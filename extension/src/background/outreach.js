/**
 * Crafture Network — the write path.
 *
 * One rule for every outreach action, whatever asked for it:
 *
 *   dry_run          → { status: 'dryRun', wouldSend }, no quota, no queue
 *   popup / approved → send now
 *   anything else    → queue for approval, unless config.autopilot is on
 *
 * A send is always: quota.check(kind) → humanDelay() → the Voyager call →
 * quota.record(kind) → an entry in the `actions` log. That log is what
 * `contactedBefore`, campaign stats and `sync.pull` read.
 */

import { ACTIONS, ERROR, EVENTS, EngineError } from '../lib/actions.js';
import { getConfig, setConfig } from '../lib/config.js';
import { getStoredProfile, logAction, putProfile, logDebug } from '../lib/storage.js';
import { register, setRateLimitProvider } from './engine.js';
import * as queue from './queue.js';
import * as quota from './quota.js';
import * as voyager from './voyager.js';
import { meteredProfileUrn } from './visits.js';
import { emit } from './events.js';
import { getGmailToken, removeCachedToken, fetchUserEmail, sendEmail, connectGmail } from './gmail.js';
import { reportBrokenEndpoint } from './endpoints.js';

/** Which quota bucket each action draws from. */
export const QUOTA_KIND = Object.freeze({
  [ACTIONS.OUTREACH_INVITE]: 'invite',
  [ACTIONS.OUTREACH_MESSAGE]: 'message',
  [ACTIONS.OUTREACH_INMAIL]: 'message',
  [ACTIONS.OUTREACH_VIEW]: 'visit',
  [ACTIONS.OUTREACH_FOLLOW]: 'visit',
  [ACTIONS.OUTREACH_LIKE]: 'visit',
  [ACTIONS.OUTREACH_COMMENT]: 'visit',
  [ACTIONS.OUTREACH_ENDORSE]: 'visit',
  [ACTIONS.OUTREACH_EMAIL]: 'email',
});

/** Origins whose writes go straight to LinkedIn. */
const DIRECT_ORIGINS = new Set(['popup', 'approved']);

/* ================================================================== */
/*  The LinkedIn calls                                                */
/* ================================================================== */

const SENDERS = {
  // A view already reserved its visit in send(); storing what it read means
  // the follow or message after it does not pay for a second one.
  [ACTIONS.OUTREACH_VIEW]: async ({ publicId }) => {
    const profile = await voyager.viewProfile(publicId);
    await putProfile({ ...profile, profileViewedAt: Date.now() });
    return profile;
  },
  [ACTIONS.OUTREACH_FOLLOW]: async ({ publicId, profileUrn, memberId }) =>
    voyager.follow({ publicId, profileUrn: profileUrn || (await meteredProfileUrn(publicId)), memberId }),
  [ACTIONS.OUTREACH_INVITE]: async ({ publicId, note, profileUrn, memberId, firstName, lastName }) =>
    voyager.sendInvite({
      publicId,
      note,
      profileUrn: profileUrn || (await meteredProfileUrn(publicId)),
      memberId,
      firstName,
      lastName,
    }),
  // Resolving a urn for a message step does NOT charge visit quota.
  [ACTIONS.OUTREACH_MESSAGE]: async ({ publicId, body, recipientUrn }) =>
    voyager.sendMessage({
      recipientUrn: recipientUrn || (await meteredProfileUrn(publicId, { meter: false })),
      publicId,
      body,
    }),
  [ACTIONS.OUTREACH_INMAIL]: async ({ publicId, subject, body, recipientUrn }) =>
    voyager.sendInMail({
      recipientUrn: recipientUrn || (await meteredProfileUrn(publicId, { meter: false })),
      publicId,
      subject,
      body,
    }),
  [ACTIONS.OUTREACH_LIKE]: ({ postUrl, publicId }) =>
    voyager.likePost({ postUrl, publicId }),
  [ACTIONS.OUTREACH_COMMENT]: ({ postUrl, publicId, body }) =>
    voyager.commentPost({ postUrl, publicId, body }),
  [ACTIONS.OUTREACH_ENDORSE]: ({ publicId, skillUrn }) => voyager.endorseSkill({ publicId, skillUrn }),
};

