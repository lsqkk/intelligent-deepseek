/**
 * 提示词注入协议：每轮对话发给 DeepSeek 的用户消息末尾追加一段「界面协议」。
 * 用 ⟦DS-UI v1⟧ ... ⟦/DS-UI⟧ 包裹，历史消息读取时再剥掉，保证界面上看不到注入内容。
 */

export const PROMPT_START = '⟦DS-UI v1⟧';
export const PROMPT_END = '⟦/DS-UI⟧';

const ZH_PROTOCOL = `【强制格式】当你生成可交互界面组件时，代码块语言必须写成 dsui，禁止写成 html（写成 html 客户端只显示源码、无法交互）。
A. 当回答涉及数据可视化、计算/换算、规划、对比、表单、模拟、教学演示、小游戏等，可参考上述触发偏好决定是否生成组件。先给一句简短说明，再用 \`\`\`dsui 代码块输出完整、自包含的 HTML（内联 CSS/JS，禁止外链/CDN/网络请求，图片只用 SVG、data URI 或 emoji；不要使用 localStorage/sessionStorage，状态放内存）。用户要求纯文字或源码时按要求输出；简单问答直接回答。
B. 组件必须真实可交互，初次渲染就展示有用的结果，不要留空等待；避免 100vh 与固定超大高度，高度自适应。
C. 优先一个组件，但不要把很长的页面塞进一个 dsui 块。仅在各部分可独立使用且无共享状态时拆分。标注示例数据和假设，处理空值及非法输入，提供键盘可操作的控件和可见焦点。
D. 视觉要融入对话：组件根节点/body 默认不要设置背景色（保持透明），不要把整体内容再套一层卡片、外框、圆角大背景或阴影；只有按钮、输入框、图表等内部元素可以有必要的样式。
E. 在 :root 定义 --fg、--muted、--border、--accent 主题变量，深色适配用 :root[data-ds-theme="dark"] 覆盖（客户端会在 <html> 上设置 data-ds-theme，可另加 @media (prefers-color-scheme: dark) 兜底）。
F. 需要用户继续对话时，提供明确的操作控件，注明会回传什么；仅在用户点击后调用 window.dsui.sendMessage('用户选择、数值和单位组成的消息')。
G. 一次回答可以输出一个或多个 dsui 块，每个块都必须是完整可运行的 HTML；块内只放代码，关键结论与假设留在正文，语言跟随用户。用户只是要"看代码"时用普通代码块，不要用 dsui。`;

const EN_PROTOCOL = `The client supports "intelligent UI": you can emit runnable interactive components that the client renders automatically.
A. For data visualization, calculations or conversions, planning, comparisons, forms, simulations, tutorials, and mini-games, use the trigger preference above to decide whether to generate a component. Start with a short explanation, then use a \`\`\`dsui fenced block containing a complete self-contained HTML document (inline CSS/JS only; no external links, CDNs or network requests; images only as SVG, data URIs or emoji; no localStorage/sessionStorage — keep state in memory). Honor requests for text or source only. Answer simple questions directly.
B. The component must be genuinely interactive and show useful results on first render; avoid 100vh and fixed oversized heights.
C. Prefer one component, but do not cram a long page into one dsui block. Split only when parts are independently useful and share no state. Label sample data and assumptions, handle empty and invalid input, and provide keyboard controls and visible focus.
D. Blend into the conversation: do NOT set a background color on the root/body by default (keep it transparent), and do NOT wrap everything in another card/frame/rounded panel/shadow. Only inner controls, charts, etc. may have necessary styling.
E. Define theme variables --fg, --muted, --border, --accent on :root and override them for :root[data-ds-theme="dark"] (the client sets data-ds-theme on <html>; a @media (prefers-color-scheme: dark) fallback is optional).
F. When the user needs to continue the conversation, provide a clearly labeled control that explains what will be passed back. Only after the user explicitly activates it, call window.dsui.sendMessage('text') with the selected values and units.
G. A reply may contain one or more dsui blocks, each a complete runnable HTML document; code only inside the blocks. Keep key conclusions and assumptions in the chat and use the same language as the user. Use normal code blocks when the user only wants to read code.`;

