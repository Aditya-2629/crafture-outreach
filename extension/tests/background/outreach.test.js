import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as outreach from '../../src/background/outreach.js';
import * as voyager from '../../src/background/voyager.js';

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
    expect(withdrawSpy).toHaveBeenCalledWith(mockInvites[0]);
    expect(res.withdrawnCount).toBe(1);
    expect(res.skippedCount).toBe(0);

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
  });

  it('triggers fail-fast and throws when 2 consecutive withdrawals fail with 0 successes', async () => {
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

    await expect(
      outreach.withdrawStaleInvites({ olderThanDays: 14, maxCount: 10 }),
    ).rejects.toThrow('SDUI withdrawal failed: 400 Bad Request');

    // Should only have attempted 2 calls before breaking immediately, skipping the 3rd
    expect(withdrawSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockRestore();
    withdrawSpy.mockRestore();
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
});
