/**
 * OutFox — Waalaxy Visual Node Sequence Builder Canvas
 * Interactive glassmorphic node cards, curved SVG connectors with flowing pulse dots,
 * and dual condition branching paths.
 */

import { ICONS } from '../ui/icons.js';

/** Default template if no steps provided */
export const DEFAULT_SEQUENCE = [
  { type: 'view' },
  { type: 'wait', waitMs: 86400000 },
  {
    type: 'invite',
    note: 'Hi {{firstName|there}} — I follow your work at {{company|your company}} and would love to connect.',
    useAi: true,
  },
  {
    type: 'branch',
    branch: {
      on: 'accepted',
      ms: 172800000,
      then: [
        {
          type: 'message',
          body: 'Thanks for connecting, {{firstName|there}}! What is your main focus this quarter?',
        },
      ],
      else: [
        {
          type: 'email',
          subject: 'Quick question regarding {{company|your company}}',
          body: 'Hi {{firstName|there}}, following up on my LinkedIn note...',
        },
      ],
    },
  },
];

/**
 * Format milliseconds into a readable delay label.
 */
function formatWait(ms) {
  const value = Number(ms) || 0;
  if (value >= 86400000) return `${Math.round(value / 86400000)} days`;
  if (value >= 3600000) return `${Math.round(value / 3600000)} hours`;
  if (value >= 60000) return `${Math.round(value / 60000)} minutes`;
  return 'Immediate';
}

/**
 * Step metadata mapping
 */
function getStepMeta(step) {
  switch (step.type) {
    case 'view':
      return {
        icon: ICONS.visit,
        title: 'View Profile',
        delayText: '5–10s delay',
        preview: 'Warm profile visit to appear in "Who viewed your profile"',
        useAi: false,
      };
    case 'follow':
      return {
        icon: ICONS.follow,
        title: 'Follow Profile',
        delayText: '1 day wait',
        preview: 'Follow prospect activity feed for organic touchpoint',
        useAi: false,
      };
    case 'wait':
      return {
        icon: ICONS.clock,
        title: 'Safety Wait',
        delayText: formatWait(step.waitMs),
        preview: `Pacing pause of ${formatWait(step.waitMs)} to mimic human browsing habits`,
        useAi: false,
      };
    case 'invite':
      return {
        icon: ICONS.invitation,
        title: 'Send Invite',
        delayText: '1 day wait',
        preview: step.note || (step.variants ? step.variants[0] : 'Hi {{firstName|there}} — would love to connect!'),
        useAi: Boolean(step.useAi || (step.note && step.note.includes('{{ai_opener}}'))),
      };
    case 'message':
      return {
        icon: ICONS.message,
        title: 'LinkedIn Message',
        delayText: '2 days wait',
        preview: step.body || (step.variants ? step.variants[0] : 'Thanks for connecting, {{firstName}}!'),
        useAi: false,
      };
    case 'email':
      return {
        icon: ICONS.email,
        title: 'Real Gmail Cold Email',
        delayText: '3 days wait',
        preview: step.subject ? `Subject: ${step.subject}` : 'Official Gmail API REST outreach',
        useAi: false,
      };
    case 'inmail':
      return {
        icon: ICONS.email,
        title: 'Free InMail',
        delayText: '1 day wait',
        preview: step.subject ? `Subject: ${step.subject}` : 'InMail routed via Open Profile',
        useAi: false,
      };
    case 'like':
      return {
        icon: ICONS.thumbsUp,
        title: 'Like Post',
        delayText: '1 day wait',
        preview: 'Engage with latest post',
        useAi: false,
      };
    case 'branch':
      return {
        icon: ICONS.clock,
        title: 'Acceptance Check',
        delayText: '2 days wait',
        preview: 'Did prospect accept connection request within 2 days?',
        useAi: false,
      };
    default:
      return {
        icon: ICONS.settings,
        title: step.type || 'Custom Step',
        delayText: 'Immediate',
        preview: JSON.stringify(step),
        useAi: false,
      };
  }
}

/**
 * Generate SVG curved Bezier connector with flowing dot
 */
function createConnectorSvg(pathD = 'M 50,0 C 50,25 50,25 50,50', width = 100, height = 50) {
  return `
    <div class="node-connector-wrapper">
      <svg class="node-connector-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <path d="${pathD}" stroke="#5A45FF" stroke-width="2" fill="none" stroke-dasharray="4 4" opacity="0.8" />
        <circle r="4" fill="#00F298">
          <animateMotion dur="2.2s" repeatCount="indefinite" path="${pathD}" />
        </circle>
      </svg>
    </div>
  `;
}

