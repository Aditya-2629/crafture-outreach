/**
 * Crafture Network — Authentic Crafture Network Campaigns View & 3-Step Wizard
 * Video Frames 11–17: Template Gallery, 3-Step Creator Wizard, Horizontal Flow Canvas, and Message Editor.
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { allProfiles } from '../lib/storage.js';
import { openUiConfirm, openUiAlert, openUiSelectModal, openLeadTimelineModal } from './modal-engine.js';
import { ICONS } from '../ui/icons.js';
import { getConfig } from '../lib/config.js';
import { renderTemplate, resolveSpintax } from '../lib/template.js';
import { isStorageChangeRelevant, captureInputFocus, restoreInputFocus } from './dashboard.js';

const CAMPAIGNS_RELEVANT_KEYS = new Set(['campaigns', 'lists', 'quotas', 'crafture_quotas', 'enrollments']);

// Pre-built Crafture Network Campaign Templates (From Video Frame 11)
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
        body: "Hi {{firstName|there}},\n\nSaw what you're building at {{company|your team}} and wanted to reach out.\n\n{{ai_opener|We help teams streamline outreach and automate pipeline growth.}}\n\nDo you have 5 minutes this week for a brief chat?\n\nBest,\n{{senderName}}",
        replyInThread: false,
      },
      { type: 'wait', waitMs: 259200000, delayLabel: 'Wait 3 days' },
      {
        type: 'email',
        subject: 'Re: Quick question regarding {{company|your company}}',
        body: "Hi {{firstName|there}},\n\nJust bumping this in case it got buried under your inbox. Would love to share how similar teams are handling outreach this quarter.\n\nLet me know if Tuesday or Thursday works better for you.\n\nBest,\n{{senderName}}",
        replyInThread: true,
      },
      { type: 'wait', waitMs: 345600000, delayLabel: 'Wait 4 days' },
      {
        type: 'email',
        subject: 'Re: Quick question regarding {{company|your company}}',
        body: "Hi {{firstName|there}},\n\nI realize you're super busy, so I'll stop following up here. If timing ever aligns down the road, feel free to reach back out.\n\nWishing you and {{company|your team}} all the best!\n\nBest,\n{{senderName}}",
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
        body: "Hi {{firstName|there}},\n\nI came across your profile and was impressed by your experience in {{headline|your domain}}.\n\nWe are currently sourcing key talent and thought your background would be an incredible fit for an upcoming leadership role.\n\nWould you be open to an exploratory 10-minute conversation this week?\n\nBest regards,\n{{senderName}}",
        replyInThread: false,
      },
      { type: 'wait', waitMs: 259200000, delayLabel: 'Wait 3 days' },
      {
        type: 'email',
        subject: 'Re: Exciting role opportunity for {{firstName|there}}',
        body: "Hi {{firstName|there}},\n\nWanted to make sure you saw my note above. We're moving quickly to final rounds and I'd love to get your thoughts before closing the candidate pipeline.\n\nLet me know if you're available for a quick chat!\n\nBest,\n{{senderName}}",
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
        body: "Hi {{firstName|there}},\n\n{{ai_opener|Wanted to connect regarding {{company|your company}}.}}\n\nBest,\n{{senderName}}",
        replyInThread: false,
      },
    ],
  },
  {
    id: 'social_warmup',
    title: 'Social Warmup + Connect',
    badge: 'High Acceptance (45%+)',
    category: 'Invitation',
    tags: ['Invitation', 'Visit', 'Social Warmup'],
    flowText: '[Profile Visit] → [Like Post] → [Follow] → [Wait 1 Day] → [Invite + Spintax] → [Follow-up Message]',
    bestFor: 'Pre-warms leads with subtle profile visits, post likes, and follows before inviting to achieve 45%+ connection rates.',
    icon: ICONS.flame,
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
              body: 'Hi {{firstName|there}},\n\nI sent you a quick connection request on LinkedIn earlier. Wanted to follow up directly to see if you had 5 minutes this week to chat?\n\nBest,\n{{senderName}}',
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
  { ms: 900000, label: '15 minutes', badge: '15m' },
  { ms: 3600000, label: '1 hour', badge: '1h' },
  { ms: 86400000, label: '1 day (24h)', badge: '1d' },
  { ms: 172800000, label: '2 days', badge: '2d' },
  { ms: 259200000, label: '3 days', badge: '3d' },
];

// Available step templates for [+] step insertion
export const INSERT_STEP_OPTIONS = [
  { type: 'view', title: 'View Profile', sub: 'Warm Touch', icon: ICONS.visit, delayMs: 0 },
  { type: 'follow', title: 'Follow Profile', sub: 'Warm Touch', icon: ICONS.user, delayMs: 0 },
  { type: 'like', title: 'Like Post', sub: 'Warm Touch', icon: ICONS.lightning, delayMs: 0 },
  { type: 'endorse', title: 'Endorse Skill', sub: 'Auto-Warmup', icon: ICONS.sparkles, delayMs: 0 },
  { type: 'invite', title: 'Send Invite', sub: 'Connection Request', icon: ICONS.invitation, delayMs: 86400000, note: 'Hi {{firstName|there}} — would love to connect!' },
  { type: 'message', title: 'LinkedIn Message', sub: 'Direct Message', icon: ICONS.message, delayMs: 172800000, body: 'Thanks for connecting, {{firstName|there}}! What is taking up most of your focus this quarter?' },
  { type: 'email', title: 'Cold Email', sub: 'Direct Email', icon: ICONS.email, delayMs: 172800000, subject: 'Quick question for {{firstName|there}}', body: 'Hi {{firstName|there}},\n\nWanted to follow up directly to see if you had 5 minutes this week to chat?\n\nBest,\n{{senderName}}' },
  { type: 'wait', title: 'Delay Timer', sub: 'Wait Period', icon: ICONS.clock, delayMs: 86400000 },
];

export function formatDelayBadge(ms) {
  if (!ms || ms <= 0) return 'Immediate';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  const days = Math.round(ms / 86400000);
  return `${days}d`;
}

export function templateToPipeline(tpl) {
  if (!tpl || tpl.id === 'custom') return [];
  if (tpl.id === 'gmail_drip') {
    return [
      { id: 'p_1', type: 'email', title: 'Cold Intro Email', sub: 'Step 1', icon: ICONS.email, delayMs: 0, subject: 'Quick question regarding {{company|your company}}', body: "Hi {{firstName|there}},\n\nSaw what you're building at {{company|your team}} and wanted to reach out.\n\n{{ai_opener|We help teams streamline outreach and automate pipeline growth.}}\n\nDo you have 5 minutes this week for a brief chat?\n\nBest,\n{{senderName}}", replyInThread: false },
      { id: 'p_2', type: 'email', title: 'Follow-up Email', sub: 'Threaded Follow-up', icon: ICONS.email, delayMs: 259200000, subject: 'Re: Quick question regarding {{company|your company}}', body: "Hi {{firstName|there}},\n\nJust bumping this in case it got buried under your inbox. Would love to share how similar teams are handling outreach this quarter.\n\nLet me know if Tuesday or Thursday works better for you.\n\nBest,\n{{senderName}}", replyInThread: true },
      { id: 'p_3', type: 'email', title: 'Break-up Email', sub: 'Final Check-in', icon: ICONS.email, delayMs: 345600000, subject: 'Re: Quick question regarding {{company|your company}}', body: "Hi {{firstName|there}},\n\nI realize you're super busy, so I'll stop following up here. If timing ever aligns down the road, feel free to reach back out.\n\nWishing you and {{company|your team}} all the best!\n\nBest,\n{{senderName}}", replyInThread: true },
    ];
  }
  if (tpl.id === 'gmail_recruiter') {
    return [
      { id: 'p_1', type: 'email', title: 'Role Opportunity Pitch', sub: 'Step 1', icon: ICONS.email, delayMs: 0, subject: 'Exciting role opportunity for {{firstName|there}} at high-growth venture', body: "Hi {{firstName|there}},\n\nI came across your profile and was impressed by your experience in {{headline|your domain}}.\n\nWe are currently sourcing key talent and thought your background would be an incredible fit for an upcoming leadership role.\n\nWould you be open to an exploratory 10-minute conversation this week?\n\nBest regards,\n{{senderName}}", replyInThread: false },
      { id: 'p_2', type: 'email', title: 'Role Follow-up', sub: 'Threaded Follow-up', icon: ICONS.email, delayMs: 259200000, subject: 'Re: Exciting role opportunity for {{firstName|there}}', body: "Hi {{firstName|there}},\n\nWanted to make sure you saw my note above. We're moving quickly to final rounds and I'd love to get your thoughts before closing the candidate pipeline.\n\nLet me know if you're available for a quick chat!\n\nBest,\n{{senderName}}", replyInThread: true },
    ];
  }
  if (tpl.id === 'gmail_blank') {
    return [
      { id: 'p_1', type: 'email', title: 'Cold Email', sub: 'Step 1', icon: ICONS.email, delayMs: 0, subject: 'Hi {{firstName|there}}', body: "Hi {{firstName|there}},\n\n{{ai_opener|Wanted to connect regarding {{company|your company}}.}}\n\nBest,\n{{senderName}}", replyInThread: false },
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
      { id: 'p_4', type: 'email', title: 'Cold Email', sub: 'If Not Accepted', icon: ICONS.email, delayMs: 172800000, subject: 'Quick question for {{firstName|there}} regarding {{company|your team}}', body: 'Hi {{firstName|there}},\n\nI sent you a quick connection request on LinkedIn earlier. Wanted to follow up directly to see if you had 5 minutes this week to chat?\n\nBest,\n{{senderName}}' },
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
        id: s.id || 's_' + Math.random().toString(36).substr(2, 6),
        delayMs: pendingDelay,
        note: s.note,
        body: s.body,
        subject: s.subject,
        useAi: s.useAi,
        abEnabled: Boolean(s.abEnabled),
        variants: s.variants || null,
        winningVariant: s.winningVariant || null,
      });
      pendingDelay = 0;
    }
  }

  processStepList(steps);
  return result;
}

export function ensureStepVariants(step, fallbackNote = '') {
  if (!step) return;
  if (!Array.isArray(step.variants) || step.variants.length < 2) {
    const baseNote = step.note !== undefined ? step.note : fallbackNote;
    const baseBody = step.body || '';
    const baseSub = step.subject || '';
    step.variants = [
      { id: 'A', note: baseNote, body: baseBody, subject: baseSub },
      { id: 'B', note: baseNote, body: baseBody, subject: baseSub },
    ];
  }
  if (!step._activeVariant) {
    step._activeVariant = 'A';
  }
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
      else if (step.type === 'follow') steps.push({ type: 'follow' });
      else if (step.type === 'like') steps.push({ type: 'like' });
      else if (step.type === 'endorse') steps.push({ type: 'endorse' });
      else if (step.type === 'message') {
        const item = { type: 'message', id: step.id, body: step.body || 'Hi {{firstName|there}}!' };
        if (step.abEnabled) {
          item.abEnabled = true;
          item.variants = step.variants;
          if (step.winningVariant) item.winningVariant = step.winningVariant;
        }
        steps.push(item);
      } else if (step.type === 'inmail') {
        const item = {
          type: 'inmail',
          id: step.id,
          subject: step.subject || 'Introduction',
          body: step.body || 'Hi {{firstName|there}}!',
        };
        if (step.abEnabled) {
          item.abEnabled = true;
          item.variants = step.variants;
          if (step.winningVariant) item.winningVariant = step.winningVariant;
        }
        steps.push(item);
      } else if (step.type === 'email') {
        const item = {
          type: 'email',
          id: step.id,
          subject: step.subject || 'Quick question',
          body: step.body || 'Hi {{firstName|there}}...',
          replyInThread: step.replyInThread !== false,
          useAi: step.useAi ?? useAi,
        };
        if (step.abEnabled) {
          item.abEnabled = true;
          item.variants = step.variants;
          if (step.winningVariant) item.winningVariant = step.winningVariant;
        }
        steps.push(item);
      } else if (step.type === 'wait') {
        steps.push({ type: 'wait', waitMs: step.delayMs || 86400000 });
      }
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
    } else if (step.type === 'follow') {
      steps.push({ type: 'follow' });
    } else if (step.type === 'like') {
      steps.push({ type: 'like' });
    } else if (step.type === 'endorse') {
      steps.push({ type: 'endorse' });
    } else if (step.type === 'invite') {
      if (step.sendBlank) {
        steps.push({
          type: 'invite',
          id: step.id,
          note: '',
          sendBlank: true,
          useAi: false,
        });
      } else {
        let finalNote = customNote || step.note || 'Hi {{firstName|there}} — would love to connect!';
        if (useAi) {
          if (!finalNote.includes('{{ai_opener}}')) {
            finalNote = `${finalNote} {{ai_opener}}`.trim();
          }
        }
        const item = {
          type: 'invite',
          id: step.id,
          note: finalNote,
          useAi: Boolean(useAi),
        };
        if (step.abEnabled) {
          item.abEnabled = true;
          item.variants = step.variants;
          if (step.winningVariant) item.winningVariant = step.winningVariant;
        }
        steps.push(item);
      }
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
    const item = {
      type: 'message',
      id: messageStep.id,
      body: messageStep.body || 'Thanks for connecting, {{firstName|there}}! What is taking up most of your focus this quarter?',
    };
    if (messageStep.abEnabled) {
      item.abEnabled = true;
      item.variants = messageStep.variants;
      if (messageStep.winningVariant) item.winningVariant = messageStep.winningVariant;
    }
    thenBranch.push(item);
    thenBranch.push({ type: 'crm_sync' });
  }

  if (emailStep) {
    if (emailStep.delayMs && emailStep.delayMs > 0) {
      elseBranch.push({ type: 'wait', waitMs: emailStep.delayMs, delayLabel: formatDelayBadge(emailStep.delayMs) });
    }
    const item = {
      type: 'email',
      id: emailStep.id,
      subject: emailStep.subject || 'Quick question for {{firstName|there}} regarding {{company|your team}}',
      body: emailStep.body || 'Hi {{firstName|there}},\n\nI sent you a quick connection request on LinkedIn earlier. Wanted to follow up directly to see if you had 5 minutes this week to chat?\n\nBest,\n{{senderName}}',
      replyInThread: emailStep.replyInThread !== false,
      useAi: emailStep.useAi ?? useAi,
    };
    if (emailStep.abEnabled) {
      item.abEnabled = true;
      item.variants = emailStep.variants;
      if (emailStep.winningVariant) item.winningVariant = emailStep.winningVariant;
    }
    elseBranch.push(item);
    elseBranch.push({ type: 'crm_sync' });
  }

  for (const s of otherPostSteps) {
    if (s.delayMs && s.delayMs > 0) {
      thenBranch.push({ type: 'wait', waitMs: s.delayMs, delayLabel: formatDelayBadge(s.delayMs) });
    }
    if (s.type === 'view') thenBranch.push({ type: 'view' });
    else if (s.type === 'follow') thenBranch.push({ type: 'follow' });
    else if (s.type === 'like') thenBranch.push({ type: 'like' });
    else if (s.type === 'endorse') thenBranch.push({ type: 'endorse' });
    else {
      const item = { type: s.type, id: s.id, note: s.note, body: s.body, subject: s.subject };
      if (s.abEnabled) {
        item.abEnabled = true;
        item.variants = s.variants;
        if (s.winningVariant) item.winningVariant = s.winningVariant;
      }
      thenBranch.push(item);
    }
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
  let hasInvite = false;
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
    const isFollowupAfterInvite = hasInvite && (step.type === 'message' || step.type === 'email');
    if (step.type === 'invite') hasInvite = true;

    html += `
      <div class="node-connector">
        ${isFollowupAfterInvite ? `
          <div class="flow-condition-pill" title="Crafture auto-parks messages until invite is accepted">
            ${ICONS.clock} On Invite → Wait for Acceptance (auto-parks 12h)
          </div>
        ` : ''}
        ${isInteractive ? `
          <button type="button" class="delay-select-pill btn-delay-dropdown" data-connector-idx="${idx}" title="Change delay before this step">
            <span>${formatDelayBadge(step.delayMs)}</span>
            <span style="display: inline-flex; align-items: center; margin-left: 3px; opacity: 0.6;">${ICONS.chevronDown}</span>
          </button>
        ` : `
          <div class="delay-pill-badge">${formatDelayBadge(step.delayMs)}</div>
        `}
        <div class="connector-arrow-line" style="position: relative; width: 100%; display: flex; align-items: center; justify-content: center;">
          →
          ${isInteractive ? `<button type="button" class="btn-insert-node" data-insert-idx="${idx}" title="Insert Step">+</button>` : ''}
        </div>
      </div>
      <div class="flow-node-item">
        <div class="flow-node-card ${idx === activeStepIdx ? 'is-active-step' : ''}" data-step-idx="${idx}" style="${isInteractive ? 'cursor: pointer;' : ''} ${idx === activeStepIdx ? 'border-color: #104B35; box-shadow: 0 0 0 2px rgba(16, 75, 53, 0.22);' : ''}">
          ${isInteractive ? `<button type="button" class="btn-delete-node" data-delete-idx="${idx}" title="Remove Step">${ICONS.x}</button>` : ''}
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
        <div class="delay-pill-badge">Immediate</div>
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

export function renderMiniStepFlow(steps = []) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return '<span class="step-flow-pill">Custom Flow</span>';
  }
  const STEP_NAMES = {
    view: 'Visit',
    follow: 'Follow',
    like: 'Like',
    endorse: 'Endorse',
    invite: 'Invite',
    message: 'Message',
    email: 'Email',
    crm_sync: 'CRM',
  };
  const activeSteps = steps
    .filter((s) => s.type && s.type !== 'wait' && s.type !== 'branch')
    .map((s) => STEP_NAMES[s.type] || s.type);

  if (activeSteps.length === 0) {
    return '<span class="step-flow-pill">Outreach Flow</span>';
  }

  return activeSteps
    .map((name) => `<span class="step-flow-pill">${name}</span>`)
    .join('<span class="step-flow-arrow">→</span>');
}

export function computeCampaignStats(camp = {}, allStorage = {}, now = Date.now()) {
  const id = camp.campaignId || camp.id;
  const storageEnrollments = allStorage[`enrollments:${id}`];
  const enrollments = Array.isArray(storageEnrollments)
    ? storageEnrollments
    : Array.isArray(camp.contacts)
    ? camp.contacts
    : Array.isArray(camp.enrollments)
    ? camp.enrollments
    : [];

  const actions = Array.isArray(allStorage.actions) ? allStorage.actions : [];
  const events = Array.isArray(allStorage.events) ? allStorage.events : [];

  const totalSteps = camp.steps?.length || 0;
  const totalLeads = enrollments.length || (camp.stats?.enrolled ?? camp.leadsCount ?? camp.stats?.total ?? 0);

  let completedOrReplied = 0;
  let activeCount = 0;
  let waitingCount = 0;
  let dueCount = 0;
  let accepted = 0;
  let replied = 0;
  const nextRunTimestamps = [];

  enrollments.forEach((e) => {
    const isCompleted = e.status === 'completed' || (Boolean(e.accepted) && (e.stepIndex || 0) >= totalSteps && totalSteps > 0);
    const isReplied = e.status === 'replied' || Boolean(e.replied);
    const isStopped = e.status === 'stopped' || e.status === 'failed' || e.status === 'blocked_not_connected';

    if (e.accepted) accepted += 1;
    if (isReplied) replied += 1;

    if (isCompleted || isReplied || isStopped) {
      completedOrReplied += 1;
    } else if (e.status === 'active' || !e.status) {
      activeCount += 1;
      const nextAt = e.nextAt || 0;
      const isWaitingForTimer = nextAt > now;
      const isWaitingForAcceptance = !e.accepted && (e.stepIndex || 0) > 0;

      if (isWaitingForTimer) {
        waitingCount += 1;
        nextRunTimestamps.push(nextAt);
      } else if (isWaitingForAcceptance) {
        waitingCount += 1;
      } else {
        dueCount += 1;
      }
    }
  });

  // Calculate invites sent from enrollments, actions, or stats
  const actionInvites = actions.filter((a) => a.campaignId === id && a.action === 'outreach.invite' && a.result?.status === 'sent').length;
  const enrollmentInvites = enrollments.filter((e) => e.accepted || e.invited || (e.stepIndex || 0) > 0 || (camp.steps?.[0]?.type === 'invite' && (e.lastActionAt || e.status === 'completed' || e.status === 'replied'))).length;
  const invitesSent = Math.max(enrollmentInvites, actionInvites, camp.stats?.invitesSent ?? 0);

  // Fallback stats if enrollments was empty but camp.stats has data
  if (enrollments.length === 0 && camp.stats) {
    if (camp.stats.accepted) accepted = camp.stats.accepted;
    if (camp.stats.replied) replied = camp.stats.replied;
    if (camp.stats.completed) completedOrReplied = camp.stats.completed;
  }

  const acceptancePct = invitesSent > 0 ? Math.min(100, Math.round((accepted / invitesSent) * 100)) : 0;
  const replyPct = invitesSent > 0 ? Math.min(100, Math.round((replied / invitesSent) * 100)) : (accepted > 0 ? Math.min(100, Math.round((replied / accepted) * 100)) : 0);
  const progressPct = totalLeads > 0 ? Math.min(100, Math.round((completedOrReplied / totalLeads) * 100)) : (camp.status === 'completed' ? 100 : 0);

  // Lifecycle determination
  const isCompleted = (totalLeads > 0 && activeCount === 0) || camp.status === 'completed';
  const isPaused = camp.status === 'paused';
  const isDraft = camp.status === 'draft';
  const isArchived = camp.status === 'archived';

  let lifecycleKey = 'running';
  let badgeHtml = '';

  if (isCompleted) {
    lifecycleKey = 'completed';
    badgeHtml = `<span class="camp-lifecycle-badge badge-completed">${ICONS.check} Completed</span>`;
  } else if (isPaused) {
    lifecycleKey = 'paused';
    badgeHtml = `<span class="camp-lifecycle-badge badge-paused">${ICONS.pause} Paused</span>`;
  } else if (isDraft) {
    lifecycleKey = 'draft';
    badgeHtml = `<span class="camp-lifecycle-badge badge-draft">${ICONS.edit} Draft</span>`;
  } else if (isArchived) {
    lifecycleKey = 'archived';
    badgeHtml = `<span class="camp-lifecycle-badge badge-archived">${ICONS.archive} Archived</span>`;
  } else if (dueCount === 0 && waitingCount > 0) {
    lifecycleKey = 'waiting';
    let waitingLabel = 'Waiting for invite acceptance';
    if (nextRunTimestamps.length > 0) {
      const minNextAt = Math.min(...nextRunTimestamps);
      const diffMins = Math.max(1, Math.round((minNextAt - now) / 60000));
      if (diffMins >= 60) {
        const diffHours = Math.round(diffMins / 60);
        waitingLabel = `Waiting (next in ${diffHours}h)`;
      } else {
        waitingLabel = `Waiting (next in ${diffMins}m)`;
      }
    }
    badgeHtml = `<span class="camp-lifecycle-badge badge-waiting">${ICONS.clock} ${waitingLabel}</span>`;
  } else {
    lifecycleKey = 'running';
    badgeHtml = `<span class="camp-lifecycle-badge badge-running"><span class="live-dot-circle" style="background:#10b981; width:7px; height:7px; border-radius:50%; display:inline-block;"></span> Running</span>`;
  }

  return {
    totalLeads,
    completedOrReplied,
    activeCount,
    waitingCount,
    dueCount,
    invitesSent,
    accepted,
    replied,
    acceptancePct,
    replyPct,
    progressPct,
    isCompleted,
    lifecycleKey,
    badgeHtml,
  };
}

/**
 * Computes live Auto-Pilot state for Campaigns:
 * - Active & Due: "Auto-Pilot Active · Next action in <Xm Ys>" (or "Auto-Pilot Active · Processing now...")
 * - Resting / Outside hours: "Auto-Pilot Resting · Resumes at <HH:MM>"
 * - No active campaigns: "Auto-Pilot Idle"
 */
