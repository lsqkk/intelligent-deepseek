/** 悬浮设置按钮 + 设置面板（Shadow DOM 隔离样式）+ toast */

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings.js';
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
.wrap {  position: fixed;
  right: 18px;
  bottom: 142px;
  width: 336px;
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

const VERSION = typeof __DS_VERSION__ === 'undefined' ? 'dev' : __DS_VERSION__;

const TOGGLES = [
  { key: 'enabled', label: '启用 Intelligent UI', desc: '总开关：关闭后不注入、不渲染' },
  { key: 'injectPrompt', label: '自动注入界面协议', desc: '新会话首条消息注入一次（推荐）' },
  { key: 'injectEveryTurn', label: '每轮都注入', desc: '默认关闭；开启后每轮携带协议，更耗 token' },
  { key: 'autoRender', label: '自动渲染 dsui 代码块', desc: '流式生成时实时刷新为可交互 iframe' },
  { key: 'renderPlainHtml', label: '同时渲染普通 html 完整文档', desc: '模型没按协议输出时的兜底，可能误伤代码展示' },
  { key: 'allowWidgetSend', label: '允许组件回传消息', desc: '组件调用 dsui.sendMessage 时直接发一条对话' },
  { key: 'showFab', label: '显示设置按钮', desc: '默认在输入框附件按钮左侧，关闭后可用油猴菜单打开' },
];

export function installSettingsUI({ getSettings }) {
  let panelHost = null;
  let fab = null;
  let fabPlacementTimer = null;

  const openPanel = () => {
    if (panelHost?.isConnected) {
      closePanel();
      return;
    }
    panelHost = document.createElement('div');
    panelHost.id = 'dsui-settings-host';
    const shadow = panelHost.attachShadow({ mode: 'open' });
    const settings = getSettings();
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
          <div class="label"><span>协议语言</span></div>
          <select data-field="protocolLanguage">
            <option value="zh">中文（推荐）</option>
            <option value="en">English</option>
          </select>
        </div>
        <div class="field">
          <div class="label"><span>附加要求（可选）</span><span style="font-size:10px">会拼进协议末尾</span></div>
          <textarea data-field="customProtocol" placeholder="例如：组件使用极简风格；优先输出 SVG 图表。"></textarea>
        </div>
        <div class="foot">
          <button class="btn primary" type="button" data-act="save">保存</button>
          <button class="btn" type="button" data-act="reset">恢复默认</button>
        </div>
        <div class="hint">设置通过油猴存储保存。注入只作用于发往 DeepSeek 的请求，不修改对话显示；历史消息读取时会自动剥离注入内容。</div>
      </div>
    `;

    // 渲染开关行
    const body = shadow.querySelector('.body');
    for (const item of TOGGLES) {
      const row = document.createElement('div');
      row.className = 'row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'switch';
      input.checked = Boolean(settings[item.key]);
      input.dataset.field = item.key;
      const label = document.createElement('label');
      input.id = `dsui-setting-${item.key}`;
      label.htmlFor = input.id;
      label.innerHTML = `${item.label}<span class="desc">${item.desc}</span>`;
      row.append(input, label);
      body.appendChild(row);
    }

    const langSelect = shadow.querySelector('[data-field="protocolLanguage"]');
    langSelect.value = settings.protocolLanguage === 'en' ? 'en' : 'zh';
    const custom = shadow.querySelector('[data-field="customProtocol"]');
    custom.value = settings.customProtocol || '';

    shadow.querySelector('.close').addEventListener('click', closePanel);
    shadow.querySelector('[data-act="reset"]').addEventListener('click', () => {
      const defaults = { ...DEFAULT_SETTINGS };
      applyToForm(defaults);
      save(defaults);
    });
    shadow.querySelector('[data-act="save"]').addEventListener('click', () => {
      save(readForm());
    });

    const applyToForm = (s) => {
      shadow.querySelectorAll('input[data-field]').forEach((input) => {
        input.checked = Boolean(s[input.dataset.field]);
      });
      langSelect.value = s.protocolLanguage === 'en' ? 'en' : 'zh';
      custom.value = s.customProtocol || '';
    };

    const readForm = () => {
      const next = { ...getSettings() };
      shadow.querySelectorAll('input[data-field]').forEach((input) => {
        next[input.dataset.field] = input.checked;
      });
      next.protocolLanguage = langSelect.value;
      next.customProtocol = custom.value.trim();
      return next;
    };

    const save = (next) => {
      const saved = saveSettings(next);
      window.dispatchEvent(new CustomEvent('dsui:settings-changed', { detail: saved }));
      syncFab(saved);
      showToast('Intelligent UI 设置已保存');
      closePanel();
    };

    // Esc 关闭
    const onKey = (event) => {
      if (event.key === 'Escape') closePanel();
    };
    shadow.__onKey = onKey;
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(panelHost);
    fab?.classList.add('is-open');
  };

  const closePanel = () => {
    if (!panelHost) return;
    const shadow = panelHost.shadowRoot;
    if (shadow?.__onKey) document.removeEventListener('keydown', shadow.__onKey, true);
    panelHost.remove();
    panelHost = null;
    fab?.classList.remove('is-open');
  };

  const syncFab = (settings = getSettings()) => {
    const shouldShow = settings.showFab !== false;
    if (shouldShow && !fab) {
      fab = document.createElement('button');
      fab.id = 'dsui-fab';
      fab.type = 'button';
      fab.title = 'Intelligent UI 设置';
      fab.setAttribute('aria-label', 'Intelligent UI 设置');
      fab.textContent = '✦';
      fab.addEventListener('click', (event) => {
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

  /** 优先放到输入框附件按钮左边；找不到输入框时用右下角悬浮兜底 */
  const placeFab = () => {
    if (!fab) return;
    const fileInput = document.querySelector('input[type="file"]');
    const uploadRow = fileInput?.parentElement;
    if (uploadRow && uploadRow.querySelector('[role="button"]')) {
      if (fab.parentElement !== uploadRow) uploadRow.insertBefore(fab, uploadRow.firstElementChild);
      fab.classList.remove('dsui-fab-floating');
      fab.title = 'Intelligent UI 设置（注入协议 / 渲染 / 回传确认）';
      fab.hidden = false;
      return;
    }
    if (fab.parentElement !== document.body) document.body.appendChild(fab);
    fab.classList.add('dsui-fab-floating');
    fab.hidden = false;
  };

  syncFab();
  return { openPanel, closePanel, syncFab };
}
