/**
 * OutFox — shared UI building blocks.
 *
 * Every button that talks to the engine goes through `busyButton`, so every
 * action in the popup gets the same spinner, the same disabled-while-running
 * behaviour and the same inline error line.
 */

import { el, render, fmtNumber } from './dom.js';
import { ApiError } from './api.js';

/* ================================================================== */
/*  Layout                                                            */
/* ================================================================== */

/** A titled card. `opts.actions` renders on the right of the header. */
export function card(title, opts, ...children) {
  let options = opts;
  let kids = children;
  if (options && (typeof options.nodeType === 'number' || typeof options !== 'object')) {
    kids = [options, ...children];
    options = {};
  }
  options = options || {};
  return el(
    'section',
    { class: `card${options.class ? ` ${options.class}` : ''}` },
    title
      ? el(
          'header',
          { class: 'card-head' },
          el('h2', { class: 'card-title' }, title),
          options.actions ? el('div', { class: 'card-actions' }, options.actions) : null,
        )
      : null,
    options.hint ? el('p', { class: 'hint' }, options.hint) : null,
    el('div', { class: 'card-body' }, kids),
  );
}

/** Label + control + optional hint. */
export function field(label, control, hint) {
  const id = control && control.id ? control.id : null;
  return el(
    'label',
    { class: 'field' },
    el('span', { class: 'field-label' }, label),
    control,
    hint ? el('span', { class: 'hint' }, hint) : null,
    id ? null : null,
  );
}

/** Horizontal row of controls. */
export function row(...children) {
  return el('div', { class: 'row' }, children);
}

/** A small coloured badge. tone: neutral | good | warn | bad | info */
export function pill(text, tone = 'neutral') {
  return el('span', { class: `pill pill--${tone}` }, text);
}

/** Label/value pair for compact stat strips. */
export function stat(label, value, tone) {
  return el(
    'div',
    { class: `stat${tone ? ` stat--${tone}` : ''}` },
    el('div', { class: 'stat-value' }, value),
    el('div', { class: 'stat-label' }, label),
  );
}

/* ================================================================== */
/*  Inputs                                                            */
/* ================================================================== */

export function input(attrs = {}) {
  return el('input', { type: 'text', class: 'input', ...attrs });
}

export function textarea(attrs = {}) {
  return el('textarea', { class: 'input textarea', rows: 3, ...attrs });
}

/**
 * A select built from `[{ value, label }]` or plain strings.
 * @returns {HTMLSelectElement}
 */
export function select(options, attrs = {}) {
  const node = el('select', { class: 'input select', ...attrs });
  for (const opt of options || []) {
    const value = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    node.appendChild(el('option', { value }, label));
  }
  if (attrs.value !== undefined && attrs.value !== null) node.value = String(attrs.value);
  return node;
}

export function checkbox(label, attrs = {}) {
  const box = el('input', { type: 'checkbox', ...attrs });
  const node = el('label', { class: 'check' }, box, el('span', null, label));
  node.input = box;
  return node;
}

/* ================================================================== */
/*  Errors, empty states, progress                                    */
/* ================================================================== */

/** A hidden-until-needed inline error row with `.show(err)` / `.hide()`. */
export function errorLine() {
  const node = el('p', { class: 'err', hidden: true });
  node.show = (error) => {
    const message =
      error instanceof ApiError
        ? error.display
        : error && error.message
          ? error.message
          : String(error || 'Something went wrong');
    node.textContent = message;
    node.hidden = false;
  };
  node.hide = () => {
    node.textContent = '';
    node.hidden = true;
  };
  return node;
}

/** A status line used for progress text. `.set(text)` / `.clear()`. */
export function statusLine(initial = '') {
  const node = el('p', { class: 'status', hidden: !initial }, initial);
  node.set = (text) => {
    node.textContent = text || '';
    node.hidden = !text;
  };
  node.clear = () => node.set('');
  return node;
}

