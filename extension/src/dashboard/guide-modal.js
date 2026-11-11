/**
 * OutFox — Interactive Google Sheets CRM Guide Modal
 * Dynamic clipboard code copy with custom LinkedIn Blue styling.
 */

import { ICONS } from '../ui/icons.js';

export const APPS_SCRIPT_CODE = `/**
 * OutFox — Google Sheets Live CRM Webhook
 * Auto-formats columns, freezes headers in LinkedIn Blue, and syncs events in real time.
 */
function doPost(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    var payload = JSON.parse(e.postData.contents);

    // Auto-initialize header row if sheet is empty
    if (sheet.getLastRow() === 0) {
      var headers = [
        "Timestamp",
        "Full Name",
        "Headline",
        "Company",
        "Event",
        "Step",
        "Note / Message",
        "LinkedIn URL"
      ];
      sheet.appendRow(headers);

      // Style Header in LinkedIn Blue (#0A66C2)
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#0A66C2");
      headerRange.setFontColor("#FFFFFF");
      headerRange.setFontWeight("bold");
      headerRange.setFontSize(10);
      sheet.setFrozenRows(1);
    }

    // Append new outreach event
    sheet.appendRow([
      new Date().toLocaleString(),
      payload.fullName || payload.name || "",
      payload.headline || payload.title || "",
      payload.company || "",
      payload.event || payload.action || "outreach",
      payload.step || "",
      payload.note || payload.message || payload.body || "",
      payload.publicId ? "https://www.linkedin.com/in/" + payload.publicId : ""
    ]);

    // Format new row
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 1, 1, 8).setFontSize(9).setVerticalAlignment("middle");
    sheet.autoResizeColumns(1, 8);

    return ContentService.createTextOutput(JSON.stringify({ status: "success", row: lastRow }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}`;

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
 * Open the Google Sheets CRM Guide modal
 */
