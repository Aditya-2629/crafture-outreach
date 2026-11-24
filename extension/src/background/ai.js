/**
 * Crafture Network — AI provider adapters.
 *
 * Bring your own key (or run Ollama locally). Each adapter turns one prompt
 * into a request and one response into text; nothing about the user's key ever
 * reaches a log, an error message or the event log.
 */

import { ACTIONS, ERROR, EngineError } from '../lib/actions.js';
import { getConfig } from '../lib/config.js';
import { get, logDebug } from '../lib/storage.js';
import { register } from './engine.js';
import { parseOutput, promptFor } from './ai-prompts.js';
import { hasHostAccess, originPatternFor } from '../lib/permissions.js';

export const DEFAULT_MODELS = Object.freeze({
  groq: 'llama-3.3-70b-versatile',
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5-mini',
  gemini: 'gemini-2.5-flash',
  ollama: 'llama3.1:8b',
  'openai-compatible': 'gpt-4o-mini',
});

export const DEFAULT_BASE_URLS = Object.freeze({
  groq: 'https://api.groq.com',
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  ollama: 'http://127.0.0.1:11434',
});

/** Providers that will not work without a key. */
const NEEDS_KEY = new Set(['groq', 'anthropic', 'openai', 'gemini']);

const trimSlash = (url) => String(url || '').replace(/\/+$/, '');

/**
 * Join a base URL with a versioned path. A user-supplied baseUrl that already
 * ends in `/v1` (the usual shape for an OpenAI-compatible endpoint) does not
 * get a second one.
 */
function apiUrl(base, versionedPath) {
  const b = trimSlash(base);
  return b.endsWith('/v1') ? `${b}${versionedPath.replace(/^\/v1/, '')}` : `${b}${versionedPath}`;
}

/* ================================================================== */
/*  Adapters                                                          */
/* ================================================================== */

const ADAPTERS = {
  groq: {
    request(cfg, model, { system, user, maxTokens }) {
      return {
        url: apiUrl(cfg.baseUrl || DEFAULT_BASE_URLS.groq, '/openai/v1/chat/completions'),
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model: model || DEFAULT_MODELS.groq,
            max_tokens: maxTokens,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        },
      };
    },
    read: (json) =>
      ((json.choices || [])[0] || {}).message
        ? String(json.choices[0].message.content || '').trim()
        : '',
  },

  anthropic: {
    request(cfg, model, { system, user, maxTokens }) {
      return {
        url: apiUrl(cfg.baseUrl || DEFAULT_BASE_URLS.anthropic, '/v1/messages'),
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system,
            messages: [{ role: 'user', content: user }],
          }),
        },
      };
    },
    read: (json) => (json.content || []).map((c) => c.text || '').join('').trim(),
  },

  openai: {
    request(cfg, model, { system, user, maxTokens }) {
      return {
        url: apiUrl(cfg.baseUrl || DEFAULT_BASE_URLS.openai, '/v1/chat/completions'),
        init: {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${cfg.apiKey}`,
          },
          body: JSON.stringify({
            model,
            max_completion_tokens: maxTokens,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        },
      };
    },
    read: (json) =>
      ((json.choices || [])[0] || {}).message
        ? String(json.choices[0].message.content || '').trim()
        : '',
  },

  gemini: {
    request(cfg, model, { system, user, maxTokens }) {
      const base = trimSlash(cfg.baseUrl || DEFAULT_BASE_URLS.gemini);
      return {
        url: `${base}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: sanitizeGeminiContents([{ role: 'user', parts: [{ text: user }] }]),
            generationConfig: { maxOutputTokens: maxTokens },
          }),
        },
      };
    },
    read: (json) => {
      const parts = (((json.candidates || [])[0] || {}).content || {}).parts || [];
      return parts.map((p) => p.text || '').join('').trim();
    },
  },

  ollama: {
    request(cfg, model, { system, user }) {
      return {
        url: `${trimSlash(cfg.baseUrl || DEFAULT_BASE_URLS.ollama)}/api/chat`,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
        },
      };
    },
    read: (json) => String((json.message || {}).content || '').trim(),
  },
};

// An OpenAI-compatible endpoint speaks the OpenAI wire format at a user-supplied base.
ADAPTERS['openai-compatible'] = ADAPTERS.openai;

/* ================================================================== */
/*  AI Engine Multi-Model & Fallback Router Helper                    */
/* ================================================================== */

function normalizeAiProvider(raw) {
  const p = String(raw || '').trim().toLowerCase();
  if (p === 'claude') return 'anthropic';
  return p;
}

function isValidAiProviderEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const provider = normalizeAiProvider(entry.provider);
  if (!provider || provider === 'none') return false;
  if (entry.active === false || entry.enabled === false) return false;

  const apiKey = String(entry.apiKey || entry.key || '').trim();
  const baseUrl = String(entry.baseUrl || entry.host || '').trim();

  if (provider === 'ollama') return true;
  if (provider === 'openai-compatible') return Boolean(apiKey || baseUrl);
  return Boolean(apiKey);
}

function toAiProviderRecord(entry, index = 0) {
  const provider = normalizeAiProvider(entry.provider);
  const apiKey = String(entry.apiKey || entry.key || '').trim();
  const baseUrl = String(entry.baseUrl || entry.host || '').trim();
  const rawModel = String(entry.model || entry.modelId || '').trim();
  const model = rawModel || (
    provider === 'groq' ? DEFAULT_MODELS.groq
      : provider === 'gemini' ? DEFAULT_MODELS.gemini
      : provider === 'anthropic' ? DEFAULT_MODELS.anthropic
      : provider === 'ollama' ? DEFAULT_MODELS.ollama
      : DEFAULT_MODELS.openai
  );

  return {
    id: entry.id || `${provider}_${index}`,
    provider,
    apiKey,
    baseUrl,
    model,
    modelId: model,
    active: true,
  };
}

