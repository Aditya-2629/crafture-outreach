// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { domWithdrawInPage } from '../../src/background/voyager.js';

describe('domWithdrawInPage in-page automation', { timeout: 15000 }, () => {
  it('matches cards by publicId and fullName, clicks withdraw and confirms modal', async () => {
    document.title = 'Manage Invitations | LinkedIn';
    document.body.innerHTML = `
      <ul class="mn-invitation-list">
        <li class="invitation-card">
          <a href="/in/ada-lovelace">Ada Lovelace</a>
          <span>Sent 2 weeks ago</span>
          <button id="withdraw-ada">Withdraw</button>
        </li>
      </ul>
      <div id="modal-container"></div>
    `;

    const adaBtn = document.getElementById('withdraw-ada');
    adaBtn.addEventListener('click', () => {
      const modal = document.createElement('div');
      modal.setAttribute('role', 'dialog');
      modal.innerHTML = '<button class="confirm-withdraw">Withdraw</button>';
      document.getElementById('modal-container').appendChild(modal);
    });

    const targets = [
      { invitationId: '101', vanityName: 'ada-lovelace', firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace' },
    ];

    const result = await domWithdrawInPage(targets);

    expect(result.initialWithdrawButtons).toBe(1);
    expect(result.pageTitle).toBe('Manage Invitations | LinkedIn');
    expect(result.matchedInDom).toBe(1);
    expect(result.results).toHaveLength(1);
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].method).toBe('dom_fallback');
  });

  it('clicks "Load more" button when targets are initially missing from DOM', async () => {
    document.title = 'Manage Invitations | LinkedIn';
    document.body.innerHTML = `
      <ul class="mn-invitation-list">
        <li class="invitation-card">
          <a href="/in/person-one">Person One</a>
          <span>Sent 1 day ago</span>
          <button>Withdraw</button>
        </li>
      </ul>
      <button class="scaffold-finite-scroll__load-button" id="load-more-btn">Load more</button>
      <div id="modal-container"></div>
    `;

    const loadMoreBtn = document.getElementById('load-more-btn');
    loadMoreBtn.addEventListener('click', () => {
      const list = document.querySelector('.mn-invitation-list');
      const newCard = document.createElement('li');
      newCard.className = 'invitation-card';
      newCard.innerHTML = `
        <a href="/in/target-person">Target Person</a>
        <span>Sent 3 weeks ago</span>
        <button id="withdraw-target">Withdraw</button>
      `;
      list.appendChild(newCard);
      // Remove load more after clicking
      loadMoreBtn.remove();
    });

    const targets = [
      { invitationId: '202', vanityName: 'target-person', firstName: 'Target', lastName: 'Person', fullName: 'Target Person' },
    ];

    const result = await domWithdrawInPage(targets);

    expect(result.loadMoreClicks).toBe(1);
    expect(result.matchedInDom).toBe(1);
    expect(result.results[0].success).toBe(true);
  });

  it('executes Relative-Date Card Fallback when 0 targets match by ID or name', async () => {
    document.title = 'Sent Invitations | LinkedIn';
    document.body.innerHTML = `
      <ul class="mn-invitation-list">
        <li class="invitation-card">
          <a href="/in/fresh-lead">Fresh Lead</a>
          <span>Sent 5 days ago</span>
          <button>Withdraw</button>
        </li>
        <li class="invitation-card">
          <a href="/in/stale-lead-1">Stale Lead 1</a>
          <span>Sent 3 weeks ago</span>
          <button id="withdraw-stale-1">Withdraw</button>
        </li>
        <li class="invitation-card">
          <a href="/in/stale-lead-2">Stale Lead 2</a>
          <span>Sent 2 months ago</span>
          <button id="withdraw-stale-2">Withdraw</button>
        </li>
      </ul>
      <div id="modal-container"></div>
    `;

    const staleBtn1 = document.getElementById('withdraw-stale-1');
    staleBtn1.addEventListener('click', () => {
      const modal = document.createElement('div');
      modal.className = 'artdeco-modal';
      modal.innerHTML = '<button class="artdeco-button--primary">Withdraw</button>';
      document.getElementById('modal-container').appendChild(modal);
    });

    // Target does not match any card in DOM
    const targets = [
      { invitationId: 'unmatched_target_999', vanityName: 'nonexistent', fullName: 'Nonexistent Prospect' },
    ];

    const result = await domWithdrawInPage(targets, { olderThanDays: 14, maxCount: 1 });

    expect(result.initialWithdrawButtons).toBe(3);
    expect(result.pageTitle).toBe('Sent Invitations | LinkedIn');
    expect(result.matchedInDom).toBe(1);
    expect(result.results.filter((r) => r.success)).toHaveLength(1);
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].method).toBe('dom_fallback');
  });

  it('clicks "Sent" tab when present and not selected, and matches broadened button/anchor selectors with aria-label', async () => {
    document.title = 'Manage Invitations | LinkedIn';
    document.body.innerHTML = `
      <div class="tabs">
        <a href="/invitation-manager/sent" role="tab" id="sent-tab" class="unselected">Sent</a>
      </div>
      <ul class="mn-invitation-list">
        <!-- populated dynamically when Sent tab is clicked -->
      </ul>
      <div id="modal-container"></div>
    `;

    const sentTab = document.getElementById('sent-tab');
    sentTab.addEventListener('click', () => {
      sentTab.setAttribute('aria-selected', 'true');
      const list = document.querySelector('.mn-invitation-list');
      const item = document.createElement('li');
      item.className = 'invitation-card';
      // Use an anchor with aria-label containing withdraw to test broadened selector
      item.innerHTML = `
        <a href="/in/grace-hopper">Grace Hopper</a>
        <span>Sent 3 weeks ago</span>
        <a role="button" id="withdraw-grace" aria-label="Withdraw invitation to Grace Hopper">Withdraw</a>
      `;
      list.appendChild(item);
    });

    const targets = [
      { invitationId: '303', vanityName: 'grace-hopper', fullName: 'Grace Hopper' },
    ];

    const result = await domWithdrawInPage(targets, { olderThanDays: 14, maxCount: 1 });

    expect(sentTab.getAttribute('aria-selected')).toBe('true');
    expect(result.initialWithdrawButtons).toBe(1);
    expect(result.matchedInDom).toBe(1);
    expect(result.results[0].success).toBe(true);
  });

  it('records exact DOM diagnostics when initialWithdrawButtons is 0', async () => {
    document.title = 'Empty Page | LinkedIn';
    document.body.innerHTML = `
      <div class="content">No invitations found here.</div>
      <button>Filter</button>
      <button role="button">Search</button>
    `;

    const targets = [{ invitationId: '999', vanityName: 'none' }];
    // Call domWithdrawInPage with short wait
    const result = await domWithdrawInPage(targets, { olderThanDays: 14, maxCount: 1, maxWaitMs: 600 });

    expect(result.initialWithdrawButtons).toBe(0);
    expect(result.domDiagnostics).toContain('url=');
    expect(result.domDiagnostics).toContain('bodySample=');
    expect(result.domDiagnostics).toContain('buttons=');
    expect(result.domDiagnostics).toContain('Filter');
    expect(result.domDiagnostics).toContain('Search');
  });
});
