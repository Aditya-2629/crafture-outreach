/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderCampaignsView,
  computeCampaignStats,
  renderMiniStepFlow,
} from '../../src/dashboard/campaigns-view.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint, statusFixture, configFixture } from './helpers.js';

describe('CampaignsView — Smart Lifecycle States & Stats', () => {
  const now = 1757000000000;

  it('formats mini step flow summary into clean pills', () => {
    const steps = [
      { type: 'view' },
      { type: 'wait', waitMs: 86400000 },
      { type: 'invite' },
      { type: 'message' },
    ];
    const html = renderMiniStepFlow(steps);
    expect(html).toContain('Visit');
    expect(html).toContain('Invite');
    expect(html).toContain('Message');
    expect(html).toContain('→');
  });

  it('identifies completed campaigns when all enrollments are finished', () => {
    const camp = {
      campaignId: 'c_done',
      name: 'Finished Founders',
      status: 'active',
      steps: [{ type: 'invite' }, { type: 'message' }],
    };
    const storage = {
      'enrollments:c_done': [
        { publicId: 'lead_1', status: 'completed', accepted: true },
        { publicId: 'lead_2', status: 'replied', accepted: true },
      ],
      actions: [
        { campaignId: 'c_done', action: 'outreach.invite', result: { status: 'sent' } },
        { campaignId: 'c_done', action: 'outreach.invite', result: { status: 'sent' } },
      ],
    };

    const stats = computeCampaignStats(camp, storage, now);
    expect(stats.isCompleted).toBe(true);
    expect(stats.lifecycleKey).toBe('completed');
    expect(stats.badgeHtml).toContain('Completed');
    expect(stats.totalLeads).toBe(2);
    expect(stats.completedOrReplied).toBe(2);
    expect(stats.progressPct).toBe(100);
    expect(stats.invitesSent).toBe(2);
    expect(stats.acceptancePct).toBe(100);
  });

  it('identifies waiting/scheduled campaigns when leads are parked in timer or awaiting acceptance', () => {
    const camp = {
      campaignId: 'c_wait',
      name: 'Nurture Sequence',
      status: 'active',
      steps: [{ type: 'view' }, { type: 'wait', waitMs: 3600000 }, { type: 'invite' }],
    };
    const storage = {
      'enrollments:c_wait': [
        { publicId: 'lead_1', status: 'active', stepIndex: 1, nextAt: now + 45 * 60 * 1000 },
      ],
    };

    const stats = computeCampaignStats(camp, storage, now);
    expect(stats.isCompleted).toBe(false);
    expect(stats.lifecycleKey).toBe('waiting');
    expect(stats.waitingCount).toBe(1);
    expect(stats.dueCount).toBe(0);
    expect(stats.badgeHtml).toContain('Waiting (next in 45m)');
  });

  it('identifies running campaigns when due actions exist', () => {
    const camp = {
      campaignId: 'c_run',
      name: 'Active Outreach',
      status: 'active',
      steps: [{ type: 'invite' }],
    };
    const storage = {
      'enrollments:c_run': [
        { publicId: 'lead_1', status: 'active', stepIndex: 0, nextAt: now - 1000 },
      ],
    };

    const stats = computeCampaignStats(camp, storage, now);
    expect(stats.lifecycleKey).toBe('running');
    expect(stats.dueCount).toBe(1);
    expect(stats.badgeHtml).toContain('Running');
  });
});

describe('CampaignsView — Full Layout & Tab Switching', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  function setupEngine(extra = {}) {
    return stubEngine({
      [ACTIONS.CAMPAIGN_GET_ALL]: {
        campaigns: [
          {
            campaignId: 'camp_1',
            name: 'Active Enterprise Connect',
            status: 'active',
            steps: [{ type: 'view' }, { type: 'invite' }],
          },
          {
            campaignId: 'camp_2',
            name: 'Completed Alpha Campaign',
            status: 'active',
            steps: [{ type: 'invite' }],
          },
          {
            campaignId: 'camp_3',
            name: 'Paused Drip',
            status: 'paused',
            steps: [{ type: 'email' }],
          },
        ],
      },
      [ACTIONS.LIST_GET_ALL]: { lists: [{ listId: 'l1', name: 'Leads' }] },
      [ACTIONS.CONFIG_GET]: configFixture({}),
      [ACTIONS.STATUS_GET]: statusFixture({}),
      [ACTIONS.CAMPAIGN_PAUSE]: {},
      [ACTIONS.CAMPAIGN_RESUME]: {},
      ...extra,
    });
  }

  it('renders top summary overview pills and completed tab', async () => {
    await chrome.storage.local.set({
      'enrollments:camp_1': [
        { publicId: 'p1', status: 'active', stepIndex: 0, nextAt: Date.now() - 1000 },
      ],
      'enrollments:camp_2': [
        { publicId: 'p2', status: 'completed', accepted: true },
      ],
      'enrollments:camp_3': [
        { publicId: 'p3', status: 'active' },
      ],
    });

    setupEngine();
    const host = mountPoint();

    await renderCampaignsView(host, { showToast: () => {} });
    await flush(6);

    // Verify top summary pills exist
    expect(host.querySelector('.camp-overview-pills-row')).toBeTruthy();
    expect(host.textContent).toContain('Active:');
    expect(host.textContent).toContain('Completed:');
    expect(host.textContent).toContain('Total Leads:');

    // Verify Completed tab exists alongside Running, Paused, Draft, Archived
    const completedTab = host.querySelector('.camp-state-tab[data-tab="completed"]');
    expect(completedTab).toBeTruthy();
    expect(completedTab.textContent).toContain('Completed');

    // Active Enterprise Connect should be in running
    expect(host.textContent).toContain('Active Enterprise Connect');

    // Switch to Completed tab
    completedTab.click();
    await flush(6);

    expect(host.textContent).toContain('Completed Alpha Campaign');
    expect(host.textContent).not.toContain('Active Enterprise Connect');
  });

  it('renders 3 clean non-overlapping columns in campaign cards', async () => {
    await chrome.storage.local.set({
      'enrollments:camp_1': [
        { publicId: 'p1', status: 'active', stepIndex: 0 },
      ],
    });

    setupEngine();
    const host = mountPoint();

    await renderCampaignsView(host, { showToast: () => {} });
    await flush(6);

    const card = host.querySelector('.OutFox-camp-card');
    expect(card).toBeTruthy();

    // Check Left, Middle, Right columns
    expect(card.querySelector('.camp-row-left')).toBeTruthy();
    expect(card.querySelector('.camp-row-middle')).toBeTruthy();
    expect(card.querySelector('.camp-row-right')).toBeTruthy();

    // Middle column has progress bar and 4 KPIs
    expect(card.querySelector('.camp-progress-track')).toBeTruthy();
    expect(card.querySelector('.camp-mini-kpis')).toBeTruthy();
    expect(card.textContent).toContain('Sent');
    expect(card.textContent).toContain('Accepted');
    expect(card.textContent).toContain('Replied');
    expect(card.textContent).toContain('Waiting');

    // Right column has Live Status button and 1-click pause toggle
    expect(card.querySelector('.btn-trigger-live-drawer')).toBeTruthy();
    expect(card.querySelector('.btn-camp-pause-toggle')).toBeTruthy();
    expect(card.querySelector('.btn-camp-3dots')).toBeTruthy();
  });
});
