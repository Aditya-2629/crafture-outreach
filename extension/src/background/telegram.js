import { ACTIONS, ERROR, EngineError } from '../lib/actions.js';
import { getConfig, setConfig } from '../lib/config.js';
import { register } from './engine.js';
import * as voyager from './voyager.js';
import * as campaigns from './campaigns.js';

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
    `You can now send direct commands from your mobile:\n` +
    `• \`Search Austin Data Analyst OPT\`\n` +
    `• \`Campaign status\`\n` +
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

async function handleUserCommand(botToken, chatId, text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return;

  if (trimmed === '/start' || trimmed === '/help') {
    return sendTelegramMessage(botToken, chatId, 
      `🦊 *OutFox Mobile AI SDR Active!*\n\nCommands you can send:\n` +
      `• _"Search Austin Data Analyst OPT"_\n` +
      `• _"Campaign status"_\n` +
      `• _"Pause campaign"_\n` +
      `• _"Resume campaign"_`
    );
  }

  // Campaign Controls
  if (/campaign.*(status|kya hal)/i.test(trimmed)) {
    const all = await campaigns.getAll();
    const active = all.filter((c) => c.status === 'active');
    let msg = `📊 *Campaign Status:*\nActive: *${active.length}* | Total: *${all.length}*\n`;
    active.forEach(c => { msg += `• *${c.name}* (Enrolled: ${c.stats?.enrolled || 0})\n`; });
    return sendTelegramMessage(botToken, chatId, msg);
  }

  if (/pause.*campaign/i.test(trimmed)) {
    const active = (await campaigns.getAll()).filter((c) => c.status === 'active');
    for (const c of active) await campaigns.setStatus(c.campaignId, 'paused');
    return sendTelegramMessage(botToken, chatId, `⏸️ *Success:* ${active.length} campaign(s) paused.`);
  }

  if (/resume.*campaign/i.test(trimmed)) {
    const paused = (await campaigns.getAll()).filter((c) => c.status === 'paused');
    for (const c of paused) await campaigns.setStatus(c.campaignId, 'active');
    return sendTelegramMessage(botToken, chatId, `▶️ *Success:* ${paused.length} campaign(s) resumed.`);
  }

  // Search Leads on LinkedIn
  if (/search|dhoond|find|prospect/i.test(trimmed)) {
    await sendTelegramMessage(botToken, chatId, `🔍 *Searching LinkedIn live...*`);
    try {
      const q = trimmed.replace(/^(search|find|dhoondo)\s+/i, '');
      const res = await voyager.searchPeople({ keywords: q, count: 5 });
      const results = res?.elements || [];
      if (!results.length) return sendTelegramMessage(botToken, chatId, `No leads found for: "${q}"`);
      
      let reply = `🎯 *Top Leads Found:*\n\n`;
      results.forEach((p, i) => {
        reply += `*${i + 1}. ${p.name || p.fullName}*\n💼 ${p.headline || 'Professional'}\n📍 ${p.location || 'USA'}\n🔗 [Profile](https://linkedin.com/in/${p.publicId})\n\n`;
      });
      return sendTelegramMessage(botToken, chatId, reply);
    } catch (e) {
      return sendTelegramMessage(botToken, chatId, `❌ Search error: ${e.message}`);
    }
  }

  // Default Fallback
  return sendTelegramMessage(botToken, chatId, `🤖 *OutFox:* Received: "${trimmed}". Try saying: \`Search Austin Data Analyst OPT\` or \`Campaign status\``);
}

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
  (async () => {
    while (isPolling) {
      try {
        pollAbortController = new AbortController();
        const url = `${TELEGRAM_API_BASE}/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`;
        const res = await fetch(url, { signal: pollAbortController.signal });
        const data = await res.json();
        if (data.ok && Array.isArray(data.result)) {
          for (const u of data.result) {
            lastUpdateId = Math.max(lastUpdateId, u.update_id);
            if (u.message?.text && String(u.message.chat.id) === String(chatId)) {
              await handleUserCommand(token, chatId, u.message.text).catch(console.error);
            }
          }
        }
      } catch (e) {
        if (e.name === 'AbortError') break;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
}

getConfig().then((cfg) => {
  if (cfg.telegram?.enabled && cfg.telegram?.botToken && cfg.telegram?.chatId) {
    startTelegramPoller(cfg.telegram.botToken, cfg.telegram.chatId);
  }
}).catch(() => {});

register(ACTIONS.TELEGRAM_STATUS, () => getTelegramStatus());
register(ACTIONS.TELEGRAM_TEST, (params) => testTelegram(params));
register(ACTIONS.TELEGRAM_SAVE, (params) => saveTelegram(params));
