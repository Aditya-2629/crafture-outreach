/**
 * OutFox — Dynamic LinkedIn Endpoints, Vault Hot-Sync & Read-Only Health Audit
 *
 * Ensures the extension stays resilient when LinkedIn rotates or alters Voyager/SDUI endpoints.
 * Endpoints are loaded from Vault on startup and every 6 hours, cached locally in storage,
 * and seamlessly fallen back to hardcoded defaults or DOM automation if Vault is unreachable.
 */

import { ACTIONS } from '../lib/actions.js';
import { register } from './engine.js';
import { logDebug } from '../lib/storage.js';
import { voyagerFetch, encodeVariables } from './voyager-core.js';
import { selfProfileUrn, getMessengerConversations } from './voyager.js';

export const VAULT_API_URL = 'https://vault.api.crafture.space/api/endpoints';
export const VAULT_API_KEY = '007_haiSecret';

export const DEFAULT_ENDPOINTS = Object.freeze({
  me: '/voyager/api/me',
  listSentInvitations: '/voyager/api/relationships/sentInvitationViewsV2',
  connectionsSummary: '/voyager/api/relationships/connectionsSummary',
  messengerConversations:
    '/voyagerMessagingGraphQL/graphql?queryId=messengerConversations.9501074288a12f3ae9e3c7ea243bccbf',
  profileViewsCount: '/voyager/api/identity/wvmpCards',
  sendInvite: '/voyagerRelationshipsDashMemberRelationships',
  withdrawInvitation:
    '/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation',
});

const STORAGE_ENDPOINTS_KEY = 'outfox_remote_endpoints';
const STORAGE_REPORTS_KEY = 'outfox_endpoint_reports';
const REPORT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours
const SYNC_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes throttle for lightweight polling

let cachedEndpoints = { ...DEFAULT_ENDPOINTS };
let endpointsMeta = {
  lastSyncAt: 0,
  lastAuditRunAt: 0,
};

/**
 * Initialize endpoints from local cache on worker startup.
 */
export async function initEndpoints() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return cachedEndpoints;
  }
  try {
    const data = await chrome.storage.local.get([STORAGE_ENDPOINTS_KEY]);
    const stored = data[STORAGE_ENDPOINTS_KEY];
    if (stored && typeof stored === 'object') {
      if (stored.endpoints && typeof stored.endpoints === 'object') {
        cachedEndpoints = { ...DEFAULT_ENDPOINTS, ...stored.endpoints };
      }
      endpointsMeta.lastSyncAt = Number(stored.lastSyncAt) || 0;
      endpointsMeta.lastAuditRunAt = Number(stored.lastAuditRunAt) || 0;
    }
  } catch (err) {
    console.warn('[Endpoints] Failed to load cached endpoints:', err);
  }
  return cachedEndpoints;
}

/**
 * Get currently active endpoint URL by key.
 *
 * @param {string} key
 * @returns {string}
 */
export function getEndpoint(key) {
  return cachedEndpoints[key] || DEFAULT_ENDPOINTS[key] || '';
}

/**
 * Hot-sync endpoints from Vault API.
 *
 * @param {boolean} [force=false]
 * @returns {Promise<{ ok: boolean, changed: boolean, endpoints: object, error?: string }>}
 */