/**
 * Actually send. Used directly by the popup path and by the queue's sender.
 *
 * A reserved unit stays spent when LinkedIn refuses — the request was made,
 * and LinkedIn may well have counted it. The single exception is a send we
 * refused ourselves, on our own validation, before anything was sent: nothing
 * reached LinkedIn, so the reservation goes back.
 *
 * @returns {Promise<{status: 'sent', sentAt: number}>}
 */
export async function send(action, params, origin = 'approved', context = {}) {
  const kind = QUOTA_KIND[action];

  // Reserve, do not check-then-record: two concurrent sends that both read
  // `daily = cap - 1` would otherwise both pass.
  await quota.reserve(kind);
  await quota.humanDelay();

  let sendResult;
  try {
    sendResult = await SENDERS[action](params);
  } catch (e) {
    const isCustomInviteLimit =
      e?.code === 'CUSTOM_INVITE_LIMIT_REACHED' ||
      e?.isCustomInviteLimit ||
      /CUSTOM_INVITE_LIMIT_REACHED|personalized.*invitation|custom.*message.*limit|note limit/i.test(e?.message || '');
    const isRateLimited =
      !isCustomInviteLimit &&
      (e?.status === 429 ||
       e?.code === ERROR.RATE_LIMITED ||
       e?.code === ERROR.CHALLENGE_DETECTED ||
       /weekly.*limit|too many/i.test(e?.message || ''));
    if (kind === 'invite' && isRateLimited) {
      try {
        await quota.noteBucketBackoff('invite', 24 * 60 * 60 * 1000);
      } catch (_) {}
    }
    if (e && e.code === ERROR.INVALID_PARAMS && e.message?.startsWith('LinkedIn refused')) {
      throw new EngineError(ERROR.LINKEDIN_ERROR, e.message, e.extra);
    }
    // Release reserved quota ONLY when we refused the send ourselves on our own validation
    if (e && e.code === ERROR.INVALID_PARAMS) {
      await quota.release(kind);
    }
    throw e;
  }

  // Graceful skip (e.g. like step when prospect has no posts)
  if (sendResult?.status === 'skipped') {
    await quota.release(kind);
    return {
      status: 'skipped',
      reason: sendResult.reason || 'skipped',
      sentAt: Date.now(),
    };
  }

  const result = {
    status: 'sent',
    sentAt: Date.now(),
    ...(sendResult?.sentWithoutNote ? { sentWithoutNote: true } : {}),
  };
  await logAction({
    action,
    publicId: params.publicId || '',
    origin,
    result,
    ...context,
  });
  logDebug('good', 'Outreach', `Successfully sent ${action} to ${params.publicId || 'prospect'}${sendResult?.sentWithoutNote ? ' (without note)' : ''}`);
  return result;
}

queue.setExecutor((action, params, context) => send(action, params, 'approved', context));

// The engine reports the bucket's RateLimit back on every outreach envelope.
setRateLimitProvider(quota.snapshot);

/* ================================================================== */
/*  Policy                                                            */
/* ================================================================== */

function isDryRun(params) {
  return params.dry_run === true || params.dryRun === true;
}

/**
 * Urns a caller may not supply for themselves.
 *
 * A urn skips the profile read that would have resolved it, so an agent could
 * send a thousand invitations without a single metered visit — and a
 * *malformed* non-empty urn would sail past the engine's check and land in
 * voyager's own unmetered `resolveProfileUrn` fallback. Only a human working
 * the popup, where every action is one click, may hand one in; for anybody
 * else the engine resolves it and pays for it.
 */
const CLIENT_URN_FIELDS = ['profileUrn', 'recipientUrn'];

/**
 * Split the caller's params into what LinkedIn is asked for and what only the
 * engine cares about. The campaign fields have to survive a spell in the
 * approval queue, or the action log written on approval cannot be attributed
 * and the campaign's stats read zero.
 */
