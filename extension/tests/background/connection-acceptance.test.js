// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ACTIONS } from '../../src/lib/actions.js';
import * as engine from '../../src/background/engine.js';
const { handle } = engine;
import { setConfig } from '../../src/lib/config.js';
import * as campaigns from '../../src/background/campaigns.js';
import * as events from '../../src/background/events.js';
import * as quota from '../../src/background/quota.js';
import * as storage from '../../src/lib/storage.js';
import * as voyager from '../../src/background/voyager.js';
import '../../src/background/outreach.js';
import { routeBackground, seedSession, stubFetch } from '../helpers/net.js';

import profileView from '../fixtures/voyager/profileView.json';
import inviteAccepted from '../fixtures/voyager/inviteAccepted.json';
import inviteCreated from '../fixtures/voyager/inviteCreated.json';

const START = new Date(2026, 8, 9, 11, 0, 0);

let net;

beforeEach(async () => {
  campaigns.clearProspectLocks();
  campaigns.setProspectCooldownMs(0);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  quota.setSleepFn(() => Promise.resolve());
  seedSession();
  net = routeBackground(stubFetch());
  net.route('messengerConversations', { elements: [] });
  net.route('sentInvitationViewsV2', { elements: [] });
  net.route('relationships/dash/connections', { elements: [] });
  net.route('/identity/dash/profiles', profileView);
  events.setSink(() => {});
  await setConfig({
    autopilot: true,
    accountPreset: 'recruiter',
    hourlyCap: 50,
    businessHoursOnly: false,
  });
});

afterEach(() => {
  events.setSink(null);
  vi.useRealTimers();
  campaigns.setProspectCooldownMs(60 * 1000);
});

describe('isConnected() detection pipeline', () => {
  it('reliably detects 1st degree connections via getConnections case-insensitively', async () => {
    await storage.putProfile({
      publicId: 'Alex-Smith',
      firstName: 'Alex',
      memberId: '88776655',
    });

    // Mock getConnections returning the prospect with different casing
    vi.spyOn(voyager, 'getConnections').mockResolvedValueOnce({
      profiles: [
        {
          publicId: 'alex-smith',
          memberId: '88776655',
          urn: 'urn:li:fsd_profile:ACoAAAalex',
          connectionDegree: 1,
        },
      ],
      total: 1,
    });

    const isConn = await campaigns.isConnected('Alex-Smith');
    expect(isConn).toBe(true);

    const stored = await storage.getStoredProfile('Alex-Smith');
    expect(stored.connectionDegree).toBe(1);
    expect(stored.isConnected).toBe(true);
  });

  it('reliably detects 1st degree connections via getConnections by memberId or urn', async () => {
    await storage.putProfile({
      publicId: 'member-target',
      memberId: '12345678',
      urn: 'urn:li:fsd_profile:target123',
    });

    vi.spyOn(voyager, 'getConnections').mockResolvedValueOnce({
      profiles: [
        {
          publicId: 'vanity-url-differs',
          memberId: '12345678',
          objectUrn: 'urn:li:member:12345678',
          connectionDegree: 1,
        },
      ],
      total: 1,
    });

    const isConn = await campaigns.isConnected('member-target');
    expect(isConn).toBe(true);
  });

  it('detects 1st degree connections via profile fallback (distance DISTANCE_1 / degree 1)', async () => {
    await storage.putProfile({
      publicId: 'fallback-lead',
      firstName: 'Fallback',
    });

    vi.spyOn(voyager, 'getConnections').mockResolvedValueOnce({ profiles: [], total: 0 });
    net.route('/identity/dash/profiles', inviteAccepted);

    const isConn = await campaigns.isConnected('fallback-lead');
    expect(isConn).toBe(true);

    const stored = await storage.getStoredProfile('fallback-lead');
    expect(stored.connectionDegree).toBe(1);
    expect(stored.isConnected).toBe(true);
  });

  it('never opens a background DOM tab or deducts quota in isConnected and relies solely on API/cache', async () => {
    await storage.putProfile({
      publicId: 'dom-only-lead',
      firstName: 'DOM Lead',
    });

    vi.spyOn(voyager, 'getConnections').mockResolvedValueOnce({ profiles: [], total: 0 });
    net.route('/identity/dash/profiles', profileView); // 2nd degree on API

    // Spy on runDomActionInTab & quota reserve
    const domSpy = vi.spyOn(voyager, 'runDomActionInTab');
    const reserveSpy = vi.spyOn(quota, 'reserve');

    const enrollment = { publicId: 'dom-only-lead', stepIndex: 1 };
    const isConn = await campaigns.isConnected('dom-only-lead', enrollment);
    expect(isConn).toBe(false);
    expect(domSpy).not.toHaveBeenCalled();
    expect(reserveSpy).not.toHaveBeenCalled();
    expect(enrollment.parkReason).toBe('waiting_acceptance');
    expect(enrollment.nextAt).toBeGreaterThan(Date.now() + 10 * 3600 * 1000);
  });

  it('domCheckConnectionInPage accurately detects 1st degree DOM structure', async () => {
    // Setup document DOM in jsdom
    document.body.innerHTML = `
      <main>
        <div class="pv-top-card">
          <h1>Jane Doe</h1>
          <span class="dist-value">1st</span>
          <button type="button" aria-label="Message Jane">Message</button>
          <button type="button">More</button>
        </div>
      </main>
    `;

    const res = await voyager.domCheckConnectionInPage();
    expect(res.ok).toBe(true);
    expect(res.connected).toBe(true);
    expect(res.hasMessage).toBe(true);
    expect(res.has1stBadge).toBe(true);
    expect(res.hasConnect).toBe(false);
    expect(res.hasPending).toBe(false);
  });

  it('domCheckConnectionInPage rejects 2nd degree or pending profiles', async () => {
    document.body.innerHTML = `
      <main>
        <div class="pv-top-card">
          <h1>John Doe</h1>
          <span class="dist-value">2nd</span>
          <button type="button">Connect</button>
          <button type="button">More</button>
        </div>
      </main>
    `;

    const res = await voyager.domCheckConnectionInPage();
    expect(res.connected).toBe(false);
    expect(res.hasConnect).toBe(true);
  });
});

