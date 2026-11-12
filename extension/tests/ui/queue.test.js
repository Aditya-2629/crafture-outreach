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
});
