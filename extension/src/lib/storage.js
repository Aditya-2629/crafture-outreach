/**
 * OutFox — storage helpers.
 *
 * Everything the engine persists goes through this module: a thin promise
 * wrapper over `chrome.storage.local`, the profile store, and the `actions`
 * log that feeds `contactedBefore`, campaign stats and `sync.pull`.
 *
 * Every record carries `updatedAt` so `sync.pull { since }` can answer with
 * only what changed.
 */

import { idbGet, idbGetAll, idbPut, idbPutMany, idbCount, isIdbAvailable } from './idb.js';

/* ================================================================== */
/*  Storage keys                                                      */
/* ================================================================== */

export const K = Object.freeze({
  CONFIG: 'config',
  QUOTA: 'quota',
  BUCKET_COOLDOWNS: 'outfox_bucket_cooldowns',
  NOTE_LIMIT_UNTIL: 'outfox_note_limit_until',
  TICK_LOCK: 'outfox_tick_lock',
  BLACKLIST: 'blacklist',
  COMPANY_BLACKLIST: 'company_blacklist',
  DEBUG_LOGS: 'debug_logs',

  LISTS: 'lists',
  listMembers: (listId) => `listMembers:${listId}`,

  QUEUE: 'queue',

  CAMPAIGNS: 'campaigns',
  enrollments: (campaignId) => `enrollments:${campaignId}`,

  ACTIONS: 'actions',

  PROFILE_INDEX: 'profileIndex',
  profile: (publicId) => `profile:${publicId}`,

  THREADS: 'threads',
  messages: (threadId) => `messages:${threadId}`,
  INBOX_SEEN: 'inboxSeen',

  EVENTS: 'events',

  RESEARCH_JOBS: 'researchJobs',
  researchPacks: (jobId) => `researchPacks:${jobId}`,

  BRIDGE: 'bridgeState',
});

/** Page text is captured verbatim; cap it so the profile store stays sane. */
export const MAX_PAGE_TEXT = 60000;

/** Keep the action log bounded — it is a rolling audit trail, not an archive. */
export const MAX_ACTION_LOG = 5000;

/* ================================================================== */
/*  Serialisation                                                     */
/* ================================================================== */

/**
 * One promise chain per storage key.
 *
 * `chrome.storage.local` has no compare-and-swap, so every read-modify-write
 * in the worker (quota counters, the queue, the action log, list members) is a
 * race waiting to happen: two callers read the same value and the second write
 * silently discards the first. Everything that mutates a key goes through
 * `withKeyLock`, which runs the callbacks for one key strictly in order.
 *
 * This is per-worker, not per-machine. Chrome runs exactly one service worker
 * per extension, so that is the whole population of writers.
 */
const locks = new Map();

export function withKeyLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const run = previous.then(fn, fn);

  // Keep the chain alive whether or not this callback threw, and drop the
  // entry once nothing is queued behind it — otherwise a long-running worker
  // that has touched `profile:<id>` for ten thousand people keeps ten thousand
  // settled promises alive for the rest of the session.
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(key, settled);
  settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });

  return run;
}

/** How many keys currently have a lock chain. Tests, and leak checks. */
export function lockCount() {
  return locks.size;
}

/** Wait for every queued mutation to settle (tests, and shutdown). */
export async function drainLocks() {
  await Promise.all([...locks.values()]);
}

/* ================================================================== */
/*  Primitives                                                        */
/* ================================================================== */

export async function get(key, fallback = null) {
  const data = await chrome.storage.local.get(key);
  const value = data ? data[key] : undefined;
  return value === undefined ? fallback : value;
}

export async function set(key, value) {
  await chrome.storage.local.set({ [key]: value });
  return value;
}

export async function remove(key) {
  await chrome.storage.local.remove(key);
}

export async function getMany(keys) {
  return chrome.storage.local.get(keys);
}