export function computeAutoPilotStatus(campaigns = [], allStorage = {}, config = {}, alarmRes = null, now = Date.now()) {
  const activeCampaigns = (campaigns || []).filter((c) => c.status === 'active');
  if (activeCampaigns.length === 0) {
    return {
      state: 'idle',
      text: 'Auto-Pilot Idle',
      dotClass: 'dot-idle',
      pillClass: 'pill-autopilot-idle',
      targetTime: null,
    };
  }

  // Check resting / cooldown / outside schedule
  const cooldowns = allStorage.crafture_bucket_cooldowns || allStorage.outfox_bucket_cooldowns || {};
  const buckets = ['invite', 'view', 'message', 'email'];
  const resting = [];
  for (const b of buckets) {
    const until = cooldowns[b] || (b === 'view' ? cooldowns.visit : 0) || 0;
    if (until > now) {
      resting.push({ bucket: b, until, diffMs: until - now });
    }
  }

  if (resting.length > 0) {
    resting.sort((a, b) => b.diffMs - a.diffMs);
    const top = resting[0];
    const resumeTimeStr = new Date(top.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return {
      state: 'resting',
      text: `Auto-Pilot Resting · Resumes at ${resumeTimeStr}`,
      dotClass: 'dot-resting',
      pillClass: 'pill-autopilot-resting',
      targetTime: top.until,
    };
  }

  // Find due and upcoming enrollments across active campaigns
  let minUpcoming = null;
  let hasDue = false;

  for (const camp of activeCampaigns) {
    const enrollments = allStorage[`enrollments:${camp.campaignId}`] || [];
    for (const e of enrollments) {
      const st = e.status || e.state || 'active';
      if (st === 'active' || st === 'running') {
        const nextAt = e.nextAt || 0;
        if (nextAt <= now) {
          hasDue = true;
        } else {
          if (minUpcoming === null || nextAt < minUpcoming) {
            minUpcoming = nextAt;
          }
        }
      }
    }
  }

  if (hasDue) {
    return {
      state: 'due',
      text: 'Auto-Pilot Active · Processing now...',
      dotClass: 'dot-active animated',
      pillClass: 'pill-autopilot-active',
      targetTime: now,
    };
  }

  const alarmTime = alarmRes?.scheduledTime;
  let targetTime = minUpcoming;
  if (alarmTime && alarmTime > now) {
    targetTime = targetTime ? Math.min(targetTime, alarmTime) : alarmTime;
  }

  if (targetTime && targetTime > now) {
    const diffSec = Math.max(1, Math.round((targetTime - now) / 1000));
    const m = Math.floor(diffSec / 60);
    const s = diffSec % 60;
    const timeText = m > 0 ? `${m}m ${s < 10 ? '0' : ''}${s}s` : `${s}s`;
    return {
      state: 'upcoming',
      text: `Auto-Pilot Active · Next action in ${timeText}`,
      dotClass: 'dot-active animated',
      pillClass: 'pill-autopilot-active',
      targetTime,
    };
  }

  return {
    state: 'active',
    text: 'Auto-Pilot Active · Monitoring leads',
    dotClass: 'dot-active',
    pillClass: 'pill-autopilot-active',
    targetTime: null,
  };
}


function ensureCampaignsStyles() {
  const STYLE_ID = 'cn-campaigns-view-css';
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .campaigns-view-shell { max-width: 1200px; margin: 0 auto; overflow-x: hidden; }
    .campaigns-top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .camp-tabs-and-search-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; gap: 16px; }
    .camp-state-tabs-bar { display: flex; gap: 8px; background: #f1f5f9; padding: 4px; border-radius: 12px; }
    .camp-state-tab { background: transparent; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.15s; }
    .camp-state-tab.is-active { background: #ffffff; color: #14142b; font-weight: 700; box-shadow: 0 2px 6px rgba(0,0,0,0.04); }
    .tab-count-badge { background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 9999px; }
    .camp-search-wrap { position: relative; display: flex; align-items: center; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 0 12px; width: 220px; }
    .camp-search-wrap input { border: none; outline: none; font-size: 13px; padding: 8px 6px; width: 100%; background: transparent; }
    .cn-camp-grid { display: flex; flex-direction: column; gap: 16px; }
    .cn-camp-card {
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 12px;
      padding: 20px;
      position: relative;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 20px;
    }
    .cn-camp-card:has:has(.camp-3dots-menu.is-open),
    .cn-camp-card.has-open-menu.has-open-menu {
      z-index: 100 !important;
      position: relative;
    }
    .cn-camp-card:hover:hover {
      border-color: rgba(15, 23, 42, 0.16);
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
    }
    .camp-overview-pills-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .camp-stat-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: #ffffff;
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 8px;
      font-size: 12px;
      color: #64748b;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .camp-stat-pill strong {
      color: #0f172a;
      font-weight: 700;
    }
    .camp-row-left {
      display: flex;
      align-items: center;
      gap: 16px;
      flex: 1.2;
      min-width: 270px;
    }
    .camp-name-badge-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .camp-flow-summary-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .step-flow-pill {
      font-size: 11px;
      font-weight: 600;
      color: #475569;
      background: #f1f5f9;
      padding: 2px 8px;
      border-radius: 6px;
    }
    .step-flow-arrow {
      color: #cbd5e1;
      font-size: 11px;
    }
    .camp-row-middle {
      flex: 1.5;
      min-width: 280px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .camp-progress-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: #64748b;
    }
    .camp-progress-title strong {
      color: #0f172a;
    }
    .camp-progress-pct {
      font-weight: 700;
      color: #0f172a;
      font-variant-numeric: tabular-nums;
    }
    .camp-progress-track {
      width: 100%;
      height: 7px;
      background: #f1f5f9;
      border-radius: 9999px;
      overflow: hidden;
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.06);
    }
    .camp-progress-fill {
      height: 100%;
      border-radius: 9999px;
      background: #104B35;
      transition: width 0.3s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .camp-progress-fill.is-complete {
      background: #10b981;
    }
    .camp-mini-kpis {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .mini-kpi-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .mini-kpi-item .kpi-label {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .mini-kpi-item .kpi-val {
      font-size: 12.5px;
      color: #0f172a;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .mini-kpi-item .kpi-sub {
      font-size: 11px;
      color: #64748b;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    .camp-row-right {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-shrink: 0;
      min-width: 250px;
    }
    .btn-camp-pause-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 10px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      background: #f8fafc;
      color: #475569;
      border: 1px solid #e2e8f0;
      transition: all 0.18s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .btn-camp-pause-toggle:hover {
      background: #f1f5f9;
      color: #0f172a;
    }
    .btn-camp-pause-toggle.is-paused {
      background: #ecfdf5;
      color: #059669;
      border-color: #a7f3d0;
    }
    .btn-camp-pause-toggle.is-paused:hover {
      background: #d1fae5;
    }
    .btn-camp-pause-toggle.is-completed {
      background: #f8fafc;
      color: #94a3b8;
      border-color: #e2e8f0;
      cursor: default;
    }
    .btn-camp-card-live {
      background: #E6EFE9;
      color: #104B35;
      border: 1px solid #DCE5DE;
      font-size: 12.5px;
      font-weight: 700;
      padding: 8px 14px;
      border-radius: 10px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.18s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .btn-camp-card-live:hover {
      background: #DCE5DE;
      color: #e05a00;
      transform: translateY(-1px);
    }
    .camp-lifecycle-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 9999px;
      white-space: nowrap;
    }
    .camp-lifecycle-badge.badge-running {
      background: #ecfdf5;
      color: #059669;
      border: 1px solid #a7f3d0;
    }
    .camp-lifecycle-badge.badge-waiting {
      background: #fffbeb;
      color: #b45309;
      border: 1px solid #fde68a;
    }
    .camp-lifecycle-badge.badge-completed {
      background: #eef2ff;
      color: #4f46e5;
      border: 1px solid #c7d2fe;
    }
    .camp-lifecycle-badge.badge-paused {
      background: #f1f5f9;
      color: #64748b;
      border: 1px solid #e2e8f0;
    }
    .camp-lifecycle-badge.badge-draft {
      background: #f8fafc;
      color: #94a3b8;
      border: 1px solid #e2e8f0;
    }
    .camp-lifecycle-badge.badge-archived {
      background: #f8fafc;
      color: #94a3b8;
      border: 1px solid #e2e8f0;
    }
    .planet-avatar { width: 44px; height: 44px; border-radius: 10px; background: #f8fafc; border: 1px solid #e2e8f0; position: relative; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #104B35; }
    .planet-avatar img { width: 28px; height: 28px; border-radius: 6px; object-fit: contain; }
    .planet-ring { display: none; }
    .camp-card-meta { flex: 1; min-width: 0; }
    .camp-card-name { font-size: 15px; font-weight: 700; color: #14142b; }
    .camp-card-badges-row { display: flex; align-items: center; gap: 8px; }
    .camp-leads-pill { font-size: 11px; font-weight: 700; background: #f1f5f9; color: #475569; padding: 2px 8px; border-radius: 9999px; }
    .camp-status-dot { width: 8px; height: 8px; border-radius: 50%; }
    .dot-running { background: #10b981; }
    .dot-paused { background: #f59e0b; }
    .dot-draft { background: #94a3b8; }
    .btn-camp-3dots { background: transparent; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 6px; border-radius: 6px; display: flex; align-items: center; justify-content: center; }
    .btn-camp-3dots:hover { background: #f1f5f9; color: #14142b; }
    .camp-3dots-menu { position: absolute; top: 48px; right: 16px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); padding: 6px; display: none; flex-direction: column; z-index: 9999 !important; min-width: 170px; }
    .camp-3dots-menu.is-open { display: flex; }
    .camp-menu-item { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 8px; font-size: 12.5px; font-weight: 600; color: #14142b; cursor: pointer; transition: background 0.12s; }
    .camp-menu-item:hover { background: #f8fafc; color: #104B35; }
    .menu-item-delete:hover { background: #fef2f2; color: #ef4444; }
    .sequence-preflight-warning { display: flex; align-items: flex-start; gap: 12px; background: #fffbeb; border: 1px solid #fef3c7; color: #92400e; border-radius: 10px; padding: 12px 16px; margin: 14px 0; }
    .sequence-preflight-warning .warning-icon { display: flex; align-items: center; justify-content: center; color: #d97706; flex-shrink: 0; margin-top: 2px; }
    .sequence-preflight-warning .warning-text strong { display: block; font-size: 13.5px; font-weight: 700; color: #92400e; margin-bottom: 3px; }
    .sequence-preflight-warning .warning-text p { margin: 0; font-size: 12.5px; color: #b45309; line-height: 1.4; }
    .flow-canvas-card {
      overflow-x: auto !important;
      overflow-y: visible !important;
      padding: 22px 26px 30px 26px !important;
      position: relative;
      z-index: 9999;
    }
    .horizontal-node-canvas {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow-x: auto;
      overflow-y: visible !important;
      padding: 12px 6px 20px 6px;
      position: relative;
      min-width: max-content;
    }
    .node-connector {
      position: relative;
      z-index: 50;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 0 4px;
    }
    .delay-select-pill {
      appearance: none;
      -webkit-appearance: none;
      background: #f1f5f9;
      color: #475569;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 18px 3px 8px;
      border-radius: 9999px;
      border: 1px solid #cbd5e1;
      cursor: pointer;
      outline: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 5px center;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .delay-select-pill:hover, .delay-select-pill:focus {
      background-color: #ffffff;
      border-color: #104B35;
      color: #104B35;
      box-shadow: 0 2px 6px rgba(16, 75, 53, 0.15);
    }
    .flow-condition-pill {
      font-size: 10px;
      font-weight: 700;
      color: #0369a1;
      background: #e0f2fe;
      border: 1px solid #bae6fd;
      border-radius: 9999px;
      padding: 2px 8px;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      margin-bottom: 4px;
    }
    .btn-quick-add {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #f8fafc;
      color: #334155;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 6px 11px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-quick-add:hover {
      background: #E6EFE9;
      color: #104B35;
      border-color: #fdba74;
      transform: translateY(-1px);
    }
    .btn-quick-add:active {
      transform: translateY(0) scale(0.98);
    }
    .live-preview-box {
      padding: 16px 18px;
      background: #fdfefe;
      border: 1.5px dashed #DCE5DE;
      border-radius: 14px;
      margin-bottom: 14px;
    }
    .delay-pill-badge {
      position: relative;
      z-index: 60;
      cursor: pointer;
    }
    .step-insert-menu,
    .delay-dropdown-menu,
    .pipeline-popover-menu {
      position: fixed;
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 12px !important;
      box-shadow: 0 14px 34px rgba(15, 23, 42, 0.16), 0 4px 12px rgba(0, 0, 0, 0.08) !important;
      z-index: 9999 !important;
      min-width: 180px;
      max-height: 280px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 6px !important;
    }
    .pipeline-popover-item {
      padding: 8px 12px;
      border: none;
      background: transparent;
      border-radius: 8px;
      text-align: left;
      font-size: 12.5px;
      font-weight: 600;
      color: #1e293b;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .pipeline-popover-item:hover {
      background: #E6EFE9;
      color: #104B35;
    }
    .pipeline-popover-item.is-selected {
      background: #DCE5DE;
      color: #c2410c;
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
      -webkit-backdrop-filter: blur(2px);
      z-index: 99990;
      display: none;
      justify-content: flex-end;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      overflow-x: hidden;
    }
    .camp-drawer-backdrop.is-open {
      display: flex !important;
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
      border-color: #104B35;
      color: #104B35;
    }
    .drawer-filter-pill.is-active {
      background: #104B35;
      color: #ffffff;
      border-color: #104B35;
      box-shadow: 0 2px 6px rgba(16, 75, 53, 0.2);
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
    .badge-status-running { background: #E6EFE9; color: #167448; border: 1px solid #DCE5DE; }
    .badge-status-waiting { background: #f5f3ff; color: #7c3aed; border: 1px solid #ddd6fe; }
    .badge-status-completed { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
    .badge-status-replied { background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; }
    .badge-status-failed { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
    .badge-status-paused { background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; }
    .btn-camp-live-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #E6EFE9;
      color: #104B35;
      border: 1px solid #DCE5DE;
      padding: 3px 9px;
      border-radius: 9999px;
      font-size: 11.5px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.12s;
    }
    .btn-camp-live-badge:hover {
      background: #104B35;
      color: #ffffff;
      border-color: #104B35;
    }
    .btn-camp-card-live {
      background: #E6EFE9;
      border: 1px solid #DCE5DE;
      color: #104B35;
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
      background: #104B35;
      color: #ffffff;
      border-color: #104B35;
    }
    .autopilot-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: -0.01em;
      transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
      user-select: none;
    }
    .pill-autopilot-active {
      background: #ecfdf5 !important;
      color: #047857 !important;
      border: 1.5px solid #a7f3d0 !important;
      box-shadow: 0 2px 6px rgba(16, 185, 129, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.8) !important;
    }
    .pill-autopilot-resting {
      background: #fffbeb !important;
      color: #b45309 !important;
      border: 1.5px solid #fde68a !important;
      box-shadow: 0 2px 6px rgba(245, 158, 11, 0.12), inset 0 1px 1px rgba(255, 255, 255, 0.8) !important;
    }
    .pill-autopilot-idle {
      background: #f8fafc !important;
      color: #64748b !important;
      border: 1.5px solid #e2e8f0 !important;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04), inset 0 1px 1px rgba(255, 255, 255, 0.8) !important;
    }
    .autopilot-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .autopilot-dot.dot-active {
      background: #10b981;
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
    }
    .autopilot-dot.dot-active.animated {
      animation: pulseGreen 2s infinite;
    }
    .autopilot-dot.dot-resting {
      background: #f59e0b;
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7);
      animation: pulseOrange 2.5s infinite;
    }
    .autopilot-dot.dot-idle {
      background: #94a3b8;
    }
  `;
  document.head.appendChild(style);
}

export async function renderCampaignsView(container, ctx = {}) {
  ensureCampaignsStyles();
  if (!container) return;

  const hasExistingContent = Boolean(container.querySelector('.campaigns-view-shell, .wizard-full-view'));
  const isInitial = !hasExistingContent && !ctx.silent && ctx.isInitialRender !== false;

  if (isInitial) {
    container.innerHTML = `
      <div class="view-loading-state">
        <div class="spinner"></div>
        <span>Loading campaigns...</span>
      </div>
    `;
  }

  let campaigns = [];
  let lists = [];
  let profiles = [];
  let activeSenderEmail = '';
  let noteLimitUntil = 0;
  let savedMessageTemplates = [];
  let isLivePreview = false;
  let allStorage = {};
  let currentConfig = {};
  let currentAlarm = null;
  let autoPilotInterval = null;
  let drawerInterval = null;

  try {
    const [cRes, lRes, pRes, cfg, sRes, alarmRes] = await Promise.all([
      call(ACTIONS.CAMPAIGN_GET_ALL, {}).catch(() => []),
      call(ACTIONS.LIST_GET_ALL, {}).catch(() => []),
      allProfiles().catch(() => []),
      getConfig().catch(() => ({})),
      new Promise((r) => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.get(null, r);
        } else {
          r({});
        }
      }),
      new Promise((r) => {
        try {
          if (typeof chrome !== 'undefined' && chrome.alarms?.get) {
            chrome.alarms.get('crafture-campaign-tick', (a1) => {
              if (a1 && a1.scheduledTime) return r(a1);
              chrome.alarms.get('campaignTick', r);
            });
          } else {
            r(null);
          }
        } catch {
          r(null);
        }
      }),
    ]);
    allStorage = sRes || {};
    currentConfig = cfg || {};
    currentAlarm = alarmRes || null;
    campaigns = Array.isArray(cRes) ? cRes : (cRes?.campaigns || []);
    const rawLists = Array.isArray(lRes) ? lRes : (lRes?.lists || []);
    lists = rawLists.map((l) => ({
      ...l,
      id: l.listId || l.id,
      listId: l.listId || l.id,
    }));
    profiles = Array.isArray(pRes) ? pRes : [];
    activeSenderEmail = cfg?.mailbox?.email || cfg?.googleWorkspace?.email || '';
    noteLimitUntil = Number(sRes?.crafture_note_limit_until || sRes?.outfox_note_limit_until) || 0;
    savedMessageTemplates = Array.isArray(sRes?.messageTemplates)
      ? sRes.messageTemplates
      : Array.isArray(sRes?.templates)
        ? sRes.templates
        : [];
  } catch (e) {
    console.warn('[Campaigns View] Read error', e);
  }

  function getSampleLead() {
    if (profiles.length > 0 && profiles[0]) {
      const p = profiles[0];
      return {
        firstName: p.firstName || 'Alex',
        lastName: p.lastName || 'Morgan',
        fullName: p.fullName || `${p.firstName || 'Alex'} ${p.lastName || 'Morgan'}`.trim(),
        company: p.company || p.companyName || 'Acme Technologies',
        companyName: p.company || p.companyName || 'Acme Technologies',
        jobTitle: p.jobTitle || p.title || p.headline || 'Head of Growth',
        title: p.jobTitle || p.title || p.headline || 'Head of Growth',
        headline: p.headline || 'Head of Growth at Acme Technologies',
        location: p.location || 'San Francisco, CA',
        industry: p.industry || 'Information Technology',
        email: p.email || p.enrichmentEmail || 'alex@acme.com',
        ai_opener: p.ai_opener || "Saw your team's expansion and wanted to connect!",
      };
    }
    return {
      firstName: 'Alex',
      lastName: 'Morgan',
      fullName: 'Alex Morgan',
      company: 'Acme Technologies',
      companyName: 'Acme Technologies',
      jobTitle: 'Head of Growth',
      title: 'Head of Growth',
      headline: 'Head of Growth at Acme Technologies',
      location: 'San Francisco, CA',
      industry: 'Information Technology',
      email: 'alex@acme.com',
      ai_opener: "Saw your team's expansion and wanted to connect!",
    };
  }

  function getStepExplanation(type) {
    switch (type) {
      case 'view':
        return "Visits the prospect's LinkedIn profile to trigger a notification and warm up the lead before connecting.";
      case 'follow':
        return "Follows the prospect's public profile on LinkedIn to signal interest and keep up with their activity.";
      case 'like':
        return "Automatically finds and likes the prospect's most recent post to increase profile visibility and familiarity.";
      case 'endorse':
        return "Endorses the prospect's top featured skill on LinkedIn to build initial rapport.";
      case 'wait':
        return "Pauses sequence execution for a specified duration before continuing to subsequent touchpoints.";
      default:
        return "Executes this automated outreach touchpoint within safe daily human anti-detection limits.";
    }
  }

  const CRAFTURE_PRESET_TEMPLATES = {
    invitation: [
      { id: 'p_inv_1', name: 'Founder-to-Founder', content: 'Hi {{firstName|there}} — saw what you are building at {{company|your company}}. Would love to connect founder to founder!' },
      { id: 'p_inv_2', name: 'Domain / Industry Peer', content: 'Hi {{firstName|there}}, love your work in {{industry|your space}}. Would be great to connect and stay in touch!' },
      { id: 'p_inv_3', name: 'Casual & Direct', content: 'Hi {{firstName|there}} — came across your profile and thought our work might intersect. Would love to connect here.' },
    ],
    message: [
      { id: 'p_msg_1', name: 'Warm Thank You & Question', content: 'Thanks for connecting, {{firstName|there}}! What is taking up most of your focus this quarter at {{company|your team}}?' },
      { id: 'p_msg_2', name: 'Value & Insights Share', content: 'Hey {{firstName|there}}, great to connect. Recently compiled a guide on pipeline automation — happy to send it over if relevant!' },
      { id: 'p_msg_3', name: 'Casual Coffee Chat', content: 'Hi {{firstName|there}}, thanks for accepting my connection request. Would you be open to a quick 10-minute chat sometime next week?' },
    ],
    email: [
      { id: 'p_eml_1', name: 'Quick Idea for {{company}}', subject: 'Quick question for {{firstName|there}} regarding {{company|your company}}', content: 'Hi {{firstName|there}},\n\nSaw what you\'re building at {{company|your team}} and wanted to reach out.\n\nDo you have 5 minutes this week for a brief chat?\n\nBest,\n{{senderName}}' },
      { id: 'p_eml_2', name: 'Executive Follow-up', subject: 'Re: Quick question regarding {{company|your company}}', content: 'Hi {{firstName|there}},\n\nWanted to follow up on my previous note. Would love to share how similar teams are solving this.\n\nLet me know if Tuesday or Thursday works best for you.\n\nBest,\n{{senderName}}' },
      { id: 'p_eml_3', name: 'Candidate / Recruiter Pitch', subject: 'Exciting leadership opportunity for {{firstName|there}}', content: 'Hi {{firstName|there}},\n\nCame across your profile and was thoroughly impressed by your track record in {{headline|your field}}.\n\nWould you be open to an exploratory 10-minute call this week?\n\nBest regards,\n{{senderName}}' },
    ],
  };

  function renderTemplateSelectOptions(category, savedList = []) {
    const normCat = category === 'invite' ? 'invitation' : category;
    const userList = savedList.filter((t) => (t.type || (t.category === 'invite' ? 'invitation' : t.category)) === normCat);
    const presets = CRAFTURE_PRESET_TEMPLATES[normCat] || [];

    let html = '';
    if (userList.length > 0) {
      html += '<optgroup label="My Saved Templates">';
      userList.forEach((t) => {
        html += `<option value="user_${t.id}">${t.name || t.title || 'Untitled'}</option>`;
      });
      html += '</optgroup>';
    }
    if (presets.length > 0) {
      html += '<optgroup label="Crafture Presets">';
      presets.forEach((p) => {
        html += `<option value="preset_${p.id}">${p.name}</option>`;
      });
      html += '</optgroup>';
    }
    return html;
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

  const savedCampState = ctx.getSavedState?.() || {};
  let activeStateTab = ctx.subState || ctx.tab || savedCampState.activeSubTab || 'running';
  let campSearchQuery = savedCampState.searchQuery || '';
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
    const scrollPos = ctx.getScrollPosition?.(container);
    const now = Date.now();
    const autoPilotStatus = computeAutoPilotStatus(campaigns, allStorage, currentConfig, currentAlarm, now);
    const enrichedCampaigns = campaigns.map((camp) => {
      const stats = computeCampaignStats(camp, allStorage, now);
      return { ...camp, computed: stats };
    });

    const running = enrichedCampaigns.filter((c) => c.computed.lifecycleKey === 'running' || c.computed.lifecycleKey === 'waiting');
    const completed = enrichedCampaigns.filter((c) => c.computed.lifecycleKey === 'completed');
    const paused = enrichedCampaigns.filter((c) => c.computed.lifecycleKey === 'paused');
    const draft = enrichedCampaigns.filter((c) => c.computed.lifecycleKey === 'draft');
    const archived = enrichedCampaigns.filter((c) => c.computed.lifecycleKey === 'archived');

    // Summary totals across all campaigns
    const totalActiveRunning = enrichedCampaigns.filter((c) => c.computed.lifecycleKey === 'running').length;
    const totalWaiting = enrichedCampaigns.filter((c) => c.computed.lifecycleKey === 'waiting').length;
    const totalCompleted = completed.length;
    const totalAllLeads = enrichedCampaigns.reduce((sum, c) => sum + (c.computed.totalLeads || 0), 0);

    let currentList = running;
    if (activeStateTab === 'completed') currentList = completed;
    else if (activeStateTab === 'paused') currentList = paused;
    else if (activeStateTab === 'draft') currentList = draft;
    else if (activeStateTab === 'archived') currentList = archived;

    if (campSearchQuery.trim()) {
      const q = campSearchQuery.toLowerCase();
      currentList = currentList.filter((c) => c.name && c.name.toLowerCase().includes(q));
    }

    const craftureLogoUrl =
      typeof chrome !== 'undefined' && chrome.runtime?.getURL
        ? chrome.runtime.getURL('icons/icon48.png')
        : '../../icons/icon48.png';

    const isNoteLimitActive = Date.now() < noteLimitUntil;
    let noteLimitRemaining = '';
    if (isNoteLimitActive) {
      const diffMs = Math.max(0, noteLimitUntil - Date.now());
      const h = Math.floor(diffMs / 3600000);
      const m = Math.floor((diffMs % 3600000) / 60000);
      noteLimitRemaining = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }

    container.innerHTML = `
      <div class="campaigns-view-shell">
        <div class="campaigns-top-bar">
          <div>
            <h1 class="main-page-title">My campaigns</h1>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="autopilot-status-pill ${autoPilotStatus.pillClass}" id="autopilot-status-pill">
              <span class="autopilot-dot ${autoPilotStatus.dotClass}"></span>
              <span class="autopilot-text">${autoPilotStatus.text}</span>
            </div>
            <button type="button" class="btn-primary-start-camp" id="btn-start-wizard" style="display:inline-flex; align-items:center; gap:6px;">
              Start a campaign ${ICONS.chevronDown}
            </button>
          </div>
        </div>

        ${isNoteLimitActive ? `
          <div class="note-limit-fallback-banner" style="display: flex; align-items: center; gap: 10px; padding: 12px 18px; margin-bottom: 20px; border-radius: 12px; background: #fffbeb; border: 1.5px solid #fef3c7; color: #b45309; font-size: 13px; font-weight: 600; box-shadow: 0 2px 6px rgba(245, 158, 11, 0.08);">
            <span style="display: inline-flex; color: #f59e0b; flex-shrink: 0;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            </span>
            <span>Monthly personalized note limit reached — sending blank invites automatically for the next <strong>${noteLimitRemaining}</strong></span>
          </div>
        ` : ''}

        <!-- Top Summary Pills (Requirement 2) -->
        <div class="camp-overview-pills-row">
          <div class="camp-stat-pill">
            <span class="live-dot-circle" style="background:#10b981; width:8px; height:8px; border-radius:50%; display:inline-block;"></span>
            <span class="stat-pill-label">Active:</span>
            <strong class="stat-pill-val">${totalActiveRunning}</strong>
          </div>
          <div class="camp-stat-pill">
            <span style="color:#f59e0b; display:inline-flex;">${ICONS.clock}</span>
            <span class="stat-pill-label">Waiting:</span>
            <strong class="stat-pill-val">${totalWaiting}</strong>
          </div>
          <div class="camp-stat-pill">
            <span style="color:#4f46e5; display:inline-flex;">${ICONS.check}</span>
            <span class="stat-pill-label">Completed:</span>
            <strong class="stat-pill-val">${totalCompleted}</strong>
          </div>
          <div class="camp-stat-pill">
            <span style="color:#104B35; display:inline-flex;">${ICONS.lightning}</span>
            <span class="stat-pill-label">Total Leads:</span>
            <strong class="stat-pill-val">${totalAllLeads}</strong>
          </div>
        </div>

        <!-- Sub-Tabs & Search Bar -->
        <div class="camp-tabs-and-search-row">
          <div class="camp-state-tabs-bar">
            <button type="button" class="camp-state-tab ${activeStateTab === 'running' ? 'is-active' : ''}" data-tab="running">
              <span>${ICONS.play} Running</span> <span class="tab-count-badge">${running.length}</span>
            </button>
            <button type="button" class="camp-state-tab ${activeStateTab === 'completed' ? 'is-active' : ''}" data-tab="completed">
              <span>${ICONS.check} Completed</span> <span class="tab-count-badge">${completed.length}</span>
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

        <!-- Cards Grid (Spacious Claymorphism SaaS Rows) -->
        <div class="cn-camp-grid">
          ${
            currentList.length === 0
              ? `
            <div class="empty-camp-pane">
              <div class="planet-avatar" style="opacity:0.6; margin-bottom:12px;">
                <img src="${craftureLogoUrl}" width="28" height="28" alt="Crafture Network" />
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
                    const st = camp.computed || computeCampaignStats(camp, allStorage, now);

                    return `
              <div class="cn-camp-card clay-card" data-camp-id="${id}" tabindex="0" role="button">
                <!-- LEFT COLUMN: Avatar + Name + Lifecycle Badge + Mini Step Flow -->
                <div class="camp-row-left">
                  <div class="planet-avatar">
                    <img src="${craftureLogoUrl}" width="28" height="28" alt="Crafture Network" />
                  </div>
                  <div class="camp-card-meta">
                    <div class="camp-name-badge-row">
                      <span class="camp-card-name" title="${camp.name}">${camp.name}</span>
                      ${st.badgeHtml}
                    </div>
                    <div class="camp-flow-summary-row">
                      ${renderMiniStepFlow(camp.steps)}
                      <span class="camp-leads-pill">${ICONS.lightning} ${st.totalLeads} leads</span>
                    </div>
                  </div>
                </div>

                <!-- MIDDLE COLUMN: Progress bar + 4 Mini KPIs -->
                <div class="camp-row-middle">
                  <div class="camp-progress-header">
                    <span class="camp-progress-title">Progress: <strong>${st.completedOrReplied} / ${st.totalLeads}</strong> leads</span>
                    <span class="camp-progress-pct font-bold">${st.progressPct}%</span>
                  </div>
                  <div class="camp-progress-track">
                    <div class="camp-progress-fill ${st.isCompleted ? 'is-complete' : ''}" style="width: ${st.progressPct}%;"></div>
                  </div>
                  <div class="camp-mini-kpis">
                    <div class="mini-kpi-item">
                      <span class="kpi-label">Sent</span>
                      <strong class="kpi-val">${st.invitesSent}</strong>
                    </div>
                    <div class="mini-kpi-item">
                      <span class="kpi-label">Accepted</span>
                      <strong class="kpi-val">${st.acceptancePct}% <span class="kpi-sub">(${st.accepted})</span></strong>
                    </div>
                    <div class="mini-kpi-item">
                      <span class="kpi-label">Replied</span>
                      <strong class="kpi-val">${st.replyPct}% <span class="kpi-sub">(${st.replied})</span></strong>
                    </div>
                    <div class="mini-kpi-item">
                      <span class="kpi-label">Waiting</span>
                      <strong class="kpi-val">${st.waitingCount}</strong>
                    </div>
                  </div>
                </div>

                <!-- RIGHT COLUMN: Live Status Button + 1-Click Pause/Resume + 3-Dots Menu -->
                <div class="camp-row-right">
                  <button type="button" class="btn-camp-card-live btn-trigger-live-drawer" data-id="${id}" title="View live lead progress">
                    ${ICONS.lightning} Live Status
                  </button>

                  ${st.isCompleted ? `
                    <button type="button" class="btn-camp-pause-toggle is-completed" disabled title="Campaign completed">
                      ${ICONS.check} Completed
                    </button>
                  ` : st.lifecycleKey === 'paused' ? `
                    <button type="button" class="btn-camp-pause-toggle is-paused" data-action="toggle_pause" data-id="${id}" data-status="paused" title="Resume campaign">
                      ${ICONS.play} Resume
                    </button>
                  ` : `
                    <button type="button" class="btn-camp-pause-toggle" data-action="toggle_pause" data-id="${id}" data-status="active" title="Pause campaign">
                      ${ICONS.pause} Pause
                    </button>
                  `}

                  <button type="button" class="btn-camp-3dots" data-dots-id="${id}" title="Campaign actions">
                    ${ICONS.moreHorizontal}
                  </button>

                  <!-- 3-Dots Dropdown Menu -->
                  <div class="camp-3dots-menu" id="camp-menu-${id}">
                    <div class="camp-menu-item" data-action="live_status" data-id="${id}">
                      <span style="color:#104B35; display:inline-flex;">${ICONS.lightning}</span> View Live Leads Status
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
                      <span>${st.lifecycleKey === 'paused' ? ICONS.play : ICONS.pause}</span> ${st.lifecycleKey === 'paused' ? 'Resume my campaign' : 'Pause my campaign'}
                    </div>
                    <div class="camp-menu-item" data-action="archive" data-id="${id}">
                      <span>${ICONS.archive}</span> Archive
                    </div>
                    <div class="camp-menu-item menu-item-delete" data-action="delete" data-id="${id}">
                      <span>${ICONS.trash}</span> Delete
                    </div>
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
      <div class="modal-backdrop hidden" id="flow-modal" style="display: none;">
        <div class="modal-dialog" style="max-width: 820px;">
          <div class="modal-head">
            <h3 class="pane-title" id="flow-modal-title">Sequence Flow</h3>
            <button type="button" class="btn-close-modal" id="btn-close-flow-modal">${ICONS.x}</button>
          </div>
          <div class="modal-body" id="flow-modal-body"></div>
        </div>
      </div>

      <!-- Live Campaign Status Drawer -->
      <div class="camp-drawer-backdrop hidden" id="camp-live-drawer-backdrop" style="display: none;">
        <div class="camp-drawer" id="camp-live-drawer">
          <div class="camp-drawer-head">
            <div class="camp-drawer-head-info">
              <div class="planet-avatar" style="width:36px; height:36px;">
                <img src="${craftureLogoUrl}" width="22" height="22" alt="Crafture Network" />
              </div>
              <div>
                <h3 class="camp-drawer-title" id="drawer-camp-name">Live Campaign Status</h3>
                <div class="camp-drawer-subtitle" id="drawer-camp-subtitle">Real-time prospect progress</div>
              </div>
            </div>
            <div class="camp-drawer-actions">
              <div class="autopilot-status-pill ${autoPilotStatus.pillClass}" id="drawer-autopilot-pill" style="font-size: 11.5px; padding: 4px 10px;">
                <span class="autopilot-dot ${autoPilotStatus.dotClass}" style="width:6px; height:6px;"></span>
                <span class="autopilot-text">${autoPilotStatus.text}</span>
              </div>
              <button type="button" class="btn-pill btn-secondary btn-sm" id="btn-drawer-refresh" style="font-size: 11.5px; padding: 5px 10px; display:inline-flex; align-items:center; gap:4px;">
                ${ICONS.refresh} Refresh
              </button>
              <button type="button" class="btn-drawer-close" id="btn-drawer-close">${ICONS.x}</button>
            </div>
          </div>
          <div id="drawer-ab-section-mount" style="padding: 0 20px;"></div>
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
    ctx.restoreScrollPosition?.(container, scrollPos);
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
        ctx.updateSubState?.(activeStateTab);
        ctx.saveState?.({ activeSubTab: activeStateTab, searchQuery: campSearchQuery });
        renderList();
      });
    });

    const searchInp = container.querySelector('#input-camp-search');
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        campSearchQuery = e.target.value;
        ctx.saveState?.({ activeSubTab: activeStateTab, searchQuery: campSearchQuery });
        renderList();
        const updated = container.querySelector('#input-camp-search');
        if (updated) {
          updated.focus();
          updated.setSelectionRange(updated.value.length, updated.value.length);
        }
      });
    }

    const refreshAndRenderList = async () => {
      const scrollPos = ctx.getScrollPosition?.(container);
      const freshCamps = await call(ACTIONS.CAMPAIGN_GET_ALL, {}).catch(() => []);
      campaigns = Array.isArray(freshCamps) ? freshCamps : (freshCamps?.campaigns || []);
      allStorage = await new Promise((r) => chrome.storage.local.get(null, r));
      renderList();
      ctx.restoreScrollPosition?.(container, scrollPos);
    };

    container.querySelectorAll('.btn-camp-3dots').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.dotsId;
        const menu = container.querySelector(`#camp-menu-${id}`);
        const card = btn.closest('.cn-camp-card');
        const willBeOpen = menu && !menu.classList.contains('is-open');

        container.querySelectorAll('.camp-3dots-menu').forEach((m) => {
          if (m !== menu) m.classList.remove('is-open');
        });
        container.querySelectorAll('.cn-camp-card').forEach((c) => {
          if (c !== card) c.classList.remove('has-open-menu');
        });

        if (menu) {
          menu.classList.toggle('is-open', willBeOpen);
          if (card) {
            card.classList.toggle('has-open-menu', willBeOpen);
          }
        }
      });
    });

    document.addEventListener('click', () => {
      container.querySelectorAll('.camp-3dots-menu').forEach((m) => m.classList.remove('is-open'));
      container.querySelectorAll('.cn-camp-card').forEach((c) => c.classList.remove('has-open-menu'));
    });

    container.querySelectorAll('.camp-menu-item').forEach((item) => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        container.querySelectorAll('.camp-3dots-menu').forEach((m) => m.classList.remove('is-open'));
        container.querySelectorAll('.cn-camp-card').forEach((c) => c.classList.remove('has-open-menu'));
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
            await refreshAndRenderList();
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
          await refreshAndRenderList();
        } else if (action === 'toggle_pause') {
          const isPaused = camp.status === 'paused';
          if (isPaused) {
            await call(ACTIONS.CAMPAIGN_RESUME, { campaignId: id });
            ctx.showToast?.(`Campaign "${camp.name}" resumed.`, 'success');
          } else {
            await call(ACTIONS.CAMPAIGN_PAUSE, { campaignId: id });
            ctx.showToast?.(`Campaign "${camp.name}" paused.`, 'info');
          }
          await refreshAndRenderList();
        } else if (action === 'archive') {
          const storage = await new Promise((r) => chrome.storage.local.get(['campaigns'], r));
          const allCamps = storage.campaigns || [];
          const found = allCamps.find((c) => (c.campaignId || c.id) === id);
          if (found) {
            found.status = 'archived';
            await chrome.storage.local.set({ campaigns: allCamps });
            ctx.showToast?.(`Campaign "${camp.name}" archived.`, 'info');
            await refreshAndRenderList();
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
            await refreshAndRenderList();
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

    container.querySelectorAll('.btn-camp-pause-toggle').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const currentStatus = btn.dataset.status;
        const isPaused = currentStatus === 'paused';
        const camp = campaigns.find((c) => (c.campaignId || c.id) === id);
        try {
          if (isPaused) {
            await call(ACTIONS.CAMPAIGN_RESUME, { campaignId: id });
            ctx.showToast?.(`Campaign "${camp?.name || ''}" resumed.`, 'success');
          } else {
            await call(ACTIONS.CAMPAIGN_PAUSE, { campaignId: id });
            ctx.showToast?.(`Campaign "${camp?.name || ''}" paused.`, 'info');
          }
          await refreshAndRenderList();
        } catch (err) {
          ctx.showToast?.(err.message || 'Action failed', 'error');
        }
      });
    });

    container.querySelectorAll('.cn-camp-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (
          e.target.closest('.btn-camp-3dots') ||
          e.target.closest('.camp-3dots-menu') ||
          e.target.closest('.btn-trigger-live-drawer') ||
          e.target.closest('.btn-camp-pause-toggle')
        ) return;
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
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (
            e.target.closest('.btn-camp-3dots') ||
            e.target.closest('.camp-3dots-menu') ||
            e.target.closest('.btn-trigger-live-drawer') ||
            e.target.closest('.btn-camp-pause-toggle')
          ) return;
          e.preventDefault();
          card.click();
        }
      });
    });

    // Auto-Pilot Live Countdown Interval
    if (autoPilotInterval) clearInterval(autoPilotInterval);
    autoPilotInterval = setInterval(() => {
      const pill = container.querySelector('#autopilot-status-pill');
      const drawerPill = container.querySelector('#drawer-autopilot-pill');
      if ((!pill && !drawerPill) || !container.isConnected) {
        clearInterval(autoPilotInterval);
        autoPilotInterval = null;
        return;
      }
      const liveStatus = computeAutoPilotStatus(campaigns, allStorage, currentConfig, currentAlarm, Date.now());
      if (pill) {
        pill.className = `autopilot-status-pill ${liveStatus.pillClass}`;
        pill.innerHTML = `
          <span class="autopilot-dot ${liveStatus.dotClass}"></span>
          <span class="autopilot-text">${liveStatus.text}</span>
        `;
      }
      if (drawerPill) {
        drawerPill.className = `autopilot-status-pill ${liveStatus.pillClass}`;
        drawerPill.innerHTML = `
          <span class="autopilot-dot ${liveStatus.dotClass}" style="width:6px; height:6px;"></span>
          <span class="autopilot-text">${liveStatus.text}</span>
        `;
      }
    }, 1000);

    container.querySelector('#btn-close-flow-modal')?.addEventListener('click', () => {
      const fm = container.querySelector('#flow-modal');
      if (fm) {
        fm.classList.add('hidden');
        fm.style.display = 'none';
      }
    });

    // =========================================================================
    // Live Leads Drawer Logic & Events
    // =========================================================================
    let drawerCampId = null;
    let drawerFilter = 'all';
    let drawerSearchQuery = '';
    if (drawerInterval) clearInterval(drawerInterval);
    drawerInterval = null;
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
      if (status === 'completed' || status === 'replied' || status === 'failed') return '—';
      if (!ts || ts <= Date.now()) {
        return status === 'active' || status === 'running'
          ? '<span style="color:#104B35; font-weight:700;">Due now</span>'
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
      backdrop.style.display = 'flex';
      backdrop.classList.remove('hidden');
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
      if (backdrop) {
        backdrop.classList.remove('is-open');
        backdrop.classList.add('hidden');
        backdrop.style.display = 'none';
      }
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
        const statusPill = isPaused
          ? `<span class="badge-status badge-status-paused" style="display:inline-flex; align-items:center; gap:4px;">${ICONS.pause} Paused</span>`
          : `<span class="badge-status badge-status-active" style="display:inline-flex; align-items:center; gap:4px;">${ICONS.lightning} Running</span>`;
        subEl.innerHTML = `${statusPill} &bull; ${data.summary?.total || 0} enrolled prospects &bull; Auto-refreshing every 5s`;
      }

      const leads = data.leads || [];
      const totalSteps = data.totalSteps || data.steps?.length || 0;

      function resolveLeadDrawerStatus(lead) {
        // 1. Replied: enrollment.status === 'replied' || enrollment.replied === true || enrollment.stoppedReason === 'replied'
        if (
          lead.status === 'replied' ||
          lead.rawStatus === 'replied' ||
          lead.replied === true ||
          lead.stoppedReason === 'replied'
        ) {
          return 'replied';
        }

        // 2. Completed: enrollment.status === 'completed' || enrollment.status === 'accepted' (on final step) || stepIndex >= campaign.steps.length || LIVE STATUS === 'ACCEPTED' with no remaining steps
        const sIdx = lead.stepIndex ?? (lead.stepNumber ? lead.stepNumber - 1 : 0);
        const isAcceptedFinal =
          (lead.status === 'accepted' || lead.rawStatus === 'accepted' || lead.accepted) &&
          (sIdx >= totalSteps - 1 || totalSteps <= 1);
        const hasNoRemainingSteps = totalSteps > 0 && sIdx >= totalSteps;
        const isLiveAcceptedNoSteps =
          String(lead.status || '').toUpperCase() === 'ACCEPTED' && (sIdx >= totalSteps - 1 || hasNoRemainingSteps);

        if (
          lead.status === 'completed' ||
          lead.rawStatus === 'completed' ||
          lead.status === 'done' ||
          lead.rawStatus === 'done' ||
          isAcceptedFinal ||
          hasNoRemainingSteps ||
          isLiveAcceptedNoSteps
        ) {
          return 'completed';
        }

        // 3. Failed: stopped, failed, blocked_not_connected, email_skipped_no_email
        if (
          lead.status === 'failed' ||
          lead.status === 'stopped' ||
          lead.rawStatus === 'failed' ||
          lead.rawStatus === 'stopped' ||
          lead.rawStatus === 'blocked_not_connected' ||
          lead.rawStatus === 'email_skipped_no_email'
        ) {
          return 'failed';
        }

        // 4. Waiting: waiting_acceptance, future timer, or waiting
        if (
          lead.status === 'waiting' ||
          lead.parkReason === 'waiting_acceptance' ||
          /waiting for invite acceptance/i.test(lead.lastError || '') ||
          (lead.nextRunAt && lead.nextRunAt > Date.now()) ||
          (lead.nextAt && lead.nextAt > Date.now())
        ) {
          return 'waiting';
        }

        // 5. Active / Running
        return 'active';
      }

      leads.forEach((l) => {
        l.resolvedStatus = resolveLeadDrawerStatus(l);
      });

      const s = {
        total: leads.length,
        active: leads.filter((l) => l.resolvedStatus === 'active').length,
        waiting: leads.filter((l) => l.resolvedStatus === 'waiting').length,
        replied: leads.filter((l) => l.resolvedStatus === 'replied').length,
        completed: leads.filter((l) => l.resolvedStatus === 'completed').length,
        failed: leads.filter((l) => l.resolvedStatus === 'failed').length,
      };

      const pills = [
        { id: 'all', label: `All (${s.total})` },
        { id: 'active', label: `Active / Running (${s.active})` },
        { id: 'waiting', label: `Waiting (${s.waiting})` },
        { id: 'replied', label: `Replied (${s.replied})` },
        { id: 'completed', label: `Completed (${s.completed})` },
        { id: 'failed', label: `Failed (${s.failed})` },
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

      // A/B Test Comparison Strip
      const abMount = container.querySelector('#drawer-ab-section-mount');
      if (abMount) {
        if (data.abStats && typeof data.abStats === 'object' && Object.keys(data.abStats).length > 0) {
          const abKeys = Object.keys(data.abStats);
          abMount.innerHTML = `
            <div class="drawer-ab-section" style="margin-top: 10px; margin-bottom: 12px; padding: 14px; background: #E6EFE9; border: 1px solid #DCE5DE; border-radius: 12px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
                <span style="font-size: 13px; font-weight: 700; color: #9a3412; display: flex; align-items: center; gap: 6px;">
                  ${ICONS.sparkles} A/B Test Performance Comparison
                </span>
                <span style="font-size: 11.5px; color: #c2410c;">Live Outreach Variant Tracking</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 10px;">
                ${abKeys
                  .map((stepKey) => {
                    const step = (data.steps || []).find((s, idx) => s.id === stepKey || String(idx) === String(stepKey));
                    const stepLabel = step
                      ? (step.title || (step.type ? step.type.charAt(0).toUpperCase() + step.type.slice(1) : '') || `Step ${stepKey}`)
                      : `Step ${stepKey}`;
                    const stats = data.abStats[stepKey] || {};
                    const aSent = stats.A?.sent || 0;
                    const aAccepted = stats.A?.accepted || 0;
                    const aReplied = stats.A?.replied || 0;
                    const aAcceptRate = aSent > 0 ? ((aAccepted / aSent) * 100).toFixed(1) : '0.0';
                    const aReplyRate = aSent > 0 ? ((aReplied / aSent) * 100).toFixed(1) : '0.0';

                    const bSent = stats.B?.sent || 0;
                    const bAccepted = stats.B?.accepted || 0;
                    const bReplied = stats.B?.replied || 0;
                    const bAcceptRate = bSent > 0 ? ((bAccepted / bSent) * 100).toFixed(1) : '0.0';
                    const bReplyRate = bSent > 0 ? ((bReplied / bSent) * 100).toFixed(1) : '0.0';

                    const isInvite = step?.type === 'invite';

                    return `
                      <div class="ab-card-row" style="background: #ffffff; border: 1px solid #DCE5DE; border-radius: 10px; padding: 12px;">
                        <div style="font-size: 12px; font-weight: 700; color: #1e293b; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                          <span>${stepLabel}</span>
                          ${step?.winningVariant ? `<span class="badge-status badge-status-completed" style="font-size: 11px;">🏆 Winner: Variant ${step.winningVariant}</span>` : ''}
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                          <!-- Variant A -->
                          <div style="padding: 10px 12px; background: #fafafb; border: 1px solid #e2e8f0; border-radius: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                              <strong style="font-size: 12.5px; color: #1e293b;">Variant A ${step?.winningVariant === 'A' ? '🏆' : ''}</strong>
                              ${!step?.winningVariant ? `
                                <button type="button" class="btn-pill btn-secondary btn-declare-winner" data-camp-id="${data.campaignId}" data-step-key="${stepKey}" data-winner="A" style="font-size: 11px; padding: 2px 8px; height: 24px;">
                                  Declare Winner
                                </button>
                              ` : ''}
                            </div>
                            <div style="font-size: 12px; color: #64748b; line-height: 1.6;">
                              <div>Sent: <strong style="color: #0f172a;">${aSent}</strong></div>
                              ${isInvite ? `<div>Accepted: <strong style="color: #16a34a;">${aAccepted} (${aAcceptRate}%)</strong></div>` : ''}
                              <div>Replied: <strong style="color: #2563eb;">${aReplied} (${aReplyRate}%)</strong></div>
                            </div>
                          </div>

                          <!-- Variant B -->
                          <div style="padding: 10px 12px; background: #fafafb; border: 1px solid #e2e8f0; border-radius: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                              <strong style="font-size: 12.5px; color: #1e293b;">Variant B ${step?.winningVariant === 'B' ? '🏆' : ''}</strong>
                              ${!step?.winningVariant ? `
                                <button type="button" class="btn-pill btn-secondary btn-declare-winner" data-camp-id="${data.campaignId}" data-step-key="${stepKey}" data-winner="B" style="font-size: 11px; padding: 2px 8px; height: 24px;">
                                  Declare Winner
                                </button>
                              ` : ''}
                            </div>
                            <div style="font-size: 12px; color: #64748b; line-height: 1.6;">
                              <div>Sent: <strong style="color: #0f172a;">${bSent}</strong></div>
                              ${isInvite ? `<div>Accepted: <strong style="color: #16a34a;">${bAccepted} (${bAcceptRate}%)</strong></div>` : ''}
                              <div>Replied: <strong style="color: #2563eb;">${bReplied} (${bReplyRate}%)</strong></div>
                            </div>
                          </div>
                        </div>
                      </div>
                    `;
                  })
                  .join('')}
              </div>
            </div>
          `;

          abMount.querySelectorAll('.btn-declare-winner').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
              e.stopPropagation();
              const campId = btn.dataset.campId;
              const sKey = btn.dataset.stepKey;
              const winner = btn.dataset.winner;
              btn.disabled = true;
              btn.textContent = 'Saving...';
              try {
                await call(ACTIONS.CAMPAIGN_DECLARE_AB_WINNER, { campaignId: campId, stepKey: sKey, winnerId: winner });
                ctx.showToast?.(`Variant ${winner} declared as winner!`, 'success');
                fetchLiveStatus(true);
              } catch (err) {
                ctx.showToast?.(`Failed to declare winner: ${err?.message || err}`, 'error');
                btn.disabled = false;
                btn.textContent = 'Declare Winner';
              }
            });
          });
        } else {
          abMount.innerHTML = '';
        }
      }
    }

    function renderFilteredLeadsTable(allLeads = []) {
      const tableWrap = container.querySelector('#drawer-table-wrap');
      if (!tableWrap) return;

      let filtered = allLeads;

      if (drawerFilter === 'active') {
        filtered = filtered.filter((l) => (l.resolvedStatus || l.status) === 'active' || (l.resolvedStatus || l.status) === 'running');
      } else if (drawerFilter === 'waiting') {
        filtered = filtered.filter((l) => (l.resolvedStatus || l.status) === 'waiting');
      } else if (drawerFilter === 'replied') {
        filtered = filtered.filter((l) => (l.resolvedStatus || l.status) === 'replied');
      } else if (drawerFilter === 'completed') {
        filtered = filtered.filter((l) => (l.resolvedStatus || l.status) === 'completed');
      } else if (drawerFilter === 'failed') {
        filtered = filtered.filter((l) => (l.resolvedStatus || l.status) === 'failed');
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
            <div style="display: flex; justify-content: center; margin-bottom: 8px; color: #94a3b8;">${ICONS.search}</div>
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
                const status = lead.resolvedStatus || lead.status || 'active';
                const isWaitingAcceptance =
                  lead.parkReason === 'waiting_acceptance' ||
                  /waiting for invite acceptance/i.test(lead.lastError || '');
                const badgeClass = `badge-status-${status}`;
                const badgeLabel = (status === 'waiting' && isWaitingAcceptance) ? 'WAITING ACCEPT' : status.toUpperCase();
                const countdown = formatCountdown(lead.nextRunAt, status);

                let lastResultHtml = '<span style="color:#94a3b8; font-size:11.5px;">Not started</span>';
                if (isWaitingAcceptance) {
                  lastResultHtml = `<span style="color:#2563eb; font-size:11.5px; font-weight:600; display:inline-flex; align-items:center; gap:4px;">${ICONS.clock || ''} Waiting for accept</span>`;
                } else if (lead.lastError) {
                  const shortErr = lead.lastError.length > 30 ? lead.lastError.slice(0, 30) + '...' : lead.lastError;
                  lastResultHtml = `<span style="color:#ef4444; font-size:11.5px; font-weight:600; display:inline-flex; align-items:center; gap:4px;" title="${lead.lastError}">${ICONS.warning} ${shortErr}</span>`;
                } else if (lead.replied) {
                  lastResultHtml = `<span style="color:#16a34a; font-weight:600; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;">${ICONS.message} Replied</span>`;
                } else if (lead.lastActionAt) {
                  lastResultHtml = `<span style="color:#64748b; font-size:11.5px;">${formatTimeAgo(lead.lastActionAt)}</span>`;
                }

                return `
                  <tr>
                    <td>
                      <div class="lead-meta-cell">
                        <div class="lead-name-row">
                          <span class="btn-open-lead-timeline" data-public-id="${lead.publicId}" style="cursor:pointer; font-weight:600; color:#1e293b; text-decoration:underline decoration-dotted;" title="Click to view outreach timeline">${lead.fullName}</span>
                          ${lead.email ? `<span style="display:inline-flex; align-items:center; color:#104B35; cursor:pointer;" title="${lead.email}">${ICONS.email}</span>` : ''}
                        </div>
                        <div class="lead-company-sub">${lead.company || lead.publicId}</div>
                      </div>
                    </td>
                    <td>
                      <span style="font-weight:600; color:#1e293b; font-size:12px;">${lead.currentStepLabel}</span>
                    </td>
                    <td>
                      <span class="badge-status ${badgeClass}">${badgeLabel}</span>
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
          window.removeEventListener('crafture:storage-change', handleStorageChange);
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
      window.addEventListener('crafture:storage-change', handleStorageChange);
    } catch {
      /* runtime message listener is best-effort */
    }
  }

  // =========================================================================
  // STATE B: 3-Step Campaign Creation Wizard (Frames 11–13)
  // =========================================================================
  function renderWizard() {
    document.querySelectorAll('.pipeline-popover-menu, .step-insert-menu, .delay-dropdown-menu').forEach((p) => p.remove());
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
            <button type="button" class="btn-back-link" id="btn-cancel-wizard" style="display:inline-flex; align-items:center; gap:6px;">
              ${ICONS.arrowLeft} Back to Campaigns
            </button>
            <h2 class="view-main-title">Create a Campaign</h2>
          </div>

          <div class="wizard-head-center">
            <div style="display: flex; align-items: center; gap: 6px; background: #E6EFE9; border: 1px solid #DCE5DE; padding: 6px 14px; border-radius: 20px; font-size: 12px; color: #104B35; font-weight: 700;">
              <span style="display:inline-flex; align-items:center; gap:4px;">${ICONS.email} Outreach Sender:</span>
              <span style="font-weight: 600; color: #9a3412;">${activeSenderEmail || 'Google Workspace / Gmail'}</span>
            </div>
          </div>

          <!-- Breadcrumbs (Frames 11-13) -->
          <div class="wizard-breadcrumbs">
            <div class="breadcrumb-step ${wizardStep === 1 ? 'is-active' : ''} ${wizardStep > 1 ? 'is-done' : ''}">
              <span class="step-num">1</span>
              <span class="step-label">Pick Template</span>
            </div>
            <span class="breadcrumb-separator" style="display:inline-flex; align-items:center;">${ICONS.chevronRight}</span>
            <div class="breadcrumb-step ${wizardStep === 2 ? 'is-active' : ''} ${wizardStep > 2 ? 'is-done' : ''}">
              <span class="step-num">2</span>
              <span class="step-label">Add Prospects</span>
            </div>
            <span class="breadcrumb-separator" style="display:inline-flex; align-items:center;">${ICONS.chevronRight}</span>
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

              <!-- Templates Grid (Custom + Crafture Network sequences) -->
              <div class="templates-grid">
                ${filteredTemplates
                  .map(
                    (tpl) => `
                  <div class="template-card ${selectedTemplate.id === tpl.id ? 'is-selected' : ''}" data-tpl-id="${tpl.id}" tabindex="0" role="button">
                    <div class="tpl-head">
                      <div class="tpl-icon-box">${tpl.icon}</div>
                      <div class="tpl-tags">
                        ${tpl.tags.map((t) => `<span class="tpl-tag-pill">${t}</span>`).join('')}
                      </div>
                      ${tpl.badge ? `<span style="background:#E6EFE9; color:#104B35; border:1px solid #DCE5DE; font-size:10.5px; font-weight:800; padding:2px 8px; border-radius:12px; margin-left:auto;">${tpl.badge}</span>` : ''}
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
                    <button type="button" class="btn-pill btn-soft btn-sm btn-select-tpl" style="margin-top: 14px; width: 100%; display:inline-flex; align-items:center; justify-content:center; gap:6px;">
                      ${selectedTemplate.id === tpl.id ? `<span style="display:inline-flex; align-items:center; gap:4px;">${ICONS.check} Selected</span>` : `<span style="display:inline-flex; align-items:center; gap:4px;">Choose Template ${ICONS.arrowRight}</span>`}
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

              <!-- Lead Source Indicator -->
              <div class="step-source-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; background: #ffffff; padding: 10px 16px; border-radius: 12px; border: 1px solid #e2e8f0;">
                <span style="font-size: 13px; font-weight: 700; color: #1e293b; display: inline-flex; align-items: center; gap: 6px;">
                  ${ICONS.user} Prospect Source: Saved Lists
                </span>
                <span style="font-size: 12px; font-weight: 600; color: #64748b; background: #f1f5f9; padding: 3px 10px; border-radius: 9999px;">
                  ${profiles.length} total saved leads
                </span>
              </div>

              <div class="cn-card" style="margin-top: 16px;">
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

                <!-- Auto-enrichment toggle card -->
                <div style="display: flex; align-items: flex-start; justify-content: space-between; padding: 14px 16px; background: #E6EFE9; border: 1px solid #DCE5DE; border-radius: 12px; margin-top: 16px;">
                  <div style="display: flex; gap: 12px; align-items: flex-start;">
                    <span style="font-size: 20px; line-height: 1; display:inline-flex; color:#104B35;">${ICONS.lightning}</span>
                    <div>
                      <strong style="font-size: 13.5px; color: #9a3412; display: block; margin-bottom: 3px;">Auto-enrich missing work emails</strong>
                      <span style="font-size: 12px; color: #c2410c; line-height: 1.4; display: block;">
                        If an enrolled prospect doesn't have an email address, Crafture will automatically find and verify their work email before sending email steps.
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
                <button type="button" class="btn-pill btn-secondary" id="btn-step2-back" style="display:inline-flex; align-items:center; gap:6px;">
                  ${ICONS.arrowLeft} Back
                </button>
                <button type="button" class="btn-pill btn-primary" id="btn-step2-next" style="display:inline-flex; align-items:center; gap:6px;">
                  Next: Sequence & Copy ${ICONS.arrowRight}
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
                <p class="step-subtitle">Fully customize delays, delete steps, or insert custom touchpoints (+). Click any step to edit its content.</p>
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

              <!-- Quick-Add Step Bar -->
              <div class="quick-add-steps-bar" style="display: flex; align-items: center; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; background: #ffffff; padding: 12px 18px; border-radius: 16px; border: 1px solid rgba(255, 255, 255, 0.85); box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);">
                <span style="font-size: 12.5px; font-weight: 700; color: #475569; display: inline-flex; align-items: center; gap: 5px; margin-right: 4px;">
                  ${ICONS.lightning} Quick-Add Step:
                </span>
                <button type="button" class="btn-quick-add" data-step-type="view" title="Append Profile Visit">${ICONS.visit} + Profile Visit</button>
                <button type="button" class="btn-quick-add" data-step-type="follow" title="Append Follow Profile">${ICONS.user} + Follow</button>
                <button type="button" class="btn-quick-add" data-step-type="like" title="Append Like Recent Post">${ICONS.lightning} + Like Post</button>
                <button type="button" class="btn-quick-add" data-step-type="endorse" title="Append Endorse Skill">${ICONS.sparkles} + Endorse</button>
                <button type="button" class="btn-quick-add" data-step-type="invite" title="Append Send Invite">${ICONS.invitation} + Send Invite</button>
                <button type="button" class="btn-quick-add" data-step-type="message" title="Append LinkedIn DM">${ICONS.message} + LinkedIn DM</button>
                <button type="button" class="btn-quick-add" data-step-type="email" title="Append Cold Email">${ICONS.email} + Cold Email</button>
              </div>

              <!-- Horizontal Visual Node Flow Canvas -->
              <div class="cn-card flow-canvas-card">
                <div class="canvas-header-bar" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
                  <span class="canvas-header-label" style="font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin: 0;">
                    VISUAL SEQUENCE PIPELINE (CLICK ANY STEP TO EDIT)
                  </span>
                  <div class="canvas-safety-pills" style="display: flex; align-items: center; gap: 8px;">
                    <span class="flow-condition-pill" style="font-size: 11px; background: #ecfdf5; color: #059669; border-color: #a7f3d0; padding: 3px 9px;">
                      ${ICONS.shield} Auto-stop on Reply
                    </span>
                    <span class="flow-condition-pill" style="font-size: 11px; background: #E6EFE9; color: #c2410c; border-color: #DCE5DE; padding: 3px 9px;">
                      ${ICONS.clock} Pacing: ~${Math.max(1, Math.ceil(prospectCount / 20))} days (${prospectCount} prospects)
                    </span>
                  </div>
                </div>
                ${renderHorizontalFlow(pipelineSteps, prospectCount, true, activeStepIdx)}
              </div>

              <!-- Dynamic Step Content Editor -->
              ${(() => {
                if (pipelineSteps.length === 0) {
                  return `
                    <div class="cn-card" style="margin-top: 20px; text-align: center; padding: 30px;">
                      <p style="color: var(--text-muted); font-size: 14px;">Your sequence has no action steps. Click any button in the <strong>Quick-Add Step Bar</strong> above to add a step.</p>
                    </div>
                  `;
                }

                if (activeStepIdx >= pipelineSteps.length) {
                  activeStepIdx = Math.max(0, pipelineSteps.length - 1);
                }
                const curStep = pipelineSteps[activeStepIdx];
                const sampleLead = getSampleLead();

                // Non-copy warm-touch steps
                if (['view', 'follow', 'like', 'endorse', 'wait'].includes(curStep.type)) {
                  return `
                    <div class="cn-card warm-touch-editor-card" style="margin-top: 20px;">
                      <div class="editor-head" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 14px; margin-bottom: 18px;">
                        <div class="editor-title-row" style="display: flex; align-items: center; gap: 12px;">
                          <span class="editor-icon-circle" style="width: 40px; height: 40px; border-radius: 12px; background: #E6EFE9; color: #104B35; display: flex; align-items: center; justify-content: center; font-size: 18px;">
                            ${curStep.icon || ICONS.lightning}
                          </span>
                          <div>
                            <span class="editor-title" style="font-size: 16px; font-weight: 700; color: var(--text-primary); display: block;">
                              ${curStep.title || curStep.type}
                            </span>
                            <span style="font-size: 12px; color: var(--text-muted);">
                              Step ${activeStepIdx + 1} of ${pipelineSteps.length} · Automated Warm Touch
                            </span>
                          </div>
                        </div>
                        <div style="background: #f1f5f9; color: #475569; font-size: 11.5px; font-weight: 600; padding: 4px 10px; border-radius: 9999px;">
                          Zero Outreach Copy Required
                        </div>
                      </div>

                      <div style="padding: 16px 18px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; margin-bottom: 20px;">
                        <h4 style="margin: 0 0 6px 0; font-size: 13.5px; font-weight: 700; color: #1e293b;">How this touchpoint works</h4>
                        <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                          ${getStepExplanation(curStep.type)}
                        </p>
                      </div>

                      <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; margin-bottom: 24px;">
                        <div>
                          <strong style="font-size: 13px; color: var(--text-primary); display: block;">Step Delay</strong>
                          <span style="font-size: 12px; color: var(--text-muted);">Wait time before executing this action after the previous step.</span>
                        </div>
                        <select class="form-input wizard-step-delay-select" style="width: auto; font-size: 12.5px; padding: 6px 12px; font-weight: 600;">
                          ${DELAY_OPTIONS.map((opt) => `
                            <option value="${opt.ms}" ${Number(curStep.delayMs || 0) === opt.ms ? 'selected' : ''}>${opt.label}</option>
                          `).join('')}
                        </select>
                      </div>

                      <div class="editor-foot-actions" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px;">
                        <div style="display: flex; gap: 8px;">
                          <button type="button" class="btn-pill btn-secondary" id="btn-step3-back" style="display:inline-flex; align-items:center; gap:6px;">
                            ${ICONS.arrowLeft} Back
                          </button>
                          <button type="button" class="btn-pill btn-secondary btn-step-remove" style="display:inline-flex; align-items:center; gap:6px; color: #ef4444; border-color: #fee2e2;">
                            ${ICONS.x} Remove Step
                          </button>
                          ${activeStepIdx < pipelineSteps.length - 1 ? `
                            <button type="button" class="btn-pill btn-secondary btn-step-next" style="display:inline-flex; align-items:center; gap:6px;">
                              Next Step ${ICONS.arrowRight}
                            </button>
                          ` : ''}
                        </div>
                        <button type="button" class="btn-pill btn-primary btn-launch-big" id="btn-launch-campaign">
                          ${ICONS.rocket} Launch Campaign Now
                        </button>
                      </div>
                    </div>
                  `;
                }

                if (curStep.abEnabled) {
                  ensureStepVariants(curStep, customNote);
                }
                const curVariant = curStep.abEnabled
                  ? (curStep.variants?.find((v) => v.id === curStep._activeVariant) || curStep.variants?.[0] || null)
                  : null;

                const renderAbHeader = () => `
                  <div class="ab-toggle-box" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #E6EFE9; border: 1px solid #DCE5DE; border-radius: 10px; margin-bottom: 14px;">
                    <div>
                      <strong style="font-size: 13px; color: #9a3412; display: flex; align-items: center; gap: 6px;">
                        ${ICONS.sparkles} A/B Test (Variant A / B)
                      </strong>
                      <span style="font-size: 11.5px; color: #7c2d12;">Split outreach 50/50 across prospects to compare real-world acceptance & reply rates.</span>
                    </div>
                    <label class="toggle-switch">
                      <input type="checkbox" id="wizard-ab-toggle" class="wizard-ab-toggle" ${curStep.abEnabled ? 'checked' : ''} />
                      <span class="slider"></span>
                    </label>
                  </div>

                  ${curStep.abEnabled ? `
                    <div class="ab-variant-tabs" style="display: flex; align-items: center; gap: 8px; margin-bottom: 14px; background: #f8fafc; padding: 4px; border-radius: 8px; border: 1px solid #e2e8f0; width: fit-content;">
                      <button type="button" class="btn-pill btn-variant-tab ${curStep._activeVariant === 'A' ? 'btn-primary' : 'btn-secondary'}" data-variant="A" style="font-size: 12px; padding: 4px 14px; height: 30px;">
                        Variant A ${curStep.winningVariant === 'A' ? '🏆 Winner' : ''}
                      </button>
                      <button type="button" class="btn-pill btn-variant-tab ${curStep._activeVariant === 'B' ? 'btn-primary' : 'btn-secondary'}" data-variant="B" style="font-size: 12px; padding: 4px 14px; height: 30px;">
                        Variant B ${curStep.winningVariant === 'B' ? '🏆 Winner' : ''}
                      </button>
                    </div>
                  ` : ''}
                `;

                // Cold Email Step
                if (curStep.type === 'email') {
                  const subjectValue = curStep.abEnabled ? (curVariant?.subject || '') : (curStep.subject || '');
                  const bodyValue = curStep.abEnabled ? (curVariant?.body || '') : (curStep.body || '');
                  return `
                    <div class="cn-card message-editor-card" style="margin-top: 20px;">
                      <div class="editor-head" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 14px;">
                        <div class="editor-title-row" style="display: flex; align-items: center; gap: 10px;">
                          <span class="editor-icon" style="color: #104B35;">${ICONS.email}</span>
                          <div>
                            <span class="editor-title" style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${curStep.title || 'Cold Email'}</span>
                            <span style="font-size: 12px; color: var(--text-muted); display: block;">Step ${activeStepIdx + 1} of ${pipelineSteps.length} (Click any node above to edit that step)</span>
                          </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; background: #E6EFE9; border: 1px solid #DCE5DE; padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #104B35; font-weight: 600;">
                          <span style="display:inline-flex; align-items:center; gap:4px;">${ICONS.email} Sender:</span>
                          <strong>${activeSenderEmail || 'Google Workspace / Gmail'}</strong>
                        </div>
                      </div>

                      ${renderAbHeader()}

                      <!-- Template Picker & Live Preview Toggle Bar -->
                      <div class="template-picker-row" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; background: #f8fafc; padding: 10px 14px; border-radius: 12px; border: 1px solid #e2e8f0;">
                        <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                          <span style="font-size: 12px; font-weight: 700; color: #475569; display: inline-flex; align-items: center; gap: 4px;">
                            ${ICONS.sheets} Template:
                          </span>
                          <select class="form-input select-load-saved-template" style="font-size: 12px; padding: 4px 8px; height: 30px; max-width: 280px;">
                            <option value="">-- Load Saved Template --</option>
                            ${renderTemplateSelectOptions('email', savedMessageTemplates)}
                          </select>
                        </div>
                        <button type="button" class="btn-toggle-live-preview ${isLivePreview ? 'is-active' : ''}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: 1px solid ${isLivePreview ? '#104B35' : '#cbd5e1'}; background: ${isLivePreview ? '#E6EFE9' : '#ffffff'}; color: ${isLivePreview ? '#104B35' : '#475569'}; cursor: pointer;">
                          ${isLivePreview ? ICONS.sparkles : ICONS.eye}
                          ${isLivePreview ? 'Back to Editor' : 'Live Preview'}
                        </button>
                      </div>

                      ${isLivePreview ? `
                        <div class="live-preview-box">
                          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px dashed #fdba74; padding-bottom: 8px;">
                            <span style="font-size: 11.5px; font-weight: 700; color: #167448; display: inline-flex; align-items: center; gap: 5px;">
                              ${ICONS.sparkles} Live Preview for: <strong>${sampleLead.fullName || sampleLead.firstName} (${sampleLead.company})</strong>
                            </span>
                            <span style="font-size: 11px; color: #9a3412;">Variables & Spintax dynamically resolved</span>
                          </div>
                          <div style="font-size: 13px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">
                            <span style="color: #64748b; font-weight: 600;">Subject:</span> ${renderTemplate(subjectValue, sampleLead)}
                          </div>
                          <div style="font-size: 13.5px; line-height: 1.5; color: #334155; white-space: pre-wrap;">${renderTemplate(bodyValue, sampleLead)}</div>
                        </div>
                      ` : `
                        <div class="form-group" style="margin-bottom: 14px;">
                          <label style="font-size: 12.5px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px; display: flex; justify-content: space-between;">
                            <span>Subject Line</span>
                            <span style="font-size: 11.5px; color: var(--text-muted); font-weight: normal;">Supports {{variables}} & Spintax</span>
                          </label>
                          <input type="text" id="wizard-email-subject" class="form-input" value="${subjectValue}" placeholder="e.g. Quick question regarding {{company|your company}}" />
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
                          <textarea id="wizard-email-body" class="form-input editor-textarea" rows="7" placeholder="Hi {{firstName|there}},&#10;&#10;...">${bodyValue}</textarea>
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
                      `}

                      <div class="editor-foot-actions" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px;">
                        <div style="display: flex; gap: 8px;">
                          <button type="button" class="btn-pill btn-secondary" id="btn-step3-back" style="display:inline-flex; align-items:center; gap:6px;">${ICONS.arrowLeft} Back</button>
                          <button type="button" class="btn-pill btn-secondary btn-step-remove" style="display:inline-flex; align-items:center; gap:6px; color: #ef4444; border-color: #fee2e2;">${ICONS.x} Remove Step</button>
                          ${activeStepIdx < pipelineSteps.length - 1 ? `
                            <button type="button" class="btn-pill btn-secondary btn-step-next" style="display:inline-flex; align-items:center; gap:6px;">Next Step ${ICONS.arrowRight}</button>
                          ` : ''}
                        </div>
                        <button type="button" class="btn-pill btn-primary btn-launch-big" id="btn-launch-campaign">
                          ${ICONS.rocket} Launch Campaign Now
                        </button>
                      </div>
                    </div>
                  `;
                }

                // LinkedIn Message Step
                if (curStep.type === 'message') {
                  const bodyValue = curStep.abEnabled ? (curVariant?.body || '') : (curStep.body || '');
                  return `
                    <div class="cn-card message-editor-card" style="margin-top: 20px;">
                      <div class="editor-head" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 14px;">
                        <div class="editor-title-row" style="display: flex; align-items: center; gap: 10px;">
                          <span class="editor-icon" style="color: #104B35;">${ICONS.message}</span>
                          <div>
                            <span class="editor-title" style="font-size: 15px; font-weight: 700; color: var(--text-primary);">${curStep.title || 'LinkedIn Message'}</span>
                            <span style="font-size: 12px; color: var(--text-muted); display: block;">Step ${activeStepIdx + 1} of ${pipelineSteps.length} (Click any node above to edit that step)</span>
                          </div>
                        </div>
                      </div>

                      <!-- Auto-Parks Info Badge -->
                      <div style="padding: 12px 16px; background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 12px; color: #0369a1; font-size: 12.5px; margin-bottom: 14px; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 18px; color: #0284c7;">${ICONS.clock}</span>
                        <div>
                          <strong>Auto-parks 12h until connection accepted:</strong> Crafture automatically monitors acceptance before sending direct messages.
                        </div>
                      </div>

                      ${renderAbHeader()}

                      <!-- Template Picker & Live Preview Toggle Bar -->
                      <div class="template-picker-row" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; background: #f8fafc; padding: 10px 14px; border-radius: 12px; border: 1px solid #e2e8f0;">
                        <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                          <span style="font-size: 12px; font-weight: 700; color: #475569; display: inline-flex; align-items: center; gap: 4px;">
                            ${ICONS.sheets} Template:
                          </span>
                          <select class="form-input select-load-saved-template" style="font-size: 12px; padding: 4px 8px; height: 30px; max-width: 280px;">
                            <option value="">-- Load Saved Template --</option>
                            ${renderTemplateSelectOptions('message', savedMessageTemplates)}
                          </select>
                        </div>
                        <button type="button" class="btn-toggle-live-preview ${isLivePreview ? 'is-active' : ''}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: 1px solid ${isLivePreview ? '#104B35' : '#cbd5e1'}; background: ${isLivePreview ? '#E6EFE9' : '#ffffff'}; color: ${isLivePreview ? '#104B35' : '#475569'}; cursor: pointer;">
                          ${isLivePreview ? ICONS.sparkles : ICONS.eye}
                          ${isLivePreview ? 'Back to Editor' : 'Live Preview'}
                        </button>
                      </div>

                      ${isLivePreview ? `
                        <div class="live-preview-box">
                          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px dashed #fdba74; padding-bottom: 8px;">
                            <span style="font-size: 11.5px; font-weight: 700; color: #167448; display: inline-flex; align-items: center; gap: 5px;">
                              ${ICONS.sparkles} Live Preview for: <strong>${sampleLead.fullName || sampleLead.firstName} (${sampleLead.company})</strong>
                            </span>
                            <span style="font-size: 11px; color: #9a3412;">Variables & Spintax dynamically resolved</span>
                          </div>
                          <div style="font-size: 13.5px; line-height: 1.5; color: #334155; white-space: pre-wrap;">${renderTemplate(bodyValue, sampleLead)}</div>
                        </div>
                      ` : `
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
                          <textarea id="wizard-message-body" class="form-input editor-textarea" rows="5" placeholder="Hi {{firstName|there}},&#10;&#10;...">${bodyValue}</textarea>
                        </div>
                      `}

                      <div class="editor-foot-actions" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px;">
                        <div style="display: flex; gap: 8px;">
                          <button type="button" class="btn-pill btn-secondary" id="btn-step3-back" style="display:inline-flex; align-items:center; gap:6px;">${ICONS.arrowLeft} Back</button>
                          <button type="button" class="btn-pill btn-secondary btn-step-remove" style="display:inline-flex; align-items:center; gap:6px; color: #ef4444; border-color: #fee2e2;">${ICONS.x} Remove Step</button>
                          ${activeStepIdx < pipelineSteps.length - 1 ? `
                            <button type="button" class="btn-pill btn-secondary btn-step-next" style="display:inline-flex; align-items:center; gap:6px;">Next Step ${ICONS.arrowRight}</button>
                          ` : ''}
                        </div>
                        <button type="button" class="btn-pill btn-primary btn-launch-big" id="btn-launch-campaign">
                          ${ICONS.rocket} Launch Campaign Now
                        </button>
                      </div>
                    </div>
                  `;
                }

                // Invite step
                const noteValue = curStep.abEnabled
                  ? (curVariant?.note !== undefined ? curVariant.note : (curStep.note !== undefined ? curStep.note : customNote))
                  : (curStep.note !== undefined ? curStep.note : customNote);
                return `
                  <div class="cn-card message-editor-card" style="margin-top: 20px;">
                    <div class="editor-head" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 14px;">
                      <div class="editor-title-row" style="display: flex; align-items: center; gap: 10px;">
                        <span class="editor-icon" style="color: #104B35;">${ICONS.invitation}</span>
                        <div>
                          <span class="editor-title" style="font-size: 15px; font-weight: 700; color: var(--text-primary);">Connection Request Note</span>
                          <span style="font-size: 12px; color: var(--text-muted); display: block;">Step ${activeStepIdx + 1} of ${pipelineSteps.length} (Click any node above to edit that step)</span>
                        </div>
                      </div>
                      ${!curStep.sendBlank ? `<span class="char-counter" id="note-char-counter">${(noteValue || '').length} / 200</span>` : ''}
                    </div>

                    <!-- Send Blank Invite Toggle -->
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; margin-bottom: 14px;">
                      <div>
                        <strong style="font-size: 13px; color: var(--text-primary); display: block;">Send blank invite (no note)</strong>
                        <span style="font-size: 11.5px; color: var(--text-muted);">Blank connection requests often achieve 15–20% higher acceptance rates on LinkedIn.</span>
                      </div>
                      <label class="toggle-switch">
                        <input type="checkbox" id="wizard-invite-blank-toggle" ${curStep.sendBlank ? 'checked' : ''} />
                        <span class="slider"></span>
                      </label>
                    </div>

                    ${curStep.sendBlank ? `
                      <div style="padding: 16px 18px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; color: #065f46; font-size: 13px; margin-bottom: 16px; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 18px; color: #059669;">${ICONS.shield}</span>
                        <div>
                          <strong>Blank Invitation Mode Active:</strong> Crafture will send this connection request without a custom note for maximum acceptance velocity.
                        </div>
                      </div>
                    ` : `
                      ${renderAbHeader()}

                      <!-- Template Picker & Live Preview Toggle Bar -->
                      <div class="template-picker-row" style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px; background: #f8fafc; padding: 10px 14px; border-radius: 12px; border: 1px solid #e2e8f0;">
                        <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                          <span style="font-size: 12px; font-weight: 700; color: #475569; display: inline-flex; align-items: center; gap: 4px;">
                            ${ICONS.sheets} Template:
                          </span>
                          <select class="form-input select-load-saved-template" style="font-size: 12px; padding: 4px 8px; height: 30px; max-width: 280px;">
                            <option value="">-- Load Saved Template --</option>
                            ${renderTemplateSelectOptions('invitation', savedMessageTemplates)}
                          </select>
                        </div>
                        <button type="button" class="btn-toggle-live-preview ${isLivePreview ? 'is-active' : ''}" style="display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 8px; border: 1px solid ${isLivePreview ? '#104B35' : '#cbd5e1'}; background: ${isLivePreview ? '#E6EFE9' : '#ffffff'}; color: ${isLivePreview ? '#104B35' : '#475569'}; cursor: pointer;">
                          ${isLivePreview ? ICONS.sparkles : ICONS.eye}
                          ${isLivePreview ? 'Back to Editor' : 'Live Preview'}
                        </button>
                      </div>

                      ${isLivePreview ? `
                        <div class="live-preview-box">
                          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px dashed #fdba74; padding-bottom: 8px;">
                            <span style="font-size: 11.5px; font-weight: 700; color: #167448; display: inline-flex; align-items: center; gap: 5px;">
                              ${ICONS.sparkles} Live Preview for: <strong>${sampleLead.fullName || sampleLead.firstName} (${sampleLead.company})</strong>
                            </span>
                            <span style="font-size: 11px; color: #9a3412;">Variables & Spintax dynamically resolved</span>
                          </div>
                          <div style="font-size: 13.5px; line-height: 1.5; color: #334155; white-space: pre-wrap;">${renderTemplate(noteValue, sampleLead)}</div>
                        </div>
                      ` : `
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

                        <textarea id="wizard-note-textarea" class="form-input editor-textarea" rows="4" maxlength="200" placeholder="Hi {{firstName|there}} — would love to connect!">${noteValue}</textarea>

                        <div class="ai-toggle-box" style="margin-top: 12px;">
                          <label class="toggle-switch">
                            <input type="checkbox" id="wizard-ai-toggle" ${useAiHook ? 'checked' : ''} />
                            <span class="slider"></span>
                          </label>
                          <div class="ai-toggle-text">
                            <span class="ai-toggle-title">${ICONS.sparkles} Use Groq/Gemini AI to generate unique personalized hook for each lead</span>
                            <span class="ai-toggle-sub">Dynamically inspects prospect headline and company to craft a contextual opening icebreaker.</span>
                          </div>
                        </div>
                      `}
                    `}

                    <div class="editor-foot-actions" style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px;">
                      <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn-pill btn-secondary" id="btn-step3-back" style="display:inline-flex; align-items:center; gap:6px;">${ICONS.arrowLeft} Back</button>
                        <button type="button" class="btn-pill btn-secondary btn-step-remove" style="display:inline-flex; align-items:center; gap:6px; color: #ef4444; border-color: #fee2e2;">${ICONS.x} Remove Step</button>
                        ${activeStepIdx < pipelineSteps.length - 1 ? `
                          <button type="button" class="btn-pill btn-secondary btn-step-next" style="display:inline-flex; align-items:center; gap:6px;">Next Step ${ICONS.arrowRight}</button>
                        ` : ''}
                      </div>
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
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
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

      // Quick-add Step Bar buttons
      container.querySelectorAll('.btn-quick-add').forEach((btn) => {
        btn.addEventListener('click', () => {
          const type = btn.dataset.stepType;
          const opt = INSERT_STEP_OPTIONS.find((o) => o.type === type);
          if (opt) {
            const newStep = {
              ...opt,
              id: 's_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            };
            pipelineSteps.push(newStep);
            activeStepIdx = pipelineSteps.length - 1;
            renderWizard();
            ctx.showToast?.(`Added "${opt.title}" to sequence!`, 'success');
          }
        });
      });

      // Load Saved Template Picker
      container.querySelector('.select-load-saved-template')?.addEventListener('change', (e) => {
        const val = e.target.value;
        if (!val) return;
        const curStep = pipelineSteps[activeStepIdx];
        if (!curStep) return;
        const normCat = curStep.type === 'invite' ? 'invitation' : curStep.type;
        let found = null;
        if (val.startsWith('user_')) {
          const id = val.replace('user_', '');
          found = savedMessageTemplates.find((t) => String(t.id) === id);
        } else if (val.startsWith('preset_')) {
          const id = val.replace('preset_', '');
          found = (CRAFTURE_PRESET_TEMPLATES[normCat] || []).find((p) => String(p.id) === id);
        }
        if (found) {
          if (curStep.type === 'invite') {
            customNote = found.content || '';
            curStep.note = customNote;
            curStep.sendBlank = false;
            if (curStep.abEnabled) {
              ensureStepVariants(curStep, customNote);
              const v = curStep.variants.find((v) => v.id === curStep._activeVariant) || curStep.variants[0];
              v.note = customNote;
            }
          } else if (curStep.type === 'message') {
            curStep.body = found.content || '';
            if (curStep.abEnabled) {
              ensureStepVariants(curStep);
              const v = curStep.variants.find((v) => v.id === curStep._activeVariant) || curStep.variants[0];
              v.body = curStep.body;
            }
          } else if (curStep.type === 'email') {
            curStep.body = found.content || '';
            if (found.subject) curStep.subject = found.subject;
            if (curStep.abEnabled) {
              ensureStepVariants(curStep);
              const v = curStep.variants.find((v) => v.id === curStep._activeVariant) || curStep.variants[0];
              v.body = curStep.body;
              if (found.subject) v.subject = found.subject;
            }
          }
          renderWizard();
          ctx.showToast?.(`Loaded "${found.name}" template!`, 'success');
        }
      });

      // A/B Test Toggle
      container.querySelector('#wizard-ab-toggle')?.addEventListener('change', (e) => {
        const step = pipelineSteps[activeStepIdx];
        if (step) {
          step.abEnabled = Boolean(e.target.checked);
          if (step.abEnabled) {
            ensureStepVariants(step, customNote);
          }
          renderWizard();
        }
      });

      // A/B Variant Tab Switch
      container.querySelectorAll('.btn-variant-tab').forEach((tabBtn) => {
        tabBtn.addEventListener('click', () => {
          const step = pipelineSteps[activeStepIdx];
          if (step && step.abEnabled) {
            ensureStepVariants(step, customNote);
            const curV = step.variants.find((v) => v.id === step._activeVariant) || step.variants[0];
            const noteEl = container.querySelector('#wizard-note-textarea');
            if (noteEl) {
              curV.note = noteEl.value;
              customNote = noteEl.value;
            }
            const bodyEl = container.querySelector('#wizard-message-body') || container.querySelector('#wizard-email-body');
            if (bodyEl) curV.body = bodyEl.value;
            const subEl = container.querySelector('#wizard-email-subject');
            if (subEl) curV.subject = subEl.value;

            step._activeVariant = tabBtn.dataset.variant;
            renderWizard();
          }
        });
      });

      // Live Preview Toggle
      container.querySelector('.btn-toggle-live-preview')?.addEventListener('click', () => {
        isLivePreview = !isLivePreview;
        renderWizard();
      });

      // Blank Invite Toggle
      container.querySelector('#wizard-invite-blank-toggle')?.addEventListener('change', (e) => {
        if (pipelineSteps[activeStepIdx]) {
          pipelineSteps[activeStepIdx].sendBlank = Boolean(e.target.checked);
          if (pipelineSteps[activeStepIdx].sendBlank) {
            pipelineSteps[activeStepIdx].note = '';
          }
          renderWizard();
        }
      });

      // Remove Step button from editor
      container.querySelector('.btn-step-remove')?.addEventListener('click', () => {
        if (pipelineSteps.length > 0 && activeStepIdx < pipelineSteps.length) {
          pipelineSteps.splice(activeStepIdx, 1);
          if (activeStepIdx >= pipelineSteps.length) {
            activeStepIdx = Math.max(0, pipelineSteps.length - 1);
          }
          renderWizard();
        }
      });

      // Next Step button from editor
      container.querySelector('.btn-step-next')?.addEventListener('click', () => {
        if (activeStepIdx < pipelineSteps.length - 1) {
          activeStepIdx++;
          renderWizard();
        }
      });

      // Step Delay Select in Warm-Touch Editor
      container.querySelector('.wizard-step-delay-select')?.addEventListener('change', (e) => {
        const ms = parseInt(e.target.value, 10);
        if (!isNaN(ms) && pipelineSteps[activeStepIdx]) {
          pipelineSteps[activeStepIdx].delayMs = ms;
          const canvasInner = container.querySelector('.flow-canvas-card .horizontal-node-canvas');
          if (canvasInner) {
            canvasInner.outerHTML = renderHorizontalFlow(pipelineSteps, getSelectedListProspectCount(), true, activeStepIdx);
            setupFlowCanvasEvents();
          }
        }
      });

      // Email Step Inputs
      container.querySelector('#wizard-email-subject')?.addEventListener('input', (e) => {
        if (pipelineSteps[activeStepIdx]) {
          const step = pipelineSteps[activeStepIdx];
          step.subject = e.target.value;
          if (step.abEnabled) {
            ensureStepVariants(step);
            const v = step.variants.find((v) => v.id === step._activeVariant) || step.variants[0];
            v.subject = e.target.value;
          }
        }
      });

      container.querySelector('#wizard-email-body')?.addEventListener('input', (e) => {
        if (pipelineSteps[activeStepIdx]) {
          const step = pipelineSteps[activeStepIdx];
          step.body = e.target.value;
          if (step.abEnabled) {
            ensureStepVariants(step);
            const v = step.variants.find((v) => v.id === step._activeVariant) || step.variants[0];
            v.body = e.target.value;
          }
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
          const step = pipelineSteps[activeStepIdx];
          step.body = e.target.value;
          if (step.abEnabled) {
            ensureStepVariants(step);
            const v = step.variants.find((v) => v.id === step._activeVariant) || step.variants[0];
            v.body = e.target.value;
          }
        }
      });

      // Invite Step Inputs
      const textarea = container.querySelector('#wizard-note-textarea');
      const counter = container.querySelector('#note-char-counter');

      textarea?.addEventListener('input', () => {
        customNote = textarea.value;
        const step = pipelineSteps[activeStepIdx];
        if (step && step.type === 'invite') {
          step.note = customNote;
          if (step.abEnabled) {
            ensureStepVariants(step, customNote);
            const v = step.variants.find((v) => v.id === step._activeVariant) || step.variants[0];
            v.note = customNote;
          }
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
              const curStep = pipelineSteps[activeStepIdx];
              if (curStep.abEnabled) {
                ensureStepVariants(curStep, customNote);
                const v = curStep.variants.find((v) => v.id === curStep._activeVariant) || curStep.variants[0];
                if (curStep.type === 'email') {
                  curStep.body = v.body = target.value;
                } else if (curStep.type === 'invite') {
                  customNote = target.value;
                  curStep.note = v.note = target.value;
                } else if (curStep.type === 'message') {
                  curStep.body = v.body = target.value;
                }
              } else {
                if (curStep.type === 'email') curStep.body = target.value;
                else if (curStep.type === 'invite') {
                  customNote = target.value;
                  curStep.note = target.value;
                } else if (curStep.type === 'message') curStep.body = target.value;
              }
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
      document.querySelectorAll('.pipeline-popover-menu, .step-insert-menu, .delay-dropdown-menu').forEach((p) => p.remove());
    }

    function refreshCanvas() {
      closeAnyPopover();
      const canvasInner = canvasCard.querySelector('.horizontal-node-canvas');
      if (canvasInner) {
        canvasInner.outerHTML = renderHorizontalFlow(pipelineSteps, getSelectedListProspectCount(), true, activeStepIdx);
        setupFlowCanvasEvents();
      }
    }

    function positionFloatingMenu(triggerBtn, menu, preferredWidth = 220) {
      if (!triggerBtn || !menu) return;
      document.body.appendChild(menu);

      const rect = triggerBtn.getBoundingClientRect();
      const menuWidth = preferredWidth;
      let left = rect.left + (rect.width / 2) - (menuWidth / 2);
      left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, left));

      let top = rect.bottom + 8;
      const approxHeight = 260;
      if (top + approxHeight > window.innerHeight && rect.top > approxHeight + 10) {
        top = Math.max(10, rect.top - approxHeight - 8);
      }

      menu.style.setProperty('position', 'fixed', 'important');
      menu.style.setProperty('z-index', '9999', 'important');
      menu.style.setProperty('top', `${Math.round(top)}px`, 'important');
      menu.style.setProperty('left', `${Math.round(left)}px`, 'important');
      menu.style.setProperty('transform', 'none', 'important');
      menu.style.setProperty('min-width', `${menuWidth}px`, 'important');
    }

    // Node Selection Click (Click node to open its editor drawer)
    canvasCard.querySelectorAll('.flow-node-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const el = e.target instanceof Element ? e.target : e.target?.parentElement;
        if (el?.closest('.btn-delete-node') || el?.closest('.btn-insert-node') || el?.closest('.delay-select-pill')) return;
        const sIdx = parseInt(card.dataset.stepIdx, 10);
        if (!isNaN(sIdx) && sIdx >= 0 && sIdx < pipelineSteps.length) {
          activeStepIdx = sIdx;
          closeAnyPopover();
          renderWizard();
        }
      });
    });

    // Step Deletion ([x] Button)
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

    // Delay Dropdown Menu Click (Floating popover)
    canvasCard.querySelectorAll('.delay-select-pill').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const connectorIdx = parseInt(btn.dataset.connectorIdx, 10);
        if (isNaN(connectorIdx) || !pipelineSteps[connectorIdx]) return;

        const existing = document.querySelector(`.delay-dropdown-menu[data-connector-idx="${connectorIdx}"]`);
        if (existing) {
          closeAnyPopover();
          return;
        }
        closeAnyPopover();

        const curStep = pipelineSteps[connectorIdx];
        const popover = document.createElement('div');
        popover.className = 'pipeline-popover-menu delay-dropdown-menu';
        popover.dataset.connectorIdx = String(connectorIdx);
        popover.innerHTML = DELAY_OPTIONS.map((opt) => `
          <button type="button" class="pipeline-popover-item ${Number(curStep.delayMs || 0) === opt.ms ? 'is-selected' : ''}" data-delay-ms="${opt.ms}" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <span style="font-weight: 600;">${opt.badge || opt.label}</span>
            <span style="font-size: 11px; opacity: 0.65; margin-left: 8px;">${opt.label}</span>
          </button>
        `).join('');

        positionFloatingMenu(btn, popover, 190);

        popover.querySelectorAll('.pipeline-popover-item').forEach((item) => {
          item.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const ms = parseInt(item.dataset.delayMs, 10);
            if (!isNaN(ms) && pipelineSteps[connectorIdx]) {
              pipelineSteps[connectorIdx].delayMs = ms;
              const warmDelaySel = container.querySelector('.wizard-step-delay-select');
              if (warmDelaySel && activeStepIdx === connectorIdx) {
                warmDelaySel.value = String(ms);
              }
              closeAnyPopover();
              refreshCanvas();
            }
          });
        });
      });
    });

    // Insert Step Button (+ Add Step)
    canvasCard.querySelectorAll('.btn-insert-node').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const insertIdx = parseInt(btn.dataset.insertIdx, 10);
        const existing = document.querySelector(`.step-insert-menu[data-insert-idx="${insertIdx}"]`);
        if (existing) {
          closeAnyPopover();
          return;
        }
        closeAnyPopover();

        const popover = document.createElement('div');
        popover.className = 'pipeline-popover-menu step-insert-menu insert-popover';
        popover.dataset.insertIdx = String(insertIdx);
        popover.innerHTML = INSERT_STEP_OPTIONS.map((opt, i) => `
          <button type="button" class="pipeline-popover-item" data-opt-idx="${i}">
            <span>${opt.icon}</span>
            <span>${opt.title}</span>
          </button>
        `).join('');

        positionFloatingMenu(btn, popover, 220);

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
              closeAnyPopover();
              renderWizard();
            }
          });
        });
      });
    });
  }

  // Global dismiss for popovers
  document.addEventListener('click', (e) => {
    const el = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (
      el?.closest('.btn-insert-node') ||
      el?.closest('.delay-select-pill') ||
      el?.closest('.step-insert-menu') ||
      el?.closest('.delay-dropdown-menu') ||
      el?.closest('.pipeline-popover-menu')
    ) {
      return;
    }
    container.querySelectorAll('.node-connector').forEach((c) => {
      c.style.zIndex = '';
    });
    document.querySelectorAll('.pipeline-popover-menu, .step-insert-menu, .delay-dropdown-menu').forEach((p) => p.remove());
  });

  window.addEventListener('scroll', (e) => {
    const el = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (el?.closest && (el.closest('.step-insert-menu') || el.closest('.delay-dropdown-menu') || el.closest('.pipeline-popover-menu'))) {
      return;
    }
    document.querySelectorAll('.pipeline-popover-menu, .step-insert-menu, .delay-dropdown-menu').forEach((p) => p.remove());
  }, { passive: true, capture: true });

  window.addEventListener('resize', () => {
    document.querySelectorAll('.pipeline-popover-menu, .step-insert-menu, .delay-dropdown-menu').forEach((p) => p.remove());
  }, { passive: true });

  let storageDebounceTimer = null;
  const storageListener = (changes, area) => {
    if (area !== 'local') return;
    const checkFn = ctx.isStorageChangeRelevant || isStorageChangeRelevant;
    if (checkFn && !checkFn(changes, CAMPAIGNS_RELEVANT_KEYS)) return;
    clearTimeout(storageDebounceTimer);
    storageDebounceTimer = setTimeout(async () => {
      if (!ctx.isActiveView || ctx.isActiveView()) {
        const freshCamps = await call(ACTIONS.CAMPAIGN_GET_ALL, {}).catch(() => []);
        campaigns = Array.isArray(freshCamps) ? freshCamps : (freshCamps?.campaigns || []);
        allStorage = await new Promise((r) => chrome.storage.local.get(null, r));
        if (viewState === 'list' && (!ctx.isActiveView || ctx.isActiveView())) {
          renderList();
        }
      }
    }, 400);
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(storageListener);
  }

  ctx.registerCleanup?.(() => {
    if (autoPilotInterval) clearInterval(autoPilotInterval);
    if (typeof drawerInterval !== 'undefined' && drawerInterval) {
      clearInterval(drawerInterval);
      drawerInterval = null;
    }
    clearTimeout(storageDebounceTimer);
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(storageListener);
    }
  });

  render();
}
