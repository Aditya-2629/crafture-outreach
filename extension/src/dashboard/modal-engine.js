/**
 * OutFox — Waalaxy In-UI Native Modal & Dialog System
 * Zero browser prompts/confirms/alerts — 100% native in-UI modals.
 */

/**
 * Native Text Input Modal (Replaces window.prompt)
 */
export function openUiPrompt({ title, subtitle = '', label = '', placeholder = '', defaultValue = '', confirmText = 'Confirm', confirmDanger = false }) {
  return new Promise((resolve) => {
    const existing = document.getElementById('waalaxy-modal-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'waalaxy-modal-backdrop';
    backdrop.className = 'waalaxy-modal-backdrop';

    backdrop.innerHTML = `
      <div class="waalaxy-modal-card">
        <div class="waalaxy-modal-head">
          <h3 class="waalaxy-modal-title">${title}</h3>
          <button type="button" class="waalaxy-modal-close" id="modal-btn-close">✕</button>
        </div>
        ${subtitle ? `<p class="waalaxy-modal-subtitle">${subtitle}</p>` : ''}
        
        <div class="waalaxy-modal-body">
          ${label ? `<label class="waalaxy-input-label">${label}</label>` : ''}
          <input type="text" id="waalaxy-modal-input" class="waalaxy-modal-input" placeholder="${placeholder}" value="${defaultValue}" />
        </div>

        <div class="waalaxy-modal-footer">
          <button type="button" class="btn-modal-ghost" id="modal-btn-cancel">Cancel</button>
          <button type="button" class="btn-modal-primary ${confirmDanger ? 'btn-modal-danger' : ''}" id="modal-btn-confirm">
            ${confirmText}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const input = backdrop.querySelector('#waalaxy-modal-input');
    const closeBtn = backdrop.querySelector('#modal-btn-close');
    const cancelBtn = backdrop.querySelector('#modal-btn-cancel');
    const confirmBtn = backdrop.querySelector('#modal-btn-confirm');

    const cleanup = () => {
      document.removeEventListener('keydown', handleKey);
      backdrop.remove();
    };

    const handleConfirm = () => {
      const val = input.value.trim();
      if (!val) {
        input.focus();
        input.style.borderColor = '#ef4444';
        return;
      }
      cleanup();
      resolve(val);
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    const handleKey = (e) => {
      if (e.key === 'Escape') handleCancel();
      if (e.key === 'Enter') handleConfirm();
    };

    closeBtn.addEventListener('click', handleCancel);
    cancelBtn.addEventListener('click', handleCancel);
    confirmBtn.addEventListener('click', handleConfirm);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) handleCancel();
    });

    document.addEventListener('keydown', handleKey);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  });
}

/**
 * Native Confirmation Dialog (Replaces window.confirm)
 */
export function openUiConfirm({ title, message, confirmText = 'Confirm', confirmDanger = false }) {
  return new Promise((resolve) => {
    const existing = document.getElementById('waalaxy-modal-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'waalaxy-modal-backdrop';
    backdrop.className = 'waalaxy-modal-backdrop';

    backdrop.innerHTML = `
      <div class="waalaxy-modal-card">
        <div class="waalaxy-modal-head">
          <h3 class="waalaxy-modal-title">${title}</h3>
          <button type="button" class="waalaxy-modal-close" id="modal-btn-close">✕</button>
        </div>
        
        <div class="waalaxy-modal-body">
          <div class="waalaxy-confirm-message">${message}</div>
        </div>

        <div class="waalaxy-modal-footer">
          <button type="button" class="btn-modal-ghost" id="modal-btn-cancel">Cancel</button>
          <button type="button" class="btn-modal-primary ${confirmDanger ? 'btn-modal-danger' : ''}" id="modal-btn-confirm">
            ${confirmText}
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const closeBtn = backdrop.querySelector('#modal-btn-close');
    const cancelBtn = backdrop.querySelector('#modal-btn-cancel');
    const confirmBtn = backdrop.querySelector('#modal-btn-confirm');

    const cleanup = () => {
      document.removeEventListener('keydown', handleKey);
      backdrop.remove();
    };

    const handleCancel = () => {
      cleanup();
      resolve(false);
    };

    const handleConfirm = () => {
      cleanup();
      resolve(true);
    };

    const handleKey = (e) => {
      if (e.key === 'Escape') handleCancel();
      if (e.key === 'Enter') handleConfirm();
    };

    closeBtn.addEventListener('click', handleCancel);
    cancelBtn.addEventListener('click', handleCancel);
    confirmBtn.addEventListener('click', handleConfirm);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) handleCancel();
    });

    document.addEventListener('keydown', handleKey);
  });
}

