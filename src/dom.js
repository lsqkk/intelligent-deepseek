/** DeepSeek 页面 DOM 适配层。选择器基于 2026-11 线上结构，集中在这里便于页面改版时修复。 */

export const SELECTORS = {
  assistantMarkdown: '.ds-markdown.ds-assistant-message-main-content',
  message: '.ds-message',
  codeBlock: '.md-code-block',
  codeInfo: '.md-code-block-infostring',
  userBubble: '.ds-collapsible-text',
  textarea: 'textarea',
};

export function findAssistantRoots(root = document) {
  return [...root.querySelectorAll(SELECTORS.assistantMarkdown)];
}

export function findCodeBlocks(root = document) {
  return [...root.querySelectorAll(SELECTORS.codeBlock)];
}

/** 代码块语言标记，如 ```dsui 里的 dsui。
 * 线上页面用自定义 CodeInfoRow 渲染语言标签（没有 md-code-block-infostring 类），
 * 因此优先取标准类，退化时从 banner 的 textContent 开头解析（banner 文本形如 "html复制下载运行"）。
 */
export function readLang(block) {
  const info = block.querySelector('.md-code-block-infostring');
  if (info) return (info.textContent || '').trim().toLowerCase();
  const banner = block.querySelector('.md-code-block-banner');
  if (!banner) return '';
  const text = (banner.textContent || '').trim();
  const match = text.match(/^([A-Za-z][\w+#.\-]{0,31})/);
  return match ? match[1].toLowerCase() : '';
}

/** 代码块原始代码（React 渲染的是高亮后的 span，textContent 即原文） */
export function readCode(block) {
  return block.querySelector('pre')?.textContent ?? '';
}

/** 是否是本脚本要渲染的代码块 */
export function shouldRenderBlock(block, settings) {
  const lang = readLang(block);
  if (lang === 'dsui' || lang.startsWith('dsui')) return true;
  if (!settings?.renderPlainHtml) return false;
  if (lang === 'html' || lang === 'htm' || lang === 'svg') {
    const code = readCode(block);
    return /<!doctype\s+html|<html[\s>]/i.test(code);
  }
  return false;
}

/** 从 HTML 里提取 <title> 作为卡片标题 */
export function extractTitle(html, fallback = '交互界面') {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = m?.[1]?.trim();
  return title ? decodeEntities(title).slice(0, 80) : fallback;
}
export function clampWidgetHeight(height, viewportHeight = window.innerHeight) {
  const content = Number(height) || 0;
  const min = 140;
  const max = Math.max(min + 80, Math.round(viewportHeight * 0.72));
  return Math.min(Math.max(content, min), max);
}

let decoderEl = null;

function decodeEntities(text) {
  if (!decoderEl) decoderEl = document.createElement('textarea');
  decoderEl.innerHTML = text;
  return decoderEl.value;
}
