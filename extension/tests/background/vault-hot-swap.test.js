import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as endpoints from '../../src/background/endpoints.js';
import * as voyager from '../../src/background/voyager.js';
import * as core from '../../src/background/voyager-core.js';

describe('Vault declarative payload metadata (meta) & strategy (mode) hot-swap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('withdrawInvitation', () => {
    it('applies custom screenId, queryName, requestedStateKeys, and extraPayload from Vault meta', async () => {
      vi.spyOn(endpoints, 'getEndpointConfig').mockReturnValue({
        url: '/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.mynetwork.addaWithdrawInvitation',
        mode: 'sdui_first',
        meta: {
          screenId: 'CustomWithdrawDialogScreen',
          queryName: 'CustomWithdrawQueryRefresh',
          requestedStateKeys: [
            { key: { value: { $case: 'id', id: 'customSentCountKey' } }, namespace: '' },
          ],
          extraPayload: {
            customWithdrawFlag: true,
            trackingCode: 'TEST_WITHDRAW_123',
          },
          headers: {
            'x-custom-withdraw-header': 'withdraw-test-val',
          },
        },
      });

      let capturedPayload = null;
      let capturedHeaders = null;
      vi.spyOn(core, 'voyagerFetch').mockImplementation(async (url, opts) => {
        capturedPayload = opts?.body;
        capturedHeaders = opts?.headers;
        return { ok: true, status: 200, text: '{"actionStatus":"SUCCESS"}' };
      });

      const res = await voyager.withdrawInvitation('7504239478362759168', {
        publicId: 'adalovelace',
        profileUrn: 'ACoAA0106FIXTURE',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });

      expect(res.ok).toBe(true);
      expect(capturedPayload).toBeDefined();
      expect(capturedHeaders['x-custom-withdraw-header']).toBe('withdraw-test-val');

      const reqArgs = capturedPayload.requestedArguments;
      expect(reqArgs.screenId).toBe('CustomWithdrawDialogScreen');
      expect(reqArgs.requestedStateKeys).toEqual([
        { key: { value: { $case: 'id', id: 'customSentCountKey' } }, namespace: '' },
      ]);
      expect(reqArgs.payload.queryName).toBe('CustomWithdrawQueryRefresh');
      expect(reqArgs.payload.customWithdrawFlag).toBe(true);
      expect(reqArgs.payload.trackingCode).toBe('TEST_WITHDRAW_123');
    });

    it('skips API layer and executes DOM fallback directly when mode is dom_first', async () => {
      vi.spyOn(endpoints, 'getEndpointConfig').mockReturnValue({
        url: '/flagship-web/rsc-action/actions/server-request?sduiid=brokenWithdraw',
        mode: 'dom_first',
        meta: {},
      });

      const fetchSpy = vi.spyOn(core, 'voyagerFetch');
      const origTabs = chrome.tabs;
      const origScripting = chrome.scripting;

      chrome.tabs = {
        create: vi.fn().mockResolvedValue({ id: 99 }),
        remove: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue({ id: 99, status: 'complete' }),
        query: vi.fn().mockResolvedValue([{ id: 1 }]),
        update: vi.fn().mockResolvedValue(true),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      };
      chrome.scripting = {
        executeScript: vi.fn().mockResolvedValue([
          { result: [{ invitationId: '7504239478362759168', success: true }] },
        ]),
      };

      try {
        const res = await voyager.withdrawInvitation('7504239478362759168', {
          publicId: 'adalovelace',
          profileUrn: 'ACoAA0106FIXTURE',
          allowDomFallback: true,
        });

        expect(res.ok).toBe(true);
        expect(res.method).toBe('dom_fallback');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(chrome.tabs.create).toHaveBeenCalled();
        expect(chrome.scripting.executeScript).toHaveBeenCalled();
        expect(chrome.tabs.remove).toHaveBeenCalledWith(99);
      } finally {
        chrome.tabs = origTabs;
        chrome.scripting = origScripting;
      }
    });
  });

  describe('sendInvite', () => {
    it('applies custom screenId, queryName, requestedStateKeys, and extraPayload in SDUI request', async () => {
      vi.spyOn(endpoints, 'getEndpointConfig').mockImplementation((key) => {
        return {
          url: '/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.mynetwork.addaAddConnection',
          mode: 'sdui_first',
          meta: {
            screenId: 'CustomInviteScreenV2',
            queryName: 'CustomInviteQuery',
            requestedStateKeys: [
              { key: { value: { $case: 'id', id: 'stateKeyInvite' } }, namespace: 'ns' },
            ],
            extraPayload: {
              customInviteOption: 'EXPEDITED',
            },
            headers: {
              'x-custom-invite-header': 'invite-test-val',
            },
          },
        };
      });

      let capturedPayload = null;
      let capturedHeaders = null;
      vi.spyOn(core, 'voyagerFetch').mockImplementation(async (url, opts) => {
        capturedPayload = opts?.body;
        capturedHeaders = opts?.headers;
        return { ok: true, status: 200, text: '{"actionStatus":"SUCCESS"}' };
      });

      const res = await voyager.sendInvite({
        publicId: 'adalovelace',
        profileUrn: 'urn:li:member:123456',
        memberId: '123456',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });

      expect(res.ok).toBe(true);
      expect(capturedPayload).toBeDefined();
      expect(capturedHeaders['x-custom-invite-header']).toBe('invite-test-val');

      const reqArgs = capturedPayload.requestedArguments;
      expect(reqArgs.screenId).toBe('CustomInviteScreenV2');
      expect(reqArgs.requestedStateKeys).toEqual([
        { key: { value: { $case: 'id', id: 'stateKeyInvite' } }, namespace: 'ns' },
      ]);
      expect(reqArgs.payload.queryName).toBe('CustomInviteQuery');
      expect(reqArgs.payload.customInviteOption).toBe('EXPEDITED');
    });

    it('skips SDUI / legacy API and runs DOM send directly when mode is dom_first', async () => {
      vi.spyOn(endpoints, 'getEndpointConfig').mockReturnValue({
        url: '/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.mynetwork.addaAddConnection',
        mode: 'dom_first',
        meta: {},
      });

      const fetchSpy = vi.spyOn(core, 'voyagerFetch');
      const origTabs = chrome.tabs;
      const origScripting = chrome.scripting;

      chrome.tabs = {
        create: vi.fn().mockResolvedValue({ id: 55 }),
        remove: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue({ id: 55, status: 'complete' }),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      };
      chrome.scripting = {
        executeScript: vi.fn().mockResolvedValue([{ result: { success: true } }]),
      };

      try {
        const res = await voyager.sendInvite({
          publicId: 'testprospect',
          memberId: '998877',
          note: 'Hello there!',
        });

        expect(res.ok).toBe(true);
        expect(res.method).toBe('dom');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(chrome.tabs.create).toHaveBeenCalled();
        expect(chrome.tabs.remove).toHaveBeenCalledWith(55);
      } finally {
        chrome.tabs = origTabs;
        chrome.scripting = origScripting;
      }
    });
  });

  describe('follow', () => {
    it('applies custom screenId, queryName, requestedStateKeys, and extraPayload in SDUI request', async () => {
      vi.spyOn(endpoints, 'getEndpointConfig').mockReturnValue({
        url: '/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.mynetwork.addaUpdateFollowState',
        mode: 'sdui_first',
        meta: {
          screenId: 'CustomFollowDialog',
          queryName: 'CustomFollowQuery',
          requestedStateKeys: [
            { key: { value: { $case: 'id', id: 'stateKeyFollow' } }, namespace: '' },
          ],
          extraPayload: {
            followSource: 'FEED_CUSTOM',
          },
          headers: {
            'x-custom-follow-header': 'follow-test-val',
          },
        },
      });

      let capturedPayload = null;
      let capturedHeaders = null;
      vi.spyOn(core, 'voyagerFetch').mockImplementation(async (url, opts) => {
        capturedPayload = opts?.body;
        capturedHeaders = opts?.headers;
        return { ok: true, status: 200, text: '{"actionStatus":"SUCCESS"}' };
      });

      const res = await voyager.follow({
        memberId: '123456',
        publicId: 'testuser',
        following: true,
      });

      expect(res.ok).toBe(true);
      expect(capturedPayload).toBeDefined();
      expect(capturedHeaders['x-custom-follow-header']).toBe('follow-test-val');

      const reqArgs = capturedPayload.requestedArguments;
      expect(reqArgs.screenId).toBe('CustomFollowDialog');
      expect(reqArgs.requestedStateKeys).toEqual([
        { key: { value: { $case: 'id', id: 'stateKeyFollow' } }, namespace: '' },
      ]);
      expect(reqArgs.payload.queryName).toBe('CustomFollowQuery');
      expect(reqArgs.payload.followSource).toBe('FEED_CUSTOM');
    });

    it('executes DOM action directly when mode is dom_first', async () => {
      vi.spyOn(endpoints, 'getEndpointConfig').mockReturnValue({
        url: '/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.requests.mynetwork.addaUpdateFollowState',
        mode: 'dom_first',
        meta: {},
      });

      const fetchSpy = vi.spyOn(core, 'voyagerFetch');
      const origTabs = chrome.tabs;
      const origScripting = chrome.scripting;

      chrome.tabs = {
        create: vi.fn().mockResolvedValue({ id: 77 }),
        remove: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue({ id: 77, status: 'complete' }),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      };
      chrome.scripting = {
        executeScript: vi.fn().mockResolvedValue([{ result: { success: true } }]),
      };

      try {
        const res = await voyager.follow({
          memberId: '123456',
          publicId: 'targetprospect',
          following: true,
        });

        expect(res.ok).toBe(true);
        expect(res.method).toBe('dom');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(chrome.tabs.create).toHaveBeenCalled();
        expect(chrome.tabs.remove).toHaveBeenCalledWith(77);
      } finally {
        chrome.tabs = origTabs;
        chrome.scripting = origScripting;
      }
    });
  });

  describe('likePost', () => {
    it('applies custom screenId, queryName, requestedStateKeys, and extraPayload in SDUI request', async () => {
      vi.spyOn(endpoints, 'getEndpointConfig').mockReturnValue({
        url: '/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.reactions.create',
        mode: 'sdui_first',
        meta: {
          screenId: 'CustomLikeProfileScreen',
          queryName: 'CustomReactionsRefresh',
          requestedStateKeys: [
            { key: { value: { $case: 'id', id: 'stateKeyLike' } }, namespace: '' },
          ],
          extraPayload: {
            customReactionOption: 'CELEBRATE',
          },
          headers: {
            'x-custom-like-header': 'like-test-val',
          },
        },
      });

      let capturedPayload = null;
      let capturedHeaders = null;
      vi.spyOn(core, 'voyagerFetch').mockImplementation(async (url, opts) => {
        capturedPayload = opts?.body;
        capturedHeaders = opts?.headers;
        return { ok: true, status: 200, text: '{"actionStatus":"SUCCESS"}' };
      });

      const res = await voyager.likePost({
        postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/',
      });

      expect(res.ok).toBe(true);
      expect(capturedPayload).toBeDefined();
      expect(capturedHeaders['x-custom-like-header']).toBe('like-test-val');

      const reqArgs = capturedPayload.requestedArguments;
      expect(reqArgs.screenId).toBe('CustomLikeProfileScreen');
      expect(reqArgs.requestedStateKeys).toEqual([
        { key: { value: { $case: 'id', id: 'stateKeyLike' } }, namespace: '' },
      ]);
      expect(reqArgs.payload.queryName).toBe('CustomReactionsRefresh');
      expect(reqArgs.payload.customReactionOption).toBe('CELEBRATE');
    });

    it('executes DOM action directly when mode is dom_first', async () => {
      vi.spyOn(endpoints, 'getEndpointConfig').mockReturnValue({
        url: '/flagship-web/rsc-action/actions/server-request?sduiid=com.linkedin.sdui.reactions.create',
        mode: 'dom_first',
        meta: {},
      });

      const fetchSpy = vi.spyOn(core, 'voyagerFetch');
      const origTabs = chrome.tabs;
      const origScripting = chrome.scripting;

      chrome.tabs = {
        create: vi.fn().mockResolvedValue({ id: 66 }),
        remove: vi.fn().mockResolvedValue(true),
        get: vi.fn().mockResolvedValue({ id: 66, status: 'complete' }),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      };
      chrome.scripting = {
        executeScript: vi.fn().mockResolvedValue([{ result: { success: true } }]),
      };

      try {
        const res = await voyager.likePost({
          postUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/',
        });

        expect(res.ok).toBe(true);
        expect(res.method).toBe('dom');
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(chrome.tabs.create).toHaveBeenCalled();
        expect(chrome.tabs.remove).toHaveBeenCalledWith(66);
      } finally {
        chrome.tabs = origTabs;
        chrome.scripting = origScripting;
      }
    });
  });
});
