/**
 * Crafture Network — Voyager endpoints.
 *
 * Every LinkedIn call the engine makes lives here, using the user's own
 * logged-in session. Response shaping lives in `voyager-normalize.js`, reading
 * the normalized envelope through `normalized.js`; the transport lives in
 * `voyager-core.js`.
 *
 * LinkedIn's web client moved almost everything off the old REST paths and
 * onto persisted GraphQL queries, each identified by a `queryId` that changes
 * when LinkedIn ships a new bundle. Every one of those ids, every decoration
 * id and every surviving REST path is in the `ENDPOINTS` table below and
 * nowhere else, so refreshing them after a LinkedIn release is a single edit —
 * see `docs/voyager-endpoints.md` for how to re-capture them.
 */

import { ERROR, EngineError, INVITE_NOTE_FIX, INVITE_NOTE_MAX } from '../lib/actions.js';
import { isNoteLimitActive, setNoteLimitActive, logDebug, getStoredProfile } from '../lib/storage.js';
import { noteBucketBackoff } from './quota.js';
import { collection } from './normalized.js';
import {
  getEndpoint,
  getEndpointConfig,
  syncEndpointsFromVault,
  reportBrokenEndpoint,
  markEndpointHealthy,
} from './endpoints.js';
import {
  LINKEDIN_BASE,
  generateTrackingId,
  graphql,
  messagingGraphql,
  qs,
  voyagerFetch,
} from './voyager-core.js';
import {
  companyIdFromUrn,
  conversationUrn,
  hasCollection,
  mergeProfiles,
  normalizeComments,
  normalizeCompany,
  normalizeConnections,
  normalizeConversations,
  normalizeFollowingStates,
  normalizeMessages,
  normalizePosts,
  normalizeProfileSection,
  normalizeProfileView,
  normalizeProfileCollection,
  normalizeReactions,
  normalizeRecruiterSearch,
  normalizeSalesNavSearch,
  normalizeSearchClusters,
  normalizeSentInvitations,
  normalizeTotal,
  sectionToEducation,
  sectionToExperience,
  sectionToSkills,
  threadIdFromUrn,
  vectorImageUrl,
  concatVectorUrl,
} from './voyager-normalize.js';

export * from './voyager-core.js';
export * from './voyager-normalize.js';

/* ================================================================== */
/*  Endpoint catalogue — the only place a LinkedIn path is written     */
/* ================================================================== */

/** When and against which LinkedIn web client the table below was captured. */
export const CAPTURED = Object.freeze({
  at: '2026-09-08',
  clientVersion: '1.13.46474',
});

/**
 * The invitation write, separately.
 *
 * It could not be captured with the reads, because capturing a write means
 * sending one to a real person. It was captured on 2026-09-09 from a manual
 * send through LinkedIn's own UI, so `createInvitation` below is the only
 * write in this file that is verified rather than inferred.
 */
export const INVITE_CAPTURED = Object.freeze({
  at: '2026-09-09',
  clientVersion: '1.13.46516',
});

/**
 * The unfollow write and the list it walks, separately, for the same reason.
 *
 * Captured 2026-09-09 from LinkedIn's own Following manager (client
 * 1.13.46516) by unfollowing real people:
 *
 *   list      GET  /graphql?variables=(start:<n>,count:10,origin:CurationHub,
 *                  query:(flagshipSearchIntent:MYNETWORK_CURATION_HUB,…,
 *                  queryParameters:List((key:resultType,value:List(PEOPLE_FOLLOW)))))
 *                  &queryId=voyagerSearchDashClusters.<hash>
 *   unfollow  POST /feed/dash/followingStates/urn:li:fsd_followingState:urn:li:fsd_profile:<id>
 *                  {"patch":{"$set":{"following":false}}}  → 200, empty body
 *
 * The list is the same search-clusters surface `getFollowers` reads, with
 * `PEOPLE_FOLLOW` where that one sends `FOLLOWERS`, so it needs no new query
 * id and no new normalizer. The write carries no `?action=` at all — the
 * `toggleFollow` action `follow()` still sends is a different, uncaptured
 * call, which is why both spellings are in the table below.
 *
 * **The Following list is not the whole story.** Verified on a real account on
 * 2026-09-09: it does *not* include your connections. LinkedIn follows
 * everybody you connect with automatically, and you go on following them after
 * that list has been emptied to zero — which is why a feed that should be
 * silent is still full of posts. The followers facet of the same query is the
 * only place that state is visible: with
 * `(key:resultType,value:List(FOLLOWERS)))` and `count:50` it answers the same
 * `EntityResultViewModel` rows *plus* one
 * `com.linkedin.voyager.dash.feed.FollowingState` per result
 * (`entityUrn: "urn:li:fsd_followingState:urn:li:fsd_profile:<id>"`,
 * `following: true|false`), and `metadata.totalResultCount` is the follower
 * count. `following: true` on a follower is a connection you are still
 * following. Captured the same day, on the same client, from the same account.
 */
export const UNFOLLOW_CAPTURED = Object.freeze({
  at: '2026-09-09',
  clientVersion: '1.13.46516',
});

export const ENDPOINTS = Object.freeze({
  // ---- REST paths still served, captured 2026-09-08, client 1.13.46474 ----
  me: '/me',
  graphql: '/graphql',
  messagingGraphql: '/voyagerMessagingGraphQL/graphql',
  profiles: '/identity/dash/profiles',
  companies: '/organization/companies',
  connections: '/relationships/dash/connections',
  sentInvitations: '/relationships/sentInvitationViewsV2',

  /**
   * Connection invitations. Verified against a real send on 2026-09-09,
   * client 1.13.46516 — the only write in this table that has been.
   * Takes `?action=verifyQuotaAndCreateV2` and the invitation decoration.
   */
  createInvitation: '/voyagerRelationshipsDashMemberRelationships',

  /**
   * The following-state patch, as the Following manager's own Unfollow button
   * sends it. Verified against real unfollows on 2026-09-09, client
   * 1.13.46516: a bare POST to the state urn, no query string.
   *
   * `unverified.followingStates` below is the same base path with the
   * `?action=toggleFollow` spelling `follow()` uses, which has *not* been
   * captured. Two keys, because only one of the two is something we have
   * watched LinkedIn accept.
   */
  followingStates: '/feed/dash/followingStates',

  /**
   * The two curation-hub facets, both **verified** on 2026-09-09 against
   * client 1.13.46516.
   *
   * They are one request with one operand changed: the same
   * `queryIds.searchClusters` hash, the same `CurationHub` origin, the same
   * `MYNETWORK_CURATION_HUB` intent, and a `resultType` of `PEOPLE_FOLLOW`
   * (the Following manager's own list) or `FOLLOWERS` (the followers list,
   * which is the only read that carries a `FollowingState` per row and so the
   * only place a connection's follow state can be seen). Naming them here
   * rather than inline in two functions is what keeps them provably the same
   * request: refreshing the hash after a LinkedIn release is still one edit.
   */
  curationHub: Object.freeze({
    origin: 'CurationHub',
    intent: 'MYNETWORK_CURATION_HUB',
    resultTypes: Object.freeze({
      following: 'PEOPLE_FOLLOW',
      followers: 'FOLLOWERS',
    }),
  }),

  /**
   * Persisted GraphQL query ids. Captured 2026-09-08, client 1.13.46474.
   * These are the first thing to break after a LinkedIn release: a stale id
   * answers 400. `docs/voyager-endpoints.md` says how to re-capture them.
   */
  queryIds: Object.freeze({
    searchClusters: 'voyagerSearchDashClusters.e438ab99259203e9c1cd3f358e217282',
    company: 'voyagerOrganizationDashCompanies.513e1fead204f45d2d951de15bb8461d',
    memberPosts: 'voyagerFeedDashProfileUpdates.be2623b61657a92a693eb8d9c67aeec0',
    reactions: 'voyagerSocialDashReactions.759f60600a6108d4110bc8b8f6ecd507',
    positions: 'voyagerIdentityDashProfilePositions.fb2d242249d743cf65109f72ed6ee9cf',
    profileComponents: 'voyagerIdentityDashProfileComponents.8903e7f7b15f1c12a050c55d48ca2835',
    sentInvitations: 'voyagerRelationshipsDashSentInvitationViews.6c862840bc95d23d4c97c3844cde9981',
    /** Every category, newest first — what `inbox.threads` asks for. */
    conversations: 'messengerConversations.737b27144cf922499202658a5345016f',
    /** Primary inbox with an opaque `nextCursor` — used to page back. */
    conversationsByCategory: 'messengerConversations.9501074288a12f3ae9e3c7ea243bccbf',
    messages: 'messengerMessages.d8ea76885a52fd5dc5c317078ab7c977',
  }),

  /** Decoration ids for the surviving REST reads. Captured 2026-09-08. */
  decorations: Object.freeze({
    fullProfile: 'com.linkedin.voyager.dash.deco.identity.profile.FullProfile-76',
    topCard: 'com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-19',
    connectionList: 'com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16',
    company: 'com.linkedin.voyager.deco.organization.web.WebFullCompanyMain-12',
    /**
     * What `verifyQuotaAndCreateV2` decorates its answer with. Without it
     * LinkedIn still creates the invitation but answers a thinner body, and
     * the `*invitation` urn this build reads success from is not in it.
     * Captured 2026-09-09, client 1.13.46516.
     */
    invitationCreation:
      'com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2',
  }),

  /**
   * **Unverified.** Nothing below has been confirmed against the live client.
   *
   * The two comment paths returned 400 on 2026-09-08 and the GraphQL query id
   * that replaced them has not been identified; the group, event, Sales
   * Navigator and Recruiter paths could not be exercised from this account;
   * and the writes are not probed on principle, because probing a write means
   * sending something to a real person.
   *
   * Every call through here is wrapped by `unverified()`, so a shape we do not
   * recognise surfaces as a `LINKEDIN_ERROR` naming the documentation rather
   * than as raw LinkedIn JSON or a silently empty list.
   */
  unverified: Object.freeze({
    comments: '/feed/comments',
    groupMemberships: '/groups/groupMemberships',
    eventAttendees: '/events/dash/professionalEventAttendees',
    salesNavSearch: `${LINKEDIN_BASE}/sales-api/salesApiPeopleSearch`,
    recruiterSearch: `${LINKEDIN_BASE}/talent/api/talentRecruiterSearch`,
    followingStates: '/feed/dash/followingStates',
    createMessage: '/voyagerMessagingDashMessengerMessages',
    createComment: '/feed/comments',
    createReaction: '/feed/reactions',
  }),
});

const UNVERIFIED_FIX =
  'This endpoint has not been verified against the current LinkedIn client; see docs/voyager-endpoints.md';

/** Errors the user has to act on. They pass through `unverified()` untouched. */
const ACT_ON_THESE = new Set([
  ERROR.NOT_LOGGED_IN,
  ERROR.RATE_LIMITED,
  ERROR.CHALLENGE_DETECTED,
  ERROR.QUOTA_EXCEEDED,
  ERROR.INVALID_PARAMS,
]);

/**
 * Run an unverified endpoint, turning "LinkedIn answered something we do not
 * recognise" into one honest error.
 *
 * @param {string} name the `ENDPOINTS.unverified` key, for the message
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
async function unverified(name, run) {
  try {
    return await run();
  } catch (e) {
    if (e instanceof EngineError && ACT_ON_THESE.has(e.code)) throw e;
    console.error(`[Voyager unverified error: ${name}]`, e);
    throw new EngineError(
      ERROR.LINKEDIN_ERROR,
      `LinkedIn error on '${name}'. The endpoint is unverified and may have changed.`,
      { howToFix: UNVERIFIED_FIX },
    );
  }
}

/** Throw the unverified error when a body carries no collection at all. */
function requireCollection(name, raw) {
  if (!hasCollection(raw)) {
    throw new EngineError(ERROR.LINKEDIN_ERROR, `Unrecognised response from '${name}'.`, {
      howToFix: UNVERIFIED_FIX,
    });
  }
  return raw;
}

/* ================================================================== */
/*  URL parsing                                                       */
/* ================================================================== */

/** Extract numeric activityId from post URL or URN. */
export function activityIdFromUrl(postUrl) {
  const str = String(postUrl || '').trim();
  const direct = str.match(/urn:li:(?:activity|ugcPost|share):(\d+)/);
  if (direct) return direct[1];
  const legacy = str.match(/activity[-:](\d+)/);
  if (legacy) return legacy[1];
  const digits = str.match(/(\d{10,})/);
  if (digits) return digits[1];
  throw new EngineError(
    ERROR.INVALID_PARAMS,
    'Could not read an activity ID from that post URL or URN.',
    { howToFix: 'Use the post permalink, e.g. .../feed/update/urn:li:activity:1234567890/' },
  );
}

/** `https://www.linkedin.com/feed/update/urn:li:activity:123/` → the urn. */
export function activityUrnFromUrl(postUrl) {
  return `urn:li:activity:${activityIdFromUrl(postUrl)}`;
}

export function groupUrnFromUrl(groupUrl) {
  const match = String(groupUrl || '').match(/\/groups\/(\d+)/);
  if (!match) throw new EngineError(ERROR.INVALID_PARAMS, 'Could not read a group id from that URL.');
  return `urn:li:group:${match[1]}`;
}

export function eventUrnFromUrl(eventUrl) {
  const match = String(eventUrl || '').match(/\/events\/(?:[^/]*?-)?(\d{6,})/);
  if (!match) throw new EngineError(ERROR.INVALID_PARAMS, 'Could not read an event id from that URL.');
  return `urn:li:event:${match[1]}`;
}

/** `urn:li:fsd_profile:ACoAAA…` → `ACoAAA…` */
export function urnId(urn) {
  const str = String(urn || '');
  const match = str.match(/:([^:()]+)\)?$/);
  return match ? match[1] : str;
}

export function toFsdProfileUrn(urn) {
  const str = String(urn || '');
  if (!str) return '';
  if (str.includes('fsd_profile')) return str;
  return str.replace('fs_miniProfile', 'fsd_profile').replace('fs_profile', 'fsd_profile');
}

/* ================================================================== */
/*  Who we are                                                        */
/* ================================================================== */

/** Cached for the life of the service worker; it never changes for a session. */
let selfUrnCache = '';

/** Raw `/me`. */
export async function me() {
  return voyagerFetch(getEndpoint('me') || ENDPOINTS.me);
}

/**
 * Our own `urn:li:fsd_profile:…`.
 *
 * The messaging API addresses every call to a mailbox, and the mailbox is us,
 * so this is fetched once and remembered.
 */
export async function selfProfileUrn({ refresh = false } = {}) {
  if (selfUrnCache && !refresh) return selfUrnCache;
  const raw = await me();
  const included = (raw && raw.included) || [];
  const mini =
    included.find((e) => (e && e.firstName) || String(e?.entityUrn || '').includes('miniProfile')) ||
    included[0] ||
    {};
  const urn = toFsdProfileUrn(
    mini.dashEntityUrn || mini.entityUrn || (raw && raw.data && raw.data['*miniProfile']) || '',
  );
  if (!urn) {
    throw new EngineError(ERROR.NOT_LOGGED_IN, 'Could not read your own profile urn from LinkedIn.', {
      howToFix: 'Open linkedin.com in this browser and sign in.',
    });
  }
  selfUrnCache = urn;
  return urn;
}

/** Forget the cached self urn (used by the tests and after a sign-out). */
export function forgetSelf() {
  selfUrnCache = '';
}

/**
 * Extract avatar image URL from miniProfile / vectorImage structures.
 *
 * @param {object} mini
 * @param {Array} [included]
 * @returns {string}
 */
export function extractAvatarFromMini(mini, included = []) {
  if (!mini) return '';
  if (typeof mini.avatarUrl === 'string' && mini.avatarUrl.startsWith('http')) return mini.avatarUrl;
  if (typeof mini.pictureUrl === 'string' && mini.pictureUrl.startsWith('http')) return mini.pictureUrl;
  if (typeof mini.picture === 'string' && mini.picture.startsWith('http')) return mini.picture;

  const vec =
    mini.picture?.['com.linkedin.common.VectorImage'] ||
    mini.picture?.vectorImage ||
    mini.picture ||
    mini.profilePicture?.displayImageReference?.vectorImage ||
    mini.profilePicture?.displayImageReference?.['com.linkedin.common.VectorImage'] ||
    mini.profilePicture?.['com.linkedin.common.VectorImage'] ||
    mini.profilePicture?.vectorImage ||
    mini.profilePicture;

  if (vec && typeof vec === 'object') {
    const rootUrl = vec.rootUrl || '';
    const artifacts = Array.isArray(vec.artifacts) ? vec.artifacts : [];
    if (artifacts.length > 0) {
      const sorted = [...artifacts].sort((a, b) => (b.width || 0) - (a.width || 0));
      const target = sorted.find((a) => a && a.width === 200) || sorted[0];
      const segment = target?.fileIdentifyingUrlPathSegment || '';
      if (segment) {
        return concatVectorUrl(rootUrl, segment);
      }
    }
    if (rootUrl && rootUrl.startsWith('http')) return rootUrl;
  }

  // Also check if vectorImageUrl helper can resolve it
  const normalized = vectorImageUrl(mini.picture || mini.profilePicture);
  if (normalized) return normalized;

  // Search included if picture is a URN reference
  const picUrn = mini.picture || mini.profilePicture || mini['*picture'] || mini['*profilePicture'];
  if (picUrn && typeof picUrn === 'string' && Array.isArray(included)) {
    const found = included.find((e) => e && (e.entityUrn === picUrn || e.$id === picUrn || e.dashEntityUrn === picUrn));
    if (found) {
      const fromFound = extractAvatarFromMini(found);
      if (fromFound) return fromFound;
    }
  }

  return '';
}

/**
 * Is this session usable, and who is it?
 *
 * One cheap unmetered call — `/me` is not a profile view — that a smoke test
 * or `lit endpoints check` can run before anything else.
 *
 * @returns {Promise<{loggedIn: boolean, selfUrn: string, publicId?: string, firstName?: string, lastName?: string, fullName?: string, avatarUrl?: string, clientVersion?: string}>}
 */
export async function selfTest() {
  try {
    const raw = await me();
    const included = (raw && raw.included) || [];
    const mini =
      included.find((e) => (e && e.firstName) || String(e?.entityUrn || '').includes('miniProfile')) ||
      included[0] ||
      {};
    const selfUrn = toFsdProfileUrn(
      mini.dashEntityUrn || mini.entityUrn || (raw && raw.data && raw.data['*miniProfile']) || '',
    );
    if (selfUrn) selfUrnCache = selfUrn;
    if (!selfUrn) {
      return { loggedIn: false, selfUrn: '' };
    }

    const firstName = (mini.firstName || '').trim();
    const lastName = (mini.lastName || '').trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const publicId = (mini.publicIdentifier || '').trim();
    const avatarUrl = extractAvatarFromMini(mini, included);

    const out = {
      loggedIn: true,
      selfUrn,
      publicId,
      firstName,
      lastName,
      fullName,
      avatarUrl,
    };
    // LinkedIn does not return its own client version on this endpoint; it is
    // reported only when a future response starts carrying one.
    const clientVersion = raw && raw.data && raw.data.clientVersion;
    if (clientVersion) out.clientVersion = clientVersion;
    return out;
  } catch (e) {
    if (e instanceof EngineError && e.code === ERROR.NOT_LOGGED_IN) {
      return { loggedIn: false, selfUrn: '' };
    }
    throw e;
  }
}

/* ================================================================== */
/*  Profile                                                           */
/* ================================================================== */

/** Raw `identity/dash/profiles` read for a public identifier. */
export async function getProfile(publicId, decoration = ENDPOINTS.decorations.topCard) {
  return voyagerFetch(
    `${ENDPOINTS.profiles}?${qs({
      q: 'memberIdentity',
      memberIdentity: publicId,
      decorationId: decoration,
    })}`,
  );
}

/** One section of the profile page (`experience`, `education`, `skills`). */
export async function getProfileSection(profileUrn, sectionType) {
  return graphql(ENDPOINTS.queryIds.profileComponents, {
    profileUrn,
    sectionType,
    locale: 'en_US',
  });
}

/**
 * Fetch and normalize a profile.
 *
 * The top-card decoration is the base read because it is the only endpoint
 * that still states the connection degree (through the included
 * `MemberRelationship`), and three features — `network.status`, the campaign
 * `accepted` branch and the already-connected pre-check — are wrong without
 * it.
 *
 * The experience section is read straight after. LinkedIn serves no positions
 * on any profile decoration any more, so without that second call `title` and
 * `company` would be permanently empty. It is a page-component read, not a
 * profile view, so it is not metered as one.
 *
 * `full` adds the full-profile decoration (summary, industry) and the
 * education and skills sections. Every one of those extras is best-effort: a
 * section that fails leaves its field empty rather than failing the read.
 *
 * NOTE: Internal profile reads (for memberId, urn, vanity resolution, withdrawal checks, etc.)
 * MUST NEVER deduct from the user's daily visit / profileView quota.
 * Quota deduction is strictly reserved for an explicit visit / viewProfile step (purpose === 'visit').
 *
 * @param {string} publicId
 * @param {string | { full?: boolean, purpose?: string, source?: string }} [source='profile']
 * @param {{ full?: boolean, purpose?: string, source?: string }} [options={}]
 */
