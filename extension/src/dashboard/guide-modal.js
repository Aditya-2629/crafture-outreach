/**
 * OutFox — Interactive Integrations Guide Modals
 */

import { ICONS } from '../ui/icons.js';

/**
 * Copy text to clipboard safely
 */
async function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }
  // Fallback
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok;
}

/**
 * Show a quick toast notification
 */
function showGuideToast(msg) {
  let toast = document.getElementById('guide-copy-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'guide-copy-toast';
    toast.className = 'guide-copy-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('is-visible');
  setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 3500);
}

/**
 * Open Telegram Mobile AI Assistant setup modal
 */
export function openTelegramGuideModal(onSaved) {
  const existing = document.getElementById('outfox-telegram-guide-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'outfox-telegram-guide-modal';
  backdrop.className = 'modal-backdrop';

  backdrop.innerHTML = `
    <div class="modal-dialog glass-card guide-dialog" style="max-width: 620px;">
      <div class="modal-head">
        <div class="guide-head-group">
          <span class="guide-logo-icon" style="background:#229ED9; color:#fff;">${ICONS.telegram}</span>
          <h3 class="modal-title">Telegram Mobile AI Assistant — 1-Click Setup</h3>
        </div>
        <button type="button" class="btn-close-modal" id="btn-close-tg-guide">✕</button>
      </div>

      <div class="modal-body guide-body">
        <p class="guide-intro">
          Control your LinkedIn campaigns, search candidates, and trigger outreach directly from your phone via Telegram.
        </p>

        <div class="guide-steps-list">
          <!-- Step 1 -->
          <div class="guide-step-item">
            <div class="step-num-badge">1</div>
            <div class="step-content">
              <strong>Create your Bot with @BotFather</strong>
              <p>Open <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" class="guide-link">@BotFather ↗</a> in Telegram, send <code>/newbot</code>, follow the prompts, and copy the <strong>HTTP API Bot Token</strong>.</p>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="guide-step-item">
            <div class="step-num-badge">2</div>
            <div class="step-content">
              <strong>Get your Chat ID with @userinfobot</strong>
              <p>Open <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer" class="guide-link">@userinfobot ↗</a> in Telegram, send <code>/start</code>, and copy your numeric <strong>Id</strong>.</p>
            </div>
          </div>

          <!-- Step 3 -->
          <div class="guide-step-item">
            <div class="step-num-badge">3</div>
            <div class="step-content" style="width: 100%;">
              <strong>Enter Credentials & Enable Assistant</strong>
              
              <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 10px;">
                <div>
                  <label style="font-size: 11.5px; font-weight: 700; color: #475569; display: block; margin-bottom: 4px;">BOT TOKEN</label>
                  <div style="display: flex; gap: 8px;">
                    <input type="password" id="input-tg-bot-token" placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" style="flex: 1; padding: 9px 12px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; background: #fff;" />
                    <button type="button" class="btn btn-secondary" id="btn-paste-tg-token" style="padding: 0 14px; font-size: 12px; font-weight: 600; cursor: pointer;">Paste</button>
                  </div>
                </div>

                <div>
                  <label style="font-size: 11.5px; font-weight: 700; color: #475569; display: block; margin-bottom: 4px;">YOUR CHAT ID</label>
                  <div style="display: flex; gap: 8px;">
                    <input type="text" id="input-tg-chat-id" placeholder="e.g. 123456789" style="flex: 1; padding: 9px 12px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; background: #fff;" />
                    <button type="button" class="btn btn-secondary" id="btn-paste-tg-chat-id" style="padding: 0 14px; font-size: 12px; font-weight: 600; cursor: pointer;">Paste</button>
                  </div>
                </div>

                <div style="margin-top: 2px;">
                  <label style="font-size: 11.5px; font-weight: 700; color: #475569; display: block; margin-bottom: 4px;">📅 10-Min Booking Link (Calendly / Cal.com):</label>
                  <div style="display: flex; gap: 8px;">
                    <input type="text" id="input-tg-booking-link" placeholder="https://calendly.com/your-name/15min" style="flex: 1; padding: 9px 12px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; background: #fff;" />
                    <button type="button" class="btn btn-secondary" id="btn-paste-tg-booking" style="padding: 0 14px; font-size: 12px; font-weight: 600; cursor: pointer;">Paste</button>
                  </div>
                </div>
              </div>

              <div style="display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap;">
                <button type="button" class="btn btn-secondary" id="btn-test-tg-conn" style="padding: 8px 16px; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                  ⚡ Test Connection
                </button>
                <button type="button" class="btn btn-primary" id="btn-save-tg" style="padding: 8px 18px; font-size: 12px; font-weight: 700; cursor: pointer; background: #229ED9; border-color: #229ED9;">
                  Save & Enable Mobile AI
                </button>
              </div>
              <div id="tg-test-feedback" style="margin-top: 10px; font-size: 12.5px; font-weight: 600; display: none;"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button type="button" class="btn btn-secondary" id="btn-dismiss-tg-guide">Done</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();

  backdrop.querySelector('#btn-close-tg-guide')?.addEventListener('click', close);
  backdrop.querySelector('#btn-dismiss-tg-guide')?.addEventListener('click', close);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const onEsc = (e) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', onEsc);
      close();
    }
  };
  window.addEventListener('keydown', onEsc);

  const tokenInput = backdrop.querySelector('#input-tg-bot-token');
  const chatIdInput = backdrop.querySelector('#input-tg-chat-id');
  const bookingInput = backdrop.querySelector('#input-tg-booking-link');
  const pasteTokenBtn = backdrop.querySelector('#btn-paste-tg-token');
  const pasteChatIdBtn = backdrop.querySelector('#btn-paste-tg-chat-id');
  const pasteBookingBtn = backdrop.querySelector('#btn-paste-tg-booking');
  const testBtn = backdrop.querySelector('#btn-test-tg-conn');
  const saveBtn = backdrop.querySelector('#btn-save-tg');
  const feedback = backdrop.querySelector('#tg-test-feedback');

  // Load existing status
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ action: 'telegram.status' }, (res) => {
      const data = res?.data || res;
      if (data?.maskedToken && tokenInput) tokenInput.value = data.maskedToken;
      if (data?.chatId && chatIdInput) chatIdInput.value = data.chatId;
      if (data?.bookingLink && bookingInput) bookingInput.value = data.bookingLink;
    });
  }

  pasteTokenBtn?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && tokenInput) tokenInput.value = text.trim();
    } catch {}
  });

  pasteChatIdBtn?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && chatIdInput) chatIdInput.value = text.trim();
    } catch {}
  });

  pasteBookingBtn?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && bookingInput) bookingInput.value = text.trim();
    } catch {}
  });

  testBtn?.addEventListener('click', async () => {
    const botToken = tokenInput?.value?.trim();
    const chatId = chatIdInput?.value?.trim();
    if (!botToken || !chatId) {
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.color = '#ef4444';
        feedback.textContent = 'Please enter both Bot Token and Chat ID.';
      }
      return;
    }
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    try {
      chrome.runtime.sendMessage({ action: 'telegram.test', params: { botToken, chatId } }, (res) => {
        testBtn.disabled = false;
        if (res?.ok && res?.data?.ok) {
          if (feedback) {
            feedback.style.display = 'block';
            feedback.style.color = '#10b981';
            feedback.textContent = `✓ Connected to @${res.data.botUsername || 'bot'} (${res.data.latencyMs}ms)! Test message sent to your phone.`;
          }
          testBtn.textContent = `✓ Success! (${res.data.latencyMs}ms)`;
        } else {
          const errMsg = res?.error?.message || 'Connection failed';
          if (feedback) {
            feedback.style.display = 'block';
            feedback.style.color = '#ef4444';
            feedback.textContent = `Error: ${errMsg}`;
          }
          testBtn.textContent = '⚡ Test Connection';
        }
      });
    } catch (e) {
      testBtn.disabled = false;
      testBtn.textContent = '⚡ Test Connection';
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.color = '#ef4444';
        feedback.textContent = `Error: ${e.message}`;
      }
    }
  });

  saveBtn?.addEventListener('click', async () => {
    const botToken = tokenInput?.value?.trim();
    const chatId = chatIdInput?.value?.trim();
    const bookingLink = bookingInput?.value?.trim() || '';
    if (!botToken || !chatId) {
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.color = '#ef4444';
        feedback.textContent = 'Please enter both Bot Token and Chat ID before saving.';
      }
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    chrome.runtime.sendMessage({ action: 'telegram.save', params: { botToken, chatId, bookingLink, enabled: true } }, (res) => {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Saved!';
      showGuideToast('Telegram Mobile AI Assistant enabled!');
      onSaved?.();
      setTimeout(() => backdrop.remove(), 800);
    });
  });
}

/**
 * Open OutFox MCP Server setup modal
 */
export function openMcpGuideModal() {
  const existing = document.getElementById('outfox-mcp-guide-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'outfox-mcp-guide-modal';
  backdrop.className = 'modal-backdrop';

  const mcpConfigCode = JSON.stringify({
    mcpServers: {
      outfox: {
        command: "npx",
        args: [
          "-y",
          "outfox-mcp"
        ]
      }
    }
  }, null, 2);

  backdrop.innerHTML = `
    <div class="modal-dialog glass-card guide-dialog" style="max-width: 640px;">
      <div class="modal-head">
        <div class="guide-head-group">
          <span class="guide-logo-icon" style="background:#ff6b00; color:#fff;">${ICONS.terminal}</span>
          <h3 class="modal-title">OutFox MCP Server — Universal AI Agent Bridge</h3>
        </div>
        <button type="button" class="btn-close-modal" id="btn-close-mcp-guide">✕</button>
      </div>

      <div class="modal-body guide-body">
        <p class="guide-intro">
          Pair OutFox directly with Antigravity IDE, Claude Desktop, Cursor, or Windsurf. Agents can search LinkedIn prospects, trigger campaigns, and inspect quotas in real time.
        </p>

        <div class="guide-steps-list">
          <div class="guide-step-item">
            <div class="step-num-badge">1</div>
            <div class="step-content" style="width:100%;">
              <strong>Option A: 1-Command Auto-Installer (Recommended)</strong>
              <p>Run this in your terminal to automatically configure Claude Desktop & Cursor across Windows, macOS, or Linux:</p>
              <pre style="background:#0f172a; color:#38bdf8; padding:10px 12px; border-radius:8px; font-size:12px; font-family:monospace; margin:6px 0;"><code>npx outfox-mcp-setup</code></pre>
            </div>
          </div>

          <div class="guide-step-item">
            <div class="step-num-badge">2</div>
            <div class="step-content" style="width:100%;">
              <strong>Option B: Universal <code>.mcp.json</code> Config</strong>
              <p>Or paste this universal zero-setup config into your IDE or Claude Desktop:</p>
              <pre style="background:#0f172a; color:#e2e8f0; padding:12px; border-radius:8px; font-size:12px; overflow-x:auto; margin:8px 0; font-family:monospace;"><code>${mcpConfigCode}</code></pre>
              <button type="button" class="btn btn-secondary btn-copy-mcp" id="btn-copy-mcp-config" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                ${ICONS.duplicate || ''} Copy .mcp.json snippet
              </button>
            </div>
          </div>

          <div class="guide-step-item">
            <div class="step-num-badge">3</div>
            <div class="step-content">
              <strong>Localhost WebSocket Bridge</strong>
              <p>OutFox MCP communicates over <code>ws://127.0.0.1:47829</code> with your active Chrome/Brave session. Zero tokens, no headless browsers or bot detection.</p>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button type="button" class="btn btn-secondary" id="btn-dismiss-mcp-guide">Done</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();

  backdrop.querySelector('#btn-close-mcp-guide')?.addEventListener('click', close);
  backdrop.querySelector('#btn-dismiss-mcp-guide')?.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const onEsc = (e) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', onEsc);
      close();
    }
  };
  window.addEventListener('keydown', onEsc);

  backdrop.querySelector('#btn-copy-mcp-config')?.addEventListener('click', async () => {
    const ok = await copyToClipboard(mcpConfigCode);
    if (ok) {
      showGuideToast('MCP configuration snippet copied!');
      const btn = backdrop.querySelector('#btn-copy-mcp-config');
      if (btn) btn.textContent = '✓ Copied!';
      setTimeout(() => { if (btn) btn.innerHTML = `${ICONS.duplicate || ''} Copy .mcp.json snippet`; }, 2500);
    }
  });
}