/** Read-modify-write a single key, serialised against every other writer. */
export async function update(key, fn, fallback = null) {
  return withKeyLock(key, async () => {
    const current = await get(key, fallback);
    const next = await fn(current);
    await set(key, next);
    return next;
  });
}

/* ================================================================== */
/*  Ids and timestamps                                                */
/* ================================================================== */

let seq = 0;

export function newId(prefix = 'id') {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Copy of `record` carrying a fresh `updatedAt`. Never mutates the input. */
export function stamp(record, at = Date.now()) {
  return { ...(record || {}), updatedAt: at };
}

/** Filter any array of stamped records by `updatedAt`. */
export function since(records, from = 0) {
  const cutoff = Number(from) || 0;
  return (records || []).filter((r) => (r.updatedAt || 0) > cutoff);
}

/* ================================================================== */
/*  Profile store                                                     */
/* ================================================================== */

function trimProfile(profile) {
  const out = { ...profile };
  if (typeof out.pageText === 'string' && out.pageText.length > MAX_PAGE_TEXT) {
    out.pageText = out.pageText.slice(0, MAX_PAGE_TEXT);
  }
  return out;
}

/**
 * Merge a sparse record over a fuller one without erasing anything.
 *
 * A search hit carries `urn: ''`, `company: ''`, `skills: []` for everything it
 * does not know. Spreading that over a full profile read would blank the urn
 * we just paid a profile view for, and the next caller would fetch it again.
 * An empty value never overwrites a value we already have.
 *
 * `null` is the exception, and the distinction matters: `undefined`, `''` and
 * `[]` mean "this record does not carry that field", while `null` means "we
 * looked and could not tell". An explicit unknown has to win, or a stale
 * `connectionDegree` would survive the very read that failed to confirm it.
 */
function mergeKnown(existing, incoming) {
  const out = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const isEmpty =
      value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
    const had = out[key];
    const hadSomething =
      had !== undefined && had !== null && had !== '' && !(Array.isArray(had) && !had.length);
    if (isEmpty && hadSomething) continue;
    out[key] = value;
  }
  return out;
}

let migrationChecked = false;
async function ensureIdbMigrated() {
  if (migrationChecked || !isIdbAvailable()) return;
  migrationChecked = true;
  try {
    const profCount = await idbCount('profiles');
    if (profCount === 0) {
      const index = await get(K.PROFILE_INDEX, []);
      if (index.length) {
        const data = await getMany(index.map(K.profile));
        const list = index.map((id) => data[K.profile(id)]).filter(Boolean);
        if (list.length) await idbPutMany('profiles', list);
      }
    }

    const actCount = await idbCount('actions');
    if (actCount === 0) {
      const acts = await get(K.ACTIONS, []);
      if (acts.length) await idbPutMany('actions', acts);
    }
  } catch (err) {
    console.warn('[Storage] migration to IDB skipped:', err);
  }
}

/**
 * Upsert a Profile. Existing fields survive a partial write, so a cheap search
 * hit never erases a full capture.
 */
export async function putProfile(profile) {
  const publicId = profile && profile.publicId;
  if (!publicId) return null;

  const key = K.profile(publicId);
  const merged = await withKeyLock(key, async () => {
    let existing = null;
    if (isIdbAvailable()) {
      existing = await idbGet('profiles', publicId);
    }
    if (!existing) {
      existing = await get(key, null);
    }
    const record = stamp(
      trimProfile({ ...mergeKnown(existing || {}, profile), publicId }),
      profile.updatedAt || Date.now(),
    );
    await set(key, record);
    if (isIdbAvailable()) {
      await idbPut('profiles', record);
    }
    return record;
  });

  await update(
    K.PROFILE_INDEX,
    (index) => (index.includes(publicId) ? index : [...index, publicId]),
    [],
  );
  return merged;
}

export const setProfile = putProfile;

export async function putProfiles(profiles) {
  const out = [];
  for (const p of profiles || []) {
    const rec = await putProfile(p);
    if (rec) out.push(rec);
  }
  return out;
}

