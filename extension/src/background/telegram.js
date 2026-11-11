/**
 * OutFox — Telegram Autonomous AI SDR Engine
 * Dynamically uses the AI Provider (Groq, Gemini, OpenAI, Claude, Ollama)
 * configured by the user in OutFox Settings -> AI Engine.
 */

import { ACTIONS, ERROR, EngineError } from '../lib/actions.js';
import { getConfig, setConfig } from '../lib/config.js';
import { register } from './engine.js';
import * as voyager from './voyager.js';
import * as campaigns from './campaigns.js';
import * as lists from './lists.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';
let isPolling = false;
let pollAbortController = null;
let lastUpdateId = 0;

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

export async function sendTelegramMessage(token, chatId, text, options = {}) {
  return callTelegramApi(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...options,
  });
}

export async function testTelegram({ botToken, chatId }) {
  if (!botToken || !chatId) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Both Bot Token and Chat ID are required.');
  }
  const start = Date.now();
  const me = await callTelegramApi(botToken, 'getMe');
  const testMsg = `🦊 *OutFox Mobile AI Copilot Connected!*\n\n` +
    `Bot Name: *${me.first_name || 'OutFox'}* (@${me.username || 'bot'})\n` +
    `Latency: *${Date.now() - start}ms*\n\n` +
    `Tu ab apne mobile se direct commands bhej sakta hai:\n` +
    `• \`Search Austin Data Analyst OPT\`\n` +
    `• \`Campaign status dikhao\`\n` +
    `• \`Pause campaign\` / \`Resume campaign\``;

  await sendTelegramMessage(botToken, chatId, testMsg);
  return { ok: true, botUsername: me.username, latencyMs: Date.now() - start };
}

export async function saveTelegram({ botToken, chatId, enabled = true }) {
  const cfg = await getConfig();
  const current = cfg.telegram || {};
  const tokenToSave = botToken && !botToken.includes('•••') ? botToken.trim() : current.botToken;
  const chatIdToSave = chatId ? String(chatId).trim() : current.chatId;

  if (enabled && (!tokenToSave || !chatIdToSave)) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Bot Token and Chat ID are required.');
  }

  const updated = {
    ...current,
    botToken: tokenToSave,
    chatId: chatIdToSave,
    enabled: Boolean(enabled),
    status: enabled ? 'connected' : 'disconnected',
    updatedAt: Date.now(),
  };

  await setConfig({ telegram: updated });
  if (enabled) restartTelegramPoller(tokenToSave, chatIdToSave);
  else stopTelegramPoller();

  return { status: updated.status, enabled: updated.enabled, maskedToken: maskToken(tokenToSave) };
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
    isPolling,
  };
}

// =========================================================================
// AI Tools Schema (Exposed to dynamic LLM)
// =========================================================================
const AI_TOOLS = [
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
];

// =========================================================================
// Autonomous Tool Execution Engine
// =========================================================================
async function executeTool(name, args = {}) {
  if (name === 'search_and_save_leads') {
    let kw = args.keywords || 'Data Analyst';
    if (args.openToWorkOnly && !kw.includes('Open to work')) kw += ' "Open to work"';

    const searchRes = await voyager.searchProfiles({
      keywords: kw,
      location: args.location || 'United States',
      count: Math.min(Math.max(1, args.count || 10), 25),
    });

    const profiles = searchRes?.profiles || [];
    let listSaved = false;

    if (args.listName && profiles.length > 0) {
      try {
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
      return { resumedCount: paused.length, message: `${paused.length} campaign(s) resumed.` };
    }
    return {
      total: all.length,
      active: all.filter((c) => c.status === 'active').length,
      paused: all.filter((c) => c.status === 'paused').length,
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

// =========================================================================
// Dynamic AI Router (Reads Configured Provider & Model)
// =========================================================================
async function callDynamicAi(userText) {
  const cfg = await getConfig();
  const ai = cfg.ai || {};
  const provider = ai.provider || 'none';

  if (provider === 'none' || (!ai.apiKey && provider !== 'ollama')) {
    return {
      type: 'text',
      content: `⚠️ *AI Engine Not Configured:*\nOutFox Dashboard ➔ *Settings ➔ AI Engine* me jaakar apna Groq ya Gemini API Key connect karo taaki AI fully autonomous ban sake!\n\n_Filhal simple commands try karo:_\n• \`Campaign status\`\n• \`Pause campaign\`\n• \`Resume campaign\``,
    };
  }

  const apiKey = ai.apiKey || '';
  const model = ai.model || (provider === 'groq' ? 'llama-3.3-70b-versatile' : provider === 'gemini' ? 'gemini-2.0-flash' : 'gpt-4o-mini');

  const systemPrompt =
    'You are OutFox AI SDR, an autonomous assistant controlling LinkedIn outreach. ' +
    'Understand user requests in English, Hindi, or Hinglish. ' +
    'When the user asks to search prospects, save leads to a list, send messages, or manage campaigns, call the matching function tool. ' +
    'Always be helpful, warm, and accurate.';

  let url = '';
  let headers = { 'Content-Type': 'application/json' };
  let body = {};

  if (provider === 'groq') {
    url = `${ai.baseUrl || 'https://api.groq.com'}/openai/v1/chat/completions`;
    headers['Authorization'] = `Bearer ${apiKey}`;
    body = {
      model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
      tools: AI_TOOLS,
      tool_choice: 'auto',
    };
  } else if (provider === 'gemini') {
    url = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
    body = {
      model: model.includes('gemini') ? model : 'gemini-2.0-flash',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
      tools: AI_TOOLS,
      tool_choice: 'auto',
    };
  } else if (provider === 'openai' || provider === 'openai-compatible') {
    url = `${ai.baseUrl || 'https://api.openai.com/v1'}/chat/completions`;
    headers['Authorization'] = `Bearer ${apiKey}`;
    body = {
      model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
      tools: AI_TOOLS,
      tool_choice: 'auto',
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
      messages: [{ role: 'user', content: userText }],
      tools: AI_TOOLS.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      })),
    };
  } else if (provider === 'ollama') {
    url = `${ai.baseUrl || 'http://127.0.0.1:11434'}/api/chat`;
    body = {
      model: model || 'llama3.1',
      stream: false,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userText }],
      tools: AI_TOOLS,
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
    const toolUse = (data.content || []).find((c) => c.type === 'tool_use');
    if (toolUse) {
      return { type: 'tool_call', name: toolUse.name, args: toolUse.input || {} };
    }
    const textPart = (data.content || []).find((c) => c.type === 'text');
    return { type: 'text', content: textPart?.text || 'Understood.' };
  }

  const msg = data.choices?.[0]?.message;
  if (msg?.tool_calls?.length > 0) {
    const firstCall = msg.tool_calls[0];
    return {
      type: 'tool_call',
      name: firstCall.function.name,
      args: JSON.parse(firstCall.function.arguments || '{}'),
    };
  }

  return { type: 'text', content: msg?.content || 'Haan bhai, batao kya karna hai?' };
}

