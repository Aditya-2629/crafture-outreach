/**
 * OutFox — the write path.
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

import { ACTIONS, ERROR, EVENTS } from '../lib/actions.js';
import { getConfig, setConfig } from '../lib/config.js';
import { getStoredProfile, logAction, putProfile, logDebug } from '../lib/storage.js';
import { register, setRateLimitProvider } from './engine.js';
import * as queue from './queue.js';
import * as quota from './quota.js';
import * as voyager from './voyager.js';
import { meteredProfileUrn } from './visits.js';
import { emit } from './events.js';
import { getGmailToken, removeCachedToken, fetchUserEmail, sendEmail, connectGmail } from './gmail.js';

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
  [ACTIONS.OUTREACH_FOLLOW]: async ({ publicId, profileUrn }) =>
    voyager.follow({ publicId, profileUrn: profileUrn || (await meteredProfileUrn(publicId)) }),
  [ACTIONS.OUTREACH_INVITE]: async ({ publicId, note, profileUrn }) =>
    voyager.sendInvite({
      publicId,
      note,
      profileUrn: profileUrn || (await meteredProfileUrn(publicId)),
    }),
  // Resolving a urn from a public id is a profileView, so it is metered as a
  // visit on top of the message's own bucket.
  [ACTIONS.OUTREACH_MESSAGE]: async ({ publicId, body, recipientUrn }) =>
    voyager.sendMessage({
      recipientUrn: recipientUrn || (await meteredProfileUrn(publicId)),
      publicId,
      body,
    }),
  [ACTIONS.OUTREACH_INMAIL]: async ({ publicId, subject, body, recipientUrn }) =>
    voyager.sendInMail({
      recipientUrn: recipientUrn || (await meteredProfileUrn(publicId)),
      publicId,
      subject,
      body,
    }),
  [ACTIONS.OUTREACH_LIKE]: async ({ postUrl, publicId }) => {
    if (!postUrl) {
      logDebug('info', 'Outreach', `No post URL found for ${publicId || 'prospect'} — gracefully skipping like step.`);
      return { status: 'skipped', reason: 'no_post_url' };
    }
    return voyager.likePost({ postUrl });
  },
  [ACTIONS.OUTREACH_COMMENT]: ({ postUrl, body }) => voyager.commentPost({ postUrl, body }),
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
    const isRateLimited =
      e?.status === 429 ||
      e?.code === ERROR.RATE_LIMITED ||
      e?.code === ERROR.CHALLENGE_DETECTED ||
      /weekly.*limit|too many/i.test(e?.message || '');
    if (kind === 'invite' && isRateLimited) {
      try {
        await quota.noteBucketBackoff('invite', 24 * 60 * 60 * 1000);
      } catch (_) {}
    }
    // Release reserved quota on any client error (400) or invalid params
    if (e && (e.code === ERROR.INVALID_PARAMS || e.status === 400 || (e.response && e.response.status === 400))) {
      await quota.release(kind);
    }
    throw e;
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

  const invitations = await voyager.fetchSentInvitations({ start: 0, count: 100 });
  const stale = invitations.filter((inv) => inv.sentAt && now - inv.sentAt > cutoffMs);

  let withdrawnCount = 0;
  let skippedCount = 0;
  const errors = [];

  for (let i = 0; i < stale.length; i++) {
    if (withdrawnCount >= maxCount) {
      skippedCount += stale.length - i;
      break;
    }
    const inv = stale[i];
    const delayMs = Math.round(3000 + Math.random() * 3000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      await voyager.withdrawInvitation(inv.invitationId || inv.invitationUrn);
      withdrawnCount++;
      await logAction({
        action: ACTIONS.NETWORK_WITHDRAW_STALE_INVITES,
        publicId: inv.toPublicId || inv.recipientPublicId || inv.publicId || '',
        origin,
        result: { status: 'withdrawn', invitationId: inv.invitationId, withdrawnAt: Date.now() },
      });
    } catch (err) {
      skippedCount++;
      errors.push({ invitationId: inv.invitationId, error: err.message });
    }
  }

  return {
    withdrawnCount,
    skippedCount,
    withdrawn: withdrawnCount,
    attempted: withdrawnCount + skippedCount,
    totalPending: invitations.length,
    staleCount: stale.length,
    ...(errors.length > 0 ? { errors } : {}),
  };
}

export const withdrawOldInvites = withdrawStaleInvites;

register(ACTIONS.NETWORK_WITHDRAW_STALE_INVITES, (params, ctx) =>
  withdrawStaleInvites(params, ctx.origin),
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
    subject: 'OutFox — Gmail Integration Test',
    body: 'Hello! Your Gmail integration with OutFox is active and working properly.',
  });
  return { status: 'sent', to, messageId: result.messageId };
});
