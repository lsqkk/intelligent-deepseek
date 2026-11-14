/**
 * 网络层拦截：
 *  1) 在 /api/v0/chat/completion 与 /api/v0/chat/edit_message 的请求体 prompt 末尾注入协议；
 *  2) 在 /api/v0/chat/history_messages 的响应被应用读取前剥掉协议（避免刷新后界面出现注入文本）。
 *
 * 线上页面用 XMLHttpRequest 发这些请求（2026-11 实测），同时兜底 patch fetch。
 */
import { applyInjection } from './prompt.js';
import { sanitizeDeep, sanitizeJsonText } from './sanitize.js';
import { getPageWindow } from './env.js';

const COMPLETION_URLS = ['/api/v0/chat/completion', '/api/v0/chat/edit_message'];
const HISTORY_URLS = ['/api/v0/chat/history_messages', '/api/v0/share/content'];
const INJECTED_KEY = '__dsui_injected_sessions_v1';
const MAX_TRACKED_SESSIONS = 100;

let installed = false;
let injectedSessions = loadInjectedSessions();

function loadInjectedSessions() {
  try {
    const raw = localStorage.getItem(INJECTED_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function markSessionInjected(sessionId) {
  if (!sessionId) return;
  injectedSessions[sessionId] = Date.now();
  const keys = Object.keys(injectedSessions);
  if (keys.length > MAX_TRACKED_SESSIONS) {
    keys
      .sort((a, b) => Number(injectedSessions[a]) - Number(injectedSessions[b]))
      .slice(0, keys.length - MAX_TRACKED_SESSIONS)
      .forEach((key) => delete injectedSessions[key]);
  }
  try {
    localStorage.setItem(INJECTED_KEY, JSON.stringify(injectedSessions));
  } catch {}
}

/** 注入策略：默认每个新会话只注入首条消息；injectEveryTurn 开启后才每轮注入 */
export function shouldInjectPrompt(settings, sessionId, injected = injectedSessions) {
  if (!settings?.enabled || !settings.injectPrompt) return false;
  if (settings.injectEveryTurn) return true;
  if (!sessionId) return true;
  return !injected[sessionId];
}

export function installInterceptors(getSettings) {
  if (installed) return;
  installed = true;
  patchXHR(getSettings);
  patchFetch(getSettings);
}

const isCompletion = (url) => COMPLETION_URLS.some((part) => url.includes(part));
const isHistory = (url) => HISTORY_URLS.some((part) => url.includes(part));

/* ------------------------------------------------------------------ */
/* XMLHttpRequest                                                      */
/* ------------------------------------------------------------------ */

function patchXHR(getSettings) {
  const pageWindow = getPageWindow();
  const proto = pageWindow.XMLHttpRequest.prototype;
  const nativeOpen = proto.open;
  const nativeSend = proto.send;
  const responseDesc = Object.getOwnPropertyDescriptor(pageWindow.XMLHttpRequest.prototype, 'response');
  const responseTextDesc = Object.getOwnPropertyDescriptor(pageWindow.XMLHttpRequest.prototype, 'responseText');

  proto.open = function (method, url, ...rest) {
    try {
      this.__dsuiUrl = String(url ?? '');
      this.__dsuiCleaner = false;
    } catch {}
    return nativeOpen.call(this, method, url, ...rest);
  };

  proto.send = function (body) {
    try {
      const url = this.__dsuiUrl || '';
      const settings = getSettings();
      // 历史净化与总开关无关：即使关闭注入，也要清掉以前存进服务端的协议文本
      if (isHistory(url) && responseDesc) {
        installXhrResponseCleaner(this, responseDesc, responseTextDesc);
      }
      if (settings?.enabled) {
        if (settings.injectPrompt && typeof body === 'string' && isCompletion(url)) {
          body = injectIntoJsonBody(body, settings);
        }
        if (isCompletion(url)) {
          this.addEventListener(
            'loadend',
            () => {
              try {
                const pageWindow = getPageWindow();
                pageWindow.__dsuiCompletionAt = Date.now();
                pageWindow.__dsuiCompletionCount = (pageWindow.__dsuiCompletionCount || 0) + 1;
                pageWindow.dispatchEvent(new CustomEvent('dsui:completion-end', { detail: { url } }));
              } catch {}
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

  /** 在应用读取 response / responseText 前清洗注入块 */
  function installXhrResponseCleaner(xhr, respDesc, textDesc) {
    if (xhr.__dsuiCleaner) return;
    xhr.__dsuiCleaner = true;
    let cachedResponse;
    let cachedText;
    let responseReady = false;
    let textReady = false;

    try {
      Object.defineProperty(xhr, 'response', {
        configurable: true,
        get() {
          try {
            const native = respDesc.get.call(this);
            if (this.readyState !== 4) return native;
            if (responseReady) return cachedResponse;
            let out = native;
            try {
              if (this.responseType === 'json' || (native && typeof native === 'object')) {
                out = sanitizeDeep(native);
              } else if (typeof native === 'string') {
                out = sanitizeJsonText(native);
              }
            } catch {
              out = native;
            }
            cachedResponse = out;
            responseReady = true;
            return out;
          } catch {
            return undefined;
          }
        },
      });
    } catch {}

    if (textDesc) {
      try {
        Object.defineProperty(xhr, 'responseText', {
          configurable: true,
          get() {
            let native;
            try {
              native = textDesc.get.call(this);
            } catch {
              return undefined;
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
          },
        });
      } catch {}
    }
  }
}

/* ------------------------------------------------------------------ */
/* fetch（兜底；当前页面未使用）                                         */
/* ------------------------------------------------------------------ */

function patchFetch(getSettings) {
  const pageWindow = getPageWindow();
  if (typeof pageWindow.fetch !== 'function') return;
  const nativeFetch = pageWindow.fetch;

  pageWindow.fetch = async function (input, init) {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof pageWindow.Request
          ? input.url
          : String(input?.url || input || '');
    const settings = getSettings();
    let nextInput = input;
    let nextInit = init;

    try {
      if (settings?.enabled && settings.injectPrompt && isCompletion(url)) {
        if (
          typeof pageWindow.Request !== 'undefined' &&
          input &&
          typeof input === 'object' &&
          input instanceof pageWindow.Request
        ) {
          const text = await input.clone().text();
          const injected = injectIntoJsonBody(text, settings);
          if (injected !== text) {
            const headers = new pageWindow.Headers(input.headers);
            headers.delete('content-length');
            nextInput = new pageWindow.Request(input, { body: injected, headers });
          }
        } else if (init && typeof init.body === 'string') {
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
    headers.delete('content-length');
    return new pageWindow.Response(cleaned, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

/* ------------------------------------------------------------------ */

function injectIntoJsonBody(body, settings) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.prompt !== 'string') return body;
  const sessionId = typeof parsed.chat_session_id === 'string' ? parsed.chat_session_id : '';
  if (!shouldInjectPrompt(settings, sessionId)) return body;
  const nextPrompt = applyInjection(parsed.prompt, settings);
  if (nextPrompt === parsed.prompt) return body;
  parsed.prompt = nextPrompt;
  markSessionInjected(sessionId);
  try {
    const pageWindow = getPageWindow();
    pageWindow.__dsuiInjectedCount = (pageWindow.__dsuiInjectedCount || 0) + 1;
  } catch {}
  return JSON.stringify(parsed);
}

function reportError(error) {
  try {
    console.warn('[DS-UI] interceptor error:', error);
  } catch {}
}
