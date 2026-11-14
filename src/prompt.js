/**
 * 提示词注入协议：每轮对话发给 DeepSeek 的用户消息末尾追加一段「界面协议」。
 * 用 ⟦DS-UI v1⟧ ... ⟦/DS-UI⟧ 包裹，历史消息读取时再剥掉，保证界面上看不到注入内容。
 */

export const PROMPT_START = '⟦DS-UI v1⟧';
export const PROMPT_END = '⟦/DS-UI⟧';

const ZH_PROTOCOL = `【强制格式】当你生成可交互界面组件时，代码块语言必须写成 dsui，禁止写成 html（写成 html 客户端只显示源码、无法交互）。
A. 当回答涉及数据可视化、计算/换算、规划、对比、表单、模拟、教学演示、小游戏等，用界面能明显提升体验时，先给一句简短说明，然后用 \`\`\`dsui 代码块输出完整、自包含的 HTML（内联 CSS/JS，禁止外链/CDN/网络请求，图片只用 SVG、data URI 或 emoji；不要使用 localStorage/sessionStorage，状态放内存）。简单问答不要输出界面。
B. 组件必须真实可交互，初次渲染就展示有用的结果，不要留空等待；避免 100vh 与固定超大高度，高度自适应。
C. 不要把很长的页面塞进一个 dsui 块：内容多时拆分成 2-5 个 dsui，每个只专注一个交互演示（例如图表一个、表单一个、说明/小游戏一个）。
D. 视觉要融入对话：组件根节点/body 默认不要设置背景色（保持透明），不要把整体内容再套一层卡片、外框、圆角大背景或阴影；只有按钮、输入框、图表等内部元素可以有必要的样式。
E. 在 :root 定义 --fg、--muted、--border、--accent 主题变量，深色适配用 :root[data-ds-theme="dark"] 覆盖（客户端会在 <html> 上设置 data-ds-theme，可另加 @media (prefers-color-scheme: dark) 兜底）。
F. 需要用户继续对话时，调用 window.dsui.sendMessage('要发送给模型的文本')。
G. 一次回答可以输出一个或多个 dsui 块，每个块都必须是完整可运行的 HTML；块内只放代码，块结束后不要再写解释；语言跟随用户。用户只是要"看代码"时用普通代码块，不要用 dsui。`;

const EN_PROTOCOL = `The client supports "intelligent UI": you can emit runnable interactive components that the client renders automatically.
A. When an interactive UI clearly improves the answer (data visualization, calculator/converter, planner, comparison, form, simulation, tutorial, mini-game), append a \`\`\`dsui fenced block containing a complete self-contained HTML document (inline CSS/JS only; no external links, CDNs or network requests; images only as SVG, data URIs or emoji; no localStorage/sessionStorage — keep state in memory). Do not emit UI for simple Q&A.
B. The component must be genuinely interactive and show useful results on first render; avoid 100vh and fixed oversized heights.
C. Do not cram a long page into one dsui block: split into 2-5 dsui blocks, each focused on a single interactive demo (e.g. one chart, one form, one small game).
D. Blend into the conversation: do NOT set a background color on the root/body by default (keep it transparent), and do NOT wrap everything in another card/frame/rounded panel/shadow. Only inner controls, charts, etc. may have necessary styling.
E. Define theme variables --fg, --muted, --border, --accent on :root and override them for :root[data-ds-theme="dark"] (the client sets data-ds-theme on <html>; a @media (prefers-color-scheme: dark) fallback is optional).
F. To continue the conversation from the UI, call window.dsui.sendMessage('text').
G. A reply may contain one or more dsui blocks, each a complete runnable HTML document; code only inside the blocks. Use normal code blocks when the user only wants to read code.`;

/** 生成当前配置下的协议正文 */
export function getProtocol(settings) {
  const base = settings?.protocolLanguage === 'en' ? EN_PROTOCOL : ZH_PROTOCOL;
  const custom = String(settings?.customProtocol || '').trim();
  return custom ? `${base}\nF. 用户附加要求：${custom}` : base;
}

/** 把协议追加到用户 prompt 末尾；若已有旧注入则先剥离，避免重复累积 */
export function applyInjection(prompt, settings) {
  const clean = stripInjection(String(prompt ?? ''));
  if (!settings?.injectPrompt || !clean.trim()) return clean;
  return `${clean}\n\n${PROMPT_START}\n${getProtocol(settings)}\n${PROMPT_END}`;
}

/** 从任意字符串中移除「末尾」的注入块（用于历史消息、代码块内容等）。
 *  只删除以 PROMPT_END 结尾的块，且从最后一个 PROMPT_START 开始；
 *  用户原文里如果碰巧出现 start 标记但没在末尾闭合，不会被误删。 */
export function stripInjection(text) {
  let s = String(text ?? '');
  if (!s.includes(PROMPT_START)) return s;
  for (let guard = 0; guard < 8; guard++) {
    const trailing = s.replace(/\s+$/, '');
    if (!trailing.endsWith(PROMPT_END)) break;
    const endIndex = trailing.length - PROMPT_END.length;
    const startIndex = trailing.lastIndexOf(PROMPT_START, endIndex);
    if (startIndex < 0) break;
    s = trailing.slice(0, startIndex).replace(/\s+$/, '');
  }
  return s;
}

/** 判断字符串末尾是否带有注入块 */
export function hasInjection(text) {
  const s = String(text ?? '');
  if (!s.includes(PROMPT_START)) return false;
  const trailing = s.replace(/\s+$/, '');
  return trailing.endsWith(PROMPT_END) && trailing.lastIndexOf(PROMPT_START) >= 0;
}

