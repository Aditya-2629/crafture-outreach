/**
 * OutFox — Authentic OutFox Dashboard Controller
 * Wires sidebar navigation, view mounting, live account status, and toasts.
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { ICONS } from '../ui/icons.js';
import { renderHomeView } from './home-view.js';
import { renderProspectsView } from './prospects-view.js';
import { renderCampaignsView } from './campaigns-view.js';
import { renderQueueView } from './queue-view.js';
import { renderTemplatesView } from './templates-view.js';
import { renderInboxView } from './inbox-view.js';
import { renderResearchView } from './research-view.js';
import { renderSettingsView } from './settings-view.js';

let currentViewId = 'home';
let activeViewCleanup = null;
let currentRenderToken = 0;
let currentViewContext = null;

/**
 * Display a floating modern OutFox toast notification
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

  const icon = type === 'success' ? ICONS.check : type === 'error' ? ICONS.x : type === 'warn' ? ICONS.warning : ICONS.info;
  toast.innerHTML = `<span style="display:inline-flex; align-items:center;">${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

const UI_STATE_KEY = 'outfox_ui_state';

export const NOISY_STORAGE_KEYS = new Set([
  'logs',
  'outfox_debug_logs',
  'debug_logs',
  'outfox_logs',
  'lastTick',
  'outfox_remote_endpoints',
  'outfox_dev_logs_enabled',
  'outfox_logs_cache',
  'terminal_logs',
  'audit_logs',
  'outfox_chat_history',
]);

/**
 * Check if changes from chrome.storage.onChanged contain meaningful user-visible keys
 * and are not purely internal logging/tick noise.
 * @param {object} changes
 * @param {Set|Array|Function} [relevantKeys] Optional whitelist of keys or predicate
 * @returns {boolean}
 */
export function isStorageChangeRelevant(changes, relevantKeys = null) {
  if (!changes || typeof changes !== 'object') return false;
  const changedKeys = Object.keys(changes);
  if (changedKeys.length === 0) return false;

  const meaningful = changedKeys.filter((k) => !NOISY_STORAGE_KEYS.has(k));
  if (meaningful.length === 0) return false;

  if (relevantKeys) {
    if (typeof relevantKeys === 'function') {
      return meaningful.some(relevantKeys);
    }
    const keySet = relevantKeys instanceof Set ? relevantKeys : new Set(relevantKeys);
    return meaningful.some((k) => keySet.has(k));
  }

  return true;
}

/**
 * Capture currently focused input / textarea and cursor position
 */
export function captureInputFocus(container) {
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  if (!active || !container?.contains?.(active)) return null;
  const isInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;
  if (!isInput) return null;
  return {
    id: active.id || null,
    name: active.name || null,
    tagName: active.tagName,
    value: active.value,
    selectionStart: typeof active.selectionStart === 'number' ? active.selectionStart : null,
    selectionEnd: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
  };
}

/**
 * Restore focused input and cursor selection
 */
export function restoreInputFocus(container, focused) {
  if (!focused || !container) return;
  const target = focused.id
    ? container.querySelector(`#${focused.id}`)
    : focused.name
    ? container.querySelector(`[name="${focused.name}"]`)
    : null;
  if (target && typeof target.focus === 'function') {
    try {
      target.focus();
      if (focused.selectionStart != null && focused.selectionEnd != null && typeof target.setSelectionRange === 'function') {
        target.setSelectionRange(focused.selectionStart, focused.selectionEnd);
      }
    } catch {}
  }
}

/**
 * Read global UI state from sessionStorage
 */
