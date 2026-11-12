/**
 * OutFox — Authentic Waalaxy Dashboard Controller
 * Wires sidebar navigation, view mounting, live account status, and toasts.
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { renderHomeView } from './home-view.js';
import { renderProspectsView } from './prospects-view.js';
import { renderCampaignsView } from './campaigns-view.js';
import { renderQueueView } from './queue-view.js';
import { renderTemplatesView } from './templates-view.js';
import { renderInboxView } from './inbox-view.js';
import { renderSettingsView } from './settings-view.js';

let currentViewId = 'home';

/**
 * Display a floating modern Waalaxy toast notification
 * @param {string} message
 * @param {'success'|'error'|'warn'|'info'} type
 */
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const typeClass = type === 'success' ? 'toast-success' : type === 'error' ? 'toast-error' : '';
  toast.className = `toast ${typeClass}`;
  if (type === 'warn') {
    toast.style.background = 'var(--warning)';
    toast.style.color = '#FFFFFF';
    toast.style.borderColor = 'transparent';
  }

  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warn' ? '⚠' : 'ℹ';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

/**
 * Switch active dashboard view
 * @param {'home'|'prospects'|'campaigns'|'inbox'|'settings'} viewId
 * @param {object} options Extra props (e.g. openWizard: true)
 */
