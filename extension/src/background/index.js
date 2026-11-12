/**
 * OutFox — Background Service Worker (router).
 *
 * Deliberately thin. Every feature module registers its own contract actions
 * on import; this file routes inbound messages through `engine.handle`, gates
 * mass unfollow (whose engine lives in `unfollow.js` because it drives the
 * user's own tab and has no API), and wires the alarms.
 *
 * Every inbound message is a contract envelope: { action, params }.
 */

import { ACTIONS, ERROR, EngineError, err } from '../lib/actions.js';
import { getConfig } from '../lib/config.js';
import { handle, register } from './engine.js';
import { sendApproved } from './queue.js';
import { unfollowAll, unfollowCount, unfollowStatus, unfollowStop } from './unfollow.js';
import { logDebug } from '../lib/storage.js';


// Feature modules register their own contract actions on import.
import './extract.js';
import './lists.js';
import './queue.js';
import './outreach.js';
import './quota.js';
import './ai.js';
import './inbox.js';
import './campaigns.js';
import './capture.js';
import './research.js';
import './status.js';
import './sync.js';
import './stats.js';
import './candidates.js';
import './enrich.js';
import './telegram.js';
import './objections.js';
import { checkSnoozedReminders } from './telegram.js';

import { ensureConnected, onAlarm, startKeepalive } from './bridge.js';

/* ================================================================== */
/*  Quotas and pacing live in quota.js; outreach.js wires the engine's  */
/*  rate-limit provider.                                               */
/* ================================================================== */

export const CAMPAIGN_TICK_ALARM = 'campaignTick';

/**
 * The approval queue's own tick.
 *
 * `queue.approve` marks items and returns; this is what actually sends them.
 * It runs on the same kind of alarm as the campaign tick, at the shortest
 * cadence `chrome.alarms` allows, because an approval is a human waiting —
 * five minutes is fine for a sequence step and much too long for someone who
 * has just pressed Approve. The usual case never waits for it at all: the
 * approval kicks the sender immediately, and the alarm is the safety net for a
 * service worker that was torn down mid-drain.
 */
export const QUEUE_TICK_ALARM = 'queueTick';
export const QUEUE_TICK_MINUTES = 1;

/* ================================================================== */
/*  Action registrations                                              */
/* ================================================================== */

/**
 * Mass unfollow is destructive in a way no quota covers — there is no undo and
 * no queue — and it is not something an agent should ever start on its own
 * initiative. Only the popup, where a person is watching it happen and can
 * press Stop, may run it. That is true of the fast API mode as much as of the
 * mode that drives the visible tab: going faster is not the same as being
 * safer, and it is the irreversibility that earns the gate.
 *
 * `unfollowStop` and `unfollowStatus` are gated the same way for a simpler
 * reason: they are only meaningful to whoever started the run, and the only
 * caller that can start one is the popup.
 */
const UNFOLLOW_IS_HUMAN =
  'Mass unfollow cannot be undone, so it only runs from the popup where you can watch and stop it.';

function assertPopup(ctx = {}) {
  if (ctx.origin !== 'popup') throw new EngineError(ERROR.UNAUTHORIZED, UNFOLLOW_IS_HUMAN);
}

register(ACTIONS.NETWORK_UNFOLLOW_COUNT, (params, ctx) => {
  assertPopup(ctx);
  return unfollowCount(params || {});
});
register(ACTIONS.NETWORK_UNFOLLOW_ALL, (params, ctx) => {
  assertPopup(ctx);
  return unfollowAll(params || {});
});
register(ACTIONS.NETWORK_UNFOLLOW_STOP, (_params, ctx) => {
  assertPopup(ctx);
  return unfollowStop();
});
register(ACTIONS.NETWORK_UNFOLLOW_STATUS, (_params, ctx) => {
  assertPopup(ctx);
  return unfollowStatus();
});

/* ================================================================== */
/*  Router                                                            */
/* ================================================================== */

export async function route(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.action !== 'string') {
    return err(null, ERROR.INVALID_PARAMS, 'Message must be { action, params }');
  }
  return handle(msg.action, msg.params || {}, msg.origin || 'popup');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'LOG_ENTRY' && msg.entry) {
    logDebug(msg.entry.level, msg.entry.tag, msg.entry.message, msg.entry.data).catch(() => {});
    return false;
  }
  route(msg)
    .then(sendResponse)
    .catch((e) => sendResponse(err(null, ERROR.INTERNAL, e.message)));
  return true;
});

/* ================================================================== */
/*  Alarms, startup and bridge reconnect                              */
/* ================================================================== */

function reconnectBridge() {
  Promise.resolve()
    .then(() => ensureConnected())
    .catch((e) => console.warn('[Bridge] reconnect failed:', e.message));
}

export const STALE_WITHDRAW_ALARM = 'outfox-stale-withdraw';
export const SNOOZE_CHECK_ALARM = 'outfox-snooze-check';

chrome.alarms.create(CAMPAIGN_TICK_ALARM, { periodInMinutes: 2 });
chrome.alarms.create(QUEUE_TICK_ALARM, { periodInMinutes: QUEUE_TICK_MINUTES });
chrome.alarms.create(STALE_WITHDRAW_ALARM, { periodInMinutes: 720 });
chrome.alarms.create(SNOOZE_CHECK_ALARM, { periodInMinutes: 60 });
startKeepalive();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  onAlarm(alarm).catch(() => {});

  if (alarm.name === SNOOZE_CHECK_ALARM) {
    checkSnoozedReminders().catch(() => {});
    return;
  }

  if (alarm.name === STALE_WITHDRAW_ALARM) {
    const cfg = await getConfig();
    if (cfg.autoWithdraw?.enabled) {
      handle(ACTIONS.NETWORK_WITHDRAW_STALE_INVITES, {
        olderThanDays: cfg.autoWithdraw.olderThanDays || 14,
        maxCount: cfg.autoWithdraw.maxPerRun || 15,
      }, 'system').catch((e) => console.warn('[AutoWithdraw]', e.message));
    }
    return;
  }

  if (alarm.name === QUEUE_TICK_ALARM) {
    sendApproved().catch((e) => console.warn('[Queue tick]', e.message));
    return;
  }

  if (alarm.name !== CAMPAIGN_TICK_ALARM) return;
  reconnectBridge();
  handle(ACTIONS.CAMPAIGN_TICK, {}, 'system')
    .then((res) => {
      if (!res.ok) console.warn('[Campaign tick]', res.error);
    })
    .catch((e) => console.error('[Campaign tick error]', e));
});

chrome.runtime.onStartup.addListener(reconnectBridge);
chrome.runtime.onInstalled.addListener(reconnectBridge);
