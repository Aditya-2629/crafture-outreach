/**
 * OutFox — Authentic Waalaxy Campaigns View & 3-Step Wizard
 * Video Frames 11–17: Template Gallery, 3-Step Creator Wizard, Horizontal Flow Canvas, and Message Editor.
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { allProfiles } from '../lib/storage.js';
import { openUiConfirm, openUiAlert, openUiSelectModal, openLeadTimelineModal } from './modal-engine.js';
import { ICONS } from '../ui/icons.js';
import { getConfig } from '../lib/config.js';

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
    id: 'gmail_drip',
    title: '3-Step Cold Email Drip',
    badge: 'Gmail Only',
    category: 'Gmail Only',
    tags: ['Gmail Only', 'Email', 'Drip'],
    flowText: '[Step 1: Cold Intro Email] → [Wait 3 Days] → [Step 2: Follow-up Thread] → [Wait 4 Days] → [Step 3: Break-up Email] → [CRM Sync]',
    bestFor: 'Multi-touch standalone cold email outreach completely decoupled from LinkedIn, threaded in the same Gmail conversation.',
    icon: ICONS.email,
    steps: [
      {
        type: 'email',
        subject: 'Quick question regarding {{company|your company}}',
        body: "Hi {{firstName|there}},\n\nSaw what you're building at {{company|your team}} and wanted to reach out.\n\n{{ai_opener|We help teams streamline outreach and automate pipeline growth.}}\n\nDo you have 5 minutes this week for a brief chat?\n\nBest,\nAditya",
        replyInThread: false,
      },
      { type: 'wait', waitMs: 259200000, delayLabel: 'Wait 3 days' },
      {
        type: 'email',
        subject: 'Re: Quick question regarding {{company|your company}}',
        body: "Hi {{firstName|there}},\n\nJust bumping this in case it got buried under your inbox. Would love to share how similar teams are handling outreach this quarter.\n\nLet me know if Tuesday or Thursday works better for you.\n\nBest,\nAditya",
        replyInThread: true,
      },
      { type: 'wait', waitMs: 345600000, delayLabel: 'Wait 4 days' },
      {
        type: 'email',
        subject: 'Re: Quick question regarding {{company|your company}}',
        body: "Hi {{firstName|there}},\n\nI realize you're super busy, so I'll stop following up here. If timing ever aligns down the road, feel free to reach back out.\n\nWishing you and {{company|your team}} all the best!\n\nBest,\nAditya",
        replyInThread: true,
      },
      { type: 'crm_sync' },
    ],
  },
  {
    id: 'gmail_recruiter',
    title: 'Recruiter / Candidate Direct Pitch',
    badge: 'Gmail Only',
    category: 'Gmail Only',
    tags: ['Gmail Only', 'Email', 'Recruiting'],
    flowText: '[Step 1: Role Opportunity Pitch] → [Wait 3 Days] → [Step 2: Role Details Follow-up Thread] → [CRM Sync]',
    bestFor: "Direct talent acquisition and candidate sourcing sent straight to candidates' inboxes with thread continuation.",
    icon: ICONS.email,
    steps: [
      {
        type: 'email',
        subject: 'Exciting role opportunity for {{firstName|there}} at high-growth venture',
        body: "Hi {{firstName|there}},\n\nI came across your profile and was impressed by your experience in {{headline|your domain}}.\n\nWe are currently sourcing key talent and thought your background would be an incredible fit for an upcoming leadership role.\n\nWould you be open to an exploratory 10-minute conversation this week?\n\nBest regards,\nAditya",
        replyInThread: false,
      },
      { type: 'wait', waitMs: 259200000, delayLabel: 'Wait 3 days' },
      {
        type: 'email',
        subject: 'Re: Exciting role opportunity for {{firstName|there}}',
        body: "Hi {{firstName|there}},\n\nWanted to make sure you saw my note above. We're moving quickly to final rounds and I'd love to get your thoughts before closing the candidate pipeline.\n\nLet me know if you're available for a quick chat!\n\nBest,\nAditya",
        replyInThread: true,
      },
      { type: 'crm_sync' },
    ],
  },
  {
    id: 'gmail_blank',
    title: 'Blank Gmail Sequence',
    badge: 'Gmail Only',
    category: 'Gmail Only',
    tags: ['Gmail Only', 'Custom', 'Email'],
    flowText: '[Step 1: Cold Email] → [Add Step (+)]',
    bestFor: 'Build a custom email-only sequence from scratch with custom steps and delays.',
    icon: ICONS.email,
    steps: [
      {
        type: 'email',
        subject: 'Hi {{firstName|there}}',
        body: "Hi {{firstName|there}},\n\n{{ai_opener|Wanted to connect regarding {{company|your company}}.}}\n\nBest,\nAditya",
        replyInThread: false,
      },
    ],
  },
  {
    id: 'social_warmup',
    title: '🔥 Social Warmup + Connect',
    badge: 'High Acceptance (45%+)',
    category: 'Invitation',
    tags: ['Invitation', 'Visit', 'Social Warmup'],
    flowText: '[Profile Visit] → [Like Post] → [Follow] → [Wait 1 Day] → [Invite + Spintax] → [Follow-up Message]',
    bestFor: 'Pre-warms leads with subtle profile visits, post likes, and follows before inviting to achieve 45%+ connection rates.',
    icon: ICONS.invitation,
    steps: [
      { type: 'view' },
      { type: 'like' },
      { type: 'follow' },
      { type: 'wait', waitMs: 86400000, delayLabel: 'Wait 1 day' },
      {
        type: 'invite',
        note: '{Hi|Hey} {{firstName}}, {loved your recent post|saw your work at {{company}}} — would love to connect!',
      },
      {
        type: 'branch',
        branch: {
          on: 'accepted',
          ms: 172800000,
          then: [
            { type: 'wait', waitMs: 86400000, delayLabel: 'Wait 1 day' },
            {
              type: 'message',
              body: '{Hi|Hey} {{firstName}}, thanks for connecting! Looking forward to keeping in touch.',
            },
            { type: 'crm_sync' },
          ],
          else: [],
        },
      },
    ],
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
  if (tpl.id === 'gmail_drip') {
    return [
      { id: 'p_1', type: 'email', title: 'Cold Intro Email', sub: 'Step 1', icon: ICONS.email, delayMs: 0, subject: 'Quick question regarding {{company|your company}}', body: "Hi {{firstName|there}},\n\nSaw what you're building at {{company|your team}} and wanted to reach out.\n\n{{ai_opener|We help teams streamline outreach and automate pipeline growth.}}\n\nDo you have 5 minutes this week for a brief chat?\n\nBest,\nAditya", replyInThread: false },
      { id: 'p_2', type: 'email', title: 'Follow-up Email', sub: 'Threaded Follow-up', icon: ICONS.email, delayMs: 259200000, subject: 'Re: Quick question regarding {{company|your company}}', body: "Hi {{firstName|there}},\n\nJust bumping this in case it got buried under your inbox. Would love to share how similar teams are handling outreach this quarter.\n\nLet me know if Tuesday or Thursday works better for you.\n\nBest,\nAditya", replyInThread: true },
      { id: 'p_3', type: 'email', title: 'Break-up Email', sub: 'Final Check-in', icon: ICONS.email, delayMs: 345600000, subject: 'Re: Quick question regarding {{company|your company}}', body: "Hi {{firstName|there}},\n\nI realize you're super busy, so I'll stop following up here. If timing ever aligns down the road, feel free to reach back out.\n\nWishing you and {{company|your team}} all the best!\n\nBest,\nAditya", replyInThread: true },
    ];
  }
  if (tpl.id === 'gmail_recruiter') {
    return [
      { id: 'p_1', type: 'email', title: 'Role Opportunity Pitch', sub: 'Step 1', icon: ICONS.email, delayMs: 0, subject: 'Exciting role opportunity for {{firstName|there}} at high-growth venture', body: "Hi {{firstName|there}},\n\nI came across your profile and was impressed by your experience in {{headline|your domain}}.\n\nWe are currently sourcing key talent and thought your background would be an incredible fit for an upcoming leadership role.\n\nWould you be open to an exploratory 10-minute conversation this week?\n\nBest regards,\nAditya", replyInThread: false },
      { id: 'p_2', type: 'email', title: 'Role Follow-up', sub: 'Threaded Follow-up', icon: ICONS.email, delayMs: 259200000, subject: 'Re: Exciting role opportunity for {{firstName|there}}', body: "Hi {{firstName|there}},\n\nWanted to make sure you saw my note above. We're moving quickly to final rounds and I'd love to get your thoughts before closing the candidate pipeline.\n\nLet me know if you're available for a quick chat!\n\nBest,\nAditya", replyInThread: true },
    ];
  }
  if (tpl.id === 'gmail_blank') {
    return [
      { id: 'p_1', type: 'email', title: 'Cold Email', sub: 'Step 1', icon: ICONS.email, delayMs: 0, subject: 'Hi {{firstName|there}}', body: "Hi {{firstName|there}},\n\n{{ai_opener|Wanted to connect regarding {{company|your company}}.}}\n\nBest,\nAditya", replyInThread: false },
    ];
  }
  if (tpl.id === 'social_warmup') {
    return [
      { id: 'p_1', type: 'view', title: 'View Profile', sub: 'Warm Touch', icon: ICONS.visit, delayMs: 0 },
      { id: 'p_2', type: 'like', title: 'Like Recent Post', sub: 'Warm Touch', icon: ICONS.lightning, delayMs: 0 },
      { id: 'p_3', type: 'follow', title: 'Follow Profile', sub: 'Warm Touch', icon: ICONS.user, delayMs: 0 },
      { id: 'p_4', type: 'invite', title: 'Invitation', sub: 'Custom Note', icon: ICONS.invitation, delayMs: 86400000, note: '{Hi|Hey} {{firstName}}, {loved your recent post|saw your work at {{company}}} — would love to connect!' },
      { id: 'p_5', type: 'message', title: 'LinkedIn Message', sub: 'If Accepted', icon: ICONS.message, delayMs: 86400000, body: '{Hi|Hey} {{firstName}}, thanks for connecting! Looking forward to keeping in touch.' },
    ];
  }
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
      else if (step.type === 'email') steps.push({
        type: 'email',
        subject: step.subject || 'Quick question',
        body: step.body || 'Hi {{firstName|there}}...',
        replyInThread: step.replyInThread !== false,
        useAi: step.useAi ?? useAi,
      });
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
      replyInThread: emailStep.replyInThread !== false,
      useAi: emailStep.useAi ?? useAi,
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

export function renderHorizontalFlow(pipelineSteps = [], prospectCount = 12, isInteractive = true, activeStepIdx = 0) {
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
        <div class="flow-node-card ${idx === activeStepIdx ? 'is-active-step' : ''}" data-step-idx="${idx}" style="${isInteractive ? 'cursor: pointer;' : ''} ${idx === activeStepIdx ? 'border-color: #ff6b00; box-shadow: 0 0 0 2px rgba(255, 107, 0, 0.22);' : ''}">
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
    .planet-avatar img { width: 28px; height: 28px; border-radius: 6px; object-fit: contain; }
    .planet-ring { display: none; }
    .camp-card-meta { flex: 1; min-width: 0; }
    .camp-card-name { font-size: 14.5px; font-weight: 700; color: #14142b; display: block; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

    /* Live Status Drawer */
    .camp-drawer-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(2px);
      z-index: 99990;
      display: flex;
      justify-content: flex-end;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    .camp-drawer-backdrop.is-open {
      opacity: 1;
      pointer-events: auto;
    }
    .camp-drawer {
      width: 820px;
      max-width: 92vw;
      height: 100%;
      background: #ffffff;
      box-shadow: -10px 0 35px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .camp-drawer-backdrop.is-open .camp-drawer {
      transform: translateX(0);
    }
    .camp-drawer-head {
      padding: 18px 24px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #ffffff;
    }
    .camp-drawer-head-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .camp-drawer-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
    }
    .camp-drawer-subtitle {
      font-size: 12px;
      color: #64748b;
      margin-top: 2px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .camp-drawer-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-drawer-close {
      background: #f1f5f9;
      border: none;
      color: #64748b;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }
    .btn-drawer-close:hover {
      background: #e2e8f0;
      color: #0f172a;
    }
    .camp-drawer-toolbar {
      padding: 12px 24px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .drawer-pills-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .drawer-filter-pill {
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #475569;
      font-size: 11.5px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 9999px;
      cursor: pointer;
      transition: all 0.12s;
    }
    .drawer-filter-pill:hover {
      border-color: #ff6b00;
      color: #ff6b00;
    }
    .drawer-filter-pill.is-active {
      background: #ff6b00;
      color: #ffffff;
      border-color: #ff6b00;
      box-shadow: 0 2px 6px rgba(255, 107, 0, 0.2);
    }
    .drawer-search-wrap {
      display: flex;
      align-items: center;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 0 10px;
      width: 190px;
    }
    .drawer-search-wrap input {
      border: none;
      outline: none;
      font-size: 12px;
      padding: 6px 4px;
      width: 100%;
      background: transparent;
    }
    .camp-drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 0;
    }
    .drawer-leads-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    .drawer-leads-table th {
      background: #f8fafc;
      color: #64748b;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.03em;
      padding: 10px 16px;
      border-bottom: 1px solid #e2e8f0;
      text-align: left;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .drawer-leads-table td {
      padding: 12px 16px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: middle;
    }
    .drawer-leads-table tr:hover td {
      background: #fffaf5;
    }
    .lead-meta-cell {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .lead-name-row {
      font-weight: 600;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .lead-company-sub {
      font-size: 11.5px;
      color: #64748b;
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
    }
    .badge-status-active { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }
    .badge-status-running { background: #fff7ed; color: #ea580c; border: 1px solid #fed7aa; }
    .badge-status-waiting { background: #f5f3ff; color: #7c3aed; border: 1px solid #ddd6fe; }
    .badge-status-completed { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
    .badge-status-replied { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
    .badge-status-failed { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
    .badge-status-paused { background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; }
    .btn-camp-live-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #fff7ed;
      color: #ff6b00;
      border: 1px solid #ffedd5;
      padding: 3px 9px;
      border-radius: 9999px;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.12s;
    }
    .btn-camp-live-badge:hover {
      background: #ff6b00;
      color: #ffffff;
      border-color: #ff6b00;
    }
    .btn-camp-card-live {
      background: #fff7ed;
      border: 1px solid #ffedd5;
      color: #ff6b00;
      font-size: 11.5px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
    }
    .btn-camp-card-live:hover {
      background: #ff6b00;
      color: #ffffff;
      border-color: #ff6b00;
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
  let activeSenderEmail = '';

  try {
    const [cRes, lRes, pRes, cfg] = await Promise.all([
      call(ACTIONS.CAMPAIGN_GET_ALL, {}).catch(() => []),
      call(ACTIONS.LIST_GET_ALL, {}).catch(() => []),
      allProfiles().catch(() => []),
      getConfig().catch(() => ({})),
    ]);
    campaigns = Array.isArray(cRes) ? cRes : (cRes?.campaigns || []);
    const rawLists = Array.isArray(lRes) ? lRes : (lRes?.lists || []);
    lists = rawLists.map((l) => ({
      ...l,
      id: l.listId || l.id,
      listId: l.listId || l.id,
    }));
    profiles = Array.isArray(pRes) ? pRes : [];
    activeSenderEmail = cfg?.mailbox?.email || cfg?.googleWorkspace?.email || '';
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
  let activeStepIdx = 0;
  let autoEnrichMissingEmail = true;

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

    const outfoxLogoUrl =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL('icons/icon48.png')
        : '../../icons/icon48.png';

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
                <img src="${outfoxLogoUrl}" width="28" height="28" alt="OutFox" />
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
                  <img src="${outfoxLogoUrl}" width="28" height="28" alt="OutFox" />
                </div>

                <div class="camp-card-meta">
                  <span class="camp-card-name">${camp.name}</span>
                  <div class="camp-card-badges-row">
                    <span class="camp-leads-pill">⚡ ${leads} leads</span>
                    <span class="camp-status-dot ${statusClass}" title="Status: ${camp.status || 'running'}"></span>
                  </div>
                </div>

                <button type="button" class="btn-camp-card-live btn-trigger-live-drawer" data-id="${id}" title="View live lead progress">
                  ⚡ Live Status
                </button>

                <button type="button" class="btn-camp-3dots" data-dots-id="${id}" title="Campaign actions">
                  ${ICONS.moreHorizontal}
                </button>

                <!-- 3-Dots Dropdown Menu (Screenshot 3) -->
                <div class="camp-3dots-menu" id="camp-menu-${id}">
                  <div class="camp-menu-item" data-action="live_status" data-id="${id}">
                    <span style="color:#ff6b00;">⚡</span> View Live Leads Status
                  </div>
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

      <!-- Live Campaign Status Drawer -->
      <div class="camp-drawer-backdrop" id="camp-live-drawer-backdrop">
        <div class="camp-drawer" id="camp-live-drawer">
          <div class="camp-drawer-head">
            <div class="camp-drawer-head-info">
              <div class="planet-avatar" style="width:36px; height:36px;">
                <img src="${outfoxLogoUrl}" width="22" height="22" alt="OutFox" />
              </div>
              <div>
                <h3 class="camp-drawer-title" id="drawer-camp-name">Live Campaign Status</h3>
                <div class="camp-drawer-subtitle" id="drawer-camp-subtitle">Real-time prospect progress</div>
              </div>
            </div>
            <div class="camp-drawer-actions">
              <button type="button" class="btn-pill btn-secondary btn-sm" id="btn-drawer-tick" style="font-size: 11.5px; padding: 5px 12px;">
                ⚡ Run Step Now
              </button>
              <button type="button" class="btn-pill btn-secondary btn-sm" id="btn-drawer-refresh" style="font-size: 11.5px; padding: 5px 10px;">
                🔄 Refresh
              </button>
              <button type="button" class="btn-drawer-close" id="btn-drawer-close">✕</button>
            </div>
          </div>
          <div class="camp-drawer-toolbar">
            <div class="drawer-pills-bar" id="drawer-filter-pills">
              <!-- Filter pills dynamically populated -->
            </div>
            <div class="drawer-search-wrap">
              <span style="color:#94a3b8; display:flex;">${ICONS.search}</span>
              <input type="text" id="input-drawer-search" placeholder="Filter leads..." />
            </div>
          </div>
          <div class="camp-drawer-body" id="drawer-table-wrap">
            <div class="view-loading-state" style="padding: 40px 0;">
              <div class="spinner"></div>
              <span>Fetching live prospect status...</span>
            </div>
          </div>
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

        if (action === 'live_status') {
          openLiveLeadsDrawer(id);
        } else if (action === 'edit') {
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

    container.querySelectorAll('.btn-trigger-live-drawer').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (id) openLiveLeadsDrawer(id);
      });
    });

    container.querySelectorAll('.waalaxy-camp-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-camp-3dots') || e.target.closest('.camp-3dots-menu') || e.target.closest('.btn-trigger-live-drawer')) return;
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

    // =========================================================================
    // Live Leads Drawer Logic & Events
    // =========================================================================
    let drawerCampId = null;
    let drawerFilter = 'all';
    let drawerSearchQuery = '';
    let drawerInterval = null;
    let cachedLiveData = null;

    function formatTimeAgo(ts) {
      if (!ts) return '';
      const diff = Date.now() - Number(ts);
      if (diff < 60000) return 'just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
      return `${Math.floor(diff / 86400000)}d ago`;
    }

    function formatCountdown(ts, status) {
      if (status === 'completed' || status === 'replied') return '—';
      if (!ts || ts <= Date.now()) {
        return status === 'active' || status === 'running'
          ? '<span style="color:#ff6b00; font-weight:700;">Due now</span>'
          : '—';
      }
      const diff = ts - Date.now();
      if (diff < 60000) return '<span style="color:#7c3aed; font-weight:600;">in <1m</span>';
      if (diff < 3600000) return `<span style="color:#7c3aed; font-weight:600;">in ${Math.round(diff / 60000)}m</span>`;
      if (diff < 86400000) return `<span style="color:#7c3aed; font-weight:600;">in ${(diff / 3600000).toFixed(1)}h</span>`;
      return `<span style="color:#7c3aed; font-weight:600;">in ${Math.round(diff / 86400000)}d</span>`;
    }

    async function openLiveLeadsDrawer(campaignId) {
      drawerCampId = campaignId;
      drawerFilter = 'all';
      drawerSearchQuery = '';

      const backdrop = container.querySelector('#camp-live-drawer-backdrop');
      if (!backdrop) return;
      backdrop.classList.add('is-open');

      renderDrawerLoading();
      await fetchAndRenderDrawer();

      if (drawerInterval) clearInterval(drawerInterval);
      drawerInterval = setInterval(async () => {
        const liveBackdrop = container.querySelector('#camp-live-drawer-backdrop');
        if (!liveBackdrop || !liveBackdrop.classList.contains('is-open')) {
          clearInterval(drawerInterval);
          drawerInterval = null;
          return;
        }
        await fetchAndRenderDrawer(true);
      }, 5000);
    }

    function closeLiveLeadsDrawer() {
      if (drawerInterval) {
        clearInterval(drawerInterval);
        drawerInterval = null;
      }
      const backdrop = container.querySelector('#camp-live-drawer-backdrop');
      if (backdrop) backdrop.classList.remove('is-open');
    }

    function renderDrawerLoading() {
      const nameEl = container.querySelector('#drawer-camp-name');
      const subEl = container.querySelector('#drawer-camp-subtitle');
      const tableWrap = container.querySelector('#drawer-table-wrap');
      if (nameEl) nameEl.textContent = 'Loading live status...';
      if (subEl) subEl.textContent = 'Connecting to background sequence engine';
      if (tableWrap) {
        tableWrap.innerHTML = `
          <div class="view-loading-state" style="padding: 40px 0;">
            <div class="spinner"></div>
            <span>Fetching live prospect status...</span>
          </div>
        `;
      }
    }

    async function fetchAndRenderDrawer(isSilent = false) {
      if (!drawerCampId) return;
      try {
        const res = await call(ACTIONS.CAMPAIGN_LIVE_STATUS, { campaignId: drawerCampId });
        const data = res?.ok ? res.data : (res?.leads ? res : null);
        if (!data) return;
        cachedLiveData = data;
        renderDrawerContent(data, isSilent);
      } catch (err) {
        console.warn('[LiveDrawer] Fetch error:', err);
      }
    }

    function renderDrawerContent(data, isSilent = false) {
      const nameEl = container.querySelector('#drawer-camp-name');
      const subEl = container.querySelector('#drawer-camp-subtitle');
      const pillsBar = container.querySelector('#drawer-filter-pills');

      if (nameEl) nameEl.textContent = data.campaignName || 'Campaign Live Status';
      if (subEl) {
        const isPaused = data.campaignStatus === 'paused';
        const statusPill = isPaused ? '⏸️ Paused' : '⚡ Running';
        subEl.innerHTML = `${statusPill} &bull; ${data.summary?.total || 0} enrolled prospects &bull; Auto-refreshing every 5s`;
      }

      const s = data.summary || {};
      const pills = [
        { id: 'all', label: `All (${s.total || 0})` },
        { id: 'active', label: `Active / Running (${(s.active || 0) + (s.currentlyRunning || 0)})` },
        { id: 'waiting', label: `Waiting (${s.waiting || 0})` },
        { id: 'replied', label: `Replied (${s.replied || 0})` },
        { id: 'completed', label: `Completed (${s.completed || 0})` },
        { id: 'failed', label: `Failed (${s.failed || 0})` },
      ];

      if (pillsBar) {
        pillsBar.innerHTML = pills
          .map(
            (p) =>
              `<button type="button" class="drawer-filter-pill ${drawerFilter === p.id ? 'is-active' : ''}" data-filter="${p.id}">${p.label}</button>`,
          )
          .join('');

        pillsBar.querySelectorAll('.drawer-filter-pill').forEach((btn) => {
          btn.addEventListener('click', () => {
            drawerFilter = btn.dataset.filter;
            pillsBar.querySelectorAll('.drawer-filter-pill').forEach((b) => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            renderFilteredLeadsTable(data.leads || []);
          });
        });
      }

      renderFilteredLeadsTable(data.leads || []);
    }

    function renderFilteredLeadsTable(allLeads = []) {
      const tableWrap = container.querySelector('#drawer-table-wrap');
      if (!tableWrap) return;

      let filtered = allLeads;

      if (drawerFilter === 'active') {
        filtered = filtered.filter((l) => l.status === 'active' || l.status === 'running');
      } else if (drawerFilter === 'waiting') {
        filtered = filtered.filter((l) => l.status === 'waiting');
      } else if (drawerFilter === 'replied') {
        filtered = filtered.filter((l) => l.status === 'replied');
      } else if (drawerFilter === 'completed') {
        filtered = filtered.filter((l) => l.status === 'completed');
      } else if (drawerFilter === 'failed') {
        filtered = filtered.filter((l) => l.status === 'failed');
      }

      if (drawerSearchQuery.trim()) {
        const q = drawerSearchQuery.toLowerCase();
        filtered = filtered.filter(
          (l) =>
            (l.fullName && l.fullName.toLowerCase().includes(q)) ||
            (l.company && l.company.toLowerCase().includes(q)) ||
            (l.email && l.email.toLowerCase().includes(q)) ||
            (l.publicId && l.publicId.toLowerCase().includes(q)),
        );
      }

      if (filtered.length === 0) {
        tableWrap.innerHTML = `
          <div style="padding: 48px 24px; text-align: center; color: #64748b;">
            <div style="font-size: 28px; margin-bottom: 8px;">🔍</div>
            <div style="font-weight: 700; color: #1e293b; margin-bottom: 4px;">No prospects found</div>
            <div style="font-size: 12.5px;">No leads match the selected filter "${drawerFilter}".</div>
          </div>
        `;
        return;
      }

      tableWrap.innerHTML = `
        <table class="drawer-leads-table">
          <thead>
            <tr>
              <th>Prospect</th>
              <th>Current Step</th>
              <th>Live Status</th>
              <th>Next Run</th>
              <th>Last Result / Error</th>
            </tr>
          </thead>
          <tbody>
            ${filtered
              .map((lead) => {
                const status = lead.status || 'active';
                const badgeClass = `badge-status-${status}`;
                const countdown = formatCountdown(lead.nextRunAt, status);

                let lastResultHtml = '<span style="color:#94a3b8; font-size:11.5px;">Not started</span>';
                if (lead.lastError) {
                  const shortErr = lead.lastError.length > 30 ? lead.lastError.slice(0, 30) + '...' : lead.lastError;
                  lastResultHtml = `<span style="color:#ef4444; font-size:11.5px; font-weight:600;" title="${lead.lastError}">⚠️ ${shortErr}</span>`;
                } else if (lead.replied) {
                  lastResultHtml = `<span style="color:#16a34a; font-weight:600; font-size:11.5px;">💬 Replied</span>`;
                } else if (lead.lastActionAt) {
                  lastResultHtml = `<span style="color:#64748b; font-size:11.5px;">${formatTimeAgo(lead.lastActionAt)}</span>`;
                }

                return `
                  <tr>
                    <td>
                      <div class="lead-meta-cell">
                        <div class="lead-name-row">
                          <span class="btn-open-lead-timeline" data-public-id="${lead.publicId}" style="cursor:pointer; font-weight:600; color:#1e293b; text-decoration:underline decoration-dotted;" title="Click to view outreach timeline">${lead.fullName}</span>
                          ${lead.email ? `<span style="font-size:11px; color:#ff6b00; cursor:pointer;" title="${lead.email}">✉️</span>` : ''}
                        </div>
                        <div class="lead-company-sub">${lead.company || lead.publicId}</div>
                      </div>
                    </td>
                    <td>
                      <span style="font-weight:600; color:#1e293b; font-size:12px;">${lead.currentStepLabel}</span>
                    </td>
                    <td>
                      <span class="badge-status ${badgeClass}">${status.toUpperCase()}</span>
                    </td>
                    <td>
                      <span style="font-size:12px;">${countdown}</span>
                    </td>
                    <td>
                      ${lastResultHtml}
                    </td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      `;

      tableWrap.querySelectorAll('.btn-open-lead-timeline').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pid = btn.dataset.publicId;
          const found = filtered.find((l) => l.publicId === pid) || (cachedLiveData?.leads || []).find((l) => l.publicId === pid);
          openLeadTimelineModal({
            lead: found || null,
            publicId: pid,
            campaignId: drawerCampId,
            campaignName: cachedLiveData?.campaignName || '',
          });
        });
      });
    }

    container.querySelector('#btn-drawer-close')?.addEventListener('click', closeLiveLeadsDrawer);
    container.querySelector('#camp-live-drawer-backdrop')?.addEventListener('click', (e) => {
      if (e.target === container.querySelector('#camp-live-drawer-backdrop')) {
        closeLiveLeadsDrawer();
      }
    });

    container.querySelector('#btn-drawer-refresh')?.addEventListener('click', async () => {
      await fetchAndRenderDrawer();
      ctx.showToast?.('Refreshed live prospects status', 'info');
    });

    container.querySelector('#btn-drawer-tick')?.addEventListener('click', async () => {
      const btn = container.querySelector('#btn-drawer-tick');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `⚡ Running...`;
        try {
          await call(ACTIONS.CAMPAIGN_TICK, {});
          ctx.showToast?.('Step triggered! Refreshing live status...', 'success');
          await fetchAndRenderDrawer();
        } catch (err) {
          ctx.showToast?.(`Tick error: ${err.message}`, 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = `⚡ Run Step Now`;
        }
      }
    });

    const drawerSearch = container.querySelector('#input-drawer-search');
    if (drawerSearch) {
      drawerSearch.addEventListener('input', (e) => {
        drawerSearchQuery = e.target.value;
        if (cachedLiveData) renderFilteredLeadsTable(cachedLiveData.leads || []);
      });
    }

    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg?.type === 'EVENT' && (msg.event === 'campaign_step_done' || msg.event === 'campaign_live_update')) {
            if (drawerCampId && (!msg.payload?.campaignId || msg.payload.campaignId === drawerCampId)) {
              fetchAndRenderDrawer(true);
            }
          }
        });
      }

      const handleStorageChange = async () => {
        if (!container || !container.isConnected) {
          window.removeEventListener('outfox:storage-change', handleStorageChange);
          return;
        }
        if (drawerCampId) {
          fetchAndRenderDrawer(true);
        }
        if (viewState === 'list') {
          try {
            const res = await call(ACTIONS.CAMPAIGN_GET_ALL, {});
            if (res?.campaigns) {
              campaigns = res.campaigns;
              renderList();
            }
          } catch {
            /* ignore reload error */
          }
        }
      };
      window.addEventListener('outfox:storage-change', handleStorageChange);
    } catch {
      /* runtime message listener is best-effort */
    }
  }

  // =========================================================================
  // STATE B: 3-Step Campaign Creation Wizard (Frames 11–13)
  // =========================================================================
  function renderWizard() {
    const filterOptions = ['All', 'Custom', 'Gmail Only', 'Invitation', 'Message', 'Visit', 'Email', 'CRM Sync'];
    const filteredTemplates = activeFilter === 'All'
      ? CAMPAIGN_TEMPLATES
      : CAMPAIGN_TEMPLATES.filter((t) => t.tags.includes(activeFilter) || t.category === activeFilter);

    // Get prospect count for selected list
    const prospectCount = getSelectedListProspectCount();

    container.innerHTML = `
      <div class="wizard-full-view">
        <!-- Top Wizard Header with Breadcrumbs & Sender Badge -->
        <div class="wizard-top-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div class="wizard-head-left">
            <button type="button" class="btn-back-link" id="btn-cancel-wizard">
              ← Back to Campaigns
            </button>
            <h2 class="view-main-title">Create a Campaign</h2>
          </div>

          <div class="wizard-head-center">
            <div style="display: flex; align-items: center; gap: 6px; background: #fff7ed; border: 1px solid #ffedd5; padding: 6px 14px; border-radius: 20px; font-size: 12px; color: #ff6b00; font-weight: 700;">
              <span>📧 Outreach Sender:</span>
              <span style="font-weight: 600; color: #9a3412;">${activeSenderEmail || 'Google Workspace / Gmail'}</span>
            </div>
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
                      ${tpl.badge ? `<span style="background:#fff7ed; color:#ff6b00; border:1px solid #ffedd5; font-size:10.5px; font-weight:800; padding:2px 8px; border-radius:12px; margin-left:auto;">${tpl.badge}</span>` : ''}
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
                      Anti-detection pacing will distribute connection requests and emails safely within daily quotas.
                    </span>
                  `}
                </div>

                <!-- Vault Auto-enrichment toggle card -->
                <div style="display: flex; align-items: flex-start; justify-content: space-between; padding: 14px 16px; background: #fff7ed; border: 1px solid #ffedd5; border-radius: 12px; margin-top: 16px;">
                  <div style="display: flex; gap: 12px; align-items: flex-start;">
                    <span style="font-size: 20px; line-height: 1;">⚡</span>
                    <div>
                      <strong style="font-size: 13.5px; color: #9a3412; display: block; margin-bottom: 3px;">Auto-enrich missing emails via Vault</strong>
                      <span style="font-size: 12px; color: #c2410c; line-height: 1.4; display: block;">
                        If an enrolled prospect doesn't have an email address, OutFox will automatically waterfall-enrich them via Vault before sending email steps.
                      </span>
                    </div>
                  </div>
                  <label class="toggle-switch" style="flex-shrink: 0; margin-left: 12px; margin-top: 2px;">
                    <input type="checkbox" id="wizard-auto-enrich-toggle" ${autoEnrichMissingEmail !== false ? 'checked' : ''} />
                    <span class="slider"></span>
                  </label>
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

          <!-- STEP 3: SEQUENCE FLOW CANVAS & DYNAMIC STEP EDITOR -->
          ${
            wizardStep === 3
              ? `
            <div class="wizard-step-container">
              <div class="step-headline-group">
                <h3 class="step-title">Interactive Sequence Flow & Outreach Copy</h3>
                <p class="step-subtitle">Fully customize delays, delete steps (✕), or insert custom touchpoints (+). Click any step to edit its content.</p>
              </div>

              ${(() => {
                const firstAction = pipelineSteps.find((s) => s.type !== 'wait');
                if (firstAction && firstAction.type === 'message') {
                  return `
                    <div class="sequence-preflight-warning">
                      <span class="warning-icon">${ICONS.warning}</span>
                      <div class="warning-text">
                        <strong>Caution: Step 1 is Direct Message</strong>
                        <p>LinkedIn only allows direct messages to existing 1st-degree connections. If importing leads from LinkedIn Search, use a sequence starting with <strong>Invite (Connection Request)</strong> or <strong>Cold Email</strong>.</p>
                      </div>
                    </div>
                  `;
                }
                return '';
              })()}

              <!-- Horizontal Visual Node Flow Canvas -->
              <div class="waalaxy-card flow-canvas-card">
                <div class="canvas-header-label">HORIZONTAL VISUAL SEQUENCE PIPELINE (CLICK ANY STEP TO EDIT, OR [+] TO INSERT)</div>
                ${renderHorizontalFlow(pipelineSteps, prospectCount, true, activeStepIdx)}
              </div>

              <!-- Dynamic Step Content Editor -->
              ${(() => {
                if (pipelineSteps.length === 0) {
                  return `
                    <div class="waalaxy-card" style="margin-top: 20px; text-align: center; padding: 30px;">
                      <p style="color: var(--text-muted); font-size: 14px;">Your sequence has no action steps. Click <strong>[+]</strong> above to insert a step.</p>
                    </div>
                  `;
                }

                if (activeStepIdx >= pipelineSteps.length) {
                  activeStepIdx = Math.max(0, pipelineSteps.length - 1);
                }
                const curStep = pipelineSteps[activeStepIdx];

                if (curStep.type === 'email') {
                  return `
                    <div class="waalaxy-card message-editor-card" style="margin-top: 20px;">
                      <div class="editor-head" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 14px;">
                        <div class="editor-title-row" style="display: flex; align-items: center; gap: 10px;">
                          <span class="editor-icon" style="color: #ff6b00;">${ICONS.email}</span>
                          <div>
                            <span class="editor-title" style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${curStep.title || 'Cold Email'}</span>
                            <span style="font-size: 12px; color: var(--text-muted); display: block;">Step ${activeStepIdx + 1} of ${pipelineSteps.length} (Click any node above to edit that step)</span>
                          </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; background: #fff7ed; border: 1px solid #ffedd5; padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #ff6b00; font-weight: 600;">
                          <span>📧 Sender:</span>
                          <strong>${activeSenderEmail || 'Google Workspace / Gmail'}</strong>
                        </div>
                      </div>

                      <div class="form-group" style="margin-bottom: 14px;">
                        <label style="font-size: 12.5px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; display: flex; justify-content: space-between;">
                          <span>Subject Line</span>
                          <span style="font-size: 11.5px; color: var(--text-muted); font-weight: normal;">Supports {{variables}} & Spintax</span>
                        </label>
                        <input type="text" id="wizard-email-subject" class="form-input" value="${curStep.subject || ''}" placeholder="e.g. Quick question regarding {{company|your company}}" />
                      </div>

                      <div class="variable-chips-row" style="flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">
                        <span style="font-size: 11.5px; font-weight: 600; color: #64748b; margin-right: 4px;">Insert Tag:</span>
                        <button type="button" class="variable-chip" data-tag="{{firstName}}">+ {{firstName}}</button>
                        <button type="button" class="variable-chip" data-tag="{{lastName}}">+ {{lastName}}</button>
                        <button type="button" class="variable-chip" data-tag="{{fullName}}">+ {{fullName}}</button>
                        <button type="button" class="variable-chip" data-tag="{{company}}">+ {{company}}</button>
                        <button type="button" class="variable-chip" data-tag="{{jobTitle}}">+ {{jobTitle}}</button>
                        <button type="button" class="variable-chip" data-tag="{{headline}}">+ {{headline}}</button>
                        <button type="button" class="variable-chip" data-tag="{{email}}">+ {{email}}</button>
                        <button type="button" class="variable-chip" data-tag="{{ai_opener}}">+ {{ai_opener}} (AI)</button>
                      </div>

                      <div class="form-group" style="margin-bottom: 14px;">
                        <label style="font-size: 12.5px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; display: block;">
                          Email Body
                        </label>
                        <textarea id="wizard-email-body" class="form-input editor-textarea" rows="7" placeholder="Hi {{firstName|there}},&#10;&#10;...">${curStep.body || ''}</textarea>
                      </div>

                      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 14px; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                          <div>
                            <strong style="font-size: 13px; color: var(--text-primary); display: block;">Reply in same Gmail thread</strong>
                            <span style="font-size: 12px; color: var(--text-muted);">When enabled, this email is sent as a threaded follow-up reply in the prospect's existing Gmail conversation.</span>
                          </div>
                          <label class="toggle-switch">
                            <input type="checkbox" id="wizard-email-threading" ${curStep.replyInThread !== false ? 'checked' : ''} />
                            <span class="slider"></span>
                          </label>
                        </div>

                        <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                          <div>
                            <strong style="font-size: 13px; color: var(--text-primary); display: block;">${ICONS.sparkles} AI Personalized Opener ({{ai_opener}})</strong>
                            <span style="font-size: 12px; color: var(--text-muted);">Use Gemini / Groq to write a personalized opening line for each lead.</span>
                          </div>
                          <label class="toggle-switch">
                            <input type="checkbox" id="wizard-ai-toggle" ${useAiHook ? 'checked' : ''} />
                            <span class="slider"></span>
                          </label>
                        </div>
                      </div>

                      <div class="editor-foot-actions" style="margin-top: 20px;">
                        <button type="button" class="btn-pill btn-secondary" id="btn-step3-back">← Back</button>
                        <button type="button" class="btn-pill btn-primary btn-launch-big" id="btn-launch-campaign">
                          ${ICONS.rocket} Launch Campaign Now
                        </button>
                      </div>
                    </div>
                  `;
                }

                if (curStep.type === 'message') {
                  return `
                    <div class="waalaxy-card message-editor-card" style="margin-top: 20px;">
                      <div class="editor-head" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 14px;">
                        <div class="editor-title-row" style="display: flex; align-items: center; gap: 10px;">
                          <span class="editor-icon" style="color: #ff6b00;">${ICONS.message}</span>
                          <div>
                            <span class="editor-title" style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${curStep.title || 'LinkedIn Message'}</span>
                            <span style="font-size: 12px; color: var(--text-muted); display: block;">Step ${activeStepIdx + 1} of ${pipelineSteps.length} (Click any node above to edit that step)</span>
                          </div>
                        </div>
                      </div>

                      <div class="variable-chips-row" style="flex-wrap: wrap; gap: 6px; margin-bottom: 10px;">
                        <span style="font-size: 11.5px; font-weight: 600; color: #64748b; margin-right: 4px;">Insert Tag:</span>
                        <button type="button" class="variable-chip" data-tag="{{firstName}}">+ {{firstName}}</button>
                        <button type="button" class="variable-chip" data-tag="{{lastName}}">+ {{lastName}}</button>
                        <button type="button" class="variable-chip" data-tag="{{fullName}}">+ {{fullName}}</button>
                        <button type="button" class="variable-chip" data-tag="{{company}}">+ {{company}}</button>
                        <button type="button" class="variable-chip" data-tag="{{jobTitle}}">+ {{jobTitle}}</button>
                        <button type="button" class="variable-chip" data-tag="{{headline}}">+ {{headline}}</button>
                        <button type="button" class="variable-chip" data-tag="{{ai_opener}}">+ {{ai_opener}} (AI)</button>
                      </div>

                      <div class="form-group" style="margin-bottom: 14px;">
                        <label style="font-size: 12.5px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; display: block;">
                          Message Body
                        </label>
                        <textarea id="wizard-message-body" class="form-input editor-textarea" rows="5" placeholder="Hi {{firstName|there}},&#10;&#10;...">${curStep.body || ''}</textarea>
                      </div>

                      <div class="editor-foot-actions" style="margin-top: 20px;">
                        <button type="button" class="btn-pill btn-secondary" id="btn-step3-back">← Back</button>
                        <button type="button" class="btn-pill btn-primary btn-launch-big" id="btn-launch-campaign">
                          ${ICONS.rocket} Launch Campaign Now
                        </button>
                      </div>
                    </div>
                  `;
                }

                // Default / Invite step
                const noteValue = curStep.note !== undefined ? curStep.note : customNote;
                return `
                  <div class="waalaxy-card message-editor-card" style="margin-top: 20px;">
                    <div class="editor-head">
                      <div class="editor-title-row">
                        <span class="editor-icon">${ICONS.invitation}</span>
                        <span class="editor-title">Connection Request Note</span>
                      </div>
                      <span class="char-counter" id="note-char-counter">${noteValue.length} / 200</span>
                    </div>

                    <div class="variable-chips-row" style="flex-wrap: wrap; gap: 6px;">
                      <span style="font-size: 11.5px; font-weight: 600; color: #64748b; margin-right: 4px;">Insert Tag:</span>
                      <button type="button" class="variable-chip" data-tag="{{firstName}}">+ {{firstName}}</button>
                      <button type="button" class="variable-chip" data-tag="{{lastName}}">+ {{lastName}}</button>
                      <button type="button" class="variable-chip" data-tag="{{fullName}}">+ {{fullName}}</button>
                      <button type="button" class="variable-chip" data-tag="{{company}}">+ {{company}}</button>
                      <button type="button" class="variable-chip" data-tag="{{jobTitle}}">+ {{jobTitle}}</button>
                      <button type="button" class="variable-chip" data-tag="{{headline}}">+ {{headline}}</button>
                      <button type="button" class="variable-chip" data-tag="{{email}}">+ {{email}}</button>
                      <button type="button" class="variable-chip" data-tag="{{ai_opener}}">+ {{ai_opener}} (AI)</button>
                    </div>

                    <textarea id="wizard-note-textarea" class="form-input editor-textarea" rows="4" maxlength="200">${noteValue}</textarea>

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

                    <div class="editor-foot-actions">
                      <button type="button" class="btn-pill btn-secondary" id="btn-step3-back">← Back</button>
                      <button type="button" class="btn-pill btn-primary btn-launch-big" id="btn-launch-campaign">
                        ${ICONS.rocket} Launch Campaign Now
                      </button>
                    </div>
                  </div>
                `;
              })()}
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
          activeStepIdx = 0;
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

    container.querySelector('#wizard-auto-enrich-toggle')?.addEventListener('change', (e) => {
      autoEnrichMissingEmail = Boolean(e.target.checked);
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

      // Email Step Inputs
      container.querySelector('#wizard-email-subject')?.addEventListener('input', (e) => {
        if (pipelineSteps[activeStepIdx]) {
          pipelineSteps[activeStepIdx].subject = e.target.value;
        }
      });

      container.querySelector('#wizard-email-body')?.addEventListener('input', (e) => {
        if (pipelineSteps[activeStepIdx]) {
          pipelineSteps[activeStepIdx].body = e.target.value;
        }
      });

      container.querySelector('#wizard-email-threading')?.addEventListener('change', (e) => {
        if (pipelineSteps[activeStepIdx]) {
          pipelineSteps[activeStepIdx].replyInThread = Boolean(e.target.checked);
        }
      });

      // Message Step Inputs
      container.querySelector('#wizard-message-body')?.addEventListener('input', (e) => {
        if (pipelineSteps[activeStepIdx]) {
          pipelineSteps[activeStepIdx].body = e.target.value;
        }
      });

      // Invite Step Inputs
      const textarea = container.querySelector('#wizard-note-textarea');
      const counter = container.querySelector('#note-char-counter');

      textarea?.addEventListener('input', () => {
        customNote = textarea.value;
        const inviteStep = pipelineSteps.find((s) => s.type === 'invite');
        if (inviteStep) inviteStep.note = customNote;
        if (pipelineSteps[activeStepIdx] && pipelineSteps[activeStepIdx].type === 'invite') {
          pipelineSteps[activeStepIdx].note = customNote;
        }

        if (counter) {
          counter.textContent = `${textarea.value.length} / 200`;
          counter.classList.toggle('is-warning', textarea.value.length > 180);
        }
      });

      // Variable insertion chips
      container.querySelectorAll('.variable-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          const tag = chip.dataset.tag;
          const target =
            container.querySelector('#wizard-email-body') ||
            container.querySelector('#wizard-note-textarea') ||
            container.querySelector('#wizard-message-body');
          if (target && tag) {
            const start = target.selectionStart || target.value.length;
            const end = target.selectionEnd || target.value.length;
            target.value = target.value.substring(0, start) + tag + target.value.substring(end);
            if (pipelineSteps[activeStepIdx]) {
              if (pipelineSteps[activeStepIdx].type === 'email') pipelineSteps[activeStepIdx].body = target.value;
              else if (pipelineSteps[activeStepIdx].type === 'invite') {
                customNote = target.value;
                pipelineSteps[activeStepIdx].note = target.value;
              } else if (pipelineSteps[activeStepIdx].type === 'message') pipelineSteps[activeStepIdx].body = target.value;
            }
            target.focus();
            target.selectionStart = target.selectionEnd = start + tag.length;
            if (counter) {
              counter.textContent = `${target.value.length} / 200`;
              counter.classList.toggle('is-warning', target.value.length > 180);
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
            autoEnrichMissingEmail: Boolean(autoEnrichMissingEmail),
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
  // Canvas Interactive Event Handlers (Delete, Insert, Delay Picker, Select)
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
        canvasInner.outerHTML = renderHorizontalFlow(pipelineSteps, getSelectedListProspectCount(), true, activeStepIdx);
        setupFlowCanvasEvents();
      }
    }

    // Node Selection Click (Click node to open its editor drawer)
    canvasCard.querySelectorAll('.flow-node-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-node') || e.target.closest('.btn-insert-node')) return;
        const sIdx = parseInt(card.dataset.stepIdx, 10);
        if (!isNaN(sIdx) && sIdx >= 0 && sIdx < pipelineSteps.length) {
          activeStepIdx = sIdx;
          renderWizard();
        }
      });
    });

    // Step Deletion (✕ Button)
    canvasCard.querySelectorAll('.btn-delete-node').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeAnyPopover();
        const deleteIdx = parseInt(btn.dataset.deleteIdx, 10);
        if (!isNaN(deleteIdx) && deleteIdx >= 0 && deleteIdx < pipelineSteps.length) {
          pipelineSteps.splice(deleteIdx, 1);
          if (activeStepIdx >= pipelineSteps.length) {
            activeStepIdx = Math.max(0, pipelineSteps.length - 1);
          }
          renderWizard();
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
              activeStepIdx = insertIdx;
              renderWizard();
            }
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