export async function switchView(viewId, options = {}) {
  const appRoot = document.getElementById('app-root');
  if (!appRoot) return;

  currentViewId = viewId;
  const crumb = document.getElementById('topbar-crumb-title');
  if (crumb) {
    const titles = { home: 'Home', prospects: 'Prospects', campaigns: 'Campaigns', queue: 'Queue', templates: 'Message Templates', inbox: 'Inbox', settings: 'Settings' };
    crumb.textContent = titles[viewId] || 'Overview';
  }

  // 1. Update navigation items active state (.is-active)
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  navItems.forEach((btn) => {
    const isTarget = btn.dataset.view === viewId || (btn.dataset.view === 'campaigns' && (viewId === 'queue' || viewId === 'templates'));
    btn.classList.toggle('is-active', isTarget);
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  // Subnav active states
  document.querySelectorAll('.sidebar-subnav .subnav-item').forEach((sb) => {
    const isTarget = sb.dataset.view === viewId;
    sb.classList.toggle('is-active', isTarget);
  });
  const campGrp = document.getElementById('nav-group-campaigns');
  if (campGrp) campGrp.classList.toggle('is-open', viewId === 'campaigns' || viewId === 'queue' || viewId === 'templates');

  // 2. Keep hash synced for browser back/forward and bookmarks
  try {
    if (window.location.hash.replace('#', '') !== viewId) {
      window.location.hash = viewId;
    }
  } catch {}

  const ctx = {
    switchView,
    showToast,
    ...options,
  };

  // 3. Render appropriate view
  switch (viewId) {
    case 'home':
      await renderHomeView(appRoot, ctx);
      break;
    case 'prospects':
      await renderProspectsView(appRoot, ctx);
      break;
    case 'campaigns':
      await renderCampaignsView(appRoot, ctx);
      break;
    case 'queue':
      await renderQueueView(appRoot, ctx);
      break;
    case 'templates':
      await renderTemplatesView(appRoot, ctx);
      break;
    case 'inbox':
      await renderInboxView(appRoot, ctx);
      break;
    case 'settings':
      await renderSettingsView(appRoot, ctx);
      break;
    default:
      await renderHomeView(appRoot, ctx);
      break;
  }
}

/**
 * Synchronize actual logged-in user profile with topbar & sidebar UI
 */
async function syncUserProfile() {
  try {
    const stats = await call(ACTIONS.DASHBOARD_LIVE_STATS || 'dashboard.live_stats', {}).catch(() => ({}));
    const profile = stats?.profile;
    if (profile && profile.name) {
      const name = profile.name;
      const initials = name.split(/[\s-_]+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
      const topTitle = document.getElementById('greeting-title');
      if (topTitle) topTitle.textContent = `Hello ${name.split(/[\s-_]+/)[0] || 'Member'}`;
      const topUser = document.querySelector('.user-pill span');
      if (topUser) topUser.textContent = `${name} ⌵`;
      const miniAv = document.querySelector('.user-avatar-mini');
      if (miniAv) miniAv.textContent = initials || 'LI';
      const sideAv = document.querySelector('.profile-avatar');
      if (sideAv) sideAv.textContent = initials || 'LI';
      const sideName = document.querySelector('.profile-name');
      if (sideName) sideName.textContent = name;
    }
  } catch (err) {
    console.warn('[Dashboard] Profile sync notice:', err);
  }
}

/**
 * Initialize Dashboard
 */
async function initDashboard() {
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  const accountStatusEl = document.getElementById('sidebar-account-status');

  // Sync actual logged-in user profile dynamically
  syncUserProfile();

  // 1. Hook Sidebar Navigation
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetView = btn.dataset.view;
      if (targetView && targetView !== currentViewId) {
        switchView(targetView);
      }
    });
  });

  // 1b. Hook Subnav Navigation (Campaigns List / Queue)
  document.addEventListener('click', (e) => {
    const subnavBtn = e.target.closest('.subnav-item');
    if (subnavBtn) {
      e.preventDefault();
      const targetView = subnavBtn.dataset.view;
      if (targetView) switchView(targetView);
    }
  });

  // 1c. Hook Topbar "Start a campaign" Button
  document.getElementById('btn-topbar-new-campaign')?.addEventListener('click', () => {
    switchView('campaigns', { openWizard: true });
  });

  // 2. Hook Global Sheet CRM Guide clicks
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    const isGuideBtn =
      target.id === 'btn-guide-sheet' ||
      target.classList?.contains('btn-crm-guide') ||
      target.closest?.('[data-guide="sheet"]');

    if (isGuideBtn) {
      e.preventDefault();
      e.stopPropagation();
      switchView('settings', { tab: 'integrations' });
    }
  });

  // 3. Status sync (LinkedIn connection state)
  try {
    const status = await call(ACTIONS.STATUS_GET, {}).catch(() => ({}));
    if (accountStatusEl) {
      if (status.loggedIn) {
        accountStatusEl.innerHTML = '<span class="status-dot-circle is-active"></span> Currently Active';
        accountStatusEl.style.color = 'var(--success)';
      } else {
        accountStatusEl.innerHTML = '<span class="status-dot-circle is-offline"></span> LinkedIn Offline';
        accountStatusEl.style.color = 'var(--warning)';
      }
    }
  } catch (e) {
    console.warn('[Dashboard] status check warning', e);
  }

  // 4. Initial view selection from URL hash or default to 'home'
  const initialHash = window.location.hash.replace('#', '').trim();
  const validViews = ['home', 'prospects', 'campaigns', 'queue', 'templates', 'inbox', 'settings'];
  const startView = validViews.includes(initialHash) ? initialHash : 'home';

  await switchView(startView);

  // 5. Handle back/forward navigation
  window.addEventListener('hashchange', () => {
    const currentHash = window.location.hash.replace('#', '').trim();
    if (validViews.includes(currentHash) && currentHash !== currentViewId) {
      switchView(currentHash);
    }
  });

  // 6. Initialize Real-Time Terminal Drawer
  initTerminalDrawer();

  // 7. Real-Time Zero-Refresh Live Event Listener for outreach actions
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'EVENT' && (msg.event === 'campaign_step_done' || msg.event === 'outreach_sent')) {
        const stepType = msg.payload?.type;
        let countEl = null;
        if (stepType === 'message') {
          countEl = document.getElementById('tab-count-messages');
        } else if (stepType === 'visit') {
          countEl = document.getElementById('tab-count-visits');
        } else if (stepType === 'follow') {
          countEl = document.getElementById('tab-count-follows');
        }
        if (!countEl) {
          countEl = document.getElementById('tab-count-invites');
        }
        if (countEl) {
          const current = parseInt(countEl.textContent, 10) || 0;
          countEl.textContent = current + 1;
        }
      }
    });
  }
}

