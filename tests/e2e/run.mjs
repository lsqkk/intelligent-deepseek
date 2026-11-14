#!/usr/bin/env node
/**
 * 真实账号 E2E（Edge + 持久化登录态）：
 *  1) 注入脚本工作、请求体携带协议
 *  2) 模型输出 dsui -> 卡片自动渲染、iframe 可交互、工具栏可用
 *  3) 组件回传消息能发到对话
 *  4) 刷新后历史消息看不到注入文本，且卡片能重新渲染
 *  5) 主题同步到组件
 *
 * 前置：node scripts/login.mjs 完成一次登录；pnpm build
 * 运行：node tests/e2e/run.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(root, 'test-results');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const script = fs.readFileSync(path.join(root, 'dist/intelligent-deepseek.user.js'), 'utf8');
const settings = {
  enabled: true,
  injectPrompt: true,
  injectEveryTurn: false,
  autoRender: true,
  renderPlainHtml: true,
  allowWidgetSend: true,
  protocolLanguage: 'zh',
  customProtocol: '',
  showFab: true,
  debug: true,
};

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 500) });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`);
}

const ctx = await chromium.launchPersistentContext(path.join(root, '.browser-profile'), {
  channel: 'msedge',
  headless: false,
  viewport: { width: 1440, height: 940 },
  locale: 'zh-CN',
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.addInitScript({ content: script });
await page.addInitScript((s) => {
  try {
    if (window.top === window.self) localStorage.setItem('__dsui_settings_v1', s);
  } catch {}
}, JSON.stringify(settings));

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') pageErrors.push('[console] ' + m.text());
});

const completionBodies = [];
page.on('request', (req) => {
  if (req.url().includes('/api/v0/chat/completion')) {
    try {
      completionBodies.push(req.postData() || '');
    } catch {}
  }
});
let lastHistoryRaw = '';
page.on('response', async (res) => {
  if (res.url().includes('/api/v0/chat/history_messages')) {
    try {
      lastHistoryRaw = await res.text();
    } catch {}
  }
});

const state = () =>
  page.evaluate(() => {
    const widgets = [...document.querySelectorAll('.dsui-widget')];
    return {
      debug: window.__dsui?.debugState?.() || null,
      widgets: widgets.length,
      readyWidgets: widgets.filter((w) => w.dataset.state === 'ready').length,
      titles: widgets.map((w) => w.querySelector('.dsui-title')?.textContent),
      heights: widgets.map((w) => Number((w.querySelector('iframe')?.style.height || '0').replace('px', ''))),
      widgetsHtml: widgets.map((w) => w.outerHTML.slice(0, 200)),
      userBubbles: [...document.querySelectorAll('.ds-collapsible-text')].map((el) => el.innerText),
      completionCount: window.__dsuiCompletionCount || 0,
      assistantText: document.querySelector('.ds-assistant-message-main-content')?.textContent?.slice(-200) || '',
    };
  });

async function waitFor(fn, { timeout = 30000, interval = 400, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await page.waitForTimeout(interval);
  }
  console.log(`[e2e] timeout waiting for ${label}`);
  return false;
}

async function waitCompletion(timeout = 180000) {
  const baseline = await page.evaluate(() => window.__dsuiCompletionCount || 0);
  return waitFor(
    async () => (await page.evaluate(() => window.__dsuiCompletionCount || 0)) > baseline,
    { timeout, label: 'completion' }
  );
}

/* ---------------------------------------------------------------- */

await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
console.log('[e2e] 等待输入框出现…');
let composerReady = false;
try {
  await page.waitForFunction(() => {
    const ta = document.querySelector('textarea');
    return Boolean(ta && ta.offsetHeight > 0);
  }, { timeout: 120000, polling: 500 });
  composerReady = true;
} catch (error) {
  console.log('[e2e] composer wait error:', error.message.slice(0, 160));
}
if (composerReady) {
  composerReady = await page
    .waitForFunction(() => !!document.querySelector('textarea'), { timeout: 15000, polling: 500 })
    .then(() => true)
    .catch(() => false);
}
check('打开 DeepSeek 并找到输入框（登录态有效）', composerReady, `url=${page.url()}`);
if (!composerReady) {
  await page.screenshot({ path: path.join(outDir, '00-e2e-failed.png') }).catch(() => {});
  fs.writeFileSync(path.join(outDir, 'e2e-report.json'), JSON.stringify({ results, pageErrors }, null, 2));
  await ctx.close();
  process.exit(1);
}

