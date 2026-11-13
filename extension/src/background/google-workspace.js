/**
 * OutFox — Unified Google Workspace & Cloud Engine.
 *
 * Powers:
 * 1. Auto-Created "OutFox Live CRM" Google Sheet with real-time event row syncing.
 * 2. Google Drive Cloud Backup & 1-Click Restore (`OutFox Backups/outfox-backup.json`).
 * 3. Local JSON snapshot export/import.
 */

import { ACTIONS, EVENTS } from '../lib/actions.js';
import { register } from './engine.js';
import { getConfig, setConfig } from '../lib/config.js';
import { onEvent } from './events.js';
import { allProfiles, getStoredProfile } from '../lib/storage.js';
import {
  getWorkspaceToken,
  getGoogleWorkspaceToken,
  connectGoogleWorkspace,
  disconnectGoogleWorkspace,
  switchOutreachMailbox,
} from './gmail.js';

export { getWorkspaceToken };

const SHEETS_CRM_STORAGE_KEY = 'outfox_sheets_crm_meta';
const DRIVE_BACKUP_FOLDER = 'OutFox Backups';
const DRIVE_BACKUP_FILENAME = 'outfox-backup.json';

/* ================================================================== */
/*  1. Google Sheets Live CRM                                         */
/* ================================================================== */

/**
 * Creates the "OutFox Live CRM" Google Sheet with a frozen header row.
 */
