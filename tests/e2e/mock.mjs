#!/usr/bin/env node
/**
 * 离线 mock E2E：用 tests/mock/mock-deepseek.html 模拟 DeepSeek 的消息 DOM / 输入框，
 * 快速验证渲染器、流式渐进渲染、主题同步、React 节点替换、组件回传与安全拦截。
 * 运行：node tests/e2e/mock.mjs（无需登录、不消耗模型额度）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(root, 'test-results', 'mock');
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
  results.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + String(detail).slice(0, 260) : ''}`);
}

const COMPONENT = `<!doctype html><html><head><title>Mock 计算器</title>
<style>
  :root { --bg:#fff; --fg:#111; --accent:#4d6bfe; }
  :root[data-ds-theme="dark"] { --bg:#121212; --fg:#eee; --accent:#8fa2ff; }
  body { margin:0; padding:16px; font-family:sans-serif; background:var(--bg); color:var(--fg); }
  input { font-size:16px; padding:6px; }
  #out { font-size:22px; font-weight:700; margin-top:10px; color:var(--accent); }
</style></head>
<body>
  <div>数值：<input id="n" type="number" value="2" /></div>
  <div id="out">2</div>
  <script>
    const n = document.getElementById('n');
    const out = document.getElementById('out');
    n.addEventListener('input', () => { out.textContent = n.value; });
    document.documentElement.setAttribute('data-marker', 'component-loaded');
  <\/script>
</body></html>`;

const BACKCHANNEL = `<!doctype html><html><head><title>回传</title></head><body style="padding:12px">
  <button id="send" style="padding:8px 12px">发送</button>
  <script>document.getElementById('send').onclick = () => window.dsui.sendMessage('MOCK_BACKCHANNEL');<\/script>
</body></html>`;

const AUTO_SEND = `<!doctype html><html><head><title>自动发送</title></head><body>
  <script>window.dsui.sendMessage('AUTO_SEND_SHOULD_BE_BLOCKED');<\/script>
</body></html>`;

const ctx = await chromium.launch({ channel: 'msedge', headless: true });
const page = await ctx.newPage({ viewport: { width: 1200, height: 900 } });
await page.addInitScript({ content: script });
await page.addInitScript((s) => {
  try {
    if (window.top === window.self) localStorage.setItem('__dsui_settings_v1', s);
  } catch {}
}, JSON.stringify(settings));

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'warning' && msg.text().includes('[DS-UI]')) console.log('[page]', msg.text());
});
await page.goto(pathToFileURL(path.join(root, 'tests', 'mock', 'mock-deepseek.html')).href, {
  waitUntil: 'domcontentloaded',
});

const waitFor = async (fn, timeout = 8000, interval = 100) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await page.waitForTimeout(interval);
  }
  return false;
};

check('mock 页面加载且脚本注入', await page.evaluate(() => Boolean(window.__dsui)));

// 图片协议等 JSON 完整后才查询，在回答原位渲染图片及来源。
let imageSearches = 0;
await page.route('https://commons.wikimedia.org/w/api.php?*', (route) => {
  imageSearches++;
  const search = new URL(route.request().url()).searchParams;
  const query = search.get('gsrsearch');
  if (query === 'offline filetype:bitmap') return route.fulfill({
    status: 503, headers: { 'access-control-allow-origin': '*' },
  });
  const indices = {
    'red panda filetype:bitmap': [1, 2], 'partial filetype:bitmap': [1, 3],
    'broken filetype:bitmap': [3],
  }[query] ?? [];
  return route.fulfill({
    headers: { 'access-control-allow-origin': '*' },
    json: { query: { pages: indices.map((index) => ({
      title: `File:Red panda ${index}.png`, index,
      imageinfo: [{ mime: 'image/png', thumburl: `https://${index === 1 ? 'thumb' : 'upload'}.wikimedia.org/wikipedia/commons/${index}.png` }],
    })) } },
  });
});
await page.route(/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//, (route) => {
  const name = new URL(route.request().url()).pathname.split('/').pop();
  if (name === '3.png') return route.fulfill({ status: 404 });
  const [width, height] = name === '1.png' ? [120, 80] : [80, 120];
  return route.fulfill({
    contentType: 'image/svg+xml',
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="teal"/></svg>`,
  });
});
await page.addStyleTag({ content: '.ds-markdown img { height: auto !important; object-fit: contain !important; border-radius: 0; }' });
await page.evaluate(() => window.addAssistant('{"query":"red panda"', { lang: 'dsui-image' }));
const imageBlock = page.locator('.md-code-block').last();
await imageBlock.evaluate((el) => { el.querySelector('pre').textContent = '{"query":"red panda","count":2}'; });
const gallery = page.locator('.dsui-image-gallery');
check('完整图片请求渲染两张图片和来源链接', await waitFor(async () =>
  await gallery.locator('img').count() === 2 &&
  await gallery.locator('img').evaluateAll((imgs) => imgs.every((img) => img.naturalWidth > 0)) &&
  await gallery.locator('a').count() === 2
));
check('不同比例图片裁切为等高圆角缩略图', await gallery.locator('.dsui-image-frame').evaluateAll((frames) => {
  const heights = frames.map((frame) => frame.getBoundingClientRect().height);
  return heights.length === 2 && heights[0] === heights[1] && heights[0] > 0 && frames.every((frame) => {
    const img = frame.querySelector('img');
    return getComputedStyle(frame).borderRadius === '12px' && getComputedStyle(frame).overflow === 'hidden' &&
      getComputedStyle(img).objectFit === 'cover' && img.getBoundingClientRect().height === heights[0];
  });
}));
await imageBlock.evaluate((el) => el.closest('.ds-message').remove());
check('图片块移除后清理图组且只搜索一次', await waitFor(async () => await gallery.count() === 0) && imageSearches === 1);
await page.evaluate(() => {
  for (const query of ['empty', 'offline', 'broken', 'partial']) {
    const { msg } = window.addAssistant(JSON.stringify({ query, count: 2 }), { lang: 'dsui-image' });
    msg.dataset.imageQuery = query;
  }
});
const partial = page.locator('[data-image-query="partial"]');
const fallback = page.locator('[data-image-query]:not([data-image-query="partial"])');
check('无结果、请求失败和坏图不占位，有效图片保留', await waitFor(async () => {
  if (imageSearches !== 5 || await partial.locator('.dsui-image-gallery a:visible').count() !== 1) return false;
  if (await partial.locator('.dsui-image-gallery a').count() !== 1) return false;
  return fallback.evaluateAll((messages) => messages.length === 3 && messages.every((msg) => {
    const gallery = msg.querySelector('.dsui-image-gallery');
    const block = msg.querySelector('.md-code-block');
    return gallery && !gallery.textContent && getComputedStyle(gallery).display === 'none' &&
      getComputedStyle(block).display === 'none';
  }));
}));
await page.locator('[data-image-query]').evaluateAll((messages) => messages.forEach((msg) => msg.remove()));

await page.evaluate(() => {
  const { msg, block } = window.addAssistant('', { lang: 'text' });
  msg.id = 'direct-image-fixture';
  const base = 'https://upload.wikimedia.org/wikipedia/commons/';
  block.outerHTML = `
    <p id="native-image"><img src="${base}1.png" alt="小熊猫"></p>
    <p id="bare-image"><a href="${base}2.png">${base}2.png</a></p>
    <p id="broken-image"><a href="${base}3.png">${base}3.png</a></p>
    <p id="named-link"><a href="${base}1.png">下载原图</a></p>
    <p id="inline-link">图片出处：<a href="${base}2.png">${base}2.png</a></p>`;
});
check('原生 Markdown 图片和裸直链复用图组，并保留替代文字', await waitFor(async () =>
  await page.locator('#native-image + .dsui-image-gallery img[alt="小熊猫"]:visible').count() === 1 &&
  await page.locator('#bare-image + .dsui-image-gallery img:visible').count() === 1
));
check('坏直链静默回退，普通链接继续可见', await waitFor(async () =>
  await page.locator('#broken-image[data-dsui-image-source]').count() === 1 &&
  await page.locator('#broken-image + .dsui-image-gallery a').count() === 0 &&
  await page.locator('#broken-image:visible, #broken-image + .dsui-image-gallery:visible').count() === 0 &&
  await page.locator('#named-link:visible, #inline-link:visible').count() === 2
));
await page.locator('#direct-image-fixture').evaluate((msg) => msg.remove());

// 1) dsui 代码块 -> 卡片
await page.evaluate((html) => window.addAssistant(html, { lang: 'dsui' }), COMPONENT);
const rendered = await waitFor(async () => (await page.locator('.dsui-widget').count()) === 1, 8000);
check('dsui 代码块自动渲染为卡片', rendered);
await waitFor(async () => (await page.locator('.dsui-widget[data-state="ready"]').count()) === 1, 10000);
check('卡片就绪状态', (await page.locator('.dsui-widget[data-state="ready"]').count()) === 1);
check(
  'dsui 卡片无标题栏/外框（融入对话）',
  (await page.locator('.dsui-widget[data-kind="dsui"] .dsui-head').count()) === 0 &&
    (await page.evaluate(() => {
      const w = document.querySelector('.dsui-widget[data-kind="dsui"]');
      const s = w ? getComputedStyle(w) : null;
      return Boolean(s && s.borderTopWidth === '0px' && s.boxShadow === 'none' && s.backgroundColor === 'rgba(0, 0, 0, 0)');
    }))
);
check('原代码块被隐藏', (await page.locator('.md-code-block[data-dsui-hidden]').count()) === 1);
check(
  'dsui 卡片不显示代码/复制/下载工具栏',
  (await page.locator('.dsui-widget .dsui-actions').count()) === 0
);
await waitFor(
  async () =>
    (await page.frameLocator('.dsui-widget iframe').first().locator('html').getAttribute('data-marker')) ===
    'component-loaded',
  6000
);
check('iframe 内脚本已执行', true);

// 2) iframe 内交互
const frame = page.frameLocator('.dsui-widget iframe').first();
await frame.locator('#n').fill('42');
await page.waitForTimeout(200);
check('组件输入可交互', (await frame.locator('#out').innerText()) === '42');

// 3) 主题同步（组件用 :root[data-ds-theme="dark"] 覆盖变量）
const beforeBg = await frame.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
await page.evaluate(() => window.toggleTheme());
await page.waitForTimeout(500);
const theme = await frame.locator('html').getAttribute('data-ds-theme');
const afterBg = await frame.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
check('深色主题同步到 iframe', theme === 'dark', `theme=${theme}`);
check('组件内 CSS 变量随 data-ds-theme 生效', beforeBg !== afterBg && afterBg === 'rgb(18, 18, 18)', `${beforeBg} -> ${afterBg}`);
await page.screenshot({ path: path.join(outDir, 'mock-widget-dark.png') });
await page.evaluate(() => window.toggleTheme());
await page.waitForTimeout(1500);
const restoreBg = await frame.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
check('切回浅色主题后组件恢复', restoreBg === beforeBg, `${restoreBg}`);
const aliveAfterTheme = await page.evaluate(() => {
  const w = document.querySelector('.dsui-widget');
  return { state: w?.dataset.state, status: w?.querySelector('.dsui-status')?.textContent, foot: w?.querySelector('.dsui-foot')?.textContent };
});
check(
  '两次 srcdoc 重建（切主题）后卡片仍就绪、未被误判跳转',
  aliveAfterTheme.state === 'ready' && !String(aliveAfterTheme.foot || '').includes('跳转') && !String(aliveAfterTheme.status || '').includes('已停止'),
  JSON.stringify(aliveAfterTheme)
);

// 4) 工具栏（只应出现在普通 html 兜底卡片上）
await page.evaluate((html) => window.addAssistant(html, { lang: 'html' }), COMPONENT);
await page.waitForTimeout(1500);
check('普通 html 完整文档兜底渲染', (await page.locator('.dsui-widget').count()) === 2);
const htmlWidget = page.locator('.dsui-widget').nth(1);
check(
  'html 卡片保留代码/复制/下载按钮',
  (await htmlWidget.locator('.dsui-btn[data-act="code"]').count()) === 1 &&
    (await htmlWidget.locator('.dsui-btn[data-act="copy"]').count()) === 1 &&
    (await htmlWidget.locator('.dsui-btn[data-act="download"]').count()) === 1
);
await htmlWidget.locator('.dsui-btn[data-act="code"]').click();
await page.waitForTimeout(200);
check('html 卡片代码面板可展开', (await htmlWidget.locator('.dsui-code').innerText()).includes('Mock 计算器'));
await htmlWidget.locator('.dsui-btn[data-act="code"]').click();

// 5) React 式节点替换：应复用卡片而不是重复渲染
const replaced = await page.evaluate((html) => {
  const msg = document.querySelector('.ds-message');
  const next = window.replaceAssistantBlock(msg, html, 'dsui');
  return Boolean(next);
}, COMPONENT.replace('Mock 计算器', 'Mock 计算器 2').replace('value="2"', 'value="3"'));
await page.waitForTimeout(1200);
check('代码块节点被替换后不重复渲染卡片', replaced && (await page.locator('.dsui-widget').count()) === 2, `count=${await page.locator('.dsui-widget').count()}`);

// 6) 流式渐进渲染：流结束前就应出现卡片
await page.evaluate((html) => window.addAssistant(html, { lang: 'dsui', stream: true, chunk: 90 }), COMPONENT);
const appearedDuringStream = await waitFor(async () => (await page.locator('.dsui-widget').count()) === 3, 5000);
check('流式输出过程中卡片提前出现（渐进渲染）', appearedDuringStream);
await waitFor(async () => (await page.locator('.dsui-widget[data-state="ready"]').count()) === 3, 12000);
const streamStates = await page.evaluate(() =>
  [...document.querySelectorAll('.dsui-widget')].map((w) => ({
    id: w.dataset.dsuiId,
    title: w.querySelector('.dsui-title')?.textContent,
    state: w.dataset.state,
    status: w.querySelector('.dsui-status')?.textContent,
    foot: w.querySelector('.dsui-foot')?.textContent,
    height: w.querySelector('iframe')?.style.height,
  }))
);
check('流式结束后卡片就绪', (await page.locator('.dsui-widget[data-state="ready"]').count()) === 3, JSON.stringify(streamStates));

// 8) 回传消息：默认先填入原生输入框
await page.evaluate((html) => window.__dsui.mountTestWidget(html, { host: (() => { const d = document.createElement('div'); d.id = 'mock-bc-host'; document.body.appendChild(d); return d; })() }), BACKCHANNEL);
await waitFor(async () => (await page.locator('#mock-bc-host .dsui-widget').count()) === 1, 5000);
await page.frameLocator('#mock-bc-host iframe').locator('#send').click();
const draft = await page.locator('textarea').first().inputValue();
const beforeSend = await page.evaluate(() => window.__sent);
check('回传填入草稿并等待用户发送', draft === 'MOCK_BACKCHANNEL' && !beforeSend.includes(draft), draft);
await page.locator('#sendBtn').click();
await page.waitForTimeout(1200);
const sent = await page.evaluate(() => window.__sent);
check('用户发送回传草稿', sent.includes('MOCK_BACKCHANNEL'), JSON.stringify(sent));

// 9) 安全：无用户手势的自动发送应被阻止
await page.evaluate((html) => window.__dsui.mountTestWidget(html, { host: (() => { const d = document.createElement('div'); d.id = 'mock-auto-host'; document.body.appendChild(d); return d; })() }), AUTO_SEND);
await page.waitForTimeout(1200);
const sentAfterAuto = await page.evaluate(() => window.__sent);
const autoFoot = await page.locator('#mock-auto-host .dsui-foot').innerText().catch(() => '');
check('无手势的自动 sendMessage 被阻止', !sentAfterAuto.includes('AUTO_SEND_SHOULD_BE_BLOCKED'), JSON.stringify(sentAfterAuto));
check('阻止时给出可见提示', autoFoot.includes('点击') || autoFoot.includes('阻止'), autoFoot.slice(0, 80));

// 9b) 组件绕过 bridge、直接 postMessage 且不带 seq：应被父端丢弃
try {
  const autoFrame = page.frameLocator('#mock-auto-host iframe');
  const scriptText = await autoFrame.locator('script').first().textContent();
  const tokenMatch = scriptText.match(/var T=("[^"]+")/);
  const token = tokenMatch ? JSON.parse(tokenMatch[1]) : null;
  if (token) {
    await autoFrame.locator('body').evaluate(({ t }) => {
      window.parent.postMessage({ __dsui: t, type: 'sendMessage', text: 'NO_SEQ_SHOULD_BE_DROPPED' }, '*');
    }, { t: token });
  }
  await page.waitForTimeout(700);
  const noSeqSent = await page.evaluate(() => window.__sent);
  check('不带 seq 的直接 postMessage 被拒绝', Boolean(token) && !noSeqSent.includes('NO_SEQ'), `token=${Boolean(token)}`);
} catch (e) {
  check('不带 seq 的直接 postMessage 被拒绝', false, e.message.slice(0, 120));
}

// 10) 组件自行跳转外部页面：应被识别并停止接受消息
const NAVIGATE = `<!doctype html><html><head><title>跳转测试</title></head><body>
  <div id="x">normal</div>
  <script>setTimeout(function(){ location.href = 'data:text/html,<h1>external</h1>'; }, 2600);<\/script>
</body></html>`;
await page.evaluate(
  (html) =>
    window.__dsui.mountTestWidget(html, {
      host: (() => {
        const d = document.createElement('div');
        d.id = 'mock-nav-host';
        document.body.appendChild(d);
        return d;
      })(),
    }),
  NAVIGATE
);
await waitFor(async () => (await page.locator('#mock-nav-host .dsui-widget[data-state="ready"]').count()) === 1, 8000);
await page.waitForTimeout(4200);
const navState = await page.evaluate(() => {
  const w = document.querySelector('#mock-nav-host .dsui-widget');
  return {
    status: w?.querySelector('.dsui-status')?.textContent,
    foot: w?.querySelector('.dsui-foot')?.textContent,
    frameText: (() => {
      try {
        return w?.querySelector('iframe')?.contentDocument?.body?.innerText || '';
      } catch {
        return '';
      }
    })(),
  };
});
check(
  '组件自行跳转外部页面被拦截并提示',
  String(navState.foot).includes('跳转'),
  JSON.stringify(navState)
);

// 11) 设置面板
await page.locator('#dsui-fab').click();
await page.waitForTimeout(400);
check('设置面板可打开', (await page.locator('#dsui-settings-host').count()) === 1);
await page.screenshot({ path: path.join(outDir, 'mock-settings.png') });
await page.keyboard.press('Escape');

// 11) 移除消息后卡片清理
await page.evaluate(() => document.querySelectorAll('.ds-message')[0].remove());
await page.waitForTimeout(1200);
check('消息移除后卡片被清理', (await page.locator('#messages .dsui-widget').count()) === 2, `count=${await page.locator('#messages .dsui-widget').count()}`);

const failed = results.filter((r) => !r.pass);
const report = { results, failed: failed.length, errors };
fs.writeFileSync(path.join(outDir, 'mock-report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(`\n[mock] ${results.length - failed.length}/${results.length} checks passed`);
if (errors.length) console.log('page errors:', errors.slice(0, 10));
await ctx.close();
process.exit(failed.length ? 1 : 0);
