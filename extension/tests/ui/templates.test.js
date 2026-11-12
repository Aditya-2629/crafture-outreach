/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderTemplatesView } from '../../src/dashboard/templates-view.js';
import { ACTIONS } from '../../src/lib/actions.js';
import { stubEngine, flush, mountPoint } from './helpers.js';

describe('TemplatesView — Objections Playbook', () => {
  let toasts = [];
  const ctx = {
    showToast: (msg, type) => toasts.push({ msg, type }),
  };

  beforeEach(() => {
    toasts = [];
    document.body.innerHTML = '';
  });

  it('switches to Objections category and handles full CRUD, resume save, and test matcher', async () => {
    let mockObjections = [
      {
        id: 'obj_1',
        tag: 'TECH_STACK',
        title: 'Tech Stack Questions',
        trigger: 'python, sql',
        baseAnswer: 'I have 5 years with Python and SQL.',
      },
    ];

    let mockCandidate = {
      id: 'cand_1',
      name: 'Aditya',
      resumeUrl: 'https://drive.google.com/old-resume',
      bookingLink: 'https://calendly.com/aditya',
    };

    const engine = stubEngine({
      [ACTIONS.OBJECTIONS_GET]: () => ({ objections: [...mockObjections] }),
      [ACTIONS.CANDIDATES_GET]: () => ({ active: mockCandidate }),
      [ACTIONS.OBJECTION_SAVE]: ({ objection }) => {
        const saved = { ...objection, id: objection.id || 'obj_new_123' };
        const idx = mockObjections.findIndex((o) => o.id === saved.id);
        if (idx !== -1) mockObjections[idx] = saved;
        else mockObjections.unshift(saved);
        return { saved };
      },
      [ACTIONS.OBJECTION_DELETE]: ({ id }) => {
        mockObjections = mockObjections.filter((o) => o.id !== id);
        return { success: true };
      },
      [ACTIONS.CANDIDATE_SAVE]: ({ candidate }) => {
        mockCandidate = { ...candidate };
        return { saved: mockCandidate };
      },
      [ACTIONS.OBJECTION_MATCH_REPLY]: ({ message, fullName, company }) => ({
        matchedId: 'obj_1',
        tag: 'TECH_STACK',
        title: 'Tech Stack Questions',
        confidence: 0.92,
        personalizedReply: `Hi ${fullName || 'there'}, at ${company || 'your firm'}, I use Python and SQL every day.`,
      }),
    });

    const host = mountPoint();
    await renderTemplatesView(host, ctx);
    await flush();

    // 1. Switch to Objections category
    const objectionsNavBtn = host.querySelector('button[data-cat="objections"]');
    expect(objectionsNavBtn).not.toBeNull();
    objectionsNavBtn.click();
    await flush();

    expect(host.textContent).toContain('Objections Playbook');
    expect(host.textContent).toContain('Tech Stack Questions');
    expect(host.querySelector('.btn-edit-objection')).not.toBeNull();
    expect(host.querySelector('.btn-del-objection')).not.toBeNull();

    // 2. Test Resume URL Save (#btn-save-playbook-resume)
    const resumeInput = host.querySelector('#input-playbook-resume-url');
    expect(resumeInput).not.toBeNull();
    expect(resumeInput.value).toBe('https://drive.google.com/old-resume');
    resumeInput.value = 'https://drive.google.com/new-resume-v2';

    const saveResumeBtn = host.querySelector('#btn-save-playbook-resume');
    saveResumeBtn.click();
    await flush();

    expect(engine.countOf(ACTIONS.CANDIDATE_SAVE)).toBe(1);
    expect(engine.paramsFor(ACTIONS.CANDIDATE_SAVE).candidate.resumeUrl).toBe(
      'https://drive.google.com/new-resume-v2',
    );
    expect(toasts.some((t) => t.msg.includes('resume URL saved'))).toBe(true);

    // 3. Test Live AI Objection Matcher (#btn-run-objection-test)
    const testInput = host.querySelector('#input-test-objection-msg');
    const testBtn = host.querySelector('#btn-run-objection-test');
    const resultEl = host.querySelector('#objection-test-result');

    testInput.value = 'Do you have Python experience?';
    testBtn.click();
    await flush();

    expect(engine.countOf(ACTIONS.OBJECTION_MATCH_REPLY)).toBe(1);
    expect(engine.paramsFor(ACTIONS.OBJECTION_MATCH_REPLY).message).toBe(
      'Do you have Python experience?',
    );
    expect(resultEl.style.display).toBe('block');
    expect(resultEl.textContent).toContain('TECH_STACK');
    expect(resultEl.textContent).toContain('92% match');
    expect(resultEl.textContent).toContain('Sarah');
    expect(resultEl.textContent).toContain('Google');
    expect(resultEl.textContent).toContain('I use Python and SQL every day.');

    // 4. Test Add Objection Rule (#btn-create-objection-main)
    const addRuleBtn = host.querySelector('#btn-create-objection-main');
    addRuleBtn.click();
    await flush();

    const addModal = document.getElementById('modal-edit-objection-backdrop');
    expect(addModal).not.toBeNull();
    addModal.querySelector('#input-obj-tag').value = 'SALARY';
    addModal.querySelector('#input-obj-title').value = 'Salary Expectations';
    addModal.querySelector('#input-obj-trigger').value = 'salary, comp, rate';
    addModal.querySelector('#textarea-obj-answer').value = 'My rate is flexible.';

    addModal.querySelector('#btn-save-obj-modal').click();
    await flush();

    expect(engine.countOf(ACTIONS.OBJECTION_SAVE)).toBe(1);
    expect(document.getElementById('modal-edit-objection-backdrop')).toBeNull();
    expect(host.textContent).toContain('Salary Expectations');

    // 5. Test Edit Objection Rule (.btn-edit-objection)
    const editBtns = host.querySelectorAll('.btn-edit-objection');
    expect(editBtns.length).toBeGreaterThanOrEqual(1);
    editBtns[0].click();
    await flush();

    const editModal = document.getElementById('modal-edit-objection-backdrop');
    expect(editModal).not.toBeNull();
    editModal.querySelector('#input-obj-title').value = 'Salary Expectations (Updated)';
    editModal.querySelector('#btn-save-obj-modal').click();
    await flush();

    expect(engine.countOf(ACTIONS.OBJECTION_SAVE)).toBe(2);
    expect(host.textContent).toContain('Salary Expectations (Updated)');

    // 6. Test Delete Objection Rule (.btn-del-objection)
    const delBtns = host.querySelectorAll('.btn-del-objection');
    expect(delBtns.length).toBeGreaterThanOrEqual(1);
    delBtns[0].click();
    await flush();

    // Confirm modal should appear
    const confirmModal = document.getElementById('waalaxy-modal-backdrop');
    expect(confirmModal).not.toBeNull();
    confirmModal.querySelector('#modal-btn-confirm').click();
    await flush();

    expect(engine.countOf(ACTIONS.OBJECTION_DELETE)).toBe(1);
  });
});
