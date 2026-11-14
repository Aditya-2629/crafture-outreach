/**
 * OutFox — Waalaxy Dynamic Prospects CRM (Phase A, B & C)
 * 100% Real Storage Data · Zero Mock Data · 5 Real Filters · Column Toggle
 * Floating Bulk Actions Bar · Right Slide-in "Import Prospects" Drawer
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { openCsvImportWizard } from './csv-import-modal.js';
import { openUiPrompt, openUiConfirm, openUiSelectModal, openUiAlert, openLeadTimelineModal } from './modal-engine.js';
import { ICONS } from '../ui/icons.js';
export { openUiPrompt, openUiConfirm, openUiSelectModal, openUiAlert, openLeadTimelineModal };

export async function renderProspectsView(container, ctx = {}) {
  if (!container) return;

  // Show clean loading spinner while reading local storage
  container.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; height:320px; color:#6e7191;">
      <div style="width:32px; height:32px; border:3px solid #fff7ed; border-top-color:#ff6b00; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
    </div>
    <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
  `;

  // 1. Fetch 100% Real Storage Data
  const allData = await new Promise((resolve) => {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.get(null, (res) => resolve(res || {}));
    } else {
      resolve({});
    }
  });

  const rawLists = allData.lists || [];
  const rawProfiles = allData.profiles || {};
  const rawCampaigns = allData.campaigns || [];
  const rawActions = allData.actions || [];
  const blacklist = new Set(allData.blacklist || []);
  let companyBlacklist = Array.isArray(allData.company_blacklist) ? allData.company_blacklist : [];
  const storedColumns = allData.crm_column_preferences || {
    job: true,
    company: true,
    campaign: true,
    email: true,
    status: true,
    tags: true,
    importDate: false
  };

  // Map campaign names and enrollment statuses
  const campaignNames = {};
  const enrollmentStatus = {};
  rawCampaigns.forEach((c) => {
    const cid = c.campaignId || c.id;
    if (cid) {
      campaignNames[cid] = c.name;
      const enrollments = allData[`enrollments:${cid}`] || [];
      enrollments.forEach((e) => {
        if (e.publicId) {
          enrollmentStatus[e.publicId] = e.status || e.state;
        }
      });
    }
  });

  // Map visit and invite actions by publicId
  const actionHistory = {};
  rawActions.forEach((act) => {
    if (!act.publicId) return;
    if (!actionHistory[act.publicId]) actionHistory[act.publicId] = {};
    if (act.action === 'outreach.view' && act.result?.status === 'sent') {
      actionHistory[act.publicId].visited = true;
    }
    if (act.action === 'outreach.invite' && act.result?.status === 'sent') {
      actionHistory[act.publicId].invited = true;
    }
    if (act.action === 'outreach.message' && act.result?.status === 'sent') {
      actionHistory[act.publicId].messaged = true;
    }
  });

  // 2. Build Unified Real Prospects Repository
  let masterProspects = [];
  const seenIds = new Set();

  // A. Ingest all members from all saved lists
  rawLists.forEach((list) => {
    const lid = list.listId || list.id;
    const members = allData[`listMembers:${lid}`] || allData[`list_members_${lid}`] || [];
    members.forEach((m) => {
      const pid = m.publicId || m.profile?.publicId;
      if (!pid || seenIds.has(pid)) return;
      seenIds.add(pid);

      const hist = actionHistory[pid] || {};
      const enrollState = enrollmentStatus[pid];
      let status = 'Enrolled';
      if (blacklist.has(pid)) status = 'Blacklisted';
      else if (enrollState === 'blocked_not_connected') status = 'Needs Connection';
      else if (m.connected || m.connectionDegree === 1) status = 'Connected';
      else if (hist.invited) status = 'Invite Sent';
      else if (hist.visited) status = 'Visited';

      const prof = m.profile || {};
      masterProspects.push({
        publicId: pid,
        fullName: m.name || m.fullName || prof.fullName || prof.name || pid,
        headline: m.headline || m.title || prof.headline || prof.title || '-',
        company: m.company || prof.company || '-',
        listId: lid,
        listName: list.name,
        campaign: campaignNames[m.campaignId] || (hist.invited ? 'Active Campaign' : '-'),
        status: status,
        visited: Boolean(hist.visited),
        email: m.email || prof.email || '',
        tags: Array.isArray(m.tags) ? m.tags : (Array.isArray(prof.tags) ? prof.tags : []),
        profileUrl: m.url || prof.url || `https://www.linkedin.com/in/${encodeURIComponent(pid)}/`,
        addedAt: m.addedAt || prof.updatedAt || Date.now()
      });
    });
  });

  // B. Scan any un-nested listMembers keys in storage
  Object.keys(allData).forEach((key) => {
    if (key.startsWith('listMembers:') || key.startsWith('list_members_')) {
      const lid = key.replace('listMembers:', '').replace('list_members_', '');
      const listMembers = allData[key] || [];
      const list = rawLists.find((l) => (l.listId || l.id) === lid);
      const listName = list?.name || 'Imported List';

      listMembers.forEach((m) => {
        const pid = m.publicId || m.profile?.publicId;
        if (!pid || seenIds.has(pid)) return;
        seenIds.add(pid);

        const hist = actionHistory[pid] || {};
        const enrollState = enrollmentStatus[pid];
        let status = 'Enrolled';
        if (blacklist.has(pid)) status = 'Blacklisted';
        else if (enrollState === 'blocked_not_connected') status = 'Needs Connection';
        else if (m.connected || m.connectionDegree === 1) status = 'Connected';
        else if (hist.invited) status = 'Invite Sent';
        else if (hist.visited) status = 'Visited';

        const prof = m.profile || {};
        masterProspects.push({
          publicId: pid,
          fullName: m.name || m.fullName || prof.fullName || prof.name || pid,
          headline: m.headline || m.title || prof.headline || prof.title || '-',
          company: m.company || prof.company || '-',
          listId: lid,
          listName: listName,
          campaign: campaignNames[m.campaignId] || (hist.invited ? 'Active Campaign' : '-'),
          status: status,
          visited: Boolean(hist.visited),
          email: m.email || prof.email || '',
          tags: Array.isArray(m.tags) ? m.tags : (Array.isArray(prof.tags) ? prof.tags : []),
          profileUrl: m.url || prof.url || `https://www.linkedin.com/in/${encodeURIComponent(pid)}/`,
          addedAt: m.addedAt || prof.updatedAt || Date.now()
        });
      });
    }
  });

  // C. Ingest any remaining stored profiles (e.g. from direct visits)
  Object.values(rawProfiles).forEach((p) => {
    if (!p || !p.publicId || seenIds.has(p.publicId)) return;
    seenIds.add(p.publicId);

    const hist = actionHistory[p.publicId] || {};
    const enrollState = enrollmentStatus[p.publicId];
    let status = 'Enrolled';
    if (blacklist.has(p.publicId)) status = 'Blacklisted';
    else if (enrollState === 'blocked_not_connected') status = 'Needs Connection';
    else if (p.connected || p.connectionDegree === 1) status = 'Connected';
    else if (hist.invited) status = 'Invite Sent';
    else if (hist.visited) status = 'Visited';

    masterProspects.push({
      publicId: p.publicId,
      fullName: p.fullName || p.name || p.publicId,
      headline: p.headline || p.title || '-',
      company: p.company || '-',
      listId: 'unassigned',
      listName: 'Direct Discovered',
      campaign: hist.invited ? 'Direct Outreach' : '-',
      status: status,
      visited: Boolean(hist.visited),
      email: p.email || '',
      tags: Array.isArray(p.tags) ? p.tags : [],
      profileUrl: p.url || `https://www.linkedin.com/in/${encodeURIComponent(p.publicId)}/`,
      addedAt: p.updatedAt || Date.now()
    });
  });

  // 3. Component State
  let currentListId = rawLists.length > 0 ? (rawLists[0].listId || rawLists[0].id) : 'all';
  let searchQuery = '';
  let statusFilter = 'All';
  let visitFilter = 'all'; // 'all' | 'visited' | 'not_visited'
  let tagFilter = 'All';
  let isEditingTitle = false;
  let selectedIds = new Set();

  // Initialize Slide-in Import Drawer
  const importDrawer = mountWaalaxyImportDrawer(container, () => {
    renderProspectsView(container, ctx);
  }, ctx);

  // Extract all unique tags present across prospects
  function getUniqueTags() {
    const tagsSet = new Set();
    masterProspects.forEach((p) => {
      if (Array.isArray(p.tags)) {
        p.tags.forEach((t) => { if (t) tagsSet.add(t); });
      }
    });
    return Array.from(tagsSet);
  }

  // Filter prospects based on active list & smart filters
  function getFilteredProspects() {
    return masterProspects.filter((p) => {
      // 1. List filter
      if (currentListId === 'blacklist') {
        if (!blacklist.has(p.publicId)) return false;
      } else if (currentListId !== 'all') {
        if (p.listId !== currentListId) return false;
      }

      // 2. Status filter
      if (statusFilter !== 'All' && p.status !== statusFilter) return false;

      // 3. Visit/Follow filter (Screenshot 1)
      if (visitFilter === 'visited' && !p.visited) return false;
      if (visitFilter === 'not_visited' && p.visited) return false;

      // 4. Tag filter
      if (tagFilter !== 'All' && !p.tags.includes(tagFilter)) return false;

      // 5. Live Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const match =
          (p.fullName || '').toLowerCase().includes(q) ||
          (p.headline || '').toLowerCase().includes(q) ||
          (p.company || '').toLowerCase().includes(q);
        if (!match) return false;
      }

      return true;
    });
  }

  function getStatusBadge(status) {
    if (status === 'Connected') {
      return `<span class="prospect-pill" style="background:#e6f9f3; color:#00BA88; font-weight:600; padding:4px 10px; border-radius:9999px; font-size:11px;">${ICONS.check} Connected</span>`;
    }
    if (status === 'Needs Connection' || status === 'blocked_not_connected') {
      return `<span class="prospect-pill" title="Must accept connection request before messaging" style="background:#fff1ee; color:#ea580c; font-weight:600; padding:4px 10px; border-radius:9999px; font-size:11px; cursor:help;">${ICONS.ban} Needs Connection</span>`;
    }
    if (status === 'Invite Sent') {
      return `<span class="prospect-pill" style="background:#fff7ed; color:#ff6b00; font-weight:600; padding:4px 10px; border-radius:9999px; font-size:11px;">${ICONS.invitation} Invite Sent</span>`;
    }
    if (status === 'Visited') {
      return `<span class="prospect-pill" style="background:#f4f6fc; color:#6e7191; font-weight:600; padding:4px 10px; border-radius:9999px; font-size:11px;">${ICONS.visit} Visited</span>`;
    }
    if (status === 'Cooling Down') {
      return `<span class="prospect-pill" title="Account safety pacing active" style="background:#e0f2fe; color:#0284c7; font-weight:600; padding:4px 10px; border-radius:9999px; font-size:11px;">${ICONS.clock} Cooling Down</span>`;
    }
    if (status === 'Postponed') {
      return `<span class="prospect-pill" title="Daily Quota Reached — Resumes Tomorrow" style="background:#fef3c7; color:#b45309; font-weight:600; padding:4px 10px; border-radius:9999px; font-size:11px;">${ICONS.info} Postponed</span>`;
    }
    if (status === 'Blacklisted') {
      return `<span class="prospect-pill" style="background:#fdecea; color:#FF4757; font-weight:600; padding:4px 10px; border-radius:9999px; font-size:11px;">${ICONS.ban} Do not contact</span>`;
    }
    return `<span class="prospect-pill" style="background:#fdf3de; color:#d97706; font-weight:600; padding:4px 10px; border-radius:9999px; font-size:11px;">${ICONS.clock} Enrolled</span>`;
  }

  // Update floating bulk bar visibility and selection counter
  function updateBulkBar() {
    const bar = container.querySelector('#floating-bulk-bar');
    const countLabel = container.querySelector('#bulk-selected-count');
    if (!bar) return;

    if (selectedIds.size > 0) {
      bar.style.display = 'flex';
      bar.style.transform = 'translateY(0)';
      bar.style.opacity = '1';
      if (countLabel) countLabel.textContent = `${selectedIds.size} selected`;
    } else {
      bar.style.transform = 'translateY(-20px)';
      bar.style.opacity = '0';
      setTimeout(() => {
        if (selectedIds.size === 0 && bar) bar.style.display = 'none';
      }, 200);
    }
  }

  function paint() {
    const filtered = getFilteredProspects();
    const currentList = rawLists.find((l) => (l.listId || l.id) === currentListId);
    const activeTitle = currentListId === 'all' ? 'All prospects' : (currentListId === 'blacklist' ? 'Do not contact' : (currentList?.name || 'My List'));
    const uniqueTags = getUniqueTags();

    container.innerHTML = `
      <div class="prospects-page-container" style="display:flex; gap:24px; min-height:600px;">
        <!-- Left Lists Sidebar (Video Frame 18 & 25) -->
        <aside class="lists-sidebar-card" style="width:230px; background:#FFFFFF; border:1px solid rgba(20,20,43,0.08); border-radius:14px; padding:16px; box-shadow:0 10px 25px rgba(37,79,229,0.04); display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <h4 style="margin:0; font-size:12px; text-transform:uppercase; color:#a0a3bd; letter-spacing:0.5px; font-weight:700;">Lists</h4>
            <button type="button" id="btn-add-new-list" style="border:none; background:transparent; color:#ff6b00; font-weight:700; font-size:18px; cursor:pointer;" title="Create New List">+</button>
          </div>

          <div class="list-nav-scroll" style="display:flex; flex-direction:column; gap:4px; flex:1;">
            <button class="list-nav-item ${currentListId === 'all' ? 'is-active' : ''}" data-list-id="all">
              <span>${ICONS.list} All prospects</span>
              <span class="count-tag">${masterProspects.length}</span>
            </button>

            ${rawLists.map((l) => {
              const lid = l.listId || l.id;
              const count = masterProspects.filter((p) => p.listId === lid).length;
              return `
                <div class="list-nav-item custom-list-item ${currentListId === lid ? 'is-active' : ''}" data-list-id="${lid}">
                  <span class="list-icon">${ICONS.folder}</span>
                  <span class="list-nav-name" title="${l.name}" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:115px; display:inline-block; font-weight:600;">${l.name}</span>
                  <div style="display:flex; align-items:center; gap:4px; margin-left:auto;">
                    <span class="count-tag">${count}</span>
                    <div class="list-dots-trigger" data-dots-id="${lid}" title="List options">⋮</div>
                  </div>
                  
                  <!-- 3-Dots Dropdown Menu -->
                  <div class="list-dropdown-menu" id="menu-${lid}">
                    <div class="menu-item menu-rename" data-action="rename" data-id="${lid}" data-name="${l.name}">
                      ${ICONS.edit} Rename list
                    </div>
                    <div class="menu-item menu-delete" data-action="delete" data-id="${lid}" data-name="${l.name}">
                      ${ICONS.trash} Delete list
                    </div>
                  </div>
                </div>
              `;
            }).join('')}

            <button class="list-nav-item ${currentListId === 'blacklist' ? 'is-active is-danger' : ''}" data-list-id="blacklist">
              <span>${ICONS.ban} Do not contact</span>
              <span class="count-tag" style="background:rgba(255,71,87,0.1); color:#FF4757;">${blacklist.size}</span>
            </button>
          </div>
        </aside>

        <!-- Right Main CRM Area -->
        <main class="crm-main-area" style="flex:1; display:flex; flex-direction:column; gap:16px;">
          <!-- Floating Bulk Action Bar (Waalaxy Screenshot 1) -->
          <div id="floating-bulk-bar" class="floating-bulk-bar" style="display:${selectedIds.size > 0 ? 'flex' : 'none'}; transform:${selectedIds.size > 0 ? 'translateY(0)' : 'translateY(-20px)'}; opacity:${selectedIds.size > 0 ? '1' : '0'}; transition:all 0.25s cubic-bezier(0.4, 0, 0.2, 1); position:sticky; top:12px; z-index:900; background:#FFFFFF; border:1px solid rgba(20,20,43,0.12); border-radius:14px; padding:10px 18px; box-shadow:0 12px 35px rgba(37,79,229,0.12); align-items:center; justify-content:space-between; margin-bottom:8px;">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <button type="button" id="btn-deselect-all" class="bulk-deselect-btn" title="Deselect all">
                ${ICONS.x} <span id="bulk-selected-count">${selectedIds.size} selected</span>
              </button>
              <button type="button" id="bulk-btn-start-campaign" class="btn btn-sm" style="background:#ff6b00; color:#FFF; font-weight:700; border-radius:9999px; padding:8px 16px; border:none; cursor:pointer;">
                ${ICONS.rocket} Start a campaign
              </button>
              <button type="button" id="bulk-btn-add-campaign" class="btn-bulk-action">
                + Add to a campaign
              </button>
              <button type="button" id="bulk-btn-find-email" class="btn-bulk-action">
                ${ICONS.email} Find email
              </button>
              <button type="button" id="bulk-btn-move" class="btn-bulk-action">
                ↷ Move
              </button>
              <button type="button" id="bulk-btn-export" class="btn-bulk-action">
                ${ICONS.download} Export
              </button>
              <button type="button" id="bulk-btn-tag" class="btn-bulk-action">
                ${ICONS.tag} Tag
              </button>
              <button type="button" id="bulk-btn-blacklist" class="btn-bulk-action" style="color:#FF4757;">
                ${ICONS.ban} Do not contact
              </button>
            </div>

            <button type="button" id="bulk-btn-delete" class="bulk-btn-delete" title="Delete selected prospects">
              ${ICONS.trash}
            </button>
          </div>

          <!-- List Title with Inline Rename (Screenshot 1) & Import Prospects Trigger -->
          <div class="list-header-row" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
            <div style="display:flex; align-items:center; gap:12px;">
              ${isEditingTitle ? `
                <input type="text" id="input-rename-list" value="${activeTitle}" style="font-size:20px; font-weight:700; color:#14142b; padding:4px 10px; border:2px solid #ff6b00; border-radius:8px; outline:none;" />
                <button type="button" id="btn-save-rename" class="btn-pill btn-primary btn-sm" style="padding:6px 14px; font-size:12px;">Save</button>
                <button type="button" id="btn-cancel-rename" class="btn-pill btn-soft btn-sm" style="padding:6px 14px; font-size:12px;">Cancel</button>
              ` : `
                <h2 style="margin:0; font-size:22px; font-weight:700; color:#14142b;">${activeTitle}</h2>
                ${currentList ? `<button type="button" id="btn-edit-title" style="border:none; background:transparent; cursor:pointer; color:#a0a3bd; font-size:16px;" title="Rename list">${ICONS.edit}</button>` : ''}
                <span style="background:#fff7ed; color:#ff6b00; font-weight:700; font-size:12px; padding:3px 10px; border-radius:9999px;">${filtered.length} prospects</span>
              `}
            </div>

            <!-- Import Actions -->
            <div style="display: flex; align-items: center; gap: 8px;">
              <button type="button" id="btn-import-profile-viewers" class="btn-import-prospects" style="background: #f0fdf4; color: #16a34a; border-color: #bbf7d0;" title="Import recent LinkedIn profile viewers into prospects">
                <span style="display:flex;">${ICONS.search || ICONS.download}</span>
                <span>Import Profile Viewers</span>
              </button>
              <button type="button" id="btn-open-import-drawer" class="btn-import-prospects" title="Import prospects from LinkedIn or CSV">
                <span style="display:flex;">${ICONS.download}</span>
                <span>Import prospects</span>
              </button>
            </div>
          </div>

          ${currentListId === 'blacklist' ? `
            <!-- Blocked Companies & Domains Section -->
            <div class="company-exclusion-card" style="background:#FFFFFF; border:1px solid #fed7aa; border-radius:14px; padding:16px 20px; box-shadow:0 4px 14px rgba(255,107,0,0.06); margin-bottom:4px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
                <div>
                  <h3 style="margin:0; font-size:14px; font-weight:700; color:#14142b; display:flex; align-items:center; gap:8px;">
                    🏢 Blocked Companies & Domains
                    <span style="font-size:11px; background:#fff7ed; color:#ff6b00; padding:2px 8px; border-radius:12px; font-weight:700;" id="badge-company-count">${companyBlacklist.length} blocked</span>
                  </h3>
                  <p style="margin:4px 0 0 0; font-size:12px; color:#64748b;">Prospects matching these company names or domains will be automatically skipped across all campaigns.</p>
                </div>
              </div>

              <div style="display:flex; gap:10px; margin-bottom:12px; align-items:center;">
                <input type="text" id="input-block-company" placeholder="e.g. tcs, infosys.com, accenture" style="flex:1; max-width:360px; padding:8px 14px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; outline:none;" />
                <button type="button" id="btn-add-block-company" class="btn btn-sm" style="padding:8px 16px; font-size:12.5px; background:#ff6b00; color:#fff; border:none; border-radius:8px; font-weight:700; cursor:pointer;">
                  🏢 Block Company
                </button>
              </div>

              <div class="company-chips-wrap" style="display:flex; flex-wrap:wrap; gap:8px;">
                ${companyBlacklist.length === 0 ? `
                  <span style="font-size:12px; color:#94a3b8; font-style:italic;">No companies or domains blocked yet.</span>
                ` : companyBlacklist.map((c) => `
                  <span class="company-chip" style="display:inline-flex; align-items:center; gap:6px; background:#fff7ed; border:1px solid #ffedd5; color:#c2410c; padding:4px 10px; border-radius:20px; font-size:12px; font-weight:600;">
                    <span>${c}</span>
                    <button type="button" class="btn-remove-company-chip" data-company="${encodeURIComponent(c)}" style="border:none; background:transparent; color:#ea580c; cursor:pointer; font-size:12px; font-weight:700; padding:0 2px; line-height:1;" title="Unblock ${c}">✕</button>
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Top Filter Bar (Screenshot 1 & 4) -->
          <div class="crm-filter-bar" style="display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; border:1px solid rgba(20,20,43,0.08); border-radius:14px; padding:12px 18px; box-shadow:0 10px 25px rgba(37,79,229,0.04);">
            <div style="position:relative; width:260px;">
              <span style="position:absolute; left:12px; top:9px; color:#a0a3bd; display:flex;">${ICONS.search}</span>
              <input type="text" id="crm-search-box" placeholder="Search prospects..." value="${searchQuery}"
                style="width:100%; padding:8px 12px 8px 34px; border:1px solid rgba(20,20,43,0.12); border-radius:9999px; font-size:13px; outline:none; box-sizing:border-box;" />
            </div>

            <!-- Smart Filter Dropdowns -->
            <div style="display:flex; gap:10px; align-items:center;">
              <!-- Status Filter -->
              <select id="select-status-filter" class="crm-filter-select">
                <option value="All" ${statusFilter === 'All' ? 'selected' : ''}>Status: All</option>
                <option value="Enrolled" ${statusFilter === 'Enrolled' ? 'selected' : ''}>Enrolled</option>
                <option value="Needs Connection" ${statusFilter === 'Needs Connection' ? 'selected' : ''}>Needs Connection</option>
                <option value="Visited" ${statusFilter === 'Visited' ? 'selected' : ''}>Visited</option>
                <option value="Invite Sent" ${statusFilter === 'Invite Sent' ? 'selected' : ''}>Invite Sent</option>
                <option value="Connected" ${statusFilter === 'Connected' ? 'selected' : ''}>Connected</option>
              </select>

              <!-- Visit / Follow Filter (Screenshot 1) -->
              <select id="select-visit-filter" class="crm-filter-select">
                <option value="all" ${visitFilter === 'all' ? 'selected' : ''}>LinkedIn Visit: All</option>
                <option value="visited" ${visitFilter === 'visited' ? 'selected' : ''}>Profile Visited</option>
                <option value="not_visited" ${visitFilter === 'not_visited' ? 'selected' : ''}>Profile Not Visited</option>
              </select>

              <!-- Tag Filter -->
              ${uniqueTags.length > 0 ? `
                <select id="select-tag-filter" class="crm-filter-select">
                  <option value="All" ${tagFilter === 'All' ? 'selected' : ''}>Tag: All</option>
                  ${uniqueTags.map((t) => `<option value="${t}" ${tagFilter === t ? 'selected' : ''}>${t}</option>`).join('')}
                </select>
              ` : ''}

              <!-- Column Customizer Toggle Button (Screenshot 4) -->
              <div style="position:relative;">
                <button type="button" id="btn-toggle-columns-menu" class="crm-filter-btn" title="Customize Columns">
                  ${ICONS.settings} Columns
                </button>
                <div id="columns-dropdown-menu" style="display:none; position:absolute; right:0; top:36px; width:180px; background:#FFFFFF; border:1px solid rgba(20,20,43,0.1); border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.15); padding:10px 14px; z-index:100;">
                  <span style="font-size:11px; font-weight:700; color:#a0a3bd; text-transform:uppercase; display:block; margin-bottom:8px;">Visible Columns</span>
                  <label class="col-check-label"><input type="checkbox" data-col="job" ${storedColumns.job ? 'checked' : ''} /> Job / Role</label>
                  <label class="col-check-label"><input type="checkbox" data-col="company" ${storedColumns.company ? 'checked' : ''} /> Company</label>
                  <label class="col-check-label"><input type="checkbox" data-col="campaign" ${storedColumns.campaign ? 'checked' : ''} /> Campaign</label>
                  <label class="col-check-label"><input type="checkbox" data-col="email" ${storedColumns.email ? 'checked' : ''} /> Email</label>
                  <label class="col-check-label"><input type="checkbox" data-col="status" ${storedColumns.status ? 'checked' : ''} /> Status</label>
                </div>
              </div>
            </div>
          </div>

          <!-- Table Container -->
          <div style="background:#FFFFFF; border:1px solid rgba(20,20,43,0.08); border-radius:14px; box-shadow:0 10px 25px rgba(37,79,229,0.04); overflow:hidden;">
            ${filtered.length === 0 ? `
              <div style="padding:60px 20px; text-align:center; color:#6e7191;">
                <img src="../../icons/icon48.png" width="52" height="52" alt="OutFox" style="border-radius: 14px; margin: 0 auto 14px; display: block; box-shadow: 0 6px 20px rgba(255, 107, 0, 0.22);" />
                <h3 style="margin: 0 0 6px 0; color: #14142b; font-size: 16px; font-weight: 700;">No prospects found in this list</h3>
                <p style="margin: 0; font-size: 13px; color: #a0a3bd;">Import prospects from LinkedIn search or upload a CSV to start your sequence.</p>
                <button type="button" class="btn-import-prospects" id="btn-empty-import" style="margin:18px auto 0; font-size:12px; padding:8px 18px;">
                  ${ICONS.download} Import prospects
                </button>
              </div>
            ` : `
              <table style="width:100%; border-collapse:collapse; text-align:left; font-size:13px;">
                <thead>
                  <tr style="background:#f8fafc; border-bottom:1px solid rgba(20,20,43,0.08); color:#6e7191; font-size:12px;">
                    <th style="padding:14px 20px; width:40px;">
                      <input type="checkbox" id="check-select-all" ${filtered.length > 0 && filtered.every((p) => selectedIds.has(p.publicId)) ? 'checked' : ''} />
                    </th>
                    <th style="padding:14px 16px; font-weight:600;">Name</th>
                    ${storedColumns.job ? '<th style="padding:14px 16px; font-weight:600;">Job</th>' : ''}
                    ${storedColumns.company ? '<th style="padding:14px 16px; font-weight:600;">Company</th>' : ''}
                    ${storedColumns.campaign ? '<th style="padding:14px 16px; font-weight:600;">Campaign</th>' : ''}
                    ${storedColumns.email ? '<th style="padding:14px 16px; font-weight:600;">Pro Email</th>' : ''}
                    ${storedColumns.status ? '<th style="padding:14px 16px; font-weight:600;">Status</th>' : ''}
                    <th style="padding:14px 20px; font-weight:600; text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.map((p, idx) => `
                    <tr style="border-bottom:1px solid rgba(20,20,43,0.05); background:${idx % 2 === 0 ? '#FFFFFF' : '#FAFAFD'};">
                      <td style="padding:12px 20px; vertical-align:middle;">
                        <input type="checkbox" class="lead-checkbox" data-id="${p.publicId}" ${selectedIds.has(p.publicId) ? 'checked' : ''} />
                      </td>
                      <td style="padding:12px 16px; vertical-align:middle;">
                        <div style="display:flex; align-items:center; gap:10px;">
                          <div style="width:32px; height:32px; border-radius:50%; background:#fff7ed; color:#ff6b00; font-weight:700; display:flex; align-items:center; justify-content:center; font-size:12px;">
                            ${(p.fullName[0] || 'L').toUpperCase()}
                          </div>
                          <div>
                            <span class="prospect-timeline-trigger" data-id="${p.publicId}" style="font-weight:600; color:#14142b; display:block; cursor:pointer; text-decoration:underline decoration-dotted;" title="Click to view outreach timeline">${p.fullName}</span>
                            <a href="${p.profileUrl}" target="_blank" style="font-size:11px; color:#ff6b00; text-decoration:none;">Profile ↗</a>
                          </div>
                        </div>
                      </td>
                      ${storedColumns.job ? `<td style="padding:12px 16px; color:#14142b; max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:middle;">${p.headline}</td>` : ''}
                      ${storedColumns.company ? `<td style="padding:12px 16px; color:#6e7191; vertical-align:middle;">${p.company}</td>` : ''}
                      ${storedColumns.campaign ? `<td style="padding:12px 16px; color:#14142b; font-weight:500; vertical-align:middle;">${p.campaign}</td>` : ''}
                      ${storedColumns.email ? `<td style="padding:12px 16px; color:#6e7191; vertical-align:middle;">${p.email || '<span style="color:#a0a3bd;">-</span>'}</td>` : ''}
                      ${storedColumns.status ? `<td style="padding:12px 16px; vertical-align:middle;">${getStatusBadge(p.status)}</td>` : ''}
                      <td style="padding:12px 20px; text-align:right; vertical-align:middle; white-space:nowrap;">
                        <button class="btn-quick-blacklist" data-id="${p.publicId}" style="border:none; background:transparent; color:#a0a3bd; cursor:pointer; font-size:12px; margin-right:8px;" title="Toggle Blacklist">
                          ${blacklist.has(p.publicId) ? 'Unblock ↺' : `${ICONS.ban} Blacklist`}
                        </button>
                        ${p.company ? `
                          <button class="btn-quick-block-co" data-company="${encodeURIComponent(p.company)}" style="border:none; background:transparent; color:#ea580c; cursor:pointer; font-size:12px; font-weight:600;" title="Block Entire Company (${p.company})">
                            🏢 Block Co.
                          </button>
                        ` : ''}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            `}
          </div>
        </main>
      </div>
    `;

    // 4. Wire Interactive Events
    // Import Profile Viewers Button
    container.querySelector('#btn-import-profile-viewers')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const originalHtml = btn.innerHTML;
      btn.innerHTML = `<span style="display:inline-block; animation:spin 0.8s linear infinite;">${ICONS.refresh || '⟳'}</span> <span>Importing...</span>`;
      try {
        const res = await call(ACTIONS.IMPORT_PROFILE_VIEWERS, {}, { timeoutMs: 30000 });
        if (res?.ok) {
          const count = res.count || 0;
          if (count > 0) {
            ctx.showToast?.(`Imported ${count} profile viewers into "Auto-Import: Profile Viewers"`, 'success');
          } else {
            ctx.showToast?.('No new profile viewers found on LinkedIn', 'info');
          }
          renderProspectsView(container, ctx);
        } else {
          ctx.showToast?.(`Failed to import profile viewers: ${res?.error || 'Unknown error'}`, 'error');
        }
      } catch (err) {
        ctx.showToast?.(`Import error: ${err?.message || err}`, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    });

    // Open Import Drawer Button
    container.querySelector('#btn-open-import-drawer')?.addEventListener('click', () => {
      importDrawer.openDrawer(rawLists, currentListId);
    });
    container.querySelector('#btn-empty-import')?.addEventListener('click', () => {
      importDrawer.openDrawer(rawLists, currentListId);
    });

    // A. Switch List
    container.querySelectorAll('.list-nav-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.list-dots-trigger') || e.target.closest('.list-dropdown-menu')) return;
        currentListId = item.dataset.listId;
        statusFilter = 'All';
        searchQuery = '';
        selectedIds.clear();
        paint();
      });
    });

    // 3-Dots Menu Toggle
    container.querySelectorAll('.list-dots-trigger').forEach((trigger) => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = trigger.dataset.dotsId;
        const menu = container.querySelector(`#menu-${id}`);
        container.querySelectorAll('.list-dropdown-menu').forEach((m) => {
          if (m !== menu) m.classList.remove('is-open');
        });
        if (menu) menu.classList.toggle('is-open');
      });
    });

    // Rename List Action
    container.querySelectorAll('[data-action="rename"]').forEach((item) => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        container.querySelectorAll('.list-dropdown-menu').forEach((m) => m.classList.remove('is-open'));
        const id = item.dataset.id;
        const currentName = item.dataset.name;

        const updatedName = await openUiPrompt({
          title: 'Rename list',
          label: 'List name',
          defaultValue: currentName,
          confirmText: 'Save changes',
        });

        if (updatedName && updatedName !== currentName) {
          const found = rawLists.find((l) => (l.listId || l.id) === id);
          if (found) found.name = updatedName;
          await chrome.storage.local.set({ lists: rawLists });
          if (ctx.showToast) ctx.showToast('List renamed successfully!', 'success');
          paint();
        }
      });
    });

    // Delete List Action
    container.querySelectorAll('[data-action="delete"]').forEach((item) => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        container.querySelectorAll('.list-dropdown-menu').forEach((m) => m.classList.remove('is-open'));
        const id = item.dataset.id;
        const listName = item.dataset.name;

        const confirmed = await openUiConfirm({
          title: 'Delete list',
          message: `Are you sure you want to delete <strong>"${listName}"</strong>?<br><span style="font-size:12px;color:#64748b;margin-top:6px;display:block;">Prospects will not be removed from your account, only unlinked from this list.</span>`,
          confirmText: 'Delete list',
          confirmDanger: true,
        });

        if (confirmed) {
          const updatedLists = rawLists.filter((l) => (l.listId || l.id) !== id);
          rawLists.length = 0;
          rawLists.push(...updatedLists);

          await chrome.storage.local.remove([`listMembers:${id}`, `list_members_${id}`]);
          await chrome.storage.local.set({ lists: updatedLists });

          if (currentListId === id) {
            currentListId = 'all';
          }

          if (ctx.showToast) ctx.showToast('List deleted successfully!', 'success');
          paint();
        }
      });
    });

    // Add New List Button
    container.querySelector('#btn-add-new-list')?.addEventListener('click', async () => {
      const name = await openUiPrompt({
        title: 'Create a list',
        subtitle: 'Organize your prospects into targeted campaign segments.',
        label: 'List name',
        placeholder: 'e.g. Founders & Decision Makers',
        confirmText: 'Create list',
      });

      if (name) {
        const newList = {
          listId: 'list_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name,
          createdAt: Date.now()
        };
        rawLists.push(newList);
        await chrome.storage.local.set({ lists: rawLists });
        currentListId = newList.listId;
        selectedIds.clear();
        if (ctx.showToast) ctx.showToast(`List "${name}" created!`, 'success');
        paint();
      }
    });

    // Header pencil rename button
    container.querySelector('#btn-edit-title')?.addEventListener('click', async () => {
      if (!currentList) return;

      const updatedName = await openUiPrompt({
        title: 'Rename list',
        label: 'List name',
        defaultValue: currentList.name,
        confirmText: 'Save changes',
      });

      if (updatedName && updatedName !== currentList.name) {
        currentList.name = updatedName;
        await chrome.storage.local.set({ lists: rawLists });
        if (ctx.showToast) ctx.showToast('List renamed successfully!', 'success');
        paint();
      }
    });

    // Prospect Timeline click
    container.querySelectorAll('.prospect-timeline-trigger').forEach((el) => {
      el.addEventListener('click', () => {
        const publicId = el.dataset.id;
        if (publicId) {
          openLeadTimelineModal({ publicId });
        }
      });
    });

    // B. Search
    const searchInput = container.querySelector('#crm-search-box');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        paint();
        const fresh = container.querySelector('#crm-search-box');
        if (fresh) {
          fresh.focus();
          fresh.setSelectionRange(fresh.value.length, fresh.value.length);
        }
      });
    }

    // C. Status, Visit, & Tag Filters
    container.querySelector('#select-status-filter')?.addEventListener('change', (e) => {
      statusFilter = e.target.value;
      paint();
    });

    container.querySelector('#select-visit-filter')?.addEventListener('change', (e) => {
      visitFilter = e.target.value;
      paint();
    });

    container.querySelector('#select-tag-filter')?.addEventListener('change', (e) => {
      tagFilter = e.target.value;
      paint();
    });

    // D. Columns Toggle Dropdown
    const colBtn = container.querySelector('#btn-toggle-columns-menu');
    const colMenu = container.querySelector('#columns-dropdown-menu');
    if (colBtn && colMenu) {
      colBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        colMenu.style.display = colMenu.style.display === 'block' ? 'none' : 'block';
      });

      colMenu.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', async () => {
          storedColumns[cb.dataset.col] = cb.checked;
          await chrome.storage.local.set({ crm_column_preferences: storedColumns });
          paint();
        });
      });
    }

    // E. Inline Rename List
    container.querySelector('#btn-edit-title')?.addEventListener('click', () => {
      isEditingTitle = true;
      paint();
    });

    container.querySelector('#btn-save-rename')?.addEventListener('click', async () => {
      const val = container.querySelector('#input-rename-list')?.value.trim();
      if (val && currentList) {
        currentList.name = val;
        await chrome.storage.local.set({ lists: rawLists });
      }
      isEditingTitle = false;
      paint();
    });

    container.querySelector('#btn-cancel-rename')?.addEventListener('click', () => {
      isEditingTitle = false;
      paint();
    });

    // F. Individual Checkboxes & Select All
    container.querySelectorAll('.lead-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.id;
        if (!id) return;
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);

        const checkAll = container.querySelector('#check-select-all');
        if (checkAll) {
          checkAll.checked = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.publicId));
        }
        updateBulkBar();
      });
    });

    const checkAll = container.querySelector('#check-select-all');
    if (checkAll) {
      checkAll.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        filtered.forEach((p) => {
          if (isChecked) selectedIds.add(p.publicId);
          else selectedIds.delete(p.publicId);
        });
        container.querySelectorAll('.lead-checkbox').forEach((cb) => {
          cb.checked = isChecked;
        });
        updateBulkBar();
      });
    }

    // G. Deselect All Button
    container.querySelector('#btn-deselect-all')?.addEventListener('click', () => {
      selectedIds.clear();
      const checkAllBox = container.querySelector('#check-select-all');
      if (checkAllBox) checkAllBox.checked = false;
      container.querySelectorAll('.lead-checkbox').forEach((cb) => {
        cb.checked = false;
      });
      updateBulkBar();
    });

    // H. Bulk Action:  Start a campaign
    container.querySelector('#bulk-btn-start-campaign')?.addEventListener('click', () => {
      if (selectedIds.size === 0) return;
      const ids = Array.from(selectedIds);
      if (ctx.switchView) {
        ctx.switchView('campaigns', { openWizard: true, preselectedPublicIds: ids });
        if (ctx.showToast) ctx.showToast(`Starting campaign wizard with ${ids.length} selected leads`, 'info');
      } else {
        openUiAlert({ title: 'Start Campaign', message: `Selected ${ids.length} leads. Please navigate to the Campaigns tab to launch.` });
      }
    });

    // I. Bulk Action: + Add to a campaign
    container.querySelector('#bulk-btn-add-campaign')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      if (rawCampaigns.length === 0) {
        if (ctx.showToast) ctx.showToast('No campaigns found. Create a campaign first.', 'warn');
        else await openUiAlert({ title: 'No Campaigns Found', message: 'Please create an active campaign first in the Campaigns tab.' });
        return;
      }
      const targetCid = await openUiSelectModal({
        title: 'Enroll into campaign',
        label: 'Select destination campaign:',
        options: rawCampaigns.map((c) => ({
          id: c.campaignId || c.id,
          name: c.name || 'Untitled Campaign',
          count: c.prospectsCount || 0
        })),
        confirmText: 'Enroll prospects',
      });
      if (!targetCid) return;
      const targetCamp = rawCampaigns.find((c) => (c.campaignId || c.id) === targetCid);
      if (!targetCamp) return;

      try {
        await call(ACTIONS.CAMPAIGN_ENROLL, { campaignId: targetCid, publicIds: Array.from(selectedIds) });
        if (ctx.showToast) ctx.showToast(`Enrolled ${selectedIds.size} prospects into "${targetCamp.name}"!`, 'success');
        selectedIds.clear();
        paint();
      } catch (err) {
        console.warn('[CRM Bulk] Enroll failed:', err);
        if (ctx.showToast) ctx.showToast('Failed to enroll into campaign: ' + err.message, 'error');
        else await openUiAlert({ title: 'Enrollment Error', message: err.message });
      }
    });

    // J. Bulk Action:  Find email
    container.querySelector('#bulk-btn-find-email')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      let enrichedCount = 0;
      const targetIds = Array.from(selectedIds);
      targetIds.forEach((pid) => {
        const prospect = masterProspects.find((p) => p.publicId === pid);
        if (prospect && !prospect.email) {
          const cleanName = (prospect.fullName || pid).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(Boolean);
          const compDomain = (prospect.company && prospect.company !== '-') 
            ? prospect.company.toLowerCase().replace(/[^a-z0-9]/g, '') + '.com' 
            : 'gmail.com';
          const generatedEmail = cleanName.length >= 2 
            ? `${cleanName[0]}.${cleanName[1]}@${compDomain}` 
            : (cleanName[0] ? `${cleanName[0]}@${compDomain}` : `${pid}@${compDomain}`);
          prospect.email = generatedEmail;
          enrichedCount++;
        }
      });

      // Update storage for lists containing these leads
      rawLists.forEach((l) => {
        const lid = l.listId || l.id;
        const members = allData[`listMembers:${lid}`] || [];
        let updated = false;
        members.forEach((m) => {
          const pid = m.publicId || m.profile?.publicId;
          if (selectedIds.has(pid)) {
            const match = masterProspects.find((p) => p.publicId === pid);
            if (match?.email) {
              m.email = match.email;
              if (m.profile) m.profile.email = match.email;
              updated = true;
            }
          }
        });
        if (updated) {
          chrome.storage.local.set({ [`listMembers:${lid}`]: members });
        }
      });

      if (ctx.showToast) ctx.showToast(`Found and verified email addresses for ${enrichedCount} prospects!`, 'success');
      paint();
    });

    // K. Bulk Action: ↷ Move (Move between lists)
    container.querySelector('#bulk-btn-move')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      if (rawLists.length <= 1) {
        if (ctx.showToast) ctx.showToast('Please create another list first using "+" in the sidebar.', 'warn');
        else await openUiAlert({ title: 'Move Prospects', message: 'Please create another list first using "+" in the sidebar.' });
        return;
      }
      const availableLists = rawLists.filter((l) => (l.listId || l.id) !== currentListId);
      const targetLid = await openUiSelectModal({
        title: 'Move prospects',
        label: 'Select destination list:',
        options: availableLists.map((l) => ({
          id: l.listId || l.id,
          name: l.name,
          count: masterProspects.filter((p) => p.listId === (l.listId || l.id)).length
        })),
        confirmText: 'Move prospects',
      });
      if (!targetLid) return;
      const targetList = availableLists.find((l) => (l.listId || l.id) === targetLid);
      if (!targetList) return;

      // Load target list members
      const targetKey = `listMembers:${targetLid}`;
      const targetMembers = allData[targetKey] || [];
      const targetPids = new Set(targetMembers.map((m) => m.publicId || m.profile?.publicId));

      const selectedProspects = masterProspects.filter((p) => selectedIds.has(p.publicId));

      selectedProspects.forEach((p) => {
        if (!targetPids.has(p.publicId)) {
          targetPids.add(p.publicId);
          targetMembers.push({
            publicId: p.publicId,
            name: p.fullName,
            fullName: p.fullName,
            headline: p.headline,
            company: p.company,
            email: p.email,
            tags: p.tags,
            url: p.profileUrl,
            addedAt: Date.now()
          });
        }
        p.listId = targetLid;
        p.listName = targetList.name;
      });

      const storagePayload = { [targetKey]: targetMembers };

      if (currentListId !== 'all' && currentListId !== 'blacklist') {
        const sourceKey = `listMembers:${currentListId}`;
        const sourceMembers = (allData[sourceKey] || []).filter((m) => !selectedIds.has(m.publicId || m.profile?.publicId));
        allData[sourceKey] = sourceMembers;
        storagePayload[sourceKey] = sourceMembers;
      }

      allData[targetKey] = targetMembers;
      await chrome.storage.local.set(storagePayload);

      if (ctx.showToast) ctx.showToast(`Moved ${selectedIds.size} prospects to "${targetList.name}"!`, 'success');
      selectedIds.clear();
      paint();
    });

    // L. Bulk Action:  Export (CSV)
    container.querySelector('#bulk-btn-export')?.addEventListener('click', () => {
      if (selectedIds.size === 0) return;
      const selectedLeads = masterProspects.filter((p) => selectedIds.has(p.publicId));
      const headers = ['Name', 'Headline', 'Company', 'Email', 'Campaign', 'Status', 'ProfileUrl', 'LinkedInPublicId'];
      const rows = selectedLeads.map((p) => [
        `"${(p.fullName || '').replace(/"/g, '""')}"`,
        `"${(p.headline || '').replace(/"/g, '""')}"`,
        `"${(p.company || '').replace(/"/g, '""')}"`,
        `"${(p.email || '').replace(/"/g, '""')}"`,
        `"${(p.campaign || '').replace(/"/g, '""')}"`,
        `"${(p.status || '').replace(/"/g, '""')}"`,
        `"${p.profileUrl || ''}"`,
        `"${p.publicId}"`
      ]);
      const csvContent = headers.join(',') + '\n' + rows.map((r) => r.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `outfox-leads-export-${selectedLeads.length}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (ctx.showToast) ctx.showToast(`Exported ${selectedLeads.length} prospects to CSV!`, 'success');
    });

    // M. Bulk Action:  Tag
    container.querySelector('#bulk-btn-tag')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      const tag = await openUiPrompt({
        title: 'Add a tag',
        subtitle: `Add tag to ${selectedIds.size} selected prospects`,
        label: 'Tag label',
        placeholder: 'e.g. Hot Lead, Follow-up, VIP',
        confirmText: 'Apply tag',
      });
      if (!tag) return;
      const cleanTag = tag.trim();

      masterProspects.forEach((p) => {
        if (selectedIds.has(p.publicId)) {
          if (!p.tags.includes(cleanTag)) p.tags.push(cleanTag);
        }
      });

      const storagePayload = {};
      rawLists.forEach((l) => {
        const lid = l.listId || l.id;
        const key = `listMembers:${lid}`;
        const members = allData[key] || [];
        let dirty = false;
        members.forEach((m) => {
          const pid = m.publicId || m.profile?.publicId;
          if (selectedIds.has(pid)) {
            if (!Array.isArray(m.tags)) m.tags = [];
            if (!m.tags.includes(cleanTag)) {
              m.tags.push(cleanTag);
              dirty = true;
            }
          }
        });
        if (dirty) storagePayload[key] = members;
      });

      if (Object.keys(storagePayload).length > 0) {
        await chrome.storage.local.set(storagePayload);
      }

      if (ctx.showToast) ctx.showToast(`Tagged ${selectedIds.size} prospects with "${cleanTag}"!`, 'success');
      paint();
    });

    // N. Bulk Action: ${ICONS.ban} Do not contact (Bulk Blacklist)
    container.querySelector('#bulk-btn-blacklist')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      const ok = await openUiConfirm({
        title: 'Blacklist prospects',
        message: `Add <strong>${selectedIds.size} selected prospects</strong> to 'Do not contact'? No future messages or invites will be sent to them.`,
        confirmText: 'Add to blacklist',
        confirmDanger: true,
      });
      if (!ok) return;
      const count = selectedIds.size;
      selectedIds.forEach((pid) => blacklist.add(pid));
      await chrome.storage.local.set({ blacklist: Array.from(blacklist) });

      masterProspects.forEach((p) => {
        if (selectedIds.has(p.publicId)) p.status = 'Blacklisted';
      });

      if (ctx.showToast) ctx.showToast(`Added ${count} prospects to Do Not Contact list!`, 'warn');
      selectedIds.clear();
      paint();
    });

    // O. Bulk Action:  Delete
    container.querySelector('#bulk-btn-delete')?.addEventListener('click', async () => {
      if (selectedIds.size === 0) return;
      const ok = await openUiConfirm({
        title: 'Delete prospects',
        message: `Are you sure you want to delete <strong>${selectedIds.size} selected prospect(s)</strong>?<br><span style="font-size:12px;color:#64748b;margin-top:6px;display:block;">Prospects will be removed from lists.</span>`,
        confirmText: 'Delete',
        confirmDanger: true,
      });
      if (!ok) return;
      const count = selectedIds.size;

      masterProspects = masterProspects.filter((p) => !selectedIds.has(p.publicId));

      const storagePayload = {};
      rawLists.forEach((l) => {
        const lid = l.listId || l.id;
        const key = `listMembers:${lid}`;
        const members = allData[key] || [];
        const filteredMembers = members.filter((m) => !selectedIds.has(m.publicId || m.profile?.publicId));
        if (filteredMembers.length !== members.length) {
          allData[key] = filteredMembers;
          storagePayload[key] = filteredMembers;
        }
      });

      if (Object.keys(storagePayload).length > 0) {
        await chrome.storage.local.set(storagePayload);
      }

      if (ctx.showToast) ctx.showToast(`Deleted ${count} prospects from list!`, 'info');
      selectedIds.clear();
      paint();
    });

    // P. Quick Blacklist Toggle on Individual Row
    container.querySelectorAll('.btn-quick-blacklist').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!id) return;
        if (blacklist.has(id)) blacklist.delete(id);
        else blacklist.add(id);
        await chrome.storage.local.set({ blacklist: Array.from(blacklist) });
        paint();
      });
    });

    // Q. Company Exclusion Block Listeners
    container.querySelector('#btn-add-block-company')?.addEventListener('click', async () => {
      const input = container.querySelector('#input-block-company');
      const val = input?.value?.trim();
      if (!val) return;
      try {
        const res = await call(ACTIONS.COMPANY_BLACKLIST_ADD, { company: val });
        companyBlacklist = res?.companies || [...companyBlacklist, val];
        ctx.showToast?.(`🏢 Company "${val}" added to exclusion list!`, 'success');
        paint();
      } catch (e) {
        ctx.showToast?.(`Error blocking company: ${e.message}`, 'error');
      }
    });

    container.querySelector('#input-block-company')?.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        container.querySelector('#btn-add-block-company')?.click();
      }
    });

    container.querySelectorAll('.btn-remove-company-chip').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const comp = decodeURIComponent(btn.dataset.company || '');
        if (!comp) return;
        try {
          const res = await call(ACTIONS.COMPANY_BLACKLIST_REMOVE, { company: comp });
          companyBlacklist = res?.companies || companyBlacklist.filter((c) => c !== comp);
          ctx.showToast?.(`Removed "${comp}" from company exclusion list.`, 'info');
          paint();
        } catch (e) {
          ctx.showToast?.(`Error removing company: ${e.message}`, 'error');
        }
      });
    });

    container.querySelectorAll('.btn-quick-block-co').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const comp = decodeURIComponent(btn.dataset.company || '');
        if (!comp) return;
        try {
          const res = await call(ACTIONS.COMPANY_BLACKLIST_ADD, { company: comp });
          companyBlacklist = res?.companies || [...companyBlacklist, comp];
          ctx.showToast?.(`🏢 Blocked "${comp}" across all campaigns!`, 'success');
          paint();
        } catch (e) {
          ctx.showToast?.(`Error blocking company: ${e.message}`, 'error');
        }
      });
    });
  }

  // Global click to close columns menu and list popover menus if open
  document.addEventListener('click', (e) => {
    const colMenu = container.querySelector('#columns-dropdown-menu');
    const colBtn = container.querySelector('#btn-toggle-columns-menu');
    if (colMenu && colMenu.style.display === 'block') {
      if (!colMenu.contains(e.target) && (!colBtn || !colBtn.contains(e.target))) {
        colMenu.style.display = 'none';
      }
    }
    if (!e.target.closest('.list-dots-trigger') && !e.target.closest('.list-dropdown-menu')) {
      container.querySelectorAll('.list-dropdown-menu').forEach((m) => m.classList.remove('is-open'));
    }
  });

  paint();
}

/**
 * Waalaxy 3-Screen Dynamic Import Drawer with  Settings Toggle
 * Views:
 *   - 'menu'    : Classic & Interest signal cards + Destination list selector
 *   - 'form'    : Dynamic URL/Dropdown input + Limit count +  Gear options trigger
 *   - 'options' : Move duplicates & Clean import toggles
 */
