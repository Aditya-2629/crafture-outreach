/**
 * OutFox — shared action contract.
 *
 * Source of truth: `docs/actions.md`. Every layer (engine, popup, bridge, MCP
 * server, CLI, clients) speaks exactly these action names, error codes and
 * event names. Nothing here may be invented without adding it to that file.
 *
 * No dependencies, no build step: this file is loaded directly by the MV3
 * service worker.
 */

/* ================================================================== */
/*  Action names                                                      */
/* ================================================================== */

export const ACTIONS = Object.freeze({
  STATUS_GET: 'status.get',

  CONFIG_GET: 'config.get',
  CONFIG_SET: 'config.set',

  SEARCH_PEOPLE: 'search.people',

  PROFILE_GET: 'profile.get',
  PROFILE_EXPORT: 'profile.export',

  COMPANY_GET: 'company.get',
  COMPANY_EMPLOYEES: 'company.employees',

  POST_ENGAGERS: 'post.engagers',
  GROUP_MEMBERS: 'group.members',
  EVENT_ATTENDEES: 'event.attendees',

  NETWORK_CONNECTIONS: 'network.connections',
  NETWORK_FOLLOWERS: 'network.followers',
  NETWORK_STATUS: 'network.status',
  NETWORK_UNFOLLOW_COUNT: 'network.unfollowCount',
  NETWORK_UNFOLLOW_ALL: 'network.unfollowAll',
  NETWORK_UNFOLLOW_STOP: 'network.unfollowStop',
  NETWORK_UNFOLLOW_STATUS: 'network.unfollowStatus',
  NETWORK_WITHDRAW_STALE_INVITES: 'network.withdrawStaleInvites',
  NETWORK_WITHDRAW_OLD_INVITES: 'network.withdrawStaleInvites',

  OUTREACH_VIEW: 'outreach.view',
  OUTREACH_FOLLOW: 'outreach.follow',
  OUTREACH_INVITE: 'outreach.invite',
  OUTREACH_MESSAGE: 'outreach.message',
  OUTREACH_INMAIL: 'outreach.inmail',
  OUTREACH_LIKE: 'outreach.like',
  OUTREACH_COMMENT: 'outreach.comment',
  OUTREACH_EMAIL: 'outreach.email',
  OUTREACH_ENDORSE: 'outreach.endorse',

  GMAIL_CONNECT: 'gmail.connect',
  GMAIL_DISCONNECT: 'gmail.disconnect',
  GMAIL_STATUS: 'gmail.status',
  GMAIL_TEST: 'gmail.test',

  INBOX_THREADS: 'inbox.threads',
  INBOX_MESSAGES: 'inbox.messages',
  INBOX_EXPORT: 'inbox.export',

  LIST_CREATE: 'list.create',
  LIST_GET_ALL: 'list.getAll',
  LIST_GET: 'list.get',
  LIST_ADD: 'list.add',
  LIST_REMOVE: 'list.remove',
  LIST_MEMBERS: 'list.members',
  LIST_DELETE: 'list.delete',
  LIST_IMPORT_CSV: 'list.importCsv',
  LIST_UPDATE: 'list.update',

  CAMPAIGN_CREATE: 'campaign.create',
  CAMPAIGN_GET_ALL: 'campaign.getAll',
  CAMPAIGN_GET: 'campaign.get',
  CAMPAIGN_ENROLL: 'campaign.enroll',
  CAMPAIGN_PAUSE: 'campaign.pause',
  CAMPAIGN_RESUME: 'campaign.resume',
  CAMPAIGN_DELETE: 'campaign.delete',
  CAMPAIGN_TICK: 'campaign.tick',

  QUEUE_LIST: 'queue.list',
  QUEUE_APPROVE: 'queue.approve',
  QUEUE_REJECT: 'queue.reject',

  AI_COMPLETE: 'ai.complete',

  EXPORT_CSV: 'export.csv',

  RESEARCH_RESOLVE: 'research.resolve',
  RESEARCH_PACK: 'research.pack',
  RESEARCH_GET: 'research.get',

  SYNC_PULL: 'sync.pull',

  BLACKLIST_GET: 'blacklist.get',
  BLACKLIST_ADD: 'blacklist.add',
  BLACKLIST_REMOVE: 'blacklist.remove',

  COMPANY_BLACKLIST_GET: 'companyBlacklist.get',
  COMPANY_BLACKLIST_ADD: 'companyBlacklist.add',
  COMPANY_BLACKLIST_REMOVE: 'companyBlacklist.remove',

  IMPORT_PROFILE_VIEWERS: 'import.profileViewers',
  IMPORT_POST_COMMENTERS: 'import.postCommenters',

  DASHBOARD_LIVE_STATS: 'dashboard.live_stats',

  QUOTA_RESET: 'quota.reset',

  TELEGRAM_STATUS: 'telegram.status',
  TELEGRAM_SAVE: 'telegram.save',
  TELEGRAM_TEST: 'telegram.test',

  CANDIDATES_GET: 'candidates.get',
  CANDIDATE_SET_ACTIVE: 'candidates.setActive',
  CANDIDATE_SAVE: 'candidates.save',
  CANDIDATE_DELETE: 'candidates.delete',
  ENRICH_LEAD: 'enrich.lead',

  OBJECTIONS_GET: 'objections.get',
  OBJECTION_SAVE: 'objections.save',
  OBJECTION_DELETE: 'objections.delete',
  OBJECTION_MATCH_REPLY: 'objections.matchReply',
  LEAD_SNOOZE: 'lead.snooze',
  SNOOZED_GET: 'lead.snoozedGet',

  GOOGLE_WORKSPACE_CONNECT: 'googleWorkspace.connect',
  GOOGLE_WORKSPACE_STATUS: 'googleWorkspace.status',
  GOOGLE_WORKSPACE_DISCONNECT: 'googleWorkspace.disconnect',
  SHEETS_CRM_SYNC_NOW: 'sheetsCrm.syncNow',
  BACKUP_EXPORT_JSON: 'backup.exportJson',
  BACKUP_IMPORT_JSON: 'backup.importJson',
  BACKUP_DRIVE_SAVE: 'backup.driveSave',
  BACKUP_DRIVE_RESTORE: 'backup.driveRestore',
  OUTREACH_MAILBOX_SWITCH: 'outreachMailbox.switch',
});

