/**
 * 交互组件卡片：把 dsui 代码块渲染成沙箱 iframe，提供工具栏、自动高度、主题同步、
 * 以及组件 -> 对话的回传通道（window.dsui.sendMessage）。
 */
import { clampWidgetHeight, extractTitle } from './dom.js';
import { sendToChat, getComposer, setComposerText } from './chat.js';
import { detectTheme } from './theme.js';

const WIDGETS_BY_TOKEN = new Map();
const ALL_WIDGETS = new Set();
let messageRouterInstalled = false;

/** 主题变化时同步所有卡片（包括调试/测试挂载的卡片） */
export function applyThemeToAll(theme) {
  for (const widget of ALL_WIDGETS) widget.setTheme(theme);
}

/** 调试用：查看所有卡片状态 */
export function getAllWidgets() {
  return [...ALL_WIDGETS];
}

/** 安装全局 message 路由（父页面只收到带 token 的 iframe 消息才会处理） */
export function installWidgetMessageRouter() {
  if (messageRouterInstalled) return;
  messageRouterInstalled = true;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || !data.__dsui) return;
    const widget = WIDGETS_BY_TOKEN.get(data.__dsui);
    if (!widget) return;
    if (widget.iframe && event.source !== widget.iframe.contentWindow) return;
    widget.handleMessage(data);
  });
}

/* ------------------------------------------------------------------ */
/* HTML 文档构建                                                       */
/* ------------------------------------------------------------------ */

const BRIDGE_CODE = String.raw`(function(){
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

const CSP = [
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
  "base-uri 'none'",
].join('; ');

/** 把模型输出的 HTML 包装成可安全运行的 iframe 文档 */
export function buildWidgetDoc(rawHtml, { token, theme = 'light', docSeq = 0 } = {}) {
  const source = String(rawHtml ?? '');
  let doc = /<html[\s>]/i.test(source) || /<!doctype/i.test(source)
    ? source
    : `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${source}</body></html>`;

  if (!/<!doctype/i.test(doc)) doc = `<!DOCTYPE html>${doc}`;

  const headBits = `${CSP_META}<style>html,body{margin:0;padding:0;overflow-x:hidden;background:transparent;scrollbar-width:none;-ms-overflow-style:none}html{color-scheme:${theme}}*{scrollbar-width:none;-ms-overflow-style:none}*::-webkit-scrollbar{width:0;height:0;display:none}</style>`;
  const bridge = `<script>${BRIDGE_CODE.replace('__DS_UI_TOKEN__', JSON.stringify(token)).replace(
    '__DS_UI_SEQ__',
    String(docSeq)
  )}</script>`;
  // bridge 必须放在 <head> 最前面：模型组件可能在 body 里立即调用 window.dsui
  doc = injectIntoHead(doc, headBits + bridge);
  doc = adaptThemeCss(doc, theme);

  doc = doc.replace(/<html([^>]*)>/i, (_m, attrs) =>
    `<html${String(attrs).replace(/\sdata-ds-theme="[^"]*"/g, '')} data-ds-theme="${theme}">`
  );

  return doc;
}

/**
 * 模型常用 @media (prefers-color-scheme: dark) 适配深色，但 DeepSeek 的主题是 body class，
 * 不会改变 prefers-color-scheme。这里把 <style> 里的深/浅色媒体查询按当前主题展开，
 * 让只用媒体查询写的组件也能跟随页面主题。
 */
export function adaptThemeCss(doc, theme) {
  const isDark = theme === 'dark';
  return String(doc).replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, css, close) => {
    return open + transformCssMedia(css, isDark) + close;
  });
}

function transformCssMedia(css, isDark) {
  // 用等长的「遮罩文本」定位 @media，跳过注释与字符串，避免把 CSS 内容截断
  const masked = maskCss(css);
  let out = '';
  let i = 0;
  while (i < css.length) {
    const at = masked.indexOf('@media', i);
    if (at < 0) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    const open = masked.indexOf('{', at);
    if (open < 0) {
      out += css.slice(at);
      break;
    }
    const prelude = masked.slice(at + '@media'.length, open).trim();
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
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    if (depth !== 0) {
      out += css.slice(at);
      break;
    }
    const inner = css.slice(open + 1, j - 1);
    const isDarkQuery = themeOnly[1].toLowerCase() === 'dark';
    const applies = isDarkQuery ? isDark : !isDark;
    out += applies ? inner : '';
    i = j;
  }
  return out;
}

