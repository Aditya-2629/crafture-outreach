/**
 * Crafture Network — Authentic Crafture Network Home Dashboard View
 * Matches 1:1 Real Crafture Network:
 * - Single Greeting Header with Date Range & Campaigns dropdowns
 * - Hero Blue Banner (in LinkedIn Message responses & Response rate circle)
 * - LinkedIn Accordion with 2 KPI Cards (Accepted invitations, Answered messages)
 * - Actions sent Section with 4 Tabs and 1:1 Pure SVG 30-Day Column Chart
 * - Email Accordion with clean empty state
 * - Right Side: User Profile card & Real Prospecting Status (Active campaigns, Queued actions)
 * - Zero fake hardcoded data, zero credits badge.
 * - Zero Unicode emojis in core UI · 100% Pure vector SVGs
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { ICONS } from '../ui/icons.js';
import { downloadCsv, today } from '../ui/download.js';
import { isStorageChangeRelevant } from './dashboard.js';

function escapeHtml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const HOME_RELEVANT_KEYS = new Set([
  'campaigns',
  'prospects',
  'lists',
  'events',
  'stats',
  'dailyStats',
  'quotas',
  'crafture_quotas',
  'activeCandidate',
  'aiProviders',
  'candidates',
  'hunterApiKey',
  'apolloApiKey',
]);

let selectedDays = '30';
let selectedCampaignId = 'all';

function ensureHomeStyles() {
  const STYLE_ID = 'cn-home-view-css';
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .cn-home-grid { display: grid; grid-template-columns: 1fr 280px; gap: 24px; max-width: 1240px; margin: 0 auto; }
    .home-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; }
    .home-greeting { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0; letter-spacing: -0.02em; }
    .home-filters-row { display: flex; gap: 10px; }
    .filter-pill-wrap { background: #ffffff; border: 1px solid rgba(15, 23, 42, 0.08); border-radius: 8px; padding: 5px 12px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1); }
    .filter-pill-wrap:hover { transform: translateY(-1px); }
    .home-filter-select { border: none; background: transparent; font-size: 12px; font-weight: 600; color: #167448; outline: none; cursor: pointer; font-family: inherit; }

    /* Engine & Quota Strip */
    .engine-quota-strip {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      padding: 14px 20px;
      display: flex;
      align-items: center;
      gap: 18px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    .strip-item { display: flex; flex-direction: column; gap: 4px; }
    .strip-label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em; }
    .strip-value { font-size: 13.5px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 6px; font-variant-numeric: tabular-nums; }
    .strip-ico { display: inline-flex; color: #104B35; }
    .strip-divider { width: 1px; height: 32px; background: rgba(226, 232, 240, 0.7); }
    .strip-quotas-pills { display: flex; gap: 8px; flex-wrap: wrap; }
    .quota-pill { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 3px 8px; font-size: 11.5px; color: #475569; font-weight: 500; font-variant-numeric: tabular-nums; }
    .quota-pill strong { color: #0f172a; font-weight: 700; }
    .badge-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; }
    .badge-status-running { background: #ecfdf5; color: #059669; border: 1px solid rgba(16, 185, 129, 0.2); }
    .badge-status-paused { background: #fef3c7; color: #d97706; border: 1px solid rgba(245, 158, 11, 0.2); }
    .badge-status-resting { background: #eff6ff; color: #2563eb; border: 1px solid rgba(37, 99, 235, 0.2); }
    .badge-note-limit { display: inline-flex; align-items: center; gap: 6px; background: #fffbeb; color: #b45309; border: 1px solid #fde68a; padding: 4px 10px; border-radius: 9999px; font-size: 11.5px; font-weight: 700; }

    /* Funnel Strip */
    .funnel-kpis-strip {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      padding: 16px 20px;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 16px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      margin-bottom: 20px;
    }
    .funnel-tile { text-align: center; display: flex; flex-direction: column; align-items: center; }
    .funnel-tile-ico { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 10px; background: #f8fafc; color: #104B35; margin-bottom: 6px; }
    .funnel-tile-val { font-size: 19px; font-weight: 700; color: #0f172a; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .funnel-tile-pct { font-size: 12px; font-weight: 600; color: #167448; margin-left: 2px; font-variant-numeric: tabular-nums; }
    .funnel-tile-lbl { font-size: 11px; font-weight: 600; color: #64748b; margin-top: 4px; }

    /* Attention & Shortcuts Card */
    .recent-attention-card {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      margin-bottom: 20px;
    }
    .attention-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .attention-title-group { display: flex; align-items: center; gap: 8px; }
    .attention-ico { color: #104B35; display: flex; align-items: center; }
    .attention-title { font-size: 14px; font-weight: 700; color: #0f172a; }
    .attention-actions { display: flex; gap: 10px; }
    .btn-attention-link {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 9999px;
      padding: 6px 14px;
      font-size: 11.5px;
      font-weight: 700;
      color: #0f172a;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 180ms ease, border-color 180ms ease;
    }
    .btn-attention-link:hover { transform: translateY(-1.5px); border-color: #cbd5e1; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); }
    .btn-attention-link:active { transform: translateY(1px) scale(0.985); }
    .attention-threads-list { display: flex; flex-direction: column; gap: 8px; }
    .attention-thread-item { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: #f8fafc; border-radius: 10px; cursor: pointer; transition: background 150ms ease; }
    .attention-thread-item:hover { background: #f1f5f9; }
    .att-avatar { width: 28px; height: 28px; border-radius: 50%; background: #DCE5DE; color: #104B35; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
    .att-meta { flex: 1; min-width: 0; }
    .att-name { font-size: 12.5px; font-weight: 700; color: #0f172a; }
    .att-snippet { font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 380px; }
    .att-badge { font-size: 11px; font-weight: 700; color: #059669; background: #ecfdf5; padding: 2px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; }
    .attention-empty-hint { font-size: 12px; color: #64748b; }

    /* Hero Banner (Crisp White 4-Column KPI Strip) */
    .hero-blue-banner {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      padding: 20px;
      color: #0f172a;
      display: flex;
      flex-direction: column;
      gap: 16px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      margin-bottom: 20px;
    }
    .hero-banner-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .hero-pills-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .hero-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #f8fafc;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 11.5px;
      font-weight: 600;
      color: #475569;
      border: 1px solid #e2e8f0;
    }
    .hero-status-pill.is-warning {
      background: #fffbeb;
      border-color: #fde68a;
      color: #b45309;
    }
    .is-hero-dot {
      background: #10b981 !important;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.4) !important;
    }
    .hero-metrics-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
    }
    .hero-metric-tile {
      background: #f8fafc;
      border: 1px solid rgba(15, 23, 42, 0.06);
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      box-shadow: none;
    }
    .hero-tile-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .hero-tile-num {
      font-size: 24px;
      font-weight: 700;
      line-height: 1.1;
      color: #0f172a;
      font-variant-numeric: tabular-nums;
    }
    .hero-tile-badge {
      font-size: 11px;
      font-weight: 600;
      background: #f1f5f9;
      padding: 2px 7px;
      border-radius: 9999px;
      color: #475569;
      border: 1px solid #e2e8f0;
      white-space: nowrap;
    }
    .hero-tile-lbl {
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
    }

    /* Accordions & KPI Cards */
    .accordion-head-row { display: flex; justify-content: space-between; align-items: center; margin: 20px 0 12px 0; }
    .accordion-title-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .li-badge-box, .email-badge-box { width: 24px; height: 24px; border-radius: 8px; background: #0077b5; color: #fff; display: flex; align-items: center; justify-content: center; }
    .email-badge-box { background: #8b5cf6; }
    .accordion-title-text { font-size: 15px; font-weight: 800; color: #0f172a; }
    .status-pill-gmail-connected { font-size: 11.5px; font-weight: 700; color: #059669; background: #ecfdf5; border: 1px solid rgba(16, 185, 129, 0.25); padding: 3px 10px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px; }
    .status-pill-gmail-disconnected { font-size: 11.5px; font-weight: 700; color: #d97706; background: #fef3c7; border: 1px solid rgba(245, 158, 11, 0.25); padding: 3px 10px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px; }
    .btn-connect-gmail-mini {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 9999px;
      padding: 3px 12px;
      font-size: 11.5px;
      font-weight: 700;
      color: #104B35;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .btn-connect-gmail-mini:hover { transform: translateY(-1px); }

    .linkedin-kpis-pair, .email-kpis-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .email-kpis-grid { grid-template-columns: repeat(3, 1fr); }
    .kpi-card-white {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      padding: 18px 20px;
      display: flex;
      align-items: center;
      position: relative;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .kpi-card-left { display: flex; align-items: center; gap: 14px; flex: 1; }
    .kpi-icon-round { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .round-blue { background: #E6EFE9; color: #104B35; }
    .round-green { background: #ecfdf5; color: #059669; }
    .round-purple { background: #f5f3ff; color: #7c3aed; }
    .kpi-main-number { font-size: 20px; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; }
    .kpi-sub-label { font-size: 11.5px; color: #64748b; margin-top: 2px; font-weight: 500; }
    .kpi-vertical-divider { width: 1px; height: 32px; background: rgba(226, 232, 240, 0.7); margin: 0 16px; }
    .kpi-card-right { text-align: right; }
    .kpi-rate-number { font-size: 16px; font-weight: 700; color: #167448; font-variant-numeric: tabular-nums; }
    .kpi-info-icon { position: absolute; top: 12px; right: 12px; color: #cbd5e1; cursor: pointer; display: flex; align-items: center; }
    .kpi-info-icon:hover { color: #104B35; }

    /* Actions Sent & Chart */
    .actions-sent-card {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      margin-bottom: 20px;
    }
    .actions-sent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .actions-sent-title { font-size: 15px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 6px; }
    .actions-type-tabs { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .action-type-pill {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 8px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 180ms ease, border-color 180ms ease;
    }
    .action-type-pill:hover { transform: translateY(-1.5px); }
    .action-type-pill:active { transform: translateY(1px) scale(0.985); }
    .action-type-pill.is-active { background: #ffffff; border-color: #104B35; box-shadow: 0 2px 8px rgba(16, 75, 53, 0.12); }
    .pill-ico { display: flex; align-items: center; justify-content: center; }
    .ico-blue { color: #104B35; }
    .ico-cyan { color: #00c2ff; }
    .ico-coral { color: #ff7675; }
    .ico-purple { color: #7c71f8; }
    .pill-num { font-size: 13px; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; }
    .pill-name { font-size: 12px; color: #64748b; font-weight: 500; }
    .chart-legend-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; font-weight: 700; color: #0f172a; }
    .btn-download-chart-csv { background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 4px; display: flex; align-items: center; transition: color 150ms ease; }
    .btn-download-chart-csv:hover { color: #104B35; }
    .chart-tooltip { position: absolute; background: #0f172a; color: #ffffff; padding: 6px 10px; border-radius: 8px; font-size: 11px; font-weight: 600; pointer-events: none; z-index: 10; white-space: nowrap; box-shadow: 0 8px 20px rgba(0,0,0,0.2); transition: opacity 150ms ease, transform 150ms ease; }
    .chart-tooltip.hidden { display: none; }

    /* Email Strategy Box */
    .emails-sent-empty-box {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      margin-top: 14px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .empty-cat-icon { width: 44px; height: 44px; border-radius: 12px; background: #E6EFE9; color: #104B35; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px auto; }
    .empty-email-title { font-size: 14px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0; }
    .empty-email-sub { font-size: 12px; color: #64748b; margin: 0 0 16px 0; }
    .btn-email-strategy {
      background: #167448;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 8px 18px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
      transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 180ms ease, background 180ms ease;
    }
    .btn-email-strategy:hover { transform: translateY(-1px); background: #c2410c; }
    .btn-email-strategy:active { transform: translateY(1px) scale(0.985); }

    /* Side Column */
    .home-side-col { display: flex; flex-direction: column; gap: 20px; }
    .side-card {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .avatar-center-wrapper { display: flex; flex-direction: column; align-items: center; text-align: center; }
    .cn-alien-avatar { width: 56px; height: 56px; border-radius: 50%; background: #0f172a; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; position: relative; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12); }
    .li-corner-badge { position: absolute; bottom: -2px; right: -2px; width: 18px; height: 18px; border-radius: 50%; background: #0077b5; color: #fff; display: flex; align-items: center; justify-content: center; }
    .profile-username { font-size: 15px; font-weight: 700; color: #0f172a; margin: 0; text-transform: capitalize; }
    .status-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .status-title { font-size: 13.5px; font-weight: 700; color: #0f172a; }
    .status-kpis-pair { display: flex; flex-direction: column; gap: 12px; }
    .status-metric-box { display: flex; align-items: center; gap: 12px; background: #f8fafc; border: 1px solid rgba(15, 23, 42, 0.06); border-radius: 10px; padding: 12px 14px; }
    .status-icon-circle { width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
    .status-metric-val { font-size: 16px; font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; }
    .status-metric-lbl { font-size: 11px; color: #64748b; font-weight: 500; }
  `;
  document.head.appendChild(style);
}

export async function renderHomeView(container, ctx = {}) {
  if (!container) return;
  ensureHomeStyles();

  const hasExistingGrid = Boolean(container.querySelector('.cn-home-grid'));
  const isInitial = !hasExistingGrid && !ctx.silent && ctx.isInitialRender !== false;

  if (isInitial) {
    container.innerHTML = `
      <div style="display:flex; justify-content:center; align-items:center; height:320px; color:#6e7191;">
        <div style="width:34px; height:34px; border:3px solid #E6EFE9; border-top-color:#104B35; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      </div>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
  }

  // 4-second timeout guard to prevent infinite spinner if network/stats call hangs
  const [statsRes, storageRes] = await Promise.all([
    Promise.race([
      call(ACTIONS.DASHBOARD_LIVE_STATS || 'dashboard.live_stats', {}).catch(() => ({})),
      new Promise((resolve) => setTimeout(() => resolve({}), 4000)),
    ]),
    Promise.race([
      new Promise((r) => chrome.storage.local.get(null, r)),
      new Promise((resolve) => setTimeout(() => resolve({}), 4000)),
    ]),
  ]);

  // If user navigated away during load, abort cleanly
  if (ctx?.isStale?.() || (ctx?.isActiveView && !ctx.isActiveView())) return;
  if (!container || !container.isConnected) return;

  const stats = statsRes || {};
  let storage = storageRes || {};

  const profile = stats.profile || null;
  const quotas = stats.quotas || {};
  const isQuotaReached = (quotas.invite?.remaining === 0) || (quotas.invite?.usedToday >= (quotas.invite?.max || 25));

  const isConnected = stats.linkedinConnected !== false && Boolean(profile && (profile.name || profile.firstName));
  const rawName = (profile?.firstName || profile?.name || '').trim();
  const firstName = rawName.split(/[\s-_]+/)[0] || '';
  const cleanGreeting = isConnected && firstName && firstName.toLowerCase() !== 'there' && firstName.toLowerCase() !== 'crafture' && firstName.toLowerCase() !== 'user'
    ? (firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase())
    : '';
  const greetingText = isConnected && cleanGreeting ? `Hello, ${cleanGreeting}` : 'Welcome';
  const profileName = isConnected && (profile?.name || rawName) ? (profile.name || rawName) : 'Not Connected';
  const avatarTxt = isConnected
    ? (profile?.initials || rawName.split(/[\s-_]+/).map((n) => n[0]).slice(0, 2).join('').toUpperCase() || 'U')
    : '?';
  const avatarUrl = isConnected && profile?.avatarUrl ? String(profile.avatarUrl).trim() : '';

  const savedHomeState = ctx?.getSavedState?.() || {};
  if (savedHomeState.selectedDays) selectedDays = savedHomeState.selectedDays;
  if (savedHomeState.selectedCampaignId) selectedCampaignId = savedHomeState.selectedCampaignId;
  let activeChartAction = savedHomeState.activeChartAction || 'invitations';

  function paint() {
    const scrollPos = ctx?.getScrollPosition?.(container);
    const campaigns = Array.isArray(storage.campaigns) ? storage.campaigns : [];

    // Ensure selectedCampaignId is valid
    if (selectedCampaignId !== 'all' && !campaigns.some((c) => (c.campaignId || c.id) === selectedCampaignId)) {
      selectedCampaignId = 'all';
    }

    const { kpis, timeline } = computeFilteredHomeStats(storage, {
      days: selectedDays,
      campaignId: selectedCampaignId,
      fallbackStats: stats,
    });

    const activeCampaignsCount = selectedCampaignId === 'all'
      ? campaigns.filter((c) => c.status === 'running' || c.status === 'active' || !c.status).length
      : (() => {
          const c = campaigns.find((x) => (x.campaignId || x.id) === selectedCampaignId);
          return (c?.status === 'running' || c?.status === 'active' || !c?.status) ? 1 : 0;
        })();

    let queuedActionsCount = 0;
    if (selectedCampaignId === 'all') {
      campaigns.forEach((camp) => {
        const enrollments = storage[`enrollments:${camp.campaignId || camp.id}`] || [];
        queuedActionsCount += enrollments.filter((e) => e.state === 'active' || e.state === 'running' || e.status === 'active' || !e.status).length;
      });
    } else {
      const enrollments = storage[`enrollments:${selectedCampaignId}`] || [];
      queuedActionsCount = enrollments.filter((e) => e.state === 'active' || e.state === 'running' || e.status === 'active' || !e.status).length;
    }

    // 24h Note limit status
    const noteLimitUntil = Number(storage.crafture_note_limit_until || storage.outfox_note_limit_until) || 0;
    const isNoteLimitActive = Date.now() < noteLimitUntil;
    let noteLimitRemaining = '';
    if (isNoteLimitActive) {
      const diffMs = Math.max(0, noteLimitUntil - Date.now());
      const h = Math.floor(diffMs / 3600000);
      const m = Math.floor((diffMs % 3600000) / 60000);
      noteLimitRemaining = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    // Runner status & nextActionAt
    let soonestNextAt = 0;
    campaigns.forEach((camp) => {
      const enrollments = storage[`enrollments:${camp.campaignId || camp.id}`] || [];
      enrollments.forEach((e) => {
        if ((e.status === 'active' || e.state === 'active') && e.nextAt && e.nextAt > Date.now()) {
          if (!soonestNextAt || e.nextAt < soonestNextAt) soonestNextAt = e.nextAt;
        }
      });
    });

    let nextActionCountdown = 'Ready';
    if (soonestNextAt > Date.now()) {
      const diffSec = Math.round((soonestNextAt - Date.now()) / 1000);
      if (diffSec < 60) {
        nextActionCountdown = `in ${diffSec}s`;
      } else {
        const m = Math.floor(diffSec / 60);
        const s = diffSec % 60;
        nextActionCountdown = `in ${m}m ${s}s`;
      }
    }

    let runnerStatusText = 'Running';
    let runnerStatusClass = 'badge-status-running';
    if (activeCampaignsCount === 0) {
      runnerStatusText = 'Paused';
      runnerStatusClass = 'badge-status-paused';
    } else if (isQuotaReached) {
      runnerStatusText = 'Quota Resting';
      runnerStatusClass = 'badge-status-resting';
    }

    // Today's Remaining Quotas
    const remainingInvites = quotas.invite?.remaining ?? (quotas.invite?.max ? Math.max(0, quotas.invite.max - (quotas.invite.usedToday || 0)) : 25);
    const remainingMessages = quotas.message?.remaining ?? (quotas.message?.max ? Math.max(0, quotas.message.max - (quotas.message.usedToday || 0)) : 50);
    const remainingVisits = quotas.visit?.remaining ?? (quotas.visit?.max ? Math.max(0, quotas.visit.max - (quotas.visit.usedToday || 0)) : 80);
    const remainingEmails = quotas.email?.remaining ?? (storage.config?.dailyEmailCap || 100);

    // Gmail status and counts
    const isGmailConnected = Boolean(storage.config?.mailbox?.connected || storage.config?.googleWorkspace?.connected || storage.crafture_google_workspace_token || storage.outfox_google_workspace_token || storage.crafture_outreach_gmail_token || storage.outfox_outreach_gmail_token);
    const gmailEmail = storage.config?.mailbox?.email || storage.config?.googleWorkspace?.email || storage.crafture_google_workspace_token || storage.outfox_google_workspace_token?.email || '';

    let queuedEmailsCount = 0;
    campaigns.forEach((camp) => {
      const enrollments = storage[`enrollments:${camp.campaignId || camp.id}`] || [];
      enrollments.forEach((e) => {
        if (e.status === 'active' || e.state === 'active') {
          const steps = camp.steps || [];
          const nextStep = steps[e.stepIndex];
          if (nextStep && (nextStep.type === 'email' || nextStep.type === 'outreach.email')) {
            queuedEmailsCount++;
          }
        }
      });
    });
    const emailRepliesCount = kpis.emailReplies || 0;

    // Attention / Threads
    const threads = Array.isArray(storage.threads) ? storage.threads : [];
    const recentReplies = threads
      .filter((t) => t.unread || (t.messages && t.messages.some((m) => !m.fromMe)))
      .slice(0, 3);
    const pendingQueueCount = stats.queue?.pending ?? 0;

    // Account network metrics: read cached networkStats from storage immediately
    const cachedNet = storage.networkStats || null;
    const connectionsDisplay = isConnected
      ? (cachedNet?.connections != null
          ? Number(cachedNet.connections).toLocaleString()
          : (profile?.connections != null
              ? Number(profile.connections).toLocaleString()
              : '—'))
      : '—';
    const pendingDisplay = isConnected
      ? (cachedNet?.pending != null
          ? Number(cachedNet.pending).toLocaleString()
          : (profile?.pending != null
              ? Number(profile.pending).toLocaleString()
              : '—'))
      : '—';

    container.innerHTML = `
      <div class="cn-home-grid">
        <div class="home-main-col">
          <div class="home-header-row">
            <h1 class="home-greeting">${greetingText}</h1>
            <div class="home-filters-row">
              <div class="filter-pill-wrap">
                <select class="home-filter-select" id="home-filter-range">
                  <option value="1" ${selectedDays === '1' ? 'selected' : ''}>Today</option>
                  <option value="7" ${selectedDays === '7' ? 'selected' : ''}>Last 7 days</option>
                  <option value="30" ${selectedDays === '30' ? 'selected' : ''}>Last 30 days</option>
                  <option value="all" ${selectedDays === 'all' ? 'selected' : ''}>All time</option>
                </select>
              </div>
              <div class="filter-pill-wrap">
                <select class="home-filter-select" id="home-filter-campaign">
                  <option value="all" ${selectedCampaignId === 'all' ? 'selected' : ''}>All campaigns</option>
                  ${campaigns.map((c) => `<option value="${c.campaignId || c.id}" ${selectedCampaignId === (c.campaignId || c.id) ? 'selected' : ''}>${c.name || c.campaignId}</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <!-- Vibrant Crafture Clay Hero Banner -->
          <div class="hero-blue-banner">
            <div class="hero-banner-top">
              <div class="hero-pills-row">
                <span class="hero-status-pill">
                  <span class="live-dot-circle is-hero-dot"></span> Runner ${runnerStatusText}
                </span>
                <span class="hero-status-pill">
                  ${ICONS.clock} Next Action: ${nextActionCountdown}
                </span>
                <span class="hero-status-pill" title="Today's remaining: ${remainingMessages} msgs, ${remainingVisits} visits, ${remainingEmails} emails">
                  ${ICONS.lightning} ${remainingInvites} invites left
                </span>
                ${isNoteLimitActive ? `
                  <span class="hero-status-pill is-warning" title="Personalized note ceiling reached; blank invites running">
                    ${ICONS.warning} Note Limit (${noteLimitRemaining})
                  </span>
                ` : ''}
              </div>
            </div>

            <div class="hero-metrics-grid">
              <div class="hero-metric-tile">
                <div class="hero-tile-top">
                  <span class="hero-tile-num">${kpis.messageResponses || 0}</span>
                  <span class="hero-tile-badge">${kpis.responseRate || 0}% rate</span>
                </div>
                <span class="hero-tile-lbl">Message Responses</span>
              </div>

              <div class="hero-metric-tile">
                <div class="hero-tile-top">
                  <span class="hero-tile-num">${kpis.acceptedInvites || 0}</span>
                  <span class="hero-tile-badge">${kpis.acceptanceRate || 0}% rate</span>
                </div>
                <span class="hero-tile-lbl">Accepted Invitations</span>
              </div>

              <div class="hero-metric-tile">
                <div class="hero-tile-top">
                  <span class="hero-tile-num">${kpis.totalInvitesSent || 0}</span>
                  <span class="hero-tile-badge">Sent</span>
                </div>
                <span class="hero-tile-lbl">Invitations Sent</span>
              </div>

              <div class="hero-metric-tile">
                <div class="hero-tile-top">
                  <span class="hero-tile-num">${kpis.totalMessagesSent || 0}</span>
                  <span class="hero-tile-badge">Sent</span>
                </div>
                <span class="hero-tile-lbl">Messages Sent</span>
              </div>
            </div>
          </div>

          <!-- Recent Attention & Quick Shortcuts -->
          <div class="recent-attention-card">
            <div class="attention-head">
              <div class="attention-title-group">
                <span class="attention-ico">${ICONS.inbox}</span>
                <span class="attention-title">Recent Activity & Actionable Shortcuts</span>
              </div>
              <div class="attention-actions">
                <button type="button" class="btn-attention-link" id="btn-home-go-inbox">${ICONS.message} Open Inbox</button>
                <button type="button" class="btn-attention-link" id="btn-home-go-queue">${ICONS.queue} Review Queue (${pendingQueueCount})</button>
              </div>
            </div>
            <div class="attention-body">
              ${recentReplies.length > 0 ? `
                <div class="attention-threads-list">
                  ${recentReplies.map((t) => `
                    <div class="attention-thread-item" data-thread-id="${t.threadId || t.id}">
                      <div class="att-avatar">${(t.participants?.[0]?.name || 'P')[0].toUpperCase()}</div>
                      <div class="att-meta">
                        <div class="att-name">${t.participants?.[0]?.name || 'Prospect'}</div>
                        <div class="att-snippet">${t.snippet || (t.messages && t.messages[t.messages.length - 1]?.text) || 'Replied to campaign'}</div>
                      </div>
                      <span class="att-badge">${ICONS.reply} Replied</span>
                    </div>
                  `).join('')}
                </div>
              ` : `
                <div class="attention-empty-hint">
                  All active conversations are up to date. Approval queue has <strong>${pendingQueueCount}</strong> pending items awaiting dispatch.
                </div>
              `}
            </div>
          </div>

          <div class="actions-sent-card">
            <div class="actions-sent-header">
              <span class="actions-sent-title">Actions sent <span class="info-pill-mini" title="Daily outreach actions sent">${ICONS.info}</span></span>
            </div>

            <div class="actions-type-tabs">
              <button type="button" class="action-type-pill ${activeChartAction === 'invitations' ? 'is-active' : ''}" data-action="invitations">
                <span class="pill-ico ico-blue">${ICONS.invitation}</span>
                <span class="pill-num">${kpis.totalInvitesSent || 0}</span>
                <span class="pill-name">Invitations</span>
              </button>
              <button type="button" class="action-type-pill ${activeChartAction === 'messages' ? 'is-active' : ''}" data-action="messages">
                <span class="pill-ico ico-cyan">${ICONS.message}</span>
                <span class="pill-num">${kpis.totalMessagesSent || 0}</span>
                <span class="pill-name">Messages</span>
              </button>
              <button type="button" class="action-type-pill ${activeChartAction === 'visits' ? 'is-active' : ''}" data-action="visits">
                <span class="pill-ico ico-coral">${ICONS.visit}</span>
                <span class="pill-num">${kpis.totalVisits || 0}</span>
                <span class="pill-name">Visits</span>
              </button>
              <button type="button" class="action-type-pill ${activeChartAction === 'follows' ? 'is-active' : ''}" data-action="follows">
                <span class="pill-ico ico-purple">${ICONS.follow}</span>
                <span class="pill-num">${kpis.totalFollows || 0}</span>
                <span class="pill-name">Follows</span>
              </button>
            </div>

            <div class="chart-legend-row">
              <span class="chart-active-label">${activeChartAction.charAt(0).toUpperCase() + activeChartAction.slice(1)}</span>
              <button type="button" class="btn-download-chart-csv" id="btn-export-timeline" title="Export CSV">
                ${ICONS.download}
              </button>
            </div>

            <div class="timeline-svg-container">
              ${renderSvg30DayChart(timeline, activeChartAction)}
            </div>
          </div>

          <!-- Real-Only Email Channel Card -->
          <div class="accordion-head-row" style="margin-top:28px;">
            <div class="accordion-title-group">
              <span class="email-badge-box">${ICONS.email}</span>
              <span class="accordion-title-text">Email Channel</span>
              ${isGmailConnected ? `
                <span class="status-pill-gmail-connected">${ICONS.check} Connected (${gmailEmail})</span>
              ` : `
                <span class="status-pill-gmail-disconnected">${ICONS.warning} Not Connected</span>
                <button type="button" class="btn-connect-gmail-mini" id="btn-connect-gmail-home">${ICONS.google} Connect Gmail</button>
              `}
            </div>
          </div>

          <div class="email-kpis-grid">
            <div class="kpi-card-white">
              <div class="kpi-card-left">
                <div class="kpi-icon-round round-blue">${ICONS.email}</div>
                <div><div class="kpi-main-number">${kpis.totalEmailsSent || 0}</div><div class="kpi-sub-label">Emails Sent</div></div>
              </div>
            </div>
            <div class="kpi-card-white">
              <div class="kpi-card-left">
                <div class="kpi-icon-round round-purple">${ICONS.queue}</div>
                <div><div class="kpi-main-number">${queuedEmailsCount}</div><div class="kpi-sub-label">Queued</div></div>
              </div>
            </div>
            <div class="kpi-card-white">
              <div class="kpi-card-left">
                <div class="kpi-icon-round round-green">${ICONS.message}</div>
                <div><div class="kpi-main-number">${emailRepliesCount}</div><div class="kpi-sub-label">Replies</div></div>
              </div>
            </div>
          </div>

          ${!isGmailConnected ? `
            <div class="emails-sent-empty-box">
              <div class="empty-cat-icon">${ICONS.email}</div>
              <h4 class="empty-email-title">Connect your Gmail or Google Workspace Account</h4>
              <p class="empty-email-sub">Power automated cold email sequences and multichannel LinkedIn outreach with permanent token refresh.</p>
              <button type="button" class="btn-email-strategy" id="btn-connect-gmail-strategy">
                ${ICONS.google} Connect Gmail Account
              </button>
            </div>
          ` : `
            <div class="emails-sent-empty-box">
              <div class="empty-cat-icon" style="background:#ecfdf5; color:#059669;">${ICONS.check}</div>
              <h4 class="empty-email-title">Gmail Outreach Mailbox Active</h4>
              <p class="empty-email-sub">Connected as <strong>${gmailEmail}</strong>. Multi-channel sequences will dispatch cold emails automatically.</p>
              <button type="button" class="btn-email-strategy" id="btn-start-email-strategy">
                Create Outreach Campaign →
              </button>
            </div>
          `}
        </div>

        <aside class="home-side-col">
          <div class="side-card profile-card-cn">
            <div class="avatar-center-wrapper">
              <div class="cn-alien-avatar" id="home-profile-avatar-wrap">
                ${avatarUrl ? `
                  <img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(profileName)}" referrerpolicy="no-referrer" class="avatar-img-photo object-cover rounded-full" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />
                ` : ''}
                <span class="avatar-initials-txt">${avatarTxt}</span>
                <span class="li-corner-badge">${ICONS.linkedin}</span>
              </div>
              <h3 class="profile-username">${profileName}</h3>
              <div style="display:flex; justify-content:center; gap:16px; margin-top:14px; border-top:1px solid rgba(226, 232, 240, 0.7); padding-top:14px; width:100%;">
                <div style="text-align:center;">
                  <div id="profile-connections-val" style="font-size:16px; font-weight:800; color:#0f172a;">${connectionsDisplay}</div>
                  <div style="font-size:11px; color:#64748b; font-weight:600; margin-top:2px;">Connections</div>
                </div>
                <div style="width:1px; background:rgba(226, 232, 240, 0.7);"></div>
                <div style="text-align:center;">
                  <div id="profile-pending-val" style="font-size:16px; font-weight:800; color:#0f172a;">${pendingDisplay}</div>
                  <div style="font-size:11px; color:#64748b; font-weight:600; margin-top:2px;">Pending Sent</div>
                </div>
              </div>
            </div>
          </div>

          <div class="side-card status-card-cn">
            <div class="status-card-head">
              <span class="status-title">Prospecting status</span>
              <span class="badge-status ${runnerStatusClass}">
                <span class="live-dot-circle"></span> ${runnerStatusText}
              </span>
            </div>

            <div class="status-kpis-pair">
              <div class="status-metric-box">
                <div class="status-icon-circle" style="background:#E6EFE9; color:#104B35;">${ICONS.rocket}</div>
                <div>
                  <div class="status-metric-val">${activeCampaignsCount}</div>
                  <div class="status-metric-lbl">Active campaigns</div>
                </div>
              </div>

              <div class="status-metric-box">
                <div class="status-icon-circle" style="background:#f5f3ff; color:#7c3aed;">${ICONS.queue}</div>
                <div>
                  <div class="status-metric-val">${queuedActionsCount}</div>
                  <div class="status-metric-lbl">Queued actions</div>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    `;

    wireHomeEvents(timeline);
    ctx?.restoreScrollPosition?.(container, scrollPos);
  }

  function wireHomeEvents(currentTimeline) {
    const homeAvatarImg = container.querySelector('#home-profile-avatar-wrap img');
    if (homeAvatarImg) {
      homeAvatarImg.addEventListener('error', () => {
        homeAvatarImg.remove();
        const initialsEl = container.querySelector('#home-profile-avatar-wrap .avatar-initials-txt');
        if (initialsEl) initialsEl.textContent = avatarTxt;
      });
    }

    // Background refresh of live network stats if missing or stale (>3 min)
    const cachedNet = storage.networkStats || null;
    const lastUpdated = cachedNet?.updatedAt || 0;
    if (!cachedNet || Date.now() - lastUpdated > 3 * 60 * 1000) {
      call(ACTIONS.NETWORK_STATS || 'network.stats', {}).then((fresh) => {
        if (!fresh) return;
        storage.networkStats = fresh;
        const connEl = container.querySelector('#profile-connections-val');
        const pendEl = container.querySelector('#profile-pending-val');
        if (isConnected) {
          if (connEl && fresh.connections != null) {
            connEl.textContent = Number(fresh.connections).toLocaleString();
          }
          if (pendEl && fresh.pending != null) {
            pendEl.textContent = Number(fresh.pending).toLocaleString();
          }
        }
      }).catch(() => {});
    }

    container.querySelector('#home-filter-range')?.addEventListener('change', async (e) => {
      selectedDays = e.target.value;
      ctx?.saveState?.({ selectedDays, selectedCampaignId, activeChartAction });
      const latestStorage = await new Promise((r) => chrome.storage.local.get(null, r)).catch(() => null);
      if (latestStorage && typeof latestStorage === 'object') storage = latestStorage;
      paint();
    });

    container.querySelector('#home-filter-campaign')?.addEventListener('change', async (e) => {
      selectedCampaignId = e.target.value;
      ctx?.saveState?.({ selectedDays, selectedCampaignId, activeChartAction });
      const latestStorage = await new Promise((r) => chrome.storage.local.get(null, r)).catch(() => null);
      if (latestStorage && typeof latestStorage === 'object') storage = latestStorage;
      paint();
    });

    container.querySelectorAll('.action-type-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        activeChartAction = pill.dataset.action;
        ctx?.saveState?.({ selectedDays, selectedCampaignId, activeChartAction });
        paint();
      });
    });

    container.querySelector('#btn-export-timeline')?.addEventListener('click', async () => {
      const rows = (currentTimeline || []).map((slot) => ({
        Date: slot.date,
        Day: slot.label,
        Invitations: slot.invitations || 0,
        Messages: slot.messages || 0,
        Visits: slot.visits || 0,
        Follows: slot.follows || 0,
      }));
      await downloadCsv(`crafture-activity-${today()}.csv`, rows);
    });

    container.querySelector('#btn-home-go-inbox')?.addEventListener('click', () => {
      ctx.switchView?.('inbox');
    });

    container.querySelector('#btn-home-go-queue')?.addEventListener('click', () => {
      ctx.switchView?.('queue');
    });

    const triggerConnectGmail = async () => {
      try {
        await call(ACTIONS.GOOGLE_WORKSPACE_CONNECT, { interactive: true });
        ctx.showToast?.('Google account connected successfully', 'success');
        const latestStorage = await new Promise((r) => chrome.storage.local.get(null, r)).catch(() => null);
        if (latestStorage) storage = latestStorage;
        paint();
      } catch (err) {
        ctx.switchView?.('settings');
      }
    };

    container.querySelector('#btn-connect-gmail-home')?.addEventListener('click', triggerConnectGmail);
    container.querySelector('#btn-connect-gmail-strategy')?.addEventListener('click', triggerConnectGmail);

    container.querySelector('#btn-start-email-strategy')?.addEventListener('click', () => {
      ctx.switchView?.('campaigns');
    });

    const tooltipEl = container.querySelector('#chart-live-tooltip');
    if (tooltipEl) {
      container.querySelectorAll('.chart-col-group').forEach((col) => {
        col.addEventListener('mouseenter', () => {
          const txt = col.dataset.tooltip;
          if (txt) {
            tooltipEl.textContent = txt;
            tooltipEl.classList.remove('hidden');
            const rect = col.getBoundingClientRect();
            const parentRect = container.querySelector('.timeline-svg-container').getBoundingClientRect();
            tooltipEl.style.left = `${rect.left - parentRect.left - 20}px`;
            tooltipEl.style.top = `${rect.top - parentRect.top - 28}px`;
          }
        });
        col.addEventListener('mouseleave', () => {
          tooltipEl.classList.add('hidden');
        });
      });
    }
  }

  let storageDebounceTimer = null;
  const storageListener = (changes, area) => {
    if (area !== 'local') return;
    const checkFn = ctx.isStorageChangeRelevant || isStorageChangeRelevant;
    if (checkFn && !checkFn(changes, HOME_RELEVANT_KEYS)) return;
    clearTimeout(storageDebounceTimer);
    storageDebounceTimer = setTimeout(async () => {
      if (!ctx.isActiveView || ctx.isActiveView()) {
        const latestStorage = await new Promise((r) => chrome.storage.local.get(null, r)).catch(() => null);
        if (latestStorage && (!ctx.isActiveView || ctx.isActiveView())) {
          storage = latestStorage;
          paint();
        }
      }
    }, 400);
  };
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(storageListener);
    ctx.registerCleanup?.(() => {
      clearTimeout(storageDebounceTimer);
      chrome.storage.onChanged.removeListener(storageListener);
    });
  }

  paint();
}

function renderSvg30DayChart(timeline, activeAction) {
  const w = 720;
  const h = 200;
  const padL = 35;
  const padR = 20;
  const padT = 20;
  const padB = 35;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const seriesData = timeline.map((s) => Number(s[activeAction]) || 0);
  const maxVal = Math.max(...seriesData, 1);
  const numDays = timeline.length || 30;
  const stepX = chartW / numDays;
  const colW = Math.max(6, Math.min(24, stepX * 0.5));

  const colors = {
    invitations: '#104B35',
    messages: '#00c2ff',
    visits: '#ff7675',
    follows: '#7c71f8',
  };
  const activeColor = colors[activeAction] || '#104B35';

  let gridSvg = `
    <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="#f1f5f9" stroke-width="1" />
    <line x1="${padL}" y1="${padT + chartH / 2}" x2="${w - padR}" y2="${padT + chartH / 2}" stroke="#f1f5f9" stroke-width="1" />
    <line x1="${padL}" y1="${padT + chartH}" x2="${w - padR}" y2="${padT + chartH}" stroke="#e2e8f0" stroke-width="1" />
    <text x="${padL - 10}" y="${padT + 4}" fill="#94a3b8" font-size="10" font-weight="600" text-anchor="end">${maxVal}</text>
    <text x="${padL - 10}" y="${padT + chartH / 2 + 4}" fill="#94a3b8" font-size="10" font-weight="600" text-anchor="end">${Math.round(maxVal / 2)}</text>
    <text x="${padL - 10}" y="${padT + chartH + 4}" fill="#94a3b8" font-size="10" font-weight="600" text-anchor="end">0</text>
  `;

  // Stride calculation: ensures labels are spaced evenly and adjacent dates (e.g. Nov 14 / Nov 15) never overlap
  const stride = numDays <= 7 ? 1 : numDays <= 14 ? 2 : Math.max(3, Math.floor(numDays / 6));

  let colsSvg = '';
  timeline.forEach((slot, idx) => {
    const val = Number(slot[activeAction]) || 0;
    const barH = val > 0 ? (val / maxVal) * chartH : 0;
    const x = padL + idx * stepX + (stepX - colW) / 2;
    const y = padT + chartH - barH;

    // Show date on stride, but omit the stride label if it's within 2 slots of the final label
    const isLast = idx === numDays - 1;
    const isTooCloseToLast = (numDays - 1 - idx) > 0 && (numDays - 1 - idx) < Math.max(2, Math.floor(stride * 0.75));
    const showDate = isLast || (idx % stride === 0 && !isTooCloseToLast);

    const dateTextSvg = showDate ? `
      <text x="${x + colW / 2}" y="${padT + chartH + 18}" fill="#94a3b8" font-size="9.5" font-weight="600" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
        ${slot.label}
      </text>
    ` : '';

    colsSvg += `
      <g class="chart-col-group" data-tooltip="${slot.label}: ${val} ${activeAction}">
        <rect x="${x}" y="${y}" width="${colW}" height="${barH}" rx="4" ry="4" fill="${activeColor}" />
        <rect x="${x - 3}" y="${padT}" width="${colW + 6}" height="${chartH}" fill="transparent" style="cursor:pointer;" />
        ${dateTextSvg}
      </g>
    `;
  });

  return `
    <div style="position:relative; width:100%;">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" style="width:100%; height:auto; display:block;">
        ${gridSvg}
        ${colsSvg}
      </svg>
      <div id="chart-live-tooltip" class="chart-tooltip hidden"></div>
    </div>
  `;
}

/**
 * Filter action records & enrollments by date cutoff and campaign,
 * computing filtered KPIs and matching time-series timeline.
 */
export function computeFilteredHomeStats(storage = {}, { days = '30', campaignId = 'all', fallbackStats = {} } = {}) {
  const now = Date.now();
  let cutoff = 0;
  let numDays = 30;

  if (days === '1') {
    numDays = 1;
    cutoff = now - 86400000;
  } else if (days === '7') {
    numDays = 7;
    cutoff = now - 7 * 86400000;
  } else if (days === '30') {
    numDays = 30;
    cutoff = now - 30 * 86400000;
  } else if (days === 'all') {
    numDays = 30;
    cutoff = 0;
  } else {
    numDays = Number(days) || 30;
    cutoff = now - numDays * 86400000;
  }

  const rawActions = Array.isArray(storage.actions) ? storage.actions : [];
  const campaigns = Array.isArray(storage.campaigns) ? storage.campaigns : [];

  // Identify targeted campaigns and enrolled prospects
  const targetCampaigns = campaignId === 'all'
    ? campaigns
    : campaigns.filter((c) => (c.campaignId || c.id) === campaignId);

  const enrolledProspectsSet = new Set();
  const allTargetEnrollments = [];

  targetCampaigns.forEach((camp) => {
    const cId = camp.campaignId || camp.id;
    const enrollments = Array.isArray(storage[`enrollments:${cId}`]) ? storage[`enrollments:${cId}`] : [];
    enrollments.forEach((e) => {
      if (e.publicId) enrolledProspectsSet.add(e.publicId);
      allTargetEnrollments.push(e);
    });
  });

  // Filter actions by date cutoff and campaign
  const filteredActions = rawActions.filter((act) => {
    if (!act) return false;
    const at = act.at || act.updatedAt || 0;
    if (cutoff > 0 && at < cutoff) return false;

    if (campaignId !== 'all') {
      const actCamp = act.campaignId || act.result?.campaignId;
      if (actCamp && actCamp === campaignId) return true;
      if (act.publicId && enrolledProspectsSet.has(act.publicId)) return true;
      return false;
    }
    return true;
  });

  // Count sent actions
  let totalInvitesSent = 0;
  let totalMessagesSent = 0;
  let totalVisits = 0;
  let totalFollows = 0;
  let totalEmailsSent = 0;

  filteredActions.forEach((act) => {
    const isSent = act.result?.status === 'sent' || act.result?.ok === true || (!act.result && act.status === 'sent');
    if (!isSent && act.action !== 'invite_accepted') return;

    if (act.action === 'outreach.invite') totalInvitesSent++;
    else if (act.action === 'outreach.message') totalMessagesSent++;
    else if (act.action === 'outreach.view') totalVisits++;
    else if (act.action === 'outreach.follow') totalFollows++;
    else if (act.action === 'outreach.email') totalEmailsSent++;
  });

  // Count accepted invitations:
  // 1. From action log
  // 2. From enrollments marked accepted
  const acceptedPublicIds = new Set();
  filteredActions.forEach((act) => {
    if (act.action === 'invite_accepted' || act.action === 'events.invite_accepted' || act.result?.status === 'accepted') {
      if (act.publicId) acceptedPublicIds.add(act.publicId);
    }
  });

  allTargetEnrollments.forEach((enr) => {
    if (enr.accepted === true || enr.status === 'accepted') {
      const at = enr.acceptedAt || enr.updatedAt || enr.lastActionAt || enr.enrolledAt || 0;
      if (cutoff === 0 || at >= cutoff) {
        if (enr.publicId) acceptedPublicIds.add(enr.publicId);
      }
    }
  });

  let acceptedInvites = acceptedPublicIds.size;

  // Count replies received:
  // 1. From target enrollments with status 'replied' or replied: true
  // 2. From threads
  const repliedSet = new Set();
  allTargetEnrollments.forEach((enr) => {
    if (enr.status === 'replied' || enr.replied === true) {
      const at = enr.repliedAt || enr.updatedAt || enr.lastActionAt || 0;
      if (cutoff === 0 || at >= cutoff) {
        if (enr.publicId) repliedSet.add(enr.publicId);
      }
    }
  });

  const rawThreads = Array.isArray(storage.threads) ? storage.threads : [];
  rawThreads.forEach((t) => {
    const at = t.updatedAt || t.lastActivityAt || 0;
    if (cutoff > 0 && at > 0 && at < cutoff) return;
    const hasIncoming =
      (t.messages && t.messages.some((m) => !m.fromMe && (cutoff === 0 || (m.timestamp || m.at || at) >= cutoff))) ||
      t.unread ||
      t.unreadCount > 0;
    if (!hasIncoming) return;

    if (campaignId !== 'all') {
      const isTarget = t.participants?.some((p) => enrolledProspectsSet.has(p.publicId || p.id));
      if (isTarget) repliedSet.add(t.threadId || t.id || Math.random());
    } else {
      repliedSet.add(t.threadId || t.id || Math.random());
    }
  });

  let messageResponses = repliedSet.size;

  // Fallbacks if storage.actions is empty on initial load
  if (rawActions.length === 0 && days === 'all' && campaignId === 'all' && fallbackStats.kpis) {
    totalInvitesSent = fallbackStats.kpis.totalInvitesSent || 0;
    totalMessagesSent = fallbackStats.kpis.totalMessagesSent || 0;
    totalVisits = fallbackStats.kpis.totalVisits || 0;
    acceptedInvites = fallbackStats.kpis.acceptedInvites || 0;
    messageResponses = fallbackStats.kpis.messageResponses || 0;
  } else if (days === 'all' && campaignId !== 'all' && totalInvitesSent === 0 && totalMessagesSent === 0) {
    const targetCamp = targetCampaigns[0];
    if (targetCamp?.stats) {
      if (targetCamp.stats.sent) totalInvitesSent = targetCamp.stats.sent;
      if (targetCamp.stats.accepted) acceptedInvites = targetCamp.stats.accepted;
      if (targetCamp.stats.replied) messageResponses = targetCamp.stats.replied;
    }
  }

  const acceptanceRate = totalInvitesSent > 0 ? Math.min(100, Math.round((acceptedInvites / totalInvitesSent) * 100)) : 0;
  const responseRate = totalMessagesSent > 0 ? Math.min(100, Math.round((messageResponses / totalMessagesSent) * 100)) : 0;

  // Adjust numDays for 'all' time if older actions exist
  if (days === 'all' && filteredActions.length > 0) {
    const oldestAt = Math.min(...filteredActions.map((a) => a.at || now));
    const spanDays = Math.ceil((now - oldestAt) / 86400000);
    if (spanDays > 30) {
      numDays = Math.min(60, Math.max(30, spanDays));
    }
  }

  let timeline = buildFilteredTimeline(filteredActions, numDays);
  if (filteredActions.length === 0 && days === 'all' && campaignId === 'all' && fallbackStats.activityTimeline) {
    timeline = fallbackStats.activityTimeline;
  }

  return {
    kpis: {
      invitesSent: totalInvitesSent,
      totalInvitesSent,
      messagesSent: totalMessagesSent,
      totalMessagesSent,
      profileViews: totalVisits,
      totalVisits,
      follows: totalFollows,
      totalFollows,
      emailsSent: totalEmailsSent,
      totalEmailsSent,
      invitesAccepted: acceptedInvites,
      acceptedInvites,
      acceptanceRate,
      repliesReceived: messageResponses,
      messageResponses,
      responseRate,
    },
    timeline,
  };
}

function buildFilteredTimeline(filteredActions, numDays = 30) {
  const timeline = [];
  const now = new Date();

  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
    timeline.push({
      date: dateStr,
      label,
      invitations: 0,
      messages: 0,
      visits: 0,
      follows: 0,
      emails: 0,
    });
  }

  const slotMap = new Map(timeline.map((s) => [s.date, s]));
  filteredActions.forEach((act) => {
    if (!act.at) return;
    const isSent = act.result?.status === 'sent' || act.result?.ok === true || (!act.result && act.status === 'sent');
    if (!isSent) return;

    const actDate = new Date(act.at).toISOString().slice(0, 10);
    const slot = slotMap.get(actDate);
    if (!slot) return;

    if (act.action === 'outreach.invite') slot.invitations++;
    else if (act.action === 'outreach.message') slot.messages++;
    else if (act.action === 'outreach.view') slot.visits++;
    else if (act.action === 'outreach.follow') slot.follows++;
    else if (act.action === 'outreach.email') slot.emails++;
  });

  return timeline;
}

function generateFallback30DayTimeline() {
  const timeline = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    timeline.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }),
      invitations: 0,
      messages: 0,
      visits: 0,
      follows: 0,
    });
  }
  return timeline;
}