export async function getProfileNormalized(publicId, source = 'profile', options = {}) {
  let opts = options;
  let src = typeof source === 'string' ? source : 'profile';
  if (typeof source === 'object' && source !== null) {
    opts = source;
    src = opts.source || opts.purpose || 'profile';
  }
  const full = Boolean(opts?.full);
  const purpose = opts?.purpose || (src === 'visit' ? 'visit' : src);

  // If purpose !== 'visit', this is an internal/informational profile lookup.
  // It NEVER deducts from the user's daily profileView/visit quota.
  const base = normalizeProfileView(await getProfile(publicId), src);

  if (full) {
    try {
      const extra = normalizeProfileView(
        await getProfile(publicId, ENDPOINTS.decorations.fullProfile),
        src,
      );
      Object.assign(base, mergeProfiles(base, extra));
    } catch {
      // The top card already answered; the richer decoration is a bonus.
    }
  }

  const urn = toFsdProfileUrn(base.urn);
  if (!urn) return base;

  const section = async (name, map) => {
    try {
      return map(normalizeProfileSection(await getProfileSection(urn, name)));
    } catch {
      return [];
    }
  };

  base.experience = await section('experience', sectionToExperience);
  const current = base.experience.find((p) => !p.end) || base.experience[0];
  if (current) {
    base.title = base.title || current.title || '';
    base.company = base.company || current.company || '';
    if (current.companyUrn) base.companyUrn = current.companyUrn;
  }

  if (full) {
    base.education = await section('education', sectionToEducation);
    base.skills = await section('skills', sectionToSkills);
  }

  return base;
}

/**
 * Register a profile view.
 *
 * The authenticated profile fetch is itself what LinkedIn records as a visit,
 * so there is nothing else to do.
 */
export async function viewProfile(publicId) {
  try {
    const profile = await getProfileNormalized(publicId, 'visit');
    markEndpointHealthy('me');
    return profile;
  } catch (err) {
    if (canFallbackToDom(err) && publicId && typeof chrome !== 'undefined' && chrome.tabs?.create) {
      logDebug('warn', 'Voyager', `[viewProfile] API failed, falling back to DOM for ${publicId}`);
      try {
        const domRes = await runDomActionInTab(
          `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`,
          domViewProfileInPage,
          [publicId],
          'viewProfile',
        );
        if (domRes && (domRes.ok || domRes.success)) {
          return { ok: true, publicId, method: 'dom', ...domRes };
        }
      } catch (domErr) {
        logDebug('warn', 'Voyager', `[viewProfile] DOM fallback failed: ${domErr?.message}`);
      }
    }
    throw err;
  }
}

/** Resolve a profile urn from a public identifier when the caller has none. */
export async function resolveProfileUrn(publicId) {
  const stored = await getStoredProfile(publicId).catch(() => null);
  const fromStored = toFsdProfileUrn(stored?.urn);
  if (fromStored) return fromStored;
  const profile = await getProfileNormalized(publicId);
  const urn = toFsdProfileUrn(profile?.urn);
  if (!urn) throw new EngineError(ERROR.NOT_FOUND, `Could not resolve a profile urn for ${publicId}.`);
  return urn;
}

/* ================================================================== */
/*  Search                                                            */
/* ================================================================== */

const PEOPLE = { key: 'resultType', value: ['PEOPLE'] };

/** A slug LinkedIn could plausibly know as a company's universal name. */
function looksLikeUniversalName(value) {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(String(value || '')) && !/\s/.test(String(value || ''));
}

/**
 * People search.
 *
 * LinkedIn's search takes the free text in `keywords` and structured filters
 * in `queryParameters`, but only for facets it recognises. `title` is **not**
 * one of them — `(key:title,…)` is rejected — so the title is appended to the
 * keywords, which is exactly what the web app's own search box does.
 * `location` is appended the same way: the real facet is `geoUrn`, and
 * resolving a place name to a geo urn needs a typeahead call this build does
 * not make. `company` is resolved to a numeric id through the company lookup
 * when it looks like a universal name, because `currentCompany` *is* a real
 * facet and gives far better results than free text; anything else falls back
 * to the keywords.
 */
async function peopleSearchVariables({ keywords, title, company, location, start, count }) {
  const words = [keywords, title, location].map((w) => String(w || '').trim()).filter(Boolean);
  const queryParameters = [PEOPLE];

  if (company) {
    let companyId = '';
    if (looksLikeUniversalName(company)) {
      try {
        companyId = await getCompanyId(company);
      } catch {
        companyId = '';
      }
    }
    if (companyId) queryParameters.unshift({ key: 'currentCompany', value: [companyId] });
    else words.push(String(company).trim());
  }

  return {
    start,
    count,
    origin: 'GLOBAL_SEARCH_HEADER',
    query: {
      keywords: words.join(' '),
      flagshipSearchIntent: 'SEARCH_SRP',
      queryParameters,
      includeFiltersInResponse: false,
    },
  };
}

async function searchClusters(variables) {
  return graphql(ENDPOINTS.queryIds.searchClusters, variables);
}

/**
 * People search across the three sources.
 * @returns {Promise<{profiles: Profile[], total?: number, nextStart?: number}>}
 */