describe('waiting_acceptance parkReason & [Un-park] isolation', () => {
  it('tags enrollment with parkReason waiting_acceptance and unparkNonInviteEnrollments strictly ignores it', async () => {
    await storage.putProfile({ publicId: 'parked_lead', firstName: 'Parked' });
    const c = (await handle(ACTIONS.CAMPAIGN_CREATE, {
      name: 'ParkTest',
      steps: [
        { type: 'invite', note: 'Hi' },
        { type: 'message', body: 'Follow up' },
      ],
      publicIds: ['parked_lead'],
      settings: { autopilot: true },
    })).data;

    net.push(inviteCreated);
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    // Simulate invite sent, now on message step
    const enrollments = await campaigns.readEnrollments(c.campaignId);
    enrollments[0].stepIndex = 1;
    enrollments[0].nextAt = 0;
    await campaigns.writeEnrollments(c.campaignId, enrollments);

    // Run tick: prospect is not connected yet, should park with parkReason: 'waiting_acceptance'
    await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');

    const parkedEnrollments = await campaigns.readEnrollments(c.campaignId);
    expect(parkedEnrollments[0].parkReason).toBe('waiting_acceptance');
    expect(parkedEnrollments[0].lastError).toBe('Waiting for invite acceptance');
    expect(parkedEnrollments[0].nextAt).toBeGreaterThan(Date.now() + 10 * 3600 * 1000);

    // Call unparkNonInviteEnrollments: must NOT un-park this enrollment!
    const unparked = await campaigns.unparkNonInviteEnrollments();
    expect(unparked).toBe(0);

    const stillParked = await campaigns.readEnrollments(c.campaignId);
    expect(stillParked[0].parkReason).toBe('waiting_acceptance');
    expect(stillParked[0].nextAt).toBeGreaterThan(Date.now() + 10 * 3600 * 1000);
  });
});

