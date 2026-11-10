/**
 * Settings — one module, drawn both in the popup's Settings tab and full-width
 * on the options page.
 *
 * Every value is a contract `Config` field. The daily caps are clamped here as
 * well as in the engine so the UI never asks for something it cannot have; the
 * engine's clamp remains the one that counts.
 */

import { el, render, fmtNumber } from '../ui/dom.js';
import { call, getLocal, setLocal, UI_KEYS } from './api.js';
import { ACTIONS, HARD_CAPS } from '../lib/actions.js';
import {
  aiEndpointFor,
  enrichmentEndpointFor,
  hasHostAccess,
  originPatternFor,
  requestHostAccess,
} from '../lib/permissions.js';
import {
  card,
  field,
  row,
  input,
  select,
  checkbox,
  pill,
  errorLine,
  statusLine,
  busyButton,
  button,
} from './components.js';

const PRESETS = [
  { value: 'free', label: 'Free account' },
  { value: 'premium', label: 'Premium' },
  { value: 'salesnav', label: 'Sales Navigator' },
  { value: 'recruiter', label: 'Recruiter' },
];

/**
 * Suggested pacing per account type. Applied to the form when the preset
 * changes; the user can still edit every field afterwards, and the hard caps
 * still apply.
 */
export const PRESET_DEFAULTS = {
  free: {
    minDelayMs: 12000,
    maxDelayMs: 25000,
    hourlyCap: 15,
    dailyInviteCap: 20,
    dailyMessageCap: 30,
    dailyVisitCap: 100,
    dailySearchCap: 200,
  },
  premium: {
    minDelayMs: 10000,
    maxDelayMs: 20000,
    hourlyCap: 20,
    dailyInviteCap: 25,
    dailyMessageCap: 50,
    dailyVisitCap: 200,
    dailySearchCap: 300,
  },
  salesnav: {
    minDelayMs: 9000,
    maxDelayMs: 18000,
    hourlyCap: 25,
    dailyInviteCap: 40,
    dailyMessageCap: 80,
    dailyVisitCap: 300,
    dailySearchCap: 600,
  },
  recruiter: {
    minDelayMs: 8000,
    maxDelayMs: 16000,
    hourlyCap: 30,
    dailyInviteCap: 50,
    dailyMessageCap: 100,
    dailyVisitCap: 400,
    dailySearchCap: 800,
  },
};

const AI_PROVIDERS = [
  { value: 'none', label: 'None' },
  { value: 'groq', label: 'Groq (Free & Ultra-Fast)' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'ollama', label: 'Ollama (local)' },
  { value: 'openai-compatible', label: 'OpenAI-compatible' },
];

/** Which AI fields each provider actually uses. */
export const AI_FIELDS = {
  none: [],
  groq: ['model', 'apiKey'],
  anthropic: ['model', 'apiKey'],
  openai: ['model', 'apiKey'],
  gemini: ['model', 'apiKey'],
  ollama: ['model', 'baseUrl'],
  'openai-compatible': ['model', 'baseUrl', 'apiKey'],
};

const ENRICH_PROVIDERS = [
  { value: 'none', label: 'None' },
  { value: 'hunter', label: 'Hunter' },
];

const CAP_FIELDS = [
  ['dailyInviteCap', 'Invites / day', HARD_CAPS.dailyInviteCap],
  ['dailyMessageCap', 'Messages / day', HARD_CAPS.dailyMessageCap],
  ['dailyVisitCap', 'Profile visits / day', HARD_CAPS.dailyVisitCap],
  ['dailySearchCap', 'Search results / day', HARD_CAPS.dailySearchCap],
];

const int = (value, fallback = 0) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Draw the settings form.
 *
 * @param {HTMLElement} container
 * @param {{ extras?: (ctx) => Node[] }} [opts] extras are appended at the
 *        bottom (the options page adds import/export and the danger zone).
 */
