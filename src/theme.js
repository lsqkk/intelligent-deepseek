/** 页面明暗主题检测与监听。DeepSeek 在 <body> 上挂 `dark` / `light` class。 */

export function detectTheme() {
  const body = document.body;
  const cls = body?.className || '';
  if (/(^|\s)dark(\s|$)/.test(cls)) return 'dark';
  if (/(^|\s)light(\s|$)/.test(cls)) return 'light';

  // 兜底：按背景亮度推断
  const bg = getComputedStyle(body || document.documentElement).backgroundColor;
  const parsed = parseRgb(bg);
  if (parsed && parsed.a > 0.1) return luminance(parsed) < 0.42 ? 'dark' : 'light';

  try {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** 监听主题变化，返回取消函数 */
export function watchTheme(callback) {
  let last = detectTheme();
  const fire = () => {
    const next = detectTheme();
    if (next !== last) {
      last = next;
      callback(next);
    }
  };

  const observer = new MutationObserver(fire);
  if (document.body) {
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      () => observer.observe(document.body, { attributes: true, attributeFilter: ['class'] }),
      { once: true }
    );
  }

  let mq = null;
  try {
    mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', fire);
  } catch {}

  return () => {
    observer.disconnect();
    mq?.removeEventListener?.('change', fire);
  };
}

function parseRgb(value) {
  const m = String(value || '').match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (parts.length < 3) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function luminance({ r, g, b }) {
  const convert = (channel) => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * convert(r) + 0.7152 * convert(g) + 0.0722 * convert(b);
}
