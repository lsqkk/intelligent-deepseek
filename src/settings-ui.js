/** 悬浮设置按钮 + 设置面板（Shadow DOM 隔离样式）+ toast */

import { DEFAULT_SETTINGS, saveSettings, updateSettings } from './settings.js';
import { ensureToast } from './styles.js';

let toastTimer = null;

export function showToast(text, duration = 2000) {
  const el = ensureToast();
  el.textContent = text;
  el.classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-show'), duration);
}

const PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
.wrap { position: fixed;
  right: 18px;
  bottom: min(142px, 22dvh);
  width: min(360px, calc(100vw - 36px));
  max-height: min(74dvh, 640px);
  overflow: auto;
  scrollbar-width: none;
  border-radius: 14px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 18px 50px rgba(0,0,0,.22);
  z-index: 2147483003;
  padding: 14px 14px 12px;
  animation: in .16s ease-out;
}
.wrap::-webkit-scrollbar { display: none; }
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
.group { margin-bottom: 14px; }
.group-title { margin: 0; color: var(--muted); font-size: 11px; font-weight: 600; }
.group .row:last-child { border-bottom: 0; }
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
.btn:active { transform: translateY(1px); }
.hint { margin-top: 9px; font-size: 10.5px; color: var(--muted); line-height: 1.5; }
`;

const VERSION = typeof __DS_VERSION__ === 'undefined' ? 'dev' : __DS_VERSION__;

const GROUPS = [
  ['常规', [
    ['enabled', '启用 Intelligent UI', '自动注入界面协议并渲染交互组件'],
    ['injectEveryTurn', '每轮都注入', '开启后每条消息都会携带协议'],
    ['renderPlainHtml', '渲染普通 HTML 完整文档', '模型未按协议输出时的兜底，也会渲染教程中的完整 HTML'],
    ['allowWidgetSend', '允许组件回传消息', '组件可把你的选择带回输入框'],
  ]],
  ['表格', [
    ['tableFullWidth', '表格铺满回答区域', '超宽表格可横向滚动'],
    ['tableSort', '按列排序', '点击表头切换升序、降序和原始顺序'],
    ['tableExport', '复制和下载表格', '提供复制、CSV 和 XLSX'],
  ]],
  ['回答内卡片', [
    ['inlineImages', '回答内配图', '预览图片直链，或从 Wikimedia Commons 获取配图'],
    ['weatherCards', '天气卡片', '显示实时天气与预报'],
    ['mapCards', '地图卡片', '在地图上展示地点和路线入口'],
  ]],
];

export function installSettingsUI({ getSettings }) {
  let panelHost = null;
  const fab = document.createElement('button');

  const openPanel = () => {
    if (panelHost?.isConnected) {
      closePanel();
      return;
    }
    panelHost = document.createElement('div');
    panelHost.id = 'dsui-settings-host';
    const shadow = panelHost.attachShadow({ mode: 'open' });
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
        <h2 class="group-title">界面偏好</h2>
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
          <button class="btn" type="button" data-act="reset">恢复默认</button>
        </div>
        <div class="hint">改动即时保存；界面偏好在下一条消息发送时应用。</div>
      </div>
    `;

    const body = shadow.querySelector('.body');
    for (const [title, items] of GROUPS) {
      const group = document.createElement('section');
      group.className = 'group';
      group.innerHTML = `<h2 class="group-title">${title}</h2>`;
      for (const [key, label, desc] of items) {
        group.insertAdjacentHTML('beforeend', `
          <div class="row">
            <input type="checkbox" class="switch" id="dsui-setting-${key}" data-field="${key}">
            <label for="dsui-setting-${key}">${label}<span class="desc">${desc}</span></label>
          </div>
        `);
      }
      body.appendChild(group);
    }
    const fields = shadow.querySelectorAll('[data-field]');
    const applyToForm = (settings) => {
      for (const field of fields) {
        if (field.type === 'checkbox') field.checked = settings[field.dataset.field];
        else field.value = settings[field.dataset.field];
      }
    };
    applyToForm(getSettings());
    for (const field of fields) {
      const saveField = () => updateSettings({
        [field.dataset.field]: field.type === 'checkbox' ? field.checked : field.value,
      });
      field.addEventListener(field.tagName === 'TEXTAREA' ? 'input' : 'change', saveField);
    }
    shadow.querySelector('.close').addEventListener('click', closePanel);
    shadow.querySelector('[data-act="reset"]').addEventListener('click', () => applyToForm(saveSettings(DEFAULT_SETTINGS)));

    // Esc 关闭
    const onKey = (event) => {
      if (event.key === 'Escape') closePanel();
    };
    shadow.__onKey = onKey;
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(panelHost);
    fab.classList.add('is-open');
  };

  const closePanel = () => {
    if (!panelHost) return;
    const shadow = panelHost.shadowRoot;
    if (shadow?.__onKey) document.removeEventListener('keydown', shadow.__onKey, true);
    panelHost.remove();
    panelHost = null;
    fab.classList.remove('is-open');
  };

  /** 优先放到输入框附件按钮左边；找不到输入框时用右下角悬浮兜底 */
  const placeFab = () => {
    const fileInput = document.querySelector('input[type="file"]');
    const uploadRow = fileInput?.parentElement;
    if (uploadRow && uploadRow.querySelector('[role="button"]')) {
      if (fab.parentElement !== uploadRow) uploadRow.insertBefore(fab, uploadRow.firstElementChild);
      fab.classList.remove('dsui-fab-floating');
      fab.hidden = false;
      return;
    }
    if (fab.parentElement !== document.body) document.body.appendChild(fab);
    fab.classList.add('dsui-fab-floating');
    fab.hidden = false;
  };

  fab.id = 'dsui-fab';
  fab.type = 'button';
  fab.title = 'Intelligent UI 设置';
  fab.setAttribute('aria-label', fab.title);
  fab.textContent = '✦';
  fab.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPanel();
  });
  placeFab();
  setTimeout(placeFab, 600);
  setTimeout(placeFab, 1500);
  setInterval(placeFab, 1200);
  return { openPanel, closePanel };
}
