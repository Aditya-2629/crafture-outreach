import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as core from '../../src/background/voyager-core.js';
import {
  DEFAULT_ENDPOINTS,
  initEndpoints,
  getEndpoint,
  syncEndpointsFromVault,
  reportBrokenEndpoint,
  runReadOnlyEndpointAudit,
  markEndpointHealthy,
  getConsecutiveFailures,
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

  it('runs read-only health audit and appends mailboxUrn variables for messengerConversations', async () => {
    const fetchedUrls = [];
    vi.spyOn(core, 'voyagerFetch').mockImplementation(async (url) => {
      fetchedUrls.push(url);
      if (url.includes('/me')) {
        return {
          included: [
            {
              $type: 'com.linkedin.voyager.common.MiniProfile',
              entityUrn: 'urn:li:fsd_profile:ACoAAATEST',
            },
          ],
        };
      }
      return { ok: true };
    });

    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    const audit = await runReadOnlyEndpointAudit();
    expect(audit.ok).toBe(true);
    expect(audit.results.me.ok).toBe(true);
    expect(audit.results.messengerConversations.ok).toBe(true);

    const messengerCall = fetchedUrls.find(
      (u) => u.includes('messengerConversations') || u.includes('voyagerMessagingGraphQL'),
    );
    expect(messengerCall).toBeDefined();
    expect(messengerCall).toContain('variables=');
    expect(messengerCall).toContain('ACoAAATEST');
  });

  it('normalizes object endpoints with url property', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        endpoints: {
          connectionsSummary: {
            url: 'connectionsSummary_TEST404',
            method: 'GET',
            status: 'healthy',
          },
        },
      }),
    });

    const res = await syncEndpointsFromVault(true);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(true);
    expect(getEndpoint('connectionsSummary')).toBe('connectionsSummary_TEST404');
  });

  it('deduplicates auditRequestedAt so it runs strictly once per request timestamp', async () => {
    let auditCallCount = 0;
    vi.spyOn(core, 'voyagerFetch').mockImplementation(async () => {
      auditCallCount++;
      return { ok: true };
    });

    const testRequestedAt = Date.now() + 5000000;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        endpoints: {},
        auditRequestedAt: testRequestedAt,
      }),
    });

    // First sync should trigger audit
    await syncEndpointsFromVault(true);
    await new Promise((r) => setTimeout(r, 25));
    const countAfterFirst = auditCallCount;
    expect(countAfterFirst).toBeGreaterThan(0);

    // Second sync with identical auditRequestedAt should NOT trigger audit again
    await syncEndpointsFromVault(true);
    await new Promise((r) => setTimeout(r, 25));
    expect(auditCallCount).toBe(countAfterFirst);
  });

  it('does not append query params to listSentInvitations if URL already has ?', async () => {
    const fetchedUrls = [];
    vi.spyOn(core, 'voyagerFetch').mockImplementation(async (url) => {
      fetchedUrls.push(url);
      return { ok: true };
    });
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    // Sync a listSentInvitations URL that already contains query parameters
    const existingWithQuery = '/voyager/api/relationships/sentInvitationViewsV2?count=100&q=invitationType';
    await syncEndpointsFromVault(true);
    // Overwrite cached endpoint to test
    const endpoints = await initEndpoints();
    endpoints.listSentInvitations = existingWithQuery;

    await runReadOnlyEndpointAudit();
    const listSentCall = fetchedUrls.find((u) => u.includes('sentInvitationViewsV2'));
    expect(listSentCall).toBe(existingWithQuery);
    expect(listSentCall?.split('?').length).toBe(2); // strictly one '?'
  });

  it('triggers background broken endpoint report when an audited endpoint returns ok: false', async () => {
    vi.spyOn(core, 'voyagerFetch').mockImplementation(async (url) => {
      if (url.includes('connectionsSummary')) {
        const err = new Error('HTTP 404 Not Found');
        err.status = 404;
        throw err;
      }
      return { ok: true };
    });

    const reportCalls = [];
    global.fetch = vi.fn().mockImplementation(async (url, opts) => {
      if (String(url).includes('/report')) {
        reportCalls.push({ url, body: JSON.parse(opts.body) });
      }
      return { ok: true, json: async () => ({ ok: true }) };
    });

    const audit = await runReadOnlyEndpointAudit();
    expect(audit.results.connectionsSummary.ok).toBe(false);
    expect(audit.results.connectionsSummary.status).toBe(404);

    // Wait a tick for background fetch to fire
    await new Promise((r) => setTimeout(r, 20));

    expect(reportCalls.length).toBeGreaterThan(0);
    const brokenReport = reportCalls.find((c) => c.body.key === 'connectionsSummary');
    expect(brokenReport).toBeDefined();
    expect(brokenReport.body.status).toBe(404);
  });

  it('exposes follow, like, sendInviteSdui in DEFAULT_ENDPOINTS', () => {
    expect(DEFAULT_ENDPOINTS.follow).toContain('addaUpdateFollowState');
    expect(DEFAULT_ENDPOINTS.like).toContain('com.linkedin.sdui.reactions.create');
    expect(DEFAULT_ENDPOINTS.sendInviteSdui).toContain('addaAddConnection');
  });

  it('tracks consecutive failures and markEndpointHealthy resets them', async () => {
    const key = 'testEndpointReset';
    expect(getConsecutiveFailures(key)).toBe(0);

    // Call reportBrokenEndpoint twice with a 500 error
    await reportBrokenEndpoint(key, 500, '/test', 'Internal Error');
    expect(getConsecutiveFailures(key)).toBe(1);

    await reportBrokenEndpoint(key, 500, '/test', 'Internal Error');
    expect(getConsecutiveFailures(key)).toBe(2);

    // Healthy 200 response resets counter to 0
    markEndpointHealthy(key);
    expect(getConsecutiveFailures(key)).toBe(0);
  });

  it('requires 3 consecutive failures before reporting to Vault on non-404 status', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy;

    const key = 'testConsecutiveThresh';
    markEndpointHealthy(key);

    // 1st failure: skipped
    const res1 = await reportBrokenEndpoint(key, 500, '/test', 'Server error');
    expect(res1.skipped).toBe(true);
    expect(res1.reason).toContain('failures_below_threshold');
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2nd failure: skipped
    const res2 = await reportBrokenEndpoint(key, 500, '/test', 'Server error');
    expect(res2.skipped).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();

    // 3rd failure: reported!
    const res3 = await reportBrokenEndpoint(key, 500, '/test', 'Server error');
    expect(res3.ok).toBe(true);
    expect(res3.skipped).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('ignores per-prospect user errors without alerting Vault', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy;

    const key = 'testPerProspectErrors';
    markEndpointHealthy(key);

    const duplicateRes = await reportBrokenEndpoint(key, 400, '/test', { message: 'ALREADY_CONNECTED' });
    expect(duplicateRes.skipped).toBe(true);
    expect(duplicateRes.reason).toBe('per_prospect_error');

    const limitRes = await reportBrokenEndpoint(key, 400, '/test', { code: 'INVITE_LIMIT' });
    expect(limitRes.skipped).toBe(true);
    expect(limitRes.reason).toBe('per_prospect_error');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getConsecutiveFailures(key)).toBe(0);
  });
});