/* ================================================================== */
/*  Error codes                                                       */
/* ================================================================== */

export const ERROR = Object.freeze({
  EXTENSION_OFFLINE: 'EXTENSION_OFFLINE',
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  RATE_LIMITED: 'RATE_LIMITED',
  CHALLENGE_DETECTED: 'CHALLENGE_DETECTED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  OUTSIDE_BUSINESS_HOURS: 'OUTSIDE_BUSINESS_HOURS',
  INVALID_PARAMS: 'INVALID_PARAMS',
  NOT_FOUND: 'NOT_FOUND',
  LINKEDIN_ERROR: 'LINKEDIN_ERROR',
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  AI_ERROR: 'AI_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL: 'INTERNAL',
});

/* ================================================================== */
/*  Event names                                                       */
/* ================================================================== */

export const EVENTS = Object.freeze({
  INVITE_ACCEPTED: 'invite_accepted',
  REPLY_RECEIVED: 'reply_received',
  POSITIVE_REPLY: 'positive_reply',
  CAMPAIGN_STEP_DONE: 'campaign_step_done',
  CAMPAIGN_COMPLETED: 'campaign_completed',
  QUOTA_HIT: 'quota_hit',
  CHALLENGE_DETECTED: 'challenge_detected',
  QUEUE_ITEM_ADDED: 'queue_item_added',
  QUEUE_ITEM_SENT: 'queue_item_sent',
  CAMPAIGN_NOTE_TRUNCATED: 'campaign_note_truncated',
  RESEARCH_PROGRESS: 'research_progress',
  RESEARCH_COMPLETED: 'research_completed',
  UNFOLLOW_PROGRESS: 'unfollow_progress',
  EMAIL_SENT: 'email_sent',
});

/* ================================================================== */
/*  Hard caps — enforced in the extension, unraisable by any client    */
/* ================================================================== */

export const HARD_CAPS = Object.freeze({
  dailyInviteCap: 100,
  dailyMessageCap: 150,
  dailyVisitCap: 500,
  dailySearchCap: 1000,
  weeklyInviteCap: 250,
});

/**
 * How long an invitation note may be.
 *
 * LinkedIn's own dialog stops at 200 characters (captured 2026-09-09, web
 * client 1.13.46516). The engine is the only place that number is written, so
 * validation, the queue, the campaign renderer and the Voyager write all agree.
 */
export const INVITE_NOTE_MAX = 200;

/** The one sentence every layer says when a note is too long. */
export const INVITE_NOTE_FIX = 'LinkedIn limits invitation notes to 200 characters.';

/* ------------------------------------------------------------------ */
/*  Mass unfollow                                                      */
/* ------------------------------------------------------------------ */

/**
 * How many accounts one `network.unfollowAll` run may touch.
 *
 * The floor is 1 because the whole point of the limit is that you can try the
 * thing on one person before you trust it with your whole list. The ceiling is
 * a sanity bound, not a safety one: a run of 5,000 already takes most of a day
 * at human pace, and anything larger is a typo rather than an intention.
 */
export const UNFOLLOW_LIMIT_MIN = 1;
export const UNFOLLOW_LIMIT_MAX = 5000;

