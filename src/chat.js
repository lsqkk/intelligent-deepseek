/**
 * 把界面组件里的动作回传成一条新的 DeepSeek 消息。
 * DeepSeek 的输入框是受控 textarea：必须用原生 setter + input 事件才能让 React 感知，
 * 然后点击发送按钮。
 *
 * 安全/健壮性：
 *  - 只点击「发送箭头」按钮（primary + circle + 箭头图标），绝不点上传/停止/滚动等其它按钮；
 *  - 单飞锁；发送过程中如果输入框被用户改动，立即放弃，不覆盖用户输入；
 *  - 发送失败恢复用户原有草稿；
 *  - 点击后校验输入框清空或出现新用户消息，避免误报成功。
 */

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let sending = false;

export function getComposer() {
  const list = [...document.querySelectorAll('textarea')];
  return (
    list.find((ta) => ta.offsetParent !== null && !ta.disabled && !ta.readOnly) || list[0] || null
  );
}

export function setComposerText(text) {
  const ta = getComposer();
  if (!ta) return false;
  const win = ta.ownerDocument?.defaultView || window;
  const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter) setter.call(ta, text);
  else ta.value = text;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.dispatchEvent(new Event('change', { bubbles: true }));
  ta.focus();
  return true;
}

const SEND_ARROW_PATH = 'M8.3125 0.980206';
const STOP_CIRCLE_PATH = 'M2 4.88';

export function isStreaming() {
  return [...document.querySelectorAll('div[role="button"]')].some((el) => {
    const cls = String(el.className || '');
    const path = el.querySelector('svg path')?.getAttribute('d') || '';
    if (!cls.includes('ds-button--circle') || !cls.includes('ds-button--primary')) return false;
    if (!path.startsWith(STOP_CIRCLE_PATH)) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

function composerScope(ta) {
  return (
    ta.closest('div[class]')?.parentElement?.parentElement?.parentElement ||
    ta.parentElement?.parentElement ||
    document
  );
}

function findSendButton(ta) {
  const scope = composerScope(ta);
  const candidates = [...scope.querySelectorAll('div[role="button"]')].filter((el) => {
    const cls = String(el.className || '');
    const arrow = el.querySelector('svg path')?.getAttribute('d') || '';
    return (
      cls.includes('ds-button--circle') &&
      cls.includes('ds-button--primary') &&
      arrow.startsWith(SEND_ARROW_PATH) &&
      !cls.includes('ds-button--disabled')
    );
  });
  return candidates[0] || null;
}

function hasUserMessageWith(text) {
  const needle = text.slice(0, 40);
  return [...document.querySelectorAll('.ds-collapsible-text')].some((el) => el.innerText.includes(needle));
}

/** 发送一条消息；生成中会先等待空闲，避免长时间占用输入框 */
export async function sendToChat(text, { timeoutMs = 30000, retryDelay = 500 } = {}) {
  const body = String(text ?? '').slice(0, 8000).trim();
  if (!body || sending) return false;

  const ta0 = getComposer();
  if (!ta0) return false;
  const draft = ta0.value;
  // 用户输入框里有未发送内容时不要覆盖，交给组件侧提示用户
  if (draft.trim() && draft.trim() !== body) return false;

  sending = true;
  try {
    const beforeCount = document.querySelectorAll('.ds-message').length;
    setComposerText(body);
    await delay(100);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const ta = getComposer();
      if (!ta) return false;
      if (ta.value !== body) return false; // 用户改动了输入框，放弃
      const btn = findSendButton(ta);
      if (!btn) {
        await delay(retryDelay);
        continue;
      }

      btn.click();
      for (let i = 0; i < 10; i++) {
        await delay(200);
        const current = getComposer();
        const count = document.querySelectorAll('.ds-message').length;
        if (!current || !current.value) return true;
        if (count > beforeCount && hasUserMessageWith(body)) return true;
      }
      await delay(retryDelay);
    }

    const ta = getComposer();
    if (ta && (!ta.value || ta.value === body)) setComposerText(draft);
    return false;
  } finally {
    sending = false;
  }
}
