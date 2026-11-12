/**
 * OutFox — Telegram Autonomous AI SDR Engine.
 * Features:
 * - Bulletproof Markdown Entity Delivery & Plain Text Fallback
 * - Conversational Sequence Step Editing (Step 2 Invite, Step 3 Follow-up, Name)
 * - Dynamic Live Workspace Context Injection (lists, campaigns, candidates, quotas)
 * - Autonomous Sequence Blueprint Architect & Visual Pre-Flight Approval Cards
 * - Fuzzy Disambiguation ("Did You Mean?")
 * - Full Lifecycle Push Alerts (CAMPAIGN_COMPLETED, QUOTA_HIT, CHALLENGE_DETECTED, INBOUND REPLIES)
 * - Multi-Candidate Persona Switcher & Apollo/Hunter Waterfall Enrichment
 * - Groq Whisper Voice Transcriber & 1-Tap Booking Closer
 */

import { ACTIONS, ERROR, EVENTS, EngineError } from '../lib/actions.js';
import { getConfig, setConfig } from '../lib/config.js';
import { register } from './engine.js';
import * as voyager from './voyager.js';
import * as campaigns from './campaigns.js';
import * as lists from './lists.js';
import { onEvent } from './events.js';
import { getLiveDashboardStats } from './stats.js';
import { snapshotAll } from './quota.js';
import { addToBlacklist, addCompanyToBlacklist, getStoredProfile, get, set } from '../lib/storage.js';
import { getActiveCandidate, setActiveCandidate, getAllCandidates } from './candidates.js';
import { enrichLead } from './enrich.js';
import { matchAndAdaptObjection, snoozeLead, popDueSnoozes } from './objections.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
let isPolling = false;
let pollAbortController = null;
let lastUpdateId = 0;
let lastSearchedList = 'data analyst USA';

// In-Memory Real-Time CRM, Blueprint & Closer Caches
const recentAlertDedupe = new Map(); // key -> timestamp (10 min cache)
const lastInboundReplies = new Map(); // publicId -> { body, sentiment, intent, at }
const pendingDrafts = new Map(); // draftId -> { publicId, text, at }
const pendingBlueprints = new Map(); // blueprintId -> blueprint object

// Storage Keys for MV3 Service Worker Sleep Resilience
const BLUEPRINTS_STORAGE_KEY = 'outfox_pending_blueprints';
const CHAT_HISTORY_KEY = 'outfox_chat_history';

export async function getStoredBlueprints() {
  const map = (await get(BLUEPRINTS_STORAGE_KEY, {})) || {};
  return typeof map === 'object' && !Array.isArray(map) ? map : {};
}

export async function saveStoredBlueprint(blueprintId, blueprint) {
  const map = await getStoredBlueprints();
  map[blueprintId] = blueprint;
  pendingBlueprints.set(blueprintId, blueprint);
  await set(BLUEPRINTS_STORAGE_KEY, map);
}

export async function getLatestBlueprint() {
  const map = await getStoredBlueprints();
  const keys = Object.keys(map);
  if (!keys.length) {
    if (pendingBlueprints.size > 0) {
      const arr = Array.from(pendingBlueprints.values());
      return arr[arr.length - 1];
    }
    return null;
  }
  return map[keys[keys.length - 1]];
}

export async function removeStoredBlueprint(blueprintId) {
  const map = await getStoredBlueprints();
  delete map[blueprintId];
  pendingBlueprints.delete(blueprintId);
  await set(BLUEPRINTS_STORAGE_KEY, map);
}

// Persisted Multi-Turn Chat History Buffer
export const chatHistory = []; // In-memory compatibility alias
export async function recordChatTurn(role, text) {
  if (!text || typeof text !== 'string') return;
  const history = (await get(CHAT_HISTORY_KEY, [])) || [];
  const clean = text.replace(/[*_`\[\]]/g, '').trim().slice(0, 500);
  if (!clean) return;
  history.push({ role, content: clean, at: Date.now() });
  if (history.length > 16) history.splice(0, history.length - 16);
  await set(CHAT_HISTORY_KEY, history);
}

export async function getRecentChatTurns() {
  const history = (await get(CHAT_HISTORY_KEY, [])) || [];
  const now = Date.now();
  const active = history.filter((m) => now - (m.at || 0) < 7200000); // 2 hours
  return active.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }));
}

async function cleanOldCaches() {
  const now = Date.now();
  if (recentAlertDedupe.size > 1000) {
    for (const [k, time] of recentAlertDedupe.entries()) {
      if (now - time > 15 * 60 * 1000) recentAlertDedupe.delete(k);
    }
  }
  if (pendingDrafts.size > 200) {
    for (const [id, d] of pendingDrafts.entries()) {
      if (now - d.at > 24 * 60 * 60 * 1000) pendingDrafts.delete(id);
    }
  }
  try {
    const map = await getStoredBlueprints();
    let changed = false;
    for (const [id, bp] of Object.entries(map)) {
      if (now - (bp.createdAt || 0) > 24 * 60 * 60 * 1000) {
        delete map[id];
        pendingBlueprints.delete(id);
        changed = true;
      }
    }
    if (changed) await set(BLUEPRINTS_STORAGE_KEY, map);
  } catch (_) {}
}

export function maskToken(token) {
  if (!token || typeof token !== 'string') return '';
  if (token.length < 12) return '••••••••••••';
  return `${token.slice(0, 6)}••••••••${token.slice(-4)}`;
}

async function callTelegramApi(token, method, payload = {}) {
  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || `Telegram API error on ${method}`);
  return data.result;
}

// 🛡️ Bulletproof Telegram Message Dispatcher with Entity Error Fallback
export async function sendTelegramMessage(token, chatId, text, options = {}) {
  try {
    return await callTelegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...options,
    });
  } catch (err) {
    if (
      err.message &&
      (err.message.includes("can't parse entities") ||
        err.message.includes('entity') ||
        err.message.includes('parsing'))
    ) {
      console.warn('[Telegram] Markdown parse failed, falling back to plain text:', err.message);
      return await callTelegramApi(token, 'sendMessage', {
        chat_id: chatId,
        text: text.replace(/[*_`\[\]]/g, ''),
        disable_web_page_preview: true,
        ...options,
      });
    }
    throw err;
  }
}

export async function answerCallbackQuery(token, callbackQueryId, text = '') {
  try {
    await callTelegramApi(token, 'answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  } catch {}
}

async function sendTelegramAlert(text, options = {}) {
  try {
    const cfg = await getConfig();
    const tg = cfg.telegram || {};
    if (!tg.enabled || !tg.botToken || !tg.chatId) return;
    return await sendTelegramMessage(tg.botToken, tg.chatId, text, options);
  } catch (err) {
    console.warn('[Telegram Alert Error]', err?.message || err);
  }
}

// 🌐 Live Workspace Context Provider
export async function getLiveWorkspaceContext() {
  const [allLists, allCamps, activeCand, quotas] = await Promise.all([
    lists.getAll().catch(() => []),
    campaigns.getAll().catch(() => []),
    getActiveCandidate().catch(() => null),
    snapshotAll().catch(() => ({})),
  ]);

  return { allLists, allCamps, activeCand, quotas };
}

// 🔍 Fuzzy Disambiguation Matcher for Lead Lists
export function findBestMatchingList(allLists, inputName) {
  if (!inputName || !Array.isArray(allLists) || allLists.length === 0) return null;
  const target = String(inputName).toLowerCase().trim();

  // 1. Exact match
  const exact = allLists.find((l) => l.name.toLowerCase().trim() === target);
  if (exact) return { match: exact, confidence: 1.0 };

  // 2. Substring match
  const sub = allLists.find((l) => {
    const name = l.name.toLowerCase().trim();
    return name.includes(target) || target.includes(name);
  });
  if (sub) return { match: sub, confidence: 0.85 };

  // 3. Token / Word overlap
  const targetWords = target.split(/[\s_\-]+/).filter((w) => w.length > 2);
  let bestTokenMatch = null;
  let maxScore = 0;
  for (const l of allLists) {
    const listWords = l.name.toLowerCase().split(/[\s_\-]+/).filter((w) => w.length > 2);
    if (!listWords.length || !targetWords.length) continue;
    const matches = targetWords.filter((w) => listWords.some((lw) => lw.includes(w) || w.includes(lw))).length;
    const score = matches / Math.max(targetWords.length, listWords.length);
    if (score > maxScore) {
      maxScore = score;
      bestTokenMatch = l;
    }
  }

  if (bestTokenMatch && maxScore >= 0.35) {
    return { match: bestTokenMatch, confidence: 0.65 };
  }

  return null;
}

// 💬 Multi-Line Natural Language Blueprint Editing Parser
export function parseBlueprintEditCommand(text) {
  const clean = String(text || '').trim();
  const lower = clean.toLowerCase();

  // Guard: If the user is asking to create/design a campaign, DO NOT treat it as an edit!
  if (
    lower.includes('campaign') &&
    (lower.includes('degsig') ||
      lower.includes('design') ||
      lower.includes('desig') ||
      lower.includes('create') ||
      lower.includes('make') ||
      lower.includes('banao') ||
      lower.includes('start') ||
      lower.includes('launch') ||
      lower.includes('sequence'))
  ) {
    return null;
  }

  const isEdit =
    lower.includes('change') ||
    lower.includes('update') ||
    lower.includes('edit') ||
    lower.includes('set note') ||
    lower.includes('set pitch') ||
    lower.includes('set followup') ||
    lower.includes('set message');

  if (!isEdit) return null;

  const lines = clean.split('\n');
  const firstLine = lines[0].toLowerCase();
  const colonIdx = firstLine.indexOf(':');
  const cmdHeader = colonIdx !== -1 ? firstLine.slice(0, colonIdx) : firstLine;

  let targetStep = 'invite';
  if (
    cmdHeader.includes('step 3') ||
    cmdHeader.includes('3 step') ||
    cmdHeader.includes('step3') ||
    cmdHeader.includes('follow up') ||
    cmdHeader.includes('followup') ||
    cmdHeader.includes('message')
  ) {
    targetStep = 'followup';
  } else if (
    cmdHeader.includes('step 1') ||
    cmdHeader.includes('1 step') ||
    cmdHeader.includes('view')
  ) {
    targetStep = 'view';
  } else if (cmdHeader.includes('campaign name') || cmdHeader.includes('name') || cmdHeader.includes('title')) {
    targetStep = 'name';
  }

  // Extract content across multiple lines or after prefix
  let extractedContent = '';
  if (lines.length > 1 && /(change|update|edit|want to|set)/i.test(lines[0])) {
    extractedContent = lines.slice(1).join('\n').trim();
  } else {
    extractedContent = clean
      .replace(
        /^(?:i\s+want\s+to\s+)?(?:change|update|edit|set)\s+(?:the\s+)?(?:(?:step\s*\d|\d\s*step)\s*)?(?:campaign\s*name|follow\s*up|followup|invite\s*note|invite|note|pitch|message|name|title)?\s*(?:to\s+this|to\s*:?|:)?\s*/i,
        ''
      )
      .trim();
  }

  // Normalize {{full_name}} to {{firstName}} for personal LinkedIn outreach
  extractedContent = extractedContent.replace(/\{\{\s*full_name\s*\}\}/gi, '{{firstName}}');

  if (!extractedContent) return null;
  return { targetStep, newContent: extractedContent };
}

export async function testTelegram({ botToken, chatId }) {
  if (!botToken || !chatId) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Both Bot Token and Chat ID are required.');
  }
  const start = Date.now();
  const me = await callTelegramApi(botToken, 'getMe');
  const activeCand = await getActiveCandidate().catch(() => null);

  const testMsg =
    `🦊 *OutFox Mobile AI Copilot Connected!*\n\n` +
    `Bot: *${me.first_name || 'OutFox'}* (@${me.username || 'bot'})\n` +
    `Active Candidate: *${activeCand?.name || 'Default'}* (\`${activeCand?.slug || 'aditya'}\`)\n` +
    `Mode: *${activeCand?.mode === 'reverse_recruiting' ? 'Reverse Recruiting (Job Pitch)' : 'Agency Sourcing (Placements)'}*\n` +
    `Booking Link: *${activeCand?.bookingLink || 'https://calendly.com'}*\n` +
    `Latency: *${Date.now() - start}ms*\n\n` +
    `🎯 *Active Superpowers:*\n` +
    `• 🧠 *Conversation Memory:* 10-turn rolling context buffer\n` +
    `• 📋 *Blueprint Architect:* Pre-flight sequence approval cards\n` +
    `• ✏️ *Conversational Editor:* Edit note or follow-up anytime\n` +
    `• 🔄 *Candidate Switcher:* \`/switch <name>\` or \`/candidates\`\n` +
    `• 📧 *Apollo & Hunter Enrichment:* \`/enrich <publicId>\`\n` +
    `• 🔥 *Real-Time Alerts:* Inbound replies & acceptances\n` +
    `• 📅 *1-Tap Closer:* Booking links & contextual AI responses\n` +
    `• 🚨 *Safety Freeze Guard:* Automatic pause on checkpoints\n` +
    `• 📊 *Outreach Pulse:* \`/pulse\` scorecard`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '👥 Switch Persona', callback_data: 'show_candidates' },
        { text: '📊 Outreach Pulse', callback_data: 'daily_stats' },
      ],
      [
        { text: '⏸️ Pause All', callback_data: 'camp_pause' },
        { text: '▶️ Resume All', callback_data: 'camp_resume' },
      ],
    ],
  };

  await sendTelegramMessage(botToken, chatId, testMsg, { reply_markup: replyMarkup });
  return { ok: true, botUsername: me.username, latencyMs: Date.now() - start };
}

