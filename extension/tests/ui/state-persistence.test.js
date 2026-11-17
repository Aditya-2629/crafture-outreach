/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  switchView,
  getSavedUiState,
  saveUiState,
  getViewUiState,
  saveViewUiState,
  updateHash,
  getScrollPosition,
  restoreScrollPosition,
} from '../../src/dashboard/dashboard.js';
import { renderSettingsView } from '../../src/dashboard/settings-view.js';
import { renderCampaignsView } from '../../src/dashboard/campaigns-view.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint, statusFixture, configFixture } from './helpers.js';

describe('Vanilla Dashboard — State Persistence & Instant Reactive Updates', () => {
  let appRoot;
  let toastContainer;

  beforeEach(async () => {
    sessionStorage.clear();
    await chrome.storage.local.clear();
    document.body.innerHTML = '';
    window.location.hash = '';

    // Create required DOM structure for dashboard
    appRoot = document.createElement('section');
    appRoot.id = 'app-root';
    appRoot.className = 'content-body';
    document.body.appendChild(appRoot);

    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    document.body.appendChild(toastContainer);

    const crumb = document.createElement('span');
    crumb.id = 'topbar-crumb-title';
    document.body.appendChild(crumb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    sessionStorage.clear();
  });

  it('persists global and per-view UI state in sessionStorage and updates hash', () => {
    saveUiState({ activeView: 'campaigns', subState: 'completed' });
    const saved = getSavedUiState();
    expect(saved.activeView).toBe('campaigns');
    expect(saved.subState).toBe('completed');

    saveViewUiState('campaigns', { activeSubTab: 'completed', searchQuery: 'fintech' });
    const campState = getViewUiState('campaigns');
    expect(campState.activeSubTab).toBe('completed');
    expect(campState.searchQuery).toBe('fintech');

    updateHash('campaigns', 'completed');
    expect(window.location.hash).toBe('#campaigns:completed');
  });

  it('captures and restores scroll positions without throwing errors', () => {
    const mainCanvas = document.createElement('div');
    mainCanvas.className = 'main-canvas';
    mainCanvas.scrollTop = 120;
    document.body.appendChild(mainCanvas);

    const pos = getScrollPosition(appRoot);
    expect(pos.mainCanvasTop).toBe(120);

    // Call restoreScrollPosition
    expect(() => restoreScrollPosition(appRoot, pos)).not.toThrow();
  });

  it('switchView parses colon subState, updates hash, and saves to sessionStorage', async () => {
    stubEngine({
      [ACTIONS.CONFIG_GET]: configFixture({}),
      [ACTIONS.STATUS_GET]: statusFixture({}),
      [ACTIONS.DASHBOARD_LIVE_STATS]: { profile: { name: 'Aditya' }, quotas: {} },
    });

    await switchView('settings:integrations');
    await flush(6);

    expect(window.location.hash).toBe('#settings:integrations');
    const saved = getSavedUiState();
    expect(saved.activeView).toBe('settings');
    expect(saved.subState).toBe('integrations');

    const settingsState = getViewUiState('settings');
    expect(settingsState.activeSubTab).toBe('integrations');
  });

  it('settings-view restores activeSettingsTab from ctx.subState and updates in-place on connect/disconnect', async () => {
    let wsConnected = false;
    stubEngine({
      [ACTIONS.CONFIG_GET]: () => configFixture({
        googleWorkspace: { connected: wsConnected, email: wsConnected ? 'user@gmail.com' : '' },
      }),
      [ACTIONS.STATUS_GET]: statusFixture({}),
      [ACTIONS.NETWORK_WITHDRAW_AUTO_STATUS]: { active: false, totalWithdrawnToday: 0 },
      [ACTIONS.GOOGLE_WORKSPACE_CONNECT]: () => {
        wsConnected = true;
        return { ok: true, email: 'user@gmail.com' };
      },
      [ACTIONS.GOOGLE_WORKSPACE_DISCONNECT]: () => {
        wsConnected = false;
        return { ok: true };
      },
    });

    const host = mountPoint();
    let subStateReported = null;
    const ctx = {
      subState: 'integrations',
      getSavedState: () => ({ activeSubTab: 'integrations' }),
      saveState: (s) => {},
      updateSubState: (s) => { subStateReported = s; },
      showToast: () => {},
    };

    await renderSettingsView(host, ctx);
    await flush(6);

    // Verify integrations tab is rendered
    expect(host.querySelector('.settings-menu-item[data-tab="integrations"]').classList.contains('is-active')).toBe(true);
    expect(host.querySelector('#btn-connect-google-ws')).toBeTruthy();

    // Click connect Google Workspace
    const connectBtn = host.querySelector('#btn-connect-google-ws');
    connectBtn.click();
    await flush(6);

    // Re-rendered in-place: Disconnect button now appears without page refresh
    expect(host.querySelector('#btn-disconnect-google-ws')).toBeTruthy();
    expect(host.textContent).toContain('user@gmail.com');
  });

  it('settings-view updates in-place reactively when chrome.storage.onChanged fires', async () => {
    stubEngine({
      [ACTIONS.CONFIG_GET]: () => configFixture({}),
      [ACTIONS.STATUS_GET]: statusFixture({}),
      [ACTIONS.NETWORK_WITHDRAW_AUTO_STATUS]: { active: false, totalWithdrawnToday: 0 },
    });

    const host = mountPoint();
    let cleanupFn = null;
    const ctx = {
      subState: 'integrations',
      getSavedState: () => ({ activeSubTab: 'integrations' }),
      saveState: () => {},
      updateSubState: () => {},
      showToast: () => {},
      registerCleanup: (fn) => { cleanupFn = fn; },
      isActiveView: () => true,
    };

    await renderSettingsView(host, ctx);
    await flush(6);

    // Initially Telegram is not active
    expect(host.textContent).toContain('Setup Telegram Assistant');

    // Simulate background storage change (e.g. Telegram configured in background)
    await chrome.storage.local.set({
      telegram: { enabled: true, botToken: '12345:token', chatId: '999' },
    });

    // Wait for debounced listener (150ms)
    await new Promise((r) => setTimeout(r, 220));
    await flush(6);

    // In-place reactive update verified
    expect(host.textContent).toContain('Manage Telegram Assistant');

    if (cleanupFn) cleanupFn();
  });

  it('campaigns-view preserves active tab and search query on state change', async () => {
    stubEngine({
      [ACTIONS.CAMPAIGN_GET_ALL]: () => ({
        campaigns: [
          {
            campaignId: 'camp_1',
            name: 'Active Outreach',
            status: 'active',
            steps: [{ type: 'invite' }],
          },
          {
            campaignId: 'camp_2',
            name: 'Completed Sequence',
            status: 'completed',
            steps: [{ type: 'invite' }],
          },
        ],
      }),
      [ACTIONS.CONFIG_GET]: () => ({}),
      [ACTIONS.STATUS_GET]: () => ({}),
    });

    await chrome.storage.local.set({
      campaigns: [
        {
          campaignId: 'camp_1',
          name: 'Active Outreach',
          status: 'active',
          steps: [{ type: 'invite' }],
        },
        {
          campaignId: 'camp_2',
          name: 'Completed Sequence',
          status: 'completed',
          steps: [{ type: 'invite' }],
        },
      ],
      'enrollments:camp_2': [
        { publicId: 'p1', status: 'completed', stepIndex: 1 },
      ],
    });

    const host = mountPoint();
    let lastSavedState = null;
    let reportedSub = null;
    const ctx = {
      subState: 'completed',
      getSavedState: () => ({ activeSubTab: 'completed', searchQuery: '' }),
      saveState: (s) => { lastSavedState = s; },
      updateSubState: (s) => { reportedSub = s; },
      showToast: () => {},
      getScrollPosition: () => ({ mainCanvasTop: 50 }),
      restoreScrollPosition: () => {},
    };

    await renderCampaignsView(host, ctx);
    await flush(6);

    // Verify completed tab is active initially
    const completedTab = host.querySelector('.camp-state-tab[data-tab="completed"]');
    expect(completedTab.classList.contains('is-active')).toBe(true);

    // Switch to paused tab
    const pausedTab = host.querySelector('.camp-state-tab[data-tab="paused"]');
    expect(pausedTab).toBeTruthy();
    pausedTab.click();
    await flush(6);

    expect(reportedSub).toBe('paused');
    expect(lastSavedState.activeSubTab).toBe('paused');
  });
});
