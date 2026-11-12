/**
 * OutFox — messaging bridge between the UI pages and the engine.
 *
 * Every UI call goes through `send(action, params)`, which is exactly the
 * contract envelope over `chrome.runtime.sendMessage`. Nothing in the UI sends
 * the old v1 `type` strings any more.
 */

import { ERROR } from '../lib/actions.js';

/** Thrown by `call()` when the engine answers `ok: false`. */
export class ApiError extends Error {
  constructor(code, message, extra = {}) {
    super(message || code || 'Unknown error');
    this.name = 'ApiError';
    this.code = code || ERROR.INTERNAL;
    this.howToFix = extra.howToFix;
    this.retryAfter = extra.retryAfter;
  }

  /** Single line suitable for an inline error row. */
  get display() {
    // Human first: the message, then how to fix it; the machine code trails in brackets.
    const base = this.howToFix ? `${this.message} ${this.howToFix}` : this.message;
    return `${base} (${this.code})`;
  }
}

function offline(message) {
  return {
    ok: false,
    error: {
      code: ERROR.EXTENSION_OFFLINE,
      message: message || 'No response from the extension engine.',
      howToFix: 'Reload the extension from chrome://extensions and try again.',
    },
  };
}

function normalize(response) {
  if (response && typeof response === 'object' && typeof response.ok === 'boolean') {
    if (response.ok) return response;
    const error = response.error || {};
    return {
      ok: false,
      error: {
        code: error.code || ERROR.INTERNAL,
        message: error.message || 'Unknown error',
        howToFix: error.howToFix,
        retryAfter: error.retryAfter,
      },
    };
  }
  if (response && typeof response === 'object' && typeof response.error === 'string') {
    return { ok: false, error: { code: ERROR.INTERNAL, message: response.error } };
  }
  return offline();
}

const RETRYABLE_SW_PATTERNS = [
  'no sw',
  'could not establish connection',
  'receiving end does not exist',
  'context invalidated',
  'timed out',
];

function isWakeupError(error) {
  if (!error) return false;
  if (error.code === ERROR.EXTENSION_OFFLINE) return true;
  const msg = String(error.message || '').toLowerCase();
  return RETRYABLE_SW_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Send one action to the engine and resolve with the contract envelope.
 * Never rejects — transport failures come back as `EXTENSION_OFFLINE`.
 *
 * @param {string} action  a value from `ACTIONS`
 * @param {object} [params]
 * @param {number} [timeoutMs=6000]
 * @returns {Promise<{ok: true, data: *, rateLimit?: object} | {ok: false, error: object}>}
 */
export function send(action, params = {}, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = (response) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const lastError = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError;
      if (lastError) {
        resolve(offline(lastError.message));
        return;
      }
      resolve(normalize(response));
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        finish(offline('No SW (timed out)'));
      }, timeoutMs);
    }

    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        finish(offline('No SW'));
        return;
      }
      const maybePromise = chrome.runtime.sendMessage({ action, params }, finish);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(finish, (e) => finish(offline(e && e.message)));
      }
    } catch (e) {
      finish(offline(e && e.message));
    }
  });
}

/**
 * Like `send`, but returns `data` and throws an `ApiError` on `ok: false`.
 * Automatically retries up to 2 times (waiting 350ms between retries) if the MV3 service
 * worker was asleep ('No SW' / 'Could not establish connection'), guarded by a 6-second timeout.
 *
 * @param {string} action
 * @param {object} [params]
 */
export async function call(action, params = {}) {
  const maxRetries = 2;
  const overallTimeoutMs = 6000;
  const start = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const elapsed = Date.now() - start;
    const remainingTime = Math.max(1000, overallTimeoutMs - elapsed);

    let envelope;
    try {
      envelope = await send(action, params, remainingTime);
    } catch (err) {
      envelope = offline(err && err.message);
    }

    if (envelope.ok) {
      return envelope.data;
    }

    const shouldRetry =
      attempt < maxRetries &&
      isWakeupError(envelope.error) &&
      (Date.now() - start) < overallTimeoutMs;

    if (shouldRetry) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      continue;
    }

    throw new ApiError(envelope.error.code, envelope.error.message, envelope.error);
  }
}

/**
 * Subscribe to engine events (`{ event, payload }` messages).
 * @param {(event: string, payload: object) => void} handler
 * @returns {() => void} unsubscribe
 */
export function onEvent(handler) {
  const listener = (msg) => {
    if (msg && typeof msg.event === 'string') handler(msg.event, msg.payload || {});
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

/* ================================================================== */
/*  Local UI state (never leaves the machine, never sent to LinkedIn)  */
/* ================================================================== */

/** Read one `chrome.storage.local` key with a fallback. */
export async function getLocal(key, fallback = null) {
  try {
    const bag = await chrome.storage.local.get(key);
    const value = bag ? bag[key] : undefined;
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/** Write one `chrome.storage.local` key. */
export async function setLocal(key, value) {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    /* storage unavailable — UI preferences are not worth failing over */
  }
}

export const UI_KEYS = Object.freeze({
  ACTIVE_TAB: 'ui.activeTab',
  SAVED_REPLIES: 'ui.savedReplies',
  SNOOZED: 'ui.snoozedThreads',
  ENRICHMENT: 'ui.enrichment',
});
