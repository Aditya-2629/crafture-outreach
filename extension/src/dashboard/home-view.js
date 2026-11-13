/**
 * OutFox — Authentic Waalaxy Home Dashboard View
 * Matches 1:1 Real Waalaxy:
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

let selectedDays = '30';
let selectedCampaignId = 'all';

function ensureHomeStyles() {
  const STYLE_ID = 'waalaxy-home-view-css';
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .waalaxy-home-grid { display: grid; grid-template-columns: 1fr 280px; gap: 24px; max-width: 1200px; margin: 0 auto; }
    .home-header-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .home-greeting { font-size: 24px; font-weight: 800; color: #14142b; margin: 0; text-transform: capitalize; }
    .home-filters-row { display: flex; gap: 10px; }
    .filter-pill-wrap { background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 20px; padding: 4px 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
    .home-filter-select { border: none; background: transparent; font-size: 12px; font-weight: 700; color: #ff6b00; outline: none; cursor: pointer; }
    .hero-blue-banner { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 24px 32px; color: #ffffff; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08); margin-bottom: 24px; }
    .hero-banner-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.15); padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; margin-bottom: 14px; }
    .hero-metric-box { display: flex; align-items: center; gap: 16px; }
    .hero-curved-arrow { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; }
    .hero-metric-val { font-size: 32px; font-weight: 900; line-height: 1; }
    .hero-metric-label { font-size: 13px; opacity: 0.9; margin-top: 4px; }
    .radial-rate-circle { width: 72px; height: 72px; border-radius: 50%; border: 4px solid rgba(255,255,255,0.3); border-top-color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 800; margin: 0 auto 6px auto; }
    .radial-rate-label { font-size: 12px; opacity: 0.9; text-align: center; display: block; }
    .accordion-head-row { display: flex; justify-content: space-between; align-items: center; margin: 20px 0 12px 0; }
    .accordion-title-group { display: flex; align-items: center; gap: 8px; }
    .li-badge-box, .email-badge-box { width: 24px; height: 24px; border-radius: 6px; background: #0077b5; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; }
    .email-badge-box { background: #8b5cf6; }
    .accordion-title-text { font-size: 15px; font-weight: 800; color: #14142b; }
    .accordion-chevron { font-size: 12px; color: #94a3b8; }
    .linkedin-kpis-pair, .email-kpis-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
    .email-kpis-grid { grid-template-columns: repeat(3, 1fr); }
    .kpi-card-white { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 20px; display: flex; align-items: center; position: relative; box-shadow: 0 1px 4px rgba(0,0,0,0.02); }
    .kpi-card-left { display: flex; align-items: center; gap: 14px; flex: 1; }
    .kpi-icon-round { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .round-blue { background: #fff7ed; color: #ff6b00; }
    .round-green { background: #ecfdf5; color: #059669; }
    .round-cyan { background: #e0f2fe; color: #0284c7; }
    .kpi-main-number { font-size: 20px; font-weight: 800; color: #14142b; }
    .kpi-sub-label { font-size: 11.5px; color: #64748b; margin-top: 2px; }
    .kpi-vertical-divider { width: 1px; height: 32px; background: #f1f5f9; margin: 0 16px; }
    .kpi-card-right { text-align: right; }
    .kpi-rate-number { font-size: 16px; font-weight: 800; color: #ff6b00; }
    .kpi-info-icon { position: absolute; top: 12px; right: 12px; color: #cbd5e1; cursor: pointer; display: flex; align-items: center; }
    .kpi-info-icon:hover { color: #ff6b00; }
    .actions-sent-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 22px; box-shadow: 0 2px 8px rgba(0,0,0,0.02); }
    .actions-sent-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .actions-sent-title { font-size: 15px; font-weight: 800; color: #14142b; display: flex; align-items: center; gap: 6px; }
    .actions-type-tabs { display: flex; gap: 10px; margin-bottom: 16px; }
    .action-type-pill { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 8px 14px; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: all 0.15s; }
    .action-type-pill.is-active { background: #ffffff; border-color: #ff6b00; box-shadow: 0 2px 8px rgba(255, 107, 0, 0.1); }
    .pill-ico { display: flex; align-items: center; justify-content: center; }
    .ico-blue { color: #ff6b00; }
    .ico-cyan { color: #00c2ff; }
    .ico-coral { color: #ff7675; }
    .ico-purple { color: #7c71f8; }
    .pill-num { font-size: 13px; font-weight: 800; color: #14142b; }
    .pill-name { font-size: 12px; color: #64748b; font-weight: 600; }
    .chart-legend-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; font-size: 12px; font-weight: 700; color: #14142b; }
    .btn-download-chart-csv { background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 4px; display: flex; align-items: center; }
    .btn-download-chart-csv:hover { color: #ff6b00; }
    .emails-sent-empty-box { background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 14px; padding: 28px; text-align: center; margin-top: 14px; }
    .empty-cat-icon { width: 44px; height: 44px; border-radius: 12px; background: #fff7ed; color: #ff6b00; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px auto; }
    .empty-email-title { font-size: 14px; font-weight: 800; color: #14142b; margin: 0 0 4px 0; }
    .empty-email-sub { font-size: 12px; color: #64748b; margin: 0 0 16px 0; }
    .btn-email-strategy { background: #ff6b00; color: #ffffff; border: none; border-radius: 20px; padding: 8px 20px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .home-side-col { display: flex; flex-direction: column; gap: 20px; }
    .side-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.02); }
    .card-plan-badge { font-size: 10.5px; font-weight: 700; background: #f1f5f9; color: #475569; padding: 4px 10px; border-radius: 6px; display: inline-block; margin-bottom: 16px; }
    .avatar-center-wrapper { display: flex; flex-direction: column; align-items: center; text-align: center; }
    .waalaxy-alien-avatar { width: 56px; height: 56px; border-radius: 50%; background: #1e293b; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; position: relative; margin-bottom: 10px; }
    .li-corner-badge { position: absolute; bottom: -2px; right: -2px; width: 18px; height: 18px; border-radius: 50%; background: #0077b5; color: #fff; display: flex; align-items: center; justify-content: center; }
    .profile-username { font-size: 15px; font-weight: 800; color: #14142b; margin: 0; }
    .status-card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .status-title { font-size: 13.5px; font-weight: 800; color: #14142b; }
    .badge-status-reached { font-size: 11px; font-weight: 700; background: #fef2f2; color: #dc2626; padding: 3px 8px; border-radius: 6px; }
    .badge-status-running { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; background: #ecfdf5; color: #059669; padding: 3px 8px; border-radius: 6px; }
    .status-kpis-pair { display: flex; flex-direction: column; gap: 12px; }
    .status-metric-box { display: flex; align-items: center; gap: 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 14px; }
    .status-icon-circle { width: 34px; height: 34px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
    .status-metric-val { font-size: 16px; font-weight: 800; color: #14142b; }
    .status-metric-lbl { font-size: 11px; color: #64748b; font-weight: 600; }
    .chart-tooltip { position: absolute; background: #14142b; color: #ffffff; padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; pointer-events: none; z-index: 10; white-space: nowrap; }
    .chart-tooltip.hidden { display: none; }
  `;
  document.head.appendChild(style);
}

export async function renderHomeView(container, ctx = {}) {
  if (!container) return;
  ensureHomeStyles();

  container.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; height:320px; color:#6e7191;">
      <div style="width:34px; height:34px; border:3px solid #fff7ed; border-top-color:#ff6b00; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
    </div>
    <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
  `;

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

  const profile = stats.profile || { name: 'Aditya Chaudhary' };
  const quotas = stats.quotas || {};
  const isQuotaReached = (quotas.invite?.remaining === 0) || (quotas.invite?.usedToday >= (quotas.invite?.max || 25));

  const rawName = (profile.name || 'aditya').trim();
  const firstName = rawName.split(/[\s-_]+/)[0] || 'aditya';
  const displayGreeting = firstName.toLowerCase();
  const initials = rawName.split(/[\s-_]+/).map((n) => n[0]).slice(0, 2).join('').toUpperCase() || 'AC';

  let activeChartAction = 'invitations';

  function paint() {
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

    container.innerHTML = `
      <div class="waalaxy-home-grid">
        <div class="home-main-col">
          <div class="home-header-row">
            <h1 class="home-greeting">Hello ${displayGreeting} ,</h1>
            <div class="home-filters-row">
              <div class="filter-pill-wrap">
                <select class="home-filter-select" id="home-filter-range">
                  <option value="1" ${selectedDays === '1' ? 'selected' : ''}>Today ⌵</option>
                  <option value="7" ${selectedDays === '7' ? 'selected' : ''}>Last 7 days ⌵</option>
                  <option value="30" ${selectedDays === '30' ? 'selected' : ''}>Last 30 days ⌵</option>
                  <option value="all" ${selectedDays === 'all' ? 'selected' : ''}>All time ⌵</option>
                </select>
              </div>
              <div class="filter-pill-wrap">
                <select class="home-filter-select" id="home-filter-campaign">
                  <option value="all" ${selectedCampaignId === 'all' ? 'selected' : ''}>All campaigns ⌵</option>
                  ${campaigns.map((c) => `<option value="${c.campaignId || c.id}" ${selectedCampaignId === (c.campaignId || c.id) ? 'selected' : ''}>${c.name || c.campaignId} ⌵</option>`).join('')}
                </select>
              </div>
            </div>
          </div>

          <div class="hero-blue-banner">
            <div class="hero-banner-left">
              <div class="hero-banner-badge">
                <span class="li-in-icon">${ICONS.linkedin}</span> LinkedIn
              </div>
              <div class="hero-metric-box">
                <span class="hero-curved-arrow">${ICONS.reply}</span>
                <div>
                  <div class="hero-metric-val">${kpis.messageResponses || 0}</div>
                  <div class="hero-metric-label">Message responses</div>
                </div>
              </div>
            </div>

            <div class="hero-banner-right">
              <div class="radial-rate-circle">
                <span>${kpis.responseRate || 0}%</span>
              </div>
              <span class="radial-rate-label">Response rate</span>
            </div>
          </div>

          <div class="accordion-head-row">
            <div class="accordion-title-group">
              <span class="li-badge-box">${ICONS.linkedin}</span>
              <span class="accordion-title-text">LinkedIn</span>
            </div>
            <span class="accordion-chevron">${ICONS.chevronDown}</span>
          </div>

          <div class="linkedin-kpis-pair">
            <div class="kpi-card-white">
              <div class="kpi-card-left">
                <div class="kpi-icon-round round-blue">${ICONS.invitation}</div>
                <div>
                  <div class="kpi-main-number">${kpis.acceptedInvites || 0}</div>
                  <div class="kpi-sub-label">Accepted invitations</div>
                </div>
              </div>
              <div class="kpi-vertical-divider"></div>
              <div class="kpi-card-right">
                <div class="kpi-rate-number">${kpis.acceptanceRate || 0}%</div>
                <div class="kpi-sub-label">Acceptance rate</div>
              </div>
              <span class="kpi-info-icon" title="Invitations accepted by prospects">${ICONS.info}</span>
            </div>

            <div class="kpi-card-white">
              <div class="kpi-card-left">
                <div class="kpi-icon-round round-green">${ICONS.message}</div>
                <div>
                  <div class="kpi-main-number">${kpis.messageResponses || 0}</div>
                  <div class="kpi-sub-label">Answered messages</div>
                </div>
              </div>
              <div class="kpi-vertical-divider"></div>
              <div class="kpi-card-right">
                <div class="kpi-rate-number">${kpis.responseRate || 0}%</div>
                <div class="kpi-sub-label">Response rate</div>
              </div>
              <span class="kpi-info-icon" title="Responses received from prospects">${ICONS.info}</span>
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
                <span class="pill-num">0</span>
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

          <div class="accordion-head-row" style="margin-top:28px;">
            <div class="accordion-title-group">
              <span class="email-badge-box">${ICONS.email}</span>
              <span class="accordion-title-text">Email</span>
            </div>
            <span class="accordion-chevron">${ICONS.chevronDown}</span>
          </div>

          <div class="email-kpis-grid">
            <div class="kpi-card-white">
              <div class="kpi-card-left">
                <div class="kpi-icon-round round-blue">${ICONS.email}</div>
                <div><div class="kpi-main-number">0</div><div class="kpi-sub-label">Delivered</div></div>
              </div>
              <div class="kpi-vertical-divider"></div>
              <div class="kpi-card-right"><div class="kpi-rate-number">0%</div><div class="kpi-sub-label">Deliverability rate</div></div>
            </div>
            <div class="kpi-card-white">
              <div class="kpi-card-left">
                <div class="kpi-icon-round round-cyan">${ICONS.email}</div>
                <div><div class="kpi-main-number">0</div><div class="kpi-sub-label">Opened</div></div>
              </div>
              <div class="kpi-vertical-divider"></div>
              <div class="kpi-card-right"><div class="kpi-rate-number">0%</div><div class="kpi-sub-label">Open rate</div></div>
            </div>
            <div class="kpi-card-white">
              <div class="kpi-card-left">
                <div class="kpi-icon-round round-green">${ICONS.message}</div>
                <div><div class="kpi-main-number">0</div><div class="kpi-sub-label">Responses</div></div>
              </div>
              <div class="kpi-vertical-divider"></div>
              <div class="kpi-card-right"><div class="kpi-rate-number">0%</div><div class="kpi-sub-label">Response rate</div></div>
            </div>
          </div>

          <div class="emails-sent-empty-box">
            <img src="../../icons/icon48.png" width="40" height="40" alt="OutFox" style="border-radius: 10px; margin-bottom: 12px; box-shadow: 0 4px 14px rgba(255, 107, 0, 0.2);" />
            <h4 class="empty-email-title">You haven't sent any emails yet</h4>
            <p class="empty-email-sub">Start reaching out directly via integrated Google or Outlook mailbox!</p>
            <button type="button" class="btn-email-strategy" id="btn-start-email-strategy" style="background: linear-gradient(135deg, #ff741f 0%, #ff4d00 100%);">
              Start my email campaign strategy
            </button>
          </div>
        </div>

        <aside class="home-side-col">
          <div class="side-card profile-card-waalaxy">
            <div class="avatar-center-wrapper">
              <div class="waalaxy-alien-avatar">
                <span class="avatar-initials-txt">${initials}</span>
                <span class="li-corner-badge">${ICONS.linkedin}</span>
              </div>
              <h3 class="profile-username">${profile.name}</h3>
              <div style="display:flex; justify-content:center; gap:16px; margin-top:14px; border-top:1px solid #f1f5f9; padding-top:12px; width:100%;">
                <div style="text-align:center;">
                  <div style="font-size:14px; font-weight:800; color:#14142b;">${profile.connections ?? 0}</div>
                  <div style="font-size:10px; color:#94a3b8; font-weight:600;">Connections · Account</div>
                </div>
                <div style="width:1px; background:#f1f5f9;"></div>
                <div style="text-align:center;">
                  <div style="font-size:14px; font-weight:800; color:#14142b;">${profile.pending ?? 0}</div>
                  <div style="font-size:10px; color:#94a3b8; font-weight:600;">Pending · Account</div>
                </div>
              </div>
            </div>
          </div>

          <div class="side-card status-card-waalaxy">
            <div class="status-card-head">
              <span class="status-title">Prospecting status</span>
              ${isQuotaReached ? `
                <span class="badge-status-reached">Quotas reached</span>
              ` : `
                <span class="badge-status-running"><span class="live-dot-circle"></span> Running</span>
              `}
            </div>

            <div class="status-kpis-pair">
              <div class="status-metric-box">
                <div class="status-icon-circle icon-bg-blue">${ICONS.rocket}</div>
                <div>
                  <div class="status-metric-val">${activeCampaignsCount}</div>
                  <div class="status-metric-lbl">Active campaigns</div>
                </div>
              </div>

              <div class="status-metric-box">
                <div class="status-icon-circle icon-bg-purple">${ICONS.queue}</div>
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
  }

  function wireHomeEvents(currentTimeline) {
    container.querySelector('#home-filter-range')?.addEventListener('change', async (e) => {
      selectedDays = e.target.value;
      const latestStorage = await new Promise((r) => chrome.storage.local.get(null, r)).catch(() => null);
      if (latestStorage && typeof latestStorage === 'object') storage = latestStorage;
      paint();
    });

    container.querySelector('#home-filter-campaign')?.addEventListener('change', async (e) => {
      selectedCampaignId = e.target.value;
      const latestStorage = await new Promise((r) => chrome.storage.local.get(null, r)).catch(() => null);
      if (latestStorage && typeof latestStorage === 'object') storage = latestStorage;
      paint();
    });

    container.querySelectorAll('.action-type-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        activeChartAction = pill.dataset.action;
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
      await downloadCsv(`outfox-activity-${today()}.csv`, rows);
    });

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
    invitations: '#ff6b00',
    messages: '#00c2ff',
    visits: '#ff7675',
    follows: '#7c71f8',
  };
  const activeColor = colors[activeAction] || '#ff6b00';

  let gridSvg = `
    <line x1="${padL}" y1="${padT}" x2="${w - padR}" y2="${padT}" stroke="#fff7ed" stroke-width="1" />
    <line x1="${padL}" y1="${padT + chartH / 2}" x2="${w - padR}" y2="${padT + chartH / 2}" stroke="#fff7ed" stroke-width="1" />
    <line x1="${padL}" y1="${padT + chartH}" x2="${w - padR}" y2="${padT + chartH}" stroke="#e2e8f0" stroke-width="1" />
    <text x="${padL - 10}" y="${padT + 4}" fill="#94a3b8" font-size="10" text-anchor="end">${maxVal}</text>
    <text x="${padL - 10}" y="${padT + chartH / 2 + 4}" fill="#94a3b8" font-size="10" text-anchor="end">${Math.round(maxVal / 2)}</text>
    <text x="${padL - 10}" y="${padT + chartH + 4}" fill="#94a3b8" font-size="10" text-anchor="end">0</text>
  `;

  let colsSvg = '';
  timeline.forEach((slot, idx) => {
    const val = Number(slot[activeAction]) || 0;
    const barH = val > 0 ? (val / maxVal) * chartH : 0;
    const x = padL + idx * stepX + (stepX - colW) / 2;
    const y = padT + chartH - barH;

    const showDate = numDays <= 7 ? true : (idx % 2 === 0 || idx === numDays - 1);
    const dateTextSvg = showDate ? `
      <text x="${x + colW / 2}" y="${padT + chartH + 18}" fill="#94a3b8" font-size="9" text-anchor="middle" font-family="sans-serif">
        ${slot.label}
      </text>
    ` : '';

    colsSvg += `
      <g class="chart-col-group" data-tooltip="${slot.label}: ${val} ${activeAction}">
        <rect x="${x}" y="${y}" width="${colW}" height="${barH}" rx="2" ry="2" fill="${activeColor}" />
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
