# DeepSeek Intelligent UI（油猴脚本）

给 [chat.deepseek.com](https://chat.deepseek.com/) 引入类似 GPT-6 **Intelligent UI** 的机制：

1. **自动注入界面协议** —— 脚本启用时，每个新会话的首条消息会携带界面协议；修改影响协议的设置后，下一条消息会携带更新。「每轮都注入」默认关闭。界面上的用户消息保持原样。
2. **流式渲染可交互组件** —— 模型按协议输出 ` ```dsui ` 代码块（自包含 HTML）后，脚本就地渲染成沙箱 iframe：生成过程中渐进刷新、可交互、可拆分多个组件；dsui 卡片**无外框、无标题栏、无工具栏**，和对话自然融合，高度随内容向页面自然延展。
3. **组件回传对话** —— 组件里调用 `window.dsui.sendMessage('...')` 默认填入输入框，由用户编辑或发送（子端有用户手势与频率限制，防止组件加载即自动发消息）。
4. **历史消息自动净化** —— 注入内容存在 DeepSeek 服务端，刷新/切换对话时脚本会在响应被应用读取前剥离注入块，界面、编辑框、复制内容都不会出现协议文本。
5. **主题 / 高度 / 安全** —— 组件跟随 DeepSeek 深浅色（`data-ds-theme` + `@media (prefers-color-scheme)` 兜底）；iframe 高度自适应、内部滚动条隐藏；`sandbox="allow-scripts"`（无 same-origin / forms / top-navigation），CSP 禁止外链、网络请求、表单提交。
6. **设置入口** —— `✦` 按钮默认并排在输入框「上传附件」按钮左边；也可用油猴菜单打开设置。

![组件示例](docs/screenshot.png)

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（Edge / Chrome）。
2. 构建（或直接使用仓库里的 `dist/intelligent-deepseek.user.js`）：
   ```bash
   pnpm install && pnpm build
   ```
3. 打开 Tampermonkey 管理面板 → 实用工具 → 导入，选择 `dist/intelligent-deepseek.user.js`；或把文件拖进浏览器安装页。
4. 打开 <https://chat.deepseek.com/>，登录后 `✦` 按钮会并排在输入框「上传附件」按钮左边（也可用油猴菜单「✦ Intelligent UI 设置」）。

## 使用

- **表格操作** —— 回答里的 Markdown 表格默认铺满正文，超宽时可横向滚动。可点击列旁的箭头，依次切换升序、降序和原始顺序。复制为制表符分隔文本、下载 CSV 或 XLSX 均使用当前显示的顺序。
- **回答内地图** —— 试试「把西安碑林博物馆和钟楼按游览顺序标在地图上」。插件用 Photon 查询城市和地标名，再在 OpenStreetMap 底图上标点。点击标记可核对匹配地址。未匹配的地点保留 OpenStreetMap 搜索入口，旧回复中的坐标格式仍可用。
- **实时天气卡** —— 试试「北京未来 5 天天气」。插件将城市或城市加地区发给 Open-Meteo，显示查询到的地点、当前天气和预报。查询失败时天气卡会收起。
- **回答内配图** —— 更新脚本后开一个新对话，试试「介绍小熊猫，并在正文中插入 3 张照片」。有可靠直链时可用独立的 Markdown 图片，单独成段的常见图片直链也会自动渲染。需要找图时，插件把模型生成的关键词发给 Wikimedia Commons，每组最多展示 6 张。两种方式都在图片加载成功后展示，无图时正文自然衔接。搜索无需登录或 API Key。
- 正常对话即可。遇到适合界面的问题（数据可视化、计算器、规划、表单、模拟、教学、小游戏等），模型会在简短说明后输出 `dsui` 组件，脚本自动渲染；一次回答可以包含多个组件卡片。
- **dsui 卡片去掉外框与标题栏**，无圆角/边框/阴影/工具栏，和上下文自然衔接；组件高度自适应并向页面自然延展。
- 若模型输出普通 `html` 完整文档，走兜底卡片并保留 **标题 / 代码 / 复制 / 下载**（这条路径样式不变）。
- 组件内调用 `window.dsui.sendMessage(...)` 默认填入输入框；组件加载时自动调用会被手势检查拦截。
- 若模型偷懒输出普通 `html` 完整文档，默认也会被渲染（设置里可关掉；注意这会把教程里的完整 HTML 也执行起来）。
- 在设置里可分别开关表格铺满、排序、复制与下载、配图、天气和地图。设置即时保存并更新当前页面；影响模型输出的设置从下一条消息起生效。

## 组件 API（给模型生成的 HTML 用）

```js
window.dsui.sendMessage('帮我把这个结果再解释一下') // 填入输入框（需用户点击触发）
window.dsui.setTitle('自定义标题')                  // 更新卡片标题
window.dsui.resize()                               // 手动触发高度重测
window.dsui.theme                                  // 'light' | 'dark'
```

- 组件必须是单文件、内联 CSS/JS，不能访问网络（CSP `connect-src 'none'`、`default-src 'none'`），图片只能用 SVG / data URI / emoji。
- 组件运行在 opaque origin 的 iframe 里，**不能使用 localStorage/sessionStorage**，状态放内存。
- 主题：客户端在 `<html>` 上设置 `data-ds-theme="light|dark"`；推荐用 `:root[data-ds-theme="dark"]` 覆盖变量，也兼容只用 `@media (prefers-color-scheme: dark)` 的写法（脚本会按当前主题展开媒体查询）。
- 需要继续对话时调用 `window.dsui.sendMessage(...)`；子端手势检查会阻止组件加载时自动发送，点击触发后默认填入输入框。

## 开发

```bash
pnpm install
pnpm test          # 单元测试（Vitest + jsdom）
pnpm build         # 构建 dist/intelligent-deepseek.user.js
pnpm test:mock     # 离线 mock E2E（不登录、不耗额度）
pnpm login         # 打开可见 Edge 窗口手动登录一次（保存 .browser-profile / .auth）
pnpm test:e2e      # 真实账号 E2E（23 项检查，会创建测试对话）
```

### 目录

```
src/
  main.js         入口：帧判断、启动拦截/渲染/设置
  inject.js       XHR/fetch 拦截：注入 prompt、净化 history/share 响应
  prompt.js       协议文本、末尾块注入与剥离
  sanitize.js     响应/对象深度净化
  renderer.js     DOM 扫描、卡片生命周期、兜底清理
  images.js       Wikimedia Commons 搜索与回答内图组
  widget.js       iframe 沙箱、bridge、工具栏、渐进式渲染
  dom.js          DeepSeek DOM 适配（集中改版修复点）
  chat.js         受控 textarea 的程序化发送（草稿保护 / 发送箭头识别）
  settings.js     设置存取（GM_* 优先，localStorage 兜底）
  settings-ui.js  输入框旁设置按钮 + Shadow DOM 设置面板 + toast
  theme.js        深浅色检测/监听
  styles.js       全局样式
tests/
  unit/           Vitest 单元测试
  mock/           离线 DeepSeek DOM 模拟页面
  e2e/mock.mjs    离线 mock E2E
  e2e/run.mjs     真实站点端到端测试
docs/
  ARCHITECTURE.md 请求链路、DOM 结构、沙箱、改版急救清单
scripts/
  build.mjs       esbuild 打包 + 油猴头
  login.mjs       手动登录并保存浏览器态
```

更细的请求格式、DOM 选择器与实现决策见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

### 已知限制 / 风险

- 协议依赖模型配合；不遵守时会退化为普通代码块（可用 `renderPlainHtml` 兜底渲染完整 HTML）。`renderPlainHtml` 默认关闭，开启后可在禁网沙箱中渲染完整 HTML。已有显式设置会保留。
- `regenerate`（重新生成）请求没有 prompt 字段，无法补协议；如果该轮用户消息是安装脚本前发送的，重新生成不会带协议。
- 注入会存进 DeepSeek 服务端：**分享/导出/未安装脚本的查看者可能看到协议文本**（`share/content` 只对装了脚本的查看者生效）。介意隐私时可在设置里关掉「自动注入」。
- 主题切换会重建组件 iframe，组件内部状态（输入、滚动位置）会丢失。
- 组件回传默认先写入草稿，可在设置中改为直接发送；子端有用户手势与每卡片 1 分钟 5 次频率限制，属于 UX 防误触而非密码学边界。
- 组件内 `localStorage`、外部请求、表单提交、外部链接、自行导航都会被阻止；检测到导航会停用该卡片。
- DeepSeek 前端改版后选择器可能失效，改动点集中在 `src/dom.js`、`src/inject.js`、`src/chat.js`、`src/theme.js`。
- E2E 在 Edge + Playwright（页面 realm 注入）验证；Tampermonkey `@grant` 沙箱没有单独自动化验证，安装后建议先发一条「做个颜色选择器」冒烟。

## 隐私说明

- 注入只发生在本地浏览器发出的请求体中，不经过第三方服务器。
- 登录态保存在本机 `.browser-profile` / `.auth`（已 gitignore），仅用于本机测试。
- 测试账号的对话记录会出现在 DeepSeek 历史里（E2E 会创建含「RGB 颜色选择器」「BACKCHANNEL_OK」等字样的对话），可自行删除。

## License

MIT