function splitParams(params, origin) {
  const rest = { ...params };
  const { campaignId, stepIndex, routing } = rest;
  delete rest.dry_run;
  delete rest.dryRun;
  delete rest.campaignId;
  delete rest.stepIndex;
  delete rest.routing;

  if (!DIRECT_ORIGINS.has(origin)) {
    for (const field of CLIENT_URN_FIELDS) delete rest[field];
  }

  const context = {};
  if (campaignId) {
    context.campaignId = campaignId;
    if (stepIndex !== undefined) context.stepIndex = stepIndex;
  }
  if (routing) context.routing = routing;
  return { params: rest, context };
}

/**
 * Apply the origin rules to one outreach action.
 * @returns {Promise<{status: 'sent'|'queued'|'dryRun', queueId?, wouldSend?, sentAt?}>}
 */
export async function dispatch(action, rawParams, origin) {
  const { params, context } = splitParams(rawParams, origin);

  if (isDryRun(rawParams)) {
    return { status: 'dryRun', wouldSend: { action, params } };
  }

  if (DIRECT_ORIGINS.has(origin) || !queue.isQueueable(action)) {
    return send(action, params, origin, context);
  }

  const config = await getConfig();
  if (config.autopilot) return send(action, params, origin, context);

  const profile = params.publicId ? await getStoredProfile(params.publicId) : null;
  const item = await queue.enqueue(action, params, origin, profile, context);
  return { status: 'queued', queueId: item.id };
}

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

for (const action of Object.keys(SENDERS)) {
  register(action, (params, ctx) => dispatch(action, params, ctx.origin));
}

/**
 * Auto-withdraw sent invitations older than 14 days.
 * Paces each withdrawal with a safe 3–6s random delay and caps at max 10 withdrawals per run.
 * Returns `{ withdrawnCount, skippedCount }`.
 */
