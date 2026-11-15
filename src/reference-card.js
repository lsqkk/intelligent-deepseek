const CATEGORIES = {
  encyclopedia: '百科',
  book: '图书',
  answer: '问答',
  homepage: '主页',
  article: '文章',
  resource: '资源',
};

const SEARCH_SOURCES = {
  encyclopedia: ['百度百科', 'https://baike.baidu.com/search/word', 'word'],
  book: ['豆瓣读书', 'https://search.douban.com/book/subject_search?cat=1001', 'search_text'],
  answer: ['知乎', 'https://www.zhihu.com/search?type=content', 'q'],
};
const WEB_SEARCH = ['Bing', 'https://www.bing.com/search', 'q'];

function readText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function readWebUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  const text = value.trim();
  if (!/^https?:\/\/[^/?#]+/i.test(text) || /[\s\\\u0000-\u001f\u007f]/.test(text)) return null;
  try {
    const url = new URL(text);
    return url.username || url.password ? null : url;
  } catch {
    return null;
  }
}

export function readReference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { category } = value;
  const label = typeof category === 'string' && Object.hasOwn(CATEGORIES, category) ? CATEGORIES[category] : '';
  const description = readText(value.description, 240);

  if (Object.hasOwn(value, 'url')) {
    const url = readWebUrl(value.url);
    const title = readText(value.title, 160);
    if (!url || !title) return null;
    return { title, description, href: url.href, source: url.host, label };
  }

  const query = readText(value.query, 160);
  if (!query || !label) return null;
  const [source, endpoint, param] = Object.hasOwn(SEARCH_SOURCES, category) ? SEARCH_SOURCES[category] : WEB_SEARCH;
  const url = new URL(endpoint);
  url.searchParams.set(param, query);
  return { title: readText(value.title, 160) || query, description, href: url.href, source: `${source}搜索`, label };
}

export function readReferenceCards(source) {
  let values;
  try {
    const value = JSON.parse(source);
    values = Array.isArray(value) ? value : [value];
  } catch {
    // Models sometimes paste consecutive JSON objects in one fence, even with Markdown line breaks.
    const entries = source.trim().split(/(?<=\})[ \t]*,?\\?[ \t]*\r?\n(?=[ \t]*\{)/);
    if (entries.length < 2) return null;
    values = entries.map((entry) => JSON.parse(entry));
  }
  const requests = values.slice(0, 3).map(readReference).filter(Boolean);
  return requests.length ? requests : null;
}

function appendText(parent, tag, text, className) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

export function mountReference(host, { title, description, href, source, label }) {
  const link = document.createElement('a');
  link.className = 'dsui-reference-link';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';

  const body = document.createElement('span');
  body.className = 'dsui-reference-body';
  appendText(body, 'span', label ? `${label} · ${source}` : source, 'dsui-reference-source');
  appendText(body, 'strong', title, 'dsui-reference-title');
  if (description) appendText(body, 'span', description, 'dsui-reference-description');
  link.append(body);
  appendText(link, 'span', '↗', 'dsui-reference-arrow').setAttribute('aria-hidden', 'true');
  host.append(link);
  host.hidden = false;
}

export function mountReferences(host, requests) {
  for (const request of requests) mountReference(host, request);
}
