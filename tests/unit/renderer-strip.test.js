import { describe, expect, it } from 'vitest';
import { stripInjectionFromNode } from '../../src/renderer.js';
import { applyInjection, PROMPT_START } from '../../src/prompt.js';

const injected = applyInjection('原问题', { enabled: true, protocolLanguage: 'zh', customProtocol: '' });

describe('user bubble fallback cleaning', () => {
  it('removes an injection block split across multiple text nodes', () => {
    const root = document.createElement('div');
    root.className = 'ds-collapsible-text';
    const half = Math.floor(injected.length / 2);
    root.innerHTML = `<div><span>${escape(injected.slice(0, half))}</span><span>${escape(
      injected.slice(half)
    )}</span></div>`;

    expect(root.textContent).toContain(PROMPT_START);
    expect(stripInjectionFromNode(root)).toBe(true);
    expect(root.textContent).not.toContain(PROMPT_START);
    expect(root.textContent).toContain('原问题');
  });

  it('returns false when there is nothing to strip', () => {
    const root = document.createElement('div');
    root.textContent = '普通消息';
    expect(stripInjectionFromNode(root)).toBe(false);
    expect(root.textContent).toBe('普通消息');
  });

  it('keeps a full marker pair quoted by the user and removes only the trailing block', () => {
    const userText = '请解释 ⟦DS-UI v1⟧ 这段 ⟦/DS-UI⟧ 标记';
    const root = document.createElement('div');
    root.textContent = applyInjection(userText, {
      enabled: true,
      protocolLanguage: 'zh',
      customProtocol: '',
    });
    expect(stripInjectionFromNode(root)).toBe(true);
    expect(root.textContent).toBe(userText);
  });

  it('does not delete a start marker without an end marker', () => {
    const root = document.createElement('div');
    root.textContent = '用户提到 ⟦DS-UI v1⟧ 但没有结束标记';
    expect(stripInjectionFromNode(root)).toBe(false);
    expect(root.textContent).toContain('没有结束标记');
  });
});

function escape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
