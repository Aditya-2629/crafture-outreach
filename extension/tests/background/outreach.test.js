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
    expect(withdrawSpy).toHaveBeenCalledWith(mockInvites[0], expect.anything());
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
    expect(domFallbackSpy).toHaveBeenCalledWith([mockInvites[2], mockInvites[3]]);
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
});
