import { describe, it, expect, beforeEach } from 'vitest';
import { ACTIONS, ERROR } from '../../src/lib/actions.js';
import { handle } from '../../src/background/engine.js';
import { setConfig } from '../../src/lib/config.js';
import * as ai from '../../src/background/ai.js';
import { promptFor, parseOutput } from '../../src/background/ai-prompts.js';
import { stubFetch, status } from '../helpers/net.js';
import '../../src/background/ai.js';

const KEY = 'sk-secret-key-value';

const ada = {
  publicId: 'adalovelace',
  fullName: 'Ada Lovelace',
  title: 'Chief Analyst',
  company: 'Analytical Engines',
  headline: 'Chief Analyst at Analytical Engines',
  location: 'London',
};

let net;

beforeEach(() => {
  net = stubFetch();
});

describe('configuration', () => {
  it('AI_NOT_CONFIGURED when no provider is set', async () => {
    const res = await handle(ACTIONS.AI_COMPLETE, { task: 'opener', input: { profile: ada } });
    expect(res.ok).toBe(false);
    expect(res.error.code).toBe(ERROR.AI_NOT_CONFIGURED);
    expect(net.calls).toHaveLength(0);
  });

  it('AI_NOT_CONFIGURED when a hosted provider has no key', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: '' } });
    await expect(ai.complete('opener', { profile: ada })).rejects.toMatchObject({
      code: ERROR.AI_NOT_CONFIGURED,
    });
  });

  it('AI_NOT_CONFIGURED when openai-compatible has no baseUrl', async () => {
    await setConfig({ ai: { provider: 'openai-compatible', apiKey: KEY, baseUrl: '' } });
    await expect(ai.complete('opener', { profile: ada })).rejects.toMatchObject({
      code: ERROR.AI_NOT_CONFIGURED,
    });
  });

  it('ollama needs no key', async () => {
    await setConfig({ ai: { provider: 'ollama' } });
    net.push({ message: { content: 'Hello Ada.' } });
    const out = await ai.complete('opener', { profile: ada });
    expect(out.output).toBe('Hello Ada.');
  });
});

describe('adapters', () => {
  it('anthropic', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: KEY } });
    net.push({ content: [{ type: 'text', text: 'Hi Ada — nice work on the engines.' }] });

    const out = await ai.complete('opener', { profile: ada, tone: 'warm' });
    const call = net.calls[0];

    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.method).toBe('POST');
    expect(call.headers['x-api-key']).toBe(KEY);
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
    expect(call.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(call.headers.authorization).toBeUndefined();
    expect(call.json.model).toBe('claude-sonnet-5');
    expect(call.json.system).toContain('opener');
    expect(call.json.messages[0].role).toBe('user');
    expect(call.json.messages[0].content).toContain('Analytical Engines');
    expect(out).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(out.output).toBe('Hi Ada — nice work on the engines.');
  });

  it('groq', async () => {
    await setConfig({ ai: { provider: 'groq', apiKey: KEY } });
    net.push({ choices: [{ message: { content: 'Hi Ada from Groq.' } }] });

    const out = await ai.complete('summary', { profile: ada });
    const call = net.calls[0];

    expect(call.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.json.model).toBe('llama-3.3-70b-versatile');
    expect(call.json.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(out.output).toBe('Hi Ada from Groq.');
  });

  it('openai', async () => {
    await setConfig({ ai: { provider: 'openai', apiKey: KEY } });
    net.push({ choices: [{ message: { content: 'Hi Ada.' } }] });

    const out = await ai.complete('summary', { profile: ada });
    const call = net.calls[0];

    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.json.model).toBe('gpt-5-mini');
    expect(call.json.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(out.output).toBe('Hi Ada.');
  });

  it('gemini', async () => {
    await setConfig({ ai: { provider: 'gemini', apiKey: KEY } });
    net.push({ candidates: [{ content: { parts: [{ text: 'Hi Ada.' }] } }] });

    const out = await ai.complete('comment', { profile: ada, post: 'We are hiring.' });
    const call = net.calls[0];

    expect(call.url).toContain('gemini-2.5-flash:generateContent');
    expect(call.url).toContain(`key=${KEY}`);
    expect(call.json.contents[0].parts[0].text).toContain('We are hiring.');
    expect(call.json.systemInstruction.parts[0].text).toBeTruthy();
    expect(out.model).toBe('gemini-2.5-flash');
  });

  it('ollama', async () => {
    await setConfig({ ai: { provider: 'ollama' } });
    net.push({ message: { content: 'Hi Ada.' } });

    await ai.complete('opener', { profile: ada });
    const call = net.calls[0];

    expect(call.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(call.json.model).toBe('llama3.1:8b');
    expect(call.json.stream).toBe(false);
  });

  it('openai-compatible honours the baseUrl and trims a trailing slash', async () => {
    await setConfig({
      ai: { provider: 'openai-compatible', apiKey: KEY, baseUrl: 'http://127.0.0.1:1234/v1/', model: 'local-model' },
    });
    net.push({ choices: [{ message: { content: 'ok' } }] });

    await ai.complete('opener', { profile: ada });
    expect(net.calls[0].url).toBe('http://127.0.0.1:1234/v1/chat/completions');
    expect(net.calls[0].json.model).toBe('local-model');
  });

  it('an overridden model wins over the default', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: KEY, model: 'claude-opus-5' } });
    net.push({ content: [{ text: 'x' }] });
    const out = await ai.complete('opener', { profile: ada });
    expect(out.model).toBe('claude-opus-5');
  });
});