export async function getStoredProfile(publicId) {
  if (!publicId) return null;
  await ensureIdbMigrated();
  if (isIdbAvailable()) {
    const fromIdb = await idbGet('profiles', publicId);
    if (fromIdb) return fromIdb;
  }
  return get(K.profile(publicId), null);
}

export async function allProfiles() {
  await ensureIdbMigrated();
  if (isIdbAvailable()) {
    const idbList = await idbGetAll('profiles');
    if (idbList && idbList.length) return idbList;
  }
  const index = await get(K.PROFILE_INDEX, []);
  if (!index.length) return [];
  const data = await getMany(index.map(K.profile));
  return index.map((id) => data[K.profile(id)]).filter(Boolean);
}

export async function profilesSince(from = 0) {
  return since(await allProfiles(), from);
}

/* ================================================================== */
/*  Action log                                                        */
/* ================================================================== */

/** Actions that count as having reached out to somebody. */
const CONTACT_ACTIONS = new Set([
  'outreach.invite',
  'outreach.message',
  'outreach.inmail',
  'outreach.comment',
]);

/**
 * Append one entry to the `actions` log.
 * @param {{action: string, publicId?: string, origin?: string, result?: object, at?: number, campaignId?: string, stepIndex?: number}} entry
 */
export async function logAction(entry) {
  const record = {
    id: newId('act'),
    action: entry.action,
    publicId: entry.publicId || '',
    at: entry.at || Date.now(),
    origin: entry.origin || 'popup',
    result: entry.result || null,
  };
  if (entry.campaignId) record.campaignId = entry.campaignId;
  if (entry.stepIndex !== undefined) record.stepIndex = entry.stepIndex;
  record.updatedAt = record.at;

  if (isIdbAvailable()) {
    await idbPut('actions', record);
  }

  await update(
    K.ACTIONS,
    (log) => {
      const next = [...log, record];
      return next.length > MAX_ACTION_LOG ? next.slice(-MAX_ACTION_LOG) : next;
    },
    [],
  );
  return record;
}

export async function allActions() {
  await ensureIdbMigrated();
  if (isIdbAvailable()) {
    const idbActs = await idbGetAll('actions');
    if (idbActs && idbActs.length) return idbActs;
  }
  return get(K.ACTIONS, []);
}

export async function getStorageHealth() {
  const isAvailable = isIdbAvailable();
  let count = 0;
  if (isAvailable) {
    count = await idbCount('profiles');
  }
  if (!count) {
    const index = await get(K.PROFILE_INDEX, []);
    count = index.length;
  }
  return {
    isIdbActive: isAvailable,
    profileCount: count,
  };
}

export async function actionsSince(from = 0) {
  const cutoff = Number(from) || 0;
  return (await allActions()).filter((e) => (e.at || 0) > cutoff);
}

export async function actionsFor(publicId) {
  return (await allActions()).filter((e) => e.publicId === publicId);
}

/** True when we have already invited, messaged, InMailed or commented at them. */
export async function contactedBefore(publicId) {
  if (!publicId) return false;
  return (await allActions()).some(
    (e) => e.publicId === publicId && CONTACT_ACTIONS.has(e.action),
  );
}

/** Batch form of `contactedBefore` — one storage read for a whole list. */
export async function contactedSet() {
  const log = await allActions();
  const out = new Set();
  for (const e of log) if (CONTACT_ACTIONS.has(e.action) && e.publicId) out.add(e.publicId);
  return out;
}

/* ================================================================== */
/*  Do Not Contact Blacklist                                          */
/* ================================================================== */

export async function getBlacklist() {
  return get(K.BLACKLIST, []);
}

export async function isBlacklisted(publicId) {
  if (!publicId) return false;
  const list = await getBlacklist();
  return list.includes(publicId);
}

export async function addToBlacklist(publicId) {
  if (!publicId) return [];
  return update(
    K.BLACKLIST,
    (current) => {
      const set = new Set(current || []);
      set.add(publicId);
      return Array.from(set);
    },
    [],
  );
}