/** What the popup puts in the box before you touch it. */
export const UNFOLLOW_LIMIT_DEFAULT = 25;

/** The one sentence every layer says when the limit is out of range. */
export const UNFOLLOW_LIMIT_FIX =
  `limit must be between ${UNFOLLOW_LIMIT_MIN} and ${UNFOLLOW_LIMIT_MAX}; ` +
  'leave it out to walk the whole list.';

/** How many names `network.unfollowCount` returns as a sample. */
export const UNFOLLOW_SAMPLE_MAX = 10;

/**
 * How a run reaches the following list.
 *
 * `api` reads the curation-hub search that LinkedIn's own Following manager
 * reads (`resultType: PEOPLE_FOLLOW`) and unfollows with the same
 * `followingStates` patch its buttons send. It needs no tab, it is roughly
 * three times faster, and — because it never touches the DOM — it cannot be
 * broken by a markup change.
 *
 * `dom` is the original: it drives the user's own visible tab, clicking the
 * page the way a person would. It is kept as the fallback for the day LinkedIn
 * changes the query id or the patch shape, because a page a human can click is
 * the one thing that cannot go stale.
 */
export const UNFOLLOW_MODES = Object.freeze(['api', 'dom']);
export const UNFOLLOW_MODE_DEFAULT = 'api';

/**
 * Which list a run works through.
 *
 * `following` is LinkedIn's own Following list, and it is the default because
 * it is what every earlier build did. `everyone` adds a second pass over your
 * *followers*, because connections are followed automatically when you connect
 * and never appear on the Following list at all — so a list that reads zero
 * can still leave a feed full of posts. The followers list is the only read
 * that carries each person's follow state, which is why it takes a scan rather
 * than a count.
 *
 * It is API-only: there is no followers page with an Unfollow button on it to
 * click, so `mode: 'dom'` answers for the Following list whatever the scope
 * says.
 */
export const UNFOLLOW_SCOPES = Object.freeze(['following', 'everyone']);
export const UNFOLLOW_SCOPE_DEFAULT = 'following';
export const UNFOLLOW_SCOPE_EVERYONE = 'everyone';

/**
 * How hard a run pushes.
 *
 * `careful` is one request at a time with a 0.8–1.6 s gap — the default, and
 * the one to use. `fast` runs three streams over the same list at 0.5–0.9 s
 * each, so about four unfollows a second: several times quicker, and several
 * times more likely to be the thing LinkedIn rate-limits.
 */
export const UNFOLLOW_SPEEDS = Object.freeze(['careful', 'fast']);
export const UNFOLLOW_SPEED_DEFAULT = 'careful';
export const UNFOLLOW_SPEED_FAST = 'fast';

/**
 * The one phase an `unfollow_progress` event ever names.
 *
 * With it, `done` and `total` are followers read out of followers there are;
 * without it, they are people unfollowed out of people to unfollow. A reader
 * that ignores `phase` would show a scan of 9,479 as an unfollow of 9,479.
 */
export const UNFOLLOW_PHASE_SCANNING = 'scanning';

/**
 * Why a run ended.
 *
 * `cancelled` is `network.unfollowStop` — the person pressed Stop — and is
 * deliberately distinct from `error`: nothing went wrong, and the names
 * already unfollowed are still reported.
 */
export const UNFOLLOW_STOPPED = Object.freeze(['limit', 'end', 'error', 'cancelled']);

/** Floors and ceilings that are not part of HARD_CAPS but are still enforced. */
const MIN_DELAY_MS = 3000;
const MAX_HOURLY_CAP = 50;

export const DEFAULT_CONFIG = {
  minDelayMs: 5000,
  maxDelayMs: 10000,
  hourlyCap: 30,
  dailyInviteCap: 25,
  weeklyInviteCap: 150,
  dailyMessageCap: 40,
  dailyVisitCap: 120,
  dailySearchCap: 500,
  businessHoursOnly: true,
  businessStart: 9,
  businessEnd: 19,
  businessStartTime: '09:00',
  businessEndTime: '19:00',
  weekdaysOnly: true,
  autopilot: false,
  accountPreset: 'free',
  warmup: { enabled: false, days: 14 },
  humanPacing: true,
  autoWithdraw: { enabled: true, olderThanDays: 14, maxPerRun: 15 },
  dedupeAcrossCampaigns: true,
  ai: { provider: 'none' },
  enrichment: { provider: 'none' },
  bridge: { enabled: true, port: 47829, token: '8824d1f6b5220b57550a33f124e346f8' },
  mailbox: { connected: false, email: '', mode: 'workspace' },
  googleWorkspace: {
    connected: false,
    email: '',
    spreadsheetId: '',
    spreadsheetUrl: '',
    lastSyncAt: 0,
    lastBackupAt: 0,
  },
  telegram: {
    enabled: false,
    botToken: '',
    chatId: '',
    status: 'disconnected',
    lastSyncAt: 0,
    bookingLink: '',
  },
};