export async function saveTelegram({ botToken, chatId, bookingLink = '', enabled = true }) {
  const cfg = await getConfig();
  const current = cfg.telegram || {};
  const tokenToSave = botToken && !botToken.includes('•••') ? botToken.trim() : current.botToken;
  const chatIdToSave = chatId ? String(chatId).trim() : current.chatId;
  const bookingLinkToSave = bookingLink !== undefined ? String(bookingLink).trim() : (current.bookingLink || '');

  if (enabled && (!tokenToSave || !chatIdToSave)) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Bot Token and Chat ID are required.');
  }

  const updated = {
    ...current,
    botToken: tokenToSave,
    chatId: chatIdToSave,
    bookingLink: bookingLinkToSave,
    enabled: Boolean(enabled),
    status: enabled ? 'connected' : 'disconnected',
    updatedAt: Date.now(),
  };

  await setConfig({ telegram: updated });
  if (enabled) restartTelegramPoller(tokenToSave, chatIdToSave);
  else stopTelegramPoller();

  return {
    status: updated.status,
    enabled: updated.enabled,
    maskedToken: maskToken(tokenToSave),
    bookingLink: updated.bookingLink,
  };
}

export async function getTelegramStatus() {
  const cfg = await getConfig();
  const t = cfg.telegram || {};
  return {
    enabled: Boolean(t.enabled),
    status: t.status || 'disconnected',
    maskedToken: maskToken(t.botToken),
    hasToken: Boolean(t.botToken),
    chatId: t.chatId || '',
    bookingLink: t.bookingLink || '',
    isPolling,
  };
}

// 🎙️ Voice Note Transcriber via Groq Whisper
async function transcribeVoice(botToken, fileId) {
  const cfg = await getConfig();
  const apiKey = cfg.ai?.apiKey;
  if (!apiKey) {
    throw new Error('Groq API Key not found. Please set your Groq key in Settings -> AI Engine for voice transcription.');
  }

  const fileInfo = await callTelegramApi(botToken, 'getFile', { file_id: fileId });
  const fileUrl = `${TELEGRAM_API_BASE}/file/bot${botToken}/${fileInfo.file_path}`;

  const audioRes = await fetch(fileUrl);
  const audioBlob = await audioRes.blob();

  const formData = new FormData();
  formData.append('file', audioBlob, 'voice.ogg');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('response_format', 'json');

  const whisperRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!whisperRes.ok) {
    const errText = await whisperRes.text();
    throw new Error(`Whisper failed: ${errText.slice(0, 150)}`);
  }

  const data = await whisperRes.json();
  return data.text || '';
}

