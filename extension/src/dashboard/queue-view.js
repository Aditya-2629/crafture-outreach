/**
 * OutFox — Waalaxy Queue & Daily Quotas View
 * Matches 1:1 Screenshots: Queued actions table, filters, bulk delete,
 * and live LinkedIn Daily Quotas progress cards with Update activity.
 * 100% Manifest V3 CSP Compliant · Zero Emojis in Core UI · Pure SVG Icons
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { ICONS } from '../ui/icons.js';
import { openUiConfirm, openUiAlert } from './modal-engine.js';

let selectedQueueIds = new Set();
let activeCampaignFilter = 'all';
let activeTypeFilters = new Set(['Invitation', 'Message', 'Visit', 'Follow', 'Email']);

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
    .status-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; }
    .status-pill.status-postponed { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
    .status-pill.status-needs-conn { background: #fff1ee; color: #ea580c; border: 1px solid #fed7aa; cursor: help; }
    .status-pill.status-cooling { background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; }
    .status-pill.status-scheduled { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
    .status-postponed { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 700; color: #f59e0b; background: #fef3c7; padding: 2px 8px; border-radius: 4px; }
    .status-scheduled { font-size: 12px; color: #059669; font-weight: 600; }
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

export async function renderQueueView(container, ctx = {}) {
  if (!container) return;
  ensureQueueStyles();

  container.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; height:320px; color:#6e7191;">
      <div style="width:34px; height:34px; border:3px solid #fff7ed; border-top-color:#ff6b00; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
    </div>
    <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
  `;

  const [statusRes, configRes, allStorage] = await Promise.all([
    call(ACTIONS.STATUS_GET, {}).catch(() => ({})),
    call(ACTIONS.CONFIG_GET, {}).catch(() => ({})),
    new Promise((r) => chrome.storage.local.get(null, r)),
  ]);

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
        if (currentStep.type === 'message') {
          actionType = 'Message';
          actionIcon = ICONS.message;
        } else if (currentStep.type === 'view') {
          actionType = 'Visit';
          actionIcon = ICONS.visit;
        } else if (currentStep.type === 'follow') {
          actionType = 'Follow';
          actionIcon = ICONS.follow;
        } else if (currentStep.type === 'email') {
          actionType = 'Email';
          actionIcon = ICONS.email;
        }

        let statusType = 'scheduled';
        if (st === 'blocked_not_connected' || (e.error && e.error.includes('1st-degree'))) {
          statusType = 'needs_connection';
        } else if (e.error && (e.error.includes('cooldown') || e.error.includes('pacing') || e.error.includes('safety'))) {
          statusType = 'cooling_down';
        } else if (
          (actionType === 'Invitation' && isWeeklyInviteQuotaReached) ||
          (actionType === 'Message' && messagesLeft === 0) ||
          (actionType === 'Visit' && visitsLeft === 0) ||
          (actionType === 'Email' && emailsLeft === 0) ||
          (e.error && e.error.includes('Daily quota reached'))
        ) {
          statusType = 'postponed';
        }

        queuedItems.push({
          id: `${camp.campaignId}_${e.publicId}`,
          campaignId: camp.campaignId,
          campaignName: camp.name || 'Invitation',
          publicId: e.publicId,
          prospectName: e.fullName || e.name || e.publicId || 'LinkedIn Member',
          actionType,
          actionIcon,
          statusType,
          scheduledTime:
            statusType === 'postponed'
              ? 'Postponed'
              : statusType === 'needs_connection'
                ? 'Needs Connection'
                : statusType === 'cooling_down'
                  ? 'Cooling Down'
                  : 'Scheduled',
        });
      }
    });
  });

  function paint() {
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
          <div class="queue-header-row">
            <div>
              <h1 class="queue-view-title">Queue</h1>
              <div class="queue-subtitle-line">
                <span class="sub-label">Queued actions</span>
                ${isWeeklyInviteQuotaReached ? `
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
                ${campaigns.map((c) => `<option value="${c.campaignId}" ${activeCampaignFilter === c.campaignId ? 'selected' : ''}>${c.name}</option>`).join('')}
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
                  <th>TIME</th>
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
                        <span class="prospect-name">${item.prospectName}</span>
                      </div>
                    </td>
                    <td>
                      <span class="queue-campaign-tag">${item.campaignName}</span>
                    </td>
                    <td>
                      ${(() => {
                        if (item.statusType === 'needs_connection') {
                          return `
                            <span class="status-pill status-needs-conn" title="Must accept connection request before messaging">
                              ${ICONS.ban} Needs Connection
                            </span>
                          `;
                        }
                        if (item.statusType === 'cooling_down') {
                          return `
                            <span class="status-pill status-cooling" title="Account safety pacing active">
                              ${ICONS.clock} Cooling Down
                            </span>
                          `;
                        }
                        if (item.statusType === 'postponed') {
                          return `
                            <span class="status-pill status-postponed" title="Daily Quota Reached — Resumes Tomorrow">
                              ${ICONS.info} Postponed
                            </span>
                          `;
                        }
                        return `
                          <span class="status-pill status-scheduled" title="Ready to send at scheduled time">
                            ${ICONS.check} Scheduled
                          </span>
                        `;
                      })()}
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

            <div class="quota-progress-card ${isWeeklyInviteQuotaReached ? 'is-warning' : ''}">
              <div class="quota-card-top">
                <div class="quota-icon-wrap icon-invites">${ICONS.invitation}</div>
                <div class="quota-meta">
                  <span class="quota-metric-name">INVITATIONS</span>
                  <span class="quota-metric-val"><strong>${invitesLeft}</strong> left today</span>
                </div>
                <span class="quota-info-icon" title="Weekly and daily safety ceiling enforced by LinkedIn">${ICONS.info}</span>
              </div>
              <div class="quota-bar-track">
                <div class="quota-bar-fill fill-invites" style="width: ${Math.round(((inviteUsed) / (inviteDailyCap || 25)) * 100)}%;"></div>
              </div>
              ${isWeeklyInviteQuotaReached ? `
                <div class="quota-warning-line">LinkedIn weekly or daily quota reached</div>
              ` : ''}
              <div class="quota-count-line" style="display: flex; justify-content: space-between; margin-top: 4px;">
                <span>Daily: ${inviteUsed} / ${inviteDailyCap}</span>
                <span>Weekly: ${inviteWeeklyUsed} / ${inviteWeeklyCap}</span>
              </div>
            </div>

            <div class="quota-progress-card">
              <div class="quota-card-top">
                <div class="quota-icon-wrap icon-messages">${ICONS.message}</div>
                <div class="quota-meta">
                  <span class="quota-metric-name">MESSAGES</span>
                  <span class="quota-metric-val"><strong>${messagesLeft}</strong> left today</span>
                </div>
                <span class="quota-info-icon" title="Daily message safety cap">${ICONS.info}</span>
              </div>
              <div class="quota-bar-track">
                <div class="quota-bar-fill fill-messages" style="width: ${Math.round(((messageUsed) / (messageDailyCap || 40)) * 100)}%;"></div>
              </div>
              <div class="quota-count-line">${messageUsed} / ${messageDailyCap} sent today</div>
            </div>

            <div class="quota-progress-card">
              <div class="quota-card-top">
                <div class="quota-icon-wrap icon-visits">${ICONS.visit}</div>
                <div class="quota-meta">
                  <span class="quota-metric-name">PROFILE VISITS</span>
                  <span class="quota-metric-val"><strong>${visitsLeft}</strong> left today</span>
                </div>
                <span class="quota-info-icon" title="Profile visit safety quota">${ICONS.info}</span>
              </div>
              <div class="quota-bar-track">
                <div class="quota-bar-fill fill-visits" style="width: ${Math.round(((visitUsed) / (visitDailyCap || 80)) * 100)}%;"></div>
              </div>
              <div class="quota-count-line">${visitUsed} / ${visitDailyCap} visited today</div>
            </div>
          </div>

          <div class="quotas-channel-section" style="margin-top: 18px;">
            <div class="channel-heading">Cold Email (Gmail)</div>

            <div class="quota-progress-card ${emailsLeft === 0 ? 'is-warning' : ''}">
              <div class="quota-card-top">
                <div class="quota-icon-wrap" style="background:#fff7ed; color:#ff6b00; width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center;">${ICONS.email}</div>
                <div class="quota-meta">
                  <span class="quota-metric-name">COLD EMAILS</span>
                  <span class="quota-metric-val"><strong>${emailsLeft}</strong> left today</span>
                </div>
                <span class="quota-info-icon" title="Daily cold email outreach cap">${ICONS.info}</span>
              </div>
              <div class="quota-bar-track">
                <div class="quota-bar-fill" style="background:#ff6b00; width: ${Math.round(((emailUsed) / (emailDailyCap || 50)) * 100)}%;"></div>
              </div>
              <div class="quota-count-line">${emailUsed} / ${emailDailyCap} sent today</div>
            </div>
          </div>
        </aside>
      </div>
    `;

    wireQueueEvents(container, filteredQueue);
  }

  function wireQueueEvents(container, filteredQueue) {
    const resetQuotaBtn = container.querySelector('#btn-queue-reset-quota');
    if (resetQuotaBtn) {
      resetQuotaBtn.addEventListener('click', async () => {
        try {
          await call(ACTIONS.QUOTA_RESET, {});
          ctx.showToast?.("Today's quota counters reset!", 'success');
          renderQueueView(container, ctx);
        } catch {
          ctx.showToast?.('Failed to reset quotas', 'error');
        }
      });
    }

    const updateBtn = container.querySelector('#btn-update-activity');
    if (updateBtn) {
      updateBtn.addEventListener('click', async () => {
        const icon = updateBtn.querySelector('.spin-icon-update');
        if (icon) icon.classList.add('is-spinning');
        updateBtn.disabled = true;

        try {
          await call(ACTIONS.CAMPAIGN_TICK, {});
          ctx.showToast?.('Activity updated. Engine refreshed queue & quotas.', 'success');
        } catch {
          ctx.showToast?.('Activity refreshed.', 'info');
        } finally {
          setTimeout(() => {
            renderQueueView(container, ctx);
          }, 400);
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
        paint();
      });
    });

    const campSelect = container.querySelector('#select-queue-campaign');
    if (campSelect) {
      campSelect.addEventListener('change', (e) => {
        activeCampaignFilter = e.target.value;
        paint();
      });
    }

    const selectAll = container.querySelector('#chk-queue-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', (e) => {
        if (e.target.checked) filteredQueue.forEach((i) => selectedQueueIds.add(i.id));
        else selectedQueueIds.clear();
        paint();
      });
    }

    container.querySelectorAll('.chk-queue-row').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const id = chk.dataset.id;
        if (e.target.checked) selectedQueueIds.add(id);
        else selectedQueueIds.delete(id);
        paint();
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
          renderQueueView(container, ctx);
        }
      });
    }
  }

  paint();
}