/** Determinate progress bar. `.set(done, total)`. */
export function progressBar() {
  const fill = el('div', { class: 'progress-fill' });
  const node = el('div', { class: 'progress', hidden: true }, fill);
  node.set = (done, total) => {
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    fill.style.width = `${pct}%`;
    node.hidden = false;
  };
  node.reset = () => {
    fill.style.width = '0%';
    node.hidden = true;
  };
  return node;
}

/** Quota bar: used / cap, turning warn then bad as it fills. */
export function quotaBar(label, rate = {}) {
  const used = Number(rate.dailyUsed) || 0;
  const cap = Number(rate.dailyCap) || 0;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const tone = pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'good';
  return el(
    'div',
    { class: 'quota' },
    el(
      'div',
      { class: 'quota-head' },
      el('span', { class: 'quota-label' }, label),
      el('span', { class: 'quota-count' }, `${fmtNumber(used)} / ${fmtNumber(cap)}`),
    ),
    el(
      'div',
      { class: 'bar' },
      el('div', { class: `bar-fill bar-fill--${tone}`, style: { width: `${pct}%` } }),
    ),
    el(
      'div',
      { class: 'quota-sub' },
      `hour ${fmtNumber(rate.hourlyUsed || 0)} / ${fmtNumber(rate.hourlyCap || 0)}`,
    ),
  );
}

export function empty(text) {
  return el('p', { class: 'empty' }, text);
}

export function spinner() {
  return el('span', { class: 'spinner', 'aria-hidden': 'true' });
}

/* ================================================================== */
/*  Buttons                                                           */
/* ================================================================== */

/**
 * A button that runs an async handler with a spinner, disables itself while
 * running and reports failures on an inline error line.
 *
 * The handler receives `{ status, progress, button }` so long actions can
 * report progress without knowing where they are drawn.
 *
 * @param {string} label
 * @param {(ctx: {status: object, progress: object, button: HTMLButtonElement}) => Promise<*>} handler
 * @param {{ variant?: string, error?: object, status?: object, progress?: object,
 *           title?: string, ariaLabel?: string, disabled?: boolean, onDone?: Function }} [opts]
 * @returns {HTMLButtonElement}
 */
export function busyButton(label, handler, opts = {}) {
  const variant = opts.variant || 'primary';
  const button = el('button', {
    type: 'button',
    class: `btn btn--${variant}`,
    title: opts.title || null,
    'aria-label': opts.ariaLabel || null,
    disabled: Boolean(opts.disabled),
  });

  const paint = (busy) => {
    render(button, [busy ? spinner() : null, el('span', { class: 'btn-label' }, label)]);
  };
  paint(false);

  button.addEventListener('click', async () => {
    if (button.disabled) return;
    if (opts.error) opts.error.hide();
    button.disabled = true;
    button.classList.add('is-busy');
    paint(true);
    try {
      const result = await handler({
        status: opts.status || null,
        progress: opts.progress || null,
        button,
      });
      if (opts.onDone) await opts.onDone(result);
    } catch (e) {
      if (opts.error) opts.error.show(e);
      else console.error('[OutFox]', e);
    } finally {
      button.disabled = Boolean(opts.disabled);
      button.classList.remove('is-busy');
      paint(false);
    }
  });

  return button;
}

/**
 * Make a non-button element behave like one: focusable, announced as a button,
 * and activated by Enter or Space as well as by a click.
 *
 * Used where the clickable thing cannot be a real `<button>` — a drop target,
 * or a row that contains flow content a `<button>` may not hold.
 *
 * @param {HTMLElement} node
 * @param {(event: Event) => void} handler
 * @param {{ label?: string }} [opts]
 * @returns {HTMLElement} node
 */
export function activatable(node, handler, opts = {}) {
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  if (opts.label) node.setAttribute('aria-label', opts.label);
  node.addEventListener('click', handler);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      handler(event);
    }
  });
  return node;
}

