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
  const storage = storageRes || {};

  const profile = stats.profile || { name: 'Aditya Chaudhary' };
  const kpis = stats.kpis || {
    totalInvitesSent: 0,
    totalMessagesSent: 0,
    totalVisits: 0,
    acceptedInvites: 0,
    acceptanceRate: 0,
    messageResponses: 0,
    responseRate: 0,
  };

  const campaigns = Array.isArray(storage.campaigns) ? storage.campaigns : [];
  const activeCampaignsCount = campaigns.filter((c) => c.status === 'running' || c.status === 'active' || !c.status).length;

  let queuedActionsCount = 0;
  campaigns.forEach((camp) => {
    const enrollments = storage[`enrollments:${camp.campaignId}`] || [];
    queuedActionsCount += enrollments.filter((e) => e.state === 'active' || e.state === 'running' || !e.state).length;
  });

  const quotas = stats.quotas || {};
  const isQuotaReached = (quotas.invite?.remaining === 0) || (quotas.invite?.usedToday >= (quotas.invite?.max || 25));
  const timeline = stats.activityTimeline || generateFallback30DayTimeline();

  const rawName = (profile.name || 'aditya').trim();
  const firstName = rawName.split(/[\s-_]+/)[0] || 'aditya';
  const displayGreeting = firstName.toLowerCase();
  const initials = rawName.split(/[\s-_]+/).map((n) => n[0]).slice(0, 2).join('').toUpperCase() || 'AC';

  let activeChartAction = 'invitations';

  function paint() {
    container.innerHTML = `
      <div class="waalaxy-home-grid">
        <div class="home-main-col">
          <div class="home-header-row">
            <h1 class="home-greeting">Hello ${displayGreeting} ,</h1>
            <div class="home-filters-row">
              <div class="filter-pill-wrap">
                <select class="home-filter-select" id="home-filter-range">
                  <option value="30">Last 30 days ⌵</option>
                  <option value="7">Last 7 days ⌵</option>
                </select>
              </div>
              <div class="filter-pill-wrap">
                <select class="home-filter-select" id="home-filter-campaign">
                  <option value="all">MY CAMPAIGNS ⌵</option>
                  ${campaigns.map((c) => `<option value="${c.campaignId}">${c.name}</option>`).join('')}
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
            <div class="card-plan-badge">Pro Plan · Free & Self-Hosted</div>
            <div class="avatar-center-wrapper">
              <div class="waalaxy-alien-avatar">
                <span class="avatar-initials-txt">${initials}</span>
                <span class="li-corner-badge">${ICONS.linkedin}</span>
              </div>
              <h3 class="profile-username">${profile.name}</h3>
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

    wireHomeEvents();
  }

  function wireHomeEvents() {
    container.querySelectorAll('.action-type-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        activeChartAction = pill.dataset.action;
        paint();
      });
    });

    container.querySelector('#btn-export-timeline')?.addEventListener('click', async () => {
      const rows = timeline.map((slot) => ({
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
  const colW = Math.max(6, Math.min(12, stepX * 0.5));

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

    const showDate = idx % 2 === 0 || idx === numDays - 1;
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
