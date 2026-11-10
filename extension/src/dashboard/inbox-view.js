/**
 * OutFox — Waalaxy Inbox View
 * Real-time conversation triage and direct reply composer.
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { ICONS } from '../ui/icons.js';

export async function renderInboxView(container, ctx = {}) {
  if (!container) return;

  container.innerHTML = `
    <div class="view-loading-state">
      <div class="spinner"></div>
      <span>Loading conversations...</span>
    </div>
  `;

  let threads = [];

  try {
    threads = await call(ACTIONS.INBOX_THREADS, { start: 0, count: 30 }).catch(() => []);
  } catch (e) {
    console.warn('[Inbox View] Read error', e);
  }

  const threadList = Array.isArray(threads) ? threads : [];
  let selectedThread = threadList[0] || null;
  let messages = [];

  async function loadMessages(thread) {
    selectedThread = thread;
    if (!thread) {
      messages = [];
      paint();
      return;
    }

    try {
      messages = await call(ACTIONS.INBOX_MESSAGES, { threadId: thread.threadId || thread.id }).catch(() => []);
    } catch {
      messages = [];
    }
    paint();
  }

  function paint() {
    container.innerHTML = `
      <div class="inbox-view-shell">
        <div class="inbox-top-bar">
          <div>
            <h2 class="view-main-title">Inbox Triage</h2>
            <p class="view-main-sub">Read incoming replies from connections and send responses directly</p>
          </div>
          <button type="button" class="btn-pill btn-secondary btn-sm" id="btn-refresh-inbox">Refresh</button>
        </div>

        <div class="inbox-split-container glass-panel">
          <!-- Left: Threads List -->
          <div class="inbox-threads-sidebar">
            <div class="threads-head">
              <span class="threads-count">${threadList.length} Conversations</span>
            </div>

            <div class="threads-scroll-list">
              ${
                threadList.length === 0
                  ? `
                  <div class="empty-inbox-pane">
                    <span class="empty-icon-mini">${ICONS.message}</span>
                    <span class="empty-text">No conversations found yet. Incoming replies will appear here.</span>
                  </div>
                `
                  : threadList
                      .map((t) => {
                        const isSelected = selectedThread && (selectedThread.threadId === t.threadId || selectedThread.id === t.id);
                        const senderName = t.senderName || t.participantName || 'LinkedIn Member';
                        const initials = senderName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
                        const snippet = t.lastMessage || t.snippet || 'No message preview';
                        const time = t.timestamp ? new Date(t.timestamp).toLocaleDateString() : '';

                        return `
                    <div class="thread-item-card ${isSelected ? 'selected' : ''}" data-id="${t.threadId || t.id}">
                      <div class="thread-avatar">${initials}</div>
                      <div class="thread-content-col">
                        <div class="thread-item-head">
                          <span class="thread-name">${senderName}</span>
                          <span class="thread-date">${time}</span>
                        </div>
                        <p class="thread-snippet">${snippet}</p>
                      </div>
                    </div>
                  `;
                      })
                      .join('')
              }
            </div>
          </div>

          <!-- Right: Message Viewer & Composer -->
          <div class="inbox-conversation-pane">
            ${
              !selectedThread
                ? `
                <div class="no-thread-selected">
                  <span class="select-icon">${ICONS.email}</span>
                  <h3>Select a conversation</h3>
                  <p>Choose a lead from the left to read messages and reply.</p>
                </div>
              `
                : `
                <div class="conversation-header">
                  <div class="convo-user">
                    <span class="convo-name">${selectedThread.senderName || selectedThread.participantName || 'LinkedIn Member'}</span>
                    <span class="convo-status">Active conversation</span>
                  </div>
                </div>

                <div class="conversation-messages-body">
                  ${
                    messages.length === 0
                      ? `
                      <div class="empty-messages-placeholder">
                        <p>${selectedThread.lastMessage || 'Connected on LinkedIn. You can send a follow-up note below.'}</p>
                      </div>
                    `
                      : messages
                          .map((m) => {
                            const isMe = m.isOutgoing || m.fromMe;
                            return `
                        <div class="message-bubble-row ${isMe ? 'outgoing' : 'incoming'}">
                          <div class="message-bubble">
                            <p>${m.text || m.body || ''}</p>
                            <span class="message-time">${m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                          </div>
                        </div>
                      `;
                          })
                          .join('')
                  }
                </div>

                <!-- Composer -->
                <div class="conversation-composer">
                  <textarea id="inbox-reply-text" class="composer-textarea" rows="2" placeholder="Write a reply..."></textarea>
                  <div class="composer-actions">
                    <button type="button" class="btn-pill btn-primary btn-sm" id="btn-send-inbox-reply">Send Reply →</button>
                  </div>
                </div>
              `
            }
          </div>
        </div>
      </div>
    `;

    // Thread selection
    container.querySelectorAll('.thread-item-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const target = threadList.find((t) => (t.threadId || t.id) === id);
        if (target) loadMessages(target);
      });
    });

    // Refresh
    container.querySelector('#btn-refresh-inbox')?.addEventListener('click', () => {
      renderInboxView(container, ctx);
    });

    // Send reply
    const sendBtn = container.querySelector('#btn-send-inbox-reply');
    if (sendBtn) {
      sendBtn.addEventListener('click', async () => {
        const textarea = container.querySelector('#inbox-reply-text');
        const text = textarea?.value?.trim();
        if (!text) return;

        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';

        try {
          const recipientId = selectedThread.recipientPublicId || selectedThread.publicId || selectedThread.senderPublicId;
          await call(ACTIONS.OUTREACH_MESSAGE, {
            recipientPublicId: recipientId,
            body: text,
          });

          ctx.showToast?.('Reply sent successfully!', 'success');
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