const ACCOUNT_PRESETS = ['free', 'premium', 'salesnav', 'recruiter'];
const AI_PROVIDERS = ['none', 'groq', 'gemini', 'openai', 'anthropic', 'ollama', 'openai-compatible'];
const ENRICHMENT_PROVIDERS = ['none', 'hunter', 'apollo', 'waterfall'];

/* ================================================================== */
/*  Errors and envelopes                                              */
/* ================================================================== */

export class EngineError extends Error {
  /**
   * @param {string} code one of ERROR
   * @param {string} message human-readable
   * @param {object} [extra] extra error fields (retryAfter, howToFix, …)
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.extra = extra || {};
  }
}

/** Success envelope. `rateLimit` is omitted entirely when not supplied. */
export function ok(id, data, rateLimit) {
  const envelope = { id, ok: true, data };
  if (rateLimit !== undefined && rateLimit !== null) envelope.rateLimit = rateLimit;
  return envelope;
}

/** Error envelope. `extra` is folded into `error` (retryAfter, howToFix, …). */
export function err(id, code, message, extra) {
  return { id, ok: false, error: { code, message, ...(extra || {}) } };
}

/* ================================================================== */
/*  Param validation                                                  */
/* ================================================================== */

/**
 * Declarative per-action parameter specs.
 *
 *   required : { field: 'string'|'number'|'boolean'|'array'|'object' }
 *   optional : same shape
 *   enums    : { field: [allowed, …] }
 *   min      : { field: floor }    (numeric, inclusive)
 *   max      : { field: ceiling }  (numeric, inclusive)
 *   maxLength: { field: ceiling }  (string length, inclusive)
 *   fix      : { field: howToFix } (advice attached when that field is refused)
 *   anyOf    : [field, …]          (at least one must be present)
 */
const PARAM_SPECS = {
  [ACTIONS.STATUS_GET]: {
    // `verify` runs the endpoint self-check; `postUrl` opts the reactions
    // endpoint into it. Both are optional, and both have to be declared here
    // or a caller asking for them gets a plain Status and no explanation.
    optional: { verify: 'boolean', postUrl: 'string' },
  },

  [ACTIONS.CONFIG_GET]: {},
  [ACTIONS.CONFIG_SET]: {},

  [ACTIONS.SEARCH_PEOPLE]: {
    required: { keywords: 'string' },
    optional: {
      title: 'string',
      company: 'string',
      location: 'string',
      source: 'string',
      start: 'number',
      count: 'number',
    },
    enums: { source: ['search', 'salesnav', 'recruiter'] },
    max: { count: 100 },
  },

  [ACTIONS.PROFILE_GET]: {
    optional: { url: 'string', publicId: 'string', full: 'boolean' },
    anyOf: ['url', 'publicId'],
  },
  [ACTIONS.PROFILE_EXPORT]: {
    required: { urls: 'array' },
    optional: { full: 'boolean' },
  },

  [ACTIONS.COMPANY_GET]: {
    optional: { url: 'string', universalName: 'string' },
    anyOf: ['url', 'universalName'],
  },
  [ACTIONS.COMPANY_EMPLOYEES]: {
    required: { universalName: 'string' },
    optional: { start: 'number', count: 'number' },
  },

  [ACTIONS.POST_ENGAGERS]: {
    required: { postUrl: 'string', kind: 'string' },
    optional: { start: 'number', count: 'number' },
    enums: { kind: ['likes', 'comments', 'both'] },
  },
  [ACTIONS.GROUP_MEMBERS]: {
    required: { groupUrl: 'string' },
    optional: { start: 'number', count: 'number' },
  },
  [ACTIONS.EVENT_ATTENDEES]: {
    required: { eventUrl: 'string' },
    optional: { start: 'number', count: 'number' },
  },

  [ACTIONS.NETWORK_CONNECTIONS]: { optional: { start: 'number', count: 'number' } },
  [ACTIONS.NETWORK_FOLLOWERS]: { optional: { start: 'number', count: 'number' } },
  [ACTIONS.NETWORK_STATUS]: { required: { publicIds: 'array' } },
  [ACTIONS.NETWORK_UNFOLLOW_COUNT]: {
    optional: { mode: 'string', scope: 'string' },
    enums: { mode: UNFOLLOW_MODES, scope: UNFOLLOW_SCOPES },
  },
  // `limit` is the safety rail: run it on one person first, then five, and
  // only then trust it with everything. `dryRun` walks the same list and
  // unfollows nobody, so the names can be read before anything is undoable.
  // `scope` adds the followers list as a second source; `speed` trades the
  // one-at-a-time pace for three streams.
  [ACTIONS.NETWORK_UNFOLLOW_ALL]: {
    optional: {
      limit: 'number',
      dryRun: 'boolean',
      mode: 'string',
      scope: 'string',
      speed: 'string',
    },
    enums: { mode: UNFOLLOW_MODES, scope: UNFOLLOW_SCOPES, speed: UNFOLLOW_SPEEDS },
    min: { limit: UNFOLLOW_LIMIT_MIN },
    max: { limit: UNFOLLOW_LIMIT_MAX },
    fix: { limit: UNFOLLOW_LIMIT_FIX },
  },
  [ACTIONS.NETWORK_UNFOLLOW_STOP]: {},
  [ACTIONS.NETWORK_UNFOLLOW_STATUS]: {},
  [ACTIONS.NETWORK_WITHDRAW_STALE_INVITES]: {
    optional: { olderThanDays: 'number', maxCount: 'number' },
  },

  [ACTIONS.OUTREACH_VIEW]: { required: { publicId: 'string' } },
  [ACTIONS.OUTREACH_FOLLOW]: { required: { publicId: 'string' } },
  [ACTIONS.OUTREACH_INVITE]: {
    required: { publicId: 'string' },
    optional: { note: 'string', dryRun: 'boolean' },
    // Refusing an over-long note here means the caller is told before a quota
    // unit is spent and before LinkedIn is asked to do anything.
    maxLength: { note: INVITE_NOTE_MAX },
    fix: { note: INVITE_NOTE_FIX },
  },
  [ACTIONS.OUTREACH_MESSAGE]: {
    required: { publicId: 'string', body: 'string' },
    optional: { dryRun: 'boolean' },
  },
  [ACTIONS.OUTREACH_INMAIL]: {
    required: { publicId: 'string', subject: 'string', body: 'string' },
    optional: { dryRun: 'boolean' },
  },
  [ACTIONS.OUTREACH_LIKE]: {
    required: { postUrl: 'string' },
    optional: { dryRun: 'boolean' },
  },
  [ACTIONS.OUTREACH_COMMENT]: {
    required: { postUrl: 'string', body: 'string' },
    optional: { dryRun: 'boolean' },
  },
  [ACTIONS.OUTREACH_EMAIL]: {
    required: { subject: 'string', body: 'string' },
    optional: { publicId: 'string', email: 'string', to: 'string', dryRun: 'boolean' },
  },
  [ACTIONS.OUTREACH_ENDORSE]: {
    required: { publicId: 'string' },
    optional: { skillUrn: 'string', dryRun: 'boolean' },
  },

  [ACTIONS.GMAIL_CONNECT]: {
    optional: { interactive: 'boolean' },
  },
  [ACTIONS.GMAIL_DISCONNECT]: {},
  [ACTIONS.GMAIL_STATUS]: {},
  [ACTIONS.GMAIL_TEST]: {
    optional: { to: 'string' },
  },

  [ACTIONS.INBOX_THREADS]: {
    optional: { since: 'number', unreadOnly: 'boolean', count: 'number' },
  },
  [ACTIONS.INBOX_MESSAGES]: {
    required: { threadId: 'string' },
    optional: { since: 'number' },
  },
  [ACTIONS.INBOX_EXPORT]: { optional: { since: 'number' } },

  [ACTIONS.LIST_CREATE]: {
    required: { name: 'string' },
    optional: { tags: 'array' },
  },
  [ACTIONS.LIST_GET_ALL]: {},
  [ACTIONS.LIST_GET]: { required: { listId: 'string' } },
  [ACTIONS.LIST_ADD]: {
    required: { listId: 'string' },
    optional: { profiles: 'array', publicIds: 'array' },
    anyOf: ['profiles', 'publicIds'],
  },
  [ACTIONS.LIST_REMOVE]: { required: { listId: 'string', publicIds: 'array' } },
  [ACTIONS.LIST_MEMBERS]: {
    required: { listId: 'string' },
    optional: { start: 'number', count: 'number' },
  },
  [ACTIONS.LIST_DELETE]: { required: { listId: 'string' } },
  [ACTIONS.LIST_IMPORT_CSV]: { required: { listId: 'string', csv: 'string' } },
  [ACTIONS.LIST_UPDATE]: {
    required: { listId: 'string' },
    optional: { name: 'string', tags: 'array' },
  },

  [ACTIONS.CAMPAIGN_CREATE]: {
    required: { name: 'string', steps: 'array' },
    optional: {
      listId: 'string',
      publicIds: 'array',
      settings: 'object',
      sheetWebhookUrl: 'string',
      sheetUrl: 'string',
    },
  },
  [ACTIONS.CAMPAIGN_GET_ALL]: {},
  [ACTIONS.CAMPAIGN_GET]: { required: { campaignId: 'string' } },
  [ACTIONS.CAMPAIGN_ENROLL]: { required: { campaignId: 'string', publicIds: 'array' } },
  [ACTIONS.CAMPAIGN_PAUSE]: { required: { campaignId: 'string' } },
  [ACTIONS.CAMPAIGN_RESUME]: { required: { campaignId: 'string' } },
  [ACTIONS.CAMPAIGN_DELETE]: { required: { campaignId: 'string' } },
  [ACTIONS.CAMPAIGN_TICK]: {},

  [ACTIONS.QUEUE_LIST]: {
    optional: { status: 'string' },
    // `failed` is a status the queue actually writes, so it has to be a status
    // the queue can be asked for; without it there was no way to list the
    // items that did not send.
    enums: { status: ['pending', 'approved', 'rejected', 'sent', 'failed'] },
  },
  [ACTIONS.QUEUE_APPROVE]: {
    required: { ids: 'array' },
    optional: { edits: 'object' },
  },
  [ACTIONS.QUEUE_REJECT]: { required: { ids: 'array' } },

  [ACTIONS.AI_COMPLETE]: {
    required: { task: 'string', input: 'object' },
    enums: { task: ['opener', 'summary', 'sentiment', 'comment', 'score'] },
  },

  [ACTIONS.EXPORT_CSV]: {
    required: { kind: 'string' },
    optional: { id: 'string' },
    enums: { kind: ['profiles', 'list', 'campaign', 'inbox'] },
  },

  [ACTIONS.RESEARCH_RESOLVE]: { required: { rows: 'array' } },
  [ACTIONS.RESEARCH_PACK]: {
    required: { rows: 'array' },
    optional: { listName: 'string', enrich: 'boolean', full: 'boolean' },
  },
  [ACTIONS.RESEARCH_GET]: { required: { jobId: 'string' } },

  [ACTIONS.SYNC_PULL]: { optional: { since: 'number' } },

  [ACTIONS.BLACKLIST_GET]: {},
  [ACTIONS.BLACKLIST_ADD]: { required: { publicId: 'string' } },
  [ACTIONS.BLACKLIST_REMOVE]: { required: { publicId: 'string' } },

  [ACTIONS.COMPANY_BLACKLIST_GET]: {},
  [ACTIONS.COMPANY_BLACKLIST_ADD]: { required: { company: 'string' } },
  [ACTIONS.COMPANY_BLACKLIST_REMOVE]: { required: { company: 'string' } },

  [ACTIONS.IMPORT_PROFILE_VIEWERS]: {},
  [ACTIONS.IMPORT_POST_COMMENTERS]: { required: { postUrl: 'string' } },

  [ACTIONS.DASHBOARD_LIVE_STATS]: {},
  [ACTIONS.QUOTA_RESET]: { optional: { kinds: 'array' } },

  [ACTIONS.TELEGRAM_STATUS]: {},
  [ACTIONS.TELEGRAM_TEST]: {
    required: { botToken: 'string', chatId: 'string' },
  },
  [ACTIONS.TELEGRAM_SAVE]: {
    required: { botToken: 'string', chatId: 'string' },
    optional: { enabled: 'boolean', bookingLink: 'string' },
  },

  [ACTIONS.CANDIDATES_GET]: {},
  [ACTIONS.CANDIDATE_SET_ACTIVE]: { required: { idOrSlug: 'string' } },
  [ACTIONS.CANDIDATE_SAVE]: { required: { candidate: 'object' } },
  [ACTIONS.CANDIDATE_DELETE]: { required: { id: 'string' } },
  [ACTIONS.ENRICH_LEAD]: { required: { publicId: 'string' } },

  [ACTIONS.OBJECTIONS_GET]: {},
  [ACTIONS.OBJECTION_SAVE]: { required: { objection: 'object' } },
  [ACTIONS.OBJECTION_DELETE]: { required: { id: 'string' } },
  [ACTIONS.OBJECTION_MATCH_REPLY]: {
    required: { message: 'string' },
    optional: { publicId: 'string', fullName: 'string', company: 'string' },
  },
  [ACTIONS.LEAD_SNOOZE]: {
    required: { publicId: 'string' },
    optional: { days: 'number', note: 'string', fullName: 'string' },
  },
  [ACTIONS.SNOOZED_GET]: {},

  [ACTIONS.GOOGLE_WORKSPACE_CONNECT]: { optional: { interactive: 'boolean' } },
  [ACTIONS.GOOGLE_WORKSPACE_STATUS]: {},
  [ACTIONS.GOOGLE_WORKSPACE_DISCONNECT]: {},
  [ACTIONS.SHEETS_CRM_SYNC_NOW]: {},
  [ACTIONS.BACKUP_EXPORT_JSON]: {},
  [ACTIONS.BACKUP_IMPORT_JSON]: { optional: { snapshot: 'object' } },
  [ACTIONS.BACKUP_DRIVE_SAVE]: {},
  [ACTIONS.BACKUP_DRIVE_RESTORE]: {},
  [ACTIONS.OUTREACH_MAILBOX_SWITCH]: { required: { mode: 'string' }, optional: { email: 'string' } },
};

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function checkType(field, value, expected) {
  const actual = typeOf(value);
  if (expected === 'object') {
    if (actual !== 'object') return `${field} must be an object`;
    return null;
  }
  if (actual !== expected) return `${field} must be a ${expected}`;
  return null;
}

/**
 * Validate params for an action.
 * @returns {{ok: true} | {ok: false, message: string, howToFix?: string}}
 */
export function validateParams(action, params = {}) {
  const spec = Object.prototype.hasOwnProperty.call(PARAM_SPECS, action)
    ? PARAM_SPECS[action]
    : null;
  if (!spec) return { ok: false, message: 'unknown action' };

  const p = params && typeof params === 'object' && !Array.isArray(params) ? params : null;
  if (!p) return { ok: false, message: 'params must be an object' };

  const required = spec.required || {};
  const optional = spec.optional || {};
  const enums = spec.enums || {};
  const min = spec.min || {};
  const max = spec.max || {};
  const maxLength = spec.maxLength || {};
  const fix = spec.fix || {};

  /** A refusal, with the per-field advice when the spec carries any. */
  const refuse = (field, message) =>
    fix[field] ? { ok: false, message, howToFix: fix[field] } : { ok: false, message };

  for (const [field, expected] of Object.entries(required)) {
    if (p[field] === undefined || p[field] === null) {
      return { ok: false, message: `${field} is required` };
    }
    const problem = checkType(field, p[field], expected);
    if (problem) return { ok: false, message: problem };
    if (expected === 'string' && p[field] === '') {
      return { ok: false, message: `${field} must not be empty` };
    }
  }

  for (const [field, expected] of Object.entries(optional)) {
    if (p[field] === undefined || p[field] === null) continue;
    const problem = checkType(field, p[field], expected);
    if (problem) return { ok: false, message: problem };
  }

  for (const [field, allowed] of Object.entries(enums)) {
    if (p[field] === undefined || p[field] === null) continue;
    if (!allowed.includes(p[field])) {
      return { ok: false, message: `${field} must be one of: ${allowed.join(', ')}` };
    }
  }

  for (const [field, floor] of Object.entries(min)) {
    if (p[field] === undefined || p[field] === null) continue;
    if (p[field] < floor) {
      return refuse(field, `${field} must be ${floor} or more`);
    }
  }

  for (const [field, ceiling] of Object.entries(max)) {
    if (p[field] === undefined || p[field] === null) continue;
    if (p[field] > ceiling) {
      return refuse(field, `${field} must be ${ceiling} or less`);
    }
  }

  for (const [field, ceiling] of Object.entries(maxLength)) {
    if (p[field] === undefined || p[field] === null) continue;
    const length = String(p[field]).length;
    if (length > ceiling) {
      return refuse(
        field,
        `${field} must be ${ceiling} characters or fewer (this one is ${length})`,
      );
    }
  }

  if (spec.anyOf && !spec.anyOf.some((f) => p[f] !== undefined && p[f] !== null)) {
    return { ok: false, message: `one of ${spec.anyOf.join(' or ')} is required` };
  }

  return { ok: true };
}

/* ================================================================== */
/*  Config clamping                                                   */
/* ================================================================== */

function toNumber(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function clampInt(value, fallback, min, maxValue) {
  let n = Math.round(toNumber(value, fallback));
  if (typeof min === 'number' && n < min) n = min;
  if (typeof maxValue === 'number' && n > maxValue) n = maxValue;
  return n;
}

/**
 * Merge a partial config over DEFAULT_CONFIG, coerce types and enforce the
 * hard ceilings. Always returns a fresh object; never mutates its input or
 * DEFAULT_CONFIG.
 */
export function clampConfig(cfg = {}) {
  const input = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  const d = DEFAULT_CONFIG;

  const minDelayMs = clampInt(input.minDelayMs, d.minDelayMs, MIN_DELAY_MS);
  const maxDelayMs = clampInt(input.maxDelayMs, d.maxDelayMs, minDelayMs);

  const out = {
    minDelayMs,
    maxDelayMs,
    hourlyCap: clampInt(input.hourlyCap, d.hourlyCap, 0, MAX_HOURLY_CAP),
    dailyInviteCap: clampInt(input.dailyInviteCap, d.dailyInviteCap, 0, HARD_CAPS.dailyInviteCap),
    weeklyInviteCap: clampInt(input.weeklyInviteCap, d.weeklyInviteCap, 0, HARD_CAPS.weeklyInviteCap),
    dailyMessageCap: clampInt(
      input.dailyMessageCap,
      d.dailyMessageCap,
      0,
      HARD_CAPS.dailyMessageCap,
    ),
    dailyVisitCap: clampInt(input.dailyVisitCap, d.dailyVisitCap, 0, HARD_CAPS.dailyVisitCap),
    dailySearchCap: clampInt(input.dailySearchCap, d.dailySearchCap, 0, HARD_CAPS.dailySearchCap),
    businessHoursOnly: toBoolean(input.businessHoursOnly, d.businessHoursOnly),
    businessStart: clampInt(input.businessStart, d.businessStart, 0, 23),
    businessEnd: clampInt(input.businessEnd, d.businessEnd, 0, 24),
    businessStartTime: typeof input.businessStartTime === 'string' && input.businessStartTime.includes(':')
      ? input.businessStartTime
      : (d.businessStartTime || `${String(input.businessStart ?? d.businessStart ?? 9).padStart(2, '0')}:00`),
    businessEndTime: typeof input.businessEndTime === 'string' && input.businessEndTime.includes(':')
      ? input.businessEndTime
      : (d.businessEndTime || `${String(input.businessEnd ?? d.businessEnd ?? 19).padStart(2, '0')}:00`),
    weekdaysOnly: toBoolean(input.weekdaysOnly, d.weekdaysOnly),
    autopilot: toBoolean(input.autopilot, d.autopilot),
    accountPreset: ACCOUNT_PRESETS.includes(input.accountPreset)
      ? input.accountPreset
      : d.accountPreset,
    warmup: { ...d.warmup, ...(input.warmup || {}) },
    ai: { ...d.ai, ...(input.ai || {}) },
    enrichment: { ...d.enrichment, ...(input.enrichment || {}) },
    bridge: { ...d.bridge, ...(input.bridge || {}) },
    telegram: { ...(d.telegram || {}), ...(input.telegram || {}) },
  };

  out.warmup.enabled = toBoolean(out.warmup.enabled, d.warmup.enabled);
  out.warmup.days = clampInt(out.warmup.days, d.warmup.days, 0);
  if (out.warmup.startedAt !== undefined) {
    out.warmup.startedAt = clampInt(out.warmup.startedAt, 0, 0);
  }

  out.autoWithdraw = {
    enabled: toBoolean(input.autoWithdraw?.enabled, d.autoWithdraw.enabled),
    olderThanDays: clampInt(input.autoWithdraw?.olderThanDays, d.autoWithdraw.olderThanDays, 7, 60),
    maxPerRun: clampInt(input.autoWithdraw?.maxPerRun, d.autoWithdraw.maxPerRun, 1, 50),
  };
  out.humanPacing = toBoolean(input.humanPacing, d.humanPacing);
  out.dedupeAcrossCampaigns = toBoolean(input.dedupeAcrossCampaigns, d.dedupeAcrossCampaigns);

  if (!AI_PROVIDERS.includes(out.ai.provider)) out.ai.provider = d.ai.provider;
  if (!ENRICHMENT_PROVIDERS.includes(out.enrichment.provider)) {
    out.enrichment.provider = d.enrichment.provider;
  }

  out.bridge.enabled = toBoolean(out.bridge.enabled, d.bridge.enabled);
  out.bridge.port = clampInt(out.bridge.port, d.bridge.port, 1, 65535);

  out.mailbox = {
    connected: Boolean(input.mailbox && input.mailbox.connected),
    email: (input.mailbox && input.mailbox.email) || '',
    mode: ['workspace', 'custom_gmail', 'disabled'].includes(input.mailbox?.mode)
      ? input.mailbox.mode
      : 'workspace',
  };

  out.googleWorkspace = {
    connected: Boolean(input.googleWorkspace && input.googleWorkspace.connected),
    email: (input.googleWorkspace && input.googleWorkspace.email) || '',
    spreadsheetId: (input.googleWorkspace && input.googleWorkspace.spreadsheetId) || '',
    spreadsheetUrl: (input.googleWorkspace && input.googleWorkspace.spreadsheetUrl) || '',
    lastSyncAt: typeof input.googleWorkspace?.lastSyncAt === 'number' ? input.googleWorkspace.lastSyncAt : 0,
    lastBackupAt: typeof input.googleWorkspace?.lastBackupAt === 'number' ? input.googleWorkspace.lastBackupAt : 0,
  };

  if (input.webhookUrl !== undefined) out.webhookUrl = input.webhookUrl;

  if (out.telegram && typeof out.telegram.bookingLink === 'string') {
    out.telegram.bookingLink = out.telegram.bookingLink.trim();
  }

  return out;
}
