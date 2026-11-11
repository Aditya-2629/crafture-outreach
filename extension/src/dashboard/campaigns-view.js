/**
 * OutFox — Authentic Waalaxy Campaigns View & 3-Step Wizard
 * Video Frames 11–17: Template Gallery, 3-Step Creator Wizard, Horizontal Flow Canvas, and Message Editor.
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { allProfiles } from '../lib/storage.js';
import { openUiConfirm, openUiAlert, openUiSelectModal } from './modal-engine.js';
import { ICONS } from '../ui/icons.js';

// Pre-built Waalaxy Campaign Templates (From Video Frame 11)
export const CAMPAIGN_TEMPLATES = [
  {
    id: 'custom',
    title: 'Custom Sequence (Build from Scratch)',
    category: 'Custom',
    tags: ['Custom', 'Builder'],
    flowText: '[Prospects List] → [Add Step (+)]',
    bestFor: 'Construct any customized multi-touch outreach flow with flexible steps.',
    icon: ICONS.settings,
    steps: [],
  },
  {
    id: 'standard',
    title: 'Standard Invitation',
    category: 'Invitation',
    tags: ['Invitation', 'Visit'],
    flowText: '[Profile Visit] → [Connection Request]',
    bestFor: 'Quick safe networking and audience expansion.',
    icon: ICONS.invitation,
    steps: [
      { type: 'view' },
      { type: 'wait', waitMs: 86400000, delayLabel: 'Wait 1 day' },
      { type: 'invite', note: 'Hi {{firstName|there}} — I came across your work at {{company|your company}} and would love to connect.' },
      { type: 'crm_sync' },
    ],
  },
  {
    id: 'followup',
    title: 'Invitation + Follow-up Message',
    category: 'Message',
    tags: ['Invitation', 'Message', 'Visit'],
    flowText: '[Visit] → [Invite with Note] → [Wait 2 Days] → [Message if Accepted]',
    bestFor: 'B2B outreach, pipeline prospecting & qualified meetings.',
    icon: ICONS.message,
    steps: [
      { type: 'view' },
      { type: 'wait', waitMs: 86400000, delayLabel: 'Wait 1 day' },
      { type: 'invite', note: 'Hi {{firstName|there}}, love the work you are doing at {{company|your team}}. Would be great to connect!' },
      {
        type: 'branch',
        branch: {
          on: 'accepted',
          ms: 172800000,
          then: [
            { type: 'wait', waitMs: 172800000, delayLabel: 'Wait 2 days' },
            { type: 'message', body: 'Thanks for connecting, {{firstName|there}}! What is taking up most of your focus this quarter?' },
            { type: 'crm_sync' },
          ],
          else: [],
        },
      },
    ],
  },
  {
    id: 'multichannel',
    title: 'Multi-Channel Drip (LinkedIn + Gmail)',
    category: 'Email',
    tags: ['Invitation', 'Email', 'CRM Sync'],
    flowText: '[LinkedIn Invite] → [Wait 2 Days] → [If Not Accepted → Cold Email via Gmail]',
    bestFor: 'Maximum response rate across professional channels.',
    icon: ICONS.email,
    steps: [
      { type: 'view' },
      { type: 'wait', waitMs: 86400000, delayLabel: 'Wait 1 day' },
      { type: 'invite', note: 'Hi {{firstName|there}} — connecting here after seeing your work at {{company|your team}}.' },
      {
        type: 'branch',
        branch: {
          on: 'accepted',
          ms: 172800000,
          then: [
            { type: 'message', body: 'Great to connect with you, {{firstName|there}}!' },
            { type: 'crm_sync' },
          ],
          else: [
            { type: 'wait', waitMs: 172800000, delayLabel: 'Wait 2 days' },
            {
              type: 'email',
              subject: 'Quick question for {{firstName|there}} regarding {{company|your team}}',
              body: 'Hi {{firstName|there}},\n\nI sent you a quick connection request on LinkedIn earlier. Wanted to follow up directly to see if you had 5 minutes this week to chat?\n\nBest,\nAditya',
            },
            { type: 'crm_sync' },
          ],
        },
      },
    ],
  },
  {
    id: 'founder',
    title: 'Founder to Founder (Auto-Endorse)',
    category: 'CRM Sync',
    tags: ['Invitation', 'CRM Sync', 'Visit', 'Endorse'],
    flowText: '[Profile Visit] → [Auto-Endorse Skill] → [AI Hook Invite] → [CRM Sync]',
    bestFor: 'High-converting conversational introductions with skill endorsement warmup.',
    icon: ICONS.rocket,
    steps: [
      { type: 'view' },
      { type: 'endorse' },
      { type: 'wait', waitMs: 43200000, delayLabel: 'Wait 12 hours' },
      { type: 'invite', note: 'Hi {{firstName|there}} — {{ai_opener}} Would love to connect founder to founder.', useAi: true },
      { type: 'crm_sync' },
    ],
  },
];

// Available delay presets for interactive connectors
export const DELAY_OPTIONS = [
  { ms: 0, label: 'Immediate (No wait)', badge: 'Immediate' },
  { ms: 900000, label: '15 minutes', badge: '15 min' },
  { ms: 3600000, label: '1 hour', badge: '1 hour' },
  { ms: 86400000, label: '1 day (24h)', badge: '1 day' },
  { ms: 172800000, label: '2 days', badge: '2 days' },
];

// Available step templates for [+] step insertion
export const INSERT_STEP_OPTIONS = [
  { type: 'view', title: 'View Profile', sub: 'Warm Touch', icon: ICONS.visit, delayMs: 0 },
  { type: 'invite', title: 'Send Invite', sub: 'Connection Request', icon: ICONS.invitation, delayMs: 86400000, note: 'Hi {{firstName|there}} — would love to connect!' },
  { type: 'endorse', title: 'Endorse Skill', sub: 'Auto-Warmup', icon: ICONS.sparkles, delayMs: 0 },
  { type: 'message', title: 'LinkedIn Message', sub: 'Direct Message', icon: ICONS.message, delayMs: 172800000, body: 'Thanks for connecting, {{firstName|there}}! What is taking up most of your focus this quarter?' },
  { type: 'email', title: 'Cold Email', sub: 'Direct Email', icon: ICONS.email, delayMs: 172800000, subject: 'Quick question for {{firstName|there}}', body: 'Hi {{firstName|there}},\n\nWanted to follow up directly to see if you had 5 minutes this week to chat?\n\nBest,\nAditya' },
  { type: 'wait', title: 'Delay Timer', sub: 'Wait Period', icon: ICONS.clock, delayMs: 86400000 },
];

export function formatDelayBadge(ms) {
  if (!ms || ms <= 0) return 'Immediate';
  if (ms < 3600000) return `${Math.round(ms / 60000)} min`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)} hr`;
  const days = Math.round(ms / 86400000);
  return `${days} day${days > 1 ? 's' : ''}`;
}

export function templateToPipeline(tpl) {
  if (!tpl || tpl.id === 'custom') return [];
  if (tpl.id === 'standard') {
    return [
      { id: 'p_1', type: 'view', title: 'View Profile', sub: 'Warm Touch', icon: ICONS.visit, delayMs: 0 },
      { id: 'p_2', type: 'invite', title: 'Invitation', sub: 'Custom Note', icon: ICONS.invitation, delayMs: 86400000, note: tpl.steps?.find((s) => s.type === 'invite')?.note || 'Hi {{firstName|there}} — would love to connect!' },
    ];
  }
  if (tpl.id === 'followup') {
    return [
      { id: 'p_1', type: 'view', title: 'View Profile', sub: 'Warm Touch', icon: ICONS.visit, delayMs: 0 },
      { id: 'p_2', type: 'invite', title: 'Invitation', sub: 'Custom Note', icon: ICONS.invitation, delayMs: 86400000, note: 'Hi {{firstName|there}}, love the work you are doing at {{company|your team}}. Would be great to connect!' },
      { id: 'p_3', type: 'message', title: 'LinkedIn Message', sub: 'If Accepted', icon: ICONS.message, delayMs: 172800000, body: 'Thanks for connecting, {{firstName|there}}! What is taking up most of your focus this quarter?' },
    ];
  }
  if (tpl.id === 'multichannel') {
    return [
      { id: 'p_1', type: 'view', title: 'View Profile', sub: 'Warm Touch', icon: ICONS.visit, delayMs: 0 },
      { id: 'p_2', type: 'invite', title: 'Invitation', sub: 'Custom Note', icon: ICONS.invitation, delayMs: 86400000, note: 'Hi {{firstName|there}} — connecting here after seeing your work at {{company|your team}}.' },
      { id: 'p_3', type: 'message', title: 'LinkedIn Message', sub: 'If Accepted', icon: ICONS.message, delayMs: 172800000, body: 'Great to connect with you, {{firstName|there}}!' },
      { id: 'p_4', type: 'email', title: 'Cold Email', sub: 'If Not Accepted', icon: ICONS.email, delayMs: 172800000, subject: 'Quick question for {{firstName|there}} regarding {{company|your team}}', body: 'Hi {{firstName|there}},\n\nI sent you a quick connection request on LinkedIn earlier. Wanted to follow up directly to see if you had 5 minutes this week to chat?\n\nBest,\nAditya' },
    ];
  }
  if (tpl.id === 'founder') {
    return [
      { id: 'p_1', type: 'view', title: 'View Profile', sub: 'Warm Touch', icon: ICONS.visit, delayMs: 0 },
      { id: 'p_2', type: 'endorse', title: 'Endorse Skill', sub: 'Auto-Warmup', icon: ICONS.sparkles, delayMs: 0 },
      { id: 'p_3', type: 'invite', title: 'Invitation', sub: 'AI Hook Note', icon: ICONS.invitation, delayMs: 43200000, note: 'Hi {{firstName|there}} — {{ai_opener}} Would love to connect founder to founder.', useAi: true },
    ];
  }
  return [];
}

export function contractToPipeline(steps = []) {
  const result = [];
  let pendingDelay = 0;

  function processStepList(list) {
    for (const s of list) {
      if (s.type === 'wait') {
        pendingDelay = s.waitMs || 86400000;
        continue;
      }
      if (s.type === 'crm_sync') continue;
      if (s.type === 'branch') {
        if (s.branch?.then) processStepList(s.branch.then);
        if (s.branch?.else) processStepList(s.branch.else);
        continue;
      }
      const opt = INSERT_STEP_OPTIONS.find((o) => o.type === s.type) || {
        type: s.type,
        title: s.type,
        sub: 'Action',
        icon: ICONS.lightning,
      };
      result.push({
        ...opt,
        id: 's_' + Math.random().toString(36).substr(2, 6),
        delayMs: pendingDelay,
        note: s.note,
        body: s.body,
        subject: s.subject,
        useAi: s.useAi,
      });
      pendingDelay = 0;
    }
  }

  processStepList(steps);
  return result;
}

export function pipelineStepsToContract(pipelineSteps = [], customNote = '', useAi = true) {
  const steps = [];
  if (!pipelineSteps || pipelineSteps.length === 0) {
    return [{ type: 'crm_sync' }];
  }

  const inviteIndex = pipelineSteps.findIndex((s) => s.type === 'invite');

  if (inviteIndex === -1) {
    // Linear pipeline (warmup only or direct actions)
    for (const step of pipelineSteps) {
      if (step.delayMs && step.delayMs > 0) {
        steps.push({ type: 'wait', waitMs: step.delayMs, delayLabel: formatDelayBadge(step.delayMs) });
      }
      if (step.type === 'view') steps.push({ type: 'view' });
      else if (step.type === 'endorse') steps.push({ type: 'endorse' });
      else if (step.type === 'message') steps.push({ type: 'message', body: step.body || 'Hi {{firstName|there}}!' });
      else if (step.type === 'email') steps.push({ type: 'email', subject: step.subject || 'Quick question', body: step.body || 'Hi {{firstName|there}}...' });
      else if (step.type === 'wait') steps.push({ type: 'wait', waitMs: step.delayMs || 86400000 });
    }
    steps.push({ type: 'crm_sync' });
    return steps;
  }

  // Pre-invite steps + invite
  const preSteps = pipelineSteps.slice(0, inviteIndex + 1);
  const postSteps = pipelineSteps.slice(inviteIndex + 1);

  for (const step of preSteps) {
    if (step.delayMs && step.delayMs > 0) {
      steps.push({ type: 'wait', waitMs: step.delayMs, delayLabel: formatDelayBadge(step.delayMs) });
    }
    if (step.type === 'view') {
      steps.push({ type: 'view' });
    } else if (step.type === 'endorse') {
      steps.push({ type: 'endorse' });
    } else if (step.type === 'invite') {
      let finalNote = customNote || step.note || 'Hi {{firstName|there}} — would love to connect!';
      if (useAi) {
        if (!finalNote.includes('{{ai_opener}}')) {
          finalNote = `${finalNote} {{ai_opener}}`.trim();
        }
      }
      steps.push({
        type: 'invite',
        note: finalNote,
        useAi: Boolean(useAi),
      });
    } else if (step.type === 'wait') {
      steps.push({ type: 'wait', waitMs: step.delayMs || 86400000 });
    }
  }

  // If no post-invite steps, just finish with crm_sync
  if (postSteps.length === 0) {
    steps.push({ type: 'crm_sync' });
    return steps;
  }

  // Branch on accepted for post-invite steps
  const messageStep = postSteps.find((s) => s.type === 'message');
  const emailStep = postSteps.find((s) => s.type === 'email');
  const otherPostSteps = postSteps.filter((s) => s.type !== 'message' && s.type !== 'email');

  const thenBranch = [];
  const elseBranch = [];

  if (messageStep) {
    if (messageStep.delayMs && messageStep.delayMs > 0) {
      thenBranch.push({ type: 'wait', waitMs: messageStep.delayMs, delayLabel: formatDelayBadge(messageStep.delayMs) });
    }
    thenBranch.push({
      type: 'message',
      body: messageStep.body || 'Thanks for connecting, {{firstName|there}}! What is taking up most of your focus this quarter?',
    });
    thenBranch.push({ type: 'crm_sync' });
  }

  if (emailStep) {
    if (emailStep.delayMs && emailStep.delayMs > 0) {
      elseBranch.push({ type: 'wait', waitMs: emailStep.delayMs, delayLabel: formatDelayBadge(emailStep.delayMs) });
    }
    elseBranch.push({
      type: 'email',
      subject: emailStep.subject || 'Quick question for {{firstName|there}} regarding {{company|your team}}',
      body: emailStep.body || 'Hi {{firstName|there}},\n\nI sent you a quick connection request on LinkedIn earlier. Wanted to follow up directly to see if you had 5 minutes this week to chat?\n\nBest,\nAditya',
    });
    elseBranch.push({ type: 'crm_sync' });
  }

  for (const s of otherPostSteps) {
    if (s.delayMs && s.delayMs > 0) {
      thenBranch.push({ type: 'wait', waitMs: s.delayMs, delayLabel: formatDelayBadge(s.delayMs) });
    }
    if (s.type === 'view') thenBranch.push({ type: 'view' });
    else if (s.type === 'endorse') thenBranch.push({ type: 'endorse' });
  }

  if (thenBranch.length === 0 && elseBranch.length === 0) {
    steps.push({ type: 'crm_sync' });
  } else {
    steps.push({
      type: 'branch',
      branch: {
        on: 'accepted',
        ms: 172800000,
        then: thenBranch.length > 0 ? thenBranch : [{ type: 'crm_sync' }],
        else: elseBranch,
      },
    });
  }

  return steps;
}

export function renderHorizontalFlow(pipelineSteps = [], prospectCount = 12, isInteractive = true) {
  let html = `
    <div class="horizontal-node-canvas">
      <!-- Prospects Source Node -->
      <div class="flow-node-item">
        <div class="flow-node-card">
          <div class="node-icon-circle">${ICONS.user}</div>
          <div class="node-text-group">
            <span class="node-title">Prospects</span>
            <span class="node-subtitle">${prospectCount} Enrolled</span>
          </div>
        </div>
      </div>
  `;

  // Render each pipeline step with connector before it
  pipelineSteps.forEach((step, idx) => {
    html += `
      <div class="node-connector">
        <div class="delay-pill-badge" data-connector-idx="${idx}" title="${isInteractive ? 'Click to change delay' : ''}">
          ${formatDelayBadge(step.delayMs)}${isInteractive ? ' ▾' : ''}
        </div>
        <div class="connector-arrow-line" style="position: relative; width: 100%; display: flex; align-items: center; justify-content: center;">
          →
          ${isInteractive ? `<button type="button" class="btn-insert-node" data-insert-idx="${idx}" title="Insert Step">+</button>` : ''}
        </div>
      </div>
      <div class="flow-node-item">
        <div class="flow-node-card">
          ${isInteractive ? `<button type="button" class="btn-delete-node" data-delete-idx="${idx}" title="Remove Step">✕</button>` : ''}
          <div class="node-icon-circle">${step.icon || ICONS.lightning}</div>
          <div class="node-text-group">
            <span class="node-title">${step.title || step.type}</span>
            <span class="node-subtitle">${step.sub || ''}</span>
          </div>
        </div>
      </div>
    `;
  });

  // Final connector and CRM Sync node
  html += `
      <div class="node-connector">
        <div class="delay-pill-badge" data-connector-idx="${pipelineSteps.length}" title="${isInteractive ? 'Click to change delay' : ''}">
          Immediate${isInteractive ? ' ▾' : ''}
        </div>
        <div class="connector-arrow-line" style="position: relative; width: 100%; display: flex; align-items: center; justify-content: center;">
          →
          ${isInteractive ? `<button type="button" class="btn-insert-node" data-insert-idx="${pipelineSteps.length}" title="Insert Step">+</button>` : ''}
        </div>
      </div>
      <div class="flow-node-item">
        <div class="flow-node-card">
          <div class="node-icon-circle">${ICONS.sheets}</div>
          <div class="node-text-group">
            <span class="node-title">Sheets CRM</span>
            <span class="node-subtitle">Live 2-Way Sync</span>
          </div>
        </div>
      </div>
    </div>
  `;

  return html;
}


function ensureCampaignsStyles() {
  const STYLE_ID = 'waalaxy-campaigns-view-css';
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .campaigns-view-shell { max-width: 1200px; margin: 0 auto; }
    .campaigns-top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .camp-tabs-and-search-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; gap: 16px; }
    .camp-state-tabs-bar { display: flex; gap: 8px; background: #f1f5f9; padding: 4px; border-radius: 12px; }
    .camp-state-tab { background: transparent; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.15s; }
    .camp-state-tab.is-active { background: #ffffff; color: #14142b; font-weight: 700; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
    .tab-count-badge { background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 9999px; }
    .camp-search-wrap { position: relative; display: flex; align-items: center; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0 12px; width: 220px; }
    .camp-search-wrap input { border: none; outline: none; font-size: 13px; padding: 8px 6px; width: 100%; background: transparent; }
    .waalaxy-camp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; }
    .waalaxy-camp-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 20px; position: relative; box-shadow: 0 2px 6px rgba(0,0,0,0.02); transition: all 0.2s ease; cursor: pointer; display: flex; align-items: center; gap: 14px; }
    .waalaxy-camp-card:hover { border-color: #c7d2fe; box-shadow: 0 6px 18px rgba(255, 107, 0, 0.08); transform: translateY(-1px); }
    .planet-avatar { width: 44px; height: 44px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; position: relative; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #ff6b00; }
    .planet-ring { display: none; }
    .camp-card-meta { flex: 1; }
    .camp-card-name { font-size: 14.5px; font-weight: 700; color: #14142b; display: block; margin-bottom: 6px; }
    .camp-card-badges-row { display: flex; align-items: center; gap: 8px; }
    .camp-leads-pill { font-size: 11px; font-weight: 700; background: #f1f5f9; color: #475569; padding: 2px 8px; border-radius: 9999px; }
    .camp-status-dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot-running { background: #10b981; }
    .dot-paused { background: #f59e0b; }
    .dot-draft { background: #94a3b8; }
    .btn-camp-3dots { background: transparent; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 6px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
    .btn-camp-3dots:hover { background: #f1f5f9; color: #14142b; }
    .camp-3dots-menu { position: absolute; top: 48px; right: 16px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 6px; display: none; flex-direction: column; z-index: 50; min-width: 170px; }
    .camp-3dots-menu.is-open { display: flex; }
    .camp-menu-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600; color: #14142b; cursor: pointer; transition: background 0.12s; }
    .camp-menu-item:hover { background: #f8fafc; color: #ff6b00; }
    .menu-item-delete:hover { background: #fef2f2; color: #ef4444; }
    .sequence-preflight-warning { display: flex; align-items: flex-start; gap: 12px; background: #fffbeb; border: 1px solid #fef3c7; color: #92400e; border-radius: 10px; padding: 12px 16px; margin: 14px 0; }
    .sequence-preflight-warning .warning-icon { display: flex; align-items: center; justify-content: center; color: #d97706; flex-shrink: 0; margin-top: 2px; }
    .sequence-preflight-warning .warning-text strong { display: block; font-size: 13.5px; font-weight: 700; color: #92400e; margin-bottom: 3px; }
    .sequence-preflight-warning .warning-text p { margin: 0; font-size: 12.5px; color: #b45309; line-height: 1.4; }
    .flow-canvas-card {
      overflow: visible !important;
      padding: 22px 26px 40px 26px !important;
      position: relative;
    }
    .horizontal-node-canvas {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      overflow-y: visible !important;
      padding: 12px 6px 30px 6px;
      position: relative;
    }
    .node-connector {
      position: relative;
      z-index: 50;
    }
    .delay-pill-badge {
      position: relative;
      z-index: 60;
      cursor: pointer;
    }
    .pipeline-popover-menu {
      position: absolute !important;
      top: calc(100% + 8px) !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 10px !important;
      box-shadow: 0 14px 34px rgba(15, 23, 42, 0.16) !important;
      z-index: 999999 !important;
      min-width: 200px !important;
      max-height: 260px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
  `;
  document.head.appendChild(style);
}

export async function renderCampaignsView(container, ctx = {}) {
  ensureCampaignsStyles();
  if (!container) return;

  container.innerHTML = `
    <div class="view-loading-state">
      <div class="spinner"></div>
      <span>Loading campaigns...</span>
    </div>
  `;

  let campaigns = [];
  let lists = [];
  let profiles = [];

  try {
    const [cRes, lRes, pRes] = await Promise.all([
      call(ACTIONS.CAMPAIGN_GET_ALL, {}).catch(() => []),
      call(ACTIONS.LIST_GET_ALL, {}).catch(() => []),
      allProfiles().catch(() => []),
    ]);
    campaigns = Array.isArray(cRes) ? cRes : (cRes?.campaigns || []);
    const rawLists = Array.isArray(lRes) ? lRes : (lRes?.lists || []);
    lists = rawLists.map((l) => ({
      ...l,
      id: l.listId || l.id,
      listId: l.listId || l.id,
    }));
    profiles = Array.isArray(pRes) ? pRes : [];
  } catch (e) {
    console.warn('[Campaigns View] Read error', e);
  }

  function getSelectedListProspectCount() {
    if (!selectedListId) return 0;
    if (selectedListId === 'all_prospects') return profiles.length;
    const activeL = lists.find((l) => (l.id || l.listId) === selectedListId);
    return activeL ? (activeL.count || 0) : 0;
  }

  // View state: 'list' or 'wizard'
  let viewState = ctx.openWizard ? 'wizard' : 'list';
  let wizardStep = 1;
  let activeFilter = 'All';
  let selectedTemplate = CAMPAIGN_TEMPLATES[0]; // Custom by default or Standard
  let pipelineSteps = templateToPipeline(selectedTemplate);

  // Pick default list: first with leads, or 'all_prospects' if it has leads, or first list/empty
  let selectedListId = '';
  if (lists.length > 0 && lists.some((l) => (l.count || 0) > 0)) {
    selectedListId = (lists.find((l) => (l.count || 0) > 0) || lists[0]).id;
  } else if (profiles.length > 0) {
    selectedListId = 'all_prospects';
  } else if (lists.length > 0) {
    selectedListId = lists[0].id;
  }

  let campaignName = `${selectedTemplate.title} #${campaigns.length + 1}`;
  let customNote = selectedTemplate.steps?.find((s) => s.type === 'invite')?.note || 'Hi {{firstName|there}} — would love to connect!';
  let useAiHook = true;

  let activeStateTab = 'running'; // 'running' | 'paused' | 'draft' | 'archived'
  let campSearchQuery = '';
  let currentWizardStep = 1;
  let wizardTemplate = null;

  function render() {
    if (viewState === 'wizard') {
      renderWizard();
    } else {
      renderList();
    }
  }

  // =========================================================================
  // STATE A: Campaigns List & Management (Frames 14 & 15 / Screenshot 3)
  // =========================================================================
  function renderList() {
    const running = campaigns.filter((c) => c.status === 'active' || c.status === 'running' || !c.status);
    const paused = campaigns.filter((c) => c.status === 'paused');
    const draft = campaigns.filter((c) => c.status === 'draft');
    const archived = campaigns.filter((c) => c.status === 'archived');

    let currentList = running;
    if (activeStateTab === 'paused') currentList = paused;
    else if (activeStateTab === 'draft') currentList = draft;
    else if (activeStateTab === 'archived') currentList = archived;

    if (campSearchQuery.trim()) {
      const q = campSearchQuery.toLowerCase();
      currentList = currentList.filter((c) => c.name && c.name.toLowerCase().includes(q));
    }

    container.innerHTML = `
      <div class="campaigns-view-shell">
        <div class="campaigns-top-bar">
          <div>
            <h1 class="main-page-title">My campaigns</h1>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <button type="button" class="btn-pill btn-secondary btn-sm" id="btn-manual-tick" style="font-size: 12px; padding: 7px 14px;">
              ${ICONS.lightning} Run Step Now
            </button>
            <button type="button" class="btn-primary-start-camp" id="btn-start-wizard">
              Start a campaign ⌵
            </button>
          </div>
        </div>

        <!-- Sub-Tabs & Search Bar (Screenshot 3) -->
        <div class="camp-tabs-and-search-row">
          <div class="camp-state-tabs-bar">
            <button type="button" class="camp-state-tab ${activeStateTab === 'running' ? 'is-active' : ''}" data-tab="running">
              <span>${ICONS.play} Running</span> <span class="tab-count-badge">${running.length}</span>
            </button>
            <button type="button" class="camp-state-tab ${activeStateTab === 'paused' ? 'is-active' : ''}" data-tab="paused">
              <span>${ICONS.pause} Paused</span> <span class="tab-count-badge">${paused.length}</span>
            </button>
            <button type="button" class="camp-state-tab ${activeStateTab === 'draft' ? 'is-active' : ''}" data-tab="draft">
              <span>${ICONS.edit} Draft</span> <span class="tab-count-badge">${draft.length}</span>
            </button>
            <button type="button" class="camp-state-tab ${activeStateTab === 'archived' ? 'is-active' : ''}" data-tab="archived">
              <span>${ICONS.archive} Archived</span> <span class="tab-count-badge">${archived.length}</span>
            </button>
          </div>

          <div class="camp-search-wrap">
            <span style="color:#94a3b8; display:flex;">${ICONS.search}</span>
            <input type="text" id="input-camp-search" placeholder="Search" value="${campSearchQuery}" />
          </div>
        </div>

        <!-- Cards Grid (Screenshot 3) -->
        <div class="waalaxy-camp-grid">
          ${
            currentList.length === 0
              ? `
            <div class="empty-camp-pane">
              <div class="planet-avatar" style="opacity:0.6; margin-bottom:12px;">
                <div class="planet-ring"></div>
              </div>
              <h3>No ${activeStateTab} campaigns</h3>
              <p>Create an automated sequence to reach out to leads at scale.</p>
              <button type="button" class="btn-pill btn-primary btn-sm" id="btn-empty-start-camp">
                Start a campaign
              </button>
            </div>
          `
              : currentList
                  .map((camp) => {
                    const id = camp.campaignId || camp.id;
                    const leads = camp.stats?.enrolled ?? camp.leadsCount ?? camp.contacts?.length ?? (camp.stats?.total) ?? 0;
                    const isPaused = camp.status === 'paused';
                    const isDraft = camp.status === 'draft';
                    const statusClass = isPaused ? 'dot-paused' : isDraft ? 'dot-draft' : 'dot-running';

                    return `
              <div class="waalaxy-camp-card" data-camp-id="${id}">
                <div class="planet-avatar">
                  <div class="planet-ring"></div>
                </div>

                <div class="camp-card-meta">
                  <span class="camp-card-name">${camp.name}</span>
                  <div class="camp-card-badges-row">
                    <span class="camp-leads-pill">${leads} leads</span>
                    <span class="camp-status-dot ${statusClass}" title="Status: ${camp.status || 'running'}"></span>
                  </div>
                </div>

                <button type="button" class="btn-camp-3dots" data-dots-id="${id}" title="Campaign actions">
                  ${ICONS.moreHorizontal}
                </button>

                <!-- 3-Dots Dropdown Menu (Screenshot 3) -->
                <div class="camp-3dots-menu" id="camp-menu-${id}">
                  <div class="camp-menu-item" data-action="edit" data-id="${id}">
                    <span>${ICONS.edit}</span> Edit my campaign
                  </div>
                  <div class="camp-menu-item" data-action="add_prospects" data-id="${id}">
                    <span>${ICONS.plus}</span> Add prospects
                  </div>
                  <div class="camp-menu-item" data-action="duplicate" data-id="${id}">
                    <span>${ICONS.duplicate}</span> Duplicate
                  </div>
                  <div class="camp-menu-item" data-action="toggle_pause" data-id="${id}" data-status="${camp.status || 'active'}">
                    <span>${isPaused ? ICONS.play : ICONS.pause}</span> ${isPaused ? 'Resume my campaign' : 'Pause my campaign'}
                  </div>
                  <div class="camp-menu-item" data-action="archive" data-id="${id}">
                    <span>${ICONS.archive}</span> Archive
                  </div>
                  <div class="camp-menu-item menu-item-delete" data-action="delete" data-id="${id}">
                    <span>${ICONS.trash}</span> Delete
                  </div>
                </div>
              </div>
            `;
                  })
                  .join('')
          }
        </div>
      </div>

      <!-- Flow Modal Placeholder -->
      <div class="modal-backdrop hidden" id="flow-modal">
        <div class="modal-dialog" style="max-width: 820px;">
          <div class="modal-head">
            <h3 class="pane-title" id="flow-modal-title">Sequence Flow</h3>
            <button type="button" class="btn-close-modal" id="btn-close-flow-modal">✕</button>
          </div>
          <div class="modal-body" id="flow-modal-body"></div>
        </div>
      </div>
    `;

    wireListEvents();
  }

  function wireListEvents() {
    container.querySelector('#btn-start-wizard')?.addEventListener('click', () => {
      viewState = 'wizard';
      wizardStep = 1;
      currentWizardStep = 1;
      wizardTemplate = null;
      render();
    });

    container.querySelector('#btn-empty-start-camp')?.addEventListener('click', () => {
      viewState = 'wizard';
      wizardStep = 1;
      currentWizardStep = 1;
      wizardTemplate = null;
      render();
    });

    container.querySelectorAll('.camp-state-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeStateTab = tab.dataset.tab;
        renderList();
      });
    });

    const searchInp = container.querySelector('#input-camp-search');
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        campSearchQuery = e.target.value;
        renderList();
        const updated = container.querySelector('#input-camp-search');
        if (updated) {
          updated.focus();
          updated.setSelectionRange(updated.value.length, updated.value.length);
        }
      });
    }

    container.querySelectorAll('.btn-camp-3dots').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.dotsId;
        const menu = container.querySelector(`#camp-menu-${id}`);
        container.querySelectorAll('.camp-3dots-menu').forEach((m) => {
          if (m !== menu) m.classList.remove('is-open');
        });
        if (menu) menu.classList.toggle('is-open');
      });
    });

    document.addEventListener('click', () => {
      container.querySelectorAll('.camp-3dots-menu').forEach((m) => m.classList.remove('is-open'));
    });

    container.querySelectorAll('.camp-menu-item').forEach((item) => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        const id = item.dataset.id;
        const camp = campaigns.find((c) => (c.campaignId || c.id) === id);
        if (!camp) return;

        if (action === 'edit') {
          wizardTemplate = {
            id: camp.campaignId,
            title: camp.name,
            steps: camp.steps || [],
          };
          campaignName = camp.name;
          if (camp.steps?.length) {
            pipelineSteps = contractToPipeline(camp.steps);
          }
          viewState = 'wizard';
          wizardStep = 2;
          currentWizardStep = 2;
          render();
        } else if (action === 'add_prospects') {
          const listOptions = lists.map((l) => ({ id: l.listId || l.id, name: l.name, count: l.count || 0 }));
          const selectedList = await openUiSelectModal({
            title: 'Add prospects to campaign',
            label: `Select a list to enroll into "${camp.name}":`,
            options: listOptions,
            confirmText: 'Enroll Prospects',
          });

          if (selectedList) {
            const storage = await new Promise((r) => chrome.storage.local.get(null, r));
            const members = storage[`listMembers:${selectedList}`] || [];
            let ids = members.map((m) => m.publicId || m.id).filter(Boolean);
            if (ids.length === 0) {
              const matching = profiles.filter((p) => p.listId === selectedList);
              ids = matching.map((p) => p.publicId || p.id).filter(Boolean);
            }
            if (ids.length === 0) {
              openUiAlert({ title: 'List Empty', message: 'The selected list has no prospects.' });
              return;
            }
            await call(ACTIONS.CAMPAIGN_ENROLL, { campaignId: id, publicIds: ids });
            ctx.showToast?.(`Enrolled ${ids.length} prospects into "${camp.name}"!`, 'success');
            renderCampaignsView(container, ctx);
          }
        } else if (action === 'duplicate') {
          const cloned = {
            ...camp,
            name: `Copy of ${camp.name}`,
            campaignId: `camp_${Date.now()}`,
            createdAt: Date.now(),
            status: 'draft',
          };
          delete cloned.stats;
          await call(ACTIONS.CAMPAIGN_CREATE, cloned);
          ctx.showToast?.(`Campaign "${camp.name}" duplicated!`, 'success');
          renderCampaignsView(container, ctx);
        } else if (action === 'toggle_pause') {
          const isPaused = camp.status === 'paused';
          if (isPaused) {
            await call(ACTIONS.CAMPAIGN_RESUME, { campaignId: id });
            ctx.showToast?.(`Campaign "${camp.name}" resumed.`, 'success');
          } else {
            await call(ACTIONS.CAMPAIGN_PAUSE, { campaignId: id });
            ctx.showToast?.(`Campaign "${camp.name}" paused.`, 'info');
          }
          renderCampaignsView(container, ctx);
        } else if (action === 'archive') {
          const storage = await new Promise((r) => chrome.storage.local.get(['campaigns'], r));
          const allCamps = storage.campaigns || [];
          const found = allCamps.find((c) => (c.campaignId || c.id) === id);
          if (found) {
            found.status = 'archived';
            await chrome.storage.local.set({ campaigns: allCamps });
            ctx.showToast?.(`Campaign "${camp.name}" archived.`, 'info');
            renderCampaignsView(container, ctx);
          }
        } else if (action === 'delete') {
          const ok = await openUiConfirm({
            title: 'Delete Campaign',
            message: `Are you sure you want to delete <strong>"${camp.name}"</strong>? All queued actions will be canceled.`,
            confirmText: 'Delete Campaign',
            confirmDanger: true,
          });
          if (ok) {
            await call(ACTIONS.CAMPAIGN_DELETE, { campaignId: id });
            ctx.showToast?.('Campaign deleted.', 'success');
            renderCampaignsView(container, ctx);
          }
        }
      });
    });

    container.querySelectorAll('.waalaxy-camp-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-camp-3dots') || e.target.closest('.camp-3dots-menu')) return;
        const id = card.dataset.campId;
        const camp = campaigns.find((c) => (c.campaignId || c.id) === id);
        if (camp) {
          wizardTemplate = {
            id: camp.campaignId,
            title: camp.name,
            steps: camp.steps || [],
          };
          campaignName = camp.name;
          if (camp.steps?.length) {
            pipelineSteps = contractToPipeline(camp.steps);
          }
          viewState = 'wizard';
          wizardStep = 2;
          currentWizardStep = 2;
          render();
        }
      });
    });

    // Manual step execution
    container.querySelector('#btn-manual-tick')?.addEventListener('click', async () => {
      const tickBtn = container.querySelector('#btn-manual-tick');
      if (tickBtn) {
        tickBtn.disabled = true;
        tickBtn.innerHTML = `${ICONS.lightning} Triggering...`;
      }
      try {
        if (typeof chrome !== 'undefined' && chrome.alarms?.create) {
          chrome.alarms.create('campaignTick', { when: Date.now() + 100 });
        }
        await call(ACTIONS.CAMPAIGN_TICK, {}).catch(() => {});
        ctx.showToast?.('Triggered immediate sequence tick!', 'success');
        setTimeout(() => {
          renderCampaignsView(container, ctx);
        }, 600);
      } catch (e) {
        ctx.showToast?.(e.message || 'Tick failed', 'error');
      } finally {
        if (tickBtn) {
          tickBtn.disabled = false;
          tickBtn.innerHTML = `${ICONS.lightning} Run Step Now`;
        }
      }
    });

    container.querySelector('#btn-close-flow-modal')?.addEventListener('click', () => {
      container.querySelector('#flow-modal')?.classList.add('hidden');
    });
  }

  // =========================================================================
  // STATE B: 3-Step Campaign Creation Wizard (Frames 11–13)
  // =========================================================================
  function renderWizard() {
    const filterOptions = ['All', 'Custom', 'Invitation', 'Message', 'Visit', 'Email', 'CRM Sync'];
    const filteredTemplates = activeFilter === 'All'
      ? CAMPAIGN_TEMPLATES
      : CAMPAIGN_TEMPLATES.filter((t) => t.tags.includes(activeFilter) || t.category === activeFilter);

    // Get prospect count for selected list
    const prospectCount = getSelectedListProspectCount();

    container.innerHTML = `
      <div class="wizard-full-view">
        <!-- Top Wizard Header with Breadcrumbs -->
        <div class="wizard-top-header">
          <div class="wizard-head-left">
            <button type="button" class="btn-back-link" id="btn-cancel-wizard">
              ← Back to Campaigns
            </button>
            <h2 class="view-main-title">Create a Campaign</h2>
          </div>

          <!-- Breadcrumbs (Frames 11-13) -->
          <div class="wizard-breadcrumbs">
            <div class="breadcrumb-step ${wizardStep === 1 ? 'is-active' : ''} ${wizardStep > 1 ? 'is-done' : ''}">
              <span class="step-num">1</span>
              <span class="step-label">Pick Template</span>
            </div>
            <span class="breadcrumb-separator">→</span>
            <div class="breadcrumb-step ${wizardStep === 2 ? 'is-active' : ''} ${wizardStep > 2 ? 'is-done' : ''}">
              <span class="step-num">2</span>
              <span class="step-label">Add Prospects</span>
            </div>
            <span class="breadcrumb-separator">→</span>
            <div class="breadcrumb-step ${wizardStep === 3 ? 'is-active' : ''}">
              <span class="step-num">3</span>
              <span class="step-label">Content & Launch</span>
            </div>
          </div>
        </div>

        <!-- Wizard Step Body -->
        <div class="wizard-body-canvas">
          <!-- STEP 1: PICK TEMPLATE -->
          ${
            wizardStep === 1
              ? `
            <div class="wizard-step-container">
              <div class="step-headline-group">
                <h3 class="step-title">Select a campaign template</h3>
                <p class="step-subtitle">Choose from battle-tested multi-channel sequences or build your own custom sequence from scratch.</p>
              </div>

              <!-- Filter Pills (Frame 11) -->
              <div class="template-filter-pills">
                ${filterOptions
                  .map(
                    (f) => `
                  <button type="button" class="filter-pill ${activeFilter === f ? 'is-active' : ''}" data-filter="${f}">
                    ${f}
                  </button>
                `,
                  )
                  .join('')}
              </div>

              <!-- Templates Grid (Custom + Waalaxy sequences) -->
              <div class="templates-grid">
                ${filteredTemplates
                  .map(
                    (tpl) => `
                  <div class="template-card ${selectedTemplate.id === tpl.id ? 'is-selected' : ''}" data-tpl-id="${tpl.id}">
                    <div class="tpl-head">
                      <div class="tpl-icon-box">${tpl.icon}</div>
                      <div class="tpl-tags">
                        ${tpl.tags.map((t) => `<span class="tpl-tag-pill">${t}</span>`).join('')}
                      </div>
                    </div>
                    <h4 class="tpl-title">${tpl.title}</h4>
                    <p class="tpl-desc">${tpl.bestFor}</p>
                    <div class="tpl-flow-box">
                      <span class="tpl-flow-label">SEQUENCE FLOW:</span>
                      <span class="tpl-flow-text">${tpl.flowText}</span>
                    </div>
                    ${(() => {
                      const firstAction = tpl.steps?.find((s) => s.type !== 'wait');
                      if (firstAction && firstAction.type === 'message') {
                        return `
                          <div class="sequence-preflight-warning" style="margin: 10px 0 0 0; padding: 8px 12px; font-size: 11px;">
                            <span class="warning-icon" style="margin-top:0;">${ICONS.warning}</span>
                            <div class="warning-text">
                              <strong style="font-size: 11.5px; margin-bottom: 2px;">Caution: Step 1 is Direct Message</strong>
                              <p style="font-size: 11px; line-height: 1.3;">Only works for existing 1st-degree connections.</p>
                            </div>
                          </div>
                        `;
                      }
                      return '';
                    })()}
                    <button type="button" class="btn-pill btn-soft btn-sm btn-select-tpl" style="margin-top: 14px; width: 100%;">
                      ${selectedTemplate.id === tpl.id ? '✓ Selected' : 'Choose Template →'}
                    </button>
                  </div>
                `,
                  )
                  .join('')}
              </div>
            </div>
          `
              : ''
          }

          <!-- STEP 2: ADD PROSPECTS -->
          ${
            wizardStep === 2
              ? `
            <div class="wizard-step-container" style="max-width: 680px; margin: 0 auto;">
              <div class="step-headline-group">
                <h3 class="step-title">How do you want to add your prospects?</h3>
                <p class="step-subtitle">Select an existing lead list or target all saved prospects.</p>
              </div>

              <!-- Tabs: From my lists / Auto-import -->
              <div class="step-subtabs">
                <button type="button" class="subtab is-active">From my lists</button>
                <button type="button" class="subtab">From auto-import (LinkedIn Search)</button>
              </div>

              <div class="waalaxy-card" style="margin-top: 16px;">
                <div class="form-group">
                  <label>Campaign Name</label>
                  <input type="text" id="wizard-input-campname" class="form-input" value="${campaignName}" />
                </div>

                <div class="form-group" style="margin-top: 18px;">
                  <label>Select Prospect List</label>
                  <select id="wizard-select-list" class="form-input">
                    <option value="" ${!selectedListId ? 'selected' : ''}>-- Select a Prospect List --</option>
                    <option value="all_prospects" ${selectedListId === 'all_prospects' ? 'selected' : ''}>
                      All Saved Prospects (${profiles.length} leads available)
                    </option>
                    ${lists.map((l) => `<option value="${l.id}" ${selectedListId === l.id ? 'selected' : ''}>${l.name} (${l.count || 0} leads)</option>`).join('')}
                  </select>
                </div>

                <div class="prospect-summary-box">
                  <div class="prospect-count-badge ${prospectCount === 0 ? 'badge-warning' : ''}">
                    ${prospectCount} Prospect${prospectCount === 1 ? '' : 's'} ready to be enrolled
                  </div>
                  ${prospectCount === 0 ? `
                    <span style="font-size: 11.5px; color: #b27a00; font-weight: 600; display: block; margin-top: 4px;">
                      This list has no prospects. Please select a list containing at least 1 prospect.
                    </span>
                  ` : `
                    <span style="font-size: 11.5px; color: var(--text-muted); display: block; margin-top: 4px;">
                      Anti-detection pacing will distribute connection requests within your daily safety limit (25/day).
                    </span>
                  `}
                </div>
              </div>

              <div class="wizard-step-actions">
                <button type="button" class="btn-pill btn-secondary" id="btn-step2-back">
                  ← Back
                </button>
                <button type="button" class="btn-pill btn-primary" id="btn-step2-next">
                  Next: Sequence & Copy →
                </button>
              </div>
            </div>
          `
              : ''
          }

          <!-- STEP 3: SEQUENCE FLOW CANVAS & MESSAGE EDITOR -->
          ${
            wizardStep === 3
              ? `
            <div class="wizard-step-container">
              <div class="step-headline-group">
                <h3 class="step-title">Interactive Sequence Flow & Outreach Copy</h3>
                <p class="step-subtitle">Fully customize delays, delete steps (✕), or insert custom touchpoints (+). Changes save directly into the campaign runner.</p>
              </div>

              ${(() => {
                const firstAction = pipelineSteps.find((s) => s.type !== 'wait');
                if (firstAction && firstAction.type === 'message') {
                  return `
                    <div class="sequence-preflight-warning">
                      <span class="warning-icon">${ICONS.warning}</span>
                      <div class="warning-text">
                        <strong>Caution: Step 1 is Direct Message</strong>
                        <p>LinkedIn only allows direct messages to existing 1st-degree connections. If importing leads from LinkedIn Search, use a sequence starting with <strong>Invite (Connection Request)</strong>.</p>
                      </div>
                    </div>
                  `;
                }
                return '';
              })()}

              <!-- Waalaxy Horizontal Visual Node Flow Canvas (Interactive Pipeline Editor) -->
              <div class="waalaxy-card flow-canvas-card">
                <div class="canvas-header-label">HORIZONTAL VISUAL SEQUENCE PIPELINE (CLICK DELAYS OR [+] TO CUSTOMIZE)</div>
                ${renderHorizontalFlow(pipelineSteps, prospectCount, true)}
              </div>

              <!-- Message Editor Drawer -->
              <div class="waalaxy-card message-editor-card" style="margin-top: 20px;">
                <div class="editor-head">
                  <div class="editor-title-row">
                    <span class="editor-icon">${ICONS.invitation}</span>
                    <span class="editor-title">Connection Request Note</span>
                  </div>
                  <span class="char-counter" id="note-char-counter">${customNote.length} / 200</span>
                </div>

                <!-- Variable insertion chips -->
                <div class="variable-chips-row" style="flex-wrap: wrap; gap: 6px;">
                  <span style="font-size: 11.5px; font-weight: 600; color: #64748b; margin-right: 4px;">Insert Tag:</span>
                  <button type="button" class="variable-chip" data-tag="{{firstName}}">+ {{firstName}}</button>
                  <button type="button" class="variable-chip" data-tag="{{lastName}}">+ {{lastName}}</button>
                  <button type="button" class="variable-chip" data-tag="{{fullName}}">+ {{fullName}}</button>
                  <button type="button" class="variable-chip" data-tag="{{company}}">+ {{company}}</button>
                  <button type="button" class="variable-chip" data-tag="{{jobTitle}}">+ {{jobTitle}}</button>
                  <button type="button" class="variable-chip" data-tag="{{headline}}">+ {{headline}}</button>
                  <button type="button" class="variable-chip" data-tag="{{location}}">+ {{location}}</button>
                  <button type="button" class="variable-chip" data-tag="{{industry}}">+ {{industry}}</button>
                  <button type="button" class="variable-chip" data-tag="{{email}}">+ {{email}}</button>
                  <button type="button" class="variable-chip" data-tag="{{icebreaker}}">+ {{icebreaker}} (AI)</button>
                  <button type="button" class="variable-chip" data-tag="{{mutualCount}}">+ {{mutualCount}}</button>
                </div>

                <textarea id="wizard-note-textarea" class="form-input editor-textarea" rows="4" maxlength="200">${customNote}</textarea>

                <!-- AI Personalization Toggle -->
                <div class="ai-toggle-box">
                  <label class="toggle-switch">
                    <input type="checkbox" id="wizard-ai-toggle" ${useAiHook ? 'checked' : ''} />
                    <span class="slider"></span>
                  </label>
                  <div class="ai-toggle-text">
                    <span class="ai-toggle-title">${ICONS.sparkles} Use Groq/Gemini AI to generate unique personalized hook for each lead</span>
                    <span class="ai-toggle-sub">Dynamically inspects prospect headline and company to craft a contextual opening icebreaker.</span>
                  </div>
                </div>

                <!-- Launch Button -->
                <div class="editor-foot-actions">
                  <button type="button" class="btn-pill btn-secondary" id="btn-step3-back">
                    ← Back
                  </button>
                  <button type="button" class="btn-pill btn-primary btn-launch-big" id="btn-launch-campaign">
                    ${ICONS.rocket} Launch Campaign Now
                  </button>
                </div>
              </div>
            </div>
          `
              : ''
          }
        </div>
      </div>
    `;

    // Hook Wizard Events
    container.querySelector('#btn-cancel-wizard')?.addEventListener('click', () => {
      viewState = 'list';
      render();
    });

    // Step 1: Filter Pills
    container.querySelectorAll('.filter-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        activeFilter = pill.dataset.filter || 'All';
        renderWizard();
      });
    });

    // Step 1: Template Selection
    container.querySelectorAll('.template-card').forEach((card) => {
      card.addEventListener('click', () => {
        const tplId = card.dataset.tplId;
        const found = CAMPAIGN_TEMPLATES.find((t) => t.id === tplId);
        if (found) {
          selectedTemplate = found;
          campaignName = `${found.title} #${campaigns.length + 1}`;
          customNote = found.steps?.find((s) => s.type === 'invite')?.note || 'Hi {{firstName|there}} — would love to connect!';
          pipelineSteps = templateToPipeline(found);
          wizardStep = 2;
          renderWizard();
        }
      });
    });

    // Step 2 Events
    container.querySelector('#btn-step2-back')?.addEventListener('click', () => {
      wizardStep = 1;
      renderWizard();
    });

    container.querySelector('#wizard-input-campname')?.addEventListener('input', (e) => {
      campaignName = e.target.value;
    });

    container.querySelector('#wizard-select-list')?.addEventListener('change', (e) => {
      selectedListId = e.target.value;
      renderWizard();
    });

    container.querySelector('#btn-step2-next')?.addEventListener('click', () => {
      const nameInput = container.querySelector('#wizard-input-campname');
      if (nameInput && nameInput.value.trim()) campaignName = nameInput.value.trim();

      const count = getSelectedListProspectCount();
      if (!selectedListId || count <= 0) {
        openUiAlert({ title: 'Selection Required', message: 'Please select a list containing at least 1 prospect before proceeding.' });
        ctx.showToast?.('Please select a list containing at least 1 prospect.', 'warn');
        return;
      }

      wizardStep = 3;
      renderWizard();
    });

    // Step 3: Interactive Flow Canvas & Message Editor Events
    if (wizardStep === 3) {
      setupFlowCanvasEvents();

      const textarea = container.querySelector('#wizard-note-textarea');
      const counter = container.querySelector('#note-char-counter');

      textarea?.addEventListener('input', () => {
        customNote = textarea.value;
        const inviteStep = pipelineSteps.find((s) => s.type === 'invite');
        if (inviteStep) inviteStep.note = customNote;

        if (counter) {
          counter.textContent = `${textarea.value.length} / 200`;
          counter.classList.toggle('is-warning', textarea.value.length > 180);
        }
      });

      // Variable insertion chips
      container.querySelectorAll('.variable-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const tag = chip.dataset.tag;
          if (textarea && tag) {
            const start = textarea.selectionStart || textarea.value.length;
            const end = textarea.selectionEnd || textarea.value.length;
            textarea.value = textarea.value.substring(0, start) + tag + textarea.value.substring(end);
            customNote = textarea.value;
            const inviteStep = pipelineSteps.find((s) => s.type === 'invite');
            if (inviteStep) inviteStep.note = customNote;

            textarea.focus();
            textarea.selectionStart = textarea.selectionEnd = start + tag.length;
            if (counter) {
              counter.textContent = `${textarea.value.length} / 200`;
              counter.classList.toggle('is-warning', textarea.value.length > 180);
            }
          }
        });
      });

      container.querySelector('#wizard-ai-toggle')?.addEventListener('change', (e) => {
        useAiHook = Boolean(e.target.checked);
      });

      container.querySelector('#btn-step3-back')?.addEventListener('click', () => {
        wizardStep = 2;
        renderWizard();
      });

      // Launch Campaign
      container.querySelector('#btn-launch-campaign')?.addEventListener('click', async () => {
        const count = getSelectedListProspectCount();
        if (!selectedListId || count <= 0) {
          openUiAlert({ title: 'Selection Required', message: 'Please select a list containing at least 1 prospect before proceeding.' });
          ctx.showToast?.('Please select a list containing at least 1 prospect.', 'warn');
          return;
        }

        if (pipelineSteps.length === 0) {
          openUiAlert({ title: 'Action Step Required', message: 'Please add at least 1 action step to your sequence before launching.' });
          ctx.showToast?.('Please add at least 1 action step to your sequence.', 'warn');
          return;
        }

        const launchBtn = container.querySelector('#btn-launch-campaign');
        if (launchBtn) {
          launchBtn.disabled = true;
          launchBtn.textContent = 'Launching Sequence...';
        }

        // Convert editable pipeline steps to contract steps
        const contractSteps = pipelineStepsToContract(pipelineSteps, customNote, useAiHook);

        // Public IDs to enroll
        let publicIdsToEnroll = [];
        if (selectedListId === 'all_prospects') {
          publicIdsToEnroll = profiles.map((p) => p.publicId).filter(Boolean);
        } else if (selectedListId) {
          try {
            const memRes = await call(ACTIONS.LIST_MEMBERS, { listId: selectedListId, count: 5000 });
            const members = memRes?.members || [];
            publicIdsToEnroll = members.map((m) => m.publicId || m.profile?.publicId).filter(Boolean);
          } catch (err) {
            console.warn('[Campaigns View] Pre-fetching list members failed:', err);
          }
        }

        try {
          await call(ACTIONS.CAMPAIGN_CREATE, {
            name: campaignName,
            steps: contractSteps,
            listId: selectedListId !== 'all_prospects' ? selectedListId : undefined,
            publicIds: publicIdsToEnroll.length > 0 ? publicIdsToEnroll : undefined,
            syncGoogleSheets: true,
          });

          ctx.showToast?.(`Campaign "${campaignName}" launched successfully!`, 'success');
          viewState = 'list';
          renderCampaignsView(container, ctx);
        } catch (err) {
          ctx.showToast?.(`Launch error: ${err.message}`, 'error');
          if (launchBtn) {
            launchBtn.disabled = false;
            launchBtn.innerHTML = `${ICONS.rocket} Launch Campaign Now`;
          }
        }
      });
    }
  }

  // =========================================================================
  // Canvas Interactive Event Handlers (Delete, Insert, Delay Picker)
  // =========================================================================
  function setupFlowCanvasEvents() {
    const canvasCard = container.querySelector('.flow-canvas-card');
    if (!canvasCard) return;

    function closeAnyPopover() {
      container.querySelectorAll('.node-connector').forEach((c) => {
        c.style.zIndex = '';
      });
      container.querySelectorAll('.pipeline-popover-menu').forEach((p) => p.remove());
    }

    function refreshCanvas() {
      closeAnyPopover();
      const canvasInner = canvasCard.querySelector('.horizontal-node-canvas');
      if (canvasInner) {
        canvasInner.outerHTML = renderHorizontalFlow(pipelineSteps, getSelectedListProspectCount(), true);
        setupFlowCanvasEvents();
      }
    }

    // Step Deletion (✕ Button)
    canvasCard.querySelectorAll('.btn-delete-node').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAnyPopover();
        const deleteIdx = parseInt(btn.dataset.deleteIdx, 10);
        if (!isNaN(deleteIdx) && deleteIdx >= 0 && deleteIdx < pipelineSteps.length) {
          pipelineSteps.splice(deleteIdx, 1);
          refreshCanvas();
        }
      });
    });

    // Editable Delay Badges (Click opens dropdown)
    canvasCard.querySelectorAll('.delay-pill-badge').forEach((badge) => {
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        const connector = badge.closest('.node-connector');
        const existing = badge.querySelector('.pipeline-popover-menu');
        if (existing) {
          existing.remove();
          if (connector) connector.style.zIndex = '';
          return;
        }
        closeAnyPopover();
        if (connector) connector.style.zIndex = '999999';

        const connectorIdx = parseInt(badge.dataset.connectorIdx, 10);
        const popover = document.createElement('div');
        popover.className = 'pipeline-popover-menu delay-popover';
        popover.innerHTML = DELAY_OPTIONS.map((opt) => `
          <button type="button" class="pipeline-popover-item" data-ms="${opt.ms}">
            ${opt.label}
          </button>
        `).join('');

        badge.style.position = 'relative';
        badge.appendChild(popover);

        popover.querySelectorAll('.pipeline-popover-item').forEach((item) => {
          item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const ms = parseInt(item.dataset.ms, 10);
            if (!isNaN(ms)) {
              if (connectorIdx < pipelineSteps.length) {
                pipelineSteps[connectorIdx].delayMs = ms;
              }
            }
            refreshCanvas();
          });
        });
      });
    });

    // Insert Step Button (+ Add Step)
    canvasCard.querySelectorAll('.btn-insert-node').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const connector = btn.closest('.node-connector');
        const existing = connector?.querySelector('.pipeline-popover-menu');
        if (existing) {
          existing.remove();
          if (connector) connector.style.zIndex = '';
          return;
        }
        closeAnyPopover();
        if (connector) connector.style.zIndex = '999999';

        const insertIdx = parseInt(btn.dataset.insertIdx, 10);
        const popover = document.createElement('div');
        popover.className = 'pipeline-popover-menu insert-popover';
        popover.innerHTML = INSERT_STEP_OPTIONS.map((opt, i) => `
          <button type="button" class="pipeline-popover-item" data-opt-idx="${i}">
            <span>${opt.icon}</span>
            <span>${opt.title}</span>
          </button>
        `).join('');

        if (connector) {
          connector.style.position = 'relative';
          connector.appendChild(popover);
        } else {
          btn.parentElement?.appendChild(popover);
        }

        popover.querySelectorAll('.pipeline-popover-item').forEach((item) => {
          item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const optIdx = parseInt(item.dataset.optIdx, 10);
            const chosen = INSERT_STEP_OPTIONS[optIdx];
            if (chosen) {
              const newStep = {
                ...chosen,
                id: 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
              };
              pipelineSteps.splice(insertIdx, 0, newStep);
            }
            refreshCanvas();
          });
        });
      });
    });
  }

  // Global dismiss for popovers
  document.addEventListener('click', () => {
    container.querySelectorAll('.node-connector').forEach((c) => {
      c.style.zIndex = '';
    });
    container.querySelectorAll('.pipeline-popover-menu').forEach((p) => p.remove());
  });

  render();
}