describe('errors', () => {
  it('AI_ERROR on a non-200, and the key never appears in the message', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: KEY } });
    net.push(status(401, { error: { message: `bad key ${KEY}` } }));
    const e = await ai.complete('opener', { profile: ada }).catch((x) => x);
    expect(e.code).toBe(ERROR.AI_ERROR);
    expect(e.message).not.toContain(KEY);
  });

  it('AI_ERROR when the provider returns nothing usable', async () => {
    await setConfig({ ai: { provider: 'openai', apiKey: KEY } });
    net.push({ choices: [] });
    await expect(ai.complete('opener', { profile: ada })).rejects.toMatchObject({
      code: ERROR.AI_ERROR,
    });
  });
});

describe('prompts', () => {
  it('opener passes only profile facts and aims under LinkedIn\'s 200-character limit', () => {
    const { system, user } = promptFor('opener', { profile: ada, tone: 'direct' });
    // 180, not 200: a rendered name and job title must not push it over.
    expect(system).toMatch(/180/);
    expect(system).toMatch(/200/);
    expect(system).not.toMatch(/300 characters/);
    expect(system).toMatch(/do not invent|never invent/i);
    expect(system).toContain('direct');
    expect(user).toContain('Ada Lovelace');
    expect(user).toContain('Analytical Engines');
  });

  it('has a prompt for every contract task', () => {
    for (const task of ['opener', 'summary', 'sentiment', 'comment', 'score']) {
      const p = promptFor(task, { profile: ada, message: 'hi', brief: 'b', post: 'p' });
      expect(p.system).toBeTruthy();
      expect(p.user).toBeTruthy();
    }
  });

  it('sentiment parses to a sentiment and an intent', () => {
    expect(parseOutput('sentiment', '{"sentiment":"positive","intent":"book_call"}')).toEqual({
      sentiment: 'positive',
      intent: 'book_call',
    });
    expect(parseOutput('sentiment', 'Positive — they want a call')).toMatchObject({
      sentiment: 'positive',
    });
  });

  it('score parses to a number and a reason', () => {
    expect(parseOutput('score', '{"score":82,"reason":"Exact title match"}')).toEqual({
      score: 82,
      reason: 'Exact title match',
    });
    expect(parseOutput('score', '73 — close enough').score).toBe(73);
    expect(parseOutput('score', 'nonsense').score).toBe(0);
  });

  it('text tasks come back as trimmed strings', () => {
    expect(parseOutput('opener', '  Hi Ada.  ')).toBe('Hi Ada.');
  });
});

