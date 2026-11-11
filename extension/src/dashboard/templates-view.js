/**
 * OutFox — Waalaxy Messages Management & Template Editor
 * Fully working Emoji Picker, Image Uploader, File Attachment, and GIF Selector.
 */

import { openUiConfirm } from './modal-engine.js';
import { ICONS } from '../ui/icons.js';

let activeCategory = 'message';

const POPULAR_EMOJIS = [
  '👋', '😊', '🚀', '💡', '🔥', '👍', '✨', '🤝',
  '🎯', '📈', '💼', '✉️', '☕', '🙌', '👏', '🎉',
  '🌟', '🔍', '📊', '⚡', '💬', '👤', '🏢', '💻',
  '📌', '🏆', '💯', '✌️', '🤩', '🤖', '⭐', '📬'
];

const PRESET_GIFS = [
  { id: 'wave', title: 'Wave Hello', icon: '👋' },
  { id: 'thumbsup', title: 'Thumbs Up', icon: '👍' },
  { id: 'coffee', title: 'Coffee Cheers', icon: '☕' },
  { id: 'mindblown', title: 'Mind Blown', icon: '🤯' },
  { id: 'launch', title: 'Rocket Launch', icon: '🚀' },
  { id: 'highfive', title: 'High Five', icon: '🙌' }
];

