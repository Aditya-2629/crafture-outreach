/**
 * OutFox — sequence engine v2.
 *
 * A campaign is a tree of steps; an enrollment is one person's position in
 * that tree (`path` names the branch arms taken, `stepIndex` the position
 * inside the current arm). `tick()` moves every due enrollment forward by one
 * step, and every write it makes goes through the engine with origin
 * `campaign`, so Copilot mode and the quotas apply exactly as they do
 * everywhere else.
 */

import { ACTIONS, ERROR, EVENTS, EngineError, INVITE_NOTE_MAX } from '../lib/actions.js';
import { getConfig } from '../lib/config.js';
import { handle, register } from './engine.js';
import { K, allActions, get, getStoredProfile, putProfile, newId, remove, set, stamp, isBlacklisted, getBlacklist, addToBlacklist, removeFromBlacklist, logDebug, isCompanyBlacklisted, getCompanyBlacklist, addCompanyToBlacklist, removeCompanyFromBlacklist, isNoteLimitActive } from '../lib/storage.js';
import { pickVariant, renderTemplate } from '../lib/template.js';
import { emit } from './events.js';
import * as inbox from './inbox.js';
import { isWithinBusinessHours, getBucketCooldowns, setBucketCooldown, isBucketCoolingDown, getNextActiveWindowStart, normalizeBucket, sleep, check as checkQuota } from './quota.js';
import * as lists from './lists.js';
import * as queue from './queue.js';
import { enrichLead } from './enrich.js';
import * as voyager from './voyager.js';

// network.status must be registered for the 'accepted' branch to resolve.
import './extract.js';

/** Step type → the contract action that performs it. */
const STEP_ACTION = {
  view: ACTIONS.OUTREACH_VIEW,
  follow: ACTIONS.OUTREACH_FOLLOW,
  invite: ACTIONS.OUTREACH_INVITE,
  message: ACTIONS.OUTREACH_MESSAGE,
  inmail: ACTIONS.OUTREACH_INMAIL,
  like: ACTIONS.OUTREACH_LIKE,
  comment: ACTIONS.OUTREACH_COMMENT,
  email: ACTIONS.OUTREACH_EMAIL,
  endorse: ACTIONS.OUTREACH_ENDORSE,
};

/** Errors that mean nothing else will work this tick either. */
const STOP_THE_TICK = new Set([
  ERROR.OUTSIDE_BUSINESS_HOURS,
  ERROR.CHALLENGE_DETECTED,
  ERROR.NOT_LOGGED_IN,
]);

/** Max actions executed per tick to prevent burst firing (OutFox-style distributed drip) */
export const DEFAULT_MAX_ACTIONS_PER_TICK = 1;
let maxActionsPerTick = DEFAULT_MAX_ACTIONS_PER_TICK;

export function setMaxActionsPerTick(n) {
  maxActionsPerTick = n;
}

export function getMaxActionsPerTick() {
  return maxActionsPerTick;
}

export let PROSPECT_COOLDOWN_MS = 60 * 1000;

export function setProspectCooldownMs(ms) {
  PROSPECT_COOLDOWN_MS = ms;
}
export const activeProspectLocks = new Set();
export const lastProspectActionAt = new Map();

export function clearRecentConnectionsCache() {
  cachedRecentConnections = null;
  cachedRecentConnectionsAt = 0;
  profileCheckedCache.clear();
}

export function clearProspectLocks() {
  activeProspectLocks.clear();
  lastProspectActionAt.clear();
  clearRecentConnectionsCache();
}

export const CAMPAIGN_TICK_ALARM_NAME = 'outfox-campaign-tick';

/** Schedule next tick alarm with human spacing */
export function scheduleNextTickAlarm(minutes = null) {
  try {
    if (typeof chrome !== 'undefined' && chrome.alarms?.create) {
      const delay = minutes ?? (1 + Math.random() * 1.5);
      chrome.alarms.create(CAMPAIGN_TICK_ALARM_NAME, {
        delayInMinutes: delay,
      });
    }
  } catch {
    /* ignore in environments without alarms API */
  }
}

/**
 * Lightweight Watchdog: if any active campaign exists and the 'outfox-campaign-tick'
 * alarm is missing, automatically re-create it.
 * @returns {Promise<boolean>} whether an alarm was re-created
 */
export async function ensureCampaignAlarmWatchdog() {
  try {
    const campaigns = await readCampaigns();
    const hasActive = campaigns.some((c) => c.status === 'active');
    if (!hasActive) return false;

    if (typeof chrome !== 'undefined' && chrome.alarms?.get) {
      return new Promise((resolve) => {
        chrome.alarms.get(CAMPAIGN_TICK_ALARM_NAME, (existing) => {
          if (!existing) {
            scheduleNextTickAlarm(2);
            logDebug('info', 'Runner', '[Watchdog] Re-created missing campaign tick alarm for active campaigns.');
            resolve(true);
          } else {
            resolve(false);
          }
        });
      });
    }
  } catch {
    /* ignore in environments without alarms API */
  }
  return false;
}

/** Hooks run at the end of every tick (the Research Pack registers one). */
const tickHooks = [];

export function addTickHook(fn) {
  if (typeof fn === 'function') tickHooks.push(fn);
}

/** Global execution lock preventing concurrent tick execution across tabs/alarms */
export const TICK_LOCK_KEY = K.TICK_LOCK || 'outfox_tick_lock';
export const TICK_LOCK_TTL_MS = 60 * 1000; // 60-second TTL

let isTickRunning = false;

/** Check if a tick is currently running (in-memory or persistent storage lock) */
export async function isTickActive() {
  try {
    const lock = await get(TICK_LOCK_KEY, null);
    if (lock && typeof lock.lockedAt === 'number' && Date.now() - lock.lockedAt < TICK_LOCK_TTL_MS) {
      return true;
    }
  } catch {
    /* ignore storage read error */
  }
  return isTickRunning;
}

/** Acquire persistent tick lock with 60s TTL */
export async function acquireTickLock() {
  const now = Date.now();
  try {
    const lock = await get(TICK_LOCK_KEY, null);
    if (lock && typeof lock.lockedAt === 'number' && now - lock.lockedAt < TICK_LOCK_TTL_MS) {
      return false; // Still locked within TTL
    }
    await set(TICK_LOCK_KEY, { lockedAt: now });
    return true;
  } catch {
    return true;
  }
}

/** Release persistent tick lock */
export async function releaseTickLock() {
  try {
    await remove(TICK_LOCK_KEY);
  } catch {
    /* ignore */
  } finally {
    isTickRunning = false;
  }
}

/** Record a chronological history event onto an enrollment */
export function recordHistory(enrollment, { step, label, status = 'completed', error = '', reason = '' }) {
  if (!enrollment) return;
  if (!Array.isArray(enrollment.history)) {
    enrollment.history = [];
  }
  enrollment.history.push({
    step: step || 'step',
    label: label || step || 'Action',
    status,
    timestamp: Date.now(),
    ...(error ? { error } : {}),
    ...(reason ? { reason } : {}),
  });
}

/* ================================================================== */
/*  Storage + v1 migration                                            */
/* ================================================================== */

const V1_STEP_TYPES = { view_profile: 'view', send_invite: 'invite', send_message: 'message' };

/** v1 step list → contract Steps, turning `delay_hours` into real wait steps. */
export function migrateSteps(steps = []) {
  const out = [];
  for (const step of steps) {
    if (step.type === 'wait') {
      out.push({ type: 'wait', waitMs: (step.delay_hours || 24) * 3600000 });
      continue;
    }
    const type = V1_STEP_TYPES[step.type] || step.type;
    if (step.delay_hours) out.push({ type: 'wait', waitMs: step.delay_hours * 3600000 });
    const next = { type };
    if (type === 'invite' && step.message_template) next.note = step.message_template;
    if ((type === 'message' || type === 'inmail') && step.message_template) {
      next.body = step.message_template;
    }
    out.push(next);
  }
  return out;
}

/** A v1 campaign record → the contract Campaign plus its enrollments. */
export function migrateCampaign(v1) {
  const campaign = stamp({
    campaignId: v1.campaignId || v1.id || newId('camp'),
    name: v1.name || 'Untitled campaign',
    steps: migrateSteps(v1.steps),
    status: v1.status === 'completed' ? 'completed' : v1.status || 'active',
    createdAt: v1.createdAt || Date.now(),
    settings: { stopOnReply: true, autopilot: false, ...(v1.settings || {}) },
    variantCursor: 0,
    migratedFrom: 'v1',
  });

  const enrollments = (v1.contacts || []).map((c) =>
    stamp({
      publicId: c.publicIdentifier || c.publicId || '',
      stepIndex: c.currentStep || 0,
      path: [],
      nextAt: 0,
      status: c.replied ? 'replied' : 'active',
      lastActionAt: c.lastStepAt ? new Date(c.lastStepAt).getTime() : 0,
      enrolledAt: v1.createdAt || Date.now(),
      history: [
        {
          step: 'enrolled',
          label: 'Enrolled in campaign',
          status: c.replied ? 'replied' : 'active',
          timestamp: c.lastStepAt ? new Date(c.lastStepAt).getTime() : (v1.createdAt || Date.now()),
        },
      ],
    }),
  );

  return { campaign, enrollments };
}

function isV1(record) {
  return Array.isArray(record.contacts) || !record.settings;
}

/** Read the campaign list, migrating any v1 records the first time. */
export async function readCampaigns() {
  const raw = await get(K.CAMPAIGNS, []);
  if (!raw.some(isV1)) return raw;

  const migrated = [];
  for (const record of raw) {
    if (!isV1(record)) {
      migrated.push(record);
      continue;
    }
    const { campaign, enrollments } = migrateCampaign(record);
    await set(K.enrollments(campaign.campaignId), enrollments);
    migrated.push(campaign);
  }
  await set(K.CAMPAIGNS, migrated);
  return migrated;
}

async function writeCampaigns(campaigns) {
  await set(K.CAMPAIGNS, campaigns);
  return campaigns;
}

export async function readEnrollments(campaignId) {
  return get(K.enrollments(campaignId), []);
}

export async function writeEnrollments(campaignId, enrollments) {
  await set(K.enrollments(campaignId), enrollments);
  return enrollments;
}

async function requireCampaign(campaignId) {
  const campaign = (await readCampaigns()).find((c) => c.campaignId === campaignId);
  if (!campaign) throw new EngineError(ERROR.NOT_FOUND, `Campaign ${campaignId} not found.`);
  return campaign;
}

/* ================================================================== */
/*  Step tree navigation                                              */
/* ================================================================== */

/**
 * The step array an enrollment is currently inside.
 * `path` is pairs of [branchStepIndex, 0 for `then` | 1 for `else`].
 */
export function stepsAt(campaign, path = []) {
  let steps = campaign.steps || [];
  for (let i = 0; i + 1 < path.length; i += 2) {
    const branch = (steps[path[i]] || {}).branch;
    if (!branch) return [];
    steps = (path[i + 1] === 0 ? branch.then : branch.else) || [];
  }
  return steps;
}

