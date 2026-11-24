/**
 * Crafture Network — Authentic Crafture Network Inbox View
 * Production Real-Time Conversation Triage, Live LinkedIn Chat Mirror & Composer.
 * 100% Manifest V3 CSP Compliant · Vector Icons · Flicker-Free Live In-Place Updates
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { ICONS } from '../ui/icons.js';

const INBOX_RELEVANT_KEYS = new Set(['conversations', 'inbox', 'messages', 'leads', 'prospects', 'threads', 'inboxSeen']);

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

function normalizeThread(t) {
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
  const timestamp = Number(t.lastMessageAt || t.updatedAt || t.timestamp || 0);
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
}

function sortThreads(list) {
  return [...list].sort((a, b) => {
    const timeA = Number(a.lastMessageAt || a.updatedAt || a.timestamp || a.raw?.lastMessageAt || a.raw?.updatedAt || 0);
    const timeB = Number(b.lastMessageAt || b.updatedAt || b.timestamp || b.raw?.lastMessageAt || b.raw?.updatedAt || 0);
    return timeB - timeA;
  });
}

export async function renderInboxView(container, ctx = {}) {
  if (!container) return;

  // View lifecycle tracker
  let mounted = true;
  let isSyncing = false;
  let activeFilter = 'all'; // 'all' | 'unread'
  let searchQuery = '';

  const savedInboxState = ctx?.getSavedState?.() || {};
  if (ctx?.subState) {
    activeFilter = ctx.subState;
  } else if (savedInboxState.activeSubTab || savedInboxState.activeFilter) {
    activeFilter = savedInboxState.activeSubTab || savedInboxState.activeFilter;
  }
  if (savedInboxState.searchQuery) searchQuery = savedInboxState.searchQuery;

  let normalizedThreads = [];
  let selectedThread = null;
  let activeMessages = [];

  // If layout is already in DOM, perform an in-place silent sync rather than tearing down DOM
  const existingLayout = container.querySelector('.cn-inbox-layout');
  if (existingLayout) {
    await performSilentRefresh();
    return;
  }

  // Initial spinner on cold mount
  if (!ctx.silent && ctx.isInitialRender !== false) {
    container.innerHTML = `
      <div class="inbox-loading-container" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:60vh; gap:14px;">
        <div class="spinner" style="width:36px; height:36px; border:3px solid #e2e8f0; border-top-color:#104B35; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
        <span style="font-size:14px; font-weight:600; color:#64748b;">Syncing conversations from LinkedIn...</span>
      </div>
    `;
  }

  // Initial fetch of threads
  try {
    const res = await call(ACTIONS.INBOX_THREADS, { count: 50, refresh: true }).catch(() => null);
    const raw = Array.isArray(res?.threads) ? res.threads : (Array.isArray(res) ? res : []);
    normalizedThreads = sortThreads(raw.map(normalizeThread));
  } catch (e) {
    console.warn('[Inbox View] Fetch error:', e);
  }

  if (!mounted) return;

  const savedThreadId = savedInboxState.selectedThreadId;
  selectedThread = (savedThreadId && normalizedThreads.find((t) => t.threadId === savedThreadId)) || normalizedThreads[0] || null;

  // Render Base Layout Structure ONCE
  container.innerHTML = `
    <div class="cn-inbox-layout" style="display:flex; height:calc(100vh - 120px); gap:18px; padding:0 24px 24px; box-sizing:border-box;">
      
      <!-- LEFT: DISCUSSIONS SIDEBAR (380px) -->
      <aside class="inbox-discussions-sidebar" style="width:380px; min-width:340px; background:#fff; border:1px solid #e2e8f0; border-radius:14px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.03);">
        
        <!-- Head -->
        <div style="padding:18px 20px 14px; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:8px;">
            <h2 style="font-size:18px; font-weight:800; color:#0f172a; margin:0;">Discussions</h2>
            <span id="inbox-discussions-count" style="background:#E6EFE9; color:#104B35; font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px;">${normalizedThreads.length}</span>
          </div>
          <button type="button" id="btn-sync-inbox" style="background:#f8fafc; border:1px solid #e2e8f0; color:#475569; padding:5px 12px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:4px; transition:all 0.2s;">
            ↻ Refresh
          </button>
        </div>

        <!-- Sync Alert Banner -->
        <div style="background:#E6EFE9; border-left:4px solid #ff741f; padding:10px 14px; margin:12px 16px 6px; border-radius:6px; display:flex; align-items:flex-start; gap:8px;">
          <span style="color:#104B35; font-size:14px;">ℹ</span>
          <p style="margin:0; font-size:11.5px; color:#c2410c; line-height:1.4;">
            Syncing live conversations from your LinkedIn Primary Inbox in real time.
          </p>
        </div>

        <!-- Filter Tabs (All / Unread) -->
        <div style="display:flex; gap:8px; padding:10px 16px 6px;">
          <button type="button" id="btn-filter-all" class="btn-inbox-tab ${activeFilter === 'all' ? 'is-active' : ''}" data-filter="all" style="flex:1; padding:7px 12px; border-radius:8px; border:none; font-size:12.5px; font-weight:700; cursor:pointer; background:${activeFilter === 'all' ? '#104B35' : '#f1f5f9'}; color:${activeFilter === 'all' ? '#fff' : '#64748b'};">
            All (${normalizedThreads.length})
          </button>
          <button type="button" id="btn-filter-unread" class="btn-inbox-tab ${activeFilter === 'unread' ? 'is-active' : ''}" data-filter="unread" style="flex:1; padding:7px 12px; border-radius:8px; border:none; font-size:12.5px; font-weight:700; cursor:pointer; background:${activeFilter === 'unread' ? '#104B35' : '#f1f5f9'}; color:${activeFilter === 'unread' ? '#fff' : '#64748b'};">
            Unread (${normalizedThreads.filter((t) => t.unread).length})
          </button>
        </div>

        <!-- Search Input -->
        <div style="padding:8px 16px 12px;">
          <div style="position:relative; display:flex; align-items:center;">
            <span style="position:absolute; left:12px; color:#94a3b8; display:flex;">${ICONS.search}</span>
            <input type="text" id="inbox-search-input" value="${escapeHtml(searchQuery)}" placeholder="Search for a contact..." style="width:100%; padding:9px 12px 9px 34px; border:1px solid #cbd5e1; border-radius:8px; font-size:12.5px; outline:none; background:#f8fafc; transition:all 0.2s;" />
          </div>
        </div>

        <!-- Threads Scroll Stream -->
        <div class="threads-scroll-viewport" style="flex:1; overflow-y:auto; padding:0 8px 12px;"></div>
      </aside>

      <!-- RIGHT: CONVERSATION PANE & COMPOSER (Flex 1) -->
      <main class="inbox-chat-pane" style="flex:1; background:#fff; border:1px solid #e2e8f0; border-radius:14px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.03);">
        
        <!-- Empty State Container -->
        <div id="inbox-empty-pane" style="display:${selectedThread ? 'none' : 'flex'}; flex:1; flex-direction:column; align-items:center; justify-content:center; padding:32px; text-align:center;">
          <div style="width:72px; height:72px; border-radius:50%; background:#E6EFE9; display:flex; align-items:center; justify-content:center; color:#104B35; margin-bottom:16px;">
            ${ICONS.message}
          </div>
          <h3 style="font-size:20px; font-weight:800; color:#0f172a; margin:0 0 8px;">Create a conversation to start</h3>
          <p style="font-size:13px; color:#64748b; max-width:360px; margin:0 0 20px; line-height:1.5;">
            Select a discussion from the left to read conversation history, view profiles, and send replies.
          </p>
          <button type="button" id="btn-create-first-convo" style="background:#167448; color:#fff; border:none; padding:10px 20px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; box-shadow:0 1px 2px rgba(15,23,42,0.05);">
            + Select a conversation to start
          </button>
        </div>

        <!-- Active Conversation Container -->
        <div id="inbox-active-pane" style="display:${selectedThread ? 'flex' : 'none'}; flex:1; flex-direction:column; height:100%; overflow:hidden;">
          
          <!-- Chat Header -->
          <div style="padding:16px 24px; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between; background:#fff; shrink-0;">
            <div style="display:flex; align-items:center; gap:12px;">
              <div id="inbox-header-avatar" style="width:42px; height:42px; border-radius:50%; background:linear-gradient(135deg, #ff741f 0%, #167448 100%); color:#fff; display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700;">
                ${selectedThread?.initials || 'LM'}
              </div>
              <div>
                <h3 id="inbox-header-name" style="font-size:15px; font-weight:800; color:#0f172a; margin:0 0 2px;">${escapeHtml(selectedThread?.senderName || 'LinkedIn Member')}</h3>
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:11.5px; font-weight:600; color:#10b981; display:flex; align-items:center; gap:4px;">
                    <span style="width:6px; height:6px; border-radius:50%; background:#10b981;"></span> Active Discussion
                  </span>
                  <a id="inbox-header-linkedin" href="${selectedThread?.recipientPublicId ? `https://linkedin.com/in/${escapeHtml(selectedThread.recipientPublicId)}` : '#'}" target="_blank" rel="noopener noreferrer" style="font-size:11.5px; font-weight:600; color:#104B35; text-decoration:none; display:${selectedThread?.recipientPublicId ? 'inline-flex' : 'none'}; align-items:center; gap:3px;">
                    View LinkedIn Profile ${ICONS.arrowUpRight}
                  </a>
                </div>
              </div>
            </div>
          </div>

          <!-- Message Stream (Scrollable) -->
          <div class="chat-messages-stream" style="flex:1; overflow-y:auto; padding:24px; display:flex; flex-direction:column; gap:14px; background:#f8fafc;">
            <div style="display:flex; align-items:center; justify-content:center; height:100%; color:#94a3b8; font-size:13px; font-weight:600; gap:8px;">
              <div class="spinner" style="width:20px; height:20px; border:2px solid #cbd5e1; border-top-color:#104B35; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
              Loading messages...
            </div>
          </div>

          <!-- Message Composer Area (Strictly Preserved - Never reset on background sync) -->
          <div class="inbox-composer-area" style="padding:16px 20px; border-top:1px solid #e2e8f0; background:#fff; display:flex; flex-direction:column; gap:10px; shrink-0;">
            <!-- Smart Action Bar -->
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <button type="button" id="btn-inbox-ai-playbook" style="display:inline-flex; align-items:center; gap:5px; background:#E6EFE9; border:1px solid #DCE5DE; color:#167448; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer;" title="Analyze inbound message & apply personalized Objection Playbook response">
                  ${ICONS.sparkles} AI Playbook Reply
                </button>
                <button type="button" id="btn-inbox-insert-resume" style="display:inline-flex; align-items:center; gap:5px; background:#f8fafc; border:1px solid #e2e8f0; color:#475569; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer;" title="Insert active candidate resume link">
                  ${ICONS.fileText} Insert Resume
                </button>
                <button type="button" id="btn-inbox-snooze-30" style="display:inline-flex; align-items:center; gap:5px; background:#f8fafc; border:1px solid #e2e8f0; color:#475569; padding:4px 10px; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer;" title="Snooze lead for 30 days">
                  ${ICONS.clock} Snooze 30d
                </button>
              </div>
              <span id="inbox-intent-badge" style="display:none; font-size:11px; font-weight:700; background:#f1f5f9; color:#64748b; padding:2px 8px; border-radius:12px;"></span>
            </div>

            <!-- Composer Textarea -->
            <textarea id="inbox-reply-text" rows="2" placeholder="Write a reply to ${escapeHtml(selectedThread?.senderName || 'contact')}..." style="width:100%; padding:10px 14px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; outline:none; resize:none; font-family:inherit; box-sizing:border-box; transition:border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);"></textarea>
            
            <div style="display:flex; align-items:center; justify-content:space-between;">
              <span style="font-size:11px; color:#94a3b8;">Shift + Enter for new line</span>
              <button type="button" id="btn-send-inbox-reply" style="background:#167448; color:#fff; border:none; padding:8px 18px; border-radius:8px; font-size:12.5px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all 0.18s cubic-bezier(0.22, 1, 0.36, 1); box-shadow:0 1px 2px rgba(15,23,42,0.05);">
                Send Reply ${ICONS.arrowRight}
              </button>
            </div>
          </div>

        </div>
      </main>
    </div>
  `;

  // ── In-Place DOM Renderers ────────────────────────────────────────────────

  function renderThreadsListDOM() {
    const threadViewport = container.querySelector('.threads-scroll-viewport');
    if (!threadViewport) return;

    normalizedThreads = sortThreads(normalizedThreads);

    const filtered = normalizedThreads.filter((t) => {
      if (activeFilter === 'unread' && !t.unread) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return t.senderName.toLowerCase().includes(q) || t.snippet.toLowerCase().includes(q);
      }
      return true;
    });

    const unreadCount = normalizedThreads.filter((t) => t.unread).length;

    // Update count badges
    const countEl = container.querySelector('#inbox-discussions-count');
    if (countEl) countEl.textContent = String(normalizedThreads.length);

    const btnAll = container.querySelector('#btn-filter-all');
    if (btnAll) {
      btnAll.textContent = `All (${normalizedThreads.length})`;
      btnAll.style.background = activeFilter === 'all' ? '#104B35' : '#f1f5f9';
      btnAll.style.color = activeFilter === 'all' ? '#fff' : '#64748b';
    }

    const btnUnread = container.querySelector('#btn-filter-unread');
    if (btnUnread) {
      btnUnread.textContent = `Unread (${unreadCount})`;
      btnUnread.style.background = activeFilter === 'unread' ? '#104B35' : '#f1f5f9';
      btnUnread.style.color = activeFilter === 'unread' ? '#fff' : '#64748b';
    }

    // Preserve scroll position of thread list
    const prevScroll = threadViewport.scrollTop;

    if (filtered.length === 0) {
      threadViewport.innerHTML = `
        <div style="text-align:center; padding:48px 16px; color:#94a3b8;">
          <span style="display:flex; justify-content:center; margin-bottom:8px; color:#94a3b8;">${ICONS.message}</span>
          <strong style="font-size:13.5px; color:#475569; display:block;">No conversations found</strong>
          <p style="font-size:12px; margin:4px 0 0; color:#64748b;">Incoming messages from LinkedIn connections will appear here automatically.</p>
        </div>
      `;
    } else {
      threadViewport.innerHTML = filtered
        .map((t) => {
          const isSelected = selectedThread && selectedThread.threadId === t.threadId;
          return `
            <div class="inbox-thread-card" data-id="${escapeHtml(t.threadId)}" style="display:flex; align-items:flex-start; gap:12px; padding:12px; border-radius:10px; cursor:pointer; margin-bottom:4px; transition:all 0.15s; background:${isSelected ? '#f1f5f9' : '#fff'}; border:${isSelected ? '1.5px solid #104B35' : '1px solid transparent'};">
              <div style="width:40px; height:40px; min-width:40px; border-radius:50%; background:linear-gradient(135deg, #ff741f 0%, #167448 100%); color:#fff; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; box-shadow:0 1px 3px rgba(15,23,42,0.08);">
                ${escapeHtml(t.initials)}
              </div>
              <div style="flex:1; min-width:0;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:3px;">
                  <span style="font-size:13px; font-weight:700; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(t.senderName)}</span>
                  <span style="font-size:11px; font-weight:500; color:#94a3b8; white-space:nowrap; margin-left:6px;">${formatTimeAgo(t.timestamp)}</span>
                </div>
                <p style="font-size:12px; color:#64748b; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; line-height:1.3;">
                  ${escapeHtml(t.snippet)}
                </p>
              </div>
              ${t.unread ? `<span style="width:8px; height:8px; border-radius:50%; background:#104B35; margin-top:6px; shrink-0;"></span>` : ''}
            </div>
          `;
        })
        .join('');
    }

    threadViewport.scrollTop = prevScroll;

    // Re-attach card click listeners
    threadViewport.querySelectorAll('.inbox-thread-card').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.id;
        const target = normalizedThreads.find((t) => t.threadId === id);
        if (target && target.threadId !== selectedThread?.threadId) {
          selectThread(target, { isUserSwitch: true });
        }
      });
    });
  }

  function renderMessagesStreamDOM(list, { silent = false, forceScrollBottom = false } = {}) {
    const stream = container.querySelector('.chat-messages-stream');
    if (!stream) return;

    const normalizedList = list.map((m) => ({
      messageId: m.messageId || `${m.sentAt}_${Math.random()}`,
      body: m.body || m.text || '',
      sentAt: m.sentAt || m.timestamp || Date.now(),
      fromMe: Boolean(m.fromMe || m.isOutgoing || (!m.fromPublicId && !m.fromUrn)),
      fromPublicId: m.fromPublicId || '',
    }));

    // If silent refresh and message list is identical, skip DOM rewrite entirely (Zero flicker!)
    if (silent && normalizedList.length === activeMessages.length && activeMessages.length > 0) {
      const lastIncoming = normalizedList[normalizedList.length - 1];
      const lastActive = activeMessages[activeMessages.length - 1];
      if (lastIncoming.messageId === lastActive.messageId && lastIncoming.body === lastActive.body) {
        return;
      }
    }

    // Measure scroll position before DOM update
    const isNearBottom = forceScrollBottom || (stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80);
    const prevScrollTop = stream.scrollTop;

    activeMessages = normalizedList;

    if (activeMessages.length === 0) {
      stream.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#94a3b8; text-align:center;">
          <span style="display:flex; justify-content:center; margin-bottom:8px; color:#94a3b8;">${ICONS.email}</span>
          <strong style="color:#475569; font-size:13px;">No message history loaded yet</strong>
          <p style="font-size:12px; margin:4px 0 0; color:#64748b;">${escapeHtml(selectedThread?.snippet || 'Send a follow-up message below.')}</p>
        </div>
      `;
    } else {
      stream.innerHTML = activeMessages
        .map((m) => {
          const isMe = m.fromMe;
          return `
            <div style="display:flex; flex-direction:column; align-items:${isMe ? 'flex-end' : 'flex-start'};">
              <div style="max-width:70%; padding:12px 16px; border-radius:${isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px'}; background:${isMe ? '#104B35' : '#fff'}; color:${isMe ? '#fff' : '#0f172a'}; box-shadow:0 1px 2px rgba(15,23,42,0.04); border:${isMe ? 'none' : '1px solid #e2e8f0'}; font-size:13.5px; line-height:1.45; word-break:break-word;">
                ${escapeHtml(m.body)}
              </div>
              <span style="font-size:11px; font-weight:500; color:#94a3b8; margin-top:4px; padding:0 4px; font-variant-numeric:tabular-nums;">
                ${m.sentAt ? new Date(m.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
          `;
        })
        .join('');
    }

    // Auto-scroll to bottom only if candidate was already at the bottom or thread just switched
    if (isNearBottom) {
      stream.scrollTop = stream.scrollHeight;
    } else {
      stream.scrollTop = prevScrollTop;
    }
  }

  async function selectThread(thread, { isUserSwitch = false } = {}) {
    selectedThread = thread;
    ctx?.saveState?.({
      activeSubTab: activeFilter,
      activeFilter,
      searchQuery,
      selectedThreadId: thread?.threadId || null,
    });

    const emptyPane = container.querySelector('#inbox-empty-pane');
    const activePane = container.querySelector('#inbox-active-pane');

    if (!thread) {
      if (emptyPane) emptyPane.style.display = 'flex';
      if (activePane) activePane.style.display = 'none';
      return;
    }

    if (emptyPane) emptyPane.style.display = 'none';
    if (activePane) activePane.style.display = 'flex';

    // Update Chat Header in-place
    const avatarEl = container.querySelector('#inbox-header-avatar');
    if (avatarEl) avatarEl.textContent = thread.initials;

    const nameEl = container.querySelector('#inbox-header-name');
    if (nameEl) nameEl.textContent = thread.senderName;

    const linkedinLink = container.querySelector('#inbox-header-linkedin');
    if (linkedinLink) {
      if (thread.recipientPublicId) {
        linkedinLink.href = `https://linkedin.com/in/${encodeURIComponent(thread.recipientPublicId)}`;
        linkedinLink.style.display = 'inline-flex';
      } else {
        linkedinLink.style.display = 'none';
      }
    }

    // Update Composer Placeholder
    const replyTextarea = container.querySelector('#inbox-reply-text');
    if (replyTextarea) {
      replyTextarea.placeholder = `Write a reply to ${thread.senderName}...`;
      if (isUserSwitch) {
        replyTextarea.value = '';
      }
    }

    // Update thread card highlight
    container.querySelectorAll('.inbox-thread-card').forEach((c) => {
      const match = c.dataset.id === thread.threadId;
      c.style.background = match ? '#f1f5f9' : '#fff';
      c.style.border = match ? '1.5px solid #104B35' : '1px solid transparent';
    });

    // Fetch messages for new thread
    const stream = container.querySelector('.chat-messages-stream');
    if (stream && isUserSwitch) {
      stream.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; height:100%; color:#94a3b8; font-size:13px; font-weight:600; gap:8px;">
          <div class="spinner" style="width:20px; height:20px; border:2px solid #cbd5e1; border-top-color:#104B35; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
          Loading messages...
        </div>
      `;
    }

    try {
      const res = await call(ACTIONS.INBOX_MESSAGES, {
        threadId: thread.threadId,
        refresh: true,
        count: 50,
      }).catch(() => null);

      if (!mounted) return;
      const list = Array.isArray(res?.messages) ? res.messages : (Array.isArray(res) ? res : []);
      renderMessagesStreamDOM(list, { silent: false, forceScrollBottom: true });
    } catch (e) {
      console.warn('[Inbox View] Messages fetch error:', e);
      if (stream) {
        stream.innerHTML = `<div style="text-align:center; padding:24px; color:#ef4444; font-size:13px;">Failed to load messages: ${escapeHtml(e.message)}</div>`;
      }
    }
  }

  // ── Live Auto-Polling & Silent Refresh (Zero-Flicker) ──────────────────────

  async function performSilentRefresh({ manual = false } = {}) {
    if (isSyncing || !mounted) return;

    // Skip polling if document is hidden or user navigated to a different dashboard view
    if (!manual) {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      if (ctx.isActiveView && !ctx.isActiveView()) {
        return;
      }
    }

    isSyncing = true;
    const syncBtn = container.querySelector('#btn-sync-inbox');
    if (manual && syncBtn) syncBtn.textContent = '↻ Syncing...';

    try {
      // 1. Fetch fresh conversations from LinkedIn
      const res = await call(ACTIONS.INBOX_THREADS, { count: 50, refresh: true }).catch(() => null);
      if (!mounted) return;

      const raw = Array.isArray(res?.threads) ? res.threads : (Array.isArray(res) ? res : []);
      if (raw.length > 0) {
        normalizedThreads = sortThreads(raw.map(normalizeThread));
        renderThreadsListDOM();
      }

      // 2. Fetch fresh messages for the active conversation
      if (selectedThread?.threadId) {
        const mRes = await call(ACTIONS.INBOX_MESSAGES, {
          threadId: selectedThread.threadId,
          refresh: true,
          count: 50,
        }).catch(() => null);

        if (!mounted) return;
        const list = Array.isArray(mRes?.messages) ? mRes.messages : (Array.isArray(mRes) ? mRes : []);
        if (list.length > 0) {
          renderMessagesStreamDOM(list, { silent: true });
        }
      }

      if (manual) {
        ctx?.showToast?.('Inbox synchronized with LinkedIn', 'success');
      }
    } catch (err) {
      console.warn('[Inbox View] Silent poll error:', err);
      if (manual) {
        ctx?.showToast?.(`Sync failed: ${err.message}`, 'error');
      }
    } finally {
      isSyncing = false;
      if (manual && syncBtn) syncBtn.textContent = '↻ Refresh';
    }
  }

  // Initial renders
  renderThreadsListDOM();
  if (selectedThread) {
    selectThread(selectedThread, { isUserSwitch: false });
  }

  // ── Persistent Event Listeners ─────────────────────────────────────────────

  // Filter tabs
  container.querySelector('#btn-filter-all')?.addEventListener('click', () => {
    activeFilter = 'all';
    ctx?.updateSubState?.(activeFilter);
    ctx?.saveState?.({ activeSubTab: activeFilter, activeFilter, searchQuery, selectedThreadId: selectedThread?.threadId || null });
    renderThreadsListDOM();
  });

  container.querySelector('#btn-filter-unread')?.addEventListener('click', () => {
    activeFilter = 'unread';
    ctx?.updateSubState?.(activeFilter);
    ctx?.saveState?.({ activeSubTab: activeFilter, activeFilter, searchQuery, selectedThreadId: selectedThread?.threadId || null });
    renderThreadsListDOM();
  });

  // Search input: in-place list update without layout recreation
  const searchInput = container.querySelector('#inbox-search-input');
  searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    ctx?.saveState?.({ activeSubTab: activeFilter, activeFilter, searchQuery, selectedThreadId: selectedThread?.threadId || null });
    renderThreadsListDOM();
  });

  // Manual refresh button
  container.querySelector('#btn-sync-inbox')?.addEventListener('click', () => {
    performSilentRefresh({ manual: true });
  });

  // Quick start conversation in empty pane
  container.querySelector('#btn-create-first-convo')?.addEventListener('click', () => {
    if (normalizedThreads.length > 0) {
      selectThread(normalizedThreads[0], { isUserSwitch: true });
    } else {
      performSilentRefresh({ manual: true });
    }
  });

  // Smart Objection Playbook
  container.querySelector('#btn-inbox-ai-playbook')?.addEventListener('click', async () => {
    const inboundMsgs = (activeMessages || []).filter((m) => !m.fromMe);
    const lastInbound = inboundMsgs[inboundMsgs.length - 1];
    const replyTextarea = container.querySelector('#inbox-reply-text');
    const intentBadge = container.querySelector('#inbox-intent-badge');

    const messageToAnalyze = lastInbound?.body || 'Hi, can you share more details or your resume?';
    if (replyTextarea) {
      replyTextarea.placeholder = 'Analyzing objection intent with Crafture AI...';
    }

    try {
      const res = await call(ACTIONS.OBJECTION_MATCH_REPLY, {
        message: messageToAnalyze,
        publicId: selectedThread?.recipientPublicId || selectedThread?.publicId,
        fullName: selectedThread?.senderName,
      });

      if (replyTextarea && res?.personalizedReply) {
        replyTextarea.value = res.personalizedReply;
        replyTextarea.focus();
      }
      if (intentBadge && res?.tag) {
        intentBadge.style.display = 'inline-flex';
        intentBadge.style.alignItems = 'center';
        intentBadge.style.gap = '4px';
        intentBadge.innerHTML = `${ICONS.tag} ${escapeHtml(res.tag)}`;
      }
      ctx?.showToast?.(`AI Playbook: ${res?.title || 'Matched'}`, 'success');
    } catch (err) {
      ctx?.showToast?.(`AI Playbook error: ${err.message}`, 'error');
    }
  });

  // Insert Resume Link
  container.querySelector('#btn-inbox-insert-resume')?.addEventListener('click', async () => {
    try {
      const res = await call(ACTIONS.CANDIDATES_GET, {});
      const resumeUrl = res?.active?.resumeUrl || res?.active?.resumeLink;
      if (!resumeUrl) {
        ctx?.showToast?.('No resume URL set on active candidate. Configure it in Templates > Objections Playbook.', 'warn');
        return;
      }
      const replyTextarea = container.querySelector('#inbox-reply-text');
      if (replyTextarea) {
        const current = replyTextarea.value.trim();
        replyTextarea.value = current ? `${current}\n\nResume: ${resumeUrl}` : `Here is my updated resume: ${resumeUrl}`;
        replyTextarea.focus();
      }
      ctx?.showToast?.('Resume link inserted!', 'info');
    } catch (err) {
      ctx?.showToast?.(`Failed to load resume: ${err.message}`, 'error');
    }
  });

  // Snooze 30 Days
  container.querySelector('#btn-inbox-snooze-30')?.addEventListener('click', async () => {
    if (!selectedThread) return;
    try {
      await call(ACTIONS.LEAD_SNOOZE, {
        publicId: selectedThread.recipientPublicId || selectedThread.publicId,
        fullName: selectedThread.senderName,
        days: 30,
        note: 'Snoozed from Inbox',
      });
      ctx?.showToast?.(`Snoozed ${selectedThread.senderName} for 30 days!`, 'success');
    } catch (err) {
      ctx?.showToast?.(`Failed to snooze lead: ${err.message}`, 'error');
    }
  });

  // Keydown Shift+Enter vs Enter
  const replyTextarea = container.querySelector('#inbox-reply-text');
  replyTextarea?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      container.querySelector('#btn-send-inbox-reply')?.click();
    }
  });

  // Send Reply Button
  const sendBtn = container.querySelector('#btn-send-inbox-reply');
  sendBtn?.addEventListener('click', async () => {
    const textarea = container.querySelector('#inbox-reply-text');
    const text = textarea?.value?.trim();
    if (!text || !selectedThread) return;

    const recipientPid = selectedThread.recipientPublicId || selectedThread.publicId;
    if (!recipientPid) {
      ctx?.showToast?.('Could not resolve recipient profile ID to message.', 'error');
      return;
    }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    try {
      await call(ACTIONS.OUTREACH_MESSAGE, {
        publicId: recipientPid,
        body: text,
      });

      ctx?.showToast?.(`Reply sent to ${selectedThread.senderName}!`, 'success');
      textarea.value = '';

      // Optimistically append sent message
      const optimisticMsg = {
        messageId: `opt_${Date.now()}`,
        body: text,
        sentAt: Date.now(),
        fromMe: true,
      };
      renderMessagesStreamDOM([...activeMessages, optimisticMsg], { silent: false, forceScrollBottom: true });

      // Trigger fresh sync with LinkedIn
      performSilentRefresh();
    } catch (e) {
      ctx?.showToast?.(`Could not send reply: ${e.message}`, 'error');
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = `Send Reply ${ICONS.arrowRight}`;
    }
  });

  // ── 15s Auto-Polling Interval & Storage Change Listener ───────────────────

  const pollTimer = setInterval(() => {
    if (mounted) performSilentRefresh();
  }, 15000);

  let storageDebounceTimer = null;
  const storageListener = (changes, area) => {
    if (area !== 'local' || !mounted) return;
    const changedKeys = Object.keys(changes);
    const isRelevant = changedKeys.some((k) =>
      k === 'threads' ||
      k === 'inboxSeen' ||
      k.startsWith('messages:') ||
      INBOX_RELEVANT_KEYS.has(k)
    );
    if (!isRelevant) return;

    clearTimeout(storageDebounceTimer);
    storageDebounceTimer = setTimeout(() => {
      if (mounted) performSilentRefresh();
    }, 300);
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(storageListener);
  }

  // Register clean teardown when switching views or unmounting
  ctx.registerCleanup?.(() => {
    mounted = false;
    clearInterval(pollTimer);
    clearTimeout(storageDebounceTimer);
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(storageListener);
    }
  });
}