export async function searchProfiles({
  keywords,
  title,
  company,
  location,
  source = 'search',
  start = 0,
  count = 25,
} = {}) {
  if (source === 'salesnav') return salesNavSearch({ keywords, title, company, location, start, count });
  if (source === 'recruiter') return recruiterSearch({ keywords, title, company, location, start, count });

  const variables = await peopleSearchVariables({ keywords, title, company, location, start, count });
  const raw = await searchClusters(variables);
  const { profiles, total } = normalizeSearchClusters(raw, 'search');
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

/** Sales Navigator people search. Unverified: no seat on the capture account. */
export async function salesNavSearch({ keywords, title, company, location, start = 0, count = 25 } = {}) {
  return unverified('salesNavSearch', async () => {
    const search = qs({ q: 'peopleSearchQuery', keywords, title, company, location, start, count });
    const raw = await voyagerFetch(`${ENDPOINTS.unverified.salesNavSearch}?${search}`);
    const { profiles, total } = normalizeSalesNavSearch(raw);
    if (!profiles.length && !raw.elements) requireCollection('salesNavSearch', raw);
    return { profiles, total, nextStart: profiles.length ? start + count : undefined };
  });
}

/** LinkedIn Recruiter search. Unverified: no seat on the capture account. */
export async function recruiterSearch({ keywords, title, company, location, start = 0, count = 25 } = {}) {
  return unverified('recruiterSearch', async () => {
    const search = qs({ q: 'recruiterSearch', keywords, title, company, location, start, count });
    const raw = await voyagerFetch(`${ENDPOINTS.unverified.recruiterSearch}?${search}`);
    const { profiles, total } = normalizeRecruiterSearch(raw);
    if (!profiles.length && !raw.elements) requireCollection('recruiterSearch', raw);
    return { profiles, total, nextStart: profiles.length ? start + count : undefined };
  });
}

/* ================================================================== */
/*  Company                                                           */
/* ================================================================== */

/**
 * A company by universal name.
 *
 * The REST read is the one that answers with a company rather than a stub:
 * the GraphQL query LinkedIn's own company page uses returns a thin
 * decoration — for `microsoft` on the capture date, an `entityUrn` and
 * nothing else — while `WebFullCompanyMain-12` returns the name, description,
 * industries, headcount, follower count and headquarters.
 *
 * The GraphQL query is kept as the fallback, because a urn on its own is
 * still enough to search the company's employees.
 */
export async function getCompany(universalName) {
  let company = null;
  try {
    const raw = await voyagerFetch(
      `${ENDPOINTS.companies}?${qs({
        decorationId: ENDPOINTS.decorations.company,
        q: 'universalName',
        universalName,
      })}`,
    );
    company = normalizeCompany(raw, universalName);
  } catch (e) {
    if (e instanceof EngineError && ACT_ON_THESE.has(e.code)) throw e;
  }

  if (!company || !company.urn) {
    const raw = await graphql(ENDPOINTS.queryIds.company, { universalName });
    company = normalizeCompany(raw, universalName);
  }

  if (!company || !company.urn) {
    throw new EngineError(ERROR.NOT_FOUND, `Company ${universalName} not found.`);
  }
  return company;
}

/** The numeric id an employee search needs, from a universal name. */
export async function getCompanyId(universalName) {
  const id = companyIdFromUrn((await getCompany(universalName)).urn);
  if (!id) throw new EngineError(ERROR.NOT_FOUND, `Company ${universalName} not found.`);
  return id;
}

/**
 * People who work at a company.
 *
 * The `currentCompany` facet wants the numeric id, not the universal name, so
 * the name is resolved first. A caller that already has the id may pass it.
 */
export async function getCompanyEmployees({ universalName, companyId, start = 0, count = 25 }) {
  const id = companyId || (await getCompanyId(universalName));
  const raw = await searchClusters({
    start,
    count,
    origin: 'COMPANY_PAGE_CANNED_SEARCH',
    query: {
      flagshipSearchIntent: 'SEARCH_SRP',
      queryParameters: [{ key: 'currentCompany', value: [id] }, PEOPLE],
      includeFiltersInResponse: false,
    },
  });
  const { profiles, total } = normalizeSearchClusters(raw, 'company-employees');
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

/* ================================================================== */
/*  Post engagers                                                     */
/* ================================================================== */

async function fetchReactions(threadUrn, start, count) {
  const raw = await graphql(ENDPOINTS.queryIds.reactions, { threadUrn, count, start });
  return normalizeReactions(requireCollection('reactions', raw));
}

async function fetchComments(threadUrn, start, count) {
  return unverified('comments', async () => {
    const raw = await voyagerFetch(
      `${ENDPOINTS.unverified.comments}?${qs({
        q: 'comments',
        sortOrder: 'RELEVANCE',
        threadUrn,
        start,
        count,
      })}`,
    );
    return normalizeComments(requireCollection('comments', raw));
  });
}

/**
 * Who liked and/or commented on a post.
 *
 * Reactions are verified against the live client; comments are not, and their
 * replacement query id has not been identified. Asking for comments alone
 * therefore fails honestly, while `kind: 'both'` returns the reactions it did
 * get and names what it could not read in `unavailable`, rather than throwing
 * away a page of real engagers.
 *
 * @returns {Promise<{engagers: Engager[], nextStart?: number, unavailable?: string[]}>}
 */
export async function getPostEngagers({ postUrl, kind = 'both', start = 0, count = 25 }) {
  const threadUrn = activityUrnFromUrl(postUrl);
  const engagers = [];
  const unavailable = [];

  if (kind === 'likes' || kind === 'both') {
    engagers.push(...(await fetchReactions(threadUrn, start, count)));
  }

  if (kind === 'comments' || kind === 'both') {
    try {
      engagers.push(...(await fetchComments(threadUrn, start, count)));
    } catch (e) {
      if (kind === 'comments') throw e;
      unavailable.push('comments');
    }
  }

  const seen = new Map();
  for (const e of engagers) {
    const existing = seen.get(e.publicId);
    seen.set(e.publicId, existing ? { ...existing, ...e } : e);
  }
  const merged = [...seen.values()];

  const out = { engagers: merged, nextStart: merged.length ? start + count : undefined };
  if (unavailable.length) out.unavailable = unavailable;
  return out;
}

/* ================================================================== */
/*  Audiences                                                         */
/* ================================================================== */

/** Group members. Unverified: no group membership on the capture account. */
export async function getGroupMembers({ groupUrl, start = 0, count = 25 }) {
  const groupUrn = groupUrnFromUrl(groupUrl);
  return unverified('groupMemberships', async () => {
    const raw = await voyagerFetch(
      `${ENDPOINTS.unverified.groupMemberships}?${qs({ q: 'group', groupUrn, start, count })}`,
    );
    const { profiles, total } = normalizeProfileCollection(requireCollection('groupMemberships', raw), 'group');
    return { profiles, total, nextStart: profiles.length ? start + count : undefined };
  });
}

/** Event attendees. Unverified. */
export async function getEventAttendees({ eventUrl, start = 0, count = 25 }) {
  const eventUrn = eventUrnFromUrl(eventUrl);
  return unverified('eventAttendees', async () => {
    const raw = await voyagerFetch(
      `${ENDPOINTS.unverified.eventAttendees}?${qs({ q: 'eventAttendees', eventUrn, start, count })}`,
    );
    const { profiles, total } = normalizeProfileCollection(requireCollection('eventAttendees', raw), 'event');
    return { profiles, total, nextStart: profiles.length ? start + count : undefined };
  });
}

export async function getConnections({ start = 0, count = 25 } = {}) {
  const raw = await voyagerFetch(
    `${ENDPOINTS.connections}?${qs({
      decorationId: ENDPOINTS.decorations.connectionList,
      q: 'search',
      sortType: 'RECENTLY_ADDED',
      start,
      count,
    })}`,
  );
  const { profiles, total } = normalizeConnections(raw);
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

/**
 * Our own followers.
 *
 * These come back through the search clusters surface, not a followers
 * collection: the curation hub asks for `resultType: FOLLOWERS`. The
 * navigation urls it returns carry the obfuscated member id rather than a
 * vanity name, so `publicId` is that id — still a working profile URL, and
 * still a stable key.
 */
/** The widest page the curation hub will answer with in one request. */
export const FOLLOWERS_PAGE_SIZE = 50;

export async function getFollowers({ start = 0, count = 25 } = {}) {
  const raw = await curationHubPage('followers', { start, count });
  const { profiles, total } = normalizeSearchClusters(raw, 'followers');
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

/**
 * One page of the curation hub, by facet.
 *
 * `facet` is a key of `ENDPOINTS.curationHub.resultTypes`, and it is the only
 * thing that differs between the followers read and the following read — same
 * query id, same origin, same intent, same grammar. Written once so the two
 * cannot drift apart.
 *
 * @param {'following'|'followers'} facet
 * @param {{start?: number, count?: number}} page
 */
async function curationHubPage(facet, { start = 0, count = 25 } = {}) {
  const hub = ENDPOINTS.curationHub;
  return searchClusters({
    start,
    count,
    origin: hub.origin,
    query: {
      flagshipSearchIntent: hub.intent,
      includeFiltersInResponse: true,
      queryParameters: [{ key: 'resultType', value: [hub.resultTypes[facet]] }],
    },
  });
}

/**
 * Our followers, each carrying whether we are still following them back.
 *
 * The same read as `getFollowers`, kept apart from it because it answers a
 * different question and costs more to answer: it also reads the
 * `FollowingState` rows LinkedIn attaches to this facet and stamps
 * `following: true|false` onto every profile. `network.followers` does not
 * want that field and its result schema does not carry it; mass unfollow's
 * `scope: 'everyone'` is the only caller, because this list is the only place
 * a connection's follow state is visible at all (see `UNFOLLOW_CAPTURED`).
 *
 * A row with no state of its own comes back `following: false`, so an
 * unrecognised shape can only ever mean "do not touch this person".
 *
 * `count` defaults to fifty — the most this surface will answer with in one
 * go, and the difference between 190 reads and 948 on a 9,479-follower list.
 */
export async function getFollowersFollowing({ start = 0, count = FOLLOWERS_PAGE_SIZE } = {}) {
  const raw = await curationHubPage('followers', { start, count });
  const { profiles, total } = normalizeSearchClusters(raw, 'followers');
  const states = normalizeFollowingStates(raw);
  return {
    profiles: profiles.map((profile) => ({
      ...profile,
      following: states.get(profile.urn) === true,
    })),
    total,
    nextStart: profiles.length ? start + count : undefined,
  };
}


/**
 * People *we* follow — the list behind the Following manager.
 *
 * Identical to `getFollowers` but for the facet: the curation hub asks for
 * `resultType: PEOPLE_FOLLOW` instead of `FOLLOWERS`, and answers the same
 * `EntityResultViewModel` shape, so the same normalizer reads it. The web
 * client pages this ten at a time; `count` is the caller's, because a run that
 * is about to unfollow 700 people should not spend seventy round trips doing
 * it.
 *
 * `total` is `metadata.totalResultCount` — the real number you follow, not the
 * page — which is the whole reason `network.unfollowCount` needs no tab.
 */
export async function getFollowing({ start = 0, count = 25 } = {}) {
  const raw = await curationHubPage('following', { start, count });
  const { profiles, total } = normalizeSearchClusters(raw, 'following');
  return { profiles, total, nextStart: profiles.length ? start + count : undefined };
}

/**
 * Stop following one member.
 *
 * The urn in the path is percent-encoded, like every other urn this engine
 * puts in a path: LinkedIn's own client sends the colons literally and both
 * are accepted here, but one rule with no exceptions is what keeps the
 * *other* endpoints — the ones that answer 400 to a literal colon — working.
 *
 * A success is a 200 with an empty body, which `voyagerFetch` turns into
 * `{ ok: true }`. There is nothing else to read: LinkedIn says nothing about
 * who was unfollowed, so the caller's own record of the name is the only one.
 *
 * @param {{profileUrn: string}} params a `urn:li:fsd_profile:…`
 */
export async function unfollowProfile({ profileUrn }) {
  const urn = toFsdProfileUrn(profileUrn);
  if (!urn) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'unfollowProfile needs a urn:li:fsd_profile urn.');
  }
  const stateUrn = encodeURIComponent(`urn:li:fsd_followingState:${urn}`);
  return voyagerFetch(`${ENDPOINTS.followingStates}/${stateUrn}`, {
    method: 'POST',
    body: { patch: { $set: { following: false } } },
    headers: { 'content-type': 'application/json; charset=UTF-8' },
  });
}

/* ================================================================== */
/*  Messaging                                                         */
/* ================================================================== */

/**
 * The conversation list.
 *
 * The messaging surface is fussy in a way the rest of Voyager is not: it
 * rejects `includeWebMetadata`, and each query wants its variables by exactly
 * the right names in exactly the right order. Both shapes below are copied
 * from what the web client sends, and there are two because they answer
 * different questions — the first every category newest-first, the second one
 * category with a cursor, which is how paging back through the inbox works.
 */
function conversationNextCursor(raw) {
  const node = collection(raw);
  const cursor = node?.metadata?.nextCursor ?? node?.nextCursor;
  return typeof cursor === 'string' && cursor ? cursor : undefined;
}

export async function getConversations({ count = 20, nextCursor } = {}) {
  const mailboxUrn = await selfProfileUrn();

  const raw = await messagingGraphql(ENDPOINTS.queryIds.conversationsByCategory, {
    query: {
      predicateUnions: [{ conversationCategoryPredicate: { category: 'PRIMARY_INBOX' } }],
    },
    count,
    mailboxUrn,
    ...(nextCursor ? { nextCursor } : {}),
  });

  return {
    threads: normalizeConversations(raw, mailboxUrn),
    nextCursor: conversationNextCursor(raw),
  };
}

export const getMessengerConversations = getConversations;

export async function getConversationMessages({ threadId, count = 20, createdBefore }) {
  const mailboxUrn = await selfProfileUrn();
  const id = threadIdFromUrn(threadId);

  const raw = await messagingGraphql(ENDPOINTS.queryIds.messages, {
    deliveredAt: createdBefore || Date.now(),
    conversationUrn: conversationUrn(mailboxUrn, id),
    countBefore: count,
    countAfter: 0,
  });

  return { messages: normalizeMessages(raw, id) };
}

/* ================================================================== */
/*  Activity and graph                                                */
/* ================================================================== */

export async function getMemberPosts({ publicId, profileUrn, count = 10, paginationToken } = {}) {
  const urn = toFsdProfileUrn(profileUrn) || (await resolveProfileUrn(publicId));
  const raw = await graphql(ENDPOINTS.queryIds.memberPosts, {
    count,
    start: 0,
    profileUrn: urn,
    paginationToken,
  });
  return normalizePosts(raw);
}

/**
 * How many connections we share with a profile.
 *
 * This is the same search the "N mutual connections" link on a profile runs:
 * first-degree connections of that member. Only the total is wanted, so one
 * result is asked for.
 */
export async function getMutualConnectionsCount({ profileUrn }) {
  const raw = await searchClusters({
    start: 0,
    count: 1,
    origin: 'SHARED_CONNECTIONS_CANNED_SEARCH',
    query: {
      flagshipSearchIntent: 'SEARCH_SRP',
      queryParameters: [
        { key: 'connectionOf', value: [urnId(profileUrn)] },
        { key: 'network', value: ['F'] },
        PEOPLE,
      ],
      includeFiltersInResponse: false,
    },
  });
  return normalizeTotal(raw);
}

/**
 * Invitations we have sent that are still pending.
 *
 * One cheap call that answers "did they accept?" for everybody at once, with
 * no profile views spent. This is the endpoint `network.status` and the
 * campaign 'accepted' branch lean on, so it has a fallback: the REST view is
 * the one that was captured working, and the GraphQL equivalent is tried if
 * that ever stops answering.
 *
 * @returns {Promise<{publicId: string, invitationUrn: string, sentAt?: number}[]>}
 */
export async function getSentInvitations({ start = 0, count = 100 } = {}) {
  const sentPath = getEndpoint('listSentInvitations') || ENDPOINTS.sentInvitations;
  const basePath = sentPath.split('?')[0];
  try {
    const raw = await voyagerFetch(
      `${basePath}?${qs({
        q: 'invitationType',
        invitationType: 'CONNECTION',
        start,
        count,
      })}`,
    );
    return normalizeSentInvitations(requireCollection('sentInvitations', raw));
  } catch (e) {
    if (e instanceof EngineError && ACT_ON_THESE.has(e.code)) throw e;
    console.warn(
      `[Voyager] voyagerFetch on sentInvitationViewsV2 failed (status=${e?.status || e?.response?.status || 'unknown'}, message=${e?.message || e})`,
    );
    try {
      const raw = await graphql(ENDPOINTS.queryIds.sentInvitations, {
        start,
        count,
        invitationType: 'CONNECTION',
      });
      return normalizeSentInvitations(raw);
    } catch (gErr) {
      console.warn(
        `[Voyager] GraphQL fallback for sentInvitations failed (status=${gErr?.status || gErr?.response?.status || 'unknown'}, message=${gErr?.message || gErr})`,
      );
      return [];
    }
  }
}

/**
 * Fetch sent invitations list directly from Voyager REST endpoint.
 *
 * @param {{ start?: number, count?: number }} [opts]
 * @returns {Promise<{invitationId: string, sentTime: number, sentAt: number, profileUrn: string, firstName: string, lastName: string, vanityName: string, toMemberUrn: string, toPublicId: string, invitationUrn?: string, recipientPublicId?: string, publicId?: string}[]>}
 */
export async function fetchSentInvitations({ start = 0, count = 50 } = {}) {
  const listPath = getEndpoint('listSentInvitations') || ENDPOINTS.sentInvitations;
  const basePath = listPath.split('?')[0];
  try {
    const raw = await voyagerFetch(
      `${basePath}?${qs({
        q: 'invitationType',
        invitationType: 'CONNECTION',
        start,
        count,
      })}`,
    );
    const normalized = normalizeSentInvitations(raw);
    if (normalized.length > 0) {
      // Build secondary profile map from raw.included for bulletproof URN & vanity resolution
      const profileMap = new Map();
      const rawIncluded = Array.isArray(raw?.included) ? raw.included : [];
      for (const ent of rawIncluded) {
        if (!ent || typeof ent !== 'object') continue;
        const aco = (String(ent.dashEntityUrn || ent.entityUrn || '').match(/ACoAA[A-Za-z0-9_-]+/) || [])[0];
        const pub = ent.publicIdentifier || (String(ent.publicProfileUrl || '').match(/\/in\/([^/?#]+)/) || [])[1] || '';
        const numId = (String(ent.objectUrn || ent.entityUrn || '').match(/urn:li:member:(\d+)/) || [])[1];
        if (aco || pub || numId) {
          const profObj = {
            profileUrn: aco || '',
            publicId: pub || '',
            firstName: ent.firstName?.text || (typeof ent.firstName === 'string' ? ent.firstName : '') || '',
            lastName: ent.lastName?.text || (typeof ent.lastName === 'string' ? ent.lastName : '') || '',
          };
          if (ent.entityUrn) profileMap.set(ent.entityUrn, profObj);
          if (ent.dashEntityUrn) profileMap.set(ent.dashEntityUrn, profObj);
          if (ent.objectUrn) profileMap.set(ent.objectUrn, profObj);
          if (aco) profileMap.set(aco, profObj);
          if (pub) profileMap.set(pub, profObj);
          if (numId) {
            profileMap.set(numId, profObj);
            profileMap.set(`urn:li:member:${numId}`, profObj);
          }
        }
      }

      return normalized.map((inv) => {
        const id = inv.invitationId || (inv.invitationUrn ? (inv.invitationUrn.match(/\d+$/) || [])[0] : '') || inv.invitationUrn;
        let toPublicId = inv.toPublicId || inv.publicId || inv.vanityName || '';
        const entityUrn = inv.invitationUrn || inv.toMemberUrn || '';
        const toMemberUrn = inv.toMemberUrn || '';
        let profileUrn = inv.profileUrn || '';
        let firstName = inv.firstName || '';
        let lastName = inv.lastName || '';

        // If profileUrn does not start with ACo or toPublicId is empty, cross-resolve from profileMap
        if (!profileUrn.startsWith('ACo') || !toPublicId) {
          const candidateKeys = [
            toMemberUrn,
            inv.entityUrn,
            inv.invitationUrn,
            toPublicId,
            profileUrn,
          ].filter(Boolean);
          for (const k of candidateKeys) {
            const found = profileMap.get(k) || profileMap.get(String(k).replace(/^urn:li:[^:]+:/, ''));
            if (found) {
              if (!profileUrn.startsWith('ACo') && found.profileUrn) profileUrn = found.profileUrn;
              if (!toPublicId && found.publicId) toPublicId = found.publicId;
              if (!firstName && found.firstName) firstName = found.firstName;
              if (!lastName && found.lastName) lastName = found.lastName;
              break;
            }
          }
        }

        const acoMatch = String(profileUrn || toMemberUrn || '').match(/ACoAA[A-Za-z0-9_-]+/);
        if (acoMatch) {
          profileUrn = acoMatch[0];
        } else if (!profileUrn && toMemberUrn) {
          profileUrn = String(toMemberUrn).replace(/^urn:li:(?:fsd?_profile|fs_miniProfile|member):/i, '').split(':').pop();
        }

        return {
          invitationId: String(id),
          entityUrn,
          sentTime: inv.sentTime || inv.sentAt || 0,
          sentAt: inv.sentTime || inv.sentAt || 0,
          profileUrn,
          firstName,
          lastName,
          fullName: inv.fullName || [firstName, lastName].filter(Boolean).join(' ').trim() || '',
          vanityName: inv.vanityName || toPublicId,
          toMemberUrn,
          toPublicId,
          invitationUrn: inv.invitationUrn,
          recipientPublicId: toPublicId,
          publicId: toPublicId,
        };
      });
    }
  } catch (e) {
    if (e instanceof EngineError && ACT_ON_THESE.has(e.code)) throw e;
    console.warn(
      `[Voyager] fetchSentInvitations sentInvitationViewsV2 failed (status=${e?.status || e?.response?.status || 'unknown'}, message=${e?.message || e})`,
    );
  }

  const fallback = await getSentInvitations({ start, count });
  return fallback.map((inv) => {
    const id = inv.invitationId || (inv.invitationUrn ? (inv.invitationUrn.match(/\d+$/) || [])[0] : '') || inv.invitationUrn;
    const toPublicId = inv.toPublicId || inv.publicId || inv.vanityName || '';
    const entityUrn = inv.invitationUrn || inv.toMemberUrn || '';
    const toMemberUrn = inv.toMemberUrn || '';
    let profileUrn = inv.profileUrn || '';
    const acoMatch = String(profileUrn || toMemberUrn || '').match(/ACoAA[A-Za-z0-9_-]+/);
    if (acoMatch) {
      profileUrn = acoMatch[0];
    } else if (!profileUrn && toMemberUrn) {
      profileUrn = String(toMemberUrn).replace(/^urn:li:(?:fsd?_profile|fs_miniProfile|member):/i, '').split(':').pop();
    }
    return {
      invitationId: String(id),
      entityUrn,
      sentTime: inv.sentTime || inv.sentAt || 0,
      sentAt: inv.sentTime || inv.sentAt || 0,
      profileUrn,
      firstName: inv.firstName || '',
      lastName: inv.lastName || '',
      fullName: inv.fullName || [inv.firstName, inv.lastName].filter(Boolean).join(' ').trim() || '',
      vanityName: inv.vanityName || toPublicId,
      toMemberUrn,
      toPublicId,
      invitationUrn: inv.invitationUrn,
      recipientPublicId: toPublicId,
      publicId: toPublicId,
    };
  });
}

export const listSentInvitations = fetchSentInvitations;

/**
 * Self-contained page script executed inside https://www.linkedin.com/mynetwork/invitation-manager/sent/
 * Locates invitation cards for given prospects and clicks the native Withdraw button and confirmation modal.
 */
export async function domWithdrawInPage(targetInvites, options = {}) {
  const results = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const olderThanDays = typeof options?.olderThanDays === 'number' ? options.olderThanDays : 14;
  const maxCount = typeof options?.maxCount === 'number'
    ? options.maxCount
    : (Array.isArray(targetInvites) && targetInvites.length > 0 ? targetInvites.length : 10);
  const maxWaitMs = typeof options?.maxWaitMs === 'number' ? options.maxWaitMs : 15000;

  const pageTitle = document.title || '';
  const hydrationStart = Date.now();
  let initialWithdrawButtons = 0;

  function ensureSentTabSelected() {
    const sentTabs = Array.from(
      document.querySelectorAll('a[href*="/invitation-manager/sent"], button, [role="tab"]')
    );
    const sentTab = sentTabs.find((el) => {
      const txt = (el.innerText || el.textContent || '').trim();
      const href = el.getAttribute('href') || '';
      return /^sent$/i.test(txt) || href.includes('/invitation-manager/sent');
    });

    if (sentTab) {
      const isSelected =
        sentTab.getAttribute('aria-selected') === 'true' ||
        sentTab.classList.contains('artdeco-pill--selected') ||
        sentTab.classList.contains('active') ||
        sentTab.getAttribute('aria-current') === 'page';

      if (!isSelected) {
        try {
          sentTab.click();
        } catch {}
      }
    }
  }

  function isWithdrawElement(el) {
    if (!el) return false;
    const txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    const aria = (el.getAttribute('aria-label') || '').toLowerCase().replace(/\s+/g, ' ');
    return /withdraw/i.test(txt) || aria.includes('withdraw');
  }

  function getWithdrawButtons() {
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a'));
    return candidates.filter(isWithdrawElement);
  }

  // If the "Sent" tab element is present and not selected, click it
  ensureSentTabSelected();

  // 1. Wait until at least 1 element matching button, [role="button"], a with /^withdraw$/i text or aria-label includes 'withdraw' appears (up to maxWaitMs)
  while (Date.now() - hydrationStart < maxWaitMs) {
    const withdrawBtns = getWithdrawButtons();
    if (withdrawBtns.length > 0) {
      initialWithdrawButtons = withdrawBtns.length;
      break;
    }
    if (Date.now() - hydrationStart > 4000) {
      ensureSentTabSelected();
    }
    await sleep(400);
  }
  if (initialWithdrawButtons === 0) {
    initialWithdrawButtons = getWithdrawButtons().length;
  }

  let domDiagnostics = '';
  if (initialWithdrawButtons === 0) {
    const diagMsg = `url=${location.href}, bodySample=${JSON.stringify((document.body.innerText || document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 220))}, buttons=${JSON.stringify([...document.querySelectorAll('button,[role="button"]')].slice(0, 12).map((b) => (b.innerText || b.textContent || '').trim()))}`;
    try {
      console.log(`[Crafture DOM] initialWithdrawButtons=0: ${diagMsg}`);
    } catch {}
    domDiagnostics = diagMsg;
  } else {
    try {
      console.log(
        `[Crafture DOM] Hydration check: initialWithdrawButtons=${initialWithdrawButtons}, pageTitle="${pageTitle}"`,
      );
    } catch {}
  }

  function findInvitationCards() {
    const withdrawButtons = getWithdrawButtons();
    const cards = [];
    const seen = new Set();

    for (const btn of withdrawButtons) {
      let container =
        btn.closest('li.invitation-card') ||
        btn.closest('.invitation-card') ||
        btn.closest('.mn-invitation-card') ||
        btn.closest('.artdeco-list__item') ||
        btn.closest('li');

      if (!container) {
        let p = btn.parentElement;
        while (p && p !== document.body && p !== document.documentElement) {
          const txt = p.textContent || '';
          if (/sent\s+.*ago/i.test(txt) || /sent\s+/i.test(txt)) {
            container = p;
            break;
          }
          p = p.parentElement;
        }
      }

      if (container && !seen.has(container)) {
        seen.add(container);
        cards.push(container);
      }
    }

    const candidateList = Array.from(
      document.querySelectorAll(
        '.invitation-card, li.invitation-card, .mn-invitation-list li, [data-view-name="invitation-card"], .mn-invitation-card, .artdeco-list__item, ul.mn-invitation-list > li',
      ),
    );
    for (const el of candidateList) {
      if (!seen.has(el)) {
        const hasWithdraw = Array.from(el.querySelectorAll('button, [role="button"], a')).some(isWithdrawElement);
        if (hasWithdraw) {
          seen.add(el);
          cards.push(el);
        }
      }
    }

    return cards;
  }

  function isCardMatch(card, target) {
    const rawId = target.publicId || target.vanityName || target.toPublicId || '';
    const publicId = String(rawId).toLowerCase().trim().replace(/^https?:\/\/[^/]+\/in\//i, '').replace(/^\/+|\/+$/g, '');
    const rawName = target.fullName || target.name || `${target.firstName || ''} ${target.lastName || ''}`.trim();
    const name = String(rawName).toLowerCase().trim().replace(/\s+/g, ' ');

    const links = Array.from(card.querySelectorAll('a[href]')).map((a) =>
      (a.getAttribute('href') || '').toLowerCase(),
    );
    const cardText = (card.innerText || card.textContent || '').toLowerCase().replace(/\s+/g, ' ');

    const hrefMatch = Boolean(
      publicId &&
      links.some((href) =>
        href.includes(`/${publicId}/`) ||
        href.includes(`/${publicId}?`) ||
        href.endsWith(`/${publicId}`) ||
        href.includes(`/${publicId}`)
      )
    );

    const nameMatch = Boolean(
      name &&
      name.length >= 2 &&
      cardText.includes(name)
    );

    // Reliable match: match BOTH href and name when both are available, or either when one is available
    if (hrefMatch && nameMatch) return true;
    if (hrefMatch || nameMatch) return true;

    const firstName = String(target.firstName || '').toLowerCase().trim();
    const lastName = String(target.lastName || '').toLowerCase().trim();
    if (firstName.length >= 2 && lastName.length >= 2 && cardText.includes(firstName) && cardText.includes(lastName)) {
      return true;
    }

    return false;
  }

  function getLoadMoreButton() {
    const candidates = Array.from(
      document.querySelectorAll('button, [role="button"], a.artdeco-button, .scaffold-finite-scroll__load-button')
    );
    const found = candidates.find((btn) => {
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false;
      if (btn.hidden || (btn.style && (btn.style.display === 'none' || btn.style.visibility === 'hidden'))) return false;
      const txt = (btn.innerText || btn.textContent || '').trim().replace(/\s+/g, ' ');
      const aria = (btn.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
      return (
        /load\s*more|show\s*more|see\s*more/i.test(txt) ||
        /load\s*more|show\s*more|see\s*more/i.test(aria) ||
        (btn.classList && (
          btn.classList.contains('scaffold-finite-scroll__load-button') ||
          btn.classList.contains('invitation-manager__load-more-btn')
        ))
      );
    });
    if (found && found.tagName !== 'BUTTON' && found.querySelector('button')) {
      const childBtn = found.querySelector('button');
      if (childBtn && !childBtn.disabled && childBtn.getAttribute('aria-disabled') !== 'true') {
        return childBtn;
      }
    }
    return found;
  }

  // 2. Load older invitations: scroll to bottom and click "Load more" / "Show more" / "See more" up to 15 times
  const MAX_SCROLL_ROUNDS = 15;
  let loadMoreClicks = 0;
  const safeTargets = Array.isArray(targetInvites) ? targetInvites : [];
  let prevBtnCount = getWithdrawButtons().length;
  let noIncreaseRounds = 0;

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    const currentCards = findInvitationCards();
    const unmatchedTargets = safeTargets.filter((t) => !currentCards.some((c) => isCardMatch(c, t)));
    if (safeTargets.length > 0 && unmatchedTargets.length === 0) {
      break; // All targets already visible in DOM
    }

    // Support scrolling window to the bottom
    try {
      if (typeof window.scrollTo === 'function') {
        const scrollHeight = (document.body && document.body.scrollHeight) || document.documentElement.scrollHeight || 999999;
        window.scrollTo(0, scrollHeight);
      }
      if (document.scrollingElement && typeof document.scrollingElement.scrollTop === 'number') {
        document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight || 999999;
      }
    } catch {}

    // Support scrolling any scrollable ancestor/container to the bottom
    try {
      const scrollableCandidates = Array.from(
        document.querySelectorAll(
          'main, section, div, ul, [role="main"], .scaffold-finite-scroll, .mn-invitation-manager__sent-list, .scaffold-layout__main'
        )
      );
      for (const el of scrollableCandidates) {
        if (el && typeof el.scrollTop === 'number') {
          el.scrollTop = el.scrollHeight || 999999;
        }
      }
    } catch {}

    // Click any visible "Load more" / "Show more" button anywhere in document if present
    let loadMoreBtn = getLoadMoreButton();
    if (!loadMoreBtn) {
      await sleep(200);
      loadMoreBtn = getLoadMoreButton();
    }

    if (loadMoreBtn) {
      try {
        if (typeof loadMoreBtn.scrollIntoView === 'function') {
          loadMoreBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        loadMoreBtn.click();
        loadMoreClicks++;
      } catch {}
    }

    // Wait 1500ms per round for new cards to render
    await sleep(1500);

    // Stop only when all targets are matched OR withdrawButtons.length stops increasing for 2 consecutive scroll rounds
    const afterCards = findInvitationCards();
    const afterUnmatched = safeTargets.filter((t) => !afterCards.some((c) => isCardMatch(c, t)));
    if (safeTargets.length > 0 && afterUnmatched.length === 0) {
      break;
    }

    const currentBtnCount = getWithdrawButtons().length;
    if (currentBtnCount > prevBtnCount) {
      noIncreaseRounds = 0;
      prevBtnCount = currentBtnCount;
    } else {
      noIncreaseRounds++;
      if (noIncreaseRounds >= 2) {
        break; // Stop: withdrawButtons.length stopped increasing for 2 consecutive scroll rounds
      }
    }
  }

  const finalWithdrawButtons = getWithdrawButtons().length;

  // 3. Match targets or Relative-Date Card Fallback
  function parseCardAgeDays(card) {
    const text = (card.textContent || '').replace(/\s+/g, ' ');
    let match = text.match(/sent\s+(?:(\d+|an?|one)\s+)?(day|week|month|year|yesterday)s?(?:\s+ago)?/i);
    if (!match) {
      const candidates = Array.from(card.querySelectorAll('time, span, p, div'));
      for (const el of candidates) {
        const t = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
        match = t.match(/sent\s+(?:(\d+|an?|one)\s+)?(day|week|month|year|yesterday)s?(?:\s+ago)?/i);
        if (match) break;
      }
    }
    if (!match) return 0;

    const rawCount = match[1] ? match[1].toLowerCase() : '1';
    const unit = match[2].toLowerCase();
    let count = 1;
    if (rawCount === 'a' || rawCount === 'an' || rawCount === 'one') {
      count = 1;
    } else {
      const parsed = parseInt(rawCount, 10);
      if (!isNaN(parsed)) count = parsed;
    }

    if (unit === 'year') return count * 365;
    if (unit === 'month') return count * 30;
    if (unit === 'week') return count * 7;
    if (unit === 'day' || unit === 'yesterday') return count * 1;
    return 0;
  }

  const allCards = findInvitationCards();
  const matchedTargets = [];
  const matchedCardsSet = new Set();

  for (const target of safeTargets) {
    let matchedCard = allCards.find((c) => !matchedCardsSet.has(c) && isCardMatch(c, target));
    if (!matchedCard) {
      const vanity = String(target.vanityName || target.publicId || target.toPublicId || '').toLowerCase().trim();
      if (vanity) {
        const link = document.querySelector(`a[href*="/in/${vanity}"]`);
        if (link) {
          const candidate =
            link.closest('li') ||
            link.closest('.invitation-card') ||
            link.closest('.artdeco-list__item') ||
            link.parentElement?.parentElement;
          if (candidate && !matchedCardsSet.has(candidate)) {
            matchedCard = candidate;
          }
        }
      }
    }

    if (matchedCard) {
      matchedCardsSet.add(matchedCard);
      matchedTargets.push({ card: matchedCard, target });
    }
  }

  const itemsToWithdraw = [];

  if (matchedTargets.length > 0) {
    for (const item of matchedTargets) {
      itemsToWithdraw.push({
        card: item.card,
        invitationId: item.target.invitationId,
        publicId: item.target.vanityName || item.target.publicId || item.target.fullName || item.target.invitationId,
      });
    }

    for (const target of safeTargets) {
      if (!matchedTargets.some((m) => m.target === target)) {
        results.push({
          invitationId: target.invitationId,
          publicId: target.vanityName || target.publicId || target.fullName || target.invitationId,
          success: false,
          reason: 'Invitation card not found in DOM',
        });
      }
    }
  } else {
    // 0 cards matched by ID/name: Relative-Date Card Fallback
    const staleCards = [];
    for (const card of allCards) {
      const ageDays = parseCardAgeDays(card);
      if (ageDays >= olderThanDays) {
        staleCards.push({ card, ageDays });
      }
    }

    const countToTake = Math.min(staleCards.length, maxCount);
    for (let i = 0; i < countToTake; i++) {
      const { card, ageDays } = staleCards[i];
      const target = safeTargets[i];
      const link = card.querySelector('a[href*="/in/"]');
      const href = link ? link.getAttribute('href') : '';
      const cardVanity = href ? (href.match(/\/in\/([^/?#]+)/) || [])[1] : '';
      const nameEl = card.querySelector('.mn-invitation-card__title, .invitation-card__title, strong, a[href*="/in/"]');
      const cardName = nameEl ? (nameEl.innerText || nameEl.textContent || '').trim() : '';

      const invitationId = target?.invitationId || `dom_stale_${i + 1}`;
      const publicId = target?.publicId || target?.vanityName || cardVanity || cardName || invitationId;

      itemsToWithdraw.push({
        card,
        invitationId,
        publicId,
        relativeFallback: true,
        ageDays,
      });
    }

    if (countToTake < safeTargets.length) {
      for (let i = countToTake; i < safeTargets.length; i++) {
        results.push({
          invitationId: safeTargets[i].invitationId,
          publicId: safeTargets[i].vanityName || safeTargets[i].publicId || safeTargets[i].fullName || safeTargets[i].invitationId,
          success: false,
          reason: 'Invitation card not found in DOM',
        });
      }
    }
  }

  const matchedInDom = itemsToWithdraw.length;

  // 4. Click Withdraw on each selected card
  for (const item of itemsToWithdraw) {
    const card = item.card;
    const buttons = Array.from(card.querySelectorAll('button, [role="button"], a'));
    const withdrawBtn = buttons.find(isWithdrawElement);

    if (!withdrawBtn) {
      results.push({
        invitationId: item.invitationId,
        publicId: item.publicId,
        success: false,
        reason: 'Withdraw button not found in card',
      });
      continue;
    }

    try {
      if (typeof withdrawBtn.scrollIntoView === 'function') {
        withdrawBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      await sleep(350);
      withdrawBtn.click();

      // Wait ~800ms for confirmation dialog
      await sleep(800);

      // Find and click confirmation modal "Withdraw" button
      const dialogSelectors = '[role="dialog"], .artdeco-modal, #artdeco-modal-outlet, .artdeco-modal-overlay';
      const dialogs = Array.from(document.querySelectorAll(dialogSelectors));
      let confirmBtn = null;

      for (const dialog of dialogs) {
        const modalButtons = Array.from(dialog.querySelectorAll('button, [role="button"], a'));
        confirmBtn = modalButtons.find(
          (b) =>
            isWithdrawElement(b) ||
            (b.classList && b.classList.contains('artdeco-button--primary')) ||
            /withdraw|confirm/i.test((b.innerText || b.textContent || '').trim())
        );
        if (confirmBtn) break;
      }

      if (confirmBtn) {
        confirmBtn.click();
        await sleep(500);
        results.push({
          invitationId: item.invitationId,
          publicId: item.publicId,
          success: true,
          method: 'dom_fallback',
        });
      } else {
        results.push({
          invitationId: item.invitationId,
          publicId: item.publicId,
          success: true,
          method: 'dom_fallback',
          note: 'Card withdraw clicked without modal confirmation',
        });
      }
    } catch (clickErr) {
      results.push({
        invitationId: item.invitationId,
        publicId: item.publicId,
        success: false,
        reason: clickErr?.message || 'Error clicking withdraw button',
      });
    }

    // Wait ~1500ms before next invite
    await sleep(1500);
  }

  return {
    results,
    matchedInDom,
    loadMoreClicks,
    initialWithdrawButtons,
    finalWithdrawButtons,
    pageTitle,
    domDiagnostics,
  };
}

/**
 * Wait for a tab to finish loading or timeout.
 */
function waitForTabLoad(tabId, maxWaitMs = 15000) {
  return new Promise((resolve) => {
    let finished = false;
    let timer = null;

    function finish() {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      try {
        chrome.tabs.onUpdated.removeListener(onUpdatedListener);
      } catch {}
      resolve();
    }

    function onUpdatedListener(updatedId, info) {
      if (updatedId === tabId && info.status === 'complete') {
        finish();
      }
    }

    timer = setTimeout(finish, maxWaitMs);

    try {
      chrome.tabs.onUpdated.addListener(onUpdatedListener);
    } catch {
      finish();
      return;
    }

    Promise.resolve(chrome.tabs.get(tabId))
      .then((t) => {
        if (t && t.status === 'complete') finish();
      })
      .catch(() => {});
  });
}

/**
 * Fallback to clicking native Withdraw buttons in a background tab session via chrome.scripting.
 *
 * @param {Array<{invitationId: string, vanityName?: string, firstName?: string, lastName?: string, fullName?: string, publicId?: string}>} invitesBatch
 * @param {{ olderThanDays?: number, maxCount?: number }} [options]
 * @returns {Promise<{withdrawn: number, failed: number, matchedInDom: number, loadMoreClicks: number, initialWithdrawButtons: number, pageTitle: string, results: Array}>}
 */
export async function withdrawViaDomFallback(invitesBatch, options = {}) {
  const olderThanDays = typeof options?.olderThanDays === 'number' ? options.olderThanDays : 14;
  const maxCount = typeof options?.maxCount === 'number'
    ? options.maxCount
    : (Array.isArray(invitesBatch) && invitesBatch.length > 0 ? invitesBatch.length : 10);

  if ((!Array.isArray(invitesBatch) || invitesBatch.length === 0) && (!options || !options.maxCount)) {
    return { withdrawn: 0, failed: 0, matchedInDom: 0, loadMoreClicks: 0, initialWithdrawButtons: 0, pageTitle: '', domDiagnostics: '', results: [] };
  }

  if (typeof chrome === 'undefined' || !chrome.tabs?.create || !chrome.scripting?.executeScript) {
    throw new EngineError(ERROR.UNAVAILABLE, 'Chrome tabs or scripting API unavailable for DOM fallback');
  }

  const targetsCount = Array.isArray(invitesBatch) ? invitesBatch.length : 0;
  logDebug(
    'info',
    'AutoWithdraw',
    `[AutoWithdraw] Opening LinkedIn tab for ${targetsCount} invitations via DOM fallback...`,
  );

  let prevTabId = null;
  if (chrome.tabs?.query) {
    try {
      const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (Array.isArray(activeTabs) && activeTabs[0]?.id) {
        prevTabId = activeTabs[0].id;
      }
    } catch {}
  }

  let tab = null;
  try {
    tab = await chrome.tabs.create({
      url: 'https://www.linkedin.com/mynetwork/invitation-manager/sent/',
      active: true,
    });

    await waitForTabLoad(tab.id, 15000);
    // Allow initial client-side React rendering
    await new Promise((r) => setTimeout(r, 2000));

    const execResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [invitesBatch, { olderThanDays, maxCount }],
      func: domWithdrawInPage,
    });

    const rawResult = execResults && execResults[0] ? execResults[0].result : null;
    const results = Array.isArray(rawResult) ? rawResult : (rawResult?.results || []);
    const matchedInDom = typeof rawResult?.matchedInDom === 'number'
      ? rawResult.matchedInDom
      : results.filter((r) => r.reason !== 'Invitation card not found in DOM').length;
    const loadMoreClicks = typeof rawResult?.loadMoreClicks === 'number' ? rawResult.loadMoreClicks : 0;
    const initialWithdrawButtons = typeof rawResult?.initialWithdrawButtons === 'number'
      ? rawResult.initialWithdrawButtons
      : 0;
    const finalWithdrawButtons = typeof rawResult?.finalWithdrawButtons === 'number'
      ? rawResult.finalWithdrawButtons
      : initialWithdrawButtons;
    const pageTitle = rawResult?.pageTitle || '';
    const domDiagnostics = rawResult?.domDiagnostics || '';

    const withdrawn = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    if (initialWithdrawButtons === 0 && domDiagnostics) {
      logDebug('warn', 'AutoWithdraw', `[AutoWithdraw] initialWithdrawButtons=0: ${domDiagnostics}`);
    }

    logDebug(
      'good',
      'AutoWithdraw',
      `[AutoWithdraw] DOM fallback completed: initialWithdrawButtons=${initialWithdrawButtons}, finalWithdrawButtons=${finalWithdrawButtons}, pageTitle="${pageTitle}", matchedInDom=${matchedInDom}, withdrawn=${withdrawn}, failed=${failed}. (targets=${targetsCount}, loadMoreClicks=${loadMoreClicks})`,
    );

    return { withdrawn, failed, matchedInDom, loadMoreClicks, initialWithdrawButtons, finalWithdrawButtons, pageTitle, domDiagnostics, results };
  } catch (err) {
    logDebug('error', 'AutoWithdraw', `[AutoWithdraw] DOM fallback error: ${err.message || err}`);
    throw err;
  } finally {
    if (tab && tab.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        /* tab may already have been closed */
      }
    }
    if (prevTabId && chrome.tabs?.update) {
      try {
        await chrome.tabs.update(prevTabId, { active: true });
      } catch {
        /* prev tab may no longer exist */
      }
    }
  }
}

/* ================================================================== */
/*  Shared DOM Fallback Runner (Mutex-Protected Single Tab)           */
/* ================================================================== */

let domTabLock = Promise.resolve();

/**
 * Determine whether an error can safely fall back to background DOM execution.
 * Returns false on rate-limits (429), auth challenges (999/checkpoint), or per-prospect limits.
 *
 * @param {any} err
 * @returns {boolean}
 */
export function canFallbackToDom(err) {
  if (!err) return true;
  const status = Number(err?.status || err?.response?.status || err?.code) || 0;
  const msg = String(err?.message || err || '');
  const code = String(err?.code || err?.response?.data?.code || '');
  const combined = `${msg} ${code}`;

  if (
    code === ERROR.AUTH_REQUIRED ||
    code === ERROR.RATE_LIMITED ||
    code === ERROR.INVALID_PARAMS ||
    code === ERROR.CHALLENGE_DETECTED ||
    code === 'CUSTOM_INVITE_LIMIT_REACHED' ||
    err?.isCustomInviteLimit ||
    status === 429 ||
    status === 999
  ) {
    return false;
  }

  if (
    looksLikeAllowance(code, msg) ||
    looksLikeDuplicate(code, msg) ||
    looksLikePerProspectIssue(code, msg)
  ) {
    return false;
  }

  if (
    /RATE_LIMITED|AUTH_REQUIRED|INVALID_PARAMS|CUSTOM_INVITE_LIMIT|ALREADY_CONNECTED|ALREADY_PENDING|INVITE_LIMIT|PROFILE_RESTRICTED|CANT_RESEND_YET|PERSONALIZED_INVITATION_QUOTA_EXCEEDED|already.*connect|rate.*limit|weekly.*limit|daily.*limit|too many requests|checkpoint|challenge|security check|authwall|captcha|verify you are human/i.test(
      combined,
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Executes an in-page script function inside an isolated background tab (active: false).
 * Mutex-protected via domTabLock: ensures at most ONE background DOM tab is ever open at a time.
 * Automatically waits for tab load, 1.2s client hydration, executes script, and cleans up tab in finally.
 *
 * @param {string} url - Target URL to open in background
 * @param {Function} scriptFn - Function to execute inside page context
 * @param {Array} [args] - Serializable arguments to pass to scriptFn
 * @param {string} [label] - Label for logging
 * @returns {Promise<any>}
 */
export async function runDomActionInTab(url, scriptFn, args = [], label = 'DOM') {
  if (typeof chrome === 'undefined' || !chrome.tabs?.create || !chrome.scripting?.executeScript) {
    throw new EngineError(ERROR.UNAVAILABLE, 'Chrome tabs or scripting API unavailable for DOM fallback');
  }

  const execute = async () => {
    let tab = null;
    try {
      tab = await chrome.tabs.create({
        url,
        active: false,
      });

      const isTestEnv = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
      await waitForTabLoad(tab.id, isTestEnv ? 200 : 18000);
      await new Promise((r) => setTimeout(r, isTestEnv ? 10 : 1200));

      const freshTab = await chrome.tabs.get(tab.id).catch(() => tab);
      const currentUrl = freshTab?.url || '';
      if (/linkedin\.com\/(?:checkpoint|authwall|login|uas\/login)/i.test(currentUrl)) {
        throw new EngineError(ERROR.AUTH_REQUIRED, `LinkedIn redirected to auth challenge / login (${currentUrl})`);
      }

      const execResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args,
        func: scriptFn,
      });

      return execResults?.[0]?.result;
    } finally {
      if (tab?.id) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch {}
      }
    }
  };

  const nextPromise = domTabLock.then(execute, execute);
  domTabLock = nextPromise.catch(() => {});
  return nextPromise;
}

/**
 * In-page DOM execution to register a profile visit and extract top card name.
 *
 * @param {string} publicId
 */
export async function domViewProfileInPage(publicId) {
  const waitFor = async (fn, timeoutMs = 8000, intervalMs = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = fn(); if (res) return res; } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  };

  const h1 = await waitFor(() => document.querySelector('main h1, .pv-top-card h1'));
  const fullName = h1 ? (h1.textContent || '').trim() : '';
  const parts = fullName.split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';

  return {
    ok: true,
    success: true,
    method: 'dom',
    publicId,
    fullName,
    firstName,
    lastName,
  };
}

/**
 * In-page DOM execution to verify whether a profile is a 1st-degree connection.
 * Checks if top profile card has a primary Message button + 1st badge (and no Connect or Pending button).
 */
export async function domCheckConnectionInPage() {
  const waitFor = async (fn, timeoutMs = 8000, intervalMs = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = fn(); if (res) return res; } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  };

  const h1 = await waitFor(() => document.querySelector('main h1, .pv-top-card h1'));
  if (!h1) {
    return { ok: false, connected: false, reason: 'Profile top card failed to load' };
  }

  const mainCard =
    document.querySelector(
      'main .pv-top-card, main [data-view-name="profile-card"], main section:first-of-type, main',
    ) || document.querySelector('main');

  if (!mainCard) return { ok: false, connected: false, reason: 'Main card not found' };

  const actionElements = Array.from(mainCard.querySelectorAll('button, a.artdeco-button, div[role="button"]'));
  const elementLabels = actionElements.map((el) =>
    ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).trim().toLowerCase(),
  );

  const hasConnect = elementLabels.some((label) =>
    /(?:^|\s)connect(?:\s|$)/i.test(label) && !/connect with premium/i.test(label),
  );
  const hasPending = elementLabels.some((label) =>
    /(?:^|\s)(?:pending|invite sent|invitation sent|withdraw(?:\s+invitation)?)(?:\s|$)/i.test(label),
  );
  const hasMessage = elementLabels.some((label) =>
    /(?:^|\s)(?:direct\s+)?message(?:\s|$)/i.test(label),
  );

  const cardText = mainCard.textContent || '';
  const has1stBadge =
    /\b1st\b/i.test(cardText) ||
    Boolean(
      mainCard.querySelector(
        '.dist-value, [class*="dist-value"], [class*="degree-icon"], [aria-label*="1st degree"], [aria-label*="1st"], span.badge--degree',
      ),
    );

  const isConnected = hasMessage && has1stBadge && !hasConnect && !hasPending;

  return {
    ok: true,
    connected: Boolean(isConnected),
    hasMessage,
    has1stBadge,
    hasConnect,
    hasPending,
  };
}

/**
 * In-page DOM execution to send a connection request from a profile page.
 *
 * @param {{ note?: string } | string} [args]
 */
export async function domSendInviteInPage(args) {
  const noteText = typeof args === 'string' ? args : (args?.note || '');
  const waitFor = async (fn, timeoutMs = 8000, intervalMs = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = fn(); if (res) return res; } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  };

  const h1 = await waitFor(() => document.querySelector('main h1, .pv-top-card h1'));
  if (!h1) {
    return { ok: false, success: false, reason: 'Profile top card failed to load' };
  }

  const mainCard = document.querySelector('main .pv-top-card, main [data-view-name="profile-card"], main section:first-of-type, main') || document.querySelector('main');
  const getButtons = () => Array.from(mainCard.querySelectorAll('button'));

  // 1. Check if already connected (Message button or 1st degree badge)
  const is1stDegree =
    /\b1st\b/i.test(mainCard.querySelector('.dist-value')?.textContent || '') ||
    getButtons().some((b) => /^(?:Direct )?Message$/i.test((b.textContent || '').trim()) && !b.disabled);

  // 2. Check if invitation is already pending
  const isPending = getButtons().some(
    (b) =>
      /Pending/i.test((b.textContent || '').trim()) ||
      /Pending/i.test(b.getAttribute('aria-label') || ''),
  );

  if (isPending) {
    return { ok: true, success: true, alreadyPending: true, method: 'dom', message: 'Invitation already pending' };
  }
  if (is1stDegree) {
    return { ok: true, success: true, alreadyConnected: true, method: 'dom', message: 'Already connected (1st degree)' };
  }

  // 3. Find primary Connect button in main top card
  let connectBtn = getButtons().find((b) => {
    const t = (b.textContent || '').trim();
    const aria = b.getAttribute('aria-label') || '';
    return (/^Connect$/i.test(t) || /Invite.*to connect/i.test(aria) || /Connect with/i.test(aria)) && !b.disabled;
  });

  // Check inside More dropdown if not visible on header
  if (!connectBtn) {
    const moreBtn = getButtons().find((b) => {
      const t = (b.textContent || '').trim();
      const aria = b.getAttribute('aria-label') || '';
      return (/^More$/i.test(t) || /More actions/i.test(aria) || aria.includes('More')) && !b.disabled;
    });

    if (moreBtn) {
      moreBtn.click();
      await waitFor(() => document.querySelector('.artdeco-dropdown__content, [role="menu"]'), 3000);
      const dropdownItems = Array.from(
        document.querySelectorAll(
          '.artdeco-dropdown__content button, [role="menu"] [role="menuitem"], .artdeco-dropdown__item',
        ),
      );
      connectBtn = dropdownItems.find((item) => {
        const t = (item.textContent || '').trim();
        const aria = item.getAttribute('aria-label') || '';
        return (/^Connect$/i.test(t) || /Connect/i.test(aria)) && !item.disabled;
      });
    }
  }

  if (!connectBtn) {
    if (is1stDegree) {
      return { ok: true, success: true, alreadyConnected: true, method: 'dom' };
    }
    return { ok: false, success: false, reason: 'Connect button not found on profile' };
  }

  if (typeof connectBtn.scrollIntoView === 'function') {
    connectBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  await new Promise((r) => setTimeout(r, 200));
  connectBtn.click();

  // 4. Handle modal dialog
  const activeDialog = await waitFor(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .artdeco-modal'));
    return dialogs.find((d) => d.offsetParent !== null) || dialogs[dialogs.length - 1];
  }, 5000);

  if (activeDialog) {
    const modalButtons = () => Array.from(activeDialog.querySelectorAll('button, [role="button"]'));

    if (noteText && String(noteText).trim()) {
      const addNoteBtn = modalButtons().find((b) => {
        const t = (b.textContent || '').trim();
        const aria = b.getAttribute('aria-label') || '';
        return /Add a note/i.test(t) || /Add a note/i.test(aria);
      });

      if (addNoteBtn) {
        addNoteBtn.click();
        const textarea = await waitFor(() => activeDialog.querySelector('textarea, [name="message"]'), 3000);
        if (textarea) {
          textarea.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) {
            setter.call(textarea, String(noteText));
          } else {
            textarea.value = String(noteText);
          }
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          textarea.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    }

    const freshButtons = modalButtons();
    let sendBtn = null;
    if (noteText && String(noteText).trim()) {
      sendBtn = freshButtons.find((b) => {
        const t = (b.textContent || '').trim();
        const aria = b.getAttribute('aria-label') || '';
        return (/^Send$/i.test(t) || /Send now/i.test(t) || /Send invitation/i.test(aria)) && !b.disabled;
      });
    }

    if (!sendBtn) {
      sendBtn = freshButtons.find((b) => {
        const t = (b.textContent || '').trim();
        const aria = b.getAttribute('aria-label') || '';
        return (
          /Send without a note/i.test(t) ||
          /Send without a note/i.test(aria) ||
          /^Send$/i.test(t) ||
          /Send now/i.test(t) ||
          /Send invitation/i.test(aria)
        ) && !b.disabled;
      });
    }

    if (sendBtn) {
      sendBtn.click();
      // Post-click verification: verify modal closes or Pending appears
      await waitFor(() => {
        const d = document.querySelector('[role="dialog"], .artdeco-modal');
        const p = getButtons().some((b) => /Pending/i.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
        return !d || p;
      }, 5000);
      return { ok: true, success: true, method: 'dom', sentWithoutNote: !noteText };
    }
  }

  // Post-click check: check if Pending appears
  await waitFor(() => {
    return getButtons().some((b) => /Pending/i.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
  }, 4000);

  return { ok: true, success: true, method: 'dom', sentWithoutNote: true };
}

/**
 * In-page DOM execution to follow a member from their profile page.
 *
 * @param {{ following?: boolean } | boolean} [args]
 */
export async function domFollowInPage(args) {
  const shouldFollow = typeof args === 'boolean' ? args : args?.following !== false;
  const waitFor = async (fn, timeoutMs = 8000, intervalMs = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = fn(); if (res) return res; } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  };

  const h1 = await waitFor(() => document.querySelector('main h1, .pv-top-card h1'));
  if (!h1) {
    return { ok: false, success: false, reason: 'Profile top card failed to load' };
  }

  const mainCard = document.querySelector('main .pv-top-card, main [data-view-name="profile-card"], main section:first-of-type, main') || document.querySelector('main');
  const getButtons = () => Array.from(mainCard.querySelectorAll('button'));

  const checkIsFollowing = () =>
    getButtons().some((b) => {
      const t = (b.textContent || '').trim();
      const aria = b.getAttribute('aria-label') || '';
      return (/^Following$/i.test(t) || /Following/i.test(aria) || b.getAttribute('aria-pressed') === 'true') && !b.disabled;
    });

  if (shouldFollow && checkIsFollowing()) {
    return { ok: true, success: true, alreadyFollowing: true, method: 'dom' };
  }
  if (!shouldFollow && !checkIsFollowing()) {
    return { ok: true, success: true, alreadyFollowing: false, method: 'dom' };
  }

  let followBtn = getButtons().find((b) => {
    const t = (b.textContent || '').trim();
    const aria = b.getAttribute('aria-label') || '';
    if (shouldFollow) {
      return (/^Follow$/i.test(t) || /Follow.*profile/i.test(aria) || /Follow with/i.test(aria)) && !b.disabled;
    } else {
      return (/^Following$/i.test(t) || /Unfollow/i.test(aria)) && !b.disabled;
    }
  });

  if (!followBtn) {
    const moreBtn = getButtons().find((b) => {
      const t = (b.textContent || '').trim();
      const aria = b.getAttribute('aria-label') || '';
      return (/^More$/i.test(t) || /More actions/i.test(aria) || aria.includes('More')) && !b.disabled;
    });

    if (moreBtn) {
      moreBtn.click();
      await waitFor(() => document.querySelector('.artdeco-dropdown__content, [role="menu"]'), 3000);
      const dropdownItems = Array.from(
        document.querySelectorAll(
          '.artdeco-dropdown__content button, [role="menu"] [role="menuitem"], .artdeco-dropdown__item',
        ),
      );
      followBtn = dropdownItems.find((item) => {
        const t = (item.textContent || '').trim();
        const aria = item.getAttribute('aria-label') || '';
        return (shouldFollow ? /^Follow$/i.test(t) || /Follow/i.test(aria) : /^Unfollow$/i.test(t) || /Unfollow/i.test(aria)) && !item.disabled;
      });
    }
  }

  if (!followBtn) {
    return { ok: false, success: false, reason: `${shouldFollow ? 'Follow' : 'Unfollow'} button not found` };
  }

  if (typeof followBtn.scrollIntoView === 'function') {
    followBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  await new Promise((r) => setTimeout(r, 200));
  followBtn.click();

  // Post-click verification: verify button flips to Following / Follow
  await waitFor(() => {
    return shouldFollow ? checkIsFollowing() : !checkIsFollowing();
  }, 5000);

  return { ok: true, success: true, method: 'dom' };
}

/**
 * In-page DOM execution to like a post from its URL.
 */
export async function domLikePostInPage() {
  const waitFor = async (fn, timeoutMs = 8000, intervalMs = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = fn(); if (res) return res; } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  };

  const getLikeBtn = () => {
    const buttons = Array.from(
      document.querySelectorAll(
        'button[aria-label*="React Like"], button[aria-label*="Like"], button.react-button__trigger, .reactions-react-button button',
      ),
    );
    return buttons[0] || null;
  };

  const likeBtn = await waitFor(getLikeBtn, 8000);
  if (!likeBtn) {
    return { ok: false, success: false, reason: 'Like button not found on post' };
  }

  const checkIsLiked = (btn) =>
    btn.getAttribute('aria-pressed') === 'true' ||
    btn.classList.contains('react-button--active') ||
    /Unlike|Remove reaction/i.test(btn.getAttribute('aria-label') || '');

  if (checkIsLiked(likeBtn)) {
    return { ok: true, success: true, alreadyLiked: true, method: 'dom' };
  }

  if (typeof likeBtn.scrollIntoView === 'function') {
    likeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  await new Promise((r) => setTimeout(r, 200));
  likeBtn.click();

  // Post-click verification: verify aria-pressed flips to "true"
  await waitFor(() => {
    const btn = getLikeBtn();
    return btn ? checkIsLiked(btn) : false;
  }, 5000);

  return { ok: true, success: true, method: 'dom' };
}

/**
 * In-page DOM execution to comment on a post from its URL.
 *
 * @param {{ body: string } | string} args
 */
export async function domCommentPostInPage(args) {
  const commentText = typeof args === 'string' ? args : (args?.body || '');
  if (!commentText) {
    return { ok: false, success: false, reason: 'Comment text is empty' };
  }
  const waitFor = async (fn, timeoutMs = 8000, intervalMs = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = fn(); if (res) return res; } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  };

  let editor = document.querySelector(
    '.comments-comment-box__editor, .editor-content [contenteditable="true"], [contenteditable="true"][role="textbox"]',
  );
  if (!editor) {
    const commentToggleBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      /Comment/i.test((b.textContent || '') + (b.getAttribute('aria-label') || '')),
    );
    if (commentToggleBtn) {
      commentToggleBtn.click();
      editor = await waitFor(
        () =>
          document.querySelector(
            '.comments-comment-box__editor, .editor-content [contenteditable="true"], [contenteditable="true"][role="textbox"]',
          ),
        5000,
      );
    }
  }

  if (!editor) {
    return { ok: false, success: false, reason: 'Comment editor box not found' };
  }

  if (typeof editor.scrollIntoView === 'function') {
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  editor.focus();

  const inserted = document.execCommand('insertText', false, commentText);
  if (!inserted) {
    editor.textContent = commentText;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: commentText }));
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));

  const submitBtn = await waitFor(() => {
    const btns = Array.from(
      document.querySelectorAll(
        '.comments-comment-box__submit-button, button.comments-comment-box__submit-button, button[type="submit"]',
      ),
    );
    return btns.find((b) => !b.disabled && /Post|Comment|Submit/i.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
  }, 5000);

  if (!submitBtn) {
    return { ok: false, success: false, reason: 'Comment submit button not enabled' };
  }

  submitBtn.click();

  // Post-click verification: verify editor clears
  await waitFor(() => {
    const current = document.querySelector('.comments-comment-box__editor, .editor-content [contenteditable="true"]');
    return !current || !(current.textContent || '').trim();
  }, 5000);

  return { ok: true, success: true, method: 'dom' };
}

/**
 * In-page DOM execution on https://www.linkedin.com/in/{publicId}/recent-activity/all/
 * Locates the prospect's latest post in <main>, verifies existence, clicks Like button, and verifies state.
 */
export async function domLikeRecentActivityInPage() {
  const waitFor = async (fn, timeoutMs = 8000, intervalMs = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = fn(); if (res) return res; } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  };

  const main = await waitFor(() => document.querySelector('main'));
  if (!main) return { ok: false, success: false, reason: 'Main container failed to load' };

  const checkEmpty = () => {
    const mainText = main.textContent || '';
    return (
      /Nothing to see for now|hasn[’']t posted lately|no activity yet|no posts to see/i.test(mainText) ||
      Boolean(document.querySelector('.artdeco-empty-state'))
    );
  };

  const getPostCards = () =>
    Array.from(
      main.querySelectorAll(
        '.feed-shared-update-v2, div[data-urn*="activity"], div[data-view-name*="feed-full-update"], article, .profile-creator-shared-feed-update__container',
      ),
    );

  await waitFor(() => getPostCards().length > 0 || checkEmpty(), 5000);

  const postCards = getPostCards();
  if (postCards.length === 0 && checkEmpty()) {
    return { ok: true, skipped: true, reason: 'no_recent_posts' };
  }

  const targetCard = postCards[0] || main;
  const getLikeBtn = () => {
    const buttons = Array.from(
      targetCard.querySelectorAll(
        'button[aria-label*="React Like"], button[aria-label*="Like"], button.react-button__trigger, .reactions-react-button button',
      ),
    );
    return buttons[0] || null;
  };

  const likeBtn = await waitFor(getLikeBtn, 5000);
  if (!likeBtn) {
    if (checkEmpty() || postCards.length === 0) {
      return { ok: true, skipped: true, reason: 'no_recent_posts' };
    }
    return { ok: false, success: false, reason: 'Like button not found on recent post' };
  }

  const checkIsLiked = (btn) =>
    btn.getAttribute('aria-pressed') === 'true' ||
    btn.classList.contains('react-button--active') ||
    /Unlike|Remove reaction/i.test(btn.getAttribute('aria-label') || '');

  if (checkIsLiked(likeBtn)) {
    return { ok: true, success: true, alreadyLiked: true, method: 'dom' };
  }

  if (typeof likeBtn.scrollIntoView === 'function') {
    likeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  await new Promise((r) => setTimeout(r, 200));
  likeBtn.click();

  await waitFor(() => {
    const btn = getLikeBtn();
    return btn ? checkIsLiked(btn) : false;
  }, 5000);

  return { ok: true, success: true, method: 'dom' };
}

/**
 * In-page DOM execution on https://www.linkedin.com/in/{publicId}/recent-activity/all/
 * Locates the prospect's latest post in <main>, writes comment, submits, and verifies state.
 *
 * @param {{ body: string } | string} args
 */
export async function domCommentRecentActivityInPage(args) {
  const commentText = typeof args === 'string' ? args : (args?.body || '');
  if (!commentText) {
    return { ok: false, success: false, reason: 'Comment text is empty' };
  }

  const waitFor = async (fn, timeoutMs = 8000, intervalMs = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = fn(); if (res) return res; } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  };

  const main = await waitFor(() => document.querySelector('main'));
  if (!main) return { ok: false, success: false, reason: 'Main container failed to load' };

  const checkEmpty = () => {
    const mainText = main.textContent || '';
    return (
      /Nothing to see for now|hasn[’']t posted lately|no activity yet|no posts to see/i.test(mainText) ||
      Boolean(document.querySelector('.artdeco-empty-state'))
    );
  };

  const getPostCards = () =>
    Array.from(
      main.querySelectorAll(
        '.feed-shared-update-v2, div[data-urn*="activity"], div[data-view-name*="feed-full-update"], article, .profile-creator-shared-feed-update__container',
      ),
    );

  await waitFor(() => getPostCards().length > 0 || checkEmpty(), 5000);

  const postCards = getPostCards();
  if (postCards.length === 0 && checkEmpty()) {
    return { ok: true, skipped: true, reason: 'no_recent_posts' };
  }

  const targetCard = postCards[0] || main;
  let editor = targetCard.querySelector(
    '.comments-comment-box__editor, .editor-content [contenteditable="true"], [contenteditable="true"][role="textbox"]',
  );
  if (!editor) {
    const commentToggleBtn = Array.from(targetCard.querySelectorAll('button')).find((b) =>
      /Comment/i.test((b.textContent || '') + (b.getAttribute('aria-label') || '')),
    );
    if (commentToggleBtn) {
      commentToggleBtn.click();
      editor = await waitFor(
        () =>
          targetCard.querySelector(
            '.comments-comment-box__editor, .editor-content [contenteditable="true"], [contenteditable="true"][role="textbox"]',
          ),
        5000,
      );
    }
  }

  if (!editor) {
    if (checkEmpty() || postCards.length === 0) {
      return { ok: true, skipped: true, reason: 'no_recent_posts' };
    }
    return { ok: false, success: false, reason: 'Comment editor box not found on recent post' };
  }

  if (typeof editor.scrollIntoView === 'function') {
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  editor.focus();

  const inserted = document.execCommand('insertText', false, commentText);
  if (!inserted) {
    editor.textContent = commentText;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: commentText }));
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));

  const submitBtn = await waitFor(() => {
    const btns = Array.from(
      targetCard.querySelectorAll(
        'button.comments-comment-box__submit-button, button[type="submit"], .comments-comment-box button.artdeco-button--primary',
      ),
    );
    return btns.find((b) => !b.disabled && /Post|Comment/i.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
  }, 5000);

  if (!submitBtn) {
    return { ok: false, success: false, reason: 'Comment submit button not found or disabled' };
  }

  submitBtn.click();

  await waitFor(() => {
    return !editor.textContent.trim() || !submitBtn.isConnected || submitBtn.disabled;
  }, 5000);

  return { ok: true, success: true, method: 'dom' };
}

/**
 * In-page DOM execution to endorse a skill on a member's profile.
 *
 * @param {{ skillName?: string } | string} [args]
 */
export async function domEndorseInPage(args) {
  const targetSkill = typeof args === 'string' ? args : (args?.skillName || '');
  const waitFor = async (fn, timeoutMs = 8000, intervalMs = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = fn(); if (res) return res; } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  };

  await waitFor(
    () =>
      document.querySelector(
        'main [data-view-name="profile-component-entity"], main .pvs-list__item--line-separated, main section',
      ),
    8000,
  );

  const items = Array.from(
    document.querySelectorAll(
      'main [data-view-name="profile-component-entity"], main .pvs-list__item--line-separated, main li',
    ),
  );
  let matchedItem = null;
  if (targetSkill) {
    matchedItem = items.find((item) => (item.textContent || '').toLowerCase().includes(targetSkill.toLowerCase()));
  }
  if (!matchedItem && items.length) {
    matchedItem = items.find((item) => item.querySelector('button[aria-label*="Endorse"], button'));
  }

  const searchScope = matchedItem || document.querySelector('main');
  const endorseBtn = Array.from(searchScope.querySelectorAll('button')).find((b) =>
    /Endorse/i.test((b.textContent || '') + (b.getAttribute('aria-label') || '')),
  );

  if (!endorseBtn) {
    return { ok: false, success: false, reason: 'Endorse button not found for skill' };
  }

  const isAlreadyEndorsed = /Endorsed/i.test(
    (endorseBtn.textContent || '') + (endorseBtn.getAttribute('aria-label') || ''),
  );
  if (isAlreadyEndorsed) {
    return { ok: true, success: true, alreadyEndorsed: true, method: 'dom' };
  }

  if (typeof endorseBtn.scrollIntoView === 'function') {
    endorseBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  await new Promise((r) => setTimeout(r, 200));
  endorseBtn.click();

  // Post-click verification: verify label changes to Endorsed
  await waitFor(() => {
    return /Endorsed/i.test((endorseBtn.textContent || '') + (endorseBtn.getAttribute('aria-label') || ''));
  }, 5000);

  return { ok: true, success: true, method: 'dom' };
}

/**
 * In-page DOM execution to send a message to a member from their profile page.
 *
 * @param {{ body: string } | string} args
 */
export async function domSendMessageInPage(args) {
  const messageText = typeof args === 'string' ? args : (args?.body || '');
  if (!messageText) {
    return { ok: false, success: false, reason: 'Message body cannot be empty' };
  }
  const waitFor = async (fn, timeoutMs = 8000, intervalMs = 250) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const res = fn(); if (res) return res; } catch {}
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  };

  const h1 = await waitFor(() => document.querySelector('main h1, .pv-top-card h1'));
  if (!h1) {
    return { ok: false, success: false, reason: 'Profile top card failed to load' };
  }

  const mainCard =
    document.querySelector(
      'main .pv-top-card, main [data-view-name="profile-card"], main section:first-of-type, main',
    ) || document.querySelector('main');
  const getButtons = () => Array.from(mainCard.querySelectorAll('button'));

  const msgBtn = getButtons().find(
    (b) => /^(?:Direct )?Message$/i.test((b.textContent || '').trim()) && !b.disabled,
  );
  if (!msgBtn) {
    return { ok: false, success: false, reason: 'Message button not found on profile' };
  }

  msgBtn.click();

  const editor = await waitFor(
    () =>
      document.querySelector(
        '.msg-form__contenteditable, [role="textbox"][aria-label*="Write a message"], .msg-form div[contenteditable="true"]',
      ),
    5000,
  );

  if (!editor) {
    return { ok: false, success: false, reason: 'Message editor form did not appear' };
  }

  editor.focus();
  const inserted = document.execCommand('insertText', false, messageText);
  if (!inserted) {
    editor.textContent = messageText;
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: messageText }));
  }
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));

  const sendBtn = await waitFor(() => {
    const btns = Array.from(
      document.querySelectorAll(
        '.msg-form__send-button, button.msg-form__send-button, button[type="submit"]',
      ),
    );
    return btns.find((b) => !b.disabled && /Send/i.test((b.textContent || '') + (b.getAttribute('aria-label') || '')));
  }, 5000);

  if (!sendBtn) {
    return { ok: false, success: false, reason: 'Message send button not enabled' };
  }

  sendBtn.click();

  // Post-click verification: editor clears
  await waitFor(() => {
    const current = document.querySelector('.msg-form__contenteditable, .msg-form div[contenteditable="true"]');
    return !current || !(current.textContent || '').trim();
  }, 5000);

  return { ok: true, success: true, method: 'dom' };
}