/** Move one step on, climbing out of any branch arms that just finished. */
function advance(campaign, enrollment, completedStep = null) {
  enrollment.stepIndex += 1;
  delete enrollment.parkReason;
  while (enrollment.path.length >= 2 && enrollment.stepIndex >= stepsAt(campaign, enrollment.path).length) {
    const branchIndex = enrollment.path[enrollment.path.length - 2];
    enrollment.path = enrollment.path.slice(0, -2);
    enrollment.stepIndex = branchIndex + 1;
  }
  // When a step completes, ensure advance() sets a realistic nextAt delay
  // so the subsequent step does not immediately execute on the next tick
  if (completedStep) {
    const nextSteps = stepsAt(campaign, enrollment.path);
    const nextStep = nextSteps[enrollment.stepIndex];
    if (nextStep && nextStep.type !== 'wait' && nextStep.type !== 'branch') {
      const delayMs = completedStep.type === 'view'
        ? Math.floor(Math.random() * (30 - 15 + 1) + 15) * 60 * 1000 // 15–30m
        : Math.floor(Math.random() * (60 - 30 + 1) + 30) * 60 * 1000; // 30–60m
      enrollment.nextAt = Date.now() + delayMs;
      logDebug('info', 'Pacing', `[Step Stagger] ${completedStep.type} completed for ${enrollment.publicId}. Next step scheduled in ${(delayMs / 60000).toFixed(0)}m.`);
    } else {
      enrollment.nextAt = 0;
    }
  }
}

function isFinished(campaign, enrollment) {
  return enrollment.path.length === 0 && enrollment.stepIndex >= (campaign.steps || []).length;
}

/** Mark an enrollment finished. `accepted` is kept as the richer outcome. */
async function finish(campaign, enrollment) {
  enrollment.status = enrollment.accepted ? 'accepted' : 'done';
  enrollment.updatedAt = Date.now();
  recordHistory(enrollment, {
    step: 'completed',
    label: enrollment.accepted ? 'Sequence finished (Connection Accepted)' : 'Sequence finished',
    status: 'completed',
  });
  await emit(EVENTS.CAMPAIGN_COMPLETED, {
    campaignId: campaign.campaignId,
    publicId: enrollment.publicId,
  });
}

/* ================================================================== */
/*  Campaign CRUD                                                     */
/* ================================================================== */

export async function create({ name, steps, listId, publicIds, settings, sheetWebhookUrl, sheetUrl, autoEnrichMissingEmail }) {
  const campaigns = await readCampaigns();
  const campaign = stamp({
    campaignId: newId('camp'),
    name,
    steps: steps || [],
    status: 'active',
    createdAt: Date.now(),
    settings: { stopOnReply: true, autopilot: false, ...(settings || {}) },
    variantCursor: 0,
    autoEnrichMissingEmail: autoEnrichMissingEmail !== false,
    ...(sheetWebhookUrl ? { sheetWebhookUrl } : {}),
    ...(sheetUrl ? { sheetUrl } : {}),
  });
  campaigns.push(campaign);
  await writeCampaigns(campaigns);

  const ids = [...(publicIds || [])];
  if (listId) {
    try {
      const listMembers = await lists.allMembers(listId);
      for (const member of listMembers) {
        const pid = member.publicId || member.profile?.publicId;
        if (pid) ids.push(pid);
      }
    } catch (e) {
      console.warn('[Campaigns] Failed to load list members for', listId, e.message);
    }
  }
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length) await enroll(campaign.campaignId, uniqueIds);

  if (campaign.status === 'active') {
    scheduleNextTickAlarm();
    setTimeout(() => {
      tick().catch((err) => console.error('[Runner] Immediate tick error on create:', err));
    }, 50);
  }

  return withStats(campaign);
}

export async function getAll() {
  const campaigns = await readCampaigns();
  const out = [];
  for (const campaign of campaigns) out.push(await withStats(campaign));
  return out;
}

export async function getOne(campaignId) {
  return withStats(await requireCampaign(campaignId));
}

export async function enroll(campaignId, publicIds) {
  await requireCampaign(campaignId);
  const config = await getConfig();
  const enrollments = await readEnrollments(campaignId);
  const seen = new Set(enrollments.map((e) => e.publicId));

  const dedupeAcross = config.dedupeAcrossCampaigns !== false;
  const otherCampaignActiveProspects = new Map();

  if (dedupeAcross) {
    const allCampaigns = await readCampaigns();
    for (const other of allCampaigns) {
      if (other.campaignId === campaignId) continue;
      const otherEnrollments = await readEnrollments(other.campaignId);
      for (const enr of otherEnrollments) {
        if (['active', 'completed', 'replied', 'email_fallback_sent'].includes(enr.status)) {
          if (!otherCampaignActiveProspects.has(enr.publicId)) {
            otherCampaignActiveProspects.set(enr.publicId, other.name || other.campaignId);
          }
        }
      }
    }
  }

  let enrolled = 0;
  let skipped = 0;
  for (const publicId of publicIds) {
    if (!publicId || seen.has(publicId)) {
      skipped += 1;
      continue;
    }

    if (await isBlacklisted(publicId)) {
      skipped += 1;
      logDebug('info', 'Dedupe', `Skipped ${publicId}: prospect is blacklisted`);
      continue;
    }

    const prof = await getStoredProfile(publicId);
    if (prof && (await isCompanyBlacklisted(prof))) {
      skipped += 1;
      logDebug('info', 'Dedupe', `Skipped ${publicId}: company "${prof.company || prof.companyName || ''}" is on company exclusion list`);
      continue;
    }

    if (dedupeAcross && otherCampaignActiveProspects.has(publicId)) {
      skipped += 1;
      const otherName = otherCampaignActiveProspects.get(publicId);
      console.log(`[Dedupe] Skipped ${publicId}: already active/contacted in campaign "${otherName}"`);
      logDebug('info', 'Dedupe', `Skipped ${publicId}: already active/contacted in campaign "${otherName}"`);
      continue;
    }

    seen.add(publicId);
    enrollments.push(
      stamp({
        publicId,
        stepIndex: 0,
        path: [],
        nextAt: 0,
        status: 'active',
        lastActionAt: 0,
        enrolledAt: Date.now(),
        history: [
          {
            step: 'enrolled',
            label: 'Enrolled in campaign',
            status: 'active',
            timestamp: Date.now(),
          },
        ],
      }),
    );
    enrolled += 1;
  }

  await writeEnrollments(campaignId, enrollments);
  return { enrolled, skipped };
}

export async function setStatus(campaignId, status) {
  const campaigns = await readCampaigns();
  const campaign = campaigns.find((c) => c.campaignId === campaignId);
  if (!campaign) throw new EngineError(ERROR.NOT_FOUND, `Campaign ${campaignId} not found.`);
  campaign.status = status;
  campaign.updatedAt = Date.now();
  await writeCampaigns(campaigns);

  if (status === 'active') {
    scheduleNextTickAlarm();
    setTimeout(() => {
      tick().catch((err) => console.error('[Runner] Immediate tick error on resume:', err));
    }, 50);
  }

  return withStats(campaign);
}

export async function del(campaignId) {
  const campaign = await requireCampaign(campaignId);
  const campaigns = await readCampaigns();
  await writeCampaigns(campaigns.filter((c) => c.campaignId !== campaignId));
  await remove(K.enrollments(campaignId));
  return withStats(campaign);
}

/* ================================================================== */
/*  Stats                                                             */
/* ================================================================== */

/** Stats are derived from the action log and the enrollments, never stored. */
export async function statsFor(campaignId) {
  const enrollments = await readEnrollments(campaignId);
  const log = (await allActions()).filter((e) => e.campaignId === campaignId);
  const threads = await inbox.storedThreads();

  const enrolledIds = new Set(enrollments.map((e) => e.publicId));
  const byStep = {};
  let sent = 0;

  for (const entry of log) {
    if (!entry.result || entry.result.status !== 'sent') continue;
    sent += 1;
    const index = entry.stepIndex === undefined ? 0 : entry.stepIndex;
    byStep[index] = byStep[index] || { sent: 0 };
    byStep[index].sent += 1;
  }

  const accepted = (await allActions()).filter(
    (e) => e.action === EVENTS.INVITE_ACCEPTED && enrolledIds.has(e.publicId),
  ).length;

  const replied = enrollments.filter((e) => e.status === 'replied').length;
  const positive = threads.filter(
    (t) =>
      t.sentiment === 'positive' && t.participants.some((p) => enrolledIds.has(p.publicId)),
  ).length;

  return { enrolled: enrollments.length, sent, accepted, replied, positive, byStep };
}

async function withStats(campaign) {
  const stats = await statsFor(campaign.campaignId);
  return { ...campaign, leadsCount: stats.enrolled, stats };
}

/**
 * Real-time campaign and per-lead live status.
 * Joins campaign.enrollments with stored profiles, computes step labels,
 * countdown timers, and aggregate summary counts.
 */
export async function getCampaignLiveStatus(campaignId) {
  const allCampaigns = await readCampaigns();

  if (!campaignId) {
    const active = allCampaigns.filter((c) => c.status === 'active' || c.status === 'running');
    const results = await Promise.all(active.map((c) => getCampaignLiveStatus(c.campaignId)));
    return { campaigns: results };
  }

  const campaign = allCampaigns.find((c) => c.campaignId === campaignId || c.id === campaignId);
  if (!campaign) {
    throw new EngineError(ERROR.NOT_FOUND, `Campaign ${campaignId} not found.`);
  }

  const enrollments = await readEnrollments(campaign.campaignId);
  const now = Date.now();
  const totalSteps = campaign.steps?.length || 0;
  const isRunning = await isTickActive();

  const STEP_TYPE_LABELS = {
    invite: 'Connection Request',
    email: 'Send Email',
    message: 'Direct Message',
    view: 'View Profile',
    follow: 'Follow Profile',
    like: 'Like Post',
    comment: 'Comment on Post',
    inmail: 'Send InMail',
    wait: 'Delay Wait',
    branch: 'Check Condition',
    endorse: 'Endorse Skills',
  };

  const leads = await Promise.all(
    enrollments.map(async (enr) => {
      const profile = await getStoredProfile(enr.publicId).catch(() => null);
      const stepIndex = enr.stepIndex || 0;
      const step = campaign.steps?.[stepIndex];
      const stepNumber = stepIndex + 1;

      let currentStepLabel = '';
      if (enr.status === 'completed' || (enr.accepted && stepIndex >= totalSteps && totalSteps > 0)) {
        currentStepLabel = `Completed (${totalSteps}/${totalSteps})`;
      } else if (step) {
        const typeLabel = STEP_TYPE_LABELS[step.type] || (step.type ? step.type.toUpperCase() : 'Action');
        currentStepLabel = `Step ${stepNumber}/${totalSteps}: ${typeLabel}`;
      } else {
        currentStepLabel = totalSteps > 0 ? `Step ${stepNumber}/${totalSteps}` : 'No steps';
      }

      let status = enr.status || 'active';
      if (status === 'active') {
        if (enr.nextAt && enr.nextAt > now) {
          status = 'waiting';
        } else if (isRunning) {
          status = 'running';
        }
      } else if (
        status === 'stopped' ||
        status === 'failed' ||
        status === 'blocked_not_connected' ||
        status === 'email_skipped_no_email'
      ) {
        status = 'failed';
      }

      let leadHistory = Array.isArray(enr.history) && enr.history.length > 0 ? [...enr.history] : [];
      if (leadHistory.length === 0) {
        leadHistory.push({
          step: 'enrolled',
          label: 'Enrolled in campaign',
          status: 'completed',
          timestamp: enr.enrolledAt || (Date.now() - 3600000),
        });
        if (enr.lastActionAt && enr.lastActionAt > (enr.enrolledAt || 0)) {
          leadHistory.push({
            step: 'action',
            label: `Executed ${enr.lastRoutedAction ? 'Free InMail' : (currentStepLabel || 'step')}`,
            status: 'completed',
            timestamp: enr.lastActionAt,
          });
        }
      }

      return {
        publicId: enr.publicId,
        fullName: profile?.fullName || profile?.name || enr.publicId,
        company: profile?.company || '',
        email:
          enr.email ||
          profile?.email ||
          (profile?.enrichment && profile?.enrichment.email) ||
          profile?.enrichmentEmail ||
          '',
        status, // 'active' | 'waiting' | 'running' | 'completed' | 'replied' | 'failed' | 'paused'
        rawStatus: enr.status || 'active',
        currentStepLabel,
        stepNumber,
        totalSteps,
        nextRunAt: enr.nextAt || 0,
        lastError: enr.error || enr.lastError || '',
        lastActionAt: enr.lastActionAt || enr.enrolledAt || 0,
        accepted: Boolean(enr.accepted),
        replied: enr.status === 'replied',
        history: leadHistory,
      };
    }),
  );

  const summary = {
    total: leads.length,
    active: leads.filter((l) => l.status === 'active' || l.status === 'running').length,
    waiting: leads.filter((l) => l.status === 'waiting').length,
    completed: leads.filter((l) => l.status === 'completed').length,
    replied: leads.filter((l) => l.status === 'replied').length,
    failed: leads.filter((l) => l.status === 'failed').length,
    paused: leads.filter((l) => l.status === 'paused' || campaign.status === 'paused').length,
    currentlyRunning: isRunning ? 1 : 0,
  };

  return {
    campaignId: campaign.campaignId,
    campaignName: campaign.name,
    campaignStatus: campaign.status,
    totalSteps,
    summary,
    leads,
    abStats: campaign.abStats || null,
    steps: campaign.steps || [],
  };
}

