/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildAgentContext,
  buildSystemPrompt,
  executeTool,
  runAgentLoop,
  getStoredBlueprints,
  saveStoredBlueprint,
  launchBlueprintInternal,
  sendChatAction,
} from '../../src/background/telegram.js';
import * as campaigns from '../../src/background/campaigns.js';
import * as lists from '../../src/background/lists.js';
import * as candidates from '../../src/background/candidates.js';
import { get, set } from '../../src/lib/storage.js';

describe('Telegram Gemini-Grade Multi-Turn ReAct Agent Copilot', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await set('outfox_chat_history', []);
    await set('outfox_pending_blueprints', {});
  });

  describe('1. Live Workspace Context Builder (buildAgentContext)', () => {
    it('assembles a comprehensive workspace snapshot', async () => {
      vi.spyOn(lists, 'getAll').mockResolvedValue([
        { listId: 'l1', name: 'USA Data Analysts', count: 42 },
      ]);
      vi.spyOn(campaigns, 'getAll').mockResolvedValue([
        {
          campaignId: 'c1',
          name: 'Tech Outreach',
          status: 'active',
          stats: { enrolled: 42, active: 10, replied: 2, failed: 0 },
        },
      ]);
      vi.spyOn(candidates, 'getActiveCandidate').mockResolvedValue({
        name: 'Aditya',
        slug: 'aditya',
        mode: 'reverse_recruiting',
        resumeUrl: 'https://drive.google.com/resume',
        bookingLink: 'https://calendly.com/aditya',
      });

      const ctx = await buildAgentContext();
      expect(ctx.activePersona.name).toBe('Aditya');
      expect(ctx.activePersona.resumeUrl).toBe('https://drive.google.com/resume');
      expect(ctx.prospectLists).toHaveLength(1);
      expect(ctx.prospectLists[0].name).toBe('USA Data Analysts');
      expect(ctx.campaigns).toHaveLength(1);
      expect(ctx.campaigns[0].name).toBe('Tech Outreach');
      expect(ctx.quotasRemaining.invitesLeft).toBeGreaterThanOrEqual(0);

      const prompt = buildSystemPrompt(ctx);
      expect(prompt).toContain('OutFox AI SDR');
      expect(prompt).toContain('USA Data Analysts');
      expect(prompt).toContain('Tech Outreach');
      expect(prompt).toContain('Aditya');
    });
  });

  describe('2. Agent Tools Execution (executeTool)', () => {
    it('executes list_prospect_lists', async () => {
      vi.spyOn(lists, 'getAll').mockResolvedValue([
        { listId: 'l1', name: 'Founders SF', count: 18 },
      ]);
      const res = await executeTool('list_prospect_lists', {});
      expect(res.totalLists).toBe(1);
      expect(res.lists[0].name).toBe('Founders SF');
    });

    it('executes design_campaign_blueprint and saves blueprint', async () => {
      vi.spyOn(lists, 'getAll').mockResolvedValue([
        { listId: 'l1', name: 'Data Analysts USA', count: 25 },
      ]);
      vi.spyOn(candidates, 'getActiveCandidate').mockResolvedValue({
        name: 'Aditya',
        slug: 'aditya',
        pitchTemplate: 'Hi {{firstName}}, would love to connect!',
      });

      const res = await executeTool('design_campaign_blueprint', {
        listQuery: 'Data Analysts USA',
        campaignName: 'Data Sourcing 2026',
        stepsCount: 3,
      });

      expect(res.ok).toBe(true);
      expect(res.campaignName).toBe('Data Sourcing 2026');
      expect(res.steps).toHaveLength(3);

      const stored = await getStoredBlueprints();
      expect(stored[res.blueprintId]).toBeDefined();
    });

    it('executes update_blueprint_steps with multi-step updates and appendSteps', async () => {
      const bpId = 'bp_test_123';
      await saveStoredBlueprint(bpId, {
        blueprintId: bpId,
        campaignName: 'Old Campaign',
        listName: 'Target Leads',
        steps: [
          { type: 'view', desc: 'View' },
          { type: 'invite', note: 'Old note', desc: 'Invite' },
          { type: 'message', body: 'Old body', delayDays: 1, desc: 'Message' },
        ],
      });

      const res = await executeTool('update_blueprint_steps', {
        blueprintId: bpId,
        campaignName: 'Friendly Outreach',
        updates: [
          { stepNumber: 2, note: 'Hey {{firstName}}, saw your work at {{company}}!' },
          { stepNumber: 3, body: 'Hey {{firstName}}, glad we connected! Would love to chat.', delayDays: 2 },
        ],
        appendSteps: [
          { type: 'message', body: 'Hey {{firstName}}, quick breakup message.', delayDays: 4 },
        ],
      });

      expect(res.ok).toBe(true);
      expect(res.campaignName).toBe('Friendly Outreach');
      expect(res.steps).toHaveLength(4);
      expect(res.steps[1].note).toBe('Hey {{firstName}}, saw your work at {{company}}!');
      expect(res.steps[2].body).toContain('glad we connected');
      expect(res.steps[2].delayDays).toBe(2);
      expect(res.steps[3].body).toContain('quick breakup message');
      expect(res.steps[3].delayDays).toBe(4);
    });

    it('executes launch_blueprint', async () => {
      const bpId = 'bp_launch_test';
      await saveStoredBlueprint(bpId, {
        blueprintId: bpId,
        campaignName: 'Launch Test',
        listId: 'l1',
        listName: 'Target Leads',
        steps: [{ type: 'invite', note: 'Hi' }],
      });

      vi.spyOn(campaigns, 'create').mockResolvedValue({
        campaignId: 'camp_live_1',
        name: 'Launch Test',
      });
      vi.spyOn(campaigns, 'readEnrollments').mockResolvedValue([{ publicId: 'p1' }]);

      const res = await executeTool('launch_blueprint', { blueprintId: bpId });
      expect(res.ok).toBe(true);
      expect(res.campaignId).toBe('camp_live_1');
      expect(res.enrolledCount).toBe(1);

      const stored = await getStoredBlueprints();
      expect(stored[bpId]).toBeUndefined();
    });

    it('executes control_campaign pause and resume', async () => {
      vi.spyOn(campaigns, 'getAll').mockResolvedValue([
        { campaignId: 'c1', name: 'Active 1', status: 'active' },
        { campaignId: 'c2', name: 'Paused 2', status: 'paused' },
      ]);
      const setStatusSpy = vi.spyOn(campaigns, 'setStatus').mockResolvedValue(true);

      const pauseRes = await executeTool('control_campaign', { action: 'pause' });
      expect(pauseRes.ok).toBe(true);
      expect(pauseRes.action).toBe('paused');
      expect(pauseRes.count).toBe(1);
      expect(setStatusSpy).toHaveBeenCalledWith('c1', 'paused');

      const resumeRes = await executeTool('control_campaign', { action: 'resume' });
      expect(resumeRes.ok).toBe(true);
      expect(resumeRes.action).toBe('resumed');
      expect(resumeRes.count).toBe(1);
      expect(setStatusSpy).toHaveBeenCalledWith('c2', 'active');
    });

    it('executes get_campaign_live_status', async () => {
      vi.spyOn(campaigns, 'getAll').mockResolvedValue([
        { campaignId: 'c_lead_1', name: 'Data Analyst Sourcing', status: 'active' },
      ]);
      vi.spyOn(campaigns, 'getCampaignLiveStatus').mockResolvedValue({
        campaignId: 'c_lead_1',
        campaignName: 'Data Analyst Sourcing',
        summary: { total: 25, active: 5, completed: 20, replied: 3, failed: 0 },
        leads: [
          {
            fullName: 'Sarah Connor',
            company: 'Google',
            status: 'waiting',
            currentStep: 'Step 2/3: Connection Request',
            nextRunIn: 'in 15m',
            lastError: null,
          },
        ],
      });

      const res = await executeTool('get_campaign_live_status', {
        campaignNameOrId: 'Data Analyst',
      });
      expect(res.status).toBe('ok');
      expect(res.campaignName).toBe('Data Analyst Sourcing');
      expect(res.topLeads).toHaveLength(1);
      expect(res.topLeads[0].fullName).toBe('Sarah Connor');
      expect(res.topLeads[0].company).toBe('Google');
    });

    it('executes update_candidate_links', async () => {
      vi.spyOn(candidates, 'getActiveCandidate').mockResolvedValue({
        name: 'Aditya',
        resumeUrl: 'https://old-resume.pdf',
        bookingLink: 'https://old-cal.com',
      });
      const saveSpy = vi.spyOn(candidates, 'saveCandidate').mockImplementation(async (c) => c);

      const res = await executeTool('update_candidate_links', {
        resumeUrl: 'https://new-resume.pdf',
        calendarUrl: 'https://calendly.com/new',
      });

      expect(res.ok).toBe(true);
      expect(res.resumeUrl).toBe('https://new-resume.pdf');
      expect(res.calendarUrl).toBe('https://calendly.com/new');
      expect(saveSpy).toHaveBeenCalled();
    });
  });

  describe('3. Multi-Turn ReAct Agent Loop (runAgentLoop)', () => {
    it('executes multi-step edit request and attaches launch button in 1 turn', async () => {
      // Seed pending blueprint
      await saveStoredBlueprint('bp_edit_react', {
        blueprintId: 'bp_edit_react',
        campaignName: 'Tech Hiring',
        listName: 'Engineers',
        steps: [
          { type: 'view', desc: 'View' },
          { type: 'invite', note: 'Standard note', desc: 'Invite' },
          { type: 'message', body: 'Standard follow-up', delayDays: 1, desc: 'Message' },
        ],
      });

      // Mock Telegram API fetch and AI fetch
      const fetchCalls = [];
      global.fetch = vi.fn(async (url, opts) => {
        fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });

        // Telegram API
        if (url.includes('api.telegram.org')) {
          return {
            ok: true,
            json: async () => ({ ok: true, result: { message_id: 999 } }),
          };
        }

        // LLM call (Iteration 1: calls update_blueprint_steps)
        const requestBody = JSON.parse(opts.body);
        const lastMsg = requestBody.messages[requestBody.messages.length - 1];

        if (lastMsg.role === 'user') {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_edit_1',
                        function: {
                          name: 'update_blueprint_steps',
                          arguments: JSON.stringify({
                            blueprintId: 'bp_edit_react',
                            updates: [
                              { stepNumber: 2, note: 'Hey {{firstName}}, really love your engineering work!' },
                              { stepNumber: 3, body: 'Hey {{firstName}}, great connecting! Open to opportunities?' },
                            ],
                          }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }

        // Iteration 2: LLM receives tool response and replies in Hinglish
        if (lastMsg.role === 'tool') {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: 'Done bro! Step 2 aur Step 3 dono ko friendly bana diya hai. Neeche launch button se start kar sakte ho.',
                  },
                },
              ],
            }),
          };
        }

        return { ok: true, json: async () => ({}) };
      });

      // Set config for AI
      await set('config', {
        ai: { provider: 'groq', apiKey: 'gsk_dummy_key', model: 'llama-3.3-70b-versatile' },
      });

      await runAgentLoop('dummy_token', '12345', 'Bro step 2 aur step 3 dono change kar ke thoda friendly bana de');

      // Verify typing chat action was sent
      const typingActions = fetchCalls.filter((c) => c.url.includes('sendChatAction'));
      expect(typingActions.length).toBeGreaterThanOrEqual(1);

      // Verify no "AI analyzing intent..." or "Action Completed Successfully" messages were sent
      const tgMessages = fetchCalls.filter((c) => c.url.includes('sendMessage'));
      expect(tgMessages.some((m) => m.body.text.includes('AI analyzing intent'))).toBe(false);
      expect(tgMessages.some((m) => m.body.text.includes('Action Completed Successfully'))).toBe(false);

      // Verify final reply contains assistant text and launch button
      const finalMsg = tgMessages[tgMessages.length - 1];
      expect(finalMsg.body.text).toContain('Done bro');
      expect(finalMsg.body.reply_markup.inline_keyboard[0][0].text).toContain('Launch Campaign Now');
      expect(finalMsg.body.reply_markup.inline_keyboard[0][0].callback_data).toContain('camp_approve:bp_edit_react');
    });

    it('answers live campaign status query via get_campaign_live_status', async () => {
      vi.spyOn(campaigns, 'getAll').mockResolvedValue([
        { campaignId: 'camp_da', name: 'Data Analyst USA', status: 'active' },
      ]);
      vi.spyOn(campaigns, 'getCampaignLiveStatus').mockResolvedValue({
        campaignId: 'camp_da',
        campaignName: 'Data Analyst USA',
        summary: { total: 20, active: 2, completed: 17, replied: 1, failed: 0 },
        leads: [
          {
            fullName: 'Sarah Connor',
            company: 'Google',
            status: 'waiting',
            currentStep: 'Step 2/3: Connection Request',
            nextRunIn: 'in 12m',
            lastError: null,
          },
        ],
      });

      const fetchCalls = [];
      global.fetch = vi.fn(async (url, opts) => {
        fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });

        if (url.includes('api.telegram.org')) {
          return { ok: true, json: async () => ({ ok: true, result: {} }) };
        }

        const requestBody = JSON.parse(opts.body);
        const lastMsg = requestBody.messages[requestBody.messages.length - 1];

        if (lastMsg.role === 'user') {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: [
                      {
                        id: 'call_stat_1',
                        function: {
                          name: 'get_campaign_live_status',
                          arguments: JSON.stringify({ campaignNameOrId: 'Data Analyst' }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          };
        }

        if (lastMsg.role === 'tool') {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: 'Data Analyst campaign me 20 leads hai, 17 complete ho chuke hai aur Sarah Connor (Google) par atka nahi hai balki next step 12 minute me scheduled hai.',
                  },
                },
              ],
            }),
          };
        }

        return { ok: true, json: async () => ({}) };
      });

      await set('config', {
        ai: { provider: 'gemini', apiKey: 'ai_dummy_key', model: 'gemini-2.0-flash' },
      });

      await runAgentLoop('dummy_token', '12345', 'Mera Data Analyst campaign ka live status kya hai, kaunse lead par atka hai?');

      const tgMessages = fetchCalls.filter((c) => c.url.includes('sendMessage'));
      const finalMsg = tgMessages[tgMessages.length - 1];
      expect(finalMsg.body.text).toContain('Sarah Connor');
      expect(finalMsg.body.text).toContain('Google');
    });
  });
});
