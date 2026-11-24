/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ACTIONS } from '../../src/lib/actions.js';

describe('popup.js controller metrics', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="popup-engine-status"><span class="status-dot"></span> Active</div>
      <div id="popup-radial-fill" style="stroke-dashoffset: 0;"></div>
      <span id="popup-invites-sent">0</span>
      <span id="popup-invites-cap">/ 25 daily</span>
      <span id="popup-acceptance-rate">0%</span>
      <span id="popup-active-campaigns">0</span>
      <span id="popup-crm-status">Ready</span>
      <button id="btn-open-dashboard"></button>
    `;

    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn((keys, cb) => {
            const data = {
              crafture_sheets_crm_meta: { spreadsheetId: 'sheet123', connected: true },
            };
            cb ? cb(data) : Promise.resolve(data);
          }),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      tabs: {
        create: vi.fn(),
      },
      runtime: {
        getURL: vi.fn((path) => `chrome-extension://mock/${path}`),
        sendMessage: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders live metrics matching Dashboard liveStats and quotas', async () => {
    const { refreshPopup } = await import('../../src/popup/popup.js');

    // Mock chrome.runtime.sendMessage to answer actions
    globalThis.chrome.runtime.sendMessage = vi.fn((msg, cb) => {
      const action = msg?.action;
      if (action === ACTIONS.DASHBOARD_LIVE_STATS || action === 'dashboard.live_stats') {
        cb({
          ok: true,
          data: {
            linkedinConnected: true,
            quotas: {
              invite: { usedToday: 14, max: 30, remaining: 16 },
            },
            prospectingStatus: {
              activeCampaignsCount: 3,
            },
            kpis: {
              acceptanceRate: 58,
            },
          },
        });
      } else if (action === ACTIONS.STATUS_GET) {
        cb({
          ok: true,
          data: {
            loggedIn: true,
            quotas: {
              invite: { dailyUsed: 14, dailyCap: 30 },
            },
          },
        });
      } else if (action === ACTIONS.CONFIG_GET) {
        cb({
          ok: true,
          data: {
            dailyInviteCap: 30,
            googleWorkspace: { connected: true },
          },
        });
      } else if (action === ACTIONS.CAMPAIGN_GET_ALL) {
        cb({
          ok: true,
          data: [
            { campaignId: 'c1', status: 'active' },
            { campaignId: 'c2', status: 'running' },
            { campaignId: 'c3', status: 'active' },
            { campaignId: 'c4', status: 'paused' },
          ],
        });
      } else {
        cb({ ok: true, data: {} });
      }
    });

    await refreshPopup();

    expect(document.getElementById('popup-invites-sent').textContent).toBe('14');
    expect(document.getElementById('popup-invites-cap').textContent).toBe('/ 30 daily');
    expect(document.getElementById('popup-acceptance-rate').textContent).toBe('58%');
    expect(document.getElementById('popup-active-campaigns').textContent).toBe('3');
    expect(document.getElementById('popup-crm-status').textContent).toBe('Synced');
    expect(document.getElementById('popup-engine-status').textContent).toContain('Active');
  });

  it('handles disconnected LinkedIn and zero quotas cleanly', async () => {
    const { refreshPopup } = await import('../../src/popup/popup.js');

    globalThis.chrome.runtime.sendMessage = vi.fn((msg, cb) => {
      const action = msg?.action;
      if (action === ACTIONS.DASHBOARD_LIVE_STATS || action === 'dashboard.live_stats') {
        cb({
          ok: true,
          data: {
            linkedinConnected: false,
            quotas: {},
            prospectingStatus: { activeCampaignsCount: 0 },
            kpis: { acceptanceRate: 0 },
          },
        });
      } else if (action === ACTIONS.STATUS_GET) {
        cb({
          ok: true,
          data: {
            loggedIn: false,
            quotas: {},
          },
        });
      } else if (action === ACTIONS.CONFIG_GET) {
        cb({
          ok: true,
          data: {
            dailyInviteCap: 25,
            googleWorkspace: { connected: false },
          },
        });
      } else if (action === ACTIONS.CAMPAIGN_GET_ALL) {
        cb({ ok: true, data: [] });
      } else {
        cb({ ok: true, data: {} });
      }
    });

    globalThis.chrome.storage.local.get = vi.fn((keys, cb) => {
      cb({ crafture_sheets_crm_meta: {} });
    });

    await refreshPopup();

    expect(document.getElementById('popup-invites-sent').textContent).toBe('0');
    expect(document.getElementById('popup-invites-cap').textContent).toBe('/ 25 daily');
    expect(document.getElementById('popup-acceptance-rate').textContent).toBe('0%');
    expect(document.getElementById('popup-active-campaigns').textContent).toBe('0');
    expect(document.getElementById('popup-crm-status').textContent).toBe('Ready');
    expect(document.getElementById('popup-engine-status').textContent).toContain('LinkedIn Not Logged In');
  });
});
