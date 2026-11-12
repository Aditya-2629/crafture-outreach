/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderQueueView } from '../../src/dashboard/queue-view.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint } from './helpers.js';

describe('QueueView — Live Status Banner & Per-Row Pills', () => {
  let container;
  let toasts = [];
  const ctx = {
    showToast: (msg, type) => toasts.push({ msg, type }),
  };

  beforeEach(() => {
    toasts = [];
    document.body.innerHTML = '';
    container = mountPoint();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('renders top live runner status banner and per-row live status pills', async () => {
    const now = Date.now();
    stubEngine({
      [ACTIONS.STATUS_GET]: () => ({
        quotas: {
          invite: { dailyUsed: 5, dailyCap: 25, weeklyUsed: 20, weeklyCap: 150 },
          message: { dailyUsed: 2, dailyCap: 40 },
          visit: { dailyUsed: 10, dailyCap: 80 },
          email: { dailyUsed: 0, dailyCap: 50 },
        },
      }),
      [ACTIONS.CONFIG_GET]: () => ({
        weeklyInviteCap: 150,
        dailyEmailCap: 50,
      }),
    });

    // Seed chrome.storage.local
    await chrome.storage.local.set({
      campaigns: [
        {
          campaignId: 'camp_live_1',
          name: 'Engineers USA',
          status: 'active',
          steps: [
            { type: 'view' },
            { type: 'invite' },
          ],
        },
      ],
      'enrollments:camp_live_1': [
        {
          publicId: 'prospect_due_now',
          fullName: 'Alice Walker',
          status: 'active',
          stepIndex: 0,
          nextAt: now - 5000, // Due now
        },
        {
          publicId: 'prospect_scheduled',
          fullName: 'Bob Smith',
          status: 'active',
          stepIndex: 0,
          nextAt: now + 25 * 60 * 1000, // Scheduled in 25m
        },
        {
          publicId: 'prospect_retrying',
          fullName: 'Charlie Davis',
          status: 'active',
          stepIndex: 1,
          nextAt: now + 15 * 60 * 1000,
          retryCount: 1,
          lastError: 'Retry 1/3 in 15m: LinkedIn safety cooldown active',
        },
      ],
      actions: [
        {
          id: 'act_1',
          action: 'outreach.view',
          publicId: 'anita-bhatia',
          at: now - 2 * 60 * 1000,
        },
      ],
      outfox_bucket_cooldowns: {},
    });

    await renderQueueView(container, ctx);
    await flush();

    // 1. Verify Top Live Runner Status Banner exists
    const banner = container.querySelector('#queue-live-banner');
    expect(banner).not.toBeNull();

    // 2. Verify Engine State Pill: Active & Dripping
    expect(banner.textContent).toContain('Active & Dripping');

    // 3. Verify Next Scheduled Run
    expect(banner.textContent).toContain('Due now');

    // 4. Verify Last Completed Action
    expect(banner.textContent).toContain('Sent Visit to anita-bhatia');

    // 5. Verify Auto-refresh indicator
    expect(banner.textContent).toContain('Auto-refresh: ON (5s)');

    // 6. Verify Per-Row Status Pills in table
    const tableText = container.querySelector('.queue-table').textContent;
    expect(tableText).toContain('Due Now');
    expect(tableText).toContain('Scheduled (in');
    expect(tableText).toContain('Retry 1/3');
  });

  it('renders Safety Cooldown state in banner and Cooldown pill in row when bucket is resting', async () => {
    const now = Date.now();
    stubEngine({
      [ACTIONS.STATUS_GET]: () => ({ quotas: {} }),
      [ACTIONS.CONFIG_GET]: () => ({}),
    });

    await chrome.storage.local.set({
      campaigns: [
        {
          campaignId: 'camp_cool',
          name: 'Cooling Campaign',
          status: 'active',
          steps: [{ type: 'invite' }],
        },
      ],
      'enrollments:camp_cool': [
        {
          publicId: 'prospect_resting',
          fullName: 'Diana Prince',
          status: 'active',
          stepIndex: 0,
          nextAt: now - 1000,
        },
      ],
      outfox_bucket_cooldowns: {
        invite: now + 38 * 60 * 1000, // 38m left
      },
    });

    await renderQueueView(container, ctx);
    await flush();

    const banner = container.querySelector('#queue-live-banner');
    expect(banner.textContent).toContain('Safety Cooldown');
    expect(banner.textContent).toContain('Invites resting for 38m to protect account');

    const tableText = container.querySelector('.queue-table').textContent;
    expect(tableText).toContain('Cooldown (38m left)');
  });

  it('opens Lead Timeline Modal with chronological history when clicking prospect name', async () => {
    const now = Date.now();
    stubEngine({
      [ACTIONS.STATUS_GET]: () => ({ quotas: {} }),
      [ACTIONS.CONFIG_GET]: () => ({}),
    });

    await chrome.storage.local.set({
      campaigns: [
        {
          campaignId: 'camp_tl_1',
          name: 'Timeline Test Campaign',
          status: 'active',
          steps: [{ type: 'view' }, { type: 'invite' }],
        },
      ],
      'enrollments:camp_tl_1': [
        {
          publicId: 'ada_timeline',
          fullName: 'Ada Lovelace',
          status: 'active',
          stepIndex: 1,
          nextAt: now + 15 * 60 * 1000,
          history: [
            { step: 'enrolled', label: 'Enrolled in campaign', timestamp: now - 3600000, status: 'completed' },
            { step: 'view', label: 'Sent Visit', timestamp: now - 1800000, status: 'completed' },
          ],
        },
      ],
      outfox_bucket_cooldowns: {},
    });

    await renderQueueView(container, ctx);
    await flush();

    const trigger = container.querySelector('.btn-open-timeline[data-public-id="ada_timeline"]');
    expect(trigger).not.toBeNull();

    trigger.click();
    await flush();

    const modal = document.querySelector('#waalaxy-timeline-modal-backdrop');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain('Ada Lovelace');
    expect(modal.textContent).toContain('Timeline Test Campaign');
    expect(modal.textContent).toContain('Enrolled in campaign');
    expect(modal.textContent).toContain('Sent Visit');
    expect(modal.textContent).toContain('Sequence Timeline');

    // Close modal
    const closeBtn = modal.querySelector('#modal-btn-close');
    closeBtn.click();
    expect(document.querySelector('#waalaxy-timeline-modal-backdrop')).toBeNull();
  });

  it('handles Reset Quotas and Update activity buttons with toasts and button disabling', async () => {
    let quotaResetCalls = 0;
    let campaignTickCalls = 0;

    stubEngine({
      [ACTIONS.STATUS_GET]: () => ({ quotas: {} }),
      [ACTIONS.CONFIG_GET]: () => ({}),
      [ACTIONS.QUOTA_RESET]: () => {
        quotaResetCalls++;
        return { ok: true };
      },
      [ACTIONS.CAMPAIGN_TICK]: () => {
        campaignTickCalls++;
        return { ok: true };
      },
    });

    await chrome.storage.local.set({
      campaigns: [],
      outfox_bucket_cooldowns: {},
    });

    let cleanupFn = null;
    const testCtx = {
      showToast: (msg, type) => toasts.push({ msg, type }),
      registerCleanup: (fn) => {
        cleanupFn = fn;
      },
    };

    await renderQueueView(container, testCtx);
    await flush();

    // 1. Reset Quotas button
    const resetBtn = container.querySelector('#btn-queue-reset-quota');
    expect(resetBtn).not.toBeNull();
    resetBtn.click();
    expect(resetBtn.disabled).toBe(true);
    await flush();

    expect(quotaResetCalls).toBe(1);
    expect(toasts.some((t) => t.msg === 'Quotas reset')).toBe(true);

    // 2. Update activity button
    const updateBtn = container.querySelector('#btn-update-activity');
    expect(updateBtn).not.toBeNull();
    updateBtn.click();
    expect(updateBtn.disabled).toBe(true);
    await flush();

    expect(campaignTickCalls).toBe(1);
    expect(toasts.some((t) => t.msg === 'Activity synced')).toBe(true);

    // 3. Cleanup registration works
    expect(typeof cleanupFn).toBe('function');
    cleanupFn();
  });
});
