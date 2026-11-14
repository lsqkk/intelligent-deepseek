import { describe, expect, it } from 'vitest';
import {
  PROMPT_END,
  PROMPT_START,
  applyInjection,
  getProtocol,
  hasInjection,
  stripInjection,
} from '../../src/prompt.js';

const settings = { injectPrompt: true, protocolLanguage: 'zh', customProtocol: '' };

describe('prompt injection', () => {
  it('appends a marked protocol block', () => {
    const out = applyInjection('你好', settings);
    expect(out.startsWith('你好')).toBe(true);
    expect(out).toContain(PROMPT_START);
    expect(out).toContain(PROMPT_END);
    expect(hasInjection(out)).toBe(true);
  });

  it('strips the block back to the original prompt', () => {
    const original = '帮我算一下 1+1';
    const injected = applyInjection(original, settings);
    expect(stripInjection(injected)).toBe(original);
  });

  it('does not accumulate blocks when applied twice', () => {
    const once = applyInjection('hi', settings);
    const twice = applyInjection(once, settings);
    const occurrences = twice.split(PROMPT_START).length - 1;
    expect(occurrences).toBe(1);
    expect(stripInjection(twice)).toBe('hi');
  });

  it('leaves the prompt untouched when injection is disabled', () => {
    expect(applyInjection('你好', { ...settings, injectPrompt: false })).toBe('你好');
  });

  it('trims trailing whitespace produced by stripping', () => {
    expect(stripInjection('abc   \n\n⟦DS-UI v1⟧\nx\n⟦/DS-UI⟧\n\n')).toBe('abc');
  });

  it('only removes the trailing block, never user text mentioning the marker', () => {
    const userText = '请解释这个标记 ⟦DS-UI v1⟧ 是什么意思，以及它为什么会出现。';
    const once = applyInjection(userText, settings);
    expect(once.startsWith(userText)).toBe(true);
    expect(stripInjection(once)).toBe(userText);
    const twice = applyInjection(once, settings);
    expect(stripInjection(twice)).toBe(userText);
    expect(twice.split(PROMPT_START).length - 1).toBe(2); // 用户文本 1 个 + 协议 1 个
  });

  it('does not duplicate blocks when the previous prompt had a trailing block', () => {
    const userText = '你好';
    const injected = applyInjection(userText, settings);
    const again = applyInjection(injected, settings);
    expect(stripInjection(again)).toBe(userText);
    expect(again.endsWith('⟦/DS-UI⟧')).toBe(true);
  });

  it('supports custom protocol text and English mode', () => {
    expect(getProtocol({ protocolLanguage: 'en' })).toMatch(/intelligent UI/i);
    expect(getProtocol({ ...settings, customProtocol: '用极简风格' })).toContain('用极简风格');
  });

  it('requires the dsui fence language in the protocol', () => {
    expect(getProtocol(settings)).toContain('dsui');
    expect(getProtocol(settings)).toMatch(/禁止写成 html/);
  });

  it('allows proactive UI by default and reserves explicit-only for opt-in', () => {
    expect(getProtocol(settings)).toContain('或界面能明显帮助');
    expect(getProtocol({ ...settings, visualPreference: 'explicit' })).toContain('仅在用户明确要求');
    expect(getProtocol({ ...settings, visualPreference: 'frequent' })).toContain('优先考虑交互界面');
  });
});