export async function renderSettings(container, opts = {}) {
  const err = errorLine();
  const status = statusLine();

  let config;
  try {
    config = await call(ACTIONS.CONFIG_GET, {});
  } catch (e) {
    render(container, [err]);
    err.show(e);
    return null;
  }

  let bridgeConnected = false;
  try {
    const engineStatus = await call(ACTIONS.STATUS_GET, {});
    bridgeConnected = Boolean(engineStatus.bridge && engineStatus.bridge.connected);
  } catch {
    bridgeConnected = false;
  }

  const storedEnrichment = (await getLocal(UI_KEYS.ENRICHMENT, null)) || config.enrichment || {};
  const isMailboxConnected = Boolean(config.mailbox && config.mailbox.connected);
  const mailboxEmail = (config.mailbox && config.mailbox.email) || '';

  /* ---------------- controls ---------------------------------------- */

  const preset = select(PRESETS, { value: config.accountPreset });
  const minDelay = input({ type: 'number', min: 3000, step: 500, value: config.minDelayMs });
  const maxDelay = input({ type: 'number', min: 3000, step: 500, value: config.maxDelayMs });
  const hourlyCap = input({ type: 'number', min: 0, max: 50, value: config.hourlyCap });

  const caps = {};
  for (const [key, , hard] of CAP_FIELDS) {
    const node = input({ type: 'number', min: 0, max: hard, value: config[key], 'data-cap': key });
    node.addEventListener('input', () => {
      if (int(node.value) > hard) node.value = hard;
    });
    caps[key] = node;
  }

  const businessHoursOnly = checkbox('Only act during business hours', {
    checked: config.businessHoursOnly,
  });
  const businessStart = input({ type: 'number', min: 0, max: 23, value: config.businessStart });
  const businessEnd = input({ type: 'number', min: 0, max: 24, value: config.businessEnd });
  const weekdaysOnly = checkbox('Weekdays only', { checked: config.weekdaysOnly });
  const warmup = checkbox('Warm up a new account over 14 days', {
    checked: Boolean(config.warmup && config.warmup.enabled),
  });

  const aiProvider = select(AI_PROVIDERS, { value: (config.ai && config.ai.provider) || 'none' });
  const aiModel = input({ placeholder: 'model name', value: (config.ai && config.ai.model) || '' });
  const aiBaseUrl = input({
    placeholder: 'http://127.0.0.1:11434',
    value: (config.ai && config.ai.baseUrl) || '',
  });
  const aiKey = input({
    type: 'password',
    placeholder: 'API key (stays on this machine)',
    value: (config.ai && config.ai.apiKey) || '',
  });
  const aiFields = {
    model: field('Model', aiModel),
    baseUrl: field('Base URL', aiBaseUrl),
    apiKey: field('API key', aiKey),
  };
  const paintAiFields = () => {
    const shown = AI_FIELDS[aiProvider.value] || [];
    for (const [key, node] of Object.entries(aiFields)) node.hidden = !shown.includes(key);
  };
  aiProvider.addEventListener('change', paintAiFields);
  paintAiFields();

  /**
   * The URL the chosen provider will actually be called on. An MV3 worker may
   * only fetch a host it holds a permission for, and LinkedIn is the only one
   * granted at install time, so the user grants this one when they pick it.
   */
  const aiEndpoint = () =>
    aiEndpointFor({ provider: aiProvider.value, baseUrl: aiBaseUrl.value.trim() });

  const aiAccess = statusLine('');
  aiAccess.node = aiAccess;

  const maintenanceStatus = statusLine('');
  maintenanceStatus.node = maintenanceStatus;

  async function paintAiAccess() {
    const endpoint = aiEndpoint();
    if (!endpoint) {
      aiAccess.set('');
      return;
    }
    const granted = await hasHostAccess(endpoint);
    aiAccess.set(
      granted
        ? `Access granted to ${originPatternFor(endpoint)}.`
        : `The extension cannot reach ${originPatternFor(endpoint)} yet — press "Grant access".`,
    );
  }

  aiProvider.addEventListener('change', paintAiAccess);
  aiBaseUrl.addEventListener('change', paintAiAccess);
  paintAiAccess();

  const bridgeEnabled = checkbox('Let a local MCP server connect', {
    checked: Boolean(config.bridge && config.bridge.enabled),
  });
  const bridgePort = input({
    type: 'number',
    min: 1,
    max: 65535,
    value: (config.bridge && config.bridge.port) || 47829,
  });
  const bridgeToken = input({
    placeholder: 'paste the pairing token',
    value: (config.bridge && config.bridge.token) || '',
  });

  const webhookUrl = input({
    placeholder: 'https://…  (events are POSTed here)',
    value: config.webhookUrl || '',
  });

  const enrichProvider = select(ENRICH_PROVIDERS, { value: storedEnrichment.provider || 'none' });
  const enrichKey = input({
    type: 'password',
    placeholder: 'provider API key',
    value: storedEnrichment.apiKey || '',
  });

  preset.addEventListener('change', () => {
    const suggested = PRESET_DEFAULTS[preset.value];
    if (!suggested) return;
    minDelay.value = suggested.minDelayMs;
    maxDelay.value = suggested.maxDelayMs;
    hourlyCap.value = suggested.hourlyCap;
    for (const [key, , hard] of CAP_FIELDS) caps[key].value = Math.min(suggested[key], hard);
    status.set(`Applied the ${preset.value} pacing. Save to keep it.`);
  });

  /** The Config patch this form describes. */
  function collect() {
    const patch = {
      accountPreset: preset.value,
      minDelayMs: int(minDelay.value, config.minDelayMs),
      maxDelayMs: int(maxDelay.value, config.maxDelayMs),
      hourlyCap: int(hourlyCap.value, config.hourlyCap),
      businessHoursOnly: businessHoursOnly.input.checked,
      businessStart: int(businessStart.value, config.businessStart),
      businessEnd: int(businessEnd.value, config.businessEnd),
      weekdaysOnly: weekdaysOnly.input.checked,
      warmup: { ...(config.warmup || {}), enabled: warmup.input.checked },
      ai: { provider: aiProvider.value },
      bridge: {
        enabled: bridgeEnabled.input.checked,
        port: int(bridgePort.value, 47829),
      },
      webhookUrl: webhookUrl.value.trim(),
      mailbox: config.mailbox || { connected: false, email: '' },
      // Not part of the contract Config yet — the enrichment provider block.
      enrichment: { provider: enrichProvider.value, apiKey: enrichKey.value.trim() },
    };
    for (const [key, , hard] of CAP_FIELDS) patch[key] = Math.min(int(caps[key].value, 0), hard);

    const shown = AI_FIELDS[aiProvider.value] || [];
    if (shown.includes('model') || aiModel.value.trim()) patch.ai.model = aiModel.value.trim();
    if (shown.includes('baseUrl')) patch.ai.baseUrl = aiBaseUrl.value.trim();
    if (shown.includes('apiKey')) patch.ai.apiKey = aiKey.value;
    if (bridgeToken.value.trim()) patch.bridge.token = bridgeToken.value.trim();
    return patch;
  }

  async function save() {
    const patch = collect();
    const saved = await call(ACTIONS.CONFIG_SET, patch);
    await setLocal(UI_KEYS.ENRICHMENT, patch.enrichment);
    config = saved;
    status.set('Saved.');
    if (opts.onSaved) await opts.onSaved(saved);
    return saved;
  }

  const ctx = { collect, save, reload: () => renderSettings(container, opts), error: err, status };

  /* ---------------- cards -------------------------------------------- */

  render(container, [
    err,
    status,

    card(
      'Account',
      { hint: 'Choosing a preset fills in pacing that suits that account type.' },
      field('Account type', preset),
    ),

    card(
      'Pace',
      { hint: 'A random delay between these bounds sits in front of every action.' },
      row(field('Min delay (ms)', minDelay), field('Max delay (ms)', maxDelay)),
      field('Actions per hour', hourlyCap, 'Hard ceiling: 50'),
    ),

    card(
      'Daily caps',
      { hint: 'The hard caps live in the extension and no client can raise them.' },
      el(
        'div',
        { class: 'grid-2' },
        CAP_FIELDS.map(([key, labelText, hard]) =>
          field(labelText, caps[key], `Hard cap: ${fmtNumber(hard)}`),
        ),
      ),
    ),

    card(
      'When',
      businessHoursOnly,
      row(field('From (hour)', businessStart), field('To (hour)', businessEnd)),
      weekdaysOnly,
      warmup,
    ),

    card(
      'Safety & Maintenance',
      { hint: 'Clean up stale pending connection requests to stay well clear of LinkedIn invitation limits.' },
      row(
        busyButton(
          'Clean Pending Invites (>14 days)',
          async () => {
            maintenanceStatus.set('Checking pending sent invitations older than 14 days…');
            const res = await call(ACTIONS.NETWORK_WITHDRAW_STALE_INVITES, {});
            const withdrawn = res.withdrawnCount ?? res.withdrawn ?? 0;
            if (withdrawn === 0) {
              maintenanceStatus.set(
                (res.skippedCount || 0) > 0
                  ? `Checked sent invitations: ${res.skippedCount} skipped, 0 withdrawn.`
                  : 'No pending invitations older than 14 days found.',
              );
            } else {
              maintenanceStatus.set(
                `Successfully withdrew ${withdrawn} stale invitation${withdrawn === 1 ? '' : 's'}${res.skippedCount ? ` (${res.skippedCount} skipped)` : ''}.`,
              );
            }
          },
          { error: err },
        ),
      ),
      maintenanceStatus,
    ),

    card(
      'AI provider',
      { hint: 'Keys are stored locally and only ever sent to the provider you pick.' },
      field('Provider', aiProvider),
      aiFields.model,
      aiFields.baseUrl,
      aiFields.apiKey,
      aiAccess.node,
      row(
        busyButton(
          'Grant access',
          async () => {
            const endpoint = aiEndpoint();
            if (!endpoint) {
              status.set('Pick a provider first.');
              return;
            }
            // Chrome only honours this straight out of a click, so it runs
            // before anything is saved or awaited.
            const granted = await requestHostAccess(endpoint);
            await paintAiAccess();
            status.set(
              granted
                ? `Granted. ${originPatternFor(endpoint)} is reachable now.`
                : 'Access was declined, so this provider cannot be reached.',
            );
          },
          { error: err },
        ),
        busyButton(
          'Test AI Connection',
          async () => {
            const endpoint = aiEndpoint();
            if (endpoint && !(await hasHostAccess(endpoint))) {
              status.set('Please click "Grant access" first to allow network requests.');
              return;
            }
            await save();
            const startTime = Date.now();
            try {
              const result = await call(ACTIONS.AI_COMPLETE, {
                task: 'summary',
                input: { text: 'Testing AI connection. Reply with "OK".' },
              });
              const latency = Date.now() - startTime;
              const outputText =
                typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
              status.set(
                `Connected! [${result.provider || aiProvider.value} · ${result.model || aiModel.value}] responded in ${latency}ms: "${outputText}"`,
              );
            } catch (e) {
              status.set(`Connection Failed: ${e.message || e}`);
            }
          },
          { error: err },
        ),
      ),
    ),

    card(
      'Connected Mailbox (Gmail)',
      {
        hint: 'Send cold emails directly through your official Gmail or Google Workspace account using OAuth2.',
        actions: isMailboxConnected
          ? pill(`Connected: ${mailboxEmail}`, 'good')
          : pill('Not Connected', 'neutral'),
      },
      isMailboxConnected
        ? row(
            busyButton(
              'Send Test Email',
              async () => {
                const res = await call(ACTIONS.GMAIL_TEST, {});
                status.set(`Test email sent successfully to ${res.to || mailboxEmail}!`);
              },
              { variant: 'ghost', error: err },
            ),
            busyButton(
              'Disconnect Mailbox',
              async () => {
                await call(ACTIONS.GMAIL_DISCONNECT, {});
                await renderSettings(container, opts);
                status.set('Mailbox disconnected.');
              },
              { variant: 'danger', error: err },
            ),
          )
        : row(
            busyButton(
              'Connect with Gmail (Google Login)',
              async () => {
                const res = await call(ACTIONS.GMAIL_CONNECT, { interactive: true });
                await renderSettings(container, opts);
                status.set(`Connected to Gmail as ${res.email}!`);
              },
              { variant: 'primary', error: err },
            ),
          ),
    ),

    card(
      'Local bridge',
      {
        hint: 'ws://127.0.0.1:47829 — the MCP server pairs with this token.',
        actions: bridgeConnected ? pill('connected', 'good') : pill('not connected', 'neutral'),
      },
      bridgeEnabled,
      row(field('Port', bridgePort)),
      field('Pairing token', bridgeToken),
    ),

    card(
      'Webhook',
      { hint: 'Events are POSTed here. Leave empty for none.' },
      field('URL', webhookUrl),
    ),

    card(
      'Enrichment',
      { hint: 'A provider interface, not a bundled service.' },
      field('Provider', enrichProvider),
      field('API key', enrichKey),
      row(
        busyButton(
          'Grant access',
          async () => {
            const endpoint = enrichmentEndpointFor({ provider: enrichProvider.value });
            if (!endpoint) {
              status.set('Pick an enrichment provider first.');
              return;
            }
            const granted = await requestHostAccess(endpoint);
            status.set(
              granted
                ? `Granted. ${originPatternFor(endpoint)} is reachable now.`
                : 'Access was declined, so enrichment cannot reach that provider.',
            );
          },
          { error: err },
        ),
      ),
    ),

    el(
      'div',
      { class: 'row' },
      busyButton('Save settings', () => save(), { variant: 'primary', error: err }),
      button('Reload', () => renderSettings(container, opts)),
    ),

    opts.extras ? opts.extras(ctx) : null,
  ]);

  return ctx;
}