// =========================================================================
// Main User Command Processor
// =========================================================================
async function handleUserCommand(botToken, chatId, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;

  if (trimmed === '/start' || trimmed === '/help') {
    const welcome =
      `🦊 *OutFox Mobile AI Copilot Ready!*\n\n` +
      `Tu mujhse mobile par kisi bhi bhasha (Hindi/Hinglish/English) me baat kar sakta hai:\n\n` +
      `📌 *Dynamic Search & List Saving:*\n` +
      `• _"Search Indian Data Analysts in USA and name that list as Data Analyst USA"_\n` +
      `• _"Austin me 5 Engineering Managers dhoondo"_\n\n` +
      `📌 *Direct Messaging:*\n` +
      `• _"Sahil ko follow-up message bhej do: Are you free for a call?"_\n\n` +
      `📌 *Campaign Controls:*\n` +
      `• _"Campaign status dikhao"_\n` +
      `• _"Campaign pause kar do"_ ya _"Resume campaign"_`;
    return sendTelegramMessage(botToken, chatId, welcome);
  }

  try {
    await sendTelegramMessage(botToken, chatId, `⚡ *AI analyzing intent with your configured model...*`);

    const aiResult = await callDynamicAi(trimmed);

    if (aiResult.type === 'tool_call') {
      await sendTelegramMessage(botToken, chatId, `⚙️ *Executing:* \`${aiResult.name}\`...`);
      const execResult = await executeTool(aiResult.name, aiResult.args);

      let reply = `✅ *Action Completed Successfully!*\n\n`;

      if (aiResult.name === 'search_and_save_leads') {
        reply += `🎯 *Found ${execResult.countFound} Prospects on LinkedIn!*\n`;
        if (execResult.listSaved) {
          reply += `📁 *Saved to List:* \`${execResult.listName}\`\n\n`;
        }
        reply += `*Top Candidates:*\n`;
        execResult.topProfiles.forEach((p, i) => {
          reply += `*${i + 1}. ${p.name}*\n💼 ${p.headline}\n📍 ${p.location}\n${p.url ? `🔗 [Profile Link](${p.url})\n` : ''}\n`;
        });
      } else if (aiResult.name === 'manage_campaigns') {
        if (execResult.pausedCount !== undefined) {
          reply += `⏸️ *Paused:* ${execResult.pausedCount} active campaign(s).`;
        } else if (execResult.resumedCount !== undefined) {
          reply += `▶️ *Resumed:* ${execResult.resumedCount} campaign(s). Runner kicked off!`;
        } else {
          reply += `📊 *Campaign Status:*\n• Active: *${execResult.active}*\n• Paused: *${execResult.paused}*\n• Total: *${execResult.total}*`;
        }
      } else if (aiResult.name === 'send_linkedin_message') {
        reply += `✉️ Message sent to *${execResult.recipient}*!`;
      } else {
        reply += JSON.stringify(execResult, null, 2);
      }

      return sendTelegramMessage(botToken, chatId, reply);
    }

    return sendTelegramMessage(botToken, chatId, aiResult.content);
  } catch (err) {
    console.error('[Telegram Command Error]', err);
    return sendTelegramMessage(botToken, chatId, `❌ Error: ${err.message}`);
  }
}

// =========================================================================
// Long Polling Engine (Service Worker Compatible)
// =========================================================================
export function stopTelegramPoller() {
  isPolling = false;
  if (pollAbortController) {
    try { pollAbortController.abort(); } catch {}
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

  console.log('[Telegram Poller] Starting dynamic background poll for chat ID:', chatId);

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
            const msg = update.message;
            if (msg && msg.text && String(msg.chat.id) === String(chatId)) {
              await handleUserCommand(token, chatId, msg.text).catch((err) => {
                console.error('[Telegram Command Error]', err);
              });
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

getConfig().then((cfg) => {
  if (cfg.telegram && cfg.telegram.enabled && cfg.telegram.botToken && cfg.telegram.chatId) {
    startTelegramPoller(cfg.telegram.botToken, cfg.telegram.chatId);
  }
}).catch(() => {});

register(ACTIONS.TELEGRAM_STATUS, () => getTelegramStatus());
register(ACTIONS.TELEGRAM_TEST, (params) => testTelegram(params));
register(ACTIONS.TELEGRAM_SAVE, (params) => saveTelegram(params));