export async function getActiveAiProviders() {
  const [storedAiModels, storedAiProviders, cfg] = await Promise.all([
    get('ai_models', null).catch(() => null),
    get('aiProviders', null).catch(() => null),
    getConfig().catch(() => ({})),
  ]);

  const rawCandidates = [];

  // 1. Primary multi-model fallback chain from Settings -> AI Engine Router
  if (Array.isArray(storedAiModels)) {
    rawCandidates.push(...storedAiModels);
  }

  // 2. Storage aiProviders (array or object map)
  if (Array.isArray(storedAiProviders)) {
    rawCandidates.push(...storedAiProviders);
  } else if (storedAiProviders && typeof storedAiProviders === 'object') {
    for (const [providerKey, val] of Object.entries(storedAiProviders)) {
      if (val && typeof val === 'object') {
        rawCandidates.push({ provider: providerKey, ...val });
      }
    }
  }

  // 3. Config ai_models
  if (Array.isArray(cfg?.ai_models)) {
    rawCandidates.push(...cfg.ai_models);
  }

  // 4. Config aiProviders
  if (Array.isArray(cfg?.aiProviders)) {
    rawCandidates.push(...cfg.aiProviders);
  } else if (cfg?.aiProviders && typeof cfg.aiProviders === 'object') {
    for (const [providerKey, val] of Object.entries(cfg.aiProviders)) {
      if (val && typeof val === 'object') {
        rawCandidates.push({ provider: providerKey, ...val });
      }
    }
  }

  // 5. Config ai (legacy single-provider config)
  if (cfg?.ai && typeof cfg.ai === 'object') {
    rawCandidates.push(cfg.ai);
  }

  const validChain = [];
  const seenKeys = new Set();

  for (let idx = 0; idx < rawCandidates.length; idx++) {
    const raw = rawCandidates[idx];
    if (!isValidAiProviderEntry(raw)) continue;

    const record = toAiProviderRecord(raw, idx);
    const dedupeKey = `${record.provider}:${record.apiKey}:${record.model || ''}:${record.baseUrl || ''}`;
    if (!seenKeys.has(dedupeKey)) {
      seenKeys.add(dedupeKey);
      validChain.push(record);
    }
  }

  return validChain;
}

export const getAiFallbackChain = getActiveAiProviders;

/**
 * Recursively sanitize a JSON schema for Gemini FunctionDeclaration.
 * Strips unsupported fields: $schema, additionalProperties, default, invalid enums.
 * Normalizes union types like ['string', 'null'] to 'STRING'.
 * Uppercases all types to Gemini Schema types: STRING, NUMBER, INTEGER, BOOLEAN, ARRAY, OBJECT.
 */
export function sanitizeGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return { type: 'STRING' };

  const out = {};

  // Normalize type
  let type = schema.type;
  if (Array.isArray(type)) {
    // Union types like ['string', 'null'] -> select first non-null type
    const nonNull = type.find((t) => t && String(t).toLowerCase() !== 'null');
    type = nonNull || 'string';
  }

  if (typeof type === 'string') {
    const upper = type.toUpperCase();
    out.type = upper === 'INT' ? 'INTEGER' : upper;
  } else if (schema.properties) {
    out.type = 'OBJECT';
  } else if (schema.items) {
    out.type = 'ARRAY';
  } else {
    out.type = 'STRING';
  }

  if (schema.description && typeof schema.description === 'string') {
    out.description = schema.description;
  }

  // Gemini only supports enum on STRING types; strip if non-string
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (out.type === 'STRING') {
      out.enum = schema.enum.map(String).filter(Boolean);
    }
  }

  // Properties for OBJECT
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = {};
    for (const [key, val] of Object.entries(schema.properties)) {
      if (val && typeof val === 'object') {
        out.properties[key] = sanitizeGeminiSchema(val);
      }
    }
  }

  // Required properties
  if (Array.isArray(schema.required) && schema.required.length > 0) {
    out.required = schema.required.filter((k) => typeof k === 'string');
  }

  // Items for ARRAY
  if (schema.items && typeof schema.items === 'object') {
    out.items = sanitizeGeminiSchema(schema.items);
  }

  // Strips $schema, additionalProperties, default by omission
  return out;
}

/**
 * Sanitize tool definitions into clean Gemini function declarations.
 *
 * @param {Array<object>} tools
 * @returns {Array<object>}
 */
export function sanitizeGeminiTools(tools) {
  if (!Array.isArray(tools)) return [];

  const declarations = [];

  for (const item of tools) {
    if (!item || typeof item !== 'object') continue;

    // Support both OpenAI format ({ type: 'function', function: { name, description, parameters } })
    // and raw Gemini declaration format ({ name, description, parameters })
    const fn = item.function || item;
    const name = String(fn.name || '').trim();
    if (!name) continue;

    const description = String(fn.description || '');
    const parameters = sanitizeGeminiSchema(fn.parameters || { type: 'object' });

    declarations.push({
      name,
      description,
      parameters,
    });
  }

  return declarations;
}

/**
 * Robust JSON output parser for AI responses.
 * Strips markdown code fences (```json ... ```), leading prose, and trailing commentary.
 * Falls back gracefully to `fallback` without throwing.
 *
 * @param {string|object} rawResponse
 * @param {any} [fallback=null]
 * @returns {any}
 */
export function extractJsonFromAiResponse(rawResponse, fallback = null) {
  if (rawResponse === null || rawResponse === undefined) return fallback;
  if (typeof rawResponse === 'object') return rawResponse;

  let str = String(rawResponse).trim();
  if (!str) return fallback;

  // 1. Strip markdown code fences
  str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 2. Direct JSON.parse
  try {
    return JSON.parse(str);
  } catch (_) {}

  // 3. Extract outermost object { ... }
  const firstBrace = str.indexOf('{');
  const lastBrace = str.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(str.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }

  // 4. Extract outermost array [ ... ]
  const firstBracket = str.indexOf('[');
  const lastBracket = str.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(str.slice(firstBracket, lastBracket + 1));
    } catch (_) {}
  }

  return fallback;
}

/**
 * Sanitize Gemini `contents` turns right before dispatching to the Gemini API.
 * Ensures strict compliance with Gemini 2.5+ REST API schema:
 * - If `part.functionCall` exists: keeps ONLY `{ name, args }` inside `part.functionCall`
 *   (strips any `thoughtSignature`, `thought_signature`, `thought signature`, `id`, etc. from inside `functionCall`).
 * - Preserves valid `thoughtSignature` at the PART level ONLY (sibling to `functionCall`), NEVER inside `functionCall`.
 * - Strips invalid keys like `'thought signature'` (with space) or `'thought_signature'` at the part level.
 * - If `part.thought === true` and `part.text`: preserves thought / text without invalid keys.
 * - Alternates valid roles strictly (merging consecutive same-role turns into single turns).
 * - Never passes uncleaned raw model parts into Gemini API requests.
 *
 * @param {Array<object>} contents
 * @returns {Array<object>}
 */
