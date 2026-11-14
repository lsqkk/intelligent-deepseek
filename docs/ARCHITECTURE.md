# 架构与实现细节

> 面向维护者。记录 2026-11 对 chat.deepseek.com 的实测结论，便于页面改版时快速定位。

## 1. 请求链路

- 线上页面使用 **XMLHttpRequest**（不是 fetch）。发消息请求为
  `POST /api/v0/chat/completion`，JSON body 关键字段：
  ```json
  {
    "chat_session_id": "...",
    "parent_message_id": 1,
    "model_type": "default",
    "prompt": "用户输入",
    "ref_file_ids": [],
    "thinking_enabled": false,
    "search_enabled": true,
    "action": null,
    "preempt": false,
    "shumei_device_id": "..."
  }
  ```
- `src/inject.js` 在 `document-start` 时 patch `XMLHttpRequest.prototype.open/send`：
  - completion / edit_message：把 `prompt` 末尾追加协议块（`⟦DS-UI v1⟧` … `⟦/DS-UI⟧`）。
  - completion：额外挂 `loadend` 监听，记录 `window.__dsuiCompletionCount/At`（测试与调试用）。
  - history_messages：给该 XHR 实例定义自己的 `response`/`responseText` getter，
    在应用读取前对响应对象做深度净化，剥掉协议块。这样**刷新后用户气泡、编辑框、复制内容都是干净的**。
- fetch 分支保留兜底（当前页面未使用）。

### 为什么不在 UI 里改输入框内容

用户看到的本地消息来自前端状态，而不是服务端回包。若直接改输入框，用户会看到协议文本。
改请求体对用户不可见，且服务端保存的 prompt 带协议（模型每轮都能看到），这是有意为之。

### 历史注入问题

DeepSeek 会把带协议的用户消息原样存到服务端。刷新/切会话时 `history_messages` 返回的内容包含协议，
因此在响应被应用消费前净化；另外 `src/renderer.js` 还有一层 DOM 兜底（万一响应净化失效，
把可见用户气泡里的协议文本剪掉）。编辑消息依赖响应净化，因为编辑框读的是前端状态。

## 2. DOM 结构（2026-11 实测）

消息列表：

```html
<div class="ds-message">                       <!-- 一条消息 -->
  <div class="fbb737a4">
    <div class="ds-collapsible-text">…</div>   <!-- 用户消息气泡 -->
  </div>
</div>
<!-- 助手消息 -->
<div class="ds-message">
  <div class="ds-markdown ds-assistant-message-main-content">
    <div class="md-code-block md-code-block-light">
      <div class="md-code-block-banner-wrap">
        <div class="md-code-block-banner md-code-block-banner-lite">
          <div class="_121d384">
            <div class="d2a24f03"><span class="d813de27">dsui</span></div>  <!-- 语言标签 -->
            …复制/下载/运行按钮…
          </div>
        </div>
      </div>
      <pre>…高亮后的代码（textContent 即原文）…</pre>
    </div>
  </div>
</div>
```

要点：
- 线上用了自定义 `CodeInfoRow` 渲染语言标签，**没有** `md-code-block-infostring` 类；
  `readLang()` 因此优先取标准类，退化时解析 banner 的 `textContent` 开头（形如 `html复制下载运行`）。
- 代码原文从 `pre.textContent` 取（即使代码块被 `display:none` 隐藏也可读）。
- 输入框是受控 `<textarea>`（placeholder「给 DeepSeek 发送消息」）；发送按钮是
  `div[role=button].ds-button--circle`，空内容时带 `ds-button--disabled`。
- 生成中时输入区会出现一个「停止生成」按钮（class 含 `ds-button--iconLabelPrimary`，
  svg path 以 `M5.5498 9.75V5` 开头），测试用它判断是否仍在生成。
- 主题：`<body class="zh_CN light|dark">`；`followTheme` 依据 class 判断，兜底看背景亮度。
- 页面 CSP 响应头只有 `frame-ancestors 'none'`，因此 srcdoc iframe + 内联脚本可用。

## 3. 渲染器

`MutationObserver`（body 子树 + characterData，90ms 防抖）+ 3s 轮询兜底：

1. 扫描 `.ds-markdown.ds-assistant-message-main-content` 内的 `.md-code-block`。
2. 语言为 `dsui`（或开启 `renderPlainHtml` 且是完整 `<!doctype html>/<html>`）时：
   - 隐藏代码块（`data-dsui-hidden` + `display:none!important`）；
   - 在代码块后插入卡片 `.dsui-widget`；
   - **dsui 卡片无标题栏/外框/工具栏**（`data-kind="dsui"`，透明背景、无圆角/阴影），高度按内容自然延展（上限 6000px，由页面滚动承接）；html 兜底卡片保留标题与代码/复制/下载，71vh 上限；
   - 卡片里的 iframe 用 `srcdoc` 加载「模型 HTML + 注入的 bridge」，CSP 禁网。
