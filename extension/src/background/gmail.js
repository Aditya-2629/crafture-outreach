/**
 * OutFox — Official Google Workspace & Decoupled Gmail Integration.
 * Uses chrome.identity.launchWebAuthFlow with standard OAuth 2.0 Web Client
 * and permanent refresh_token via https://outfox-auth.crafture.workers.dev
 *
 * Supports single Google sign-in for Workspace (Sheets CRM, Drive Backups, Default Mailbox)
 * while allowing a decoupled outreach Gmail sender.
 */

import { getConfig, setConfig } from '../lib/config.js';

export const AUTH_WORKER_URL = 'https://outfox-auth.crafture.workers.dev';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

export const OUTREACH_GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
];

export const STORAGE_KEYS = {
  WORKSPACE_TOKEN: 'outfox_google_workspace_token',
  OUTREACH_TOKEN: 'outfox_outreach_gmail_token',
};

export const DEFAULT_CLIENT_ID = '567155036878-t4bm7btrqe9joju5uqdmq9ml2funkdap.apps.googleusercontent.com';

export async function getStoredToken(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => {
      resolve(res?.[key] || null);
    });
  });
}

export async function setStoredToken(key, data) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: data }, resolve);
  });
}

export async function clearStoredToken(key) {
  return new Promise((resolve) => {
    chrome.storage.local.remove([key], resolve);
  });
}

/**
 * Exchanges Google OAuth 2.0 authorization code for access & refresh tokens
 * via the public Cloudflare worker.
 */
export async function exchangeGoogleCode({ code, redirectUri }) {
  const res = await fetch(`${AUTH_WORKER_URL}/google/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`Google code exchange failed (${res.status}): ${errBody.error || errBody.message || res.statusText}`);
  }

  const data = await res.json();
  const accessToken = data.access_token || data.accessToken || data.token;
  if (!accessToken) {
    throw new Error('No access token returned from Google code exchange');
  }

  const refreshToken = data.refresh_token || data.refreshToken || null;
  const expiresIn = parseInt(data.expires_in || data.expiresIn || '3600', 10);
  const expiresAt = Date.now() + (expiresIn * 1000);

  return {
    accessToken,
    token: accessToken,
    refreshToken,
    expiresAt,
  };
}

/**
 * Silently refreshes an expired Google access token using the stored refresh_token.
 */
export async function refreshGoogleToken(refreshToken) {
  if (!refreshToken) throw new Error('No refresh token provided');

  const res = await fetch(`${AUTH_WORKER_URL}/google/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, refresh_token: refreshToken }),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const errorStr = `${errBody.error || ''} ${errBody.message || ''} ${res.statusText || ''}`.toLowerCase();
    const err = new Error(`Google token refresh failed (${res.status}): ${errBody.error || errBody.message || res.statusText}`);
    if (res.status === 400 && (errorStr.includes('invalid_grant') || errBody.error === 'invalid_grant')) {
      err.isInvalidGrant = true;
    }
    throw err;
  }

  const data = await res.json();
  const accessToken = data.access_token || data.accessToken || data.token;
  if (!accessToken) {
    throw new Error('No access token returned from Google token refresh');
  }

  const expiresIn = parseInt(data.expires_in || data.expiresIn || '3600', 10);
  const expiresAt = Date.now() + (expiresIn * 1000);

  return {
    accessToken,
    token: accessToken,
    refreshToken: data.refresh_token || data.refreshToken || refreshToken,
    expiresAt,
  };
}

/**
 * Launches Chrome Web Auth Flow with response_type=code and access_type=offline.
 * Supports direct token callback fallback for backwards compatibility/testing.
 */