// AI Tools Declaration
const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'design_campaign_blueprint',
      description: 'Architect a multi-step sequence blueprint for user pre-flight approval. Call this whenever the user wants to design, create, start, or launch a campaign sequence (including typos like degsig, desig, or hindi commands like sequence banao).',
      parameters: {
        type: 'object',
        properties: {
          campaignName: { type: 'string', description: 'Proposed name for the campaign' },
          listName: { type: 'string', description: 'Target lead list name to enroll leads from' },
          hasViewStep: { type: 'boolean', description: 'True if profile view step should precede the invite' },
          inviteNote: { type: 'string', description: 'Personalized connection request note with {{firstName}}' },
          followupMessage: { type: 'string', description: 'Warm welcome message sent when connection is accepted' },
        },
        required: ['listName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_campaign_blueprint',
      description: 'Update or modify the pending outreach campaign blueprint before launch (e.g. change invite note, change step 3 follow-up message, or campaign name).',
      parameters: {
        type: 'object',
        properties: {
          stepToEdit: {
            type: 'string',
            enum: ['invite', 'followup', 'name'],
            description: "Which step to edit: 'invite' (step 2 note), 'followup' (step 3 message), or 'name'.",
          },
          newText: { type: 'string', description: 'The updated text provided by the user.' },
        },
        required: ['stepToEdit', 'newText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_outreach_campaign',
      description: 'Launch a multi-step outreach sequence campaign attached to a prospect list.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the campaign' },
          listName: { type: 'string', description: 'Name of the list of leads to enroll, e.g. "data analyst USA"' },
          hasViewStep: { type: 'boolean', description: 'True if sequence should view profile first' },
          inviteNote: { type: 'string', description: 'Personalized connection note with {{firstName}}' },
          followupMessage: { type: 'string', description: 'Warm welcome message sent when connection is accepted' },
        },
        required: ['name', 'listName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_and_save_leads',
      description: 'Search LinkedIn for candidates, job-seekers or managers by title and location, and optionally save them to a list.',
      parameters: {
        type: 'object',
        properties: {
          keywords: { type: 'string', description: "Job title or search keywords, e.g. 'Data Analyst' or 'Engineering Manager'" },
          location: { type: 'string', description: "Geographic location filter, e.g. 'United States' or 'Austin, Texas'" },
          openToWorkOnly: { type: 'boolean', description: 'True if looking for candidates who are open to work / job seekers' },
          listName: { type: 'string', description: 'Optional name of the list to automatically save these leads into' },
          count: { type: 'number', description: 'Number of prospects to find (default: 10, max: 25)' },
        },
        required: ['keywords'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_linkedin_message',
      description: 'Send a direct message to a connection on LinkedIn.',
      parameters: {
        type: 'object',
        properties: {
          recipientNameOrUrn: { type: 'string', description: 'Recipient name, username/slug, or profile URN' },
          message: { type: 'string', description: 'The message body to send' },
        },
        required: ['recipientNameOrUrn', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_campaigns',
      description: 'Check status, pause, or resume OutFox outreach campaigns.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['status', 'pause', 'resume'], description: 'Action to perform on campaigns' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'switch_candidate_workspace',
      description: 'Switch active candidate persona workspace (e.g. aditya or agency) to alter targeting, pitch templates, and booking links.',
      parameters: {
        type: 'object',
        properties: {
          candidateNameOrSlug: { type: 'string', description: 'Name or slug of candidate to switch to, e.g. "aditya" or "agency"' },
        },
        required: ['candidateNameOrSlug'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'enrich_lead_email',
      description: 'Enrich a LinkedIn profile with verified business email and phone number via Apollo/Hunter waterfall.',
      parameters: {
        type: 'object',
        properties: {
          publicId: { type: 'string', description: 'LinkedIn public ID or vanity slug of the lead' },
        },
        required: ['publicId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_campaign_live_status',
      description: 'Get real-time per-lead progress, status counts (waiting, active, completed, replied, failed), countdown timers, and remaining quotas for campaigns.',
      parameters: {
        type: 'object',
        properties: {
          campaignNameOrId: {
            type: 'string',
            description: 'Optional campaign name or ID. If omitted, returns live status for active campaigns.',
          },
        },
      },
    },
  },
];

// 📋 Blueprint Synthesizer (Auto-recovery & standardized sequence generator)
export function createOptimalBlueprint(blueprintId, targetList, candidate, args = {}) {
  const steps = [];
  if (args.hasViewStep !== false) {
    steps.push({ type: 'view', desc: 'Soft-touch profile view' });
  }

  let inviteNote = args.inviteNote || candidate?.pitchTemplate || 'Hi {{firstName}}, saw your profile and would love to connect!';
  inviteNote = inviteNote.replace(/\{\{\s*full_name\s*\}\}/gi, '{{firstName}}');
  steps.push({
    type: 'invite',
    note: inviteNote,
    desc: 'Personalized connection request note',
  });

  let followupBody =
    args.followupMessage ||
    (candidate?.followupTemplate
      ? `${candidate.followupTemplate} (Grab a quick 10-min chat: ${candidate.bookingLink || 'https://calendly.com'})`
      : 'Hey {{firstName}}, glad to connect! Are you currently open to roles?');
  followupBody = followupBody.replace(/\{\{\s*full_name\s*\}\}/gi, '{{firstName}}');

  if (followupBody) {
    steps.push({
      type: 'message',
      body: followupBody,
      delayDays: 1,
      desc: 'Warm follow-up after connection is accepted',
    });
  }

  return {
    blueprintId,
    campaignName: args.campaignName || args.name || `${targetList?.name || 'Leads'} (${candidate?.slug || 'Sequence'})`,
    listId: targetList?.listId || 'unknown',
    listName: targetList?.name || 'Leads',
    leadCount: targetList?.count || targetList?.itemCount || 25,
    candidate: candidate || null,
    inviteNote,
    followupMessage: followupBody,
    steps,
    createdAt: Date.now(),
  };
}

// 📋 Visual Blueprint Pre-Flight Approval Card (Handles escaping & custom headers safely)
async function presentCampaignBlueprint(botToken, chatId, blueprintOrId, maybeBp, maybeNotice) {
  let blueprint = blueprintOrId;
  let notice = '';

  if (typeof blueprintOrId === 'string' && typeof maybeBp === 'object' && maybeBp !== null) {
    blueprint = maybeBp;
    blueprint.blueprintId = blueprint.blueprintId || blueprintOrId;
    notice = typeof maybeNotice === 'string' ? maybeNotice : '';
  } else if (typeof maybeBp === 'string') {
    notice = maybeBp;
  }

  const bpId = blueprint.blueprintId || (typeof blueprintOrId === 'string' ? blueprintOrId : '');

  let seqText = '';
  (blueprint.steps || []).forEach((s, idx) => {
    seqText += `*${idx + 1}. [${s.type.toUpperCase()}]* — ${s.desc || s.type}\n`;
    if (s.note) seqText += `   📝 Note: _"${String(s.note).replace(/_/g, '\\_')}"_\n`;
    if (s.body) seqText += `   💬 Message: _"${String(s.body).replace(/_/g, '\\_')}"_\n`;
  });

  const campNameEscaped = String(blueprint.campaignName || blueprint.name || 'Outreach Campaign').replace(/_/g, '\\_');
  const listNameEscaped = String(blueprint.listName || 'Leads').replace(/_/g, '\\_');
  const candNameEscaped = String(blueprint.candidate?.name || 'Default').replace(/_/g, '\\_');
  const modeLabel = blueprint.candidate?.mode === 'reverse_recruiting' ? 'Reverse Recruiting' : 'Agency Sourcing';

  const card =
    (notice ? `${notice}\n\n` : '') +
    `📋 *CAMPAIGN BLUEPRINT PRE-FLIGHT APPROVAL*\n\n` +
    `🎯 *Campaign Name:* *${campNameEscaped}*\n` +
    `📁 *Target Lead List:* *${listNameEscaped}* (${blueprint.leadCount || 0} leads)\n` +
    `👤 *Persona Context:* *${candNameEscaped}* (${modeLabel})\n\n` +
    `⚡ *Architected Sequence (${(blueprint.steps || []).length} Steps):*\n` +
    seqText +
    `\n🛡️ *Safeguards:* Auto-stop on reply: Enabled | Safe Quotas: Active`;

  const replyMarkup = {
    inline_keyboard: [
      [{ text: '🚀 Approve & Launch Campaign Now', callback_data: `camp_approve:${bpId}` }],
      [
        { text: '✏️ Edit Note / Pitch', callback_data: `camp_edit_info:${bpId}` },
        { text: '❌ Discard Blueprint', callback_data: `camp_discard:${bpId}` },
      ],
    ],
  };

  return sendTelegramMessage(botToken, chatId, card, { reply_markup: replyMarkup });
}

async function executeTool(name, args = {}) {
  if (name === 'switch_candidate_workspace') {
    const switched = await setActiveCandidate(args.candidateNameOrSlug);
    return {
      switched: true,
      name: switched.name,
      slug: switched.slug,
      title: switched.title,
      mode: switched.mode,
      bookingLink: switched.bookingLink,
    };
  }

  if (name === 'enrich_lead_email') {
    const res = await enrichLead(args.publicId);
    return {
      publicId: args.publicId,
      email: res.enriched?.email || null,
      phone: res.enriched?.phone || null,
      source: res.enriched?.provider || 'none',
      confidence: res.enriched?.confidence || 0,
    };
  }

  if (name === 'edit_campaign_blueprint') {
    let bp = await getLatestBlueprint();
    let bpId = bp?.blueprintId;

    // Auto-Recovery: synthesize blueprint on the fly if storage was empty
    if (!bp) {
      const allLists = await lists.getAll().catch(() => []);
      const activeCand = await getActiveCandidate().catch(() => null);
      const targetList =
        allLists.find((l) => l.name.toLowerCase().includes('data analyst')) ||
        allLists[0] ||
        { name: 'Data Analyst USA', listId: 'unknown', count: 25 };
      bpId = `bp_${Date.now()}`;
      bp = createOptimalBlueprint(bpId, targetList, activeCand, {});
    }

    const stepToEdit = args.stepToEdit || 'invite';
    let cleanText = String(args.newText || '').trim();
    cleanText = cleanText.replace(/\{\{\s*full_name\s*\}\}/gi, '{{firstName}}');

    if (stepToEdit === 'followup') {
      bp.followupMessage = cleanText;
      const msgStep = bp.steps.find((s) => s.type === 'message');
      if (msgStep) msgStep.body = cleanText;
      else bp.steps.push({ type: 'message', body: cleanText, delayDays: 1, desc: 'Follow-up message after acceptance' });
    } else if (stepToEdit === 'invite') {
      bp.inviteNote = cleanText;
      const inviteStep = bp.steps.find((s) => s.type === 'invite');
      if (inviteStep) inviteStep.note = cleanText;
    } else if (stepToEdit === 'name') {
      bp.campaignName = cleanText;
      bp.name = cleanText;
    }

    await saveStoredBlueprint(bpId, bp);
    return { ok: true, stepToEdit, blueprintId: bpId, blueprint: bp };
  }

  if (name === 'design_campaign_blueprint' || name === 'create_outreach_campaign') {
    const allLists = await lists.getAll();
    const activeCand = await getActiveCandidate();
    const searchName = String(args.listName || '').trim();

    const matchObj = findBestMatchingList(allLists, searchName);

    if (!matchObj) {
      return {
        type: 'list_not_found',
        searched: searchName,
        availableLists: allLists.map((l) => l.name),
      };
    }

    const targetList = matchObj.match;
    const confidence = matchObj.confidence;

    const blueprintId = 'bp_' + Math.random().toString(36).slice(2, 9);
    const blueprint = createOptimalBlueprint(blueprintId, targetList, activeCand, args);

    await saveStoredBlueprint(blueprintId, blueprint);

    if (confidence >= 0.60 && confidence < 0.90) {
      return {
        type: 'disambiguation_required',
        blueprintId,
        matchedName: targetList.name,
        leadCount: blueprint.leadCount,
        searched: searchName,
      };
    }

    return {
      type: 'blueprint_ready',
      blueprint,
    };
  }

  if (name === 'search_and_save_leads') {
    const activeCand = await getActiveCandidate().catch(() => null);
    let kw = args.keywords || (activeCand?.targetRoles ? activeCand.targetRoles[0] : 'Data Analyst');
    if (args.openToWorkOnly && !kw.includes('Open to work')) kw += ' "Open to work"';

    const loc = args.location || (activeCand?.targetLocations ? activeCand.targetLocations[0] : 'United States');

    const searchRes = await voyager.searchProfiles({
      keywords: kw,
      location: loc,
      count: Math.min(Math.max(1, args.count || 10), 25),
    });

    const profiles = searchRes?.profiles || [];
    let listSaved = false;

    if (args.listName && profiles.length > 0) {
      try {
        lastSearchedList = args.listName;
        const listObj = await lists.ensureList(args.listName);
        await lists.add(listObj.listId, { profiles });
        listSaved = true;
      } catch (e) {
        console.error('[Telegram List Save Error]', e);
      }
    }

    return {
      countFound: profiles.length,
      listName: args.listName || null,
      listSaved,
      topProfiles: profiles.slice(0, 5).map((p) => ({
        name: p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'LinkedIn Member',
        headline: p.headline || p.title || 'Professional',
        location: p.location || 'USA',
        url: p.publicId ? `https://linkedin.com/in/${p.publicId}` : '',
      })),
    };
  }

  if (name === 'manage_campaigns') {
    const all = await campaigns.getAll();
    if (args.action === 'pause') {
      const active = all.filter((c) => c.status === 'active');
      for (const c of active) await campaigns.setStatus(c.campaignId, 'paused');
      return { pausedCount: active.length, message: `${active.length} campaign(s) paused.` };
    }
    if (args.action === 'resume') {
      const paused = all.filter((c) => c.status === 'paused');
      for (const c of paused) await campaigns.setStatus(c.campaignId, 'active');
      return { resumedCount: paused.length, message: `${paused.length} campaign(s) resumed. Runner triggered!` };
    }
    return {
      total: all.length,
      active: all.filter((c) => c.status === 'active').length,
      paused: all.filter((c) => c.status === 'paused').length,
    };
  }

  if (name === 'get_campaign_live_status') {
    const all = await campaigns.getAll();
    let target = null;
    if (args.campaignNameOrId) {
      const q = String(args.campaignNameOrId).toLowerCase().trim();
      target = all.find(
        (c) =>
          c.campaignId === args.campaignNameOrId ||
          (c.name && c.name.toLowerCase() === q) ||
          (c.name && c.name.toLowerCase().includes(q)),
      );
    }
    if (!target) {
      target = all.find((c) => c.status === 'active' || c.status === 'running') || all[0];
    }

    return {
      type: 'live_status',
      targetCampaignId: target?.campaignId || null,
      targetCampaignName: target?.name || null,
    };
  }

  if (name === 'send_linkedin_message') {
    await voyager.sendMessage({
      publicId: args.recipientNameOrUrn,
      body: args.message,
    });
    return { sent: true, recipient: args.recipientNameOrUrn };
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function callDynamicAi(userText, options = {}) {
  const cfg = await getConfig();
  const ai = cfg.ai || {};
  const provider = ai.provider || 'none';

  if (provider === 'none' || (!ai.apiKey && provider !== 'ollama')) {
    return {
      type: 'text',
      content: `⚠️ *AI Engine Not Configured:*\nOutFox Dashboard ➔ *Settings ➔ AI Engine* me jaakar apna Groq ya Gemini API Key connect karo!\n\n_Quick Actions:_\n• \`Campaign status\`\n• \`Pause campaign\`\n• \`Resume campaign\``,
    };
  }

  const ctx = await getLiveWorkspaceContext();
  const activeCand = ctx.activeCand;
  const allLists = ctx.allLists;
  const allCamps = ctx.allCamps;
  const quotas = ctx.quotas;

  const invRemaining = Math.max(0, (quotas.invite?.dailyCap || 20) - (quotas.invite?.dailyUsed || 0));
  const msgRemaining = Math.max(0, (quotas.message?.dailyCap || 40) - (quotas.message?.dailyUsed || 0));

  const workspaceContextStr =
    `\n\n⚡ CURRENT LIVE WORKSPACE CONTEXT:\n` +
    `• Active Candidate: "${activeCand?.name || 'Aditya'}" (${activeCand?.title || 'Data Analyst'}, Mode: ${activeCand?.mode || 'reverse_recruiting'})\n` +
    `• Saved Invite Note: "${activeCand?.pitchTemplate || ''}"\n` +
    `• Saved Follow-Up: "${activeCand?.followupTemplate || ''}"\n` +
    `• Booking Link: ${activeCand?.bookingLink || 'https://calendly.com'}\n` +
    `• Existing Lead Lists (${allLists.length}):\n` +
    (allLists.length ? allLists.map((l) => `  - "${l.name}" (ID: ${l.listId}, Leads: ${l.count || l.itemCount || 0})`).join('\n') : '  (None yet)') +
    `\n• Active Campaigns (${allCamps.length}):\n` +
    (allCamps.length ? allCamps.map((c) => `  - "${c.name}" (${c.status}, Enrolled: ${c.stats?.enrolled || 0})`).join('\n') : '  (None yet)') +
    `\n• Today's Quota Remaining: Invites: ${invRemaining}, Messages: ${msgRemaining}\n` +
    `When user requests to launch, design, create, or build a campaign sequence (including typos like "degsig campaign", "desig", or "banao sequence"), call design_campaign_blueprint. When modifying sequence steps or pitches, call edit_campaign_blueprint.`;

  const apiKey = ai.apiKey || '';
  const model =
    ai.model ||
    (provider === 'groq'
      ? 'llama-3.3-70b-versatile'
      : provider === 'gemini'
        ? 'gemini-2.0-flash'
        : 'gpt-4o-mini');

  const systemPrompt =
    (options.systemPrompt ||
      (options.forceText
        ? 'You are OutFox AI SDR, an expert LinkedIn outreach copywriter. Write concise, warm, professional responses without corporate fluff. Keep under 240 characters.'
        : 'You are OutFox AI SDR, an autonomous assistant controlling LinkedIn outreach. ' +
          'Understand user requests in English, Hindi, or Hinglish. ' +
          'When the user asks to search prospects, save leads to a list, design/create campaigns, edit campaign steps, send messages, switch candidates, or enrich leads, call the matching function tool. ' +
          'Always be helpful, warm, and accurate.')) + workspaceContextStr;

  let url = '';
  let headers = { 'Content-Type': 'application/json' };
  let body = {};
  const useTools = !options.forceText;

  const recentTurns = options.forceText ? [] : (await getRecentChatTurns());

  // If recentTurns already ends with the current user message (recorded at start of command), avoid duplicating it
  let historyTurns = [...recentTurns];
  if (
    historyTurns.length > 0 &&
    historyTurns[historyTurns.length - 1].role === 'user' &&
    historyTurns[historyTurns.length - 1].content.trim() === userText.replace(/[*_`\[\]]/g, '').trim().slice(0, 600)
  ) {
    historyTurns.pop();
  }

  const assembledMessages = [
    { role: 'system', content: systemPrompt },
    ...historyTurns,
    { role: 'user', content: userText },
  ];

  // Anthropic messages format: system prompt is top-level; messages array must start with 'user' and alternate
  let anthropicMessages = [...historyTurns, { role: 'user', content: userText }];
  while (anthropicMessages.length > 0 && anthropicMessages[0].role !== 'user') {
    anthropicMessages.shift();
  }
  if (anthropicMessages.length === 0) {
    anthropicMessages = [{ role: 'user', content: userText }];
  }
  const sanitizedAnthropicMessages = [];
  for (const m of anthropicMessages) {
    if (sanitizedAnthropicMessages.length > 0 && sanitizedAnthropicMessages[sanitizedAnthropicMessages.length - 1].role === m.role) {
      sanitizedAnthropicMessages[sanitizedAnthropicMessages.length - 1].content += '\n' + m.content;
    } else {
      sanitizedAnthropicMessages.push({ role: m.role, content: m.content });
    }
  }

  if (provider === 'groq') {
    url = `${ai.baseUrl || 'https://api.groq.com'}/openai/v1/chat/completions`;
    headers['Authorization'] = `Bearer ${apiKey}`;
    body = {
      model,
      messages: assembledMessages,
      ...(useTools ? { tools: AI_TOOLS, tool_choice: 'auto' } : {}),
    };
  } else if (provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
    body = {
      model: model.includes('gemini') ? model : 'gemini-2.0-flash',
      messages: assembledMessages,
      ...(useTools ? { tools: AI_TOOLS, tool_choice: 'auto' } : {}),
    };
  } else if (provider === 'openai' || provider === 'openai-compatible') {
    url = `${ai.baseUrl || 'https://api.openai.com/v1'}/chat/completions`;
    headers['Authorization'] = `Bearer ${apiKey}`;
    body = {
      model,
      messages: assembledMessages,
      ...(useTools ? { tools: AI_TOOLS, tool_choice: 'auto' } : {}),
    };
  } else if (provider === 'anthropic') {
    url = `${ai.baseUrl || 'https://api.anthropic.com'}/v1/messages`;
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    body = {
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      system: systemPrompt,
      messages: sanitizedAnthropicMessages,
      ...(useTools
        ? {
            tools: AI_TOOLS.map((t) => ({
              name: t.function.name,
              description: t.function.description,
              input_schema: t.function.parameters,
            })),
          }
        : {}),
    };
  } else if (provider === 'ollama') {
    url = `${ai.baseUrl || 'http://127.0.0.1:11434'}/api/chat`;
    body = {
      model: model || 'llama3.1',
      stream: false,
      messages: assembledMessages,
      ...(useTools ? { tools: AI_TOOLS } : {}),
    };
  } else {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI Provider (${provider}) error ${res.status}: ${errText.slice(0, 180)}`);
  }

  const data = await res.json();

  if (provider === 'anthropic') {
    if (useTools) {
      const toolUse = (data.content || []).find((c) => c.type === 'tool_use');
      if (toolUse) {
        return { type: 'tool_call', name: toolUse.name, args: toolUse.input || {} };
      }
    }
    const textPart = (data.content || []).find((c) => c.type === 'text');
    return { type: 'text', content: textPart?.text || 'Understood.' };
  }

  const msg = data.choices?.[0]?.message;
  if (useTools && msg?.tool_calls?.length > 0) {
    const firstCall = msg.tool_calls[0];
    return {
      type: 'tool_call',
      name: firstCall.function.name,
      args: JSON.parse(firstCall.function.arguments || '{}'),
    };
  }

  return { type: 'text', content: msg?.content || 'Understood.' };
}

// 👥 Send Candidate Personas List with 1-Tap Switch Buttons
async function sendCandidatesList(botToken, chatId) {
  const [all, active] = await Promise.all([
    getAllCandidates(),
    getActiveCandidate(),
  ]);

  let text = `👥 *OutFox Candidate Personas:*\n\n`;
  all.forEach((c) => {
    const isActive = c.slug === active?.slug;
    const modeLabel = c.mode === 'reverse_recruiting' ? 'Job Pitch' : 'Agency Sourcing';
    text += `${isActive ? '👉 *[ACTIVE]* ' : '• '}*${c.name}* (\`${c.slug}\`)\n`;
    text += `  💼 ${c.title} • _${modeLabel}_\n`;
    text += `  📍 ${c.targetLocations.join(', ')}\n`;
    text += `  🔗 ${c.bookingLink}\n\n`;
  });
  text += `Tap below to switch workspace:`;

  const keyboard = all.map((c) => [
    { text: `${c.slug === active?.slug ? '✓ ' : ''}Switch to: ${c.name}`, callback_data: `switch_cand:${c.slug}` },
  ]);

  return sendTelegramMessage(botToken, chatId, text, { reply_markup: { inline_keyboard: keyboard } });
}

// 📧 Handle Lead Enrichment via Apollo/Hunter Waterfall
async function handleEnrichLead(botToken, chatId, publicId) {
  await sendTelegramMessage(botToken, chatId, `🔍 *Enriching lead \`${publicId}\` via Apollo & Hunter waterfall...*`);
  try {
    const res = await enrichLead(publicId);
    const enr = res.enriched || {};
    let msg = `⚡ *Lead Enrichment Results for* \`${publicId}\`:\n\n`;

    if (enr.email) {
      msg += `📧 *Email:* \`${enr.email}\`\n`;
      if (enr.phone) msg += `📱 *Phone:* \`${enr.phone}\`\n`;
      msg += `🏷️ *Source:* ${enr.provider?.toUpperCase() || 'WATERFALL'}\n`;
      msg += `🎯 *Confidence:* ${Math.round((enr.confidence || 0.8) * 100)}%\n\n`;
      msg += `_Contact verified and saved to OutFox database!_`;
    } else {
      msg += `⚠️ No verified email found across Apollo & Hunter.\nReason: ${enr.reason || 'No match found'}`;
    }

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '📅 Send 10-Min Booking Link', callback_data: `reply_cal:${publicId}` }],
        [{ text: '✨ AI Draft Reply', callback_data: `reply_ai:${publicId}` }],
      ],
    };

    return sendTelegramMessage(botToken, chatId, msg, { reply_markup: replyMarkup });
  } catch (err) {
    return sendTelegramMessage(botToken, chatId, `❌ Enrichment error: ${err.message}`);
  }
}

// 📊 Outreach Pulse Scorecard Generator
async function renderDailyStats(botToken, chatId) {
  const [stats, quotas, allCamp, activeCand] = await Promise.all([
    getLiveDashboardStats().catch(() => null),
    snapshotAll().catch(() => ({})),
    campaigns.getAll().catch(() => []),
    getActiveCandidate().catch(() => null),
  ]);

  const activeCount = allCamp.filter((c) => c.status === 'active').length;
  const pausedCount = allCamp.filter((c) => c.status === 'paused').length;

  const invUsed = quotas.invite?.dailyUsed || 0;
  const invCap = quotas.invite?.dailyCap || 20;
  const invLeft = Math.max(0, invCap - invUsed);

  const msgUsed = quotas.message?.dailyUsed || 0;
  const msgCap = quotas.message?.dailyCap || 40;
  const msgLeft = Math.max(0, msgCap - msgUsed);

  const acceptRate = stats?.kpis?.acceptanceRate ?? 0;
  const replyRate = stats?.kpis?.responseRate ?? 0;

  const pulseMsg =
    `📊 *OUTFOX DAILY PULSE SCORECARD*\n\n` +
    `👤 *Active Candidate:* *${activeCand?.name || 'Default'}* (\`${activeCand?.slug || 'aditya'}\`)\n` +
    `⚙️ *Mode:* ${activeCand?.mode === 'reverse_recruiting' ? 'Reverse Recruiting' : 'Agency Sourcing'}\n\n` +
    `⚡ *Campaigns:*\n` +
    `• Active: *${activeCount}* | Paused: *${pausedCount}* | Total: *${allCamp.length}*\n\n` +
    `📈 *Daily Outreach Remaining:*\n` +
    `• Invites Today: *${invUsed} / ${invCap}* (${invLeft} remaining)\n` +
    `• Messages Today: *${msgUsed} / ${msgCap}* (${msgLeft} remaining)\n\n` +
    `🎯 *Conversion Rates:*\n` +
    `• Connection Acceptance: *${acceptRate}%*\n` +
    `• Inbound Reply Rate: *${replyRate}%*`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '👥 Switch Persona', callback_data: 'show_candidates' },
        { text: '📊 Campaign Status', callback_data: 'camp_status' },
      ],
      [
        { text: '⏸️ Pause All', callback_data: 'camp_pause' },
        { text: '▶️ Resume All', callback_data: 'camp_resume' },
      ],
    ],
  };

  return sendTelegramMessage(botToken, chatId, pulseMsg, { reply_markup: replyMarkup });
}

// ⚡ Real-Time Per-Lead Campaign Status Generator
async function renderLiveCampaignStatus(botToken, chatId, targetCampaignId = null) {
  const [allCamps, quotas] = await Promise.all([
    campaigns.getAll().catch(() => []),
    snapshotAll().catch(() => ({})),
  ]);

  const activeCamps = allCamps.filter((c) => c.status === 'active' || c.status === 'running');
  const target = targetCampaignId
    ? allCamps.find((c) => c.campaignId === targetCampaignId)
    : activeCamps[0] || allCamps[0];

  if (!target) {
    const emptyMsg =
      `ℹ️ *No Campaigns Found:*\n\n` +
      `OutFox me abhi koi campaign active ya configured nahi hai.\n\n` +
      `_Type_ \`design campaign for [list]\` _to start a new sequence._`;
    return sendTelegramMessage(botToken, chatId, emptyMsg);
  }

  const liveRes = await campaigns.getCampaignLiveStatus(target.campaignId).catch(() => null);
  if (!liveRes) {
    return sendTelegramMessage(botToken, chatId, `⚠️ Failed to fetch live status for campaign "${target.name}".`);
  }

  const s = liveRes.summary || {};
  const campNameEscaped = String(liveRes.campaignName || target.name || 'Campaign').replace(/[_*`]/g, ' ');
  const statusUpper = String(liveRes.campaignStatus || target.status || 'ACTIVE').toUpperCase();
  const statusEmoji = statusUpper === 'ACTIVE' || statusUpper === 'RUNNING' ? '🟢' : '⏸️';

  const invLeft = Math.max(0, (quotas.invite?.dailyCap || 20) - (quotas.invite?.dailyUsed || 0));
  const msgLeft = Math.max(0, (quotas.message?.dailyCap || 20) - (quotas.message?.dailyUsed || 0));
  const emailLeft = Math.max(0, (quotas.email?.dailyCap || 50) - (quotas.email?.dailyUsed || 0));

  let msg = `⚡ *LIVE CAMPAIGN STATUS:*\n\n`;
  msg += `${statusEmoji} *${campNameEscaped}* (\`${statusUpper}\`)\n`;
  msg += `👥 *Total Leads Enrolled:* *${s.total || 0}*\n\n`;

  msg += `📊 *Lead Status Breakdown:*\n`;
  msg += `• ⏳ *Waiting:* ${s.waiting || 0}\n`;
  msg += `• 🏃 *Active / Running:* ${s.active || 0}\n`;
  msg += `• 💬 *Replied:* ${s.replied || 0}\n`;
  msg += `• ✅ *Completed:* ${s.completed || 0}\n`;
  if (s.failed > 0) msg += `• ⚠️ *Failed / Issues:* ${s.failed}\n`;
  msg += `\n`;

  msg += `🛡️ *Today's Quota Remaining:*\n`;
  msg += `• Invites: *${invLeft} left* (${quotas.invite?.dailyUsed || 0}/${quotas.invite?.dailyCap || 20})\n`;
  msg += `• Messages: *${msgLeft} left* (${quotas.message?.dailyUsed || 0}/${quotas.message?.dailyCap || 20})\n`;
  msg += `• Emails: *${emailLeft} left* (${quotas.email?.dailyUsed || 0}/${quotas.email?.dailyCap || 50})\n\n`;

  const leads = liveRes.leads || [];
  const relevantLeads = [
    ...leads.filter((l) => l.status === 'running'),
    ...leads.filter((l) => l.status === 'active' && (!l.nextRunAt || l.nextRunAt <= Date.now())),
    ...leads.filter((l) => l.status === 'waiting'),
    ...leads.filter((l) => l.status === 'failed'),
    ...leads.filter((l) => l.status === 'replied'),
  ].slice(0, 5);

  if (relevantLeads.length > 0) {
    msg += `🎯 *Live Prospects Progress:*\n`;
    for (const lead of relevantLeads) {
      const safeName = String(lead.fullName || lead.publicId).replace(/[_*`]/g, ' ');
      const safeCompany = String(lead.company || '').replace(/[_*`]/g, ' ');
      const compStr = safeCompany ? ` (${safeCompany})` : '';
      const stepStr = String(lead.currentStepLabel || 'In Progress').replace(/[_*`]/g, ' ');

      let timingOrResult = '';
      if (lead.lastError) {
        const safeErr = String(lead.lastError).replace(/[_*`]/g, ' ');
        timingOrResult = `⚠️ ${safeErr.length > 28 ? safeErr.slice(0, 28) + '...' : safeErr}`;
      } else if (lead.replied) {
        timingOrResult = `💬 Replied`;
      } else if (lead.nextRunAt && lead.nextRunAt > Date.now()) {
        const diffMs = lead.nextRunAt - Date.now();
        const mins = Math.max(1, Math.round(diffMs / 60000));
        timingOrResult = `⏳ in ${mins < 60 ? `${mins}m` : `${(mins / 60).toFixed(1)}h`}`;
      } else if (lead.status === 'active' || lead.status === 'running') {
        timingOrResult = `🏃 Due now`;
      } else {
        timingOrResult = `✅ Done`;
      }

      msg += `• *${safeName}*${compStr}\n  ↳ ${stepStr} — ${timingOrResult}\n`;
    }
    msg += `\n`;
  }

  msg += `_Auto-pacing and LinkedIn cooldowns active._`;

  const isPaused = target.status === 'paused';
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '🔄 Refresh Live Status', callback_data: `camp_live_refresh:${target.campaignId}` },
        { text: '⚡ Run Step Now', callback_data: `camp_live_tick:${target.campaignId}` },
      ],
      [
        { text: isPaused ? '▶️ Resume Campaign' : '⏸️ Pause Campaign', callback_data: `camp_live_toggle:${target.campaignId}` },
      ],
    ],
  };

  return sendTelegramMessage(botToken, chatId, msg, { reply_markup: replyMarkup });
}

async function handleUserCommand(botToken, chatId, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;
  cleanOldCaches().catch(() => {});

  if (trimmed === '/clear' || trimmed === '/reset') {
    await set(CHAT_HISTORY_KEY, []);
    return sendTelegramMessage(
      botToken,
      chatId,
      `🧹 *Conversation Memory Cleared!*\nStarting a fresh session with your live workspace context.`
    );
  }

  // Record user turn in the rolling context buffer
  await recordChatTurn('user', trimmed);

  if (trimmed === '/start' || trimmed === '/help') {
    const activeCand = await getActiveCandidate().catch(() => null);
    const welcome =
      `🦊 *OutFox Mobile AI Copilot Ready!*\n\n` +
      `Active Persona: *${activeCand?.name || 'Aditya'}* (\`${activeCand?.slug || 'aditya'}\`)\n\n` +
      `📌 *Conversation Memory:*\n` +
      `• \`/clear\` or \`/reset\` — Wipe memory buffer & start fresh\n\n` +
      `📌 *Campaign Blueprints & Editing:*\n` +
      `• _"Design campaign for Data Analyst USA"_\n` +
      `• _"Change step 3 follow up to: Hey {{firstName}}..."_\n` +
      `• _"Change invite note to: Hi {{firstName}}..."_\n\n` +
      `📌 *Candidate Workspace Switcher:*\n` +
      `• \`/switch aditya\` or \`/switch agency\`\n` +
      `• \`/candidates\` — List all personas & 1-tap switch\n\n` +
      `📌 *Email Waterfall Enrichment:*\n` +
      `• \`/enrich <publicId>\` — Discover email via Apollo & Hunter\n\n` +
      `📌 *Closer & Pulse:*\n` +
      `• \`/pulse\` or \`Daily stats\` — Scorecard & remaining quotas\n` +
      `• \`Campaign status\`, \`Pause campaign\`, \`Resume campaign\``;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '👥 Personas', callback_data: 'show_candidates' },
          { text: '📊 Outreach Pulse', callback_data: 'daily_stats' },
        ],
        [
          { text: '⏸️ Pause All', callback_data: 'camp_pause' },
          { text: '▶️ Resume All', callback_data: 'camp_resume' },
        ],
      ],
    };

    return sendTelegramMessage(botToken, chatId, welcome, { reply_markup: replyMarkup });
  }

  // 0. Slash Command: /blockcompany <name>
  if (trimmed.startsWith('/blockcompany') || trimmed.startsWith('/block_company')) {
    const companyQuery = trimmed.replace(/^\/block_?company\s*/i, '').trim();
    if (!companyQuery) {
      return sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ *Usage:* \`/blockcompany <name or domain>\`\n_Example:_ \`/blockcompany infosys.com\``
      );
    }
    await addCompanyToBlacklist(companyQuery);
    return sendTelegramMessage(
      botToken,
      chatId,
      `🏢 *Company Excluded:*\n\`${companyQuery}\` has been added to the Company Exclusion list.\n\nAll campaigns will automatically skip prospects from this company.`
    );
  }

  // 1. Conversational Sequence Step Editing Interceptor (with Auto-Recovery & Persistent Storage)
  const editCmd = parseBlueprintEditCommand(trimmed);
  if (editCmd && editCmd.newContent) {
    let bp = await getLatestBlueprint();
    let latestId = bp?.blueprintId;

    // Auto-Recovery: synthesize blueprint on the fly if storage was empty
    if (!bp) {
      const allLists = await lists.getAll().catch(() => []);
      const activeCand = await getActiveCandidate().catch(() => null);
      const targetList =
        allLists.find((l) => l.name.toLowerCase().includes('data analyst')) ||
        allLists[0] ||
        { name: 'Data Analyst USA', listId: 'unknown', count: 25 };
      latestId = `bp_${Date.now()}`;
      bp = createOptimalBlueprint(latestId, targetList, activeCand, {});
    }

    if (editCmd.targetStep === 'followup') {
      bp.followupMessage = editCmd.newContent;
      const msgStep = bp.steps.find((s) => s.type === 'message');
      if (msgStep) msgStep.body = editCmd.newContent;
      else bp.steps.push({ type: 'message', body: editCmd.newContent, delayDays: 1, desc: 'Follow-up message after acceptance' });
      await saveStoredBlueprint(latestId, bp);
      await recordChatTurn('assistant', 'Updated Step 3 (Follow-Up Message) of campaign blueprint.');
      return presentCampaignBlueprint(botToken, chatId, latestId, bp, '✏️ *Step 3 (Follow-Up Message) Updated Successfully!*');
    }

    if (editCmd.targetStep === 'invite') {
      bp.inviteNote = editCmd.newContent;
      const inviteStep = bp.steps.find((s) => s.type === 'invite');
      if (inviteStep) inviteStep.note = editCmd.newContent;
      await saveStoredBlueprint(latestId, bp);
      await recordChatTurn('assistant', 'Updated Step 2 (Connection Note) of campaign blueprint.');
      return presentCampaignBlueprint(botToken, chatId, latestId, bp, '✏️ *Step 2 (Connection Note) Updated Successfully!*');
    }

    if (editCmd.targetStep === 'name') {
      bp.campaignName = editCmd.newContent;
      bp.name = editCmd.newContent;
      await saveStoredBlueprint(latestId, bp);
      await recordChatTurn('assistant', `Updated campaign name to "${editCmd.newContent}".`);
      return presentCampaignBlueprint(botToken, chatId, latestId, bp, '✏️ *Campaign Name Updated Successfully!*');
    }
  }

  // 2. Candidate Switcher Commands
  const switchMatch = trimmed.match(/^\/switch(?:\s+(.+))?$/i);
  if (switchMatch) {
    const target = (switchMatch[1] || '').trim();
    if (!target) return sendCandidatesList(botToken, chatId);

    try {
      const switched = await setActiveCandidate(target);
      const modeLabel = switched.mode === 'reverse_recruiting' ? '🎯 Reverse Recruiting (Job Pitch)' : '🏢 Agency Sourcing (Placements)';
      const msg =
        `🔄 *Active Candidate Switched!*\n\n` +
        `👤 *Name:* *${switched.name}* (\`${switched.slug}\`)\n` +
        `💼 *Title:* ${switched.title}\n` +
        `⚙️ *Mode:* ${modeLabel}\n` +
        `📍 *Target Locations:* ${switched.targetLocations.join(', ')}\n` +
        `📅 *Booking Link:* ${switched.bookingLink}\n\n` +
        `_All outreach pitches and sequences will now align with this candidate._`;
      return sendTelegramMessage(botToken, chatId, msg);
    } catch (err) {
      return sendTelegramMessage(botToken, chatId, `❌ ${err.message}`);
    }
  }

  if (/^\/?candidates$/i.test(trimmed)) {
    return sendCandidatesList(botToken, chatId);
  }

  // 3. Email Waterfall Enrichment Command
  const enrichMatch = trimmed.match(/^\/enrich\s+([a-zA-Z0-9\-_%]+)/i);
  if (enrichMatch) {
    const publicId = enrichMatch[1].trim();
    return handleEnrichLead(botToken, chatId, publicId);
  }

  // 4. Quick Daily Stats / Pulse Command
  if (/^\/?(pulse|stats|scorecard|daily\s*stats|report)/i.test(trimmed)) {
    return renderDailyStats(botToken, chatId);
  }

  // 5. Live Campaign & Per-Lead Status Command (/live, /status, or natural language)
  if (
    /^\/?(live|status|live\s*status)/i.test(trimmed) ||
    /^(campaign\s*status|campaign\s*ka\s*(?:live\s*)?status|kis\s*lead\s*ka\s*kya\s*status)/i.test(trimmed) ||
    /live\s*status\s*batao/i.test(trimmed)
  ) {
    return renderLiveCampaignStatus(botToken, chatId);
  }

  try {
    await sendTelegramMessage(botToken, chatId, `⚡ *AI analyzing intent...*`);

    const aiResult = await callDynamicAi(trimmed);

    if (aiResult.type === 'tool_call') {
      const execResult = await executeTool(aiResult.name, aiResult.args);

      if (aiResult.name === 'edit_campaign_blueprint') {
        if (execResult.ok && execResult.blueprint) {
          const stepLabel =
            execResult.stepToEdit === 'followup'
              ? 'Step 3 (Follow-Up Message)'
              : execResult.stepToEdit === 'invite'
                ? 'Step 2 (Connection Note)'
                : 'Campaign Name';
          await recordChatTurn('assistant', `Updated ${stepLabel} in campaign blueprint.`);
          const notice =
            execResult.stepToEdit === 'followup'
              ? '✏️ *Step 3 (Follow-Up Message) Updated Successfully!*'
              : execResult.stepToEdit === 'invite'
                ? '✏️ *Step 2 (Connection Note) Updated Successfully!*'
                : '✏️ *Campaign Name Updated Successfully!*';
          return presentCampaignBlueprint(botToken, chatId, execResult.blueprintId, execResult.blueprint, notice);
        } else {
          return sendTelegramMessage(botToken, chatId, `⚠️ ${execResult.error || 'Failed to edit blueprint.'}`);
        }
      }

      if (aiResult.name === 'design_campaign_blueprint' || aiResult.name === 'create_outreach_campaign') {
        if (execResult.type === 'disambiguation_required') {
          const disambigMsg =
            `🤔 *Did you mean list "${execResult.matchedName}" (${execResult.leadCount} leads)?*\n` +
            `You requested outreach for _"${execResult.searched}"_.`;

          const replyMarkup = {
            inline_keyboard: [
              [{ text: `✅ Yes, use "${execResult.matchedName}"`, callback_data: `bp_view:${execResult.blueprintId}` }],
              [{ text: '📁 Select from All Lists', callback_data: 'list_all_for_camp' }],
            ],
          };

          return sendTelegramMessage(botToken, chatId, disambigMsg, { reply_markup: replyMarkup });
        }

        if (execResult.type === 'list_not_found') {
          const notFoundMsg =
            `⚠️ *List "${execResult.searched}" nahi mili.*\n\n` +
            `Existing lists: ${execResult.availableLists.map((n) => `\`${n}\``).join(', ') || 'None'}\n\n` +
            `_Pehle leads search karke list banao ya /candidates check karo._`;

          const replyMarkup = {
            inline_keyboard: [
              [{ text: '📁 View All Lists', callback_data: 'list_all_for_camp' }],
              [{ text: '👥 Switch Persona', callback_data: 'show_candidates' }],
            ],
          };

          return sendTelegramMessage(botToken, chatId, notFoundMsg, { reply_markup: replyMarkup });
        }

        if (execResult.type === 'blueprint_ready') {
          const bp = execResult.blueprint;
          await recordChatTurn('assistant', `Generated campaign blueprint for list "${bp.listName}" with ${(bp.steps || []).length} steps.`);
          return presentCampaignBlueprint(botToken, chatId, bp.blueprintId || execResult.blueprintId, bp);
        }
      }

      let reply = `✅ *Action Completed Successfully!*\n\n`;
      let replyMarkup = null;

      if (aiResult.name === 'switch_candidate_workspace') {
        await recordChatTurn('assistant', `Switched active candidate persona to ${execResult.name} (${execResult.title}).`);
        reply +=
          `🔄 *Candidate Workspace Switched!*\n\n` +
          `• Name: *${execResult.name}* (\`${execResult.slug}\`)\n` +
          `• Title: ${execResult.title}\n` +
          `• Mode: ${execResult.mode === 'reverse_recruiting' ? 'Reverse Recruiting' : 'Agency Sourcing'}\n` +
          `• Booking Link: ${execResult.bookingLink}`;

        replyMarkup = {
          inline_keyboard: [
            [{ text: '📊 Outreach Pulse', callback_data: 'daily_stats' }],
          ],
        };
      } else if (aiResult.name === 'enrich_lead_email') {
        await recordChatTurn('assistant', execResult.email ? `Enriched lead ${execResult.publicId}: found email ${execResult.email}.` : `Could not find email for lead ${execResult.publicId}.`);
        if (execResult.email) {
          reply +=
            `📧 *Enrichment Successful!*\n\n` +
            `• Lead: \`${execResult.publicId}\`\n` +
            `• Email: \`${execResult.email}\`\n` +
            (execResult.phone ? `• Phone: \`${execResult.phone}\`\n` : '') +
            `• Source: ${execResult.source.toUpperCase()}\n` +
            `• Confidence: ${Math.round((execResult.confidence || 0.8) * 100)}%`;
        } else {
          reply += `⚠️ No email found for \`${execResult.publicId}\` across Apollo and Hunter.`;
        }
      } else if (aiResult.name === 'search_and_save_leads') {
        const listNameUsed = execResult.listName || lastSearchedList;
        await recordChatTurn('assistant', `Found ${execResult.countFound} prospects on LinkedIn and saved to list "${listNameUsed}".`);
        reply += `🎯 *Found ${execResult.countFound} Prospects on LinkedIn!*\n`;
        if (execResult.listSaved) {
          reply += `📁 *Saved to List:* \`${execResult.listName}\`\n\n`;
        }
        reply += `*Top Candidates:*\n`;
        execResult.topProfiles.forEach((p, i) => {
          reply += `*${i + 1}. ${p.name}*\n💼 ${p.headline}\n📍 ${p.location}\n${p.url ? `🔗 [Profile Link](${p.url})\n` : ''}\n`;
        });

        const targetList = execResult.listName || lastSearchedList;
        replyMarkup = {
          inline_keyboard: [
            [{ text: `🚀 Launch Campaign for "${targetList}"`, callback_data: `quick_launch:${targetList}` }],
            [
              { text: '📊 Pulse', callback_data: 'daily_stats' },
              { text: '⏸️ Pause All', callback_data: 'camp_pause' },
            ],
          ],
        };
      } else if (aiResult.name === 'get_campaign_live_status') {
        await recordChatTurn('assistant', `Checked live status for campaign ${execResult.targetCampaignName || 'active'}.`);
        return renderLiveCampaignStatus(botToken, chatId, execResult.targetCampaignId);
      } else if (aiResult.name === 'manage_campaigns') {
        await recordChatTurn('assistant', execResult.message || `Campaign status: ${execResult.active} active, ${execResult.paused} paused.`);
        if (execResult.pausedCount !== undefined) {
          reply += `⏸️ *Paused:* ${execResult.pausedCount} active campaign(s).`;
        } else if (execResult.resumedCount !== undefined) {
          reply += `▶️ *Resumed:* ${execResult.resumedCount} campaign(s). Runner kicked off!`;
        } else {
          reply += `📊 *Campaign Status:*\n• Active: *${execResult.active}*\n• Paused: *${execResult.paused}*\n• Total: *${execResult.total}*`;
        }

        replyMarkup = {
          inline_keyboard: [
            [
              { text: '⏸️ Pause All', callback_data: 'camp_pause' },
              { text: '▶️ Resume All', callback_data: 'camp_resume' },
            ],
          ],
        };
      } else if (aiResult.name === 'send_linkedin_message') {
        await recordChatTurn('assistant', `Sent LinkedIn message to ${execResult.recipient}.`);
        reply += `✉️ Message sent to *${execResult.recipient}*!`;
      } else {
        reply += JSON.stringify(execResult, null, 2);
      }

      return sendTelegramMessage(botToken, chatId, reply, replyMarkup ? { reply_markup: replyMarkup } : {});
    }

    await recordChatTurn('assistant', aiResult.content);
    return sendTelegramMessage(botToken, chatId, aiResult.content);
  } catch (err) {
    console.error('[Telegram Command Error]', err);
    return sendTelegramMessage(botToken, chatId, `❌ Error: ${err.message}`);
  }
}

