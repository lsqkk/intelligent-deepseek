const COMMONS = 'https://commons.wikimedia.org';
const searches = new Map();

export function readImageRequest(code) {
  try {
    const value = JSON.parse(code);
    const query = typeof value?.query === 'string' ? value.query.trim() : '';
    const count = value?.count ?? 1;
    if (!query || query.length > 120 || !Number.isInteger(count) || count < 1 || count > 6) return null;
    return { query, count };
  } catch {
    return null;
  }
}

/** Recognize a standalone Markdown image or auto-linked image URL. */
export function readDirectImage(block) {
  const child = block.firstElementChild;
  if (!child || block.childElementCount !== 1) return null;
  const image = child.matches('img') ? child : child.querySelector(':scope > img:only-child');
  if (image && !block.textContent.trim()) {
    const src = httpsImageUrl(image.getAttribute('src'));
    return src && { src, href: src, title: image.getAttribute('alt') || '查看原图' };
  }
  if (!child.matches('a') || block.textContent.trim() !== child.textContent.trim()) return null;
  const src = httpsImageUrl(child.getAttribute('href'));
  if (!src || !/\.(?:avif|gif|jpe?g|png|webp)(?:$|\/)/i.test(new URL(src).pathname)) return null;
  const label = child.textContent.trim();
  // Preserve named links such as citations and download links.
  if (httpsImageUrl(label) !== src) return null;
  return { src, href: src, title: '查看原图' };
}

function httpsImageUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch {}
  return null;
}

async function requestJson(url) {
  if (typeof GM_xmlhttpRequest === 'function') {
    return new Promise((resolve, reject) => {
      let timer;
      const fail = () => {
        clearTimeout(timer);
        reject(new Error('图片搜索失败'));
      };
      const request = GM_xmlhttpRequest({
        method: 'GET', url: url.href, anonymous: true, responseType: 'json',
        onload(response) {
          if (response.status < 200 || response.status >= 300) return fail();
          clearTimeout(timer);
          resolve(response.response);
        },
        onerror: fail,
        onabort: fail,
        ontimeout: fail,
      });
      timer = setTimeout(() => {
        reject(new Error('图片搜索超时'));
        request?.abort();
      }, 12000);
    });
  }
  const response = await fetch(url, {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('图片搜索失败');
  return response.json();
}

function search({ query, count }) {
  const key = JSON.stringify([query, count]);
  if (searches.has(key)) return searches.get(key);
  const url = new URL('/w/api.php', COMMONS);
  url.search = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    generator: 'search', gsrnamespace: '6', gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: String(count * 2), prop: 'imageinfo', iiprop: 'url|mime', iiurlwidth: '640',
  });
  const pending = requestJson(url).then((data) => {
    if (!data || data.error) throw new Error('图片搜索失败');
    const pages = data.query?.pages ?? [];
    return pages.sort((a, b) => a.index - b.index).flatMap(({ title, imageinfo }) => {
      const image = imageinfo?.[0];
      if (!title?.startsWith('File:') || !/^image\/(?:jpeg|png|webp|gif)$/.test(image?.mime)) return [];
      const src = image.thumburl || image.url;
      if (!/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(src)) return [];
      return [{
        src,
        title: title.slice(5).replace(/_/g, ' '),
        href: `${COMMONS}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
      }];
    }).slice(0, count);
  }).catch((error) => {
    if (searches.get(key) === pending) searches.delete(key);
    throw error;
  });
  searches.set(key, pending);
  if (searches.size > 40) searches.delete(searches.keys().next().value);
  return pending;
}

export class ImageGallery {
  constructor(block, request) {
    this.block = block;
    this.request = request;
    this.key = JSON.stringify(request);
    this.el = document.createElement('div');
    this.el.className = 'dsui-image-gallery';
    this.el.hidden = true;
  }

  mount() {
    this.block.setAttribute('data-dsui-image-source', '');
    this.block.after(this.el);
    if (this.request) this.load();
  }

  async load() {
    const images = this.request.src ? [this.request] : await search(this.request).catch(() => []);
    if (this.destroyed) return;
    for (const { src, title, href } of images) {
      const link = document.createElement('a');
      link.hidden = true;
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = title;
      const frame = document.createElement('div');
      frame.className = 'dsui-image-frame';
      const image = document.createElement('img');
      image.alt = title;
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('load', () => {
        link.hidden = false;
        this.el.hidden = false;
      }, { once: true });
      image.addEventListener('error', () => link.remove(), { once: true });
      const caption = document.createElement('span');
      caption.textContent = this.request.src ? `${new URL(src).hostname} ↗` : 'Wikimedia Commons ↗';
      frame.append(image);
      link.append(frame, caption);
      this.el.append(link);
      image.src = src;
    }
  }

  destroy() {
    this.destroyed = true;
    this.el.remove();
    this.block.removeAttribute('data-dsui-image-source');
  }
}
