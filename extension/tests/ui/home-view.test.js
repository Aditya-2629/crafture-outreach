/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { computeFilteredHomeStats } from '../../src/dashboard/home-view.js';

describe('HomeView — Dynamic Date Range & Campaign Filtering', () => {
  const now = Date.now();
  const DAY_MS = 86400000;

  const sampleStorage = {
    campaigns: [
      { campaignId: 'camp-1', name: 'Data Analyst USA', status: 'running' },
      { campaignId: 'camp-2', name: 'Software Engineer UK', status: 'paused' },
    ],
    'enrollments:camp-1': [
      {
        publicId: 'prospect-1',
        accepted: true,
        acceptedAt: now - 2 * DAY_MS,
        status: 'accepted',
      },
      {
        publicId: 'prospect-2',
        status: 'replied',
        repliedAt: now - 3 * DAY_MS,
      },
      {
        publicId: 'prospect-3',
        status: 'active',
      },
    ],
    'enrollments:camp-2': [
      {
        publicId: 'prospect-4',
        accepted: true,
        acceptedAt: now - 15 * DAY_MS,
        status: 'accepted',
      },
    ],
    actions: [
      // Today (within 1 day)
      {
        action: 'outreach.invite',
        publicId: 'prospect-1',
        campaignId: 'camp-1',
        at: now - 2 * 3600 * 1000,
        result: { status: 'sent' },
      },
      {
        action: 'outreach.view',
        publicId: 'prospect-3',
        campaignId: 'camp-1',
        at: now - 3 * 3600 * 1000,
        result: { status: 'sent' },
      },
      // 3 days ago (within 7 days)
      {
        action: 'outreach.message',
        publicId: 'prospect-2',
        campaignId: 'camp-1',
        at: now - 3 * DAY_MS,
        result: { status: 'sent' },
      },
      // 10 days ago (within 30 days, camp-2)
      {
        action: 'outreach.invite',
        publicId: 'prospect-4',
        campaignId: 'camp-2',
        at: now - 10 * DAY_MS,
        result: { status: 'sent' },
      },
      {
        action: 'outreach.email',
        publicId: 'prospect-4',
        campaignId: 'camp-2',
        at: now - 12 * DAY_MS,
        result: { status: 'sent' },
      },
      // 45 days ago (older than 30 days, only in 'all')
      {
        action: 'outreach.invite',
        publicId: 'prospect-old',
        campaignId: 'camp-1',
        at: now - 45 * DAY_MS,
        result: { status: 'sent' },
      },
    ],
  };

  it('filters by "Today" (days = "1") across all campaigns', () => {
    const stats = computeFilteredHomeStats(sampleStorage, { days: '1', campaignId: 'all' });
    expect(stats.kpis.totalInvitesSent).toBe(1);
    expect(stats.kpis.totalVisits).toBe(1);
    expect(stats.kpis.totalMessagesSent).toBe(0);
    expect(stats.timeline).toHaveLength(1);
  });

  it('filters by "Last 7 days" (days = "7") across all campaigns', () => {
    const stats = computeFilteredHomeStats(sampleStorage, { days: '7', campaignId: 'all' });
    expect(stats.kpis.totalInvitesSent).toBe(1);
    expect(stats.kpis.totalMessagesSent).toBe(1);
    expect(stats.kpis.totalVisits).toBe(1);
    expect(stats.kpis.acceptedInvites).toBe(1); // prospect-1 was accepted 2 days ago
    expect(stats.kpis.messageResponses).toBe(1); // prospect-2 replied 3 days ago
    expect(stats.timeline).toHaveLength(7);
  });

  it('filters by "Last 30 days" (days = "30") across all campaigns', () => {
    const stats = computeFilteredHomeStats(sampleStorage, { days: '30', campaignId: 'all' });
    expect(stats.kpis.totalInvitesSent).toBe(2); // prospect-1 + prospect-4
    expect(stats.kpis.totalMessagesSent).toBe(1);
    expect(stats.kpis.totalVisits).toBe(1);
    expect(stats.kpis.totalEmailsSent).toBe(1); // prospect-4 email 12d ago
    expect(stats.kpis.acceptedInvites).toBe(2); // prospect-1 (2d) + prospect-4 (15d)
    expect(stats.timeline).toHaveLength(30);
  });

  it('filters by "All time" (days = "all") including older actions', () => {
    const stats = computeFilteredHomeStats(sampleStorage, { days: 'all', campaignId: 'all' });
    expect(stats.kpis.totalInvitesSent).toBe(3); // prospect-1 + prospect-4 + prospect-old
    expect(stats.kpis.totalMessagesSent).toBe(1);
    expect(stats.kpis.totalVisits).toBe(1);
    expect(stats.kpis.totalEmailsSent).toBe(1);
  });

  it('filters specifically by campaign "camp-1"', () => {
    const stats = computeFilteredHomeStats(sampleStorage, { days: '30', campaignId: 'camp-1' });
    expect(stats.kpis.totalInvitesSent).toBe(1); // only prospect-1
    expect(stats.kpis.totalMessagesSent).toBe(1); // prospect-2
    expect(stats.kpis.totalVisits).toBe(1); // prospect-3
    expect(stats.kpis.totalEmailsSent).toBe(0); // email belonged to camp-2
    expect(stats.kpis.acceptedInvites).toBe(1); // only prospect-1 from camp-1
    expect(stats.kpis.acceptanceRate).toBe(100); // 1 / 1 = 100%
  });

  it('filters specifically by campaign "camp-2"', () => {
    const stats = computeFilteredHomeStats(sampleStorage, { days: '30', campaignId: 'camp-2' });
    expect(stats.kpis.totalInvitesSent).toBe(1); // only prospect-4
    expect(stats.kpis.totalMessagesSent).toBe(0);
    expect(stats.kpis.totalVisits).toBe(0);
    expect(stats.kpis.totalEmailsSent).toBe(1); // prospect-4
    expect(stats.kpis.acceptedInvites).toBe(1); // prospect-4
    expect(stats.kpis.acceptanceRate).toBe(100);
  });

  it('gracefully uses fallbackStats when storage has no actions on initial load', () => {
    const emptyStorage = { campaigns: [] };
    const fallbackStats = {
      kpis: {
        totalInvitesSent: 15,
        totalMessagesSent: 8,
        totalVisits: 22,
        acceptedInvites: 6,
        messageResponses: 3,
      },
    };

    const stats = computeFilteredHomeStats(emptyStorage, {
      days: 'all',
      campaignId: 'all',
      fallbackStats,
    });

    expect(stats.kpis.totalInvitesSent).toBe(15);
    expect(stats.kpis.totalMessagesSent).toBe(8);
    expect(stats.kpis.totalVisits).toBe(22);
    expect(stats.kpis.acceptedInvites).toBe(6);
    expect(stats.kpis.acceptanceRate).toBe(40); // 6 / 15 = 40%
    expect(stats.kpis.messageResponses).toBe(3);
    expect(stats.kpis.responseRate).toBe(38); // 3 / 8 = 38%
  });
});
