/**
 * OutFox — Authentic Waalaxy Settings View
 * Production Settings UI: 4 Core Tabs, Dynamic Timezone Engine & Real Integrations Hub
 * 100% Manifest V3 CSP Compliant · Zero Core Emojis · Vector SVGs · Native in-UI Modals
 */

import { call } from '../ui/api.js';
import { ACTIONS } from '../lib/actions.js';
import { ICONS } from '../ui/icons.js';
import { openUiConfirm, openUiAlert, openUiPrompt } from './modal-engine.js';
import { openSheetCrmGuide } from './guide-modal.js';

let activeSettingsTab = 'activity';
let liveClockInterval = null;

const TIMEZONE_NAMES = {
  'Asia/Kolkata': 'IST',
  'UTC': 'UTC',
  'America/New_York': 'EST',
  'America/Los_Angeles': 'PST',
  'America/Chicago': 'CST',
  'Europe/Paris': 'CET',
  'Europe/London': 'GMT',
  'Asia/Dubai': 'GST',
  'Asia/Singapore': 'SGT',
  'Asia/Tokyo': 'JST',
  'Australia/Sydney': 'AEST',
};

export function getTzDetails(tz = 'Asia/Kolkata') {
  try {
    const now = new Date();
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'long',
    });
    const parts = dtf.formatToParts(now);
    let hour = 0;
    let minute = 0;
    let weekday = '';
    for (const part of parts) {
      if (part.type === 'hour') hour = parseInt(part.value, 10);
      else if (part.type === 'minute') minute = parseInt(part.value, 10);
      else if (part.type === 'weekday') weekday = part.value.toUpperCase();
    }
    if (hour === 24) hour = 0;
    const mins = hour * 60 + minute;

    const dtf12 = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    });
    const timeStr = dtf12.format(now);
    const tzDisplayName = TIMEZONE_NAMES[tz] || tz.split('/').pop().replace(/_/g, ' ');

    return {
      hour,
      minute,
      mins,
      weekday,
      timeStr,
      tzDisplayName,
    };
  } catch (e) {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const weekday = days[now.getDay()];
    const mins = hour * 60 + minute;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayH = hour % 12 || 12;
    return {
      hour,
      minute,
      mins,
      weekday,
      timeStr: `${displayH}:${String(minute).padStart(2, '0')} ${ampm}`,
      tzDisplayName: 'Local',
    };
  }
}

function maskKey(key = '') {
  if (!key) return '••••••••';
  if (key.length <= 8) return '••••••••';
  const prefix = key.slice(0, 4);
  return `${prefix}••••••••`;
}

export async function testAiConnection(provider, modelId, apiKey) {
  const start = Date.now();
  try {
    if (provider === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: modelId || 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: 'Reply "OK"' }],
          max_tokens: 5,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return { success: true, latency: Date.now() - start };
    } else if (provider === 'gemini') {
      const model = modelId || 'gemini-1.5-flash';
      const cleanKey = apiKey.trim();
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: 'Reply "OK"' }] }],
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return { success: true, latency: Date.now() - start };
    } else if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: modelId || 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'Reply "OK"' }],
          max_tokens: 5,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return { success: true, latency: Date.now() - start };
    } else if (provider === 'claude') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelId || 'claude-3-5-haiku-20241022',
          messages: [{ role: 'user', content: 'Reply "OK"' }],
          max_tokens: 5,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }
      return { success: true, latency: Date.now() - start };
    } else if (provider === 'ollama') {
      const host = apiKey.trim() || 'http://localhost:11434';
      const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { success: true, latency: Date.now() - start };
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  } catch (err) {
    return { success: false, error: err.message || 'Connection failed' };
  }
}