export async function launchGoogleOAuth({ scopes, interactive = false, prompt = 'consent' }) {
  const manifest = chrome.runtime.getManifest();
  const clientId = (manifest.oauth2 && manifest.oauth2.client_id) || DEFAULT_CLIENT_ID;
  const scopeStr = (scopes || []).join(' ');

  const redirectUri = typeof chrome.identity?.getRedirectURL === 'function'
    ? chrome.identity.getRedirectURL()
    : `https://${chrome.runtime?.id || 'extension'}.chromiumapp.org/`;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    access_type: 'offline',
    include_granted_scopes: 'true',
    redirect_uri: redirectUri,
    scope: scopeStr,
  });
  if (prompt) params.set('prompt', prompt);

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();

  return new Promise((resolve, reject) => {
    if (!chrome.identity || typeof chrome.identity.launchWebAuthFlow !== 'function') {
      return reject(new Error('chrome.identity API is not available.'));
    }

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, async (responseUrl) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!responseUrl) return reject(new Error('Google sign-in was closed before completion.'));

      try {
        const urlObj = new URL(responseUrl);
        const hashParams = new URLSearchParams(urlObj.hash.replace(/^#/, ''));
        const code = urlObj.searchParams.get('code') || hashParams.get('code');

        if (code) {
          const exchanged = await exchangeGoogleCode({ code, redirectUri });
          return resolve(exchanged);
        }

        // Direct token fallback (e.g. mock test URLs with #access_token=...)
        const directToken = hashParams.get('access_token') || urlObj.searchParams.get('access_token');
        if (directToken) {
          const expiresIn = parseInt(hashParams.get('expires_in') || urlObj.searchParams.get('expires_in') || '3600', 10);
          const expiresAt = Date.now() + (expiresIn * 1000);
          return resolve({
            accessToken: directToken,
            token: directToken,
            refreshToken: hashParams.get('refresh_token') || null,
            expiresAt,
          });
        }

        const errorMsg = hashParams.get('error') || urlObj.searchParams.get('error') || 'No authorization code returned';
        return reject(new Error(`Google OAuth notice: ${errorMsg}`));
      } catch (err) {
        reject(new Error(err.message || 'Failed to handle OAuth redirect'));
      }
    });
  });
}

export async function fetchUserEmail(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to retrieve Google profile email.');
  const data = await res.json();
  if (!data.email) throw new Error('No email found on Google user profile.');
  return data.email;
}

export async function removeCachedToken(token) {
  return new Promise((resolve) => {
    if (!token || !chrome.identity || typeof chrome.identity.removeCachedAuthToken !== 'function') return resolve();
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
  });
}

/** In-flight token refresh promises keyed by storage key to deduplicate concurrent refresh requests */
export const inFlightRefreshes = new Map();

/**
 * Core token acquisition logic:
 * 1. Checks valid cache (>60s before expiresAt).
 * 2. If expired and refreshToken exists, silently refreshes via Cloudflare worker.
 * 3. On invalid_grant, clears storage.
 * 4. Interactive or fallback launches OAuth flow.
 */
async function acquireToken(key, scopes, interactive = false) {
  const existing = await getStoredToken(key);

  // 1. Valid cached token
  if (existing && (existing.accessToken || existing.token)) {
    const token = existing.accessToken || existing.token;
    if (typeof existing.expiresAt === 'number' && Date.now() < existing.expiresAt - 60000) {
      if (key === STORAGE_KEYS.WORKSPACE_TOKEN && existing.email) {
        try {
          const cfg = await getConfig();
          if (!cfg.googleWorkspace?.connected) {
            await setConfig({ googleWorkspace: { connected: true, email: existing.email } });
          }
        } catch {}
      }
      return token;
    }

    // 2. Silent refresh with refreshToken (deduplicating concurrent in-flight requests)
    if (existing.refreshToken) {
      if (inFlightRefreshes.has(key)) {
        return await inFlightRefreshes.get(key);
      }
      const refreshPromise = (async () => {
        try {
          const refreshed = await refreshGoogleToken(existing.refreshToken);
          const updated = {
            ...existing,
            accessToken: refreshed.accessToken,
            token: refreshed.accessToken,
            refreshToken: refreshed.refreshToken || existing.refreshToken,
            expiresAt: refreshed.expiresAt,
          };
          await setStoredToken(key, updated);
          return refreshed.accessToken;
        } catch (refreshErr) {
          if (refreshErr.isInvalidGrant) {
            await clearStoredToken(key);
            if (!interactive) {
              throw new Error('User interaction required');
            }
          } else if (!interactive) {
            throw refreshErr;
          }
        } finally {
          inFlightRefreshes.delete(key);
        }
      })();

      inFlightRefreshes.set(key, refreshPromise);
      const res = await refreshPromise;
      if (res) return res;
    }
  }

  // 3. Needs OAuth authorization
  let authResult;
  try {
    authResult = await launchGoogleOAuth({
      scopes,
      interactive: Boolean(interactive),
      prompt: interactive ? 'consent' : '',
    });
  } catch (err) {
    const isInteractionRequired = /interaction required|user interaction/i.test(err?.message || '');
    if (!interactive && isInteractionRequired) {
      throw new Error('User interaction required');
    }
    const label = key === STORAGE_KEYS.WORKSPACE_TOKEN ? 'Google Workspace' : 'Outreach Gmail';
    throw new Error(`${label} sign-in required: ${err.message || err}`);
  }

  const token = authResult.accessToken || authResult.token;
  let email = existing?.email;
  try {
    email = await fetchUserEmail(token);
  } catch {
    /* Keep existing email if userinfo lookup fails */
  }

  const tokenRecord = {
    accessToken: token,
    token,
    refreshToken: authResult.refreshToken || existing?.refreshToken || null,
    expiresAt: authResult.expiresAt,
    email: email || '',
  };
  await setStoredToken(key, tokenRecord);
  if (key === STORAGE_KEYS.WORKSPACE_TOKEN && tokenRecord.email) {
    try {
      const cfg = await getConfig();
      if (!cfg.googleWorkspace?.connected) {
        await setConfig({ googleWorkspace: { connected: true, email: tokenRecord.email } });
      }
    } catch {}
  }
  return token;
}

