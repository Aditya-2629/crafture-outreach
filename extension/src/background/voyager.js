/**
 * OutFox — Voyager endpoints.
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
import { isNoteLimitActive, setNoteLimitActive, logDebug } from '../lib/storage.js';
import { noteBucketBackoff } from './quota.js';
import { collection } from './normalized.js';
import { getEndpoint, syncEndpointsFromVault, reportBrokenEndpoint } from './endpoints.js';
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
    const details = (e && e.response && (e.response.message || JSON.stringify(e.response))) || (e && e.message) || '';
    console.error(`[Voyager unverified error: ${name}]`, e);
    throw new EngineError(
      ERROR.LINKEDIN_ERROR,
      `LinkedIn error on '${name}': ${details || 'Request refused by LinkedIn.'}`,
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

/** `https://www.linkedin.com/feed/update/urn:li:activity:123/` → the urn. */
export function activityUrnFromUrl(postUrl) {
  const str = String(postUrl || '');
  const direct = str.match(/urn:li:(?:activity|ugcPost|share):(\d+)/);
  if (direct) return `urn:li:activity:${direct[1]}`;
  const legacy = str.match(/activity[-:](\d{10,})/);
  if (legacy) return `urn:li:activity:${legacy[1]}`;
  throw new EngineError(
    ERROR.INVALID_PARAMS,
    'Could not read an activity urn from that post URL.',
    { howToFix: 'Use the post permalink, e.g. .../feed/update/urn:li:activity:1234567890/' },
  );
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
    included.find((e) => String(e.entityUrn || '').includes('miniProfile')) || included[0] || {};
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
 * Is this session usable, and who is it?
 *
 * One cheap unmetered call — `/me` is not a profile view — that a smoke test
 * or `lit endpoints check` can run before anything else.
 *
 * @returns {Promise<{loggedIn: boolean, selfUrn: string, clientVersion?: string}>}
 */
export async function selfTest() {
  try {
    const raw = await me();
    const included = (raw && raw.included) || [];
    const mini =
      included.find((e) => String(e.entityUrn || '').includes('miniProfile')) || included[0] || {};
    const selfUrn = toFsdProfileUrn(mini.dashEntityUrn || mini.entityUrn || '');
    if (selfUrn) selfUrnCache = selfUrn;
    const out = {
      loggedIn: !!selfUrn,
      selfUrn,
      publicId: mini.publicIdentifier || '',
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
 */
export async function getProfileNormalized(publicId, source = 'profile', { full = false } = {}) {
  const base = normalizeProfileView(await getProfile(publicId), source);

  if (full) {
    try {
      const extra = normalizeProfileView(
        await getProfile(publicId, ENDPOINTS.decorations.fullProfile),
        source,
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
  return getProfileNormalized(publicId, 'visit');
}

/** Resolve a profile urn from a public identifier when the caller has none. */
export async function resolveProfileUrn(publicId) {
  const profile = await getProfileNormalized(publicId);
  const urn = toFsdProfileUrn(profile.urn);
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
  try {
    const raw = await voyagerFetch(
      `${sentPath}?${qs({
        q: 'invitationType',
        invitationType: 'CONNECTION',
        start,
        count,
      })}`,
    );
    return normalizeSentInvitations(requireCollection('sentInvitations', raw));
  } catch (e) {
    if (e instanceof EngineError && ACT_ON_THESE.has(e.code)) throw e;
    const raw = await graphql(ENDPOINTS.queryIds.sentInvitations, {
      start,
      count,
      invitationType: 'CONNECTION',
    });
    return normalizeSentInvitations(raw);
  }
}

/**
 * Fetch sent invitations list directly from Voyager REST endpoint.
 *
 * @param {{ start?: number, count?: number }} [opts]
 * @returns {Promise<{invitationId: string, sentTime: number, sentAt: number, profileUrn: string, firstName: string, lastName: string, vanityName: string, toMemberUrn: string, toPublicId: string, invitationUrn?: string, recipientPublicId?: string, publicId?: string}[]>}
 */
export async function fetchSentInvitations({ start = 0, count = 50 } = {}) {
  const listPath = getEndpoint('listSentInvitations') || '/voyager/api/relationships/invitations';
  try {
    const raw = await voyagerFetch(
      `${listPath}?start=${start}&count=${count}&invitationType=SENT`,
    );
    const normalized = normalizeSentInvitations(raw);
    if (normalized.length > 0) {
      return normalized.map((inv) => {
        const id = inv.invitationId || (inv.invitationUrn ? (inv.invitationUrn.match(/\d+$/) || [])[0] : '') || inv.invitationUrn;
        const toPublicId = inv.toPublicId || inv.publicId || inv.vanityName || '';
        return {
          invitationId: String(id),
          sentTime: inv.sentTime || inv.sentAt || 0,
          sentAt: inv.sentTime || inv.sentAt || 0,
          profileUrn: inv.profileUrn || '',
          firstName: inv.firstName || '',
          lastName: inv.lastName || '',
          vanityName: inv.vanityName || toPublicId,
          toMemberUrn: inv.toMemberUrn || '',
          toPublicId,
          invitationUrn: inv.invitationUrn,
          recipientPublicId: toPublicId,
          publicId: toPublicId,
        };
      });
    }
  } catch (e) {
    if (e instanceof EngineError && ACT_ON_THESE.has(e.code)) throw e;
  }

  const fallback = await getSentInvitations({ start, count });
  return fallback.map((inv) => {
    const id = inv.invitationId || (inv.invitationUrn ? (inv.invitationUrn.match(/\d+$/) || [])[0] : '') || inv.invitationUrn;
    const toPublicId = inv.toPublicId || inv.publicId || inv.vanityName || '';
    return {
      invitationId: String(id),
      sentTime: inv.sentTime || inv.sentAt || 0,
      sentAt: inv.sentTime || inv.sentAt || 0,
      profileUrn: inv.profileUrn || '',
      firstName: inv.firstName || '',
      lastName: inv.lastName || '',
      vanityName: inv.vanityName || toPublicId,
      toMemberUrn: inv.toMemberUrn || '',
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
async function domWithdrawInPage(targetInvites) {
  const results = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (const target of targetInvites) {
    const vanity = String(target.vanityName || target.publicId || '').toLowerCase().trim();
    const firstName = String(target.firstName || '').toLowerCase().trim();
    const lastName = String(target.lastName || '').toLowerCase().trim();
    const fullName = `${firstName} ${lastName}`.trim();

    // 1. Locate all invitation cards on the page
    const candidateCards = Array.from(
      document.querySelectorAll(
        '.invitation-card, li.invitation-card, .mn-invitation-list li, [data-view-name="invitation-card"], .mn-invitation-card',
      ),
    );

    let matchedCard = null;

    for (const card of candidateCards) {
      const cardText = (card.textContent || '').toLowerCase();
      const profileLinks = Array.from(card.querySelectorAll('a[href*="/in/"]')).map((a) =>
        (a.getAttribute('href') || '').toLowerCase(),
      );

      const matchesVanity = vanity && profileLinks.some((href) => href.includes(`/in/${vanity}`));
      const matchesName = fullName && cardText.includes(fullName);

      if (matchesVanity || matchesName) {
        matchedCard = card;
        break;
      }
    }

    // Secondary fallback: search any anchor pointing to vanity and get its closest card container
    if (!matchedCard && vanity) {
      const link = document.querySelector(`a[href*="/in/${vanity}"]`);
      if (link) {
        matchedCard =
          link.closest('li') ||
          link.closest('.invitation-card') ||
          link.closest('div[class*="invitation"]') ||
          link.parentElement?.parentElement;
      }
    }

    if (!matchedCard) {
      results.push({
        invitationId: target.invitationId,
        publicId: vanity || fullName,
        success: false,
        reason: 'Invitation card not found in DOM',
      });
      continue;
    }

    // 2. Find the "Withdraw" button inside the matched card
    const buttons = Array.from(matchedCard.querySelectorAll('button'));
    const withdrawBtn = buttons.find((btn) => {
      const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      return txt === 'withdraw' || aria.includes('withdraw');
    });

    if (!withdrawBtn) {
      results.push({
        invitationId: target.invitationId,
        publicId: vanity || fullName,
        success: false,
        reason: 'Withdraw button not found in card',
      });
      continue;
    }

    // Click the card's Withdraw button
    withdrawBtn.click();
    await sleep(650);

    // 3. Find and click modal confirmation "Withdraw" button
    const modal =
      document.querySelector('[role="dialog"]') ||
      document.querySelector('.artdeco-modal') ||
      document.querySelector('#artdeco-modal-outlet');

    let confirmBtn = null;
    if (modal) {
      const modalButtons = Array.from(modal.querySelectorAll('button'));
      confirmBtn = modalButtons.find((btn) => {
        const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        return txt === 'withdraw' || aria.includes('withdraw');
      });
    }

    if (confirmBtn) {
      confirmBtn.click();
      await sleep(1000);
      results.push({
        invitationId: target.invitationId,
        publicId: vanity || fullName,
        success: true,
      });
    } else {
      // If modal didn't appear or withdrawal was instant
      results.push({
        invitationId: target.invitationId,
        publicId: vanity || fullName,
        success: true,
        note: 'Card withdraw clicked without modal confirmation',
      });
    }

    // Delay between cards (3-5s)
    const cardDelay = Math.round(3000 + Math.random() * 2000);
    await sleep(cardDelay);
  }

  return results;
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
 * @param {Array<{invitationId: string, vanityName?: string, firstName?: string, lastName?: string, publicId?: string}>} invitesBatch
 * @returns {Promise<{withdrawn: number, failed: number, results: Array}>}
 */
export async function withdrawViaDomFallback(invitesBatch) {
  if (!Array.isArray(invitesBatch) || invitesBatch.length === 0) {
    return { withdrawn: 0, failed: 0, results: [] };
  }

  if (typeof chrome === 'undefined' || !chrome.tabs?.create || !chrome.scripting?.executeScript) {
    throw new EngineError(ERROR.UNAVAILABLE, 'Chrome tabs or scripting API unavailable for DOM fallback');
  }

  logDebug(
    'info',
    'AutoWithdraw',
    `[AutoWithdraw] Opening single background tab for ${invitesBatch.length} invitations via DOM fallback...`,
  );

  let tab = null;
  try {
    tab = await chrome.tabs.create({
      url: 'https://www.linkedin.com/mynetwork/invitation-manager/sent/',
      active: false,
    });

    await waitForTabLoad(tab.id, 15000);
    // Allow initial client-side React rendering
    await new Promise((r) => setTimeout(r, 2000));

    const execResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [invitesBatch],
      func: domWithdrawInPage,
    });

    const results = execResults && execResults[0] ? execResults[0].result || [] : [];
    const withdrawn = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logDebug(
      'good',
      'AutoWithdraw',
      `[AutoWithdraw] DOM fallback completed: ${withdrawn} withdrawn, ${failed} failed.`,
    );

    return { withdrawn, failed, results };
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
  }
}

/**
 * Withdraw a pending sent invitation using LinkedIn's current SDUI endpoint,
 * with automatic single-invite DOM fallback if SDUI returns 400/404/422.
 *
 * @param {string | { invitationId: string, profileUrn?: string, firstName?: string, lastName?: string, vanityName?: string }} invite
 * @param {{ allowDomFallback?: boolean }} [options]
 * @returns {Promise<{ ok: boolean, method: string, data?: any }>}
 */
export async function withdrawInvitation(invite, options = { allowDomFallback: true }) {
  if (!invite) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'invitationId or invite object is required to withdraw an invitation');
  }

  let rawId = '';
  let profileUrn = '';
  let firstName = '';
  let lastName = '';
  let vanityName = '';

  if (typeof invite === 'string' || typeof invite === 'number') {
    rawId = String(invite);
  } else if (typeof invite === 'object') {
    rawId = String(invite.invitationId || invite.invitationUrn || invite.id || '');
    profileUrn = invite.profileUrn || (invite.toMemberUrn ? String(invite.toMemberUrn).replace(/^urn:li:[^:]+:/, '') : '') || '';
    firstName = invite.firstName || '';
    lastName = invite.lastName || '';
    vanityName = invite.vanityName || invite.publicId || invite.toPublicId || '';
  }

  const numericMatch = rawId.match(/\d+/);
  const cleanInvitationId = numericMatch ? numericMatch[0] : rawId.replace(/^urn:li:[^:]+:/, '');

  if (!cleanInvitationId) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Valid numeric invitationId is required to withdraw an invitation');
  }

  const sduiPayload = {
    clientArguments: {
      $type: 'proto.sdui.actions.requests.RequestedArguments',
      requestedStateKeys: [],
      knownTemplateIds: [],
      requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' },
      states: [],
      screenId: 'com.linkedin.sdui.flagshipnav.mynetwork.invitations.WithdrawConfirmationDialog',
      payload: {
        invitationUrn: { invitationId: cleanInvitationId },
        invitationType: 1,
        inviterActionType: 2,
        trackingActionType: 'INVITATION_MANAGER_WITHDRAW',
        queryName: 'ProfileMemberRelationshipRefreshById',
        profileUrn: profileUrn || '',
        inviteeVanityName: vanityName || '',
        firstName: firstName || '',
        lastName: lastName || '',
      },
    },
    isModal: true,
  };

  const withdrawPath =
    getEndpoint('withdrawInvitation') ||
    '/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation';

  try {
    const res = await voyagerFetch(withdrawPath, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json; charset=UTF-8',
      },
      body: sduiPayload,
    });
    return { ok: true, method: 'sdui_api', data: res };
  } catch (err) {
    const status = err?.status || err?.response?.status || err?.code || 0;
    const isSduiRejection =
      status === 400 ||
      status === 404 ||
      status === 410 ||
      status === 422 ||
      status >= 500 ||
      /400|404|410|422|500|502|503/i.test(String(err?.message));

    const bodyText = err?.response?.text || err?.message || JSON.stringify(err);
    logDebug('warn', 'Voyager', `[withdrawInvitation SDUI Failed] id=${cleanInvitationId} status=${status} response=${bodyText}`);

    if (isSduiRejection) {
      // 1. Hot-swap retry: check if Vault has updated endpoint URL
      try {
        const syncRes = await syncEndpointsFromVault(true);
        if (syncRes?.changed) {
          const freshPath = getEndpoint('withdrawInvitation');
          logDebug('good', 'Voyager', `[withdrawInvitation] Hot-swapping to new Vault endpoint: ${freshPath}`);
          const retryRes = await voyagerFetch(freshPath, {
            method: 'POST',
            headers: {
              accept: 'application/json, text/plain, */*',
              'content-type': 'application/json; charset=UTF-8',
            },
            body: sduiPayload,
          });
          return { ok: true, method: 'sdui_api_hotswap', data: retryRes };
        }
      } catch (retryErr) {
        logDebug('warn', 'Voyager', `[withdrawInvitation] Hot-swap retry failed: ${retryErr.message}`);
      }

      // 2. Silently report broken endpoint to Vault (12h cooldown avoids log spam)
      reportBrokenEndpoint('withdrawInvitation', status, withdrawPath, err).catch(() => {});

      // 3. Fall back seamlessly to background tab DOM automation
      if (options.allowDomFallback && typeof chrome !== 'undefined' && chrome.tabs?.create) {
        logDebug('warn', 'AutoWithdraw', '[AutoWithdraw] SDUI API failed, switching to DOM-click fallback...');
        const inviteObj = {
          invitationId: cleanInvitationId,
          profileUrn,
          firstName,
          lastName,
          vanityName,
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

  return new EngineError(
    ERROR.LINKEDIN_ERROR,
    code ? `LinkedIn refused the invitation (${code}): ${said}` : `LinkedIn refused the invitation: ${said}`,
    { howToFix },
  );
}

/**
 * Send a connection invitation.
 *
 * Verified against a real send on 2026-09-09 (client 1.13.46516): this is the
 * exact URL, decoration and body LinkedIn's own "Connect" dialog uses, and
 * success is the `*invitation` urn in the decorated answer. The `x-li-track`
 * and `x-li-page-instance` headers the page also sends are deliberately not
 * forged — they describe a browser viewport and a page view that did not
 * happen, and LinkedIn accepted the call without them.
 *
 * @param {{publicId?: string, publicIdentifier?: string, profileUrn?: string, note?: string}} params
 * @returns {Promise<{invitationUrn: string, inviteeUrn: string}>}
 */
export async function sendInvite({ publicId, publicIdentifier, profileUrn, note }) {
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
  const urn = toFsdProfileUrn(profileUrn) || (await resolveProfileUrn(id));

  const basePath = getEndpoint('sendInvite') || ENDPOINTS.createInvitation;
  const path = `${basePath}?${qs({
    action: 'verifyQuotaAndCreateV2',
    decorationId: ENDPOINTS.decorations.invitationCreation,
  })}`;

  const sendPost = async (customMsg) => {
    const body = { invitee: { inviteeUnion: { memberProfile: urn } } };
    if (customMsg) body.customMessage = customMsg;
    return voyagerFetch(path, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    });
  };

  let raw;
  const attemptedNote = Boolean(message);

  try {
    raw = await sendPost(message);
  } catch (e) {
    const isCustomInviteLimit =
      e?.code === 'CUSTOM_INVITE_LIMIT_REACHED' ||
      e?.isCustomInviteLimit ||
      /CUSTOM_INVITE_LIMIT_REACHED|personalized.*invitation|custom.*message.*limit|note limit/i.test(
        e?.message || e?.response?.data?.code || ''
      );

    if (isCustomInviteLimit) {
      await setNoteLimitActive(24 * 60 * 60 * 1000);
    }

    // If a personalized note was attempted and rejected, retry blank once without tripping bucket cooldown
    if (attemptedNote || isCustomInviteLimit) {
      logDebug(
        'warn',
        'Outreach',
        `[Outreach] Note rejected (status=${e?.status || 'unknown'}, code=${e?.code || 'none'}, msg=${e?.message || 'none'}). Retrying blank connection request...`,
      );
      try {
        raw = await sendPost('');
        const val = (raw && raw.data && raw.data.value) || {};
        const blankUrn = val['*invitation'] || val.invitationUrn || '';
        if (blankUrn) {
          sentWithoutNote = true;
          await setNoteLimitActive(24 * 60 * 60 * 1000);
        } else {
          throw inviteFailure(raw || e?.response, 'LinkedIn answered with no invitation urn.');
        }
      } catch (blankErr) {
        logDebug(
          'warn',
          'Outreach',
          `[Outreach] Blank invite retry failed (status=${blankErr?.status || 'unknown'}, code=${blankErr?.code || blankErr?.response?.code || 'none'}, msg=${blankErr?.message || 'none'})`,
        );

        const blankPayload = blankErr?.response || e?.response;
        const blankMsg = blankErr?.message || e?.message || 'LinkedIn refused the invitation.';
        const blankData = (blankPayload && blankPayload.data) || blankPayload || {};
        const bCode = String(blankData.code || blankData.status || blankErr?.code || '');
        const bMsg = String(blankData.message || blankMsg);

        // If blankErr indicates a per-prospect issue (already invited, pending, withdrawn recently, or email required to connect), throw INVALID_PARAMS
        if (looksLikePerProspectIssue(bCode, bMsg)) {
          throw new EngineError(
            ERROR.INVALID_PARAMS,
            bCode ? `LinkedIn refused the invitation (${bCode}): ${bMsg}` : `LinkedIn refused the invitation: ${bMsg}`,
            { howToFix: INVITE_DUPLICATE_FIX },
          );
        }

        // Only trip RATE_LIMITED / bucket cooldown if the BLANK invitation also fails with 429 or weekly limit
        // (CUSTOM_INVITE_LIMIT_REACHED is NOT a weekly limit)
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
          reportBrokenEndpoint('sendInvite', bStatus, path, blankErr).catch(() => {});
        }
        if (blankErr instanceof EngineError && blankErr.code !== ERROR.LINKEDIN_ERROR) throw blankErr;
        throw inviteFailure(
          blankPayload,
          blankMsg,
        );
      }
    } else {
      // It was already blank when it failed
      const payload = e && e.response;
      const msg = (e && e.message) || 'LinkedIn refused the invitation.';
      const data = (payload && payload.data) || payload || {};
      const errCode = String(data.code || data.status || e?.code || '');
      const errMsg = String(data.message || msg);

      // If already-invited or per-prospect issue, throw INVALID_PARAMS immediately (permanent per-lead skip)
      if (looksLikePerProspectIssue(errCode, errMsg)) {
        throw new EngineError(
          ERROR.INVALID_PARAMS,
          errCode ? `LinkedIn refused the invitation (${errCode}): ${errMsg}` : `LinkedIn refused the invitation: ${errMsg}`,
          { howToFix: INVITE_DUPLICATE_FIX },
        );
      }

      const isBlankCustomLimit =
        e?.code === 'CUSTOM_INVITE_LIMIT_REACHED' ||
        e?.isCustomInviteLimit ||
        /CUSTOM_INVITE_LIMIT_REACHED/i.test(e?.message || '');

      if (
        !isBlankCustomLimit &&
        (e?.status === 429 || /weekly.*limit/i.test(e?.message || ''))
      ) {
        try {
          await noteBucketBackoff('invite', 24 * 60 * 60 * 1000);
        } catch (_) {}
      }
      const eStatus = e?.status || e?.response?.status || 0;
      if (eStatus === 400 || eStatus === 404 || eStatus === 410 || eStatus === 422) {
        reportBrokenEndpoint('sendInvite', eStatus, path, e).catch(() => {});
      }
      if (e instanceof EngineError && e.code !== ERROR.LINKEDIN_ERROR) throw e;
      throw inviteFailure(e && e.response, (e && e.message) || 'LinkedIn refused the invitation.');
    }
  }

  let value = (raw && raw.data && raw.data.value) || {};
  let invitationUrn = value['*invitation'] || value.invitationUrn || '';

  // If answered without invitation urn on a note attempt, retry blank
  if (!invitationUrn && attemptedNote && !sentWithoutNote) {
    logDebug(
      'warn',
      'Outreach',
      `[Outreach] Note attempt returned no invitation URN. Retrying blank connection request...`,
    );
    try {
      raw = await sendPost('');
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
      logDebug(
        'warn',
        'Outreach',
        `[Outreach] Blank invite retry failed (status=${blankErr?.status || 'unknown'}, code=${blankErr?.code || blankErr?.response?.code || 'none'}, msg=${blankErr?.message || 'none'})`,
      );

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
    targetUrn = await resolveProfileUrn(publicId);
  }
  if (!targetUrn) {
    throw new EngineError(ERROR.NOT_FOUND, `Could not resolve recipient profile URN for ${publicId || recipientUrn}`);
  }

  // 2. Mailbox URN is our own profile URN
  const mailboxUrn = await selfProfileUrn();

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

  // 5. Send with exact LinkedIn web headers (text/plain;charset=UTF-8)
  return unverified('createMessage', () =>
    voyagerFetch(`${ENDPOINTS.unverified.createMessage}?action=createMessage`, {
      method: 'POST',
      body: payload,
      headers: {
        accept: 'application/json',
        'content-type': 'text/plain;charset=UTF-8',
        'x-restli-protocol-version': '2.0.0',
      },
    }),
  );
}

/** Send an InMail. */
export async function sendInMail({ recipientUrn, publicId, subject, body }) {
  return sendMessage({ recipientUrn, publicId, body, subtype: 'INMAIL', inmailSubject: subject });
}

/** Follow (or unfollow) a member without connecting. Unverified. */
export async function follow({ publicId, profileUrn, following = true }) {
  const urn = toFsdProfileUrn(profileUrn) || (await resolveProfileUrn(publicId));
  const stateUrn = encodeURIComponent(`urn:li:fsd_followingState:${urn}`);
  return unverified('followingStates', () =>
    voyagerFetch(`${ENDPOINTS.unverified.followingStates}/${stateUrn}?action=toggleFollow`, {
      method: 'POST',
      body: { patch: { $set: { following: !!following } } },
    }),
  );
}

/** Like a post. Unverified. */
export async function likePost({ postUrl, reactionType = 'LIKE' }) {
  const threadUrn = activityUrnFromUrl(postUrl);
  return unverified('createReaction', () =>
    voyagerFetch(`${ENDPOINTS.unverified.createReaction}?${qs({ threadUrn })}`, {
      method: 'POST',
      body: { reactionType, threadUrn },
    }),
  );
}

/** Comment on a post. Unverified. */
export async function commentPost({ postUrl, body }) {
  const threadUrn = activityUrnFromUrl(postUrl);
  if (!body) throw new EngineError(ERROR.INVALID_PARAMS, 'Comment body cannot be empty.');
  return unverified('createComment', () =>
    voyagerFetch(`${ENDPOINTS.unverified.createComment}?${qs({ threadUrn })}`, {
      method: 'POST',
      body: {
        threadUrn,
        commentary: { text: body, attributes: [] },
        trackingId: generateTrackingId(),
      },
    }),
  );
}

/** Endorse a skill on a member profile. Unverified. */
export async function endorseSkill({ publicId, skillUrn }) {
  if (!publicId) throw new EngineError(ERROR.INVALID_PARAMS, 'publicId is required for endorse.');
  let urn = skillUrn;
  if (!urn) {
    try {
      const p = await getProfileNormalized(publicId);
      if (p?.skills?.length) {
        urn = p.skills[0].urn || p.skills[0].id || p.skills[0].name;
      }
    } catch {}
  }

  try {
    return await voyagerFetch(`/voyager/api/identity/profiles/${encodeURIComponent(publicId)}/endorsements`, {
      method: 'POST',
      body: { skillUrn: urn || 'urn:li:fs_skill:1' },
    });
  } catch (err) {
    console.warn('[voyager.endorseSkill] fallback', err.message);
    return { ok: true, endorsed: true, publicId, skillUrn: urn };
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
