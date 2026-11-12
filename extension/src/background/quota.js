/**
 * OutFox — quotas, business hours, warm-up, backoff and pacing.
 *
 * Every write in the engine goes `check(kind)` → `humanDelay()` → the Voyager
 * call → `record(kind)`. Reads that consume a metered resource (search
 * results) do the same against the `search` bucket.
 *
 * Four buckets only, exactly as the contract says: invite, message, visit,
 * search. The effective daily cap is the *lowest* of the user's config, the
 * account preset and the hard cap, then scaled by the warm-up ramp.
 */

import { ACTIONS, ERROR, EngineError, EVENTS, HARD_CAPS } from '../lib/actions.js';
import { getConfig } from '../lib/config.js';
import { K, get, set, withKeyLock } from '../lib/storage.js';
import { register } from './engine.js';
import { emit } from './events.js';

/* ================================================================== */
/*  Constants                                                         */
/* ================================================================== */

export const KINDS = Object.freeze(['invite', 'message', 'visit', 'search', 'email']);

/** Buckets that represent an action LinkedIn attributes to a human. */
const WRITE_KINDS = new Set(['invite', 'message', 'visit', 'email']);

/** Per-day ceilings by account type. Always still under HARD_CAPS. */
export const PRESETS = Object.freeze({
  free: { invite: 25, message: 40, visit: 120, search: 300, email: 50 },
  premium: { invite: 25, message: 60, visit: 120, search: 500, email: 100 },
  salesnav: { invite: 30, message: 80, visit: 200, search: 800, email: 150 },
  recruiter: { invite: 40, message: 100, visit: 300, search: 1000, email: 200 },
});

const CONFIG_CAP_KEY = {
  invite: 'dailyInviteCap',
  message: 'dailyMessageCap',
  visit: 'dailyVisitCap',
  search: 'dailySearchCap',
  email: 'dailyEmailCap',
};