/* ================================================================== */
/*  Step execution                                                    */
/* ================================================================== */

let cachedRecentConnections = null;
let cachedRecentConnectionsAt = 0;
const CONNECTIONS_CACHE_TTL_MS = 30 * 1000;
export const profileCheckedCache = new Map();

export async function getRecentConnections(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && cachedRecentConnections && now - cachedRecentConnectionsAt < CONNECTIONS_CACHE_TTL_MS) {
    return cachedRecentConnections;
  }
  try {
    const res = await voyager.getConnections({ count: 100 });
    cachedRecentConnections = res?.profiles || [];
    cachedRecentConnectionsAt = now;
    return cachedRecentConnections;
  } catch (err) {
    logDebug('warn', 'Runner', `[isConnected] getRecentConnections error: ${err?.message}`);
    return cachedRecentConnections || [];
  }
}

function matchesConnection(conn, normPublicId, targetMemberId, targetUrn) {
  if (!conn) return false;
  const connPublicId = String(conn.publicId || '').trim().toLowerCase();
  if (connPublicId && normPublicId && connPublicId === normPublicId) return true;

  if (targetMemberId) {
    const normTargetMem = String(targetMemberId).trim();
    if (conn.memberId && String(conn.memberId).trim() === normTargetMem) return true;
    if (conn.objectUrn && String(conn.objectUrn).replace(/^urn:li:member:/, '').trim() === normTargetMem) return true;
  }

  if (targetUrn) {
    const normTargetUrn = String(targetUrn).trim().toLowerCase();
    if (conn.urn && String(conn.urn).trim().toLowerCase() === normTargetUrn) return true;
    if (conn.objectUrn && String(conn.objectUrn).trim().toLowerCase() === normTargetUrn) return true;
  }

  return false;
}

export async function isConnected(publicId, enrollment = null, { forceFresh = false } = {}) {
  if (enrollment && enrollment.accepted === true) {
    return true;
  }
  try {
    const profile = await getStoredProfile(publicId).catch(() => null);
    // 1. If stored profile has connectionDegree === 1 or was imported as 1st connection
    if (
      profile &&
      (profile.connectionDegree === 1 ||
       profile.isConnected === true ||
       profile.degree === 1 ||
       profile.distance === 'DISTANCE_1' ||
       profile.networkDistance === 'DISTANCE_1' ||
       profile.connected === true)
    ) {
      if (enrollment) {
        enrollment.accepted = true;
        delete enrollment.parkReason;
      }
      return true;
    }

    const normPublicId = String(publicId || '').trim().toLowerCase();
    const targetMemberId =
      profile?.memberId ||
      enrollment?.memberId ||
      (normPublicId.match(/^\d+$/) ? normPublicId : null);
    const targetUrn =
      profile?.urn ||
      profile?.objectUrn ||
      enrollment?.profileUrn ||
      enrollment?.urn;

    // 2. Case-insensitive matching against getConnections({ count: 100 })
    try {
      const recentConnections = await getRecentConnections();
      const matched = recentConnections.some((conn) =>
        matchesConnection(conn, normPublicId, targetMemberId, targetUrn),
      );
      if (matched) {
        if (profile) {
          profile.connectionDegree = 1;
          profile.isConnected = true;
          await putProfile(profile).catch(() => {});
        }
        if (enrollment) {
          enrollment.accepted = true;
          delete enrollment.parkReason;
        }
        return true;
      }
    } catch (err) {
      logDebug('warn', 'Runner', `[isConnected] getConnections matching error: ${err?.message}`);
    }

    // 3. Fallback to unmetered getProfileNormalized(publicId) DISTANCE_1 check (zero quota burn)
    const lastChecked = profileCheckedCache.get(normPublicId) || 0;
    const now = Date.now();
    if (forceFresh || now - lastChecked > 60 * 1000) {
      profileCheckedCache.set(normPublicId, now);
      try {
        const normProfile = await voyager.getProfileNormalized(publicId);
        if (normProfile) {
          const deg = normProfile.connectionDegree ?? normProfile.degree;
          const dist = normProfile.distance || normProfile.networkDistance;
          const isConn =
            deg === 1 ||
            dist === 'DISTANCE_1' ||
            normProfile.connected === true ||
            normProfile.isConnected === true;
          const baseProfile = profile || { publicId };
          const updatedProfile = {
            ...normProfile,
            ...baseProfile,
            publicId,
            ...(isConn ? { connectionDegree: 1, isConnected: true } : {}),
          };
          if (baseProfile.firstName) updatedProfile.firstName = baseProfile.firstName;
          if (baseProfile.lastName) updatedProfile.lastName = baseProfile.lastName;
          if (normProfile.urn && !updatedProfile.urn) {
            updatedProfile.urn = normProfile.urn;
          }
          await putProfile(updatedProfile).catch(() => {});
          if (isConn) {
            if (enrollment) {
              enrollment.accepted = true;
              delete enrollment.parkReason;
            }
            return true;
          }
        }
      } catch (err) {
        logDebug('warn', 'Runner', `[isConnected] getProfileNormalized error for ${publicId}: ${err?.message}`);
      }
    }

    if (enrollment && !enrollment.accepted) {
      enrollment.parkReason = 'waiting_acceptance';
      enrollment.nextAt = Date.now() + 12 * 3600 * 1000;
    }
  } catch (err) {
    console.warn('[isConnected check error]', err);
  }
  return false;
}

/** Which arm of a branch this person takes. */
export async function chooseBranch(branch, enrollment) {
  const since = enrollment.lastActionAt || enrollment.enrolledAt || 0;
  if (branch.on === 'accepted') return (await isConnected(enrollment.publicId, enrollment, { forceFresh: true })) ? 0 : 1;
  if (branch.on === 'replied') {
    return (await inbox.repliedSince(enrollment.publicId, since)) ? 0 : 1;
  }
  if (branch.on === 'notAcceptedAfterMs') {
    const elapsed = Date.now() - since;
    if (elapsed < (branch.ms || 0)) return -1; // not yet decidable
    return (await isConnected(enrollment.publicId)) ? 1 : 0;
  }
  return 1;
}

/**
 * Cut a rendered invitation note down to what LinkedIn will accept.
 *
 * A note is a template plus somebody's name and job title, so the same step
 * that fits for "Ada Lovelace, Analyst" can overflow for someone with a longer
 * name at a longer company. Refusing the step would strand that one person
 * halfway through a sequence for a reason they cannot see, so the note is cut
 * instead — at a word boundary, because a sentence stopped mid-word reads as a
 * bug to the person receiving it — and the cut is announced as an event so the
 * template can be shortened rather than quietly clipped forever.
 *
 * @returns {{note: string, truncated: boolean, originalLength: number}}
 */
export function fitInviteNote(note, limit = INVITE_NOTE_MAX) {
  const text = note === undefined || note === null ? '' : String(note);
  if (text.length <= limit) return { note: text, truncated: false, originalLength: text.length };

  const cut = text.slice(0, limit);
  const lastSpace = cut.search(/\s\S*$/);
  // Only honour the word boundary if it leaves most of the allowance; a note
  // whose first "word" is longer than the limit is cut where the limit is.
  const trimmed = lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : cut;
  return {
    note: trimmed.replace(/[\s,;:–—-]+$/, '').trimEnd(),
    truncated: true,
    originalLength: text.length,
  };
}

export function hasLeadingGreeting(templateText = '') {
  if (!templateText || typeof templateText !== 'string') return false;
  return /^\s*(?:hi|hey|hello|dear)\b/i.test(templateText);
}

export function stripLeadingGreeting(text, templateText = '') {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
  if (hasLeadingGreeting(templateText)) {
    cleaned = cleaned.replace(/^(?:hi|hey|hello|dear)\b[^,.\n!?:;–—-]*[,\s!.:;–—-]+/i, '').trim();
    cleaned = cleaned.replace(/^[,\s!.:;–—-]+/, '').trim();
    if (cleaned) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }
  return cleaned;
}

export async function resolveAiOpener(profile, templateText = '') {
  try {
    const res = await handle(ACTIONS.AI_COMPLETE, { task: 'opener', input: { profile } }, 'campaign');
    if (res && res.ok && res.data && res.data.output) {
      const text = typeof res.data.output === 'string' ? res.data.output : String(res.data.output);
      const cleaned = stripLeadingGreeting(text, templateText);
      return fitInviteNote(cleaned, 180).note;
    }
  } catch {
    /* fallback to empty string on missing key, network error, etc. */
  }
  return '';
}

/* ================================================================== */
/*  A/B Testing Support                                               */
/* ================================================================== */