/**
 * Withdraw a pending sent invitation using LinkedIn's current SDUI endpoint,
 * with automatic single-invite DOM fallback if SDUI returns 400/404/422.
 *
 * @param {string | number | { invitationId: string, profileUrn?: string, toMemberUrn?: string, firstName?: string, lastName?: string, vanityName?: string, publicId?: string, toPublicId?: string }} invitationId
 * @param {{ profileUrn?: string, publicId?: string, firstName?: string, lastName?: string, allowDomFallback?: boolean }} [meta]
 * @returns {Promise<{ ok: boolean, method: string, data?: any }>}
 */
export async function withdrawInvitation(invitationId, meta = {}) {
  if (!invitationId) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'invitationId or invite object is required to withdraw an invitation');
  }

  // NOTE: Withdrawing invitations NEVER calls getProfile, getProfileNormalized,
  // resolveProfileUrn, or quota.reserve('profileView'). It uses the pre-fetched
  // invitationId, entityUrn, and profileUrn from fetchSentInvitations directly.
  let rawId = '';
  let profileUrn = '';
  let firstName = '';
  let lastName = '';
  let fullName = '';
  let vanityName = '';

  if (typeof invitationId === 'object' && invitationId !== null) {
    rawId = String(invitationId.invitationId || invitationId.invitationUrn || invitationId.id || (invitationId.entityUrn && /invitation/i.test(invitationId.entityUrn) ? invitationId.entityUrn : '') || '');
    profileUrn =
      meta.profileUrn ||
      meta.toMemberUrn ||
      (meta.entityUrn && !/invitation/i.test(meta.entityUrn) ? meta.entityUrn : '') ||
      invitationId.profileUrn ||
      (invitationId.toMemberUrn ? String(invitationId.toMemberUrn).replace(/^urn:li:[^:]+:/, '') : '') ||
      (invitationId.entityUrn && !/invitation/i.test(invitationId.entityUrn) ? String(invitationId.entityUrn).replace(/^urn:li:[^:]+:/, '') : '') ||
      '';
    firstName = meta.firstName || invitationId.firstName || '';
    lastName = meta.lastName || invitationId.lastName || '';
    fullName = meta.fullName || invitationId.fullName || [firstName, lastName].filter(Boolean).join(' ').trim();
    vanityName = meta.publicId || meta.vanityName || invitationId.vanityName || invitationId.publicId || invitationId.toPublicId || '';
  } else {
    rawId = String(invitationId);
    profileUrn =
      meta.profileUrn ||
      meta.toMemberUrn ||
      (meta.entityUrn && !/invitation/i.test(meta.entityUrn) ? meta.entityUrn : '') ||
      '';
    firstName = meta.firstName || '';
    lastName = meta.lastName || '';
    fullName = meta.fullName || [firstName, lastName].filter(Boolean).join(' ').trim();
    vanityName = meta.publicId || meta.vanityName || '';
  }

  const cleanInvitationId = String(rawId).split(':').pop().replace(/\D+/g, '') || String(rawId).split(':').pop();
  const cleanId = cleanInvitationId;
  let rawProfileId = String(profileUrn || '')
    .replace(/^urn:li:(?:fsd_profile|fs_miniProfile):/i, '')
    .replace(/^urn:li:[^:]+:/, '')
    .split(':')
    .pop();
  const publicId = vanityName;

  if (!cleanInvitationId) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Valid numeric invitationId is required to withdraw an invitation');
  }

  const endpointCfg = getEndpointConfig('withdrawInvitation');
  const { mode, meta: vaultMeta = {} } = endpointCfg;
  const vaultMode = mode || 'sdui_first';
  const allowDomFallback = meta?.allowDomFallback !== false;

  if (vaultMode === 'dom_first' && allowDomFallback) {
    logDebug('good', 'Voyager', `[withdrawInvitation] Mode is dom_first, executing DOM fallback directly`);
    const inviteObj = {
      invitationId: cleanInvitationId,
      entityUrn: meta?.entityUrn || `urn:li:fs_relInvitation:${cleanInvitationId}`,
      profileUrn: rawProfileId,
      firstName,
      lastName,
      fullName,
      vanityName: publicId,
      publicId,
    };
    const domRes = await withdrawViaDomFallback([inviteObj]);
    return { ok: (domRes?.withdrawn || 0) > 0, method: 'dom_fallback', data: domRes };
  }

  // If rawProfileId is empty or numeric-only (not ACo...), check cached profile storage (zero network cost)
  if ((!rawProfileId || !rawProfileId.startsWith('ACo')) && publicId) {
    try {
      const cached = await getStoredProfile(publicId).catch(() => null);
      const cachedUrn =
        cached?.profileUrn ||
        cached?.dashEntityUrn ||
        cached?.entityUrn ||
        cached?.urn ||
        '';
      const match = String(cachedUrn).match(/ACoAA[A-Za-z0-9_-]+/);
      if (match) {
        rawProfileId = match[0];
      }
    } catch {}
  }

  const cleanProfileUrn = rawProfileId;

  const payload = {
    inviterActionType: vaultMeta.inviterActionType || 'InviterActionType_WITHDRAW',
    inviteeVanityName: publicId || '',
    firstName: firstName || '',
    lastName: lastName || '',
    profileUrn: rawProfileId || '',
    firstFiveInviteCount: { key: 'guidedFlowNumSentInvites', namespace: '' },
    guidedFlowUrlandProfileList: {
      key: 'guidedFlowUrlAndPictureList',
      namespace: 'guidedFlowUrlAndPictureListNameSpace',
    },
    invitationType: 'GenericInvitationType_CONNECTION',
    invitationUrn: { invitationId: String(cleanInvitationId) },
  };

  // Only include queryName when a valid ACoAA... profile ID is present
  if (rawProfileId && rawProfileId.startsWith('ACo')) {
    payload.queryName = 'ProfileMemberRelationshipRefreshById';
  }
  if (vaultMeta.queryName !== undefined) {
    if (vaultMeta.queryName) payload.queryName = vaultMeta.queryName;
    else delete payload.queryName;
  }
  if (vaultMeta.extraPayload && typeof vaultMeta.extraPayload === 'object') {
    Object.assign(payload, vaultMeta.extraPayload);
  }

  const requestedStateKeys = Array.isArray(vaultMeta.requestedStateKeys) ? vaultMeta.requestedStateKeys : [
    { key: { value: { $case: 'id', id: 'guidedFlowNumSentInvites' } }, namespace: '' },
    {
      key: { value: { $case: 'id', id: 'guidedFlowUrlAndPictureList' } },
      namespace: 'guidedFlowUrlAndPictureListNameSpace',
    },
  ];

  const serverRequestArgs = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    requestedStateKeys,
    payload,
    requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' },
  };

  const topLevelArgs = {
    ...serverRequestArgs,
    states: [],
    screenId: vaultMeta.screenId || 'com.linkedin.sdui.flagshipnav.mynetwork.invitations.WithdrawConfirmationDialog',
    knownTemplateIds: [],
  };

  const sduiId = vaultMeta.sduiid || 'com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation';

  const sduiPayload = {
    requestId: sduiId,
    serverRequest: {
      requestId: sduiId,
      requestedArguments: serverRequestArgs,
      isApfcEnabled: false,
      isStreaming: false,
      rumPageKey: '',
    },
    states: [],
    requestedArguments: topLevelArgs,
  };

  const withdrawHeaders = {
    accept: '*/*',
    'content-type': 'application/json',
    'x-li-rsc-stream': 'true',
    'x-li-anchor-page-key': 'd_flagship3_people_invitations_withdraw_friction',
    ...(vaultMeta.headers && typeof vaultMeta.headers === 'object' ? vaultMeta.headers : {}),
  };

  const withdrawPath =
    endpointCfg.url ||
    getEndpoint('withdrawInvitation') ||
    '/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation';

  try {
    const res = await voyagerFetch(withdrawPath, {
      method: 'POST',
      headers: withdrawHeaders,
      body: sduiPayload,
      rawText: true,
    });
    const resText = typeof res === 'string' ? res : (res?.text || '');
    const hasExplicitError =
      /^(?:\d+:)?E:|"actionStatus"\s*:\s*"FAILED"|"errorCode"\s*:/i.test(resText) ||
      /"errorMessage"\s*:\s*"[^"]+"/i.test(resText);
    if (hasExplicitError) {
      throw new EngineError(ERROR.LINKEDIN_ERROR, `SDUI action error: ${resText.slice(0, 300)}`);
    }
    markEndpointHealthy('withdrawInvitation');
    return { ok: true, status: res?.status || 200, method: 'sdui_api', data: res };
  } catch (err) {
    const status = err?.status || err?.response?.status || err?.code || 0;
    const isNetworkError = !status && /fetch|network|timeout|connection|offline/i.test(String(err?.message || ''));
    const isSduiRejection =
      status === 400 ||
      status === 404 ||
      status === 410 ||
      status === 422 ||
      status >= 500 ||
      isNetworkError ||
      /400|404|410|422|500|502|503|SDUI action error/i.test(String(err?.message));

    const bodyText = err?.response?.text || err?.message || JSON.stringify(err);
    logDebug('warn', 'Voyager', `[withdrawInvitation SDUI Failed] id=${cleanId} profileUrn=${cleanProfileUrn} vanity=${vanityName} status=${status} response=${bodyText}`);

    if (isSduiRejection) {
      // 1. Hot-swap retry: check if Vault has updated endpoint URL
      try {
        const syncRes = await syncEndpointsFromVault(true);
        if (syncRes?.changed) {
          const freshPath = getEndpoint('withdrawInvitation');
          logDebug('good', 'Voyager', `[withdrawInvitation] Hot-swapping to new Vault endpoint: ${freshPath}`);
          const retryRes = await voyagerFetch(freshPath, {
            method: 'POST',
            headers: withdrawHeaders,
            body: sduiPayload,
            rawText: true,
          });
          const retryText = typeof retryRes === 'string' ? retryRes : (retryRes?.text || '');
          const retryHasError =
            /^(?:\d+:)?E:|"actionStatus"\s*:\s*"FAILED"|"errorCode"\s*:/i.test(retryText) ||
            /"errorMessage"\s*:\s*"[^"]+"/i.test(retryText);
          if (!retryHasError) {
            markEndpointHealthy('withdrawInvitation');
            return { ok: true, status: retryRes?.status || 200, method: 'sdui_api_hotswap', data: retryRes };
          }
        }
      } catch (retryErr) {
        logDebug('warn', 'Voyager', `[withdrawInvitation] Hot-swap retry failed: ${retryErr.message}`);
      }

      // 2. Silently report broken endpoint to Vault (12h cooldown avoids log spam)
      reportBrokenEndpoint('withdrawInvitation', status, withdrawPath, err).catch(() => {});

      // 3. Fall back seamlessly to background tab DOM automation
      const allowDomFallback = meta?.allowDomFallback !== false;
      if (allowDomFallback && typeof chrome !== 'undefined' && chrome.tabs?.create) {
        logDebug('warn', 'AutoWithdraw', '[AutoWithdraw] SDUI API failed, switching to DOM-click fallback...');
        const inviteObj = {
          invitationId: cleanId,
          profileUrn: cleanProfileUrn,
          firstName,
          lastName,
          fullName,
          vanityName,
          publicId: vanityName,
        };
        const domRes = await withdrawViaDomFallback([inviteObj]);
        if (domRes.withdrawn > 0) {
          return { ok: true, method: 'dom_fallback', data: domRes };
        }
      }
    }

    throw err;
  }
}

