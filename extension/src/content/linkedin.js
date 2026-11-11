/**
 * OutFox — Content Script (ISOLATED world)
 *
 * Two jobs:
 *  1. On-page UI — selection checkboxes on search results, a floating action
 *     bar, an "Export Profile" button, toasts.
 *  2. Answering the background's page requests (CAPTURE_FULL, DOM_LIKE,
 *     DOM_FOLLOW, DOM_COMMENT), which are implemented in capture.js and
 *     reached through `globalThis.LITK`.
 *
 * Everything it asks of the background goes through the v2 contract:
 * `{ action, params }` in, `{ ok, data } | { ok: false, error }` back.
 */

(function () {
  'use strict';

  /* ================================================================ */
  /*  Helpers                                                         */
  /* ================================================================ */

  /**
   * Run one contract action in the background.
   * Resolves with `data`; rejects with the envelope's error message.
   */
  function call(action, params) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, params: params || {} }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp) {
          reject(new Error('The extension did not answer.'));
          return;
        }
        if (resp.ok === false || resp.error) {
          const error = resp.error || {};
          reject(new Error(error.message || String(error) || 'Request failed'));
          return;
        }
        resolve(resp.data === undefined ? resp : resp.data);
      });
    });
  }

  function publicIdFromUrl(url) {
    const match = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function logDebug(level, tag, message, data = null) {
    const entry = {
      timestamp: new Date().toLocaleTimeString(),
      level: level || 'info',
      tag: tag || 'Importer',
      message: String(message || ''),
      data: data ? (typeof data === 'object' ? JSON.stringify(data) : String(data)) : null,
    };
    try {
      chrome.runtime.sendMessage({ type: 'LOG_ENTRY', entry }, () => {
        if (chrome.runtime.lastError) {}
      });
    } catch {}
  }

  /* ================================================================ */
  /*  Toast notifications                                             */
  /* ================================================================ */

  let toastContainer = null;

  function ensureToastContainer() {
    if (toastContainer && document.body.contains(toastContainer)) return;
    toastContainer = document.createElement('div');
    toastContainer.id = 'litk-toast-container';
    document.body.appendChild(toastContainer);
  }

  function showToast(message, type = 'info', duration = 4000) {
    ensureToastContainer();

    const toast = document.createElement('div');
    toast.className = `litk-toast litk-toast--${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('litk-toast--visible');
    });

    setTimeout(() => {
      toast.classList.remove('litk-toast--visible');
      toast.addEventListener('transitionend', () => toast.remove(), { once: true });
      setTimeout(() => toast.remove(), 500);
    }, duration);
  }

  /* ================================================================ */
  /*  Search results: checkboxes + bulk actions                       */
  /* ================================================================ */

  const selectedResults = new Set();
  let actionBar = null;

  function injectSearchCheckboxes() {
    const resultCards = document.querySelectorAll(
      '.reusable-search__result-container, ' +
      'li.reusable-search__result-container'
    );

    resultCards.forEach((card) => {
      if (card.querySelector('.litk-checkbox')) return;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'litk-checkbox';
      checkbox.title = 'Select for export';

      const link = card.querySelector('a[href*="/in/"]');
      const profileUrl = link ? link.href : '';
      const nameEl = card.querySelector(
        '.entity-result__title-text a span[aria-hidden="true"], ' +
        '.app-aware-link span[dir="ltr"] > span[aria-hidden="true"]'
      );
      const name = nameEl ? nameEl.textContent.trim() : '';

      checkbox.dataset.url = profileUrl;
      checkbox.dataset.name = name;

      checkbox.addEventListener('change', () => {
        const key = profileUrl || name;
        if (!key) return;

        if (checkbox.checked) {
          selectedResults.add(key);
        } else {
          selectedResults.delete(key);
        }
        updateActionBar();
      });

      card.style.position = 'relative';
      card.insertBefore(checkbox, card.firstChild);
    });
  }

  function updateActionBar() {
    if (selectedResults.size === 0) {
      if (actionBar) {
        actionBar.classList.remove('litk-action-bar--visible');
      }
      return;
    }

    if (!actionBar) {
      actionBar = document.createElement('div');
      actionBar.className = 'litk-action-bar';
      actionBar.innerHTML = `
        <span class="litk-action-bar__count">${selectedResults.size} selected</span>
        <button class="litk-action-bar__btn litk-action-bar__btn--export" title="Export selected profiles to CSV">
          Export Selected (CSV)
        </button>
        <button class="litk-action-bar__btn litk-action-bar__btn--clear" title="Deselect all">
          Clear
        </button>
      `;

      actionBar.querySelector('.litk-action-bar__btn--export').addEventListener('click', exportSelected);
      actionBar.querySelector('.litk-action-bar__btn--clear').addEventListener('click', clearSelection);

      document.body.appendChild(actionBar);
    }

    actionBar.querySelector('.litk-action-bar__count').textContent = `${selectedResults.size} selected`;
    actionBar.classList.add('litk-action-bar--visible');
  }

  async function exportSelected() {
    if (selectedResults.size === 0) return;

    showToast(`Fetching ${selectedResults.size} profiles...`, 'info', 10000);

    const profiles = [];

    for (const urlOrName of selectedResults) {
      const publicId = publicIdFromUrl(urlOrName);
      if (!publicId) continue;

      try {
        profiles.push(await call('profile.get', { publicId }));
      } catch (err) {
        console.warn(`[OutFox] Failed to export ${urlOrName}:`, err.message);
      }
    }

    if (profiles.length > 0) {
      try {
        // The engine builds the CSV and hands it to chrome.downloads; a
        // content script cannot download on its own.
        const res = await call('export.csv', { kind: 'profiles', profiles, download: true });
        showToast(`Exported ${profiles.length} profiles to ${res.filename}`, 'success');
      } catch (err) {
        showToast(`Export failed: ${err.message}`, 'error');
      }
    } else {
      showToast('No profiles could be exported', 'error');
    }
  }

  function clearSelection() {
    selectedResults.clear();
    document.querySelectorAll('.litk-checkbox').forEach((cb) => {
      cb.checked = false;
    });
    updateActionBar();
  }

  /* ================================================================ */
  /*  Profile page: export button                                     */
  /* ================================================================ */

  function injectProfileExportButton() {
    if (!window.location.pathname.match(/^\/in\/[^/]+\/?$/)) return;
    if (document.querySelector('.litk-export-btn')) return;

    const nameSection = document.querySelector(
      '.pv-top-card, .ph5, .scaffold-layout__main'
    );
    if (!nameSection) return;

    const btn = document.createElement('button');
    btn.className = 'litk-export-btn';
    btn.textContent = 'Export Profile';
    btn.title = 'Export this profile as JSON (OutFox)';

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Exporting...';

      try {
        const profile = await call('profile.get', { url: window.location.href });

        const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${profile.publicId || 'profile'}.json`;
        a.click();
        URL.revokeObjectURL(url);

        showToast(`Exported ${profile.fullName || 'profile'}`, 'success');
      } catch (err) {
        showToast(`Export failed: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Export Profile';
      }
    });

    const insertTarget =
      nameSection.querySelector('.pv-top-card--list') ||
      nameSection.querySelector('h1')?.parentElement ||
      nameSection;
    insertTarget.appendChild(btn);
  }

  /* ================================================================ */
  /*  Feature B: In-LinkedIn 1-Click "AI Dossier" Button             */
  /* ================================================================ */

  function injectProfileDossierButton() {
    if (!window.location.pathname.match(/^\/in\/[^/]+\/?$/)) return;
    if (document.getElementById('outfox-dossier-btn')) return;

    const targetArea =
      document.querySelector('.pv-top-card-v2-ctas') ||
      document.querySelector('.pvs-profile-actions') ||
      document.querySelector('.pv-top-card--list') ||
      document.querySelector('.ph5 .display-flex') ||
      document.querySelector('h1')?.parentElement;

    if (!targetArea) return;

    const btn = document.createElement('button');
    btn.id = 'outfox-dossier-btn';
    btn.className = 'outfox-pill-btn';
    btn.innerHTML = 'AI Dossier';
    btn.title = 'Generate instant AI dossier & personalized conversation hook (OutFox)';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const fullName = (
        document.querySelector('h1.inline.t-24, h1.text-heading-xlarge, h1')?.textContent || 'LinkedIn Member'
      ).trim();

      const headline = (
        document.querySelector('.text-body-medium.break-words, .pv-top-card--list-bullet')?.textContent || ''
      ).trim();

      let company = '';
      if (headline.includes(' at ')) {
        company = headline.split(' at ').pop().trim();
      } else if (headline.includes(' @ ')) {
        company = headline.split(' @ ').pop().trim();
      }

      // Open floating modal card
      const overlay = document.createElement('div');
      overlay.className = 'outfox-dossier-overlay';
      overlay.innerHTML = `
        <div class="outfox-dossier-card">
          <div class="outfox-dossier-head">
            <span class="outfox-dossier-title">AI Dossier · ${fullName}</span>
            <button type="button" class="outfox-dossier-close" id="btn-close-dossier">✕</button>
          </div>
          <div id="dossier-content" style="display: flex; flex-direction: column; gap: 14px; padding: 20px 0; text-align: center;">
            <div class="outfox-loading-spin" style="width:24px; height:24px; border:2.5px solid #fff7ed; border-top-color:#ff6b00; border-radius:50%; margin:0 auto; animation: spin 0.8s infinite linear;"></div>
            <span style="font-size: 13px; color: #6e7191;">Analyzing profile with Groq/Gemini AI...</span>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('#btn-close-dossier')?.addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) overlay.remove();
      });

      try {
        const resp = await call('ai.complete', {
          task: 'summary',
          input: {
            profile: { fullName, headline, company },
            pageText: document.body.innerText.slice(0, 3000),
          },
        });

        const outputText = typeof resp === 'string' ? resp : (resp?.output || resp?.summary || JSON.stringify(resp));

        const firstName = fullName.split(' ')[0] || 'there';
        const hook = `Hi ${firstName} — came across your work in ${company || headline || 'your space'} and loved what you are building. Would be great to connect!`;

        const contentEl = overlay.querySelector('#dossier-content');
        if (contentEl) {
          contentEl.style.textAlign = 'left';
          contentEl.innerHTML = `
            <div class="outfox-dossier-section">
              <span class="outfox-dossier-lbl">WHAT THEY DO & RESPONSIBILITIES</span>
              <p class="outfox-dossier-text">${outputText.replace(/\n+/g, ' ')}</p>
            </div>

            <div class="outfox-hook-box">
              <span class="outfox-dossier-lbl" style="color: #ff6b00;">BEST ICEBREAKER HOOK</span>
              <p class="outfox-hook-text" id="outfox-hook-copy-target">"${hook}"</p>
              <button type="button" class="outfox-btn-copy" id="btn-copy-hook">
                Copy Hook
              </button>
            </div>
          `;

          overlay.querySelector('#btn-copy-hook')?.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(hook);
              const copyBtn = overlay.querySelector('#btn-copy-hook');
              if (copyBtn) copyBtn.innerHTML = '✓ Copied!';
              setTimeout(() => {
                if (copyBtn) copyBtn.innerHTML = 'Copy Hook';
              }, 2000);
            } catch {}
          });
        }
      } catch (err) {
        const contentEl = overlay.querySelector('#dossier-content');
        if (contentEl) {
          contentEl.innerHTML = `
            <div style="padding: 10px; color: #FF4757; font-size: 13px;">
              AI Analysis Notice: ${err.message || 'Configure your Groq/Gemini API key in extension Settings.'}
            </div>
          `;
        }
      }
    });

    targetArea.appendChild(btn);
  }

  /* ================================================================ */
  /*  Feature C: Floating 1-Click Search Importer & Auto-Paginator     */
  /* ================================================================ */

  function extractCardData(card, linkEl) {
    if (!linkEl || !linkEl.href) return null;
    const publicId = publicIdFromUrl(linkEl.href);
    if (!publicId || publicId === 'me') return null;

    const rawUrn =
      card?.getAttribute('data-chameleon-result-urn') ||
      card?.getAttribute('data-urn') ||
      card?.getAttribute('data-entity-urn') ||
      card?.querySelector('[data-chameleon-result-urn]')?.getAttribute('data-chameleon-result-urn') ||
      card?.querySelector('[data-urn]')?.getAttribute('data-urn') ||
      card?.querySelector('[data-entity-urn]')?.getAttribute('data-entity-urn') ||
      '';

    const isFirstDegree =
      /1st/i.test(card?.textContent || '') ||
      window.location.search.includes('network=%5B%22F%22%5D') ||
      window.location.search.includes('network=%5B"F"%5D') ||
      Boolean(card?.querySelector('button[aria-label*="Message"]'));

    const badgeText =
      card?.querySelector(
        '.entity-result__badge-text, .dist-value, .artdeco-badge, .entity-result__badge, .artdeco-entity-lockup__degree'
      )?.textContent || '';

    let degree = isFirstDegree ? 1 : 2;
    if (!isFirstDegree) {
      if (/2nd/i.test(badgeText) || /2nd/i.test(card?.textContent || '')) degree = 2;
      else if (/3rd/i.test(badgeText) || /3rd/i.test(card?.textContent || '')) degree = 3;
    }

    const nameEl = card?.querySelector('.entity-result__title-text, .actor-name') || linkEl;
    const headlineEl = card?.querySelector('.entity-result__primary-subtitle, .subline-level-1');
    const locationEl = card?.querySelector('.entity-result__secondary-subtitle, .subline-level-2');

    const fullName = nameEl?.textContent?.replace(/\s+/g, ' ').trim() || publicId;
    const headline = headlineEl?.textContent?.replace(/\s+/g, ' ').trim() || 'LinkedIn Prospect';
    const profileLocation = locationEl?.textContent?.replace(/\s+/g, ' ').trim() || '';

    let company = '';
    if (headline.includes(' at ')) {
      company = headline.split(' at ').pop().trim();
    } else if (headline.includes(' @ ')) {
      company = headline.split(' @ ').pop().trim();
    }

    const lead = {
      publicId,
      urn: rawUrn.includes('urn:li:') ? rawUrn : '',
      connectionDegree: isFirstDegree ? 1 : degree,
      isConnected: isFirstDegree,
      fullName,
      headline,
      location: profileLocation,
      company,
      importedFrom: 'linkedin_search',
      enrolledAt: Date.now(),
    };
    if (company) lead.company = company;
    return lead;
  }

  async function crawlSearchPages(targetCount, updateProgress, isCancelled) {
    const seen = new Set();
    const collected = [];
    let pageCount = 1;

    while (collected.length < targetCount) {
      if (isCancelled && isCancelled()) break;

      // Smooth scroll slightly to trigger LinkedIn's lazy rendering of cards on page
      window.scrollBy({ top: 500, behavior: 'smooth' });
      await new Promise((r) => setTimeout(r, 400));

      let cards = Array.from(
        document.querySelectorAll(
          '.reusable-search__result-container, .entity-result, li.reusable-search__result-container'
        )
      );
      if (cards.length === 0) {
        const links = Array.from(document.querySelectorAll('a[href*="/in/"]'));
        cards = links.map((l) => l.closest('li') || l.parentElement).filter(Boolean);
      }

      let foundOnThisPage = 0;
      for (const card of cards) {
        const link = card.querySelector?.('a[href*="/in/"]') || (card.matches?.('a[href*="/in/"]') ? card : null);
        if (!link) continue;
        const data = extractCardData(card, link);
        if (data && !seen.has(data.publicId)) {
          seen.add(data.publicId);
          collected.push(data);
          foundOnThisPage++;
          if (collected.length >= targetCount) break;
        }
      }

      if (updateProgress) {
        updateProgress(
          collected.length,
          targetCount,
          pageCount,
          `Scraped Page ${pageCount}... (${collected.length} / ${targetCount} leads)`
        );
      }

      if (collected.length >= targetCount) break;
      if (isCancelled && isCancelled()) break;

      const nextBtn = document.querySelector(
        'button[aria-label="Next"], .artdeco-pagination__button--next, a[aria-label="Next"]'
      );

      if (
        !nextBtn ||
        nextBtn.disabled ||
        nextBtn.getAttribute('aria-disabled') === 'true' ||
        nextBtn.classList.contains('artdeco-button--disabled')
      ) {
        logDebug('info', 'Importer', `Reached end of search results at page ${pageCount}.`);
        break;
      }

      if (updateProgress) {
        updateProgress(
          collected.length,
          targetCount,
          pageCount,
          `Paging to Page ${pageCount + 1}... (${collected.length} / ${targetCount} leads)`
        );
      }

      nextBtn.click();
      pageCount += 1;

      // Human pacing delay: 2.6s to 3.4s
      const delay = 2600 + Math.random() * 800;
      await new Promise((r) => setTimeout(r, delay));
    }

    return { collected, pageCount };
  }

  function injectSearchImporterBadge() {
    const isSearchPage =
      location.pathname.includes('/search/') ||
      location.search.includes('keywords');
    if (!isSearchPage) {
      document.getElementById('outfox-floating-import')?.remove();
      return;
    }

    if (document.getElementById('outfox-floating-import')) return;

    const badge = document.createElement('div');
    badge.id = 'outfox-floating-import';
    badge.className = 'outfox-float-badge';
    badge.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Import to OutFox';
    badge.title = '1-click import all search result prospects into OutFox';

    badge.addEventListener('click', async () => {
      // Fetch lists from background
      let lists = [];
      try {
        const lRes = await call('list.getAll', {});
        lists = Array.isArray(lRes) ? lRes : (lRes?.lists || []);
      } catch {}

      // Extract search keywords for smart default list naming
      const searchKeywords = new URLSearchParams(window.location.search).get('keywords') || '';
      const cleanKeywords = searchKeywords.replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const defaultNewName = cleanKeywords ? `${cleanKeywords} (Search)` : `Search Import - ${new Date().toLocaleDateString()}`;

      // Open Modal Overlay
      const overlay = document.createElement('div');
      overlay.className = 'outfox-import-overlay';
      overlay.innerHTML = `
        <div class="outfox-import-dialog">
          <div class="outfox-dossier-head">
            <span class="outfox-dossier-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:text-bottom;margin-right:6px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              1-Click Search Import
            </span>
            <button type="button" class="outfox-dossier-close" id="btn-close-import">✕</button>
          </div>

          <!-- Configuration View -->
          <div id="outfox-import-config-view" style="display: flex; flex-direction: column; gap: 14px;">
            <div>
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
                <label style="font-size: 12.5px; font-weight: 600; color: #14142b;">Target leads to import:</label>
                <span style="font-size: 11.5px; color: #6e7191;">Auto-paginates search</span>
              </div>
              <input type="number" id="input-import-target" class="outfox-input" value="50" min="10" max="1000" step="5" />
              <div style="display: flex; gap: 6px; margin-top: 8px;">
                <button type="button" class="outfox-preset-btn" data-val="25">25</button>
                <button type="button" class="outfox-preset-btn active" data-val="50">50</button>
                <button type="button" class="outfox-preset-btn" data-val="100">100</button>
                <button type="button" class="outfox-preset-btn" data-val="250">250</button>
              </div>
            </div>

            <div>
              <label style="font-size: 12.5px; font-weight: 600; color: #14142b; display: block; margin-bottom: 6px;">Destination List:</label>
              <select id="select-import-list" class="outfox-select" style="margin-top: 0; width: 100%;">
                <option value="__new__">✨ + Create New List</option>
                ${lists.map((l) => `<option value="${l.listId || l.id}">${l.name} (${l.count || 0} leads)</option>`).join('')}
              </select>
            </div>

            <div id="container-list-name-input" style="margin-top: 4px;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
                <label id="label-list-custom-name" style="font-size: 12px; font-weight: 600; color: #475569;">New List Name:</label>
                <span id="hint-list-action" style="font-size: 11px; color: #ff6b00; font-weight: 600;">Custom Name</span>
              </div>
              <input type="text" id="input-import-list-name" class="outfox-input" placeholder="e.g. Austin Software Engineers" value="${defaultNewName}" style="width: 100%; box-sizing: border-box;" />
            </div>

            <div style="background: #f8fafc; border-radius: 10px; padding: 10px 14px; font-size: 12px; color: #6e7191; line-height: 1.4;">
              Extracts profile URN & connection degree directly from search cards to preserve profile view quotas.
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
              <button type="button" class="outfox-pill-btn" style="background: #f1f2f6 !important; color: #6e7191 !important;" id="btn-cancel-import">Cancel</button>
              <button type="button" class="outfox-pill-btn" id="btn-confirm-import">Start Import →</button>
            </div>
          </div>

          <!-- Progress View -->
          <div id="outfox-import-progress-view" style="display: none; flex-direction: column; gap: 12px; padding: 6px 0;">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <span id="outfox-progress-status" style="font-size: 13.5px; font-weight: 600; color: #14142b;">Scraping Page 1...</span>
              <span id="outfox-progress-counter" style="font-size: 13px; font-weight: 700; color: #ff6b00;">0 / 50</span>
            </div>

            <div style="background: #fff7ed; border-radius: 9999px; height: 10px; overflow: hidden; width: 100%;">
              <div id="outfox-progress-fill" style="background: #ff6b00; height: 100%; width: 0%; border-radius: 9999px; transition: width 0.3s ease;"></div>
            </div>

            <span id="outfox-progress-hint" style="font-size: 11.5px; color: #6e7191;">Simulating natural human pacing (2.5s - 3.5s delay between pages)...</span>

            <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
              <button type="button" class="outfox-pill-btn" style="background: #f1f2f6 !important; color: #14142b !important;" id="btn-stop-import">Stop & Save Leads</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      let isCrawling = false;
      let cancelled = false;

      const targetInput = overlay.querySelector('#input-import-target');
      const presetBtns = overlay.querySelectorAll('.outfox-preset-btn');

      presetBtns.forEach((pBtn) => {
        pBtn.addEventListener('click', () => {
          presetBtns.forEach((b) => b.classList.remove('active'));
          pBtn.classList.add('active');
          if (targetInput) targetInput.value = pBtn.dataset.val;
        });
      });

      targetInput?.addEventListener('input', () => {
        const val = targetInput.value;
        presetBtns.forEach((b) => {
          b.classList.toggle('active', b.dataset.val === val);
        });
      });

      const selectEl = overlay.querySelector('#select-import-list');
      const nameInput = overlay.querySelector('#input-import-list-name');
      const nameLabel = overlay.querySelector('#label-list-custom-name');
      const nameHint = overlay.querySelector('#hint-list-action');

      selectEl?.addEventListener('change', () => {
        if (selectEl.value === '__new__') {
          if (nameLabel) nameLabel.textContent = 'New List Name:';
          if (nameHint) nameHint.textContent = '✨ Creates New';
          if (nameInput) nameInput.value = defaultNewName;
        } else {
          const selectedList = lists.find((l) => (l.listId || l.id) === selectEl.value);
          if (nameLabel) nameLabel.textContent = 'Rename List (Optional):';
          if (nameHint) nameHint.textContent = '✏️ Rename';
          if (nameInput && selectedList) nameInput.value = selectedList.name;
        }
      });

      function closeOverlay() {
        if (isCrawling) {
          cancelled = true;
          return;
        }
        overlay.remove();
      }

      overlay.querySelector('#btn-close-import')?.addEventListener('click', closeOverlay);
      overlay.querySelector('#btn-cancel-import')?.addEventListener('click', closeOverlay);
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay && !isCrawling) overlay.remove();
      });

      overlay.querySelector('#btn-stop-import')?.addEventListener('click', () => {
        cancelled = true;
        const stopBtn = overlay.querySelector('#btn-stop-import');
        if (stopBtn) {
          stopBtn.disabled = true;
          stopBtn.textContent = 'Saving collected leads...';
        }
      });

      overlay.querySelector('#btn-confirm-import')?.addEventListener('click', async () => {
        const rawTarget = parseInt(targetInput?.value || '50', 10);
        const targetCount = Math.max(10, Math.min(1000, isNaN(rawTarget) ? 50 : rawTarget));

        const select = overlay.querySelector('#select-import-list');
        let targetListId = select?.value;
        const customName = nameInput?.value?.trim();
        let finalListName = customName || defaultNewName;

        // Switch to progress view
        const configView = overlay.querySelector('#outfox-import-config-view');
        const progressView = overlay.querySelector('#outfox-import-progress-view');
        const statusEl = overlay.querySelector('#outfox-progress-status');
        const counterEl = overlay.querySelector('#outfox-progress-counter');
        const fillEl = overlay.querySelector('#outfox-progress-fill');
        const closeBtn = overlay.querySelector('#btn-close-import');

        if (configView) configView.style.display = 'none';
        if (progressView) progressView.style.display = 'flex';
        if (closeBtn) closeBtn.style.display = 'none';

        isCrawling = true;
        cancelled = false;

        const updateProgress = (collectedCount, totalTarget, page, statusText) => {
          const pct = Math.min(100, Math.round((collectedCount / totalTarget) * 100));
          if (counterEl) counterEl.textContent = `${collectedCount} / ${totalTarget}`;
          if (fillEl) fillEl.style.width = `${pct}%`;
          if (statusEl) statusEl.textContent = statusText || `Scraping Page ${page}...`;
        };

        logDebug('info', 'Importer', `Starting auto-pagination crawler: target ${targetCount} leads.`);

        try {
          const { collected, pageCount } = await crawlSearchPages(targetCount, updateProgress, () => cancelled);

          if (collected.length === 0) {
            overlay.remove();
            showToast('No prospects found on this search page yet.', 'info');
            return;
          }

          if (statusEl) statusEl.textContent = `Enrolling ${collected.length} leads into list...`;
          if (counterEl) counterEl.textContent = `${collected.length} / ${targetCount}`;

          if (targetListId === '__new__') {
            const created = await call('list.create', { name: finalListName });
            targetListId = created?.listId || created?.id;
          } else if (targetListId) {
            const originalList = lists.find((l) => (l.listId || l.id) === targetListId);
            if (customName && originalList && customName !== originalList.name) {
              await call('list.update', { listId: targetListId, name: customName });
              finalListName = customName;
            } else {
              finalListName = originalList?.name || 'Selected List';
            }
          }

          if (targetListId) {
            await call('list.add', { listId: targetListId, profiles: collected });
          }

          logDebug('good', 'Importer', `Successfully enrolled ${collected.length} leads across ${pageCount} pages!`);
          overlay.remove();
          showToast(`✓ Successfully imported ${collected.length} leads into "${finalListName}"!`, 'success', 5000);
        } catch (err) {
          logDebug('bad', 'Importer', `Auto-pagination import failed: ${err.message}`);
          overlay.remove();
          showToast(`Import error: ${err.message}`, 'error');
        } finally {
          isCrawling = false;
        }
      });
    });

    document.body.appendChild(badge);
  }

  /* ================================================================ */
  /*  Observer — re-inject on SPA navigation                         */
  /* ================================================================ */

  let lastUrl = location.href;

  function onPageChange() {
    const isSearchPage =
      location.pathname.includes('/search/') ||
      location.search.includes('keywords');
    const isProfilePage = /^\/in\/[^/]+\/?$/.test(location.pathname);

    if (isSearchPage) {
      setTimeout(() => {
        injectSearchCheckboxes();
        injectSearchImporterBadge();
      }, 1500);
    }

    if (isProfilePage) {
      setTimeout(() => {
        injectProfileExportButton();
        injectProfileDossierButton();
      }, 1500);
    }
  }

  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onPageChange();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Re-inject periodically for dynamically loaded content
  setInterval(() => {
    if (location.pathname.includes('/search/')) {
      injectSearchCheckboxes();
      injectSearchImporterBadge();
    }
    if (/^\/in\/[^/]+\/?$/.test(location.pathname)) {
      injectProfileDossierButton();
    }
  }, 2500);

  // Initial injection
  onPageChange();

  /* ================================================================ */
  /*  Listen for progress messages from background                    */
  /* ================================================================ */

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return undefined;

    if (msg.type === 'UNFOLLOW_PROGRESS') {
      showToast(`Unfollowed: ${msg.unfollowed} | Remaining: ${msg.remaining}`, 'info', 2000);
      return undefined;
    }

    // Page requests from the background: capture.js does the work. Some of
    // them (a full capture reads the photo bytes) are async.
    const page = globalThis.LITK && globalThis.LITK.handleMessage(msg);
    if (page === null || page === undefined) return undefined;

    Promise.resolve(page)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  });
})();