/**
 * Native List Selection Modal (For "Move to list" / "Enroll into campaign")
 */
export function openUiSelectModal({ title, label, options = [], confirmText = 'Move' }) {
  return new Promise((resolve) => {
    const existing = document.getElementById('waalaxy-modal-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'waalaxy-modal-backdrop';
    backdrop.className = 'waalaxy-modal-backdrop';

    backdrop.innerHTML = `
      <div class="waalaxy-modal-card">
        <div class="waalaxy-modal-head">
          <h3 class="waalaxy-modal-title">${title}</h3>
          <button type="button" class="waalaxy-modal-close" id="modal-btn-close">✕</button>
        </div>
        
        <div class="waalaxy-modal-body">
          <label class="waalaxy-input-label">${label}</label>
          <div class="waalaxy-select-list">
            ${options.map((opt, i) => `
              <label class="waalaxy-select-item">
                <input type="radio" name="ui_select_opt" value="${opt.id}" ${i === 0 ? 'checked' : ''} />
                <span class="select-item-name">${opt.name}</span>
                <span class="select-item-count">${opt.count !== undefined ? `${opt.count} leads` : ''}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div class="waalaxy-modal-footer">
          <button type="button" class="btn-modal-ghost" id="modal-btn-cancel">Cancel</button>
          <button type="button" class="btn-modal-primary" id="modal-btn-confirm">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const closeBtn = backdrop.querySelector('#modal-btn-close');
    const cancelBtn = backdrop.querySelector('#modal-btn-cancel');
    const confirmBtn = backdrop.querySelector('#modal-btn-confirm');

    const cleanup = () => {
      document.removeEventListener('keydown', handleKey);
      backdrop.remove();
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    const handleConfirm = () => {
      const checked = backdrop.querySelector('input[name="ui_select_opt"]:checked');
      cleanup();
      resolve(checked ? checked.value : null);
    };

    const handleKey = (e) => {
      if (e.key === 'Escape') handleCancel();
      if (e.key === 'Enter') handleConfirm();
    };

    closeBtn.addEventListener('click', handleCancel);
    cancelBtn.addEventListener('click', handleCancel);
    confirmBtn.addEventListener('click', handleConfirm);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) handleCancel();
    });

    document.addEventListener('keydown', handleKey);
  });
}

/**
 * Native In-UI Alert (Replaces window.alert)
 */
export function openUiAlert({ title = 'Notice', message, confirmText = 'OK' }) {
  return openUiConfirm({ title, message, confirmText, confirmDanger: false });
}

/**
 * Native Lead Timeline Modal (Fox Orange #ff6b00 theme)
 * Displays chronological step history, current status, countdown, and error/cooldown details.
 */