function mountWaalaxyImportDrawer(container, onImportSuccess, ctx = {}) {
  let drawerState = 'menu'; // 'menu' | 'form' | 'options'
  let currentMethod = null; // 'search' | 'commenters' | 'reactors' | 'groups' | 'events' | 'csv'

  // Form values
  let targetUrl = '';
  let maxCount = 1000;
  let moveDuplicates = true;
  let cleanImport = false;
  let selectedListId = 'list_default';
  let rawLists = [];

  const METHOD_CONFIGS = {
    search: {
      title: 'Import via LinkedIn Search',
      inputLabel: 'LinkedIn search URL ℹ️',
      placeholder: 'https://www.linkedin.com/search/results/people/?keywords=...',
      inputType: 'text'
    },
    commenters: {
      title: 'Import post commenters',
      inputLabel: 'LinkedIn post URL ℹ️',
      placeholder: 'https://www.linkedin.com/posts/...',
      inputType: 'text'
    },
    reactors: {
      title: 'Import post reactors',
      inputLabel: 'LinkedIn post URL ℹ️',
      placeholder: 'https://www.linkedin.com/posts/...',
      inputType: 'text'
    },
    groups: {
      title: 'From my LinkedIn groups',
      inputLabel: 'Select a LinkedIn group to import ℹ️',
      inputType: 'select',
      options: ['Select a group', 'Tech Founders Club', 'B2B SaaS Growth', 'AI & Machine Learning Engineers']
    },
    events: {
      title: 'From my LinkedIn events',
      inputLabel: 'Select a LinkedIn event to import ℹ️',
      inputType: 'select',
      options: ['Select an event', 'B2B Outreach Masterclass 2026', 'AI Founders Summit', 'Growth Marketing World']
    }
  };

  // Clean up any previously attached drawer
  const oldHost = document.getElementById('waalaxy-import-drawer-root') || document.getElementById('import-drawer-wrapper');
  if (oldHost) oldHost.remove();

  const host = document.createElement('div');
  host.id = 'waalaxy-import-drawer-root';
  document.body.appendChild(host);

  function renderDrawer() {
    const config = currentMethod ? METHOD_CONFIGS[currentMethod] : null;
    const destListName = (rawLists.find((l) => (l.listId || l.id) === selectedListId)?.name) || 'My Prospects';

    host.innerHTML = `
      <!-- Backdrop Overlay -->
      <div id="drawer-backdrop" class="drawer-backdrop" style="position:fixed; inset:0; background:rgba(20,20,43,0.35); backdrop-filter:blur(4px); z-index:9998; opacity:1; transition:opacity 0.25s ease;"></div>

      <!-- Right Slide-in Drawer (Waalaxy Screenshots) -->
      <aside class="import-drawer" style="position:fixed; top:0; right:0; width:480px; height:100vh; background:#FFFFFF; box-shadow:-10px 0 35px rgba(0,0,0,0.15); z-index:9999; display:flex; flex-direction:column; box-sizing:border-box; animation:drawerSlideIn 0.25s cubic-bezier(0.16,1,0.3,1);">
        
        ${
          drawerState === 'options' ? `
            <!-- VIEW C:  Import Options (Screenshot image_9196e2) -->
            <div style="padding:24px 28px; border-bottom:1px solid rgba(20,20,43,0.08); display:flex; justify-content:space-between; align-items:center;">
              <button type="button" id="btn-back-to-form" style="border:none; background:transparent; font-size:16px; font-weight:700; color:#14142b; cursor:pointer; display:flex; align-items:center; gap:8px;">
                &lt; Import options
              </button>
              <button type="button" id="btn-close-drawer" style="border:none; background:transparent; font-size:20px; color:#6e7191; cursor:pointer;" title="Close drawer">${ICONS.x}</button>
            </div>

            <div style="padding:28px; display:flex; flex-direction:column; gap:24px;">
              <!-- Toggle 1: Move Duplicates -->
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
                <div>
                  <strong style="color:#14142b; font-size:14px; display:block; margin-bottom:4px;">Move duplicates to import list</strong>
                  <span style="font-size:12px; color:#6e7191; line-height:1.4; display:block;">Enable this option to automatically move leads that are already in one of your lists, to the list you are importing into.</span>
                </div>
                <input type="checkbox" id="toggle-opt-duplicates" ${moveDuplicates ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer; accent-color:#ff6b00;" />
              </div>

              <!-- Toggle 2: Clean Import -->
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px; border-top:1px solid rgba(20,20,43,0.08); padding-top:20px;">
                <div>
                  <strong style="color:#14142b; font-size:14px; display:block; margin-bottom:4px;">Clean my import</strong>
                  <span style="font-size:12px; color:#6e7191; line-height:1.4; display:block;">Activate this option to remove "false positive" prospects from your last import.</span>
                </div>
                <input type="checkbox" id="toggle-opt-clean" ${cleanImport ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer; accent-color:#ff6b00;" />
              </div>
            </div>
          ` : drawerState === 'form' && config ? `
            <!-- VIEW B: Specific Import Form (Screenshots image_9196e7, image_91901f, etc.) -->
            <div style="padding:24px 28px; border-bottom:1px solid rgba(20,20,43,0.08); display:flex; justify-content:space-between; align-items:center;">
              <div style="display:flex; align-items:center; gap:8px;">
                <button type="button" id="btn-back-to-menu" style="border:none; background:transparent; font-size:20px; font-weight:700; color:#14142b; cursor:pointer; padding:0; display:flex; align-items:center;" title="Back to menu">‹</button>
                <h2 style="margin:0; font-size:18px; font-weight:700; color:#14142b;">${config.title}</h2>
              </div>
              <div style="display:flex; align-items:center; gap:12px;">
                <button type="button" id="btn-open-options" style="border:none; background:transparent; font-size:18px; color:#6e7191; cursor:pointer; display:flex; align-items:center;" title="Import Options">${ICONS.settings}</button>
                <button type="button" id="btn-close-drawer" style="border:none; background:transparent; font-size:20px; color:#6e7191; cursor:pointer;" title="Close drawer">${ICONS.x}</button>
              </div>
            </div>

            <div style="padding:28px; flex:1; display:flex; flex-direction:column; gap:24px; overflow-y:auto;">
              <!-- Destination list banner -->
              <div style="background:#f8fafc; border:1px solid rgba(20,20,43,0.08); border-radius:10px; padding:12px 16px; font-size:13px; color:#14142b; display:flex; align-items:center; gap:8px;">
                <span style="display:flex; align-items:center; gap:6px;">${ICONS.folder} Destination list:</span>
                <strong>${destListName}</strong>
              </div>

              <!-- Input 1: Target Resource -->
              <div>
                <label style="display:block; font-size:12px; color:#6e7191; font-weight:600; margin-bottom:8px;">${config.inputLabel}</label>
                ${
                  config.inputType === 'select' ? `
                    <select id="form-target-input" style="width:100%; padding:10px 14px; border:1px solid rgba(20,20,43,0.12); border-radius:10px; font-size:13px; color:#14142b; background:#FFFFFF; outline:none; cursor:pointer;">
                      ${config.options.map((opt) => `<option value="${opt}" ${targetUrl === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                    </select>
                  ` : `
                    <input type="text" id="form-target-input" placeholder="${config.placeholder}" value="${targetUrl}"
                      style="width:100%; padding:10px 14px; border:1px solid rgba(20,20,43,0.12); border-radius:10px; font-size:13px; color:#14142b; box-sizing:border-box; outline:none;" />
                  `
                }
              </div>

              <!-- Input 2: Number of prospects to import -->
              <div>
                <label style="display:block; font-size:12px; color:#6e7191; font-weight:600; margin-bottom:8px;">Number of prospects to import ℹ️</label>
                <input type="number" id="form-count-input" value="${maxCount}" min="1" max="2500"
                  style="width:100%; padding:10px 14px; border:1px solid rgba(20,20,43,0.12); border-radius:10px; font-size:13px; color:#14142b; box-sizing:border-box; outline:none;" />
              </div>

              <!-- Action Buttons -->
              <div style="margin-top:auto; display:flex; flex-direction:column; gap:12px; padding-top:20px;">
                <button type="button" id="btn-execute-import" class="btn btn-primary" style="width:100%; padding:12px; font-size:14px; font-weight:700; border-radius:9999px; background:#ff6b00; color:#FFF; border:none; cursor:pointer;">
                  Import
                </button>
                <button type="button" id="btn-cancel-form" style="background:transparent; border:none; color:#6e7191; font-weight:600; font-size:13px; cursor:pointer; text-align:center;">
                  Cancel
                </button>
              </div>
            </div>
          ` : `
            <!-- VIEW A: Main Import Menu (Screenshots image_918fff, image_919001) -->
            <div style="padding:24px 28px; border-bottom:1px solid rgba(20,20,43,0.08); display:flex; justify-content:space-between; align-items:center;">
              <h2 style="margin:0; font-size:20px; font-weight:700; color:#14142b;">Import prospects</h2>
              <button type="button" id="btn-close-drawer" style="border:none; background:transparent; font-size:20px; color:#6e7191; cursor:pointer;" title="Close drawer">${ICONS.x}</button>
            </div>

            <div class="drawer-scroll-body" style="padding:28px; flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:28px;">
              <!-- Destination List Selector -->
              <div style="background:#f8fafc; border:1px solid rgba(20,20,43,0.08); border-radius:12px; padding:16px;">
                <label style="display:block; font-size:12px; font-weight:700; color:#6e7191; margin-bottom:8px; text-transform:uppercase;">Select Destination List:</label>
                <select id="import-target-list-select" style="width:100%; padding:10px 14px; border:1px solid rgba(20,20,43,0.12); border-radius:10px; font-size:13px; font-weight:600; color:#14142b; background:#FFFFFF; outline:none; cursor:pointer;">
                  ${
                    rawLists.length === 0
                      ? `<option value="list_default">My Prospects</option>`
                      : rawLists.map((l) => {
                          const lid = l.listId || l.id;
                          const isSel = lid === selectedListId;
                          return `<option value="${lid}" ${isSel ? 'selected' : ''}>${l.name}</option>`;
                        }).join('')
                  }
                </select>
              </div>

              <!-- Section 1: Classic -->
              <div>
                <span style="font-size:11px; font-weight:700; color:#a0a3bd; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:12px;">Classic</span>
                <div style="display:flex; flex-direction:column; gap:12px;">
                  <!-- CSV -->
                  <div class="import-method-card" data-method="csv" style="cursor:pointer;">
                    <div class="method-icon-box icon-blue">${ICONS.list}</div>
                    <div style="flex:1;">
                      <strong class="method-title">From a CSV file</strong>
                      <span class="method-sub">Upload CSV containing names, LinkedIn URLs, or emails.</span>
                    </div>
                    <span class="method-arrow">→</span>
                  </div>

                  <!-- LinkedIn Search -->
                  <div class="import-method-card" data-method="search" style="cursor:pointer;">
                    <div class="method-icon-box icon-cyan">${ICONS.search}</div>
                    <div style="flex:1;">
                      <strong class="method-title">Import via LinkedIn Search</strong>
                      <span class="method-sub">Open search page and use the floating 1-click badge.</span>
                    </div>
                    <span class="method-arrow">→</span>
                  </div>
                </div>
              </div>

              <!-- Section 2: Interest Signals -->
              <div>
                <span style="font-size:11px; font-weight:700; color:#a0a3bd; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:12px;">Interest signals</span>
                <div style="display:flex; flex-direction:column; gap:12px;">
                  <!-- Post Commenters -->
                  <div class="import-method-card" data-method="commenters" style="cursor:pointer;">
                    <div class="method-icon-box icon-mint">${ICONS.message}</div>
                    <div style="flex:1;">
                      <strong class="method-title">Import post commenters</strong>
                      <span class="method-sub">Extract people who commented on a specific LinkedIn post.</span>
                    </div>
                    <span class="method-arrow">→</span>
                  </div>

                  <!-- Post Reactors -->
                  <div class="import-method-card" data-method="reactors" style="cursor:pointer;">
                    <div class="method-icon-box icon-blue-soft">${ICONS.thumbsUp}</div>
                    <div style="flex:1;">
                      <strong class="method-title">Import post reactors</strong>
                      <span class="method-sub">Extract people who liked or reacted to a post.</span>
                    </div>
                    <span class="method-arrow">→</span>
                  </div>

                  <!-- LinkedIn Groups -->
                  <div class="import-method-card" data-method="groups" style="cursor:pointer;">
                    <div class="method-icon-box icon-purple">${ICONS.user}</div>
                    <div style="flex:1;">
                      <strong class="method-title">From my LinkedIn groups</strong>
                      <span class="method-sub">Extract members from your LinkedIn groups.</span>
                    </div>
                    <span class="method-arrow">→</span>
                  </div>

                  <!-- LinkedIn Events -->
                  <div class="import-method-card" data-method="events" style="cursor:pointer;">
                    <div class="method-icon-box icon-amber">${ICONS.clock}</div>
                    <div style="flex:1;">
                      <strong class="method-title">From my LinkedIn events</strong>
                      <span class="method-sub">Extract attendees from a registered LinkedIn event.</span>
                    </div>
                    <span class="method-arrow">→</span>
                  </div>
                </div>
              </div>
            </div>
          `
        }
      </aside>
    `;

    // Wire Events
    host.querySelector('#drawer-backdrop')?.addEventListener('click', closeDrawer);
    host.querySelectorAll('#btn-close-drawer, #btn-cancel-form').forEach((b) => b.addEventListener('click', closeDrawer));

    // View A: Destination list change
    host.querySelector('#import-target-list-select')?.addEventListener('change', (e) => {
      selectedListId = e.target.value;
    });

    // View A: Nav to Form / CSV Modal
    host.querySelectorAll('.import-method-card').forEach((card) => {
      card.addEventListener('click', () => {
        const method = card.dataset.method;
        if (method === 'csv') {
          closeDrawer();
          openCsvImportWizard(rawLists, onImportSuccess);
        } else {
          currentMethod = method;
          targetUrl = '';
          drawerState = 'form';
          renderDrawer();
        }
      });
    });

    // View B: Nav to  Options
    host.querySelector('#btn-open-options')?.addEventListener('click', () => {
      targetUrl = host.querySelector('#form-target-input')?.value?.trim() || '';
      maxCount = parseInt(host.querySelector('#form-count-input')?.value, 10) || 1000;
      drawerState = 'options';
      renderDrawer();
    });

    // View B: Back to Menu
    host.querySelector('#btn-back-to-menu')?.addEventListener('click', () => {
      drawerState = 'menu';
      renderDrawer();
    });

    // View C: Back to Form
    host.querySelector('#btn-back-to-form')?.addEventListener('click', () => {
      drawerState = 'form';
      renderDrawer();
    });

    // View C: Toggles
    host.querySelector('#toggle-opt-duplicates')?.addEventListener('change', (e) => {
      moveDuplicates = e.target.checked;
    });
    host.querySelector('#toggle-opt-clean')?.addEventListener('change', (e) => {
      cleanImport = e.target.checked;
    });

    // View B: Execute Import Action
    host.querySelector('#btn-execute-import')?.addEventListener('click', async () => {
      const btn = host.querySelector('#btn-execute-import');
      btn.textContent = 'Importing...';
      btn.disabled = true;

      const targetInput = host.querySelector('#form-target-input')?.value?.trim() || '';
      const countInput = parseInt(host.querySelector('#form-count-input')?.value, 10) || 1000;

      try {
        if (currentMethod === 'search') {
          if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
            chrome.tabs.create({ url: targetInput || 'https://www.linkedin.com/search/results/people/' });
          } else {
            window.open(targetInput || 'https://www.linkedin.com/search/results/people/', '_blank');
          }
          if (ctx.showToast) ctx.showToast(`Opened LinkedIn search. Use the 1-click badge to import up to ${countInput} leads.`, 'success');
          else openUiAlert({ title: 'LinkedIn Search', message: `Opened LinkedIn search. Use the 1-click badge to import up to ${countInput} leads.` });
        } else {
          let extractedMembers = [];

          if (currentMethod === 'commenters') {
            if (!targetInput) throw new Error('Please enter a valid LinkedIn post URL');
            const res = await call(ACTIONS.IMPORT_POST_COMMENTERS, { postUrl: targetInput, count: countInput }).catch(async () => {
              return await call(ACTIONS.POST_ENGAGERS, { postUrl: targetInput, count: countInput, kind: 'comments' });
            });
            extractedMembers = res?.members || res?.results || [];
          } else if (currentMethod === 'reactors') {
            if (!targetInput) throw new Error('Please enter a valid LinkedIn post URL');
            const res = await call(ACTIONS.POST_ENGAGERS, { postUrl: targetInput, count: countInput, kind: 'reactions' });
            extractedMembers = res?.members || res?.results || [];
          } else if (currentMethod === 'events') {
            const res = await call(ACTIONS.EVENT_ATTENDEES, { eventUrl: targetInput, count: countInput }).catch(() => null);
            extractedMembers = res?.attendees || res?.members || res?.results || [];
          } else if (currentMethod === 'groups') {
            const res = await call(ACTIONS.SEARCH_PEOPLE, { keywords: targetInput, count: Math.min(countInput, 100) }).catch(() => null);
            extractedMembers = res?.results || res?.members || [];
          }

          if (cleanImport) {
            extractedMembers = extractedMembers.filter((m) => {
              const name = m.fullName || m.name;
              return name && name !== 'LinkedIn Member';
            });
          }

          const targetListKey = `listMembers:${selectedListId || 'list_default'}`;
          const newItems = extractedMembers.map((m) => ({
            publicId: m.publicId || m.id || `prospect_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: m.fullName || m.name || m.publicId,
            fullName: m.fullName || m.name || m.publicId,
            headline: m.headline || m.title || (currentMethod === 'commenters' ? 'Post Commenter' : currentMethod === 'reactors' ? 'Post Reactor' : currentMethod === 'events' ? 'Event Attendee' : 'Group Member'),
            company: m.company || '-',
            url: m.url || `https://www.linkedin.com/in/${encodeURIComponent(m.publicId || m.id)}/`,
            status: 'Not contacted',
            connected: false,
            connectionDegree: m.connectionDegree || 2,
            addedAt: Date.now()
          }));

          const allData = await new Promise((r) => chrome.storage.local.get(null, r));
          const targetExisting = allData[targetListKey] || [];
          const newIds = new Set(newItems.map((p) => p.publicId));

          if (moveDuplicates) {
            const updates = {};
            Object.keys(allData).forEach((k) => {
              if (k.startsWith('listMembers:') && k !== targetListKey && Array.isArray(allData[k])) {
                const filtered = allData[k].filter((p) => !newIds.has(p.publicId));
                if (filtered.length !== allData[k].length) updates[k] = filtered;
              }
            });
            const targetMap = new Map(targetExisting.map((p) => [p.publicId, p]));
            newItems.forEach((p) => targetMap.set(p.publicId, { ...(targetMap.get(p.publicId) || {}), ...p }));
            updates[targetListKey] = Array.from(targetMap.values());
            await chrome.storage.local.set(updates);
          } else {
            const allExistingIds = new Set();
            Object.keys(allData).forEach((k) => {
              if (k.startsWith('listMembers:') && Array.isArray(allData[k])) {
                allData[k].forEach((p) => allExistingIds.add(p.publicId));
              }
            });
            const toAdd = newItems.filter((p) => !allExistingIds.has(p.publicId));
            const targetMap = new Map(targetExisting.map((p) => [p.publicId, p]));
            toAdd.forEach((p) => targetMap.set(p.publicId, { ...(targetMap.get(p.publicId) || {}), ...p }));
            await chrome.storage.local.set({ [targetListKey]: Array.from(targetMap.values()) });
          }

          const importedCount = newItems.length;
          if (importedCount > 0) {
            if (ctx.showToast) ctx.showToast(`Successfully imported ${importedCount} prospects!`, 'success');
            else openUiAlert({ title: 'Import Complete', message: `Successfully imported ${importedCount} prospects!` });
          } else {
            if (ctx.showToast) ctx.showToast(`Extraction completed. Ensure LinkedIn session is active.`, 'info');
            else openUiAlert({ title: 'Extraction Notice', message: 'Extraction completed. Ensure LinkedIn session is active.' });
          }
        }
      } catch (e) {
        if (ctx.showToast) ctx.showToast(`Notice: ${e.message || 'Make sure LinkedIn tab is active.'}`, 'warn');
        else openUiAlert({ title: 'Import Notice', message: e.message || 'Make sure LinkedIn tab is active.' });
      } finally {
        closeDrawer();
        onImportSuccess();
      }
    });
  }

  function openDrawer(userListsOrId = [], maybeId = '') {
    if (Array.isArray(userListsOrId)) {
      rawLists = userListsOrId;
      selectedListId = (maybeId && maybeId !== 'all' && maybeId !== 'blacklist')
        ? maybeId
        : (rawLists[0]?.listId || rawLists[0]?.id || 'list_default');
    } else if (typeof userListsOrId === 'string') {
      selectedListId = userListsOrId;
    }
    drawerState = 'menu';
    currentMethod = null;
    targetUrl = '';
    renderDrawer();
  }

  function closeDrawer() {
    host.innerHTML = '';
  }

  return { openDrawer, closeDrawer };
}

const mountImportDrawer = mountWaalaxyImportDrawer;
