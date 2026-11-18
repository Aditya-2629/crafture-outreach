import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS } from '../../src/lib/actions.js';
import { setConfig } from '../../src/lib/config.js';
import * as outreach from '../../src/background/outreach.js';
import * as voyager from '../../src/background/voyager.js';
import * as quota from '../../src/background/quota.js';

describe('withdrawStaleInvites', () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => {
      if (typeof fn === 'function') fn();
      return 0;
    });
    await chrome.storage.local.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes full invite object to voyager.withdrawInvitation and increments withdrawnCount', async () => {
    const now = Date.now();
    const staleTime = now - 20 * 24 * 60 * 60 * 1000; // 20 days ago

    const mockInvites = [
      {
        invitationId: '7504239478362759168',
        sentTime: staleTime,
        sentAt: staleTime,
        profileUrn: 'ACoAA0106FIXTURE',
        firstName: 'Ada',
        lastName: 'Lovelace',
        vanityName: 'adalovelace',
        publicId: 'adalovelace',
      },
    ];

    const fetchSpy = vi.spyOn(voyager, 'fetchSentInvitations').mockResolvedValue(mockInvites);
    const withdrawSpy = vi.spyOn(voyager, 'withdrawInvitation').mockResolvedValue({ ok: true });

    const res = await outreach.withdrawStaleInvites({ olderThanDays: 14, maxCount: 10 });

    expect(fetchSpy).toHaveBeenCalled();
    expect(withdrawSpy).toHaveBeenCalledWith(
      '7504239478362759168',
      expect.objectContaining({
        profileUrn: 'ACoAA0106FIXTURE',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    );
    expect(res.withdrawnCount).toBe(1);
    expect(res.skippedCount).toBe(0);

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
  });

  it('hands off remaining invites to withdrawViaDomFallback when SDUI fails twice', async () => {
    const now = Date.now();
    const staleTime = now - 20 * 24 * 60 * 60 * 1000;

    const mockInvites = [
      { invitationId: '101', sentTime: staleTime, publicId: 'p1', vanityName: 'p1' },
      { invitationId: '102', sentTime: staleTime, publicId: 'p2', vanityName: 'p2' },
      { invitationId: '103', sentTime: staleTime, publicId: 'p3', vanityName: 'p3' },
      { invitationId: '104', sentTime: staleTime, publicId: 'p4', vanityName: 'p4' },
    ];

    const fetchSpy = vi.spyOn(voyager, 'fetchSentInvitations').mockResolvedValue(mockInvites);
    const withdrawSpy = vi
      .spyOn(voyager, 'withdrawInvitation')
      .mockRejectedValue(new Error('SDUI error: 400 Bad Request'));

    const domFallbackSpy = vi.spyOn(voyager, 'withdrawViaDomFallback').mockResolvedValue({
      withdrawn: 2,
      failed: 0,
      results: [
        { invitationId: '103', publicId: 'p3', success: true },
        { invitationId: '104', publicId: 'p4', success: true },
      ],
    });

    const res = await outreach.withdrawStaleInvites({ olderThanDays: 14, maxCount: 10 });

    expect(withdrawSpy).toHaveBeenCalledTimes(2);
    expect(domFallbackSpy).toHaveBeenCalledWith(
      [mockInvites[2], mockInvites[3]],
      expect.objectContaining({ olderThanDays: 14, maxCount: 10 }),
    );
    expect(res.withdrawnCount).toBe(2);
    expect(res.method).toBe('dom_fallback');

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
    domFallbackSpy.mockRestore();
  });

  it('triggers fail-fast and throws when withdrawals fail with 0 successes across SDUI and DOM fallback', async () => {
    const now = Date.now();
    const staleTime = now - 20 * 24 * 60 * 60 * 1000;

    const mockInvites = [
      { invitationId: '101', sentTime: staleTime, publicId: 'p1' },
      { invitationId: '102', sentTime: staleTime, publicId: 'p2' },
      { invitationId: '103', sentTime: staleTime, publicId: 'p3' },
    ];

    const fetchSpy = vi.spyOn(voyager, 'fetchSentInvitations').mockResolvedValue(mockInvites);
    const withdrawSpy = vi
      .spyOn(voyager, 'withdrawInvitation')
      .mockRejectedValue(new Error('SDUI withdrawal failed: 400 Bad Request'));
    const domFallbackSpy = vi.spyOn(voyager, 'withdrawViaDomFallback').mockResolvedValue({
      withdrawn: 0,
      failed: 1,
      results: [{ invitationId: '103', publicId: 'p3', success: false }],
    });

    await expect(
      outreach.withdrawStaleInvites({ olderThanDays: 14, maxCount: 10 }),
    ).rejects.toThrow('SDUI withdrawal failed: 400 Bad Request');

    expect(withdrawSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
    domFallbackSpy.mockRestore();
  });

  it('does not trigger fail-fast if at least 1 withdrawal succeeded', async () => {
    const now = Date.now();
    const staleTime = now - 20 * 24 * 60 * 60 * 1000;

    const mockInvites = [
      { invitationId: '101', sentTime: staleTime, publicId: 'p1' },
      { invitationId: '102', sentTime: staleTime, publicId: 'p2' },
      { invitationId: '103', sentTime: staleTime, publicId: 'p3' },
    ];

    const fetchSpy = vi.spyOn(voyager, 'fetchSentInvitations').mockResolvedValue(mockInvites);
    const withdrawSpy = vi
      .spyOn(voyager, 'withdrawInvitation')
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error('Network error on 102'))
      .mockRejectedValueOnce(new Error('Network error on 103'));

    const res = await outreach.withdrawStaleInvites({ olderThanDays: 14, maxCount: 10 });

    expect(res.withdrawnCount).toBe(1);
    expect(res.skippedCount).toBe(2);
    expect(res.errors).toHaveLength(2);

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
  });

  it('paginates fetchSentInvitations until a batch returns < 100 items', async () => {
    const now = Date.now();
    const freshTime = now - 2 * 24 * 60 * 60 * 1000;
    const staleTime = now - 60 * 24 * 60 * 60 * 1000; // 60 days old

    // Page 1: 100 fresh invites
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      invitationId: `fresh_${i}`,
      sentTime: freshTime,
      publicId: `fresh_user_${i}`,
    }));

    // Page 2: 2 stale invites (2-month-old)
    const page2 = [
      { invitationId: 'stale_1', sentTime: staleTime, publicId: 'stale_user_1' },
      { invitationId: 'stale_2', sentTime: staleTime, publicId: 'stale_user_2' },
    ];

    const fetchSpy = vi.spyOn(voyager, 'fetchSentInvitations')
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);

    const withdrawSpy = vi.spyOn(voyager, 'withdrawInvitation').mockResolvedValue({ ok: true, method: 'sdui_api' });

    const res = await outreach.withdrawStaleInvites({ olderThanDays: 14, maxCount: 10 });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenNthCalledWith(1, { start: 0, count: 100 });
    expect(fetchSpy).toHaveBeenNthCalledWith(2, { start: 100, count: 100 });
    expect(res.totalPending).toBe(102);
    expect(res.staleCount).toBe(2);
    expect(res.withdrawnCount).toBe(2);

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
  });
});

