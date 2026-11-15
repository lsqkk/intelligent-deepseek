/**
 * 设置存取。优先用油猴的 GM_* 存储（跨 tab / 持久），
 * 在直接注入脚本（E2E）时退化为 localStorage。
 */

const STORAGE_KEY = '__dsui_settings_v1';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  injectEveryTurn: false,
  tableSort: true,
  tableExport: true,
  inlineImages: true,
  weatherCards: true,
  mapCards: true,
  referenceCards: true,
  renderPlainHtml: false,
  allowWidgetSend: true,
  widgetSendMode: 'draft',
  protocolLanguage: 'zh',
  visualPreference: 'auto',
  customProtocol: '',
  protocolRevision: 0,
  debug: false,
});

const PROTOCOL_FIELDS = ['protocolLanguage', 'visualPreference', 'customProtocol'];

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
  const previous = loadSettings();
  const normalized = normalize(settings);
  normalized.protocolRevision = PROTOCOL_FIELDS.some((key) => normalized[key] !== previous[key])
    ? Math.max(Date.now(), previous.protocolRevision + 1)
    : previous.protocolRevision;
  const text = JSON.stringify(normalized);
  if (!gmSet(STORAGE_KEY, normalized)) {
    try {
      localStorage.setItem(STORAGE_KEY, text);
    } catch {}
  }
  window.dispatchEvent(new Event('dsui:settings-changed'));
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
    if (!['auto', 'explicit', 'frequent'].includes(out.visualPreference)) {
      out.visualPreference = DEFAULT_SETTINGS.visualPreference;
    }
    if (out.widgetSendMode !== 'send') out.widgetSendMode = DEFAULT_SETTINGS.widgetSendMode;
  }
  return out;
}
