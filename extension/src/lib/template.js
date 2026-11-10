/**
 * OutFox — message templating.
 *
 * `{{field}}` placeholders with an optional inline fallback (`{{firstName|there}}`).
 * Only profile fields are substituted: nothing here can invent a fact.
 */

const FIELDS = {
  firstName: (p) => p.firstName,
  lastName: (p) => p.lastName,
  fullName: (p) => p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim(),
  company: (p) => p.company || p.companyName || '',
  companyName: (p) => p.company || p.companyName || '',
  jobTitle: (p) => p.jobTitle || p.title || p.headline || '',
  title: (p) => p.jobTitle || p.title || p.headline || '',
  position: (p) => p.jobTitle || p.title || p.headline || '',
  headline: (p) => p.headline || '',
  location: (p) => p.location || '',
  industry: (p) => p.industry || '',
  email: (p) => p.email || p.enrichmentEmail || (p.enrichment && p.enrichment.email) || '',
  icebreaker: (p) => p.icebreaker || (p.enrichment && p.enrichment.icebreaker) || p.ai_opener || '',
  ai_opener: (p) => p.icebreaker || (p.enrichment && p.enrichment.icebreaker) || p.ai_opener || '',
  mutualCount: (p) => p.mutualCount || p.mutualConnectionCount || '',
  phone: (p) => p.phone || p.phoneNumber || '',
  publicId: (p) => p.publicId || '',
  url: (p) => p.url || '',
};

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*(?:\|([^}]*))?\}\}/g;

/**
 * Render a template against a Profile.
 * @param {string} template
 * @param {object} profile
 * @returns {string} never null; collapses the double spaces an empty
 *   substitution leaves behind
 */
export function renderTemplate(template, profile = {}) {
  if (!template) return '';
  const p = profile || {};

  const out = String(template).replace(PLACEHOLDER, (_match, field, fallback) => {
    const getter = FIELDS[field];
    const value = getter ? getter(p) : p[field];
    if (value === undefined || value === null || value === '') {
      return fallback === undefined ? '' : fallback.trim();
    }
    return String(value);
  });

  return out.replace(/[ \t]{2,}/g, ' ').trim();
}

/** Round-robin pick from a variant list. Returns undefined when there are none. */
export function pickVariant(variants, index = 0) {
  if (!Array.isArray(variants) || !variants.length) return undefined;
  const i = ((Math.trunc(index) % variants.length) + variants.length) % variants.length;
  return variants[i];
}

/** True when a template still has an unresolved placeholder. */
export function hasPlaceholders(text) {
  PLACEHOLDER.lastIndex = 0;
  return PLACEHOLDER.test(String(text || ''));
}