function ensureSettingsStyles() {
  const STYLE_ID = 'waalaxy-settings-injected-styles';
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `
    .waalaxy-settings-layout { display: flex; min-height: 100%; background: #f8fafc; font-family: inherit; }
    .settings-subsidebar { width: 240px; min-width: 240px; background: #ffffff; border-right: 1px solid #e2e8f0; padding: 24px 16px; box-sizing: border-box; }
    .subsidebar-header { margin-bottom: 20px; padding: 0 8px; }
    .subsidebar-title { font-size: 18px; font-weight: 800; color: #14142b; margin: 0; }
    .subsidebar-menu { display: flex; flex-direction: column; gap: 6px; }
    .settings-menu-item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 10px 14px; border-radius: 12px; border: 1px solid transparent; background: transparent; font-size: 13px; font-weight: 600; color: #475569; cursor: pointer; transition: all 0.15s ease; text-align: left; box-sizing: border-box; }
    .settings-menu-item:hover { background: #f1f5f9; color: #14142b; }
    .settings-menu-item.is-active { background: #ffffff; border-color: #e2e8f0; color: #2563eb; font-weight: 700; box-shadow: 0 2px 8px rgba(49, 90, 231, 0.08); }
    .menu-icon-circle { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .icon-bg-blue { background: #2563eb; color: #ffffff; }
    .icon-bg-teal { background: #00bfa5; color: #ffffff; }
    .icon-bg-purple { background: #8b5cf6; color: #ffffff; }
    .icon-bg-pink { background: #ec4899; color: #ffffff; }
    .badge-tab-new { font-size: 10px; font-weight: 700; background: #eef2ff; color: #2563eb; padding: 2px 8px; border-radius: 9999px; margin-left: auto; }
    .settings-main-canvas { flex: 1; padding: 32px 40px; overflow-y: auto; box-sizing: border-box; }
    
    .activity-head-row { margin-bottom: 28px; }
    .activity-title-group { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .activity-main-title { font-size: 22px; font-weight: 800; color: #14142b; margin: 0; }
    .activity-sub-text { font-size: 13px; color: #64748b; margin: 6px 0 0 0; }
    .tz-live-clock-badge { display: inline-flex; align-items: center; gap: 6px; background: #eef2ff; color: #2563eb; padding: 4px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; border: 1px solid rgba(49,90,231,0.15); }
    .live-activity-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 9999px; font-size: 11.5px; font-weight: 700; }
    .live-activity-pill.is-running { background: #ecfdf5; color: #059669; }
    .live-activity-pill.is-paused { background: #fef2f2; color: #dc2626; }
    .live-dot-circle { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    
    .settings-block-section { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.02); }
    .settings-section-heading { font-size: 14px; font-weight: 700; color: #14142b; margin: 0 0 14px 0; display: block; }
    .timezone-picker-wrap { max-width: 440px; }
    .waalaxy-select-large { width: 100%; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; font-size: 13.5px; font-weight: 500; color: #14142b; outline: none; cursor: pointer; }
    
    .working-days-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .custom-mode-toggle { display: flex; align-items: center; gap: 10px; }
    .custom-mode-label { font-size: 12.5px; font-weight: 600; color: #64748b; }
    .ios-switch { position: relative; display: inline-block; width: 44px; height: 24px; }
    .ios-switch input { opacity: 0; width: 0; height: 0; }
    .ios-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #cbd5e1; transition: 0.2s; border-radius: 24px; }
    .ios-slider:before { position: absolute; content: ""; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: 0.2s; border-radius: 50%; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
    .ios-switch input:checked + .ios-slider { background-color: #2563eb; }
    .ios-switch input:checked + .ios-slider:before { transform: translateX(20px); }
    
    .days-toggle-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    @media (max-width: 900px) { .days-toggle-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 500px) { .days-toggle-grid { grid-template-columns: 1fr; } }
    .day-toggle-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .day-card-name { font-size: 11px; font-weight: 700; color: #475569; letter-spacing: 0.5px; }
    
    .slider-labels-top { display: flex; justify-content: space-between; font-size: 14px; font-weight: 700; color: #2563eb; margin-bottom: 12px; }
    .dual-range-track-wrap { position: relative; height: 24px; margin: 12px 0; }
    .dual-range-track { position: absolute; top: 8px; left: 0; right: 0; height: 8px; background: #e2e8f0; border-radius: 4px; }
    .dual-range-fill { position: absolute; height: 100%; background: #2563eb; border-radius: 4px; }
    .range-slider-input { position: absolute; top: 0; left: 0; width: 100%; height: 24px; pointer-events: none; -webkit-appearance: none; background: transparent; margin: 0; }
    .range-slider-input::-webkit-slider-thumb { pointer-events: all; width: 22px; height: 22px; border-radius: 50%; background: #ffffff; border: 2.5px solid #2563eb; box-shadow: 0 2px 6px rgba(0,0,0,0.2); cursor: pointer; -webkit-appearance: none; }
    .slider-labels-bottom { display: flex; justify-content: space-between; font-size: 11px; color: #94a3b8; font-weight: 600; margin-top: 6px; }
    
    .quotas-section-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
    .quotas-title-with-info { display: flex; align-items: center; gap: 6px; }
    .quotas-caption { font-size: 12px; color: #64748b; margin: 4px 0 0 0; }
    .btn-restore-defaults { background: #f1f5f9; border: 1px solid #e2e8f0; color: #475569; font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 8px; cursor: pointer; transition: background 0.15s; }
    .btn-restore-defaults:hover { background: #e2e8f0; color: #14142b; }
    .quotas-subheading { font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
    
    .quota-cards-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    @media (max-width: 1000px) { .quota-cards-row { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 550px) { .quota-cards-row { grid-template-columns: 1fr; } }
    .quota-input-card, .quota-edit-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 14px; min-width: 0; display: flex; align-items: center; gap: 12px; }
    .q-card-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .icon-circle-blue { background: #eef2ff; color: #2563eb; }
    .icon-circle-coral { background: #fff1ee; color: #ff7a59; }
    .icon-circle-purple { background: #f5f3ff; color: #8b5cf6; }
    .q-card-content { flex: 1; min-width: 0; }
    .q-card-label { font-size: 10.5px; font-weight: 700; color: #64748b; letter-spacing: 0.5px; display: block; margin-bottom: 6px; }
    .quota-input-group, .q-input-group { display: flex; align-items: center; gap: 8px; }
    .quota-number-input { width: 74px; min-width: 74px; height: 34px; padding: 4px 6px; box-sizing: border-box; font-size: 15px; font-weight: 800; text-align: center; border-radius: 8px; border: 1px solid #cbd5e1; outline: none; background: #ffffff; color: #14142b; }
    .quota-max-label, .q-input-total { font-size: 13px; font-weight: 700; color: #94a3b8; white-space: nowrap; }
    
    .settings-save-bar { margin-top: 24px; display: flex; justify-content: flex-end; }
    .btn-primary-settings { background: #2563eb; color: #ffffff; border: none; border-radius: 10px; padding: 10px 24px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(49, 90, 231, 0.25); transition: background 0.15s; }
    .btn-primary-settings:hover { background: #1d4ed8; }

    .waalaxy-white-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; margin-bottom: 24px; box-shadow: 0 2px 6px rgba(0,0,0,0.02); }
    .card-header-with-icon { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
    .card-black-icon-box { width: 40px; height: 40px; border-radius: 10px; background: #14142b; color: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .card-title-bold { font-size: 16px; font-weight: 800; color: #14142b; margin: 0; }
    .card-subtitle-gray { font-size: 12.5px; color: #64748b; margin: 3px 0 0 0; }
    .email-accounts-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .email-accounts-table th { text-align: left; padding: 10px 14px; font-size: 11px; font-weight: 700; color: #64748b; background: #f8fafc; border-bottom: 1px solid #e2e8f0; letter-spacing: 0.5px; }
    .email-accounts-table td { padding: 14px; font-size: 13px; color: #14142b; border-bottom: 1px solid #f1f5f9; }
    .provider-badge-cell { display: flex; align-items: center; gap: 10px; }
    .provider-logo-mini { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; }
    .provider-name-txt { font-weight: 600; color: #14142b; }
    .email-addr-txt { font-weight: 500; color: #334155; }
    .badge-status-running { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: #ecfdf5; color: #059669; }
    .btn-disconnect-acc { background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 4px; }
    .btn-disconnect-acc:hover { color: #ef4444; background: #fee2e2; }
    .btn-link-add-email { background: transparent; border: none; color: #2563eb; font-size: 13px; font-weight: 700; cursor: pointer; padding: 4px 0; }
    .btn-link-add-email:hover { text-decoration: underline; }

    .signatures-split-view { display: grid; grid-template-columns: 260px 1fr; gap: 24px; margin-top: 10px; }
    .sig-left-pane { display: flex; flex-direction: column; gap: 12px; border-right: 1px solid #f1f5f9; padding-right: 20px; }
    .sig-pane-label { font-size: 12px; font-weight: 600; color: #64748b; }
    .waalaxy-select-small { background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 13px; color: #14142b; outline: none; cursor: pointer; }
    .sig-list-header { display: flex; justify-content: space-between; align-items: center; font-size: 12px; font-weight: 600; color: #14142b; margin-top: 8px; }
    .btn-sig-link { background: transparent; border: none; color: #2563eb; font-size: 12px; font-weight: 700; cursor: pointer; }
    .sig-nav-list { display: flex; flex-direction: column; gap: 6px; }
    .sig-nav-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; cursor: pointer; transition: all 0.12s; }
    .sig-nav-item:hover, .sig-nav-item.is-active { background: #eef2ff; border-color: #2563eb; color: #2563eb; font-weight: 600; }
    .btn-del-sig { background: transparent; border: none; color: #94a3b8; cursor: pointer; font-size: 12px; }
    .btn-del-sig:hover { color: #ef4444; }
    .empty-sig-txt { font-size: 12px; color: #94a3b8; font-style: italic; }

    .sig-right-canvas { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 14px; min-height: 240px; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; }
    .sig-empty-canvas { display: flex; flex-direction: column; align-items: center; text-align: center; }
    .sig-empty-title { font-size: 16px; font-weight: 800; color: #14142b; margin: 0 0 6px 0; }
    .sig-empty-sub { font-size: 13px; color: #64748b; max-width: 320px; line-height: 1.5; margin: 0 0 18px 0; }
    .btn-create-sig-blue { background: #2563eb; color: #ffffff; border: none; padding: 10px 24px; border-radius: 20px; font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(49, 90, 231, 0.25); transition: background 0.15s; }
    .btn-create-sig-blue:hover { background: #1d4ed8; }
    .sig-editor-box { width: 100%; display: flex; flex-direction: column; gap: 8px; }
    .input-text-sig { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; background: #ffffff; }
    .sig-textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; font-family: inherit; resize: vertical; background: #ffffff; }
    .sig-editor-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; }

    .settings-integrations-scroll, .settings-history-scroll { max-width: 960px; }
    .integrations-cards-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
    @media (max-width: 800px) { .integrations-cards-grid { grid-template-columns: 1fr; } }
    .integration-item-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 2px 6px rgba(0,0,0,0.02); transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); position: relative; }
    .integration-item-card:hover { border-color: #c7d2fe; box-shadow: 0 8px 24px rgba(49, 90, 231, 0.08); transform: translateY(-1px); }
    .int-card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .int-card-head-left { display: flex; align-items: center; gap: 12px; }
    .int-logo-ico { width: 38px; height: 38px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; flex-shrink: 0; }
    .int-card-title { font-size: 15px; font-weight: 700; color: #14142b; margin: 0; }
    .int-card-desc { font-size: 12.5px; color: #64748b; line-height: 1.5; margin: 12px 0 20px 0; min-height: 48px; }
    .btn-int-action { background: #ffffff; border: 1.5px solid #2563eb; color: #2563eb; border-radius: 20px; padding: 8px 18px; font-size: 12.5px; font-weight: 600; cursor: pointer; align-self: flex-start; transition: all 0.15s ease; }
    .btn-int-action:hover { background: #eef2ff; }
    .btn-int-active { background: #2563eb; color: #ffffff; border: none; box-shadow: 0 4px 12px rgba(49, 90, 231, 0.25); }
    .btn-int-active:hover { background: #1d4ed8; }

    .history-table-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.02); }
    .import-history-table { width: 100%; border-collapse: collapse; }
    .import-history-table th { text-align: left; padding: 12px 18px; font-size: 11px; font-weight: 700; color: #64748b; background: #f8fafc; border-bottom: 1px solid #e2e8f0; letter-spacing: 0.4px; }
    .import-history-table td { padding: 14px 18px; font-size: 13px; color: #14142b; border-bottom: 1px solid #f1f5f9; }
    .history-date-cell { font-size: 12px; color: #64748b; white-space: nowrap; }
    .history-list-name { font-weight: 600; color: #14142b; }
    .history-success-val { color: #10b981; font-size: 14px; }
    .empty-history-cell { text-align: center; padding: 36px; color: #94a3b8; font-size: 13px; }

    .btn-connect-provider { width: 100%; background: #ffffff; border: 1.5px solid #e2e8f0; border-radius: 12px; padding: 14px 20px; display: flex; align-items: center; justify-content: center; gap: 12px; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 2px 4px rgba(0,0,0,0.02); }
    .btn-connect-provider:hover { border-color: #2563eb; background: #f8fafc; box-shadow: 0 4px 12px rgba(49, 90, 231, 0.1); transform: translateY(-1px); }
  `;
}

