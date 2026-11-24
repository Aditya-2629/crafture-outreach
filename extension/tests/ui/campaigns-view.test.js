/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderCampaignsView,
  computeCampaignStats,
  computeAutoPilotStatus,
  renderMiniStepFlow,
  contractToPipeline,
  pipelineStepsToContract,
  ensureStepVariants,
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

    // Verify manual "Run Step Now" button is removed and replaced by Auto-Pilot status pill
    expect(host.querySelector('#btn-manual-tick')).toBeNull();
    const autoPilotPill = host.querySelector('#autopilot-status-pill');
    expect(autoPilotPill).toBeTruthy();
    expect(autoPilotPill.textContent).toContain('Auto-Pilot');

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

    const card = host.querySelector('.cn-camp-card');
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

  it('toggles has-open-menu on parent card when 3-dots menu is opened and dismissed', async () => {
    setupEngine();
    const host = mountPoint();

    await renderCampaignsView(host, { showToast: () => {} });
    await flush(6);

    const cards = host.querySelectorAll('.cn-camp-card');
    expect(cards.length).toBeGreaterThanOrEqual(2);

    const card0 = cards[0];
    const card1 = cards[1];
    const btn0 = card0.querySelector('.btn-camp-3dots');
    const menu0 = card0.querySelector('.camp-3dots-menu');

    expect(btn0).toBeTruthy();
    expect(menu0).toBeTruthy();
    expect(card0.classList.contains('has-open-menu')).toBe(false);
    expect(menu0.classList.contains('is-open')).toBe(false);

    // Click 3-dots button on Card 0
    btn0.click();
    expect(card0.classList.contains('has-open-menu')).toBe(true);
    expect(menu0.classList.contains('is-open')).toBe(true);

    // Click 3-dots button on Card 1 -> Card 0 should close, Card 1 should open
    const btn1 = card1.querySelector('.btn-camp-3dots');
    const menu1 = card1.querySelector('.camp-3dots-menu');
    btn1.click();

    expect(card0.classList.contains('has-open-menu')).toBe(false);
    expect(menu0.classList.contains('is-open')).toBe(false);
    expect(card1.classList.contains('has-open-menu')).toBe(true);
    expect(menu1.classList.contains('is-open')).toBe(true);

    // Outside click -> closes Card 1
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(card1.classList.contains('has-open-menu')).toBe(false);
    expect(menu1.classList.contains('is-open')).toBe(false);
  });

  it('opens floating step-insert and delay dropdown menus with fixed positioning and dismisses on outside click', async () => {
    setupEngine({
      [ACTIONS.LIST_GET_ALL]: { lists: [{ listId: 'l1', name: 'Leads', count: 12 }] },
    });
    const host = mountPoint();

    await renderCampaignsView(host, { showToast: () => {} });
    await flush(6);

    // Open wizard by clicking Edit on first campaign
    const card = host.querySelector('.cn-camp-card');
    const editItem = card.querySelector('.camp-menu-item[data-action="edit"]');
    editItem.click();
    await flush(6);

    // Select a prospect list in Step 2 so we can advance
    const listSelect = host.querySelector('#wizard-select-list');
    if (listSelect) {
      listSelect.value = 'l1';
      listSelect.dispatchEvent(new Event('change'));
      await flush(6);
    }

    // In Step 2, click Next to navigate to Step 3 (Flow Canvas)
    const nextBtn = host.querySelector('#btn-step2-next');
    expect(nextBtn).toBeTruthy();
    nextBtn.click();
    await flush(6);

    // Check we are in Step 3 visual flow canvas
    const canvasCard = host.querySelector('.flow-canvas-card');
    expect(canvasCard).toBeTruthy();

    const insertBtn = canvasCard.querySelector('.btn-insert-node');
    expect(insertBtn).toBeTruthy();

    // Click + insert button
    insertBtn.click();
    const insertMenu = document.querySelector('.step-insert-menu');
    expect(insertMenu).toBeTruthy();
    expect(insertMenu.style.position).toBe('fixed');
    expect(insertMenu.style.zIndex).toBe('9999');

    // Click outside -> dismisses insert menu
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.step-insert-menu')).toBeNull();

    // Click delay pill
    const delayBtn = canvasCard.querySelector('.delay-select-pill');
    if (delayBtn) {
      delayBtn.click();
      const delayMenu = document.querySelector('.delay-dropdown-menu');
      expect(delayMenu).toBeTruthy();
      expect(delayMenu.style.position).toBe('fixed');
      expect(delayMenu.style.zIndex).toBe('9999');

      // Click outside -> dismisses delay menu
      document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(document.querySelector('.delay-dropdown-menu')).toBeNull();
    }
  });

  describe('computeAutoPilotStatus', () => {
    const t0 = 1757000000000;

    it('returns Auto-Pilot Idle when there are no active campaigns', () => {
      const status = computeAutoPilotStatus([], {}, {}, null, t0);
      expect(status.state).toBe('idle');
      expect(status.text).toBe('Auto-Pilot Idle');
      expect(status.pillClass).toBe('pill-autopilot-idle');

      const pausedOnly = [{ campaignId: 'c_paused', status: 'paused' }];
      const status2 = computeAutoPilotStatus(pausedOnly, {}, {}, null, t0);
      expect(status2.state).toBe('idle');
      expect(status2.text).toBe('Auto-Pilot Idle');
    });

    it('returns Auto-Pilot Resting with resume time when quota cooldown is active', () => {
      const activeCamps = [{ campaignId: 'c1', status: 'active' }];
      const storage = {
        crafture_bucket_cooldowns: {
          invite: t0 + 3600 * 1000, // Resting 1h
        },
      };
      const status = computeAutoPilotStatus(activeCamps, storage, {}, null, t0);
      expect(status.state).toBe('resting');
      expect(status.text).toContain('Auto-Pilot Resting · Resumes at');
      expect(status.pillClass).toBe('pill-autopilot-resting');
    });

    it('returns Auto-Pilot Active · Processing now... when due actions exist', () => {
      const activeCamps = [{ campaignId: 'c1', status: 'active' }];
      const storage = {
        'enrollments:c1': [
          { publicId: 'p_due', status: 'active', nextAt: t0 - 5000 },
        ],
      };
      const status = computeAutoPilotStatus(activeCamps, storage, {}, null, t0);
      expect(status.state).toBe('due');
      expect(status.text).toBe('Auto-Pilot Active · Processing now...');
      expect(status.pillClass).toBe('pill-autopilot-active');
    });

    it('returns Auto-Pilot Active with countdown when actions are scheduled in the future', () => {
      const activeCamps = [{ campaignId: 'c1', status: 'active' }];
      const storage = {
        'enrollments:c1': [
          { publicId: 'p_future', status: 'active', nextAt: t0 + 85 * 1000 }, // 1m 25s
        ],
      };
      const status = computeAutoPilotStatus(activeCamps, storage, {}, null, t0);
      expect(status.state).toBe('upcoming');
      expect(status.text).toBe('Auto-Pilot Active · Next action in 1m 25s');
      expect(status.pillClass).toBe('pill-autopilot-active');
    });

    it('aligns countdown with upcoming alarm if alarm is sooner than enrollment', () => {
      const activeCamps = [{ campaignId: 'c1', status: 'active' }];
      const storage = {
        'enrollments:c1': [
          { publicId: 'p_future', status: 'active', nextAt: t0 + 120 * 1000 }, // 2m
        ],
      };
      const alarm = { scheduledTime: t0 + 45 * 1000 }; // 45s
      const status = computeAutoPilotStatus(activeCamps, storage, {}, alarm, t0);
      expect(status.state).toBe('upcoming');
      expect(status.text).toBe('Auto-Pilot Active · Next action in 45s');
    });
  });

  describe('A/B Testing Contract Conversion & Pipeline State', () => {
    it('preserves abEnabled and variants through contractToPipeline and pipelineStepsToContract', () => {
      const contractSteps = [
        {
          id: 'step_invite',
          type: 'invite',
          note: 'Note A',
          abEnabled: true,
          variants: [
            { id: 'A', note: 'Note A' },
            { id: 'B', note: 'Note B' },
          ],
        },
        {
          type: 'wait',
          waitMs: 86400000,
        },
        {
          id: 'step_msg',
          type: 'message',
          body: 'Msg A',
          abEnabled: true,
          variants: [
            { id: 'A', body: 'Msg A' },
            { id: 'B', body: 'Msg B' },
          ],
        },
      ];

      const pipeline = contractToPipeline(contractSteps);
      expect(pipeline.length).toBe(2);
      expect(pipeline[0].abEnabled).toBe(true);
      expect(pipeline[0].variants).toHaveLength(2);
      expect(pipeline[0].id).toBe('step_invite');

      expect(pipeline[1].abEnabled).toBe(true);
      expect(pipeline[1].variants).toHaveLength(2);
      expect(pipeline[1].delayMs).toBe(86400000);

      const converted = pipelineStepsToContract(pipeline);
      const inviteStep = converted.find((s) => s.type === 'invite');
      expect(inviteStep.abEnabled).toBe(true);
      expect(inviteStep.variants).toHaveLength(2);

      const msgStep = converted.find((s) => s.type === 'message') ||
        converted.find((s) => s.type === 'branch')?.branch?.then?.find((s) => s.type === 'message');
      expect(msgStep).toBeDefined();
      expect(msgStep.abEnabled).toBe(true);
      expect(msgStep.variants).toHaveLength(2);
    });

    it('ensureStepVariants initializes Variant A and Variant B with active state', () => {
      const step = {
        type: 'invite',
        note: 'Initial Note',
      };
      ensureStepVariants(step, 'Fallback Note');
      expect(step.variants).toHaveLength(2);
      expect(step.variants[0].id).toBe('A');
      expect(step.variants[0].note).toBe('Initial Note');
      expect(step.variants[1].id).toBe('B');
      expect(step.variants[1].note).toBe('Initial Note');
      expect(step._activeVariant).toBe('A');
    });
  });
});