/**
 * Render single node card HTML
 */
function renderCardHtml(step, id, isBranchChild = false, branchType = '') {
  const meta = getStepMeta(step);
  const borderClass = branchType === 'yes' ? 'border-branch-yes' : branchType === 'no' ? 'border-branch-no' : '';

  return `
    <div class="node-card glass-card ${borderClass}" data-step-id="${id}">
      <div class="node-header">
        <span class="node-icon">${meta.icon}</span>
        <span class="node-title">${meta.title}</span>
        <span class="node-delay-badge">${meta.delayText}</span>
      </div>
      <div class="node-body">
        <p class="node-preview">${meta.preview}</p>
        ${meta.useAi ? `<span class="ai-badge">${ICONS.sparkles} Gemini/Groq AI Hook</span>` : ''}
      </div>
      <div class="node-actions">
        <button type="button" class="node-btn edit-step" data-action="edit" data-id="${id}">${ICONS.edit} Edit</button>
        ${!isBranchChild ? `<button type="button" class="node-btn delete-step" data-action="delete" data-id="${id}">${ICONS.trash} Delete</button>` : ''}
      </div>
    </div>
  `;
}

/**
 * Main Visual Sequence Builder Renderer
 * @param {HTMLElement} container
 * @param {Array} sequenceSteps
 * @param {(updatedSteps: Array) => void} onStepUpdate
 */