export async function renderSettingsView(container, ctx = {}) {
  if (!container) return;
  if (ctx && ctx.tab) {
    activeSettingsTab = ctx.tab;
  }
  ensureSettingsStyles();

  if (liveClockInterval) {
    clearInterval(liveClockInterval);
    liveClockInterval = null;
  }

  container.innerHTML = `
    <div style="display:flex; justify-content:center; align-items:center; height:320px; color:#6e7191;">
      <div style="width:34px; height:34px; border:3px solid #eef1fc; border-top-color:#2563eb; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
    </div>
    <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
  `;

  let config = {};
  let storage = {};

  try {
    const [cRes, sRes] = await Promise.all([
      call(ACTIONS.CONFIG_GET, {}).catch(() => ({})),
      new Promise((r) => chrome.storage.local.get(null, r)),
    ]);
    config = cRes || {};
    storage = sRes || {};
  } catch (e) {
    console.warn('[Settings View] Read error', e);
  }

  const defaultDays = {
    MONDAY: true,
    TUESDAY: true,
    WEDNESDAY: true,
    THURSDAY: true,
    FRIDAY: true,
    SATURDAY: true,
    SUNDAY: true,
  };
  let workingDays = config.workingDays || defaultDays;
  let startMinutes = Number.isInteger(config.startMinutes) ? config.startMinutes : 0;
  let endMinutes = Number.isInteger(config.endMinutes) ? config.endMinutes : 1439;

  let maxInvites = config.dailyInviteCap || 100;
  let maxMessages = config.dailyMessageCap || 150;
  let maxVisits = config.dailyVisitCap || 150;
  let maxFollows = config.dailyFollowCap || 100;

  // Selected timezone: storage.timezone || config.timezone || 'Asia/Kolkata'
  let selectedTz = storage.timezone || config.timezone || 'Asia/Kolkata';

  function formatMinsToAmPm(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    return `${displayH}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  const mailbox = config.mailbox || {};
  let emailAccounts = Array.isArray(storage.emailAccounts) ? storage.emailAccounts : [];
  if (mailbox.connected && mailbox.email && !emailAccounts.find((a) => a.email === mailbox.email)) {
    emailAccounts.unshift({
      id: 'acc_gmail_primary',
      provider: 'google',
      email: mailbox.email,
      senderName: config.senderName || 'Aditya Chaudhary',
      status: 'active',
      connectedAt: Date.now(),
    });
  }

  let signatures = Array.isArray(storage.emailSignatures) ? storage.emailSignatures : [];
  let defaultSigId = config.defaultSignatureId || 'none';
  let activeEditingSig = null;

  let aiModels = Array.isArray(storage.ai_models) ? storage.ai_models : [];

  let importHistory = Array.isArray(storage.importHistory) ? storage.importHistory : [];
  if (importHistory.length === 0) {
    importHistory = [
      {
        id: 'imp_initial',
        dateTime: '10/11/2026 at 01:44',
        listName: 'My First List',
        importType: 'LinkedIn Search',
        scanned: 20,
        success: 20,
        duplicate: 0,
        falsePositives: 0,
      },
    ];
  }

  function paint() {
    const tzData = getTzDetails(selectedTz);
    const isTodayActive = workingDays[tzData.weekday] !== false;
    const isTimeActive = tzData.mins >= startMinutes && tzData.mins <= endMinutes;
    const isCurrentlyActive = isTodayActive && isTimeActive;

    const hasSheet = Boolean(
      storage.googleSheetUrl || config.googleSheetUrl || storage.googleSheetWebhookUrl || config.googleSheetWebhookUrl,
    );
    const hasWebhook = Boolean(storage.webhookUrl || config.webhookUrl);

    container.innerHTML = `
      <div class="waalaxy-settings-layout">
        <!-- SUB-SIDEBAR (4 Working Tabs Only) -->
        <aside class="settings-subsidebar">
          <div class="subsidebar-header">
            <h2 class="subsidebar-title">Settings</h2>
          </div>

          <nav class="subsidebar-menu">
            <button type="button" class="settings-menu-item ${activeSettingsTab === 'activity' ? 'is-active' : ''}" data-tab="activity">
              <span class="menu-icon-circle icon-bg-teal">${ICONS.clock}</span>
              <span class="menu-tab-label">Account activity</span>
            </button>

            <button type="button" class="settings-menu-item ${activeSettingsTab === 'email_accounts' ? 'is-active' : ''}" data-tab="email_accounts">
              <span class="menu-icon-circle icon-bg-purple">${ICONS.message}</span>
              <span class="menu-tab-label">Email accounts</span>
            </button>

            <button type="button" class="settings-menu-item ${activeSettingsTab === 'integrations' ? 'is-active' : ''}" data-tab="integrations">
              <span class="menu-icon-circle icon-bg-blue">${ICONS.rocket}</span>
              <span class="menu-tab-label">Integrations</span>
              <span class="badge-tab-new">New</span>
            </button>

            <button type="button" class="settings-menu-item ${activeSettingsTab === 'import_history' ? 'is-active' : ''}" data-tab="import_history">
              <span class="menu-icon-circle icon-bg-pink">${ICONS.list}</span>
              <span class="menu-tab-label">Import history</span>
            </button>
          </nav>
        </aside>

        <!-- MAIN CANVAS -->
        <main class="settings-main-canvas">
          ${activeSettingsTab === 'activity' ? `
            <!-- TAB 1: ACCOUNT ACTIVITY (Schedule, Live Clock & Quotas) -->
            <div class="settings-activity-scroll">
              <div class="activity-head-row">
                <div class="activity-title-group">
                  <h1 class="activity-main-title">Account activity</h1>
                  <span class="tz-live-clock-badge" id="tz-live-clock">
                    ${ICONS.clock} ${tzData.timeStr} · ${tzData.tzDisplayName}
                  </span>
                  <span class="live-activity-pill ${isCurrentlyActive ? 'is-running' : 'is-paused'}" id="status-activity-pill">
                    <span class="live-dot-circle"></span>
                    <span id="status-activity-text">${isCurrentlyActive ? 'Currently active' : 'Outside schedule'}</span>
                  </span>
                </div>
                <p class="activity-sub-text">Choose when you want your OutFox actions to be sent</p>
              </div>

              <!-- Timezone Selector -->
              <div class="settings-block-section">
                <label class="settings-section-heading">Select time zone</label>
                <div class="timezone-picker-wrap">
                  <select id="select-timezone" class="waalaxy-select-large">
                    <option value="Asia/Kolkata" ${selectedTz === 'Asia/Kolkata' ? 'selected' : ''}>(GMT+05:30) Asia/Kolkata (IST)</option>
                    <option value="UTC" ${selectedTz === 'UTC' ? 'selected' : ''}>(GMT+00:00) UTC Universal Time</option>
                    <option value="America/New_York" ${selectedTz === 'America/New_York' ? 'selected' : ''}>(GMT-05:00) America/New_York (EST)</option>
                    <option value="America/Chicago" ${selectedTz === 'America/Chicago' ? 'selected' : ''}>(GMT-06:00) America/Chicago (CST)</option>
                    <option value="America/Los_Angeles" ${selectedTz === 'America/Los_Angeles' ? 'selected' : ''}>(GMT-08:00) America/Los_Angeles (PST)</option>
                    <option value="Europe/Paris" ${selectedTz === 'Europe/Paris' ? 'selected' : ''}>(GMT+01:00) Europe/Paris (CET)</option>
                    <option value="Europe/London" ${selectedTz === 'Europe/London' ? 'selected' : ''}>(GMT+00:00) Europe/London (GMT)</option>
                    <option value="Asia/Dubai" ${selectedTz === 'Asia/Dubai' ? 'selected' : ''}>(GMT+04:00) Asia/Dubai (GST)</option>
                    <option value="Asia/Singapore" ${selectedTz === 'Asia/Singapore' ? 'selected' : ''}>(GMT+08:00) Asia/Singapore (SGT)</option>
                    <option value="Asia/Tokyo" ${selectedTz === 'Asia/Tokyo' ? 'selected' : ''}>(GMT+09:00) Asia/Tokyo (JST)</option>
                    <option value="Australia/Sydney" ${selectedTz === 'Australia/Sydney' ? 'selected' : ''}>(GMT+10:00) Australia/Sydney (AEST)</option>
                  </select>
                </div>
              </div>

              <!-- Working Days (Monday - Sunday) -->
              <div class="settings-block-section">
                <div class="working-days-head">
                  <label class="settings-section-heading">Select Working days</label>
                  <div class="custom-mode-toggle">
                    <span class="custom-mode-label">Daily custom mode</span>
                    <label class="ios-switch">
                      <input type="checkbox" id="toggle-custom-mode" />
                      <span class="ios-slider"></span>
                    </label>
                  </div>
                </div>

                <div class="days-toggle-grid">
                  ${['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'].map((day) => `
                    <div class="day-toggle-card">
                      <span class="day-card-name">${day}</span>
                      <label class="ios-switch">
                        <input type="checkbox" class="chk-day-toggle" data-day="${day}" ${workingDays[day] !== false ? 'checked' : ''} />
                        <span class="ios-slider"></span>
                      </label>
                    </div>
                  `).join('')}
                </div>
              </div>

              <!-- Time Slider -->
              <div class="settings-block-section">
                <div class="slider-labels-top">
                  <span id="slider-val-start" class="slider-time-indicator">${formatMinsToAmPm(startMinutes)}</span>
                  <span id="slider-val-end" class="slider-time-indicator">${formatMinsToAmPm(endMinutes)}</span>
                </div>

                <div class="dual-range-track-wrap">
                  <div class="dual-range-track">
                    <div class="dual-range-fill" id="slider-track-fill" style="left:${(startMinutes / 1439) * 100}%; width:${((endMinutes - startMinutes) / 1439) * 100}%;"></div>
                  </div>
                  <input type="range" min="0" max="1439" value="${startMinutes}" id="range-start-input" class="range-slider-input input-range-left" />
                  <input type="range" min="0" max="1439" value="${endMinutes}" id="range-end-input" class="range-slider-input input-range-right" />
                </div>

                <div class="slider-labels-bottom">
                  <span>12:00 AM</span>
                  <span>11:59 PM</span>
                </div>
              </div>

              <!-- Quotas Inputs (Single Row · Zero Cutoffs for 100 / 150) -->
              <div class="settings-block-section">
                <div class="quotas-section-head">
                  <div>
                    <div class="quotas-title-with-info">
                      <h3 class="settings-section-heading" style="margin:0;">Edit your max daily quota</h3>
                      <span class="info-circle-btn" title="Safety quotas enforced on your LinkedIn profile">${ICONS.info}</span>
                    </div>
                    <p class="quotas-caption">Specific limit : Linkedin allows only 200 invitations max. per week</p>
                  </div>

                  <button type="button" class="btn-restore-defaults" id="btn-restore-quotas">
                    Restore default values
                  </button>
                </div>

                <div class="quotas-subheading">LinkedIn</div>

                <div class="quota-cards-row">
                  <div class="quota-input-card">
                    <div class="q-card-icon icon-circle-blue">${ICONS.invitation}</div>
                    <div class="q-card-content">
                      <span class="q-card-label">INVITATIONS</span>
                      <div class="quota-input-group">
                        <input type="number" id="input-quota-invites" class="quota-number-input" value="${maxInvites}" min="1" max="100" />
                        <span class="quota-max-label">/ 100</span>
                      </div>
                    </div>
                  </div>

                  <div class="quota-input-card">
                    <div class="q-card-icon icon-circle-blue">${ICONS.message}</div>
                    <div class="q-card-content">
                      <span class="q-card-label">MESSAGES</span>
                      <div class="quota-input-group">
                        <input type="number" id="input-quota-messages" class="quota-number-input" value="${maxMessages}" min="1" max="150" />
                        <span class="quota-max-label">/ 150</span>
                      </div>
                    </div>
                  </div>

                  <div class="quota-input-card">
                    <div class="q-card-icon icon-circle-coral">${ICONS.visit}</div>
                    <div class="q-card-content">
                      <span class="q-card-label">PROFILE VISITS</span>
                      <div class="quota-input-group">
                        <input type="number" id="input-quota-visits" class="quota-number-input" value="${maxVisits}" min="1" max="150" />
                        <span class="quota-max-label">/ 150</span>
                      </div>
                    </div>
                  </div>

                  <div class="quota-input-card">
                    <div class="q-card-icon icon-circle-purple">${ICONS.follow}</div>
                    <div class="q-card-content">
                      <span class="q-card-label">FOLLOWS</span>
                      <div class="quota-input-group">
                        <input type="number" id="input-quota-follows" class="quota-number-input" value="${maxFollows}" min="1" max="100" />
                        <span class="quota-max-label">/ 100</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="settings-save-bar">
                  <button type="button" class="btn-primary-settings" id="btn-save-activity-settings">Save Activity Settings</button>
                </div>
              </div>
            </div>
          ` : activeSettingsTab === 'email_accounts' ? `
            <!-- TAB 2: EMAIL ACCOUNTS & SIGNATURES -->
            <div class="settings-email-scroll">
              <div class="activity-head-row">
                <h1 class="activity-main-title">Manage my email accounts</h1>
                <p class="activity-sub-text">Connect and manage your synchronized email inboxes for cold outreach</p>
              </div>

              <!-- Card 1: Accounts Table -->
              <div class="waalaxy-white-card">
                <div class="card-header-with-icon">
                  <div class="card-black-icon-box">${ICONS.email}</div>
                  <div>
                    <h3 class="card-title-bold">Accounts</h3>
                    <p class="card-subtitle-gray">Manage your connected email accounts</p>
                  </div>
                </div>

                <div class="accounts-table-wrap">
                  <table class="email-accounts-table">
                    <thead>
                      <tr>
                        <th>PROVIDER</th>
                        <th>EMAIL ADDRESS</th>
                        <th>SENDER NAME</th>
                        <th>STATUS</th>
                        <th width="80"></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${emailAccounts.length === 0 ? `
                        <tr>
                          <td colspan="5" class="empty-table-row">No email accounts connected yet. Connect Google or Outlook below.</td>
                        </tr>
                      ` : emailAccounts.map((acc) => `
                        <tr>
                          <td>
                            <div class="provider-badge-cell">
                              <span class="provider-logo-mini">${acc.provider === 'google' ? ICONS.google : acc.provider === 'outlook' ? ICONS.outlook : ICONS.email}</span>
                              <span class="provider-name-txt">${acc.provider === 'google' ? 'Google' : acc.provider === 'outlook' ? 'Outlook' : 'SMTP'}</span>
                            </div>
                          </td>
                          <td class="email-addr-txt">${acc.email}</td>
                          <td>${acc.senderName || 'Aditya Chaudhary'}</td>
                          <td><span class="badge-status-running"><span class="live-dot-circle"></span> Connected</span></td>
                          <td>
                            <button type="button" class="btn-disconnect-acc" data-id="${acc.id}" title="Disconnect">${ICONS.x}</button>
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>

                  <button type="button" class="btn-link-add-email" id="btn-open-connect-modal">
                    + Add an email address
                  </button>
                </div>
              </div>

              <!-- Card 2: Signatures -->
              <div class="waalaxy-white-card">
                <div class="card-header-with-icon">
                  <div class="card-black-icon-box">${ICONS.edit}</div>
                  <div>
                    <h3 class="card-title-bold">Signatures</h3>
                    <p class="card-subtitle-gray">Add your signature at the end of every email you send</p>
                  </div>
                </div>

                <div class="signatures-split-view">
                  <div class="sig-left-pane">
                    <label class="sig-pane-label">Default signature</label>
                    <select id="select-default-signature" class="waalaxy-select-small">
                      <option value="none">No signature ⌵</option>
                      ${signatures.map((s) => `<option value="${s.id}" ${s.id === defaultSigId ? 'selected' : ''}>${s.name}</option>`).join('')}
                    </select>

                    <div class="sig-list-header">
                      <span>Your signatures</span>
                      <button type="button" class="btn-sig-link" id="btn-add-sig-trigger">+ Add a signature</button>
                    </div>

                    <div class="sig-nav-list">
                      ${signatures.length === 0 ? `
                        <span class="empty-sig-txt">No saved signatures</span>
                      ` : signatures.map((s) => `
                        <div class="sig-nav-item ${activeEditingSig?.id === s.id ? 'is-active' : ''}" data-sig-id="${s.id}">
                          <span class="sig-name-label">${s.name}</span>
                          <button type="button" class="btn-del-sig" data-id="${s.id}">${ICONS.x}</button>
                        </div>
                      `).join('')}
                    </div>
                  </div>

                  <div class="sig-right-canvas">
                    ${activeEditingSig ? `
                      <div class="sig-editor-box">
                        <label class="sig-pane-label">Signature name</label>
                        <input type="text" id="input-sig-name" class="input-text-sig" value="${activeEditingSig.name || 'My Signature'}" />
                        
                        <label class="sig-pane-label" style="margin-top:12px;">Content</label>
                        <textarea id="textarea-sig-body" class="sig-textarea" rows="5" placeholder="Best regards,\nYour Name\nCompany">${activeEditingSig.content || ''}</textarea>

                        <div class="sig-editor-actions">
                          <button type="button" class="btn-restore-defaults" id="btn-cancel-sig-edit">Cancel</button>
                          <button type="button" class="btn-primary-settings" id="btn-save-sig-edit">Save signature</button>
                        </div>
                      </div>
                    ` : `
                      <div class="sig-empty-canvas">
                        <h4 class="sig-empty-title">Find your signatures here</h4>
                        <p class="sig-empty-sub">Add, edit, and organize all your email signatures in one place.</p>
                        <button type="button" class="btn-create-sig-blue" id="btn-canvas-create-sig">
                          Create a signature
                        </button>
                      </div>
                    `}
                  </div>
                </div>
              </div>
            </div>
          ` : activeSettingsTab === 'integrations' ? `
            <!-- TAB 3: REAL INTEGRATIONS (Google Sheets, AI Engine, MCP, Webhooks) -->
            <div class="settings-integrations-scroll">
              <h1 class="activity-main-title" style="margin-bottom:24px;">Integrations & CRM Sync</h1>

              <div class="integrations-cards-grid">
                <!-- 1. Google Sheets CRM Sync -->
                <div class="integration-item-card">
                  <div class="int-card-head">
                    <div class="int-card-head-left">
                      <span class="int-logo-ico" style="background:#0f9d58; color:#fff;">${ICONS.sheets}</span>
                      <h3 class="int-card-title">Google Sheets Sync</h3>
                    </div>
                    ${hasSheet
                      ? `<span class="badge-status-running"><span class="live-dot-circle"></span> Connected</span>`
                      : `<span class="live-activity-pill is-paused" style="font-size:11px;">○ Not Configured</span>`}
                  </div>
                  <p class="int-card-desc">Auto-append accepted leads, replied messages, and emails directly to a live Google Sheet in real-time.</p>
                  <button type="button" class="btn-int-action ${hasSheet ? 'btn-int-active' : ''}" id="btn-setup-sheet-crm">
                    ${hasSheet ? 'Manage Google Sheet ↗' : 'Setup Google Sheet ↗'}
                  </button>
                </div>

                <!-- 2. AI Engine & Fallback Router -->
                <div class="integration-item-card">
                  <div class="int-card-head">
                    <div class="int-card-head-left">
                      <span class="int-logo-ico" style="background:#7c3aed; color:#fff;">${ICONS.robot}</span>
                      <h3 class="int-card-title">AI Engine & Fallback Router</h3>
                    </div>
                    ${aiModels.length > 0
                      ? `<span class="badge-status-running"><span class="live-dot-circle"></span> ${aiModels.length} Model${aiModels.length > 1 ? 's' : ''} Active</span>`
                      : `<span class="live-activity-pill is-paused" style="font-size:11px;">○ Not Configured</span>`}
                  </div>
                  <p class="int-card-desc">Multi-model fallback chain: Automatically fall back between Groq, Gemini, OpenAI, Claude and Ollama if quotas or rate limits hit.</p>
                  <button type="button" class="btn-int-action ${aiModels.length > 0 ? 'btn-int-active' : ''}" id="btn-configure-ai">
                    Configure AI Fallback Chain
                  </button>
                </div>

                <!-- 3. IA Connector (MCP) -->
                <div class="integration-item-card">
                  <div class="int-card-head">
                    <div class="int-card-head-left">
                      <span class="int-logo-ico" style="background:#2563eb; color:#fff;">${ICONS.sparkles}</span>
                      <h3 class="int-card-title">IA Connector (MCP)</h3>
                    </div>
                    <span class="badge-status-running"><span class="live-dot-circle"></span> SSE Ready</span>
                  </div>
                  <p class="int-card-desc">Connect Claude Desktop, Cursor, or ChatGPT to OutFox through local Model Context Protocol SSE on port 3000.</p>
                  <button type="button" class="btn-int-action" id="btn-mcp-guide">How to connect ? ↗</button>
                </div>

                <!-- 4. Webhooks (Zapier & Make) -->
                <div class="integration-item-card">
                  <div class="int-card-head">
                    <div class="int-card-head-left">
                      <span class="int-logo-ico" style="background:#ff4a00; color:#fff;">${ICONS.webhook}</span>
                      <h3 class="int-card-title">Webhooks (Zapier & Make)</h3>
                    </div>
                    ${hasWebhook
                      ? `<span class="badge-status-running"><span class="live-dot-circle"></span> Connected</span>`
                      : `<span class="live-activity-pill is-paused" style="font-size:11px;">○ Not Configured</span>`}
                  </div>
                  <p class="int-card-desc">Stream outreach events (invite sent, accepted, replies) to your custom Zapier or Make Webhook URL.</p>
                  <button type="button" class="btn-int-action ${hasWebhook ? 'btn-int-active' : ''}" id="btn-configure-webhook">
                    ${hasWebhook ? 'Edit Webhook URL' : 'Configure Webhook'}
                  </button>
                </div>
              </div>
            </div>
          ` : `
            <!-- TAB 4: IMPORT HISTORY (Audit Log) -->
            <div class="settings-history-scroll">
              <h1 class="activity-main-title" style="margin-bottom:24px;">Import history</h1>

              <div class="history-table-card">
                <table class="import-history-table">
                  <thead>
                    <tr>
                      <th>DATE AND TIME</th>
                      <th>LIST</th>
                      <th>IMPORT TYPE</th>
                      <th>SCANNED <span class="th-info-ico">${ICONS.info}</span></th>
                      <th>SUCCESS <span class="th-info-ico">${ICONS.info}</span></th>
                      <th>DUPLICATE <span class="th-info-ico">${ICONS.info}</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${importHistory.map((item) => `
                      <tr>
                        <td class="history-date-cell">${item.dateTime}</td>
                        <td class="history-list-name">${item.listName}</td>
                        <td><span style="font-size:12px; font-weight:600; color:#64748b;">${item.importType}</span></td>
                        <td>${item.scanned}</td>
                        <td class="history-success-val font-bold">${item.success}</td>
                        <td style="color:#f59e0b; font-weight:600;">${item.duplicate}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          `}
        </main>
      </div>
    `;

    wireEvents();
  }

  function wireEvents() {
    container.querySelectorAll('.settings-menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        activeSettingsTab = item.dataset.tab;
        paint();
      });
    });

    if (activeSettingsTab === 'activity') {
      wireActivityEvents();
    } else if (activeSettingsTab === 'email_accounts') {
      wireEmailAccountsEvents();
    } else if (activeSettingsTab === 'integrations') {
      wireIntegrationsEvents();
    }
  }

  function wireActivityEvents() {
    // 1. Working Days
    container.querySelectorAll('.chk-day-toggle').forEach((chk) => {
      chk.addEventListener('change', () => {
        workingDays[chk.dataset.day] = chk.checked;
        saveConfig();
        updateLiveStatus();
      });
    });

    // 2. Time slider
    const rangeLeft = container.querySelector('#range-start-input');
    const rangeRight = container.querySelector('#range-end-input');
    const fillTrack = container.querySelector('#slider-track-fill');
    const lblStart = container.querySelector('#slider-val-start');
    const lblEnd = container.querySelector('#slider-val-end');

    if (rangeLeft && rangeRight) {
      function updateSlider() {
        let val1 = parseInt(rangeLeft.value);
        let val2 = parseInt(rangeRight.value);
        if (val1 > val2) {
          const tmp = val1;
          val1 = val2;
          val2 = tmp;
        }
        startMinutes = val1;
        endMinutes = val2;

        const leftPct = (val1 / 1439) * 100;
        const widthPct = ((val2 - val1) / 1439) * 100;

        if (fillTrack) {
          fillTrack.style.left = `${leftPct}%`;
          fillTrack.style.width = `${widthPct}%`;
        }
        if (lblStart) lblStart.textContent = formatMinsToAmPm(val1);
        if (lblEnd) lblEnd.textContent = formatMinsToAmPm(val2);
        updateLiveStatus();
      }

      rangeLeft.addEventListener('input', updateSlider);
      rangeRight.addEventListener('input', updateSlider);
      rangeLeft.addEventListener('change', saveConfig);
      rangeRight.addEventListener('change', saveConfig);
    }

    // 3. Timezone selector & live update
    container.querySelector('#select-timezone')?.addEventListener('change', async (e) => {
      selectedTz = e.target.value;
      storage.timezone = selectedTz;
      await new Promise((r) => chrome.storage.local.set({ timezone: selectedTz }, r));
      await saveConfig();
      updateLiveStatus();
      ctx.showToast?.(`Time zone updated to ${selectedTz}`, 'info');
    });

    function updateLiveStatus() {
      const curTzData = getTzDetails(selectedTz);
      const curTodayActive = workingDays[curTzData.weekday] !== false;
      const curTimeActive = curTzData.mins >= startMinutes && curTzData.mins <= endMinutes;
      const curActive = curTodayActive && curTimeActive;

      const clockEl = container.querySelector('#tz-live-clock');
      if (clockEl) {
        clockEl.innerHTML = `${ICONS.clock} ${curTzData.timeStr} · ${curTzData.tzDisplayName}`;
      }
      const pillEl = container.querySelector('#status-activity-pill');
      const textEl = container.querySelector('#status-activity-text');
      if (pillEl && textEl) {
        pillEl.className = `live-activity-pill ${curActive ? 'is-running' : 'is-paused'}`;
        textEl.textContent = curActive ? 'Currently active' : 'Outside schedule';
      }
    }

    // Tick live clock every 10 seconds
    liveClockInterval = setInterval(() => {
      updateLiveStatus();
    }, 10000);

    // 4. Restore default quotas
    container.querySelector('#btn-restore-quotas')?.addEventListener('click', () => {
      maxInvites = 25;
      maxMessages = 40;
      maxVisits = 80;
      maxFollows = 50;
      container.querySelector('#input-quota-invites').value = 25;
      container.querySelector('#input-quota-messages').value = 40;
      container.querySelector('#input-quota-visits').value = 80;
      container.querySelector('#input-quota-follows').value = 50;
      saveConfig();
      ctx.showToast?.('Default quotas restored.', 'info');
    });

    // 5. Save settings button
    container.querySelector('#btn-save-activity-settings')?.addEventListener('click', async () => {
      await saveConfig();
      ctx.showToast?.('Account activity settings saved successfully!', 'success');
    });

    async function saveConfig() {
      const qInv = parseInt(container.querySelector('#input-quota-invites')?.value) || maxInvites;
      const qMsg = parseInt(container.querySelector('#input-quota-messages')?.value) || maxMessages;
      const qVis = parseInt(container.querySelector('#input-quota-visits')?.value) || maxVisits;
      const qFol = parseInt(container.querySelector('#input-quota-follows')?.value) || maxFollows;

      const payload = {
        workingDays,
        startMinutes,
        endMinutes,
        businessStartTime: formatMinsToAmPm(startMinutes),
        businessEndTime: formatMinsToAmPm(endMinutes),
        timezone: selectedTz,
        dailyInviteCap: qInv,
        dailyMessageCap: qMsg,
        dailyVisitCap: qVis,
        dailyFollowCap: qFol,
      };

      try {
        await call(ACTIONS.CONFIG_SET, { config: payload });
      } catch (e) {
        console.warn('Config save error', e);
      }
    }
  }

  function wireEmailAccountsEvents() {
    container.querySelector('#btn-open-connect-modal')?.addEventListener('click', () => {
      openConnectEmailModal({
        onSuccess: (newAccount) => {
          emailAccounts.push(newAccount);
          chrome.storage.local.set({ emailAccounts });
          ctx.showToast?.(`Email account connected: ${newAccount.email}`, 'success');
          paint();
        },
      });
    });

    container.querySelectorAll('.btn-disconnect-acc').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const target = emailAccounts.find((a) => a.id === id);
        emailAccounts = emailAccounts.filter((a) => a.id !== id);
        await chrome.storage.local.set({ emailAccounts });
        if (target && target.provider === 'google') {
          await call(ACTIONS.GMAIL_DISCONNECT, {}).catch(() => {});
        }
        ctx.showToast?.('Email account disconnected.', 'info');
        paint();
      });
    });

    const startNewSig = () => {
      activeEditingSig = { id: `sig_${Date.now()}`, name: 'My Signature', content: 'Best regards,\nAditya Chaudhary' };
      paint();
    };

    container.querySelector('#btn-add-sig-trigger')?.addEventListener('click', startNewSig);
    container.querySelector('#btn-canvas-create-sig')?.addEventListener('click', startNewSig);

    container.querySelectorAll('.sig-nav-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-del-sig')) return;
        const id = item.dataset.sigId;
        activeEditingSig = signatures.find((s) => s.id === id) || null;
        paint();
      });
    });

    container.querySelectorAll('.btn-del-sig').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        signatures = signatures.filter((s) => s.id !== id);
        if (activeEditingSig?.id === id) activeEditingSig = null;
        await chrome.storage.local.set({ emailSignatures: signatures });
        ctx.showToast?.('Signature removed.', 'info');
        paint();
      });
    });

    container.querySelector('#select-default-signature')?.addEventListener('change', async (e) => {
      defaultSigId = e.target.value;
      await call(ACTIONS.CONFIG_SET, { config: { defaultSignatureId: defaultSigId } });
      ctx.showToast?.('Default signature saved.', 'success');
    });

    container.querySelector('#btn-cancel-sig-edit')?.addEventListener('click', () => {
      activeEditingSig = null;
      paint();
    });

    container.querySelector('#btn-save-sig-edit')?.addEventListener('click', async () => {
      const name = container.querySelector('#input-sig-name')?.value?.trim();
      const content = container.querySelector('#textarea-sig-body')?.value?.trim();
      if (!name) {
        openUiAlert({ title: 'Validation Required', message: 'Please provide a name for this signature.' });
        return;
      }
      const existingIdx = signatures.findIndex((s) => s.id === activeEditingSig.id);
      const updated = { id: activeEditingSig.id, name, content };
      if (existingIdx !== -1) {
        signatures[existingIdx] = updated;
      } else {
        signatures.push(updated);
      }
      activeEditingSig = null;
      await chrome.storage.local.set({ emailSignatures: signatures });
      ctx.showToast?.('Signature saved successfully!', 'success');
      paint();
    });
  }

  function wireIntegrationsEvents() {
    // 1. Google Sheets CRM Sync
    container.querySelector('#btn-setup-sheet-crm')?.addEventListener('click', () => {
      openSheetCrmGuide((url) => {
        storage.googleSheetUrl = url;
        storage.googleSheetWebhookUrl = url;
        paint();
      });
    });

    // 2. AI Engine Multi-Model & Fallback Router
    container.querySelector('#btn-configure-ai')?.addEventListener('click', () => {
      openAiEngineRouterModal({
        aiModels,
        onSave: async (updated) => {
          aiModels = updated;
          storage.ai_models = updated;
          await new Promise((r) => chrome.storage.local.set({ ai_models: updated }, r));
          if (updated.length > 0) {
            const primary = updated[0];
            await call(ACTIONS.CONFIG_SET, {
              config: {
                ai: {
                  provider: primary.provider === 'claude' ? 'anthropic' : primary.provider,
                  apiKey: primary.apiKey,
                  model: primary.modelId,
                },
              },
            });
          }
          paint();
        },
      });
    });

    // 3. IA Connector (MCP)
    container.querySelector('#btn-mcp-guide')?.addEventListener('click', () => {
      openUiAlert({
        title: 'MCP Connector (Claude Desktop & ChatGPT)',
        message: `Connect your AI assistant to OutFox via Model Context Protocol on port 3000:<br><br>
        <strong>Claude Desktop / Cursor Configuration:</strong><br>
        <pre style="background:#f1f5f9; padding:12px; border-radius:8px; font-size:12px; overflow-x:auto; margin-top:8px;">{
  "mcpServers": {
    "outfox-outreach": {
      "url": "http://127.0.0.1:3000/sse"
    }
  }
}</pre><br>
        The SSE endpoint runs locally inside OutFox and exposes tools for campaign management and prospect enrollment.`,
      });
    });

    // 4. Webhooks (Zapier & Make)
    container.querySelector('#btn-configure-webhook')?.addEventListener('click', async () => {
      const url = await openUiPrompt({
        title: 'Configure Webhook',
        subtitle: 'Stream outreach events (invitations, acceptances, replies) to Zapier, Make, or custom HTTP receiver.',
        label: 'Webhook URL',
        defaultValue: storage.webhookUrl || config.webhookUrl || '',
        placeholder: 'https://hooks.zapier.com/...',
        confirmText: 'Save Webhook',
      });
      if (url !== null) {
        storage.webhookUrl = url;
        await new Promise((r) => chrome.storage.local.set({ webhookUrl: url }, r));
        await call(ACTIONS.CONFIG_SET, { config: { webhookUrl: url } });
        ctx.showToast?.('Webhook URL saved successfully!', 'success');
        paint();
      }
    });
  }

  paint();
}

/**
 * AI Engine Multi-Model & Fallback Router Modal
 */
export function openAiEngineRouterModal({ aiModels = [], onSave }) {
  const existing = document.getElementById('modal-ai-router-backdrop');
  if (existing) existing.remove();

  let modelsList = [...aiModels];

  const backdrop = document.createElement('div');
  backdrop.id = 'modal-ai-router-backdrop';
  backdrop.className = 'edit-msg-modal-backdrop';

  function renderModal() {
    backdrop.innerHTML = `
      <div class="waalaxy-modal-card" style="width: 620px; max-width: 90vw; max-height: 85vh; overflow-y: auto; padding: 28px 32px; background:#fff; border-radius:16px; box-shadow: 0 10px 40px rgba(0,0,0,0.18);">
        <div class="waalaxy-modal-head" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 20px;">
          <div>
            <h2 class="waalaxy-modal-title" style="font-size:18px; margin:0; font-weight:800; color:#14142b;">AI Engine & Fallback Chain Router</h2>
            <p class="waalaxy-modal-subtitle" style="margin:4px 0 0; font-size:12.5px; color:#64748b; line-height: 1.4;">
              Configure multiple AI models ordered by priority. If your primary model hits a rate limit or runs out of credits, OutFox automatically falls back to the next model in the chain.
            </p>
          </div>
          <button type="button" class="waalaxy-modal-close" id="btn-close-ai-modal" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:16px;">${ICONS.x}</button>
        </div>

        <!-- Priority-Ordered Models Chain -->
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${modelsList.length === 0 ? `
            <div style="padding: 28px 20px; text-align: center; color: #94a3b8; background: #f8fafc; border-radius: 12px; border: 1.5px dashed #cbd5e1;">
              <span style="font-size: 13px; font-weight: 600;">No AI models in chain yet. Add your first model below.</span>
            </div>
          ` : modelsList.map((m, idx) => {
            const priorityBadge = idx === 0 ? '#1 Primary' : `#${idx + 1} Fallback ${idx}`;
            return `
              <div class="ai-model-card" data-idx="${idx}" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:12px; padding:14px 18px; display:flex; align-items:center; justify-content:space-between; gap:14px; box-shadow:0 1px 3px rgba(0,0,0,0.02);">
                <div style="display:flex; align-items:center; gap:12px; min-width:0;">
                  <span style="font-size:11px; font-weight:800; padding:4px 10px; border-radius:6px; flex-shrink:0; background:${idx === 0 ? '#eef2ff' : '#f1f5f9'}; color:${idx === 0 ? '#2563eb' : '#64748b'};">${priorityBadge}</span>
                  <div style="min-width:0;">
                    <div style="display:flex; align-items:center; gap:8px;">
                      <strong style="font-size:14px; color:#14142b; text-transform:capitalize;">${m.provider}</strong>
                      <span style="font-size:12px; color:#64748b; font-family:monospace; background:#f8fafc; padding:2px 6px; border-radius:4px; border:1px solid #e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${m.modelId}</span>
                    </div>
                    <span style="font-size:11.5px; color:#94a3b8; font-family:monospace;">${maskKey(m.apiKey)}</span>
                  </div>
                </div>
                <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
                  <button type="button" class="btn-test-ai-item" data-idx="${idx}" style="background:#f1f5f9; border:1px solid #e2e8f0; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; color:#14142b;">
                    Test
                  </button>
                  <button type="button" class="btn-delete-ai-item" data-idx="${idx}" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; padding:4px 6px;" title="Remove model">
                    ${ICONS.x}
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- + Add AI Model to Chain -->
        <div style="margin-top:22px; padding:18px; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0;">
          <h4 style="margin:0 0 14px 0; font-size:13.5px; font-weight:800; color:#14142b;">+ Add AI Model to Chain</h4>
          <div style="display:grid; grid-template-columns: 140px 1fr 1fr auto; gap:10px; align-items:flex-end;">
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#64748b; margin-bottom:4px;">PROVIDER</label>
              <select id="new-ai-provider" style="width:100%; padding:8px 10px; border:1.5px solid #cbd5e1; border-radius:8px; font-size:12.5px; background:#fff; font-weight:600; outline:none; cursor:pointer;">
                <option value="groq">Groq</option>
                <option value="gemini">Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="claude">Claude</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#64748b; margin-bottom:4px;">MODEL ID</label>
              <input type="text" id="new-ai-model-id" value="llama-3.3-70b-versatile" style="width:100%; box-sizing:border-box; padding:8px 10px; border:1.5px solid #cbd5e1; border-radius:8px; font-size:12.5px; outline:none;" />
            </div>
            <div>
              <label style="display:block; font-size:11px; font-weight:700; color:#64748b; margin-bottom:4px;">API KEY (or Host)</label>
              <input type="password" id="new-ai-api-key" placeholder="gsk_..." style="width:100%; box-sizing:border-box; padding:8px 10px; border:1.5px solid #cbd5e1; border-radius:8px; font-size:12.5px; outline:none;" />
            </div>
            <div>
              <button type="button" id="btn-add-ai-model" style="padding:9px 18px; background:#2563eb; color:#fff; border:none; border-radius:8px; font-size:12.5px; font-weight:700; cursor:pointer; white-space:nowrap;">
                + Add
              </button>
            </div>
          </div>
        </div>

        <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:10px;">
          <button type="button" class="btn-primary-settings" id="btn-save-ai-router" style="padding:8px 22px;">Done</button>
        </div>
      </div>
    `;

    wireModalEvents();
  }

  function wireModalEvents() {
    backdrop.querySelector('#btn-close-ai-modal')?.addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('#btn-save-ai-router')?.addEventListener('click', () => {
      onSave?.(modelsList);
      backdrop.remove();
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    const providerSelect = backdrop.querySelector('#new-ai-provider');
    const modelInput = backdrop.querySelector('#new-ai-model-id');
    const keyInput = backdrop.querySelector('#new-ai-api-key');

    const presets = {
      groq: { model: 'llama-3.3-70b-versatile', placeholder: 'gsk_...' },
      gemini: { model: 'gemini-1.5-flash', placeholder: 'AIzaSy...' },
      openai: { model: 'gpt-4o-mini', placeholder: 'sk-...' },
      claude: { model: 'claude-3-5-haiku-20241022', placeholder: 'sk-ant-...' },
      ollama: { model: 'llama3.2', placeholder: 'http://localhost:11434' },
    };

    providerSelect?.addEventListener('change', (e) => {
      const p = e.target.value;
      if (presets[p]) {
        modelInput.value = presets[p].model;
        keyInput.placeholder = presets[p].placeholder;
      }
    });

    // Add model
    backdrop.querySelector('#btn-add-ai-model')?.addEventListener('click', () => {
      const provider = providerSelect?.value || 'groq';
      const modelId = modelInput?.value?.trim() || presets[provider]?.model;
      const apiKey = keyInput?.value?.trim() || (provider === 'ollama' ? 'http://localhost:11434' : '');

      if (!apiKey) {
        openUiAlert({ title: 'API Key Required', message: 'Please enter your API Key or host URL.' });
        return;
      }

      modelsList.push({
        id: `ai_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        provider,
        modelId,
        apiKey,
        active: true,
      });

      onSave?.(modelsList);
      renderModal();
    });

    // Delete item
    backdrop.querySelectorAll('.btn-delete-ai-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        modelsList.splice(idx, 1);
        onSave?.(modelsList);
        renderModal();
      });
    });

    // Test item
    backdrop.querySelectorAll('.btn-test-ai-item').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const item = modelsList[idx];
        if (!item) return;

        btn.disabled = true;
        btn.textContent = 'Testing...';

        const result = await testAiConnection(item.provider, item.modelId, item.apiKey);
        if (result.success) {
          btn.textContent = `✓ OK (${result.latency}ms)`;
          btn.style.color = '#059669';
          btn.style.borderColor = '#10b981';
          setTimeout(() => {
            btn.textContent = 'Test';
            btn.style.color = '#14142b';
            btn.style.borderColor = '#e2e8f0';
            btn.disabled = false;
          }, 3000);
        } else {
          btn.textContent = 'Failed';
          btn.style.color = '#dc2626';
          btn.style.borderColor = '#ef4444';
          openUiAlert({ title: 'AI Connection Test Failed', message: result.error });
          setTimeout(() => {
            btn.textContent = 'Test';
            btn.style.color = '#14142b';
            btn.style.borderColor = '#e2e8f0';
            btn.disabled = false;
          }, 3000);
        }
      });
    });
  }

  document.body.appendChild(backdrop);
  renderModal();
}

/**
 * Connect Email Modal (Google OAuth, Outlook, SMTP)
 */
function openConnectEmailModal({ onSuccess }) {
  const existing = document.getElementById('modal-connect-email-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = 'modal-connect-email-backdrop';
  backdrop.className = 'edit-msg-modal-backdrop';

  backdrop.innerHTML = `
    <div class="waalaxy-modal-card" style="width: 480px; padding: 28px 32px; background:#fff; border-radius:16px; box-shadow: 0 10px 40px rgba(0,0,0,0.15);">
      <div class="waalaxy-modal-head" style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <h2 class="waalaxy-modal-title" style="font-size:18px; margin:0; font-weight:800; color:#14142b;">Connect a new email address</h2>
          <p class="waalaxy-modal-subtitle" style="margin:4px 0 0; font-size:12px; color:#64748b;">Connect an email account to send personalized cold email campaigns.</p>
        </div>
        <button type="button" class="waalaxy-modal-close" id="btn-close-connect-modal" style="background:transparent; border:none; color:#94a3b8; cursor:pointer;">${ICONS.x}</button>
      </div>

      <div class="connect-options-list" style="margin-top:20px; display:flex; flex-direction:column; gap:12px;">
        <button type="button" class="btn-connect-provider" id="btn-oauth-google">
          ${ICONS.google}
          <span style="font-weight:600; color:#14142b; font-size:14px;">Sign in with Google</span>
        </button>

        <button type="button" class="btn-connect-provider" id="btn-oauth-outlook">
          ${ICONS.outlook}
          <span style="font-weight:600; color:#14142b; font-size:14px;">Sign in with Outlook</span>
        </button>

        <div style="display:flex; align-items:center; gap:12px; margin:4px 0;">
          <div style="flex:1; height:1px; background:#e2e8f0;"></div>
          <span style="font-size:11px; color:#94a3b8; font-weight:600;">or other providers</span>
          <div style="flex:1; height:1px; background:#e2e8f0;"></div>
        </div>

        <button type="button" class="btn-connect-provider" id="btn-custom-smtp">
          <span style="width:20px; height:20px; border-radius:4px; background:#7c3aed; color:#fff; display:flex; align-items:center; justify-content:center;">${ICONS.email}</span>
          <span style="font-weight:600; color:#14142b; font-size:14px;">Sign in with an other account</span>
        </button>

        <div class="smtp-inline-form hidden" id="smtp-inline-form" style="margin-top:8px; padding-top:12px; border-top:1px solid #f1f5f9; display:flex; flex-direction:column; gap:8px;">
          <input type="text" id="smtp-host" class="input-text-model" placeholder="SMTP Host (e.g. smtp.gmail.com)" style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px;" />
          <input type="number" id="smtp-port" class="input-text-model" placeholder="Port (e.g. 587)" value="587" style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px;" />
          <input type="email" id="smtp-email" class="input-text-model" placeholder="Email Address" style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px;" />
          <input type="password" id="smtp-pass" class="input-text-model" placeholder="Password / App Password" style="padding:8px 12px; border:1px solid #cbd5e1; border-radius:8px;" />
          <button type="button" class="btn-primary-settings" id="btn-submit-smtp" style="margin-top:6px;">Connect SMTP</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  backdrop.querySelector('#btn-close-connect-modal')?.addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  backdrop.querySelector('#btn-oauth-google')?.addEventListener('click', async () => {
    const btn = backdrop.querySelector('#btn-oauth-google');
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.6';
    }

    try {
      const res = await call(ACTIONS.GMAIL_CONNECT, { interactive: true });
      backdrop.remove();
      onSuccess({
        id: `acc_google_${Date.now()}`,
        provider: 'google',
        email: res.email || 'connected-user@gmail.com',
        senderName: 'Aditya Chaudhary',
        connectedAt: Date.now(),
      });
    } catch (e) {
      openUiAlert({ title: 'Google Auth Notice', message: e.message || 'Authentication error' });
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    }
  });

  backdrop.querySelector('#btn-oauth-outlook')?.addEventListener('click', async () => {
    const email = await openUiPrompt({
      title: 'Connect Outlook / Microsoft 365',
      label: 'Enter your Outlook / Microsoft 365 email:',
      placeholder: 'user@outlook.com',
      confirmText: 'Connect',
    });
    if (email) {
      backdrop.remove();
      onSuccess({
        id: `acc_outlook_${Date.now()}`,
        provider: 'outlook',
        email: email.trim(),
        senderName: 'Aditya Chaudhary',
        connectedAt: Date.now(),
      });
    }
  });

  backdrop.querySelector('#btn-custom-smtp')?.addEventListener('click', () => {
    const form = backdrop.querySelector('#smtp-inline-form');
    if (form) form.classList.toggle('hidden');
  });

  backdrop.querySelector('#btn-submit-smtp')?.addEventListener('click', () => {
    const email = backdrop.querySelector('#smtp-email')?.value?.trim();
    if (!email) {
      openUiAlert({ title: 'Validation Required', message: 'Please enter an email address.' });
      return;
    }
    backdrop.remove();
    onSuccess({
      id: `acc_smtp_${Date.now()}`,
      provider: 'smtp',
      email,
      senderName: 'Aditya Chaudhary',
      connectedAt: Date.now(),
    });
  });
}
