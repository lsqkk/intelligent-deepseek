/**
 * 历史消息净化：DeepSeek 会把我们注入过提示词的用户消息原样存到服务端。
 * 读取 history_messages 时，在应用消费响应之前把注入块从所有字符串里剥掉，
 * 这样刷新页面/切换对话后界面上看不到注入内容，编辑消息时也不会带出来。
 */
import { PROMPT_START, stripInjection } from './prompt.js';

const MAX_DEPTH = 60;

export function sanitizeDeep(value, depth = 0) {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') {
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
  if (value && typeof value === 'object') {
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

/** 净化 JSON 文本；解析失败时原样返回，避免破坏响应 */
export function sanitizeJsonText(text) {
  if (typeof text !== 'string' || !text.includes(PROMPT_START)) return text;
  try {
    return JSON.stringify(sanitizeDeep(JSON.parse(text)));
  } catch {
    return text;
  }
}
