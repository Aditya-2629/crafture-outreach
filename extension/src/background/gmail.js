/**
 * OutFox — Official Google Gmail API Integration.
 * Uses chrome.identity.launchWebAuthFlow with standard OAuth 2.0 Web Client.
 */

import { getConfig, setConfig } from '../lib/config.js';

let cachedToken = null;

export async function getGmailToken(interactive = false) {
  if (cachedToken && !interactive) {
    return cachedToken;
  }

  const manifest = chrome.runtime.getManifest();
  const clientId = (manifest.oauth2 && manifest.oauth2.client_id) || '272657974342-33vqnbq383euhl43tjimcede05ev23od.apps.googleusercontent.com';
  const scopes = ((manifest.oauth2 && manifest.oauth2.scopes) || [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email',
  ]).join(' ');

  const redirectUri = typeof chrome.identity.getRedirectURL === 'function'
    ? chrome.identity.getRedirectURL()
    : `https://${chrome.runtime.id}.chromiumapp.org/`;

  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: scopes,
    prompt: 'select_account',
  }).toString();

  return new Promise((resolve, reject) => {
    if (!chrome.identity || typeof chrome.identity.launchWebAuthFlow !== 'function') {
      return reject(new Error('chrome.identity API is not available.'));
    }

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }, (responseUrl) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!responseUrl) return reject(new Error('Google sign-in was closed before completion.'));

      try {
        const urlObj = new URL(responseUrl);
        const hashParams = new URLSearchParams(urlObj.hash.replace(/^#/, ''));
        const token = hashParams.get('access_token');
        if (!token) {
          const errorMsg = hashParams.get('error') || urlObj.searchParams.get('error') || 'No access token returned';
          return reject(new Error(`Google OAuth notice: ${errorMsg}`));
        }
        cachedToken = token;
        resolve(token);
      } catch (err) {
        reject(new Error(`Failed to parse OAuth redirect: ${err.message}`));
      }
    });
  });
}

export async function removeCachedToken(token) {
  cachedToken = null;
  return new Promise((resolve) => {
    if (!token || !chrome.identity || typeof chrome.identity.removeCachedAuthToken !== 'function') return resolve();
    chrome.identity.removeCachedAuthToken({ token }, () => resolve());
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

export async function connectGmail(interactive = true) {
  const token = await getGmailToken(interactive);
  const email = await fetchUserEmail(token);
  await setConfig({ mailbox: { connected: true, email } });
  return { success: true, email };
}

function safeBase64Encode(str) {
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(str)));
  return Buffer.from(str, 'utf-8').toString('base64');
}

export function createRfc2822Message({ to, from, subject, body }) {
  const utf8Subject = `=?utf-8?B?${safeBase64Encode(subject || '')}?=`;
  const emailLines = [
    `To: ${to}`,
    from ? `From: ${from}` : '',
    `Subject: ${utf8Subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    body || '',
  ].filter(Boolean).join('\r\n');

  return safeBase64Encode(emailLines).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendEmail({ to, subject, body }) {
  if (!to) throw new Error('Recipient email address is required.');

  let token;
  try {
    token = await getGmailToken(false);
  } catch {
    token = await getGmailToken(true);
  }

  const cfg = await getConfig();
  const raw = createRfc2822Message({
    to,
    from: cfg.mailbox && cfg.mailbox.email ? cfg.mailbox.email : undefined,
    subject: subject || '',
    body: body || '',
  });

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(`Gmail API error (${res.status}): ${(errorJson.error && errorJson.error.message) || res.statusText}`);
  }

  const data = await res.json();
  return { status: 'sent', messageId: data.id, to, sentAt: Date.now() };
}