export function getSavedUiState() {
  try {
    if (typeof sessionStorage === 'undefined') return {};
    const raw = sessionStorage.getItem(UI_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save partial top-level UI state to sessionStorage
 */
export function saveUiState(partial) {
  try {
    if (typeof sessionStorage === 'undefined') return {};
    const current = getSavedUiState();
    const updated = { ...current, ...partial };
    sessionStorage.setItem(UI_STATE_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return {};
  }
}

/**
 * Read per-view UI state
 */
export function getViewUiState(viewId) {
  const state = getSavedUiState();
  return (state.views && state.views[viewId]) || {};
}

/**
 * Save per-view UI state
 */
export function saveViewUiState(viewId, partial) {
  try {
    if (typeof sessionStorage === 'undefined') return {};
    const current = getSavedUiState();
    const views = current.views || {};
    views[viewId] = { ...(views[viewId] || {}), ...partial };
    current.views = views;
    sessionStorage.setItem(UI_STATE_KEY, JSON.stringify(current));
    return views[viewId];
  } catch {
    return {};
  }
}

/**
 * Safely sync window location hash (e.g. #campaigns:completed) without jarring refresh
 */
export function updateHash(viewId, subState = null) {
  try {
    if (typeof window === 'undefined' || !window.location) return;
    const targetHash = subState ? `${viewId}:${subState}` : viewId;
    if (window.location.hash.replace('#', '') !== targetHash) {
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', `#${targetHash}`);
      } else {
        window.location.hash = targetHash;
      }
    }
  } catch {}
}

/**
 * Capture current scroll positions of the active view and main canvas
 */
export function getScrollPosition(element) {
  const mainCanvas = typeof document !== 'undefined' ? document.querySelector('.main-canvas') : null;
  const innerScroll = element?.querySelector?.(
    '.crm-table-container, .inbox-threads-list, .queue-table-container, .queue-table-scroll, .OutFox-settings-layout, .campaigns-view-shell, .templates-view-shell'
  );
  return {
    windowTop: typeof window !== 'undefined' ? (window.scrollY || document.documentElement?.scrollTop || 0) : 0,
    mainCanvasTop: mainCanvas ? mainCanvas.scrollTop : 0,
    innerTop: innerScroll ? innerScroll.scrollTop : (element ? element.scrollTop : 0),
  };
}

/**
 * Smoothly restore captured scroll positions
 */
export function restoreScrollPosition(element, pos) {
  if (!pos) return;
  const apply = () => {
    if (pos.mainCanvasTop != null) {
      const mainCanvas = typeof document !== 'undefined' ? document.querySelector('.main-canvas') : null;
      if (mainCanvas && typeof mainCanvas.scrollTop === 'number') {
        mainCanvas.scrollTop = pos.mainCanvasTop;
      }
    }
    if (pos.innerTop != null) {
      const innerScroll = element?.querySelector?.(
        '.crm-table-container, .inbox-threads-list, .queue-table-container, .queue-table-scroll, .OutFox-settings-layout, .campaigns-view-shell, .templates-view-shell'
      );
      if (innerScroll && typeof innerScroll.scrollTop === 'number') {
        innerScroll.scrollTop = pos.innerTop;
      } else if (element && typeof element.scrollTop === 'number') {
        element.scrollTop = pos.innerTop;
      }
    }
    if (pos.windowTop != null && typeof window !== 'undefined') {
      try {
        if ((window.scrollY || document.documentElement?.scrollTop) !== pos.windowTop) {
          if (typeof window.scrollTo === 'function') {
            window.scrollTo({ top: pos.windowTop, behavior: 'instant' });
          }
        }
      } catch {}
    }
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(apply);
  } else {
    setTimeout(apply, 0);
  }
}

let userSidebarPinned = null; // 'expanded' | 'collapsed' | null

/**
 * Check if sidebar is currently in collapsed state
 */
export function getSidebarCollapsed() {
  const sidebar = document.querySelector('.sidebar');
  return sidebar ? sidebar.classList.contains('is-collapsed') : false;
}

/**
 * Toggle or set sidebar collapsed state
 * @param {boolean} collapsed
 * @param {boolean} [manual=false] Whether this change was explicitly triggered by user
 */
export function setSidebarCollapsed(collapsed, manual = false) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  if (manual) {
    userSidebarPinned = collapsed ? 'collapsed' : 'expanded';
    try {
      sessionStorage.setItem('outfox_sidebar_pinned', userSidebarPinned);
    } catch (_) {}
  }
  sidebar.classList.toggle('is-collapsed', Boolean(collapsed));
  const toggleBtn = document.getElementById('btn-sidebar-toggle');
  if (toggleBtn) {
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggleBtn.setAttribute('title', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }
}

/**
 * Auto-collapse rules: collapse for dense split views (prospects, inbox) or viewport < 1280px
 * unless user explicitly pinned their preference.
 */
export function updateSidebarStateForView(targetView) {
  if (userSidebarPinned === 'expanded') {
    setSidebarCollapsed(false);
    return;
  }
  if (userSidebarPinned === 'collapsed') {
    setSidebarCollapsed(true);
    return;
  }
  const isDenseView = targetView === 'prospects' || targetView === 'inbox';
  const isNarrowScreen = typeof window !== 'undefined' && window.innerWidth < 1280;
  if (isDenseView || isNarrowScreen) {
    setSidebarCollapsed(true);
  } else {
    setSidebarCollapsed(false);
  }
}

/**
 * Switch active dashboard view
 * @param {'home'|'prospects'|'campaigns'|'queue'|'templates'|'inbox'|'research'|'settings'} viewId
 * @param {object} options Extra props (e.g. openWizard: true, subState: 'completed')
 */
export async function switchView(viewId, options = {}) {
  // Support viewId formatted as "view:subState"
  let targetView = viewId;
  let targetSubState = options.subState || options.tab || null;
  if (typeof viewId === 'string' && viewId.includes(':')) {
    const parts = viewId.split(':');
    targetView = parts[0];
    if (!targetSubState && parts[1]) {
      targetSubState = parts[1];
    }
  }

  const appRoot = document.getElementById('app-root');
  if (!appRoot) return;

  // 0. Increment render token to immediately invalidate any in-flight rendering from prior views
  const token = ++currentRenderToken;

  // View transition trigger
  appRoot.classList.remove('view-enter-active');
  void appRoot.offsetWidth;
  appRoot.classList.add('view-enter-active');

  // 1. Always invoke activeViewCleanup from previous view to destroy intervals and listeners
  if (typeof activeViewCleanup === 'function') {
    try {
      activeViewCleanup();
    } catch (err) {
      console.warn('[Dashboard] activeViewCleanup error:', err);
    }
    activeViewCleanup = null;
  }

  const cleanups = [];
  activeViewCleanup = () => {
    cleanups.forEach((fn) => {
      try { fn(); } catch (err) { console.warn(err); }
    });
    cleanups.length = 0;
  };

  currentViewId = targetView;
  const crumb = document.getElementById('topbar-crumb-title');
  if (crumb) {
    const titles = {
      home: 'Home',
      prospects: 'Prospects',
      campaigns: 'Campaigns',
      queue: 'Queue',
      templates: 'Message Templates',
      inbox: 'Inbox',
      research: 'Research',
      settings: 'Settings',
    };
    crumb.textContent = titles[targetView] || 'Overview';
  }

  // 2. Update navigation items active state (.is-active)
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item');
  navItems.forEach((btn) => {
    const isTarget = btn.dataset.view === targetView || (btn.dataset.view === 'campaigns' && (targetView === 'queue' || targetView === 'templates'));
    btn.classList.toggle('is-active', isTarget);
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  // Subnav active states
  document.querySelectorAll('.sidebar-subnav .subnav-item').forEach((sb) => {
    const isTarget = sb.dataset.view === targetView;
    sb.classList.toggle('is-active', isTarget);
  });
  const campGrp = document.getElementById('nav-group-campaigns');
  if (campGrp) campGrp.classList.toggle('is-open', targetView === 'campaigns' || targetView === 'queue' || targetView === 'templates');

  // Auto-collapse rules: collapse for dense split views (prospects, inbox) or viewport < 1280px
  updateSidebarStateForView(targetView);

  // Restore subState from saved state if not explicitly passed
  const savedState = getViewUiState(targetView);
  if (!targetSubState) {
    targetSubState = savedState.activeSubTab || savedState.activeCategory || savedState.activeTab || null;
  }

  // Keep hash and sessionStorage synced
  updateHash(targetView, targetSubState);
  saveUiState({
    activeView: targetView,
    subState: targetSubState,
  });
  if (targetSubState) {
    saveViewUiState(targetView, { activeSubTab: targetSubState });
  }

  const ctx = {
    switchView,
    showToast,
    token,
    isStale: () => token !== currentRenderToken,
    isActiveView: () => currentViewId === targetView && token === currentRenderToken,
    registerCleanup: (fn) => {
      if (token === currentRenderToken && typeof fn === 'function') {
        cleanups.push(fn);
      }
    },
    isStorageChangeRelevant,
    captureInputFocus: (el) => captureInputFocus(el || appRoot),
    restoreInputFocus: (el, f) => restoreInputFocus(el || appRoot, f),
    isInitialRender: options.isInitialRender !== undefined ? options.isInitialRender : true,
    silent: options.silent || false,
    onLiveUpdate: null,
    getSavedState: () => getViewUiState(targetView),
    saveState: (partial) => {
      const updated = saveViewUiState(targetView, partial);
      const sub = partial.activeSubTab || partial.activeCategory || partial.activeTab;
      if (sub) {
        saveUiState({ activeView: targetView, subState: sub });
        updateHash(targetView, sub);
      }
      return updated;
    },
    updateSubState: (sub) => {
      saveUiState({ activeView: targetView, subState: sub });
      saveViewUiState(targetView, { activeSubTab: sub });
      updateHash(targetView, sub);
    },
    getScrollPosition: (el) => getScrollPosition(el),
    restoreScrollPosition: (el, pos) => restoreScrollPosition(el, pos),
    subState: targetSubState,
    tab: targetSubState,
    ...options,
  };
  currentViewContext = ctx;

  // 3. Render appropriate view
  switch (targetView) {
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
    case 'research':
      await renderResearchView(appRoot, ctx);
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
 * Render or clear the "LinkedIn Not Logged In" banner
 */
function renderLinkedInStatusBanner(connected) {
  const bannerContainer = document.getElementById('dashboard-not-logged-in-banner');
  if (!bannerContainer) return;

  if (connected) {
    bannerContainer.innerHTML = '';
    return;
  }

  // If already rendered, don't duplicate
  if (bannerContainer.querySelector('.outfox-not-logged-in-banner')) return;

  bannerContainer.innerHTML = `
    <div class="outfox-not-logged-in-banner" id="not-logged-in-banner-card">
      <div class="not-logged-in-banner-content">
        <div class="not-logged-in-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div class="not-logged-in-text">
          <strong>LinkedIn Not Connected</strong>
          <p>LinkedIn is not logged in on this browser. Sign in to LinkedIn to sync your profile and run campaigns.</p>
        </div>
      </div>
      <div class="not-logged-in-actions">
        <button type="button" class="btn-open-linkedin-login" id="btn-banner-login">Open LinkedIn Login</button>
        <button type="button" class="btn-check-again-login" id="btn-banner-check">Check Again</button>
      </div>
    </div>
  `;

  bannerContainer.querySelector('#btn-banner-login')?.addEventListener('click', () => {
    window.open('https://www.linkedin.com/login', '_blank');
  });

  bannerContainer.querySelector('#btn-banner-check')?.addEventListener('click', async () => {
    showToast('Checking LinkedIn connection...', 'info');
    const isConn = await syncUserProfile();
    if (isConn) {
      showToast('LinkedIn connected successfully!', 'success');
      if (currentViewId) {
        switchView(currentViewId, currentViewContext?.subState ? { subState: currentViewContext.subState } : {});
      }
    } else {
      showToast('LinkedIn is still not logged in. Please log in first.', 'warn');
    }
  });
}

/**
 * Synchronize actual logged-in user profile with topbar & sidebar UI
 */
export async function syncUserProfile() {
  try {
    const [stats, status] = await Promise.all([
      call(ACTIONS.DASHBOARD_LIVE_STATS || 'dashboard.live_stats', {}).catch(() => ({})),
      call(ACTIONS.STATUS_GET, {}).catch(() => ({})),
    ]);

    const isConnected = stats?.linkedinConnected === true || (stats?.linkedinConnected !== false && Boolean(status?.loggedIn));
    const profile = isConnected ? (stats?.profile || null) : null;

    const accountStatusEl = document.getElementById('sidebar-account-status');
    const topUser = document.getElementById('topbar-user-fullname') || document.querySelector('.user-pill span');
    const miniAv = document.getElementById('topbar-user-avatar') || document.querySelector('.user-avatar-mini');
    const sideAv = document.getElementById('sidebar-user-avatar') || document.querySelector('.profile-avatar');
    const sideName = document.getElementById('sidebar-user-fullname') || document.querySelector('.profile-name');

    if (isConnected && profile) {
      if (accountStatusEl) {
        accountStatusEl.innerHTML = '<span class="status-dot-circle is-active"></span> LinkedIn Online';
        accountStatusEl.style.color = 'var(--success)';
      }

      const name = profile.name || profile.fullName || 'OutFox User';
      const initials = profile.initials || name.split(/[\s-_]+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || 'U';

      const topTitle = document.getElementById('greeting-title');
      if (topTitle) topTitle.textContent = `Hello ${profile.firstName || name.split(/[\s-_]+/)[0] || 'Member'}`;
      if (topUser) topUser.textContent = name;
      if (miniAv) miniAv.textContent = initials;
      if (sideAv) sideAv.textContent = initials;
      if (sideName) sideName.textContent = name;

      renderLinkedInStatusBanner(true);
      return true;
    } else {
      // Disconnected state
      if (accountStatusEl) {
        accountStatusEl.innerHTML = '<span class="status-dot-circle is-offline"></span> LinkedIn Not Logged In';
        accountStatusEl.style.color = 'var(--warning)';
      }
      if (topUser) topUser.textContent = 'Guest';
      if (miniAv) miniAv.textContent = 'G';
      if (sideAv) sideAv.textContent = 'G';
      if (sideName) sideName.textContent = 'Guest';

      renderLinkedInStatusBanner(false);
      return false;
    }
  } catch (err) {
    console.warn('[Dashboard] Profile sync notice:', err);
    return false;
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

  // 1a. Hook Sidebar Pin/Collapse Toggle Button & saved preference
  try {
    const savedPin = sessionStorage.getItem('outfox_sidebar_pinned');
    if (savedPin === 'expanded' || savedPin === 'collapsed') {
      userSidebarPinned = savedPin;
      setSidebarCollapsed(savedPin === 'collapsed', false);
    }
  } catch (_) {}

  document.getElementById('btn-sidebar-toggle')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isCurrentlyCollapsed = getSidebarCollapsed();
    setSidebarCollapsed(!isCurrentlyCollapsed, true);
  });

  // Responsive resize watcher for auto-collapse
  window.addEventListener('resize', () => {
    if (!userSidebarPinned) {
      updateSidebarStateForView(currentViewId);
    }
  });

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
    const subnavBtn = e.target?.closest ? e.target.closest('.subnav-item') : null;
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
      target.classList?.contains?.('btn-crm-guide') ||
      (target.closest ? target.closest('[data-guide="sheet"]') : null);

    if (isGuideBtn) {
      e.preventDefault();
      e.stopPropagation();
      switchView('settings', { tab: 'integrations' });
    }
  });

  // 3. Status sync (LinkedIn connection & user profile)
  await syncUserProfile().catch(() => {});

  // 4. Initial view selection from URL hash or sessionStorage or default to 'home'
  const validViews = ['home', 'prospects', 'campaigns', 'queue', 'templates', 'inbox', 'research', 'settings'];
  const rawHash = (typeof window !== 'undefined' && window.location?.hash ? window.location.hash : '').replace('#', '').trim();
  let startView = 'home';
  let initialSubState = null;

  if (rawHash) {
    const [hView, hSub] = rawHash.split(':');
    if (validViews.includes(hView)) {
      startView = hView;
      initialSubState = hSub || null;
    }
  } else {
    const saved = getSavedUiState();
    if (saved && saved.activeView && validViews.includes(saved.activeView)) {
      startView = saved.activeView;
      initialSubState = saved.subState || null;
    }
  }

  await switchView(startView, initialSubState ? { subState: initialSubState } : {});

  // 5. Handle back/forward navigation
  window.addEventListener('hashchange', () => {
    const currentHash = (window.location.hash || '').replace('#', '').trim();
    const [hView, hSub] = currentHash.split(':');
    if (validViews.includes(hView)) {
      if (hView !== currentViewId || (hSub && hSub !== currentViewContext?.subState)) {
        switchView(hView, hSub ? { subState: hSub } : {});
      }
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

  // 8. Filtered storage listener for global dashboard state (no re-renders, updates in-place)
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    let globalStorageTimer = null;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (!isStorageChangeRelevant(changes, ['outfox_dev_logs_enabled', 'profile', 'status', 'auth'])) return;
      clearTimeout(globalStorageTimer);
      globalStorageTimer = setTimeout(() => {
        if (changes.outfox_dev_logs_enabled) {
          const pill = document.getElementById('outfox-logs-pill');
          if (pill) pill.classList.toggle('hidden', !changes.outfox_dev_logs_enabled.newValue);
        }
        if (changes.profile || changes.status) {
          syncUserProfile();
        }
      }, 400);
    });
  }
}

/**
 * Initialize Centralized Real-Time Terminal Drawer (Non-intrusive floating pill)
 */
function initTerminalDrawer() {
  const pill = document.getElementById('outfox-logs-pill') || document.getElementById('btn-toggle-terminal');
  const modal = document.getElementById('outfox-terminal-modal');
  const stream = document.getElementById('terminal-log-stream');
  const countBadge = document.getElementById('terminal-log-count');
  const closeBtn = document.getElementById('btn-close-terminal');
  const copyBtn = document.getElementById('btn-copy-logs');
  const clearBtn = document.getElementById('btn-clear-logs');

  if (!modal || !stream) return;

  function toggleTerminal() {
    if (pill) pill.classList.remove('hidden');
    const isHidden = modal.classList.toggle('hidden');
    if (!isHidden) stream.scrollTop = stream.scrollHeight;
  }

  function openTerminal() {
    if (pill) pill.classList.remove('hidden');
    modal.classList.remove('hidden');
    stream.scrollTop = stream.scrollHeight;
  }

  // Expose toggle helpers for Settings and developer shortcuts
  if (typeof window !== 'undefined') {
    window.outfoxToggleTerminal = toggleTerminal;
    window.outfoxOpenTerminal = openTerminal;
  }

  // Keyboard shortcut: Ctrl+Shift+L or Alt+L toggles terminal drawer anytime
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) || (e.altKey && (e.key === 'L' || e.key === 'l'))) {
      e.preventDefault();
      toggleTerminal();
    }
  });

  // Check if developer logs pill is explicitly enabled in storage
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get('outfox_dev_logs_enabled', (res) => {
      if (res?.outfox_dev_logs_enabled && pill) {
        pill.classList.remove('hidden');
      }
    });
  }

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
  pill?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTerminal();
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
      const orig = copyBtn.innerHTML;
      copyBtn.innerHTML = `${ICONS.check} Copied!`;
      setTimeout(() => {
        copyBtn.innerHTML = orig;
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