export async function removeFromBlacklist(publicId) {
  if (!publicId) return [];
  return update(
    K.BLACKLIST,
    (current) => (current || []).filter((id) => id !== publicId),
    [],
  );
}

/* ================================================================== */
/*  Company & Domain Exclusion                                        */
/* ================================================================== */

export function normalizeCompany(val) {
  return String(val || '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|pvt|limited|technologies|solutions)\b\.?/g, '')
    .replace(/[^a-z0-9.]/g, ' ')
    .replace(/\.+(\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function getCompanyBlacklist() {
  return get(K.COMPANY_BLACKLIST, []);
}

export async function addCompanyToBlacklist(companyOrDomain) {
  const clean = normalizeCompany(companyOrDomain);
  if (!clean) return [];
  return update(
    K.COMPANY_BLACKLIST,
    (current) => Array.from(new Set([...(current || []), clean])),
    [],
  );
}

export async function removeCompanyFromBlacklist(companyOrDomain) {
  const clean = normalizeCompany(companyOrDomain);
  return update(
    K.COMPANY_BLACKLIST,
    (current) => (current || []).filter((c) => c !== clean),
    [],
  );
}

export async function isCompanyBlacklisted(profile = {}) {
  const blocked = await getCompanyBlacklist();
  if (!blocked.length) return false;
  const company = normalizeCompany(profile.company || profile.companyName || '');
  const domain = String(profile.companyDomain || profile.domain || '').toLowerCase().trim();
  const headline = String(profile.headline || '').toLowerCase();

  return blocked.some((term) => {
    if (domain && domain.includes(term)) return true;
    if (company && (company === term || company.includes(term))) return true;
    if (headline && term.length > 3 && headline.includes(term)) return true;
    return false;
  });
}

/** Check if LinkedIn monthly personalized note limit is active */
export async function isNoteLimitActive() {
  try {
    const until = await get(K.NOTE_LIMIT_UNTIL, 0);
    return typeof until === 'number' && Date.now() < until;
  } catch {
    return false;
  }
}

/** Record note limit active timestamp (defaults to 24h) */
export async function setNoteLimitActive(ms = 24 * 60 * 60 * 1000) {
  try {
    await set(K.NOTE_LIMIT_UNTIL, Date.now() + ms);
  } catch {}
}

/* ================================================================== */
/*  Centralized Debug & Activity Logger                               */
/* ================================================================== */

/**
 * Append a debug/activity entry to rolling log and broadcast to open dashboard views.
 * @param {'info'|'good'|'warn'|'error'} level
 * @param {string} tag E.g. 'Runner', 'Outreach', 'Importer', 'Pacing'
 * @param {string} message
 * @param {any} data Optional payload or error details
 */
export async function logDebug(level, tag, message, data = null) {
  const entry = {
    timestamp: new Date().toLocaleTimeString(),
    level: level || 'info',
    tag: tag || 'Sys',
    message: String(message || ''),
    data: data ? (typeof data === 'object' ? JSON.stringify(data) : String(data)) : null,
  };

  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await update(
        K.DEBUG_LOGS,
        (current = []) => {
          const list = Array.isArray(current) ? current : [];
          list.push(entry);
          return list.slice(-100);
        },
        [],
      );
    }
  } catch (err) {
    console.warn('[logDebug storage error]', err);
  }

  // Broadcast to open dashboard tabs
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: 'LOG_ENTRY', entry }, () => {
        if (chrome.runtime.lastError) {} // Suppress unchecked error if no receiver open
      });
    }
  } catch {}

  const consolePrefix = `[${entry.timestamp}] [${entry.tag}]`;
  if (level === 'error') console.error(consolePrefix, entry.message, data || '');
  else if (level === 'warn') console.warn(consolePrefix, entry.message, data || '');
  else console.log(consolePrefix, entry.message, data || '');

  return entry;
}


