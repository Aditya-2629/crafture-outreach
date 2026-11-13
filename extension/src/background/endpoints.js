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
const STORAGE_LAST_AUDIT_RUN_KEY = 'outfox_last_audit_run_at';
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
    const data = await chrome.storage.local.get([STORAGE_ENDPOINTS_KEY, STORAGE_LAST_AUDIT_RUN_KEY]);
    const stored = data[STORAGE_ENDPOINTS_KEY];
    if (stored && typeof stored === 'object') {
      if (stored.endpoints && typeof stored.endpoints === 'object') {
        cachedEndpoints = { ...DEFAULT_ENDPOINTS, ...stored.endpoints };
      }
      endpointsMeta.lastSyncAt = Number(stored.lastSyncAt) || 0;
      endpointsMeta.lastAuditRunAt = Number(data[STORAGE_LAST_AUDIT_RUN_KEY] || stored.lastAuditRunAt) || 0;
    } else if (data[STORAGE_LAST_AUDIT_RUN_KEY] !== undefined) {
      endpointsMeta.lastAuditRunAt = Number(data[STORAGE_LAST_AUDIT_RUN_KEY]) || 0;
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
        const rawUrl = typeof val === 'string' ? val : val?.url;
        if (typeof rawUrl === 'string' && rawUrl.trim() && cachedEndpoints[k] !== rawUrl.trim()) {
          cachedEndpoints[k] = rawUrl.trim();
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

    // Deduplicate auditRequestedAt persistently
    let lastAuditRunAt = endpointsMeta.lastAuditRunAt || 0;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const storedAudit = await chrome.storage.local.get([STORAGE_LAST_AUDIT_RUN_KEY]);
      if (storedAudit && storedAudit[STORAGE_LAST_AUDIT_RUN_KEY] !== undefined) {
        lastAuditRunAt = Number(storedAudit[STORAGE_LAST_AUDIT_RUN_KEY]) || 0;
      }
    }

    const requestedAt = Number(payload.auditRequestedAt || 0);
    if (requestedAt > lastAuditRunAt) {
      endpointsMeta.lastAuditRunAt = requestedAt;
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        // Immediately persist BEFORE running audit so concurrent/rapid ticks never re-trigger
        await chrome.storage.local.set({
          [STORAGE_LAST_AUDIT_RUN_KEY]: requestedAt,
        });
      }
      logDebug(
        'good',
        'Endpoints',
        `[Vault Sync] On-demand health audit requested by Vault (req=${requestedAt}, last=${lastAuditRunAt}). Running...`,
      );
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
    const errorMsg = err?.message || String(err);
    results.me = { ok: false, status, url: meUrl, error: errorMsg };
    reportBrokenEndpoint('me', status, meUrl, errorMsg).catch(() => {});
  }

  if (!mailboxUrn) {
    try {
      mailboxUrn = await selfProfileUrn();
    } catch {}
  }

  // 2. Audit 'listSentInvitations' (only append query params if URL does not already contain '?')
  const rawListSentEndpoint = getEndpoint('listSentInvitations');
  const listSentUrl = rawListSentEndpoint.includes('?')
    ? rawListSentEndpoint
    : `${rawListSentEndpoint}?count=1&invitationType=CONNECTION&q=invitationType&start=0`;
  try {
    await voyagerFetch(listSentUrl);
    results.listSentInvitations = { ok: true, status: 200, url: listSentUrl };
  } catch (err) {
    const status = Number(err?.status || err?.response?.status || err?.code) || 500;
    const errorMsg = err?.message || String(err);
    results.listSentInvitations = { ok: false, status, url: listSentUrl, error: errorMsg };
    reportBrokenEndpoint('listSentInvitations', status, listSentUrl, errorMsg).catch(() => {});
  }

  // 3. Audit 'connectionsSummary'
  const connUrl = getEndpoint('connectionsSummary');
  try {
    await voyagerFetch(connUrl);
    results.connectionsSummary = { ok: true, status: 200, url: connUrl };
  } catch (err) {
    const status = Number(err?.status || err?.response?.status || err?.code) || 500;
    const errorMsg = err?.message || String(err);
    results.connectionsSummary = { ok: false, status, url: connUrl, error: errorMsg };
    reportBrokenEndpoint('connectionsSummary', status, connUrl, errorMsg).catch(() => {});
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
      const errorMsg = err?.message || String(err);
      results.messengerConversations = {
        ok: false,
        status,
        url: messengerUrl,
        error: errorMsg,
      };
      reportBrokenEndpoint('messengerConversations', status, messengerUrl, errorMsg).catch(() => {});
    }
  }

  // Ensure any audited endpoint returning ok: false triggers a background report to Vault
  for (const [key, res] of Object.entries(results)) {
    if (!res.ok) {
      reportBrokenEndpoint(key, res.status, res.url, res.error).catch(() => {});
    }
  }

  const now = Date.now();
  endpointsMeta.lastAuditRunAt = Math.max(now, endpointsMeta.lastAuditRunAt);

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get([STORAGE_ENDPOINTS_KEY, STORAGE_LAST_AUDIT_RUN_KEY]).then((data) => {
      const stored = data[STORAGE_ENDPOINTS_KEY] || {};
      const currentStored = Number(data[STORAGE_LAST_AUDIT_RUN_KEY]) || 0;
      const latestAuditTime = Math.max(now, currentStored, endpointsMeta.lastAuditRunAt);
      chrome.storage.local.set({
        [STORAGE_ENDPOINTS_KEY]: {
          ...stored,
          lastAuditRunAt: latestAuditTime,
        },
        [STORAGE_LAST_AUDIT_RUN_KEY]: latestAuditTime,
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
