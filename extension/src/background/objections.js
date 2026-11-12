/**
 * OutFox — Smart Objection Playbook, AI Intent Personalizer & 30-Day Snooze Engine
 * Persistent Objection Rules, Multi-Provider Semantic Intent Matcher & Snooze Lifecycle
 */

import { ACTIONS, ERROR, EngineError } from '../lib/actions.js';
import { get, set } from '../lib/storage.js';
import { getConfig } from '../lib/config.js';
import { register } from './engine.js';
import { getActiveCandidate } from './candidates.js';

export const OBJECTIONS_KEY = 'outfox_objections';
export const SNOOZE_KEY = 'outfox_snoozed_leads';

export const DEFAULT_OBJECTIONS = [
  {
    id: 'obj_resume_ask',
    tag: 'RESUME_ASK',
    title: 'Send me your resume / CV',
    trigger: 'send resume, send cv, share your profile, attach resume, shoot over your cv, resume link, share cv',
    baseAnswer: 'Sure thing, {{firstName}}! Here is my updated resume: {{resumeLink}} . I would love to connect for 10 mins this week to see where I can add value: {{bookingLink}} .',
    createdAt: Date.now(),
  },
  {
    id: 'obj_visa_c2c',
    tag: 'VISA_C2C',
    title: 'Visa / sponsorship / C2C or W2?',
    trigger: 'visa, sponsorship, c2c, w2, work authorization, opt, cpt, stem, corp to corp, citizen',
    baseAnswer: 'Hi {{firstName}}, I am on STEM OPT with valid US work authorization and no immediate sponsorship needed. Completely open and flexible for both W2 and C2C arrangements! Happy to chat: {{bookingLink}} .',
    createdAt: Date.now(),
  },
  {
    id: 'obj_not_now',
    tag: 'NOT_NOW',
    title: 'Not hiring right now / ping next month',
    trigger: 'not hiring, no open roles, ping later, reach out next month, not right now, touch base later, headcount full, freeze',
    baseAnswer: 'Totally understand, {{firstName}}! I appreciate the transparency. I will stay in touch and circle back next month. Have a great quarter ahead!',
    createdAt: Date.now(),
  },
  {
    id: 'obj_rate_ask',
    tag: 'RATE_ASK',
    title: 'Expected salary / hourly rate',
    trigger: 'salary, hourly rate, compensation, what is your rate, pay expectation, expected rate, c2c rate, billing rate',
    baseAnswer: 'Hi {{firstName}}, my rate expectations are aligned with current market standards for the role and location, and I am flexible depending on team fit and project scope. Would love a quick chat to discuss details: {{bookingLink}} .',
    createdAt: Date.now(),
  },
];

/* ================================================================== */
/*  CRUD Helpers                                                      */
/* ================================================================== */

export async function getAllObjections() {
  const stored = await get(OBJECTIONS_KEY, null);
  if (!Array.isArray(stored) || stored.length === 0) {
    await set(OBJECTIONS_KEY, DEFAULT_OBJECTIONS);
    return DEFAULT_OBJECTIONS;
  }
  return stored;
}

