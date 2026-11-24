import { get, set, K } from '../lib/storage.js';
import { ACTIONS, ERROR, EngineError } from '../lib/actions.js';
import { register } from './engine.js';

const CANDIDATES_KEY = 'crafture_candidates';
const ACTIVE_CANDIDATE_KEY = 'crafture_active_candidate';

export const DEFAULT_CANDIDATES = [
  {
    id: 'cand_default',
    slug: 'default',
    name: 'Default Persona',
    title: 'Data Analyst (OPT/STEM)',
    mode: 'reverse_recruiting', // Pitching Tech Hiring Managers
    targetRoles: ['Data Analyst', 'Business Analyst', 'BI Developer', 'Analytics Engineer'],
    targetLocations: ['Austin, Texas', 'Dallas, Texas', 'Remote USA'],
    bookingLink: '',
    resumeUrl: '',
    skills: ['SQL', 'Python', 'Tableau', 'Power BI', 'Snowflake'],
    pitchTemplate:
      'Hi {{firstName}}, noticed you lead analytics/engineering at {{company}}. I am a Data Analyst with experience in SQL, Python & Tableau open to roles in Austin/Remote. Would love to connect!',
    followupTemplate:
      'Hey {{firstName}}, thanks for connecting! I saw {{company}} has exciting data initiatives. Are you currently open to adding a Data Analyst to your team or open to a quick 10-min chat?',
    createdAt: Date.now(),
  },
  {
    id: 'cand_agency',
    slug: 'agency',
    name: 'Career Placement Partner',
    title: 'Agency Lead Gen & Talent Sourcing',
    mode: 'sourcing', // Sourcing candidates looking for jobs
    targetRoles: ['Data Analyst', 'OPT', 'CPT', 'Looking for job', 'Open to work'],
    targetLocations: ['Austin, Texas', 'Texas', 'United States'],
    bookingLink: '',
    resumeUrl: '',
    skills: ['Career Consulting', 'Talent Placement', 'Direct Hire'],
    pitchTemplate:
      'Hi {{firstName}}, saw your background in Data Analytics. We are actively placing talent into direct client projects across Texas. Love to connect!',
    followupTemplate:
      'Hey {{firstName}}, glad to connect! Are you currently exploring Data Analyst roles or open to new consulting projects in the US? Happy to share our open pipeline.',
    createdAt: Date.now(),
  },
];

export async function getAllCandidates() {
  const list = await get(CANDIDATES_KEY, null);
  if (!list || !Array.isArray(list) || list.length === 0) {
    await set(CANDIDATES_KEY, DEFAULT_CANDIDATES);
    return DEFAULT_CANDIDATES;
  }
  let changed = false;
  const sanitized = list.map((c) => {
    if (c.slug === 'aditya' || c.id === 'cand_aditya' || c.name === 'Aditya Chaudhary') {
      changed = true;
      return {
        ...c,
        id: 'cand_default',
        slug: 'default',
        name: c.name === 'Aditya Chaudhary' ? 'Default Persona' : c.name,
        bookingLink: c.bookingLink?.includes('aditya') ? '' : (c.bookingLink || ''),
        resumeUrl: c.resumeUrl?.includes('aditya') ? '' : (c.resumeUrl || ''),
      };
    }
    return c;
  });
  if (changed) {
    await set(CANDIDATES_KEY, sanitized).catch(() => {});
  }
  return sanitized;
}

export async function getActiveCandidate() {
  let activeSlug = await get(ACTIVE_CANDIDATE_KEY, 'default');
  if (activeSlug === 'aditya' || activeSlug === 'cand_aditya') activeSlug = 'default';
  const all = await getAllCandidates();
  const match = all.find((c) => c.slug === activeSlug || c.id === activeSlug);
  const cand = match || all[0] || DEFAULT_CANDIDATES[0];
  if (cand && (cand.id === 'cand_default' || cand.slug === 'default' || cand.name === 'Default Persona')) {
    try {
      const storedUser = await get('user_profile', null);
      if (storedUser?.name && storedUser.name !== 'Crafture User' ) {
        return { ...cand, name: storedUser.name };
      }
    } catch {}
  }
  return cand;
}

export async function setActiveCandidate(idOrSlug) {
  const all = await getAllCandidates();
  const target = String(idOrSlug || '').toLowerCase().trim();
  const match = all.find(
    (c) =>
      c.id.toLowerCase() === target ||
      c.slug.toLowerCase() === target ||
      c.name.toLowerCase().includes(target)
  );

  if (!match) {
    throw new EngineError(
      ERROR.NOT_FOUND,
      `Candidate "${idOrSlug}" nahi mila. Available: ${all.map((c) => c.slug).join(', ')}`
    );
  }

  await set(ACTIVE_CANDIDATE_KEY, match.slug);
  return match;
}

export async function saveCandidate(candidateData) {
  if (!candidateData || !candidateData.name) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Candidate name is required.');
  }

  const all = await getAllCandidates();
  const slug = (candidateData.slug || candidateData.name.toLowerCase().replace(/[^a-z0-9]/g, '')).slice(0, 20);
  const id = candidateData.id || `cand_${slug}_${Date.now()}`;

  const normalized = {
    id,
    slug,
    name: candidateData.name.trim(),
    title: candidateData.title || 'Data Professional',
    mode: candidateData.mode || 'reverse_recruiting',
    targetRoles: Array.isArray(candidateData.targetRoles) ? candidateData.targetRoles : ['Data Analyst'],
    targetLocations: Array.isArray(candidateData.targetLocations) ? candidateData.targetLocations : ['United States'],
    bookingLink: candidateData.bookingLink || 'https://calendly.com',
    resumeUrl: candidateData.resumeUrl !== undefined ? String(candidateData.resumeUrl).trim() : (existingIdx >= 0 ? all[existingIdx].resumeUrl : '') || '',
    skills: Array.isArray(candidateData.skills) ? candidateData.skills : [],
    pitchTemplate: candidateData.pitchTemplate || 'Hi {{firstName}}, would love to connect!',
    followupTemplate: candidateData.followupTemplate || 'Hey {{firstName}}, glad to connect!',
    createdAt: candidateData.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  const existingIdx = all.findIndex((c) => c.id === id || c.slug === slug);
  if (existingIdx >= 0) all[existingIdx] = { ...all[existingIdx], ...normalized };
  else all.push(normalized);

  await set(CANDIDATES_KEY, all);
  return normalized;
}

export async function deleteCandidate(id) {
  const all = await getAllCandidates();
  const next = all.filter((c) => c.id !== id && c.slug !== id);
  if (next.length === 0) {
    throw new EngineError(ERROR.INVALID_PARAMS, 'Cannot delete the last remaining candidate.');
  }
  await set(CANDIDATES_KEY, next);
  return { deleted: true, remaining: next.length };
}

register(ACTIONS.CANDIDATES_GET, async () => ({
  candidates: await getAllCandidates(),
  active: await getActiveCandidate(),
}));
register(ACTIONS.CANDIDATE_SET_ACTIVE, async ({ idOrSlug }) => ({
  active: await setActiveCandidate(idOrSlug),
}));
register(ACTIONS.CANDIDATE_SAVE, async ({ candidate }) => ({
  saved: await saveCandidate(candidate),
}));
register(ACTIONS.CANDIDATE_DELETE, async ({ id }) => ({
  result: await deleteCandidate(id),
}));