/**
 * Retrieves valid Google Workspace token, executing silent or interactive OAuth flow if needed.
 */
export async function getGoogleWorkspaceToken(interactive = false) {
  return acquireToken(STORAGE_KEYS.WORKSPACE_TOKEN, WORKSPACE_SCOPES, interactive);
}

/**
 * High-level helper for user-triggered actions.
 * Executes silent refresh (interactive: false) first; if it fails with "User interaction required",
 * automatically retries launchWebAuthFlow with interactive: true before throwing an error.
 */
export async function getWorkspaceToken(interactive = false) {
  try {
    return await getGoogleWorkspaceToken(interactive);
  } catch (err) {
    if (/interaction required|user interaction/i.test(err?.message || '')) {
      return await getGoogleWorkspaceToken(true);
    }
    throw err;
  }
}

/**
 * Connects Google Workspace account with all 4 scopes (Gmail, Userinfo, Sheets, Drive).
 * Defaults cold outreach mailbox to this account unless user previously selected a custom Gmail.
 */
export async function connectGoogleWorkspace(interactive = true) {
  const token = await getWorkspaceToken(interactive);
  const email = await fetchUserEmail(token);
  const cfg = await getConfig();

  const updates = {
    googleWorkspace: {
      connected: true,
      email,
    },
  };

  // If mailbox is unconfigured or set to workspace mode, default to this account
  if (!cfg.mailbox?.mode || cfg.mailbox.mode === 'workspace' || !cfg.mailbox.connected) {
    updates.mailbox = {
      connected: true,
      email,
      mode: 'workspace',
    };
  }

  await setConfig(updates);
  return { success: true, email };
}

export async function disconnectGoogleWorkspace() {
  const item = await getStoredToken(STORAGE_KEYS.WORKSPACE_TOKEN);
  if (item?.token) await removeCachedToken(item.token);
  await clearStoredToken(STORAGE_KEYS.WORKSPACE_TOKEN);

  const cfg = await getConfig();
  const mailboxUpdates = cfg.mailbox?.mode === 'workspace'
    ? { mailbox: { connected: false, email: '', mode: 'workspace' } }
    : {};

  await setConfig({
    googleWorkspace: {
      connected: false,
      email: '',
      spreadsheetId: '',
      spreadsheetUrl: '',
    },
    ...mailboxUpdates,
  });

  return { disconnected: true };
}

/**
 * Connects a separate Gmail specifically for cold outreach (decoupled sender).
 */
export async function connectGmail(interactive = true) {
  const authResult = await launchGoogleOAuth({
    scopes: OUTREACH_GMAIL_SCOPES,
    interactive,
    prompt: 'consent',
  });
  const token = authResult.accessToken || authResult.token;
  const email = await fetchUserEmail(token);
  const existing = await getStoredToken(STORAGE_KEYS.OUTREACH_TOKEN);

  await setStoredToken(STORAGE_KEYS.OUTREACH_TOKEN, {
    accessToken: token,
    token,
    refreshToken: authResult.refreshToken || existing?.refreshToken || null,
    expiresAt: authResult.expiresAt,
    email,
  });

  await setConfig({
    mailbox: {
      connected: true,
      email,
      mode: 'custom_gmail',
    },
  });

  return { success: true, email };
}

