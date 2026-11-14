import { describe, expect, it } from 'vitest';
import { adaptThemeCss, buildWidgetDoc, isRenderable } from '../../src/widget.js';

const token = 'tok-test-123';

describe('widget document builder', () => {
  it('injects CSP, theme and the bridge into a full document', () => {
    const doc = buildWidgetDoc('<!DOCTYPE html><html><head><title>T</title></head><body><p>hi</p></body></html>', {
      token,
      theme: 'dark',
    });
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain('data-ds-theme="dark"');
    expect(doc).toContain('tok-test-123');
    expect(doc).toContain('window.dsui');
    expect(doc.indexOf('window.dsui')).toBeLessThan(doc.indexOf('</body>'));
    expect(doc).toContain('<title>T</title>');
  });

  it('wraps fragments into a complete document', () => {
    const doc = buildWidgetDoc('<div>fragment</div>', { token, theme: 'light' });
    expect(doc.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(doc).toContain('<div>fragment</div>');
    expect(doc).toContain('data-ds-theme="light"');
  });

  it('adds a doctype when missing', () => {
    const doc = buildWidgetDoc('<html><body>x</body></html>', { token, theme: 'light' });
    expect(doc.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  it('only exposes network-free CSP directives', () => {
    const doc = buildWidgetDoc('<div>x</div>', { token, theme: 'light' });
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("object-src 'none'");
    expect(doc).toContain("form-action 'none'");
  });

  it('unwraps dark media queries when the page theme is dark', () => {
    const css = `body{background:#fff}@media (prefers-color-scheme: dark){body{background:#111}}
      @media (prefers-color-scheme: light){body{color:#000}}`;
    const dark = adaptThemeCss(`<style>${css}</style>`, 'dark');
    expect(dark).toContain('body{background:#111}');
    expect(dark).not.toContain('prefers-color-scheme');
    expect(dark).not.toContain('body{color:#000}');

    const light = adaptThemeCss(`<style>${css}</style>`, 'light');
    expect(light).not.toContain('#111');
    expect(light).toContain('body{color:#000}');
    expect(light).not.toContain('prefers-color-scheme');
  });

  it('keeps combined media queries intact and skips comments/strings', () => {
    const css = `/* @media (prefers-color-scheme: dark) { } */
      .a{content:"@media"}
      @media (max-width:600px) and (prefers-color-scheme: dark){.b{color:red}}`;
    const dark = adaptThemeCss(`<style>${css}</style>`, 'dark');
    expect(dark).toContain('@media (max-width:600px) and (prefers-color-scheme: dark)');
    expect(dark).toContain('content:"@media"');
    const light = adaptThemeCss(`<style>${css}</style>`, 'light');
    expect(light).toContain('content:"@media"');
    expect(light).toContain('@media (max-width:600px)');
  });

  it('decides when streamed HTML is renderable', () => {
    expect(isRenderable('<div')).toBe(false);
    expect(isRenderable('<div>' + 'x'.repeat(40) + '</div>')).toBe(false);
    expect(isRenderable('<!doctype html><html><body>hello</body></html>')).toBe(true);
    // 没有 body 的片段在流式阶段先不渲染（finalize 时会兜底渲染）
    expect(isRenderable('<div>' + 'x'.repeat(600) + '</div>')).toBe(false);
    expect(isRenderable('<body><div>' + 'x'.repeat(600) + '</div></body>')).toBe(true);
  });
});