export function openEditMessageModal({ template = null, category = 'message', onSave }) {
  ensureTemplatesStyles();
  const existing = document.getElementById('modal-edit-message-backdrop');
  if (existing) existing.remove();

  const isNew = !template;
  let modelName = template?.name || (category === 'invitation' ? 'Invitation Note' : category === 'email' ? 'Cold Email' : 'Message');
  let content = template?.content || '';
  let attachments = template?.attachments || [];

  const backdrop = document.createElement('div');
  backdrop.id = 'modal-edit-message-backdrop';
  backdrop.className = 'edit-msg-modal-backdrop';

  function renderModal() {
    const hasFirstName = content.includes('{{firstName}}');
    const charLen = content.length;
    const isGoodLength = charLen >= 100 && charLen <= 500;
    const isTooLong = charLen > 500;

    const lower = content.toLowerCase();
    const pronounsCount = (lower.match(/\b(i|we)\b/g) || []).length;
    const isPronounGood = pronounsCount <= 1;
    const hasSpamPoliteness = /\b(sincerely|best regards|warm regards|yours truly|cheers)\b/i.test(content);

    let previewText = (content || 'Your message will appear here...')
      .replace(/\{\{firstName\}\}/g, '<strong style="color:#ff6b00;">Alex</strong>')
      .replace(/\{\{lastName\}\}/g, '<strong style="color:#ff6b00;">Rivera</strong>')
      .replace(/\{\{fullName\}\}/g, '<strong style="color:#ff6b00;">Alex Rivera</strong>')
      .replace(/\{\{company(?:Name)?\}\}/g, '<strong style="color:#ff6b00;">CloudScale Technologies</strong>')
      .replace(/\{\{jobTitle\}\}/g, '<strong style="color:#ff6b00;">Head of Growth</strong>')
      .replace(/\{\{headline\}\}/g, '<strong style="color:#ff6b00;">Head of Growth at CloudScale Technologies</strong>')
      .replace(/\{\{location\}\}/g, '<strong style="color:#ff6b00;">San Francisco, CA</strong>')
      .replace(/\{\{industry\}\}/g, '<strong style="color:#ff6b00;">Information Technology</strong>')
      .replace(/\{\{email\}\}/g, '<strong style="color:#ff6b00;">alex@cloudscale.io</strong>')
      .replace(/\{\{icebreaker\}\}/g, '<strong style="color:#ff6b00;">Saw your recent post on scaling SaaS sales teams — really resonated!</strong>')
      .replace(/\{\{mutualCount\}\}/g, '<strong style="color:#ff6b00;">14</strong>');

    backdrop.innerHTML = `
      <div class="edit-msg-modal-card">
        <div class="edit-msg-modal-head">
          <h2 class="edit-msg-title">${isNew ? 'Create a message template' : 'Edit a message'}</h2>
          <button type="button" class="btn-close-modal" id="btn-close-edit-modal">${ICONS.x}</button>
        </div>

        <div class="edit-msg-modal-grid">
          <div class="edit-msg-left-col">
            <div class="edit-msg-inputs-row">
              <div class="input-group-half">
                <label class="edit-msg-label">Message model</label>
                <div class="select-model-pill">Custom Template ⌵</div>
              </div>
              <div class="input-group-half">
                <div class="label-with-counter">
                  <label class="edit-msg-label">Model name</label>
                  <span class="char-count-mini" id="model-name-counter">${modelName.length}/50</span>
                </div>
                <input type="text" id="input-model-name" class="input-text-model" value="${modelName}" maxlength="50" placeholder="e.g. Founder Intro" />
              </div>
            </div>

            <div class="textarea-wrapper">
              <textarea id="textarea-msg-content" class="composer-textarea-full" placeholder="Write something amazing..." maxlength="8000">${content}</textarea>
              
              ${attachments.length > 0 ? `
                <div class="attachments-chips-row">
                  ${attachments.map((att, idx) => `
                    <div class="att-chip">
                      <span class="att-chip-icon">${att.type === 'image' ? ICONS.image : att.type === 'gif' ? ICONS.gif : ICONS.paperclip}</span>
                      <span class="att-chip-title">${att.name}</span>
                      ${att.size ? `<span class="att-chip-size">(${att.size})</span>` : ''}
                      <button type="button" class="btn-remove-att" data-att-idx="${idx}" title="Remove">${ICONS.x}</button>
                    </div>
                  `).join('')}
                </div>
              ` : ''}

              <div class="textarea-bottom-bar">
                <span class="char-count-total" id="content-char-counter">${content.length}/8000</span>
              </div>
            </div>

            <div class="edit-msg-toolbar">
              <div class="variable-dropdown-wrap" style="position:relative;">
                <button type="button" class="btn-pill-variable" id="btn-var-dropdown">
                  Insert a variable ⌵
                </button>
                <div class="var-menu-dropdown hidden" id="var-menu-dropdown">
                  <div class="var-menu-item" data-var="{{firstName}}">
                    <span>{{firstName}}</span>
                    <span class="var-desc">First Name</span>
                  </div>
                  <div class="var-menu-item" data-var="{{lastName}}">
                    <span>{{lastName}}</span>
                    <span class="var-desc">Last Name</span>
                  </div>
                  <div class="var-menu-item" data-var="{{fullName}}">
                    <span>{{fullName}}</span>
                    <span class="var-desc">Full Name</span>
                  </div>
                  <div class="var-menu-item" data-var="{{company}}">
                    <span>{{company}}</span>
                    <span class="var-desc">Company</span>
                  </div>
                  <div class="var-menu-item" data-var="{{jobTitle}}">
                    <span>{{jobTitle}}</span>
                    <span class="var-desc">Job Title / Position</span>
                  </div>
                  <div class="var-menu-item" data-var="{{headline}}">
                    <span>{{headline}}</span>
                    <span class="var-desc">LinkedIn Headline</span>
                  </div>
                  <div class="var-menu-item" data-var="{{location}}">
                    <span>{{location}}</span>
                    <span class="var-desc">City / Country</span>
                  </div>
                  <div class="var-menu-item" data-var="{{industry}}">
                    <span>{{industry}}</span>
                    <span class="var-desc">Industry</span>
                  </div>
                  <div class="var-menu-item" data-var="{{email}}">
                    <span>{{email}}</span>
                    <span class="var-desc">Work / Personal Email</span>
                  </div>
                  <div class="var-menu-item" data-var="{{icebreaker}}">
                    <span>{{icebreaker}}</span>
                    <span class="var-desc">AI Personalized Hook</span>
                  </div>
                  <div class="var-menu-item" data-var="{{mutualCount}}">
                    <span>{{mutualCount}}</span>
                    <span class="var-desc">Mutual Connections Count</span>
                  </div>
                </div>
              </div>

              <div class="toolbar-media-icons">
                <div class="media-popover-wrap" style="position:relative;">
                  <button type="button" class="tool-icon-btn" id="btn-open-emojis" title="Add Emoji">${ICONS.smile}</button>
                  <div class="emoji-picker-popover hidden" id="emoji-picker-popover">
                    <div class="emoji-grid">
                      ${POPULAR_EMOJIS.map((em) => `<button type="button" class="emoji-select-btn" data-emoji="${em}">${em}</button>`).join('')}
                    </div>
                  </div>
                </div>

                <button type="button" class="tool-icon-btn" id="btn-attach-image" title="Attach Image">${ICONS.image}</button>
                <input type="file" id="hidden-image-file" accept="image/*" style="display:none;" />

                <button type="button" class="tool-icon-btn" id="btn-attach-file" title="Attach Document">${ICONS.paperclip}</button>
                <input type="file" id="hidden-doc-file" accept=".pdf,.doc,.docx,.csv,.xlsx,.txt" style="display:none;" />

                <div class="media-popover-wrap" style="position:relative;">
                  <button type="button" class="tool-icon-btn btn-gif-text" id="btn-open-gifs" title="Attach GIF">${ICONS.gif}</button>
                  <div class="gif-picker-popover hidden" id="gif-picker-popover">
                    <div class="gif-popover-head">Select Outreach GIF</div>
                    <div class="gif-grid">
                      ${PRESET_GIFS.map((g) => `
                        <div class="gif-item-card" data-gif-title="${g.title}" data-gif-icon="${g.icon}">
                          <span class="gif-card-icon">${g.icon}</span>
                          <span class="gif-card-name">${g.title}</span>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                </div>
              </div>

              <button type="button" class="btn-confirm-save" id="btn-confirm-save-msg">
                Confirm
              </button>
            </div>
          </div>

          <div class="edit-msg-right-col">
            <div class="advice-card">
              <div class="advice-card-head">
                <span class="advice-icon">${ICONS.message}</span>
                <div>
                  <h4 class="advice-title">Check your message</h4>
                  <p class="advice-sub">Skyrocket response with expert advice</p>
                </div>
              </div>

              <div class="advice-checklist">
                <div class="checklist-item ${hasFirstName ? 'is-good' : 'is-bad'}">
                  <span class="check-status-icon">${hasFirstName ? ICONS.check : ICONS.x}</span>
                  <span>use {{firstName}} variable</span>
                </div>
                <div class="checklist-item ${isGoodLength ? 'is-good' : isTooLong ? 'is-bad' : 'is-neutral'}">
                  <span class="check-status-icon">${isGoodLength ? ICONS.check : isTooLong ? ICONS.x : ICONS.dot}</span>
                  <span>use between 100 and 500 characters</span>
                </div>
                <div class="checklist-item is-good">
                  <span class="check-status-icon">${ICONS.check}</span>
                  <span>don't use your first name or last name</span>
                </div>
                <div class="checklist-item ${isPronounGood ? 'is-good' : 'is-bad'}">
                  <span class="check-status-icon">${isPronounGood ? ICONS.check : ICONS.x}</span>
                  <span>don't use the pronoun "I" or "we" more than once</span>
                </div>
                <div class="checklist-item ${!hasSpamPoliteness ? 'is-good' : 'is-bad'}">
                  <span class="check-status-icon">${!hasSpamPoliteness ? ICONS.check : ICONS.x}</span>
                  <span>avoid politeness e.g. "Sincerely", "Best regards"</span>
                </div>
              </div>
            </div>

            <div class="preview-card">
              <div class="preview-card-head">
                <span class="preview-title">Preview</span>
                <span class="preview-sub">How your prospect will see your message ⌵</span>
              </div>
              <div class="preview-bubble-body">
                <div class="preview-msg-text">${previewText}</div>
                ${attachments.length > 0 ? `
                  <div class="preview-att-box">
                    ${attachments.map((att) => `
                      <div class="preview-att-pill">
                        <span>${att.type === 'image' ? ICONS.image : att.type === 'gif' ? ICONS.gif : ICONS.paperclip}</span>
                        <span>${att.name}</span>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    wireModalEvents();
  }

  function wireModalEvents() {
    backdrop.querySelector('#btn-close-edit-modal').addEventListener('click', () => backdrop.remove());

    const nameInput = backdrop.querySelector('#input-model-name');
    nameInput.addEventListener('input', (e) => {
      modelName = e.target.value;
      const countEl = backdrop.querySelector('#model-name-counter');
      if (countEl) countEl.textContent = `${modelName.length}/50`;
    });

    const textarea = backdrop.querySelector('#textarea-msg-content');
    textarea.addEventListener('input', (e) => {
      content = e.target.value;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      renderModal();
      const updated = backdrop.querySelector('#textarea-msg-content');
      if (updated) {
        updated.focus();
        updated.setSelectionRange(start, end);
      }
    });

    const varBtn = backdrop.querySelector('#btn-var-dropdown');
    const varMenu = backdrop.querySelector('#var-menu-dropdown');
    varBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      varMenu.classList.toggle('hidden');
    });

    backdrop.querySelectorAll('.var-menu-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        insertTextAtCursor(item.dataset.var);
        varMenu.classList.add('hidden');
      });
    });

    // 1. Emoji picker
    const emojiBtn = backdrop.querySelector('#btn-open-emojis');
    const emojiPop = backdrop.querySelector('#emoji-picker-popover');
    emojiBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      emojiPop.classList.toggle('hidden');
    });

    backdrop.querySelectorAll('.emoji-select-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        insertTextAtCursor(btn.dataset.emoji);
        emojiPop.classList.add('hidden');
      });
    });

    // 2. Image picker
    const imgBtn = backdrop.querySelector('#btn-attach-image');
    const imgFile = backdrop.querySelector('#hidden-image-file');
    imgBtn.addEventListener('click', () => imgFile.click());
    imgFile.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const sizeStr = (file.size / 1024).toFixed(0) + ' KB';
        attachments.push({ type: 'image', name: file.name, size: sizeStr });
        renderModal();
      }
    });

    // 3. Document picker
    const docBtn = backdrop.querySelector('#btn-attach-file');
    const docFile = backdrop.querySelector('#hidden-doc-file');
    docBtn.addEventListener('click', () => docFile.click());
    docFile.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const sizeStr = file.size > 1024 * 1024 ? (file.size / (1024 * 1024)).toFixed(1) + ' MB' : (file.size / 1024).toFixed(0) + ' KB';
        attachments.push({ type: 'file', name: file.name, size: sizeStr });
        renderModal();
      }
    });

    // 4. GIF picker
    const gifBtn = backdrop.querySelector('#btn-open-gifs');
    const gifPop = backdrop.querySelector('#gif-picker-popover');
    gifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      gifPop.classList.toggle('hidden');
    });

    backdrop.querySelectorAll('.gif-item-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const title = card.dataset.gifTitle;
        const icon = card.dataset.gifIcon;
        attachments.push({ type: 'gif', name: `GIF: ${title}`, icon });
        gifPop.classList.add('hidden');
        renderModal();
      });
    });

    document.addEventListener('click', () => {
      varMenu.classList.add('hidden');
      if (emojiPop) emojiPop.classList.add('hidden');
      if (gifPop) gifPop.classList.add('hidden');
    });

    backdrop.querySelectorAll('.btn-remove-att').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.attIdx);
        attachments.splice(idx, 1);
        renderModal();
      });
    });

    function insertTextAtCursor(str) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      content = content.slice(0, start) + str + content.slice(end);
      renderModal();
      const updated = backdrop.querySelector('#textarea-msg-content');
      if (updated) {
        updated.focus();
        const newPos = start + str.length;
        updated.setSelectionRange(newPos, newPos);
      }
    }

    backdrop.querySelector('#btn-confirm-save-msg').addEventListener('click', async () => {
      if (!content.trim() && attachments.length === 0) {
        textarea.focus();
        textarea.style.borderColor = '#ef4444';
        return;
      }
      backdrop.remove();
      onSave({
        id: template?.id || `tmpl_${Date.now()}`,
        name: modelName.trim() || 'Custom Template',
        type: category,
        content: content.trim(),
        attachments,
        updatedAt: Date.now(),
      });
    });
  }

  document.body.appendChild(backdrop);
  renderModal();
}