describe('auto-withdraw cleanup scheduler', () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn) => {
      if (typeof fn === 'function') fn();
      return 0;
    });
    await chrome.storage.local.clear();
    await chrome.alarms.clearAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts cleanup, runs immediate first batch, and schedules drip alarm when more stale invites remain', async () => {
    const now = Date.now();
    const staleTime = now - 20 * 24 * 60 * 60 * 1000;
    // 20 stale invites
    const mockInvites = Array.from({ length: 20 }, (_, i) => ({
      invitationId: `inv_${i}`,
      sentTime: staleTime,
      publicId: `user_${i}`,
    }));

    const fetchSpy = vi.spyOn(voyager, 'fetchSentInvitations').mockResolvedValue(mockInvites);
    const withdrawSpy = vi.spyOn(voyager, 'withdrawInvitation').mockResolvedValue({ ok: true });

    const state = await outreach.startAutoWithdrawCleanup({
      olderThanDays: 14,
      batchSize: 5,
      cooldownMinutes: 10,
      dailyCap: 50,
    });

    expect(state.active).toBe(true);
    expect(state.totalWithdrawnToday).toBe(5);
    expect(state.batchSize).toBe(5);
    expect(state.cooldownMinutes).toBe(10);
    expect(state.dailyCap).toBe(50);
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      outreach.WITHDRAW_CLEANUP_ALARM,
      { delayInMinutes: 10 },
    );

    // Verify persisted in storage
    const stored = await outreach.getAutoWithdrawCleanupStatus();
    expect(stored.active).toBe(true);
    expect(stored.totalWithdrawnToday).toBe(5);

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
  });

  it('stops cleanly and clears alarm when initial batch clears all stale invites', async () => {
    const now = Date.now();
    const staleTime = now - 20 * 24 * 60 * 60 * 1000;
    const mockInvites = [
      { invitationId: 'inv_1', sentTime: staleTime, publicId: 'user_1' },
    ];

    const fetchSpy = vi.spyOn(voyager, 'fetchSentInvitations').mockResolvedValue(mockInvites);
    const withdrawSpy = vi.spyOn(voyager, 'withdrawInvitation').mockResolvedValue({ ok: true });

    const state = await outreach.startAutoWithdrawCleanup({
      olderThanDays: 14,
      batchSize: 15,
      dailyCap: 75,
    });

    expect(state.active).toBe(false);
    expect(state.stoppedReason).toBe('completed');
    expect(state.totalWithdrawnToday).toBe(1);

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
  });

  it('stops cleanly when daily cap is reached', async () => {
    const now = Date.now();
    const staleTime = now - 20 * 24 * 60 * 60 * 1000;
    const mockInvites = Array.from({ length: 10 }, (_, i) => ({
      invitationId: `inv_${i}`,
      sentTime: staleTime,
      publicId: `user_${i}`,
    }));

    const fetchSpy = vi.spyOn(voyager, 'fetchSentInvitations').mockResolvedValue(mockInvites);
    const withdrawSpy = vi.spyOn(voyager, 'withdrawInvitation').mockResolvedValue({ ok: true });

    // With dailyCap of 3 and batchSize of 5, it should only withdraw 3 and stop
    const state = await outreach.startAutoWithdrawCleanup({
      olderThanDays: 14,
      batchSize: 5,
      dailyCap: 3,
    });

    expect(state.active).toBe(false);
    expect(state.stoppedReason).toBe('daily_cap_reached');
    expect(state.totalWithdrawnToday).toBe(3);

    // Attempting to start again on same day should reject cleanly
    const reState = await outreach.startAutoWithdrawCleanup({ dailyCap: 3 });
    expect(reState.active).toBe(false);
    expect(reState.stoppedReason).toBe('daily_cap_reached');

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
  });

  it('stops auto-clean and clears alarms on stopAutoWithdrawCleanup', async () => {
    await chrome.storage.local.set({
      [outreach.WITHDRAW_CLEANUP_STORAGE_KEY]: {
        active: true,
        totalWithdrawnToday: 10,
      },
    });
    chrome.alarms.create(outreach.WITHDRAW_CLEANUP_ALARM, { delayInMinutes: 15 });

    const stopped = await outreach.stopAutoWithdrawCleanup('manual_pause');
    expect(stopped.active).toBe(false);
    expect(stopped.stoppedReason).toBe('manual_pause');
    expect(chrome.alarms.clear).toHaveBeenCalledWith(outreach.WITHDRAW_CLEANUP_ALARM);
  });

  it('runAutoWithdrawCleanupTick processes next drip batch and reschedules or terminates', async () => {
    const now = Date.now();
    const staleTime = now - 20 * 24 * 60 * 60 * 1000;

    await chrome.storage.local.set({
      [outreach.WITHDRAW_CLEANUP_STORAGE_KEY]: {
        active: true,
        olderThanDays: 14,
        batchSize: 2,
        cooldownMinutes: 15,
        dailyCap: 10,
        totalWithdrawnToday: 2,
        today: new Date().toDateString(),
      },
    });

    const mockInvites = [
      { invitationId: 'inv_10', sentTime: staleTime, publicId: 'u10' },
      { invitationId: 'inv_11', sentTime: staleTime, publicId: 'u11' },
      { invitationId: 'inv_12', sentTime: staleTime, publicId: 'u12' },
    ];

    const fetchSpy = vi.spyOn(voyager, 'fetchSentInvitations').mockResolvedValue(mockInvites);
    const withdrawSpy = vi.spyOn(voyager, 'withdrawInvitation').mockResolvedValue({ ok: true });

    await outreach.runAutoWithdrawCleanupTick();

    const updated = await outreach.getAutoWithdrawCleanupStatus();
    expect(updated.active).toBe(true);
    expect(updated.totalWithdrawnToday).toBe(4);
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      outreach.WITHDRAW_CLEANUP_ALARM,
      { delayInMinutes: 15 },
    );

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
  });

  describe('ACTIONS.OUTREACH_LIKE graceful skip', () => {
    it('returns skipped status and releases reserved quota when postUrl is missing or empty', async () => {
      await setConfig({ businessHoursOnly: false });
      const res = await outreach.send(ACTIONS.OUTREACH_LIKE, { publicId: 'test_user' });
      expect(res.status).toBe('skipped');
      expect(res.reason).toBe('no_post_url');

      const resEmpty = await outreach.send(ACTIONS.OUTREACH_LIKE, { publicId: 'test_user', postUrl: '' });
      expect(resEmpty.status).toBe('skipped');
      expect(resEmpty.reason).toBe('no_post_url');
    });
  });

  describe('withdrawStaleInvites & quota verification', () => {
    it('never consumes profileView or visit quota, and never calls getProfile or getProfileNormalized', async () => {
      await quota.resetDailyQuota();
      const beforeSnapshot = await quota.snapshot('visit');
      expect(beforeSnapshot.dailyUsed).toBe(0);

      const now = Date.now();
      const staleTime = now - 20 * 24 * 60 * 60 * 1000;

      const mockInvites = [
        {
          invitationId: '7504239478362759168',
          entityUrn: 'urn:li:fs_relInvitation:7504239478362759168',
          sentTime: staleTime,
          sentAt: staleTime,
          profileUrn: 'ACoAA0106FIXTURE',
          toMemberUrn: 'urn:li:member:123456',
          firstName: 'Ada',
          lastName: 'Lovelace',
          fullName: 'Ada Lovelace',
          vanityName: 'adalovelace',
          publicId: 'adalovelace',
        },
      ];

      const fetchSpy = vi.spyOn(voyager, 'fetchSentInvitations').mockResolvedValue(mockInvites);
      const withdrawSpy = vi.spyOn(voyager, 'withdrawInvitation').mockResolvedValue({ ok: true, method: 'sdui_api' });
      const getProfileSpy = vi.spyOn(voyager, 'getProfile');
      const getProfileNormSpy = vi.spyOn(voyager, 'getProfileNormalized');
      const resolveUrnSpy = vi.spyOn(voyager, 'resolveProfileUrn');
      const reserveSpy = vi.spyOn(quota, 'reserve');

      const res = await outreach.withdrawStaleInvites({ olderThanDays: 14, maxCount: 10 });
      expect(res.withdrawnCount).toBe(1);

      expect(withdrawSpy).toHaveBeenCalledWith(
        '7504239478362759168',
        expect.objectContaining({
          profileUrn: 'urn:li:member:123456',
          entityUrn: 'urn:li:fs_relInvitation:7504239478362759168',
          publicId: 'adalovelace',
          firstName: 'Ada',
          lastName: 'Lovelace',
        }),
      );

      // Verify zero profile lookups
      expect(getProfileSpy).not.toHaveBeenCalled();
      expect(getProfileNormSpy).not.toHaveBeenCalled();
      expect(resolveUrnSpy).not.toHaveBeenCalled();

      // Verify zero quota reservations
      expect(reserveSpy).not.toHaveBeenCalledWith('visit', expect.anything());
      expect(reserveSpy).not.toHaveBeenCalledWith('profileView', expect.anything());

      const afterSnapshot = await quota.snapshot('visit');
      expect(afterSnapshot.dailyUsed).toBe(0);

      fetchSpy.mockRestore();
      withdrawSpy.mockRestore();
      getProfileSpy.mockRestore();
      getProfileNormSpy.mockRestore();
      resolveUrnSpy.mockRestore();
      reserveSpy.mockRestore();
    });
  });
});