describe('instant wake-up when connection accepted', () => {
  it('wakes up waiting_acceptance enrollments immediately when connection appears in getConnections', async () => {
    await storage.putProfile({ publicId: 'waking_lead', firstName: 'Waking' });
    const c = (await handle(ACTIONS.CAMPAIGN_CREATE, {
      name: 'WakeCamp',
      steps: [
        { type: 'invite', note: 'Hi' },
        { type: 'message', body: 'Welcome!' },
      ],
      publicIds: ['waking_lead'],
      settings: { autopilot: true },
    })).data;

    // Put lead into waiting_acceptance parked state
    const enrollments = await campaigns.readEnrollments(c.campaignId);
    enrollments[0].stepIndex = 1;
    enrollments[0].parkReason = 'waiting_acceptance';
    enrollments[0].lastError = 'Waiting for invite acceptance';
    enrollments[0].nextAt = Date.now() + 12 * 3600 * 1000;
    await campaigns.writeEnrollments(c.campaignId, enrollments);

    // Mock getConnections returning waking_lead as recently accepted
    vi.spyOn(voyager, 'getConnections').mockResolvedValue({
      profiles: [
        {
          publicId: 'waking_lead',
          connectionDegree: 1,
        },
      ],
      total: 1,
    });

    // Run wakeAcceptedEnrollments
    const now = Date.now();
    const woken = await campaigns.wakeAcceptedEnrollments(now);
    expect(woken).toBe(1);

    const updated = await campaigns.readEnrollments(c.campaignId);
    expect(updated[0].accepted).toBe(true);
    expect(updated[0].parkReason).toBeUndefined();
    expect(updated[0].lastError).toBeNull();
    expect(updated[0].nextAt).toBe(now);

    // Now run campaign tick: message step MUST execute on this exact tick!
    net.push({}); // mock message POST
    const tickRes = await handle(ACTIONS.CAMPAIGN_TICK, {}, 'system');
    expect(tickRes.data.executed).toBe(1);

    const doneEnrollment = await campaigns.readEnrollments(c.campaignId);
    expect(['done', 'accepted']).toContain(doneEnrollment[0].status);
  });

  it('checkNewAcceptancesAndWakeUp skips immediately without API calls when 0 enrollments are waiting', async () => {
    const getConnectionsSpy = vi.spyOn(voyager, 'getConnections');
    getConnectionsSpy.mockClear();

    const woken = await campaigns.checkNewAcceptancesAndWakeUp({ triggerTick: false });
    expect(woken).toBe(0);
    expect(getConnectionsSpy).not.toHaveBeenCalled();
  });

  it('checkNewAcceptancesAndWakeUp makes 1 single call ({ count: 40 }) and wakes matched leads', async () => {
    await storage.putProfile({ publicId: 'matched_lead', firstName: 'Matched' });
    const c = (await handle(ACTIONS.CAMPAIGN_CREATE, {
      name: 'WatcherCamp',
      steps: [
        { type: 'invite', note: 'Hi' },
        { type: 'message', body: 'Hello' },
      ],
      publicIds: ['matched_lead'],
      settings: { autopilot: true },
    })).data;

    const enrollments = await campaigns.readEnrollments(c.campaignId);
    enrollments[0].stepIndex = 1;
    enrollments[0].parkReason = 'waiting_acceptance';
    enrollments[0].nextAt = Date.now() + 10 * 3600 * 1000;
    await campaigns.writeEnrollments(c.campaignId, enrollments);

    const getConnectionsSpy = vi.spyOn(voyager, 'getConnections').mockResolvedValue({
      profiles: [{ publicId: 'matched_lead', connectionDegree: 1 }],
      total: 1,
    });

    const now = Date.now();
    const woken = await campaigns.checkNewAcceptancesAndWakeUp({ triggerTick: false, now });
    expect(woken).toBe(1);
    expect(getConnectionsSpy).toHaveBeenCalledWith({ count: 40 });

    const updated = await campaigns.readEnrollments(c.campaignId);
    expect(updated[0].accepted).toBe(true);
    expect(updated[0].parkReason).toBeUndefined();
    expect(updated[0].nextAt).toBe(now);
  });
});