/** A plain (non-async) button. */
export function button(label, onClick, opts = {}) {
  return el(
    'button',
    {
      type: 'button',
      class: `btn btn--${opts.variant || 'ghost'}`,
      title: opts.title || null,
      disabled: Boolean(opts.disabled),
      onclick: onClick,
    },
    el('span', { class: 'btn-label' }, label),
  );
}

/* ================================================================== */
/*  Confirmation dialog                                               */
/* ================================================================== */

/**
 * In-page confirmation. `window.confirm` is unavailable in some extension
 * surfaces and impossible to assert on, so this draws its own modal.
 *
 * @param {{ title: string, message: string, confirmLabel?: string,
 *           cancelLabel?: string, danger?: boolean, typeToConfirm?: string,
 *           host?: HTMLElement }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts = {}) {
  const host = opts.host || document.body;
  return new Promise((resolve) => {
    let confirmBtn;
    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };

    const typed = opts.typeToConfirm
      ? input({
          class: 'input',
          placeholder: opts.typeToConfirm,
          'data-testid': 'confirm-typed',
          oninput: () => {
            confirmBtn.disabled = typed.value.trim() !== opts.typeToConfirm;
          },
        })
      : null;

    confirmBtn = el(
      'button',
      {
        type: 'button',
        class: `btn btn--${opts.danger ? 'danger' : 'primary'}`,
        'data-testid': 'confirm-ok',
        disabled: Boolean(opts.typeToConfirm),
        onclick: () => close(true),
      },
      opts.confirmLabel || 'Confirm',
    );

    const backdrop = el(
      'div',
      { class: 'modal-backdrop', 'data-testid': 'confirm-dialog' },
      el(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        el('h3', { class: 'modal-title' }, opts.title || 'Are you sure?'),
        opts.message ? el('p', { class: 'modal-body' }, opts.message) : null,
        typed
          ? el(
              'p',
              { class: 'modal-body' },
              `Type ${opts.typeToConfirm} to confirm.`,
              el('span', null, ' '),
              typed,
            )
          : null,
        el(
          'div',
          { class: 'modal-actions' },
          el(
            'button',
            {
              type: 'button',
              class: 'btn btn--ghost',
              'data-testid': 'confirm-cancel',
              onclick: () => close(false),
            },
            opts.cancelLabel || 'Cancel',
          ),
          confirmBtn,
        ),
      ),
    );

    host.appendChild(backdrop);
    confirmBtn.focus();
  });
}

/**
 * Write text to clipboard, falling back to a temporary textarea if the Clipboard API is unavailable.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback to execCommand */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const successful = document.execCommand('copy');
    ta.remove();
    return successful;
  } catch {
    return false;
  }
}

export const DEFAULT_SHEET_APPS_SCRIPT = `function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Timestamp", "Full Name", "Headline", "Company", "Profile URL", "Status", "Campaign", "Event"]);
      sheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#E8F0FE");
      sheet.setFrozenRows(1);
    }
    var data = JSON.parse(e.postData.contents);
    var timestamp = Utilities.formatDate(new Date(), "GMT", "yyyy-MM-dd HH:mm:ss");
    var row = [
      timestamp,
      data.fullName || data.publicId || "",
      data.headline || "",
      data.company || "",
      data.url || (data.publicId ? "https://www.linkedin.com/in/" + data.publicId : ""),
      data.status || "",
      data.campaignName || "",
      data.event || ""
    ];
    sheet.appendRow(row);
    return ContentService.createTextOutput(JSON.stringify({ result: "success" })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ result: "error", error: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}`;

/**
 * Interactive Guide Modal displaying 1-click step-by-step instructions
 * and a prominent button to copy the Apps Script code.
 *
 * @param {{ title?: string, steps?: HTMLElement[], codeToCopy?: string,
 *           onClose?: Function, host?: HTMLElement }} [opts]
 */