export function sanitizeGeminiContents(contents) {
  if (!Array.isArray(contents)) return [];

  const rawTurns = [];

  for (const turn of contents) {
    if (!turn || typeof turn !== 'object') continue;
    const role = turn.role === 'assistant' ? 'model' : (turn.role || 'user');
    const rawParts = Array.isArray(turn.parts) ? turn.parts : [];

    const sanitizedParts = rawParts.map((part) => {
      if (!part || typeof part !== 'object') {
        return { text: String(part ?? '') };
      }

      // Check for any signature candidate across part and functionCall
      const signature =
        part.thoughtSignature ||
        part.thought_signature ||
        part['thought signature'] ||
        part.functionCall?.thoughtSignature ||
        part.functionCall?.thought_signature ||
        part.functionCall?.['thought signature'] ||
        null;

      // 1. Function Call Part: keep ONLY { name, args } inside functionCall
      if (part.functionCall && typeof part.functionCall === 'object') {
        const fc = part.functionCall;
        const name = String(fc.name || '');
        const args = fc.args && typeof fc.args === 'object' && !Array.isArray(fc.args) ? fc.args : {};

        const cleanPart = {
          functionCall: { name, args },
        };

        if (signature && typeof signature === 'string') {
          cleanPart.thoughtSignature = signature;
        }

        return cleanPart;
      }

      // 2. Function Response Part
      if (part.functionResponse && typeof part.functionResponse === 'object') {
        const fr = part.functionResponse;
        return {
          functionResponse: {
            name: String(fr.name || ''),
            response: (fr.response && typeof fr.response === 'object') ? fr.response : { result: fr.response },
          },
        };
      }

      // 3. Text / Thought Part
      if (typeof part.text === 'string') {
        const cleanPart = { text: part.text };
        if (part.thought === true) {
          cleanPart.thought = true;
        }
        if (signature && typeof signature === 'string') {
          cleanPart.thoughtSignature = signature;
        }
        return cleanPart;
      }

      // 4. Inline Data Part
      if (part.inlineData && typeof part.inlineData === 'object') {
        return {
          inlineData: {
            mimeType: part.inlineData.mimeType,
            data: part.inlineData.data,
          },
        };
      }

      // Fallback: If part has other shapes, clean text / signature
      const cleanPart = {};
      if (part.text !== undefined) cleanPart.text = String(part.text);
      if (signature && typeof signature === 'string') cleanPart.thoughtSignature = signature;
      return Object.keys(cleanPart).length > 0 ? cleanPart : { text: '' };
    }).filter((p) => Object.keys(p).length > 0);

    rawTurns.push({
      role,
      parts: sanitizedParts.length > 0 ? sanitizedParts : [{ text: '' }],
    });
  }

  // Strict role alternation: merge consecutive same-role turns into single turns
  const alternating = [];
  for (const turn of rawTurns) {
    if (alternating.length > 0 && alternating[alternating.length - 1].role === turn.role) {
      alternating[alternating.length - 1].parts.push(...turn.parts);
    } else {
      alternating.push(turn);
    }
  }

  // For multi-turn chats, Gemini requires initial turn to be 'user'
  if (alternating.length > 1 && alternating[0].role === 'model' && alternating.some((t) => t.role === 'user')) {
    while (alternating.length > 0 && alternating[0].role !== 'user') {
      alternating.shift();
    }
  }

  return alternating;
}

/**
 * Queries the selected provider's live models API (or returns curated defaults).
 * Marks recommended top tool-calling / fast models.
 *
 * @param {object} params
 * @param {string} params.provider
 * @param {string} [params.apiKey]
 * @param {string} [params.baseUrl]
 * @returns {Promise<{provider: string, models: Array<{id: string, name: string, recommended: boolean}>}>}
 */
export async function listProviderModels({ provider, apiKey, baseUrl } = {}) {
  const norm = String(provider || '').trim().toLowerCase();
  const normalizedProvider = norm === 'claude' ? 'anthropic' : (norm || 'groq');

  const CURATED_MODELS = {
    gemini: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', recommended: true },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', recommended: true },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', recommended: false },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', recommended: false },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', recommended: false },
    ],
    groq: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile', recommended: true },
      { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B (Groq)', recommended: true },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant', recommended: false },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B 32k', recommended: false },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9B IT', recommended: false },
    ],
    openai: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', recommended: true },
      { id: 'gpt-4o', name: 'GPT-4o', recommended: true },
      { id: 'o1-mini', name: 'o1 Mini', recommended: false },
      { id: 'o3-mini', name: 'o3 Mini', recommended: false },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', recommended: false },
    ],
    anthropic: [
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet', recommended: true },
      { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', recommended: true },
      { id: 'claude-3-7-sonnet-latest', name: 'Claude 3.7 Sonnet', recommended: false },
      { id: 'claude-3-opus-latest', name: 'Claude 3 Opus', recommended: false },
    ],
    ollama: [
      { id: 'llama3.2', name: 'Llama 3.2', recommended: true },
      { id: 'llama3.1:8b', name: 'Llama 3.1 8B', recommended: true },
      { id: 'mistral', name: 'Mistral 7B', recommended: false },
      { id: 'qwen2.5:7b', name: 'Qwen 2.5 7B', recommended: false },
    ],
  };

  const fallbacks = (CURATED_MODELS[normalizedProvider] || []).map((m) => ({ ...m }));
  const cleanKey = String(apiKey || '').trim();

  // If no apiKey provided, return curated defaults immediately
  if (!cleanKey && normalizedProvider !== 'ollama') {
    return { provider: normalizedProvider, models: fallbacks, fromCache: true };
  }

  try {
    if (normalizedProvider === 'gemini') {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const rawList = Array.isArray(data.models) ? data.models : [];
        const filtered = rawList
          .filter((m) => {
            const methods = m.supportedGenerationMethods || [];
            return methods.includes('generateContent') || String(m.name || '').includes('gemini');
          })
          .map((m) => {
            const rawId = String(m.name || '').replace(/^models\//, '');
            const isRec = rawId.includes('2.5-flash') || rawId.includes('2.5-pro');
            return {
              id: rawId,
              name: m.displayName || rawId,
              recommended: isRec,
            };
          });

        if (filtered.length > 0) {
          filtered.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
          return { provider: normalizedProvider, models: filtered, live: true };
        }
      }
    } else if (normalizedProvider === 'groq') {
      const url = 'https://api.groq.com/openai/v1/models';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cleanKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        const rawList = Array.isArray(data.data) ? data.data : [];
        const filtered = rawList
          .filter((m) => !String(m.id || '').includes('whisper'))
          .map((m) => {
            const id = m.id;
            const isRec = id === 'llama-3.3-70b-versatile' || id.includes('gpt-oss') || id === 'llama-3.1-8b-instant';
            return {
              id,
              name: id,
              recommended: isRec,
            };
          });

        if (filtered.length > 0) {
          filtered.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
          return { provider: normalizedProvider, models: filtered, live: true };
        }
      }
    } else if (normalizedProvider === 'openai') {
      const url = 'https://api.openai.com/v1/models';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cleanKey}` },
      });
      if (res.ok) {
        const data = await res.json();
        const rawList = Array.isArray(data.data) ? data.data : [];
        const filtered = rawList
          .filter((m) => m.id && (m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3')))
          .map((m) => {
            const id = m.id;
            const isRec = id === 'gpt-4o-mini' || id === 'gpt-4o';
            return {
              id,
              name: id,
              recommended: isRec,
            };
          });

        if (filtered.length > 0) {
          filtered.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
          return { provider: normalizedProvider, models: filtered, live: true };
        }
      }
    } else if (normalizedProvider === 'ollama') {
      const host = baseUrl || 'http://localhost:11434';
      const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`);
      if (res.ok) {
        const data = await res.json();
        const rawList = Array.isArray(data.models) ? data.models : [];
        const filtered = rawList.map((m) => ({
          id: m.name,
          name: m.name,
          recommended: m.name.includes('llama3') || m.name.includes('mistral'),
        }));
        if (filtered.length > 0) {
          filtered.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
          return { provider: normalizedProvider, models: filtered, live: true };
        }
      }
    }
  } catch (_) {
    // Return curated fallbacks on error
  }

  return { provider: normalizedProvider, models: fallbacks, fallback: true };
}

