/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderInboxView } from '../../src/dashboard/inbox-view.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint } from './helpers.js';

describe('Dashboard inbox-view', () => {
  it('mounts layout and fetches fresh threads and messages with refresh: true', async () => {
    const thread1 = {
      threadId: 't1',
      senderName: 'Sarah Connor',
      recipientPublicId: 'sarah-c',
      snippet: 'Are you available tomorrow?',
      lastMessageAt: Date.now(),
      unread: true,
      participants: [{ fullName: 'Sarah Connor', publicId: 'sarah-c' }],
    };

    const messages = [
      { messageId: 'm1', threadId: 't1', fromPublicId: 'sarah-c', body: 'Are you available tomorrow?', sentAt: Date.now() - 1000 },
    ];

    const engine = stubEngine({
      [ACTIONS.INBOX_THREADS]: { threads: [thread1] },
      [ACTIONS.INBOX_MESSAGES]: { messages },
    });

    const host = mountPoint();
    let cleanupFn = null;
    const ctx = {
      registerCleanup: (fn) => { cleanupFn = fn; },
      isActiveView: () => true,
    };

    await renderInboxView(host, ctx);
    await flush(10);

    // Verify threads call requested refresh: true
    expect(engine.paramsFor(ACTIONS.INBOX_THREADS)).toMatchObject({ refresh: true, count: 50 });

    // Verify layout and cards rendered
    expect(host.querySelector('.cn-inbox-layout')).toBeTruthy();
    expect(host.querySelectorAll('.inbox-thread-card')).toHaveLength(1);
    expect(host.querySelector('#inbox-header-name')?.textContent).toBe('Sarah Connor');

    // Verify messages stream loaded
    expect(host.querySelector('.chat-messages-stream')?.textContent).toContain('Are you available tomorrow?');

    // Clean up
    cleanupFn?.();
  });

  it('preserves reply textarea value on in-place silent refresh', async () => {
    let threadList = [
      {
        threadId: 't1',
        senderName: 'John Doe',
        recipientPublicId: 'johndoe',
        snippet: 'Initial hello',
        lastMessageAt: 1000,
        unread: false,
        participants: [{ fullName: 'John Doe', publicId: 'johndoe' }],
      },
    ];

    let messageList = [
      { messageId: 'm1', threadId: 't1', fromPublicId: 'johndoe', body: 'Initial hello', sentAt: 1000 },
    ];

    stubEngine({
      [ACTIONS.INBOX_THREADS]: () => ({ threads: threadList }),
      [ACTIONS.INBOX_MESSAGES]: () => ({ messages: messageList }),
    });

    const host = mountPoint();
    let cleanupFn = null;
    const ctx = {
      registerCleanup: (fn) => { cleanupFn = fn; },
      isActiveView: () => true,
    };

    await renderInboxView(host, ctx);
    await flush(10);

    const textarea = host.querySelector('#inbox-reply-text');
    expect(textarea).toBeTruthy();

    // User is actively drafting a message
    textarea.value = 'I am currently drafting my response...';

    // Now new message arrives from John Doe
    threadList = [
      {
        threadId: 't1',
        senderName: 'John Doe',
        recipientPublicId: 'johndoe',
        snippet: 'Second incoming follow-up',
        lastMessageAt: 2000,
        unread: true,
        participants: [{ fullName: 'John Doe', publicId: 'johndoe' }],
      },
    ];

    messageList = [
      { messageId: 'm1', threadId: 't1', fromPublicId: 'johndoe', body: 'Initial hello', sentAt: 1000 },
      { messageId: 'm2', threadId: 't1', fromPublicId: 'johndoe', body: 'Second incoming follow-up', sentAt: 2000 },
    ];

    // Trigger in-place silent refresh via re-rendering or clicking refresh button
    const syncBtn = host.querySelector('#btn-sync-inbox');
    syncBtn.click();
    await flush(10);

    // Message stream should show new incoming message
    expect(host.querySelector('.chat-messages-stream')?.textContent).toContain('Second incoming follow-up');

    // CRITICAL: Textarea value MUST NOT be wiped!
    const textareaAfter = host.querySelector('#inbox-reply-text');
    expect(textareaAfter.value).toBe('I am currently drafting my response...');

    cleanupFn?.();
  });

  it('sorts threads newest-first and selects the newest thread on initial open', async () => {
    const olderThread = {
      threadId: 't-older',
      senderName: 'Older Sender',
      recipientPublicId: 'older-p',
      snippet: 'Older message',
      lastMessageAt: 1000,
      unread: false,
      participants: [{ fullName: 'Older Sender', publicId: 'older-p' }],
    };

    const newestThread = {
      threadId: 't-newest',
      senderName: 'Newest Sender',
      recipientPublicId: 'newest-p',
      snippet: 'Newest message',
      lastMessageAt: 5000,
      unread: true,
      participants: [{ fullName: 'Newest Sender', publicId: 'newest-p' }],
    };

    const middleThread = {
      threadId: 't-middle',
      senderName: 'Middle Sender',
      recipientPublicId: 'middle-p',
      snippet: 'Middle message',
      lastMessageAt: 3000,
      unread: false,
      participants: [{ fullName: 'Middle Sender', publicId: 'middle-p' }],
    };

    // Even if engine returns unordered threads
    stubEngine({
      [ACTIONS.INBOX_THREADS]: { threads: [olderThread, newestThread, middleThread] },
      [ACTIONS.INBOX_MESSAGES]: { messages: [] },
    });

    const host = mountPoint();
    let cleanupFn = null;
    const ctx = {
      registerCleanup: (fn) => { cleanupFn = fn; },
      isActiveView: () => true,
    };

    await renderInboxView(host, ctx);
    await flush(10);

    // Verify first card in DOM is the newest thread
    const cards = host.querySelectorAll('.inbox-thread-card');
    expect(cards).toHaveLength(3);
    expect(cards[0].dataset.id).toBe('t-newest');
    expect(cards[1].dataset.id).toBe('t-middle');
    expect(cards[2].dataset.id).toBe('t-older');

    // Verify newest thread is selected initially in header
    expect(host.querySelector('#inbox-header-name')?.textContent).toBe('Newest Sender');

    cleanupFn?.();
  });
});
