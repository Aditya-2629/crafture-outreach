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
import { K, allActions, get, getStoredProfile, newId, remove, set, stamp, isBlacklisted, getBlacklist, addToBlacklist, removeFromBlacklist, logDebug } from '../lib/storage.js';
import { pickVariant, renderTemplate } from '../lib/template.js';
import { emit } from './events.js';
import * as inbox from './inbox.js';
import { isWithinBusinessHours } from './quota.js';
import * as lists from './lists.js';
import * as queue from './queue.js';

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
  ERROR.QUOTA_EXCEEDED,
  ERROR.OUTSIDE_BUSINESS_HOURS,
  ERROR.RATE_LIMITED,
  ERROR.CHALLENGE_DETECTED,
  ERROR.NOT_LOGGED_IN,
]);

/** Hooks run at the end of every tick (the Research Pack registers one). */
const tickHooks = [];

export function addTickHook(fn) {
  if (typeof fn === 'function') tickHooks.push(fn);
}

/** Global execution lock preventing concurrent tick execution across tabs/alarms */
let isTickRunning = false;

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

async function writeEnrollments(campaignId, enrollments) {
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
function advance(campaign, enrollment) {
  enrollment.stepIndex += 1;
  while (enrollment.path.length >= 2 && enrollment.stepIndex >= stepsAt(campaign, enrollment.path).length) {
    const branchIndex = enrollment.path[enrollment.path.length - 2];
    enrollment.path = enrollment.path.slice(0, -2);
    enrollment.stepIndex = branchIndex + 1;
  }
}

function isFinished(campaign, enrollment) {
  return enrollment.path.length === 0 && enrollment.stepIndex >= (campaign.steps || []).length;
}

/** Mark an enrollment finished. `accepted` is kept as the richer outcome. */
async function finish(campaign, enrollment) {
  enrollment.status = enrollment.accepted ? 'accepted' : 'done';
  enrollment.updatedAt = Date.now();
  await emit(EVENTS.CAMPAIGN_COMPLETED, {
    campaignId: campaign.campaignId,
    publicId: enrollment.publicId,
  });
}

/* ================================================================== */
/*  Campaign CRUD                                                     */
/* ================================================================== */

export async function create({ name, steps, listId, publicIds, settings, sheetWebhookUrl, sheetUrl }) {
  const campaigns = await readCampaigns();
  const campaign = stamp({
    campaignId: newId('camp'),
    name,
    steps: steps || [],
    status: 'active',
    createdAt: Date.now(),
    settings: { stopOnReply: true, autopilot: false, ...(settings || {}) },
    variantCursor: 0,
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
  const enrollments = await readEnrollments(campaignId);
  const seen = new Set(enrollments.map((e) => e.publicId));

  let enrolled = 0;
  let skipped = 0;
  for (const publicId of publicIds) {
    if (!publicId || seen.has(publicId)) {
      skipped += 1;
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
    setTimeout(() => {
      tick().catch((err) => console.error('[Runner] Immediate tick error on resume:', err));
    }, 100);
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

/* ================================================================== */
/*  Step execution                                                    */
/* ================================================================== */

async function isConnected(publicId) {
  try {
    const profile = await getStoredProfile(publicId);
    // 1. If stored profile has connectionDegree === 1 or was imported as 1st connection
    if (profile && (profile.connectionDegree === 1 || profile.isConnected === true)) {
      return true;
    }
    // 2. Fallback to network status check
    const res = await handle(ACTIONS.NETWORK_STATUS, { publicIds: [publicId] }, 'campaign');
    if (res?.ok && res.data?.statuses?.[publicId] === 'connected') {
      return true;
    }
  } catch (err) {
    console.warn('[isConnected check error]', err);
  }
  // Default to true for direct message campaigns so 1st-degree connections are never falsely blocked
  return true;
}

/** Which arm of a branch this person takes. */
export async function chooseBranch(branch, enrollment) {
  const since = enrollment.lastActionAt || enrollment.enrolledAt || 0;
  if (branch.on === 'accepted') return (await isConnected(enrollment.publicId)) ? 0 : 1;
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

async function resolveAiOpener(profile) {
  try {
    const res = await handle(ACTIONS.AI_COMPLETE, { task: 'opener', input: { profile } }, 'campaign');
    if (res && res.ok && res.data && res.data.output) {
      const text = typeof res.data.output === 'string' ? res.data.output : String(res.data.output);
      return fitInviteNote(text, 180).note;
    }
  } catch {
    /* fallback to empty string on missing key, network error, etc. */
  }
  return '';
}

async function stepParams(campaign, step, enrollment, routed = null) {
  const profile = (await getStoredProfile(enrollment.publicId)) || {
    publicId: enrollment.publicId,
  };
  // A step may carry `variants` with no `note`/`body` at all — the shipped
  // sequence templates do exactly that — so the variant is the text, and a
  // literal `note`/`body` is only the fallback. The cursor only moves once the
  // write has actually happened, so a refused step does not burn a variant.
  const variant = pickVariant(step.variants, campaign.variantCursor || 0);
  const variantUsed = !!(step.variants && step.variants.length);

  const params = {
    publicId: enrollment.publicId,
    campaignId: campaign.campaignId,
    stepIndex: enrollment.stepIndex,
  };

  if (routed === 'routed_free_inmail') {
    const rawBody = step.inmailBody || step.body || step.note || variant || '';
    let bodyText = variant || rawBody;
    if (bodyText.includes('{{ai_opener') || step.useAi === true) {
      const opener = await resolveAiOpener(profile);
      bodyText = bodyText.replace(
        /\{\{\s*ai_opener\s*(?:\|([^}]*))?\}\}/g,
        (_m, fallback) => opener || (fallback ? fallback.trim() : ''),
      );
      if (step.useAi && !bodyText.trim()) bodyText = opener;
    }
    params.body = renderTemplate(bodyText, profile);
    params.subject = renderTemplate(step.inmailSubject || step.subject || 'Introduction', profile);
    params.routing = 'routed_free_inmail';
    return { params, variantUsed };
  }

  if (step.type === 'invite') {
    let noteText = variant || step.note || '';
    if (noteText.includes('{{ai_opener') || step.useAi === true) {
      const opener = await resolveAiOpener(profile);
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
  if (step.type === 'message') params.body = renderTemplate(variant || step.body, profile);
  if (step.type === 'inmail') {
    params.body = renderTemplate(variant || step.body, profile);
    params.subject = renderTemplate(step.subject, profile);
  }
  if (step.type === 'email') {
    let rawBody = variant || step.body || '';
    if (rawBody.includes('{{ai_opener') || step.useAi === true) {
      const opener = await resolveAiOpener(profile);
      rawBody = rawBody.replace(
        /\{\{\s*ai_opener\s*(?:\|([^}]*))?\}\}/g,
        (_m, fallback) => opener || (fallback ? fallback.trim() : ''),
      );
      if (step.useAi && !rawBody.trim()) rawBody = opener;
    }
    params.body = renderTemplate(rawBody, profile);
    params.subject = renderTemplate(step.subject || 'Reaching out', profile);
    params.email =
      step.email ||
      profile.email ||
      (profile.enrichment && profile.enrichment.email) ||
      profile.enrichmentEmail ||
      '';
  }
  if (step.type === 'like' || step.type === 'comment') {
    params.postUrl = step.postUrl || '';
    if (step.type === 'comment') params.body = renderTemplate(variant || step.body, profile);
  }
  return { params, variantUsed };
}

/* ================================================================== */
/*  Tick                                                              */
/* ================================================================== */

/**
 * Move every due enrollment forward.
 * @returns {Promise<{executed: number, queued: number}>}
 */
export async function tick() {
  if (isTickRunning) {
    console.log('[Runner] Previous tick still executing. Skipping duplicate tick.');
    return { executed: 0, queued: 0 };
  }
  isTickRunning = true;

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
  let queued = 0;

  // Outside the working window nothing may be written, so do not walk the
  // enrollments at all — a nightly tick over 500 people would otherwise make
  // 500 pointless reads. Individual writes are still gated by quota.check.
  let halted = config.businessHoursOnly && !isWithinBusinessHours(config);
  const haltedBuckets = new Set();

  for (const campaign of campaigns) {
    if (halted) break;
    if (campaign.status !== 'active') continue;

    const enrollments = await readEnrollments(campaign.campaignId);
    const cursorBefore = campaign.variantCursor || 0;
    let dirty = false;

    for (const enrollment of enrollments) {
      if (halted) break;

      // Check live storage status before processing prospect
      const liveCampaigns = await readCampaigns();
      const currentCamp = liveCampaigns.find((c) => c.campaignId === campaign.campaignId);
      if (!currentCamp || currentCamp.status !== 'active') {
        logDebug('warn', 'Runner', `Campaign ${campaign.campaignId} is paused/stopped. Aborting sequence loop.`);
        break;
      }

      if (enrollment.status !== 'active') continue;
      if ((enrollment.nextAt || 0) > now) continue;

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
          continue;
        }
        if (item.status === 'failed') {
          enrollment.status = 'stopped';
          enrollment.error =
            (item.result && item.result.error && item.result.error.message) || 'The queued step failed.';
          continue;
        }

        // Sent: carry on from the step after the one that was queued.
        enrollment.lastActionAt = Date.now();
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
          dirty = true;
          continue;
        }
      }

      // Do Not Contact Blacklist Guardrail
      if (await isBlacklisted(enrollment.publicId)) {
        enrollment.status = 'blacklisted';
        enrollment.error = 'Contact is on the Do Not Contact blacklist.';
        enrollment.updatedAt = now;
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

        // If this action bucket is halted for this tick (e.g. invite reached quota/rate limit), skip this enrollment so other types (view, message, email) can proceed
        if (haltedBuckets.has(step.type)) {
          break;
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
          if (arm === 0 && step.branch.on === 'accepted') enrollment.accepted = true;
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
          const skippedIndex = enrollment.stepIndex;
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
        // Before executing a message step, verify prospect is an active 1st-degree connection.
        if (step.type === 'message') {
          const connected = await isConnected(enrollment.publicId);
          if (!connected) {
            logDebug(
              'warn',
              'Runner',
              `[Runner] Skipped messaging ${enrollment.publicId}: Not a 1st-degree connection yet. Connection request required.`,
            );
            enrollment.status = 'blocked_not_connected';
            enrollment.error =
              'Cannot message: Prospect is not a 1st-degree connection yet. Send a Connection Request (Invite) first.';
            enrollment.updatedAt = Date.now();
            dirty = true;
            await emit(EVENTS.CAMPAIGN_STEP_DONE, {
              campaignId: campaign.campaignId,
              publicId: enrollment.publicId,
              stepIndex: enrollment.stepIndex,
              type: 'message',
              status: 'skipped',
              reason: 'not_first_degree',
            });
            break;
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

        const { params, variantUsed } = await stepParams(campaign, step, enrollment, routed);
        const res = await handle(action, params, 'campaign');
        wrote = true;

        if (!res.ok) {
          let friendlyError = res.error?.message || 'Unknown error';
          if (
            res.error?.code === ERROR.RATE_LIMITED ||
            res.error?.code === ERROR.CHALLENGE_DETECTED ||
            /429|999|403|rate limit|challenge/i.test(friendlyError)
          ) {
            friendlyError =
              'LinkedIn safety cooldown active. Campaign paused for human pacing to protect your account.';
          } else if (
            res.error?.code === ERROR.QUOTA_EXCEEDED ||
            /quota|limit reached/i.test(friendlyError)
          ) {
            const cap =
              res.error?.extra?.cap ||
              res.error?.cap ||
              campaign.dailyCap ||
              'daily limit';
            friendlyError = `Daily quota reached (${cap}/day). Postponed automatically until tomorrow's window.`;
          }

          logDebug('error', 'Runner', `Step failed: ${friendlyError}`);

          // Bucket-isolated throttling for invites: do NOT halt the whole tick across all campaigns
          if (step.type === 'invite' && (res.error?.code === ERROR.QUOTA_EXCEEDED || res.error?.code === ERROR.RATE_LIMITED)) {
            haltedBuckets.add('invite');
            logDebug('warn', 'Runner', `Invite bucket paused for this tick due to quota/rate-limit. Other enrollments (view, message, email) will continue.`);
            break;
          }

          if (STOP_THE_TICK.has(res.error.code)) {
            halted = true;
            break;
          }

          // Distinguish permanent failure from transient errors with exponential retry
          const isPermanent =
            res.error?.code === ERROR.NOT_FOUND ||
            res.error?.code === ERROR.INVALID_PARAMS ||
            /not found|invalid|blacklisted|already invited/i.test(friendlyError);

          const retries = enrollment.retryCount || 0;
          if (!isPermanent && retries < 3) {
            const backoffMins = [15, 60, 240][retries] || 240;
            enrollment.retryCount = retries + 1;
            enrollment.nextAt = Date.now() + backoffMins * 60000;
            enrollment.lastError = `Retry ${enrollment.retryCount}/3 in ${backoffMins}m: ${friendlyError}`;
            enrollment.updatedAt = Date.now();
            dirty = true;
            logDebug('warn', 'Runner', `[Retry ${enrollment.retryCount}/3] ${enrollment.publicId} scheduled in ${backoffMins}m`);
            break;
          }

          // Permanent failure or max retries exceeded stops that prospect.
          enrollment.status = 'stopped';
          enrollment.error = friendlyError;
          enrollment.updatedAt = Date.now();
          dirty = true;
          break;
        }

        const doneIndex = enrollment.stepIndex;
        enrollment.updatedAt = Date.now();
        dirty = true;
        if (variantUsed) campaign.variantCursor = (campaign.variantCursor || 0) + 1;

        if (res.data.status === 'queued') {
          queued += 1;
          // Stay on this step; the next tick picks it up once a human has
          // approved or rejected it.
          enrollment.pendingQueueId = res.data.queueId;
        } else {
          executed += 1;
          enrollment.lastActionAt = Date.now();
          if (routed) {
            enrollment.lastRoutedAction = routed;
            console.log(`[Campaign] ${routed} for ${enrollment.publicId}`);
          }
          advance(campaign, enrollment);
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

    if (dirty) await writeEnrollments(campaign.campaignId, enrollments);

    // stepParams advances variantCursor in memory; without this the rotation
    // restarts at A on every tick and everyone gets the same variant.
    if ((campaign.variantCursor || 0) !== cursorBefore) {
      const freshCampaigns = await readCampaigns();
      const target = freshCampaigns.find((c) => c.campaignId === campaign.campaignId);
      if (target) {
        target.variantCursor = campaign.variantCursor;
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

  for (const hook of tickHooks) {
    try {
      await hook({ executed, queued, halted });
    } catch {
      /* a hook must not break the tick */
    }
  }

    return { executed, queued };
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
register(ACTIONS.CAMPAIGN_DELETE, ({ campaignId }) => del(campaignId));
register(ACTIONS.CAMPAIGN_TICK, () => tick());

register(ACTIONS.BLACKLIST_GET, async () => ({ blacklist: await getBlacklist() }));
register(ACTIONS.BLACKLIST_ADD, async ({ publicId }) => ({ blacklist: await addToBlacklist(publicId) }));
register(ACTIONS.BLACKLIST_REMOVE, async ({ publicId }) => ({ blacklist: await removeFromBlacklist(publicId) }));