export async function syncEndpointsFromVault(force = false) {
  const now = Date.now();
  if (!force && now - (endpointsMeta.lastSyncAt || 0) < SYNC_THROTTLE_MS) {
    return { ok: true, changed: false, endpoints: cachedEndpoints, throttled: true };
  }

  try {
    const res = await fetch(VAULT_API_URL, {
      method: 'GET',
      headers: {
        'x-api-key': VAULT_API_KEY,
        accept: 'application/json',
      },
    });

    if (!res.ok) {
      logDebug('warn', 'Endpoints', `[Vault Sync] Server responded with status ${res.status}`);
      return { ok: false, changed: false, endpoints: cachedEndpoints, error: `Vault HTTP ${res.status}` };
    }

    const payload = await res.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return { ok: false, changed: false, endpoints: cachedEndpoints, error: 'Invalid JSON from Vault' };
    }

    const remoteEndpoints = payload.endpoints || payload;
    let changed = false;

    if (remoteEndpoints && typeof remoteEndpoints === 'object') {
      for (const [k, val] of Object.entries(remoteEndpoints)) {
        if (typeof val === 'string' && val.trim() && cachedEndpoints[k] !== val.trim()) {
          cachedEndpoints[k] = val.trim();
          changed = true;
        }
      }
    }

    endpointsMeta.lastSyncAt = Date.now();

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({
        [STORAGE_ENDPOINTS_KEY]: {
          endpoints: cachedEndpoints,
          ...endpointsMeta,
        },
      });
    }

    // Check if Vault requested an on-demand read-only health audit
    if (payload.auditRequestedAt && Number(payload.auditRequestedAt) > endpointsMeta.lastAuditRunAt) {
      logDebug('good', 'Endpoints', '[Vault Sync] On-demand health audit requested by Vault. Running...');
      runReadOnlyEndpointAudit().catch((err) => {
        logDebug('warn', 'Endpoints', `[Vault Audit Error] ${err.message}`);
      });
    }

    logDebug('good', 'Endpoints', `[Vault Sync] Hot-sync completed (changed=${changed})`);
    return { ok: true, changed, endpoints: cachedEndpoints };
  } catch (err) {
    logDebug('warn', 'Endpoints', `[Vault Sync Error] ${err.message}`);
    return { ok: false, changed: false, endpoints: cachedEndpoints, error: err.message };
  }
}

/**
 * Report a broken LinkedIn endpoint to Vault with a 12h cooldown per key to avoid log spam.
 *
 * @param {string} key
 * @param {number|string} status
 * @param {string} url
 * @param {any} error
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string }>}
 */