export async function createLiveCrmSheet(token) {
  const payload = {
    properties: {
      title: 'OutFox Live CRM',
    },
    sheets: [
      {
        properties: {
          title: 'Leads CRM',
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: [
                  { userEnteredValue: { stringValue: 'Public ID' } },
                  { userEnteredValue: { stringValue: 'Full Name' } },
                  { userEnteredValue: { stringValue: 'Company' } },
                  { userEnteredValue: { stringValue: 'LinkedIn URL' } },
                  { userEnteredValue: { stringValue: 'Email' } },
                  { userEnteredValue: { stringValue: 'Phone' } },
                  { userEnteredValue: { stringValue: 'Event / Step' } },
                  { userEnteredValue: { stringValue: 'Status' } },
                  { userEnteredValue: { stringValue: 'Message / Notes' } },
                  { userEnteredValue: { stringValue: 'Updated At' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google Sheets API error (${res.status}): ${(err.error && err.error.message) || res.statusText}`);
  }

  const data = await res.json();
  const spreadsheetId = data.spreadsheetId;
  const spreadsheetUrl = data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

  await setConfig({
    googleWorkspace: {
      spreadsheetId,
      spreadsheetUrl,
    },
  });

  await new Promise((r) => chrome.storage.local.set({
    [SHEETS_CRM_STORAGE_KEY]: { spreadsheetId, spreadsheetUrl },
    outfox_sheets_crm: { spreadsheetId, spreadsheetUrl },
  }, r));
  return { spreadsheetId, spreadsheetUrl };
}

/**
 * Retrieves existing or auto-creates "OutFox Live CRM" Google Sheet.
 */
export async function getOrCreateLiveCrmSheet(token) {
  const cfg = await getConfig();
  if (cfg.googleWorkspace?.spreadsheetId && cfg.googleWorkspace?.spreadsheetUrl) {
    return {
      spreadsheetId: cfg.googleWorkspace.spreadsheetId,
      spreadsheetUrl: cfg.googleWorkspace.spreadsheetUrl,
    };
  }

  const stored = await new Promise((r) => chrome.storage.local.get([SHEETS_CRM_STORAGE_KEY, 'outfox_sheets_crm'], (res) => {
    r(res?.[SHEETS_CRM_STORAGE_KEY] || res?.outfox_sheets_crm);
  }));

  if (stored?.spreadsheetId && stored?.spreadsheetUrl) {
    await setConfig({
      googleWorkspace: {
        spreadsheetId: stored.spreadsheetId,
        spreadsheetUrl: stored.spreadsheetUrl,
      },
    });
    return stored;
  }

  return createLiveCrmSheet(token);
}

/**
 * Ensures "OutFox Live CRM" Google Sheet is created and returns metadata.
 */
export async function ensureLiveCrmSheet(interactive = false) {
  const token = await getWorkspaceToken(interactive);
  return getOrCreateLiveCrmSheet(token);
}

/**
 * Appends row(s) to the "Leads CRM" tab of the connected Google Sheet.
 */
async function appendRowsToSheet(token, spreadsheetId, rows = []) {
  if (!rows || rows.length === 0) return;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent('Leads CRM!A:J')}:append?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: rows }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Google Sheets append failed (${res.status}): ${(err.error && err.error.message) || res.statusText}`);
  }

  return res.json();
}

/**
 * Real-time event subscriber: Auto-syncs outreach events into the Live CRM Sheet.
 */
onEvent(async (name, payload = {}) => {
  const TARGET_EVENTS = [
    EVENTS.CAMPAIGN_STEP_DONE,
    EVENTS.REPLY_RECEIVED,
    EVENTS.POSITIVE_REPLY,
    EVENTS.EMAIL_SENT,
    EVENTS.INVITE_ACCEPTED,
  ];

  if (!TARGET_EVENTS.includes(name)) return;

  try {
    const cfg = await getConfig();
    if (!cfg.googleWorkspace?.connected) return;

    let token;
    try {
      token = await getGoogleWorkspaceToken(false);
    } catch {
      return; // Token expired or not available silently
    }

    const { spreadsheetId } = await getOrCreateLiveCrmSheet(token);
    if (!spreadsheetId) return;

    const publicId = payload.publicId || payload.lead?.publicId || payload.recipientPublicId || '';
    let profile = null;
    if (publicId) {
      profile = await getStoredProfile(publicId).catch(() => null);
    }

    const fullName = profile?.fullName || payload.fullName || payload.name || `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim();
    const company = profile?.company || profile?.companyName || payload.company || '';
    const linkedInUrl = profile?.url || (publicId ? `https://www.linkedin.com/in/${publicId}` : '');
    const email = profile?.email || payload.email || payload.to || '';
    const phone = profile?.phone || payload.phone || '';
    const eventStep = name.toUpperCase().replace(/_/g, ' ');
    const status = payload.status || (name === EVENTS.POSITIVE_REPLY ? 'Interested' : name === EVENTS.REPLY_RECEIVED ? 'Replied' : 'Active');
    const notes = payload.message || payload.text || payload.body || payload.note || profile?.headline || '';
    const updatedAt = new Date().toISOString();

    const row = [
      publicId,
      fullName,
      company,
      linkedInUrl,
      email,
      phone,
      eventStep,
      status,
      notes,
      updatedAt,
    ];

    await appendRowsToSheet(token, spreadsheetId, [row]);
  } catch (err) {
    console.warn('[Sheets Live CRM Sync Error]', err.message);
  }
});

/**
 * Batch-appends all stored profiles into "OutFox Live CRM" Sheet.
 */
export async function syncAllLeadsToSheet() {
  const cfg = await getConfig();
  if (!cfg.googleWorkspace?.connected) {
    throw new Error('Google Workspace is not connected. Connect your Google account first.');
  }

  const token = await getWorkspaceToken();
  const { spreadsheetId, spreadsheetUrl } = await getOrCreateLiveCrmSheet(token);

  const profiles = await allProfiles();
  if (!profiles || profiles.length === 0) {
    return { success: true, rowsSynced: 0, spreadsheetUrl };
  }

  const rows = profiles.map((p) => [
    p.publicId || '',
    p.fullName || `${p.firstName || ''} ${p.lastName || ''}`.trim(),
    p.company || p.companyName || '',
    p.url || (p.publicId ? `https://www.linkedin.com/in/${p.publicId}` : ''),
    p.email || '',
    p.phone || '',
    'SYNC ALL LEADS',
    p.status || 'saved',
    p.headline || p.notes || '',
    new Date(p.updatedAt || p.capturedAt || Date.now()).toISOString(),
  ]);

  // Batch in chunks of 500 rows
  const CHUNK_SIZE = 500;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await appendRowsToSheet(token, spreadsheetId, chunk);
  }

  const now = Date.now();
  await setConfig({
    googleWorkspace: {
      lastSyncAt: now,
    },
  });

  return { success: true, rowsSynced: rows.length, spreadsheetUrl };
}

/* ================================================================== */
/*  2. Full Snapshot Backup & Restore (Local + Google Drive)           */
/* ================================================================== */

/**
 * Exports all storage collections into a clean JSON snapshot (excluding OAuth tokens).
 */
export async function exportFullSnapshot() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (allData) => {
      const filtered = {};
      for (const [k, v] of Object.entries(allData || {})) {
        if (k.toLowerCase().includes('token')) continue;
        filtered[k] = v;
      }
      resolve({
        version: 1,
        source: 'OutFox',
        exportedAt: new Date().toISOString(),
        collectionsCount: Object.keys(filtered).length,
        data: filtered,
      });
    });
  });
}

