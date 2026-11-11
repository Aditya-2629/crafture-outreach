/**
 * OutFox — Enrichment Provider Interface & Waterfall Engine.
 * Supports Apollo.io, Hunter.io, and algorithmic Pattern Generation fallback.
 */

import { getConfig } from '../lib/config.js';
import { ACTIONS, ERROR, EngineError } from '../lib/actions.js';
import { register } from './engine.js';
import { getStoredProfile, putProfile } from '../lib/storage.js';
import * as voyager from './voyager.js';

export const HUNTER_BASE = 'https://api.hunter.io/v2/email-finder';
export const APOLLO_BASE = 'https://api.apollo.io/v1/people/match';

/** A domain to look a person up against, from the company or their profile. */
export function domainFor(profile = {}, company = {}) {
  const website = company.website || profile.companyWebsite || '';
  const match = String(website).match(/^(?:https?:\/\/)?(?:www\.)?([^/?#]+)/i);
  if (match) return match[1].toLowerCase();

  const compName = company.name || profile.company || '';
  if (compName && !compName.includes(' ') && compName.length > 2) {
    const clean = compName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean) return `${clean}.com`;
  }
  return '';
}

/**
 * Build the Hunter email-finder request.
 */
export function hunterRequest({ domain, firstName, lastName, fullName, apiKey }) {
  if (!domain || !apiKey) return null;

  const params = new URLSearchParams({ domain, api_key: apiKey });
  const first = firstName || String(fullName || '').split(' ')[0] || '';
  const last = lastName || String(fullName || '').split(' ').slice(1).join(' ') || '';
  if (first) params.set('first_name', first);
  if (last) params.set('last_name', last);
  if (!first && !last) return null;

  return { url: `${HUNTER_BASE}?${params.toString()}` };
}

export function readHunter(json) {
  const data = (json && json.data) || {};
  const out = { provider: 'hunter' };
  if (data.email) out.email = data.email;
  if (data.phone_number) out.phone = data.phone_number;
  if (typeof data.score === 'number') out.confidence = data.score / 100;
  return out;
}

export async function executeHunter({ domain, firstName, lastName, fullName, apiKey }) {
  const req = hunterRequest({ domain, firstName, lastName, fullName, apiKey });
  if (!req) return null;

  try {
    const res = await fetch(req.url, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    return readHunter(data);
  } catch (err) {
    console.warn('[enrich] Hunter error:', err?.message || err);
    return null;
  }
}

export async function executeApollo({ apiKey, firstName, lastName, domain, organizationName, linkedinUrl }) {
  if (!apiKey) return null;

  try {
    const payload = {
      api_key: apiKey,
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      domain: domain || undefined,
      organization_name: organizationName || undefined,
      linkedin_url: linkedinUrl || undefined,
    };

    const res = await fetch(APOLLO_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const person = data?.person || {};

    const out = { provider: 'apollo' };
    if (person.email) out.email = person.email;
    if (person.phone_numbers && person.phone_numbers.length > 0) {
      out.phone = person.phone_numbers[0].raw_number || person.phone_numbers[0].sanitized_number;
    } else if (person.sanitized_phone) {
      out.phone = person.sanitized_phone;
    }
    if (person.email) out.confidence = 0.92;
    return out.email ? out : null;
  } catch (err) {
    console.warn('[enrich] Apollo error:', err?.message || err);
    return null;
  }
}

export function patternGenerateEmail({ firstName, lastName, domain }) {
  if (!firstName || !lastName || !domain) return null;
  const cleanFirst = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanLast = lastName.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!cleanFirst || !cleanLast) return null;
  return {
    email: `${cleanFirst}.${cleanLast}@${domain}`,
    confidence: 0.5,
    provider: 'pattern_generator',
  };
}

/**
 * Execute Waterfall lookup: Apollo -> Hunter -> Pattern Generator
 */
export async function lookupEmailWaterfall(profile = {}, company = {}, extra = {}) {
  const cfg = await getConfig();
  const settings = cfg.enrichment || {};

  const apolloKey = settings.apolloApiKey || (settings.provider === 'apollo' ? settings.apiKey : '') || settings.apiKey;
  const hunterKey = settings.hunterApiKey || (settings.provider === 'hunter' ? settings.apiKey : '') || settings.apiKey;

  const first = profile.firstName || String(profile.fullName || '').split(' ')[0] || '';
  const last = profile.lastName || String(profile.fullName || '').split(' ').slice(1).join(' ') || '';
  const domain = extra.domain || domainFor(profile, company);
  const organizationName = extra.company || company.name || profile.company || '';
  const linkedinUrl = profile.url || (profile.publicId ? `https://www.linkedin.com/in/${profile.publicId}` : '');

  // 1. Try Apollo.io Match
  if (apolloKey) {
    const apolloRes = await executeApollo({
      apiKey: apolloKey,
      firstName: first,
      lastName: last,
      domain,
      organizationName,
      linkedinUrl,
    });
    if (apolloRes && apolloRes.email) return apolloRes;
  }

  // 2. Try Hunter.io Email Finder
  if (hunterKey && domain) {
    const hunterRes = await executeHunter({
      domain,
      firstName: first,
      lastName: last,
      fullName: profile.fullName,
      apiKey: hunterKey,
    });
    if (hunterRes && hunterRes.email) return hunterRes;
  }

  // 3. Pattern Generator Fallback
  if (domain && first && last) {
    const patternRes = patternGenerateEmail({ firstName: first, lastName: last, domain });
    if (patternRes) return patternRes;
  }

  return { provider: 'none', reason: 'no-match-found' };
}

/**
 * Legacy interface for pack generation compatibility
 */
export async function lookupEmail(profile, company) {
  return lookupEmailWaterfall(profile, company);
}

/**
 * High-Level Lead Enrichment Pipeline
 * Discovers email, phone, updates profile in storage, and returns enriched contact.
 */
export async function enrichLead(publicId, extra = {}) {
  if (!publicId) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'publicId is required for lead enrichment.');
  }

  let profile = await getStoredProfile(publicId);
  if (!profile || !profile.fullName) {
    try {
      const fetched = await voyager.getProfileNormalized(publicId);
      if (fetched) {
        await putProfile(fetched);
        profile = fetched;
      }
    } catch (e) {
      console.warn('[enrichLead] voyager profile lookup skipped:', e?.message || e);
    }
  }

  if (!profile) {
    profile = {
      publicId,
      fullName: extra.fullName || publicId,
      firstName: extra.firstName || String(extra.fullName || publicId).split(' ')[0],
      lastName: extra.lastName || String(extra.fullName || '').split(' ').slice(1).join(' '),
      company: extra.company || '',
      url: `https://www.linkedin.com/in/${publicId}`,
    };
  }

  const enriched = await lookupEmailWaterfall(profile, {}, extra);

  const updatedProfile = {
    ...profile,
    ...(enriched.email ? { email: enriched.email } : {}),
    ...(enriched.phone ? { phone: enriched.phone } : {}),
    enrichmentSource: enriched.provider,
    confidence: enriched.confidence !== undefined ? enriched.confidence : 0.5,
    enrichedAt: Date.now(),
  };

  await putProfile(updatedProfile);

  return {
    ok: true,
    publicId,
    profile: updatedProfile,
    enriched,
  };
}

register(ACTIONS.ENRICH_LEAD, async ({ publicId, ...extra }) => enrichLead(publicId, extra));
