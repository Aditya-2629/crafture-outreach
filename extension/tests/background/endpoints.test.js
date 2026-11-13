import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_ENDPOINTS,
  initEndpoints,
  getEndpoint,
  syncEndpointsFromVault,
  reportBrokenEndpoint,
  runReadOnlyEndpointAudit,
} from '../../src/background/endpoints.js';

describe('endpoints', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('serves default endpoints when no cache exists', () => {
    expect(getEndpoint('me')).toBe(DEFAULT_ENDPOINTS.me);
    expect(getEndpoint('withdrawInvitation')).toBe(DEFAULT_ENDPOINTS.withdrawInvitation);
    expect(getEndpoint('sendInvite')).toBe(DEFAULT_ENDPOINTS.sendInvite);
  });

  it('handles offline / unavailable Vault gracefully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    const res = await syncEndpointsFromVault(false);
    expect(res.ok).toBe(false);
    expect(res.changed).toBe(false);
    expect(getEndpoint('me')).toBe(DEFAULT_ENDPOINTS.me);
  });

  it('updates cached endpoints when Vault provides new endpoints', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        endpoints: {
          withdrawInvitation: '/flagship-web/rsc-action/actions/server-request?sduiid=newWithdrawV2',
        },
      }),
    });

    const res = await syncEndpointsFromVault(true);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(getEndpoint('withdrawInvitation')).toBe(
      '/flagship-web/rsc-action/actions/server-request?sduiid=newWithdrawV2',
    );
  });

  it('enforces 12h cooldown on reporting broken endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy;

    const first = await reportBrokenEndpoint('withdrawInvitation', 404, '/test', 'Not Found');
    expect(first.ok).toBe(true);
    expect(first.skipped).toBeUndefined();

    // Second immediate call for same key should be skipped by cooldown
    const second = await reportBrokenEndpoint('withdrawInvitation', 404, '/test', 'Not Found');
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
    expect(second.reason).toBe('cooldown_active');
  });

  it('throttles syncEndpointsFromVault when force is false and called within 2 minutes', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ endpoints: {} }),
    });

    const first = await syncEndpointsFromVault(true);
    expect(first.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const second = await syncEndpointsFromVault(false);
    expect(second.throttled).toBe(true);
    // fetch should not be called again
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
