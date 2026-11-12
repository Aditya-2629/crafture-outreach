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
import { getActiveCandidate, setActiveCandidate, getAllCandidates, saveCandidate } from './candidates.js';
import { enrichLead } from './enrich.js';
import { matchAndAdaptObjection, snoozeLead, popDueSnoozes } from './objections.js';
import { syncAllLeadsToSheet, backupToGoogleDrive } from './google-workspace.js';

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

export async function sendChatAction(token, chatId, action = 'typing') {
  try {
    return await callTelegramApi(token, 'sendChatAction', {
      chat_id: chatId,
      action,
    });
  } catch {
    return null;
  }
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

// 🌐 Live Workspace Context Builder for Gemini-Grade Agentic Copilot
export async function buildAgentContext() {
  const [allLists, allCamps, activeCand, quotas, latestBp] = await Promise.all([
    lists.getAll().catch(() => []),
    campaigns.getAll().catch(() => []),
    getActiveCandidate().catch(() => null),
    snapshotAll().catch(() => ({})),
    getLatestBlueprint().catch(() => null),
  ]);

  const invitesLeft = Math.max(0, (quotas.invite?.dailyCap || 20) - (quotas.invite?.dailyUsed || 0));
  const messagesLeft = Math.max(0, (quotas.message?.dailyCap || 40) - (quotas.message?.dailyUsed || 0));
  const emailsLeft = Math.max(0, (quotas.email?.dailyCap || 50) - (quotas.email?.dailyUsed || 0));

  let bpStr = 'None';
  if (latestBp) {
    const stepsSummary = (latestBp.steps || [])
      .map((s, i) => {
        let desc = `Step ${i + 1} (${(s.type || 'action').toUpperCase()})`;
        if (s.delayDays) desc += ` [delay: ${s.delayDays}d]`;
        if (s.note) desc += `: Note="${s.note}"`;
        if (s.subject) desc += `: Subject="${s.subject}"`;
        if (s.body) desc += `: Body="${s.body}"`;
        return desc;
      })
      .join(' | ');
    bpStr = `ID: "${latestBp.blueprintId}", Campaign: "${latestBp.campaignName || latestBp.name}", TargetList: "${latestBp.listName}", Steps: [${stepsSummary}]`;
  }

  const campList = allCamps.map((c) => ({
    id: c.campaignId || c.id,
    name: c.name,
    status: c.status,
    enrolledCount: c.stats?.enrolled || 0,
    activeCount: c.stats?.active || 0,
    repliedCount: c.stats?.replied || 0,
    failedCount: c.stats?.failed || 0,
  }));

  const listsSummary = allLists.map((l) => ({
    listId: l.listId,
    name: l.name,
    count: l.count || l.itemCount || 0,
  }));

  return {
    activePersona: {
      name: activeCand?.name || 'Default',
      slug: activeCand?.slug || 'default',
      mode: activeCand?.mode || 'reverse_recruiting',
      resumeUrl: activeCand?.resumeUrl || '',
      calendarUrl: activeCand?.bookingLink || '',
    },
    prospectLists: listsSummary,
    campaigns: campList,
    quotasRemaining: {
      invitesLeft,
      messagesLeft,
      emailsLeft,
    },
    pendingBlueprint: latestBp,
    raw: { allLists, allCamps, activeCand, quotas, latestBp, bpStr },
  };
}

export function buildSystemPrompt(context) {
  const { activePersona, prospectLists, campaigns: campList, quotasRemaining, raw } = context;

  const listsStr = prospectLists.length
    ? prospectLists.map((l) => `  - "${l.name}" (ID: ${l.listId}, Leads: ${l.count})`).join('\n')
    : '  (No lists saved yet)';

  const campsStr = campList.length
    ? campList.map((c) => `  - "${c.name}" (ID: ${c.id}, Status: ${c.status}, Enrolled: ${c.enrolledCount}, Replied: ${c.repliedCount}, Failed: ${c.failedCount})`).join('\n')
    : '  (No campaigns yet)';

  return `You are OutFox AI SDR, an elite autonomous Agentic Copilot controlling LinkedIn outreach sequences directly from Telegram.

CORE CAPABILITIES & DIRECTIVES:
1. Multi-Turn ReAct Agent:
   - You understand user intent, inspect live workspace state, and execute 1 or more tools sequentially to fulfill requests.
2. Language & Tone:
   - Match the user's language and style seamlessly (natural Hinglish or English).
   - Be concise, direct, helpful, and proactive—like a trusted senior co-founder or SDR lead.
   - Avoid generic robotic disclaimers and corporate fluff.
3. Grounded Reality (Never Hallucinate):
   - Never invent or assume campaign stats, lead names, lists, or errors.
   - When asked about live status or progress, call \`get_campaign_live_status\`.
   - When asked about prospect lists, call \`list_prospect_lists\`.
4. Sequence Blueprints & Conversational Step Edits:
   - When user asks to design, create, or start a campaign (e.g. "design campaign for USA recruiters", "banao sequence"), call \`design_campaign_blueprint\`.
   - When user asks to edit, rewrite, translate, or adjust steps (e.g. "step 2 aur 3 dono change kar ke friendly bana de", "thoda casual bana de", "4 din baad ek breakup message aur daal"), call \`update_blueprint_steps\` to modify one or multiple steps at once.
   - Always present the updated copy and steps clearly in your response so the user can review before launching.
5. Multi-Action Execution:
   - If the user asks for multiple tasks at once (e.g. "pause old campaign and design a new sequence for recruiter leads"), execute both tools in your ReAct loop and summarize the outcomes together.

⚡ LIVE WORKSPACE STATE:
• Active Persona: "${activePersona.name}" (Slug: ${activePersona.slug}, Mode: ${activePersona.mode}, Resume: ${activePersona.resumeUrl || 'None'}, Calendar: ${activePersona.calendarUrl || 'None'})
• Saved Prospect Lists (${prospectLists.length}):
${listsStr}
• Campaigns (${campList.length}):
${campsStr}
• Today's Quotas Remaining:
  - Invites Left: ${quotasRemaining.invitesLeft}
  - Messages Left: ${quotasRemaining.messagesLeft}
  - Emails Left: ${quotasRemaining.emailsLeft}
• Current Pending Blueprint:
  ${raw.bpStr}
`;
}

// 🌐 Live Workspace Context Provider (Compatibility Wrapper)
export async function getLiveWorkspaceContext() {
  const ctx = await buildAgentContext();
  return {
    allLists: ctx.raw.allLists,
    allCamps: ctx.raw.allCamps,
    activeCand: ctx.raw.activeCand,
    quotas: ctx.raw.quotas,
  };
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
      name: 'get_campaign_live_status',
      description:
        'Get real-time live status of campaigns and prospects. Returns overall summary (active, waiting, completed, replied, failed) and per-lead status (fullName, company, status, currentStep, nextRunIn, lastError). Always call this when asked about live status or campaign progress.',
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
  {
    type: 'function',
    function: {
      name: 'list_prospect_lists',
      description: 'List all saved prospect lists with their IDs, names, and lead counts.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'design_campaign_blueprint',
      description:
        'Architect and design a new multi-step outreach sequence blueprint for user pre-flight approval and launch. Call when user asks to design, create, banao, or setup a campaign.',
      parameters: {
        type: 'object',
        properties: {
          listQuery: {
            type: 'string',
            description: 'Name or keywords of the prospect list to enroll leads from (e.g. "Data Analyst USA")',
          },
          campaignName: { type: 'string', description: 'Proposed name for the campaign' },
          goal: { type: 'string', description: 'Outreach goal (e.g. recruiter connection, founder pitch, job search)' },
          tone: { type: 'string', description: 'Tone of copy (e.g. casual, friendly, formal, direct)' },
          stepsCount: { type: 'number', description: 'Desired number of steps (e.g. 2, 3, or 4)' },
          inviteNote: { type: 'string', description: 'Personalized connection note with {{firstName}}' },
          followupMessage: { type: 'string', description: 'Warm welcome message after connection is accepted' },
        },
        required: ['listQuery'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_blueprint_steps',
      description:
        'Update one or multiple steps of the active campaign blueprint (e.g. change invite note, change follow-up messages, adjust delay days, or append new steps like breakup message). Use this when user says "step 2 aur 3 change kar", "make it more casual", "add a breakup message", etc.',
      parameters: {
        type: 'object',
        properties: {
          blueprintId: { type: 'string', description: 'Optional blueprint ID to update (defaults to latest pending blueprint)' },
          campaignName: { type: 'string', description: 'Updated campaign name if user requested a rename' },
          updates: {
            type: 'array',
            description: 'Array of updates to existing steps',
            items: {
              type: 'object',
              properties: {
                stepNumber: { type: 'number', description: '1-based step index (1, 2, 3, etc.)' },
                type: { type: 'string', enum: ['view', 'invite', 'message', 'email'], description: 'Step action type' },
                note: { type: 'string', description: 'New connection request note (for invite step)' },
                body: { type: 'string', description: 'New message body text (for message or email step)' },
                subject: { type: 'string', description: 'Email subject line (for email step)' },
                delayDays: { type: 'number', description: 'Days to wait before this step executes' },
              },
              required: ['stepNumber'],
            },
          },
          appendSteps: {
            type: 'array',
            description: 'New steps to append at the end of the sequence',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['view', 'invite', 'message', 'email'], description: 'Step action type' },
                note: { type: 'string', description: 'Connection note' },
                body: { type: 'string', description: 'Message body' },
                subject: { type: 'string', description: 'Email subject' },
                delayDays: { type: 'number', description: 'Days to wait before sending' },
                desc: { type: 'string', description: 'Short description of step' },
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'launch_blueprint',
      description: 'Convert and launch the active pending sequence blueprint into a live running campaign immediately.',
      parameters: {
        type: 'object',
        properties: {
          blueprintId: { type: 'string', description: 'Optional blueprint ID to launch (defaults to latest pending)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'control_campaign',
      description: 'Pause or resume one or all OutFox outreach campaigns.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['pause', 'resume'], description: 'Action to perform: pause or resume' },
          campaignNameOrId: {
            type: 'string',
            description: 'Optional specific campaign name or ID to control. If omitted, controls all campaigns.',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'switch_candidate_persona',
      description: 'Switch active candidate persona workspace (e.g. "aditya" or "agency") to update targeting, pitch templates, and booking links.',
      parameters: {
        type: 'object',
        properties: {
          slugOrName: { type: 'string', description: 'Name or slug of candidate to switch to, e.g. "aditya" or "agency"' },
        },
        required: ['slugOrName'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_candidate_links',
      description: 'Update resume URL or calendar/booking link for the active candidate persona.',
      parameters: {
        type: 'object',
        properties: {
          resumeUrl: { type: 'string', description: 'New PDF or Google Drive resume URL' },
          calendarUrl: { type: 'string', description: 'New Calendly or booking link URL' },
        },
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
      name: 'block_company',
      description: 'Add an entire company name or domain to the Company Exclusion list to skip all employees across campaigns.',
      parameters: {
        type: 'object',
        properties: {
          companyOrDomain: { type: 'string', description: 'Company name (e.g. "Infosys") or domain (e.g. "tcs.com")' },
        },
        required: ['companyOrDomain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'snooze_lead',
      description: 'Snooze a prospect for N days (default 30 days) to pause outreach and receive a follow-up reminder.',
      parameters: {
        type: 'object',
        properties: {
          publicId: { type: 'string', description: 'LinkedIn public ID or identifier of the lead' },
          days: { type: 'number', description: 'Number of days to snooze (default: 30)' },
        },
        required: ['publicId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sync_google_workspace',
      description: 'Sync OutFox CRM leads to Google Sheets or trigger a cloud backup to Google Drive.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['sync_sheet', 'backup_drive'], description: 'Action to perform: sync_sheet or backup_drive' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_and_save_leads',
      description: 'Search LinkedIn for prospects by keyword/title and location, and save to a list.',
      parameters: {
        type: 'object',
        properties: {
          keywords: { type: 'string', description: 'Job title or search keywords, e.g. "Data Analyst" or "Engineering Manager"' },
          location: { type: 'string', description: 'Geographic location filter, e.g. "United States" or "Austin, Texas"' },
          openToWorkOnly: { type: 'boolean', description: 'True if looking for candidates who are open to work' },
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

// 📋 Visual Blueprint Pre-Flight Approval Card
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

export async function launchBlueprintInternal(blueprintId) {
  const blueprints = await getStoredBlueprints();
  const blueprint =
    (blueprintId ? blueprints[blueprintId] : null) ||
    (blueprintId ? pendingBlueprints.get(blueprintId) : null) ||
    (await getLatestBlueprint());

  if (!blueprint) {
    throw new Error('Blueprint expired or not found.');
  }

  const camp = await campaigns.create({
    name: blueprint.campaignName || blueprint.name || 'Outreach Campaign',
    listId: blueprint.listId,
    steps: blueprint.steps,
    settings: { stopOnReply: true, autopilot: false },
  });

  const actualId = blueprint.blueprintId || blueprintId;
  if (actualId) await removeStoredBlueprint(actualId);

  const enrolled = await campaigns.readEnrollments(camp.campaignId).catch(() => []);
  return {
    campaign: camp,
    blueprint,
    enrolledCount: enrolled.length,
  };
}

export async function executeTool(name, args = {}) {
  if (name === 'get_campaign_live_status') {
    const all = await campaigns.getAll();
    let target = null;
    if (args.campaignNameOrId) {
      const q = String(args.campaignNameOrId).toLowerCase().trim();
      target = all.find(
        (c) =>
          c.campaignId === args.campaignNameOrId ||
          c.id === args.campaignNameOrId ||
          (c.name && c.name.toLowerCase() === q) ||
          (c.name && c.name.toLowerCase().includes(q)),
      );
    }
    const campId = target
      ? target.campaignId || target.id
      : all.find((c) => c.status === 'active')?.campaignId || all[0]?.campaignId || null;

    if (!campId) {
      return {
        status: 'no_campaigns',
        message: 'No campaigns found in workspace.',
      };
    }

    const liveData = await campaigns.getCampaignLiveStatus(campId);
    return {
      status: 'ok',
      campaignId: campId,
      campaignName: liveData.campaignName || target?.name || 'Campaign',
      summary: liveData.summary || {},
      leadsCount: (liveData.leads || []).length,
      topLeads: (liveData.leads || []).slice(0, 8).map((l) => ({
        fullName: l.fullName || 'Lead',
        company: l.company || '',
        status: l.status,
        currentStep: l.currentStep,
        nextRunIn: l.nextRunIn,
        lastError: l.lastError || null,
      })),
    };
  }

  if (name === 'list_prospect_lists') {
    const all = await lists.getAll();
    return {
      totalLists: all.length,
      lists: all.map((l) => ({
        listId: l.listId,
        name: l.name,
        count: l.count || l.itemCount || 0,
      })),
    };
  }

  if (name === 'design_campaign_blueprint' || name === 'create_outreach_campaign') {
    const allLists = await lists.getAll();
    const activeCand = await getActiveCandidate();
    const searchName = String(args.listQuery || args.listName || '').trim();

    const matchObj = findBestMatchingList(allLists, searchName);
    const targetList = matchObj
      ? matchObj.match
      : allLists.find((l) => (l.name || '').toLowerCase().includes(searchName.toLowerCase())) ||
        allLists[0] ||
        { name: searchName || 'Leads', listId: 'unknown', count: 25 };

    const blueprintId = 'bp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const blueprint = createOptimalBlueprint(blueprintId, targetList, activeCand, {
      campaignName: args.campaignName,
      name: args.campaignName,
      inviteNote: args.inviteNote,
      followupMessage: args.followupMessage,
      hasViewStep: args.hasViewStep !== false,
    });

    if (args.stepsCount === 2) {
      blueprint.steps = blueprint.steps.filter((s) => s.type === 'invite' || s.type === 'message');
    } else if (args.stepsCount === 1) {
      blueprint.steps = blueprint.steps.filter((s) => s.type === 'invite');
    }

    await saveStoredBlueprint(blueprintId, blueprint);

    return {
      ok: true,
      blueprintId,
      campaignName: blueprint.campaignName,
      listName: blueprint.listName,
      leadCount: blueprint.leadCount,
      stepsCount: blueprint.steps.length,
      steps: blueprint.steps.map((s, idx) => ({
        stepNumber: idx + 1,
        type: s.type,
        note: s.note || null,
        body: s.body || null,
        subject: s.subject || null,
        delayDays: s.delayDays || 0,
        desc: s.desc || s.type,
      })),
    };
  }

  if (name === 'update_blueprint_steps' || name === 'edit_campaign_blueprint') {
    let bp = null;
    if (args.blueprintId) {
      const allBps = await getStoredBlueprints();
      bp = allBps[args.blueprintId] || pendingBlueprints.get(args.blueprintId);
    }
    if (!bp) {
      bp = await getLatestBlueprint();
    }
    if (!bp) {
      const allLists = await lists.getAll().catch(() => []);
      const activeCand = await getActiveCandidate().catch(() => null);
      const targetList = allLists[0] || { name: 'USA Prospects', listId: 'unknown', count: 25 };
      const bpId = `bp_${Date.now()}`;
      bp = createOptimalBlueprint(bpId, targetList, activeCand, {});
    }

    const blueprintId = bp.blueprintId || `bp_${Date.now()}`;

    if (args.campaignName) {
      bp.campaignName = args.campaignName.trim();
      bp.name = bp.campaignName;
    }

    // Support legacy single stepToEdit argument
    if (args.stepToEdit && args.newText) {
      const stepToEdit = args.stepToEdit;
      let cleanText = String(args.newText || '').trim().replace(/\{\{\s*full_name\s*\}\}/gi, '{{firstName}}');
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
    }

    // Apply updates array for multi-step editing
    if (Array.isArray(args.updates)) {
      for (const upd of args.updates) {
        const stepNum = Number(upd.stepNumber);
        if (!stepNum || stepNum < 1) continue;
        const idx = stepNum - 1;

        if (!bp.steps[idx]) {
          bp.steps[idx] = {
            type: upd.type || 'message',
            desc: `Step ${stepNum}`,
            delayDays: upd.delayDays || 1,
          };
        }

        const step = bp.steps[idx];
        if (upd.type) step.type = upd.type;
        if (upd.note !== undefined) {
          step.note = String(upd.note).replace(/\{\{\s*full_name\s*\}\}/gi, '{{firstName}}');
          bp.inviteNote = step.note;
        }
        if (upd.body !== undefined) {
          step.body = String(upd.body).replace(/\{\{\s*full_name\s*\}\}/gi, '{{firstName}}');
          if (step.type === 'message' || !bp.followupMessage) {
            bp.followupMessage = step.body;
          }
        }
        if (upd.subject !== undefined) step.subject = String(upd.subject);
        if (upd.delayDays !== undefined) step.delayDays = Number(upd.delayDays);
      }
    }

    // Append new steps
    if (Array.isArray(args.appendSteps)) {
      for (const ns of args.appendSteps) {
        bp.steps.push({
          type: ns.type || 'message',
          body: ns.body ? String(ns.body).replace(/\{\{\s*full_name\s*\}\}/gi, '{{firstName}}') : undefined,
          note: ns.note ? String(ns.note).replace(/\{\{\s*full_name\s*\}\}/gi, '{{firstName}}') : undefined,
          subject: ns.subject,
          delayDays: ns.delayDays !== undefined ? Number(ns.delayDays) : 2,
          desc: ns.desc || (ns.type === 'message' ? 'Follow-up message' : ns.type),
        });
      }
    }

    await saveStoredBlueprint(blueprintId, bp);

    return {
      ok: true,
      blueprintId,
      campaignName: bp.campaignName,
      listName: bp.listName,
      leadCount: bp.leadCount || 0,
      stepsCount: bp.steps.length,
      steps: bp.steps.map((s, idx) => ({
        stepNumber: idx + 1,
        type: s.type,
        note: s.note || null,
        body: s.body || null,
        subject: s.subject || null,
        delayDays: s.delayDays || 0,
        desc: s.desc || s.type,
      })),
    };
  }

  if (name === 'launch_blueprint') {
    const res = await launchBlueprintInternal(args.blueprintId);
    return {
      ok: true,
      campaignId: res.campaign.campaignId,
      campaignName: res.campaign.name,
      listName: res.blueprint.listName,
      enrolledCount: res.enrolledCount,
      stepsCount: res.blueprint.steps.length,
    };
  }

  if (name === 'control_campaign' || name === 'manage_campaigns') {
    const all = await campaigns.getAll();
    const action = args.action;
    let target = null;
    if (args.campaignNameOrId) {
      const q = String(args.campaignNameOrId).toLowerCase().trim();
      target = all.find(
        (c) =>
          c.campaignId === args.campaignNameOrId ||
          c.id === args.campaignNameOrId ||
          (c.name && c.name.toLowerCase() === q) ||
          (c.name && c.name.toLowerCase().includes(q)),
      );
    }

    if (action === 'pause') {
      const toPause = target ? [target] : all.filter((c) => c.status === 'active' || c.status === 'running');
      for (const c of toPause) await campaigns.setStatus(c.campaignId, 'paused');
      return {
        ok: true,
        action: 'paused',
        count: toPause.length,
        campaigns: toPause.map((c) => c.name),
      };
    } else if (action === 'resume') {
      const toResume = target ? [target] : all.filter((c) => c.status === 'paused');
      for (const c of toResume) await campaigns.setStatus(c.campaignId, 'active');
      return {
        ok: true,
        action: 'resumed',
        count: toResume.length,
        campaigns: toResume.map((c) => c.name),
      };
    }
    return {
      total: all.length,
      active: all.filter((c) => c.status === 'active').length,
      paused: all.filter((c) => c.status === 'paused').length,
    };
  }

  if (name === 'switch_candidate_persona' || name === 'switch_candidate_workspace') {
    const targetSlug = args.slugOrName || args.candidateNameOrSlug;
    const switched = await setActiveCandidate(targetSlug);
    return {
      ok: true,
      name: switched.name,
      slug: switched.slug,
      title: switched.title,
      mode: switched.mode,
      bookingLink: switched.bookingLink,
      resumeUrl: switched.resumeUrl || '',
    };
  }

  if (name === 'update_candidate_links') {
    const cand = await getActiveCandidate();
    if (!cand) return { ok: false, message: 'No active candidate persona found.' };
    if (args.resumeUrl) cand.resumeUrl = String(args.resumeUrl).trim();
    if (args.calendarUrl) cand.bookingLink = String(args.calendarUrl).trim();
    const saved = await saveCandidate(cand);
    return {
      ok: true,
      name: saved.name,
      resumeUrl: saved.resumeUrl,
      calendarUrl: saved.bookingLink,
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

  if (name === 'block_company') {
    const company = args.companyOrDomain || args.company;
    await addCompanyToBlacklist(company);
    return {
      ok: true,
      blocked: company,
      message: `Company '${company}' added to exclusion blacklist.`,
    };
  }

  if (name === 'snooze_lead') {
    const snoozed = await snoozeLead({
      publicId: args.publicId,
      days: Number(args.days) || 30,
    });
    return {
      ok: true,
      publicId: args.publicId,
      days: Number(args.days) || 30,
      reminderAt: snoozed.reminderAt,
    };
  }

  if (name === 'sync_google_workspace') {
    if (args.action === 'backup_drive') {
      const res = await backupToGoogleDrive();
      return { ok: true, action: 'backup_drive', fileId: res?.fileId, name: res?.name };
    } else {
      const res = await syncAllLeadsToSheet();
      return { ok: true, action: 'sync_sheet', syncedRows: res?.syncedRows || 0 };
    }
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

  if (name === 'send_linkedin_message') {
    await voyager.sendMessage({
      publicId: args.recipientNameOrUrn,
      body: args.message,
    });
    return { sent: true, recipient: args.recipientNameOrUrn };
  }

  throw new Error(`Unknown tool: ${name}`);
}

// Convert OpenAI JSON schema types to Gemini uppercase types recursively
function _toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = { ...schema };
  if (out.type) out.type = out.type.toUpperCase();
  if (out.properties)
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, _toGeminiSchema(v)])
    );
  if (out.items) out.items = _toGeminiSchema(out.items);
  return out;
}

function _toGeminiFunctionDeclarations(tools) {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: _toGeminiSchema(t.function.parameters),
  }));
}

// Convert OpenAI-format history turns to Gemini `contents` format
function _toGeminiContents(openAiMessages) {
  return openAiMessages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    }));
}

export async function callLlmWithTools(provider, aiConfig, messages, tools = [], geminiContents = null) {
  const apiKey = String(aiConfig.apiKey || '').trim();
  const baseUrl = String(aiConfig.baseUrl || '').trim();
  const model = String(aiConfig.model || '').trim() ||
    (provider === 'groq' ? 'llama-3.3-70b-versatile'
      : provider === 'gemini' ? 'gemini-2.5-flash'
      : provider === 'anthropic' ? 'claude-3-5-sonnet-latest'
      : 'gpt-4o-mini');

  const useTools = Array.isArray(tools) && tools.length > 0;

  if (provider === 'anthropic') {
    const url = `${aiConfig.baseUrl || 'https://api.anthropic.com'}/v1/messages`;
    const sysMsg = messages.find((m) => m.role === 'system');
    const nonSysMessages = messages.filter((m) => m.role !== 'system');

    while (nonSysMessages.length > 0 && nonSysMessages[0].role !== 'user') {
      nonSysMessages.shift();
    }
    if (nonSysMessages.length === 0) {
      nonSysMessages.push({ role: 'user', content: 'Hello' });
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        system: sysMsg?.content || '',
        messages: nonSysMessages,
        ...(useTools
          ? {
              tools: tools.map((t) => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters,
              })),
            }
          : {}),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 180)}`);
    }

    const data = await res.json();
    let text = '';
    const toolCalls = [];
    if (Array.isArray(data.content)) {
      for (const part of data.content) {
        if (part.type === 'text') text += part.text;
        else if (part.type === 'tool_use') {
          toolCalls.push({
            id: part.id,
            name: part.name,
            args: part.input || {},
          });
        }
      }
    }
    return { text, toolCalls, rawContent: data.content };
  }

  // --- Gemini: native generateContent (preserves thoughtSignature) ---
  if (provider === 'gemini') {
    const resolvedModel = model || 'gemini-2.5-flash';
    const baseHost = baseUrl || 'https://generativelanguage.googleapis.com';
    const url = `${baseHost}/v1beta/models/${resolvedModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const sysMsg = messages.find((m) => m.role === 'system');
    // Use pre-built Gemini contents if provided, otherwise convert history
    const contents = geminiContents || _toGeminiContents(messages);

    const payload = {
      contents,
      ...(sysMsg ? { systemInstruction: { parts: [{ text: sysMsg.content }] } } : {}),
      ...(useTools ? { tools: [{ functionDeclarations: _toGeminiFunctionDeclarations(tools) }] } : {}),
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GEMINI API error ${res.status}: ${errText.slice(0, 180)}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    // Keep exact untouched candidate content, ensuring valid role
    const rawGeminiContent = candidate?.content || { role: 'model', parts: [] };
    if (!rawGeminiContent.role) rawGeminiContent.role = 'model';

    // Ensure thought_signature / thoughtSignature are preserved and available on all functionCall parts
    let turnSignature = candidate?.thought_signature || candidate?.thoughtSignature || null;
    for (const part of rawGeminiContent.parts || []) {
      if (!turnSignature && (part.thought_signature || part.thoughtSignature)) {
        turnSignature = part.thought_signature || part.thoughtSignature;
      }
      if (!turnSignature && (part.functionCall?.thought_signature || part.functionCall?.thoughtSignature)) {
        turnSignature = part.functionCall.thought_signature || part.functionCall.thoughtSignature;
      }
    }
    if (turnSignature && Array.isArray(rawGeminiContent.parts)) {
      for (const part of rawGeminiContent.parts) {
        if (!part.thought_signature) part.thought_signature = turnSignature;
        if (!part.thoughtSignature) part.thoughtSignature = turnSignature;
        if (part.functionCall) {
          if (!part.functionCall.thought_signature) part.functionCall.thought_signature = turnSignature;
          if (!part.functionCall.thoughtSignature) part.functionCall.thoughtSignature = turnSignature;
        }
      }
    }

    let text = '';
    const toolCalls = [];
    for (const part of rawGeminiContent.parts || []) {
      if (part.text && !part.thought) {
        text += part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          id: `gemini_${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
      }
    }
    return { text, toolCalls, rawGeminiContent };
  }

  // OpenAI / Groq / Ollama / openai-compatible
  let url = '';
  const headers = { 'Content-Type': 'application/json' };

  if (provider === 'groq') {
    url = `${baseUrl || 'https://api.groq.com'}/openai/v1/chat/completions`;
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'ollama') {
    url = `${baseUrl || 'http://127.0.0.1:11434'}/api/chat`;
  } else {
    // openai / openai-compatible
    url = `${baseUrl || 'https://api.openai.com/v1'}/chat/completions`;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const resolvedModel = model;

  const payload = {
    model: resolvedModel,
    messages,
    ...(useTools ? { tools, tool_choice: 'auto' } : {}),
  };
  if (provider === 'ollama') {
    payload.stream = false;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${provider.toUpperCase()} API error ${res.status}: ${errText.slice(0, 180)}`);
  }

  const data = await res.json();

  if (provider === 'ollama') {
    const msg = data.message;
    const text = msg?.content || '';
    const toolCalls = [];
    if (Array.isArray(msg?.tool_calls)) {
      for (const tc of msg.tool_calls) {
        toolCalls.push({
          id: tc.id || `call_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.function?.name,
          args: typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {}),
        });
      }
    }
    return { text, toolCalls, rawMessage: msg };
  }

  const msg = data.choices?.[0]?.message;
  const text = msg?.content || '';
  const toolCalls = [];
  if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      let parsedArgs = {};
      try {
        parsedArgs = typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || {});
      } catch (e) {
        parsedArgs = {};
      }
      toolCalls.push({
        id: tc.id || `call_${Math.random().toString(36).slice(2, 8)}`,
        name: tc.function?.name,
        args: parsedArgs,
      });
    }
  }

  return { text, toolCalls, rawMessage: msg };
}

export async function runAgentLoop(botToken, chatId, userText) {
  let typingTimer = null;
  const startTyping = () => {
    sendChatAction(botToken, chatId, 'typing');
    typingTimer = setInterval(() => {
      sendChatAction(botToken, chatId, 'typing');
    }, 3800);
  };
  const stopTyping = () => {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
  };

  startTyping();

  try {
    const cfg = await getConfig();
    const ai = cfg?.ai || {};
    const provider = String(ai.provider || 'none').toLowerCase();
    const apiKey = String(ai.apiKey || '').trim();

    const noKey = provider !== 'ollama' && provider !== 'openai-compatible' && !apiKey;
    if (provider === 'none' || noKey) {
      const offlineMsg =
        `⚠️ *AI Copilot Not Configured:*\n` +
        `OutFox Dashboard ➔ *Settings ➔ AI Engine* me jaakar apna Groq ya Gemini API Key connect karo!\n\n` +
        `_Quick Actions Available:_\n` +
        `• \`/live\` — Check live campaigns\n` +
        `• \`/pulse\` — Daily scorecard\n` +
        `• \`/candidates\` — Switch persona`;
      stopTyping();
      return sendTelegramMessage(botToken, chatId, offlineMsg);
    }

    const contextData = await buildAgentContext();
    const systemPrompt = buildSystemPrompt(contextData);
    const recentHistory = await getRecentChatTurns();

    // Avoid duplicate user message if already recorded
    let historyTurns = [...recentHistory];
    if (
      historyTurns.length > 0 &&
      historyTurns[historyTurns.length - 1].role === 'user' &&
      historyTurns[historyTurns.length - 1].content.trim() === userText.replace(/[*_`\[\]]/g, '').trim().slice(0, 500)
    ) {
      historyTurns.pop();
    }

    let messages = [
      { role: 'system', content: systemPrompt },
      ...historyTurns,
      { role: 'user', content: userText },
    ];

    // Gemini needs its own contents array (native format, no system role)
    const isGemini = provider === 'gemini';
    let geminiContents = isGemini
      ? [
          ..._toGeminiContents(historyTurns),
          { role: 'user', parts: [{ text: userText }] },
        ]
      : null;

    let lastBlueprint = null;
    let launchedCampaign = null;
    let controlledCampaigns = null;
    let finalContent = '';
    let iterations = 0;
    const MAX_ITERATIONS = 5;

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      const response = await callLlmWithTools(provider, ai, messages, AI_TOOLS, geminiContents);

      if (response.toolCalls && response.toolCalls.length > 0) {
        if (isGemini) {
          // Push raw model content VERBATIM — preserves thoughtSignature
          geminiContents.push(response.rawGeminiContent);
        } else if (provider === 'anthropic') {
          messages.push({
            role: 'assistant',
            content: response.rawContent || response.toolCalls.map((tc) => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.args,
            })),
          });
        } else {
          // OpenAI / Groq / Ollama / openai-compatible — push raw assistant message
          messages.push(
            response.rawMessage || {
              role: 'assistant',
              content: response.text || null,
              tool_calls: response.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.args) },
              })),
            }
          );
        }

        const functionResponses = []; // collected for Gemini batch push
        for (const tc of response.toolCalls) {
          let toolOutput;
          try {
            toolOutput = await executeTool(tc.name, tc.args);
          } catch (err) {
            toolOutput = { error: err.message || 'Tool execution failed' };
          }

          if (tc.name === 'design_campaign_blueprint' || tc.name === 'update_blueprint_steps') {
            lastBlueprint = toolOutput;
          } else if (tc.name === 'launch_blueprint') {
            launchedCampaign = toolOutput;
          } else if (tc.name === 'control_campaign') {
            controlledCampaigns = toolOutput;
          }

          if (isGemini) {
            functionResponses.push({
              functionResponse: { name: tc.name, response: { result: toolOutput } },
            });
          } else if (provider === 'anthropic') {
            messages.push({
              role: 'user',
              content: [{ type: 'tool_result', tool_use_id: tc.id, content: JSON.stringify(toolOutput) }],
            });
          } else {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(toolOutput) });
          }
        }

        // Gemini: single user turn with all function responses
        if (isGemini && functionResponses.length > 0) {
          geminiContents.push({ role: 'user', parts: functionResponses });
        }
      } else {
        finalContent = response.text || '';
        break;
      }
    }

    if (!finalContent && lastBlueprint) {
      finalContent = `📋 *Campaign Blueprint Ready!*\n\n• Campaign: *${lastBlueprint.campaignName}*\n• Target List: *${lastBlueprint.listName}*\n• Steps: *${(lastBlueprint.steps || []).length}*`;
    }

    if (!finalContent) {
      finalContent = 'Understood. Done!';
    }

    // Build action buttons based on executed tools
    const inlineButtons = [];

    if (lastBlueprint && (lastBlueprint.blueprintId || lastBlueprint.ok)) {
      const bpId = lastBlueprint.blueprintId || (await getLatestBlueprint())?.blueprintId;
      if (bpId) {
        inlineButtons.push([
          { text: '🚀 Launch Campaign Now', callback_data: `camp_approve:${bpId}` },
        ]);
        inlineButtons.push([
          { text: '✏️ Edit Note / Pitch', callback_data: `camp_edit_info:${bpId}` },
          { text: '❌ Discard', callback_data: `camp_discard:${bpId}` },
        ]);
      }
    } else if (controlledCampaigns) {
      inlineButtons.push([
        { text: '📊 Live Status', callback_data: 'live_status' },
        { text: controlledCampaigns.action === 'paused' ? '▶️ Resume All' : '⏸️ Pause All', callback_data: controlledCampaigns.action === 'paused' ? 'camp_resume' : 'camp_pause' },
      ]);
    } else if (launchedCampaign) {
      inlineButtons.push([
        { text: '📊 Live Status', callback_data: 'live_status' },
        { text: '⏸️ Pause Campaign', callback_data: 'camp_pause' },
      ]);
    }

    await recordChatTurn('assistant', finalContent);

    stopTyping();
    const replyMarkup = inlineButtons.length > 0 ? { inline_keyboard: inlineButtons } : undefined;
    return await sendTelegramMessage(botToken, chatId, finalContent, replyMarkup ? { reply_markup: replyMarkup } : {});
  } catch (err) {
    console.error('[Telegram Agent Loop Error]', err);
    stopTyping();
    const fallbackText = `⚠️ *Copilot Error:* ${err.message || 'Something went wrong.'}\n\n_Tip: Use /live or /clear to reset._`;
    return await sendTelegramMessage(botToken, chatId, fallbackText);
  } finally {
    stopTyping();
  }
}

export async function callDynamicAi(userText, options = {}) {
  const cfg = await getConfig();
  const ai = cfg.ai || {};
  const provider = ai.provider || 'none';

  if (provider === 'none' || (!ai.apiKey && provider !== 'ollama')) {
    return {
      type: 'text',
      content: 'AI Engine not configured.',
    };
  }

  const systemPrompt =
    options.systemPrompt ||
    'You are OutFox AI SDR, an expert LinkedIn outreach copywriter. Write concise, warm, professional responses without corporate fluff. Keep under 240 characters.';
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userText },
  ];

  const res = await callLlmWithTools(provider, ai, messages, []);
  return {
    type: 'text',
    content: res.text,
  };
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

  // 1. Candidate Switcher Commands
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

  // 2. Email Waterfall Enrichment Command
  const enrichMatch = trimmed.match(/^\/enrich\s+([a-zA-Z0-9\-_%]+)/i);
  if (enrichMatch) {
    const publicId = enrichMatch[1].trim();
    return handleEnrichLead(botToken, chatId, publicId);
  }

  // 3. Quick Daily Stats / Pulse Command
  if (/^\/?(pulse|stats|scorecard|daily\s*stats|report)/i.test(trimmed)) {
    return renderDailyStats(botToken, chatId);
  }

  // 4. Explicit Live Status Slash Command
  if (/^\/?live$/i.test(trimmed)) {
    return renderLiveCampaignStatus(botToken, chatId);
  }

  // 5. 100% of Natural Language Flows into the Multi-Turn ReAct Agent Loop
  return runAgentLoop(botToken, chatId, trimmed);
}

async function handleCallback(botToken, chatId, callbackData) {
  const data = String(callbackData || '');
  cleanOldCaches();

  // 1. Blueprint Pre-Flight Approval: Approve & Launch
  if (data.startsWith('camp_approve:')) {
    const blueprintId = data.replace('camp_approve:', '').trim();
    await sendTelegramMessage(botToken, chatId, `🚀 *Launching campaign sequence...*`);
    try {
      const res = await launchBlueprintInternal(blueprintId);
      await recordChatTurn('assistant', `Campaign "${res.campaign.name}" launched for list "${res.blueprint.listName}" with ${res.enrolledCount} enrolled leads.`);

      const launchMsg =
        `🚀 *Campaign Successfully Launched!*\n\n` +
        `• Campaign: *${res.campaign.name}*\n` +
        `• Target List: *${res.blueprint.listName}*\n` +
        `• Enrolled Leads: *${res.enrolledCount}*\n` +
        `• Sequence Steps: *${res.blueprint.steps.length}*\n\n` +
        `_OutFox background runner is now active!_`;

      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '📊 Campaign Status', callback_data: 'live_status' },
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

  // 10. Campaign Controls & Live Status
  if (data === 'live_status') {
    return renderLiveCampaignStatus(botToken, chatId);
  }

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
