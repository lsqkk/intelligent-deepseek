/** 入口：尽早安装网络拦截；DOM 就绪后启动渲染和设置界面 */

import { loadSettings, saveSettings, updateSettings, DEFAULT_SETTINGS } from './settings.js';
import { installInterceptors } from './inject.js';
import { injectStyles } from './styles.js';
import { startRenderer } from './renderer.js';
import { installSettingsUI, showToast } from './settings-ui.js';
import { Widget, installWidgetMessageRouter, getAllWidgets } from './widget.js';
import { sendToChat } from './chat.js';
import { applyInjection } from './prompt.js';
import { readLang } from './dom.js';

const getSettings = () => loadSettings();

const isTopFrame = (() => {
  try {
    return window.top === window.self;
  } catch {
    return false;
  }
})();

function main() {
  // 必须在页面脚本发请求前安装（@run-at document-start）
  installInterceptors(getSettings);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}

if (isTopFrame) main();

function boot() {
  if (document.documentElement.dataset.dsuiBooted === '1') return;
  document.documentElement.dataset.dsuiBooted = '1';

  injectStyles();
  const rendererStop = startRenderer({ getSettings, onToast: showToast });
  const ui = installSettingsUI({ getSettings });

  registerMenu(ui);
  if (getSettings().debug) installDebugApi(ui);

  if (getSettings().debug) {
    console.info('[DS-UI] booted', __DS_VERSION__, 'settings=', getSettings());
    setTimeout(() => console.info('[DS-UI] debug state', window.__dsui?.debugState?.()), 3000);
  }
  window.addEventListener('beforeunload', () => rendererStop?.());
}

function registerMenu(ui) {
  try {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('✦ Intelligent UI 设置', () => ui.openPanel());
    GM_registerMenuCommand('切换「自动注入协议」', () => {
      const next = updateSettings({ injectPrompt: !getSettings().injectPrompt });
      showToast(next.injectPrompt ? '已开启协议注入' : '已关闭协议注入');
    });
    GM_registerMenuCommand('切换「自动渲染界面」', () => {
      const next = updateSettings({ autoRender: !getSettings().autoRender });
      showToast(next.autoRender ? '已开启自动渲染' : '已关闭自动渲染');
      window.dispatchEvent(new CustomEvent('dsui:settings-changed', { detail: next }));
    });
    GM_registerMenuCommand('退出全屏 / 恢复对话输入框', () => {
      getAllWidgets().forEach((widget) => widget.exitFullscreen());
      showToast('已退出全屏，输入框恢复');
    });
    GM_registerMenuCommand('临时停用脚本（恢复原始代码块）', () => {
      const next = updateSettings({ enabled: false });
      window.dispatchEvent(new CustomEvent('dsui:settings-changed', { detail: next }));
      showToast('已临时停用；重新开启请再点一次或刷新页面');
    });
  } catch {}
}

/** 调试 / E2E 钩子：可直接挂载一个测试组件，不依赖模型输出 */
function installDebugApi(ui) {
  installWidgetMessageRouter();
  const api = {
    version: __DS_VERSION__,
    getSettings,
    saveSettings,
    resetSettings: () => {
      const saved = saveSettings({ ...DEFAULT_SETTINGS });
      window.dispatchEvent(new CustomEvent('dsui:settings-changed', { detail: saved }));
      return saved;
    },
    openSettings: () => ui.openPanel(),
    previewInjection: (text) => applyInjection(text, getSettings()),
    sendToChat,
    debugState() {
      return {
        settings: getSettings(),
        version: __DS_VERSION__,
        roots: document.querySelectorAll('.ds-markdown.ds-assistant-message-main-content').length,
        blocks: [...document.querySelectorAll('.md-code-block')].map((block) => ({
          lang: readLang(block),
          langRaw: (block.querySelector('.md-code-block-infostring')?.textContent || '').trim(),
          head: (block.querySelector('pre')?.textContent || '').slice(0, 120),
          hidden: block.hasAttribute('data-dsui-hidden'),
        })),
        widgets: document.querySelectorAll('.dsui-widget').length,
        injectedCount: window.__dsuiInjectedCount || 0,
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
        pending: w.pending,
        status: w.statusEl?.textContent,
        foot: w.footEl?.textContent,
      }));
    },
    mountTestWidget(html, { host: hostEl } = {}) {
      const host = hostEl || document.createElement('div');
      if (!hostEl) {
        host.id = 'dsui-test-host';
        host.style.cssText =
          'position:fixed;left:12px;bottom:12px;width:min(720px,86vw);z-index:2147483000;background:transparent;';
        document.body.appendChild(host);
      }
      const block = document.createElement('div');
      block.className = 'md-code-block md-code-block-light';
      const pre = document.createElement('pre');
      pre.textContent = String(html ?? '');
      block.appendChild(pre);
      host.appendChild(block);
      const widget = new Widget(block, { getSettings, onToast: showToast });
      widget.mount();
      widget.update(String(html ?? ''));
      widget.finalize();
      return { widget, host };
    },
  };
  window.__dsui = api;
}