export function renderVisualSequence(container, sequenceSteps = [], onStepUpdate = () => {}) {
  if (!container) return;

  const steps = sequenceSteps && sequenceSteps.length > 0 ? sequenceSteps : JSON.parse(JSON.stringify(DEFAULT_SEQUENCE));

  let html = `
    <div class="sequence-canvas-header">
      <div class="canvas-title-group">
        <h3 class="canvas-title">Visual Sequence Workflow</h3>
        <p class="canvas-sub">Interactive Waalaxy-style visual pipeline with dynamic Bezier connectors & branching</p>
      </div>
      <button type="button" class="btn btn-primary btn-sm" id="btn-add-initial-step">+ Append Step</button>
    </div>
    <div class="sequence-canvas" id="sequence-canvas-flow">
  `;

  steps.forEach((step, idx) => {
    if (step.type === 'branch') {
      // Branch Condition Card
      html += renderCardHtml(step, idx);

      // Split into Path A (Yes) and Path B (No)
      const thenStep = step.branch?.then?.[0] || { type: 'message', body: 'Thanks for connecting!' };
      const elseStep = step.branch?.else?.[0] || { type: 'email', subject: 'Quick follow-up', body: 'Hi {{firstName}}...' };

      html += `
        <div class="branch-connector-split">
          <svg width="260" height="40" viewBox="0 0 260 40" class="branch-split-svg">
            <!-- Left curve to Yes -->
            <path d="M 130,0 C 130,20 60,20 60,40" stroke="#00F298" stroke-width="2" fill="none" stroke-dasharray="4 4" />
            <circle r="4" fill="#00F298"><animateMotion dur="2s" repeatCount="indefinite" path="M 130,0 C 130,20 60,20 60,40" /></circle>
            <!-- Right curve to No -->
            <path d="M 130,0 C 130,20 200,20 200,40" stroke="#FFB800" stroke-width="2" fill="none" stroke-dasharray="4 4" />
            <circle r="4" fill="#FFB800"><animateMotion dur="2s" repeatCount="indefinite" path="M 130,0 C 130,20 200,20 200,40" /></circle>
          </svg>
        </div>

        <div class="branch-container">
          <!-- Path A: Accepted -->
          <div class="branch-path branch-path-yes">
            <span class="branch-path-badge branch-badge-yes">${ICONS.check} Accepted</span>
            ${renderCardHtml(thenStep, `${idx}-then-0`, true, 'yes')}
          </div>

          <!-- Path B: Not Accepted -->
          <div class="branch-path branch-path-no">
            <span class="branch-path-badge branch-badge-no">${ICONS.x} Not Accepted</span>
            ${renderCardHtml(elseStep, `${idx}-else-0`, true, 'no')}
          </div>
        </div>
      `;
    } else {
      html += renderCardHtml(step, idx);
    }

    // Add connector between steps (except after the last step)
    if (idx < steps.length - 1) {
      html += createConnectorSvg('M 50,0 C 50,25 50,25 50,50', 100, 50);
      html += `
        <div class="add-step-inline-wrapper">
          <button type="button" class="btn-add-step-inline" data-insert-index="${idx + 1}" title="Insert step here">+</button>
        </div>
      `;
      html += createConnectorSvg('M 50,0 C 50,25 50,25 50,50', 100, 50);
    }
  });

  html += `
    </div>

    <!-- Edit Step Modal -->
    <div class="modal-backdrop hidden" id="modal-edit-step">
      <div class="modal-dialog glass-card">
        <div class="modal-head">
          <h3 class="modal-title" id="edit-step-modal-title">Edit Sequence Step</h3>
          <button type="button" class="btn-close-modal" id="btn-close-edit-modal">${ICONS.x}</button>
        </div>
        <div class="modal-body">
          <div class="form-group" id="edit-template-group">
            <label for="edit-step-text">Message / Note Content</label>
            <textarea id="edit-step-text" class="form-input" rows="4"></textarea>
            <small style="color: #8E87A5; font-size: 11px;">Variables: {{firstName}}, {{lastName}}, {{company}}, {{title}}, {{ai_opener}}</small>
          </div>
          <div class="form-group" id="edit-delay-group">
            <label for="edit-step-wait">Delay (Hours)</label>
            <input type="number" id="edit-step-wait" class="form-input" min="1" max="168" value="24" />
          </div>
          <div class="form-check-group" id="edit-ai-group">
            <label class="check-label">
              <input type="checkbox" id="edit-step-ai" />
              <span>Use Groq/Gemini AI personalization hook ({{ai_opener}})</span>
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" id="btn-cancel-edit-modal">Cancel</button>
          <button type="button" class="btn btn-primary" id="btn-save-edit-step">Save Changes</button>
        </div>
      </div>
    </div>

    <!-- Step Type Picker Modal -->
    <div class="modal-backdrop hidden" id="modal-pick-step">
      <div class="modal-dialog glass-card" style="width: 440px;">
        <div class="modal-head">
          <h3 class="modal-title">Choose Next Action</h3>
          <button type="button" class="btn-close-modal" id="btn-close-pick-modal">${ICONS.x}</button>
        </div>
        <div class="modal-body">
          <div class="step-picker-grid">
            <button type="button" class="picker-btn" data-type="view">
              <span class="picker-icon">${ICONS.visit}</span>
              <div class="picker-info"><span class="picker-name">View Profile</span><span class="picker-sub">Warm visit</span></div>
            </button>
            <button type="button" class="picker-btn" data-type="invite">
              <span class="picker-icon">${ICONS.invitation}</span>
              <div class="picker-info"><span class="picker-name">Send Invite</span><span class="picker-sub">With note & AI opener</span></div>
            </button>
            <button type="button" class="picker-btn" data-type="message">
              <span class="picker-icon">${ICONS.message}</span>
              <div class="picker-info"><span class="picker-name">LinkedIn Message</span><span class="picker-sub">Follow-up chat</span></div>
            </button>
            <button type="button" class="picker-btn" data-type="email">
              <span class="picker-icon">${ICONS.email}</span>
              <div class="picker-info"><span class="picker-name">Gmail Cold Email</span><span class="picker-sub">Official Gmail REST</span></div>
            </button>
            <button type="button" class="picker-btn" data-type="wait">
              <span class="picker-icon">${ICONS.clock}</span>
              <div class="picker-info"><span class="picker-name">Safety Wait</span><span class="picker-sub">Pacing delay</span></div>
            </button>
            <button type="button" class="picker-btn" data-type="follow">
              <span class="picker-icon">${ICONS.follow}</span>
              <div class="picker-info"><span class="picker-name">Follow Profile</span><span class="picker-sub">Feed engagement</span></div>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Wire Interactions
  let activeEditTarget = null;
  let activeInsertIndex = steps.length;

  const modalEdit = container.querySelector('#modal-edit-step');
  const modalPick = container.querySelector('#modal-pick-step');

  const closeEdit = () => modalEdit?.classList.add('hidden');
  const closePick = () => modalPick?.classList.add('hidden');

  container.querySelector('#btn-close-edit-modal')?.addEventListener('click', closeEdit);
  container.querySelector('#btn-cancel-edit-modal')?.addEventListener('click', closeEdit);
  container.querySelector('#btn-close-pick-modal')?.addEventListener('click', closePick);

  // Edit Step Click Handlers
  container.querySelectorAll('.edit-step').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const stepId = btn.dataset.id;
      activeEditTarget = stepId;

      let targetStep = null;
      if (stepId.includes('-then-')) {
        const rootIdx = parseInt(stepId.split('-then-')[0], 10);
        targetStep = steps[rootIdx]?.branch?.then?.[0];
      } else if (stepId.includes('-else-')) {
        const rootIdx = parseInt(stepId.split('-else-')[0], 10);
        targetStep = steps[rootIdx]?.branch?.else?.[0];
      } else {
        targetStep = steps[parseInt(stepId, 10)];
      }

      if (!targetStep) return;

      const editTitle = container.querySelector('#edit-step-modal-title');
      const editText = container.querySelector('#edit-step-text');
      const editAi = container.querySelector('#edit-step-ai');
      const editWait = container.querySelector('#edit-step-wait');

      if (editTitle) editTitle.textContent = `Edit ${targetStep.type.toUpperCase()} Step`;
      if (editText) editText.value = targetStep.note || targetStep.body || targetStep.variants?.[0] || '';
      if (editAi) editAi.checked = Boolean(targetStep.useAi);
      if (editWait) editWait.value = targetStep.waitMs ? Math.round(targetStep.waitMs / 3600000) : 24;

      modalEdit?.classList.remove('hidden');
    });
  });

  // Save Edit Step
  container.querySelector('#btn-save-edit-step')?.addEventListener('click', () => {
    if (activeEditTarget === null) return;
    const editText = container.querySelector('#edit-step-text')?.value;
    const editAi = container.querySelector('#edit-step-ai')?.checked;
    const editWaitHours = Number(container.querySelector('#edit-step-wait')?.value) || 24;

    let targetStep = null;
    if (activeEditTarget.includes('-then-')) {
      const rootIdx = parseInt(activeEditTarget.split('-then-')[0], 10);
      targetStep = steps[rootIdx]?.branch?.then?.[0];
    } else if (activeEditTarget.includes('-else-')) {
      const rootIdx = parseInt(activeEditTarget.split('-else-')[0], 10);
      targetStep = steps[rootIdx]?.branch?.else?.[0];
    } else {
      targetStep = steps[parseInt(activeEditTarget, 10)];
    }

    if (targetStep) {
      if (targetStep.type === 'invite') {
        targetStep.note = editText;
        targetStep.useAi = editAi;
      } else if (targetStep.type === 'message' || targetStep.type === 'email') {
        targetStep.body = editText;
      }
      if (targetStep.waitMs !== undefined) {
        targetStep.waitMs = editWaitHours * 3600000;
      }
    }

    closeEdit();
    onStepUpdate(steps);
    renderVisualSequence(container, steps, onStepUpdate);
  });

  // Delete Step Click Handlers
  container.querySelectorAll('.delete-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.id, 10);
      if (!isNaN(idx) && idx >= 0 && idx < steps.length) {
        steps.splice(idx, 1);
        onStepUpdate(steps);
        renderVisualSequence(container, steps, onStepUpdate);
      }
    });
  });

  // Add Step Pickers
  const openPicker = (insertIdx) => {
    activeInsertIndex = insertIdx;
    modalPick?.classList.remove('hidden');
  };

  container.querySelector('#btn-add-initial-step')?.addEventListener('click', () => {
    openPicker(steps.length);
  });

  container.querySelectorAll('.btn-add-step-inline').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.insertIndex, 10);
      openPicker(idx);
    });
  });

  // Pick Action Type
  container.querySelectorAll('.picker-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      let newStep = { type };
      if (type === 'invite') newStep = { type, note: 'Hi {{firstName}} — would love to connect!', useAi: true };
      else if (type === 'message') newStep = { type, body: 'Thanks for connecting, {{firstName}}!' };
      else if (type === 'email') newStep = { type, subject: 'Reaching out', body: 'Hi {{firstName}}...' };
      else if (type === 'wait') newStep = { type, waitMs: 86400000 };

      steps.splice(activeInsertIndex, 0, newStep);
      closePick();
      onStepUpdate(steps);
      renderVisualSequence(container, steps, onStepUpdate);
    });
  });
}

