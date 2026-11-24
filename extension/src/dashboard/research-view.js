/**
 * Crafture Network — Full-Page Research & Dossier View
 *
 * Automated prospect intelligence engine:
 * 1. Single profile quick-lookup dossier generator.
 * 2. Bulk CSV drop/paste with column auto-mapping and preview.
 * 3. Deep LinkedIn profile resolution, identity verification & candidate rival matching.
 * 4. Buying & outreach signal extraction (job changes, posting habits, mutuals, hiring).
 * 5. Instant CSV & Markdown dossier exports.
 *
 * 100% Manifest V3 CSP Compliant · Vector SVG Icons · Pure Crafture Network Design System
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { ICONS } from '../ui/icons.js';
import {
  parseCsv,
  readTextFile,
  guessMapping,
  toResearchRows,
  RESEARCH_FIELDS,
} from '../ui/csv.js';
import { downloadCsv, downloadMarkdown, slug, today } from '../ui/download.js';
import { isStorageChangeRelevant, captureInputFocus, restoreInputFocus } from './dashboard.js';

const RESEARCH_RELEVANT_KEYS = new Set(['research', 'research_jobs', 'candidates', 'activeCandidate']);

const POLL_INTERVAL_MS = 4000;
const PREVIEW_ROW_COUNT = 3;

function fmtNumber(n) {
  return Number(n || 0).toLocaleString();
}

function fmtDuration(ms) {
  const sec = Math.round(Math.max(0, ms) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatSignalPill(signal) {
  const sig = String(signal || '');
  if (sig === 'changedJobRecently') {
    return `<span class="research-pill pill-orange" style="display:inline-flex; align-items:center; gap:5px;">${ICONS.building} Changed Job Recently</span>`;
  }
  if (sig === 'postedRecently') {
    return `<span class="research-pill pill-blue" style="display:inline-flex; align-items:center; gap:5px;">${ICONS.edit} Posted Recently</span>`;
  }
  if (sig === 'high-activity') {
    return `<span class="research-pill pill-green" style="display:inline-flex; align-items:center; gap:5px;">${ICONS.flame} High Activity</span>`;
  }
  if (sig === 'companyHiring') {
    return `<span class="research-pill pill-purple" style="display:inline-flex; align-items:center; gap:5px;">${ICONS.rocket} Company Hiring</span>`;
  }
  if (sig === 'alreadyConnected') {
    return `<span class="research-pill pill-teal" style="display:inline-flex; align-items:center; gap:5px;">${ICONS.users} 1st Degree Connection</span>`;
  }
  if (sig === 'engagedWithMe') {
    return `<span class="research-pill pill-orange" style="display:inline-flex; align-items:center; gap:5px;">${ICONS.star} Engaged With You</span>`;
  }
  if (sig.startsWith('mutuals:')) {
    const count = sig.split(':')[1] || '';
    return `<span class="research-pill pill-slate" style="display:inline-flex; align-items:center; gap:5px;">${ICONS.users} ${count} Mutuals</span>`;
  }
  if (sig.startsWith('followers:')) {
    const count = sig.split(':')[1] || '';
    return `<span class="research-pill pill-slate" style="display:inline-flex; align-items:center; gap:5px;">${ICONS.megaphone} ${count} Followers</span>`;
  }
  if (sig.startsWith('headcount:')) {
    const size = sig.split(':')[1] || '';
    return `<span class="research-pill pill-slate" style="display:inline-flex; align-items:center; gap:5px;">${ICONS.building} ${size} Size</span>`;
  }
  return `<span class="research-pill pill-slate">${escapeHtml(sig)}</span>`;
}

function ensureResearchStyles() {
  if ((document.getElementById('cn-research-styles'))) return;
  const style = document.createElement('style');
  style.id = 'cn-research-styles';
  style.textContent = `
    .research-view-shell {
      display: flex;
      flex-direction: column;
      gap: 24px;
      padding-bottom: 40px;
    }
    .research-head-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .research-page-title {
      font-size: 24px;
      font-weight: 800;
      color: #0f172a;
      margin: 0;
      letter-spacing: -0.4px;
    }
    .research-page-sub {
      font-size: 13.5px;
      color: #64748b;
      margin: 4px 0 0 0;
    }
    .research-white-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.03);
    }
    .research-card-title {
      font-size: 15px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .research-card-subtitle {
      font-size: 12.5px;
      color: #64748b;
      margin: 0 0 16px 0;
    }
    .research-dropzone {
      border: 2px dashed #cbd5e1;
      border-radius: 12px;
      padding: 32px 20px;
      text-align: center;
      cursor: pointer;
      background: #f8fafc;
      transition: all 0.2s ease;
    }
    .research-dropzone:hover, .research-dropzone.is-over {
      border-color: #104B35;
      background: #fffbf7;
    }
    .research-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11.5px;
      font-weight: 700;
    }
    .pill-green { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
    .pill-blue { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }
    .pill-orange { background: #E6EFE9; color: #167448; border: 1px solid #DCE5DE; }
    .pill-purple { background: #faf5ff; color: #7e22ce; border: 1px solid #e9d5ff; }
    .pill-teal { background: #f0fdfa; color: #0d9488; border: 1px solid #99f6e4; }
    .pill-slate { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; }
    .pill-red { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }

    .research-pack-item {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px 20px;
      background: #ffffff;
      margin-bottom: 12px;
      transition: all 0.15s ease;
    }
    .research-pack-item:hover {
      border-color: #cbd5e1;
      box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
    }
    .research-dossier-preview {
      margin-top: 12px;
      padding: 12px 16px;
      background: #f8fafc;
      border-radius: 8px;
      font-size: 12.5px;
      color: #334155;
      line-height: 1.6;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      max-height: 220px;
      overflow-y: auto;
      border: 1px solid #e2e8f0;
    }

    /* Research Dossier Drawer */
    .research-drawer-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(2px);
      z-index: 1000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      display: flex;
      justify-content: flex-end;
    }
    .research-drawer-backdrop.is-open {
      opacity: 1;
      pointer-events: auto;
    }
    .research-drawer {
      width: 100%;
      max-width: 580px;
      height: 100vh;
      background: #ffffff;
      box-shadow: -4px 0 24px rgba(15, 23, 42, 0.15);
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .research-drawer-backdrop.is-open .research-drawer {
      transform: translateX(0);
    }
    .research-drawer-head {
      padding: 18px 24px;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #ffffff;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .research-drawer-body {
      padding: 24px;
      overflow-y: auto;
      flex: 1;
    }
  `;
  document.head.appendChild(style);
}

export async function renderResearchView(container, ctx = {}) {
  ensureResearchStyles();
  if (!container) return;

  // View state
  let headers = [];
  let parsedRows = [];
  let mapping = {};
  let researchRows = [];

  let activeJobId = null;
  let jobStatus = 'idle'; // 'idle' | 'pending' | 'running' | 'completed' | 'failed'
  let doneCount = 0;
  let totalCount = 0;
  let etaMs = 0;
  let startedAt = 0;
  let packs = [];
  let pollTimer = null;
  let lastError = null;
  const openDossierIndices = new Set();
  let activeDrawerPackIdx = null;

  // Checkbox & input options
  let fullCapture = true;
  let enrichContacts = true;
  let targetListName = '';

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  if (typeof ctx?.registerCleanup === 'function') {
    ctx.registerCleanup(stopPolling);
  }

  function startPolling(jobId) {
    stopPolling();
    activeJobId = jobId;
    jobStatus = 'running';
    startedAt = Date.now();
    pollTimer = setInterval(() => pollJob(true), POLL_INTERVAL_MS);
    pollJob(false);
  }

  async function pollJob(isSilent = true) {
    if (!activeJobId) return;
    if (ctx?.isStale?.() || (ctx?.isActiveView && !ctx.isActiveView())) {
      stopPolling();
      return;
    }

    try {
      const data = await call(ACTIONS.RESEARCH_GET, { jobId: activeJobId });
      doneCount = data?.done || 0;
      totalCount = data?.total || totalCount;
      packs = Array.isArray(data?.packs) ? data.packs : [];
      jobStatus = data?.status || 'running';
      etaMs = data?.etaMs || 0;

      if (jobStatus !== 'running' && jobStatus !== 'pending') {
        stopPolling();
        if (jobStatus === 'completed') {
          ctx.showToast?.(`Research Pack completed! ${packs.length} dossiers generated.`, 'success');
        }
      }
      paint(isSilent);
    } catch (err) {
      stopPolling();
      lastError = err?.message || 'Failed to poll research job';
      ctx.showToast?.(`Research error: ${lastError}`, 'error');
      paint(false);
    }
  }

  // Check for active running or latest research jobs on mount
  (async () => {
    try {
      const allJobs = await call(ACTIONS.RESEARCH_LIST, {}).catch(async () => {
        return (typeof chrome !== 'undefined' && chrome.storage?.local?.get)
          ? (await chrome.storage.local.get('research_jobs'))?.research_jobs || []
          : [];
      });
      const active = Array.isArray(allJobs) ? allJobs.find((j) => j.status === 'pending' || j.status === 'running') : null;
      if (active) {
        startPolling(active.jobId);
      } else if (Array.isArray(allJobs) && allJobs.length > 0 && !activeJobId) {
        const latest = allJobs[allJobs.length - 1];
        activeJobId = latest.jobId;
        jobStatus = latest.status || 'completed';
        doneCount = latest.done || 0;
        totalCount = latest.total || 0;
        packs = Array.isArray(latest.packs) ? latest.packs : [];
        paint(false);
      }
    } catch {}
  })();

  function ingestCsv(text) {
    try {
      const res = parseCsv(text);
      if (!res.headers || !res.headers.length) {
        throw new Error('No valid header row found in CSV.');
      }
      headers = res.headers;
      parsedRows = res.rows;
      mapping = guessMapping(headers);
      researchRows = toResearchRows(parsedRows, mapping);
      lastError = null;
      ctx.showToast?.(`Parsed ${researchRows.length} rows from CSV!`, 'success');
      paint();
    } catch (err) {
      lastError = err?.message || 'Could not parse CSV';
      ctx.showToast?.(lastError, 'error');
      paint();
    }
  }

  function renderPacksListHtml(packsList) {
    if (!packsList || packsList.length === 0) {
      return `
        <div style="text-align: center; padding: 32px 20px; color: #94a3b8; font-size: 13px;">
          Processing queue… Dossiers will stream in automatically.
        </div>
      `;
    }

    return `
      <div class="research-packs-list">
        ${packsList.map((pack, index) => {
          const resolved = pack.resolved || { kind: 'unresolved', confidence: 0 };
          const p = pack.profile || {};
          const c = pack.company || {};
          const name = p.fullName || c.name || pack.row?.name || pack.row?.linkedinUrl || `Row #${index + 1}`;
          const subtitle = [p.title || c.industry, p.company || c.name, p.location].filter(Boolean).join(' · ');
          const signals = pack.signals || [];
          const candidates = resolved.candidates || [];
          const isErr = Boolean(pack.error || pack.status === 'error');
          const isReady = pack.status === 'completed' || Boolean(p.fullName || c.name);
          const isExpanded = openDossierIndices.has(index);

          let statusBadge = `<span class="research-pill pill-slate">${resolved.kind}</span>`;
          if (isErr) {
            statusBadge = `<span class="research-pill pill-red" style="display:inline-flex; align-items:center; gap:4px;">${ICONS.warning || '⚠'} Error</span>`;
          } else if (isReady) {
            statusBadge = `<span class="research-pill pill-green" style="display:inline-flex; align-items:center; gap:4px;">${ICONS.check || '✓'} Ready</span>`;
          } else if (jobStatus === 'running' || jobStatus === 'pending') {
            statusBadge = `<span class="research-pill pill-orange">Processing…</span>`;
          }

          return `
            <div class="research-pack-item" data-pack-idx="${index}" style="${isErr ? 'border-color:#fca5a5; background:#fffcfc;' : ''}">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
                <div>
                  <div style="font-size: 14.5px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                    <span class="btn-open-dossier-drawer" data-idx="${index}" style="cursor:pointer; text-decoration:underline decoration-dotted;" title="Click to open full dossier drawer">${escapeHtml(name)}</span>
                    <span class="research-pill ${resolved.kind === 'person' ? 'pill-green' : resolved.kind === 'company' ? 'pill-blue' : 'pill-red'}">
                      ${resolved.kind}
                    </span>
                    ${resolved.confidence ? `
                      <span class="research-pill pill-slate">${Math.round(resolved.confidence * 100)}% match</span>
                    ` : ''}
                    ${statusBadge}
                  </div>
                  ${subtitle ? `
                    <div style="font-size: 12.5px; color: #64748b; margin-top: 3px;">${escapeHtml(subtitle)}</div>
                  ` : ''}
                </div>

                <div style="display: flex; gap: 6px; align-items: center;">
                  <button type="button" class="btn-open-dossier-drawer" data-idx="${index}" style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 4px 10px; font-size: 11.5px; font-weight: 700; color: #1d4ed8; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                    View Dossier
                  </button>
                  <button type="button" class="btn-toggle-dossier" data-idx="${index}" style="background: none; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px 10px; font-size: 11.5px; font-weight: 700; color: #475569; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                    ${isExpanded ? 'Hide Preview' : 'Inline Preview'} ${ICONS.chevronDown}
                  </button>
                </div>
              </div>

              <!-- Row Error Notification -->
              ${pack.error ? `
                <div style="margin-top: 10px; padding: 8px 12px; background: #fef2f2; border: 1px solid #fee2e2; border-radius: 8px; font-size: 12px; color: #b91c1c; display: flex; align-items: center; gap: 6px;">
                  <span style="display:inline-flex; align-items:center;">${ICONS.warning}</span>
                  <span style="font-weight: 700;">Issue:</span>
                  <span>${escapeHtml(pack.error)}</span>
                </div>
              ` : ''}

              <!-- Signals -->
              ${signals.length > 0 ? `
                <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;">
                  ${signals.map((s) => formatSignalPill(s)).join('')}
                </div>
              ` : ''}

              <!-- Unresolved Candidates Picker -->
              ${candidates.length > 0 ? `
                <div style="margin-top: 12px; padding: 10px 14px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 8px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                  <span style="font-size: 12px; font-weight: 700; color: #b45309;">Ambiguous match:</span>
                  <select class="candidate-picker" data-pack-idx="${index}" style="flex: 1; min-width: 200px; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; background: #ffffff;">
                    <option value="">${candidates.length} potential matches found…</option>
                    ${candidates.map((cand) => `
                      <option value="${escapeHtml(cand.url || cand.publicId)}">${escapeHtml(cand.fullName)} — ${escapeHtml(cand.headline || cand.company || '')}</option>
                    `).join('')}
                  </select>
                  <button type="button" class="btn-resolve-candidate" data-pack-idx="${index}" style="padding: 6px 12px; font-size: 12px; font-weight: 700; background: #104B35; color: #fff; border: none; border-radius: 6px; cursor: pointer;">
                    Use Selected
                  </button>
                </div>
              ` : ''}

              <!-- Collapsible Markdown Preview -->
              <div class="research-dossier-preview" id="dossier-preview-${index}" style="display: ${isExpanded ? 'block' : 'none'};">
                ${escapeHtml(pack.markdown || 'No markdown dossier generated yet.')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function updateDrawer(pack) {
    const backdrop = container.querySelector('#research-drawer-backdrop');
    const headInfo = container.querySelector('#drawer-head-info');
    const bodyWrap = container.querySelector('#drawer-body-wrap');
    if (!backdrop || !headInfo || !bodyWrap || !pack) return;

    const p = pack.profile || {};
    const c = pack.company || {};
    const r = pack.row || {};
    const e = pack.enrichment || {};
    const name = p.fullName || c.name || r.name || r.fullName || 'Prospect Dossier';
    const isErr = Boolean(pack.error || pack.status === 'error');
    const url = p.url || c.url || r.linkedinUrl || '';

    headInfo.innerHTML = `
      <div style="width: 36px; height: 36px; border-radius: 50%; background: #104B35; color: #ffffff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14px; flex-shrink: 0;">
        ${escapeHtml((name[0] || 'P').toUpperCase())}
      </div>
      <div style="min-width: 0;">
        <h3 style="margin: 0; font-size: 15px; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
          <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(name)}</span>
          ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #0284c7; display: inline-flex; align-items: center; font-size: 12px; text-decoration: none;" title="Open on LinkedIn">↗</a>` : ''}
        </h3>
        <div style="font-size: 11.5px; color: #64748b; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${escapeHtml([p.title || c.industry, p.company || c.name].filter(Boolean).join(' · ') || 'Crafture Dossier')}
        </div>
      </div>
    `;

    const experience = p.experience || [];
    const posts = pack.recentPosts || [];

    bodyWrap.innerHTML = `
      <!-- Status Banner -->
      ${isErr ? `
        <div style="margin-bottom: 20px; padding: 12px 16px; background: #fef2f2; border: 1px solid #fee2e2; border-radius: 10px; color: #b91c1c; font-size: 13px; display: flex; align-items: flex-start; gap: 10px;">
          <span style="display: inline-flex; margin-top: 2px;">${ICONS.warning}</span>
          <div>
            <div style="font-weight: 700;">Research Issue Encountered</div>
            <div style="font-size: 12.5px; margin-top: 2px; line-height: 1.4;">${escapeHtml(pack.error || 'Failed to resolve or fetch profile data')}</div>
          </div>
        </div>
      ` : `
        <div style="margin-bottom: 20px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span class="research-pill pill-green">${ICONS.check} Dossier Ready</span>
          ${pack.resolved?.confidence ? `<span class="research-pill pill-slate">${Math.round(pack.resolved.confidence * 100)}% match</span>` : ''}
          ${pack.connectionStatus ? `<span class="research-pill pill-teal">${escapeHtml(pack.connectionStatus)}</span>` : ''}
        </div>
      `}

      <!-- Quick Meta Grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px;">
        <div>
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Company</div>
          <div style="font-size: 13px; font-weight: 600; color: #1e293b; margin-top: 2px;">${escapeHtml(p.company || c.name || r.company || '—')}</div>
        </div>
        <div>
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Location</div>
          <div style="font-size: 13px; font-weight: 600; color: #1e293b; margin-top: 2px;">${escapeHtml(p.location || c.hq || '—')}</div>
        </div>
        <div>
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Verified Email</div>
          <div style="font-size: 13px; font-weight: 600; color: ${e.email || r.email ? '#059669' : '#64748b'}; margin-top: 2px;">${escapeHtml(e.email || r.email || 'None discovered')}</div>
        </div>
        <div>
          <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Phone</div>
          <div style="font-size: 13px; font-weight: 600; color: #1e293b; margin-top: 2px;">${escapeHtml(e.phone || r.phone || '—')}</div>
        </div>
      </div>

      <!-- Signals -->
      ${(pack.signals || []).length > 0 ? `
        <div style="margin-bottom: 20px;">
          <h4 style="font-size: 12px; font-weight: 800; color: #0f172a; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">Buying & Outreach Signals</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 6px;">
            ${(pack.signals || []).map(formatSignalPill).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Experience Section -->
      ${experience.length > 0 ? `
        <div style="margin-bottom: 20px;">
          <h4 style="font-size: 12px; font-weight: 800; color: #0f172a; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">Career Experience</h4>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${experience.slice(0, 5).map((exp) => `
              <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px;">
                <div style="font-size: 13px; font-weight: 700; color: #1e293b;">${escapeHtml(exp.title || 'Role')}</div>
                <div style="font-size: 12px; color: #64748b;">${escapeHtml(exp.company || '')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Recent Posts Section -->
      ${posts.length > 0 ? `
        <div style="margin-bottom: 20px;">
          <h4 style="font-size: 12px; font-weight: 800; color: #0f172a; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">Recent LinkedIn Activity</h4>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${posts.slice(0, 4).map((post) => `
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #334155;">
                <div style="line-height: 1.4;">${escapeHtml(String(post.text || '').slice(0, 160))}${post.text && post.text.length > 160 ? '…' : ''}</div>
                <div style="margin-top: 6px; font-size: 11px; color: #94a3b8; display: flex; gap: 12px;">
                  <span>👍 ${post.likes || 0} likes</span>
                  <span>💬 ${post.comments || 0} comments</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Markdown Dossier Document -->
      <div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h4 style="font-size: 12px; font-weight: 800; color: #0f172a; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">Full Markdown Dossier</h4>
          <button type="button" id="btn-copy-drawer-md" class="btn-pill btn-soft btn-sm" style="padding: 4px 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
            ${ICONS.copy || ''} Copy Markdown
          </button>
        </div>
        <pre style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; font-size: 11.5px; font-family: monospace; line-height: 1.5; white-space: pre-wrap; max-height: 300px; overflow-y: auto; color: #334155;">${escapeHtml(pack.markdown || 'No markdown dossier available.')}</pre>
      </div>
    `;

    bodyWrap.querySelector('#btn-copy-drawer-md')?.addEventListener('click', async () => {
      if (pack.markdown) {
        await navigator.clipboard.writeText(pack.markdown).catch(() => {});
        ctx.showToast?.('Dossier copied to clipboard!', 'success');
      }
    });
  }

  function openDrawer(idx) {
    activeDrawerPackIdx = idx;
    const backdrop = container.querySelector('#research-drawer-backdrop');
    if (backdrop && packs[idx]) {
      updateDrawer(packs[idx]);
      backdrop.classList.add('is-open');
    }
  }

  function closeDrawer() {
    activeDrawerPackIdx = null;
    const backdrop = container.querySelector('#research-drawer-backdrop');
    if (backdrop) {
      backdrop.classList.remove('is-open');
    }
  }

  function wirePackEvents(root) {
    if (!root) return;
    root.querySelectorAll('.btn-open-dossier-drawer').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        openDrawer(idx);
      });
    });

    root.querySelectorAll('.btn-toggle-dossier').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        const target = container.querySelector(`#dossier-preview-${idx}`);
        if (target) {
          if (openDossierIndices.has(idx)) {
            openDossierIndices.delete(idx);
            target.style.display = 'none';
            btn.innerHTML = `Inline Preview ${ICONS.chevronDown}`;
          } else {
            openDossierIndices.add(idx);
            target.style.display = 'block';
            btn.innerHTML = `Hide Preview <span style="display:inline-flex; transform:rotate(180deg);">${ICONS.chevronDown}</span>`;
          }
        }
      });
    });

    root.querySelectorAll('.btn-resolve-candidate').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const packIdx = Number(btn.dataset.packIdx);
        const sel = root.querySelector(`.candidate-picker[data-pack-idx="${packIdx}"]`);
        const chosenUrl = sel?.value;
        if (!chosenUrl) {
          ctx.showToast?.('Select a matching candidate first.', 'warn');
          return;
        }

        const pack = packs[packIdx];
        if (!pack) return;

        btn.disabled = true;
        btn.textContent = 'Resolving…';

        try {
          const nextRow = { ...(pack.row || {}), linkedinUrl: chosenUrl };
          const job = await call(ACTIONS.RESEARCH_PACK, {
            rows: [nextRow],
            full: fullCapture,
            enrich: enrichContacts,
          });

          if (job?.jobId) {
            ctx.showToast?.('Re-running candidate match…', 'info');
            totalCount = job.total || 1;
            doneCount = 0;
            startPolling(job.jobId);
          }
        } catch (err) {
          ctx.showToast?.(`Resolution failed: ${err.message || err}`, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Use Selected';
        }
      });
    });
  }

  function paint(isSilent = false) {
    if (ctx?.isStale?.() || (ctx?.isActiveView && !ctx.isActiveView())) return;
    const scrollPos = ctx?.getScrollPosition?.(container);
    const focusedInput = ctx?.captureInputFocus?.(container) || captureInputFocus(container);

    const progressPct = totalCount > 0 ? Math.min(100, Math.round((doneCount / totalCount) * 100)) : 0;
    const unresolvedCount = packs.filter((p) => !p.resolved || p.resolved.kind === 'unresolved').length;

    let etaDisplay = '';
    if (jobStatus === 'running' && totalCount > doneCount) {
      const elapsed = Date.now() - startedAt;
      const remainingMs = doneCount > 0
        ? (elapsed / doneCount) * (totalCount - doneCount)
        : Math.max(0, etaMs - elapsed);
      etaDisplay = ` · ~${fmtDuration(remainingMs)} remaining`;
    }

    const jobSubtitleText = `${fmtNumber(doneCount)} of ${fmtNumber(totalCount)} processed · ${jobStatus}${unresolvedCount ? ` · ${unresolvedCount} unresolved` : ''}${etaDisplay}`;

    // Silent in-place DOM update when polling: zero spinner wipe, zero flicker
    const activeCardEl = container.querySelector('#research-active-job-card');
    if (isSilent && activeCardEl && activeJobId) {
      const headPill = container.querySelector('#research-head-status-pill');
      if (headPill) {
        headPill.className = `research-pill ${jobStatus === 'completed' ? 'pill-green' : jobStatus === 'failed' ? 'pill-red' : 'pill-blue'}`;
        headPill.innerHTML = `<span class="live-dot-circle" style="background: currentColor;"></span> ${jobStatus.toUpperCase()} ${doneCount}/${totalCount}`;
      }

      const subTitleEl = container.querySelector('#research-job-subtitle');
      if (subTitleEl) subTitleEl.textContent = jobSubtitleText;

      const progBarEl = container.querySelector('#research-progress-bar-fill');
      if (progBarEl) progBarEl.style.width = `${progressPct}%`;

      const listWrap = container.querySelector('#research-packs-list-wrap');
      if (listWrap) {
        listWrap.innerHTML = renderPacksListHtml(packs);
        wirePackEvents(listWrap);
      }

      if (activeDrawerPackIdx !== null && packs[activeDrawerPackIdx]) {
        updateDrawer(packs[activeDrawerPackIdx]);
      }
      return;
    }

    container.innerHTML = `
      <div class="research-view-shell">
        <!-- Header -->
        <div class="research-head-row">
          <div>
            <h1 class="research-page-title">Prospect & Company Research</h1>
            <p class="research-page-sub">Build deep dossiers, discover buying signals, verify identity, and enrich contact details.</p>
          </div>
          ${activeJobId ? `
            <div style="display: flex; align-items: center; gap: 8px;">
              <span id="research-head-status-pill" class="research-pill ${jobStatus === 'completed' ? 'pill-green' : jobStatus === 'failed' ? 'pill-red' : 'pill-blue'}">
                <span class="live-dot-circle" style="background: currentColor;"></span>
                ${jobStatus.toUpperCase()} ${doneCount}/${totalCount}
              </span>
            </div>
          ` : ''}
        </div>

        ${lastError ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 12px 18px; color: #dc2626; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: space-between;">
            <span style="display:inline-flex; align-items:center; gap:6px;">${ICONS.warning} ${escapeHtml(lastError)}</span>
            <button type="button" id="btn-dismiss-error" style="background:none; border:none; color:#dc2626; cursor:pointer; display:inline-flex; align-items:center;">${ICONS.x}</button>
          </div>
        ` : ''}

        <!-- 1. Quick Single Lookup Card -->
        <div class="research-white-card">
          <h2 class="research-card-title">${ICONS.search} Quick Prospect Lookup</h2>
          <p class="research-card-subtitle">Generate an instant research dossier for a single LinkedIn profile URL or name & company.</p>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <input type="text" id="input-quick-research" placeholder="e.g. https://www.linkedin.com/in/satyanadella or Satya Nadella, Microsoft" style="flex: 1; min-width: 300px; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 13.5px; outline: none;" />
            <button type="button" id="btn-run-quick-research" class="btn-primary-settings" style="padding: 10px 20px; font-size: 13px; font-weight: 700; background: #104B35; color: #ffffff; border: none; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
              ${ICONS.search} Build Dossier
            </button>
          </div>
        </div>

        <!-- 2. Bulk CSV Ingestion Card -->
        <div class="research-white-card">
          <h2 class="research-card-title">${ICONS.download} Bulk Research CSV Ingest</h2>
          <p class="research-card-subtitle">Drop a CSV file or paste rows. Everything is parsed locally in your browser — zero external uploads.</p>

          <input type="file" id="file-csv-picker" accept=".csv,text/csv" style="display: none;" />

          <div class="research-dropzone" id="csv-dropzone">
            <div style="color: #104B35; margin-bottom: 8px;">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <div style="font-size: 14px; font-weight: 700; color: #1e293b;">Drag and drop your CSV file here, or click to browse</div>
            <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Supports name, linkedin_url, email, domain, company</div>
          </div>

          <div style="margin-top: 16px;">
            <div style="font-size: 12.5px; font-weight: 600; color: #475569; margin-bottom: 6px;">…or paste CSV text directly:</div>
            <textarea id="textarea-paste-csv" rows="3" placeholder="name,linkedin_url,company&#10;Satya Nadella,https://www.linkedin.com/in/satyanadella,Microsoft" style="width: 100%; box-sizing: border-box; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 13px; font-family: monospace; outline: none;"></textarea>
            <div style="margin-top: 8px; display: flex; justify-content: flex-end;">
              <button type="button" id="btn-parse-pasted" class="btn-pill btn-soft btn-sm" style="padding: 7px 16px; font-size: 12.5px; font-weight: 700; cursor: pointer;">
                Parse Pasted CSV
              </button>
            </div>
          </div>
        </div>

        ${headers.length > 0 ? `
          <!-- 3. Column Mapping & Preview Card -->
          <div class="research-white-card">
            <h2 class="research-card-title">${ICONS.filter} Column Mapping & Preview</h2>
            <p class="research-card-subtitle">${fmtNumber(researchRows.length)} rows parsed · Map columns to Crafture research fields.</p>

            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px;">
              ${RESEARCH_FIELDS.map((f) => `
                <div>
                  <label style="display: block; font-size: 12px; font-weight: 700; color: #475569; margin-bottom: 4px;">${f.label}</label>
                  <select class="select-column-map" data-field="${f.key}" style="width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; background: #ffffff;">
                    <option value="">— ignore —</option>
                    ${headers.map((h) => `<option value="${escapeHtml(h)}" ${mapping[f.key] === h ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
                  </select>
                </div>
              `).join('')}
            </div>

            <!-- Preview Table -->
            <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: left;">
                <thead style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                  <tr>
                    ${RESEARCH_FIELDS.map((f) => `<th style="padding: 8px 12px; font-weight: 700; color: #475569;">${f.label}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>
                  ${researchRows.slice(0, PREVIEW_ROW_COUNT).map((r) => `
                    <tr style="border-bottom: 1px solid #f1f5f9;">
                      ${RESEARCH_FIELDS.map((f) => `<td style="padding: 8px 12px; color: #1e293b;">${escapeHtml(r[f.key] || '—')}</td>`).join('')}
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            <!-- Execution Options & Trigger -->
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
              <div style="display: flex; gap: 20px; flex-wrap: wrap;">
                <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #1e293b; cursor: pointer;">
                  <input type="checkbox" id="check-full-capture" ${fullCapture ? 'checked' : ''} />
                  <span>Full capture (page text & profile photo)</span>
                </label>
                <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #1e293b; cursor: pointer;">
                  <input type="checkbox" id="check-enrich-contacts" ${enrichContacts ? 'checked' : ''} />
                  <span>Enrich contact details (email & phone)</span>
                </label>
              </div>

              <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                <input type="text" id="input-list-name" placeholder="Save results into list (optional)" value="${escapeHtml(targetListName)}" style="flex: 1; min-width: 240px; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none;" />
                <button type="button" id="btn-build-packs" class="btn-primary-settings" style="padding: 9px 22px; font-size: 13px; font-weight: 700; background: #104B35; color: #ffffff; border: none; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                  ${ICONS.lightning} Build Research Packs (${researchRows.length} rows)
                </button>
              </div>
            </div>
          </div>
        ` : ''}

        ${activeJobId ? `
          <!-- 4. Active Job Progress Card -->
          <div class="research-white-card" id="research-active-job-card">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
              <div>
                <h2 class="research-card-title" style="margin: 0;">
                  ${jobStatus === 'running' || jobStatus === 'pending' ? `<span style="display:inline-block; animation:spin 0.8s linear infinite;">${ICONS.refresh || '⟳'}</span>` : ICONS.check}
                  Research Job #${activeJobId.slice(-8)}
                </h2>
                <div id="research-job-subtitle" style="font-size: 12.5px; color: #64748b; margin-top: 4px;">
                  ${jobSubtitleText}
                </div>
              </div>

              <!-- Export Actions & Manual Run Now -->
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                ${jobStatus === 'running' || jobStatus === 'pending' ? `
                  <button type="button" id="btn-run-research-now" class="btn-pill btn-soft btn-sm" style="padding: 7px 14px; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; background: #E6EFE9; color: #167448; border: 1px solid #DCE5DE;">
                    ${ICONS.play} Run Now
                  </button>
                ` : ''}
                <button type="button" id="btn-download-csv" class="btn-pill btn-soft btn-sm" style="padding: 7px 14px; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;" ${packs.length === 0 ? 'disabled' : ''}>
                  ${ICONS.download} Download CSV
                </button>
                <button type="button" id="btn-download-md" class="btn-pill btn-soft btn-sm" style="padding: 7px 14px; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;" ${packs.length === 0 ? 'disabled' : ''}>
                  ${ICONS.file || ICONS.download} Download Markdown
                </button>
              </div>
            </div>

            <!-- Progress Bar -->
            <div style="background: #f1f5f9; height: 10px; border-radius: 6px; overflow: hidden; margin-bottom: 16px;">
              <div id="research-progress-bar-fill" style="background: linear-gradient(90deg, #104B35 0%, #167448 100%); height: 100%; width: ${progressPct}%; transition: width 0.3s ease;"></div>
            </div>

            <!-- Generated Dossiers List Wrap -->
            <div style="margin-top: 20px;">
              <h3 style="font-size: 14px; font-weight: 700; color: #1e293b; margin: 0 0 12px 0;">Generated Dossiers (${packs.length})</h3>
              <div id="research-packs-list-wrap">
                ${renderPacksListHtml(packs)}
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Research Dossier Slide-Over Drawer -->
        <div class="research-drawer-backdrop" id="research-drawer-backdrop">
          <div class="research-drawer" id="research-drawer">
            <div class="research-drawer-head">
              <div id="drawer-head-info" style="display: flex; align-items: center; gap: 12px; min-width: 0;"></div>
              <button type="button" id="btn-close-research-drawer" style="background: none; border: none; cursor: pointer; color: #64748b; padding: 6px; border-radius: 6px; display: inline-flex; align-items: center;" title="Close Drawer">
                ${ICONS.x || '✕'}
              </button>
            </div>
            <div class="research-drawer-body" id="drawer-body-wrap"></div>
          </div>
        </div>
      </div>
    `;

    wireEvents();
    ctx?.restoreScrollPosition?.(container, scrollPos);
    ctx?.restoreInputFocus?.(container, focusedInput) || restoreInputFocus(container, focusedInput);
  }

  function wireEvents() {
    // Dismiss error
    container.querySelector('#btn-dismiss-error')?.addEventListener('click', () => {
      lastError = null;
      paint();
    });

    // Quick single lookup
    const inputQuick = container.querySelector('#input-quick-research');
    const btnQuick = container.querySelector('#btn-run-quick-research');
    if (btnQuick && inputQuick) {
      btnQuick.addEventListener('click', async () => {
        const val = inputQuick.value.trim();
        if (!val) {
          ctx.showToast?.('Enter a LinkedIn URL or Name/Company first.', 'warn');
          return;
        }

        btnQuick.disabled = true;
        const origText = btnQuick.innerHTML;
        btnQuick.innerHTML = 'Starting…';

        try {
          const isUrl = /^https?:\/\//i.test(val);
          const row = isUrl
            ? { linkedinUrl: val }
            : { name: val.split(',')[0].trim(), company: (val.split(',')[1] || '').trim() };

          const res = await call(ACTIONS.RESEARCH_PACK, {
            rows: [row],
            full: true,
            enrich: true,
            listName: 'Quick Research',
          });

          if (res?.jobId) {
            ctx.showToast?.('Research Pack queued!', 'success');
            totalCount = res.total || 1;
            doneCount = 0;
            packs = [];
            startPolling(res.jobId);
          }
        } catch (err) {
          lastError = err?.message || 'Quick lookup failed';
          ctx.showToast?.(lastError, 'error');
          paint();
        } finally {
          btnQuick.disabled = false;
          btnQuick.innerHTML = origText;
        }
      });
    }

    // CSV File Drop & Pick
    const filePicker = container.querySelector('#file-csv-picker');
    const dropzone = container.querySelector('#csv-dropzone');

    if (dropzone && filePicker) {
      dropzone.addEventListener('click', () => filePicker.click());
      filePicker.addEventListener('change', async () => {
        const file = filePicker.files && filePicker.files[0];
        if (!file) return;
        try {
          const text = await readTextFile(file);
          ingestCsv(text);
        } catch (e) {
          lastError = e?.message || 'Could not read CSV file';
          ctx.showToast?.(lastError, 'error');
          paint();
        }
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('is-over');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-over'));
      dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-over');
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!file) return;
        try {
          const text = await readTextFile(file);
          ingestCsv(text);
        } catch (e2) {
          lastError = e2?.message || 'Could not read CSV file';
          ctx.showToast?.(lastError, 'error');
          paint();
        }
      });
    }

    // Paste CSV
    const btnParsePasted = container.querySelector('#btn-parse-pasted');
    const textareaPasted = container.querySelector('#textarea-paste-csv');
    if (btnParsePasted && textareaPasted) {
      btnParsePasted.addEventListener('click', () => {
        const val = textareaPasted.value.trim();
        if (!val) {
          ctx.showToast?.('Paste CSV content first.', 'warn');
          return;
        }
        ingestCsv(val);
      });
    }

    // Column Map Selects
    container.querySelectorAll('.select-column-map').forEach((sel) => {
      sel.addEventListener('change', () => {
        const fieldKey = sel.dataset.field;
        mapping[fieldKey] = sel.value || null;
        researchRows = toResearchRows(parsedRows, mapping);
        paint();
      });
    });

    // Options check/inputs
    container.querySelector('#check-full-capture')?.addEventListener('change', (e) => {
      fullCapture = e.target.checked;
    });
    container.querySelector('#check-enrich-contacts')?.addEventListener('change', (e) => {
      enrichContacts = e.target.checked;
    });
    container.querySelector('#input-list-name')?.addEventListener('input', (e) => {
      targetListName = e.target.value;
    });

    // Build Research Packs Button
    const btnBuild = container.querySelector('#btn-build-packs');
    if (btnBuild) {
      btnBuild.addEventListener('click', async () => {
        if (!researchRows.length) {
          ctx.showToast?.('Load or paste some rows first.', 'warn');
          return;
        }

        btnBuild.disabled = true;
        const origText = btnBuild.innerHTML;
        btnBuild.innerHTML = 'Starting…';

        try {
          const params = {
            rows: researchRows,
            full: fullCapture,
            enrich: enrichContacts,
          };
          if (targetListName.trim()) params.listName = targetListName.trim();

          const job = await call(ACTIONS.RESEARCH_PACK, params);
          if (job?.jobId) {
            ctx.showToast?.(`Queued research for ${job.total || researchRows.length} rows!`, 'success');
            totalCount = job.total || researchRows.length;
            doneCount = 0;
            packs = [];
            etaMs = job.etaMs || 0;
            startPolling(job.jobId);
          }
        } catch (err) {
          lastError = err?.message || 'Failed to start research pack';
          ctx.showToast?.(lastError, 'error');
          paint();
        } finally {
          btnBuild.disabled = false;
          btnBuild.innerHTML = origText;
        }
      });
    }

    // Wire dossier cards & actions
    wirePackEvents(container);

    // Drawer close events
    container.querySelector('#btn-close-research-drawer')?.addEventListener('click', closeDrawer);
    container.querySelector('#research-drawer-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'research-drawer-backdrop') {
        closeDrawer();
      }
    });

    // Run Now button (Manual trigger)
    const btnRunNow = container.querySelector('#btn-run-research-now');
    if (btnRunNow) {
      btnRunNow.addEventListener('click', async () => {
        btnRunNow.disabled = true;
        const origHtml = btnRunNow.innerHTML;
        btnRunNow.innerHTML = `<span style="display:inline-block; animation:spin 0.8s linear infinite;">${ICONS.refresh || '⟳'}</span> Running...`;
        try {
          if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
            await new Promise((resolve) => {
              chrome.runtime.sendMessage({ type: 'RESEARCH_RUN_NOW' }, (resp) => {
                resolve(resp);
              });
            }).catch(() => null);
          }
          await call(ACTIONS.CAMPAIGN_TICK, {}).catch(() => {});
          ctx.showToast?.('Research processing triggered!', 'info');
          await pollJob();
        } catch (e) {
          ctx.showToast?.(`Run error: ${e.message || e}`, 'error');
        } finally {
          btnRunNow.disabled = false;
          btnRunNow.innerHTML = origHtml;
        }
      });
    }

    // Download CSV
    const btnDownCsv = container.querySelector('#btn-download-csv');
    if (btnDownCsv) {
      btnDownCsv.addEventListener('click', async () => {
        const rows = packs.map((p) => p.csvRow).filter(Boolean);
        if (!rows.length) {
          ctx.showToast?.('No enriched rows available yet.', 'warn');
          return;
        }
        try {
          await downloadCsv(`research-${slug(activeJobId || 'job')}-${today()}.csv`, rows);
          ctx.showToast?.('CSV downloaded!', 'success');
        } catch (e) {
          ctx.showToast?.(`Download error: ${e.message || e}`, 'error');
        }
      });
    }

    // Download Markdown
    const btnDownMd = container.querySelector('#btn-download-md');
    if (btnDownMd) {
      btnDownMd.addEventListener('click', async () => {
        const markdown = packs
          .map((p) => p.markdown)
          .filter(Boolean)
          .join('\n\n---\n\n');
        if (!markdown) {
          ctx.showToast?.('No markdown dossiers written yet.', 'warn');
          return;
        }
        try {
          await downloadMarkdown(`research-${slug(activeJobId || 'job')}-${today()}.md`, markdown);
          ctx.showToast?.('Markdown dossiers downloaded!', 'success');
        } catch (e) {
          ctx.showToast?.(`Download error: ${e.message || e}`, 'error');
        }
      });
    }
  }

  let storageDebounceTimer = null;
  const storageListener = (changes, area) => {
    if (area !== 'local') return;
    const checkFn = ctx.isStorageChangeRelevant || isStorageChangeRelevant;
    if (checkFn && !checkFn(changes, RESEARCH_RELEVANT_KEYS)) return;
    clearTimeout(storageDebounceTimer);
    storageDebounceTimer = setTimeout(async () => {
      if (!ctx.isActiveView || ctx.isActiveView()) {
        paint();
      }
    }, 400);
  };

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(storageListener);
  }

  if (typeof ctx?.registerCleanup === 'function') {
    ctx.registerCleanup(() => {
      stopPolling();
      clearTimeout(storageDebounceTimer);
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(storageListener);
      }
    });
  }

  paint();
}