describe('ai.complete action', () => {
  it('returns output, provider and model through the engine', async () => {
    await setConfig({ ai: { provider: 'anthropic', apiKey: KEY } });
    net.push({ content: [{ text: 'Hi Ada.' }] });
    const res = await handle(ACTIONS.AI_COMPLETE, { task: 'opener', input: { profile: ada } });
    expect(res.data).toEqual({ output: 'Hi Ada.', provider: 'anthropic', model: 'claude-sonnet-5' });
  });
});

describe('sanitizeGeminiContents', () => {
  it('strips thoughtSignature and invalid keys from inside functionCall while preserving sibling thoughtSignature', () => {
    const uncleanedContents = [
      {
        role: 'user',
        parts: [{ text: 'Search for leads' }],
      },
      {
        role: 'model',
        parts: [
          {
            text: 'Thinking about tools...',
            thought: true,
            'thought signature': 'sig_thought_1',
          },
          {
            functionCall: {
              name: 'search_and_save_leads',
              args: { keywords: 'Data Analyst', count: 10 },
              'thought signature': 'sig_fc_invalid_space',
              thoughtSignature: 'sig_fc_valid',
              thought_signature: 'sig_fc_snake',
              id: 'call_123',
            },
            'thought signature': 'sig_part_space',
          },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'search_and_save_leads',
              response: { result: { count: 10 } },
            },
          },
        ],
      },
    ];

    const sanitized = ai.sanitizeGeminiContents(uncleanedContents);

    // Turn 1
    expect(sanitized[0]).toEqual({
      role: 'user',
      parts: [{ text: 'Search for leads' }],
    });

    // Turn 2
    const modelTurn = sanitized[1];
    expect(modelTurn.role).toBe('model');
    expect(modelTurn.parts).toHaveLength(2);

    // Thought text part
    expect(modelTurn.parts[0]).toEqual({
      text: 'Thinking about tools...',
      thought: true,
      thoughtSignature: 'sig_thought_1',
    });

    // Function call part
    const fcPart = modelTurn.parts[1];
    expect(fcPart.functionCall).toEqual({
      name: 'search_and_save_leads',
      args: { keywords: 'Data Analyst', count: 10 },
    });
    // Sibling thoughtSignature at the part level
    expect(fcPart.thoughtSignature).toBeDefined();
    // NEVER thought signature or thoughtSignature inside functionCall
    expect(fcPart.functionCall['thought signature']).toBeUndefined();
    expect(fcPart.functionCall.thoughtSignature).toBeUndefined();
    expect(fcPart.functionCall.thought_signature).toBeUndefined();
    expect(fcPart.functionCall.id).toBeUndefined();
    // NEVER invalid keys with spaces at the part level
    expect(fcPart['thought signature']).toBeUndefined();
    expect(fcPart.thought_signature).toBeUndefined();

    // Turn 3
    expect(sanitized[2]).toEqual({
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: 'search_and_save_leads',
            response: { result: { count: 10 } },
          },
        },
      ],
    });
  });

  it('handles empty and malformed content safely', () => {
    expect(ai.sanitizeGeminiContents(null)).toEqual([]);
    expect(ai.sanitizeGeminiContents([])).toEqual([]);
    expect(ai.sanitizeGeminiContents('invalid')).toEqual([]);
    expect(ai.sanitizeGeminiContents([{ role: 'assistant', parts: [{}] }])).toEqual([
      { role: 'model', parts: [{ text: '' }] },
    ]);
  });
});