export function recordAbStat(campaign, stepKey, variantId, metric) {
  if (!campaign || !stepKey || !variantId || !metric) return;
  campaign.abStats = campaign.abStats || {};
  if (!campaign.abStats[stepKey]) {
    campaign.abStats[stepKey] = {
      A: { sent: 0, accepted: 0, replied: 0 },
      B: { sent: 0, accepted: 0, replied: 0 },
    };
  }
  const normId = (variantId || '').toUpperCase() === 'B' ? 'B' : 'A';
  if (!campaign.abStats[stepKey][normId]) {
    campaign.abStats[stepKey][normId] = { sent: 0, accepted: 0, replied: 0 };
  }
  campaign.abStats[stepKey][normId][metric] = (campaign.abStats[stepKey][normId][metric] || 0) + 1;
  campaign._abStatsChanged = true;
}

export function getOrAssignVariant(campaign, step, enrollment) {
  const stepKey = step.id || String(enrollment.stepIndex);
  enrollment.assignedVariants = enrollment.assignedVariants || {};
  let assigned = enrollment.assignedVariants[stepKey];
  if (!assigned) {
    campaign.abCounters = campaign.abCounters || {};
    const count = campaign.abCounters[stepKey] || 0;
    assigned = count % 2 === 0 ? 'A' : 'B';
    campaign.abCounters[stepKey] = count + 1;
    campaign._abStatsChanged = true;
    enrollment.assignedVariants[stepKey] = assigned;
  }
  const variants = Array.isArray(step.variants) ? step.variants : [];
  const variantObj = variants.find((v) => (v && (v.id || '').toUpperCase() === assigned.toUpperCase())) || variants[0] || null;
  return { variantId: assigned, variantObj, stepKey };
}

export function recordInviteAccepted(campaign, enrollment) {
  if (!campaign || !enrollment || enrollment.abInviteAttributed) return;
  let stepKey = enrollment.lastInviteStepKey;
  if (!stepKey && Array.isArray(campaign.steps)) {
    const inviteStep = campaign.steps.find((s) => s.type === 'invite');
    if (inviteStep) {
      stepKey = inviteStep.id || String(campaign.steps.indexOf(inviteStep));
    }
  }
  if (!stepKey) return;
  const assigned = enrollment.assignedVariants?.[stepKey];
  if (!assigned) return;

  recordAbStat(campaign, stepKey, assigned, 'accepted');
  enrollment.abInviteAttributed = true;
  campaign._abStatsChanged = true;
}

export function recordReplyAttribution(campaign, enrollment) {
  if (!campaign || !enrollment || enrollment.abReplyAttributed) return;
  let stepKey = enrollment.lastMessageStepKey;
  if (!stepKey && Array.isArray(campaign.steps)) {
    const lastMsgStep = [...campaign.steps].reverse().find((s) => ['message', 'inmail', 'email'].includes(s.type));
    if (lastMsgStep) {
      stepKey = lastMsgStep.id || String(campaign.steps.indexOf(lastMsgStep));
    }
  }
  if (!stepKey) return;
  const assigned = enrollment.assignedVariants?.[stepKey];
  if (!assigned) return;

  recordAbStat(campaign, stepKey, assigned, 'replied');
  enrollment.abReplyAttributed = true;
  campaign._abStatsChanged = true;
}

export async function declareWinner(campaignId, stepKey, winnerId) {
  if (!campaignId || !stepKey || !winnerId) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'campaignId, stepKey, and winnerId are required');
  }
  const campaigns = await readCampaigns();
  const campaign = campaigns.find((c) => c.campaignId === campaignId);
  if (!campaign) {
    throw new EngineError(ERROR.NOT_FOUND, `Campaign ${campaignId} not found`);
  }
  const steps = campaign.steps || [];
  const stepIndex = steps.findIndex((s, idx) => s.id === stepKey || String(idx) === String(stepKey));
  if (stepIndex === -1) {
    throw new EngineError(ERROR.NOT_FOUND, `Step ${stepKey} not found in campaign ${campaignId}`);
  }
  const step = steps[stepIndex];
  const variants = step.variants || [];
  const winningVariant = variants.find((v) => (v && (v.id || '').toUpperCase() === String(winnerId).toUpperCase())) || variants[0];

  if (winningVariant) {
    if (winningVariant.note !== undefined) step.note = winningVariant.note;
    if (winningVariant.body !== undefined) step.body = winningVariant.body;
    if (winningVariant.subject !== undefined) step.subject = winningVariant.subject;
  }
  step.abEnabled = false;
  step.winningVariant = String(winnerId).toUpperCase();
  campaign.updatedAt = Date.now();
  await writeCampaigns(campaigns);
  await emit(EVENTS.CAMPAIGN_LIVE_UPDATE, { campaignId });
  return withStats(campaign);
}

export async function stepParams(campaign, step, enrollment, routed = null) {
  const profile = (await getStoredProfile(enrollment.publicId)) || {
    publicId: enrollment.publicId,
  };

  let variant = undefined;
  let variantUsed = false;
  let assignedVariant = null;
  const stepKey = step.id || String(enrollment.stepIndex);
  let abNote, abBody, abSubject;

  if (step.abEnabled && Array.isArray(step.variants) && step.variants.length > 0) {
    const ab = getOrAssignVariant(campaign, step, enrollment);
    assignedVariant = ab.variantId;
    if (ab.variantObj) {
      abNote = ab.variantObj.note;
      abBody = ab.variantObj.body;
      abSubject = ab.variantObj.subject;
    }
    variantUsed = false;
  } else {
    // A step may carry `variants` with no `note`/`body` at all — the shipped
    // sequence templates do exactly that — so the variant is the text, and a
    // literal `note`/`body` is only the fallback. The cursor only moves once the
    // write has actually happened, so a refused step does not burn a variant.
    variant = pickVariant(step.variants, campaign.variantCursor || 0);
    variantUsed = !!(step.variants && step.variants.length);
  }

  const params = {
    publicId: enrollment.publicId,
    campaignId: campaign.campaignId,
    stepIndex: enrollment.stepIndex,
    ...(profile?.urn ? { profileUrn: profile.urn } : {}),
    ...(profile?.memberId ? { memberId: profile.memberId } : {}),
    ...(profile?.firstName ? { firstName: profile.firstName } : {}),
    ...(profile?.lastName ? { lastName: profile.lastName } : {}),
  };

  if (routed === 'routed_free_inmail') {
    const rawBody = (step.abEnabled && abBody !== undefined)
      ? abBody
      : (step.inmailBody || step.body || step.note || variant || '');
    let bodyText = rawBody;
    if (bodyText.includes('{{ai_opener') || step.useAi === true) {
      const opener = await resolveAiOpener(profile, bodyText);
      bodyText = bodyText.replace(
        /\{\{\s*ai_opener\s*(?:\|([^}]*))?\}\}/g,
        (_m, fallback) => opener || (fallback ? fallback.trim() : ''),
      );
      if (step.useAi && !bodyText.trim()) bodyText = opener;
    }
    params.body = renderTemplate(bodyText, profile);
    const rawSubject = (step.abEnabled && abSubject !== undefined)
      ? abSubject
      : (step.inmailSubject || step.subject || 'Introduction');
    params.subject = renderTemplate(rawSubject, profile);
    params.routing = 'routed_free_inmail';
    return { params, variantUsed, assignedVariant, stepKey };
  }

  if (step.type === 'invite') {
    let noteText = (step.abEnabled && abNote !== undefined) ? abNote : (variant || step.note || '');
    if (await isNoteLimitActive()) {
      params.note = '';
    } else {
      if (noteText.includes('{{ai_opener') || step.useAi === true) {
        const opener = await resolveAiOpener(profile, noteText);
        noteText = noteText.replace(
          /\{\{\s*ai_opener\s*(?:\|([^}]*))?\}\}/g,
          (_m, fallback) => opener || (fallback ? fallback.trim() : ''),
        );
        if (step.useAi && !noteText.trim()) noteText = opener;
      }
      const fitted = fitInviteNote(renderTemplate(noteText, profile));
      params.note = fitted.note;
      if (fitted.truncated) {
        await emit(EVENTS.CAMPAIGN_NOTE_TRUNCATED, {
          campaignId: campaign.campaignId,
          publicId: enrollment.publicId,
          stepIndex: enrollment.stepIndex,
          originalLength: fitted.originalLength,
          limit: INVITE_NOTE_MAX,
          note: fitted.note,
        });
      }
    }
  }
  if (step.type === 'message') {
    let msgBody = (step.abEnabled && abBody !== undefined) ? abBody : (variant || step.body || '');
    if (msgBody.includes('{{ai_opener') || step.useAi === true) {
      const opener = await resolveAiOpener(profile, msgBody);
      msgBody = msgBody.replace(
        /\{\{\s*ai_opener\s*(?:\|([^}]*))?\}\}/g,
        (_m, fallback) => opener || (fallback ? fallback.trim() : ''),
      );
      if (step.useAi && !msgBody.trim()) msgBody = opener;
    }
    params.body = renderTemplate(msgBody, profile);
  }
  if (step.type === 'inmail') {
    const rawBody = (step.abEnabled && abBody !== undefined) ? abBody : (variant || step.body || '');
    const rawSubject = (step.abEnabled && abSubject !== undefined) ? abSubject : (step.subject || 'Introduction');
    params.body = renderTemplate(rawBody, profile);
    params.subject = renderTemplate(rawSubject, profile);
  }
  if (step.type === 'email') {
    let rawBody = (step.abEnabled && abBody !== undefined) ? abBody : (variant || step.body || '');
    if (rawBody.includes('{{ai_opener') || step.useAi === true) {
      const opener = await resolveAiOpener(profile, rawBody);
      rawBody = rawBody.replace(
        /\{\{\s*ai_opener\s*(?:\|([^}]*))?\}\}/g,
        (_m, fallback) => opener || (fallback ? fallback.trim() : ''),
      );
      if (step.useAi && !rawBody.trim()) rawBody = opener;
    }
    params.body = renderTemplate(rawBody, profile);
    const rawSubject = (step.abEnabled && abSubject !== undefined)
      ? abSubject
      : (step.subject || enrollment.gmailSubject || 'Reaching out');
    params.subject = renderTemplate(rawSubject, profile);
    params.email =
      step.email ||
      profile.email ||
      (profile.enrichment && profile.enrichment.email) ||
      profile.enrichmentEmail ||
      '';

    // Gmail Threading chaining
    if (step.replyInThread !== false && enrollment.gmailThreadId) {
      params.threadId = enrollment.gmailThreadId;
      if (enrollment.gmailLastMessageId) {
        params.inReplyTo = enrollment.gmailLastMessageId;
        params.references = enrollment.gmailLastMessageId;
      }
    }
  }
  if (step.type === 'like' || step.type === 'comment') {
    params.postUrl = step.postUrl || '';
    if ((step.type === 'like' || step.type === 'comment') && !params.postUrl) {
      try {
        let profileUrn = params.profileUrn;
        if (!profileUrn) {
          const stored = await getStoredProfile(enrollment.publicId);
          profileUrn = stored?.urn || stored?.profileUrn;
        }
        if (!profileUrn && voyager.resolveProfileUrn) {
          profileUrn = await voyager.resolveProfileUrn(enrollment.publicId).catch(() => null);
        }
        if (voyager.getMemberPosts) {
          const posts = await voyager.getMemberPosts({
            profileUrn,
            publicId: enrollment.publicId,
            count: 1,
          }).catch(() => []);
          const firstPost = Array.isArray(posts) ? posts[0] : null;
          const postUrl =
            firstPost?.url ||
            firstPost?.postUrl ||
            (firstPost?.urn ? `https://www.linkedin.com/feed/update/${firstPost.urn}/` : '');
          if (postUrl) {
            params.postUrl = postUrl;
          }
        }
      } catch (err) {
        logDebug('warn', 'Runner', `[${step.type} Step] Failed to fetch latest post for ${enrollment.publicId}: ${err.message}`);
      }
    }
    if (step.type === 'comment') params.body = renderTemplate(variant || step.body, profile);
  }
  return { params, variantUsed, assignedVariant, stepKey };
}