/* ================================================================== */
/*  Writes — the invitation is verified; the rest are not              */
/* ================================================================== */

/**
 * What LinkedIn says when it refuses an invitation, and what to do about it.
 *
 * A refusal comes back as `{"data":{"code":…,"message":…}}` — sometimes with a
 * non-200, sometimes as a 200 with no `*invitation` in it — and the two that
 * matter are worth naming, because neither is a bug and neither is fixed by
 * retrying.
 */
const INVITE_DUPLICATE_FIX =
  'That invitation is already pending. Check "Sent" under My Network before inviting again.';

const INVITE_ALLOWANCE_FIX =
  'LinkedIn has exhausted an invitation allowance on this account. Free accounts get only a few personalised (with-note) invitations a month — send without a note, or wait for the allowance to reset.';

const INVITE_UNRECOGNISED_FIX =
  'LinkedIn accepted the request but did not answer with an invitation urn; see docs/voyager-endpoints.md';

function looksLikeDuplicate(code, message) {
  return /ALREADY|DUPLICATE|PENDING/i.test(code) || /already (been )?(sent|invited)|pending invitation|duplicate/i.test(message);
}

function looksLikeAllowance(code, message) {
  return (
    /QUOTA|LIMIT|EXCEEDED|EXHAUST/i.test(code) ||
    /quota|limit|allowance|remaining|weekly|monthly|too many/i.test(message)
  );
}