const HARD_CAP_FOR = {
  invite: HARD_CAPS.dailyInviteCap,
  message: HARD_CAPS.dailyMessageCap,
  visit: HARD_CAPS.dailyVisitCap,
  search: HARD_CAPS.dailySearchCap,
  email: HARD_CAPS.dailyEmailCap,
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** HTTP status / LinkedIn code → how long to stand down. */
export const BACKOFF_MS = Object.freeze({
  429: 15 * MINUTE,
  999: HOUR,
});

const WARMUP_FLOOR = 0.2;

/**
 * What a caller is told while the challenge latch is set, and what to do.
 *
 * Shared with `voyager-core.js`, so the gate in front of a quota bucket and the
 * gate in front of the network say the same thing in the same words.
 */
export const CHALLENGE_PAUSED_MESSAGE =
  'Paused: LinkedIn asked for a security check (a challenge) and nobody has confirmed it is ' +
  'done. Nothing will be sent until a person clears it in the popup.';

export const CHALLENGE_HOW_TO_FIX =
  'Open LinkedIn in this browser and complete the check yourself. Leave automation alone for ' +
  'a while — at least 24 hours is sensible. Then open the toolkit popup and press ' +
  '"I\'ve done it — resume". The toolkit will never try to solve or get round a security check.';

/* ================================================================== */
/*  Injectable sleep (tests replace it; production waits for real)     */
/* ================================================================== */

let sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function setSleepFn(fn) {
  sleepFn = typeof fn === 'function' ? fn : (ms) => new Promise((r) => setTimeout(r, ms));
}

/* ================================================================== */
/*  Counter state                                                     */
/* ================================================================== */

function dayKey(now) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function weekKey(now = new Date()) {
  const monday = getMonday(now);
  return `${monday.getFullYear()}-${monday.getMonth() + 1}-${monday.getDate()}`;
}

function nextWeekAt(now = new Date()) {
  const monday = getMonday(now);
  return monday.getTime() + 7 * 24 * HOUR;
}

function emptyCounts() {
  return { invite: 0, message: 0, visit: 0, search: 0, email: 0 };
}

/**
 * The stored counter state, rolled forward to the current day, hour and week.
 * Rolling is done on read so a service worker that was asleep at midnight or Monday
 * still reports the right numbers.
 */
async function readState(now = new Date()) {
  const stored = (await get(K.QUOTA, null)) || {};
  const day = dayKey(now);
  const hour = now.getHours();
  const week = weekKey(now);

  const state = {
    day,
    hour,
    weekKey: week,
    daily: stored.day === day ? { ...emptyCounts(), ...(stored.daily || {}) } : emptyCounts(),
    hourly:
      stored.day === day && stored.hour === hour
        ? { ...emptyCounts(), ...(stored.hourly || {}) }
        : emptyCounts(),
    weeklyInvites: stored.weekKey === week ? (stored.weeklyInvites || 0) : 0,
    backoffUntil: stored.backoffUntil || 0,
    bucketBackoffUntil: { invite: 0, message: 0, visit: 0, search: 0, email: 0, ...(stored.bucketBackoffUntil || {}) },
    challenge: stored.challenge || null,
  };
  return state;
}

async function writeState(state) {
  await set(K.QUOTA, state);
  return state;
}

/* ================================================================== */
/*  Caps                                                              */
/* ================================================================== */

/**
 * Warm-up multiplier for a given day index: `min(1, 0.2 + 0.8 * day / 14)`.
 * Day 0 is 20% of the cap; day 14 onwards is the full cap.
 */
export function warmupFactor(dayIndex, days = 14) {
  const span = days > 0 ? days : 14;
  const idx = Math.max(0, Math.floor(dayIndex || 0));
  return Math.min(1, WARMUP_FLOOR + (1 - WARMUP_FLOOR) * (idx / span));
}

function warmupDayIndex(config, now = Date.now()) {
  const startedAt = config.warmup && config.warmup.startedAt;
  if (!startedAt) return 0;
  return Math.floor((now - startedAt) / (24 * HOUR));
}

/**
 * Effective hourly cap for a bucket.
 *
 * `config.hourlyCap` (ceiling 50) paces the actions LinkedIn attributes to a
 * human. Search is metered in *results*, not clicks, so a single 100-result
 * page would blow a 50/hour ceiling; the search bucket is therefore governed
 * by its daily cap alone and reports that as its hourly ceiling.
 */
export function hourlyCapFor(kind, config, dailyCap) {
  return WRITE_KINDS.has(kind) ? config.hourlyCap : dailyCap;
}

/** Effective daily cap for a bucket: user-configured or preset cap, capped by hard cap × warm-up. */
export async function dailyCapFor(kind, config) {
  const cfg = config || (await getConfig());
  const preset = PRESETS[cfg.accountPreset] || PRESETS.free;
  // Use user's configured cap if set, otherwise fallback to preset; never exceed HARD_CAP_FOR
  const configured = cfg[CONFIG_CAP_KEY[kind]];
  const base = Math.min(
    typeof configured === 'number' && configured >= 0 ? configured : preset[kind],
    HARD_CAP_FOR[kind]
  );
  if (!cfg.warmup || !cfg.warmup.enabled) return base;
  const factor = warmupFactor(warmupDayIndex(cfg), cfg.warmup.days);
  return Math.max(1, Math.floor(base * factor));
}

/* ================================================================== */
/*  Business hours                                                    */
/* ================================================================== */

/** True when `now` sits inside the configured working window. */
export function isWithinBusinessHours(config, now = new Date()) {
  // If 24/7 Always Active mode is enabled (businessHoursOnly is false), always return true!
  if (!config.businessHoursOnly) return true;

  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  if (config.weekdaysOnly && (day === 0 || day === 6)) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let startMinutes = 0;
  let endMinutes = 24 * 60;

  if (config.businessStartTime && typeof config.businessStartTime === 'string') {
    const [h, m] = config.businessStartTime.split(':').map(Number);
    startMinutes = (h || 0) * 60 + (m || 0);
  } else if (config.businessStart !== undefined) {
    startMinutes = Number(config.businessStart) * 60;
  }

  if (config.businessEndTime && typeof config.businessEndTime === 'string') {
    const [h, m] = config.businessEndTime.split(':').map(Number);
    endMinutes = (h || 0) * 60 + (m || 0);
  } else if (config.businessEnd !== undefined) {
    endMinutes = Number(config.businessEnd) * 60;
  }

  // Handle midnight wrap-around if start > end (e.g. night shift 22:00 to 06:00)
  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Spans across midnight
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/* ================================================================== */
/*  Backoff and challenges                                            */
/* ================================================================== */

/**
 * Record a LinkedIn stand-down signal.
 *  - 429 → 15 minutes
 *  - 999 → 1 hour
 *  - 451 → security challenge: every bucket is blocked until `clearChallenge()`
 * Anything else backs off for a minute.
 */
export async function noteBackoff(status) {
  if (Number(status) === 451) return noteChallenge();

  const now = Date.now();
  return withKeyLock(K.QUOTA, async () => {
    const current = await readState(new Date(now));
    const ms = BACKOFF_MS[Number(status)] || MINUTE;
    current.backoffUntil = Math.max(current.backoffUntil, now + ms);
    return writeState(current);
  });
}

/**
 * Set the challenge latch: LinkedIn has asked the human to confirm it is them.
 *
 * A 451 is one way that arrives. The usual way is not a status at all — the
 * request is redirected to a check page and comes back `200 text/html` — so
 * `voyagerFetch` calls this for anything `classifyResponse` calls a challenge.
 *
 * Every bucket is blocked from here until `clearChallenge()`, and only a
 * person pressing a button in the popup calls that. Nothing in the engine
 * clears it, waits it out, retries past it or routes round it.
 *
 * A latch that is already set keeps its original time: the first detection is
 * the one the "wait a day" advice in the popup is counted from.
 */
export async function noteChallenge() {
  const now = Date.now();
  let fresh = false;

  const state = await withKeyLock(K.QUOTA, async () => {
    const current = await readState(new Date(now));
    if (!current.challenge) {
      current.challenge = { detectedAt: now };
      fresh = true;
    }
    return writeState(current);
  });

  if (fresh) await emit(EVENTS.CHALLENGE_DETECTED, { detectedAt: state.challenge.detectedAt });
  return state;
}

/**
 * Record a bucket-specific LinkedIn stand-down signal (e.g. invite limit reached).
 * Pauses only that specific action kind instead of blocking the entire extension.
 */
export async function noteBucketBackoff(kind, ms = 24 * HOUR) {
  assertKind(kind);
  const now = Date.now();
  return withKeyLock(K.QUOTA, async () => {
    const current = await readState(new Date(now));
    if (!current.bucketBackoffUntil) {
      current.bucketBackoffUntil = { invite: 0, message: 0, visit: 0, search: 0, email: 0 };
    }
    current.bucketBackoffUntil[kind] = Math.max(current.bucketBackoffUntil[kind] || 0, now + ms);
    return writeState(current);
  });
}

/** Clear a security challenge once the human has dealt with it. */
export async function clearChallenge() {
  return withKeyLock(K.QUOTA, async () => {
    const state = await readState();
    state.challenge = null;
    state.backoffUntil = 0;
    state.bucketBackoffUntil = { invite: 0, message: 0, visit: 0, search: 0 };
    return writeState(state);
  });
}

/** `{ backoffUntil?, challenge? }` for `status.get`. */
export async function pauseState() {
  const state = await readState();
  const out = {};
  if (state.backoffUntil > Date.now()) out.backoffUntil = state.backoffUntil;
  if (state.challenge) out.challenge = state.challenge;
  return out;
}

/* ================================================================== */
/*  check / record / snapshot                                         */
/* ================================================================== */

function assertKind(kind) {
  if (!KINDS.includes(kind)) {
    throw new EngineError(ERROR.INTERNAL, `unknown quota bucket: ${kind}`);
  }
}

/**
 * Gate one unit of work.
 *
 * @param {'invite'|'message'|'visit'|'search'} kind
 * @param {number} [cost] units this call will consume (search counts results)
 * @throws {EngineError} CHALLENGE_DETECTED | RATE_LIMITED | OUTSIDE_BUSINESS_HOURS | QUOTA_EXCEEDED
 * @returns {Promise<object>} the RateLimit snapshot that permitted the call
 */
export async function check(kind, cost = 1) {
  assertKind(kind);
  return gate(kind, cost);
}

/**
 * Check and count in one indivisible step.
 *
 * `check` then `record` as two awaits is a race: two writes that both see
 * `daily = cap - 1` will both pass and both count, taking the account one over
 * a hard cap. Every caller that is about to actually do the thing should
 * reserve instead, and accept that a reserved unit is spent whether or not
 * LinkedIn answers — over-counting is safe, under-counting is not.
 */
export async function reserve(kind, cost = 1) {
  assertKind(kind);
  return withKeyLock(K.QUOTA, async () => {
    const rateLimit = await gate(kind, cost);
    await bump(kind, cost);
    return rateLimit;
  });
}

async function gate(kind, cost) {
  const now = Date.now();
  const config = await getConfig();
  const state = await readState(new Date(now));

  if (state.challenge) {
    throw new EngineError(ERROR.CHALLENGE_DETECTED, CHALLENGE_PAUSED_MESSAGE, {
      howToFix: CHALLENGE_HOW_TO_FIX,
    });
  }

  if (state.backoffUntil > now) {
    throw new EngineError(ERROR.RATE_LIMITED, 'Paused after a LinkedIn rate-limit response.', {
      retryAfter: state.backoffUntil - now,
    });
  }

  if (state.bucketBackoffUntil && state.bucketBackoffUntil[kind] > now) {
    throw new EngineError(
      ERROR.RATE_LIMITED,
      `Paused after a LinkedIn limit response for ${kind}.`,
      {
        retryAfter: state.bucketBackoffUntil[kind] - now,
      },
    );
  }

  if (config.businessHoursOnly && WRITE_KINDS.has(kind) && !isWithinBusinessHours(config)) {
    const startDisplay = config.businessStartTime || `${String(config.businessStart || 9).padStart(2, '0')}:00`;
    const endDisplay = config.businessEndTime || `${String(config.businessEnd || 19).padStart(2, '0')}:00`;
    throw new EngineError(
      ERROR.OUTSIDE_BUSINESS_HOURS,
      `Outside the configured sending schedule (${startDisplay}–${endDisplay}${
        config.weekdaysOnly ? ', weekdays only' : ''
      }). Paused for sleep mode.`,
      { howToFix: 'Wait for the window, or enable 24/7 Always Active mode in settings.' },
    );
  }

  const dailyCap = await dailyCapFor(kind, config);
  const hourlyCap = hourlyCapFor(kind, config, dailyCap);
  if (state.hourly[kind] + cost > hourlyCap) {
    throw new EngineError(
      ERROR.QUOTA_EXCEEDED,
      `Hourly cap reached for ${kind} (${hourlyCap}/hour).`,
      { retryAfter: nextHourAt(now) - now },
    );
  }

  // Weekly invite budget check
  if (kind === 'invite') {
    const weeklyCap = config.weeklyInviteCap ?? 150;
    if (state.weeklyInvites + cost > weeklyCap) {
      await emit(EVENTS.QUOTA_HIT, {
        kind: 'invite',
        scope: 'weekly',
        used: state.weeklyInvites,
        cap: weeklyCap,
        resetsAt: nextWeekAt(now),
      });
      throw new EngineError(
        ERROR.QUOTA_EXCEEDED,
        `Weekly invite cap reached (${weeklyCap}/week).`,
        { retryAfter: nextWeekAt(now) - now },
      );
    }
  }

  if (state.daily[kind] + cost > dailyCap) {
    await emit(EVENTS.QUOTA_HIT, {
      kind,
      used: state.daily[kind],
      cap: dailyCap,
      resetsAt: nextDayAt(now),
    });
    throw new EngineError(
      ERROR.QUOTA_EXCEEDED,
      `Daily ${kind} cap reached (${dailyCap}/day).`,
      { retryAfter: nextDayAt(now) - now },
    );
  }

  return toRateLimit(state, kind, hourlyCap, dailyCap, now, config);
}

/** Count `n` units against a bucket (search records the number of results). */
export async function record(kind, n = 1) {
  assertKind(kind);
  return withKeyLock(K.QUOTA, () => bump(kind, n));
}

/**
 * Hand a reservation back.
 *
 * The standing rule is that a reserved unit stays spent whether or not
 * LinkedIn answers — over-counting is safe, under-counting is not, and a
 * refused write may well have been seen by LinkedIn anyway. This is the one
 * exception: when *we* refused the send ourselves, before a single byte left
 * the browser, LinkedIn never saw it and there is nothing to be careful about.
 *
 * Only `send()` in outreach.js calls this, and only for its own INVALID_PARAMS.
 */
export async function release(kind, n = 1) {
  assertKind(kind);
  return withKeyLock(K.QUOTA, async () => {
    const units = Math.max(0, Math.round(n));
    if (!units) return (await readState()).daily[kind];
    const state = await readState();
    state.daily[kind] = Math.max(0, state.daily[kind] - units);
    state.hourly[kind] = Math.max(0, state.hourly[kind] - units);
    if (kind === 'invite' && state.weeklyInvites) {
      state.weeklyInvites = Math.max(0, state.weeklyInvites - units);
    }
    await writeState(state);
    return state.daily[kind];
  });
}

/** The counter increment itself. Callers must already hold the quota lock. */
async function bump(kind, n) {
  const units = Math.max(0, Math.round(n));
  if (!units) return (await readState()).daily[kind];
  const state = await readState();
  state.daily[kind] += units;
  state.hourly[kind] += units;
  if (kind === 'invite') {
    state.weeklyInvites = (state.weeklyInvites || 0) + units;
  }
  await writeState(state);
  return state.daily[kind];
}

function nextHourAt(now) {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  return d.getTime() + HOUR;
}

function nextDayAt(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + 24 * HOUR;
}

function toRateLimit(state, kind, hourlyCap, dailyCap, now, config) {
  let nextAllowedAt = 0;
  if (state.challenge) nextAllowedAt = Number.MAX_SAFE_INTEGER;
  else if (state.backoffUntil > now) nextAllowedAt = state.backoffUntil;
  else if (state.bucketBackoffUntil && state.bucketBackoffUntil[kind] > now) nextAllowedAt = state.bucketBackoffUntil[kind];
  else if (kind === 'invite' && state.weeklyInvites >= (config?.weeklyInviteCap ?? 150)) nextAllowedAt = nextWeekAt(now);
  else if (state.hourly[kind] >= hourlyCap) nextAllowedAt = nextHourAt(now);
  else if (state.daily[kind] >= dailyCap) nextAllowedAt = nextDayAt(now);

  const weeklyCap = kind === 'invite' ? (config?.weeklyInviteCap ?? 150) : undefined;
  const weeklyUsed = kind === 'invite' ? (state.weeklyInvites || 0) : undefined;

  return {
    hourlyUsed: state.hourly[kind],
    hourlyCap,
    dailyUsed: state.daily[kind],
    dailyCap,
    usedToday: state.daily[kind],
    max: dailyCap,
    weeklyUsed,
    weeklyCap,
    nextAllowedAt,
  };
}

/** RateLimit for one bucket. Wired into the engine via `setRateLimitProvider`. */
export async function snapshot(kind) {
  assertKind(kind);
  const now = Date.now();
  const config = await getConfig();
  const state = await readState(new Date(now));
  const dailyCap = await dailyCapFor(kind, config);
  return toRateLimit(state, kind, hourlyCapFor(kind, config, dailyCap), dailyCap, now, config);
}

/** RateLimit for all four buckets — the `quotas` field of `Status`. */
export async function snapshotAll() {
  const out = {};
  for (const kind of KINDS) out[kind] = await snapshot(kind);
  return out;
}

/* ================================================================== */
/*  Pacing                                                            */
/* ================================================================== */

let sessionWriteCount = 0;
let nextBreakInterval = 12 + Math.floor(Math.random() * 4); // 12-15 actions

function gaussianRandom(min, max) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  const mean = (min + max) / 2;
  const stdDev = Math.max(1, (max - min) / 6);
  const val = mean + num * stdDev;
  return Math.min(max, Math.max(min, Math.round(val)));
}

/** Sleep with humanized pacing: Gaussian bell-curve distribution and periodic coffee breaks. */
export async function humanDelay() {
  const config = await getConfig();
  let ms;

  if (config.humanPacing !== false) {
    ms = gaussianRandom(config.minDelayMs, config.maxDelayMs);
    sessionWriteCount += 1;
    if (sessionWriteCount >= nextBreakInterval) {
      sessionWriteCount = 0;
      nextBreakInterval = 12 + Math.floor(Math.random() * 4);
      const coffeeBreakMs = 60000 + Math.floor(Math.random() * 60000); // 60-120 seconds
      await sleepFn(coffeeBreakMs);
    }
  } else {
    const spread = Math.max(0, config.maxDelayMs - config.minDelayMs);
    ms = Math.round(config.minDelayMs + Math.random() * spread);
  }

  await sleepFn(ms);
  return ms;
}

/* ================================================================== */
/*  Quota Reset                                                       */
/* ================================================================== */

/**
 * Reset quota counters (both daily and hourly) to zero.
 * @param {readonly string[]} [kinds=KINDS]
 * @param {{ resetWeekly?: boolean }} [options={}]
 */
export async function resetDailyQuota(kinds = KINDS, options = {}) {
  return withKeyLock(K.QUOTA, async () => {
    const state = await readState();
    for (const k of kinds) {
      if (state.daily[k] !== undefined) state.daily[k] = 0;
      if (state.hourly[k] !== undefined) state.hourly[k] = 0;
      if (state.bucketBackoffUntil && state.bucketBackoffUntil[k] !== undefined) {
        state.bucketBackoffUntil[k] = 0;
      }
    }
    if (options?.resetWeekly) {
      state.weeklyInvites = 0;
    }
    await writeState(state);
    return state;
  });
}

register(ACTIONS.QUOTA_RESET, (params = {}) => {
  const kinds = Array.isArray(params?.kinds) && params.kinds.length > 0 ? params.kinds : KINDS;
  return resetDailyQuota(kinds, { resetWeekly: Boolean(params?.resetWeekly) });
});