/**
 * Initialize Centralized Real-Time Terminal Drawer (Non-intrusive floating pill)
 */
function initTerminalDrawer() {
  const pill = document.getElementById('outfox-logs-pill');
  const modal = document.getElementById('outfox-terminal-modal');
  const stream = document.getElementById('terminal-log-stream');
  const countBadge = document.getElementById('terminal-log-count');
  const closeBtn = document.getElementById('btn-close-terminal');
  const copyBtn = document.getElementById('btn-copy-logs');
  const clearBtn = document.getElementById('btn-clear-logs');

  if (!pill || !modal || !stream) return;

  let inMemoryLogs = [];

  function formatLogText(entry) {
    const dataPart = entry.data ? ` | ${entry.data}` : '';
    return `[${entry.timestamp}] [${(entry.level || 'info').toUpperCase()}] [${entry.tag || 'Sys'}] ${entry.message}${dataPart}`;
  }

  function appendLog(entry) {
    inMemoryLogs.push(entry);
    if (inMemoryLogs.length > 200) inMemoryLogs.shift();
    if (countBadge) countBadge.textContent = inMemoryLogs.length;

    const row = document.createElement('div');
    row.className = `term-row term-lvl-${entry.level || 'info'}`;

    const tagColor =
      entry.level === 'error'
        ? '#f87171'
        : entry.level === 'warn'
        ? '#facc15'
        : entry.level === 'good'
        ? '#4ade80'
        : '#38bdf8';

    row.innerHTML = `
      <span class="term-time">[${entry.timestamp}]</span>
      <span class="term-tag" style="color: ${tagColor}; font-weight: 600;">[${entry.tag || 'Sys'}]</span>
      <span class="term-msg">${entry.message || ''}</span>
      ${entry.data ? `<span class="term-data">${entry.data}</span>` : ''}
    `;

    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;
  }

  // Load existing logs from chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get('debug_logs', (res) => {
      const logs = Array.isArray(res?.debug_logs) ? res.debug_logs : [];
      stream.innerHTML = '';
      logs.forEach(appendLog);
      if (logs.length === 0) {
        stream.innerHTML = '<div style="color: #64748b; font-style: italic;">No logs recorded yet. Running engine actions will stream live here.</div>';
      }
    });
  }

  // Listen for real-time messages from background & content script
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'LOG_ENTRY' && msg.entry) {
        if (inMemoryLogs.length === 0) stream.innerHTML = '';
        appendLog(msg.entry);
      }
    });
  }

  // Toggle Modal via Pill
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = modal.classList.toggle('hidden');
    if (!isHidden) stream.scrollTop = stream.scrollHeight;
  });

  // Close via X button
  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    modal.classList.add('hidden');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!modal.classList.contains('hidden')) {
      if (!modal.contains(e.target) && !pill.contains(e.target)) {
        modal.classList.add('hidden');
      }
    }
  });

  // Copy Logs to Clipboard
  copyBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const text = inMemoryLogs.map(formatLogText).join('\n');
    try {
      await navigator.clipboard.writeText(text || 'No logs available.');
      const orig = copyBtn.textContent;
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => {
        copyBtn.textContent = orig;
      }, 1800);
      showToast('Engine logs copied to clipboard!', 'success');
    } catch {
      showToast('Could not copy logs to clipboard', 'warn');
    }
  });

  // Clear Logs
  clearBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    inMemoryLogs = [];
    stream.innerHTML = '<div style="color: #64748b; font-style: italic;">Logs cleared. Waiting for engine activity...</div>';
    if (countBadge) countBadge.textContent = '0';
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ debug_logs: [] });
    }
    showToast('Logs cleared.', 'info');
  });
}

// Start dashboard once DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboard);
  } else {
    initDashboard();
  }
}