/* ================================================================== */
/*  Tick                                                              */
/* ================================================================== */

/**
 * Un-parks mistakenly postponed non-invite steps (e.g. view, visit, follow, like, message, email)
 * if nextAt is far in the future (> Date.now() + 2 * 3600 * 1000) while their own bucket is healthy.
 * Resets enrollment.nextAt = Date.now() so those steps execute immediately.
 * @returns {Promise<number>} number of enrollments un-parked
 */
export async function unparkNonInviteEnrollments(now = Date.now()) {
  try {
    const campaigns = await readCampaigns();
    const bucketCooldowns = await getBucketCooldowns();
    let unparkedCount = 0;

    for (const campaign of campaigns) {
      if (campaign.status !== 'active') continue;
      const enrollments = await readEnrollments(campaign.campaignId);
      let dirty = false;

      for (const enrollment of enrollments) {
        if (enrollment.status !== 'active') continue;
        if (
          enrollment.parkReason === 'waiting_acceptance' ||
          enrollment.parkReason?.includes?.('waiting_acceptance') ||
          enrollment.lastError === 'Waiting for invite acceptance' ||
          enrollment.lastError?.includes?.('Waiting for invite acceptance')
        ) {
          continue;
        }
        const steps = stepsAt(campaign, enrollment.path);
        const step = steps[enrollment.stepIndex];
        if (
          step &&
          step.type !== 'invite' &&
          step.type !== 'wait' &&
          ['view', 'visit', 'follow', 'like', 'comment', 'endorse', 'message', 'inmail', 'email'].includes(step.type) &&
          (enrollment.nextAt || 0) > now + 2 * 3600 * 1000
        ) {
          const stepBucket = normalizeBucket(step.type);
          const isResting = (bucketCooldowns[stepBucket] || 0) > now;
          if (!isResting) {
            enrollment.nextAt = now;
            if (enrollment.lastError?.includes('Daily quota reached') || enrollment.lastError?.includes('Postponed')) {
              enrollment.lastError = null;
            }
            dirty = true;
            unparkedCount += 1;
            logDebug('good', 'Runner', `[Un-park] Reset mistakenly postponed ${step.type} step for ${enrollment.publicId} to execute immediately.`);
          }
        }
      }

      if (dirty) {
        await writeEnrollments(campaign.campaignId, enrollments);
        emit(EVENTS.CAMPAIGN_LIVE_UPDATE, { campaignId: campaign.campaignId }).catch(() => {});
      }
    }
    return unparkedCount;
  } catch (err) {
    logDebug('warn', 'Runner', `[Un-park] Error during un-parking check: ${err.message}`);
    return 0;
  }
}

/**
 * Safe 5-minute constant-call acceptance watcher.
 * Checks all pending leads waiting for acceptance across all active campaigns
 * using a single getConnections({ count: 40 }) API call per cycle.
 *
 * @param {object} [options]
 * @param {boolean} [options.triggerTick=true] whether to trigger tick() if any enrollment is woken
 * @param {number} [options.now=Date.now()]
 * @returns {Promise<number>} number of enrollments woken up
 */
export async function checkNewAcceptancesAndWakeUp({ triggerTick = true, now = Date.now() } = {}) {
  try {
    // 1. Skip immediately if 0 enrollments across active/running campaigns are waiting on acceptance
    const campaigns = await readCampaigns();
    const activeCampaigns = campaigns.filter((c) => c.status === 'active');
    if (!activeCampaigns.length) return 0;

    const waitingByCampaign = new Map();
    let totalWaiting = 0;

    for (const campaign of activeCampaigns) {
      const enrollments = await readEnrollments(campaign.campaignId);
      const waiting = enrollments.filter(
        (e) =>
          e.status === 'active' &&
          (e.parkReason === 'waiting_acceptance' || e.lastError === 'Waiting for invite acceptance'),
      );
      if (waiting.length > 0) {
        waitingByCampaign.set(campaign.campaignId, { enrollments, waiting });
        totalWaiting += waiting.length;
      }
    }

    if (totalWaiting === 0) return 0;

    // 2. Skip immediately if outside active working hours
    const config = await getConfig();
    if (config.businessHoursOnly && !isWithinBusinessHours(config)) {
      return 0;
    }

    // 3. Skip immediately if daily message quota is full or cooling down
    try {
      await checkQuota('message');
    } catch (err) {
      logDebug('info', 'Runner', `[AcceptWatcher] Message quota unavailable or cooling down (${err?.message}). Skipping check.`);
      return 0;
    }

    // 4. Make ONLY 1 single API call (getConnections({ count: 40 }))
    let recentConnections = [];
    try {
      const res = await voyager.getConnections({ count: 40 });
      recentConnections = res?.profiles || [];
    } catch (err) {
      logDebug('warn', 'Runner', `[AcceptWatcher] getConnections failed: ${err?.message}`);
      return 0;
    }

    if (!recentConnections.length) return 0;

    // 5. Match newest connections locally in memory
    const recentPublicIds = new Set();
    const recentMemberIds = new Set();
    const recentUrns = new Set();

    for (const conn of recentConnections) {
      if (conn.publicId) recentPublicIds.add(String(conn.publicId).trim().toLowerCase());
      if (conn.memberId) recentMemberIds.add(String(conn.memberId).trim());
      if (conn.urn) recentUrns.add(String(conn.urn).trim().toLowerCase());
      if (conn.objectUrn) {
        recentUrns.add(String(conn.objectUrn).trim().toLowerCase());
        const stripped = String(conn.objectUrn).replace(/^urn:li:member:/, '').trim();
        if (stripped) recentMemberIds.add(stripped);
      }
    }

    let wokenCount = 0;

    for (const [campaignId, { enrollments, waiting }] of waitingByCampaign.entries()) {
      let dirty = false;

      for (const enrollment of waiting) {
        const normId = String(enrollment.publicId || '').trim().toLowerCase();
        let isAccepted = recentPublicIds.has(normId);

        if (!isAccepted) {
          const stored = await getStoredProfile(enrollment.publicId).catch(() => null);
          const storedMemberId = stored?.memberId || enrollment.memberId;
          const storedUrn = stored?.urn || stored?.objectUrn || enrollment.profileUrn;

          if (storedMemberId && recentMemberIds.has(String(storedMemberId).trim())) {
            isAccepted = true;
          } else if (storedUrn && recentUrns.has(String(storedUrn).trim().toLowerCase())) {
            isAccepted = true;
          }
        }

        if (isAccepted) {
          enrollment.accepted = true;
          const camp = campaigns.find((c) => c.campaignId === campaignId);
          if (camp) {
            recordInviteAccepted(camp, enrollment);
          }
          delete enrollment.parkReason;
          enrollment.lastError = null;
          enrollment.nextAt = now;
          enrollment.updatedAt = now;
          recordHistory(enrollment, {
            step: 'connection',
            label: 'Connection accepted by prospect',
            status: 'accepted',
          });

          try {
            const profile = await getStoredProfile(enrollment.publicId);
            if (profile) {
              profile.connectionDegree = 1;
              profile.isConnected = true;
              await putProfile(profile).catch(() => {});
            }
          } catch (_) {}

          dirty = true;
          wokenCount += 1;
          logDebug(
            'good',
            'Runner',
            `[AcceptWatcher] Detected new connection ${enrollment.publicId} — waking message step.`,
          );
        }
      }

      if (dirty) {
        await writeEnrollments(campaignId, enrollments);
        emit(EVENTS.CAMPAIGN_LIVE_UPDATE, { campaignId }).catch(() => {});
        if (campaigns.some((c) => c._abStatsChanged)) {
          await writeCampaigns(campaigns);
        }
      }
    }

    // 6. If 1 or more enrollments were woken up, immediately trigger tick()
    if (triggerTick && wokenCount > 0) {
      tick().catch((err) => {
        logDebug('warn', 'Runner', `[AcceptWatcher] tick() after wake failed: ${err?.message}`);
      });
    }

    return wokenCount;
  } catch (err) {
    logDebug('warn', 'Runner', `[AcceptWatcher] Error: ${err?.message}`);
    return 0;
  }
}

/**
 * Wakes up enrollments that were parked waiting for invite acceptance as soon as
 * their connection has been accepted on LinkedIn.
 * Reuses the constant-call acceptance watcher logic without triggering a duplicate tick.
 * @returns {Promise<number>} number of enrollments woken up
 */
export async function wakeAcceptedEnrollments(now = Date.now()) {
  return checkNewAcceptancesAndWakeUp({ triggerTick: false, now });
}

/**
 * Move every due enrollment forward.
 * @returns {Promise<{executed: number, queued: number}>}
 */
