/**
 * OutFox — Full-Page Research & Dossier View
 *
 * Automated prospect intelligence engine:
 * 1. Single profile quick-lookup dossier generator.
 * 2. Bulk CSV drop/paste with column auto-mapping and preview.
 * 3. Deep LinkedIn profile resolution, identity verification & candidate rival matching.
 * 4. Buying & outreach signal extraction (job changes, posting habits, mutuals, hiring).
 * 5. Instant CSV & Markdown dossier exports.
 *
 * 100% Manifest V3 CSP Compliant · Vector SVG Icons · Pure OutFox Design System
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
    return `<span class="research-pill pill-orange">💼 Changed Job Recently</span>`;
  }
  if (sig === 'postedRecently') {
    return `<span class="research-pill pill-blue">✍️ Posted Recently</span>`;
  }
  if (sig === 'high-activity') {
    return `<span class="research-pill pill-green">🔥 High Activity</span>`;
  }
  if (sig === 'companyHiring') {
    return `<span class="research-pill pill-purple">🚀 Company Hiring</span>`;
  }
  if (sig === 'alreadyConnected') {
    return `<span class="research-pill pill-teal">🤝 1st Degree Connection</span>`;
  }
  if (sig === 'engagedWithMe') {
    return `<span class="research-pill pill-orange">⭐ Engaged With You</span>`;
  }
  if (sig.startsWith('mutuals:')) {
    const count = sig.split(':')[1] || '';
    return `<span class="research-pill pill-slate">👥 ${count} Mutuals</span>`;
  }
  if (sig.startsWith('followers:')) {
    const count = sig.split(':')[1] || '';
    return `<span class="research-pill pill-slate">📢 ${count} Followers</span>`;
  }
  if (sig.startsWith('headcount:')) {
    const size = sig.split(':')[1] || '';
    return `<span class="research-pill pill-slate">🏢 ${size} Size</span>`;
  }
  return `<span class="research-pill pill-slate">${escapeHtml(sig)}</span>`;
}

function ensureResearchStyles() {
  if (document.getElementById('outfox-research-styles')) return;
  const style = document.createElement('style');
  style.id = 'outfox-research-styles';
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
      border-color: #ff6b00;
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
    .pill-orange { background: #fff7ed; color: #ea580c; border: 1px solid #fed7aa; }
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
    pollTimer = setInterval(pollJob, POLL_INTERVAL_MS);
    pollJob();
  }

  async function pollJob() {
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
      paint();
    } catch (err) {
      stopPolling();
      lastError = err?.message || 'Failed to poll research job';
      ctx.showToast?.(`Research error: ${lastError}`, 'error');
      paint();
    }
  }

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

  function paint() {
    if (ctx?.isStale?.() || (ctx?.isActiveView && !ctx.isActiveView())) return;

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
              <span class="research-pill ${jobStatus === 'completed' ? 'pill-green' : jobStatus === 'failed' ? 'pill-red' : 'pill-blue'}">
                <span class="live-dot-circle" style="background: currentColor;"></span>
                ${jobStatus.toUpperCase()} ${doneCount}/${totalCount}
              </span>
            </div>
          ` : ''}
        </div>

        ${lastError ? `
          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 12px 18px; color: #dc2626; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: space-between;">
            <span>⚠ ${escapeHtml(lastError)}</span>
            <button type="button" id="btn-dismiss-error" style="background:none; border:none; color:#dc2626; cursor:pointer; font-weight:700;">✕</button>
          </div>
        ` : ''}

        <!-- 1. Quick Single Lookup Card -->
        <div class="research-white-card">
          <h2 class="research-card-title">${ICONS.search} Quick Prospect Lookup</h2>
          <p class="research-card-subtitle">Generate an instant research dossier for a single LinkedIn profile URL or name & company.</p>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <input type="text" id="input-quick-research" placeholder="e.g. https://www.linkedin.com/in/satyanadella or Satya Nadella, Microsoft" style="flex: 1; min-width: 300px; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 13.5px; outline: none;" />
            <button type="button" id="btn-run-quick-research" class="btn-primary-settings" style="padding: 10px 20px; font-size: 13px; font-weight: 700; background: #ff6b00; color: #ffffff; border: none; border-radius: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
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
            <div style="color: #ff6b00; margin-bottom: 8px;">
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
            <p class="research-card-subtitle">${fmtNumber(researchRows.length)} rows parsed · Map columns to OutFox research fields.</p>

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
                <button type="button" id="btn-build-packs" class="btn-primary-settings" style="padding: 9px 22px; font-size: 13px; font-weight: 700; background: #ff6b00; color: #ffffff; border: none; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                  ${ICONS.lightning} Build Research Packs (${researchRows.length} rows)
                </button>
              </div>
            </div>
          </div>
        ` : ''}

        ${activeJobId ? `
          <!-- 4. Active Job Progress Card -->
          <div class="research-white-card">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 12px;">
              <div>
                <h2 class="research-card-title" style="margin: 0;">
                  ${jobStatus === 'running' || jobStatus === 'pending' ? `<span style="display:inline-block; animation:spin 0.8s linear infinite;">${ICONS.refresh || '⟳'}</span>` : ICONS.check}
                  Research Job #${activeJobId.slice(-8)}
                </h2>
                <div style="font-size: 12.5px; color: #64748b; margin-top: 4px;">
                  ${fmtNumber(doneCount)} of ${fmtNumber(totalCount)} processed · ${jobStatus}${unresolvedCount ? ` · ${unresolvedCount} unresolved` : ''}${etaDisplay}
                </div>
              </div>

              <!-- Export Actions -->
              <div style="display: flex; gap: 8px;">
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
              <div style="background: linear-gradient(90deg, #ff6b00 0%, #ea580c 100%); height: 100%; width: ${progressPct}%; transition: width 0.3s ease;"></div>
            </div>

            <!-- Generated Dossiers List -->
            <div style="margin-top: 20px;">
              <h3 style="font-size: 14px; font-weight: 700; color: #1e293b; margin: 0 0 12px 0;">Generated Dossiers (${packs.length})</h3>

              ${packs.length === 0 ? `
                <div style="text-align: center; padding: 32px 20px; color: #94a3b8; font-size: 13px;">
                  Processing queue… Dossiers will stream in automatically.
                </div>
              ` : `
                <div class="research-packs-list">
                  ${packs.map((pack, index) => {
                    const resolved = pack.resolved || { kind: 'unresolved', confidence: 0 };
                    const p = pack.profile || {};
                    const c = pack.company || {};
                    const name = p.fullName || c.name || pack.row?.name || pack.row?.linkedinUrl || `Row #${index + 1}`;
                    const subtitle = [p.title || c.industry, p.company || c.name, p.location].filter(Boolean).join(' · ');
                    const signals = pack.signals || [];
                    const candidates = resolved.candidates || [];

                    return `
                      <div class="research-pack-item" data-pack-idx="${index}">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
                          <div>
                            <div style="font-size: 14.5px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                              <span>${escapeHtml(name)}</span>
                              <span class="research-pill ${resolved.kind === 'person' ? 'pill-green' : resolved.kind === 'company' ? 'pill-blue' : 'pill-red'}">
                                ${resolved.kind}
                              </span>
                              ${resolved.confidence ? `
                                <span class="research-pill pill-slate">${Math.round(resolved.confidence * 100)}% match</span>
                              ` : ''}
                            </div>
                            ${subtitle ? `
                              <div style="font-size: 12.5px; color: #64748b; margin-top: 3px;">${escapeHtml(subtitle)}</div>
                            ` : ''}
                          </div>

                          <button type="button" class="btn-toggle-dossier" data-idx="${index}" style="background: none; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px 10px; font-size: 11.5px; font-weight: 700; color: #475569; cursor: pointer;">
                            View Dossier ⌵
                          </button>
                        </div>

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
                            <button type="button" class="btn-resolve-candidate" data-pack-idx="${index}" style="padding: 6px 12px; font-size: 12px; font-weight: 700; background: #ff6b00; color: #fff; border: none; border-radius: 6px; cursor: pointer;">
                              Use Selected
                            </button>
                          </div>
                        ` : ''}

                        <!-- Collapsible Markdown Preview -->
                        <div class="research-dossier-preview" id="dossier-preview-${index}" style="display: none;">
                          ${escapeHtml(pack.markdown || 'No markdown dossier generated yet.')}
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              `}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    wireEvents();
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

    // Dossier Expander Toggles
    container.querySelectorAll('.btn-toggle-dossier').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = btn.dataset.idx;
        const target = container.querySelector(`#dossier-preview-${idx}`);
        if (target) {
          const isHidden = target.style.display === 'none';
          target.style.display = isHidden ? 'block' : 'none';
          btn.textContent = isHidden ? 'Hide Dossier ∧' : 'View Dossier ⌵';
        }
      });
    });

    // Ambiguous Candidate Resolution
    container.querySelectorAll('.btn-resolve-candidate').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const packIdx = Number(btn.dataset.packIdx);
        const sel = container.querySelector(`.candidate-picker[data-pack-idx="${packIdx}"]`);
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

  paint();
}
