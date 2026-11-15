/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderSettingsView } from '../../src/dashboard/settings-view.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint, statusFixture, configFixture } from './helpers.js';

describe('SettingsView — Import History Tab', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  function setupEngine(extra = {}) {
    return stubEngine({
      [ACTIONS.CONFIG_GET]: configFixture({}),
      [ACTIONS.STATUS_GET]: statusFixture({}),
      [ACTIONS.NETWORK_WITHDRAW_AUTO_STATUS]: { active: false, totalWithdrawnToday: 0 },
      [ACTIONS.IMPORT_HISTORY_CLEAR]: {},
      ...extra,
    });
  }

  it('renders clean empty state with no dummy data when importHistory is empty', async () => {
    setupEngine();
    const host = mountPoint();

    await renderSettingsView(host, { showToast: () => {} });
    await flush(6);

    // Switch to import_history tab
    const historyTabBtn = host.querySelector('.settings-menu-item[data-tab="import_history"]');
    expect(historyTabBtn).toBeTruthy();
    historyTabBtn.click();
    await flush(6);

    // Verify dummy fallback is gone
    expect(host.textContent).not.toContain('My First List');
    expect(host.textContent).not.toContain('10/11/2026 at 01:44');

    // Verify empty state is displayed
    expect(host.textContent).toContain('No imports yet');
    expect(host.textContent).toContain('Prospects imported from CSV files');
    expect(host.querySelector('#btn-clear-import-history')).toBeNull();
  });

  it('renders real import rows and formats timestamps when history exists', async () => {
    setupEngine();
    const host = mountPoint();

    await chrome.storage.local.set({
      importHistory: [
        {
          id: 'imp_1',
          dateText: '15/11/2026 at 14:00',
          listName: 'Fintech Founders',
          importType: 'LinkedIn Search',
          scanned: 50,
          success: 48,
          duplicate: 2,
        },
      ],
    });

    await renderSettingsView(host, { showToast: () => {} });
    await flush(6);

    const historyTabBtn = host.querySelector('.settings-menu-item[data-tab="import_history"]');
    historyTabBtn.click();
    await flush(6);

    expect(host.textContent).toContain('Fintech Founders');
    expect(host.textContent).toContain('LinkedIn Search');
    expect(host.textContent).toContain('15/11/2026 at 14:00');
    expect(host.textContent).toContain('50');
    expect(host.textContent).toContain('48');
    expect(host.textContent).toContain('2');
    expect(host.querySelector('#btn-clear-import-history')).toBeTruthy();
  });

  it('removes internal infrastructure cards from Activity tab and provides Developer Logs shortcut', async () => {
    setupEngine();
    const host = mountPoint();

    await renderSettingsView(host, { tab: 'activity', showToast: () => {} });
    await flush(6);

    // Activity tab is default
    expect(host.textContent).not.toContain('High-Speed IndexedDB Engine');
    expect(host.textContent).not.toContain('LinkedIn Endpoints (Vault)');
    expect(host.querySelector('#btn-sync-endpoints-now')).toBeNull();
    expect(host.querySelector('#storage-health-badge')).toBeNull();

    // Verify Developer Logs link is present
    const devLogsBtn = host.querySelector('#btn-open-dev-logs');
    expect(devLogsBtn).toBeTruthy();
    expect(devLogsBtn.textContent).toContain('Developer Logs');
  });
});
