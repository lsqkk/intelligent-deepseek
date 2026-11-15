import { describe, expect, it } from 'vitest';
import { shouldInjectPrompt } from '../../src/inject.js';

const base = { enabled: true, injectEveryTurn: false };

describe('prompt injection policy', () => {
  it('injects the first message of a new session only', () => {
    const injected = {};
    expect(shouldInjectPrompt(base, 'session-a', injected)).toBe(true);
    expect(shouldInjectPrompt(base, 'session-a', { 'session-a': Date.now() })).toBe(false);
    expect(shouldInjectPrompt(base, 'session-b', { 'session-a': Date.now() })).toBe(true);
  });

  it('injects every turn when injectEveryTurn is on', () => {
    const injected = { 'session-a': Date.now() };
    expect(shouldInjectPrompt({ ...base, injectEveryTurn: true }, 'session-a', injected)).toBe(true);
  });

  it('never injects when the master switch is off', () => {
    expect(shouldInjectPrompt({ ...base, enabled: false }, 'session-a', {})).toBe(false);
  });

  it('updates an existing session once when protocol preferences change', () => {
    const settings = { ...base, protocolRevision: 10 };
    expect(shouldInjectPrompt(settings, 'session-a', { 'session-a': 123 })).toBe(true);
    expect(shouldInjectPrompt(settings, 'session-a', { 'session-a': { at: 124, revision: 10 } })).toBe(false);
  });

  it('injects when the session id is unknown', () => {
    expect(shouldInjectPrompt(base, '', {})).toBe(true);
  });

  it('reads injection records written after this tab has loaded', () => {
    const key = '__dsui_injected_sessions_v1';
    expect(shouldInjectPrompt(base, 'shared-chat')).toBe(true);
    localStorage.setItem(key, JSON.stringify({ 'shared-chat': { at: Date.now(), revision: 0 } }));
    try {
      expect(shouldInjectPrompt(base, 'shared-chat')).toBe(false);
      expect(shouldInjectPrompt({ ...base, protocolRevision: 1 }, 'shared-chat')).toBe(true);
    } finally {
      localStorage.removeItem(key);
    }
  });
});