export async function withdrawStaleInvites(params = {}, origin = 'popup') {
  const olderThanDays = typeof params.olderThanDays === 'number' ? params.olderThanDays : 14;
  const maxCount =
    typeof params.maxCount === 'number' ? Math.min(Math.max(1, params.maxCount), 50) : 10;
  const cutoffMs = olderThanDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const seenIds = new Set();
  const allInvitations = [];
  const pageStarts = [0, 100, 200, 300, 400];
  for (const start of pageStarts) {
    try {
      const batch = await voyager.fetchSentInvitations({ start, count: 100 });
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const inv of batch) {
        const id = inv.invitationId || inv.invitationUrn;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          allInvitations.push(inv);
        } else if (!id) {
          allInvitations.push(inv);
        }
      }
      if (batch.length < 100) break;
    } catch (err) {
      logDebug('warn', 'Outreach', `[withdrawStaleInvites] Error fetching page at start=${start}: ${err.message}`);
      break;
    }
  }

  const withSentAtCount = allInvitations.filter((inv) => Boolean(inv.sentTime || inv.sentAt)).length;
  const stale = allInvitations.filter(
    (inv) => (inv.sentTime || inv.sentAt) && now - (inv.sentTime || inv.sentAt) > cutoffMs,
  );

  const toProcess = stale.slice(0, maxCount);
  const scannedCount = toProcess.length;

  let withdrawnCount = 0;
  let skippedCount = 0;
  let consecutiveFailures = 0;
  let usedMethod = 'sdui_api';
  const errors = [];

  for (let i = 0; i < toProcess.length; i++) {
    const inv = toProcess[i];
    const delayMs = Math.round(3000 + Math.random() * 3000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      // Pass invitation metadata directly into voyager.withdrawInvitation(invitationId, meta)
      // NOTE: Withdrawing stale invitations MUST NEVER call getProfile, getProfileNormalized,
      // or reserve profileView/visit quota.
      const res = await voyager.withdrawInvitation(inv.invitationId || inv.invitationUrn || inv.entityUrn, {
        profileUrn: inv.profileUrn || inv.toMemberUrn || '',
        entityUrn: inv.entityUrn || inv.invitationUrn || '',
        toMemberUrn: inv.toMemberUrn || '',
        publicId: inv.publicId || inv.toPublicId || inv.vanityName || '',
        firstName: inv.firstName || '',
        lastName: inv.lastName || '',
        fullName: inv.fullName || '',
        allowDomFallback: false,
      });
      withdrawnCount++;
      consecutiveFailures = 0;
      await logAction({
        action: ACTIONS.NETWORK_WITHDRAW_STALE_INVITES,
        publicId: inv.toPublicId || inv.recipientPublicId || inv.publicId || inv.vanityName || '',
        origin,
        result: {
          status: 'withdrawn',
          invitationId: inv.invitationId,
          withdrawnAt: Date.now(),
          method: res?.method || 'sdui_api',
        },
      });
      logDebug(
        'good',
        'Outreach',
        `[withdrawStaleInvites] Successfully withdrawn invitation for ${inv.publicId || inv.invitationId} via ${res?.method || 'sdui_api'}`,
      );
    } catch (err) {
      skippedCount++;
      consecutiveFailures++;
      errors.push({ invitationId: inv.invitationId, error: err.message });
      logDebug(
        'warn',
        'Outreach',
        `[withdrawStaleInvites] Failed to withdraw invitation ${inv.invitationId}: ${err.message}`,
      );

      const status = err.status || err.response?.status || 0;
      const isSduiRejection =
        status === 400 ||
        status === 404 ||
        status === 410 ||
        status === 422 ||
        status >= 500 ||
        /400|404|410|422|500|502|503/i.test(String(err?.message || err.message));

      // If SDUI API fails twice with 400/404/422, hand off failed invites + remaining eligible batch to single DOM fallback session
      if (consecutiveFailures >= 2 && isSduiRejection) {
        reportBrokenEndpoint('withdrawInvitation', status, '', err).catch(() => {});
        const failedBatch = toProcess.slice(Math.max(0, i + 1 - consecutiveFailures), i + 1);
        const remainingBatch = toProcess.slice(i + 1);
        const handoffBatch = failedBatch.concat(remainingBatch);

        // Roll back skippedCount and errors for the failedBatch being handed off to DOM fallback
        skippedCount = Math.max(0, skippedCount - failedBatch.length);
        const failedIds = new Set(failedBatch.map((inv) => String(inv.invitationId || inv.invitationUrn || '')).filter(Boolean));
        for (let e = errors.length - 1; e >= 0; e--) {
          if (failedIds.has(String(errors[e]?.invitationId || ''))) {
            errors.splice(e, 1);
          }
        }

        logDebug(
          'warn',
          'Outreach',
          `[AutoWithdraw] SDUI API failed twice (${err.message}). Handoff of ${handoffBatch.length} invites (${failedBatch.length} failed + ${remainingBatch.length} remaining) to single background DOM-click session...`,
        );

        if (handoffBatch.length > 0) {
          try {
            usedMethod = withdrawnCount > 0 ? 'hybrid' : 'dom_fallback';
            const domRes = await voyager.withdrawViaDomFallback(handoffBatch, {
              olderThanDays,
              maxCount: Math.max(1, maxCount - withdrawnCount),
            });

            if (domRes && Array.isArray(domRes.results)) {
              for (const r of domRes.results) {
                if (r.success) {
                  withdrawnCount++;
                  await logAction({
                    action: ACTIONS.NETWORK_WITHDRAW_STALE_INVITES,
                    publicId: r.publicId || '',
                    origin,
                    result: {
                      status: 'withdrawn',
                      invitationId: r.invitationId,
                      withdrawnAt: Date.now(),
                      method: 'dom_fallback',
                    },
                  });
                } else {
                  skippedCount++;
                  errors.push({ invitationId: r.invitationId, error: r.reason });
                }
              }
            }
          } catch (domErr) {
            logDebug(
              'error',
              'Outreach',
              `[AutoWithdraw] DOM-click fallback error: ${domErr.message}`,
            );
            errors.push({ batch: 'dom_fallback', error: domErr.message });
          }
        }

        // If after trying both SDUI and DOM fallback with 0 successes, break and throw error
        if (withdrawnCount === 0) {
          logDebug(
            'error',
            'Outreach',
            `[withdrawStaleInvites] Fail-fast triggered: 0 successes after SDUI and DOM fallback. Aborting.`,
          );
          throw err;
        }

        break;
      }

      // Fail-fast guard: if 2 consecutive non-SDUI failures occur with 0 successes
      if (consecutiveFailures >= 2 && withdrawnCount === 0) {
        logDebug(
          'error',
          'Outreach',
          `[withdrawStaleInvites] Fail-fast triggered: 2 consecutive withdrawals failed with 0 successes. Aborting run.`,
        );
        throw err;
      }
    }
  }

  logDebug(
    'info',
    'Outreach',
    `[withdrawStaleInvites] Finished run: fetched=${allInvitations.length}, withSentAt=${withSentAtCount}, stale=${stale.length}, withdrawn=${withdrawnCount}, skipped=${skippedCount}, method=${usedMethod}`,
  );

  return {
    scannedCount,
    withdrawnCount,
    skippedCount,
    withdrawn: withdrawnCount,
    attempted: scannedCount,
    totalPending: allInvitations.length,
    staleCount: stale.length,
    method: usedMethod,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

export const withdrawOldInvites = withdrawStaleInvites;

register(ACTIONS.NETWORK_WITHDRAW_STALE_INVITES, (params, ctx) =>
  withdrawStaleInvites(params, ctx.origin),
);

export const WITHDRAW_CLEANUP_ALARM = 'crafture-withdraw-cleanup';
export const WITHDRAW_CLEANUP_STORAGE_KEY = 'crafture_withdraw_cleanup_state';

/**
 * Retrieve current status of the auto-withdraw cleanup background scheduler.
 */
export async function getAutoWithdrawCleanupStatus() {
  try {
    const data = await chrome.storage.local.get([WITHDRAW_CLEANUP_STORAGE_KEY]);
    return data?.[WITHDRAW_CLEANUP_STORAGE_KEY] || {
      active: false,
      olderThanDays: 14,
      batchSize: 15,
      cooldownMinutes: 15,
      dailyCap: 75,
      totalWithdrawnToday: 0,
      today: new Date().toDateString(),
      lastRunAt: null,
      nextRunAt: null,
      stoppedReason: null,
    };
  } catch {
    return {
      active: false,
      olderThanDays: 14,
      batchSize: 15,
      cooldownMinutes: 15,
      dailyCap: 75,
      totalWithdrawnToday: 0,
      today: new Date().toDateString(),
      lastRunAt: null,
      nextRunAt: null,
      stoppedReason: null,
    };
  }
}

/**
 * Stop and clear the auto-withdraw cleanup background alarm.
 */
export async function stopAutoWithdrawCleanup(reason = 'stopped_by_user') {
  try {
    chrome.alarms?.clear?.(WITHDRAW_CLEANUP_ALARM);
  } catch {}
  const state = await getAutoWithdrawCleanupStatus();
  state.active = false;
  state.stoppedReason = reason;
  state.nextRunAt = null;
  try {
    await chrome.storage.local.set({ [WITHDRAW_CLEANUP_STORAGE_KEY]: state });
  } catch {}
  logDebug('info', 'AutoWithdrawCleanup', `[AutoWithdrawCleanup] Scheduler stopped: ${reason}`);
  return state;
}

/**
 * Start or resume the safe, alarm-based Auto-Clean All Stale Invites background scheduler.
 * Runs an immediate first batch, then schedules alarms with cooldownMinutes interval.
 */
export async function startAutoWithdrawCleanup(params = {}, origin = 'popup') {
  const olderThanDays = typeof params.olderThanDays === 'number' ? params.olderThanDays : 14;
  const batchSize = typeof params.batchSize === 'number' ? Math.max(1, Math.min(50, params.batchSize)) : 15;
  const cooldownMinutes = typeof params.cooldownMinutes === 'number' ? Math.max(1, params.cooldownMinutes) : 15;
  const dailyCap = typeof params.dailyCap === 'number' ? Math.max(1, params.dailyCap) : 75;

  const todayStr = new Date().toDateString();
  const prevState = await getAutoWithdrawCleanupStatus();
  const totalWithdrawnToday = prevState.today === todayStr ? (prevState.totalWithdrawnToday || 0) : 0;

  if (totalWithdrawnToday >= dailyCap) {
    const state = {
      ...prevState,
      active: false,
      olderThanDays,
      batchSize,
      cooldownMinutes,
      dailyCap,
      totalWithdrawnToday,
      today: todayStr,
      stoppedReason: 'daily_cap_reached',
      nextRunAt: null,
    };
    try {
      chrome.alarms?.clear?.(WITHDRAW_CLEANUP_ALARM);
      await chrome.storage.local.set({ [WITHDRAW_CLEANUP_STORAGE_KEY]: state });
    } catch {}
    logDebug('warn', 'AutoWithdrawCleanup', `[AutoWithdrawCleanup] Daily cap reached (${totalWithdrawnToday}/${dailyCap}). Cannot start.`);
    return state;
  }

  // Run immediate first batch
  const remainingForToday = Math.max(1, dailyCap - totalWithdrawnToday);
  const currentBatchSize = Math.min(batchSize, remainingForToday);

  let batchRes;
  try {
    batchRes = await withdrawStaleInvites({
      olderThanDays,
      maxCount: currentBatchSize,
    }, origin);
  } catch (err) {
    const isFatal =
      err?.code === ERROR.RATE_LIMITED ||
      err?.code === ERROR.CHALLENGE_DETECTED ||
      err?.code === ERROR.NOT_LOGGED_IN ||
      /fail-fast|challenge|rate.limit|too.many.requests|unauthorized/i.test(err?.message || '');
    if (isFatal) {
      await stopAutoWithdrawCleanup(err?.message || 'error');
    }
    throw err;
  }

  const withdrawnNow = batchRes?.withdrawnCount ?? batchRes?.withdrawn ?? 0;
  const newTotalWithdrawn = totalWithdrawnToday + withdrawnNow;
  const now = Date.now();

  const allCleared =
    (batchRes?.staleCount === 0) ||
    ((batchRes?.staleCount || 0) <= withdrawnNow) ||
    (batchRes?.attempted === 0);

  const capReached = newTotalWithdrawn >= dailyCap;

  if (allCleared) {
    const state = {
      active: false,
      olderThanDays,
      batchSize,
      cooldownMinutes,
      dailyCap,
      totalWithdrawnToday: newTotalWithdrawn,
      today: todayStr,
      lastRunAt: now,
      nextRunAt: null,
      stoppedReason: 'completed',
      lastBatchResult: batchRes,
    };
    try {
      chrome.alarms?.clear?.(WITHDRAW_CLEANUP_ALARM);
      await chrome.storage.local.set({ [WITHDRAW_CLEANUP_STORAGE_KEY]: state });
    } catch {}
    logDebug('info', 'AutoWithdrawCleanup', `[AutoWithdrawCleanup] First batch completed. All stale invites cleared (${newTotalWithdrawn} total withdrawn today).`);
    return state;
  }

  if (capReached) {
    const state = {
      active: false,
      olderThanDays,
      batchSize,
      cooldownMinutes,
      dailyCap,
      totalWithdrawnToday: newTotalWithdrawn,
      today: todayStr,
      lastRunAt: now,
      nextRunAt: null,
      stoppedReason: 'daily_cap_reached',
      lastBatchResult: batchRes,
    };
    try {
      chrome.alarms?.clear?.(WITHDRAW_CLEANUP_ALARM);
      await chrome.storage.local.set({ [WITHDRAW_CLEANUP_STORAGE_KEY]: state });
    } catch {}
    logDebug('info', 'AutoWithdrawCleanup', `[AutoWithdrawCleanup] Daily cap reached (${newTotalWithdrawn}/${dailyCap}). Stopping.`);
    return state;
  }

  // Schedule drip alarm
  try {
    chrome.alarms?.create?.(WITHDRAW_CLEANUP_ALARM, { delayInMinutes: cooldownMinutes });
  } catch {}

  const state = {
    active: true,
    olderThanDays,
    batchSize,
    cooldownMinutes,
    dailyCap,
    totalWithdrawnToday: newTotalWithdrawn,
    today: todayStr,
    lastRunAt: now,
    nextRunAt: now + cooldownMinutes * 60 * 1000,
    stoppedReason: null,
    lastBatchResult: batchRes,
  };
  try {
    await chrome.storage.local.set({ [WITHDRAW_CLEANUP_STORAGE_KEY]: state });
  } catch {}
  logDebug('info', 'AutoWithdrawCleanup', `[AutoWithdrawCleanup] First batch done (${withdrawnNow} withdrawn). Scheduled next batch in ${cooldownMinutes}m.`);
  return state;
}

/**
 * Handle alarm fire for WITHDRAW_CLEANUP_ALARM.
 */
export async function runAutoWithdrawCleanupTick() {
  const state = await getAutoWithdrawCleanupStatus();
  if (!state.active) {
    try {
      chrome.alarms?.clear?.(WITHDRAW_CLEANUP_ALARM);
    } catch {}
    return;
  }

  const todayStr = new Date().toDateString();
  if (state.today !== todayStr) {
    state.today = todayStr;
    state.totalWithdrawnToday = 0;
  }

  if (state.totalWithdrawnToday >= state.dailyCap) {
    logDebug('info', 'AutoWithdrawCleanup', `[AutoWithdrawCleanup] Daily cap reached (${state.totalWithdrawnToday}/${state.dailyCap}). Stopping for today.`);
    await stopAutoWithdrawCleanup('daily_cap_reached');
    return;
  }

  const remainingForToday = Math.max(1, state.dailyCap - state.totalWithdrawnToday);
  const currentBatchSize = Math.min(state.batchSize || 15, remainingForToday);

  let batchRes;
  try {
    batchRes = await withdrawStaleInvites({
      olderThanDays: state.olderThanDays || 14,
      maxCount: currentBatchSize,
    }, 'system');
  } catch (err) {
    logDebug('warn', 'AutoWithdrawCleanup', `[AutoWithdrawCleanup] Tick error: ${err.message}`);
    const isFatal =
      err?.code === ERROR.RATE_LIMITED ||
      err?.code === ERROR.CHALLENGE_DETECTED ||
      err?.code === ERROR.NOT_LOGGED_IN ||
      /fail-fast|challenge|rate.limit|too.many.requests|unauthorized/i.test(err?.message || '');
    if (isFatal) {
      await stopAutoWithdrawCleanup(err?.message || 'error');
    } else {
      state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
      if (state.consecutiveFailures >= 3) {
        await stopAutoWithdrawCleanup(`aborted_after_3_failures: ${err.message}`);
      } else {
        try {
          chrome.alarms?.create?.(WITHDRAW_CLEANUP_ALARM, { delayInMinutes: state.cooldownMinutes || 15 });
        } catch {}
        state.nextRunAt = Date.now() + (state.cooldownMinutes || 15) * 60 * 1000;
        await chrome.storage.local.set({ [WITHDRAW_CLEANUP_STORAGE_KEY]: state });
      }
    }
    return;
  }

  const withdrawnNow = batchRes?.withdrawnCount ?? batchRes?.withdrawn ?? 0;
  state.totalWithdrawnToday = (state.totalWithdrawnToday || 0) + withdrawnNow;
  state.lastRunAt = Date.now();
  state.lastBatchResult = batchRes;
  state.consecutiveFailures = 0;

  const allCleared =
    (batchRes?.staleCount === 0) ||
    ((batchRes?.staleCount || 0) <= withdrawnNow) ||
    (batchRes?.attempted === 0);

  if (allCleared) {
    logDebug('info', 'AutoWithdrawCleanup', `[AutoWithdrawCleanup] All stale invites cleared (${state.totalWithdrawnToday} total withdrawn). Finished.`);
    await stopAutoWithdrawCleanup('completed');
    return;
  }

  if (state.totalWithdrawnToday >= state.dailyCap) {
    logDebug('info', 'AutoWithdrawCleanup', `[AutoWithdrawCleanup] Daily cap reached (${state.totalWithdrawnToday}/${state.dailyCap}). Stopping.`);
    await stopAutoWithdrawCleanup('daily_cap_reached');
    return;
  }

  try {
    chrome.alarms?.create?.(WITHDRAW_CLEANUP_ALARM, { delayInMinutes: state.cooldownMinutes || 15 });
  } catch {}
  state.nextRunAt = Date.now() + (state.cooldownMinutes || 15) * 60 * 1000;
  try {
    await chrome.storage.local.set({ [WITHDRAW_CLEANUP_STORAGE_KEY]: state });
  } catch {}
  logDebug('info', 'AutoWithdrawCleanup', `[AutoWithdrawCleanup] Drip batch finished (${withdrawnNow} withdrawn). Next batch in ${state.cooldownMinutes}m.`);
}

register(ACTIONS.NETWORK_WITHDRAW_AUTO_START, (params, ctx) =>
  startAutoWithdrawCleanup(params, ctx.origin),
);
register(ACTIONS.NETWORK_WITHDRAW_AUTO_STOP, () =>
  stopAutoWithdrawCleanup('stopped_by_user'),
);
register(ACTIONS.NETWORK_WITHDRAW_AUTO_STATUS, () =>
  getAutoWithdrawCleanupStatus(),
);

/* ================================================================== */
/*  Gmail Outreach & Account Handlers                                 */
/* ================================================================== */

/**
 * Dispatch cold email through user's authenticated Gmail account.
 * If no recipient email exists on the prospect, gracefully returns status: 'skipped'.
 */
export async function sendOutreachEmail(params = {}, origin = 'popup') {
  if (isDryRun(params)) {
    return { status: 'dryRun', wouldSend: { action: ACTIONS.OUTREACH_EMAIL, params } };
  }

  const { publicId, subject, body, threadId, inReplyTo, references } = params;
  const profile = publicId ? await getStoredProfile(publicId) : null;
  const recipientEmail =
    params.email ||
    params.to ||
    (profile && profile.email) ||
    (profile && profile.enrichment && profile.enrichment.email) ||
    (profile && profile.enrichmentEmail);

  if (!recipientEmail) {
    return {
      status: 'skipped',
      reason: 'No email address found for lead',
      publicId: publicId || '',
    };
  }

  await quota.reserve('email');

  let result;
  try {
    result = await sendEmail({
      to: recipientEmail,
      subject,
      body,
      threadId,
      inReplyTo,
      references,
    });
  } catch (err) {
    await quota.release('email');
    throw err;
  }

  await logAction({
    action: ACTIONS.OUTREACH_EMAIL,
    publicId: publicId || '',
    origin,
    channel: 'gmail',
    result: {
      status: 'sent',
      messageId: result.messageId,
      threadId: result.threadId,
      to: recipientEmail,
      sentAt: Date.now(),
    },
  });

  await emit(EVENTS.EMAIL_SENT, {
    publicId: publicId || '',
    email: recipientEmail,
    subject,
    status: 'sent',
    channel: 'gmail',
    messageId: result.messageId,
    threadId: result.threadId,
    ...(params.campaignId ? { campaignId: params.campaignId } : {}),
  });

  return {
    status: 'sent',
    to: recipientEmail,
    messageId: result.messageId,
    threadId: result.threadId,
    sentAt: Date.now(),
  };
}

register(ACTIONS.OUTREACH_EMAIL, (params, ctx) => sendOutreachEmail(params, ctx.origin));

register(ACTIONS.GMAIL_CONNECT, async (params = {}) => {
  const interactive = params.interactive !== false;
  return connectGmail(interactive);
});

register(ACTIONS.GMAIL_DISCONNECT, async () => {
  try {
    const token = await getGmailToken(false);
    await removeCachedToken(token);
  } catch {
    /* token might already be removed */
  }
  await setConfig({ mailbox: { connected: false, email: '' } });
  return { disconnected: true };
});

register(ACTIONS.GMAIL_STATUS, async () => {
  const cfg = await getConfig();
  return {
    connected: Boolean(cfg.mailbox && cfg.mailbox.connected),
    email: (cfg.mailbox && cfg.mailbox.email) || '',
  };
});

register(ACTIONS.GMAIL_TEST, async (params = {}) => {
  const cfg = await getConfig();
  const to = params.to || (cfg.mailbox && cfg.mailbox.email);
  if (!to) {
    throw new Error('No mailbox connected. Please connect with Gmail first.');
  }
  const result = await sendEmail({
    to,
    subject: 'Crafture Network — Gmail Integration Test',
    body: 'Hello! Your Gmail integration with Crafture Network is active and working properly.',
  });
  return { status: 'sent', to, messageId: result.messageId };
});
