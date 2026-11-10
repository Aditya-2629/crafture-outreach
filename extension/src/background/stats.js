/**
 * OutFox — Real-Time Data Pipeline & Metric Aggregator
 * Gathers authentic LinkedIn network metrics, calculates conversion rates,
 * and generates a 30-day activity timeline from local action logs.
 */

import { allActions, allProfiles, get, K } from '../lib/storage.js';
import { getConfig } from '../lib/config.js';
import { readCampaigns, readEnrollments } from './campaigns.js';
import { storedThreads } from './inbox.js';
import { getNetworkStats, getProfileViewsCount, selfTest } from './voyager.js';
import { isWithinBusinessHours } from './quota.js';
import { register } from './engine.js';
import { ACTIONS } from '../lib/actions.js';

/**
 * Group all logged actions into 30 daily buckets (YYYY-MM-DD)
 */
export function build30DayTimeline(actions = []) {
  const timeline = [];
  const now = new Date();

  // Create 30 consecutive day slots ending today
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const label = d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }); // e.g. "11 Oct"

    timeline.push({
      date: dateStr,
      label,
      invitations: 0,
      messages: 0,
      visits: 0,
    });
  }

  const slotMap = new Map(timeline.map((slot) => [slot.date, slot]));

  // Populate counts from real action logs
  actions.forEach((act) => {
    if (!act.at || !act.result || act.result.status !== 'sent') return;
    const actDate = new Date(act.at).toISOString().slice(0, 10);
    const slot = slotMap.get(actDate);
    if (!slot) return;

    if (act.action === 'outreach.invite') slot.invitations++;
    else if (act.action === 'outreach.message') slot.messages++;
    else if (act.action === 'outreach.view') slot.visits++;
  });

  return timeline;
}

/**
 * Aggregate all live metrics across storage and network
 */
export async function getLiveDashboardStats() {
  const [actions, campaigns, config, networkStats, profileViews, threads] = await Promise.all([
    allActions().catch(() => []),
    readCampaigns().catch(() => []),
    getConfig().catch(() => ({})),
    getNetworkStats().catch(() => ({ pendingCount: 0, connectionsCount: 0 })),
    getProfileViewsCount().catch(() => 0),
    storedThreads().catch(() => []),
  ]);

  // 1. Calculate Sent Totals
  let totalInvitesSent = 0;
  let totalMessagesSent = 0;
  let totalVisits = 0;

  actions.forEach((act) => {
    if (act.result?.status !== 'sent') return;
    if (act.action === 'outreach.invite') totalInvitesSent++;
    else if (act.action === 'outreach.message') totalMessagesSent++;
    else if (act.action === 'outreach.view') totalVisits++;
  });

  // 2. Calculate Accepted & Replies
  let acceptedInvites = 0;
  actions.forEach((act) => {
    if (act.action === 'invite_accepted' || act.result?.status === 'accepted') acceptedInvites++;
  });
  if (acceptedInvites === 0) {
    for (const c of campaigns) {
      if (c.stats?.accepted) acceptedInvites += c.stats.accepted;
    }
  }

  let messageResponses = 0;
  threads.forEach((t) => {
    if (t.messages && t.messages.some((m) => !m.fromMe)) {
      messageResponses++;
    } else if (t.unread || t.unreadCount > 0) {
      messageResponses++;
    }
  });
  if (messageResponses === 0) {
    for (const c of campaigns) {
      if (c.stats?.replied) messageResponses += c.stats.replied;
    }
  }

  // Rates
  const acceptanceRate = totalInvitesSent > 0 ? Math.round((acceptedInvites / totalInvitesSent) * 100) : 0;
  const responseRate = totalMessagesSent > 0 ? Math.round((messageResponses / totalMessagesSent) * 100) : 0;

  // 3. Campaign & Prospecting Status
  const activeCampaigns = campaigns.filter((c) => c.status === 'active');
  let queuedActions = 0;
  for (const c of activeCampaigns) {
    const enrollments = await readEnrollments(c.campaignId).catch(() => []);
    queuedActions += enrollments.filter((e) => e.status === 'active').length;
  }

  // Engine state determination
  let engineStatus = 'running';
  if (config.businessHoursOnly && !isWithinBusinessHours(config)) {
    engineStatus = 'outside_schedule';
  }

  // 4. Build 30-Day Activity History
  const activityTimeline = build30DayTimeline(actions);

  let userName = 'aditya chaudhary';
  try {
    const self = await selfTest().catch(() => null);
    if (self && self.publicId) userName = self.publicId;
  } catch {}

  return {
    profile: {
      name: userName,
      connections: networkStats.connectionsCount,
      pending: networkStats.pendingCount,
      views: profileViews,
    },
    prospectingStatus: {
      activeCampaignsCount: activeCampaigns.length,
      queuedActionsCount: queuedActions,
      engineStatus, // 'running' | 'outside_schedule'
    },
    kpis: {
      totalInvitesSent,
      totalMessagesSent,
      totalVisits,
      acceptedInvites,
      acceptanceRate,
      messageResponses,
      responseRate,
    },
    activityTimeline, // Array of 30 { date, label, invitations, messages, visits }
  };
}

// Register action for UI to call
register(ACTIONS.DASHBOARD_LIVE_STATS, () => getLiveDashboardStats());