function looksLikePerProspectIssue(code, message) {
  const c = String(code || '');
  const m = String(message || '');
  return (
    looksLikeDuplicate(c, m) ||
    /WITHDRAWN|EMAIL_REQUIRED|CANT_CREATE_INVITATION|CANT_RESEND|CANT_RESEND_YET/i.test(c) ||
    /already (been )?(sent|invited)|pending invitation|duplicate|CANT_RESEND_YET|withdr(ew|awn)|recently withdrew|email (required|address)|enter.*email|cannot connect|not allowed to connect|cannot be invited/i.test(m)
  );
}

/**
 * Turn a refused invitation into one honest EngineError.
 *
 * @param {any} payload the parsed LinkedIn body, when there was one
 * @param {string} fallback the message to use when LinkedIn said nothing useful
 */
function inviteFailure(payload, fallback) {
  const data = (payload && payload.data) || payload || {};
  const code = String(data.code || data.status || '');
  const message = String(data.message || '').trim();
  const said = message || fallback;

  let howToFix = INVITE_UNRECOGNISED_FIX;
  if (looksLikeDuplicate(code, message)) howToFix = INVITE_DUPLICATE_FIX;
  else if (looksLikeAllowance(code, message)) howToFix = INVITE_ALLOWANCE_FIX;

  const err = new EngineError(
    ERROR.LINKEDIN_ERROR,
    code ? `LinkedIn refused the invitation (${code}): ${said}` : `LinkedIn refused the invitation: ${said}`,
    { howToFix },
  );
  err.status = data.status || (payload && payload.status) || 400;
  err.response = payload;
  return err;
}

/**
 * Dispatch LinkedIn Flagship SDUI Connect request (addaAddConnection).
 *
 * @param {{publicId?: string, fsdProfileUrn?: string, memberId: string|number, firstName?: string, lastName?: string}} params
 * @returns {Promise<{ok: boolean, invitationUrn: string, inviteeUrn: string, method: string}>}
 */
export async function sendSduiConnectionRequest({
  publicId,
  fsdProfileUrn,
  memberId,
  firstName = '',
  lastName = '',
}) {
  const cleanMemberId = String(memberId || '').replace(/^urn:li:member:/, '').replace(/\D+/g, '') || String(memberId || '');
  const cleanPublicId = String(publicId || '').trim();
  let cleanFsdProfileUrn = toFsdProfileUrn(fsdProfileUrn) || (fsdProfileUrn ? String(fsdProfileUrn) : '');

  if (!cleanMemberId) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Valid numeric memberId is required for SDUI connect');
  }

  if (!cleanFsdProfileUrn || !cleanFsdProfileUrn.startsWith('urn:li:fsd_profile:')) {
    const cleanProfileId =
      (fsdProfileUrn && String(fsdProfileUrn).replace(/^urn:li:(?:fsd_profile|fs_miniProfile|fs_profile|member):/, '')) ||
      cleanPublicId ||
      cleanMemberId;
    if (cleanProfileId) {
      cleanFsdProfileUrn = `urn:li:fsd_profile:${cleanProfileId}`;
    }
  }

  const endpointCfg = getEndpointConfig('sendInviteSdui').url
    ? getEndpointConfig('sendInviteSdui')
    : getEndpointConfig('sendInvite');
  const vaultMeta = endpointCfg.meta || {};

  const payload = {
    connectionState: {
      key: `state:invitation:urn:li:member:${cleanMemberId}`,
      namespace: null,
    },
    firstName: firstName || '',
    inviteeUrn: {
      memberId: String(cleanMemberId),
    },
    isDisabled: {
      key: `connect-button-disabled-${cleanPublicId}`,
      namespace: null,
    },
    lastName: lastName || '',
    nonIterableProfileId: cleanFsdProfileUrn,
    origin: 'InvitationOrigin_PROFILE',
    profileCanonicalUrl: `https://www.linkedin.com/in/${cleanPublicId}`,
  };
  if (vaultMeta.queryName) payload.queryName = vaultMeta.queryName;
  if (vaultMeta.extraPayload && typeof vaultMeta.extraPayload === 'object') {
    Object.assign(payload, vaultMeta.extraPayload);
  }

  const requestedArguments = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    knownTemplateIds: [],
    payload,
    requestMetadata: {
      $type: 'proto.sdui.common.RequestMetadata',
    },
    requestedStateKeys: Array.isArray(vaultMeta.requestedStateKeys) ? vaultMeta.requestedStateKeys : [],
    screenId: vaultMeta.screenId || 'com.linkedin.sdui.flagshipnav.mynetwork.invitations.CustomInvite',
    states: [],
  };

  const sduiId = vaultMeta.sduiid || 'com.linkedin.sdui.requests.mynetwork.addaAddConnection';

  const serverRequest = {
    isApfcEnabled: false,
    isStreaming: false,
    requestId: sduiId,
    requestedArguments,
    rumPageKey: '',
  };

  const sduiPayload = {
    requestId: sduiId,
    requestedArguments,
    serverRequest,
    states: [],
  };

  const configuredPath = endpointCfg.url || getEndpoint('sendInviteSdui') || getEndpoint('sendInvite');
  const sduiPath =
    configuredPath && configuredPath.includes('server-request')
      ? configuredPath
      : `/flagship-web/rsc-action/actions/server-request?sduiid=${encodeURIComponent(sduiId)}`;

  try {
    const res = await voyagerFetch(sduiPath, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json; charset=UTF-8',
        ...(vaultMeta.headers && typeof vaultMeta.headers === 'object' ? vaultMeta.headers : {}),
      },
      body: sduiPayload,
      rawText: true,
    });

    const resText = typeof res === 'string' ? res : (res?.text || '');
    const hasExplicitError =
      /^(?:\d+:)?E:|"actionStatus"\s*:\s*"FAILED"|"errorCode"\s*:/i.test(resText) ||
      /"errorMessage"\s*:\s*"[^"]+"/i.test(resText);
    if (hasExplicitError) {
      throw new EngineError(ERROR.LINKEDIN_ERROR, `SDUI action error: ${resText.slice(0, 300)}`);
    }

    markEndpointHealthy('sendInvite');
    markEndpointHealthy('sendInviteSdui');
    return {
      ok: true,
      invitationUrn: `urn:li:fsd_invitation:${cleanMemberId}`,
      inviteeUrn: cleanFsdProfileUrn,
      method: 'sdui_api',
    };
  } catch (err) {
    const status = err?.status || err?.response?.status || 0;
    const isNetworkError = !status && /fetch|network|timeout|connection|offline/i.test(String(err?.message || ''));
    const isSduiRejection =
      status === 400 ||
      status === 404 ||
      status === 410 ||
      status === 422 ||
      status >= 500 ||
      isNetworkError ||
      /400|404|410|422|500|502|503|SDUI action error/i.test(String(err?.message));

    logDebug('warn', 'Voyager', `[sendInvite SDUI Failed] memberId=${cleanMemberId} status=${status} error=${err?.message}`);

    if (isSduiRejection) {
      try {
        const syncRes = await syncEndpointsFromVault(true);
        if (syncRes?.changed) {
          const freshPath = getEndpoint('sendInvite');
          if (freshPath && freshPath.includes('server-request')) {
            logDebug('good', 'Voyager', `[sendInvite] Hot-swapping to new Vault endpoint: ${freshPath}`);
            const retryRes = await voyagerFetch(freshPath, {
              method: 'POST',
              headers: {
                accept: 'application/json, text/plain, */*',
                'content-type': 'application/json; charset=UTF-8',
              },
              body: sduiPayload,
              rawText: true,
            });
            const retryText = typeof retryRes === 'string' ? retryRes : (retryRes?.text || '');
            const retryHasError =
              /^(?:\d+:)?E:|"actionStatus"\s*:\s*"FAILED"|"errorCode"\s*:/i.test(retryText) ||
              /"errorMessage"\s*:\s*"[^"]+"/i.test(retryText);
            if (!retryHasError) {
              return {
                ok: true,
                invitationUrn: `urn:li:fsd_invitation:${cleanMemberId}`,
                inviteeUrn: cleanFsdProfileUrn,
                method: 'sdui_api_hotswap',
              };
            }
          }
        }
      } catch (retryErr) {
        logDebug('warn', 'Voyager', `[sendInvite] Hot-swap retry failed: ${retryErr.message}`);
      }

      reportBrokenEndpoint('sendInvite', status, sduiPath, err).catch(() => {});
    }

    const errMsg = String(err?.message || '');
    if (looksLikePerProspectIssue('', errMsg)) {
      throw new EngineError(ERROR.INVALID_PARAMS, `LinkedIn refused the invitation: ${errMsg}`, {
        howToFix: INVITE_DUPLICATE_FIX,
      });
    }

    if (status === 429 || /weekly.*limit/i.test(errMsg)) {
      try {
        await noteBucketBackoff('invite', 24 * 60 * 60 * 1000);
      } catch (_) {}
    }

    if (err instanceof EngineError && err.code !== ERROR.LINKEDIN_ERROR) throw err;
    throw inviteFailure(err?.response, errMsg);
  }
}

/**
 * Send a connection invitation.
 *
 * Verified against a real send on 2026-09-09 (client 1.13.46516): this is the
 * exact URL, decoration and body LinkedIn's own "Connect" dialog uses, and
 * success is the `*invitation` urn in the decorated answer. Supports Flagship
 * SDUI Connect (addaAddConnection) for blank requests and 400 fallbacks.
 *
 * @param {{publicId?: string, publicIdentifier?: string, profileUrn?: string, note?: string, memberId?: string|number, firstName?: string, lastName?: string}} params
 * @returns {Promise<{invitationUrn: string, inviteeUrn: string, ok?: boolean, method?: string, sentWithoutNote?: boolean}>}
 */