export function guideModal(opts = {}) {
  const host = opts.host || document.body;
  const title = opts.title || 'Google Sheets CRM Setup (1-Click Guide)';
  const code = opts.codeToCopy || DEFAULT_SHEET_APPS_SCRIPT;

  let backdrop;
  const close = () => {
    if (backdrop) backdrop.remove();
    if (opts.onClose) opts.onClose();
  };

  const copyBtn = button(
    'Copy Ready-to-Use Script',
    async () => {
      const success = await copyToClipboard(code);
      const label = copyBtn.querySelector('.btn-label') || copyBtn;
      const originalText = 'Copy Ready-to-Use Script';
      if (success) {
        label.textContent = 'Copied to Clipboard!';
        copyBtn.style.backgroundColor = '#057642';
        copyBtn.style.color = '#ffffff';
        setTimeout(() => {
          label.textContent = originalText;
        }, 2500);
      } else {
        label.textContent = 'Could not copy automatically';
        setTimeout(() => {
          label.textContent = originalText;
        }, 2500);
      }
    },
    { variant: 'primary' },
  );

  copyBtn.style.backgroundColor = '#057642';
  copyBtn.style.color = '#ffffff';
  copyBtn.style.fontWeight = '600';
  copyBtn.style.margin = '4px 0';

  const defaultStepNodes = [
    el(
      'li',
      { style: 'margin-bottom: 8px;' },
      el('strong', null, 'Step 1: '),
      'Open ',
      el(
        'a',
        {
          href: 'https://sheets.new',
          target: '_blank',
          rel: 'noopener noreferrer',
          style: 'color: #0A66C2; font-weight: 600; text-decoration: underline;',
        },
        'https://sheets.new',
      ),
      ' in your browser to create a new spreadsheet.',
    ),
    el(
      'li',
      { style: 'margin-bottom: 8px;' },
      el('strong', null, 'Step 2: '),
      'In the top menu, go to ',
      el('strong', null, 'Extensions ➔ Apps Script'),
      '.',
    ),
    el(
      'li',
      { style: 'margin-bottom: 8px;' },
      el('strong', null, 'Step 3: '),
      'Delete any default code in Code.gs and click below:',
      el('div', { style: 'margin-top: 4px;' }, copyBtn),
    ),
    el(
      'li',
      { style: 'margin-bottom: 8px;' },
      el('strong', null, 'Step 4: '),
      'Click ',
      el('strong', null, 'Deploy ➔ New deployment'),
      '. Select type: ',
      el('strong', null, 'Web app'),
      ', set ',
      el('strong', null, 'Who has access: Anyone'),
      ', and click ',
      el('strong', null, 'Deploy'),
      ' to get your Web App URL.',
    ),
    el(
      'li',
      { style: 'margin-bottom: 4px;' },
      el('strong', null, 'Step 5: '),
      'Paste the Web App URL and your Sheet Link into the campaign builder.',
    ),
  ];

  const stepsList = el(
    'ol',
    { style: 'padding-left: 18px; margin: 0; font-size: 12px; line-height: 1.45;' },
    opts.steps || defaultStepNodes,
  );

  backdrop = el(
    'div',
    { class: 'modal-backdrop', 'data-testid': 'guide-modal' },
    el(
      'div',
      {
        class: 'modal',
        role: 'dialog',
        'aria-modal': 'true',
        style: 'max-width: 340px; max-height: 520px; overflow-y: auto;',
      },
      el('h3', { class: 'modal-title' }, title),
      el('div', { class: 'modal-body' }, stepsList),
      el(
        'div',
        { class: 'modal-actions', style: 'margin-top: 10px;' },
        button('Got it', () => close(), { variant: 'primary' }),
      ),
    ),
  );

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const onKey = (e) => {
    if (e.key === 'Escape') {
      window.removeEventListener('keydown', onKey);
      close();
    }
  };
  window.addEventListener('keydown', onKey);

  host.appendChild(backdrop);
  return { close, backdrop };
}