export async function reportBrokenEndpoint(key, status, url, error) {
  if (!key) return { ok: false, reason: 'No key provided' };

  try {
    let reports = {};
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get([STORAGE_REPORTS_KEY]);
      reports = data[STORAGE_REPORTS_KEY] || {};
    }

    const lastReported = Number(reports[key]) || 0;
    const now = Date.now();
    if (now - lastReported < REPORT_COOLDOWN_MS) {
      return { ok: true, skipped: true, reason: 'cooldown_active' };
    }

    reports[key] = now;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ [STORAGE_REPORTS_KEY]: reports });
    }

    const reportUrl = `${VAULT_API_URL}/report`;
    const body = {
      key,
      status: Number(status) || status || 0,
      url: url || getEndpoint(key),
      error: String(error?.message || error || 'Unknown endpoint error'),
      reportedAt: now,
      version: '1.0.0',
    };

    fetch(reportUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': VAULT_API_KEY,
      },
      body: JSON.stringify(body),
    }).catch(() => {});

    logDebug('warn', 'Endpoints', `[Endpoints Report] Reported broken endpoint ${key} (status=${status})`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Execute a safe, zero-write read-only health audit of LinkedIn Voyager endpoints.
 * Never performs writes, sends invites, or alters messages.
 *
 * @returns {Promise<{ ok: boolean, results: object }>}
 */
export async function runReadOnlyEndpointAudit() {
  const results = {};

  // 1. Audit 'me' endpoint and resolve active user's mailboxUrn
  let mailboxUrn = '';
  const meUrl = getEndpoint('me');
  try {
    const meRes = await voyagerFetch(meUrl);
    results.me = { ok: true, status: 200, url: meUrl };
    const included = meRes?.included || [];
    const mini = included.find((e) => String(e.entityUrn || '').includes('miniProfile')) || included[0] || {};
    mailboxUrn = mini.dashEntityUrn || mini.entityUrn || meRes?.data?.['*miniProfile'] || '';
  } catch (err) {
    const status = Number(err?.status || err?.response?.status || err?.code) || 500;
    results.me = { ok: false, status, url: meUrl, error: err?.message || String(err) };
  }

  if (!mailboxUrn) {
    try {
      mailboxUrn = await selfProfileUrn();
    } catch {}
  }

  // 2. Audit 'listSentInvitations'
  const listSentUrl = `${getEndpoint('listSentInvitations')}?count=1&invitationType=CONNECTION&q=invitationType&start=0`;
  try {
    await voyagerFetch(listSentUrl);
    results.listSentInvitations = { ok: true, status: 200, url: listSentUrl };
  } catch (err) {
    const status = Number(err?.status || err?.response?.status || err?.code) || 500;
    results.listSentInvitations = { ok: false, status, url: listSentUrl, error: err?.message || String(err) };
  }

  // 3. Audit 'connectionsSummary'
  const connUrl = getEndpoint('connectionsSummary');
  try {
    await voyagerFetch(connUrl);
    results.connectionsSummary = { ok: true, status: 200, url: connUrl };
  } catch (err) {
    const status = Number(err?.status || err?.response?.status || err?.code) || 500;
    results.connectionsSummary = { ok: false, status, url: connUrl, error: err?.message || String(err) };
  }

  // 4. Audit 'messengerConversations' with mailboxUrn variables (fallback to verified inbox helper)
  const rawMessengerEndpoint = getEndpoint('messengerConversations');
  let messengerUrl = rawMessengerEndpoint;
  try {
    if (rawMessengerEndpoint.includes('graphql') || rawMessengerEndpoint.includes('voyagerMessagingGraphQL')) {
      const queryIdParam = rawMessengerEndpoint.includes('queryId=')
        ? ''
        : `${rawMessengerEndpoint.includes('?') ? '&' : '?'}queryId=messengerConversations.9501074288a12f3ae9e3c7ea243bccbf`;
      const baseWithQueryId = rawMessengerEndpoint.includes('queryId=')
        ? rawMessengerEndpoint
        : `${rawMessengerEndpoint}${queryIdParam}`;
      const sep = baseWithQueryId.includes('?') ? '&' : '?';
      const vars = encodeVariables({
        query: {
          predicateUnions: [{ conversationCategoryPredicate: { category: 'PRIMARY_INBOX' } }],
        },
        count: 1,
        ...(mailboxUrn ? { mailboxUrn } : {}),
      });
      messengerUrl = baseWithQueryId.includes('variables=')
        ? baseWithQueryId
        : `${baseWithQueryId}${sep}variables=${vars}`;
      await voyagerFetch(messengerUrl);
    } else {
      const sep = rawMessengerEndpoint.includes('?') ? '&' : '?';
      const mailboxPart = mailboxUrn
        ? `&mailboxUrn=${encodeURIComponent(mailboxUrn)}&variables=(mailboxUrn:${encodeURIComponent(mailboxUrn)})`
        : '';
      messengerUrl = `${rawMessengerEndpoint}${sep}keyVersion=LEGACY_INBOX&q=all&count=1${mailboxPart}`;
      await voyagerFetch(messengerUrl);
    }
    results.messengerConversations = { ok: true, status: 200, url: messengerUrl };
  } catch (err) {
    // If testing the raw endpoint returned an error, attempt the verified getMessengerConversations helper
    try {
      if (typeof getMessengerConversations === 'function') {
        await getMessengerConversations({ count: 1 });
        results.messengerConversations = {
          ok: true,
          status: 200,
          url: messengerUrl,
          method: 'voyager.getMessengerConversations',
        };
      } else {
        throw err;
      }
    } catch (fallbackErr) {
      const status = Number(err?.status || err?.response?.status || err?.code) || 500;
      results.messengerConversations = {
        ok: false,
        status,
        url: messengerUrl,
        error: err?.message || String(err),
      };
    }
  }

  const now = Date.now();
  endpointsMeta.lastAuditRunAt = now;

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get([STORAGE_ENDPOINTS_KEY]).then((data) => {
      const stored = data[STORAGE_ENDPOINTS_KEY] || {};
      chrome.storage.local.set({
        [STORAGE_ENDPOINTS_KEY]: {
          ...stored,
          lastAuditRunAt: now,
        },
      });
    }).catch(() => {});
  }

  // Send results to Vault health telemetry endpoint
  fetch(`${VAULT_API_URL}/health`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': VAULT_API_KEY,
    },
    body: JSON.stringify({
      results,
      auditedAt: now,
      version: '1.0.0',
    }),
  }).catch(() => {});

  logDebug('good', 'Endpoints', `[Health Audit] Completed read-only health audit: ${JSON.stringify(results)}`);
  return { ok: true, results };
}

/* ================================================================== */
/*  Engine Action Registrations                                       */
/* ================================================================== */

register(ACTIONS.VAULT_SYNC_ENDPOINTS, async (params) => {
  return await syncEndpointsFromVault(Boolean(params?.force));
});

register(ACTIONS.VAULT_HEALTH_AUDIT, async () => {
  return await runReadOnlyEndpointAudit();
});