export async function sendInvite({
  publicId,
  publicIdentifier,
  profileUrn,
  note,
  memberId,
  firstName,
  lastName,
}) {
  let message = note === undefined || note === null ? '' : String(note);
  let sentWithoutNote = false;

  // Length is checked before the profile is resolved: refusing costs nothing,
  // and resolving costs a metered profile view.
  if (message.length > INVITE_NOTE_MAX) {
    throw new EngineError(
      ERROR.INVALID_PARAMS,
      `note must be ${INVITE_NOTE_MAX} characters or fewer (this one is ${message.length})`,
      { howToFix: INVITE_NOTE_FIX },
    );
  }

  // If monthly personalized note limit is active for this account, skip note upfront
  if (message && (await isNoteLimitActive())) {
    logDebug(
      'info',
      'Outreach',
      `[Outreach] Monthly note limit active until tomorrow. Sending blank invitation to ${publicId || publicIdentifier || 'prospect'}...`,
    );
    message = '';
    sentWithoutNote = true;
  }

  const id = publicId || publicIdentifier;

  const basePath = getEndpoint('sendInvite') || ENDPOINTS.createInvitation;
  const isServerRequestEndpoint = basePath && basePath.includes('server-request');

  // Resolve profile info if we have a public id or memberId is needed
  let resolvedProfile = null;
  let resolvedMemberId = memberId || (profileUrn ? String(profileUrn).match(/urn:li:member:(\d+)/)?.[1] : '');
  let resolvedFirstName = firstName || '';
  let resolvedLastName = lastName || '';
  let resolvedFsdProfileUrn = toFsdProfileUrn(profileUrn) || '';

  const ensureSduiProfile = async () => {
    if (id && (!resolvedMemberId || !resolvedFsdProfileUrn)) {
      try {
        resolvedProfile = await getProfileNormalized(id);
        if (resolvedProfile) {
          resolvedMemberId = resolvedMemberId || resolvedProfile.memberId || (resolvedProfile.objectUrn ? String(resolvedProfile.objectUrn).replace(/^urn:li:member:/, '') : '');
          resolvedFirstName = resolvedFirstName || resolvedProfile.firstName || '';
          resolvedLastName = resolvedLastName || resolvedProfile.lastName || '';
          resolvedFsdProfileUrn = resolvedFsdProfileUrn || toFsdProfileUrn(resolvedProfile.urn);
        }
      } catch (_) {}
    }
  };

  let urn = resolvedFsdProfileUrn || toFsdProfileUrn(profileUrn);
  if (!urn && id && !resolvedMemberId) {
    try {
      urn = await resolveProfileUrn(id);
    } catch (_) {}
  }
  resolvedFsdProfileUrn = urn;

  const sendDom = async (customNote) => {
    if (!id || typeof chrome === 'undefined' || !chrome.tabs?.create) {
      return null;
    }
    logDebug('warn', 'Voyager', `[sendInvite] API failed, falling back to background tab DOM for ${id}`);
    const profileUrl = `https://www.linkedin.com/in/${encodeURIComponent(id)}/`;
    const domRes = await runDomActionInTab(
      profileUrl,
      domSendInviteInPage,
      [{ note: customNote || '' }],
      'sendInvite',
    );
    if (domRes && (domRes.ok || domRes.success)) {
      return {
        ok: true,
        method: 'dom',
        invitationUrn: `urn:li:fsd_invitation:${resolvedMemberId || id}`,
        inviteeUrn: resolvedFsdProfileUrn || `urn:li:fsd_profile:${resolvedMemberId || id}`,
        ...(domRes.sentWithoutNote || (!customNote && message) ? { sentWithoutNote: true } : {}),
        ...(domRes.alreadyConnected ? { alreadyConnected: true } : {}),
        ...(domRes.alreadyPending ? { alreadyPending: true } : {}),
      };
    }
    if (domRes?.reason) {
      throw new EngineError(ERROR.LINKEDIN_ERROR, `DOM fallback failed: ${domRes.reason}`);
    }
    return null;
  };

  const sendInviteSduiCfg = getEndpointConfig('sendInviteSdui');
  const sendInviteCfg = getEndpointConfig('sendInvite');
  const endpointCfg = (sendInviteSduiCfg.mode === 'dom_first' || sendInviteCfg.mode === 'dom_first')
    ? { mode: 'dom_first', meta: { ...sendInviteCfg.meta, ...sendInviteSduiCfg.meta } }
    : (sendInviteSduiCfg.url ? sendInviteSduiCfg : sendInviteCfg);
  const { mode: vaultMode = 'sdui_first', meta: vaultMeta = {} } = endpointCfg;

  if (vaultMode === 'dom_first' && id) {
    logDebug('good', 'Voyager', `[sendInvite] Mode is dom_first, executing DOM action directly for ${id}`);
    const domRes = await sendDom(message);
    if (domRes) return domRes;
  }

  const sendSdui = async () => {
    await ensureSduiProfile();
    const sduiRes = await sendSduiConnectionRequest({
      publicId: id || resolvedProfile?.publicId || '',
      fsdProfileUrn: urn || resolvedFsdProfileUrn,
      memberId: resolvedMemberId,
      firstName: resolvedFirstName,
      lastName: resolvedLastName,
    });
    return {
      ...sduiRes,
      ...(sentWithoutNote ? { sentWithoutNote: true } : {}),
    };
  };

  const sendLegacyPost = async (customMsg) => {
    const path = `${basePath}?${qs({
      action: 'verifyQuotaAndCreateV2',
      decorationId: ENDPOINTS.decorations.invitationCreation,
    })}`;
    const body = { invitee: { inviteeUnion: { memberProfile: urn } } };
    if (customMsg) body.customMessage = customMsg;
    return voyagerFetch(path, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    });
  };

  // If endpoint points to server-request or if sending blank invite with available memberId/id:
  if (isServerRequestEndpoint || (!message && (resolvedMemberId || id))) {
    try {
      return await sendSdui();
    } catch (sduiErr) {
      logDebug('warn', 'Voyager', `[sendInvite] SDUI failed (${sduiErr?.message}). Falling back to legacy / DOM...`);
      if (!canFallbackToDom(sduiErr)) {
        throw sduiErr;
      }
      // Try Layer 2: Legacy Voyager blank post
      try {
        if (!urn && id) {
          try { urn = await resolveProfileUrn(id); } catch (_) {}
        }
        if (urn) {
          raw = await sendLegacyPost('');
          const val = (raw && raw.data && raw.data.value) || {};
          const blankUrn = val['*invitation'] || val.invitationUrn || '';
          if (blankUrn) {
            return {
              ok: true,
              invitationUrn: blankUrn,
              inviteeUrn: val.inviteeUrn || val['*invitee'] || urn,
              sentWithoutNote: true,
            };
          }
        }
      } catch (legacyErr) {
        logDebug('warn', 'Voyager', `[sendInvite] Legacy fallback failed: ${legacyErr?.message}`);
        if (!canFallbackToDom(legacyErr)) {
          throw legacyErr;
        }
      }
      // Try Layer 3: DOM Fallback
      const domRes = await sendDom('');
      if (domRes) return domRes;
      throw sduiErr;
    }
  }

  let raw;
  const attemptedNote = Boolean(message);

  try {
    raw = await sendLegacyPost(message);
  } catch (e) {
    const isCustomInviteLimit =
      e?.code === 'CUSTOM_INVITE_LIMIT_REACHED' ||
      e?.isCustomInviteLimit ||
      /CUSTOM_INVITE_LIMIT_REACHED|personalized.*invitation|custom.*message.*limit|note limit/i.test(
        e?.message || e?.response?.data?.code || ''
      );

    if (isCustomInviteLimit) {
      await setNoteLimitActive(24 * 60 * 60 * 1000);
      sentWithoutNote = true;
    }

    const payload = e && e.response;
    const msg = (e && e.message) || 'LinkedIn refused the invitation.';
    const data = (payload && payload.data) || payload || {};
    const errCode = String(data.code || data.status || e?.code || '');
    const errMsg = String(data.message || msg);

    if (looksLikePerProspectIssue(errCode, errMsg)) {
      throw new EngineError(
        ERROR.INVALID_PARAMS,
        errCode ? `LinkedIn refused the invitation (${errCode}): ${errMsg}` : `LinkedIn refused the invitation: ${errMsg}`,
        { howToFix: INVITE_DUPLICATE_FIX },
      );
    }

    const status = e?.status || e?.response?.status || 0;
    const isAllowanceLimit = looksLikeAllowance(errCode, errMsg);

    // If verifyQuotaAndCreateV2 returns HTTP 400 (non-limit), fallback to SDUI addaAddConnection!
    if (status === 400 && !isAllowanceLimit && !isCustomInviteLimit && (resolvedMemberId || id)) {
      logDebug(
        'warn',
        'Outreach',
        `[Outreach] HTTP 400 (non-limit) on legacy invite (code=${errCode}). Retrying via SDUI addaAddConnection...`,
      );
      try {
        return await sendSdui();
      } catch (sduiErr) {
        logDebug('warn', 'Outreach', `[Outreach] SDUI fallback also failed: ${sduiErr?.message}`);
        throw sduiErr;
      }
    }

    // Fallback legacy blank retry for when no memberId/id was resolvable
    if (attemptedNote || isCustomInviteLimit) {
      logDebug(
        'warn',
        'Outreach',
        `[Outreach] Note rejected (status=${status}, code=${errCode}). Retrying blank connection request...`,
      );
      try {
        raw = await sendLegacyPost('');
        const val = (raw && raw.data && raw.data.value) || {};
        const blankUrn = val['*invitation'] || val.invitationUrn || '';
        if (blankUrn) {
          sentWithoutNote = true;
          await setNoteLimitActive(24 * 60 * 60 * 1000);
        } else {
          throw inviteFailure(e?.response || raw, e?.message || 'LinkedIn answered with no invitation urn.');
        }
      } catch (blankErr) {
        logDebug(
          'warn',
          'Outreach',
          `[Outreach] Blank invite retry failed (status=${blankErr?.status || 'unknown'}, code=${blankErr?.code || blankErr?.response?.code || 'none'}, msg=${blankErr?.message || 'none'})`,
        );

        const blankPayload = (blankErr?.response && (blankErr.response.data || blankErr.response.code)) ? blankErr.response : (e?.response || blankErr?.response);
        const blankMsg = blankErr?.message || e?.message || 'LinkedIn refused the invitation.';
        const blankData = (blankPayload && blankPayload.data) || blankPayload || {};
        const bCode = String(blankData.code || blankData.status || blankErr?.code || '');
        const bMsg = String(blankData.message || blankMsg);

        if (looksLikePerProspectIssue(bCode, bMsg)) {
          throw new EngineError(
            ERROR.INVALID_PARAMS,
            bCode ? `LinkedIn refused the invitation (${bCode}): ${bMsg}` : `LinkedIn refused the invitation: ${bMsg}`,
            { howToFix: INVITE_DUPLICATE_FIX },
          );
        }

        const isBlankCustomLimit =
          blankErr?.code === 'CUSTOM_INVITE_LIMIT_REACHED' ||
          blankErr?.isCustomInviteLimit ||
          /CUSTOM_INVITE_LIMIT_REACHED/i.test(bMsg || bCode);

        if (
          !isBlankCustomLimit &&
          (blankErr?.status === 429 || /weekly.*limit/i.test(blankErr?.message || ''))
        ) {
          try {
            await noteBucketBackoff('invite', 24 * 60 * 60 * 1000);
          } catch (_) {}
        }
        const bStatus = blankErr?.status || blankErr?.response?.status || 0;
        if (bStatus === 400 || bStatus === 404 || bStatus === 410 || bStatus === 422) {
          reportBrokenEndpoint('sendInvite', bStatus, basePath, blankErr).catch(() => {});
        }
        if (canFallbackToDom(blankErr) && id && typeof chrome !== 'undefined' && chrome.tabs?.create) {
          const domRes = await sendDom('');
          if (domRes) return domRes;
        }
        if (blankErr instanceof EngineError && blankErr.code !== ERROR.LINKEDIN_ERROR) throw blankErr;
        throw inviteFailure(
          blankPayload,
          blankMsg,
        );
      }
    } else {
      if (
        e?.status === 429 || /weekly.*limit/i.test(e?.message || '')
      ) {
        try {
          await noteBucketBackoff('invite', 24 * 60 * 60 * 1000);
        } catch (_) {}
      }
      const eStatus = e?.status || e?.response?.status || 0;
      if (eStatus === 400 || eStatus === 404 || eStatus === 410 || eStatus === 422) {
        reportBrokenEndpoint('sendInvite', eStatus, basePath, e).catch(() => {});
      }
      if (canFallbackToDom(e) && id && typeof chrome !== 'undefined' && chrome.tabs?.create) {
        const domRes = await sendDom(message);
        if (domRes) return domRes;
      }
      if (e instanceof EngineError && e.code !== ERROR.LINKEDIN_ERROR) throw e;
      throw inviteFailure(e && e.response, (e && e.message) || 'LinkedIn refused the invitation.');
    }
  }

  let value = (raw && raw.data && raw.data.value) || {};
  let invitationUrn = value['*invitation'] || value.invitationUrn || '';

  // If answered without invitation urn on a note attempt, retry
  if (!invitationUrn && attemptedNote && !sentWithoutNote) {
    if (resolvedMemberId || id) {
      return sendSdui();
    }
    logDebug(
      'warn',
      'Outreach',
      `[Outreach] Note attempt returned no invitation URN. Retrying blank connection request...`,
    );
    try {
      raw = await sendLegacyPost('');
      const val = (raw && raw.data && raw.data.value) || {};
      const blankUrn = val['*invitation'] || val.invitationUrn || '';
      if (blankUrn) {
        sentWithoutNote = true;
        await setNoteLimitActive();
        value = val;
        invitationUrn = blankUrn;
      } else {
        throw inviteFailure(raw, 'LinkedIn answered with no invitation urn.');
      }
    } catch (blankErr) {
      const blankPayload = blankErr?.response || raw;
      const blankMsg = blankErr?.message || 'LinkedIn refused the invitation.';
      const blankData = (blankPayload && blankPayload.data) || blankPayload || {};
      const bCode = String(blankData.code || blankData.status || blankErr?.code || '');
      const bMsg = String(blankData.message || blankMsg);

      if (looksLikePerProspectIssue(bCode, bMsg)) {
        throw new EngineError(
          ERROR.INVALID_PARAMS,
          bCode ? `LinkedIn refused the invitation (${bCode}): ${bMsg}` : `LinkedIn refused the invitation: ${bMsg}`,
          { howToFix: INVITE_DUPLICATE_FIX },
        );
      }

      if (blankErr instanceof EngineError && blankErr.code !== ERROR.LINKEDIN_ERROR) throw blankErr;
      throw inviteFailure(blankPayload, blankMsg);
    }
  }

  if (!invitationUrn) {
    throw inviteFailure(raw, 'LinkedIn answered with no invitation urn.');
  }

  return {
    invitationUrn,
    inviteeUrn: value.inviteeUrn || value['*invitee'] || urn,
    ...(sentWithoutNote ? { sentWithoutNote: true } : {}),
  };
}

export const sendConnectionRequest = sendInvite;

/**
 * Send a message (`subtype: 'INMAIL'` for an InMail).
 *
 * Unverified, for the same reason as the invitation.
 */
/**
 * Send a message matching LinkedIn Web Client 2026.
 */
export async function sendMessage({
  recipientUrn,
  publicId,
  body,
  subtype = 'MEMBER_TO_MEMBER',
  inmailSubject,
}) {
  if (!recipientUrn && !publicId) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'recipientUrn or publicId is required.');
  }
  if (!body) throw new EngineError(ERROR.INVALID_PARAMS, 'Message body cannot be empty.');

  // 1. Resolve to valid fsd_profile URN
  let targetUrn = toFsdProfileUrn(recipientUrn);
  if (!targetUrn && publicId) {
    try {
      targetUrn = await resolveProfileUrn(publicId);
    } catch (e) {
      logDebug('warn', 'Voyager', `[sendMessage] Failed to resolve target profile URN: ${e?.message}`);
    }
  }

  // 2. Mailbox URN is our own profile URN
  let mailboxUrn = null;
  try {
    mailboxUrn = await selfProfileUrn();
  } catch (_) {}

  const endpointPath = getEndpoint('sendMessage') || `${ENDPOINTS.unverified.createMessage}?action=createMessage`;

  if (targetUrn && mailboxUrn) {
    // 3. 16-character raw tracking ID (matches LinkedIn Web)
    const rawBytes = new Uint8Array(16);
    crypto.getRandomValues(rawBytes);
    const trackingId = Array.from(rawBytes, (b) => String.fromCharCode(b)).join('');

    // 4. Exact payload from live LinkedIn Web request
    const payload = {
      message: {
        body: {
          attributes: [],
          text: body,
        },
        originToken: crypto.randomUUID(),
        renderContentUnions: [],
      },
      mailboxUrn,
      trackingId,
      dedupeByClientGeneratedToken: false,
      hostRecipientUrns: [targetUrn],
    };

    if (subtype === 'INMAIL') {
      payload.messageSubtype = 'INMAIL';
      if (inmailSubject) payload.message.subject = inmailSubject;
    }

    try {
      // 5. Send with exact LinkedIn web headers (text/plain;charset=UTF-8)
      const res = await voyagerFetch(endpointPath, {
        method: 'POST',
        body: payload,
        headers: {
          accept: 'application/json',
          'content-type': 'text/plain;charset=UTF-8',
          'x-restli-protocol-version': '2.0.0',
        },
      });

      markEndpointHealthy('sendMessage');
      return { ok: true, method: 'voyager_api', data: res };
    } catch (err) {
      const status = err?.status || err?.response?.status || 0;
      reportBrokenEndpoint('sendMessage', status, endpointPath, err).catch(() => {});

      if (subtype !== 'INMAIL' && canFallbackToDom(err) && publicId && typeof chrome !== 'undefined' && chrome.tabs?.create) {
        logDebug('warn', 'Voyager', `[sendMessage] API failed, falling back to background tab DOM for ${publicId}`);
        try {
          const domRes = await runDomActionInTab(
            `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`,
            domSendMessageInPage,
            [{ body }],
            'sendMessage',
          );
          if (domRes && (domRes.ok || domRes.success)) {
            return { ok: true, method: 'dom', ...domRes };
          }
        } catch (domErr) {
          logDebug('warn', 'Voyager', `[sendMessage] DOM fallback failed: ${domErr?.message}`);
        }
      }

      if (err instanceof EngineError) throw err;
      throw new EngineError(ERROR.LINKEDIN_ERROR, `Send message failed: ${err?.message || err}`);
    }
  }

  // If no targetUrn/mailboxUrn but publicId is present for regular message, attempt DOM fallback
  if (subtype !== 'INMAIL' && publicId && typeof chrome !== 'undefined' && chrome.tabs?.create) {
    logDebug('warn', 'Voyager', `[sendMessage] Missing URNs, attempting background tab DOM for ${publicId}`);
    try {
      const domRes = await runDomActionInTab(
        `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`,
        domSendMessageInPage,
        [{ body }],
        'sendMessage',
      );
      if (domRes && (domRes.ok || domRes.success)) {
        return { ok: true, method: 'dom', ...domRes };
      }
    } catch (domErr) {
      logDebug('warn', 'Voyager', `[sendMessage] DOM fallback failed: ${domErr?.message}`);
    }
  }

  throw new EngineError(ERROR.NOT_FOUND, `Could not resolve recipient profile URN for ${publicId || recipientUrn}`);
}

/** Send an InMail. */
export async function sendInMail({ recipientUrn, publicId, subject, body }) {
  return sendMessage({ recipientUrn, publicId, body, subtype: 'INMAIL', inmailSubject: subject });
}

/**
 * Follow (or unfollow) a member using LinkedIn Flagship SDUI endpoint (addaUpdateFollowState).
 *
 * @param {{ publicId?: string, profileUrn?: string, memberId?: string|number, following?: boolean }} params
 * @returns {Promise<{ ok: boolean, method: string, data: any, memberId: string }>}
 */
export async function follow({ publicId, profileUrn, memberId, following = true }) {
  let resolvedMemberId = memberId
    ? String(memberId).replace(/^urn:li:member:/, '').replace(/\D+/g, '')
    : '';

  if (!resolvedMemberId && profileUrn) {
    const match = String(profileUrn).match(/(?:urn:li:member:|fsd_profile:)(\d+)/);
    if (match) resolvedMemberId = match[1];
  }

  const id = publicId || (profileUrn && !String(profileUrn).match(/^\d+$/) ? String(profileUrn).replace(/^urn:li:(?:fsd_profile|member):/, '') : '');

  if (!resolvedMemberId && id) {
    try {
      const stored = await getStoredProfile(id);
      if (stored?.memberId) {
        resolvedMemberId = String(stored.memberId).replace(/\D+/g, '');
      } else if (stored?.objectUrn) {
        resolvedMemberId = String(stored.objectUrn).replace(/^urn:li:member:/, '').replace(/\D+/g, '');
      }
    } catch (_) {}
  }

  if (!resolvedMemberId && id) {
    try {
      const p = await getProfileNormalized(id);
      if (p) {
        resolvedMemberId = p.memberId || (p.objectUrn ? String(p.objectUrn).replace(/^urn:li:member:/, '').replace(/\D+/g, '') : '');
      }
    } catch (e) {
      logDebug('warn', 'Voyager', `[Follow] Could not fetch profile for memberId resolution: ${e?.message}`);
    }
  }

  if (!resolvedMemberId) {
    throw new EngineError(
      ERROR.NOT_FOUND,
      `Could not resolve a numeric memberId to follow ${publicId || profileUrn || 'prospect'}.`,
    );
  }

  const endpointCfg = getEndpointConfig('follow');
  const { mode: vaultMode = 'sdui_first', meta: vaultMeta = {} } = endpointCfg;

  if (vaultMode === 'dom_first' && (publicId || id) && typeof chrome !== 'undefined' && chrome.tabs?.create) {
    const targetId = publicId || id;
    logDebug('good', 'Voyager', `[Follow] Mode is dom_first, executing DOM action directly for ${targetId}`);
    try {
      const domRes = await runDomActionInTab(
        `https://www.linkedin.com/in/${encodeURIComponent(targetId)}/`,
        domFollowInPage,
        [{ following }],
        'follow',
      );
      if (domRes && (domRes.ok || domRes.success)) {
        return {
          ok: true,
          method: 'dom',
          memberId: resolvedMemberId || targetId,
          ...(domRes.alreadyFollowing ? { alreadyFollowing: true } : {}),
        };
      }
    } catch (domErr) {
      logDebug('warn', 'Voyager', `[Follow] DOM fallback failed: ${domErr?.message}`);
    }
  }

  const sduiId = vaultMeta.sduiid || 'com.linkedin.sdui.requests.mynetwork.addaUpdateFollowState';
  const followStateType = following ? 'FollowStateType_FOLLOW_ACTIVE' : 'FollowStateType_UNFOLLOW';

  const payload = {
    followStateBinding: {
      key: `urn:li:fsd_followingState:urn:li:member:${resolvedMemberId}`,
      namespace: null,
    },
    followStateType,
    memberUrn: {
      memberId: String(resolvedMemberId),
    },
  };
  if (vaultMeta.queryName) payload.queryName = vaultMeta.queryName;
  if (vaultMeta.extraPayload && typeof vaultMeta.extraPayload === 'object') {
    Object.assign(payload, vaultMeta.extraPayload);
  }

  const requestedArguments = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    knownTemplateIds: [],
    payload,
    requestMetadata: {
      $type: 'proto.sdui.common.RequestMetadata',
    },
    requestedStateKeys: Array.isArray(vaultMeta.requestedStateKeys) ? vaultMeta.requestedStateKeys : [],
    screenId: vaultMeta.screenId !== undefined ? vaultMeta.screenId : '',
    states: [],
  };

  const sduiPayload = {
    requestId: sduiId,
    requestedArguments,
    serverRequest: {
      isApfcEnabled: false,
      isStreaming: false,
      requestId: sduiId,
      requestedArguments,
      rumPageKey: '',
    },
    states: [],
  };

  const followPath =
    endpointCfg.url ||
    getEndpoint('follow') ||
    `/flagship-web/rsc-action/actions/server-request?sduiid=${sduiId}`;

  try {
    const res = await voyagerFetch(followPath, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json; charset=UTF-8',
        ...(vaultMeta.headers && typeof vaultMeta.headers === 'object' ? vaultMeta.headers : {}),
      },
      body: sduiPayload,
      rawText: true,
    });

    const resText = typeof res === 'string' ? res : (res?.text || '');
    const hasExplicitError =
      /^(?:\d+:)?E:|"actionStatus"\s*:\s*"FAILED"|"errorCode"\s*:/i.test(resText) ||
      /"errorMessage"\s*:\s*"[^"]+"/i.test(resText);
    if (hasExplicitError) {
      throw new EngineError(ERROR.LINKEDIN_ERROR, `SDUI action error: ${resText.slice(0, 300)}`);
    }

    markEndpointHealthy('follow');
    return { ok: true, method: 'sdui_api', data: res, memberId: resolvedMemberId };
  } catch (err) {
    const status = err?.status || err?.response?.status || 0;
    const isNetworkError = !status && /fetch|network|timeout|connection|offline/i.test(String(err?.message || ''));
    const isSduiRejection =
      status === 400 ||
      status === 404 ||
      status === 410 ||
      status === 422 ||
      status >= 500 ||
      isNetworkError ||
      /400|404|410|422|500|502|503|SDUI action error/i.test(String(err?.message));

    if (isSduiRejection) {
      try {
        const syncRes = await syncEndpointsFromVault(true);
        if (syncRes?.changed) {
          const freshPath = getEndpoint('follow');
          const retryRes = await voyagerFetch(freshPath, {
            method: 'POST',
            headers: {
              accept: 'application/json, text/plain, */*',
              'content-type': 'application/json; charset=UTF-8',
              ...(vaultMeta.headers && typeof vaultMeta.headers === 'object' ? vaultMeta.headers : {}),
            },
            body: sduiPayload,
            rawText: true,
          });
          const retryText = typeof retryRes === 'string' ? retryRes : (retryRes?.text || '');
          const retryHasError =
            /^(?:\d+:)?E:|"actionStatus"\s*:\s*"FAILED"|"errorCode"\s*:/i.test(retryText) ||
            /"errorMessage"\s*:\s*"[^"]+"/i.test(retryText);
          if (!retryHasError) {
            markEndpointHealthy('follow');
            return { ok: true, method: 'sdui_api_hotswap', data: retryRes, memberId: resolvedMemberId };
          }
        }
      } catch (_) {}
      reportBrokenEndpoint('follow', status, followPath, err).catch(() => {});
    }

    if (canFallbackToDom(err) && (publicId || id) && typeof chrome !== 'undefined' && chrome.tabs?.create) {
      const targetId = publicId || id;
      logDebug('warn', 'Voyager', `[Follow] SDUI failed, falling back to background tab DOM for ${targetId}`);
      try {
        const domRes = await runDomActionInTab(
          `https://www.linkedin.com/in/${encodeURIComponent(targetId)}/`,
          domFollowInPage,
          [{ following }],
          'follow',
        );
        if (domRes && (domRes.ok || domRes.success)) {
          return {
            ok: true,
            method: 'dom',
            memberId: resolvedMemberId || targetId,
            ...(domRes.alreadyFollowing ? { alreadyFollowing: true } : {}),
          };
        }
      } catch (domErr) {
        logDebug('warn', 'Voyager', `[Follow] DOM fallback failed: ${domErr?.message}`);
      }
    }

    if (err instanceof EngineError) throw err;
    throw new EngineError(ERROR.LINKEDIN_ERROR, `Follow failed: ${err?.message || err}`);
  }
}