const PROMPT = '做一个 RGB 颜色选择器：三个滑杆实时显示颜色和十六进制值。';
const PROMPT_RETRY =
  '请严格使用 dsui 代码块（不是 html）做一个 RGB 颜色选择器：三个滑杆实时显示颜色和十六进制值。';

async function ensureNewChat() {
  // 页面可能恢复上次会话（异步）：先等稳定，再点「开启新对话」，确认 URL 是根路径且消息清空
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.waitForTimeout(2500);
    const stateNow = await page.evaluate(() => ({
      url: location.href,
      msgs: document.querySelectorAll('.ds-message').length,
      composer: Boolean(document.querySelector('textarea')),
    }));
    const atRoot = /^https:\/\/chat\.deepseek\.com\/?$/.test(stateNow.url);
    if (stateNow.composer && atRoot && stateNow.msgs === 0) return true;
    if (!atRoot) {
      await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForFunction(() => !!document.querySelector('textarea'), { timeout: 120000, polling: 500 });
    }
    await page.getByText('开启新对话', { exact: true }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  const finalState = await page.evaluate(() => ({
    url: location.href,
    msgs: document.querySelectorAll('.ds-message').length,
  }));
  return /^https:\/\/chat\.deepseek\.com\/?$/.test(finalState.url) && finalState.msgs === 0;
}

async function sendPromptAndWait(prompt) {
  const t = Date.now();
  const before = await page.evaluate(() => window.__dsuiCompletionCount || 0);
  const beforeUrl = page.url();
  await page.locator('textarea').first().fill(prompt);
  await page.locator('textarea').first().press('Enter');

  // 确认消息进入了当前对话，并且是这条新对话的第一条用户消息
  const userVisible = await waitFor(
    async () =>
      page.evaluate((p) => {
        const first = document.querySelector('.ds-collapsible-text');
        return Boolean(first && first.innerText.includes(p.slice(0, 18)));
      }, prompt),
    { timeout: 20000, label: 'user message' }
  );
  // 等新会话 URL（避免在旧会话里发消息）
  const newSession = await waitFor(
    async () => page.url() !== beforeUrl && /\/a\/chat\/s\//.test(page.url()),
    { timeout: 20000, label: 'session url' }
  );
  const completed = await waitFor(
    async () => (await page.evaluate(() => window.__dsuiCompletionCount || 0)) > before,
    { timeout: 180000, label: 'completion' }
  );
  await page.waitForTimeout(1800);
  const st = await state();
  return {
    t,
    userVisible,
    newSession,
    completed,
    state: st,
    seconds: Math.round((Date.now() - t) / 1000),
    url: page.url(),
  };
}

async function waitStreamingEnd(timeout = 25000) {
  // 仅作为辅助信号；即使检测不到（页面改版）也不阻塞主流程
  return waitFor(
    async () =>
      page.evaluate(() => {
        // 生成中时输入区的圆形发送按钮会变成「停止」方块图标
        const stop = [...document.querySelectorAll('div[role="button"]')].some((b) => {
          const cls = String(b.className || '');
          const path = b.querySelector('svg path')?.getAttribute('d') || '';
          if (!cls.includes('ds-button--circle') || !cls.includes('ds-button--primary')) return false;
          if (!path.startsWith('M2 4.88')) return false;
          const rect = b.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
        });
        const text = document.querySelector('.ds-assistant-message-main-content')?.textContent || '';
        return !stop && text.length > 0;
      }),
    { timeout, label: 'streaming end' }
  ).catch(() => false);
}

const injected = await page.evaluate(() => Boolean(window.__dsui));
check('油猴脚本已注入页面', injected);
const readFabInfo = () =>
  page.evaluate(() => {
    const fab = document.getElementById('dsui-fab');
    const fileInput = document.querySelector('input[type="file"]');
    const row = fileInput?.parentElement || null;
    const uploadBtn = row?.querySelector('[role="button"]') || null;
    return {
      found: Boolean(fab),
      inComposer: Boolean(fab && row && fab.parentElement === row),
      beforeUpload: Boolean(
        fab && uploadBtn && fab.compareDocumentPosition(uploadBtn) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
    };
  });
await waitFor(async () => {
  const info = await readFabInfo();
  return info.found && info.inComposer && info.beforeUpload;
}, { timeout: 12000, label: 'fab placement' }).catch(() => false);
const fabInfo = await readFabInfo();
check(
  '设置按钮并排在附件按钮左侧',
  fabInfo.found && fabInfo.inComposer && fabInfo.beforeUpload,
  JSON.stringify(fabInfo)
);
check('新对话已就绪', await ensureNewChat(), `url=${page.url()}`);

let run = await sendPromptAndWait(PROMPT);
await waitStreamingEnd();
await page.waitForTimeout(1200);
let s = await state();
if (!run.userVisible || !run.newSession || s.widgets === 0) {
  console.log(
    '[e2e] 首次对话无效，重试。userVisible=',
    run.userVisible,
    'newSession=',
    run.newSession,
    'widgets=',
    s.widgets,
    'tail=',
    JSON.stringify(s.assistantText.slice(-160))
  );
  check('新对话已就绪（重试）', await ensureNewChat(), `url=${page.url()}`);
  run = await sendPromptAndWait(PROMPT_RETRY);
  await waitStreamingEnd();
  await page.waitForTimeout(1200);
  s = await state();
}
await waitFor(async () => (await page.locator('.dsui-widget').count()) > 0, { timeout: 20000, label: 'widget' }).catch(() => {});
s = await state();
const t0 = run.t;
const injectedOk = (await page.evaluate(() => window.__dsuiInjectedCount || 0)) >= 1;
check('请求体已注入 DS-UI 协议', injectedOk);
const lastBody = completionBodies[completionBodies.length - 1] || '';
check('注入内容出现在 completion 请求中', lastBody.includes('⟦DS-UI v1⟧'), lastBody.slice(0, 160));
check(
  '模型输出 dsui 并渲染出卡片',
  s.widgets >= 1,
  `widgets=${s.widgets} userVisible=${run.userVisible} completed=${run.completed} seconds=${run.seconds}`
);
check('卡片进入已就绪状态', s.readyWidgets >= 1 && s.readyWidgets === s.widgets, `ready=${s.readyWidgets}/${s.widgets}`);
check('卡片标题来自组件 <title>', (s.titles[0] || '').length > 1, s.titles.join(' | '));
check('iframe 高度自适应', (s.heights[0] || 0) > 140, `heights=${s.heights.join(',')}`);
check('原代码块被隐藏', (s.debug?.blocks || []).some((b) => b.hidden), JSON.stringify(s.debug?.blocks?.map((b) => b.lang)));
await page.screenshot({ path: path.join(outDir, '01-widget.png') });

// ---- iframe 内交互 ----
const frame = page.frameLocator('.dsui-widget iframe').first();
let frameText = '';
try {
  await waitFor(
    async () => {
      try {
        const text = await frame.locator('body').innerText({ timeout: 1500 });
        return text.length > 30;
      } catch {
        return false;
      }
    },
    { timeout: 20000, label: 'iframe content' }
  );
  frameText = await frame.locator('body').innerText({ timeout: 10000 });
} catch (e) {
  console.log('[e2e] frame read err', e.message.slice(0, 120));
}
check('iframe 内渲染出内容', frameText.length > 30, frameText.slice(0, 120).replace(/\n/g, ' | '));

let interactionOk = false;
let interactionDetail = '';
try {
  const numberCount = await frame.locator('input[type="number"]').count();
  const rangeCount = await frame.locator('input[type="range"]').count();
  const before = frameText;
  if (numberCount > 0) {
    await frame.locator('input[type="number"]').first().fill('180');
  } else if (rangeCount > 0) {
    await frame.locator('input[type="range"]').first().evaluate((el) => {
      el.value = String(Number(el.max || 100));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await page.waitForTimeout(600);
  let after = await frame.locator('body').innerText();
  if (after === before) {
    // 滑杆事件没触发时，退化到点第一个按钮（如「随机颜色」）再比较
    const buttonCount = await frame.locator('button').count();
    if (buttonCount > 0) {
      await frame.locator('button').first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(700);
      after = await frame.locator('body').innerText();
    }
  }
  interactionOk = after !== before;
  interactionDetail = `number=${numberCount}, range=${rangeCount}, changed=${interactionOk}`;
} catch (e) {
  interactionDetail = e.message.slice(0, 160);
}
check('iframe 内输入可交互并更新界面', interactionOk, interactionDetail);

// ---- 工具栏：dsui 卡片根据设计不显示代码/复制/下载，避免打断对话 ----
check(
  'dsui 卡片不显示右侧工具栏',
  (await page.locator('.dsui-widget .dsui-actions').count()) === 0,
  `actions=${await page.locator('.dsui-widget .dsui-actions').count()}`
);

// ---- 组件回传消息 ----
const testWidgetHtml = `<!doctype html><html><head><title>回传测试</title></head><body style="padding:16px;font-family:sans-serif">
<button id="send" style="padding:8px 14px;font-size:14px">发送回传</button>
<script>document.getElementById('send').onclick=()=>window.dsui.sendMessage('BACKCHANNEL_OK');</script>
</body></html>`;
await page.evaluate((html) => window.__dsui.mountTestWidget(html), testWidgetHtml);
await page.waitForTimeout(1200);
check(
  '调试挂载测试组件成功',
  (await page.locator('#dsui-test-host .dsui-widget').count()) === 1
);
const testFrame = page.frameLocator('#dsui-test-host iframe');
let clicked = false;
let backchannelSent = false;
const bcBefore = await page.evaluate(() => window.__dsuiCompletionCount || 0);
for (let attempt = 0; attempt < 3 && !backchannelSent; attempt++) {
  try {
    await testFrame.locator('#send').click({ timeout: 10000 });
    clicked = true;
  } catch (e) {
    console.log('[e2e] click send failed:', e.message.slice(0, 120));
    await page.waitForTimeout(500);
    continue;
  }
  backchannelSent = await waitFor(
    async () => (await page.evaluate(() => window.__dsuiCompletionCount || 0)) > bcBefore,
    { timeout: 25000, label: 'backchannel completion' }
  );
  if (!backchannelSent) await page.waitForTimeout(800);
}
if (!backchannelSent) {
  const debug = await page.evaluate(() => {
    const ta = [...document.querySelectorAll('textarea')].find((t) => t.offsetParent !== null);
    return {
      composer: ta?.value,
      stop: [...document.querySelectorAll('div[role="button"]')]
        .filter((b) => String(b.className).includes('ds-button--circle'))
        .filter((b) => b.querySelector('svg path')?.getAttribute('d')?.startsWith('M2 4.88'))
        .map((b) => ({ rect: b.getBoundingClientRect().toJSON(), cls: b.className })),
      sendButtons: [...document.querySelectorAll('div[role="button"]')]
        .filter((b) => String(b.className).includes('ds-button--circle'))
        .map((b) => ({ cls: b.className, svg: b.querySelector('svg path')?.getAttribute('d')?.slice(0, 24) })),
      toast: document.getElementById('dsui-toast')?.textContent,
      widgets: window.__dsui?.debugWidgets?.(),
    };
  });
  console.log('[e2e] backchannel debug:', JSON.stringify(debug, null, 2));
  await page.screenshot({ path: path.join(outDir, '02b-backchannel-failed.png') });
}
check('点击组件按钮后直接发送消息并触发新对话', clicked && backchannelSent);
const bcBody = completionBodies[completionBodies.length - 1] || '';
check(
  '同一会话后续轮次默认不再注入协议（首条消息注入一次）',
  bcBody.length > 0 && !bcBody.includes('⟦DS-UI'),
  bcBody.slice(0, 160)
);
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(outDir, '02-backchannel.png') });

// ---- 刷新后历史净化 + 重新渲染 ----
const sessionUrl = /\/a\/chat\/s\//.test(run.url) ? run.url : page.url();
console.log('[e2e] 会话地址:', sessionUrl);
await page.goto(sessionUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
const reloadOk = await waitFor(async () => {
  const count = await page.locator('.dsui-widget').count();
  const bubbles = await page.evaluate(() => [...document.querySelectorAll('.ds-collapsible-text')].map((el) => el.innerText));
  return count >= 1 && bubbles.length > 0 && lastHistoryRaw.length > 0;
}, { timeout: 45000, label: 'history reload' });
await waitFor(async () => lastHistoryRaw.includes('RGB 颜色选择器'), { timeout: 15000, label: 'history payload' }).catch(() => {});
await page.waitForTimeout(1500);
const afterReload = await state();
check('刷新后历史中的 dsui 组件重新渲染', reloadOk && afterReload.widgets >= 1, `widgets=${afterReload.widgets}`);
check(
  '刷新后用户气泡不含注入协议文本',
  afterReload.userBubbles.every((text) => !text.includes('⟦DS-UI') && !text.includes('DS-UI v1')),
  afterReload.userBubbles.map((t) => t.slice(0, 60)).join(' || ')
);
check(
  '刷新后仍在同一条测试对话中',
  afterReload.userBubbles.some((text) => text.includes('RGB 颜色选择器')),
  afterReload.userBubbles.map((t) => t.slice(0, 40)).join(' || ')
);
check(
  '刷新后能看到组件回传的消息',
  lastHistoryRaw.includes('BACKCHANNEL_OK'),
  lastHistoryRaw ? lastHistoryRaw.slice(0, 120) : 'history payload empty'
);
check(
  '历史消息内容仍完整（助手回复未损坏）',
  afterReload.assistantText.length > 20,
  afterReload.assistantText.slice(0, 100)
);
await page.screenshot({ path: path.join(outDir, '03-after-reload.png') });

// ---- 主题同步（用受控组件测试 data-ds-theme 与 CSS 变量联动） ----
let themeSyncOk = false;
let themeDetail = '';
try {
  const themeWidgetHtml = `<!doctype html><html><head><title>主题测试</title><style>
    :root { --bg:#ffffff; }
    :root[data-ds-theme="dark"] { --bg:#101010; }
    body { margin:0; height:60px; background:var(--bg); }
  </style></head><body></body></html>`;
  await page.evaluate((html) => {
    const host = document.createElement('div');
    host.id = 'dsui-theme-host';
    document.body.appendChild(host);
    window.__dsui.mountTestWidget(html, { host });
  }, themeWidgetHtml);
  await page.waitForTimeout(1200);
  const beforeBg = await page
    .frameLocator('#dsui-theme-host iframe')
    .locator('body')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const beforeClass = await page.evaluate(() => document.body.className);
  await page.evaluate(() => {
    document.body.classList.remove('light');
    document.body.classList.add('dark');
  });
  await page.waitForTimeout(1500);
  const themeInFrame = await page
    .frameLocator('#dsui-theme-host iframe')
    .locator('html')
    .getAttribute('data-ds-theme');
  const afterBg = await page
    .frameLocator('#dsui-theme-host iframe')
    .locator('body')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  themeSyncOk = themeInFrame === 'dark' && afterBg === 'rgb(16, 16, 16)' && beforeBg !== afterBg;
  themeDetail = `beforeBg=${beforeBg} afterBg=${afterBg} theme=${themeInFrame}`;
  await page.evaluate((cls) => {
    document.body.className = cls;
  }, beforeClass);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, '04-dark.png') });
} catch (e) {
  console.log('[e2e] theme test error', e.message.slice(0, 160));
  themeDetail = e.message.slice(0, 160);
}
check('深色主题同步到组件 iframe 并生效', themeSyncOk, themeDetail);

// ---- 汇总 ----
const failed = results.filter((r) => !r.pass);
const report = {
  when: new Date().toISOString(),
  durationSec: Math.round((Date.now() - t0) / 1000),
  results,
  failed: failed.length,
  pageErrors: pageErrors.slice(0, 30),
  completionBodies: completionBodies.map((b) => b.slice(0, 1200)),
};
fs.writeFileSync(path.join(outDir, 'e2e-report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`\n[e2e] ${results.length - failed.length}/${results.length} checks passed; duration ${report.durationSec}s`);
fs.writeFileSync(path.join(outDir, 'e2e-summary.txt'), results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ' :: ' + r.detail : ''}`).join('\n'), 'utf8');
await ctx.close();
process.exit(failed.length ? 1 : 0);