3. 流式期间每次代码内容变化（>650ms 节流）更新 iframe；内容未形成可渲染结构时显示
   「正在构建界面…」占位，避免闪白。
4. 代码 1.4s 不再变化视为完成（`data-state="ready"`），再渲染一次最终版本。
5. React 重渲染可能替换代码块节点：渲染器会在新旧代码块之间「收养」已有卡片
   （检查前后兄弟节点 + 旧 block 已断开），避免重复卡片与状态丢失。
6. 消息被虚拟列表回收 / 设置关闭渲染时销毁卡片，解除 token 注册与定时器。

## 4. iframe 沙箱与 bridge

- `sandbox="allow-scripts"`（无 same-origin / forms / pointer-lock / top-navigation），
  组件拿不到父页面 cookie/localStorage，`event.origin === "null"`。
- 文档内注入 CSP：
  ```
  default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval';
  img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none';
  worker-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'
  ```
- 同时注入基础样式：`html,body{background:transparent;margin:0}` + 隐藏滚动条（`scrollbar-width:none`、`::-webkit-scrollbar{display:none}`）。
- bridge 注入在 `<head>` 最前（早于模型脚本），提供：
  - `window.dsui.sendMessage(text)`：先校验用户手势（`navigator.userActivation` 或 4s 内
    有 trusted pointerdown/keydown），防止页面加载即自动发消息；1.2s 内重复调用会被限流。
  - `window.dsui.setTitle`、`resize`、`theme`、`onThemeChange`。
  - `ResizeObserver` 测量高度 → `postMessage` → 父页面 `clamp(140, h, 72vh)`。
  - 主题：父页面重建 iframe 时传入主题（`data-ds-theme` + 媒体查询展开），不向 iframe 发 token。
- 父页面路由：每个卡片随机 token + 每次 srcdoc 递增 docSeq；只接受 `event.source === iframe.contentWindow`
  且 `data.seq === docSeq` 的消息。
- 回传落地：默认写入草稿；直接发送模式调用 `src/chat.js`：写受控 textarea → 点击发送箭头 →
  校验输入框清空/新消息出现；失败恢复草稿。每卡片 1 分钟最多 5 次。

## 5. 协议

`src/prompt.js` 的 `ZH_PROTOCOL`，核心约束：
- 组件必须放在 ` ```dsui ` 代码块（强格式要求，实测能显著提高遵守率；DeepSeek 默认倾向输出 `html`）；
- 优先一个组件；仅在各部分可独立使用且无需共享状态时拆分；
- 单文件自包含、禁外链/网络、图片 SVG/data URI/emoji；
- 初次渲染即展示结果、避免 100vh；
- 视觉融入对话：根节点/body 不要背景色，不要整体套卡片/外框/阴影；
- 主题变量（--fg/--muted/--border/--accent）+ `:root[data-ds-theme="dark"]`；
- 语言跟随用户、不要用普通代码块替代。

## 6. 组件回传

- bridge 做用户手势检查（`isTrusted` pointerdown/keydown，4s 窗口）和 1.2s 限流；
- 父页面校验 token + docSeq 后默认写入输入框；用户可选择直接发送；
- 每卡片 1 分钟内最多 5 次；
- 这是 UX 防误触，不是密码学安全边界；真正的隔离靠 iframe sandbox + CSP。

## 7. 测试

- 单元：`pnpm test`（34 项：prompt 注入/剥离、深度净化、DOM 语言解析、文档构建、主题 CSS 适配、气泡清理）。
- 离线：`pnpm test:mock`（26 项），用 `tests/mock/mock-deepseek.html` 模拟消息 DOM、流式输出、受控输入框，覆盖渲染、渐进预览、主题、节点替换、草稿回传、无 seq 拒绝、导航拦截、设置面板、清理。
- 真机：`pnpm login` 一次登录后 `pnpm test:e2e`（23 项），真实账号跑：
  注入 → 模型输出 dsui → 渲染/交互/无工具栏 → 组件回传 → 指定会话刷新净化 → 主题 → 设置按钮位置。
  产物在 `test-results/`。

## 8. 改版急救清单

1. 输入框/发送按钮变了 → `src/chat.js`（`getComposer`、`findSendButton`）。
2. 消息/代码块类名变了 → `src/dom.js`（`SELECTORS`、`readLang`、`readCode`）。
3. 请求字段/端点变了 → `src/inject.js`（`COMPLETION_URLS`、`HISTORY_URLS`、字段名）。
4. 主题 class 变了 → `src/theme.js`。
5. 渲染时机问题 → `src/renderer.js` 的扫描与收养逻辑。
6. 组件桥接/沙箱 → `src/widget.js`。
