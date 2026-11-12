/**
 * OutFox — Waalaxy Queue & Daily Quotas View
 * Matches 1:1 Screenshots: Queued actions table, filters, bulk delete,
 * live runner status banner with auto-refresh, and live LinkedIn Daily Quotas progress cards.
 * 100% Manifest V3 CSP Compliant · Zero Emojis in Core UI · Pure SVG Icons
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { ICONS } from '../ui/icons.js';
import { openUiConfirm, openLeadTimelineModal } from './modal-engine.js';

let selectedQueueIds = new Set();
let activeCampaignFilter = 'all';
let activeTypeFilters = new Set(['Invitation', 'Message', 'Visit', 'Follow', 'Email']);

let queueTimer = null;
let isRefreshing = false;
let lastRenderedSnapshot = '';

function cleanupTimers() {
  if (queueTimer) {
    clearInterval(queueTimer);
    queueTimer = null;
  }
}

function shouldAbortQueueRender(container, ctx) {
  if (ctx?.isStale?.()) return true;
  if (ctx?.isActiveView && !ctx.isActiveView()) return true;
  if (!container || !container.isConnected || !document.contains(container)) return true;
  const rawHash = (typeof window !== 'undefined' && window.location?.hash)
    ? window.location.hash.replace('#', '').trim()
    : '';
  if (rawHash && rawHash !== 'queue') return true;
  return false;
}

function isUserInteracting(container) {
  if (!container || !container.isConnected) return false;
  const activeEl = document.activeElement;
  if (activeEl && container.contains(activeEl)) {
    const tag = activeEl.tagName ? activeEl.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      return true;
    }
  }
  const openMenu = container.querySelector('#action-type-menu:not(.hidden)');
  if (openMenu) return true;
  return false;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimeRemaining(ms) {
  if (ms <= 0) return 'Due now';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 45) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

const ACTION_DISPLAY_NAMES = {
  'outreach.invite': 'Invite',
  'outreach.view': 'Visit',
  'outreach.message': 'Message',
  'outreach.email': 'Email',
  'outreach.inmail': 'InMail',
  'outreach.follow': 'Follow',
  'outreach.like': 'Like',
  'outreach.comment': 'Comment',
  'outreach.endorse': 'Endorse',
  invite: 'Invite',
  view: 'Visit',
  message: 'Message',
  email: 'Email',
  inmail: 'InMail',
  follow: 'Follow',
};

function formatLastAction(allStorage) {
  const actions = Array.isArray(allStorage?.actions) ? allStorage.actions : [];
  if (actions.length === 0) return 'No actions recorded today';
  const sorted = [...actions].sort((a, b) => (b.at || 0) - (a.at || 0));
  const last = sorted[0];
  if (!last || !last.action) return 'No actions recorded today';

  const rawAction = last.action.replace('outreach.', '');
  const verb = ACTION_DISPLAY_NAMES[last.action] || ACTION_DISPLAY_NAMES[rawAction] || rawAction;
  const verbCap = verb.charAt(0).toUpperCase() + verb.slice(1);
  const target = last.publicId || 'prospect';
  const timeAgo = formatRelativeTime(last.at);
  return `${timeAgo ? timeAgo + ': ' : ''}Sent ${verbCap} to ${target}`;
}

function getEngineState(cooldowns, queuedItems, campaigns, now = Date.now()) {
  const buckets = ['invite', 'view', 'message', 'email'];
  const resting = [];
  for (const b of buckets) {
    const until = cooldowns[b] || (b === 'view' ? cooldowns.visit : 0) || 0;
    if (until > now) {
      resting.push({ bucket: b, until, diffMs: until - now });
    }
  }

  if (resting.length > 0) {
    resting.sort((a, b) => b.diffMs - a.diffMs);
    const top = resting[0];
    const bucketLabel =
      top.bucket === 'invite' ? 'Invites' : top.bucket === 'view' ? 'Visits' : top.bucket === 'message' ? 'Messages' : 'Emails';

    if (top.diffMs > 2 * 3600 * 1000) {
      const resumeTime = new Date(top.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return {
        type: 'quota',
        pillClass: 'pill-quota',
        dotClass: 'red',
        text: `Daily Quota Reached — Resumes tomorrow at ${resumeTime}`,
      };
    } else {
      const minsLeft = Math.max(1, Math.round(top.diffMs / 60000));
      return {
        type: 'cooldown',
        pillClass: 'pill-cooldown',
        dotClass: 'orange',
        text: `Safety Cooldown — ${bucketLabel} resting for ${minsLeft}m to protect account`,
      };
    }
  }

  const hasActiveCampaigns = campaigns.some((c) => c.status === 'active');
  const hasDueSteps = queuedItems.length > 0;

  if (hasActiveCampaigns && hasDueSteps) {
    return {
      type: 'active',
      pillClass: 'pill-active',
      dotClass: 'green',
      text: `Active & Dripping`,
    };
  }

  return {
    type: 'idle',
    pillClass: 'pill-idle',
    dotClass: 'gray',
    text: `Idle — No active campaigns or due steps`,
  };
}

function getNextScheduledRun(queuedItems, alarmScheduledTime, now = Date.now()) {
  const dueNowCount = queuedItems.filter((i) => i.isDueNow).length;
  if (dueNowCount > 0) {
    return `Due now (${dueNowCount} action${dueNowCount > 1 ? 's' : ''} ready)`;
  }

  if (alarmScheduledTime && alarmScheduledTime > now) {
    return `Next check in ${formatTimeRemaining(alarmScheduledTime - now)}`;
  }

  const upcomingItems = queuedItems
    .filter((i) => (i.nextAt || 0) > now)
    .sort((a, b) => a.nextAt - b.nextAt);

  if (upcomingItems.length > 0) {
    return `Next action in ${formatTimeRemaining(upcomingItems[0].nextAt - now)}`;
  }

  return `No actions scheduled`;
}

function renderRowStatusPill(item, now = Date.now()) {
  const e = item.enrollment;
  const cooldownUntil = item.bucketCooldownUntil || 0;
  const isBucketCooling = cooldownUntil > now;

  // 1. Retry state
  if ((e.retryCount || 0) > 0 && e.lastError) {
    const errorText = escapeHtml(e.lastError);
    return `
      <span class="status-pill status-retry" title="${errorText}">
        🔁 Retry ${e.retryCount}/3
      </span>
    `;
  }

  // 2. Cooldown / Quota Full in outfox_bucket_cooldowns
  if (isBucketCooling) {
    const diffMs = cooldownUntil - now;
    if (diffMs > 2 * 3600 * 1000) {
      const resumeTime = new Date(cooldownUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `
        <span class="status-pill status-quota-full" title="Daily quota reached. Resumes tomorrow at ${resumeTime}">
          📅 Quota Full (Tomorrow)
        </span>
      `;
    } else {
      const minsLeft = Math.max(1, Math.round(diffMs / 60000));
      return `
        <span class="status-pill status-cooling" title="Account safety cooldown active (~${minsLeft}m left)">
          🛡️ Cooldown (${minsLeft}m left)
        </span>
      `;
    }
  }

  // 3. Needs Connection
  if (e.status === 'blocked_not_connected' || (e.error && e.error.includes('1st-degree'))) {
    return `
      <span class="status-pill status-needs-conn" title="Must accept connection request before messaging">
        ⚠️ Needs Connection
      </span>
    `;
  }

  // 4. Scheduled in future
  if ((e.nextAt || 0) > now) {
    const timeRemaining = formatTimeRemaining(e.nextAt - now);
    return `
      <span class="status-pill status-scheduled" title="Scheduled for ${new Date(e.nextAt).toLocaleTimeString()}">
        ⏳ Scheduled (in ${timeRemaining})
      </span>
    `;
  }

  // 5. Due Now
  return `
    <span class="status-pill status-due-now" title="Ready to execute on next runner tick">
      ⚡ Due Now
    </span>
  `;
}

function ensureQueueStyles() {
  const STYLE_ID = 'waalaxy-queue-view-css';
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .waalaxy-queue-layout { display: grid; grid-template-columns: 1fr 300px; gap: 24px; max-width: 1200px; margin: 0 auto; }
    .queue-main-panel { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.02); }
    .queue-header-row { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
    .queue-view-title { font-size: 22px; font-weight: 800; color: #14142b; margin: 0; }
    .queue-subtitle-line { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
    .sub-label { font-size: 13px; color: #64748b; }
    .badge-quota-reached { font-size: 11px; font-weight: 700; background: #fef2f2; color: #dc2626; padding: 2px 8px; border-radius: 6px; }
    .badge-quota-active { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; background: #ecfdf5; color: #059669; padding: 2px 8px; border-radius: 6px; }
    .btn-update-activity { background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 20px; padding: 8px 16px; font-size: 12px; font-weight: 700; color: #14142b; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.15s; }
    .btn-update-activity:hover { border-color: #ff6b00; color: #ff6b00; background: #f8fafc; }
    .spin-icon-update { display: flex; align-items: center; justify-content: center; }
    .spin-icon-update.is-spinning { animation: spin 0.8s linear infinite; }

    /* Top Live Runner Status Banner */
    .queue-live-banner {
      background: linear-gradient(135deg, #fff7ed 0%, #ffffff 100%);
      border: 1.5px solid #ffedd5;
      border-radius: 14px;
      padding: 14px 18px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      box-shadow: 0 2px 6px rgba(255, 107, 0, 0.04);
    }
    .banner-left { display: flex; flex-direction: column; gap: 4px; }
    .banner-super-label { font-size: 10px; font-weight: 800; color: #9a3412; letter-spacing: 0.8px; text-transform: uppercase; }
    .live-state-pill { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; padding: 4px 12px; border-radius: 20px; }
    .live-state-pill.pill-active { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .live-state-pill.pill-cooldown { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
    .live-state-pill.pill-quota { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .live-state-pill.pill-idle { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }

    .pulse-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .pulse-dot.green { background: #10b981; box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2); }
    .pulse-dot.orange { background: #f97316; box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.2); }
    .pulse-dot.red { background: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2); }
    .pulse-dot.gray { background: #94a3b8; }
    .pulse-dot.animated { animation: livePulse 2s infinite; }

    @keyframes livePulse {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.15); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.8; }
    }

    .banner-center-metrics { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
    .banner-stat-item { display: flex; flex-direction: column; gap: 2px; }
    .banner-stat-label { font-size: 10px; font-weight: 700; color: #64748b; letter-spacing: 0.5px; text-transform: uppercase; }
    .banner-stat-val { font-size: 12.5px; font-weight: 700; color: #14142b; }
    .banner-stat-val.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #ff6b00; }
    .banner-refresh-indicator { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: #64748b; background: #ffffff; padding: 4px 10px; border-radius: 12px; border: 1px solid #e2e8f0; }

    .queue-channel-tabs { display: flex; gap: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 12px; margin-bottom: 16px; }
    .channel-tab { background: transparent; border: none; font-size: 13.5px; font-weight: 600; color: #64748b; cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; }
    .channel-tab.is-active { background: #fff7ed; color: #ff6b00; font-weight: 700; }
    .tab-count-pill { font-size: 11px; padding: 2px 6px; border-radius: 9999px; background: rgba(255, 107, 0, 0.1); color: #ff6b00; }
    .queue-filters-bar { display: flex; gap: 10px; margin-bottom: 16px; }
    .filter-pill-select { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; color: #14142b; outline: none; cursor: pointer; }
    .filter-pill-btn { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; color: #14142b; cursor: pointer; }
    .action-type-menu { position: absolute; top: 100%; left: 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,0.08); padding: 8px; display: flex; flex-direction: column; gap: 6px; z-index: 20; min-width: 140px; margin-top: 4px; }
    .action-type-menu.hidden { display: none; }
    .action-checkbox-item { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #14142b; cursor: pointer; padding: 4px 6px; }
    .floating-queue-bulk { display: none; align-items: center; justify-content: space-between; background: #14142b; color: #ffffff; padding: 10px 16px; border-radius: 10px; margin-bottom: 14px; }
    .floating-queue-bulk.is-visible { display: flex; }
    .bulk-count-label { font-size: 12px; font-weight: 700; }
    .btn-queue-bulk-delete { background: #ef4444; border: none; color: #ffffff; border-radius: 6px; padding: 6px 12px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .queue-table-container { overflow-x: auto; }
    .queue-table { width: 100%; border-collapse: collapse; }
    .queue-table th { text-align: left; padding: 10px 12px; font-size: 11px; font-weight: 700; color: #64748b; background: #f8fafc; border-bottom: 1px solid #e2e8f0; letter-spacing: 0.5px; }
    .queue-table td { padding: 12px; font-size: 13px; color: #14142b; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
    .queue-action-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #ff6b00; background: #fff7ed; padding: 4px 10px; border-radius: 6px; }
    .q-icon { display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; }
    .prospect-name { font-weight: 600; color: #14142b; }
    .queue-campaign-tag { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 3px 8px; border-radius: 4px; }

    /* Per-row status pills */
    .status-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; }
    .status-pill.status-due-now { background: #fef08a; color: #854d0e; border: 1px solid #fde047; font-weight: 800; }
    .status-pill.status-scheduled { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .status-pill.status-cooling { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
    .status-pill.status-quota-full { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .status-pill.status-retry { background: #fdf4ff; color: #86198f; border: 1px solid #f0abfc; cursor: help; }
    .status-pill.status-needs-conn { background: #fff1ee; color: #ea580c; border: 1px solid #fed7aa; cursor: help; }

    .queue-empty-state { text-align: center; padding: 40px 20px; }
    .empty-icon-wrap { width: 48px; height: 48px; border-radius: 12px; background: #f1f5f9; color: #94a3b8; display: flex; align-items: center; justify-content: center; margin: 0 auto 12px auto; }
    .queue-quotas-panel { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 22px; box-shadow: 0 2px 8px rgba(0,0,0,0.02); height: fit-content; }
    .quotas-head { margin-bottom: 20px; }
    .quotas-title { font-size: 16px; font-weight: 800; color: #14142b; margin: 0 0 4px 0; }
    .quotas-sub { font-size: 12px; color: #64748b; margin: 0; }
    .channel-heading { font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
    .quota-progress-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
    .quota-progress-card.is-warning { border-color: #fca5a5; background: #fff5f5; }
    .quota-card-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .quota-icon-wrap { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .icon-invites { background: #fff7ed; color: #ff6b00; }
    .icon-messages { background: #e0f2fe; color: #0284c7; }
    .icon-visits { background: #fff1ee; color: #ff7a59; }
    .quota-meta { flex: 1; }
    .quota-metric-name { font-size: 10px; font-weight: 800; color: #64748b; letter-spacing: 0.5px; display: block; }
    .quota-metric-val { font-size: 12.5px; color: #14142b; }
    .quota-info-icon { color: #cbd5e1; cursor: pointer; display: flex; align-items: center; }
    .quota-bar-track { height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; margin-bottom: 6px; }
    .quota-bar-fill { height: 100%; border-radius: 3px; }
    .fill-invites { background: #ff6b00; }
    .fill-messages { background: #0284c7; }
    .fill-visits { background: #ff7a59; }
    .quota-count-line { font-size: 11px; color: #64748b; text-align: right; }
    .quota-warning-line { font-size: 11px; color: #dc2626; font-weight: 700; text-align: right; }
  `;
  document.head.appendChild(style);
}

export async function refreshQueueSilently(container, ctx = {}, options = {}) {
  if (shouldAbortQueueRender(container, ctx)) {
    cleanupTimers();
    return;
  }
  if (!options.force && isUserInteracting(container)) {
    return;
  }
  await performQueueFetchAndPaint(container, ctx, { isInitial: false, force: Boolean(options.force) });
}

async function performQueueFetchAndPaint(container, ctx = {}, { isInitial = false, force = false } = {}) {
  if (shouldAbortQueueRender(container, ctx)) {
    cleanupTimers();
    return;
  }
  if (isRefreshing) return;
  isRefreshing = true;

  try {
    if (isInitial) {
      container.innerHTML = `
        <div style="display:flex; justify-content:center; align-items:center; height:320px; color:#6e7191;">
          <div style="width:34px; height:34px; border:3px solid #fff7ed; border-top-color:#ff6b00; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
        </div>
        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
      `;
    }

    const [statusRes, configRes, allStorage, alarmRes] = await Promise.all([
      call(ACTIONS.STATUS_GET, {}).catch(() => ({})),
      call(ACTIONS.CONFIG_GET, {}).catch(() => ({})),
      new Promise((r) => chrome.storage.local.get(null, r)),
      new Promise((r) => {
        try {
          if (typeof chrome !== 'undefined' && chrome.alarms?.get) {
            chrome.alarms.get('outfox-campaign-tick', (a1) => {
              if (a1 && a1.scheduledTime) return r(a1);
              chrome.alarms.get('campaignTick', r);
            });
          } else {
            r(null);
          }
        } catch {
          r(null);
        }
      }),
    ]);

    // Check immediately after await: did user navigate away?
    if (shouldAbortQueueRender(container, ctx)) {
      cleanupTimers();
      return;
    }

    const quotas = statusRes?.quotas || {};
    const inviteQuota = quotas.invite || {};
    const messageQuota = quotas.message || {};
    const visitQuota = quotas.view || quotas.visit || {};
    const emailQuota = quotas.email || {};

    const inviteUsed = inviteQuota.dailyUsed ?? inviteQuota.usedToday ?? 0;
    const inviteDailyCap = inviteQuota.dailyCap ?? inviteQuota.max ?? 25;
    const inviteWeeklyUsed = inviteQuota.weeklyUsed ?? 0;
    const inviteWeeklyCap = inviteQuota.weeklyCap ?? configRes?.weeklyInviteCap ?? 150;

    const messageUsed = messageQuota.dailyUsed ?? messageQuota.usedToday ?? 0;
    const messageDailyCap = messageQuota.dailyCap ?? messageQuota.max ?? 40;

    const visitUsed = visitQuota.dailyUsed ?? visitQuota.usedToday ?? 0;
    const visitDailyCap = visitQuota.dailyCap ?? visitQuota.max ?? 80;

    const emailUsed = emailQuota.dailyUsed ?? emailQuota.usedToday ?? 0;
    const emailDailyCap = emailQuota.dailyCap ?? emailQuota.max ?? (configRes?.dailyEmailCap || 50);

    const invitesLeft = Math.max(0, inviteDailyCap - inviteUsed);
    const weeklyInvitesLeft = Math.max(0, inviteWeeklyCap - inviteWeeklyUsed);
    const messagesLeft = Math.max(0, messageDailyCap - messageUsed);
    const visitsLeft = Math.max(0, visitDailyCap - visitUsed);
    const emailsLeft = Math.max(0, emailDailyCap - emailUsed);

    const isWeeklyInviteQuotaReached = invitesLeft === 0 || weeklyInvitesLeft === 0;
    const campaigns = Array.isArray(allStorage.campaigns) ? allStorage.campaigns : [];
    const cooldowns = allStorage.outfox_bucket_cooldowns || {};
    const now = Date.now();
    const queuedItems = [];

    campaigns.forEach((camp) => {
      const enrollments = allStorage[`enrollments:${camp.campaignId}`] || [];
      enrollments.forEach((e) => {
        const st = e.status || e.state || 'active';
        if (st === 'active' || st === 'running' || st === 'blocked_not_connected') {
          const nextStepIndex = e.stepIndex || 0;
          const currentStep = camp.steps?.[nextStepIndex] || { type: 'invite' };

          let actionType = 'Invitation';
          let actionIcon = ICONS.invitation;
          let bucketKey = 'invite';

          if (currentStep.type === 'message') {
            actionType = 'Message';
            actionIcon = ICONS.message;
            bucketKey = 'message';
          } else if (currentStep.type === 'view') {
            actionType = 'Visit';
            actionIcon = ICONS.visit;
            bucketKey = 'view';
          } else if (currentStep.type === 'follow') {
            actionType = 'Follow';
            actionIcon = ICONS.follow;
            bucketKey = 'view';
          } else if (currentStep.type === 'email') {
            actionType = 'Email';
            actionIcon = ICONS.email;
            bucketKey = 'email';
          } else if (currentStep.type === 'inmail') {
            actionType = 'InMail';
            actionIcon = ICONS.message;
            bucketKey = 'message';
          }

          const bucketCooldownUntil = cooldowns[bucketKey] || (bucketKey === 'view' ? cooldowns.visit : 0) || 0;
          const isBucketCooling = bucketCooldownUntil > now;
          const isDueNow = (e.nextAt || 0) <= now && !isBucketCooling && st === 'active';

          const storedProfile = allStorage[`profile:${e.publicId}`] || allStorage.profileIndex?.[e.publicId];
          const prospectName =
            e.fullName || e.name || storedProfile?.fullName || storedProfile?.name || e.publicId || 'LinkedIn Member';

          queuedItems.push({
            id: `${camp.campaignId}_${e.publicId}`,
            campaignId: camp.campaignId,
            campaignName: camp.name || 'Invitation',
            publicId: e.publicId,
            prospectName,
            actionType,
            actionIcon,
            currentStep,
            enrollment: e,
            nextAt: e.nextAt || 0,
            isDueNow,
            bucketKey,
            bucketCooldownUntil,
          });
        }
      });
    });

    const engineState = getEngineState(cooldowns, queuedItems, campaigns, now);
    const nextRunText = getNextScheduledRun(queuedItems, alarmRes?.scheduledTime, now);
    const lastActionText = formatLastAction(allStorage);

    // Build data snapshot to skip DOM manipulation if nothing changed
    const currentSnapshot = JSON.stringify({
      engineText: engineState.text,
      engineClass: engineState.pillClass,
      nextRunText,
      lastActionText,
      quotas: [
        inviteUsed,
        inviteDailyCap,
        inviteWeeklyUsed,
        messageUsed,
        messageDailyCap,
        visitUsed,
        visitDailyCap,
        emailUsed,
        emailDailyCap,
        isWeeklyInviteQuotaReached,
      ],
      queued: queuedItems.map(
        (q) =>
          `${q.id}:${q.actionType}:${q.isDueNow}:${q.bucketCooldownUntil}:${q.enrollment.status}:${q.enrollment.retryCount}`
      ),
      activeCampaignFilter,
      activeTypeFilters: Array.from(activeTypeFilters).sort(),
      selectedCount: selectedQueueIds.size,
    });

    if (!isInitial && !force && currentSnapshot === lastRenderedSnapshot) {
      return;
    }
    lastRenderedSnapshot = currentSnapshot;

    // Check immediately before DOM paint: did user navigate away?
    if (shouldAbortQueueRender(container, ctx)) {
      cleanupTimers();
      return;
    }

    // Preserve scroll position
    const prevScrollTop = container.scrollTop;
    const prevScrollY = window.scrollY;

    paint({
      container,
      ctx,
      quotas: {
        inviteUsed,
        inviteDailyCap,
        inviteWeeklyUsed,
        inviteWeeklyCap,
        invitesLeft,
        isWeeklyInviteQuotaReached,
        messageUsed,
        messageDailyCap,
        messagesLeft,
        visitUsed,
        visitDailyCap,
        visitsLeft,
        emailUsed,
        emailDailyCap,
        emailsLeft,
      },
      campaigns,
      queuedItems,
      allStorage,
      engineState,
      nextRunText,
      lastActionText,
      now,
    });

    if (container && typeof prevScrollTop === 'number') {
      container.scrollTop = prevScrollTop;
    }
    if (typeof prevScrollY === 'number' && typeof window.scrollTo === 'function') {
      try {
        window.scrollTo(0, prevScrollY);
      } catch {}
    }
  } catch (err) {
    console.error('[QueueView Error]', err);
  } finally {
    isRefreshing = false;
  }
}

function paint(state) {
  const {
    container,
    ctx,
    quotas,
    campaigns,
    queuedItems,
    allStorage,
    engineState,
    nextRunText,
    lastActionText,
    now,
  } = state;

  const filteredQueue = queuedItems.filter((item) => {
    const matchCamp = activeCampaignFilter === 'all' || item.campaignId === activeCampaignFilter;
    const matchType = activeTypeFilters.has(item.actionType);
    return matchCamp && matchType;
  });

  const isAllChecked = filteredQueue.length > 0 && filteredQueue.every((item) => selectedQueueIds.has(item.id));
  const totalSelected = selectedQueueIds.size;

  container.innerHTML = `
    <div class="waalaxy-queue-layout">
      <div class="queue-main-panel">
        <!-- Top Live Runner Status Banner -->
        <div class="queue-live-banner" id="queue-live-banner">
          <div class="banner-left">
            <span class="banner-super-label">Live Runner Status</span>
            <span class="live-state-pill ${engineState.pillClass}">
              <span class="pulse-dot ${engineState.dotClass} ${engineState.type === 'active' ? 'animated' : ''}"></span>
              ${engineState.text}
            </span>
          </div>

          <div class="banner-center-metrics">
            <div class="banner-stat-item">
              <span class="banner-stat-label">Next Scheduled Run</span>
              <span class="banner-stat-val font-mono">${nextRunText}</span>
            </div>
            <div class="banner-stat-item">
              <span class="banner-stat-label">Last Completed Action</span>
              <span class="banner-stat-val">${lastActionText}</span>
            </div>
          </div>

          <div class="banner-refresh-indicator">
            <span class="pulse-dot orange animated"></span>
            Auto-refresh: 5m
          </div>
        </div>

        <div class="queue-header-row">
          <div>
            <h1 class="queue-view-title">Queue</h1>
            <div class="queue-subtitle-line">
              <span class="sub-label">Queued actions</span>
              ${quotas.isWeeklyInviteQuotaReached ? `
                <span class="badge-quota-reached">Quotas reached</span>
              ` : `
                <span class="badge-quota-active"><span class="live-dot-circle"></span> Active Engine</span>
              `}
            </div>
          </div>

          <button type="button" class="btn-update-activity" id="btn-update-activity">
            <span class="spin-icon-update">${ICONS.refresh}</span> Update activity
          </button>
        </div>

        <div class="queue-channel-tabs">
          <button type="button" class="channel-tab is-active" data-channel="linkedin">
            LinkedIn <span class="tab-count-pill">${filteredQueue.length}</span>
          </button>
          <button type="button" class="channel-tab" data-channel="email">
            Email <span class="tab-count-pill">0</span>
          </button>
        </div>

        <div class="queue-filters-bar">
          <div class="dropdown-filter-wrap">
            <select id="select-queue-campaign" class="filter-pill-select">
              <option value="all">My campaigns (All)</option>
              ${campaigns.map((c) => `<option value="${c.campaignId}" ${activeCampaignFilter === c.campaignId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>

          <div class="dropdown-filter-wrap" style="position:relative;">
            <button type="button" class="filter-pill-btn" id="btn-action-type-dropdown">
              Action type ⌵
            </button>
            <div class="action-type-menu hidden" id="action-type-menu">
              ${['Invitation', 'Message', 'Visit', 'Follow', 'Email'].map((t) => `
                <label class="action-checkbox-item">
                  <input type="checkbox" class="chk-action-filter" value="${t}" ${activeTypeFilters.has(t) ? 'checked' : ''} />
                  <span>${t}</span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="floating-queue-bulk ${totalSelected > 0 ? 'is-visible' : ''}">
          <span class="bulk-count-label">${totalSelected} selected</span>
          <button type="button" class="btn-queue-bulk-delete" id="btn-bulk-delete-queue">
            ${ICONS.trash} Delete
          </button>
        </div>

        <div class="queue-table-container">
          <table class="queue-table">
            <thead>
              <tr>
                <th width="40">
                  <input type="checkbox" id="chk-queue-select-all" ${isAllChecked ? 'checked' : ''} />
                </th>
                <th>ACTION</th>
                <th>PROSPECT</th>
                <th>CAMPAIGN</th>
                <th>LIVE STATUS</th>
              </tr>
            </thead>
            <tbody>
              ${filteredQueue.length === 0 ? `
                <tr>
                  <td colspan="5" class="queue-empty-state">
                    <div class="empty-icon-wrap">${ICONS.queue}</div>
                    <p style="text-align:center; color:#64748b; margin:0; font-size:13px;">No actions waiting in queue. Launch a campaign or enroll prospects to queue up actions!</p>
                  </td>
                </tr>
              ` : filteredQueue.map((item) => `
                <tr class="${selectedQueueIds.has(item.id) ? 'row-selected' : ''}">
                  <td>
                    <input type="checkbox" class="chk-queue-row" data-id="${item.id}" ${selectedQueueIds.has(item.id) ? 'checked' : ''} />
                  </td>
                  <td>
                    <div class="queue-action-badge">
                      <span class="q-icon">${item.actionIcon}</span>
                      <span class="q-label">${item.actionType}</span>
                    </div>
                  </td>
                  <td>
                    <div class="queue-prospect-cell">
                      <span class="prospect-name btn-open-timeline" data-public-id="${escapeHtml(item.publicId)}" data-camp-id="${escapeHtml(item.campaignId)}" style="cursor: pointer; color: #1e293b; font-weight: 600; text-decoration: underline decoration-dotted;" title="Click to view outreach timeline">${escapeHtml(item.prospectName)}</span>
                    </div>
                  </td>
                  <td>
                    <span class="queue-campaign-tag">${escapeHtml(item.campaignName)}</span>
                  </td>
                  <td>
                    ${renderRowStatusPill(item, now)}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <aside class="queue-quotas-panel">
        <div class="quotas-head" style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <h2 class="quotas-title">Daily quotas</h2>
            <p class="quotas-sub">These quotas are updated on a daily basis.</p>
          </div>
          <button type="button" id="btn-queue-reset-quota" title="Reset Today's Quotas" style="background: #fff7ed; border: 1px solid #ffedd5; color: #ff6b00; border-radius: 8px; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px;">
            ↻ Reset
          </button>
        </div>

        <div class="quotas-channel-section">
          <div class="channel-heading">LinkedIn</div>

          <div class="quota-progress-card ${quotas.isWeeklyInviteQuotaReached ? 'is-warning' : ''}">
            <div class="quota-card-top">
              <div class="quota-icon-wrap icon-invites">${ICONS.invitation}</div>
              <div class="quota-meta">
                <span class="quota-metric-name">INVITATIONS</span>
                <span class="quota-metric-val"><strong>${quotas.invitesLeft}</strong> left today</span>
              </div>
              <span class="quota-info-icon" title="Weekly and daily safety ceiling enforced by LinkedIn">${ICONS.info}</span>
            </div>
            <div class="quota-bar-track">
              <div class="quota-bar-fill fill-invites" style="width: ${Math.min(100, Math.round(((quotas.inviteUsed) / (quotas.inviteDailyCap || 25)) * 100))}%;"></div>
            </div>
            ${quotas.isWeeklyInviteQuotaReached ? `
              <div class="quota-warning-line">LinkedIn weekly or daily quota reached</div>
            ` : ''}
            <div class="quota-count-line" style="display: flex; justify-content: space-between; margin-top: 4px;">
              <span>Daily: ${quotas.inviteUsed} / ${quotas.inviteDailyCap}</span>
              <span>Weekly: ${quotas.inviteWeeklyUsed} / ${quotas.inviteWeeklyCap}</span>
            </div>
          </div>

          <div class="quota-progress-card">
            <div class="quota-card-top">
              <div class="quota-icon-wrap icon-messages">${ICONS.message}</div>
              <div class="quota-meta">
                <span class="quota-metric-name">MESSAGES</span>
                <span class="quota-metric-val"><strong>${quotas.messagesLeft}</strong> left today</span>
              </div>
              <span class="quota-info-icon" title="Daily message safety cap">${ICONS.info}</span>
            </div>
            <div class="quota-bar-track">
              <div class="quota-bar-fill fill-messages" style="width: ${Math.min(100, Math.round(((quotas.messageUsed) / (quotas.messageDailyCap || 40)) * 100))}%;"></div>
            </div>
            <div class="quota-count-line">${quotas.messageUsed} / ${quotas.messageDailyCap} sent today</div>
          </div>

          <div class="quota-progress-card">
            <div class="quota-card-top">
              <div class="quota-icon-wrap icon-visits">${ICONS.visit}</div>
              <div class="quota-meta">
                <span class="quota-metric-name">PROFILE VISITS</span>
                <span class="quota-metric-val"><strong>${quotas.visitsLeft}</strong> left today</span>
              </div>
              <span class="quota-info-icon" title="Profile visit safety quota">${ICONS.info}</span>
            </div>
            <div class="quota-bar-track">
              <div class="quota-bar-fill fill-visits" style="width: ${Math.min(100, Math.round(((quotas.visitUsed) / (quotas.visitDailyCap || 80)) * 100))}%;"></div>
            </div>
            <div class="quota-count-line">${quotas.visitUsed} / ${quotas.visitDailyCap} visited today</div>
          </div>
        </div>

        <div class="quotas-channel-section" style="margin-top: 18px;">
          <div class="channel-heading">Cold Email (Gmail)</div>

          <div class="quota-progress-card ${quotas.emailsLeft === 0 ? 'is-warning' : ''}">
            <div class="quota-card-top">
              <div class="quota-icon-wrap" style="background:#fff7ed; color:#ff6b00; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">${ICONS.email}</div>
              <div class="quota-meta">
                <span class="quota-metric-name">COLD EMAILS</span>
                <span class="quota-metric-val"><strong>${quotas.emailsLeft}</strong> left today</span>
              </div>
              <span class="quota-info-icon" title="Daily cold email outreach cap">${ICONS.info}</span>
            </div>
            <div class="quota-bar-track">
              <div class="quota-bar-fill" style="background:#ff6b00; width: ${Math.min(100, Math.round(((quotas.emailUsed) / (quotas.emailDailyCap || 50)) * 100))}%;"></div>
            </div>
            <div class="quota-count-line">${quotas.emailUsed} / ${quotas.emailDailyCap} sent today</div>
          </div>
        </div>
      </aside>
    </div>
  `;

  wireQueueEvents(container, filteredQueue, queuedItems, campaigns, allStorage, ctx);
}

function wireQueueEvents(container, filteredQueue, queuedItems, campaigns, allStorage, ctx) {
  const resetQuotaBtn = container.querySelector('#btn-queue-reset-quota');
  if (resetQuotaBtn) {
    resetQuotaBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetQuotaBtn.disabled = true;
      resetQuotaBtn.style.opacity = '0.6';
      resetQuotaBtn.style.cursor = 'not-allowed';

      try {
        await call(ACTIONS.QUOTA_RESET, {});
        ctx.showToast?.('Quotas reset', 'success');
      } catch {
        ctx.showToast?.('Failed to reset quotas', 'error');
      } finally {
        await refreshQueueSilently(container, ctx, { force: true });
        setTimeout(() => {
          if (resetQuotaBtn) {
            resetQuotaBtn.disabled = false;
            resetQuotaBtn.style.opacity = '1';
            resetQuotaBtn.style.cursor = 'pointer';
          }
        }, 600);
      }
    });
  }

  const updateBtn = container.querySelector('#btn-update-activity');
  if (updateBtn) {
    updateBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const icon = updateBtn.querySelector('.spin-icon-update');
      if (icon) icon.classList.add('is-spinning');
      updateBtn.disabled = true;
      updateBtn.style.opacity = '0.6';
      updateBtn.style.cursor = 'not-allowed';

      try {
        await call(ACTIONS.CAMPAIGN_TICK, {});
        ctx.showToast?.('Activity synced', 'success');
      } catch {
        ctx.showToast?.('Activity synced', 'info');
      } finally {
        if (icon) icon.classList.remove('is-spinning');
        await refreshQueueSilently(container, ctx, { force: true });
        setTimeout(() => {
          if (updateBtn) {
            updateBtn.disabled = false;
            updateBtn.style.opacity = '1';
            updateBtn.style.cursor = 'pointer';
          }
        }, 600);
      }
    });
  }

  const typeBtn = container.querySelector('#btn-action-type-dropdown');
  const typeMenu = container.querySelector('#action-type-menu');
  if (typeBtn && typeMenu) {
    typeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      typeMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => typeMenu.classList.add('hidden'));
  }

  container.querySelectorAll('.chk-action-filter').forEach((chk) => {
    chk.addEventListener('change', () => {
      if (chk.checked) activeTypeFilters.add(chk.value);
      else activeTypeFilters.delete(chk.value);
      refreshQueueSilently(container, ctx, { force: true });
    });
  });

  container.querySelectorAll('.btn-open-timeline').forEach((btn) => {
    btn.addEventListener('click', () => {
      const publicId = btn.dataset.publicId;
      const campId = btn.dataset.campId;
      const item = queuedItems.find((q) => q.publicId === publicId && q.campaignId === campId);
      openLeadTimelineModal({
        lead: item
          ? {
              publicId: item.publicId,
              fullName: item.prospectName,
              status: item.enrollment?.status || 'active',
              currentStepLabel: `${item.actionType} (${item.campaignName})`,
              nextRunAt: item.nextAt || 0,
              lastError: item.enrollment?.error || item.enrollment?.lastError || '',
              lastActionAt: item.enrollment?.lastActionAt || 0,
              history: item.enrollment?.history || [],
            }
          : null,
        publicId,
        campaignId: campId,
        campaignName: item?.campaignName,
      });
    });
  });

  const campSelect = container.querySelector('#select-queue-campaign');
  if (campSelect) {
    campSelect.addEventListener('change', (e) => {
      activeCampaignFilter = e.target.value;
      refreshQueueSilently(container, ctx, { force: true });
    });
  }

  const selectAll = container.querySelector('#chk-queue-select-all');
  if (selectAll) {
    selectAll.addEventListener('change', (e) => {
      if (e.target.checked) filteredQueue.forEach((i) => selectedQueueIds.add(i.id));
      else selectedQueueIds.clear();
      refreshQueueSilently(container, ctx, { force: true });
    });
  }

  container.querySelectorAll('.chk-queue-row').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const id = chk.dataset.id;
      if (e.target.checked) selectedQueueIds.add(id);
      else selectedQueueIds.delete(id);
      refreshQueueSilently(container, ctx, { force: true });
    });
  });

  const bulkDeleteBtn = container.querySelector('#btn-bulk-delete-queue');
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', async () => {
      const confirmed = await openUiConfirm({
        title: 'Delete Queued Actions',
        message: `Are you sure you want to remove <strong>${selectedQueueIds.size} action(s)</strong> from the queue? These prospects will not receive this step.`,
        confirmText: 'Delete Actions',
        confirmDanger: true,
      });

      if (confirmed) {
        const updates = {};
        campaigns.forEach((camp) => {
          const enrollKey = `enrollments:${camp.campaignId}`;
          const existing = allStorage[enrollKey] || [];
          const remaining = existing.filter((e) => !selectedQueueIds.has(`${camp.campaignId}_${e.publicId}`));
          if (remaining.length !== existing.length) {
            updates[enrollKey] = remaining;
          }
        });

        if (Object.keys(updates).length > 0) {
          await chrome.storage.local.set(updates);
        }

        ctx.showToast?.(`Removed ${selectedQueueIds.size} actions from queue.`, 'success');
        selectedQueueIds.clear();
        await refreshQueueSilently(container, ctx, { force: true });
      }
    });
  }
}

export async function renderQueueView(container, ctx = {}) {
  if (!container) return;

  // 1. Immediately clear existing timer and listener from prior renders
  cleanupTimers();

  // 2. Register cleanup with dashboard.js view lifecycle
  ctx.registerCleanup?.(() => {
    cleanupTimers();
  });

  // 3. Provide silent live update handler to dashboard.js storage listener
  ctx.onLiveUpdate = () => refreshQueueSilently(container, ctx);

  ensureQueueStyles();
  lastRenderedSnapshot = '';

  await performQueueFetchAndPaint(container, ctx, { isInitial: true, force: true });

  // 4. If user navigated away during initial fetch, stop right here
  if (shouldAbortQueueRender(container, ctx)) {
    cleanupTimers();
    return;
  }

  // 5. Periodic 5-minute background refresh
  queueTimer = setInterval(() => {
    if (shouldAbortQueueRender(container, ctx)) {
      cleanupTimers();
      return;
    }
    refreshQueueSilently(container, ctx);
  }, 5 * 60 * 1000);
}