export async function openLeadTimelineModal({ lead = null, publicId = '', campaignId = '', campaignName = '' } = {}) {
  let targetLead = lead;
  let campName = campaignName;

  if (!targetLead && typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      const data = await new Promise((r) => chrome.storage.local.get(null, r));
      const allCampaigns = Array.isArray(data.campaigns) ? data.campaigns : [];
      for (const c of allCampaigns) {
        if (campaignId && c.campaignId !== campaignId) continue;
        const enrollments = data[`enrollments:${c.campaignId}`] || [];
        const found = enrollments.find((e) => e.publicId === publicId);
        if (found) {
          campName = campName || c.name || 'OutFox Campaign';
          const profile = data[`profile:${publicId}`] || (data.profiles && data.profiles[publicId]) || {};
          targetLead = {
            publicId,
            fullName: found.fullName || profile.fullName || profile.name || publicId,
            company: profile.company || profile.companyName || '',
            email: found.email || profile.email || '',
            status: found.status || 'active',
            currentStepLabel: c.steps?.[found.stepIndex]?.type
              ? `Step ${(found.stepIndex || 0) + 1}: ${c.steps[found.stepIndex].type.toUpperCase()}`
              : 'Step 1',
            nextRunAt: found.nextAt || 0,
            lastError: found.error || found.lastError || '',
            lastActionAt: found.lastActionAt || found.enrolledAt || 0,
            history: found.history || [],
          };
          break;
        }
      }
    } catch {
      /* ignore storage read error */
    }
  }

  if (!targetLead) {
    targetLead = {
      publicId: publicId || 'prospect',
      fullName: publicId || 'Prospect Lead',
      company: '',
      email: '',
      status: 'active',
      currentStepLabel: 'Active Sequence',
      nextRunAt: 0,
      lastError: '',
      history: [],
    };
  }

  return new Promise((resolve) => {
    const existing = document.getElementById('waalaxy-timeline-modal-backdrop');
    if (existing) existing.remove();

    const backdrop = document.createElement('div');
    backdrop.id = 'waalaxy-timeline-modal-backdrop';
    backdrop.className = 'waalaxy-modal-backdrop';

    const now = Date.now();
    const status = String(targetLead.status || 'active').toLowerCase();
    const statusUpper = status.toUpperCase();

    let statusBg = '#dcfce7';
    let statusColor = '#15803d';
    if (status === 'waiting') {
      statusBg = '#fef3c7';
      statusColor = '#b45309';
    } else if (status === 'replied') {
      statusBg = '#dbeafe';
      statusColor = '#1d4ed8';
    } else if (status === 'failed' || status === 'stopped') {
      statusBg = '#fee2e2';
      statusColor = '#b91c1c';
    } else if (status === 'completed' || status === 'accepted' || status === 'done') {
      statusBg = '#f3e8ff';
      statusColor = '#7e22ce';
    }

    const nextRun = targetLead.nextRunAt || targetLead.nextAt || 0;
    let countdownText = '⚡ Due now (ready for next tick)';
    if (status === 'completed' || status === 'done' || status === 'accepted') {
      countdownText = '✓ Sequence finished';
    } else if (status === 'replied') {
      countdownText = '💬 Replied — Stopped on reply';
    } else if (nextRun > now) {
      const diffMs = nextRun - now;
      const totalSec = Math.floor(diffMs / 1000);
      const hrs = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      const resumesAt = new Date(nextRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      countdownText = `⏳ In ${timeStr} (at ${resumesAt})`;
    }

    let historyItems = Array.isArray(targetLead.history) && targetLead.history.length > 0
      ? [...targetLead.history]
      : [];

    if (historyItems.length === 0) {
      historyItems.push({
        step: 'enrolled',
        label: 'Enrolled in campaign',
        status: 'completed',
        timestamp: targetLead.enrolledAt || (now - 3600000),
      });
      if (targetLead.lastActionAt && targetLead.lastActionAt > (targetLead.enrolledAt || 0)) {
        historyItems.push({
          step: 'action',
          label: 'Outreach step executed',
          status: 'completed',
          timestamp: targetLead.lastActionAt,
        });
      }
    }

    const formatTimestamp = (ts) => {
      if (!ts) return '';
      const d = new Date(ts);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const getStepIcon = (h) => {
      const s = String(h.step || '').toLowerCase();
      if (s === 'enrolled') return '📥';
      if (s === 'view' || s === 'visit') return '👁️';
      if (s === 'invite') return '🤝';
      if (s === 'accepted') return '🎉';
      if (s === 'message') return '💬';
      if (s === 'email') return '✉️';
      if (s === 'replied' || s === 'reply') return '🗣️';
      if (s === 'retrying') return '🔁';
      if (s === 'completed' || s === 'finish') return '🏁';
      if (h.status === 'failed') return '⚠️';
      if (h.status === 'quota_postponed') return '📅';
      if (h.status === 'cooldown_postponed') return '🛡️';
      return '⚡';
    };

    const initial = (targetLead.fullName?.[0] || targetLead.publicId?.[0] || 'L').toUpperCase();

    backdrop.innerHTML = `
      <div class="waalaxy-modal-card" style="max-width: 580px; width: 92%; max-height: 88vh; display: flex; flex-direction: column; padding: 0; overflow: hidden; border-radius: 16px; border: 1px solid #fed7aa; box-shadow: 0 20px 40px rgba(255, 107, 0, 0.12), 0 1px 3px rgba(0,0,0,0.1);">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #fff7ed 0%, #ffedd5 100%); padding: 20px 24px; border-bottom: 1px solid #fed7aa; display: flex; justify-content: space-between; align-items: flex-start;">
          <div style="display: flex; gap: 14px; align-items: center;">
            <div style="width: 44px; height: 44px; border-radius: 50%; background: #ff6b00; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; box-shadow: 0 4px 10px rgba(255, 107, 0, 0.3);">
              ${initial}
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <h3 style="margin: 0; font-size: 17px; font-weight: 700; color: #1e293b;">${targetLead.fullName}</h3>
                <span style="background: ${statusBg}; color: ${statusColor}; font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; letter-spacing: 0.5px;">${statusUpper}</span>
              </div>
              <div style="font-size: 12.5px; color: #64748b; margin-top: 3px;">
                ${targetLead.company ? `<span>${targetLead.company}</span> · ` : ''}
                <span style="color: #ff6b00; font-weight: 600;">${campName || 'Campaign'}</span>
                ${targetLead.email ? ` · <span style="color: #475569;">${targetLead.email}</span>` : ''}
              </div>
            </div>
          </div>
          <button type="button" class="waalaxy-modal-close" id="modal-btn-close" style="font-size: 18px; color: #64748b; background: transparent; border: none; cursor: pointer; padding: 4px;">✕</button>
        </div>

        <!-- Body Scrollable -->
        <div style="padding: 24px; overflow-y: auto; flex: 1;">
          
          <!-- Current Step & Next Execution Box -->
          <div style="background: #ffffff; border: 1px solid #f1f5f9; border-radius: 12px; padding: 16px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 11.5px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Current Position</span>
              <span style="font-size: 12.5px; font-weight: 600; color: #ff6b00;">${targetLead.currentStepLabel || 'In Progress'}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 11.5px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px;">Next Scheduled Run</span>
              <span style="font-size: 12.5px; font-weight: 600; color: #1e293b;">${countdownText}</span>
            </div>
            ${targetLead.lastError ? `
              <div style="margin-top: 12px; padding: 10px 12px; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; font-size: 12px; color: #be123c; display: flex; gap: 8px; align-items: flex-start;">
                <span>⚠️</span>
                <div>
                  <div style="font-weight: 700; margin-bottom: 2px;">Notice / Last Reason:</div>
                  <div>${targetLead.lastError}</div>
                </div>
              </div>
            ` : ''}
          </div>

          <!-- Chronological Step Timeline -->
          <div style="margin-bottom: 12px;">
            <h4 style="margin: 0 0 16px 0; font-size: 13.5px; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 6px;">
              <span>Sequence Timeline</span>
              <span style="font-size: 11px; background: #f1f5f9; color: #64748b; padding: 2px 6px; border-radius: 9999px;">${historyItems.length} events</span>
            </h4>

            <div style="position: relative; padding-left: 28px; border-left: 2px solid #ffedd5; margin-left: 10px;">
              ${historyItems.map((h, i) => `
                <div style="position: relative; margin-bottom: 20px;">
                  <!-- Dot -->
                  <div style="position: absolute; left: -37px; top: 0px; width: 20px; height: 20px; border-radius: 50%; background: #fff7ed; border: 2px solid #ff6b00; display: flex; align-items: center; justify-content: center; font-size: 10px;">
                    ${getStepIcon(h)}
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: baseline;">
                    <span style="font-size: 13px; font-weight: 700; color: #1e293b;">${h.label || h.step}</span>
                    <span style="font-size: 11px; color: #94a3b8; font-weight: 500;">${formatTimestamp(h.timestamp)}</span>
                  </div>
                  ${h.error ? `<div style="font-size: 11.5px; color: #e11d48; margin-top: 2px;">${h.error}</div>` : ''}
                  ${h.reason ? `<div style="font-size: 11.5px; color: #64748b; margin-top: 2px;">Reason: ${h.reason}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div style="padding: 14px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
          ${targetLead.publicId ? `
            <a href="https://www.linkedin.com/in/${targetLead.publicId}" target="_blank" style="font-size: 12px; color: #ff6b00; font-weight: 600; text-decoration: none; display: flex; align-items: center; gap: 4px;">
              View LinkedIn Profile ↗
            </a>
          ` : '<div></div>'}
          <button type="button" class="btn-modal-primary" id="modal-btn-close-footer" style="padding: 7px 18px; font-size: 12.5px; background: #ff6b00; color: #ffffff; border-radius: 8px; border: none; cursor: pointer; font-weight: 600;">
            Close
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(backdrop);

    const closeBtn = backdrop.querySelector('#modal-btn-close');
    const footerCloseBtn = backdrop.querySelector('#modal-btn-close-footer');

    const cleanup = () => {
      document.removeEventListener('keydown', handleKey);
      backdrop.remove();
      resolve(true);
    };

    const handleKey = (e) => {
      if (e.key === 'Escape') cleanup();
    };

    closeBtn?.addEventListener('click', cleanup);
    footerCloseBtn?.addEventListener('click', cleanup);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) cleanup();
    });

    document.addEventListener('keydown', handleKey);
  });
}