function ensureTemplatesStyles() {
  const STYLE_ID = 'waalaxy-templates-view-css';
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .templates-layout { display: flex; min-height: 100%; background: #f8fafc; font-family: inherit; }
    .templates-sidebar { width: 220px; min-width: 220px; background: #ffffff; border-right: 1px solid #e2e8f0; padding: 24px 16px; box-sizing: border-box; }
    .templates-sidebar-head { margin-bottom: 20px; padding: 0 8px; }
    .sub-sidebar-title { font-size: 18px; font-weight: 800; color: #14142b; margin: 0; }
    .templates-sidebar-group { margin-bottom: 20px; }
    .group-label { font-size: 10.5px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; padding: 0 8px; margin-bottom: 8px; }
    .template-nav-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 12px; border-radius: 8px; border: none; background: transparent; font-size: 13px; font-weight: 600; color: #475569; cursor: pointer; transition: all 0.12s; text-align: left; }
    .template-nav-btn:hover { background: #f1f5f9; color: #14142b; }
    .template-nav-btn.is-active { background: #fff7ed; color: #ff6b00; font-weight: 700; }
    .cat-icon { display: flex; align-items: center; justify-content: center; }
    .templates-main-canvas { flex: 1; padding: 32px 40px; overflow-y: auto; box-sizing: border-box; }
    .templates-head-bar { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
    .main-page-title { font-size: 22px; font-weight: 800; color: #14142b; margin: 0 0 6px 0; }
    .category-heading-row { display: flex; align-items: center; gap: 8px; }
    .cat-main-name { font-size: 14px; font-weight: 700; color: #64748b; }
    .badge-total-count { font-size: 11px; font-weight: 700; background: #e2e8f0; color: #475569; padding: 2px 7px; border-radius: 9999px; }
    .btn-primary-create { background: #ff6b00; color: #ffffff; border: none; border-radius: 20px; padding: 9px 20px; font-size: 12.5px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(255, 107, 0, 0.25); transition: background 0.15s; }
    .btn-primary-create:hover { background: #e05a00; }
    .templates-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 18px; }
    .template-item-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 6px rgba(0,0,0,0.02); transition: all 0.2s ease; }
    .template-item-card:hover { border-color: #c7d2fe; box-shadow: 0 6px 18px rgba(255, 107, 0, 0.08); transform: translateY(-1px); }
    .template-card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .template-name { font-size: 14px; font-weight: 700; color: #14142b; margin: 0; }
    .template-type-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; background: #f1f5f9; color: #64748b; padding: 2px 6px; border-radius: 4px; }
    .template-snippet { font-size: 12.5px; color: #475569; line-height: 1.5; margin: 0 0 14px 0; min-height: 48px; white-space: pre-line; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .template-card-footer { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #f1f5f9; padding-top: 10px; }
    .template-char-badge { font-size: 11px; color: #94a3b8; font-weight: 600; }
    .template-actions { display: flex; gap: 8px; }
    .btn-card-action { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px 10px; font-size: 11.5px; font-weight: 600; color: #475569; cursor: pointer; display: flex; align-items: center; gap: 4px; }
    .btn-card-action:hover { background: #fff7ed; color: #ff6b00; border-color: #ff6b00; }
    .btn-del-tmpl:hover { background: #fef2f2; color: #ef4444; border-color: #ef4444; }

    .edit-msg-modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; }
    .edit-msg-modal-card { width: 920px; max-width: 95vw; max-height: 90vh; background: #ffffff; border-radius: 20px; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.2); display: flex; flex-direction: column; overflow: hidden; }
    .edit-msg-modal-head { display: flex; justify-content: space-between; align-items: center; padding: 20px 28px; border-bottom: 1px solid #fff7ed; }
    .edit-msg-title { font-size: 18px; font-weight: 800; color: #14142b; margin: 0; }
    .btn-close-modal { background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 6px; display: flex; align-items: center; justify-content: center; border-radius: 6px; }
    .btn-close-modal:hover { color: #14142b; background: #f1f5f9; }
    .edit-msg-modal-grid { display: grid; grid-template-columns: 1fr 340px; flex: 1; overflow: hidden; }
    .edit-msg-left-col { padding: 24px 28px; overflow-y: auto; border-right: 1px solid #fff7ed; display: flex; flex-direction: column; gap: 18px; }
    .edit-msg-inputs-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .edit-msg-label { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 6px; display: block; }
    .select-model-pill { background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 13px; font-weight: 600; color: #14142b; }
    .input-text-model { width: 100%; box-sizing: border-box; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 13px; font-weight: 600; color: #14142b; outline: none; }
    .input-text-model:focus { border-color: #ff6b00; }
    .textarea-wrapper { background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; min-height: 200px; }
    .composer-textarea-full { flex: 1; border: none; outline: none; font-size: 13.5px; line-height: 1.5; color: #14142b; resize: none; font-family: inherit; }
    .edit-msg-toolbar { display: flex; justify-content: space-between; align-items: center; }
    .btn-pill-variable { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 20px; padding: 6px 14px; font-size: 12px; font-weight: 600; color: #ff6b00; cursor: pointer; }
    .var-menu-dropdown { position: absolute; bottom: 100%; left: 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.1); padding: 6px; min-width: 180px; z-index: 20; margin-bottom: 6px; }
    .var-menu-dropdown.hidden { display: none; }
    .var-menu-item { padding: 8px 12px; border-radius: 6px; font-size: 12.5px; font-weight: 600; color: #14142b; cursor: pointer; display: flex; justify-content: space-between; }
    .var-menu-item:hover { background: #fff7ed; color: #ff6b00; }
    .toolbar-media-icons { display: flex; gap: 8px; align-items: center; }
    .tool-icon-btn { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #475569; }
    .tool-icon-btn:hover { background: #fff7ed; color: #ff6b00; border-color: #ff6b00; }
    .emoji-picker-popover { position: absolute; bottom: 100%; right: 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); padding: 12px; width: 280px; z-index: 30; margin-bottom: 8px; }
    .emoji-picker-popover.hidden { display: none; }
    .emoji-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
    .emoji-select-btn { background: transparent; border: none; font-size: 18px; padding: 4px; cursor: pointer; border-radius: 4px; }
    .emoji-select-btn:hover { background: #f1f5f9; transform: scale(1.2); }
    .gif-picker-popover { position: absolute; bottom: 100%; right: 0; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); padding: 12px; width: 260px; z-index: 30; margin-bottom: 8px; }
    .gif-picker-popover.hidden { display: none; }
    .gif-popover-head { font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px; }
    .gif-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .gif-choice-btn { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px; font-size: 11px; font-weight: 600; color: #14142b; cursor: pointer; text-align: left; }
    .gif-choice-btn:hover { background: #fff7ed; border-color: #ff6b00; color: #ff6b00; }
    .attachments-chips-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .att-chip { background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; padding: 3px 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #14142b; }
    .btn-remove-att { background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 0; display: flex; align-items: center; }
    .btn-remove-att:hover { color: #ef4444; }
    .edit-msg-right-col { padding: 24px 20px; overflow-y: auto; background: #f8fafc; display: flex; flex-direction: column; gap: 20px; }
    .quality-checklist-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; }
    .quality-card-title { font-size: 13px; font-weight: 800; color: #14142b; margin: 0 0 12px 0; }
    .check-item { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; font-size: 12px; color: #475569; }
    .check-circle { width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; flex-shrink: 0; }
    .check-good { background: #ecfdf5; color: #059669; }
    .check-warn { background: #fffbeb; color: #d97706; }
    .check-danger { background: #fef2f2; color: #dc2626; }
    .preview-card-box { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px; }
    .preview-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .preview-avatar { width: 34px; height: 34px; border-radius: 50%; background: #ff6b00; color: #ffffff; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; }
    .preview-prospect-name { font-size: 13px; font-weight: 700; color: #14142b; }
    .preview-content-bubble { background: #f1f5f9; border-radius: 10px; padding: 12px; font-size: 12.5px; color: #334155; line-height: 1.5; white-space: pre-wrap; }
    .edit-msg-modal-foot { padding: 16px 28px; border-top: 1px solid #fff7ed; display: flex; justify-content: flex-end; gap: 12px; }
    .btn-modal-ghost { background: transparent; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 8px 18px; font-size: 12.5px; font-weight: 700; color: #64748b; cursor: pointer; }
    .btn-modal-ghost:hover { background: #f1f5f9; color: #14142b; }
    .btn-modal-primary { background: #ff6b00; border: none; border-radius: 10px; padding: 8px 22px; font-size: 12.5px; font-weight: 700; color: #ffffff; cursor: pointer; box-shadow: 0 4px 12px rgba(255, 107, 0, 0.25); }
    .btn-modal-primary:hover { background: #e05a00; }
  `;
  document.head.appendChild(style);
}

export async function renderTemplatesView(container, ctx = {}) {
  ensureTemplatesStyles();
  if (!container) return;

  const storage = await new Promise((r) => chrome.storage.local.get(['messageTemplates'], r));
  let templates = Array.isArray(storage.messageTemplates) ? storage.messageTemplates : [];

  function paint() {
    const filtered = templates.filter((t) => (t.type || 'message') === activeCategory);

    container.innerHTML = `
      <div class="templates-view-shell">
        <aside class="templates-sidebar">
          <div class="templates-sidebar-head">
            <h2 class="sub-sidebar-title">Messages</h2>
          </div>

          <div class="templates-sidebar-group">
            <div class="group-label">LINKEDIN</div>
            <button type="button" class="template-nav-btn ${activeCategory === 'message' ? 'is-active' : ''}" data-cat="message">
              <span class="cat-icon">${ICONS.message}</span>
              <span class="cat-label">Message</span>
            </button>
            <button type="button" class="template-nav-btn ${activeCategory === 'invitation' ? 'is-active' : ''}" data-cat="invitation">
              <span class="cat-icon">${ICONS.invitation}</span>
              <span class="cat-label">Invitation</span>
            </button>
          </div>

          <div class="templates-sidebar-group">
            <div class="group-label">EMAIL</div>
            <button type="button" class="template-nav-btn ${activeCategory === 'email' ? 'is-active' : ''}" data-cat="email">
              <span class="cat-icon">${ICONS.email}</span>
              <span class="cat-label">Email</span>
            </button>
          </div>
        </aside>

        <main class="templates-main-canvas">
          <div class="templates-head-bar">
            <div>
              <h1 class="main-page-title">Messages management</h1>
              <div class="category-heading-row">
                <span class="cat-main-name">${activeCategory === 'invitation' ? 'Invitation' : activeCategory === 'email' ? 'Email' : 'Message'}</span>
                <span class="badge-total-count">${filtered.length}</span>
              </div>
            </div>

            <button type="button" class="btn-primary-create" id="btn-create-template-main">
              + Create a template
            </button>
          </div>

          <div class="templates-body-content">
            ${filtered.length === 0 ? `
              <div class="templates-empty-state">
                <div class="outfox-logo-illustration-wrap" style="margin-bottom: 16px;">
                  <img src="../../icons/icon128.png" width="84" height="84" style="border-radius: 22px; box-shadow: 0 10px 28px rgba(255, 107, 0, 0.28); display: inline-block;" alt="OutFox" />
                </div>
                <h3 class="empty-title">No templates</h3>
                <p class="empty-sub">Save high-converting message snippets to reuse across all outreach sequences.</p>
                <button type="button" class="btn-create-template-blue" id="btn-empty-create-template" style="background: linear-gradient(135deg, #ff741f 0%, #ff4d00 100%);">
                  Create a template
                </button>
              </div>
            ` : `
              <div class="templates-grid">
                ${filtered.map((t) => `
                  <div class="template-item-card">
                    <div class="template-card-head">
                      <h4 class="template-name">${t.name}</h4>
                      <span class="template-type-badge">${t.type}</span>
                    </div>
                    <p class="template-snippet">${t.content}</p>
                    <div class="template-card-footer">
                      <span class="template-char-badge">${t.content.length} chars</span>
                      <div class="template-actions">
                        <button type="button" class="btn-card-action btn-edit-tmpl" data-id="${t.id}">${ICONS.edit} Edit</button>
                        <button type="button" class="btn-card-action btn-del-tmpl" data-id="${t.id}" title="Delete">${ICONS.trash}</button>
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </main>
      </div>
    `;

    wireTemplatesEvents();
  }

  function wireTemplatesEvents() {
    container.querySelectorAll('.template-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeCategory = btn.dataset.cat;
        paint();
      });
    });

    const handleCreate = () => {
      openEditMessageModal({
        category: activeCategory,
        onSave: async (newTmpl) => {
          templates.unshift(newTmpl);
          await chrome.storage.local.set({ messageTemplates: templates });
          ctx.showToast?.('Template created successfully!', 'success');
          paint();
        },
      });
    };

    container.querySelector('#btn-create-template-main')?.addEventListener('click', handleCreate);
    container.querySelector('#btn-empty-create-template')?.addEventListener('click', handleCreate);

    container.querySelectorAll('.btn-edit-tmpl').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const tmpl = templates.find((t) => t.id === id);
        if (!tmpl) return;

        openEditMessageModal({
          template: tmpl,
          category: tmpl.type || 'message',
          onSave: async (updated) => {
            const idx = templates.findIndex((t) => t.id === id);
            if (idx !== -1) templates[idx] = updated;
            await chrome.storage.local.set({ messageTemplates: templates });
            ctx.showToast?.('Template updated!', 'success');
            paint();
          },
        });
      });
    });

    container.querySelectorAll('.btn-del-tmpl').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const ok = await openUiConfirm({
          title: 'Delete Template',
          message: 'Are you sure you want to delete this message template?',
          confirmText: 'Delete',
          confirmDanger: true,
        });

        if (ok) {
          templates = templates.filter((t) => t.id !== id);
          await chrome.storage.local.set({ messageTemplates: templates });
          ctx.showToast?.('Template deleted.', 'success');
          paint();
        }
      });
    });
  }

  paint();
}
