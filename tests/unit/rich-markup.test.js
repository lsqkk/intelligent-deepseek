import { describe, expect, it } from 'vitest';
import { diagramKind, readDiagram } from '../../src/diagram.js';
import { MessageEnvironments } from '../../src/environments.js';

function renderMarkup(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const environments = new MessageEnvironments();
  environments.update([root]);
  return { root, environments };
}

describe('styled Markdown environments', () => {
  it('handles alert markers with line breaks and preserves native content', () => {
    const { root, environments } = renderMarkup('<blockquote><p>[!WARNING]<br><a href="/docs">Read this</a></p></blockquote><blockquote><p>普通引文</p></blockquote>');
    const link = root.querySelector('a');
    environments.update([root]);
    expect(root.querySelector('[data-dsui-env]').dataset.dsuiEnv).toBe('warning');
    expect(root.querySelector('[data-dsui-env-heading]').textContent).toBe('警告');
    expect(root.querySelector('br').hasAttribute('data-dsui-env-hidden')).toBe(true);
    expect(root.querySelector('a')).toBe(link);
    expect(root.querySelectorAll('[data-dsui-env]')).toHaveLength(1);
    environments.update([]);
    expect(root.querySelector('p').textContent).toBe('[!WARNING]Read this');
    expect(root.querySelector('[data-dsui-env-hidden]')).toBeNull();
  });

  it('styles a complete academic environment and retains its original DOM', () => {
    const { root, environments } = renderMarkup('<p>::: theorem 勾股定理</p><p>对直角三角形，<span class="katex">a² + b² = c²</span>。</p><ul><li>条件</li></ul><p>:::</p><p>其他段落</p>');
    const formula = root.querySelector('.katex');
    expect(root.querySelector('[data-dsui-env-heading]').textContent).toBe('定理 · 勾股定理');
    expect(root.querySelectorAll('[data-dsui-env="academic"]')).toHaveLength(3);
    expect(root.querySelector('ul').dataset.dsuiEnvEdge).toBe('end');
    expect(root.querySelector('.katex')).toBe(formula);
    environments.update([]);
    expect(root.querySelector('p').textContent).toBe('::: theorem 勾股定理');
    expect(root.lastElementChild.previousElementSibling.textContent).toBe(':::');
  });

  it('waits for closing markers and adapts to React text updates in a single paragraph', () => {
    const { root, environments } = renderMarkup('<p>::: definition\n定义</p><p><code>::: lemma</code></p>');
    const text = root.firstChild.firstChild;
    expect(root.querySelector('[data-dsui-env-heading]')).toBeNull();
    text.data += '\n:::';
    environments.update([root]);
    expect(text.data).toBe('定义');
    expect(root.querySelector('[data-dsui-env-heading]').textContent).toBe('定义');
    text.data = '普通正文';
    environments.update([root]);
    expect(root.querySelector('[data-dsui-env]')).toBeNull();
    expect(text.data).toBe('普通正文');
  });
});

describe('diagram fences', () => {
  it('recognizes diagram languages and leaves native Mermaid untouched', () => {
    expect(diagramKind('infographic')).toBe('infographic');
    expect(diagramKind('puml')).toBe('plantuml');
    expect(diagramKind('mermaid')).toBeNull();
  });

  it('waits for valid diagram markers and supports PlantUML diagram families', () => {
    expect(readDiagram('plantuml', '@startuml\nAlice -> Bob', 'dark')).toBeNull();
    expect(readDiagram('plantuml', '@startmindmap\r\n* 中心\r\n@endmindmap', 'dark')?.theme).toBe('dark');
    expect(readDiagram('infographic', 'template', 'light')).toBeNull();
    expect(readDiagram('infographic', 'infographic list-grid-compact-card\ndata\n  lists\n    - label 信息', 'light')?.kind).toBe('infographic');
  });
});