export function openSheetCrmGuide(onSaved) {
  const existing = document.getElementById('outfox-sheet-guide-modal');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'outfox-sheet-guide-modal';
  backdrop.className = 'modal-backdrop';

  backdrop.innerHTML = `
    <div class="modal-dialog glass-card guide-dialog">
      <div class="modal-head">
        <div class="guide-head-group">
          <span class="guide-logo-icon">${ICONS.sheets}</span>
          <h3 class="modal-title">Google Sheets Live CRM — 1-Click Setup</h3>
        </div>
        <button type="button" class="btn-close-modal" id="btn-close-guide">✕</button>
      </div>

      <div class="modal-body guide-body">
        <p class="guide-intro">
          Connect your Google Spreadsheet to log accepted connections, message replies, and outreach touches in real time.
        </p>

        <div class="guide-steps-list">
          <!-- Step 1 -->
          <div class="guide-step-item">
            <div class="step-num-badge">1</div>
            <div class="step-content">
              <strong>Create a new Google Sheet</strong>
              <p>Open <a href="https://sheets.new" target="_blank" rel="noopener noreferrer" class="guide-link">https://sheets.new ↗</a> in your browser.</p>
            </div>
          </div>

          <!-- Step 2 -->
          <div class="guide-step-item">
            <div class="step-num-badge">2</div>
            <div class="step-content">
              <strong>Open Apps Script</strong>
              <p>In the top menu, go to <em>Extensions → Apps Script</em>.</p>
            </div>
          </div>

          <!-- Step 3 -->
          <div class="guide-step-item">
            <div class="step-num-badge">3</div>
            <div class="step-content">
              <strong>Paste the Ready-to-Use Webhook Code</strong>
              <p>Replace any existing code in the editor with our automated script:</p>
              <button type="button" class="btn btn-primary btn-copy-script" id="btn-copy-apps-script" style="display:inline-flex;align-items:center;gap:8px;">
                ${ICONS.code} Copy Ready-to-Use Apps Script Code
              </button>
            </div>
          </div>

          <!-- Step 4 -->
          <div class="guide-step-item">
            <div class="step-num-badge">4</div>
            <div class="step-content">
              <strong>Deploy Web App</strong>
              <p>Click <strong>Deploy → New deployment</strong>. Select type <strong>Web App</strong>, set <em>Who has access: <strong>Anyone</strong></em>, then copy the Web App URL.</p>
            </div>
          </div>

          <!-- Step 5: Connect & Test Web App URL -->
          <div class="guide-step-item">
            <div class="step-num-badge">5</div>
            <div class="step-content" style="width: 100%;">
              <strong>Connect & Enable Real-Time CRM Sync</strong>
              <p>Paste the deployed Web App URL below and click Test Connection:</p>
              
              <div style="display: flex; gap: 8px; margin-top: 8px;">
                <input type="url" id="input-sheet-webapp-url" placeholder="https://script.google.com/macros/s/.../exec" style="flex: 1; padding: 9px 12px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; background: #fff;" />
                <button type="button" class="btn btn-secondary" id="btn-paste-sheet-url" style="padding: 0 14px; font-size: 12px; font-weight: 600; cursor: pointer;">Paste</button>
              </div>

              <div style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap;">
                <button type="button" class="btn btn-secondary" id="btn-test-sheet-conn" style="padding: 8px 16px; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                  Test Connection
                </button>
                <button type="button" class="btn btn-primary" id="btn-save-sheet-url" style="padding: 8px 18px; font-size: 12px; font-weight: 700; cursor: pointer; background: #0f9d58; border-color: #0f9d58;">
                  Save & Enable Sync
                </button>
              </div>
              <div id="sheet-test-feedback" style="margin-top: 8px; font-size: 12.5px; font-weight: 600; display: none;"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button type="button" class="btn btn-secondary" id="btn-dismiss-guide">Done</button>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();

  backdrop.querySelector('#btn-close-guide')?.addEventListener('click', close);
  backdrop.querySelector('#btn-dismiss-guide')?.addEventListener('click', close);

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

  // Copy button
  const copyBtn = backdrop.querySelector('#btn-copy-apps-script');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const ok = await copyToClipboard(APPS_SCRIPT_CODE);
      if (ok) {
        showGuideToast('Code copied! Now paste into Apps Script.');
        copyBtn.textContent = '✓ Copied to Clipboard!';
        setTimeout(() => {
          copyBtn.innerHTML = `${ICONS.code} Copy Ready-to-Use Apps Script Code`;
        }, 3000);
      }
    });
  }

  // Step 5: Web App URL inputs & buttons
  const urlInput = backdrop.querySelector('#input-sheet-webapp-url');
  const pasteBtn = backdrop.querySelector('#btn-paste-sheet-url');
  const testBtn = backdrop.querySelector('#btn-test-sheet-conn');
  const saveBtn = backdrop.querySelector('#btn-save-sheet-url');
  const feedback = backdrop.querySelector('#sheet-test-feedback');

  // Prepopulate if saved
  if (typeof chrome !== 'undefined' && chrome.storage?.local?.get) {
    chrome.storage.local.get(['googleSheetUrl', 'googleSheetWebhookUrl'], (res) => {
      const existingUrl = res?.googleSheetUrl || res?.googleSheetWebhookUrl;
      if (existingUrl && urlInput) urlInput.value = existingUrl;
    });
  }

  pasteBtn?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && urlInput) urlInput.value = text.trim();
    } catch {}
  });

  testBtn?.addEventListener('click', async () => {
    const url = urlInput?.value?.trim();
    if (!url) {
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.color = '#ef4444';
        feedback.textContent = 'Please enter a Google Apps Script Web App URL first.';
      }
      return;
    }
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    const start = Date.now();
    try {
      const testPayload = {
        timestamp: new Date().toISOString(),
        fullName: 'OutFox Test Lead',
        headline: 'Connection Test',
        company: 'OutFox',
        event: 'TEST_PING',
        step: 'Verification',
        message: 'Live test from OutFox',
      };
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(testPayload),
        mode: 'no-cors',
      });
      const ms = Date.now() - start;
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.color = '#10b981';
        feedback.textContent = `✓ Success! (${ms}ms) Test entry sent to Google Sheet.`;
      }
      testBtn.textContent = `✓ Success! (${ms}ms)`;
    } catch (err) {
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.color = '#ef4444';
        feedback.textContent = `Connection error: ${err.message}`;
      }
      testBtn.textContent = 'Test Connection';
    } finally {
      testBtn.disabled = false;
    }
  });

  saveBtn?.addEventListener('click', async () => {
    const url = urlInput?.value?.trim();
    if (!url) {
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.color = '#ef4444';
        feedback.textContent = 'Please enter a valid Google Web App URL.';
      }
      return;
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.local?.set) {
      await new Promise((r) =>
        chrome.storage.local.set(
          {
            googleSheetUrl: url,
            googleSheetWebhookUrl: url,
          },
          r,
        ),
      );
    }
    showGuideToast('Google Sheets CRM sync enabled!');
    onSaved?.(url);
    setTimeout(() => backdrop.remove(), 1000);
  });
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
        command: "node",
        args: [
          "C:\\Users\\hp\\Desktop\\ADITYA\\linki\\linkedin-toolkit\\linkedin-toolkit\\mcp-server\\dist\\server.js"
        ]
      }
    }
  }, null, 2);

  backdrop.innerHTML = `
    <div class="modal-dialog glass-card guide-dialog" style="max-width: 640px;">
      <div class="modal-head">
        <div class="guide-head-group">
          <span class="guide-logo-icon" style="background:#2563eb; color:#fff;">${ICONS.terminal}</span>
          <h3 class="modal-title">OutFox MCP Server — Local IDE Agent Setup</h3>
        </div>
        <button type="button" class="btn-close-modal" id="btn-close-mcp-guide">✕</button>
      </div>

      <div class="modal-body guide-body">
        <p class="guide-intro">
          Pair OutFox directly with Antigravity IDE, Claude Code, Cursor, or Windsurf. Agents can search LinkedIn prospects, trigger campaigns, and inspect quotas in real time.
        </p>

        <div class="guide-steps-list">
          <div class="guide-step-item">
            <div class="step-num-badge">1</div>
            <div class="step-content" style="width:100%;">
              <strong>Add OutFox to your <code>.mcp.json</code></strong>
              <p>Add this MCP server block to your IDE configuration file:</p>
              <pre style="background:#0f172a; color:#e2e8f0; padding:12px; border-radius:8px; font-size:12px; overflow-x:auto; margin:8px 0; font-family:monospace;"><code>${mcpConfigCode}</code></pre>
              <button type="button" class="btn btn-secondary btn-copy-mcp" id="btn-copy-mcp-config" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
                ${ICONS.duplicate || ''} Copy .mcp.json snippet
              </button>
            </div>
          </div>

          <div class="guide-step-item">
            <div class="step-num-badge">2</div>
            <div class="step-content">
              <strong>Localhost WebSocket Bridge</strong>
              <p>OutFox MCP communicates over <code>ws://127.0.0.1:47829</code> with your active Chrome/Brave session. No headless browsers or bot detection.</p>
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


