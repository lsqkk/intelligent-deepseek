import { describe, expect, it } from 'vitest';
import {
  clampWidgetHeight,
  extractTitle,
  readCode,
  readLang,
  shouldRenderBlock,
} from '../../src/dom.js';

/** 线上页面实际结构：语言标签在 banner 的第一个 span 里，没有 md-code-block-infostring 类 */
function makeBlock({ lang = 'dsui', code = '<!DOCTYPE html><html><body>hi</body></html>' } = {}) {
  const block = document.createElement('div');
  block.className = 'md-code-block md-code-block-light';
  block.innerHTML = `
    <div class="md-code-block-banner-wrap">
      <div class="md-code-block-banner md-code-block-banner-lite">
        <div class="_121d384">
          <div class="d2a24f03"><span class="d813de27">${lang}</span></div>
          <div class="d2a24f03 _246a029">
            <div role="button"><span class="code-info-button-text">复制</span></div>
          </div>
        </div>
      </div>
    </div>
    <pre><code>${escapeHtml(code)}</code></pre>
  `;
  return block;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

describe('dom helpers', () => {
  it('reads language from banner text when the stabdard class is absent', () => {
    expect(readLang(makeBlock({ lang: 'dsui' }))).toBe('dsui');
    expect(readLang(makeBlock({ lang: 'html' }))).toBe('html');
  });

  it('reads the raw code from pre textContent', () => {
    expect(readCode(makeBlock({ code: '<div>abc</div>' }))).toBe('<div>abc</div>');
  });

  it('renders dsui blocks always and plain html only when enabled', () => {
    const dsui = makeBlock({ lang: 'dsui' });
    const html = makeBlock({ lang: 'html' });
    expect(shouldRenderBlock(dsui, { renderPlainHtml: false })).toBe(true);
    expect(shouldRenderBlock(html, { renderPlainHtml: false })).toBe(false);
    expect(shouldRenderBlock(html, { renderPlainHtml: true })).toBe(true);
    expect(shouldRenderBlock(makeBlock({ lang: 'python' }), { renderPlainHtml: true })).toBe(false);
  });

  it('does not treat a short html snippet as a full document when fallback is on', () => {
    const snippet = makeBlock({ lang: 'html', code: '<div>hello</div>' });
    expect(shouldRenderBlock(snippet, { renderPlainHtml: true })).toBe(false);
  });

  it('extracts and decodes the title', () => {
    expect(extractTitle('<html><head><title>BMI &amp; 计算器</title></head></html>')).toBe('BMI & 计算器');
    expect(extractTitle('<div>no title</div>')).toBe('交互界面');
  });

  it('clamps widget heights', () => {
    expect(clampWidgetHeight(10, 1000)).toBe(140);
    expect(clampWidgetHeight(500, 1000)).toBe(500);
    expect(clampWidgetHeight(5000, 1000)).toBe(720);
  });
});
