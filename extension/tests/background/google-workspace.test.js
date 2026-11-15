import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getWorkspaceToken,
  getGoogleWorkspaceToken,
  getGmailToken,
  connectGmail,
  exchangeGoogleCode,
  refreshGoogleToken,
  AUTH_WORKER_URL,
  STORAGE_KEYS,
} from '../../src/background/gmail.js';
import {
  syncAllLeadsToSheet,
  backupToGoogleDrive,
  restoreFromGoogleDrive,
  getWorkspaceToken as gwGetWorkspaceToken,
} from '../../src/background/google-workspace.js';
import { setConfig } from '../../src/lib/config.js';

describe('Google Workspace Auth & User Actions', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await setConfig({
      googleWorkspace: {
        connected: true,
        email: 'test@example.com',
      },
    });
  });

  it('exports getWorkspaceToken from both gmail.js and google-workspace.js', () => {
    expect(typeof getWorkspaceToken).toBe('function');
    expect(typeof gwGetWorkspaceToken).toBe('function');
  });

  it('returns cached token immediately without launching web auth flow', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.WORKSPACE_TOKEN]: {
        token: 'cached-token-123',
        expiresAt: Date.now() + 3600000,
        email: 'test@example.com',
      },
    });

    const launchSpy = vi.spyOn(chrome.identity, 'launchWebAuthFlow');
    const token = await getWorkspaceToken();
    expect(token).toBe('cached-token-123');
    expect(launchSpy).not.toHaveBeenCalled();
  });

  it('automatically retries launchWebAuthFlow with interactive: true when silent refresh fails with "User interaction required"', async () => {
    let callCount = 0;
    const launchCalls = [];

    vi.spyOn(chrome.identity, 'launchWebAuthFlow').mockImplementation(({ url, interactive }, callback) => {
      callCount++;
      launchCalls.push({ url, interactive });
      if (callCount === 1) {
        // Silent refresh fails
        chrome.runtime.lastError = { message: 'User interaction required' };
        callback(null);
        chrome.runtime.lastError = undefined;
      } else {
        // Interactive retry succeeds
        callback('https://test.chromiumapp.org/#access_token=token-interactive-xyz&expires_in=3600');
      }
    });

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('userinfo')) {
        return {
          ok: true,
          json: async () => ({ email: 'test@example.com' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const token = await getWorkspaceToken();
    expect(token).toBe('token-interactive-xyz');
    expect(launchCalls).toHaveLength(2);
    expect(launchCalls[0].interactive).toBe(false);
    expect(launchCalls[1].interactive).toBe(true);
  });

  it('throws error when interactive retry also fails', async () => {
    vi.spyOn(chrome.identity, 'launchWebAuthFlow').mockImplementation(({ interactive }, callback) => {
      chrome.runtime.lastError = { message: 'User interaction required' };
      callback(null);
      chrome.runtime.lastError = undefined;
    });

    await expect(getWorkspaceToken()).rejects.toThrow(/Google Workspace sign-in required/);
  });

  it('syncAllLeadsToSheet calls getWorkspaceToken and retries interactively when token is missing', async () => {
    let callCount = 0;
    const launchCalls = [];

    vi.spyOn(chrome.identity, 'launchWebAuthFlow').mockImplementation(({ interactive }, callback) => {
      callCount++;
      launchCalls.push({ interactive });
      if (callCount === 1) {
        chrome.runtime.lastError = { message: 'User interaction required' };
        callback(null);
        chrome.runtime.lastError = undefined;
      } else {
        callback('https://test.chromiumapp.org/#access_token=token-for-sync&expires_in=3600');
      }
    });

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('userinfo')) {
        return { ok: true, json: async () => ({ email: 'test@example.com' }) };
      }
      if (String(url).includes('spreadsheets')) {
        return {
          ok: true,
          json: async () => ({ spreadsheetId: 'sheet-123', spreadsheetUrl: 'https://docs.google.com/sheet-123' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const result = await syncAllLeadsToSheet();
    expect(result.success).toBe(true);
    expect(launchCalls).toHaveLength(2);
    expect(launchCalls[0].interactive).toBe(false);
    expect(launchCalls[1].interactive).toBe(true);
  });

  it('exchanges authorization code via the standalone Cloudflare auth worker', async () => {
    let capturedBody = null;
    let capturedUrl = null;

    globalThis.fetch = vi.fn(async (url, opts) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({
          access_token: 'worker-exchanged-access-token',
          refresh_token: 'worker-refresh-token-xyz',
          expires_in: 3600,
        }),
      };
    });

    const result = await exchangeGoogleCode({
      code: 'auth-code-12345',
      redirectUri: 'https://extension-id.chromiumapp.org/',
    });

    expect(capturedUrl).toBe(`${AUTH_WORKER_URL}/google/exchange`);
    expect(capturedBody).toEqual({
      code: 'auth-code-12345',
      redirectUri: 'https://extension-id.chromiumapp.org/',
    });
    expect(result.accessToken).toBe('worker-exchanged-access-token');
    expect(result.token).toBe('worker-exchanged-access-token');
    expect(result.refreshToken).toBe('worker-refresh-token-xyz');
    expect(result.expiresAt).toBeGreaterThan(Date.now() + 3000000);
  });

  it('silently auto-refreshes expired token using stored refresh_token without user interaction', async () => {
    // Store expired token with valid refresh_token
    await chrome.storage.local.set({
      [STORAGE_KEYS.WORKSPACE_TOKEN]: {
        accessToken: 'old-expired-token',
        token: 'old-expired-token',
        refreshToken: 'saved-refresh-token-456',
        expiresAt: Date.now() - 5000, // already expired
        email: 'test@example.com',
      },
    });

    const launchSpy = vi.spyOn(chrome.identity, 'launchWebAuthFlow');
    let refreshCalled = false;

    globalThis.fetch = vi.fn(async (url, opts) => {
      if (String(url).includes('/google/refresh')) {
        refreshCalled = true;
        const body = JSON.parse(opts.body);
        expect(body.refreshToken).toBe('saved-refresh-token-456');
        return {
          ok: true,
          json: async () => ({
            access_token: 'new-refreshed-token-789',
            expires_in: 3600,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    // Request token non-interactively
    const token = await getGoogleWorkspaceToken(false);
    expect(token).toBe('new-refreshed-token-789');
    expect(refreshCalled).toBe(true);
    expect(launchSpy).not.toHaveBeenCalled();

    // Verify storage updated
    const stored = await new Promise((r) => chrome.storage.local.get([STORAGE_KEYS.WORKSPACE_TOKEN], r));
    const item = stored[STORAGE_KEYS.WORKSPACE_TOKEN];
    expect(item.accessToken).toBe('new-refreshed-token-789');
    expect(item.token).toBe('new-refreshed-token-789');
    expect(item.refreshToken).toBe('saved-refresh-token-456');
    expect(item.expiresAt).toBeGreaterThan(Date.now() + 3000000);
  });

  it('deduplicates concurrent refresh requests using inFlightRefreshes', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.WORKSPACE_TOKEN]: {
        accessToken: 'expired-token-123',
        token: 'expired-token-123',
        refreshToken: 'saved-refresh-token-456',
        expiresAt: Date.now() - 5000,
        email: 'test@example.com',
      },
    });

    let refreshCallCount = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/google/refresh')) {
        refreshCallCount += 1;
        await new Promise((r) => setTimeout(r, 20));
        return {
          ok: true,
          json: async () => ({
            access_token: 'new-refreshed-token-999',
            refresh_token: 'saved-refresh-token-456',
            expires_in: 3600,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const [t1, t2, t3] = await Promise.all([
      getGoogleWorkspaceToken(false),
      getGoogleWorkspaceToken(false),
      getGoogleWorkspaceToken(false),
    ]);

    expect(t1).toBe('new-refreshed-token-999');
    expect(t2).toBe('new-refreshed-token-999');
    expect(t3).toBe('new-refreshed-token-999');
    expect(refreshCallCount).toBe(1);
  });

  it('clears stored token and prompts interactive re-connect on invalid_grant', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.WORKSPACE_TOKEN]: {
        accessToken: 'revoked-token',
        token: 'revoked-token',
        refreshToken: 'revoked-refresh-token',
        expiresAt: Date.now() - 10000,
        email: 'test@example.com',
      },
    });

    // Mock refresh returning invalid_grant
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/google/refresh')) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: 'invalid_grant',
            error_description: 'Token has been expired or revoked.',
          }),
        };
      }
      if (String(url).includes('/google/exchange')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'brand-new-token-after-reauth',
            refresh_token: 'new-refresh-token-after-reauth',
            expires_in: 3600,
          }),
        };
      }
      if (String(url).includes('userinfo')) {
        return { ok: true, json: async () => ({ email: 'test@example.com' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    // Mock interactive web auth flow returning authorization code
    vi.spyOn(chrome.identity, 'launchWebAuthFlow').mockImplementation(({ url, interactive }, callback) => {
      expect(url).toContain('response_type=code');
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(interactive).toBe(true);
      callback('https://test.chromiumapp.org/?code=brand-new-auth-code');
    });

    const token = await getWorkspaceToken();
    expect(token).toBe('brand-new-token-after-reauth');

    const stored = await new Promise((r) => chrome.storage.local.get([STORAGE_KEYS.WORKSPACE_TOKEN], r));
    const item = stored[STORAGE_KEYS.WORKSPACE_TOKEN];
    expect(item.accessToken).toBe('brand-new-token-after-reauth');
    expect(item.refreshToken).toBe('new-refresh-token-after-reauth');
  });

  it('preserves existing refreshToken when Google omits it on re-consent', async () => {
    await chrome.storage.local.set({
      [STORAGE_KEYS.WORKSPACE_TOKEN]: {
        accessToken: 'old-access-token',
        token: 'old-access-token',
        refreshToken: 'retained-refresh-token',
        expiresAt: Date.now() - 1000,
        email: 'test@example.com',
      },
    });

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('/google/exchange')) {
        return {
          ok: true,
          json: async () => ({
            access_token: 'reauth-access-token-without-rt',
            // Google omits refresh_token on repeated consents without prompt=consent
            expires_in: 3600,
          }),
        };
      }
      if (String(url).includes('userinfo')) {
        return { ok: true, json: async () => ({ email: 'test@example.com' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    vi.spyOn(chrome.identity, 'launchWebAuthFlow').mockImplementation(({ interactive }, callback) => {
      callback('https://test.chromiumapp.org/?code=code-reauth');
    });

    const token = await getWorkspaceToken(true);
    expect(token).toBe('reauth-access-token-without-rt');

    const stored = await new Promise((r) => chrome.storage.local.get([STORAGE_KEYS.WORKSPACE_TOKEN], r));
    const item = stored[STORAGE_KEYS.WORKSPACE_TOKEN];
    expect(item.accessToken).toBe('reauth-access-token-without-rt');
    // Kept existing refreshToken!
    expect(item.refreshToken).toBe('retained-refresh-token');
  });
});