async function handleCallback(botToken, chatId, callbackData) {
  const data = String(callbackData || '');
  cleanOldCaches();

  // 1. Blueprint Pre-Flight Approval: Approve & Launch
  if (data.startsWith('camp_approve:')) {
    const blueprintId = data.replace('camp_approve:', '').trim();
    const blueprints = await getStoredBlueprints();
    const blueprint = blueprints[blueprintId] || pendingBlueprints.get(blueprintId) || (await getLatestBlueprint());
    if (!blueprint) {
      return sendTelegramMessage(botToken, chatId, `⚠️ *Blueprint expired or already launched.*`);
    }

    await sendTelegramMessage(botToken, chatId, `🚀 *Launching campaign sequence for "${blueprint.campaignName || blueprint.name}"...*`);
    try {
      const camp = await campaigns.create({
        name: blueprint.campaignName || blueprint.name,
        listId: blueprint.listId,
        steps: blueprint.steps,
        settings: { stopOnReply: true, autopilot: false },
      });

      await removeStoredBlueprint(blueprintId);
      const enrolled = await campaigns.readEnrollments(camp.campaignId).catch(() => []);
      await recordChatTurn('assistant', `Campaign "${camp.name}" launched for list "${blueprint.listName}" with ${enrolled.length} enrolled leads.`);

      const launchMsg =
        `🚀 *Campaign Successfully Launched!*\n\n` +
        `• Campaign: *${camp.name}*\n` +
        `• Target List: *${blueprint.listName}*\n` +
        `• Enrolled Leads: *${enrolled.length}*\n` +
        `• Sequence Steps: *${blueprint.steps.length}*\n\n` +
        `_OutFox background runner is now active!_`;

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '📊 Campaign Status', callback_data: 'camp_status' },
            { text: '⏸️ Pause Campaign', callback_data: 'camp_pause' },
          ],
        ],
      };

      return sendTelegramMessage(botToken, chatId, launchMsg, { reply_markup: replyMarkup });
    } catch (err) {
      return sendTelegramMessage(botToken, chatId, `❌ Failed to launch campaign: ${err.message}`);
    }
  }

  // 2. Discard Blueprint
  if (data.startsWith('camp_discard:')) {
    const blueprintId = data.replace('camp_discard:', '').trim();
    await removeStoredBlueprint(blueprintId);
    return sendTelegramMessage(botToken, chatId, `❌ *Blueprint discarded.*`);
  }

  // 3. Edit Blueprint Info Prompt
  if (data.startsWith('camp_edit_info:')) {
    return sendTelegramMessage(
      botToken,
      chatId,
      `✏️ *To edit this sequence, send a message:*\n\n` +
      `• *Step 2 (Invite Note):*\n\`Change invite note to: Hi {{firstName}}, ...\`\n\n` +
      `• *Step 3 (Follow-Up Message):*\n\`Change step 3 follow up to: Hey {{firstName}}, thanks for connecting! ...\`\n\n` +
      `• *Campaign Name:*\n\`Change campaign name to: Austin Tech Sourcing\``
    );
  }

  // 4. View Disambiguated Blueprint
  if (data.startsWith('bp_view:')) {
    const blueprintId = data.replace('bp_view:', '').trim();
    const blueprints = await getStoredBlueprints();
    const bp = blueprints[blueprintId] || pendingBlueprints.get(blueprintId);
    if (bp) return presentCampaignBlueprint(botToken, chatId, bp);
    return sendTelegramMessage(botToken, chatId, `⚠️ *Blueprint expired.*`);
  }

  // 5. List All Lists for Campaign Selection
  if (data === 'list_all_for_camp') {
    const allLists = await lists.getAll();
    if (!allLists.length) {
      return sendTelegramMessage(botToken, chatId, `⚠️ *No lead lists found.* Pehle leads search karke list me save karo.`);
    }

    let text = `📁 *Select a Lead List for Campaign:*\n\n`;
    allLists.forEach((l) => {
      text += `• *${l.name}* (${l.count || l.itemCount || 0} leads)\n`;
    });

    const buttons = allLists.slice(0, 8).map((l) => [
      { text: `📁 ${l.name}`, callback_data: `sel_list:${l.listId}` },
    ]);

    return sendTelegramMessage(botToken, chatId, text, { reply_markup: { inline_keyboard: buttons } });
  }

  // 6. Select Specific List for Campaign Blueprint
  if (data.startsWith('sel_list:')) {
    const listId = data.replace('sel_list:', '').trim();
    const allLists = await lists.getAll();
    const targetList = allLists.find((l) => l.listId === listId);
    if (!targetList) return sendTelegramMessage(botToken, chatId, `❌ List not found.`);

    const activeCand = await getActiveCandidate();
    const blueprintId = 'bp_' + Math.random().toString(36).slice(2, 9);
    const blueprint = createOptimalBlueprint(blueprintId, targetList, activeCand);
    await saveStoredBlueprint(blueprintId, blueprint);
    return presentCampaignBlueprint(botToken, chatId, blueprint);
  }

  // 7. Quick Launch from Search
  if (data.startsWith('quick_launch:')) {
    const listName = data.replace('quick_launch:', '').trim();
    const prompt = `Design a campaign blueprint for list "${listName}".`;
    return handleUserCommand(botToken, chatId, prompt);
  }

  // 8. Persona Switcher Callbacks
  if (data === 'show_candidates') {
    return sendCandidatesList(botToken, chatId);
  }

  if (data.startsWith('switch_cand:')) {
    const slug = data.replace('switch_cand:', '').trim();
    try {
      const switched = await setActiveCandidate(slug);
      return sendTelegramMessage(
        botToken,
        chatId,
        `✅ *Switched to ${switched.name}!*\nTitle: ${switched.title}\nMode: ${switched.mode}\nBooking: ${switched.bookingLink}`
      );
    } catch (err) {
      return sendTelegramMessage(botToken, chatId, `❌ ${err.message}`);
    }
  }

  // 9. Lead Enrichment Callback
  if (data.startsWith('enrich:')) {
    const publicId = data.replace('enrich:', '').trim();
    return handleEnrichLead(botToken, chatId, publicId);
  }

  // 10. Campaign Controls
  if (data === 'camp_status') {
    const all = await campaigns.getAll();
    const active = all.filter((c) => c.status === 'active');
    const paused = all.filter((c) => c.status === 'paused');
    let msg = `📊 *Campaign Status:*\n• Active: *${active.length}* | Paused: *${paused.length}* | Total: *${all.length}*\n\n`;
    active.forEach((c) => {
      msg += `⚡ *${c.name}* (Enrolled: ${c.stats?.enrolled || 0})\n`;
    });
    return sendTelegramMessage(botToken, chatId, msg);
  }

  if (data === 'camp_pause') {
    const active = (await campaigns.getAll()).filter((c) => c.status === 'active');
    for (const c of active) await campaigns.setStatus(c.campaignId, 'paused');
    return sendTelegramMessage(botToken, chatId, `⏸️ *Success:* ${active.length} active campaign(s) paused.`);
  }

  if (data === 'camp_resume') {
    const paused = (await campaigns.getAll()).filter((c) => c.status === 'paused');
    for (const c of paused) await campaigns.setStatus(c.campaignId, 'active');
    return sendTelegramMessage(botToken, chatId, `▶️ *Success:* ${paused.length} campaign(s) resumed. Runner triggered!`);
  }

  if (data === 'daily_stats') {
    return renderDailyStats(botToken, chatId);
  }

  // Live Campaign Callbacks
  if (data.startsWith('camp_live_refresh:')) {
    const campId = data.replace('camp_live_refresh:', '').trim();
    return renderLiveCampaignStatus(botToken, chatId, campId);
  }

  if (data.startsWith('camp_live_tick:')) {
    const campId = data.replace('camp_live_tick:', '').trim();
    await campaigns.tick().catch(() => {});
    return renderLiveCampaignStatus(botToken, chatId, campId);
  }

  if (data.startsWith('camp_live_toggle:')) {
    const campId = data.replace('camp_live_toggle:', '').trim();
    const camp = (await campaigns.getAll()).find((c) => c.campaignId === campId);
    if (camp) {
      const isPaused = camp.status === 'paused';
      await campaigns.setStatus(campId, isPaused ? 'active' : 'paused');
      return renderLiveCampaignStatus(botToken, chatId, campId);
    }
  }

  // 11. 1-Tap Booking Dispatch
  if (data.startsWith('reply_cal:')) {
    const publicId = data.replace('reply_cal:', '').trim();
    const activeCand = await getActiveCandidate().catch(() => null);
    const cfg = await getConfig();
    const bookingLink = activeCand?.bookingLink || cfg.telegram?.bookingLink || cfg.bookingLink || 'https://calendly.com';
    const body = `Thanks for getting back to me! Here is a direct link to grab a quick 10-15 min chat on my calendar: ${bookingLink} - looking forward to speaking!`;

    await sendTelegramMessage(botToken, chatId, `⏳ *Dispatching booking link to* \`${publicId}\`...`);
    try {
      await voyager.sendMessage({ publicId, body });
      return sendTelegramMessage(
        botToken,
        chatId,
        `✅ *1-Tap Booking Link Sent!*\nDelivered to \`${publicId}\` on LinkedIn.`
      );
    } catch (err) {
      return sendTelegramMessage(botToken, chatId, `❌ Failed to send booking link: ${err.message}`);
    }
  }

  // 12. Contextual AI Response Generator
  if (data.startsWith('reply_ai:')) {
    const publicId = data.replace('reply_ai:', '').trim();
    const cached = lastInboundReplies.get(publicId);

    await sendTelegramMessage(botToken, chatId, `✨ *Drafting contextual AI reply for* \`${publicId}\`...`);

    let prompt = '';
    if (cached && cached.body) {
      prompt = `A LinkedIn lead (${publicId}) sent this inbound reply: "${cached.body}". Write a warm, high-converting 2-sentence LinkedIn response answering them and inviting them to a brief 10-minute call. Under 240 chars. No corporate fluff. Output only the message text.`;
    } else {
      prompt = `A LinkedIn lead (${publicId}) just accepted my connection request. Write a warm, high-converting 2-sentence LinkedIn welcome message thanking them for connecting and inviting them to a brief 10-minute call. Under 240 chars. No corporate fluff. Output only the message text.`;
    }

    try {
      const aiRes = await callDynamicAi(prompt, { forceText: true });
      let draftText = (aiRes.type === 'text' ? aiRes.content : '') || '';
      draftText = draftText.replace(/^["']|["']$/g, '').trim();

      const draftId = 'd_' + Math.random().toString(36).slice(2, 9);
      pendingDrafts.set(draftId, { publicId, text: draftText, at: Date.now() });

      const previewMsg =
        `✨ *AI Generated Response Draft:*\n` +
        `👤 *Lead:* \`${publicId}\`\n\n` +
        `"${draftText}"`;

      const replyMarkup = {
        inline_keyboard: [
          [{ text: '🚀 Send This AI Reply Now', callback_data: `send_draft:${draftId}` }],
          [
            { text: '🔄 Regenerate', callback_data: `reply_ai:${publicId}` },
            { text: '❌ Cancel', callback_data: `cancel_draft:${draftId}` },
          ],
        ],
      };

      return sendTelegramMessage(botToken, chatId, previewMsg, { reply_markup: replyMarkup });
    } catch (err) {
      return sendTelegramMessage(botToken, chatId, `❌ AI draft generation failed: ${err.message}`);
    }
  }

  // 13. Send Pending AI Draft
  if (data.startsWith('send_draft:')) {
    const draftId = data.replace('send_draft:', '').trim();
    const draft = pendingDrafts.get(draftId);
    if (!draft) {
      return sendTelegramMessage(botToken, chatId, `⚠️ *Draft expired or already sent.*`);
    }

    await sendTelegramMessage(botToken, chatId, `⏳ *Delivering message to* \`${draft.publicId}\`...`);
    try {
      await voyager.sendMessage({ publicId: draft.publicId, body: draft.text });
      pendingDrafts.delete(draftId);
      return sendTelegramMessage(
        botToken,
        chatId,
        `🚀 *AI Reply Successfully Delivered!*\nDelivered to \`${draft.publicId}\` on LinkedIn.`
      );
    } catch (err) {
      return sendTelegramMessage(botToken, chatId, `❌ Failed to deliver reply: ${err.message}`);
    }
  }

  // 14. Cancel Pending AI Draft
  if (data.startsWith('cancel_draft:')) {
    const draftId = data.replace('cancel_draft:', '').trim();
    pendingDrafts.delete(draftId);
    return sendTelegramMessage(botToken, chatId, `❌ *Draft cancelled.*`);
  }

  // 15. Blacklist / Do Not Contact
  if (data.startsWith('blacklist:')) {
    const publicId = data.replace('blacklist:', '').trim();
    try {
      await addToBlacklist(publicId);
      return sendTelegramMessage(
        botToken,
        chatId,
        `🚫 *Lead Blacklisted:* \`${publicId}\` added to Do Not Contact.`
      );
    } catch (err) {
      return sendTelegramMessage(botToken, chatId, `❌ Failed to blacklist: ${err.message}`);
    }
  }

  // 16. Block Company
  if (data.startsWith('block_co:')) {
    const company = data.replace('block_co:', '').trim();
    try {
      await addCompanyToBlacklist(company);
      return sendTelegramMessage(
        botToken,
        chatId,
        `🏢 *Company Excluded:* \`${company}\` added to Company Exclusion list.\n\nAll campaigns will automatically skip prospects from this company.`
      );
    } catch (err) {
      return sendTelegramMessage(botToken, chatId, `❌ Failed to block company: ${err.message}`);
    }
  }

  // 17. Send 1-Tap Resume Link
  if (data.startsWith('reply_resume:')) {
    const publicId = data.replace('reply_resume:', '').trim();
    const activeCand = await getActiveCandidate().catch(() => null);
    const resumeUrl = activeCand?.resumeUrl || activeCand?.resumeLink || '';
    if (!resumeUrl) {
      return sendTelegramMessage(
        botToken,
        chatId,
        `⚠️ *No Resume URL Configured:*\nPlease set the resume URL in OutFox Dashboard ➔ *Templates ➔ Objections Playbook*.`
      );
    }
    const cal = activeCand?.bookingLink ? ` You can also pick a 10-min slot on my calendar if helpful: ${activeCand.bookingLink}` : '';
    const body = `Hi! Here is a direct link to my resume: ${resumeUrl} .${cal}`;
    try {
      await voyager.sendMessage({ publicId, body });
      return sendTelegramMessage(
        botToken,
        chatId,
        `📄 *Resume Link Delivered!*\nSuccessfully sent resume link to \`${publicId}\` on LinkedIn.`
      );
    } catch (err) {
      return sendTelegramMessage(botToken, chatId, `❌ Failed to send resume link: ${err.message}`);
    }
  }

  // 18. Snooze 30 Days
  if (data.startsWith('snooze_30:')) {
    const publicId = data.replace('snooze_30:', '').trim();
    try {
      const snoozed = await snoozeLead({ publicId, days: 30, note: 'Snoozed from Telegram' });
      const wakeDate = new Date(snoozed.wakeAt).toLocaleDateString();
      return sendTelegramMessage(
        botToken,
        chatId,
        `⏰ *Lead Snoozed for 30 Days!*\n\`${publicId}\` will be snoozed until *${wakeDate}*.\n\nYou will receive a reminder when it is time to follow up!`
      );
    } catch (err) {
      return sendTelegramMessage(botToken, chatId, `❌ Failed to snooze lead: ${err.message}`);
    }
  }
}

export function stopTelegramPoller() {
  isPolling = false;
  if (pollAbortController) {
    try {
      pollAbortController.abort();
    } catch {}
    pollAbortController = null;
  }
}

export function restartTelegramPoller(token, chatId) {
  stopTelegramPoller();
  if (!token || !chatId) return;
  startTelegramPoller(token, chatId);
}

export async function startTelegramPoller(token, chatId) {
  if (isPolling) return;
  isPolling = true;

  console.log('[Telegram Poller] Starting Blueprint + Persona poll for chat ID:', chatId);

  (async () => {
    while (isPolling) {
      try {
        pollAbortController = new AbortController();
        const url = `${TELEGRAM_API_BASE}/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`;
        const res = await fetch(url, { signal: pollAbortController.signal });
        const data = await res.json();

        if (data.ok && Array.isArray(data.result)) {
          for (const update of data.result) {
            lastUpdateId = Math.max(lastUpdateId, update.update_id);

            // 1. Handle Inline Action Buttons
            if (update.callback_query) {
              const cq = update.callback_query;
              if (String(cq.message?.chat?.id) === String(chatId)) {
                await answerCallbackQuery(token, cq.id, 'Executing...');
                await handleCallback(token, chatId, cq.data).catch(console.error);
              }
              continue;
            }

            const msg = update.message;
            if (!msg || String(msg.chat.id) !== String(chatId)) continue;

            // 2. Handle Voice Notes via Groq Whisper
            if (msg.voice && msg.voice.file_id) {
              await sendTelegramMessage(token, chatId, `🎙️ *Voice Note Received! Transcribing via Whisper...*`);
              try {
                const transcribed = await transcribeVoice(token, msg.voice.file_id);
                await sendTelegramMessage(token, chatId, `🗣️ *You Said:* _"${transcribed}"_`);
                await handleUserCommand(token, chatId, transcribed);
              } catch (vErr) {
                await sendTelegramMessage(token, chatId, `❌ Voice transcription error: ${vErr.message}`);
              }
              continue;
            }

            // 3. Handle Text Commands
            if (msg.text) {
              await handleUserCommand(token, chatId, msg.text).catch(console.error);
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') break;
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    console.log('[Telegram Poller] Polling stopped.');
  })();
}

// 🔔 Full Lifecycle Event Subscriber
onEvent(async (name, payload = {}) => {
  try {
    const cfg = await getConfig();
    const tg = cfg.telegram || {};
    if (!tg.enabled || !tg.botToken || !tg.chatId) return;

    const now = Date.now();
    cleanOldCaches();

    // 1. Inbound Replies (EVENTS.REPLY_RECEIVED / EVENTS.POSITIVE_REPLY)
    if (name === EVENTS.REPLY_RECEIVED || name === EVENTS.POSITIVE_REPLY) {
      const publicId = payload.publicId || payload.fromPublicId;
      if (!publicId) return;

      const dedupeKey = `inbound:${publicId}:${payload.body || payload.text || ''}`;
      const lastTime = recentAlertDedupe.get(dedupeKey) || 0;
      if (now - lastTime < 10 * 60 * 1000) return;
      recentAlertDedupe.set(dedupeKey, now);

      const bodyText = payload.body || payload.text || '';
      const sentiment = payload.sentiment || (name === EVENTS.POSITIVE_REPLY ? 'positive' : 'neutral');
      const intent = payload.intent || 'interest';

      lastInboundReplies.set(publicId, {
        body: bodyText,
        sentiment,
        intent,
        at: now,
      });

      let company = payload.company || payload.companyName;
      if (!company) {
        const stored = await getStoredProfile(publicId).catch(() => null);
        company = stored?.company || stored?.companyName;
      }

      // Analyze Intent & Match Objection Playbook
      const match = await matchAndAdaptObjection(bodyText, {
        publicId,
        fullName: payload.fullName || payload.name,
        company,
      }).catch(() => null);

      let draftButton = null;
      let playbookSection = '';

      if (match && match.personalizedReply) {
        const draftId = 'd_' + Math.random().toString(36).slice(2, 9);
        pendingDrafts.set(draftId, { publicId, text: match.personalizedReply, at: now });
        draftButton = [{ text: '✨ Send AI Playbook Reply Now', callback_data: `send_draft:${draftId}` }];
        playbookSection =
          `\n🏷️ *Detected Intent:* \`${match.tag}\` (${match.title})\n` +
          `🤖 *AI Playbook Suggested Reply:*\n"${match.personalizedReply}"\n`;
      }

      const sentimentLabel =
        sentiment === 'positive' || name === EVENTS.POSITIVE_REPLY
          ? 'High Interest / Ready to Connect!'
          : `${sentiment.toUpperCase()} Interest`;

      const alertMsg =
        `🔥 *HOT LEAD INBOUND REPLY!*\n\n` +
        `👤 *Lead:* \`${publicId}\`\n` +
        `🔗 [Open LinkedIn Profile](https://linkedin.com/in/${publicId})\n` +
        `✨ *AI Sentiment:* ${sentimentLabel}\n\n` +
        `💬 *Inbound Reply:*\n` +
        `"${bodyText}"\n` +
        playbookSection;

      const keyboard = [];
      if (draftButton) keyboard.push(draftButton);
      keyboard.push([
        { text: '📄 Send Resume Link', callback_data: `reply_resume:${publicId}` },
        { text: '📅 Send Booking Link', callback_data: `reply_cal:${publicId}` },
      ]);
      keyboard.push([
        { text: '⏰ Snooze 30 Days', callback_data: `snooze_30:${publicId}` },
        { text: '📧 Find Email', callback_data: `enrich:${publicId}` },
      ]);
      keyboard.push([
        { text: '🔄 Regenerate AI', callback_data: `reply_ai:${publicId}` },
        { text: '🚫 Do Not Contact', callback_data: `blacklist:${publicId}` },
      ]);
      if (company) {
        keyboard.push([{ text: `🏢 Block Company (${company})`, callback_data: `block_co:${company}` }]);
      }

      const replyMarkup = { inline_keyboard: keyboard };
      await sendTelegramAlert(alertMsg, { reply_markup: replyMarkup });
    }

    // 2. Accepted Connections (EVENTS.INVITE_ACCEPTED)
    else if (name === EVENTS.INVITE_ACCEPTED) {
      const publicId = payload.publicId;
      if (!publicId) return;

      const dedupeKey = `accepted:${publicId}`;
      const lastTime = recentAlertDedupe.get(dedupeKey) || 0;
      if (now - lastTime < 10 * 60 * 1000) return;
      recentAlertDedupe.set(dedupeKey, now);

      const alertMsg =
        `🤝 *CONNECTION REQUEST ACCEPTED!*\n\n` +
        `👤 *Lead:* \`${publicId}\`\n` +
        `🔗 [Open LinkedIn Profile](https://linkedin.com/in/${publicId})\n\n` +
        `Candidate accepted your invitation! Choose an action:`;

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '📅 Send Booking Link', callback_data: `reply_cal:${publicId}` },
            { text: '✨ AI Draft Welcome', callback_data: `reply_ai:${publicId}` },
          ],
          [{ text: '📧 Find Email (Apollo)', callback_data: `enrich:${publicId}` }],
        ],
      };

      await sendTelegramAlert(alertMsg, { reply_markup: replyMarkup });
    }

    // 3. Campaign Finished Processing (EVENTS.CAMPAIGN_COMPLETED)
    else if (name === EVENTS.CAMPAIGN_COMPLETED) {
      const campaignId = payload.campaignId;
      const allCamps = await campaigns.getAll().catch(() => []);
      const camp = allCamps.find((c) => c.campaignId === campaignId);
      const stats = camp?.stats || {};

      const alertMsg =
        `🏁 *CAMPAIGN FINISHED PROCESSING!*\n\n` +
        `Campaign: *${camp?.name || 'Outreach Campaign'}*\n` +
        `• Enrolled: *${stats.enrolled || 0}* | Viewed: *${stats.viewed || 0}* | Invites Sent: *${stats.invited || 0}*\n` +
        `• Accepted: *${stats.accepted || 0}* | Replies: *${stats.replied || 0}*\n\n` +
        `_All prospect sequence steps have completed processing!_`;

      const replyMarkup = {
        inline_keyboard: [
          [{ text: '📊 View Outreach Pulse', callback_data: 'daily_stats' }],
        ],
      };

      await sendTelegramAlert(alertMsg, { reply_markup: replyMarkup });
    }

    // 4. Security Checkpoint Freeze (EVENTS.CHALLENGE_DETECTED)
    else if (name === EVENTS.CHALLENGE_DETECTED) {
      const dedupeKey = 'checkpoint:freeze';
      const lastTime = recentAlertDedupe.get(dedupeKey) || 0;
      if (now - lastTime < 10 * 60 * 1000) return;
      recentAlertDedupe.set(dedupeKey, now);

      // Auto-freeze all active campaigns
      try {
        const all = await campaigns.getAll();
        const active = all.filter((c) => c.status === 'active');
        for (const c of active) await campaigns.setStatus(c.campaignId, 'paused');
      } catch (e) {
        console.error('[Telegram Safety Guard Error]', e);
      }

      const alertMsg =
        `🚨 *SECURITY CHECKPOINT DETECTED!*\n\n` +
        `LinkedIn is asking you to confirm it's you.\n\n` +
        `🛡️ *Safety Guard Activated:* All outreach runners and sequences have been paused automatically.\n` +
        `👉 Please open LinkedIn in your browser and complete the check yourself, then tap Resume All below.`;

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '📊 Status', callback_data: 'camp_status' },
            { text: '▶️ Resume After Solving', callback_data: 'camp_resume' },
          ],
        ],
      };

      await sendTelegramAlert(alertMsg, { reply_markup: replyMarkup });
    }

    // 5. Daily Quota Cap Hit (EVENTS.QUOTA_HIT)
    else if (name === EVENTS.QUOTA_HIT) {
      const kind = payload.kind || 'outreach';
      const dedupeKey = `quota_hit:${kind}`;
      const lastTime = recentAlertDedupe.get(dedupeKey) || 0;
      if (now - lastTime < 10 * 60 * 1000) return;
      recentAlertDedupe.set(dedupeKey, now);

      const alertMsg =
        `⚠️ *DAILY OUTREACH LIMIT REACHED for ${kind}*\n\n` +
        `OutFox has paused ${kind} automation until morning to protect your LinkedIn account reputation.`;

      const replyMarkup = {
        inline_keyboard: [
          [{ text: '📊 Outreach Pulse', callback_data: 'daily_stats' }],
        ],
      };

      await sendTelegramAlert(alertMsg, { reply_markup: replyMarkup });
    }
  } catch (err) {
    console.error('[Telegram onEvent Handler Error]', err);
  }
});