describe('Gemini Schema and Tools Sanitizer', () => {
  it('strips unsupported schema properties ($schema, additionalProperties, default) and normalizes types', () => {
    const rawSchema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      additionalProperties: false,
      properties: {
        keywords: {
          type: 'string',
          description: 'Search keywords',
          default: 'Software Engineer',
        },
        count: {
          type: ['integer', 'null'],
          description: 'Number of results',
        },
        level: {
          type: 'integer',
          enum: [1, 2, 3], // non-string enum should be removed
        },
        tags: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['tech', 'sales'],
          },
        },
      },
      required: ['keywords'],
    };

    const sanitized = ai.sanitizeGeminiSchema(rawSchema);

    expect(sanitized.$schema).toBeUndefined();
    expect(sanitized.additionalProperties).toBeUndefined();
    expect(sanitized.type).toBe('OBJECT');
    expect(sanitized.properties.keywords.default).toBeUndefined();
    expect(sanitized.properties.keywords.type).toBe('STRING');
    // Union type normalized
    expect(sanitized.properties.count.type).toBe('INTEGER');
    // Non-string enum stripped
    expect(sanitized.properties.level.enum).toBeUndefined();
    // String enum preserved
    expect(sanitized.properties.tags.items.enum).toEqual(['tech', 'sales']);
    expect(sanitized.required).toEqual(['keywords']);
  });

  it('sanitizeGeminiTools converts OpenAI tool format to clean Gemini declarations', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'search_leads',
          description: 'Searches LinkedIn leads',
          parameters: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
    ];

    const decls = ai.sanitizeGeminiTools(tools);
    expect(decls).toHaveLength(1);
    expect(decls[0].name).toBe('search_leads');
    expect(decls[0].description).toBe('Searches LinkedIn leads');
    expect(decls[0].parameters.type).toBe('OBJECT');
    expect(decls[0].parameters.$schema).toBeUndefined();
    expect(decls[0].parameters.additionalProperties).toBeUndefined();
  });
});

describe('extractJsonFromAiResponse', () => {
  it('extracts JSON from markdown code fences', () => {
    const fenced = '```json\n{"candidates": [1, 2, 3], "status": "ok"}\n```';
    expect(ai.extractJsonFromAiResponse(fenced)).toEqual({
      candidates: [1, 2, 3],
      status: 'ok',
    });
  });

  it('extracts outermost JSON object or array from conversational prose', () => {
    const prose = 'Sure! Here is the data: {"id": "c1", "enrolled": 10} Let me know if you need anything else.';
    expect(ai.extractJsonFromAiResponse(prose)).toEqual({
      id: 'c1',
      enrolled: 10,
    });

    const arrayProse = 'Candidates matching criteria:\n[{"i": 0}, {"i": 2}]\nHope this helps!';
    expect(ai.extractJsonFromAiResponse(arrayProse)).toEqual([{ i: 0 }, { i: 2 }]);
  });

  it('returns fallback safely when parsing fails or input is null', () => {
    expect(ai.extractJsonFromAiResponse(null, { fallback: true })).toEqual({ fallback: true });
    expect(ai.extractJsonFromAiResponse('No json here whatsoever', null)).toBeNull();
  });
});

describe('listProviderModels & ACTIONS.AI_LIST_MODELS', () => {
  it('returns curated models with recommended tags when no API key provided', async () => {
    const geminiRes = await ai.listProviderModels({ provider: 'gemini' });
    expect(geminiRes.provider).toBe('gemini');
    expect(geminiRes.models.length).toBeGreaterThan(0);
    expect(geminiRes.models.some((m) => m.id === 'gemini-2.5-flash' && m.recommended)).toBe(true);

    const groqRes = await ai.listProviderModels({ provider: 'groq' });
    expect(groqRes.provider).toBe('groq');
    expect(groqRes.models.some((m) => m.id === 'llama-3.3-70b-versatile' && m.recommended)).toBe(true);

    const claudeRes = await ai.listProviderModels({ provider: 'claude' });
    expect(claudeRes.provider).toBe('anthropic');
    expect(claudeRes.models.some((m) => m.id.includes('claude-3-5') && m.recommended)).toBe(true);
  });

  it('handles ACTIONS.AI_LIST_MODELS action via engine handle', async () => {
    const res = await handle(ACTIONS.AI_LIST_MODELS, { provider: 'gemini' });
    expect(res.ok).toBe(true);
    expect(res.data.provider).toBe('gemini');
    expect(res.data.models.length).toBeGreaterThan(0);
    expect(res.data.models[0].recommended).toBe(true);
  });
});
