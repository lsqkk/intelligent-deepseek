/**
 * 渲染调度：监听消息 DOM，把 dsui 代码块替换（隐藏）为交互式组件卡片。
 * 兼容流式输出（内容增长时渐进刷新 iframe）与 React 重渲染（节点被替换后自动重建）。
 */
import { PROMPT_END, PROMPT_START } from './prompt.js';
import { findAssistantRoots, readCode, readLang, shouldRenderBlock, SELECTORS } from './dom.js';
import { Widget, installWidgetMessageRouter, applyThemeToAll } from './widget.js';
import { detectTheme, watchTheme } from './theme.js';
import { ImageGallery, readDirectImage, readImageRequest } from './images.js';
import { TableTools } from './tables.js';
import { DataCard, readDataCard } from './data-card.js';

const SCAN_DEBOUNCE_MS = 90;

export function startRenderer({ getSettings, onToast }) {
  installWidgetMessageRouter();

  const widgets = new Map(); // block element -> Widget
  const tables = new Map();
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
        console.warn('[DS-UI] scan error:', error);
      }
    }, SCAN_DEBOUNCE_MS);
  };

  const scan = () => {
    if (stopped) return;
    const settings = getSettings() || {};
    const enabled = settings.enabled && settings.autoRender;
    if (!enabled) {
      teardownAll();
      return;
    }

    const seen = new Set();
    const seenTables = new Set();
    const renderCard = (block, Card, request) => {
      seen.add(block);
      const current = widgets.get(block);
      if (current instanceof Card && current.el.isConnected && current.key === JSON.stringify(request)) return;
      current?.destroy();
      const card = new Card(block, request);
      widgets.set(block, card);
      card.mount();
    };
    for (const root of findAssistantRoots(document)) {
      for (const table of root.querySelectorAll('table')) {
        if (table.closest(SELECTORS.codeBlock) || !table.rows.length) continue;
        seenTables.add(table);
        if (!tables.has(table)) tables.set(table, new TableTools(table, onToast));
        tables.get(table).refresh();
      }
      for (const block of root.querySelectorAll('p')) {
        const request = readDirectImage(block);
        if (request) renderCard(block, ImageGallery, request);
      }
      for (const block of root.querySelectorAll(SELECTORS.codeBlock)) {
        const lang = readLang(block);
        if (lang === 'dsui-image') {
          renderCard(block, ImageGallery, readImageRequest(readCode(block)));
          continue;
        }
        const dataCard = readDataCard(lang, readCode(block));
        if (dataCard) {
          renderCard(block, DataCard, dataCard);
          continue;
        }
        if (!shouldRenderBlock(block, settings)) {
          // 之前渲染过但设置变了/内容变了：恢复原代码块
          if (block.hasAttribute('data-dsui-hidden') && !widgets.has(block)) {
            block.removeAttribute('data-dsui-hidden');
          }
          continue;
        }
        seen.add(block);
        block.setAttribute('data-dsui-hidden', '1');

        let widget = widgets.get(block);
        if (widget && (!(widget instanceof Widget) || !widget.el?.isConnected || widget.block !== block)) {
          widget.destroy();
          widgets.delete(block);
          widget = null;
        }
        if (!widget) {
          widget = adoptAdjacentWidget(block);
        }
        if (!widget) {
          const kind = lang === 'html' || lang === 'htm' || lang === 'svg' ? 'html' : 'dsui';
          widget = new Widget(block, { getSettings, onToast, kind });
          widgets.set(block, widget);
          widget.mount();
        } else if (widget.block !== block) {
          // 复用了隔壁已有卡片：绑定到新节点
          widget.block = block;
          block.setAttribute('data-dsui-hidden', '1');
          block.after(widget.el);
        }

        block.setAttribute('data-dsui-hidden', '1');
        widget.update(readCode(block));
      }
    }
    for (const [table, tools] of tables) {
      if (seenTables.has(table)) continue;
      tools.destroy();
      tables.delete(table);
    }

    // 清理已经不属于任何消息的卡片
    for (const [block, widget] of [...widgets]) {
      if (!seen.has(block) || !block.isConnected || !widget.el?.isConnected) {
        widget.destroy();
        widgets.delete(block);
      }
    }

    cleanInjectedUserBubbles();
  };

  /** React 重渲染时新代码块可能插在旧卡片旁边：复用旧卡片而不是新建 */
  const adoptAdjacentWidget = (block) => {
    const message = block.closest('.ds-message');
    const candidates = [block.previousElementSibling, block.nextElementSibling].filter(
      (el) => el && el.classList && el.classList.contains('dsui-widget') && el.closest('.ds-message') === message
    );
    for (const el of candidates) {
      const id = el.dataset.dsuiId;
      for (const [oldBlock, widget] of [...widgets]) {
        if (widget.id === id && !oldBlock.isConnected) {
          widgets.delete(oldBlock);
          widgets.set(block, widget);
          block.setAttribute('data-dsui-hidden', '1');
          block.after(widget.el);
          return widget;
        }
      }
    }
    return null;
  };

  const teardownAll = () => {
    for (const tools of tables.values()) tools.destroy();
    tables.clear();
    for (const [block, widget] of [...widgets]) {
      widget.destroy();
      widgets.delete(block);
      if (block?.isConnected) block.removeAttribute('data-dsui-hidden');
    }
  };

  const stopTheme = watchTheme((next) => {
    theme = next;
    applyThemeToAll(next);
    scheduleScan();
  });

  const onSettingsChanged = () => scheduleScan();
  window.addEventListener('dsui:settings-changed', onSettingsChanged);

  observer = new MutationObserver(scheduleScan);
  const observe = () => {
    if (document.body) {
      observer.observe(document.body, {
        childList: true, subtree: true, characterData: true, attributeFilter: ['src', 'href', 'alt'],
      });
      scheduleScan();
    } else {
      document.addEventListener('DOMContentLoaded', observe, { once: true });
    }
  };
  observe();

  // 兜底轮询：极少数虚拟列表场景下 MutationObserver 会漏掉节点替换
  const fallbackTimer = setInterval(scheduleScan, 3000);

  return () => {
    stopped = true;
    clearTimeout(scanTimer);
    scanTimer = null;
    clearInterval(fallbackTimer);
    observer?.disconnect();
    stopTheme();
    window.removeEventListener('dsui:settings-changed', onSettingsChanged);
    teardownAll();
  };
}

