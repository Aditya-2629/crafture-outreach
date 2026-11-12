/**
 * OutFox — Waalaxy 3-Step CSV Import Wizard Modal
 * Step 1: Upload (Drag & Drop + Destination List)
 * Step 2: Match Data (Dynamic mapping table + Auto-detect + Live previews)
 * Step 3: Finalize Import (Duplicate handling toggles + Save to storage)
 */

import { openUiAlert } from './modal-engine.js';
import { ICONS } from '../ui/icons.js';

export function openCsvImportWizard(userLists = [], onImportSuccess) {
  let currentStep = 1; // 1: Upload, 2: Match data, 3: Finalize
  let selectedListId = userLists[0]?.listId || userLists[0]?.id || 'list_default';
  let parsedCsvHeaders = [];
  let parsedCsvRows = [];
  let detectedCount = 0;

  // Mapping state: property -> csvHeaderIndex
  let columnMapping = {
    linkedinUrl: -1,
    firstName: -1,
    lastName: -1,
    jobTitle: -1,
    email: -1,
    company: -1,
  };

  // Finalize toggles
  let moveDuplicates = true;
  let overwriteExisting = false;

  // Modal Backdrop & Shell
  const modalWrapper = document.createElement('div');
  modalWrapper.className = 'csv-wizard-backdrop';
  modalWrapper.style.cssText = `
    position: fixed; inset: 0; background: rgba(20, 20, 43, 0.45);
    backdrop-filter: blur(6px); z-index: 10000; display: flex;
    align-items: center; justify-content: center; opacity: 0;
    transition: opacity 0.25s ease;
  `;

  document.body.appendChild(modalWrapper);
  setTimeout(() => (modalWrapper.style.opacity = '1'), 10);

  function closeModal() {
    modalWrapper.style.opacity = '0';
    setTimeout(() => modalWrapper.remove(), 250);
  }

  // Parse uploaded file
  function handleFile(file) {
    if (!file || !file.name.endsWith('.csv')) {
      openUiAlert({ title: 'Invalid File', message: 'Please select a valid .csv file.' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        openUiAlert({ title: 'Empty CSV', message: 'The selected CSV file is empty.' });
        return;
      }

      parsedCsvHeaders = lines[0].split(',').map((h) => h.replace(/^["']|["']$/g, '').trim());
      parsedCsvRows = lines.slice(1).map((line) => {
        // Safe CSV split handling commas inside quotes
        const match = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(',');
        return match.map((c) => c.replace(/^["']|["']$/g, '').trim());
      });

      detectedCount = parsedCsvRows.length;

      // Auto-detect mappings based on header names
      parsedCsvHeaders.forEach((h, idx) => {
        const norm = h.toLowerCase();
        if (norm.includes('url') || norm.includes('linkedin') || norm.includes('profile') || norm.includes('link')) {
          if (columnMapping.linkedinUrl === -1) columnMapping.linkedinUrl = idx;
        } else if (norm.includes('first') || norm === 'fname') {
          if (columnMapping.firstName === -1) columnMapping.firstName = idx;
        } else if (norm.includes('last') || norm === 'lname') {
          if (columnMapping.lastName === -1) columnMapping.lastName = idx;
        } else if (norm.includes('title') || norm.includes('job') || norm.includes('role') || norm.includes('position') || norm.includes('headline')) {
          if (columnMapping.jobTitle === -1) columnMapping.jobTitle = idx;
        } else if (norm.includes('email') || norm.includes('mail')) {
          if (columnMapping.email === -1) columnMapping.email = idx;
        } else if (norm.includes('company') || norm.includes('org')) {
          if (columnMapping.company === -1) columnMapping.company = idx;
        }
      });

      currentStep = 2;
      render();
    };
    reader.readAsText(file);
  }

  function render() {
    modalWrapper.innerHTML = `
      <div class="csv-wizard-card" style="width: 860px; max-width: 95vw; background: #FFFFFF; border-radius: 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); overflow: hidden; display: flex; flex-direction: column;">
        
        <!-- Top Breadcrumbs Bar (Screenshots 2, 3, 4) -->
        <div style="padding: 24px 32px 16px; border-bottom: 1px solid rgba(20,20,43,0.06); position: relative;">
          <button type="button" id="btn-close-wizard" style="position: absolute; right: 24px; top: 24px; border: none; background: transparent; font-size: 20px; color: #a0a3bd; cursor: pointer;" title="Close wizard">✕</button>

          <div style="display: flex; justify-content: center; align-items: center; gap: 32px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; ${currentStep >= 1 ? 'background:#ff6b00; color:#FFF;' : 'background:#fff7ed; color:#ff6b00;'}">
                ${currentStep > 1 ? '✓' : '1'}
              </span>
              <span style="font-size: 13px; font-weight: 600; color: ${currentStep === 1 ? '#ff6b00' : '#14142b'};">Upload</span>
            </div>

            <div style="width: 40px; height: 1px; background: rgba(20,20,43,0.1);"></div>

            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; ${currentStep >= 2 ? 'background:#ff6b00; color:#FFF;' : 'background:#fff7ed; color:#6e7191;'}">
                ${currentStep > 2 ? '✓' : '2'}
              </span>
              <span style="font-size: 13px; font-weight: 600; color: ${currentStep === 2 ? '#ff6b00' : '#6e7191'};">Match data</span>
            </div>

            <div style="width: 40px; height: 1px; background: rgba(20,20,43,0.1);"></div>

            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; ${currentStep >= 3 ? 'background:#ff6b00; color:#FFF;' : 'background:#fff7ed; color:#6e7191;'}">
                3
              </span>
              <span style="font-size: 13px; font-weight: 600; color: ${currentStep === 3 ? '#ff6b00' : '#6e7191'};">Finalize import</span>
            </div>
          </div>
        </div>

        <!-- Wizard Step Body -->
        <div style="padding: 32px 40px; min-height: 380px;">
          ${
            currentStep === 1 ? `
              <!-- STEP 1: Upload File (Screenshot image_91a282) -->
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
                <div>
                  <h3 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 700; color: #14142b;">Import a CSV file</h3>
                  <p style="margin: 0; font-size: 13px; color: #6e7191;">Make sure all prospects have LinkedIn URLs in the file.</p>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 12px; color: #6e7191; font-weight: 600;">Import list</span>
                  <select id="wizard-list-select" style="padding: 8px 14px; border: 1px solid rgba(20,20,43,0.12); border-radius: 10px; font-size: 13px; font-weight: 600; color: #14142b; background: #FFFFFF; outline: none; cursor: pointer;">
                    ${userLists.length > 0 
                      ? userLists.map((l) => `<option value="${l.listId || l.id}" ${(l.listId || l.id) === selectedListId ? 'selected' : ''}>${l.name}</option>`).join('')
                      : `<option value="list_default">My Prospects</option>`}
                  </select>
                </div>
              </div>

              <!-- Drag & Drop Zone -->
              <div id="drop-zone" style="border: 2px dashed #b9c4f8; border-radius: 16px; padding: 60px 20px; text-align: center; background: #fdfdff; cursor: pointer; transition: all 0.2s ease;">
                <input type="file" id="csv-file-input" accept=".csv" style="display: none;" />
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ff6b00" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p style="margin: 0; font-size: 14px; font-weight: 600; color: #14142b;">
                  Drag & Drop or <span style="color: #ff6b00; text-decoration: underline;">Choose file</span> to upload
                </p>
                <span style="font-size: 12px; color: #a0a3bd; margin-top: 6px; display: block;">.CSV</span>
              </div>
            ` : currentStep === 2 ? `
              <!-- STEP 2: Match Data (Screenshot image_91a26a) -->
              <div style="margin-bottom: 24px;">
                <h3 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 700; color: #14142b;">
                  Match your data - <span style="color: #ff6b00;">${detectedCount} prospects detected</span>
                </h3>
                <p style="margin: 0; font-size: 13px; color: #6e7191;">
                  LinkedIn URLs are automatically detected and imported — configure your properties below.
                </p>
              </div>

              <!-- Mapping Table -->
              <div style="border: 1px solid rgba(20,20,43,0.08); border-radius: 12px; overflow: hidden; background: #FFFFFF; max-height: 320px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                  <thead>
                    <tr style="background: #f8fafc; border-bottom: 1px solid rgba(20,20,43,0.08); color: #6e7191; font-size: 11px; text-transform: uppercase;">
                      <th style="padding: 12px 20px;">Properties from CSV</th>
                      <th style="padding: 12px 20px;">Waalaxy Property</th>
                      <th style="padding: 12px 20px;">Preview Information</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${[
                      { key: 'linkedinUrl', label: 'LinkedIn Profile URL' },
                      { key: 'firstName', label: 'First name' },
                      { key: 'lastName', label: 'Last name' },
                      { key: 'jobTitle', label: 'Job Title' },
                      { key: 'email', label: 'Email' },
                      { key: 'company', label: 'Company name' },
                    ].map((row) => {
                      const selectedIdx = columnMapping[row.key];
                      const preview1 = selectedIdx >= 0 ? (parsedCsvRows[0]?.[selectedIdx] || '--') : '--';
                      const preview2 = selectedIdx >= 0 ? (parsedCsvRows[1]?.[selectedIdx] || '--') : '--';
                      return `
                        <tr style="border-bottom: 1px solid rgba(20,20,43,0.05);">
                          <td style="padding: 12px 20px;">
                            <select class="map-dropdown" data-key="${row.key}" style="padding: 8px 12px; border: 1px solid rgba(20,20,43,0.12); border-radius: 8px; font-size: 13px; color: #14142b; width: 220px; background: #FFFFFF; outline: none; cursor: pointer;">
                              <option value="-1">Choose a property ⌵</option>
                              ${parsedCsvHeaders.map((h, i) => `<option value="${i}" ${i === selectedIdx ? 'selected' : ''}>${h}</option>`).join('')}
                            </select>
                          </td>
                          <td style="padding: 12px 20px; font-weight: 600; color: #14142b;">${row.label}</td>
                          <td style="padding: 12px 20px; color: #6e7191; font-size: 12px;">
                            <div>${preview1}</div>
                            <div style="opacity: 0.7;">${preview2}</div>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            ` : `
              <!-- STEP 3: Finalize Import (Screenshot image_91a268) -->
              <div style="margin-bottom: 32px;">
                <h3 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 700; color: #14142b;">
                  Finalize your import of <span style="color: #ff6b00;">${detectedCount} prospects detected</span>
                </h3>
                <p style="margin: 0; font-size: 13px; color: #6e7191;">
                  Matching complete! Configure the import options and then start the import.
                </p>
              </div>

              <!-- Options Toggles -->
              <div style="display: flex; flex-direction: column; gap: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border: 1px solid rgba(20,20,43,0.08); border-radius: 14px; background: #FFFFFF;">
                  <div>
                    <strong style="color: #14142b; font-size: 14px; display: block; margin-bottom: 4px;">Move duplicates to import list</strong>
                    <span style="font-size: 12px; color: #6e7191;">Automatically move leads that are already in one of your lists to the list you are importing into.</span>
                  </div>
                  <input type="checkbox" id="toggle-duplicates" ${moveDuplicates ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;" />
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border: 1px solid rgba(20,20,43,0.08); border-radius: 14px; background: #FFFFFF;">
                  <div>
                    <strong style="color: #14142b; font-size: 14px; display: block; margin-bottom: 4px;">Overwrite and replace existing prospect information</strong>
                    <span style="font-size: 12px; color: #6e7191;">Replaces the information already saved with data from your CSV file.</span>
                  </div>
                  <input type="checkbox" id="toggle-overwrite" ${overwriteExisting ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;" />
                </div>
              </div>
            `
          }
        </div>

        <!-- Wizard Footer Bar with Navigation Buttons -->
        <div style="padding: 20px 32px; border-top: 1px solid rgba(20,20,43,0.06); background: #FAFBFD; display: flex; justify-content: space-between; align-items: center;">
          ${
            currentStep > 1
              ? `<button type="button" id="btn-wizard-back" style="padding: 10px 20px; background: transparent; border: none; font-size: 13px; font-weight: 600; color: #6e7191; cursor: pointer;">&lt; Back</button>`
              : `<div></div>`
          }

          ${
            currentStep === 1
              ? `<div></div>`
              : currentStep === 2
              ? `<button type="button" id="btn-wizard-next" style="padding: 10px 28px; background: #ff6b00; color: #FFF; border: none; border-radius: 9999px; font-weight: 700; font-size: 13px; cursor: pointer;">Next →</button>`
              : `<button type="button" id="btn-wizard-import" style="padding: 10px 32px; background: #ff6b00; color: #FFF; border: none; border-radius: 9999px; font-weight: 700; font-size: 14px; cursor: pointer;">Import</button>`
          }
        </div>

      </div>
    `;

    // Wire Events
    modalWrapper.querySelector('#btn-close-wizard')?.addEventListener('click', closeModal);

    // Step 1: Drop & Click
    const dropZone = modalWrapper.querySelector('#drop-zone');
    const fileInput = modalWrapper.querySelector('#csv-file-input');
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => handleFile(e.target.files?.[0]));
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.background = '#fff7ed'; });
      dropZone.addEventListener('dragleave', () => { dropZone.style.background = '#fdfdff'; });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.background = '#fdfdff';
        handleFile(e.dataTransfer.files?.[0]);
      });
    }

    const listSelect = modalWrapper.querySelector('#wizard-list-select');
    if (listSelect) {
      listSelect.addEventListener('change', (e) => { selectedListId = e.target.value; });
    }

    // Step 2: Mapping dropdown change
    modalWrapper.querySelectorAll('.map-dropdown').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const key = sel.dataset.key;
        columnMapping[key] = parseInt(sel.value, 10);
        render(); // update preview live
      });
    });

    modalWrapper.querySelector('#btn-wizard-back')?.addEventListener('click', () => {
      currentStep--;
      render();
    });

    modalWrapper.querySelector('#btn-wizard-next')?.addEventListener('click', () => {
      currentStep = 3;
      render();
    });

    // Step 3: Toggles & Final Import Execution
    modalWrapper.querySelector('#toggle-duplicates')?.addEventListener('change', (e) => {
      moveDuplicates = e.target.checked;
    });

    modalWrapper.querySelector('#toggle-overwrite')?.addEventListener('change', (e) => {
      overwriteExisting = e.target.checked;
    });

    modalWrapper.querySelector('#btn-wizard-import')?.addEventListener('click', async () => {
      const btn = modalWrapper.querySelector('#btn-wizard-import');
      btn.textContent = 'Importing...';
      btn.disabled = true;

      const finalLeads = [];
      parsedCsvRows.forEach((row, i) => {
        const getVal = (idx) => (idx >= 0 && row[idx] ? row[idx] : '');
        const fn = getVal(columnMapping.firstName);
        const ln = getVal(columnMapping.lastName);
        const name = (fn || ln) ? `${fn} ${ln}`.trim() : (getVal(0) || `Lead ${i + 1}`);
        const headline = getVal(columnMapping.jobTitle) || 'LinkedIn Member';
        const company = getVal(columnMapping.company) || '-';
        const email = getVal(columnMapping.email) || '';
        let url = getVal(columnMapping.linkedinUrl) || '';

        let publicId = url ? url.replace(/.*\/in\//, '').replace(/\/.*/, '').replace(/[^a-zA-Z0-9_-]/g, '') : '';
        if (!publicId) {
          if (email && email.trim()) {
            publicId = 'email:' + email.toLowerCase().trim();
          } else {
            publicId = `lead_${Date.now()}_${i}`;
          }
        }

        finalLeads.push({
          publicId,
          name,
          fullName: name,
          firstName: fn || (name ? name.split(' ')[0] : ''),
          lastName: ln || (name ? name.split(' ').slice(1).join(' ') : ''),
          headline,
          company,
          email,
          url: url || (email ? `mailto:${email}` : `https://www.linkedin.com/in/${publicId}/`),
          addedAt: Date.now()
        });
      });

      // Save into storage
      const allData = await new Promise((r) => chrome.storage.local.get(null, r));
      const storageKey = `listMembers:${selectedListId}`;
      let existing = allData[storageKey] || [];

      if (overwriteExisting) {
        const incomingMap = new Map(finalLeads.map((l) => [l.publicId, l]));
        existing = existing.map((ex) => {
          if (incomingMap.has(ex.publicId)) {
            const incoming = incomingMap.get(ex.publicId);
            incomingMap.delete(ex.publicId);
            return { ...ex, ...incoming };
          }
          return ex;
        });
        existing.push(...incomingMap.values());
      } else {
        const existingIds = new Set(existing.map((e) => e.publicId));
        const newOnes = finalLeads.filter((l) => !existingIds.has(l.publicId));
        existing = [...existing, ...newOnes];
      }

      const storagePayload = { [storageKey]: existing };

      // Persist individual profiles into profile store
      finalLeads.forEach((lead) => {
        const profileKey = `profile:${lead.publicId}`;
        const existingProfile = allData[profileKey] || {};
        storagePayload[profileKey] = {
          ...existingProfile,
          publicId: lead.publicId,
          name: lead.name,
          fullName: lead.fullName || lead.name,
          firstName: lead.firstName || (lead.name ? lead.name.split(' ')[0] : ''),
          lastName: lead.lastName || (lead.name ? lead.name.split(' ').slice(1).join(' ') : ''),
          headline: lead.headline,
          company: lead.company,
          email: lead.email || existingProfile.email || '',
          url: lead.url,
          updatedAt: Date.now(),
        };
      });

      // Handle duplicate moving from other lists if requested
      if (moveDuplicates) {
        const incomingPids = new Set(finalLeads.map((l) => l.publicId));
        (allData.lists || []).forEach((l) => {
          const lid = l.listId || l.id;
          if (lid !== selectedListId) {
            const otherKey = `listMembers:${lid}`;
            const otherMembers = allData[otherKey] || [];
            const filtered = otherMembers.filter((m) => !incomingPids.has(m.publicId || m.profile?.publicId));
            if (filtered.length !== otherMembers.length) {
              storagePayload[otherKey] = filtered;
            }
          }
        });
      }

      await chrome.storage.local.set(storagePayload);

      openUiAlert({ title: 'Import Complete', message: `Successfully imported ${finalLeads.length} prospects!` });
      closeModal();
      if (onImportSuccess) onImportSuccess();
    });
  }

  render();
}