export async function saveObjection(objData) {
  if (!objData || (!objData.tag && !objData.title)) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Objection tag and title are required.');
  }
  const all = await getAllObjections();
  const id = objData.id || `obj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const normalized = {
    id,
    tag: (objData.tag || 'CUSTOM').toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
    title: (objData.title || 'Custom Objection').trim(),
    trigger: (objData.trigger || '').trim(),
    baseAnswer: (objData.baseAnswer || '').trim(),
    createdAt: objData.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  const idx = all.findIndex((o) => o.id === id);
  if (idx >= 0) all[idx] = { ...all[idx], ...normalized };
  else all.push(normalized);
  await set(OBJECTIONS_KEY, all);
  return normalized;
}

export async function deleteObjection(id) {
  const all = await getAllObjections();
  const filtered = all.filter((o) => o.id !== id);
  await set(OBJECTIONS_KEY, filtered);
  return { success: true, count: filtered.length };
}

/* ================================================================== */
/*  30-Day Snooze Queue                                               */
/* ================================================================== */

export async function getSnoozedLeads() {
  return get(SNOOZE_KEY, []);
}

export async function snoozeLead({ publicId, days = 30, note = '', fullName = '' }) {
  if (!publicId) throw new EngineError(ERROR.INVALID_PARAMS, 'publicId is required to snooze.');
  const all = await getSnoozedLeads();
  const numDays = Number(days) || 30;
  const wakeAt = Date.now() + numDays * 24 * 60 * 60 * 1000;
  const entry = {
    id: `snz_${publicId}_${Date.now()}`,
    publicId,
    fullName: fullName || publicId,
    note: note || '',
    days: numDays,
    snoozedAt: Date.now(),
    wakeAt,
    notified: false,
  };
  const filtered = all.filter((s) => s.publicId !== publicId);
  filtered.push(entry);
  await set(SNOOZE_KEY, filtered);
  return entry;
}

export async function popDueSnoozes() {
  const all = await getSnoozedLeads();
  const now = Date.now();
  const due = [];
  const updated = all.map((item) => {
    if (item.wakeAt <= now && !item.notified) {
      due.push(item);
      return { ...item, notified: true, notifiedAt: now };
    }
    return item;
  });
  if (due.length > 0) {
    await set(SNOOZE_KEY, updated);
  }
  return due;
}

/* ================================================================== */
/*  AI Semantic Intent Matcher & Personalizer                         */
/* ================================================================== */

/**
 * Execute a fast raw AI chat completion through user's configured provider.
 */
async function callAiForPlaybook(systemPrompt, userPrompt) {
  const cfg = await getConfig();
  const ai = cfg.ai || {};
  const provider = ai.provider || 'none';
  const apiKey = (ai.apiKey || '').trim();

  if (provider === 'none' || (!apiKey && provider !== 'ollama')) {
    return null;
  }

  const model =
    ai.model ||
    (provider === 'groq'
      ? 'llama-3.3-70b-versatile'
      : provider === 'gemini'
        ? 'gemini-1.5-flash'
        : provider === 'anthropic'
          ? 'claude-3-5-haiku-20241022'
          : 'gpt-4o-mini');

  try {
    if (provider === 'groq' || provider === 'openai' || provider === 'openai-compatible') {
      const endpoint =
        provider === 'groq'
          ? 'https://api.groq.com/openai/v1/chat/completions'
          : provider === 'openai'
            ? 'https://api.openai.com/v1/chat/completions'
            : `${(ai.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 300,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.choices?.[0]?.message?.content || null;
    } else if (provider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ parts: [{ text: userPrompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } else if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          max_tokens: 300,
          temperature: 0.3,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.content?.[0]?.text || null;
    } else if (provider === 'ollama') {
      const base = (ai.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: ai.model || 'llama3.1:8b',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.message?.content || null;
    }
  } catch (err) {
    console.warn('[Objection AI Call]', err.message);
  }
  return null;
}

/**
 * Keyword-based heuristic matcher when AI is offline or returns unparseable output.
 */
function keywordMatchObjection(message = '', objections = [], context = {}) {
  const lower = message.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const obj of objections) {
    const triggers = (obj.trigger || '')
      .toLowerCase()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    let score = 0;
    for (const t of triggers) {
      if (lower.includes(t)) {
        score += t.length; // Longer phrase matches carry more weight
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = obj;
    }
  }

  const chosen = best || objections[0] || DEFAULT_OBJECTIONS[0];
  let reply = chosen.baseAnswer || '';
  reply = reply
    .replace(/\{\{firstName\}\}/g, context.firstName || 'there')
    .replace(/\{\{company\}\}/g, context.company || 'your team')
    .replace(/\{\{resumeLink\}\}/g, context.resumeLink || 'https://drive.google.com/resume')
    .replace(/\{\{bookingLink\}\}/g, context.bookingLink || 'https://calendly.com');

  return {
    matchedId: chosen.id,
    tag: chosen.tag || 'OBJECTION',
    title: chosen.title || 'Standard Response',
    personalizedReply: reply,
    confidence: bestScore > 0 ? 0.85 : 0.4,
  };
}

/**
 * Match inbound reply against Playbook and dynamically personalizes response.
 */
export async function matchAndAdaptObjection(inboundMessage = '', prospectInfo = {}) {
  const msg = String(inboundMessage || '').trim();
  const objections = await getAllObjections();
  const activeCand = await getActiveCandidate().catch(() => null);

  const rawName = prospectInfo.fullName || prospectInfo.name || '';
  const firstName = rawName.split(' ')[0] || 'there';
  const company = prospectInfo.company || prospectInfo.companyName || 'your company';
  const resumeLink = activeCand?.resumeUrl || activeCand?.resumeLink || 'https://drive.google.com/resume';
  const bookingLink = activeCand?.bookingLink || 'https://calendly.com';

  const context = {
    firstName,
    company,
    resumeLink,
    bookingLink,
  };

  if (!msg) {
    return keywordMatchObjection('resume', objections, context);
  }

  // System Prompt for Semantic Matching & Natural Personalization
  const systemPrompt = `You are OutFox AI SDR, an expert LinkedIn outreach closer.
Your task is to analyze an inbound LinkedIn message, determine the prospect's objection/intent, match it to the best Playbook rule, and personalize the base answer naturally.

PLAYBOOK RULES:
${objections
  .map(
    (o, i) =>
      `[${i + 1}] ID: "${o.id}", TAG: "${o.tag}", TITLE: "${o.title}"\n    Trigger concepts: ${o.trigger}\n    Base Answer: "${o.baseAnswer}"`,
  )
  .join('\n\n')}

CANDIDATE CONTEXT:
• Name: "${activeCand?.name || 'Aditya Chaudhary'}" (${activeCand?.title || 'Data Analyst'})
• Resume URL: "${resumeLink}"
• Booking Calendar Link: "${bookingLink}"

PROSPECT CONTEXT:
• First Name: "${firstName}"
• Company: "${company}"

INSTRUCTIONS:
1. Identify which Playbook rule best matches the prospect's intent, even if they use different phrasing (e.g. "shoot over your CV" -> RESUME_ASK).
2. Adapt and personalize the base answer for this prospect. Replace any {{placeholders}} with real values. Keep it warm, concise, professional, and strictly UNDER 350 CHARACTERS. No corporate fluff.
3. Respond ONLY with valid JSON in this exact structure:
{
  "matchedId": "string (the rule ID)",
  "tag": "string (the rule TAG)",
  "title": "string (the rule TITLE)",
  "personalizedReply": "string (the tailored message under 350 chars)",
  "confidence": number (between 0.0 and 1.0)
}`;

  const userPrompt = `Inbound prospect message:\n"${msg}"\n\nAnalyze intent and return JSON:`;

  const aiText = await callAiForPlaybook(systemPrompt, userPrompt);
  if (aiText) {
    try {
      const cleanJson = aiText.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
      const parsed = JSON.parse(cleanJson);
      if (parsed && parsed.personalizedReply) {
        let reply = String(parsed.personalizedReply).replace(/^["']|["']$/g, '').trim();
        // Substitute any residual placeholders
        reply = reply
          .replace(/\{\{firstName\}\}/g, firstName)
          .replace(/\{\{company\}\}/g, company)
          .replace(/\{\{resumeLink\}\}/g, resumeLink)
          .replace(/\{\{bookingLink\}\}/g, bookingLink);

        return {
          matchedId: parsed.matchedId || objections[0]?.id || 'obj_custom',
          tag: (parsed.tag || 'OBJECTION').toUpperCase(),
          title: parsed.title || 'AI Playbook Response',
          personalizedReply: reply,
          confidence: Number(parsed.confidence) || 0.9,
        };
      }
    } catch (parseErr) {
      console.warn('[Playbook JSON Parse Failed, using fallback]', parseErr.message);
    }
  }

  // Fallback to heuristic keyword matching
  return keywordMatchObjection(msg, objections, context);
}

/* ================================================================== */
/*  Action Registrations                                              */
/* ================================================================== */

register(ACTIONS.OBJECTIONS_GET, async () => ({
  objections: await getAllObjections(),
}));

register(ACTIONS.OBJECTION_SAVE, async ({ objection }) => ({
  saved: await saveObjection(objection),
}));

register(ACTIONS.OBJECTION_DELETE, async ({ id }) => {
  return deleteObjection(id);
});

register(ACTIONS.OBJECTION_MATCH_REPLY, async (params) => {
  return matchAndAdaptObjection(params.message, params);
});

register(ACTIONS.LEAD_SNOOZE, async (params) => ({
  snoozed: await snoozeLead(params),
}));

register(ACTIONS.SNOOZED_GET, async () => ({
  snoozed: await getSnoozedLeads(),
}));

