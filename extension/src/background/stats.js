/**
 * OutFox — Real-Time Data Pipeline & Metric Aggregator
 * Gathers authentic LinkedIn network metrics, calculates conversion rates,
 * and generates a 30-day activity timeline from local action logs.
 */

import { allActions, allProfiles, get, set, K } from '../lib/storage.js';
import { getConfig } from '../lib/config.js';
import { readCampaigns, readEnrollments, ensureCampaignAlarmWatchdog } from './campaigns.js';
import { storedThreads } from './inbox.js';
import { getNetworkStats, getProfileViewsCount, selfTest, me, vectorImageUrl, extractAvatarFromMini } from './voyager.js';
import { isWithinBusinessHours } from './quota.js';
import { register } from './engine.js';
import { ACTIONS } from '../lib/actions.js';

/**
 * Extract profile picture URL from LinkedIn miniProfile or included entities
 */
export function extractAvatarUrl(mini, included = []) {
  return extractAvatarFromMini(mini, included);
}

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
  ensureCampaignAlarmWatchdog().catch(() => {});
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

  // 5. LinkedIn Session Detection & Real Dynamic User Profile
  let linkedinConnected = false;
  let userProfile = null;

  try {
    let hasCookie = true;
    if (typeof chrome !== 'undefined' && chrome?.cookies?.get) {
      const liAtCookie = await chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'li_at' }).catch(() => null);
      hasCookie = !!(liAtCookie && liAtCookie.value);
    }
    if (hasCookie) {
      const self = await selfTest().catch(() => null);
      if (self && self.loggedIn && (self.fullName || self.publicId)) {
        const name = self.fullName || self.publicId || 'OutFox User';
        const firstName = self.firstName || self.fullName || 'there';
        const lastName = self.lastName || '';
        const initials =
          [self.firstName, self.lastName].filter(Boolean).map((n) => n[0]).join('').toUpperCase() ||
          (name ? name[0].toUpperCase() : 'U');
        linkedinConnected = true;
        userProfile = {
          name,
          fullName: self.fullName || name,
          firstName,
          lastName,
          initials: initials || 'U',
          publicId: self.publicId || '',
          avatarUrl: self.avatarUrl || '',
          connections: networkStats.connectionsCount,
          pending: networkStats.pendingCount,
          views: profileViews,
        };
        await set('user_profile', userProfile).catch(() => {});
      } else {
        const meRes = await me().catch(() => null);
        if (meRes) {
          const included = Array.isArray(meRes.included) ? meRes.included : [];
          const mini =
            included.find((e) => (e && e.firstName) || String(e?.entityUrn || '').includes('miniProfile') || String(e?.$type || '').includes('MiniProfile')) ||
            included[0] ||
            {};
          const firstName = (mini.firstName || '').trim();
          const lastName = (mini.lastName || '').trim();
          const fullName = [firstName, lastName].filter(Boolean).join(' ') || (mini.publicIdentifier || '').trim();
          const publicId = (mini.publicIdentifier || '').trim();
          const initials =
            [firstName, lastName].filter(Boolean).map((n) => n[0]).join('').toUpperCase() ||
            (fullName ? fullName[0].toUpperCase() : 'U');
          const avatarUrl = extractAvatarUrl(mini, included);

          if (fullName || publicId) {
            linkedinConnected = true;
            userProfile = {
              name: fullName || 'OutFox User',
              fullName: fullName || 'OutFox User',
              firstName: firstName || fullName || 'there',
              lastName: lastName || '',
              initials: initials || 'U',
              publicId: publicId || '',
              avatarUrl: avatarUrl || '',
              connections: networkStats.connectionsCount,
              pending: networkStats.pendingCount,
              views: profileViews,
            };
            await set('user_profile', userProfile).catch(() => {});
          }
        }
      }
    }
  } catch {
    linkedinConnected = false;
    userProfile = null;
  }

  // Cache networkStats in storage so dashboard never renders 0 on initial load
  if (networkStats && (networkStats.connectionsCount != null || networkStats.pendingCount != null)) {
    chrome.storage.local.set({
      networkStats: {
        connections: networkStats.connectionsCount,
        pending: networkStats.pendingCount,
        updatedAt: Date.now(),
      },
    }).catch(() => {});
  }

  return {
    linkedinConnected,
    profile: userProfile,
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

register(ACTIONS.NETWORK_STATS || 'network.stats', async () => {
  const net = await getNetworkStats().catch(() => ({ pendingCount: 0, connectionsCount: 0 }));
  const data = {
    connections: net.connectionsCount,
    pending: net.pendingCount,
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ networkStats: data }).catch(() => {});
  return data;
});

