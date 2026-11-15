import { describe, expect, it } from 'vitest';
import { DataCard, readDataCard } from '../../src/data-card.js';
import { readReference } from '../../src/reference-card.js';

describe('reference cards', () => {
  it.each([
    ['encyclopedia', 'https://baike.baidu.com/search/word', 'word', '百度百科搜索'],
    ['book', 'https://search.douban.com/book/subject_search', 'search_text', '豆瓣读书搜索'],
    ['answer', 'https://www.zhihu.com/search', 'q', '知乎搜索'],
    ['homepage', 'https://www.bing.com/search', 'q', 'Bing搜索'],
    ['article', 'https://www.bing.com/search', 'q', 'Bing搜索'],
    ['resource', 'https://www.bing.com/search', 'q', 'Bing搜索'],
  ])('routes the %s category to its search provider', (category, endpoint, parameter, source) => {
    const query = '三体 & 刘慈欣 #1';
    const request = readReference({ query, category });
    const url = new URL(request.href);
    expect(url.origin + url.pathname).toBe(endpoint);
    expect(url.searchParams.get(parameter)).toBe(query);
    expect(url.hash).toBe('');
    expect(request).toMatchObject({ title: query, source });
  });

  it.each([
    'javascript:alert(1)', 'data:text/html,hi', 'file:///temp/test.html',
    '//example.org', '/relative', 'https:example.org', 'https:///example.org',
    'https://example.org@other.example', 'https://example.org\\@other.example',
    'https://exam\tple.org',
  ])('rejects unsafe or incomplete URLs such as %s', (url) => {
    expect(readReference({ title: 'Example', url })).toBeNull();
  });

  it('hides invalid or incomplete card payloads without treating them as HTML', () => {
    for (const source of ['{"query":', 'null', '[]', '{"query":"三体","category":"__proto__"}', '{"url":"https://example.org"}']) {
      expect(readDataCard('dsui-reference', source)).toEqual({ lang: 'dsui-reference', request: null });
    }
  });

  it('keeps the original code visible when a reference fence cannot be parsed', () => {
    const block = document.createElement('div');
    const card = new DataCard(block, readDataCard('dsui-reference', '{"query":'));
    card.mount();
    expect(card.el.hidden).toBe(true);
    expect(block.hasAttribute('data-dsui-hidden')).toBe(false);
  });

  it.each(['\n', '\\\n', ',\n'])('accepts a single fence with JSON objects separated by %j', (separator) => {
    const entries = [
      { title: 'The Routledge Guidebook', query: 'Routledge Gramsci Schwarzmantel', description: '英文导读', category: 'book' },
      { title: '解析《狱中札记》', query: '葛兰西 狱中札记 上海外语教育出版社', category: 'book' },
      { title: '葛兰西传', query: '葛兰西传 生活就是反抗 弗雷迪内', category: 'book' },
    ];
    const source = entries.map((entry) => JSON.stringify(entry, null, 2)).join(separator);
    const container = document.createElement('div');
    const block = container.appendChild(document.createElement('div'));
    const card = new DataCard(block, readDataCard('dsui-reference', source));
    card.mount();
    const links = [...card.el.querySelectorAll('a')];
    expect(links.map((link) => link.querySelector('strong').textContent)).toEqual(entries.map((entry) => entry.title));
    expect(links.map((link) => new URL(link.href).searchParams.get('search_text'))).toEqual(entries.map((entry) => entry.query));
    expect(block.dataset.dsuiHidden).toBe('1');
  });

  it('renders a direct link as text with its actual host and restores the source on removal', () => {
    const container = document.createElement('div');
    const block = container.appendChild(document.createElement('div'));
    const title = '<img src=x onerror=alert(1)>';
    const url = 'https://example.org/docs#intro';
    const card = new DataCard(block, readDataCard('dsui-reference', JSON.stringify({ title, url, description: '使用指南' })));
    card.mount();

    const link = block.nextElementSibling.querySelector('a');
    expect(card.el.hidden).toBe(false);
    expect(block.dataset.dsuiHidden).toBe('1');
    expect(link.href).toBe(url);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.textContent).toContain('example.org');
    expect(link.textContent).toContain(title);
    expect(link.textContent).toContain('使用指南');
    expect(link.querySelector('img')).toBeNull();

    card.destroy();
    expect(block.hasAttribute('data-dsui-hidden')).toBe(false);
    expect(block.nextElementSibling).toBeNull();
  });
});