/**
 * Restores all storage collections from a JSON snapshot.
 */
export async function importFullSnapshot(snapshotInput) {
  const snapshot = snapshotInput?.data || snapshotInput;
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid snapshot payload. Expected a JSON object with collections.');
  }

  const safe = {};
  for (const [k, v] of Object.entries(snapshot)) {
    if (k.toLowerCase().includes('token')) continue;
    safe[k] = v;
  }

  await new Promise((resolve, reject) => {
    chrome.storage.local.set(safe, () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve();
    });
  });

  return {
    success: true,
    keysRestored: Object.keys(safe).length,
    restoredAt: Date.now(),
  };
}

/**
 * Helper to find or create the "OutFox Backups" folder on Google Drive.
 */
async function getOrCreateDriveBackupFolder(token) {
  const query = `name = '${DRIVE_BACKUP_FOLDER}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`;

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (listRes.ok) {
    const listData = await listRes.json();
    if (listData.files && listData.files.length > 0) {
      return listData.files[0].id;
    }
  }

  // Create folder
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: DRIVE_BACKUP_FOLDER,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.json().catch(() => ({}));
    throw new Error(`Drive folder creation failed (${createRes.status}): ${(err.error && err.error.message) || createRes.statusText}`);
  }

  const folderData = await createRes.json();
  return folderData.id;
}

/**
 * Uploads full snapshot to "OutFox Backups/outfox-backup.json" on Google Drive.
 */
export async function backupToGoogleDrive() {
  const cfg = await getConfig();
  if (!cfg.googleWorkspace?.connected) {
    throw new Error('Google Workspace is not connected. Connect your Google account first.');
  }

  const token = await getWorkspaceToken();
  const folderId = await getOrCreateDriveBackupFolder(token);
  const snapshot = await exportFullSnapshot();
  const fileContent = JSON.stringify(snapshot, null, 2);

  // Check if outfox-backup.json already exists in folder
  const fileQuery = `name = '${DRIVE_BACKUP_FILENAME}' and '${folderId}' in parents and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fileQuery)}&fields=files(id,name)`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  let existingFileId = null;
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.files && searchData.files.length > 0) {
      existingFileId = searchData.files[0].id;
    }
  }

  let fileId;
  if (existingFileId) {
    // Update existing file content
    const updateRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: fileContent,
    });
    if (!updateRes.ok) {
      const err = await updateRes.json().catch(() => ({}));
      throw new Error(`Drive backup update failed (${updateRes.status}): ${(err.error && err.error.message) || updateRes.statusText}`);
    }
    fileId = existingFileId;
  } else {
    // Multipart create
    const boundary = '-------outfox_drive_backup_boundary';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: DRIVE_BACKUP_FILENAME,
      parents: [folderId],
      mimeType: 'application/json',
    };

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: application/json\r\n\r\n' +
      fileContent +
      closeDelimiter;

    const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartRequestBody,
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new Error(`Drive backup creation failed (${createRes.status}): ${(err.error && err.error.message) || createRes.statusText}`);
    }

    const created = await createRes.json();
    fileId = created.id;
  }

  const now = Date.now();
  await setConfig({
    googleWorkspace: {
      lastBackupAt: now,
    },
  });

  return { success: true, fileId, backedUpAt: now };
}

