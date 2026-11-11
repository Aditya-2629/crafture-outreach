/**
 * OutFox — Authentic Waalaxy Inbox View
 * Production Real-Time Conversation Triage, Live LinkedIn Chat Mirror & Composer.
 * 100% Manifest V3 CSP Compliant · Vector Icons · Instant Synchronous Triage
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { ICONS } from '../ui/icons.js';

let activeFilter = 'all'; // 'all' | 'unread'
let searchQuery = '';

export async function renderInboxView(container, ctx = {}) {
  if (!container) return;

  container.innerHTML = `
    <div class="inbox-loading-container" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:60vh; gap:14px;">
      <div class="spinner" style="width:36px; height:36px; border:3px solid #e2e8f0; border-top-color:#2563eb; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
      <span style="font-size:14px; font-weight:600; color:#64748b;">Syncing conversations from LinkedIn...</span>
    </div>
  `;

  let rawThreads = [];

  try {
    const res = await call(ACTIONS.INBOX_THREADS, { count: 50 }).catch(() => null);
    rawThreads = Array.isArray(res?.threads) ? res.threads : (Array.isArray(res) ? res : []);
  } catch (e) {
    console.warn('[Inbox View] Fetch error:', e);
  }

  // Normalize threads & participant data
  const normalizedThreads = rawThreads.map((t) => {
    const participants = Array.isArray(t.participants) ? t.participants : [];
    const other = participants.find((p) => p && (p.fullName || p.publicId)) || participants[0] || {};
    const senderName = t.senderName || t.participantName || other.fullName || other.publicId || 'LinkedIn Member';
    const recipientPublicId = other.publicId || t.publicId || t.recipientPublicId || '';
    const initials = senderName
      .split(' ')
      .map((n) => n[0])
      .filter(Boolean)
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'LM';

    const snippet = t.snippet || t.lastMessage || 'No message preview';
    const timestamp = t.lastMessageAt || t.timestamp || Date.now();
    const unread = Boolean(t.unread);

    return {
      threadId: t.threadId || t.conversationUrn || t.id,
      senderName,
      recipientPublicId,
      initials,
      snippet,
      timestamp,
      unread,
      raw: t,
    };
  });

  let selectedThread = normalizedThreads[0] || null;
  let activeMessages = [];
  let isFetchingMessages = false;

  async function loadMessages(thread) {
    selectedThread = thread;
    if (!thread) {
      activeMessages = [];
      paint();
      return;
    }

    isFetchingMessages = true;
    paint();

    try {
      const res = await call(ACTIONS.INBOX_MESSAGES, { threadId: thread.threadId }).catch(() => null);
      const list = Array.isArray(res?.messages) ? res.messages : (Array.isArray(res) ? res : []);
      activeMessages = list.map((m) => ({
        messageId: m.messageId || `${m.sentAt}_${Math.random()}`,
        body: m.body || m.text || '',
        sentAt: m.sentAt || m.timestamp || Date.now(),
        fromMe: Boolean(m.fromMe || m.isOutgoing || (!m.fromPublicId && !m.fromUrn)),
        fromPublicId: m.fromPublicId || '',
      }));
    } catch (e) {
      console.warn('[Inbox View] Messages error:', e);
      activeMessages = [];
    } finally {
      isFetchingMessages = false;
      paint();
    }
  }

  function formatTimeAgo(ts) {
    if (!ts) return '';
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function paint() {
    const filtered = normalizedThreads.filter((t) => {
      if (activeFilter === 'unread' && !t.unread) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return t.senderName.toLowerCase().includes(q) || t.snippet.toLowerCase().includes(q);
      }
      return true;
    });

    const unreadCount = normalizedThreads.filter((t) => t.unread).length;

    container.innerHTML = `
      <div class="waalaxy-inbox-layout" style="display:flex; height:calc(100vh - 120px); gap:18px; padding:0 24px 24px; box-sizing:border-box;">
        
        <!-- LEFT: DISCUSSIONS SIDEBAR (380px) -->
        <aside class="inbox-discussions-sidebar" style="width:380px; min-width:340px; background:#fff; border:1px solid #e2e8f0; border-radius:14px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.03);">
          
          <!-- Head -->
          <div style="padding:18px 20px 14px; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between;">
            <div style="display:flex; align-items:center; gap:8px;">
              <h2 style="font-size:18px; font-weight:800; color:#0f172a; margin:0;">Discussions</h2>
              <span style="background:#eff6ff; color:#2563eb; font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px;">${normalizedThreads.length}</span>
            </div>
            <button type="button" id="btn-sync-inbox" style="background:#f8fafc; border:1px solid #e2e8f0; color:#475569; padding:5px 12px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:4px; transition:all 0.2s;">
              ↻ Refresh
            </button>
          </div>

          <!-- Blue Sync Alert Banner (matches Waalaxy) -->
          <div style="background:#eff6ff; border-left:4px solid #3b82f6; padding:10px 14px; margin:12px 16px 6px; border-radius:6px; display:flex; align-items:flex-start; gap:8px;">
            <span style="color:#2563eb; font-size:14px;">ℹ</span>
            <p style="margin:0; font-size:11.5px; color:#1e40af; line-height:1.4;">
              Syncing live conversations from your LinkedIn Primary Inbox in real time.
            </p>
          </div>

          <!-- Filter Tabs (All / Unread) -->
          <div style="display:flex; gap:8px; padding:10px 16px 6px;">
            <button type="button" class="btn-inbox-tab ${activeFilter === 'all' ? 'is-active' : ''}" data-filter="all" style="flex:1; padding:7px 12px; border-radius:8px; border:none; font-size:12.5px; font-weight:700; cursor:pointer; background:${activeFilter === 'all' ? '#2563eb' : '#f1f5f9'}; color:${activeFilter === 'all' ? '#fff' : '#64748b'};">
              All (${normalizedThreads.length})
            </button>
            <button type="button" class="btn-inbox-tab ${activeFilter === 'unread' ? 'is-active' : ''}" data-filter="unread" style="flex:1; padding:7px 12px; border-radius:8px; border:none; font-size:12.5px; font-weight:700; cursor:pointer; background:${activeFilter === 'unread' ? '#2563eb' : '#f1f5f9'}; color:${activeFilter === 'unread' ? '#fff' : '#64748b'};">
              Unread (${unreadCount})
            </button>
          </div>

          <!-- Search Input -->
          <div style="padding:8px 16px 12px;">
            <div style="position:relative; display:flex; align-items:center;">
              <span style="position:absolute; left:12px; color:#94a3b8; font-size:14px;">🔍</span>
              <input type="text" id="inbox-search-input" value="${searchQuery}" placeholder="Search for a contact..." style="width:100%; padding:9px 12px 9px 34px; border:1px solid #cbd5e1; border-radius:8px; font-size:12.5px; outline:none; background:#f8fafc; transition:all 0.2s;" />
            </div>
          </div>

          <!-- Threads Scroll Stream -->
          <div class="threads-scroll-viewport" style="flex:1; overflow-y:auto; padding:0 8px 12px;">
            ${
              filtered.length === 0
                ? `
                <div style="text-align:center; padding:48px 16px; color:#94a3b8;">
                  <span style="font-size:32px; display:block; margin-bottom:8px;">💬</span>
                  <strong style="font-size:13.5px; color:#475569; display:block;">No conversations found</strong>
                  <p style="font-size:12px; margin:4px 0 0; color:#64748b;">Incoming messages from LinkedIn connections will appear here automatically.</p>
                </div>
              `
                : filtered
                    .map((t) => {
                      const isSelected = selectedThread && selectedThread.threadId === t.threadId;
                      return `
                  <div class="inbox-thread-card" data-id="${t.threadId}" style="display:flex; align-items:flex-start; gap:12px; padding:12px; border-radius:10px; cursor:pointer; margin-bottom:4px; transition:all 0.15s; background:${isSelected ? '#f1f5f9' : '#fff'}; border:${isSelected ? '1.5px solid #2563eb' : '1px solid transparent'};">
                    <div style="width:40px; height:40px; min-width:40px; border-radius:50%; background:linear-gradient(135deg, #2563eb, #7c3aed); color:#fff; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; box-shadow:0 2px 6px rgba(37,99,235,0.2);">
                      ${t.initials}
                    </div>
                    <div style="flex:1; min-width:0;">
                      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:3px;">
                        <span style="font-size:13px; font-weight:700; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${t.senderName}</span>
                        <span style="font-size:11px; font-weight:500; color:#94a3b8; white-space:nowrap; margin-left:6px;">${formatTimeAgo(t.timestamp)}</span>
                      </div>
                      <p style="font-size:12px; color:#64748b; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.3;">
                        ${t.snippet}
                      </p>
                    </div>
                    ${t.unread ? `<span style="width:8px; height:8px; border-radius:50%; background:#2563eb; margin-top:6px;"></span>` : ''}
                  </div>
                `;
                    })
                    .join('')
            }
          </div>
        </aside>

        <!-- RIGHT: CONVERSATION PANE & COMPOSER (Flex 1) -->
        <main class="inbox-chat-pane" style="flex:1; background:#fff; border:1px solid #e2e8f0; border-radius:14px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.03);">
          ${
            !selectedThread
              ? `
              <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px; text-align:center;">
                <div style="width:72px; height:72px; border-radius:50%; background:#eff6ff; display:flex; align-items:center; justify-content:center; font-size:32px; margin-bottom:16px;">
                  💬
                </div>
                <h3 style="font-size:20px; font-weight:800; color:#0f172a; margin:0 0 8px;">Create a conversation to start 💬</h3>
                <p style="font-size:13px; color:#64748b; max-width:360px; margin:0 0 20px; line-height:1.5;">
                  Select a discussion from the left to read conversation history, view profiles, and send replies.
                </p>
                <button type="button" id="btn-create-first-convo" style="background:#2563eb; color:#fff; border:none; padding:10px 20px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; box-shadow:0 4px 12px rgba(37,99,235,0.25);">
                  + Select a conversation to start
                </button>
              </div>
            `
              : `
              <div style="padding:16px 24px; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between; background:#fff;">
                <div style="display:flex; align-items:center; gap:12px;">
                  <div style="width:42px; height:42px; border-radius:50%; background:linear-gradient(135deg, #2563eb, #7c3aed); color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700;">
                    ${selectedThread.initials}
                  </div>
                  <div>
                    <h3 style="font-size:15px; font-weight:800; color:#0f172a; margin:0 0 2px;">${selectedThread.senderName}</h3>
                    <div style="display:flex; align-items:center; gap:8px;">
                      <span style="font-size:11.5px; font-weight:600; color:#10b981; display:flex; align-items:center; gap:4px;">
                        <span style="width:6px; height:6px; border-radius:50%; background:#10b981;"></span> Active Discussion
                      </span>
                      ${
                        selectedThread.recipientPublicId
                          ? `<a href="https://linkedin.com/in/${selectedThread.recipientPublicId}" target="_blank" rel="noopener noreferrer" style="font-size:11.5px; font-weight:600; color:#2563eb; text-decoration:none;">View LinkedIn Profile ↗</a>`
                          : ''
                      }
                    </div>
                  </div>
                </div>
              </div>

              <!-- Message Stream -->
              <div class="chat-messages-stream" style="flex:1; overflow-y:auto; padding:24px; display:flex; flex-direction:column; gap:14px; background:#f8fafc;">
                ${
                  isFetchingMessages
                    ? `
                    <div style="display:flex; align-items:center; justify-content:center; height:100%; color:#94a3b8; font-size:13px; font-weight:600; gap:8px;">
                      <div class="spinner" style="width:20px; height:20px; border:2px solid #cbd5e1; border-top-color:#2563eb; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
                      Loading messages...
                    </div>
                  `
                    : activeMessages.length === 0
                      ? `
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#94a3b8; text-align:center;">
                      <span style="font-size:28px; margin-bottom:8px;">✉️</span>
                      <strong style="color:#475569; font-size:13px;">No message history loaded yet</strong>
                      <p style="font-size:12px; margin:4px 0 0; color:#64748b;">${selectedThread.snippet || 'Send a follow-up message below.'}</p>
                    </div>
                  `
                      : activeMessages
                          .map((m) => {
                            const isMe = m.fromMe;
                            return `
                        <div style="display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'};">
                          <div style="max-width:70%; padding:12px 16px; border-radius:${isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px'}; background:${isMe ? '#2563eb' : '#fff'}; color:${isMe ? '#fff' : '#0f172a'}; box-shadow:0 2px 8px rgba(0,0,0,0.04); border:${isMe ? 'none' : '1px solid #e2e8f0'}; font-size:13.5px; line-height:1.45; word-break:break-word;">
                            ${m.body}
                          </div>
                          <span style="font-size:10.5px; font-weight:500; color:#94a3b8; margin-top:4px; padding:0 4px;">
                            ${m.sentAt ? new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                      `;
                          })
                          .join('')
                }
              </div>

              <!-- Message Composer -->
              <div style="padding:16px 20px; border-top:1px solid #e2e8f0; background:#fff; display:flex; flex-direction:column; gap:10px;">
                <textarea id="inbox-reply-text" rows="2" placeholder="Write a reply to ${selectedThread.senderName}..." style="width:100%; padding:10px 14px; border:1.5px solid #cbd5e1; border-radius:10px; font-size:13px; outline:none; resize:none; font-family:inherit; box-sizing:border-box; transition:border-color 0.2s;"></textarea>
                <div style="display:flex; align-items:center; justify-content:space-between;">
                  <span style="font-size:11px; color:#94a3b8;">Shift + Enter for new line</span>
                  <button type="button" id="btn-send-inbox-reply" style="background:#2563eb; color:#fff; border:none; padding:8px 18px; border-radius:8px; font-size:12.5px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all 0.2s; box-shadow:0 2px 8px rgba(37,99,235,0.25);">
                    Send Reply →
                  </button>
                </div>
              </div>
            `
          }
        </main>
      </div>
    `;

    // Filter tab clicks
    container.querySelectorAll('.btn-inbox-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        paint();
      });
    });

    // Search input
    const searchInput = container.querySelector('#inbox-search-input');
    searchInput?.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      paint();
      const newInp = container.querySelector('#inbox-search-input');
      if (newInp) {
        newInp.focus();
        newInp.setSelectionRange(newInp.value.length, newInp.value.length);
      }
    });

    // Refresh button
    container.querySelector('#btn-sync-inbox')?.addEventListener('click', () => {
      renderInboxView(container, ctx);
    });

    // Thread selection
    container.querySelectorAll('.inbox-thread-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const target = normalizedThreads.find((t) => t.threadId === id);
        if (target) loadMessages(target);
      });
    });

    // Quick start button in empty pane
    container.querySelector('#btn-create-first-convo')?.addEventListener('click', () => {
      if (normalizedThreads.length > 0) {
        loadMessages(normalizedThreads[0]);
      } else {
        renderInboxView(container, ctx);
      }
    });

    // Auto-scroll message stream to bottom
    const stream = container.querySelector('.chat-messages-stream');
    if (stream) {
      stream.scrollTop = stream.scrollHeight;
    }

    // Keydown Shift+Enter vs Enter in reply textarea
    const replyTextarea = container.querySelector('#inbox-reply-text');
    replyTextarea?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        container.querySelector('#btn-send-inbox-reply')?.click();
      }
    });

    // Send reply button
    const sendBtn = container.querySelector('#btn-send-inbox-reply');
    if (sendBtn && selectedThread) {
      sendBtn.addEventListener('click', async () => {
        const textarea = container.querySelector('#inbox-reply-text');
        const text = textarea?.value?.trim();
        if (!text) return;

        const recipientPid = selectedThread.recipientPublicId;
        if (!recipientPid) {
          ctx.showToast?.('Could not resolve recipient profile ID to message.', 'error');
          return;
        }

        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';

        try {
          await call(ACTIONS.OUTREACH_MESSAGE, {
            publicId: recipientPid,
            body: text,
          });

          ctx.showToast?.(`Reply sent to ${selectedThread.senderName}!`, 'success');
          textarea.value = '';
          loadMessages(selectedThread);
        } catch (e) {
          ctx.showToast?.(`Could not send reply: ${e.message}`, 'error');
        } finally {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send Reply →';
        }
      });
    }
  }

  if (selectedThread) {
    loadMessages(selectedThread);
  } else {
    paint();
  }
}
