/**
 * Crafture Network — Quick Controller Popup Shell
 * 340px controller showing daily progress ring and 1-click dashboard launcher.
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';

// Backward-compatibility stubs for test harness
export const TABS = [];
export function createShell() {
  return {
    start: () => Promise.resolve(),
    activate: () => Promise.resolve(),
    paintHeader: () => Promise.resolve(),
    activeId: 'dashboard',
  };
}

const CIRCUMFERENCE = 2 * Math.PI * 62; // ~389.5px

export async function refreshPopup() {
  try {
    const [liveStats, statusRes, configRes, campaignsRes, storageRes] = await Promise.all([
      call(ACTIONS.DASHBOARD_LIVE_STATS || 'dashboard.live_stats', {}).catch(() => ({})),
      call(ACTIONS.STATUS_GET, {}).catch(() => ({})),
      call(ACTIONS.CONFIG_GET, {}).catch(() => ({})),
      call(ACTIONS.CAMPAIGN_GET_ALL, {}).catch(() => []),
      new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
          chrome.storage.local.get(null, (res) => resolve(res || {}));
        } else {
          resolve({});
        }
      }).catch(() => ({})),
    ]);

    const live = liveStats || {};
    const status = statusRes || {};
    const config = configRes || {};
    const storage = storageRes || {};

    // 1. Quota Progress Circle
    const used = Number(
      live.quotas?.invite?.usedToday ??
      live.quotas?.invite?.used ??
      live.quotas?.invite?.dailyUsed ??
      status.quotas?.invite?.usedToday ??
      status.quotas?.invite?.used ??
      status.quotas?.invite?.dailyUsed ??
      storage.quotas?.invite?.usedToday ??
      storage.quotas?.invite?.dailyUsed ??
      0
    ) || 0;

    const max = Number(
      live.quotas?.invite?.max ??
      live.quotas?.invite?.dailyCap ??
      status.quotas?.invite?.max ??
      status.quotas?.invite?.dailyCap ??
      config.dailyInviteCap ??
      storage.config?.dailyInviteCap ??
      25
    ) || 25;

    const pct = Math.min(100, Math.max(0, Math.round((used / max) * 100)));

    const numEl = document.getElementById('popup-invites-sent');
    const capEl = document.getElementById('popup-invites-cap');
    const fillEl = document.getElementById('popup-radial-fill');

    if (numEl) numEl.textContent = String(used);
    if (capEl) capEl.textContent = `/ ${max} daily`;
    if (fillEl) {
      const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
      fillEl.style.strokeDashoffset = String(offset);
    }

    // 2. Engine & LinkedIn Status
    const statusBadge = document.getElementById('popup-engine-status');
    const isConnected = live.linkedinConnected === true ||
      (live.linkedinConnected !== false && Boolean(status.loggedIn));

    if (statusBadge) {
      if (isConnected) {
        statusBadge.innerHTML = '<span class="status-dot"></span> Active';
        statusBadge.style.color = '#167448';
        statusBadge.style.background = '#E6EFE9';
        statusBadge.style.borderColor = 'rgba(22, 116, 72, 0.2)';
        statusBadge.style.cursor = 'default';
        statusBadge.onclick = null;
        statusBadge.title = '';
      } else {
        statusBadge.innerHTML = '<span class="status-dot is-pending"></span> LinkedIn Not Logged In';
        statusBadge.style.color = '#B45309';
        statusBadge.style.background = '#FEF3C7';
        statusBadge.style.borderColor = 'rgba(180, 83, 9, 0.25)';
        statusBadge.style.cursor = 'pointer';
        statusBadge.title = 'Open LinkedIn Login';
        statusBadge.onclick = () => window.open('https://www.linkedin.com/login', '_blank');
      }
    }

    // 3. Campaigns & Acceptance Rate
    const campCountEl = document.getElementById('popup-active-campaigns');
    const rateEl = document.getElementById('popup-acceptance-rate');

    const campList = Array.isArray(campaignsRes) && campaignsRes.length
      ? campaignsRes
      : (Array.isArray(storage.campaigns) ? storage.campaigns : []);

    const activeCamps = campList.filter((c) => c && (c.status === 'active' || c.status === 'running' || !c.status));
    const activeCampaignsCount = live.prospectingStatus?.activeCampaignsCount ?? activeCamps.length;

    if (campCountEl) campCountEl.textContent = String(activeCampaignsCount);

    let totalInvited = 0;
    let totalAccepted = 0;
    campList.forEach((c) => {
      totalInvited += c.stats?.sent || c.stats?.invited || 0;
      totalAccepted += c.stats?.accepted || 0;
    });

    let acceptanceRate = live.kpis?.acceptanceRate;
    if (acceptanceRate == null || (acceptanceRate === 0 && totalInvited > 0)) {
      acceptanceRate = totalInvited > 0 ? Math.round((totalAccepted / totalInvited) * 100) : 0;
    }
    acceptanceRate = Number(acceptanceRate) || 0;

    if (rateEl) {
      rateEl.textContent = `${acceptanceRate}%`;
    }

    // 4. Google Sheets CRM Status
    const crmEl = document.getElementById('popup-crm-status');
    if (crmEl) {
      const sheetsMeta = storage.crafture_sheets_crm_meta || storage.outfox_sheets_crm_meta || {};
      const gw = config.googleWorkspace || storage.googleWorkspace || {};
      const sheetsConnected = Boolean(
        config.googleWorkspace?.connected ||
        storage.googleWorkspace?.connected ||
        (gw.connected && (sheetsMeta.spreadsheetId || gw.spreadsheetId)) ||
        Boolean(sheetsMeta.connected || sheetsMeta.spreadsheetId)
      );

      if (sheetsConnected) {
        crmEl.textContent = 'Synced';
        crmEl.style.color = '#167448';
      } else {
        crmEl.textContent = 'Ready';
        crmEl.style.color = '#69756E';
      }
    }
  } catch (e) {
    console.warn('[Crafture Popup] status read error', e);
  }
}

let debounceTimer = null;
export function debouncedRefresh() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    refreshPopup();
  }, 250);
}

if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      debouncedRefresh();
    }
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    refreshPopup();

    const openDashBtn = document.getElementById('btn-open-dashboard');
    if (openDashBtn) {
      openDashBtn.addEventListener('click', () => {
        if (typeof chrome !== 'undefined' && chrome.tabs?.create && chrome.runtime?.getURL) {
          chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/dashboard.html') });
        }
      });
    }
  });
}