/* ------------------------------------------------------------------ */
/* 兜底：如果历史消息净化没生效，至少把用户气泡里看到的注入文本剪掉      */
/* ------------------------------------------------------------------ */

function cleanInjectedUserBubbles() {
  const bubbles = document.querySelectorAll(SELECTORS.userBubble);
  for (const bubble of bubbles) {
    if (!bubble.textContent?.includes(PROMPT_START)) continue;
    stripInjectionFromNode(bubble);
  }
}

export function stripInjectionFromNode(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  const combined = nodes.map((n) => n.data).join('');
  let clean = combined;
  // 只剥「末尾」块，且从最后一个 START 开始；支持多个尾部块
  for (let guard = 0; guard < 8; guard++) {
    const trimmed = clean.replace(/\s+$/, '');
    if (!trimmed.endsWith(PROMPT_END)) break;
    const endIndex = trimmed.length - PROMPT_END.length;
    const start = trimmed.lastIndexOf(PROMPT_START, endIndex);
    if (start < 0) break;
    clean = trimmed.slice(0, start).replace(/\s+$/, '');
  }
  if (clean === combined) return false;

  // clean 一定是 combined 的前缀；把公共前缀之后的文本节点清空/截断
  let cursor = 0;
  for (const textNode of nodes) {
    const nodeStart = cursor;
    const nodeEnd = cursor + textNode.data.length;
    cursor = nodeEnd;
    if (nodeEnd <= clean.length) continue;
    if (nodeStart >= clean.length) {
      textNode.data = '';
    } else {
      textNode.data = textNode.data.slice(0, clean.length - nodeStart);
    }
  }
  return true;
}