const ZH_IMAGES = `H. 用户要求配图时，或图片能帮助读者辨认对象、理解背景或看清细节时，主动在相关段落之间配图，可与 dsui HTML 块并列。
常见场景：介绍公众人物时配肖像（如 Ada Lovelace portrait）；解读社会热点时配背景地点或设施（如 Port of Rotterdam aerial view）；教学时配实物或结构的特写（如 monarch butterfly chrysalis close-up）；讲解景点、历史文物、动植物辨识时也可配图。热点配图仅用于说明背景，不能当作事件现场或事实证据。
手头已有可靠的 HTTPS 图片直链，且已知图片确实对应主题时（例如用户提供或检索结果明确返回的图片文件），单独一段写原生 Markdown 图片 ![简短替代文字](图片直链)。图片直链指向图片文件本身。网页、文章链接和普通引用仍用普通链接。不要只贴裸 URL，也不要根据标题猜图片路径。
只有主题、没有可靠图片直链时，用 \`\`\`dsui-image 围栏代码块，块内只写一行 JSON，例如 {"query":"red panda","count":3}。客户端在 Wikimedia Commons 搜索，可能显示 0 至 6 张。query 用简洁英文关键词，只写公开主题，不包含个人信息。同一主题用一个块，勿重复用两种方式配图。正文应在没有配图时也完整自然。不要写「我找到了」「如下图」或承诺图片数量，也不要描述尚未看到的搜索结果。`;
const EN_IMAGES = `H. When requested, or when images help identify a subject, explain context, or show details, proactively add them between the relevant paragraphs. Images can appear alongside dsui HTML blocks.
Examples include a portrait in a public figure profile (Ada Lovelace portrait), a contextual location or facility in a current-events explainer (Port of Rotterdam aerial view), or a close-up in a lesson (monarch butterfly chrysalis close-up). Images can also help with landmarks, artifacts, and wildlife identification. Context images are illustrative and must not be presented as scenes from the event or evidence for a claim.
Use a standalone native Markdown image, ![brief alt text](direct image URL), only when you already have a reliable HTTPS URL to the image itself and know it depicts the subject, such as a user-provided URL or an explicit search result. Keep articles, web pages, and citations as regular links. Do not paste bare image URLs or guess file paths.
When you have a subject but no reliable direct image URL, use a \`\`\`dsui-image fenced block containing only JSON, e.g. {"query":"red panda","count":3}. Wikimedia Commons may return zero to six usable images. Use concise English keywords for public subjects and omit personal information. Use one block per subject and avoid duplicating images via both formats. Keep the text complete and natural when images are absent. Do not say you found images, refer to images below, promise a result count, or describe unseen results.`;

/** 生成当前配置下的协议正文 */
export function getProtocol(settings) {
  const en = settings?.protocolLanguage === 'en';
  const base = en ? EN_PROTOCOL : ZH_PROTOCOL;
  const preference = settings?.visualPreference;
  const trigger = preference === 'explicit'
    ? (en ? 'Only generate a component when explicitly requested.' : '仅在用户明确要求交互界面、工具或可视化时生成组件。')
    : preference === 'frequent'
      ? (en ? 'Prefer interactive UI for meaningful trends, comparisons and calculations.' : '对有实质内容的趋势、比较和计算，优先考虑交互界面。')
      : (en ? 'Use UI when requested or when it materially improves the task.' : '用户明确要求，或界面能明显帮助理解、计算或决策时，才生成组件。');
  const custom = String(settings?.customProtocol || '').replaceAll(PROMPT_START, '').replaceAll(PROMPT_END, '').trim();
  const label = en ? 'Additional presentation preferences (subject to the current request and component requirements)' : '附加呈现偏好（以本轮要求和组件约束为准）';
  const cards = en
    ? 'I. For current or forecast weather, use a dsui-weather fenced JSON block like {"city":"Beijing","days":5} (1–7 days, or "date":"YYYY-MM-DD" for one specific date). The client fetches weather; do not invent values. For maps, use a dsui-map fenced JSON block like {"city":"Xi’an","places":["Stele Forest Museum","Bell Tower"]}. Give up to 8 ordered public places with specific names. For multiple cities, omit city and qualify each name with its city. The client looks up coordinates. Only use ["name",latitude,longitude] when the user provided exact WGS84 coordinates. Keep place names in the text as a fallback.'
    : 'I. 实况或预报用 dsui-weather 围栏 JSON 块，如 {"city":"北京","days":5}（1–7 天，指定某天可用 "date":"YYYY-MM-DD"）。由客户端查天气，勿编造数值。地点分布或行程用 dsui-map 围栏 JSON 块，如 {"city":"西安","places":["碑林博物馆","钟楼"]}。按顺序写最多 8 个具体的公开地标。跨城市时省略 city，在每个地名里带上城市。坐标由客户端查；用户已提供精确 WGS84 坐标时才用 ["地名",纬度,经度]。正文保留地名。';
  return [trigger, base, en ? EN_IMAGES : ZH_IMAGES, cards, custom && `${label}\n${custom}`].filter(Boolean).join('\n');
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