export async function tick() {
  if (isTickRunning) {
    console.log('[Runner] Tick already in progress; skipping overlap.');
    return { executed: 0, queued: 0 };
  }
  isTickRunning = true;
  try {
    const acquired = await acquireTickLock();
    if (!acquired) {
      console.log('[Runner] Previous tick still executing (storage lock active). Skipping duplicate tick.');
      return { executed: 0, queued: 0 };
    }

    let hasMoreDueEnrollments = false;
    try {
      logDebug('info', 'Runner', 'Sequence tick started. Checking active campaigns...');

  // Look at the inbox first, so stopOnReply and the 'replied' branch see the
  // replies that arrived since the last tick rather than the ones before it.
  // A failing inbox (no session, a backoff) must never stop the tick.
  try {
    await inbox.detectReplies();
  } catch {
    /* nothing to do but carry on */
  }

  const campaigns = await readCampaigns();
  const config = await getConfig();
  const now = Date.now();
  let executed = 0;
  let attemptedWrites = 0;
  let queued = 0;

  // Outside the working window nothing may be written, so do not walk the
  // enrollments at all — a nightly tick over 500 people would otherwise make
  // 500 pointless reads. Individual writes are still gated by quota.check.
  let halted = config.businessHoursOnly && !isWithinBusinessHours(config);
  const haltedBuckets = new Set();

  // Un-park mistakenly postponed non-invite steps on every tick run
  await unparkNonInviteEnrollments(now);

  // Instant wake-up for enrollments whose connection invite was accepted on LinkedIn
  await wakeAcceptedEnrollments(now);

  const bucketCooldowns = await getBucketCooldowns();

  // Populate haltedBuckets from persistent cooldowns
  for (const [bucket, until] of Object.entries(bucketCooldowns)) {
    if (until > now) {
      haltedBuckets.add(bucket);
      if (bucket === 'view') haltedBuckets.add('visit');
      if (bucket === 'visit') haltedBuckets.add('view');
    }
  }

  let totalDueEnrollments = 0;
  let restingBucketSkippedCount = 0;

  for (const campaign of campaigns) {
    if (halted || executed >= maxActionsPerTick || attemptedWrites >= maxActionsPerTick) break;
    if (campaign.status !== 'active') continue;

    const enrollments = await readEnrollments(campaign.campaignId);
    const cursorBefore = campaign.variantCursor || 0;
    let dirty = false;

    enrollmentLoop: for (const enrollment of enrollments) {
      if (halted || executed >= maxActionsPerTick || attemptedWrites >= maxActionsPerTick) break;

      // Check live storage status before processing prospect
      const liveCampaigns = await readCampaigns();
      const currentCamp = liveCampaigns.find((c) => c.campaignId === campaign.campaignId);
      if (!currentCamp || currentCamp.status !== 'active') {
        logDebug('warn', 'Runner', `Campaign ${campaign.campaignId} is paused/stopped. Aborting sequence loop.`);
        break;
      }

      if (enrollment.status !== 'active') continue;

      const pendingSteps = stepsAt(campaign, enrollment.path);
      const nextPendingStep = pendingSteps[enrollment.stepIndex];

      // Un-park mistakenly postponed non-invite steps (e.g. view, visit, follow, like, message, email):
      // If an active enrollment's current step is a healthy non-invite step mistakenly parked > 2h in the future,
      // reset nextAt = now so it executes immediately in this tick.
      // NEVER reset enrollments with parkReason === 'waiting_acceptance' or 'Waiting for invite acceptance'.
      if (
        enrollment.parkReason !== 'waiting_acceptance' &&
        !enrollment.parkReason?.includes?.('waiting_acceptance') &&
        enrollment.lastError !== 'Waiting for invite acceptance' &&
        !enrollment.lastError?.includes?.('Waiting for invite acceptance')
      ) {
        if (
          nextPendingStep &&
          nextPendingStep.type !== 'invite' &&
          nextPendingStep.type !== 'wait' &&
          ['view', 'visit', 'follow', 'like', 'comment', 'endorse', 'message', 'inmail', 'email'].includes(nextPendingStep.type) &&
          (enrollment.nextAt || 0) > now + 2 * 3600 * 1000
        ) {
          const stepBucket = normalizeBucket(nextPendingStep.type);
          const isResting = (bucketCooldowns[stepBucket] || 0) > now || haltedBuckets.has(stepBucket);
          if (!isResting) {
            logDebug('good', 'Runner', `[Un-park] Resetting mistakenly postponed ${nextPendingStep.type} step for ${enrollment.publicId} to execute immediately.`);
            enrollment.nextAt = now;
            if (enrollment.lastError?.includes('Daily quota reached') || enrollment.lastError?.includes('Postponed')) {
              enrollment.lastError = null;
            }
            dirty = true;
          }
        }
      }

      if ((enrollment.nextAt || 0) > now) continue;

      // Prevent concurrent execution of the same prospect
      if (activeProspectLocks.has(enrollment.publicId)) continue;

      totalDueEnrollments += 1;

      // Strict per-bucket isolation: If next step belongs to a resting bucket (e.g. invite reached quota/rate limit),
      // ONLY postpone invite enrollments to nextAllowedAt / tomorrow's window, and continue to next enrollment.
      // NEVER set tomorrow's nextAt on view, follow, like, message, or email steps.
      if (nextPendingStep && !['wait', 'branch'].includes(nextPendingStep.type)) {
        const normBucket = normalizeBucket(nextPendingStep.type);
        const cooldownUntil = bucketCooldowns[normBucket] || 0;
        if (cooldownUntil > now || haltedBuckets.has(normBucket)) {
          restingBucketSkippedCount += 1;
          if (normBucket === 'invite') {
            const nextAllowedAt = cooldownUntil > now ? cooldownUntil : getNextActiveWindowStart(config);
            if ((enrollment.nextAt || 0) < nextAllowedAt) {
              enrollment.nextAt = nextAllowedAt;
              dirty = true;
            }
          }
          continue enrollmentLoop;
        }
      }

      logDebug('info', 'Runner', `Processing prospect ${enrollment.publicId} (Step ${enrollment.stepIndex + 1})`);

      // A step that is sitting in the approval queue has not happened yet.
      // Advancing past it would run the next step out of order, and re-running
      // it would queue a duplicate — so wait for the human either way.
      if (enrollment.pendingQueueId) {
        const item = await queue.byId(enrollment.pendingQueueId);
        if (!item || item.status === 'pending' || item.status === 'approved') continue;

        delete enrollment.pendingQueueId;
        enrollment.updatedAt = Date.now();
        dirty = true;

        if (item.status === 'rejected') {
          enrollment.status = 'stopped';
          enrollment.error = 'The queued step was rejected.';
          recordHistory(enrollment, {
            step: 'queue',
            label: 'Queued step was rejected',
            status: 'rejected',
            error: enrollment.error,
          });
          continue;
        }
        if (item.status === 'failed') {
          enrollment.status = 'stopped';
          enrollment.error =
            (item.result && item.result.error && item.result.error.message) || 'The queued step failed.';
          recordHistory(enrollment, {
            step: 'queue',
            label: 'Queued step failed',
            status: 'failed',
            error: enrollment.error,
          });
          continue;
        }

        // Sent: carry on from the step after the one that was queued.
        enrollment.lastActionAt = Date.now();
        recordHistory(enrollment, {
          step: 'queue',
          label: 'Queued step approved & executed',
          status: 'completed',
        });
        advance(campaign, enrollment);
        if (isFinished(campaign, enrollment)) {
          await finish(campaign, enrollment);
          continue;
        }
      }

      if (campaign.settings.stopOnReply) {
        const watermark = enrollment.lastActionAt || enrollment.enrolledAt || 0;
        if (await inbox.repliedSince(enrollment.publicId, watermark)) {
          enrollment.status = 'replied';
          enrollment.updatedAt = now;
          recordReplyAttribution(campaign, enrollment);
          recordHistory(enrollment, {
            step: 'replied',
            label: 'Prospect replied to outreach',
            status: 'replied',
          });
          dirty = true;
          continue;
        }
      }

      // Do Not Contact Blacklist Guardrail
      if (await isBlacklisted(enrollment.publicId)) {
        enrollment.status = 'blacklisted';
        enrollment.error = 'Contact is on the Do Not Contact blacklist.';
        enrollment.updatedAt = now;
        recordHistory(enrollment, {
          step: 'blacklisted',
          label: 'Contact is on blacklist',
          status: 'blacklisted',
          error: enrollment.error,
        });
        dirty = true;
        continue;
      }

      const profileForGuard = await getStoredProfile(enrollment.publicId);
      if (profileForGuard && (await isCompanyBlacklisted(profileForGuard))) {
        enrollment.status = 'blacklisted';
        enrollment.error = `Company "${profileForGuard.company || profileForGuard.companyName || 'Blocked'}" is on the Company Exclusion list.`;
        enrollment.updatedAt = now;
        recordHistory(enrollment, {
          step: 'blacklisted',
          label: 'Company is on exclusion list',
          status: 'blacklisted',
          error: enrollment.error,
        });
        dirty = true;
        continue;
      }

      // One enrollment may resolve several zero-cost steps (branch, wait) in a
      // single tick, but performs at most one write.
      let wrote = false;
      let guard = 0;

      while (!wrote && guard < 20) {
        guard += 1;

        if (isFinished(campaign, enrollment)) {
          await finish(campaign, enrollment);
          dirty = true;
          break;
        }

        const steps = stepsAt(campaign, enrollment.path);
        const step = steps[enrollment.stepIndex];
        if (!step) {
          advance(campaign, enrollment);
          dirty = true;
          continue;
        }

        // Strict per-bucket isolation: If this action bucket is halted for this tick (e.g. invite reached quota/rate limit),
        // ONLY postpone invite enrollments to nextAllowedAt / tomorrow's window, and continue to next enrollment.
        // NEVER set tomorrow's nextAt on view, follow, like, message, or email steps.
        const normBucket = normalizeBucket(step.type);
        if (haltedBuckets.has(normBucket) || haltedBuckets.has(step.type)) {
          restingBucketSkippedCount += 1;
          if (normBucket === 'invite') {
            const nextAllowedAt = (bucketCooldowns['invite'] > now) ? bucketCooldowns['invite'] : getNextActiveWindowStart(config);
            if ((enrollment.nextAt || 0) < nextAllowedAt) {
              enrollment.nextAt = nextAllowedAt;
              dirty = true;
            }
          }
          continue enrollmentLoop;
        }

        if (step.type === 'wait') {
          if (!step.waitMs || step.waitMs <= 0) {
            advance(campaign, enrollment);
            enrollment.updatedAt = Date.now();
            dirty = true;
            continue;
          }
          logDebug('warn', 'Pacing', 'Waiting human delay...');
          enrollment.nextAt = Date.now() + step.waitMs;
          advance(campaign, enrollment);
          enrollment.updatedAt = Date.now();
          dirty = true;
          queued += 1;
          break;
        }

        if (step.type === 'branch') {
          const arm = await chooseBranch(step.branch || {}, enrollment);
          if (arm === -1) {
            enrollment.nextAt = Date.now() + 3600000; // look again in an hour
            enrollment.updatedAt = Date.now();
            dirty = true;
            queued += 1;
            break;
          }
          if (arm === 0 && step.branch.on === 'accepted') {
            enrollment.accepted = true;
            recordInviteAccepted(campaign, enrollment);
          }
          if (arm === 0 && step.branch.on === 'replied') {
            recordReplyAttribution(campaign, enrollment);
          }
          enrollment.path = [...enrollment.path, enrollment.stepIndex, arm];
          enrollment.stepIndex = 0;
          enrollment.updatedAt = Date.now();
          dirty = true;
          continue;
        }

        let action = STEP_ACTION[step.type];
        if (!action) {
          advance(campaign, enrollment);
          dirty = true;
          continue;
        }

        // Inviting someone we are already connected to is an error at
        // LinkedIn's end and a wasted invite at ours. Treat it as accepted.
        if (step.type === 'invite' && (await isConnected(enrollment.publicId))) {
          logDebug('info', 'Runner', `[Runner] Prospect ${enrollment.publicId} is already connected. Auto-advancing to message step.`);
          enrollment.accepted = true;
          recordInviteAccepted(campaign, enrollment);
          delete enrollment.parkReason;
          if (enrollment.lastError === 'Waiting for invite acceptance') {
            enrollment.lastError = null;
          }
          const skippedIndex = enrollment.stepIndex;
          recordHistory(enrollment, {
            step: 'invite',
            label: 'Already connected (Invite auto-accepted)',
            status: 'skipped',
            reason: 'alreadyConnected',
          });
          advance(campaign, enrollment);
          enrollment.updatedAt = Date.now();
          dirty = true;
          await emit(EVENTS.CAMPAIGN_STEP_DONE, {
            campaignId: campaign.campaignId,
            publicId: enrollment.publicId,
            stepIndex: skippedIndex,
            type: step.type,
            status: 'skipped',
            reason: 'alreadyConnected',
          });
          if (isFinished(campaign, enrollment)) await finish(campaign, enrollment);
          continue;
        }

        // Non-Connection Message Guardrail:
        // Before executing an automated message step in a multi-step sequence containing an invite,
        // verify prospect is an active 1st-degree connection.
        // If not connected yet, park enrollment for 12h without calling createMessage or incrementing retries.
        if (step.type === 'message') {
          const hasInviteStep =
            campaign.steps?.some((s) => s.type === 'invite') ||
            Boolean(enrollment.history?.some((h) => h.step === 'invite'));

          if (hasInviteStep && config.autopilot !== false) {
            const connected = await isConnected(enrollment.publicId, enrollment);
            if (!connected) {
              const wait12h = 12 * 60 * 60 * 1000;
              enrollment.nextAt = Date.now() + wait12h;
              enrollment.parkReason = 'waiting_acceptance';
              enrollment.lastError = 'Waiting for invite acceptance';
              enrollment.updatedAt = Date.now();
              recordHistory(enrollment, {
                step: 'message',
                label: 'Waiting for invite acceptance (re-check in 12h)',
                status: 'waiting',
                note: 'Prospect is not connected yet',
              });
              dirty = true;
              queued += 1;
              await writeEnrollments(campaign.campaignId, enrollments);
              logDebug(
                'info',
                'Runner',
                `[Runner] Prospect ${enrollment.publicId} has not accepted connection yet. Parking message step for 12h (Waiting for invite acceptance).`,
              );
              break;
            }
            enrollment.accepted = true;
            recordInviteAccepted(campaign, enrollment);
            delete enrollment.parkReason;
            if (enrollment.lastError === 'Waiting for invite acceptance') {
              enrollment.lastError = null;
            }
          }
        }

        // Email Step Verification & Auto-Enrichment Guardrail:
        if (step.type === 'email') {
          let leadProfile = await getStoredProfile(enrollment.publicId);
          let leadEmail =
            step.email ||
            (leadProfile && leadProfile.email) ||
            (leadProfile && leadProfile.enrichment && leadProfile.enrichment.email) ||
            (leadProfile && leadProfile.enrichmentEmail);

          if (!leadEmail && campaign.autoEnrichMissingEmail !== false) {
            logDebug('info', 'Runner', `[Auto-Enrich] No email found for ${enrollment.publicId}. Attempting waterfall enrichment via Vault...`);
            try {
              const enrichRes = await enrichLead(enrollment.publicId, {
                fullName: leadProfile?.fullName || leadProfile?.name || enrollment.publicId,
                company: leadProfile?.company || '',
              });
              if (enrichRes?.enriched?.email || enrichRes?.profile?.email) {
                leadEmail = enrichRes.enriched?.email || enrichRes.profile?.email;
                leadProfile = enrichRes.profile || (await getStoredProfile(enrollment.publicId));
                logDebug('good', 'Runner', `[Auto-Enrich] Successfully enriched email for ${enrollment.publicId}: ${leadEmail}`);
              }
            } catch (enrichErr) {
              logDebug('warn', 'Runner', `[Auto-Enrich] Enrichment failed for ${enrollment.publicId}: ${enrichErr?.message || enrichErr}`);
            }
          }

          if (!leadEmail) {
            logDebug('warn', 'Runner', `[Runner] Skipped email step for ${enrollment.publicId}: No email found (NO_EMAIL).`);
            enrollment.status = 'email_skipped_no_email';
            enrollment.updatedAt = Date.now();
            recordHistory(enrollment, {
              step: 'email',
              label: 'Skipped: No email address found',
              status: 'skipped',
              reason: 'NO_EMAIL',
            });
            dirty = true;
            await emit(EVENTS.CAMPAIGN_STEP_DONE, {
              campaignId: campaign.campaignId,
              publicId: enrollment.publicId,
              stepIndex: enrollment.stepIndex,
              type: 'email',
              status: 'skipped',
              reason: 'NO_EMAIL',
            });
            advance(campaign, enrollment);
            if (isFinished(campaign, enrollment)) await finish(campaign, enrollment);
            continue;
          }
        }

        // Smart "Open Profile" Free InMail Routing:
        // If stored profile has openLink === true and step has an inmail body or fallback message,
        // route to InMail instead of Invite to conserve the user's connection quota.
        const storedProfile = await getStoredProfile(enrollment.publicId);
        const isOpenProfile = Boolean(
          storedProfile &&
            (storedProfile.openLink === true ||
              storedProfile.isOpenProfile === true ||
              (storedProfile.memberBadges && storedProfile.memberBadges.openLink === true)),
        );
        const inmailBodyText =
          step.inmailBody || step.body || step.note || (step.variants && step.variants.length > 0);
        const shouldRouteInMail =
          step.type === 'invite' &&
          step.autoOpenInMail !== false &&
          isOpenProfile &&
          Boolean(inmailBodyText);

        let routed = null;
        if (shouldRouteInMail) {
          action = ACTIONS.OUTREACH_INMAIL;
          routed = 'routed_free_inmail';
        }

        // Enforce PROSPECT_COOLDOWN_MS per prospect before executing an action step
        if (Date.now() - (lastProspectActionAt.get(enrollment.publicId) || 0) < PROSPECT_COOLDOWN_MS) {
          continue enrollmentLoop;
        }

        const { params, variantUsed, assignedVariant, stepKey } = await stepParams(campaign, step, enrollment, routed);

        activeProspectLocks.add(enrollment.publicId);
        lastProspectActionAt.set(enrollment.publicId, Date.now());
        enrollment.updatedAt = Date.now();
        await writeEnrollments(campaign.campaignId, enrollments);

        let res;
        try {
          res = await handle(action, params, 'campaign');
        } finally {
          activeProspectLocks.delete(enrollment.publicId);
          lastProspectActionAt.set(enrollment.publicId, Date.now());
        }
        wrote = true;
        if (res.ok && res.data?.status !== 'queued' && res.data?.status !== 'skipped') {
          attemptedWrites += 1;
        }

        if (!res.ok) {
          const errorCode = res.error?.code;
          const errorMsg = res.error?.message || '';
          logDebug('warn', 'Runner', `[${step.type} Raw Error] publicId=${enrollment.publicId} code=${errorCode} msg=${errorMsg}`);

          // Extra safety guard: If message step failed at LinkedIn because prospect is not a connection
          if (step.type === 'message' && /not a connection|cannot be messaged because/i.test(errorMsg)) {
            const wait12h = 12 * 60 * 60 * 1000;
            enrollment.nextAt = Date.now() + wait12h;
            enrollment.parkReason = 'waiting_acceptance';
            enrollment.lastError = 'Waiting for invite acceptance';
            enrollment.updatedAt = Date.now();
            recordHistory(enrollment, {
              step: 'message',
              label: 'Waiting for invite acceptance (re-check in 12h)',
              status: 'waiting',
              note: errorMsg,
            });
            dirty = true;
            queued += 1;
            await writeEnrollments(campaign.campaignId, enrollments);
            logDebug(
              'info',
              'Runner',
              `[Runner] Prospect ${enrollment.publicId} is not connected. Parking message step for 12h (Waiting for invite acceptance).`,
            );
            continue enrollmentLoop;
          }

          const isPermanent =
            errorCode === ERROR.NOT_FOUND ||
            errorCode === ERROR.INVALID_PARAMS ||
            /not found|invalid|blacklisted|already (been )?(sent|invited)|pending invitation|duplicate|CANT_RESEND_YET|withdr(ew|awn)|recently withdrew|email (required|address)|cannot connect/i.test(errorMsg);

          const isNoteLimitOnly =
            errorCode === 'CUSTOM_INVITE_LIMIT_REACHED' ||
            res.error?.isCustomInviteLimit ||
            /CUSTOM_INVITE_LIMIT_REACHED|personalized.*invitation|custom.*message.*limit|note limit/i.test(errorMsg);
          const isRateLimit =
            !isPermanent &&
            !isNoteLimitOnly &&
            (errorCode === ERROR.RATE_LIMITED ||
             errorCode === ERROR.CHALLENGE_DETECTED ||
             /429|999|403|rate limit|safety cooldown|cooldown/i.test(errorMsg));
          const isQuota =
            !isPermanent &&
            !isNoteLimitOnly &&
            (errorCode === ERROR.QUOTA_EXCEEDED ||
             /quota|limit reached|daily limit/i.test(errorMsg));

          const bucket = normalizeBucket(step.type);
          const bucketTitle = bucket.charAt(0).toUpperCase() + bucket.slice(1);

          // 1. Quota Exceeded on any step: cooldown until next day's active window start
          if (isQuota) {
            const isHourly = /hourly/i.test(errorMsg);
            const failedBucketMatch = errorMsg.match(/(?:for|reached for)\s+(invite|message|visit|view|email|search)/i);
            const failedBucket = failedBucketMatch ? normalizeBucket(failedBucketMatch[1]) : bucket;

            // If message step failed due to a secondary bucket (like visit), NEVER exhaust message daily quota
            if (bucket === 'message' && failedBucket !== 'message') {
              logDebug('warn', 'Runner', `[Runner] Message step hit secondary ${failedBucket} limit (${errorMsg}). Skipping message daily exhaustion.`);
              const retryAfter = res.error?.extra?.retryAfter || 15 * 60 * 1000;
              enrollment.nextAt = Date.now() + retryAfter;
              enrollment.lastError = `Temporary ${failedBucket} cooldown. Resuming in ~${Math.ceil(retryAfter / 60000)}m`;
              dirty = true;
              continue enrollmentLoop;
            }

            // If hourly cap was reached, only pause until the hour resets, NOT until tomorrow
            if (isHourly) {
              const retryAfter = res.error?.extra?.retryAfter || 60 * 60 * 1000;
              const cooldownUntil = Date.now() + retryAfter;
              await setBucketCooldown(bucket, cooldownUntil);
              haltedBuckets.add(bucket);
              bucketCooldowns[bucket] = cooldownUntil;

              const mins = Math.max(1, Math.round(retryAfter / 60000));
              enrollment.nextAt = cooldownUntil;
              enrollment.lastError = `Hourly cap reached for ${bucket}. Resuming in ~${mins}m`;
              enrollment.updatedAt = Date.now();
              recordHistory(enrollment, {
                step: step.type,
                label: `Postponed: Hourly ${bucket} quota reached`,
                status: 'quota_postponed',
                error: enrollment.lastError,
              });
              dirty = true;
              logDebug('info', 'Runner', `${bucketTitle} hourly quota reached. Resting for ~${mins}m.`);
              continue enrollmentLoop;
            }

            const nextActiveStart = getNextActiveWindowStart(config);
            await setBucketCooldown(bucket, nextActiveStart);
            haltedBuckets.add(bucket);
            if (bucket === 'view') haltedBuckets.add('visit');
            if (bucket === 'visit') haltedBuckets.add('view');
            bucketCooldowns[bucket] = nextActiveStart;

            enrollment.nextAt = nextActiveStart;
            enrollment.lastError = `Daily quota reached. Postponed until tomorrow's active window (${new Date(nextActiveStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
            enrollment.updatedAt = Date.now();
            recordHistory(enrollment, {
              step: step.type,
              label: `Postponed: Daily ${bucket} quota reached`,
              status: 'quota_postponed',
              error: enrollment.lastError,
            });
            dirty = true;

            logDebug('info', 'Runner', `${bucketTitle} daily quota reached. Resting until tomorrow's active window (${new Date(nextActiveStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).`);
            continue enrollmentLoop;
          }

          // 2. Rate Limited / Safety Cooldown: cooldown for 45m + 5–15m jitter
          if (isRateLimit) {
            const rateLimitJitterMs = Math.floor(Math.random() * (15 - 5 + 1) + 5) * 60 * 1000;
            const cooldownUntil = Date.now() + 45 * 60 * 1000 + rateLimitJitterMs;
            await setBucketCooldown(bucket, cooldownUntil);
            haltedBuckets.add(bucket);
            if (bucket === 'view') haltedBuckets.add('visit');
            if (bucket === 'visit') haltedBuckets.add('view');
            bucketCooldowns[bucket] = cooldownUntil;

            const mins = Math.round((cooldownUntil - Date.now()) / 60000);
            enrollment.nextAt = cooldownUntil;
            enrollment.lastError = `Safety cooldown active. Resuming in ~${mins}m`;
            enrollment.updatedAt = Date.now();
            recordHistory(enrollment, {
              step: step.type,
              label: `Postponed: Safety cooldown (~${mins}m)`,
              status: 'cooldown_postponed',
              error: enrollment.lastError,
            });
            dirty = true;

            logDebug('info', 'Runner', `${bucketTitle} bucket resting for ~${mins}m (human pacing)`);
            continue enrollmentLoop;
          }

          if (STOP_THE_TICK.has(errorCode)) {
            halted = true;
            break;
          }

          // Non-quota, non-rate-limit errors count as an attempted write to bound retries per tick
          attemptedWrites += 1;

          let friendlyError = errorMsg || 'Unknown error';
          logDebug('error', 'Runner', `Step failed: ${friendlyError}`);

          const retries = enrollment.retryCount || 0;
          if (!isPermanent && retries < 3) {
            const backoffMins = [15, 60, 240][retries] || 240;
            enrollment.retryCount = retries + 1;
            enrollment.nextAt = Date.now() + backoffMins * 60000;
            enrollment.lastError = `Retry ${enrollment.retryCount}/3 in ${backoffMins}m: ${friendlyError}`;
            enrollment.updatedAt = Date.now();
            recordHistory(enrollment, {
              step: step.type,
              label: `Retry ${enrollment.retryCount}/3: ${friendlyError}`,
              status: 'retrying',
              error: friendlyError,
            });
            dirty = true;
            logDebug('warn', 'Runner', `[Retry ${enrollment.retryCount}/3] ${enrollment.publicId} scheduled in ${backoffMins}m`);
            continue enrollmentLoop;
          }

          // Permanent failure or max retries exceeded stops that prospect.
          enrollment.status = 'stopped';
          enrollment.error = friendlyError;
          enrollment.updatedAt = Date.now();
          recordHistory(enrollment, {
            step: step.type,
            label: `Failed: ${friendlyError}`,
            status: 'failed',
            error: friendlyError,
          });
          dirty = true;
          continue enrollmentLoop;
        }

        const doneIndex = enrollment.stepIndex;
        enrollment.updatedAt = Date.now();
        dirty = true;
        if (variantUsed) campaign.variantCursor = (campaign.variantCursor || 0) + 1;

        if (res.data.status === 'queued') {
          queued += 1;
          // Stay on this step; the next tick picks it up once a human has approved or rejected it.
          enrollment.pendingQueueId = res.data.queueId;
          enrollment.nextAt = 0;
          recordHistory(enrollment, {
            step: step.type,
            label: `Sent to approval queue`,
            status: 'queued',
          });
        } else if (res.data.status === 'skipped') {
          enrollment.nextAt = 0;
          recordHistory(enrollment, {
            step: step.type,
            label: `Skipped ${step.type} (${res.data.reason || 'no post'})`,
            status: 'skipped',
            reason: res.data.reason || 'skipped',
          });
          advance(campaign, enrollment);
        } else {
          executed += 1;
          enrollment.lastActionAt = Date.now();
          if (step.abEnabled && assignedVariant) {
            recordAbStat(campaign, stepKey, assignedVariant, 'sent');
            campaign._abStatsChanged = true;
            dirty = true;
          }
          if (step.type === 'invite') {
            enrollment.lastInviteStepKey = stepKey;
          }
          if (['message', 'inmail', 'email'].includes(step.type)) {
            enrollment.lastMessageStepKey = stepKey;
          }
          if (routed) {
            enrollment.lastRoutedAction = routed;
            console.log(`[Campaign] ${routed} for ${enrollment.publicId}`);
          }
          if (step.type === 'email' && res.data) {
            if (res.data.threadId) enrollment.gmailThreadId = res.data.threadId;
            if (res.data.messageId) enrollment.gmailLastMessageId = res.data.messageId;
            if (params.subject) enrollment.gmailSubject = params.subject;
          }

          const stepVerb = step.type.charAt(0).toUpperCase() + step.type.slice(1);
          const historyLabel = routed
            ? 'Sent Free InMail (routed)'
            : (res.data?.sentWithoutNote ? 'Sent Invite (blank - note limit reached)' : `Sent ${stepVerb}`);
          recordHistory(enrollment, {
            step: step.type,
            label: historyLabel,
            status: 'completed',
          });

          advance(campaign, enrollment, step);
        }

        await emit(EVENTS.CAMPAIGN_STEP_DONE, {
          campaignId: campaign.campaignId,
          publicId: enrollment.publicId,
          stepIndex: doneIndex,
          type: step.type,
          status: routed || res.data.status,
          ...(routed ? { routed } : {}),
        });

        if (isFinished(campaign, enrollment)) await finish(campaign, enrollment);
      }
    }

    if (dirty) {
      await writeEnrollments(campaign.campaignId, enrollments);
      emit(EVENTS.CAMPAIGN_LIVE_UPDATE, { campaignId: campaign.campaignId }).catch(() => {});
    }

    // stepParams advances variantCursor in memory; without this the rotation
    // restarts at A on every tick and everyone gets the same variant.
    if ((campaign.variantCursor || 0) !== cursorBefore || campaign._abStatsChanged) {
      const freshCampaigns = await readCampaigns();
      const target = freshCampaigns.find((c) => c.campaignId === campaign.campaignId);
      if (target) {
        if (campaign.variantCursor !== undefined) target.variantCursor = campaign.variantCursor;
        if (campaign.abStats) target.abStats = campaign.abStats;
        if (campaign.abCounters) target.abCounters = campaign.abCounters;
        target.updatedAt = Date.now();
        await writeCampaigns(freshCampaigns);
      }
    }

    const remaining = (await readEnrollments(campaign.campaignId)).filter(
      (e) => e.status === 'active',
    );
    if (!remaining.length && enrollments.length) {
      const freshCampaigns = await readCampaigns();
      const target = freshCampaigns.find((c) => c.campaignId === campaign.campaignId);
      if (target && target.status === 'active') {
        target.status = 'completed';
        target.updatedAt = Date.now();
        await writeCampaigns(freshCampaigns);
      }
    }
  }

  // Cap notice if tick batch limit reached
  if (executed >= maxActionsPerTick) {
    logDebug('info', 'Runner', `Reached tick batch limit (${executed} actions). Yielding until next tick alarm for distributed human pacing.`);
  }

  // Check if more due enrollments remain across active campaigns for alarm-based pacing
  hasMoreDueEnrollments = false;
  if (executed >= maxActionsPerTick && !halted) {
    try {
      const activeCamps = campaigns.filter((c) => c.status === 'active');
      for (const c of activeCamps) {
        const ens = await readEnrollments(c.campaignId);
        const dueExists = ens.some((e) => {
          if (e.status !== 'active' || (e.nextAt || 0) > now) return false;
          const steps = stepsAt(c, e.path);
          const s = steps[e.stepIndex];
          if (s && !['wait', 'branch'].includes(s.type)) {
            const norm = normalizeBucket(s.type);
            if (haltedBuckets.has(norm) || (bucketCooldowns[norm] || 0) > now) return false;
          }
          return true;
        });
        if (dueExists) {
          hasMoreDueEnrollments = true;
          break;
        }
      }
    } catch {
      /* ignore check errors */
    }
  }

  // Clean Tick Logs: Quiet notice if all due enrollments are paused on resting buckets
  if (executed === 0 && queued === 0 && restingBucketSkippedCount > 0 && restingBucketSkippedCount >= totalDueEnrollments) {
    logDebug('info', 'Runner', 'All due steps paused until quota/cooldown window resumes.');
  }

  for (const hook of tickHooks) {
    try {
      await hook({ executed, queued, halted });
    } catch {
      /* a hook must not break the tick */
    }
  }

    return { executed, queued };
    } finally {
      await releaseTickLock();
      if (hasMoreDueEnrollments) {
        const humanSpacing = 1 + Math.random() * 1.5; // 1 to 2.5 minutes randomized human spacing
        logDebug('info', 'Runner', `[Human Spacing] Next due action scheduled via alarm in ${humanSpacing.toFixed(1)}m`);
        scheduleNextTickAlarm(humanSpacing);
      } else {
        scheduleNextTickAlarm(2);
      }
    }
  } finally {
    isTickRunning = false;
  }
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

register(ACTIONS.CAMPAIGN_CREATE, (params) => create(params));
register(ACTIONS.CAMPAIGN_GET_ALL, async () => ({ campaigns: await getAll() }));
register(ACTIONS.CAMPAIGN_GET, ({ campaignId }) => getOne(campaignId));
register(ACTIONS.CAMPAIGN_ENROLL, ({ campaignId, publicIds }) => enroll(campaignId, publicIds));
register(ACTIONS.CAMPAIGN_PAUSE, ({ campaignId }) => setStatus(campaignId, 'paused'));
register(ACTIONS.CAMPAIGN_RESUME, ({ campaignId }) => setStatus(campaignId, 'active'));
register(ACTIONS.CAMPAIGN_START, ({ campaignId }) => setStatus(campaignId, 'active'));
register(ACTIONS.CAMPAIGN_DELETE, ({ campaignId }) => del(campaignId));
register(ACTIONS.CAMPAIGN_TICK, () => tick());
register(ACTIONS.CAMPAIGN_LIVE_STATUS, async ({ campaignId }) => getCampaignLiveStatus(campaignId));
register(ACTIONS.CAMPAIGN_DECLARE_AB_WINNER, async ({ campaignId, stepKey, winnerId }) =>
  declareWinner(campaignId, stepKey, winnerId)
);

register(ACTIONS.BLACKLIST_GET, async () => ({ blacklist: await getBlacklist() }));
register(ACTIONS.BLACKLIST_ADD, async ({ publicId }) => ({ blacklist: await addToBlacklist(publicId) }));
register(ACTIONS.BLACKLIST_REMOVE, async ({ publicId }) => ({ blacklist: await removeFromBlacklist(publicId) }));

register(ACTIONS.COMPANY_BLACKLIST_GET, async () => ({ companies: await getCompanyBlacklist() }));
register(ACTIONS.COMPANY_BLACKLIST_ADD, async ({ company }) => ({ companies: await addCompanyToBlacklist(company) }));
register(ACTIONS.COMPANY_BLACKLIST_REMOVE, async ({ company }) => ({ companies: await removeCompanyFromBlacklist(company) }));