/* ================================================================== */
/*  Public interface                                                  */
/* ================================================================== */

/** True when `ai.complete` will do something other than throw. */
export async function isConfigured() {
  const { ai } = await getConfig();
  if (ai && ai.provider !== 'none' && ADAPTERS[ai.provider]) {
    if (!NEEDS_KEY.has(ai.provider) || ai.apiKey) {
      if (ai.provider !== 'openai-compatible' || ai.baseUrl) {
        const model = ai.model || DEFAULT_MODELS[ai.provider];
        const { url } = ADAPTERS[ai.provider].request(ai, model, { system: '', user: '', maxTokens: 1 });
        return hasHostAccess(url);
      }
    }
  }
  const providers = await getActiveAiProviders();
  if (providers.length === 0) return false;
  const primary = providers[0];
  const adapter = ADAPTERS[primary.provider];
  if (!adapter) return false;
  const model = primary.model || DEFAULT_MODELS[primary.provider];
  const { url } = adapter.request(primary, model, { system: '', user: '', maxTokens: 1 });
  return hasHostAccess(url);
}

function assertConfigured(ai) {
  const howToFix = 'Set an AI provider and key on the extension options page.';
  if (!ai || ai.provider === 'none' || !ADAPTERS[ai.provider]) {
    throw new EngineError(ERROR.AI_NOT_CONFIGURED, 'No AI provider is configured.', { howToFix });
  }
  if (NEEDS_KEY.has(ai.provider) && !ai.apiKey) {
    throw new EngineError(
      ERROR.AI_NOT_CONFIGURED,
      `No API key is configured for ${ai.provider}.`,
      { howToFix },
    );
  }
  if (ai.provider === 'openai-compatible' && !ai.baseUrl) {
    throw new EngineError(
      ERROR.AI_NOT_CONFIGURED,
      'An openai-compatible provider needs a baseUrl.',
      { howToFix },
    );
  }
}

/**
 * Run one task through the configured provider.
 *
 * @param {'opener'|'summary'|'sentiment'|'comment'|'score'} task
 * @param {object} input task-specific input (profile, message, brief, post, tone)
 * @returns {Promise<{output: string|object, provider: string, model: string}>}
 */
