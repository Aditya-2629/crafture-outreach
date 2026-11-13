import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getWorkspaceToken,
  getGoogleWorkspaceToken,
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
});
