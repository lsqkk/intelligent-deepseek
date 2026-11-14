/** 运行环境：优先拿到页面真实 window（油猴沙箱下为 unsafeWindow） */

export function getPageWindow() {
  try {
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
  } catch {}
  return window;
}

export const IS_TAMPERMONKEY = (() => {
  try {
    return typeof GM_getValue === 'function' || typeof GM_registerMenuCommand === 'function';
  } catch {
    return false;
  }
})();