export async function complete(task, input = {}) {
  const { ai } = await getConfig();
  const providers = await getActiveAiProviders();
  const targetAi = (ai && ai.provider !== 'none' && (ai.apiKey || ai.provider === 'ollama'))
    ? ai
    : (providers[0] || ai);

  assertConfigured(targetAi);

  const adapter = ADAPTERS[targetAi.provider];
  const model = targetAi.model || DEFAULT_MODELS[targetAi.provider];
  const prompt = promptFor(task, input);
  const { url, init } = adapter.request(targetAi, model, prompt);

  // An MV3 worker cannot fetch a host it has no permission for, and the
  // failure looks like a network error. Say what it actually is.
  if (!(await hasHostAccess(url))) {
    throw new EngineError(
      ERROR.AI_NOT_CONFIGURED,
      `The extension has no permission to reach ${originPatternFor(url)}.`,
      {
        howToFix:
          'Open Settings → AI provider and press "Grant access", then approve the prompt.',
      },
    );
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (e) {
    // Never echo the request: the URL may carry the key as a query parameter.
    throw new EngineError(ERROR.AI_ERROR, `Could not reach the ${ai.provider} API: ${e.message}`);
  }

  if (!response.ok) {
    throw new EngineError(
      ERROR.AI_ERROR,
      `The ${ai.provider} API returned ${response.status}.`,
      { howToFix: 'Check the key, the model name and any spending limit on the account.' },
    );
  }

  let json;
  try {
    json = await response.json();
  } catch {
    throw new EngineError(ERROR.AI_ERROR, `The ${ai.provider} API returned a non-JSON response.`);
  }

  const text = adapter.read(json);
  if (!text) {
    throw new EngineError(ERROR.AI_ERROR, `The ${ai.provider} API returned an empty response.`);
  }

  return { output: parseOutput(task, text), provider: ai.provider, model };
}

register(ACTIONS.AI_COMPLETE, ({ task, input }) => complete(task, input));
register(ACTIONS.AI_LIST_MODELS, (params) => listProviderModels(params));

/* ================================================================== */
/*  Prompt Execution & Hybrid Audience Filter                         */
/* ================================================================== */

/**
 * Execute a raw prompt using the AI multi-model fallback chain.
 *
 * @param {object} params
 * @param {string} params.system
 * @param {string} params.user
 * @param {number} [params.maxTokens=200]
 * @returns {Promise<{text: string, provider: string, model: string}>}
 */
export async function executeAiPrompt({ system = '', user = '', maxTokens = 200 } = {}) {
  const providers = await getActiveAiProviders();
  if (!providers || providers.length === 0) {
    const { ai } = await getConfig().catch(() => ({}));
    if (ai && ai.provider && ai.provider !== 'none') {
      providers.push(toAiProviderRecord(ai));
    }
  }

  if (providers.length === 0) {
    throw new EngineError(ERROR.AI_NOT_CONFIGURED, 'No AI provider is configured.');
  }

  let lastError = null;
  for (const candidate of providers) {
    const adapter = ADAPTERS[candidate.provider];
    if (!adapter) continue;
    const model = candidate.model || DEFAULT_MODELS[candidate.provider];
    try {
      const { url, init } = adapter.request(candidate, model, { system, user, maxTokens });
      if (typeof hasHostAccess === 'function' && !(await hasHostAccess(url))) {
        continue;
      }
      const response = await fetch(url, init);
      if (!response.ok) {
        throw new EngineError(ERROR.AI_ERROR, `The ${candidate.provider} API returned ${response.status}.`);
      }
      const json = await response.json();
      const text = adapter.read(json);
      if (text && text.trim()) {
        return { text: text.trim(), provider: candidate.provider, model };
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new EngineError(ERROR.AI_ERROR, 'All AI providers in fallback chain failed');
}

export const INDIAN_BACKGROUND_REGEX =
  /\b(IIT|NIT|BITS|Pilani|VTU|SRM|VIT|Vellore|Anna University|Delhi University|IIM|IIIT|Manipal|Amity|JNTU|Osmania|Mumbai University|Pune University|Thapar|PSG|Symbiosis|TCS|Tata Consultancy|Infosys|Wipro|Cognizant|CTS|HCL|HCLTech|Tech Mahindra|LTIMindtree|Persistent Systems|Mphasis|Hexaware|Mu Sigma|Zoho|Freshworks|Flipkart|Swiggy|Zomato|Ola|Paytm|Jio|Reliance|Pune|Mumbai|Delhi|Bengaluru|Bangalore|Hyderabad|Chennai|Ahmedabad|Kolkata|Noida|Gurgaon|Gurugram)\b/i;

export const INDIAN_SURNAMES = new Set([
  'sharma', 'patel', 'gupta', 'kumar', 'singh', 'reddy', 'verma', 'rao', 'shah', 'mehta',
  'jain', 'agarwal', 'agrawal', 'mishra', 'joshi', 'nair', 'iyer', 'iyengar', 'deshmukh',
  'kulkarni', 'patil', 'chatterjee', 'mukherjee', 'banerjee', 'bose', 'das', 'sen', 'ghosh',
  'dutta', 'chaudhary', 'choudhury', 'yadav', 'pandey', 'tiwari', 'tripathi', 'shukla',
  'bhat', 'bhatt', 'hegde', 'shetty', 'pai', 'kamath', 'menon', 'pillai', 'krishnan', 'raman',
  'subramanian', 'venkat', 'venkatesh', 'swaminathan', 'narayanan', 'srinivasan', 'raghavan',
  'balasubramanian', 'naidu', 'chowdary', 'raju', 'prasad', 'murthy', 'sastry', 'shastri',
  'saxena', 'mathur', 'bhatia', 'kapoor', 'khanna', 'malhotra', 'sethi', 'arora', 'chopra',
  'grover', 'chawla', 'ahuja', 'dua', 'sood', 'oberoi', 'talwar', 'puri', 'bakshi', 'kaur',
  'grewal', 'sidhu', 'dhillon', 'gill', 'sandhu', 'maan', 'deol', 'bajwa', 'cheema', 'sahni',
  'khatri', 'thakur', 'chauhan', 'rathore', 'rajput', 'singhania', 'mittal', 'goel', 'goyal',
  'bansal', 'modi', 'adani', 'ambani', 'birla', 'trivedi', 'upadhyay', 'dwivedi', 'dubey',
  'jha', 'sinha', 'srivastava', 'rastogi', 'nigam', 'bhardwaj', 'goswami', 'giri',
  'chakraborty', 'ganguly', 'bhattacharya', 'somani', 'parekh', 'dave', 'vyas', 'parikh',
  'soni', 'vora', 'desai', 'inamdar', 'gokhale', 'godbole', 'apte', 'kelkar', 'chitale',
  'marathe', 'bhonsle', 'shinde', 'gaikwad', 'pawar', 'jadhav', 'kadam', 'more', 'chavan',
  'salunkhe', 'mohite', 'sawant', 'surve', 'raut', 'bhosale', 'pandit', 'sengupta', 'dasgupta',
  'mukhopadhyay', 'bandyopadhyay', 'chattopadhyay', 'bhattacharyya', 'majumdar', 'mazumdar',
  'ghoshal', 'pal', 'paul', 'biswas', 'sarkar', 'adhikari', 'bhowmick', 'kundu', 'nandi',
  'saha', 'gogoi', 'saikia', 'bora', 'deka', 'kalita', 'hazarika', 'ray', 'roy'
]);

export const INDIAN_FIRST_NAMES = new Set([
  'aarav', 'aaditya', 'aayush', 'abhinav', 'abhishek', 'aditya', 'ajay', 'akash', 'akhil',
  'amit', 'anand', 'anil', 'ankit', 'anmol', 'anurag', 'arjun', 'arun', 'ashish', 'ashwin',
  'avinash', 'ayush', 'balaji', 'bharat', 'bhaskar', 'chetan', 'chirag', 'deepak', 'devesh',
  'dhruv', 'dinesh', 'divyansh', 'gaurav', 'gautam', 'girish', 'harish', 'harsh', 'harshit',
  'hemant', 'himanshu', 'hitesh', 'ishan', 'jaideep', 'jatin', 'jay', 'jayant', 'jitendra',
  'karan', 'karthik', 'kartik', 'kaushik', 'kunal', 'lakshay', 'lokesh', 'madhav', 'mahesh',
  'manish', 'manoj', 'mayank', 'mohit', 'mukesh', 'nakul', 'naveen', 'navin', 'neeraj',
  'nihal', 'nikhil', 'nishant', 'nitin', 'pankaj', 'parth', 'pavan', 'pradeep', 'prakash',
  'pranav', 'pranay', 'prashant', 'prateek', 'pratik', 'praveen', 'priyansh', 'rahul', 'raj',
  'rajat', 'rajesh', 'rajiv', 'rakesh', 'ramesh', 'ravindra', 'rohan', 'rohit', 'ronak',
  'sachin', 'sameer', 'sandeep', 'sanjay', 'sanjeev', 'sarvesh', 'sathish', 'saurabh',
  'shantanu', 'shashank', 'shivam', 'shreyas', 'siddharth', 'snehal', 'somesh', 'sourabh',
  'subhash', 'sudarshan', 'sudhir', 'suhas', 'sumit', 'sunder', 'sunil', 'suresh', 'surya',
  'swapnil', 'tanmay', 'tarun', 'tejas', 'tushar', 'umesh', 'utkarsh', 'vaibhav', 'varun',
  'vedant', 'venkat', 'vidit', 'vijay', 'vikas', 'vikram', 'vinay', 'vineet', 'vinod',
  'vipul', 'vishal', 'vivek', 'yash', 'yogesh', 'aadhya', 'aakanksha', 'aarohi', 'aarti',
  'aditi', 'aishwarya', 'akanksha', 'akshata', 'ananya', 'anchal', 'anita', 'anjali',
  'ankita', 'anushka', 'aparna', 'archana', 'arpita', 'arti', 'arushi', 'asawari', 'asha',
  'ashwini', 'avni', 'barkha', 'bhavna', 'bhumi', 'deepa', 'deepika', 'deepti', 'dhwani',
  'diksha', 'divya', 'dipti', 'ekta', 'garima', 'gayatri', 'geeta', 'harini', 'harshita',
  'hema', 'isha', 'ishani', 'ishita', 'janhvi', 'jaya', 'jyoti', 'kajal', 'kamini', 'kanika',
  'karishma', 'kavita', 'kavya', 'khushboo', 'kirti', 'komal', 'kriti', 'kritika', 'lakshmi',
  'lavanya', 'leela', 'madhuri', 'mahima', 'malini', 'manasi', 'mansi', 'meena', 'meera',
  'megha', 'monika', 'mridula', 'mukta', 'namita', 'namrata', 'nandini', 'nandita', 'navya',
  'neha', 'nidhi', 'nikita', 'nishita', 'pallavi', 'parul', 'payal', 'pooja', 'poonam',
  'prachi', 'pragya', 'prerna', 'preeti', 'priya', 'priyanka', 'radha', 'radhika', 'ragini',
  'rakhi', 'rashmi', 'reena', 'rekha', 'richa', 'ridhima', 'ritu', 'riya', 'roshni', 'rupa',
  'sakshi', 'saloni', 'samiksha', 'sandhya', 'sangeeta', 'sapna', 'sarita', 'saumya',
  'seema', 'shalini', 'shambhavi', 'shanti', 'sheetal', 'shikha', 'shilpa', 'shivani',
  'shobha', 'shreya', 'shristi', 'shruti', 'shweta', 'simran', 'sneha', 'snigdha', 'sonal',
  'sonali', 'sonia', 'spandana', 'srishti', 'subhashini', 'suchitra', 'sudha', 'sugandha',
  'sujata', 'sukanya', 'suman', 'sunita', 'supriya', 'surabhi', 'surbhi', 'sushma', 'swati',
  'tanvi', 'taruna', 'trisha', 'uma', 'upasana', 'urvashi', 'usha', 'vaishali', 'vandana',
  'varsha', 'vidya', 'vinita'
]);

export const NON_INDIAN_NAMES = new Set([
  'john', 'james', 'robert', 'michael', 'william', 'david', 'richard', 'joseph', 'thomas',
  'charles', 'christopher', 'daniel', 'matthew', 'anthony', 'donald', 'mark', 'paul',
  'steven', 'andrew', 'kenneth', 'joshua', 'kevin', 'brian', 'george', 'edward', 'ronald',
  'timothy', 'jason', 'jeffrey', 'ryan', 'jacob', 'gary', 'nicholas', 'eric', 'jonathan',
  'stephen', 'larry', 'justin', 'scott', 'brandon', 'benjamin', 'samuel', 'gregory',
  'alexander', 'patrick', 'frank', 'raymond', 'jack', 'dennis', 'jerry', 'tyler', 'aaron',
  'jose', 'adam', 'henry', 'nathan', 'douglas', 'zachary', 'peter', 'kyle', 'walter',
  'ethan', 'jeremy', 'harold', 'keith', 'christian', 'roger', 'noah', 'gerald', 'carl',
  'terry', 'sean', 'austin', 'arthur', 'lawrence', 'jesse', 'dylan', 'bryan', 'joe',
  'jordan', 'billy', 'bruce', 'albert', 'willie', 'gabriel', 'logan', 'alan', 'juan',
  'wayne', 'roy', 'ralph', 'randy', 'eugene', 'vincent', 'russell', 'louis', 'philip',
  'bobby', 'johnny', 'bradley', 'mary', 'patricia', 'jennifer', 'linda', 'elizabeth',
  'barbara', 'susan', 'jessica', 'sarah', 'karen', 'nancy', 'lisa', 'margaret', 'betty',
  'sandra', 'ashley', 'dorothy', 'kimberly', 'emily', 'donna', 'michelle', 'carol',
  'amanda', 'melissa', 'deborah', 'stephanie', 'rebecca', 'sharon', 'laura', 'cynthia',
  'kathleen', 'amy', 'shirley', 'angela', 'helen', 'anna', 'brenda', 'pamela', 'nicole',
  'emma', 'samantha', 'katherine', 'christine', 'debra', 'rachel', 'catherine', 'carolyn',
  'janet', 'ruth', 'maria', 'heather', 'diane', 'virginia', 'julie', 'joyce', 'victoria',
  'olivia', 'kelly', 'christina', 'lauren', 'joan', 'evelyn', 'judith', 'megan', 'cheryl',
  'andrea', 'hannah', 'martha', 'jacqueline', 'frances', 'gloria', 'ann', 'teresa',
  'kathryn', 'sara', 'janice', 'jean', 'alice', 'madison', 'doris', 'abigail', 'julia',
  'judy', 'grace', 'denise', 'amber', 'marilyn', 'beverly', 'danielle', 'theresa', 'sophia',
  'marie', 'diana', 'brittany', 'natalie', 'isabella', 'charlotte',
  'smith', 'johnson', 'williams', 'brown', 'jones', 'garcia', 'miller', 'davis', 'rodriguez',
  'martinez', 'hernandez', 'lopez', 'gonzalez', 'wilson', 'anderson', 'thomas', 'taylor',
  'moore', 'jackson', 'martin', 'lee', 'perez', 'thompson', 'white', 'harris', 'sanchez',
  'clark', 'ramirez', 'lewis', 'robinson', 'walker', 'young', 'allen', 'king', 'wright',
  'scott', 'torres', 'nguyen', 'hill', 'flores', 'green', 'adams', 'nelson', 'baker', 'hall',
  'rivera', 'campbell', 'mitchell', 'carter', 'roberts', 'gomez', 'phillips', 'evans',
  'turner', 'diaz', 'parker', 'cruz', 'edwards', 'collins', 'reyes', 'stewart', 'morris',
  'morales', 'murphy', 'cook', 'rogers', 'gutierrez', 'ortiz', 'morgan', 'cooper', 'peterson',
  'bailey', 'reed', 'howard', 'ramos', 'kim', 'cox', 'ward', 'richardson', 'watson',
  'brooks', 'chavez', 'wood', 'bennett', 'gray', 'mendoza', 'ruiz', 'hughes', 'price',
  'alvarez', 'castillo', 'sanders', 'myers', 'long', 'ross', 'foster', 'jimenez', 'powell',
  'jenkins', 'perry', 'sullivan', 'bell', 'coleman', 'butler', 'henderson', 'barnes',
  'gonzales', 'fisher', 'vasquez', 'simmons', 'romero', 'patterson', 'hamilton', 'graham',
  'reynolds', 'griffin', 'wallace', 'moreno', 'west', 'cole', 'hayes', 'bryant', 'herrera',
  'gibson', 'ellis', 'tran', 'medina', 'aguilar', 'stevens', 'murray', 'ford', 'castro',
  'marshall', 'owens', 'harrison', 'fernandez', 'mcdonald', 'woods', 'washington', 'kennedy',
  'wells', 'vargas', 'henry', 'chen', 'freeman', 'webb', 'tucker', 'guzman', 'burns',
  'crawford', 'olson', 'simpson', 'porter', 'hunter', 'gordon', 'mendez', 'silva', 'shaw',
  'snyder', 'mason', 'dixon', 'munoz', 'hunt', 'hicks', 'holmes', 'palmer', 'wagner',
  'black', 'robertson', 'boyd', 'rose', 'stone', 'salazar', 'fox', 'warren', 'mills',
  'meyer', 'rice', 'schmidt', 'garza', 'daniels', 'ferguson', 'nichols', 'stephens', 'soto',
  'weaver', 'gardner', 'payne', 'grant', 'dunn', 'kelley', 'spencer', 'hawkins', 'arnold',
  'pierce', 'vazquez', 'hansen', 'peters', 'santos', 'hart', 'knight', 'elliott',
  'cunningham', 'duncan', 'armstrong', 'weber', 'lovelace', 'babbage', 'boole'
]);

/**
 * Drop leads ONLY if location explicitly names a non-US country or foreign city/region.
 * Keeps all US states, US metros (e.g. "San Francisco Bay Area", "Greater Seattle Area",
 * "Dallas-Fort Worth Metroplex", "New York City Metropolitan Area", "Greater Boston"),
 * and empty/unspecified locations.
 */
export function isDefiniteNonUsaLocation(loc) {
  if (!loc || typeof loc !== 'string') return false;
  const l = loc.trim();
  if (!l) return false;

  // 1. If location explicitly mentions USA, United States, or US states / metros / abbreviations, keep it
  const isUsa =
    /\b(united states|usa|u\.s\.a\.?|u\.s\.|al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|california|texas|new york|washington|illinois|massachusetts|georgia|florida|virginia|ohio|michigan|north carolina|pennsylvania|new jersey|colorado|arizona|san francisco|bay area|seattle|dallas|fort worth|metroplex|austin|houston|chicago|boston|new york city|nyc|manhattan|brooklyn|los angeles|san diego|san jose|atlanta|denver|phoenix|philadelphia|detroit|minneapolis|portland|las vegas|orlando|tampa|charlotte|pittsburgh|baltimore|greater\s+[a-z]+(?:\s+area)?)\b/i.test(
      l,
    );
  if (isUsa) return false;

  // 2. Only drop if location explicitly names a NON-US country or foreign city/region
  const nonUsaRegex =
    /\b(india|karnataka|maharashtra|tamil nadu|telangana|delhi|mumbai|bengaluru|bangalore|hyderabad|pune|chennai|noida|gurgaon|gurugram|kolkata|ahmedabad|united kingdom|uk|great britain|england|london|manchester|canada|toronto|vancouver|montreal|ontario|germany|berlin|munich|france|paris|australia|sydney|melbourne|singapore|uae|united arab emirates|dubai|netherlands|amsterdam|ireland|dublin|pakistan|bangladesh|philippines|brazil|nigeria|kenya|mexico|spain|italy|switzerland|sweden|norway|denmark|finland|new zealand|poland|austria|belgium|japan|china|hong kong|taiwan|indonesia|malaysia|vietnam|thailand|south africa|egypt|saudi arabia|qatar|israel|russia|ukraine|turkey)\b/i;

  return nonUsaRegex.test(l);
}

/**
 * Classifies a prospect for Indian origin criteria using zero-token local heuristics.
 * Returns 'KEEP', 'DROP', or 'AMBIGUOUS'.
 */
export function classifyProspectByIndianCriteria(p) {
  const headline = String(p.headline || p.title || '');
  const summary = String(p.summary || '');
  const company = String(p.company || '');
  const school = String(p.school || '');
  const combinedSignals = `${headline} ${summary} ${company} ${school}`;

  // 1. High confidence background signals (institutions, companies, cities)
  if (INDIAN_BACKGROUND_REGEX.test(combinedSignals)) {
    return 'KEEP';
  }

  // 2. Name check
  const rawName = String(p.fullName || p.name || `${p.firstName || ''} ${p.lastName || ''}`).trim();
  const tokens = rawName.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

  let hasIndianNameToken = false;
  let hasNonIndianToken = false;

  for (const token of tokens) {
    if (INDIAN_SURNAMES.has(token) || INDIAN_FIRST_NAMES.has(token)) {
      hasIndianNameToken = true;
      break;
    }
    if (NON_INDIAN_NAMES.has(token)) {
      hasNonIndianToken = true;
    }
  }

  if (hasIndianNameToken) {
    return 'KEEP';
  }

  // Definite non-Indian if matched non-Indian list and has 0 Indian signals
  if (hasNonIndianToken && tokens.length > 0) {
    return 'DROP';
  }

  // Ambiguous: unusual name or no definitive match
  return 'AMBIGUOUS';
}

/**
 * Robust JSON parser for Stage 2 AI responses.
 * Handles:
 * - Direct JSON array: [0, 1]
 * - Markdown fences: ```json\n[0, 1]\n```
 * - Object with indices/matches: {"indices": [0, 1]}
 * - Fenced object: ```json\n{"indices": [0, 1]}\n```
 * - Brackets in prose: "Matching candidates are: [0, 1]"
 * Returns null if parsing fails so caller can invoke safe fallback.
 */
export function parseAiIndices(text) {
  if (!text || typeof text !== 'string') return null;
  let clean = text.trim();
  clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const parsed = JSON.parse(clean);
    if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => !isNaN(n));
    if (parsed && typeof parsed === 'object') {
      const arr = parsed.indices || parsed.matches || parsed.results || Object.values(parsed).find(Array.isArray);
      if (Array.isArray(arr)) return arr.map(Number).filter((n) => !isNaN(n));
    }
  } catch (_) {}

  const arrayMatch = clean.match(/\[[\d\s,]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => !isNaN(n));
    } catch (_) {}
  }

  const objectMatch = clean.match(/\{[\s\S]*?\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      const arr = parsed.indices || parsed.matches || parsed.results || Object.values(parsed).find(Array.isArray);
      if (Array.isArray(arr)) return arr.map(Number).filter((n) => !isNaN(n));
    } catch (_) {}
  }

  return null;
}

/**
 * 2-Stage Hybrid Audience Filter for leads.
 * Stage 1: Zero-token deterministic local pre-filter (location dropping, high-confidence signal/name keeping).
 * Stage 2: Minimal single-batch AI check for ambiguous leads only when needed to fill targetCount.
 *
 * @param {Array<object>} prospects
 * @param {string} criteria
 * @param {object} [options]
 * @param {number} [options.targetCount]
 * @param {Function} [options.aiPromptFn]
 * @returns {Promise<Array<object>>}
 */
export async function filterProspectsByCriteria(prospects = [], criteria = '', options = {}) {
  const targetCount = Math.max(1, options.targetCount || prospects.length);
  if (!Array.isArray(prospects) || prospects.length === 0) return [];
  if (!criteria || !String(criteria).trim()) {
    return prospects.slice(0, targetCount);
  }

  const critStr = String(criteria).trim();
  const wantsUsa = /\b(usa|u\.s\.a\.?|united states|us|america)\b/i.test(critStr);
  const wantsIndian = /\b(indians?|desi|south asian|indian origin|from india)\b/i.test(critStr);

  const rawCount = prospects.filter(Boolean).length;
  let droppedLoc = 0;
  const stage1Matches = [];
  const ambiguousLeads = [];

  for (const p of prospects) {
    if (!p) continue;
    // Stage 1.1: Location check (Zero-Token Local Pre-Filter)
    if (wantsUsa && isDefiniteNonUsaLocation(p.location)) {
      droppedLoc++;
      continue;
    }

    // Stage 1.2: Demographic / Nationality signals
    if (wantsIndian) {
      const classification = classifyProspectByIndianCriteria(p);
      if (classification === 'KEEP') {
        stage1Matches.push(p);
      } else if (classification === 'AMBIGUOUS') {
        ambiguousLeads.push(p);
      }
    } else {
      stage1Matches.push(p);
    }
  }

  const s1Kept = stage1Matches.length;
  let s2In = 0;
  let s2Kept = 0;

  // If Stage 1 deterministic filter already satisfies target count, or no ambiguous leads exist
  if (stage1Matches.length >= targetCount || ambiguousLeads.length === 0) {
    logDebug('info', 'AI', `[Filter] raw=${rawCount}, droppedLocation=${droppedLoc}, stage1Kept=${s1Kept}, stage2Input=${s2In}, stage2Kept=${s2Kept}`);
    console.log(`[Filter] raw=${rawCount}, droppedLocation=${droppedLoc}, stage1Kept=${s1Kept}, stage2Input=${s2In}, stage2Kept=${s2Kept}`);
    return stage1Matches.slice(0, targetCount);
  }

  // Stage 2: Minimal Single-Batch AI Check for ambiguous leads
  s2In = Math.min(30, ambiguousLeads.length);
  const compactAmbiguous = ambiguousLeads.slice(0, 30).map((p, idx) => ({
    i: idx,
    name: p.fullName || p.name || `${p.firstName || ''} ${p.lastName || ''}`.trim() || 'Unknown',
    headline: (p.headline || p.title || '').slice(0, 80),
    location: (p.location || '').slice(0, 50),
  }));

  // Clean criteria to focus purely on demographic and location for Stage 2
  let aiCriteria = critStr.replace(/\b(actively job searching|job searching|actively looking|job seeker|seeking (?:a )?job|looking for (?:a )?job|searching for (?:a )?job)\b/gi, '').trim();
  if (!aiCriteria) aiCriteria = 'Indian origin/heritage currently in the United States';

  const system =
    'You are an accurate prospect classifier. Return ONLY a valid JSON array of indices [i] of candidates who fit the target demographic/location criteria (e.g. Indian origin/heritage currently in the United States). Do NOT reject candidates solely for lacking job-seeking keywords in their headline. Include ambiguous or modern Indian names. Return ONLY a valid JSON array like [0, 2] or object {"indices": [0, 2]}.';
  const user = `Target Demographic & Location Criteria: ${aiCriteria}\n\nCandidates:\n${JSON.stringify(compactAmbiguous)}\n\nReturn JSON array of matching indices [i] (e.g. [0, 2]):`;

  try {
    const aiFn = options.aiPromptFn || executeAiPrompt;
    const aiRes = await aiFn({ system, user, maxTokens: 150 });
    const text = String(aiRes?.text || '').trim();
    const indices = parseAiIndices(text);

    if (Array.isArray(indices) && indices.length > 0) {
      for (const idx of indices) {
        if (typeof idx === 'number' && ambiguousLeads[idx]) {
          stage1Matches.push(ambiguousLeads[idx]);
          s2Kept++;
          if (stage1Matches.length >= targetCount) break;
        }
      }
    } else {
      // If Stage 2 returned invalid JSON or empty result, do NOT drop ambiguous Indian-sounding names — fall back safely
      for (const lead of ambiguousLeads) {
        if (stage1Matches.length >= targetCount) break;
        stage1Matches.push(lead);
        s2Kept++;
      }
    }
  } catch (err) {
    // Graceful fallback: If the AI call fails, times out, or returns 429,
    // do NOT drop ambiguous Indian-sounding names — fall back safely.
    logDebug('warn', 'AI', `[filterProspectsByCriteria Stage 2 AI Fallback] ${err.message}`);
    for (const lead of ambiguousLeads) {
      if (stage1Matches.length >= targetCount) break;
      stage1Matches.push(lead);
      s2Kept++;
    }
  }

  logDebug('info', 'AI', `[Filter] raw=${rawCount}, droppedLocation=${droppedLoc}, stage1Kept=${s1Kept}, stage2Input=${s2In}, stage2Kept=${s2Kept}`);
  console.log(`[Filter] raw=${rawCount}, droppedLocation=${droppedLoc}, stage1Kept=${s1Kept}, stage2Input=${s2In}, stage2Kept=${s2Kept}`);

  return stage1Matches.slice(0, targetCount);
}