/** 把注释、字符串替换成空格（保留换行与长度），便于安全扫描 CSS 结构 */
function maskCss(css) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      let end = css.indexOf('*/', i + 2);
      end = end < 0 ? css.length : end + 2;
      out += ' '.repeat(end - i);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out += ch;
      i++;
      while (i < css.length) {
        const c = css[i];
        if (c === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        out += c === '\n' ? '\n' : ' ';
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

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

/** 判断流式中的 HTML 是否已经足够完整、可以安全地放进 iframe 预览 */
export function isRenderable(code) {
  const s = String(code || '');
  if (/<\/html>/i.test(s)) return true;
  if (s.length < 80) return false;
  const bodyIndex = s.search(/<body[\s>]/i);
  if (bodyIndex < 0) return false;
  const afterBody = s.slice(bodyIndex);
  if (/<\/(div|section|main|svg|canvas|table|button|form|ul|ol)>/i.test(afterBody)) return true;
  if (s.length > 2000 && /<script[\s>]/i.test(afterBody)) return true;
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

/* ------------------------------------------------------------------ */
/* Widget                                                              */
/* ------------------------------------------------------------------ */

let nextWidgetId = 0;

function randomToken() {
  try {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return Math.random().toString(36).slice(2, 12);
  }
}

export class Widget {
  constructor(block, { getSettings, onToast, kind = 'dsui' } = {}) {
    this.block = block;
    this.kind = kind === 'html' ? 'html' : 'dsui';
    this.getSettings = getSettings;
    this.onToast = onToast;
    this.id = `dsui-${++nextWidgetId}`;
    this.token = `${this.id}-${randomToken()}`;
    this.code = '';
    this.renderedCode = '';
    this.codeEl = null;
    this.lastRenderAt = 0;
    this.renderTimer = null;
    this.finalizeTimer = null;
    this.statusTimer = null;
    this.isFinal = false;
    this.ready = false;
    this.lastHeight = 0;
    this.showCode = false;
    this.theme = 'light';
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

    const root = document.createElement('div');
    root.className = 'dsui-widget';
    root.dataset.dsuiId = this.id;
    root.dataset.kind = this.kind;
    root.dataset.state = 'streaming';
    const actions =
      this.kind === 'html'
        ? `<span class="dsui-actions">
             <button type="button" class="dsui-btn" data-act="code" title="切换查看源码">代码</button>
             <button type="button" class="dsui-btn" data-act="copy" title="复制源码">复制</button>
             <button type="button" class="dsui-btn" data-act="download" title="下载 HTML">下载</button>
           </span>`
        : '';
    const head =
      this.kind === 'html'
        ? `<div class="dsui-head">
             <span class="dsui-mark" aria-hidden="true">✦</span>
             <span class="dsui-title">交互界面</span>
             <span class="dsui-status" data-busy="1">生成中…</span>
             ${actions}
           </div>`
        : '';
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
    this.iframe = root.querySelector('.dsui-frame');
    this.placeholder = root.querySelector('.dsui-placeholder');
    this.titleEl = root.querySelector('.dsui-title');
    this.statusEl = root.querySelector('.dsui-status');
    this.codePanel = root.querySelector('.dsui-code');
    this.codeEl = root.querySelector('.dsui-code code');
    this.footEl = root.querySelector('.dsui-foot');
    this.sendTimes = [];

    // 初始高度，避免 iframe 高度为 0 时内容测量异常
    this.iframe.style.height = this.kind === 'dsui' ? '120px' : '260px';

    root.addEventListener('click', (event) => this.onClick(event));
    this.iframe.addEventListener('load', () => {
      if (this.navigated) return;
      this.replacing = false;
      this.heightTimer = setTimeout(() => {
        if (!this.ready && !this.navigated) this.setStatus('生成中…', true);
      }, 600);
    });

    this.block.setAttribute('data-dsui-hidden', '1');
    this.block.after(root);
    WIDGETS_BY_TOKEN.set(this.token, this);
    ALL_WIDGETS.add(this);
  }

  onClick(event) {
    const button = event.target.closest?.('[data-act]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const act = button.dataset.act;
    if (act === 'code') this.toggleCode(button);
    else if (act === 'copy') this.copyCode(button);
    else if (act === 'download') this.downloadCode(button);
  }

  handleWidgetSend(text) {
    const content = String(text ?? '').trim();
    if (!content) return;
    const settings = this.getSettings() || {};
    if (!settings.allowWidgetSend) {
      this.onToast?.('界面回传已关闭（可在设置中开启）');
      return;
    }
    this.sendTimes = this.sendTimes.filter((t) => Date.now() - t < 60000);
    if (this.sendTimes.length >= 5) {
      this.onToast?.('该组件发送过于频繁，请稍后再试');
      return;
    }
    this.sendTimes.push(Date.now());
    this.sendMessageToChat(content);
  }

  toggleCode(button) {
    this.showCode = !this.showCode;
    this.codePanel.hidden = !this.showCode;
    this.iframe.style.display = this.showCode ? 'none' : '';
    button.classList.toggle('is-active', this.showCode);
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
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand('copy');
      ta.remove();
    }
    button.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => {
      button.textContent = '复制';
    }, 1400);
  }

  downloadCode(button) {
    try {
      const title = (this.titleEl?.textContent || 'component').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
      const blob = new Blob([this.code], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title || 'component'}.html`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      button.textContent = '已下载';
      setTimeout(() => {
        button.textContent = '下载';
      }, 1400);
    } catch {
      this.onToast?.('下载失败，请切换「代码」手动复制');
    }
  }

  /** 代码内容更新（流式时会被反复调用） */
  update(code) {
    if (this.navigated) return;
    const next = String(code ?? '');
    if (next === this.code) return;
    this.code = next;
    this.isFinal = false;
    this.ready = false;
    if (!this.el) return;

    const title = extractTitle(next, '交互界面');
    if (this.titleEl && this.titleEl.textContent !== title) this.titleEl.textContent = title;
    this.setStatus('生成中…', true);
    if (this.el) this.el.dataset.state = 'streaming';

    if (this.showCode) this.codeEl.textContent = next;
    this.scheduleRender(false);

    clearTimeout(this.finalizeTimer);
    this.finalizeTimer = setTimeout(() => this.finalize(), 1400);
  }

  finalize() {
    if (this.destroyed || this.navigated) return;
    this.isFinal = true;
    if (this.el) this.el.dataset.state = 'ready';
    this.scheduleRender(true);
    this.setStatus('已就绪', false);
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      if (this.footEl) this.footEl.hidden = true;
      if (this.statusEl) this.statusEl.textContent = '';
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
      // 第一次出现可渲染结构：尽快显示
      if (!this.renderTimer) {
        this.renderTimer = setTimeout(() => {
          this.renderTimer = null;
          this.renderFrame();
        }, 180);
      }
      return;
    }
    // 流式期间最多每 1.5s 刷新一次，避免 iframe 不停重载导致长期空白
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
      this.iframe.classList.remove('is-ready');
      this.placeholder?.classList.remove('is-hidden');
    }
    const seq = ++this.renderSeq;
    const doc = buildWidgetDoc(this.code, { token: this.token, theme: this.theme, docSeq: this.docSeq });
    this.iframe.srcdoc = doc;

    // ready 迟迟不来（组件脚本重/报错）时仍然展示，不判定为跳转
    clearTimeout(this.readyTimer);
    this.readyTimer = setTimeout(() => {
      if (this.destroyed || this.navigated || this.renderSeq !== seq) return;
      if (!this.ready) {
        this.iframe?.classList.add('is-ready');
        this.placeholder?.classList.add('is-hidden');
        this.setStatus('组件未就绪', false);
        if (this.footEl) {
          this.footEl.hidden = false;
          this.footEl.textContent = '组件脚本没有正常初始化，可切换「代码」查看源码或刷新页面重试。';
        }
      }
    }, 3000);
  }

  handleMessage(data) {
    // 只接受当前文档（docSeq）发来的消息；旧文档/外部页面无法冒充
    if (typeof data.seq !== 'number' || data.seq !== this.docSeq) return;
    if (this.replacing && data.type === 'navigating') return;
    if (this.navigated && data.type !== 'navigating') return;
    switch (data.type) {
      case 'ready':
        this.ready = true;
        clearTimeout(this.readyTimer);
        this.iframe?.classList.add('is-ready');
        this.placeholder?.classList.add('is-hidden');
        if (this.isFinal || this.renderedCode === this.code) this.setStatus('已就绪', false);
        break;
      case 'navigating':
        this.markNavigated();
        break;
      case 'height':
        this.applyHeight(data.height);
        break;
      case 'title':
        if (data.text && this.titleEl) this.titleEl.textContent = String(data.text).slice(0, 80);
        break;
      case 'error':
        this.showError(data.message);
        break;
      case 'sendMessage':
        this.handleWidgetSend(data.text);
        break;
      default:
        break;
    }
  }

  applyHeight(height) {
    const isDsui = this.kind === 'dsui';
    const h = clampWidgetHeight(height, window.innerHeight, {
      // dsui 去掉卡片外框后让高度自然延展，由页面滚动承接
      min: isDsui ? 60 : 140,
      max: isDsui ? 6000 : Math.max(220, Math.round(window.innerHeight * 0.72)),
    });
    this.lastHeight = h;
    this.iframe.style.height = `${h}px`;
    if (isDsui && this.el) {
      this.el.dataset.overflow = Number(height) > h + 2 ? '1' : '0';
    }
  }

  async sendMessageToChat(text) {
    const content = String(text ?? '').trim();
    if (!content) return;
    const composer = getComposer();
    if (composer && composer.value.trim() && composer.value.trim() !== content) {
      this.onToast?.('输入框里已有未发送内容，请先发送或清空');
      return;
    }
    if (this.getSettings()?.widgetSendMode !== 'send') {
      const staged = composer && !composer.disabled && !composer.readOnly && setComposerText(content);
      this.onToast?.(staged ? '已填入输入框，可编辑后发送' : '暂时无法填入输入框');
      return;
    }
    this.onToast?.('界面正在发送消息…');
    const ok = await sendToChat(content);
    this.onToast?.(ok ? '已发送到对话' : '发送失败，请手动输入');
  }

  setTheme(theme) {
    if (this.navigated || this.theme === theme) return;
    this.theme = theme;
    if (this.renderedCode) {
      this.renderedCode = '';
      this.scheduleRender(true);
    }
  }
  postToFrame(payload) {
    if (this.navigated || !this.ready) return;
    try {
      this.iframe?.contentWindow?.postMessage(payload, '*');
    } catch {}
  }

  markNavigated() {
    if (this.navigated) return;
    try {
      if (this.getSettings()?.debug) {
        console.warn('[DS-UI] widget marked navigated', this.id, this.renderedCode.slice(0, 60));
      }
    } catch {}
    this.navigated = true;
    this.replacing = false;
    clearTimeout(this.renderTimer);
    clearTimeout(this.streamRenderTimer);
    clearTimeout(this.readyTimer);
    clearTimeout(this.navTimeout);
    clearTimeout(this.heightTimer);
    clearTimeout(this.statusTimer);
    this.iframe?.classList.remove('is-ready');
    this.setStatus('已停止', false);
    this.showError('组件尝试跳转到外部页面，已停止接受它的消息');
    try {
      this.iframe.removeAttribute('srcdoc');
      this.iframe.src = 'about:blank';
    } catch {}
  }

  setStatus(text, busy) {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    if (busy) this.statusEl.dataset.busy = '1';
    else delete this.statusEl.dataset.busy;
    if (text) this.statusEl.hidden = false;
  }
  showError(message) {
    if (!this.footEl) return;
    this.footEl.hidden = false;
    this.footEl.textContent = `组件脚本报错：${String(message || '').slice(0, 160)}`;
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
    if (this.block?.isConnected) this.block.removeAttribute('data-dsui-hidden');
    this.iframe = null;
    this.el = null;
  }
}
