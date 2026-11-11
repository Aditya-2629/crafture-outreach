/**
 * OutFox — event emitter.
 *
 * `emit(name, payload)` fans one contract event out to:
 *   1. the bridge, when connected (installed with `setSink`, so this module
 *      never imports bridge.js and there is no import cycle);
 *   2. `chrome.notifications`, for the three events a human must see;
 *   3. the popup, via `chrome.runtime.sendMessage` (best-effort);
 *   4. a bounded on-disk log, so `sync.pull { since }` can replay events.
 */

import { EVENTS } from '../lib/actions.js';
import { K, get, update, getStoredProfile } from '../lib/storage.js';
import { getConfig } from '../lib/config.js';

const KNOWN = new Set(Object.values(EVENTS));

/** Events that raise a desktop notification. */
const NOTIFY = {
  [EVENTS.CHALLENGE_DETECTED]: {
    title: "LinkedIn is asking you to confirm it's you",
    message:
      'Everything is paused. Open LinkedIn and complete the check yourself, then open the ' +
      'toolkit popup for what to do next. The toolkit will not try to solve it.',
  },
  [EVENTS.QUOTA_HIT]: {
    title: 'Daily limit reached',
    message: 'OutFox has paused this action type until the quota resets.',
  },
  [EVENTS.POSITIVE_REPLY]: {
    title: 'Positive reply',
    message: 'Someone replied with interest — open the Inbox tab.',
  },
};

export const MAX_EVENT_LOG = 500;

/** Installed by bridge.js: `(frame) => void`. */
let sink = null;

const listeners = new Set();

export function onEvent(fn) {
  if (typeof fn === 'function') {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  return () => {};
}

export function setSink(fn) {
  sink = typeof fn === 'function' ? fn : null;
}

export function hasSink() {
  return !!sink;
}

function notify(name, payload) {
  const spec = NOTIFY[name];
  if (!spec || typeof chrome === 'undefined' || !chrome.notifications) return;
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: spec.title,
      message: payload && payload.message ? String(payload.message) : spec.message,
    });
  } catch {
    /* notifications are advisory */
  }
}

async function record(frame) {
  await update(
    K.EVENTS,
    (log) => {
      const next = [...log, frame];
      return next.length > MAX_EVENT_LOG ? next.slice(-MAX_EVENT_LOG) : next;
    },
    [],
  );
}

async function dispatchWebhook(name, payload = {}) {
  const targetEvents = new Set([
    EVENTS.CAMPAIGN_STEP_DONE,
    EVENTS.INVITE_ACCEPTED,
    EVENTS.REPLY_RECEIVED,
    EVENTS.EMAIL_SENT,
  ]);
  if (!targetEvents.has(name)) return;

  try {
    const publicId = payload.publicId;
    const campaigns = await get(K.CAMPAIGNS, []);
    let targetCampaign = null;

    if (payload.campaignId) {
      targetCampaign = campaigns.find((c) => c.campaignId === payload.campaignId);
    } else if (publicId) {
      for (const c of campaigns) {
        const enrollments = await get(K.enrollments(c.campaignId), []);
        if (enrollments.some((e) => e.publicId === publicId)) {
          targetCampaign = c;
          break;
        }
      }
    }

    const config = await getConfig();
    const webhookUrl =
      (targetCampaign && targetCampaign.sheetWebhookUrl) || config.webhookUrl;

    if (!webhookUrl || typeof fetch !== 'function') return;

    const profile = publicId ? await getStoredProfile(publicId) : null;
    const fullName =
      (profile && (profile.fullName || `${profile.firstName || ''} ${profile.lastName || ''}`.trim())) ||
      (profile && profile.firstName) ||
      publicId ||
      '';
    const headline = (profile && profile.headline) || '';
    const company = (profile && profile.company) || '';
    const url =
      (profile && profile.url) || (publicId ? `https://www.linkedin.com/in/${publicId}` : '');
    const status =
      payload.status ||
      (name === EVENTS.INVITE_ACCEPTED
        ? 'accepted'
        : name === EVENTS.REPLY_RECEIVED
          ? 'replied'
          : 'done');

    const enriched = {
      event: name,
      timestamp: new Date().toISOString(),
      publicId: publicId || '',
      fullName,
      headline,
      company,
      url,
      status,
      campaignId: targetCampaign ? targetCampaign.campaignId : payload.campaignId || '',
      campaignName: targetCampaign ? targetCampaign.name : '',
      stepIndex: payload.stepIndex !== undefined ? payload.stepIndex : null,
      type: payload.type || null,
      ...(payload.note ? { note: payload.note } : {}),
      ...(payload.text ? { replyText: payload.text } : {}),
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(enriched),
    });
  } catch (err) {
    /* webhooks are best-effort: failure must never break action emission */
    console.warn('[OutFox] Webhook dispatch error:', err && err.message);
  }
}

/**
 * Emit one contract event.
 * @param {string} name one of EVENTS
 * @param {object} payload
 * @returns {Promise<object>} the frame that was emitted
 */
export async function emit(name, payload = {}) {
  if (!KNOWN.has(name)) throw new Error(`unknown event: ${name}`);

  const frame = { event: name, payload };

  try {
    if (sink) await sink(frame);
  } catch {
    /* a disconnected bridge must never fail the action that emitted */
  }

  for (const fn of listeners) {
    try {
      fn(name, payload);
    } catch (e) {
      console.warn('[events] listener error:', e);
    }
  }

  notify(name, payload);

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      await chrome.runtime.sendMessage({ type: 'EVENT', event: name, payload });
    }
  } catch {
    /* nobody listening (no popup open) */
  }

  try {
    await dispatchWebhook(name, payload);
  } catch {
    /* webhook failure must never break emit */
  }

  await record({ ...frame, updatedAt: Date.now() });
  return frame;
}

/** Events recorded since a timestamp — the `events` array of `sync.pull`. */
export async function recent(from = 0) {
  const cutoff = Number(from) || 0;
  const log = await get(K.EVENTS, []);
  return log.filter((e) => (e.updatedAt || 0) > cutoff);
}
