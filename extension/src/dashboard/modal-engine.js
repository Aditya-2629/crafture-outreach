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