// Auto-start poller on module load if configured
getConfig().then((cfg) => {
  if (cfg.telegram && cfg.telegram.enabled && cfg.telegram.botToken && cfg.telegram.chatId) {
    startTelegramPoller(cfg.telegram.botToken, cfg.telegram.chatId);
  }
}).catch(() => {});

register(ACTIONS.TELEGRAM_STATUS, () => getTelegramStatus());
register(ACTIONS.TELEGRAM_TEST, (params) => testTelegram(params));
register(ACTIONS.TELEGRAM_SAVE, (params) => saveTelegram(params));

export async function checkSnoozedReminders() {
  try {
    const cfg = await getConfig();
    const tg = cfg.telegram || {};
    if (!tg.enabled || !tg.botToken || !tg.chatId) return;

    const dueLeads = await popDueSnoozes();
    if (!dueLeads || dueLeads.length === 0) return;

    for (const lead of dueLeads) {
      const alertMsg =
        `⏰ *30-DAY SNOOZE REMINDER — TIME TO FOLLOW UP!*\n\n` +
        `👤 *Lead:* \`${lead.publicId}\`\n` +
        `📝 *Note:* ${lead.note || '30-day circle back'}\n` +
        `🔗 [Open LinkedIn Profile](https://linkedin.com/in/${lead.publicId})\n\n` +
        `_The 30-day cooling period has completed. Re-engage this lead now!_`;

      const replyMarkup = {
        inline_keyboard: [
          [{ text: '✨ Draft Reconnect AI Message', callback_data: `reply_ai:${lead.publicId}` }],
          [{ text: '📅 Send Booking Link', callback_data: `reply_cal:${lead.publicId}` }],
          [{ text: '⏰ Snooze Another 30 Days', callback_data: `snooze_30:${lead.publicId}` }],
        ],
      };

      await sendTelegramAlert(alertMsg, { reply_markup: replyMarkup });
    }
  } catch (err) {
    console.warn('[checkSnoozedReminders error]', err.message);
  }
}
