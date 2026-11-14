/**
 * 设置存取。优先用油猴的 GM_* 存储（跨 tab / 持久），
 * 在直接注入脚本（E2E）时退化为 localStorage。
 */

const STORAGE_KEY = '__dsui_settings_v1';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  injectPrompt: true,
  autoRender: true,
  renderPlainHtml: true,
  allowWidgetSend: true,
  protocolLanguage: 'zh',
  customProtocol: '',
  showFab: true,
  debug: false,
});

function gmGet(key) {
  try {
    if (typeof GM_getValue === 'function') return GM_getValue(key);
  } catch {}
  return undefined;
}

function gmSet(key, value) {
  try {
    if (typeof GM_setValue === 'function') {
      GM_setValue(key, value);
      return true;
    }
  } catch {}
  return false;
}

export function loadSettings() {
  let raw = gmGet(STORAGE_KEY);
  if (raw == null) {
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {}
  }
  let parsed = null;
  if (raw) {
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {}
  }
  return normalize(parsed);
}

export function saveSettings(settings) {
  const normalized = normalize(settings);
  const text = JSON.stringify(normalized);
  if (!gmSet(STORAGE_KEY, normalized)) {
    try {
      localStorage.setItem(STORAGE_KEY, text);
    } catch {}
  }
  return normalized;
}

export function updateSettings(patch) {
  return saveSettings({ ...loadSettings(), ...patch });
}

function normalize(value) {
  const out = { ...DEFAULT_SETTINGS };
  if (value && typeof value === 'object') {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (value[key] !== undefined && typeof value[key] === typeof DEFAULT_SETTINGS[key]) {
        out[key] = value[key];
      }
    }
  }
  return out;
}
