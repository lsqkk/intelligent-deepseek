/** 全局样式（组件卡片、隐藏的原代码块、FAB、toast） */

export const STYLE_ID = 'dsui-global-style';

const CSS = __DS_LEAFLET_CSS__ + `
.md-code-block[data-dsui-hidden="1"] { display: none !important; }
[data-dsui-env-hidden] { display: none !important; }
.ds-markdown [data-dsui-env] {
  --dsui-env-accent: #4263c0;
  margin-block: 0;
  padding: 2px 14px;
  border: 0;
  border-inline-start: 3px solid var(--dsui-env-accent);
  background: color-mix(in srgb, var(--dsui-env-accent) 10%, transparent);
  color: inherit;
}
.ds-markdown :is(ul, ol)[data-dsui-env] { padding-inline-start: 34px; }
.ds-markdown [data-dsui-env="academic"] { --dsui-env-accent: #8260ca; }
.ds-markdown [data-dsui-env="warning"] { --dsui-env-accent: #b37515; }
.ds-markdown [data-dsui-env="tip"] { --dsui-env-accent: #248263; }
.ds-markdown [data-dsui-env="danger"] { --dsui-env-accent: #c64352; }
.ds-markdown :is([data-dsui-env-edge="start"], [data-dsui-env-edge="both"]) {
  margin-block-start: 12px;
  padding-block-start: 10px;
  border-start-end-radius: 10px;
}
.ds-markdown :is([data-dsui-env-edge="end"], [data-dsui-env-edge="both"]) {
  margin-block-end: 12px;
  padding-block-end: 10px;
  border-end-end-radius: 10px;
}
.ds-markdown [data-dsui-env-heading] { display: block; font-size: 0.94em; overflow-wrap: anywhere; }
.ds-markdown blockquote[data-dsui-env] > :first-child { margin-block-start: 0; }
.ds-markdown blockquote[data-dsui-env] > :last-child { margin-block-end: 0; }
.dsui-diagram[data-dsui-diagram-ready] { margin-block: 12px; }
.dsui-diagram iframe { display: block; width: 100%; height: 1px; border: 0; }
.dsui-diagram iframe[aria-hidden="true"] { position: absolute; opacity: 0; pointer-events: none; }
.dsui-diagram { position: relative; }
.dsui-diagram button {
  margin-block-end: 6px; padding: 3px 7px; font: inherit; font-size: 12px; color: inherit;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 6px;
  background: transparent; cursor: pointer;
}
.dsui-diagram button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
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

.dsui-table-tools { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-bottom: 4px; min-width: 0; max-width: 100%; }
.dsui-table-tools button:disabled { opacity: .5; cursor: wait; }
.dsui-table-tools button,
.dsui-table-sort {
  color: inherit;
  font: inherit;
  font-size: 12px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  padding: 4px 6px;
  cursor: pointer;
}
.dsui-table-tools button:hover,
.dsui-table-sort:hover { background: color-mix(in srgb, currentColor 9%, transparent); }
.dsui-table-sort { margin-inline-start: 4px; }
.dsui-table-sort::before { content: '↕'; }
th[aria-sort="ascending"] > .dsui-table-sort::before { content: '↑'; }
th[aria-sort="descending"] > .dsui-table-sort::before { content: '↓'; }

.dsui-data-card { margin: 12px 0; min-width: 0; }
.dsui-data-card[hidden], .dsui-map-canvas[hidden] { display: none !important; }
.ds-markdown .dsui-reference .dsui-reference-link {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 14px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 12px;
  background: color-mix(in srgb, currentColor 3%, transparent);
  color: inherit;
  text-decoration: none;
}
.ds-markdown .dsui-reference .dsui-reference-link:hover {
  background: color-mix(in srgb, currentColor 7%, transparent);
}
.dsui-reference-link + .dsui-reference-link { margin-block-start: 8px; }
.ds-markdown .dsui-reference-link:hover .dsui-reference-title { text-decoration: underline; }
.ds-markdown .dsui-reference-link:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.dsui-reference-body { display: grid; gap: 3px; min-width: 0; overflow-wrap: anywhere; }
.dsui-reference-title { line-height: 1.35; }
.dsui-reference-source, .dsui-reference-description { color: color-mix(in srgb, currentColor 76%, transparent); }
.dsui-reference-source { font-size: 12px; }
.dsui-reference-description { font-size: 13px; }
.dsui-reference-arrow { flex: none; }
.dsui-map-canvas { height: clamp(220px, 42vw, 360px); border-radius: 12px; isolation: isolate; }
.dsui-map-canvas img.leaflet-tile { margin: 0 !important; border-radius: 0 !important; }
.dsui-map-canvas a { color: #0958a5; }
.dsui-map-address { display: block; margin-top: 4px; }
.dsui-map-pin {
  display: grid; place-items: center; border: 2px solid white; border-radius: 50%;
  background: #345be0; color: white; font-weight: 700; box-shadow: 0 1px 5px #0005;
}
.dsui-map-places { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 8px; font-size: 13px; }
.dsui-map-places button {
  color: inherit; background: transparent; font: inherit; cursor: pointer;
  border: 1px solid color-mix(in srgb, currentColor 22%, transparent); border-radius: 7px; padding: 4px 8px;
}
.dsui-weather {
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: 12px; padding: 12px 14px;
}
.dsui-weather-header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; }
.ds-markdown .dsui-weather .dsui-weather-days {
  list-style: none; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 88px), 1fr));
  gap: 8px; padding: 0; margin: 10px 0;
}
.ds-markdown .dsui-weather-days > li {
  margin: 0; display: flex; flex-direction: column; gap: 3px;
  padding: 7px 9px; font-size: 13px; border-radius: 8px;
  background: color-mix(in srgb, currentColor 6%, transparent);
}
.dsui-weather-source { font-size: 12px; }

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

export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

export function ensureToast() {
  let el = document.getElementById('dsui-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dsui-toast';
    document.body?.appendChild(el);
  }
  return el;
}
