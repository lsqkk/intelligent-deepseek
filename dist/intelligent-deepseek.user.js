// ==UserScript==
// @name         DeepSeek Intelligent UI
// @name:zh-CN   DeepSeek 智能交互界面
// @namespace    lsqkk.intelligent-deepseek
// @version      1.3.1
// @description  Bring GPT-6 Intelligent-UI style interactive HTML rendering to chat.deepseek.com: first-turn protocol injection, streaming dsui widgets, and widget-to-chat actions.
// @description:zh-CN  给 chat.deepseek.com 引入类似 GPT-6 Intelligent UI 的机制：新会话首条消息注入界面协议、流式渲染可交互 HTML 组件、组件可回传消息继续对话。
// @author       lsqkk
// @license      MIT
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      commons.wikimedia.org
// @noframes
// ==/UserScript==

(() => {
  // src/settings.js
  var STORAGE_KEY = "__dsui_settings_v1";
  var DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    injectPrompt: true,
    injectEveryTurn: false,
    autoRender: true,
    renderPlainHtml: false,
    allowWidgetSend: true,
    widgetSendMode: "draft",
    protocolLanguage: "zh",
    visualPreference: "auto",
    customProtocol: "",
    showFab: true,
    debug: false
  });
  function gmGet(key) {
    try {
      if (typeof GM_getValue === "function") return GM_getValue(key);
    } catch {
    }
    return void 0;
  }
  function gmSet(key, value) {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
        return true;
      }
    } catch {
    }
    return false;
  }
  function loadSettings() {
    let raw = gmGet(STORAGE_KEY);
    if (raw == null) {
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch {
      }
    }
    let parsed = null;
    if (raw) {
      try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
      }
    }
    return normalize(parsed);
  }
  function saveSettings(settings) {
    const normalized = normalize(settings);
    const text = JSON.stringify(normalized);
    if (!gmSet(STORAGE_KEY, normalized)) {
      try {
        localStorage.setItem(STORAGE_KEY, text);
      } catch {
      }
    }
    return normalized;
  }
  function updateSettings(patch) {
    return saveSettings({ ...loadSettings(), ...patch });
  }
  function normalize(value) {
    const out = { ...DEFAULT_SETTINGS };
    if (value && typeof value === "object") {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (value[key] !== void 0 && typeof value[key] === typeof DEFAULT_SETTINGS[key]) {
          out[key] = value[key];
        }
      }
      if (!["auto", "explicit", "frequent"].includes(out.visualPreference)) {
        out.visualPreference = DEFAULT_SETTINGS.visualPreference;
      }
      if (out.widgetSendMode !== "send") out.widgetSendMode = DEFAULT_SETTINGS.widgetSendMode;
    }
    return out;
  }

  // src/prompt.js
  var PROMPT_START = "⟦DS-UI v1⟧";
  var PROMPT_END = "⟦/DS-UI⟧";
  var ZH_PROTOCOL = `【强制格式】当你生成可交互界面组件时，代码块语言必须写成 dsui，禁止写成 html（写成 html 客户端只显示源码、无法交互）。
A. 当回答涉及数据可视化、计算/换算、规划、对比、表单、模拟、教学演示、小游戏等，可参考上述触发偏好决定是否生成组件。先给一句简短说明，再用 \`\`\`dsui 代码块输出完整、自包含的 HTML（内联 CSS/JS，禁止外链/CDN/网络请求，图片只用 SVG、data URI 或 emoji；不要使用 localStorage/sessionStorage，状态放内存）。用户要求纯文字或源码时按要求输出；简单问答直接回答。
B. 组件必须真实可交互，初次渲染就展示有用的结果，不要留空等待；避免 100vh 与固定超大高度，高度自适应。
C. 优先一个组件，但不要把很长的页面塞进一个 dsui 块。仅在各部分可独立使用且无共享状态时拆分。标注示例数据和假设，处理空值及非法输入，提供键盘可操作的控件和可见焦点。
D. 视觉要融入对话：组件根节点/body 默认不要设置背景色（保持透明），不要把整体内容再套一层卡片、外框、圆角大背景或阴影；只有按钮、输入框、图表等内部元素可以有必要的样式。
E. 在 :root 定义 --fg、--muted、--border、--accent 主题变量，深色适配用 :root[data-ds-theme="dark"] 覆盖（客户端会在 <html> 上设置 data-ds-theme，可另加 @media (prefers-color-scheme: dark) 兜底）。
F. 需要用户继续对话时，提供明确的操作控件，注明会回传什么；仅在用户点击后调用 window.dsui.sendMessage('用户选择、数值和单位组成的消息')。
G. 一次回答可以输出一个或多个 dsui 块，每个块都必须是完整可运行的 HTML；块内只放代码，关键结论与假设留在正文，语言跟随用户。用户只是要"看代码"时用普通代码块，不要用 dsui。`;
  var EN_PROTOCOL = `The client supports "intelligent UI": you can emit runnable interactive components that the client renders automatically.
A. For data visualization, calculations or conversions, planning, comparisons, forms, simulations, tutorials, and mini-games, use the trigger preference above to decide whether to generate a component. Start with a short explanation, then use a \`\`\`dsui fenced block containing a complete self-contained HTML document (inline CSS/JS only; no external links, CDNs or network requests; images only as SVG, data URIs or emoji; no localStorage/sessionStorage — keep state in memory). Honor requests for text or source only. Answer simple questions directly.
B. The component must be genuinely interactive and show useful results on first render; avoid 100vh and fixed oversized heights.
C. Prefer one component, but do not cram a long page into one dsui block. Split only when parts are independently useful and share no state. Label sample data and assumptions, handle empty and invalid input, and provide keyboard controls and visible focus.
D. Blend into the conversation: do NOT set a background color on the root/body by default (keep it transparent), and do NOT wrap everything in another card/frame/rounded panel/shadow. Only inner controls, charts, etc. may have necessary styling.
E. Define theme variables --fg, --muted, --border, --accent on :root and override them for :root[data-ds-theme="dark"] (the client sets data-ds-theme on <html>; a @media (prefers-color-scheme: dark) fallback is optional).
F. When the user needs to continue the conversation, provide a clearly labeled control that explains what will be passed back. Only after the user explicitly activates it, call window.dsui.sendMessage('text') with the selected values and units.
G. A reply may contain one or more dsui blocks, each a complete runnable HTML document; code only inside the blocks. Keep key conclusions and assumptions in the chat and use the same language as the user. Use normal code blocks when the user only wants to read code.`;
  var ZH_IMAGES = `H. 用户要求配图时，或图片能帮助读者辨认对象、理解背景或看清细节时，主动在相关段落之间配图，可与 dsui HTML 块并列。
常见场景：介绍公众人物时配肖像（如 Ada Lovelace portrait）；解读社会热点时配背景地点或设施（如 Port of Rotterdam aerial view）；教学时配实物或结构的特写（如 monarch butterfly chrysalis close-up）；讲解景点、历史文物、动植物辨识时也可配图。热点配图仅用于说明背景，不能当作事件现场或事实证据。
手头已有可靠的 HTTPS 图片直链，且已知图片确实对应主题时（例如用户提供或检索结果明确返回的图片文件），单独一段写原生 Markdown 图片 ![简短替代文字](图片直链)。图片直链指向图片文件本身。网页、文章链接和普通引用仍用普通链接。不要只贴裸 URL，也不要根据标题猜图片路径。
只有主题、没有可靠图片直链时，用 \`\`\`dsui-image 围栏代码块，块内只写一行 JSON，例如 {"query":"red panda","count":3}。客户端在 Wikimedia Commons 搜索，可能显示 0 至 6 张。query 用简洁英文关键词，只写公开主题，不包含个人信息。同一主题用一个块，勿重复用两种方式配图。正文应在没有配图时也完整自然。不要写「我找到了」「如下图」或承诺图片数量，也不要描述尚未看到的搜索结果。`;
  var EN_IMAGES = `H. When requested, or when images help identify a subject, explain context, or show details, proactively add them between the relevant paragraphs. Images can appear alongside dsui HTML blocks.
Examples include a portrait in a public figure profile (Ada Lovelace portrait), a contextual location or facility in a current-events explainer (Port of Rotterdam aerial view), or a close-up in a lesson (monarch butterfly chrysalis close-up). Images can also help with landmarks, artifacts, and wildlife identification. Context images are illustrative and must not be presented as scenes from the event or evidence for a claim.
Use a standalone native Markdown image, ![brief alt text](direct image URL), only when you already have a reliable HTTPS URL to the image itself and know it depicts the subject, such as a user-provided URL or an explicit search result. Keep articles, web pages, and citations as regular links. Do not paste bare image URLs or guess file paths.
When you have a subject but no reliable direct image URL, use a \`\`\`dsui-image fenced block containing only JSON, e.g. {"query":"red panda","count":3}. Wikimedia Commons may return zero to six usable images. Use concise English keywords for public subjects and omit personal information. Use one block per subject and avoid duplicating images via both formats. Keep the text complete and natural when images are absent. Do not say you found images, refer to images below, promise a result count, or describe unseen results.`;
  function getProtocol(settings) {
    const en = settings?.protocolLanguage === "en";
    const base = en ? EN_PROTOCOL : ZH_PROTOCOL;
    const preference = settings?.visualPreference;
    const trigger = preference === "explicit" ? en ? "Only generate a component when explicitly requested." : "仅在用户明确要求交互界面、工具或可视化时生成组件。" : preference === "frequent" ? en ? "Prefer interactive UI for meaningful trends, comparisons and calculations." : "对有实质内容的趋势、比较和计算，优先考虑交互界面。" : en ? "Use UI when requested or when it materially improves the task." : "用户明确要求，或界面能明显帮助理解、计算或决策时，才生成组件。";
    const custom = String(settings?.customProtocol || "").replaceAll(PROMPT_START, "").replaceAll(PROMPT_END, "").trim();
    const label = en ? "Additional presentation preferences (subject to the current request and component requirements)" : "附加呈现偏好（以本轮要求和组件约束为准）";
    return [trigger, base, en ? EN_IMAGES : ZH_IMAGES, custom && `${label}
${custom}`].filter(Boolean).join("\n");
  }
  function applyInjection(prompt, settings) {
    const clean = stripInjection(String(prompt ?? ""));
    if (!settings?.injectPrompt || !clean.trim()) return clean;
    return `${clean}

${PROMPT_START}
${getProtocol(settings)}
${PROMPT_END}`;
  }
  function stripInjection(text) {
    let s = String(text ?? "");
    if (!s.includes(PROMPT_START)) return s;
    for (let guard = 0; guard < 8; guard++) {
      const trailing = s.replace(/\s+$/, "");
      if (!trailing.endsWith(PROMPT_END)) break;
      const endIndex = trailing.length - PROMPT_END.length;
      const startIndex = trailing.lastIndexOf(PROMPT_START, endIndex);
      if (startIndex < 0) break;
      s = trailing.slice(0, startIndex).replace(/\s+$/, "");
    }
    return s;
  }

  // src/sanitize.js
  var MAX_DEPTH = 60;
  function sanitizeDeep(value, depth = 0) {
    if (depth > MAX_DEPTH) return value;
    if (typeof value === "string") {
      return value.includes(PROMPT_START) ? stripInjection(value) : value;
    }
    if (Array.isArray(value)) {
      let changed = false;
      const out = value.map((item) => {
        const next = sanitizeDeep(item, depth + 1);
        if (next !== item) changed = true;
        return next;
      });
      return changed ? out : value;
    }
    if (value && typeof value === "object") {
      let changed = false;
      const out = {};
      for (const key of Object.keys(value)) {
        const next = sanitizeDeep(value[key], depth + 1);
        if (next !== value[key]) changed = true;
        out[key] = next;
      }
      return changed ? out : value;
    }
    return value;
  }
  function sanitizeJsonText(text) {
    if (typeof text !== "string" || !text.includes(PROMPT_START)) return text;
    try {
      return JSON.stringify(sanitizeDeep(JSON.parse(text)));
    } catch {
      return text;
    }
  }

  // src/env.js
  function getPageWindow() {
    try {
      if (typeof unsafeWindow !== "undefined" && unsafeWindow) return unsafeWindow;
    } catch {
    }
    return window;
  }
  var IS_TAMPERMONKEY = (() => {
    try {
      return typeof GM_getValue === "function" || typeof GM_registerMenuCommand === "function";
    } catch {
      return false;
    }
  })();

  // src/inject.js
  var COMPLETION_URLS = ["/api/v0/chat/completion", "/api/v0/chat/edit_message"];
  var HISTORY_URLS = ["/api/v0/chat/history_messages", "/api/v0/share/content"];
  var INJECTED_KEY = "__dsui_injected_sessions_v1";
  var MAX_TRACKED_SESSIONS = 100;
  var installed = false;
  var injectedSessions = loadInjectedSessions();
  function loadInjectedSessions() {
    try {
      const raw = localStorage.getItem(INJECTED_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  function markSessionInjected(sessionId) {
    if (!sessionId) return;
    injectedSessions[sessionId] = Date.now();
    const keys = Object.keys(injectedSessions);
    if (keys.length > MAX_TRACKED_SESSIONS) {
      keys.sort((a, b) => Number(injectedSessions[a]) - Number(injectedSessions[b])).slice(0, keys.length - MAX_TRACKED_SESSIONS).forEach((key) => delete injectedSessions[key]);
    }
    try {
      localStorage.setItem(INJECTED_KEY, JSON.stringify(injectedSessions));
    } catch {
    }
  }
  function shouldInjectPrompt(settings, sessionId, injected = injectedSessions) {
    if (!settings?.enabled || !settings.injectPrompt) return false;
    if (settings.injectEveryTurn) return true;
    if (!sessionId) return true;
    return !injected[sessionId];
  }
  function installInterceptors(getSettings2) {
    if (installed) return;
    installed = true;
    patchXHR(getSettings2);
    patchFetch(getSettings2);
  }
  var isCompletion = (url) => COMPLETION_URLS.some((part) => url.includes(part));
  var isHistory = (url) => HISTORY_URLS.some((part) => url.includes(part));
  function patchXHR(getSettings2) {
    const pageWindow = getPageWindow();
    const proto = pageWindow.XMLHttpRequest.prototype;
    const nativeOpen = proto.open;
    const nativeSend = proto.send;
    const responseDesc = Object.getOwnPropertyDescriptor(pageWindow.XMLHttpRequest.prototype, "response");
    const responseTextDesc = Object.getOwnPropertyDescriptor(pageWindow.XMLHttpRequest.prototype, "responseText");
    proto.open = function(method, url, ...rest) {
      try {
        this.__dsuiUrl = String(url ?? "");
        this.__dsuiCleaner = false;
      } catch {
      }
      return nativeOpen.call(this, method, url, ...rest);
    };
    proto.send = function(body) {
      try {
        const url = this.__dsuiUrl || "";
        const settings = getSettings2();
        if (isHistory(url) && responseDesc) {
          installXhrResponseCleaner(this, responseDesc, responseTextDesc);
        }
        if (settings?.enabled) {
          if (settings.injectPrompt && typeof body === "string" && isCompletion(url)) {
            body = injectIntoJsonBody(body, settings);
          }
          if (isCompletion(url)) {
            this.addEventListener(
              "loadend",
              () => {
                try {
                  const pageWindow2 = getPageWindow();
                  pageWindow2.__dsuiCompletionAt = Date.now();
                  pageWindow2.__dsuiCompletionCount = (pageWindow2.__dsuiCompletionCount || 0) + 1;
                  pageWindow2.dispatchEvent(new CustomEvent("dsui:completion-end", { detail: { url } }));
                } catch {
                }
              },
              { once: true }
            );
          }
        }
      } catch (error) {
        reportError(error);
      }
      return nativeSend.call(this, body);
    };
    function installXhrResponseCleaner(xhr, respDesc, textDesc) {
      if (xhr.__dsuiCleaner) return;
      xhr.__dsuiCleaner = true;
      let cachedResponse;
      let cachedText;
      let responseReady = false;
      let textReady = false;
      try {
        Object.defineProperty(xhr, "response", {
          configurable: true,
          get() {
            try {
              const native = respDesc.get.call(this);
              if (this.readyState !== 4) return native;
              if (responseReady) return cachedResponse;
              let out = native;
              try {
                if (this.responseType === "json" || native && typeof native === "object") {
                  out = sanitizeDeep(native);
                } else if (typeof native === "string") {
                  out = sanitizeJsonText(native);
                }
              } catch {
                out = native;
              }
              cachedResponse = out;
              responseReady = true;
              return out;
            } catch {
              return void 0;
            }
          }
        });
      } catch {
      }
      if (textDesc) {
        try {
          Object.defineProperty(xhr, "responseText", {
            configurable: true,
            get() {
              let native;
              try {
                native = textDesc.get.call(this);
              } catch {
                return void 0;
              }
              if (this.readyState !== 4) return native;
              if (textReady) return cachedText;
              try {
                cachedText = sanitizeJsonText(native);
              } catch {
                cachedText = native;
              }
              textReady = true;
              return cachedText;
            }
          });
        } catch {
        }
      }
    }
  }
  function patchFetch(getSettings2) {
    const pageWindow = getPageWindow();
    if (typeof pageWindow.fetch !== "function") return;
    const nativeFetch = pageWindow.fetch;
    pageWindow.fetch = async function(input, init) {
      const url = typeof input === "string" ? input : input instanceof pageWindow.Request ? input.url : String(input?.url || input || "");
      const settings = getSettings2();
      let nextInput = input;
      let nextInit = init;
      try {
        if (settings?.enabled && settings.injectPrompt && isCompletion(url)) {
          if (typeof pageWindow.Request !== "undefined" && input && typeof input === "object" && input instanceof pageWindow.Request) {
            const text = await input.clone().text();
            const injected = injectIntoJsonBody(text, settings);
            if (injected !== text) {
              const headers = new pageWindow.Headers(input.headers);
              headers.delete("content-length");
              nextInput = new pageWindow.Request(input, { body: injected, headers });
            }
          } else if (init && typeof init.body === "string") {
            nextInit = { ...init, body: injectIntoJsonBody(init.body, settings) };
          }
        }
      } catch (error) {
        reportError(error);
      }
      const response = await nativeFetch.call(this, nextInput, nextInit);
      if (isHistory(url)) {
        return cleanFetchResponse(response);
      }
      return response;
    };
  }
  async function cleanFetchResponse(response) {
    try {
      const pageWindow = getPageWindow();
      const clone = response.clone();
      const text = await clone.text();
      const cleaned = sanitizeJsonText(text);
      if (cleaned === text) return response;
      const headers = new pageWindow.Headers(response.headers);
      headers.delete("content-length");
      return new pageWindow.Response(cleaned, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch {
      return response;
    }
  }
  function injectIntoJsonBody(body, settings) {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return body;
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.prompt !== "string") return body;
    const sessionId = typeof parsed.chat_session_id === "string" ? parsed.chat_session_id : "";
    if (!shouldInjectPrompt(settings, sessionId)) return body;
    const nextPrompt = applyInjection(parsed.prompt, settings);
    if (nextPrompt === parsed.prompt) return body;
    parsed.prompt = nextPrompt;
    markSessionInjected(sessionId);
    try {
      const pageWindow = getPageWindow();
      pageWindow.__dsuiInjectedCount = (pageWindow.__dsuiInjectedCount || 0) + 1;
    } catch {
    }
    return JSON.stringify(parsed);
  }
  function reportError(error) {
    try {
      console.warn("[DS-UI] interceptor error:", error);
    } catch {
    }
  }

  // src/styles.js
  var STYLE_ID = "dsui-global-style";
  var CSS = `
.md-code-block[data-dsui-hidden="1"] { display: none !important; }
[data-dsui-image-source] { display: none !important; }
.dsui-image-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr));
  gap: 10px;
  margin: 12px 0;
}
.dsui-image-gallery a { min-width: 0; color: inherit; font-size: 12px; }
.dsui-image-gallery[hidden],
.dsui-image-gallery > a[hidden] { display: none !important; }
.dsui-image-gallery .dsui-image-frame {
  position: relative;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  border-radius: 12px;
}
.ds-markdown .dsui-image-gallery .dsui-image-frame > img {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  max-width: none;
  max-height: none;
  margin: 0;
  object-fit: cover !important;
  object-position: center;
}
.dsui-image-gallery > a > span { display: block; margin-top: 5px; }

.dsui-widget {
  --dsui-bg: #ffffff;
  --dsui-fg: #1f2329;
  --dsui-muted: #8a8f98;
  --dsui-border: #e4e7ec;
  --dsui-soft: #f6f7f9;
  --dsui-accent: #4d6bfe;
  --dsui-shadow: 0 1px 2px rgba(16, 24, 40, .04), 0 8px 24px rgba(16, 24, 40, .06);
  position: relative;
  margin: 14px 0 18px;
  border: 1px solid var(--dsui-border);
  border-radius: 14px;
  background: var(--dsui-bg);
  color: var(--dsui-fg);
  box-shadow: var(--dsui-shadow);
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.5;
  animation: dsui-in .18s ease-out;
}
@keyframes dsui-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }

body.dark .dsui-widget,
html.dark .dsui-widget {
  --dsui-bg: #1c1d1f;
  --dsui-fg: #e7e9ee;
  --dsui-muted: #9aa0aa;
  --dsui-border: #2f3136;
  --dsui-soft: #232427;
  --dsui-accent: #6b85ff;
  --dsui-shadow: 0 1px 2px rgba(0, 0, 0, .25), 0 12px 32px rgba(0, 0, 0, .28);
}

.dsui-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--dsui-border);
  background: var(--dsui-soft);
  min-height: 36px;
  box-sizing: border-box;
}
.dsui-mark {
  color: var(--dsui-accent);
  font-size: 13px;
  line-height: 1;
}
.dsui-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsui-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 46%;
}
.dsui-status {
  font-size: 11.5px;
  color: var(--dsui-muted);
  white-space: nowrap;
  margin-left: auto;
}
.dsui-status[data-busy="1"]::after {
  content: "";
  display: inline-block;
  width: 5px; height: 5px;
  margin-left: 5px;
  border-radius: 50%;
  background: var(--dsui-accent);
  vertical-align: 1px;
  animation: dsui-pulse 1.1s ease-in-out infinite;
}
@keyframes dsui-pulse { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
.dsui-actions {
  margin-left: 6px;
  display: flex;
  gap: 2px;
  align-items: center;
}
.dsui-btn {
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  background: transparent;
  color: var(--dsui-muted);
  font-size: 12px;
  font-family: inherit;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 7px;
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
}
.dsui-btn:hover { background: var(--dsui-border); color: var(--dsui-fg); }
.dsui-btn.is-active { background: var(--dsui-accent); color: #fff; }
.dsui-btn:focus-visible { outline: 2px solid var(--dsui-accent); outline-offset: 1px; }

.dsui-body { position: relative; }
.dsui-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: var(--dsui-muted);
  background: var(--dsui-bg);
  z-index: 1;
}
.dsui-placeholder.is-hidden { display: none; }
.dsui-spinner {
  width: 13px; height: 13px;
  border: 2px solid var(--dsui-border);
  border-top-color: var(--dsui-accent);
  border-radius: 50%;
  animation: dsui-spin .8s linear infinite;
}
@keyframes dsui-spin { to { transform: rotate(360deg); } }
.dsui-frame {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  height: 260px;
  opacity: 0;
  transition: height .16s ease, opacity .18s ease;
}
.dsui-frame.is-ready { opacity: 1; }
.dsui-code {
  margin: 0;
  padding: 12px 14px;
  max-height: 62vh;
  overflow: auto;
  background: var(--dsui-soft);
  color: var(--dsui-fg);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  white-space: pre;
  tab-size: 2;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.dsui-code::-webkit-scrollbar { width: 0; height: 0; display: none; }
.dsui-code code { font: inherit; color: inherit; }

/* dsui：去掉卡片外框，融入对话；高度自然延展 */
.dsui-widget[data-kind="dsui"] {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  margin: 8px 0 14px;
  overflow: visible;
  animation: none;
}
.dsui-widget[data-kind="dsui"] .dsui-placeholder {
  position: static;
  min-height: 72px;
  background: transparent;
  color: var(--dsui-muted);
}
.dsui-widget[data-kind="dsui"] .dsui-frame { background: transparent; }
.dsui-widget[data-kind="dsui"] .dsui-foot {
  border: 0;
  background: transparent;
  padding: 4px 2px 0;
}
.dsui-widget[data-kind="dsui"] .dsui-code { border-radius: 10px; }

/* 长组件底部用轻微渐隐提示还有内容（不遮挡交互） */
.dsui-widget[data-kind="dsui"] .dsui-body::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 14px;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--dsui-bg) 55%, transparent));
  opacity: 0;
  transition: opacity .2s ease;
}
.dsui-widget[data-kind="dsui"][data-overflow="1"] .dsui-body::after { opacity: 1; }
.dsui-foot {
  padding: 7px 12px;
  border-top: 1px solid var(--dsui-border);
  background: var(--dsui-soft);
  color: #c2410c;
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
body.dark .dsui-foot, html.dark .dsui-foot { color: #fb923c; }

/* 设置入口按钮：默认与输入框的附件按钮并排 */
#dsui-fab {
  position: static;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  margin: 0 2px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #8a8f98;
  font-size: 15px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background .12s ease, color .12s ease;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#dsui-fab:hover { background: rgba(127, 127, 127, .14); color: #4d6bfe; }
body.dark #dsui-fab, html.dark #dsui-fab { color: #9aa0aa; }
body.dark #dsui-fab:hover, html.dark #dsui-fab:hover { color: #8fa2ff; }
#dsui-fab[hidden] { display: none !important; }
/* 找不到输入框时的兜底悬浮样式（例如分享页/登录页） */
#dsui-fab.dsui-fab-floating {
  position: fixed;
  right: 18px;
  bottom: 96px;
  z-index: 2147483000;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(77, 107, 254, .28);
  background: rgba(255, 255, 255, .86);
  box-shadow: 0 2px 10px rgba(16, 24, 40, .12);
  backdrop-filter: blur(8px);
}
body.dark #dsui-fab.dsui-fab-floating, html.dark #dsui-fab.dsui-fab-floating {
  background: rgba(28, 29, 31, .88);
  border-color: rgba(107, 133, 255, .36);
}
@media (max-width: 640px) {
  #dsui-fab.dsui-fab-floating { right: 12px; bottom: 80px; width: 30px; height: 30px; font-size: 13px; }
}

/* toast */
#dsui-toast {
  position: fixed;
  left: 50%;
  bottom: 120px;
  transform: translate(-50%, 8px);
  z-index: 2147483002;
  background: rgba(22, 24, 28, .92);
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
  font-size: 12.5px;
  line-height: 1.4;
  padding: 8px 14px;
  border-radius: 10px;
  pointer-events: none;
  opacity: 0;
  transition: opacity .18s ease, transform .18s ease;
  max-width: min(420px, 80vw);
  text-align: center;
}
#dsui-toast.is-show { opacity: 1; transform: translate(-50%, 0); }
`;
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }
  function ensureToast() {
    let el = document.getElementById("dsui-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "dsui-toast";
      document.body?.appendChild(el);
    }
    return el;
  }

  // src/dom.js
  var SELECTORS = {
    assistantMarkdown: ".ds-markdown.ds-assistant-message-main-content",
    message: ".ds-message",
    codeBlock: ".md-code-block",
    codeInfo: ".md-code-block-infostring",
    userBubble: ".ds-collapsible-text",
    textarea: "textarea"
  };
  function findAssistantRoots(root = document) {
    return [...root.querySelectorAll(SELECTORS.assistantMarkdown)];
  }
  function readLang(block) {
    const info = block.querySelector(".md-code-block-infostring");
    if (info) return (info.textContent || "").trim().toLowerCase();
    const banner = block.querySelector(".md-code-block-banner");
    if (!banner) return "";
    const text = (banner.textContent || "").trim();
    const match = text.match(/^([A-Za-z][\w+#.\-]{0,31})/);
    return match ? match[1].toLowerCase() : "";
  }
  function readCode(block) {
    return block.querySelector("pre")?.textContent ?? "";
  }
  function shouldRenderBlock(block, settings) {
    const lang = readLang(block);
    if (lang === "dsui" || lang.startsWith("dsui")) return true;
    if (!settings?.renderPlainHtml) return false;
    if (lang === "html" || lang === "htm" || lang === "svg") {
      const code = readCode(block);
      return /<!doctype\s+html|<html[\s>]/i.test(code);
    }
    return false;
  }
  function extractTitle(html, fallback = "交互界面") {
    const m = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = m?.[1]?.trim();
    return title ? decodeEntities(title).slice(0, 80) : fallback;
  }
  function clampWidgetHeight(height, viewportHeight = window.innerHeight, options = {}) {
    const content = Number(height) || 0;
    const min = Number(options.min) || 140;
    const max = Number(options.max) || Math.max(min + 80, Math.round(viewportHeight * 0.72));
    return Math.min(Math.max(content, min), max);
  }
  var decoderEl = null;
  function decodeEntities(text) {
    if (!decoderEl) decoderEl = document.createElement("textarea");
    decoderEl.innerHTML = text;
    return decoderEl.value;
  }

  // src/chat.js
  var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var sending = false;
  function getComposer() {
    const list = [...document.querySelectorAll("textarea")];
    return list.find((ta) => ta.offsetParent !== null && !ta.disabled && !ta.readOnly) || list[0] || null;
  }
  function setComposerText(text) {
    const ta = getComposer();
    if (!ta) return false;
    const win = ta.ownerDocument?.defaultView || window;
    const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(ta, text);
    else ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
    ta.focus();
    return true;
  }
  var SEND_ARROW_PATH = "M8.3125 0.980206";
  function composerScope(ta) {
    return ta.closest("div[class]")?.parentElement?.parentElement?.parentElement || ta.parentElement?.parentElement || document;
  }
  function findSendButton(ta) {
    const scope = composerScope(ta);
    const candidates = [...scope.querySelectorAll('div[role="button"]')].filter((el) => {
      const cls = String(el.className || "");
      const arrow = el.querySelector("svg path")?.getAttribute("d") || "";
      return cls.includes("ds-button--circle") && cls.includes("ds-button--primary") && arrow.startsWith(SEND_ARROW_PATH) && !cls.includes("ds-button--disabled");
    });
    return candidates[0] || null;
  }
  function hasUserMessageWith(text) {
    const needle = text.slice(0, 40);
    return [...document.querySelectorAll(".ds-collapsible-text")].some((el) => el.innerText.includes(needle));
  }
  async function sendToChat(text, { timeoutMs = 3e4, retryDelay = 500 } = {}) {
    const body = String(text ?? "").slice(0, 8e3).trim();
    if (!body || sending) return false;
    const ta0 = getComposer();
    if (!ta0) return false;
    const draft = ta0.value;
    if (draft.trim() && draft.trim() !== body) return false;
    sending = true;
    try {
      const beforeCount = document.querySelectorAll(".ds-message").length;
      setComposerText(body);
      await delay(100);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const ta2 = getComposer();
        if (!ta2) return false;
        if (ta2.value !== body) return false;
        const btn = findSendButton(ta2);
        if (!btn) {
          await delay(retryDelay);
          continue;
        }
        btn.click();
        for (let i = 0; i < 10; i++) {
          await delay(200);
          const current = getComposer();
          const count = document.querySelectorAll(".ds-message").length;
          if (!current || !current.value) return true;
          if (count > beforeCount && hasUserMessageWith(body)) return true;
        }
        await delay(retryDelay);
      }
      const ta = getComposer();
      if (ta && (!ta.value || ta.value === body)) setComposerText(draft);
      return false;
    } finally {
      sending = false;
    }
  }

  // src/theme.js
  function detectTheme() {
    const body = document.body;
    const cls = body?.className || "";
    if (/(^|\s)dark(\s|$)/.test(cls)) return "dark";
    if (/(^|\s)light(\s|$)/.test(cls)) return "light";
    const bg = getComputedStyle(body || document.documentElement).backgroundColor;
    const parsed = parseRgb(bg);
    if (parsed && parsed.a > 0.1) return luminance(parsed) < 0.42 ? "dark" : "light";
    try {
      return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      return "light";
    }
  }
  function watchTheme(callback) {
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
      observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => observer.observe(document.body, { attributes: true, attributeFilter: ["class"] }),
        { once: true }
      );
    }
    let mq = null;
    try {
      mq = matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener?.("change", fire);
    } catch {
    }
    return () => {
      observer.disconnect();
      mq?.removeEventListener?.("change", fire);
    };
  }
  function parseRgb(value) {
    const m = String(value || "").match(/rgba?\(([^)]+)\)/i);
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

  // src/widget.js
  var WIDGETS_BY_TOKEN = /* @__PURE__ */ new Map();
  var ALL_WIDGETS = /* @__PURE__ */ new Set();
  var messageRouterInstalled = false;
  function applyThemeToAll(theme) {
    for (const widget of ALL_WIDGETS) widget.setTheme(theme);
  }
  function getAllWidgets() {
    return [...ALL_WIDGETS];
  }
  function installWidgetMessageRouter() {
    if (messageRouterInstalled) return;
    messageRouterInstalled = true;
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object" || !data.__dsui) return;
      const widget = WIDGETS_BY_TOKEN.get(data.__dsui);
      if (!widget) return;
      if (widget.iframe && event.source !== widget.iframe.contentWindow) return;
      widget.handleMessage(data);
    });
  }
  var BRIDGE_CODE = String.raw`(function(){
  var T=__DS_UI_TOKEN__;
  var SEQ=__DS_UI_SEQ__;
  var lastH=0;
  var lastGesture=0;
  var lastSend=0;
  function post(m){ try{ m.__dsui=T; m.seq=SEQ; parent.postMessage(m,'*'); }catch(e){} }
  function markGesture(ev){ if(ev && ev.isTrusted) lastGesture=Date.now(); }
  try{
    document.addEventListener('pointerdown',markGesture,true);
    document.addEventListener('keydown',markGesture,true);
    document.addEventListener('touchstart',markGesture,true);
  }catch(e){}
  function measure(){
    try{
      var d=document.documentElement,b=document.body;
      var h=Math.max(d?d.scrollHeight:0,b?b.scrollHeight:0);
      if(h && Math.abs(h-lastH)>1){ lastH=h; post({type:'height',height:h}); }
    }catch(e){}
  }
  var bodyObserved=false;
  function observeBody(){
    try{
      if(bodyObserved || !document.body || !window.ResizeObserver) return;
      new ResizeObserver(measure).observe(document.body);
      bodyObserved=true;
    }catch(e){}
  }
  var api={
    sendMessage:function(t){
      var now=Date.now();
      if(now-lastSend<1200){ post({type:'error',message:'发送过于频繁，请稍候再试'}); return false; }
      var active=false;
      try{ active=!!(navigator.userActivation && navigator.userActivation.isActive); }catch(e){}
      if(!active && now-lastGesture>4000){
        post({type:'error',message:'界面回传需要用户先点击组件（已阻止自动发送）'});
        return false;
      }
      lastSend=now;
      post({type:'sendMessage',text:String(t==null?'':t).slice(0,8000)});
      return true;
    },
    resize:measure,
    setTitle:function(t){ post({type:'title',text:String(t==null?'':t).slice(0,120)}); },
    onThemeChange:function(cb){ window.addEventListener('dsui:theme',function(e){ try{cb(e.detail)}catch(_){}}); }
  };
  Object.defineProperty(api,'theme',{get:function(){ try{ return document.documentElement.getAttribute('data-ds-theme')||'light'; }catch(e){ return 'light'; } }});
  try{ Object.defineProperty(window,'dsui',{configurable:true,get:function(){return api}}); }catch(e){ window.dsui=api; }
  window.addEventListener('message',function(e){
    var d=e.data;
    if(!d||d.__dsuiHost!==T) return;
    if(d.type==='theme'){
      try{ document.documentElement.setAttribute('data-ds-theme',d.theme); document.documentElement.style.colorScheme=d.theme; }catch(_){}
      try{ window.dispatchEvent(new CustomEvent('dsui:theme',{detail:d.theme})); }catch(_){}
      measure();
    }
  });
  window.addEventListener('error',function(ev){ post({type:'error',message:String((ev&&ev.message)||'脚本错误').slice(0,300)}); });
  try{
    document.addEventListener('click',function(e){
      var a=e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if(!a) return;
      var href=a.getAttribute('href')||'';
      if(/^https?:\/\//i.test(href)){
        e.preventDefault();
        post({type:'error',message:'组件内不允许打开外部链接'});
      }
    },true);
    document.addEventListener('submit',function(e){
      e.preventDefault();
      post({type:'error',message:'组件内不允许提交表单到外部'});
    },true);
    window.addEventListener('beforeunload',function(){ post({type:'navigating'}); });
    window.addEventListener('pagehide',function(){ post({type:'navigating'}); });
  }catch(e){}
  if(window.ResizeObserver){ try{ new ResizeObserver(measure).observe(document.documentElement); }catch(e){} }
  window.addEventListener('load',function(){ setTimeout(measure,30); observeBody(); });
  var announce=function(){ observeBody(); post({type:'ready'}); measure(); setTimeout(measure,120); };
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',function(){ setTimeout(announce,0); },{once:true});
  }else{
    setTimeout(announce,0);
  }
  setTimeout(measure,250); setTimeout(measure,1000);
})();`;
  var CSP = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline' 'unsafe-eval'",
    "img-src data: blob:",
    "font-src data:",
    "media-src data: blob:",
    "connect-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join("; ");
  function buildWidgetDoc(rawHtml, { token, theme = "light", docSeq = 0 } = {}) {
    const source = String(rawHtml ?? "");
    let doc = /<html[\s>]/i.test(source) || /<!doctype/i.test(source) ? source : `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${source}</body></html>`;
    if (!/<!doctype/i.test(doc)) doc = `<!DOCTYPE html>${doc}`;
    const headBits = `${CSP_META}<style>html,body{margin:0;padding:0;overflow-x:hidden;background:transparent;scrollbar-width:none;-ms-overflow-style:none}html{color-scheme:${theme}}*{scrollbar-width:none;-ms-overflow-style:none}*::-webkit-scrollbar{width:0;height:0;display:none}</style>`;
    const bridge = `<script>${BRIDGE_CODE.replace("__DS_UI_TOKEN__", JSON.stringify(token)).replace(
      "__DS_UI_SEQ__",
      String(docSeq)
    )}<\/script>`;
    doc = injectIntoHead(doc, headBits + bridge);
    doc = adaptThemeCss(doc, theme);
    doc = doc.replace(
      /<html([^>]*)>/i,
      (_m, attrs) => `<html${String(attrs).replace(/\sdata-ds-theme="[^"]*"/g, "")} data-ds-theme="${theme}">`
    );
    return doc;
  }
  function adaptThemeCss(doc, theme) {
    const isDark = theme === "dark";
    return String(doc).replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, css, close) => {
      return open + transformCssMedia(css, isDark) + close;
    });
  }
  function transformCssMedia(css, isDark) {
    const masked = maskCss(css);
    let out = "";
    let i = 0;
    while (i < css.length) {
      const at = masked.indexOf("@media", i);
      if (at < 0) {
        out += css.slice(i);
        break;
      }
      out += css.slice(i, at);
      const open = masked.indexOf("{", at);
      if (open < 0) {
        out += css.slice(at);
        break;
      }
      const prelude = masked.slice(at + "@media".length, open).trim();
      const themeOnly = /^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/i.exec(prelude);
      if (!themeOnly) {
        out += css.slice(at, open + 1);
        i = open + 1;
        continue;
      }
      let depth = 1;
      let j = open + 1;
      while (j < masked.length && depth > 0) {
        const ch = masked[j];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        j++;
      }
      if (depth !== 0) {
        out += css.slice(at);
        break;
      }
      const inner = css.slice(open + 1, j - 1);
      const isDarkQuery = themeOnly[1].toLowerCase() === "dark";
      const applies = isDarkQuery ? isDark : !isDark;
      out += applies ? inner : "";
      i = j;
    }
    return out;
  }
  function maskCss(css) {
    let out = "";
    let i = 0;
    while (i < css.length) {
      const ch = css[i];
      if (ch === "/" && css[i + 1] === "*") {
        let end = css.indexOf("*/", i + 2);
        end = end < 0 ? css.length : end + 2;
        out += " ".repeat(end - i);
        i = end;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const quote = ch;
        out += ch;
        i++;
        while (i < css.length) {
          const c = css[i];
          if (c === "\\") {
            out += "  ";
            i += 2;
            continue;
          }
          out += c === "\n" ? "\n" : " ";
          i++;
          if (c === quote) break;
        }
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }
  var CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
  function isRenderable(code) {
    const s = String(code || "");
    if (/<\/html>/i.test(s)) return true;
    if (s.length < 80) return false;
    const bodyIndex = s.search(/<body[\s>]/i);
    if (bodyIndex < 0) return false;
    const afterBody = s.slice(bodyIndex);
    if (/<\/(div|section|main|svg|canvas|table|button|form|ul|ol)>/i.test(afterBody)) return true;
    if (s.length > 2e3 && /<script[\s>]/i.test(afterBody)) return true;
    return false;
  }
  function injectIntoHead(doc, snippet) {
    const head = doc.match(/<head[^>]*>/i);
    if (head) {
      const at = head.index + head[0].length;
      return doc.slice(0, at) + snippet + doc.slice(at);
    }
    const html = doc.match(/<html[^>]*>/i);
    if (html) {
      const at = html.index + html[0].length;
      return doc.slice(0, at) + `<head>${snippet}</head>` + doc.slice(at);
    }
    return `<!DOCTYPE html><html><head>${snippet}</head><body>${doc}</body></html>`;
  }
  var nextWidgetId = 0;
  function randomToken() {
    try {
      const bytes = new Uint8Array(8);
      crypto.getRandomValues(bytes);
      return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      return Math.random().toString(36).slice(2, 12);
    }
  }
  var Widget = class {
    constructor(block, { getSettings: getSettings2, onToast, kind = "dsui" } = {}) {
      this.block = block;
      this.kind = kind === "html" ? "html" : "dsui";
      this.getSettings = getSettings2;
      this.onToast = onToast;
      this.id = `dsui-${++nextWidgetId}`;
      this.token = `${this.id}-${randomToken()}`;
      this.code = "";
      this.renderedCode = "";
      this.codeEl = null;
      this.lastRenderAt = 0;
      this.renderTimer = null;
      this.finalizeTimer = null;
      this.statusTimer = null;
      this.isFinal = false;
      this.ready = false;
      this.lastHeight = 0;
      this.showCode = false;
      this.theme = "light";
      this.renderSeq = 0;
      this.readyTimer = null;
      this.streamRenderTimer = null;
      this.navTimeout = null;
      this.docSeq = 0;
      this.replacing = false;
      this.navigated = false;
      this.hasRenderedOnce = false;
      this.destroyed = false;
    }
    mount() {
      const settings = this.getSettings() || {};
      this.theme = settings.__theme || detectTheme();
      const root = document.createElement("div");
      root.className = "dsui-widget";
      root.dataset.dsuiId = this.id;
      root.dataset.kind = this.kind;
      root.dataset.state = "streaming";
      const actions = this.kind === "html" ? `<span class="dsui-actions">
             <button type="button" class="dsui-btn" data-act="code" title="切换查看源码">代码</button>
             <button type="button" class="dsui-btn" data-act="copy" title="复制源码">复制</button>
             <button type="button" class="dsui-btn" data-act="download" title="下载 HTML">下载</button>
           </span>` : "";
      const head = this.kind === "html" ? `<div class="dsui-head">
             <span class="dsui-mark" aria-hidden="true">✦</span>
             <span class="dsui-title">交互界面</span>
             <span class="dsui-status" data-busy="1">生成中…</span>
             ${actions}
           </div>` : "";
      root.innerHTML = `
      ${head}
      <div class="dsui-body">
        <div class="dsui-placeholder"><span class="dsui-spinner"></span><span>正在构建界面…</span></div>
        <iframe class="dsui-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" title="交互界面"></iframe>
        <pre class="dsui-code" hidden><code></code></pre>
      </div>
      <div class="dsui-foot" hidden></div>
    `;
      this.el = root;
      this.iframe = root.querySelector(".dsui-frame");
      this.placeholder = root.querySelector(".dsui-placeholder");
      this.titleEl = root.querySelector(".dsui-title");
      this.statusEl = root.querySelector(".dsui-status");
      this.codePanel = root.querySelector(".dsui-code");
      this.codeEl = root.querySelector(".dsui-code code");
      this.footEl = root.querySelector(".dsui-foot");
      this.sendTimes = [];
      this.iframe.style.height = this.kind === "dsui" ? "120px" : "260px";
      root.addEventListener("click", (event) => this.onClick(event));
      this.iframe.addEventListener("load", () => {
        if (this.navigated) return;
        this.replacing = false;
        this.heightTimer = setTimeout(() => {
          if (!this.ready && !this.navigated) this.setStatus("生成中…", true);
        }, 600);
      });
      this.block.setAttribute("data-dsui-hidden", "1");
      this.block.after(root);
      WIDGETS_BY_TOKEN.set(this.token, this);
      ALL_WIDGETS.add(this);
    }
    onClick(event) {
      const button = event.target.closest?.("[data-act]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const act = button.dataset.act;
      if (act === "code") this.toggleCode(button);
      else if (act === "copy") this.copyCode(button);
      else if (act === "download") this.downloadCode(button);
    }
    handleWidgetSend(text) {
      const content = String(text ?? "").trim();
      if (!content) return;
      const settings = this.getSettings() || {};
      if (!settings.allowWidgetSend) {
        this.onToast?.("界面回传已关闭（可在设置中开启）");
        return;
      }
      this.sendTimes = this.sendTimes.filter((t) => Date.now() - t < 6e4);
      if (this.sendTimes.length >= 5) {
        this.onToast?.("该组件发送过于频繁，请稍后再试");
        return;
      }
      this.sendTimes.push(Date.now());
      this.sendMessageToChat(content);
    }
    toggleCode(button) {
      this.showCode = !this.showCode;
      this.codePanel.hidden = !this.showCode;
      this.iframe.style.display = this.showCode ? "none" : "";
      button.classList.toggle("is-active", this.showCode);
      if (this.showCode) {
        if (this.codeEl.textContent !== this.code) this.codeEl.textContent = this.code;
        this.codePanel.scrollTop = 0;
      }
    }
    async copyCode(button) {
      const text = this.code;
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      }
      button.textContent = ok ? "已复制" : "复制失败";
      setTimeout(() => {
        button.textContent = "复制";
      }, 1400);
    }
    downloadCode(button) {
      try {
        const title = (this.titleEl?.textContent || "component").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 60);
        const blob = new Blob([this.code], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${title || "component"}.html`;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2e3);
        button.textContent = "已下载";
        setTimeout(() => {
          button.textContent = "下载";
        }, 1400);
      } catch {
        this.onToast?.("下载失败，请切换「代码」手动复制");
      }
    }
    /** 代码内容更新（流式时会被反复调用） */
    update(code) {
      if (this.navigated) return;
      const next = String(code ?? "");
      if (next === this.code) return;
      this.code = next;
      this.isFinal = false;
      this.ready = false;
      if (!this.el) return;
      const title = extractTitle(next, "交互界面");
      if (this.titleEl && this.titleEl.textContent !== title) this.titleEl.textContent = title;
      this.setStatus("生成中…", true);
      if (this.el) this.el.dataset.state = "streaming";
      if (this.showCode) this.codeEl.textContent = next;
      this.scheduleRender(false);
      clearTimeout(this.finalizeTimer);
      this.finalizeTimer = setTimeout(() => this.finalize(), 1400);
    }
    finalize() {
      if (this.destroyed || this.navigated) return;
      this.isFinal = true;
      if (this.el) this.el.dataset.state = "ready";
      this.scheduleRender(true);
      this.setStatus("已就绪", false);
      clearTimeout(this.statusTimer);
      this.statusTimer = setTimeout(() => {
        if (this.footEl) this.footEl.hidden = true;
        if (this.statusEl) this.statusEl.textContent = "";
      }, 2600);
    }
    scheduleRender(immediate) {
      if (this.destroyed || this.navigated) return;
      if (immediate) {
        clearTimeout(this.renderTimer);
        clearTimeout(this.streamRenderTimer);
        this.renderTimer = null;
        this.streamRenderTimer = null;
        this.renderFrame();
        return;
      }
      if (!this.renderedCode) {
        if (!this.renderTimer) {
          this.renderTimer = setTimeout(() => {
            this.renderTimer = null;
            this.renderFrame();
          }, 180);
        }
        return;
      }
      if (!this.streamRenderTimer) {
        this.streamRenderTimer = setTimeout(() => {
          this.streamRenderTimer = null;
          this.renderFrame();
        }, 1500);
      }
    }
    renderFrame() {
      if (this.destroyed || this.navigated || !this.iframe) return;
      if (!this.code.trim()) return;
      if (this.renderedCode === this.code) return;
      if (!this.isFinal && !isRenderable(this.code)) return;
      this.renderedCode = this.code;
      this.lastRenderAt = Date.now();
      this.ready = false;
      this.docSeq += 1;
      this.replacing = true;
      const firstRender = !this.hasRenderedOnce;
      this.hasRenderedOnce = true;
      if (firstRender) {
        this.iframe.classList.remove("is-ready");
        this.placeholder?.classList.remove("is-hidden");
      }
      const seq = ++this.renderSeq;
      const doc = buildWidgetDoc(this.code, { token: this.token, theme: this.theme, docSeq: this.docSeq });
      this.iframe.srcdoc = doc;
      clearTimeout(this.readyTimer);
      this.readyTimer = setTimeout(() => {
        if (this.destroyed || this.navigated || this.renderSeq !== seq) return;
        if (!this.ready) {
          this.iframe?.classList.add("is-ready");
          this.placeholder?.classList.add("is-hidden");
          this.setStatus("组件未就绪", false);
          if (this.footEl) {
            this.footEl.hidden = false;
            this.footEl.textContent = "组件脚本没有正常初始化，可切换「代码」查看源码或刷新页面重试。";
          }
        }
      }, 3e3);
    }
    handleMessage(data) {
      if (typeof data.seq !== "number" || data.seq !== this.docSeq) return;
      if (this.replacing && data.type === "navigating") return;
      if (this.navigated && data.type !== "navigating") return;
      switch (data.type) {
        case "ready":
          this.ready = true;
          clearTimeout(this.readyTimer);
          this.iframe?.classList.add("is-ready");
          this.placeholder?.classList.add("is-hidden");
          if (this.isFinal || this.renderedCode === this.code) this.setStatus("已就绪", false);
          break;
        case "navigating":
          this.markNavigated();
          break;
        case "height":
          this.applyHeight(data.height);
          break;
        case "title":
          if (data.text && this.titleEl) this.titleEl.textContent = String(data.text).slice(0, 80);
          break;
        case "error":
          this.showError(data.message);
          break;
        case "sendMessage":
          this.handleWidgetSend(data.text);
          break;
        default:
          break;
      }
    }
    applyHeight(height) {
      const isDsui = this.kind === "dsui";
      const h = clampWidgetHeight(height, window.innerHeight, {
        // dsui 去掉卡片外框后让高度自然延展，由页面滚动承接
        min: isDsui ? 60 : 140,
        max: isDsui ? 6e3 : Math.max(220, Math.round(window.innerHeight * 0.72))
      });
      this.lastHeight = h;
      this.iframe.style.height = `${h}px`;
      if (isDsui && this.el) {
        this.el.dataset.overflow = Number(height) > h + 2 ? "1" : "0";
      }
    }
    async sendMessageToChat(text) {
      const content = String(text ?? "").trim();
      if (!content) return;
      const composer = getComposer();
      if (composer && composer.value.trim() && composer.value.trim() !== content) {
        this.onToast?.("输入框里已有未发送内容，请先发送或清空");
        return;
      }
      if (this.getSettings()?.widgetSendMode !== "send") {
        const staged = composer && !composer.disabled && !composer.readOnly && setComposerText(content);
        this.onToast?.(staged ? "已填入输入框，可编辑后发送" : "暂时无法填入输入框");
        return;
      }
      this.onToast?.("界面正在发送消息…");
      const ok = await sendToChat(content);
      this.onToast?.(ok ? "已发送到对话" : "发送失败，请手动输入");
    }
    setTheme(theme) {
      if (this.navigated || this.theme === theme) return;
      this.theme = theme;
      if (this.renderedCode) {
        this.renderedCode = "";
        this.scheduleRender(true);
      }
    }
    postToFrame(payload) {
      if (this.navigated || !this.ready) return;
      try {
        this.iframe?.contentWindow?.postMessage(payload, "*");
      } catch {
      }
    }
    markNavigated() {
      if (this.navigated) return;
      try {
        if (this.getSettings()?.debug) {
          console.warn("[DS-UI] widget marked navigated", this.id, this.renderedCode.slice(0, 60));
        }
      } catch {
      }
      this.navigated = true;
      this.replacing = false;
      clearTimeout(this.renderTimer);
      clearTimeout(this.streamRenderTimer);
      clearTimeout(this.readyTimer);
      clearTimeout(this.navTimeout);
      clearTimeout(this.heightTimer);
      clearTimeout(this.statusTimer);
      this.iframe?.classList.remove("is-ready");
      this.setStatus("已停止", false);
      this.showError("组件尝试跳转到外部页面，已停止接受它的消息");
      try {
        this.iframe.removeAttribute("srcdoc");
        this.iframe.src = "about:blank";
      } catch {
      }
    }
    setStatus(text, busy) {
      if (!this.statusEl) return;
      this.statusEl.textContent = text;
      if (busy) this.statusEl.dataset.busy = "1";
      else delete this.statusEl.dataset.busy;
      if (text) this.statusEl.hidden = false;
    }
    showError(message) {
      if (!this.footEl) return;
      this.footEl.hidden = false;
      this.footEl.textContent = `组件脚本报错：${String(message || "").slice(0, 160)}`;
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      clearTimeout(this.renderTimer);
      clearTimeout(this.finalizeTimer);
      clearTimeout(this.statusTimer);
      clearTimeout(this.heightTimer);
      clearTimeout(this.readyTimer);
      clearTimeout(this.streamRenderTimer);
      clearTimeout(this.navTimeout);
      WIDGETS_BY_TOKEN.delete(this.token);
      ALL_WIDGETS.delete(this);
      this.el?.remove();
      if (this.block?.isConnected) this.block.removeAttribute("data-dsui-hidden");
      this.iframe = null;
      this.el = null;
    }
  };

  // src/images.js
  var COMMONS = "https://commons.wikimedia.org";
  var searches = /* @__PURE__ */ new Map();
  function readImageRequest(code) {
    try {
      const value = JSON.parse(code);
      const query = typeof value?.query === "string" ? value.query.trim() : "";
      const count = value?.count ?? 1;
      if (!query || query.length > 120 || !Number.isInteger(count) || count < 1 || count > 6) return null;
      return { query, count };
    } catch {
      return null;
    }
  }
  function readDirectImage(block) {
    const child = block.firstElementChild;
    if (!child || block.childElementCount !== 1) return null;
    const image = child.matches("img") ? child : child.querySelector(":scope > img:only-child");
    if (image && !block.textContent.trim()) {
      const src2 = httpsImageUrl(image.getAttribute("src"));
      return src2 && { src: src2, href: src2, title: image.getAttribute("alt") || "查看原图" };
    }
    if (!child.matches("a") || block.textContent.trim() !== child.textContent.trim()) return null;
    const src = httpsImageUrl(child.getAttribute("href"));
    if (!src || !/\.(?:avif|gif|jpe?g|png|webp)(?:$|\/)/i.test(new URL(src).pathname)) return null;
    const label = child.textContent.trim();
    if (httpsImageUrl(label) !== src) return null;
    return { src, href: src, title: "查看原图" };
  }
  function httpsImageUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" && !url.username && !url.password) return url.href;
    } catch {
    }
    return null;
  }
  async function requestJson(url) {
    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        let timer;
        const fail = () => {
          clearTimeout(timer);
          reject(new Error("图片搜索失败"));
        };
        const request = GM_xmlhttpRequest({
          method: "GET",
          url: url.href,
          anonymous: true,
          responseType: "json",
          onload(response2) {
            if (response2.status < 200 || response2.status >= 300) return fail();
            clearTimeout(timer);
            resolve(response2.response);
          },
          onerror: fail,
          onabort: fail,
          ontimeout: fail
        });
        timer = setTimeout(() => {
          reject(new Error("图片搜索超时"));
          request?.abort();
        }, 12e3);
      });
    }
    const response = await fetch(url, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(12e3)
    });
    if (!response.ok) throw new Error("图片搜索失败");
    return response.json();
  }
  function search({ query, count }) {
    const key = JSON.stringify([query, count]);
    if (searches.has(key)) return searches.get(key);
    const url = new URL("/w/api.php", COMMONS);
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      origin: "*",
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: `${query} filetype:bitmap`,
      gsrlimit: String(count * 2),
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "640"
    });
    const pending = requestJson(url).then((data) => {
      if (!data || data.error) throw new Error("图片搜索失败");
      const pages = data.query?.pages ?? [];
      return pages.sort((a, b) => a.index - b.index).flatMap(({ title, imageinfo }) => {
        const image = imageinfo?.[0];
        if (!title?.startsWith("File:") || !/^image\/(?:jpeg|png|webp|gif)$/.test(image?.mime)) return [];
        const src = image.thumburl || image.url;
        if (!/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(src)) return [];
        return [{
          src,
          title: title.slice(5).replace(/_/g, " "),
          href: `${COMMONS}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`
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
  var ImageGallery = class {
    constructor(block, request) {
      this.block = block;
      this.request = request;
      this.key = JSON.stringify(request);
      this.el = document.createElement("div");
      this.el.className = "dsui-image-gallery";
      this.el.hidden = true;
    }
    mount() {
      this.block.setAttribute("data-dsui-image-source", "");
      this.block.after(this.el);
      if (this.request) this.load();
    }
    async load() {
      const images = this.request.src ? [this.request] : await search(this.request).catch(() => []);
      if (this.destroyed) return;
      for (const { src, title, href } of images) {
        const link = document.createElement("a");
        link.hidden = true;
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.title = title;
        const frame = document.createElement("div");
        frame.className = "dsui-image-frame";
        const image = document.createElement("img");
        image.alt = title;
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("load", () => {
          link.hidden = false;
          this.el.hidden = false;
        }, { once: true });
        image.addEventListener("error", () => link.remove(), { once: true });
        const caption = document.createElement("span");
        caption.textContent = this.request.src ? `${new URL(src).hostname} ↗` : "Wikimedia Commons ↗";
        frame.append(image);
        link.append(frame, caption);
        this.el.append(link);
        image.src = src;
      }
    }
    destroy() {
      this.destroyed = true;
      this.el.remove();
      this.block.removeAttribute("data-dsui-image-source");
    }
  };

  // src/renderer.js
  var SCAN_DEBOUNCE_MS = 90;
  function startRenderer({ getSettings: getSettings2, onToast }) {
    installWidgetMessageRouter();
    const widgets = /* @__PURE__ */ new Map();
    let theme = detectTheme();
    let scanTimer = null;
    let observer = null;
    let stopped = false;
    const scheduleScan = () => {
      if (stopped || scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        if (stopped) return;
        try {
          scan();
        } catch (error) {
          console.warn("[DS-UI] scan error:", error);
        }
      }, SCAN_DEBOUNCE_MS);
    };
    const scan = () => {
      if (stopped) return;
      const settings = getSettings2() || {};
      const enabled = settings.enabled && settings.autoRender;
      if (!enabled) {
        teardownAll();
        return;
      }
      const seen = /* @__PURE__ */ new Set();
      const renderImages = (block, request) => {
        seen.add(block);
        const current = widgets.get(block);
        if (current instanceof ImageGallery && current.el.isConnected && current.key === JSON.stringify(request)) return;
        current?.destroy();
        const gallery = new ImageGallery(block, request);
        widgets.set(block, gallery);
        gallery.mount();
      };
      for (const root of findAssistantRoots(document)) {
        for (const block of root.querySelectorAll("p")) {
          const request = readDirectImage(block);
          if (request) renderImages(block, request);
        }
        for (const block of root.querySelectorAll(SELECTORS.codeBlock)) {
          const lang = readLang(block);
          if (lang === "dsui-image") {
            renderImages(block, readImageRequest(readCode(block)));
            continue;
          }
          if (!shouldRenderBlock(block, settings)) {
            if (block.hasAttribute("data-dsui-hidden") && !widgets.has(block)) {
              block.removeAttribute("data-dsui-hidden");
            }
            continue;
          }
          seen.add(block);
          block.setAttribute("data-dsui-hidden", "1");
          let widget = widgets.get(block);
          if (widget && (widget instanceof ImageGallery || !widget.el?.isConnected || widget.block !== block)) {
            widget.destroy();
            widgets.delete(block);
            widget = null;
          }
          if (!widget) {
            widget = adoptAdjacentWidget(block);
          }
          if (!widget) {
            const kind = lang === "html" || lang === "htm" || lang === "svg" ? "html" : "dsui";
            widget = new Widget(block, { getSettings: getSettings2, onToast, kind });
            widgets.set(block, widget);
            widget.mount();
          } else if (widget.block !== block) {
            widget.block = block;
            block.setAttribute("data-dsui-hidden", "1");
            block.after(widget.el);
          }
          block.setAttribute("data-dsui-hidden", "1");
          widget.update(readCode(block));
        }
      }
      for (const [block, widget] of [...widgets]) {
        if (!seen.has(block) || !block.isConnected || !widget.el?.isConnected) {
          widget.destroy();
          widgets.delete(block);
        }
      }
      cleanInjectedUserBubbles();
    };
    const adoptAdjacentWidget = (block) => {
      const message = block.closest(".ds-message");
      const candidates = [block.previousElementSibling, block.nextElementSibling].filter(
        (el) => el && el.classList && el.classList.contains("dsui-widget") && el.closest(".ds-message") === message
      );
      for (const el of candidates) {
        const id = el.dataset.dsuiId;
        for (const [oldBlock, widget] of [...widgets]) {
          if (widget.id === id && !oldBlock.isConnected) {
            widgets.delete(oldBlock);
            widgets.set(block, widget);
            block.setAttribute("data-dsui-hidden", "1");
            block.after(widget.el);
            return widget;
          }
        }
      }
      return null;
    };
    const teardownAll = () => {
      for (const [block, widget] of [...widgets]) {
        widget.destroy();
        widgets.delete(block);
        if (block?.isConnected) block.removeAttribute("data-dsui-hidden");
      }
    };
    const stopTheme = watchTheme((next) => {
      theme = next;
      applyThemeToAll(next);
      scheduleScan();
    });
    const onSettingsChanged = () => scheduleScan();
    window.addEventListener("dsui:settings-changed", onSettingsChanged);
    observer = new MutationObserver(scheduleScan);
    const observe = () => {
      if (document.body) {
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributeFilter: ["src", "href", "alt"]
        });
        scheduleScan();
      } else {
        document.addEventListener("DOMContentLoaded", observe, { once: true });
      }
    };
    observe();
    const fallbackTimer = setInterval(scheduleScan, 3e3);
    return () => {
      stopped = true;
      clearTimeout(scanTimer);
      scanTimer = null;
      clearInterval(fallbackTimer);
      observer?.disconnect();
      stopTheme();
      window.removeEventListener("dsui:settings-changed", onSettingsChanged);
      teardownAll();
    };
  }
  function cleanInjectedUserBubbles() {
    const bubbles = document.querySelectorAll(SELECTORS.userBubble);
    for (const bubble of bubbles) {
      if (!bubble.textContent?.includes(PROMPT_START)) continue;
      stripInjectionFromNode(bubble);
    }
  }
  function stripInjectionFromNode(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while (node = walker.nextNode()) nodes.push(node);
    const combined = nodes.map((n) => n.data).join("");
    let clean = combined;
    for (let guard = 0; guard < 8; guard++) {
      const trimmed = clean.replace(/\s+$/, "");
      if (!trimmed.endsWith(PROMPT_END)) break;
      const endIndex = trimmed.length - PROMPT_END.length;
      const start = trimmed.lastIndexOf(PROMPT_START, endIndex);
      if (start < 0) break;
      clean = trimmed.slice(0, start).replace(/\s+$/, "");
    }
    if (clean === combined) return false;
    let cursor = 0;
    for (const textNode of nodes) {
      const nodeStart = cursor;
      const nodeEnd = cursor + textNode.data.length;
      cursor = nodeEnd;
      if (nodeEnd <= clean.length) continue;
      if (nodeStart >= clean.length) {
        textNode.data = "";
      } else {
        textNode.data = textNode.data.slice(0, clean.length - nodeStart);
      }
    }
    return true;
  }

  // src/settings-ui.js
  var toastTimer = null;
  function showToast(text, duration = 2e3) {
    const el = ensureToast();
    el.textContent = text;
    el.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("is-show"), duration);
  }
  var PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.wrap {  position: fixed;
  right: 18px;
  bottom: 142px;
  width: min(336px, calc(100vw - 36px));
  max-height: min(76vh, 640px);
  overflow: auto;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 18px 50px rgba(0,0,0,.22);
  z-index: 2147483003;
  padding: 14px 14px 12px;
  animation: in .16s ease-out;
}
@keyframes in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
:host { --bg: #fff; --fg: #1f2329; --muted: #7b818b; --line: #e4e7ec; --soft: #f6f7f9; --accent: #4d6bfe; }
@media (prefers-color-scheme: dark) {
  :host { --bg: #1c1d1f; --fg: #e7e9ee; --muted: #9aa0aa; --line: #2f3136; --soft: #232427; --accent: #6b85ff; }
}
.head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.logo { color: var(--accent); font-size: 15px; }
.title { font-size: 13.5px; font-weight: 700; }
.ver { margin-left: auto; font-size: 11px; color: var(--muted); }
.close { border: 0; background: transparent; color: var(--muted); font-size: 16px; cursor: pointer; padding: 0 2px; line-height: 1; }
.row { display: flex; align-items: flex-start; gap: 9px; padding: 7px 0; border-bottom: 1px dashed var(--line); }
.row:last-of-type { border-bottom: 0; }
.row label { font-size: 12.5px; cursor: pointer; line-height: 1.45; }
.row .desc { display: block; color: var(--muted); font-size: 11px; margin-top: 1px; }
.switch { appearance: none; -webkit-appearance: none; width: 34px; height: 20px; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; flex: 0 0 auto; margin: 0; transition: background .15s ease; }
.switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); transition: transform .15s ease; }
.switch:checked { background: var(--accent); }
.switch:checked::after { transform: translateX(14px); }
.field { margin: 8px 0 4px; }
.field .label { font-size: 12px; color: var(--muted); margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
select, textarea { width: 100%; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); color: var(--fg); font-size: 12px; padding: 6px 8px; outline: none; }
textarea { min-height: 58px; resize: vertical; line-height: 1.5; }
select:focus, textarea:focus { border-color: var(--accent); }
.foot { display: flex; gap: 8px; margin-top: 12px; }
.btn { flex: 1; border: 1px solid var(--line); border-radius: 8px; background: var(--soft); color: var(--fg); font-size: 12px; padding: 7px 0; cursor: pointer; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
.btn:active { transform: translateY(1px); }
.hint { margin-top: 9px; font-size: 10.5px; color: var(--muted); line-height: 1.5; }
`;
  var VERSION = false ? "dev" : "1.3.1";
  var TOGGLES = [
    { key: "enabled", label: "启用 Intelligent UI", desc: "总开关：关闭后不注入、不渲染" },
    { key: "injectPrompt", label: "自动注入界面协议", desc: "新会话首条消息注入一次（推荐）" },
    { key: "injectEveryTurn", label: "每轮都注入", desc: "默认关闭；开启后每轮携带协议，更耗 token" },
    { key: "autoRender", label: "自动渲染 dsui 代码块", desc: "流式生成时实时刷新为可交互 iframe" },
    { key: "renderPlainHtml", label: "同时渲染普通 html 完整文档", desc: "模型没按协议输出时的兜底，可能误伤代码展示" },
    { key: "allowWidgetSend", label: "允许组件回传消息", desc: "组件可把你的选择带回输入框，继续对话" },
    { key: "showFab", label: "显示设置按钮", desc: "默认在输入框附件按钮左侧，关闭后可用油猴菜单打开" }
  ];
  function installSettingsUI({ getSettings: getSettings2 }) {
    let panelHost = null;
    let fab = null;
    let fabPlacementTimer = null;
    const openPanel = () => {
      if (panelHost?.isConnected) {
        closePanel();
        return;
      }
      panelHost = document.createElement("div");
      panelHost.id = "dsui-settings-host";
      const shadow = panelHost.attachShadow({ mode: "open" });
      const settings = getSettings2();
      shadow.innerHTML = `
      <style>${PANEL_CSS}</style>
      <div class="wrap" role="dialog" aria-label="Intelligent UI 设置">
        <div class="head">
          <span class="logo">✦</span>
          <span class="title">Intelligent UI</span>
          <span class="ver">v${VERSION}</span>
          <button class="close" type="button" aria-label="关闭">✕</button>
        </div>
        <div class="body"></div>
        <div class="field">
          <label class="label" for="dsui-visual-preference">何时生成交互界面</label>
          <select id="dsui-visual-preference" data-field="visualPreference">
            <option value="auto">自动判断（推荐）</option>
            <option value="explicit">仅在我明确要求时</option>
            <option value="frequent">更常使用图表和交互</option>
          </select>
        </div>
        <div class="field">
          <label class="label" for="dsui-widget-send-mode">组件回传方式</label>
          <select id="dsui-widget-send-mode" data-field="widgetSendMode">
            <option value="draft">填入输入框，由我发送（推荐）</option>
            <option value="send">直接发送</option>
          </select>
        </div>
        <div class="field">
          <label class="label" for="dsui-protocol-language">协议语言</label>
          <select id="dsui-protocol-language" data-field="protocolLanguage">
            <option value="zh">中文（推荐）</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="field">
          <label class="label" for="dsui-custom-protocol">呈现偏好（可选，会随协议发给 DeepSeek）</label>
          <textarea id="dsui-custom-protocol" data-field="customProtocol" placeholder="例如：金额用人民币；默认显示月度趋势。"></textarea>
        </div>
        <div class="foot">
          <button class="btn primary" type="button" data-act="save">保存</button>
          <button class="btn" type="button" data-act="reset">恢复默认</button>
        </div>
        <div class="hint">默认在新会话的首条消息应用界面偏好。开启「每轮都注入」后，当前会话的下一条消息也会携带新设置。</div>
      </div>
    `;
      const body = shadow.querySelector(".body");
      for (const item of TOGGLES) {
        const row = document.createElement("div");
        row.className = "row";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.className = "switch";
        input.checked = Boolean(settings[item.key]);
        input.dataset.field = item.key;
        const label = document.createElement("label");
        input.id = `dsui-setting-${item.key}`;
        label.htmlFor = input.id;
        label.innerHTML = `${item.label}<span class="desc">${item.desc}</span>`;
        row.append(input, label);
        body.appendChild(row);
      }
      const langSelect = shadow.querySelector('[data-field="protocolLanguage"]');
      const visualPreference = shadow.querySelector('[data-field="visualPreference"]');
      visualPreference.value = settings.visualPreference;
      const widgetSendMode = shadow.querySelector('[data-field="widgetSendMode"]');
      widgetSendMode.value = settings.widgetSendMode;
      langSelect.value = settings.protocolLanguage === "en" ? "en" : "zh";
      const custom = shadow.querySelector('[data-field="customProtocol"]');
      custom.value = settings.customProtocol || "";
      shadow.querySelector(".close").addEventListener("click", closePanel);
      shadow.querySelector('[data-act="reset"]').addEventListener("click", () => {
        const defaults = { ...DEFAULT_SETTINGS };
        applyToForm(defaults);
        save(defaults);
      });
      shadow.querySelector('[data-act="save"]').addEventListener("click", () => {
        save(readForm());
      });
      const applyToForm = (s) => {
        shadow.querySelectorAll("input[data-field]").forEach((input) => {
          input.checked = Boolean(s[input.dataset.field]);
        });
        langSelect.value = s.protocolLanguage === "en" ? "en" : "zh";
        visualPreference.value = s.visualPreference;
        widgetSendMode.value = s.widgetSendMode;
        custom.value = s.customProtocol || "";
      };
      const readForm = () => {
        const next = { ...getSettings2() };
        shadow.querySelectorAll("input[data-field]").forEach((input) => {
          next[input.dataset.field] = input.checked;
        });
        next.protocolLanguage = langSelect.value;
        next.visualPreference = visualPreference.value;
        next.widgetSendMode = widgetSendMode.value;
        next.customProtocol = custom.value.trim();
        return next;
      };
      const save = (next) => {
        const saved = saveSettings(next);
        window.dispatchEvent(new CustomEvent("dsui:settings-changed", { detail: saved }));
        syncFab(saved);
        showToast("Intelligent UI 设置已保存");
        closePanel();
      };
      const onKey = (event) => {
        if (event.key === "Escape") closePanel();
      };
      shadow.__onKey = onKey;
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(panelHost);
      fab?.classList.add("is-open");
    };
    const closePanel = () => {
      if (!panelHost) return;
      const shadow = panelHost.shadowRoot;
      if (shadow?.__onKey) document.removeEventListener("keydown", shadow.__onKey, true);
      panelHost.remove();
      panelHost = null;
      fab?.classList.remove("is-open");
    };
    const syncFab = (settings = getSettings2()) => {
      const shouldShow = settings.showFab !== false;
      if (shouldShow && !fab) {
        fab = document.createElement("button");
        fab.id = "dsui-fab";
        fab.type = "button";
        fab.title = "Intelligent UI 设置";
        fab.setAttribute("aria-label", "Intelligent UI 设置");
        fab.textContent = "✦";
        fab.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openPanel();
        });
        document.body.appendChild(fab);
        placeFab();
        setTimeout(placeFab, 600);
        setTimeout(placeFab, 1500);
        if (!fabPlacementTimer) fabPlacementTimer = setInterval(placeFab, 1200);
      } else if (!shouldShow && fab) {
        clearInterval(fabPlacementTimer);
        fabPlacementTimer = null;
        fab.remove();
        fab = null;
        closePanel();
      }
    };
    const placeFab = () => {
      if (!fab) return;
      const fileInput = document.querySelector('input[type="file"]');
      const uploadRow = fileInput?.parentElement;
      if (uploadRow && uploadRow.querySelector('[role="button"]')) {
        if (fab.parentElement !== uploadRow) uploadRow.insertBefore(fab, uploadRow.firstElementChild);
        fab.classList.remove("dsui-fab-floating");
        fab.title = "Intelligent UI 设置（注入协议 / 渲染 / 回传确认）";
        fab.hidden = false;
        return;
      }
      if (fab.parentElement !== document.body) document.body.appendChild(fab);
      fab.classList.add("dsui-fab-floating");
      fab.hidden = false;
    };
    syncFab();
    return { openPanel, closePanel, syncFab };
  }

  // src/main.js
  var getSettings = () => loadSettings();
  var isTopFrame = (() => {
    try {
      return window.top === window.self;
    } catch {
      return false;
    }
  })();
  function main() {
    installInterceptors(getSettings);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
    } else {
      boot();
    }
  }
  if (isTopFrame) main();
  function boot() {
    if (document.documentElement.dataset.dsuiBooted === "1") return;
    document.documentElement.dataset.dsuiBooted = "1";
    injectStyles();
    const rendererStop = startRenderer({ getSettings, onToast: showToast });
    const ui = installSettingsUI({ getSettings });
    registerMenu(ui);
    if (getSettings().debug) installDebugApi(ui);
    if (getSettings().debug) {
      console.info("[DS-UI] booted", "1.3.1", "settings=", getSettings());
      setTimeout(() => console.info("[DS-UI] debug state", window.__dsui?.debugState?.()), 3e3);
    }
    window.addEventListener("beforeunload", () => rendererStop?.());
  }
  function registerMenu(ui) {
    try {
      if (typeof GM_registerMenuCommand !== "function") return;
      GM_registerMenuCommand("✦ Intelligent UI 设置", () => ui.openPanel());
      GM_registerMenuCommand("切换「自动注入协议」", () => {
        const next = updateSettings({ injectPrompt: !getSettings().injectPrompt });
        showToast(next.injectPrompt ? "已开启协议注入" : "已关闭协议注入");
      });
      GM_registerMenuCommand("切换「自动渲染界面」", () => {
        const next = updateSettings({ autoRender: !getSettings().autoRender });
        showToast(next.autoRender ? "已开启自动渲染" : "已关闭自动渲染");
        window.dispatchEvent(new CustomEvent("dsui:settings-changed", { detail: next }));
      });
      GM_registerMenuCommand("临时停用脚本（恢复原始代码块）", () => {
        const next = updateSettings({ enabled: false });
        window.dispatchEvent(new CustomEvent("dsui:settings-changed", { detail: next }));
        showToast("已临时停用；重新开启请再点一次或刷新页面");
      });
    } catch {
    }
  }
  function installDebugApi(ui) {
    installWidgetMessageRouter();
    const api = {
      version: "1.3.1",
      getSettings,
      saveSettings,
      resetSettings: () => {
        const saved = saveSettings({ ...DEFAULT_SETTINGS });
        window.dispatchEvent(new CustomEvent("dsui:settings-changed", { detail: saved }));
        return saved;
      },
      openSettings: () => ui.openPanel(),
      previewInjection: (text) => applyInjection(text, getSettings()),
      sendToChat,
      debugState() {
        return {
          settings: getSettings(),
          version: "1.3.1",
          roots: document.querySelectorAll(".ds-markdown.ds-assistant-message-main-content").length,
          blocks: [...document.querySelectorAll(".md-code-block")].map((block) => ({
            lang: readLang(block),
            langRaw: (block.querySelector(".md-code-block-infostring")?.textContent || "").trim(),
            head: (block.querySelector("pre")?.textContent || "").slice(0, 120),
            hidden: block.hasAttribute("data-dsui-hidden")
          })),
          widgets: document.querySelectorAll(".dsui-widget").length,
          injectedCount: window.__dsuiInjectedCount || 0
        };
      },
      debugWidgets() {
        return getAllWidgets().map((w) => ({
          id: w.id,
          theme: w.theme,
          docSeq: w.docSeq,
          ready: w.ready,
          navigated: w.navigated,
          state: w.el?.dataset.state,
          status: w.statusEl?.textContent,
          foot: w.footEl?.textContent
        }));
      },
      mountTestWidget(html, { host: hostEl } = {}) {
        const host = hostEl || document.createElement("div");
        if (!hostEl) {
          host.id = "dsui-test-host";
          host.style.cssText = "position:fixed;left:12px;bottom:12px;width:min(720px,86vw);z-index:2147483000;background:transparent;";
          document.body.appendChild(host);
        }
        const block = document.createElement("div");
        block.className = "md-code-block md-code-block-light";
        const pre = document.createElement("pre");
        pre.textContent = String(html ?? "");
        block.appendChild(pre);
        host.appendChild(block);
        const widget = new Widget(block, { getSettings, onToast: showToast });
        widget.mount();
        widget.update(String(html ?? ""));
        widget.finalize();
        return { widget, host };
      }
    };
    window.__dsui = api;
  }
})();