export async function disconnectGmail() {
  const item = await getStoredToken(STORAGE_KEYS.OUTREACH_TOKEN);
  if (item?.token) await removeCachedToken(item.token);
  await clearStoredToken(STORAGE_KEYS.OUTREACH_TOKEN);

  await setConfig({
    mailbox: {
      connected: false,
      email: '',
      mode: 'disabled',
    },
  });

  return { disconnected: true };
}

/**
 * Switch outreach sender mode between 'workspace', 'custom_gmail', and 'disabled'.
 */
export async function switchOutreachMailbox({ mode, email } = {}) {
  const validModes = ['workspace', 'custom_gmail', 'disabled'];
  if (!validModes.includes(mode)) {
    throw new Error(`Invalid outreach mailbox mode: ${mode}. Expected one of: ${validModes.join(', ')}`);
  }

  const cfg = await getConfig();

  if (mode === 'workspace') {
    const wsTokenRecord = await getStoredToken(STORAGE_KEYS.WORKSPACE_TOKEN);
    const wsEmail = cfg.googleWorkspace?.email || wsTokenRecord?.email;
    if (!wsEmail && !wsTokenRecord) {
      throw new Error('Google Workspace is not connected. Connect Google Workspace first.');
    }
    await setConfig({
      mailbox: {
        connected: true,
        email: wsEmail,
        mode: 'workspace',
      },
    });
  } else if (mode === 'custom_gmail') {
    const customRecord = await getStoredToken(STORAGE_KEYS.OUTREACH_TOKEN);
    if (!customRecord?.token && !customRecord?.accessToken) {
      // Prompt user to connect custom Gmail
      return connectGmail(true);
    }
    await setConfig({
      mailbox: {
        connected: true,
        email: customRecord.email || email,
        mode: 'custom_gmail',
      },
    });
  } else if (mode === 'disabled') {
    await setConfig({
      mailbox: {
        connected: false,
        email: '',
        mode: 'disabled',
      },
    });
  }

  const updated = await getConfig();
  return { mailbox: updated.mailbox };
}

/**
 * Returns access token for cold email outreach, routing according to outreachMailbox mode.
 */
export async function getGmailToken(interactive = false) {
  const cfg = await getConfig();
  const mode = cfg.mailbox?.mode || 'workspace';

  if (mode === 'disabled' || (!cfg.mailbox?.connected && mode !== 'workspace')) {
    throw new Error('Cold outreach mailbox is disabled or not connected.');
  }

  if (mode === 'custom_gmail') {
    return acquireToken(STORAGE_KEYS.OUTREACH_TOKEN, OUTREACH_GMAIL_SCOPES, interactive);
  }

  // Default: workspace
  return getWorkspaceToken(interactive);
}

function safeBase64Encode(str) {
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(str)));
  return Buffer.from(str, 'utf-8').toString('base64');
}

export function createRfc2822Message({ to, from, subject, body, inReplyTo, references, threadId }) {
  let finalSubject = subject || '';
  if (threadId && !finalSubject.toLowerCase().startsWith('re:')) {
    finalSubject = `Re: ${finalSubject}`;
  }
  const utf8Subject = `=?utf-8?B?${safeBase64Encode(finalSubject)}?=`;
  const headers = [
    `To: ${to}`,
    from ? `From: ${from}` : null,
    `Subject: ${utf8Subject}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : (inReplyTo ? `References: ${inReplyTo}` : null),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
  ].filter(Boolean).join('\r\n');

  const fullMessage = `${headers}\r\n\r\n${body || ''}`;
  return safeBase64Encode(fullMessage).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendEmail({ to, subject, body, threadId, inReplyTo, references }) {
  if (!to) throw new Error('Recipient email address is required.');

  let token;
  try {
    token = await getGmailToken(false);
  } catch {
    token = await getGmailToken(true);
  }

  const cfg = await getConfig();
  const fromEmail = cfg.mailbox && cfg.mailbox.email ? cfg.mailbox.email : undefined;

  const raw = createRfc2822Message({
    to,
    from: fromEmail,
    subject: subject || '',
    body: body || '',
    threadId,
    inReplyTo,
    references,
  });

  const sendPayload = { raw };
  if (threadId) {
    sendPayload.threadId = threadId;
  }

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(sendPayload),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(`Gmail API error (${res.status}): ${(errorJson.error && errorJson.error.message) || res.statusText}`);
  }

  const data = await res.json();
  return {
    ok: true,
    status: 'sent',
    messageId: data.id,
    threadId: data.threadId || threadId || data.id,
    sentFrom: fromEmail,
    to,
    sentAt: Date.now(),
  };
}