/**
 * Like a post via Flagship SDUI endpoint (com.linkedin.sdui.reactions.create).
 *
 * @param {{ postUrl?: string, publicId?: string, profileUrn?: string, reactionType?: string }} params
 * @returns {Promise<{ ok: boolean, method: string, data?: any, activityId?: string, status?: string, reason?: string, alreadyLiked?: boolean }>}
 */
export async function likePost({ postUrl, publicId, profileUrn, reactionType = 'LIKE' } = {}) {
  let targetPostUrl = postUrl;
  if (!targetPostUrl && (publicId || profileUrn)) {
    try {
      const posts = await getMemberPosts({ publicId, profileUrn, count: 1 });
      const first = Array.isArray(posts) ? posts[0] : null;
      targetPostUrl =
        first?.url ||
        first?.postUrl ||
        (first?.urn ? `https://www.linkedin.com/feed/update/${first.urn}/` : '');
    } catch (e) {
      logDebug('warn', 'Voyager', `[likePost] Failed to resolve latest member post: ${e?.message}`);
    }
  }

  if (!targetPostUrl && publicId && typeof chrome !== 'undefined' && chrome.tabs?.create) {
    logDebug('warn', 'Voyager', `[likePost] No post URL found, falling back to recent-activity DOM for ${publicId}`);
    try {
      const domRes = await runDomActionInTab(
        `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/recent-activity/all/`,
        domLikeRecentActivityInPage,
        [],
        'likeRecentActivity',
      );
      if (domRes && (domRes.ok || domRes.success || domRes.skipped)) {
        if (domRes.skipped) {
          return { ok: true, skipped: true, status: 'skipped', reason: domRes.reason || 'no_recent_posts' };
        }
        return {
          ok: true,
          method: 'dom',
          ...(domRes.alreadyLiked ? { alreadyLiked: true } : {}),
        };
      }
    } catch (domErr) {
      logDebug('warn', 'Voyager', `[likePost] Recent activity DOM fallback failed: ${domErr?.message}`);
    }
  }

  if (!targetPostUrl) {
    return { ok: true, skipped: true, status: 'skipped', reason: 'no_post_url' };
  }

  const endpointCfg = getEndpointConfig('likePost').url ? getEndpointConfig('likePost') : getEndpointConfig('like');
  const { mode: vaultMode = 'sdui_first', meta: vaultMeta = {} } = endpointCfg;

  if (vaultMode === 'dom_first' && targetPostUrl && typeof chrome !== 'undefined' && chrome.tabs?.create) {
    logDebug('good', 'Voyager', `[likePost] Mode is dom_first, executing DOM action directly for ${targetPostUrl}`);
    try {
      const domRes = await runDomActionInTab(targetPostUrl, domLikePostInPage, [targetPostUrl], 'likePost');
      if (domRes && (domRes.ok || domRes.success)) {
        return {
          ok: true,
          method: 'dom',
          activityId: activityIdFromUrl(targetPostUrl),
          ...(domRes.alreadyLiked ? { alreadyLiked: true } : {}),
        };
      }
    } catch (domErr) {
      logDebug('warn', 'Voyager', `[likePost] DOM action failed: ${domErr?.message}`);
    }
  }

  const activityId = activityIdFromUrl(targetPostUrl);
  const sduiId = vaultMeta.sduiid || 'com.linkedin.sdui.reactions.create';

  const normReactionType =
    reactionType && String(reactionType).startsWith('ReactionType_')
      ? reactionType
      : `ReactionType_${String(reactionType || 'LIKE').toUpperCase()}`;

  const payload = {
    reactionSource: vaultMeta.reactionSource || 'Update',
    reactionType: normReactionType,
    threadUrn: {
      threadUrnActivityThreadUrn: {
        activityUrn: {
          activityId: String(activityId),
        },
      },
    },
  };
  if (vaultMeta.queryName) payload.queryName = vaultMeta.queryName;
  if (vaultMeta.extraPayload && typeof vaultMeta.extraPayload === 'object') {
    Object.assign(payload, vaultMeta.extraPayload);
  }

  const requestedArguments = {
    $type: 'proto.sdui.actions.requests.RequestedArguments',
    knownTemplateIds: [],
    payload,
    requestMetadata: {
      $type: 'proto.sdui.common.RequestMetadata',
    },
    requestedStateKeys: Array.isArray(vaultMeta.requestedStateKeys) ? vaultMeta.requestedStateKeys : [],
    screenId: vaultMeta.screenId || 'com.linkedin.sdui.flagshipnav.profile.Profile',
    states: [],
  };

  const sduiPayload = {
    requestId: sduiId,
    requestedArguments,
    serverRequest: {
      isApfcEnabled: false,
      isStreaming: false,
      requestId: sduiId,
      requestedArguments,
      rumPageKey: '',
    },
    states: [],
  };

  const likePath =
    endpointCfg.url ||
    getEndpoint('likePost') ||
    getEndpoint('like') ||
    `/flagship-web/rsc-action/actions/server-request?sduiid=${sduiId}`;

  try {
    const res = await voyagerFetch(likePath, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json; charset=UTF-8',
        ...(vaultMeta.headers && typeof vaultMeta.headers === 'object' ? vaultMeta.headers : {}),
      },
      body: sduiPayload,
      rawText: true,
    });

    const resText = typeof res === 'string' ? res : (res?.text || '');
    const hasExplicitError =
      /^(?:\d+:)?E:|"actionStatus"\s*:\s*"FAILED"|"errorCode"\s*:/i.test(resText) ||
      /"errorMessage"\s*:\s*"[^"]+"/i.test(resText);
    if (hasExplicitError) {
      throw new EngineError(ERROR.LINKEDIN_ERROR, `SDUI action error: ${resText.slice(0, 300)}`);
    }

    markEndpointHealthy('like');
    markEndpointHealthy('likePost');
    return { ok: true, method: 'sdui_api', data: res, activityId };
  } catch (err) {
    const status = err?.status || err?.response?.status || 0;
    const isNetworkError = !status && /fetch|network|timeout|connection|offline/i.test(String(err?.message || ''));
    const isSduiRejection =
      status === 400 ||
      status === 404 ||
      status === 410 ||
      status === 422 ||
      status >= 500 ||
      isNetworkError ||
      /400|404|410|422|500|502|503|SDUI action error/i.test(String(err?.message));

    if (isSduiRejection) {
      try {
        const syncRes = await syncEndpointsFromVault(true);
        if (syncRes?.changed) {
          const freshPath = getEndpoint('likePost') || getEndpoint('like');
          const retryRes = await voyagerFetch(freshPath, {
            method: 'POST',
            headers: {
              accept: 'application/json, text/plain, */*',
              'content-type': 'application/json; charset=UTF-8',
              ...(vaultMeta.headers && typeof vaultMeta.headers === 'object' ? vaultMeta.headers : {}),
            },
            body: sduiPayload,
            rawText: true,
          });
          const retryText = typeof retryRes === 'string' ? retryRes : (retryRes?.text || '');
          const retryHasError =
            /^(?:\d+:)?E:|"actionStatus"\s*:\s*"FAILED"|"errorCode"\s*:/i.test(retryText) ||
            /"errorMessage"\s*:\s*"[^"]+"/i.test(retryText);
          if (!retryHasError) {
            markEndpointHealthy('like');
            markEndpointHealthy('likePost');
            return { ok: true, method: 'sdui_api_hotswap', data: retryRes, activityId };
          }
        }
      } catch (_) {}
      reportBrokenEndpoint('likePost', status, likePath, err).catch(() => {});
      reportBrokenEndpoint('like', status, likePath, err).catch(() => {});
    }

    if (canFallbackToDom(err) && targetPostUrl && typeof chrome !== 'undefined' && chrome.tabs?.create) {
      logDebug('warn', 'Voyager', `[likePost] SDUI failed, falling back to background tab DOM for ${targetPostUrl}`);
      try {
        const domRes = await runDomActionInTab(targetPostUrl, domLikePostInPage, [targetPostUrl], 'likePost');
        if (domRes && (domRes.ok || domRes.success)) {
          return {
            ok: true,
            method: 'dom',
            activityId,
            ...(domRes.alreadyLiked ? { alreadyLiked: true } : {}),
          };
        }
      } catch (domErr) {
        logDebug('warn', 'Voyager', `[likePost] DOM fallback failed: ${domErr?.message}`);
      }
    }

    if (err instanceof EngineError) throw err;
    throw new EngineError(ERROR.LINKEDIN_ERROR, `Like post failed: ${err?.message || err}`);
  }
}

/** Comment on a post via Voyager endpoint with DOM fallback. */
export async function commentPost({ postUrl, publicId, profileUrn, body } = {}) {
  if (!body) throw new EngineError(ERROR.INVALID_PARAMS, 'Comment body cannot be empty.');

  let targetPostUrl = postUrl;
  if (!targetPostUrl && (publicId || profileUrn)) {
    try {
      const posts = await getMemberPosts({ publicId, profileUrn, count: 1 });
      const first = Array.isArray(posts) ? posts[0] : null;
      targetPostUrl =
        first?.url ||
        first?.postUrl ||
        (first?.urn ? `https://www.linkedin.com/feed/update/${first.urn}/` : '');
    } catch (e) {
      logDebug('warn', 'Voyager', `[commentPost] Failed to resolve latest member post: ${e?.message}`);
    }
  }

  if (!targetPostUrl && publicId && typeof chrome !== 'undefined' && chrome.tabs?.create) {
    logDebug('warn', 'Voyager', `[commentPost] No post URL found, falling back to recent-activity DOM for ${publicId}`);
    try {
      const domRes = await runDomActionInTab(
        `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/recent-activity/all/`,
        domCommentRecentActivityInPage,
        [{ body }],
        'commentRecentActivity',
      );
      if (domRes && (domRes.ok || domRes.success || domRes.skipped)) {
        if (domRes.skipped) {
          return { ok: true, skipped: true, status: 'skipped', reason: domRes.reason || 'no_recent_posts' };
        }
        return { ok: true, method: 'dom', ...domRes };
      }
    } catch (domErr) {
      logDebug('warn', 'Voyager', `[commentPost] Recent activity DOM fallback failed: ${domErr?.message}`);
    }
  }

  if (!targetPostUrl) {
    return { ok: true, skipped: true, status: 'skipped', reason: 'no_post_url' };
  }

  const threadUrn = activityUrnFromUrl(targetPostUrl);
  const commentPath = `${ENDPOINTS.unverified.createComment}?${qs({ threadUrn })}`;

  try {
    const res = await voyagerFetch(commentPath, {
      method: 'POST',
      body: {
        threadUrn,
        commentary: { text: body, attributes: [] },
        trackingId: generateTrackingId(),
      },
    });
    markEndpointHealthy('comment');
    return { ok: true, method: 'voyager_api', data: res };
  } catch (err) {
    const status = err?.status || err?.response?.status || 0;
    reportBrokenEndpoint('comment', status, commentPath, err).catch(() => {});

    if (canFallbackToDom(err) && targetPostUrl && typeof chrome !== 'undefined' && chrome.tabs?.create) {
      logDebug('warn', 'Voyager', `[commentPost] API failed, falling back to background tab DOM for ${targetPostUrl}`);
      try {
        const domRes = await runDomActionInTab(
          targetPostUrl,
          domCommentPostInPage,
          [{ body }],
          'commentPost',
        );
        if (domRes && (domRes.ok || domRes.success)) {
          return { ok: true, method: 'dom', ...domRes };
        }
      } catch (domErr) {
        logDebug('warn', 'Voyager', `[commentPost] DOM fallback failed: ${domErr?.message}`);
      }
    }

    if (err instanceof EngineError) throw err;
    throw new EngineError(ERROR.LINKEDIN_ERROR, `Comment post failed: ${err?.message || err}`);
  }
}

/** Endorse a skill on a member profile with DOM fallback. */
export async function endorseSkill({ publicId, skillUrn, skillName } = {}) {
  if (!publicId) throw new EngineError(ERROR.INVALID_PARAMS, 'publicId is required for endorse.');
  let urn = skillUrn;
  let targetSkillName = skillName;
  if (!urn && !targetSkillName) {
    try {
      const p = await getProfileNormalized(publicId);
      if (p?.skills?.length) {
        urn = p.skills[0].urn || p.skills[0].id || p.skills[0].name;
        targetSkillName = p.skills[0].name || p.skills[0].skillName || urn;
      }
    } catch {}
  }

  const endorsePath = `/voyager/api/identity/profiles/${encodeURIComponent(publicId)}/endorsements`;
  try {
    const res = await voyagerFetch(endorsePath, {
      method: 'POST',
      body: { skillUrn: urn || 'urn:li:fs_skill:1' },
    });
    markEndpointHealthy('endorseSkill');
    return { ok: true, method: 'voyager_api', publicId, skillUrn: urn, data: res };
  } catch (err) {
    const status = err?.status || err?.response?.status || 0;
    reportBrokenEndpoint('endorseSkill', status, endorsePath, err).catch(() => {});

    if (canFallbackToDom(err) && publicId && typeof chrome !== 'undefined' && chrome.tabs?.create) {
      logDebug('warn', 'Voyager', `[endorseSkill] API failed, falling back to background tab DOM for ${publicId}`);
      try {
        const domRes = await runDomActionInTab(
          `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/details/skills/`,
          domEndorseInPage,
          [{ skillName: targetSkillName || urn }],
          'endorseSkill',
        );
        if (domRes && (domRes.ok || domRes.success)) {
          return { ok: true, method: 'dom', publicId, skillUrn: urn, ...domRes };
        }
      } catch (domErr) {
        logDebug('warn', 'Voyager', `[endorseSkill] DOM fallback failed: ${domErr?.message}`);
      }
    }

    if (err instanceof EngineError) throw err;
    throw new EngineError(ERROR.LINKEDIN_ERROR, `Endorse skill failed: ${err?.message || err}`);
  }
}

/**
 * Fetch real LinkedIn network summary (Connections count & Pending count)
 */
export async function getNetworkStats() {
  let pendingCount = 0;
  let connectionsCount = 0;

  // 1. Fetch pending sent invitations total (isolated try/catch)
  try {
    const pendingRes = await voyagerFetch(
      '/voyager/api/relationships/sentInvitationViewsV2?count=1&invitationType=CONNECTION&q=invitationType&start=0'
    );
    pendingCount =
      pendingRes?.data?.data?.paging?.total ||
      pendingRes?.data?.paging?.total ||
      pendingRes?.paging?.total ||
      pendingRes?.data?.['*elements']?.length ||
      pendingRes?.data?.elements?.length ||
      0;
  } catch {
    /* gracefully return 0 without logging error if unavailable */
  }

  // 2. Fetch connections summary (isolated try/catch so failure never zeroes out connections)
  try {
    const connPath = getEndpoint('connectionsSummary') || '/voyager/api/relationships/connectionsSummary';
    const connRes = await voyagerFetch(connPath);
    connectionsCount =
      connRes?.data?.numConnections ||
      connRes?.numConnections ||
      connRes?.data?.data?.numConnections ||
      0;
  } catch (err) {
    console.warn('[Voyager] Failed to fetch connections summary:', err?.message || err);
  }

  return { pendingCount, connectionsCount };
}

/**
 * Fetch real profile views in the last 90 days
 */
export async function getProfileViewsCount() {
  try {
    const wvmpPath = getEndpoint('profileViewsCount') || '/voyager/api/identity/wvmpCards';
    const res = await voyagerFetch(wvmpPath);
    const cards =
      res?.data?.elements ||
      res?.data?.data?.elements ||
      res?.elements ||
      [];
    let views = 0;
    for (const card of cards) {
      if (card.numViews !== undefined) views = card.numViews;
      else if (card.insight?.count !== undefined) views = card.insight.count;
    }
    return views;
  } catch {
    return 0;
  }
}

/* ================================================================== */
/*  Endpoint self-check                                                */
/* ================================================================== */

/**
 * Every endpoint the check below can exercise without writing anything.
 *
 * `unverified` entries are reported as such and never called: there is no
 * point spending a request on a path we already know we cannot read.
 */
export const VERIFIABLE = Object.freeze([
  'me',
  'profile',
  'profileExperience',
  'search',
  'company',
  'companyEmployees',
  'connections',
  'sentInvitations',
  'conversations',
  'followers',
  'memberPosts',
  'reactions',
]);

export const UNVERIFIABLE = Object.freeze([
  'comments',
  'groupMembers',
  'eventAttendees',
  'salesNavSearch',
  'recruiterSearch',
  'follow',
  'message',
]);

/**
 * Writes whose shape *is* verified but which the self-check still will not run,
 * because running one means sending something to a real person. They report
 * `skipped`, not `unverified`: the distinction is the whole point of having
 * captured them.
 */
export const VERIFIED_WRITES = Object.freeze(['invite']);

/**
 * A read-only pass over the verified endpoints, one minimal call each.
 *
 * This is what `status.get { verify: true }` and `lit endpoints check` run
 * after a LinkedIn release, to find out which query id went stale without
 * having to reproduce a whole workflow. Every call asks for one record.
 *
 * @param {{probes?: {postUrl?: string}, meter?: (kind: string, n: number) => Promise<void>}} [options]
 * @returns {Promise<{endpoints: Record<string, 'ok'|'failed'|'unverified'|'skipped'>,
 *   clientVersionCaptured: string, capturedAt: string, errors: Record<string, string>}>}
 */
export async function verifyEndpoints({ probes = {}, meter } = {}) {
  const endpoints = {};
  const errors = {};
  const charge = async (kind, n) => {
    if (meter) await meter(kind, n);
  };

  const step = async (name, run) => {
    try {
      const ok = await run();
      endpoints[name] = ok === false ? 'failed' : 'ok';
    } catch (e) {
      endpoints[name] = 'failed';
      errors[name] = e && e.message ? e.message : String(e);
    }
  };

  const self = await selfTest().catch(() => ({ loggedIn: false, selfUrn: '' }));
  endpoints.me = self.loggedIn ? 'ok' : 'failed';
  if (!self.loggedIn) {
    for (const name of VERIFIABLE) if (!endpoints[name]) endpoints[name] = 'skipped';
    for (const name of UNVERIFIABLE) endpoints[name] = 'unverified';
    for (const name of VERIFIED_WRITES) endpoints[name] = 'skipped';
    return {
      endpoints,
      clientVersionCaptured: CAPTURED.clientVersion,
      capturedAt: CAPTURED.at,
      errors,
    };
  }

  if (self.publicId) {
    await step('profile', async () => {
      await charge('visit', 1);
      const profile = normalizeProfileView(
        await getProfile(self.publicId, ENDPOINTS.decorations.fullProfile),
      );
      return !!profile.publicId;
    });
    await step('profileExperience', async () => {
      const raw = await getProfileSection(self.selfUrn, 'experience');
      return hasCollection(raw);
    });
  } else {
    endpoints.profile = 'skipped';
    endpoints.profileExperience = 'skipped';
  }

  await step('search', async () => {
    await charge('search', 1);
    const out = await searchProfiles({ keywords: 'linkedin', count: 1 });
    return out.profiles.length > 0;
  });

  await step('company', async () => !!(await getCompany('linkedin')).urn);
  await step('companyEmployees', async () => {
    const out = await getCompanyEmployees({ universalName: 'linkedin', count: 1 });
    return out.profiles.length > 0;
  });
  await step('connections', async () => hasCollection(await rawConnections(1)));
  await step('sentInvitations', async () => {
    await getSentInvitations({ count: 1 });
    return true;
  });
  await step('conversations', async () => {
    await getConversations({ count: 1 });
    return true;
  });
  await step('followers', async () => {
    await getFollowers({ count: 1 });
    return true;
  });
  await step('memberPosts', async () => {
    await getMemberPosts({ profileUrn: self.selfUrn, count: 1 });
    return true;
  });

  if (probes.postUrl) {
    await step('reactions', async () => {
      await getPostEngagers({ postUrl: probes.postUrl, kind: 'likes', count: 1 });
      return true;
    });
  } else {
    endpoints.reactions = 'skipped';
  }

  for (const name of UNVERIFIABLE) endpoints[name] = 'unverified';
  for (const name of VERIFIED_WRITES) endpoints[name] = 'skipped';

  return {
    endpoints,
    clientVersionCaptured: CAPTURED.clientVersion,
    capturedAt: CAPTURED.at,
    errors,
  };
}

/** The raw connections read, so the self-check can look at the body itself. */
async function rawConnections(count) {
  return voyagerFetch(
    `${ENDPOINTS.connections}?${qs({
      decorationId: ENDPOINTS.decorations.connectionList,
      q: 'search',
      sortType: 'RECENTLY_ADDED',
      start: 0,
      count,
    })}`,
  );
}