/**
 * Downloads and restores the latest outfox-backup.json from Google Drive.
 */
export async function restoreFromGoogleDrive() {
  const cfg = await getConfig();
  if (!cfg.googleWorkspace?.connected) {
    throw new Error('Google Workspace is not connected. Connect your Google account first.');
  }

  const token = await getWorkspaceToken();

  // Search for outfox-backup.json
  const fileQuery = `name = '${DRIVE_BACKUP_FILENAME}' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fileQuery)}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime)`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!searchRes.ok) {
    throw new Error('Failed to search Google Drive for backup file.');
  }

  const searchData = await searchRes.json();
  if (!searchData.files || searchData.files.length === 0) {
    throw new Error(`No ${DRIVE_BACKUP_FILENAME} found on your Google Drive.`);
  }

  const targetFile = searchData.files[0];
  const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${targetFile.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!downloadRes.ok) {
    throw new Error(`Failed to download backup from Google Drive (${downloadRes.status}).`);
  }

  const snapshotJson = await downloadRes.json();
  const restoreResult = await importFullSnapshot(snapshotJson);
  return { ...restoreResult, fileId: targetFile.id };
}

/* ================================================================== */
/*  3. Register Engine Actions                                        */
/* ================================================================== */

register(ACTIONS.GOOGLE_WORKSPACE_CONNECT, async (params = {}) => {
  const interactive = params.interactive !== false;
  const result = await connectGoogleWorkspace(interactive);
  let spreadsheetUrl = '';
  try {
    const token = await getWorkspaceToken(false);
    const sheet = await getOrCreateLiveCrmSheet(token);
    spreadsheetUrl = sheet?.spreadsheetUrl || '';
  } catch {
    /* Sheet will be auto-created on first sync/event */
  }
  return { ...result, spreadsheetUrl };
});

register(ACTIONS.GOOGLE_WORKSPACE_STATUS, async () => {
  const cfg = await getConfig();
  const gw = cfg.googleWorkspace || {};
  return {
    connected: Boolean(gw.connected),
    email: gw.email || '',
    spreadsheetId: gw.spreadsheetId || '',
    spreadsheetUrl: gw.spreadsheetUrl || '',
    lastSyncAt: gw.lastSyncAt || 0,
    lastBackupAt: gw.lastBackupAt || 0,
  };
});

register(ACTIONS.GOOGLE_WORKSPACE_DISCONNECT, async () => {
  return disconnectGoogleWorkspace();
});

register(ACTIONS.SHEETS_CRM_SYNC_NOW, async () => {
  return syncAllLeadsToSheet();
});

register(ACTIONS.BACKUP_EXPORT_JSON, async () => {
  const snapshot = await exportFullSnapshot();
  return { snapshot };
});

register(ACTIONS.BACKUP_IMPORT_JSON, async (params = {}) => {
  return importFullSnapshot(params.snapshot);
});

register(ACTIONS.BACKUP_DRIVE_SAVE, async () => {
  return backupToGoogleDrive();
});

register(ACTIONS.BACKUP_DRIVE_RESTORE, async () => {
  return restoreFromGoogleDrive();
});

register(ACTIONS.OUTREACH_MAILBOX_SWITCH, async (params = {}) => {
  return switchOutreachMailbox(params);
});

