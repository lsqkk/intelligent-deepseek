#!/usr/bin/env node
/**
 * 离线 mock E2E：用 tests/mock/mock-deepseek.html 模拟 DeepSeek 的消息 DOM / 输入框，
 * 快速验证渲染器、流式渐进渲染、主题同步、React 节点替换、组件回传与安全拦截。
 * 运行：node tests/e2e/mock.mjs（无需登录、不消耗模型额度）
 */
import { chromium } from 'playwright';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outDir = path.join(root, 'test-results', 'mock');
fs.mkdirSync(outDir, { recursive: true });

const script = fs.readFileSync(path.join(root, 'dist/intelligent-deepseek.user.js'), 'utf8');
const settings = {
  enabled: true,
  // 旧版本关闭的核心功能不应阻止新版工作。
  injectPrompt: false,
  injectEveryTurn: false,
  autoRender: false,
  renderPlainHtml: true,
  allowWidgetSend: true,
  protocolLanguage: 'zh',
  customProtocol: '',
  showFab: false,
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

await page.evaluate(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async (text) => { window.copiedTable = text; } },
  });
  const { msg, block } = window.addAssistant('', { lang: 'text' });
  msg.id = 'table-fixture';
  msg.style.maxWidth = '220px';
  block.outerHTML = `<div class="ds-scroll-area" style="overflow-x:auto"><table>
    <thead><tr><th style="min-width:170px">方案</th><th style="min-width:160px">变化</th></tr></thead>
    <tbody><tr><td>方案 "甲", A</td><td>12.5%</td></tr>
    <tr><td>=1+2</td><td>-2%</td></tr><tr><td>方案丙</td><td></td></tr></tbody>
  </table></div>`;
});
const tableMessage = page.locator('#table-fixture');
const table = tableMessage.locator('table');
const sort = table.getByRole('button', { name: '排序：变化' });
const values = () => table.locator('tbody tr td:nth-child(2)').allTextContents();
await sort.focus();
await sort.press('Enter');
check('原生表格可横向滚动，百分比按数值升序且空值在末尾',
  (await table.evaluate((el) => {
    const scroller = el.parentElement;
    const toolbar = scroller.previousElementSibling;
    return scroller.scrollWidth > scroller.clientWidth && toolbar.classList.contains('dsui-table-tools') &&
      toolbar.clientWidth <= scroller.clientWidth && getComputedStyle(el).display === 'table';
  })) &&
  JSON.stringify(await values()) === JSON.stringify(['-2%', '12.5%', '']));
await tableMessage.getByRole('button', { name: '复制表格' }).click();
check('复制按当前顺序生成 TSV 并保护公式文本', await page.evaluate(() =>
  window.copiedTable === '方案\t变化\r\n\'=1+2\t-2%\r\n"方案 ""甲"", A"\t12.5%\r\n方案丙\t'
));
const downloaded = page.waitForEvent('download');
await tableMessage.getByRole('button', { name: '下载 CSV' }).click();
const tableDownload = await downloaded;
const csv = fs.readFileSync(await tableDownload.path(), 'utf8');
check('下载 UTF-8 CSV，保留中文并转义逗号和引号',
  tableDownload.suggestedFilename().endsWith('.csv') &&
  csv === '\uFEFF方案,变化\r\n\'=1+2,-2%\r\n"方案 ""甲"", A",12.5%\r\n方案丙,');
const downloadingWorkbook = page.waitForEvent('download', { timeout: 10000 });
await tableMessage.getByRole('button', { name: '下载 XLSX' }).click();
const workbookFile = await downloadingWorkbook;
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(await workbookFile.path());
const [sheet] = workbook.worksheets;
check('XLSX 可读取，保留顺序与百分数并冻结表头', workbookFile.suggestedFilename().endsWith('.xlsx') &&
  sheet.getCell('A1').value === '方案' && sheet.getCell('A2').value === '=1+2' &&
  sheet.getCell('B2').value === -0.02 && sheet.getCell('B2').numFmt === '0%' &&
  sheet.getCell('B3').numFmt === '0.0%' && sheet.views[0].ySplit === 1 && Boolean(sheet.autoFilter));
await sort.click();
check('再次点击切换为降序', await table.locator('th[aria-sort="descending"]').count() === 1 &&
  JSON.stringify(await values()) === JSON.stringify(['12.5%', '-2%', '']));
await sort.click();
check('第三次排序恢复且清除 aria-sort', await table.locator('th[aria-sort]').count() === 0);
await tableMessage.evaluate((msg) => msg.remove());

await page.evaluate(() => {
  const { msg, block } = window.addAssistant('', { lang: 'text' });
  msg.id = 'native-table-layout';
  block.outerHTML = `<div class="ds-scroll-area" style="width:260px;overflow-x:auto">
    <div style="width:max-content"><table>
      <thead><tr><th>甲</th><th>乙</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody>
    </table></div></div>`;
});
const nativeTable = page.locator('#native-table-layout');
const usesNativeLayout = () => nativeTable.locator('table').evaluate((table) => {
  const scroller = table.closest('.ds-scroll-area');
  return scroller.clientWidth === 260 && table.getBoundingClientRect().width < 260 &&
    getComputedStyle(scroller).overflowX === 'auto' && table.parentElement.parentElement === scroller;
});
await page.locator('#dsui-fab').click();
const setting = (key) => page.locator(`#dsui-settings-host [data-field="${key}"]`);
check('表格保留原生宽度和滚动布局，设置中已移除铺满选项', await usesNativeLayout() &&
  await setting('tableFullWidth').count() === 0);
await setting('tableExport').uncheck();
check('关闭表格工具栏即时生效，排序仍开启', await waitFor(async () =>
  await nativeTable.locator('.dsui-table-tools').count() === 0 &&
  await nativeTable.locator('.dsui-table-sort').count() === 2));
await setting('tableSort').uncheck();
check('关闭排序即时生效，原生布局保持可用', await waitFor(async () =>
  await nativeTable.locator('.dsui-table-sort').count() === 0 && await usesNativeLayout()));
await page.locator('#dsui-settings-host [data-act="reset"]').click();
// 当前 mock 的其他检查需要普通 HTML 兜底。
await setting('renderPlainHtml').check();
check('恢复默认即时重新启用排序和导出', await waitFor(async () => await usesNativeLayout() &&
  await nativeTable.locator('.dsui-table-tools').count() === 1 && await nativeTable.locator('.dsui-table-sort').count() === 2));
await page.keyboard.press('Escape');
await nativeTable.evaluate((msg) => msg.remove());

let weatherLookups = 0;
await page.route('https://geocoding-api.open-meteo.com/v1/search?*', (route) => {
  weatherLookups++;
  return route.fulfill({
    headers: { 'access-control-allow-origin': '*' },
    json: { results: new URL(route.request().url()).searchParams.get('name') === '北京' ?
      [{ name: '北京', country: '中国', latitude: 39.9, longitude: 116.4 }] : [] },
  });
});
await page.route('https://api.open-meteo.com/v1/forecast?*', (route) => route.fulfill({
  headers: { 'access-control-allow-origin': '*' },
  json: {
    current: { temperature_2m: 13, weather_code: 0, time: '2026-11-15T11:00' },
    daily: { time: ['2026-11-15', '2026-11-16'], temperature_2m_min: [5, 6], temperature_2m_max: [14, 16],
      weather_code: [0, 3], precipitation_probability_max: [0, 30] },
  },
}));
let blockTiles = false;
let placeLookups = 0;
await page.route('https://photon.komoot.io/api?*', (route) => {
  placeLookups++;
  const query = new URL(route.request().url()).searchParams.get('q');
  const point = (name, city, osm_value, coordinates) => ({
    properties: { name, city, osm_value, type: 'other' },
    geometry: { type: 'Point', coordinates },
  });
  const features = {
    西安碑林博物馆: [
      point('碑林博物馆二期', "Xi'an", 'construction', [108.9480757, 34.2570186]),
      point("Xi'an Stele Forest Museum", "Xi'an", 'museum', [108.9481311, 34.2550498]),
    ],
    西安钟楼: [point('钟楼', '西安市', 'attraction', [108.9423, 34.261])],
    西安同名景点: [point('同名景点', '杭州市', 'attraction', [120, 30])],
  }[query] ?? [];
  return route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: { features } });
});
await page.route('https://tile.openstreetmap.org/**', (route) => blockTiles ? route.abort() : route.fulfill({
  contentType: 'image/png',
  body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/w9sAAAAASUVORK5CYII=', 'base64'),
}));
await page.evaluate(() => {
  const addCard = (id, lang, data) => {
    const { msg } = window.addAssistant(JSON.stringify(data), { lang });
    msg.id = id;
  };
  addCard('weather-card', 'dsui-weather', { city: '北京', days: 2 });
  addCard('no-weather', 'dsui-weather', { city: 'unknown' });
  addCard('map-card', 'dsui-map', { places: [['故宫', 39.916, 116.397], ['景山', 39.925, 116.397]] });
});
const weather = page.locator('#weather-card .dsui-weather');
check('天气卡显示真实接口结构中的城市、当前温度、日预报与来源', await waitFor(async () =>
  (await weather.locator('li').count()) === 2 && (await weather.isVisible()) &&
  (await weather.innerText()).includes('13 °C') && (await weather.innerText()).includes('降水 30%') &&
  (await weather.locator('a').getAttribute('href')) === 'https://open-meteo.com/'
));
check('找不到城市时隐藏天气卡和原协议块', await waitFor(async () =>
  weatherLookups === 2 && await page.locator('#no-weather .dsui-weather[hidden]').count() === 1 &&
  !(await page.locator('#no-weather .md-code-block').isVisible())
));
const map = page.locator('#map-card');
await map.scrollIntoViewIfNeeded();
check('地图呈现底图、地点标记与路线入口', await waitFor(async () =>
  await map.locator('.leaflet-tile-loaded').count() > 0 && await map.locator('.dsui-map-pin').count() === 2 &&
  (await map.getByRole('link', { name: '打开路线 ↗' }).getAttribute('href')).includes('destination=39.925%2C116.397')
));
await map.getByRole('button', { name: '2. 景山' }).click();
check('点击地点聚焦地图并显示对应标记详情', await waitFor(async () =>
  await map.locator('.leaflet-popup').getByRole('link', { name: '景山 ↗' }).isVisible()
));
await page.evaluate(() => {
  const { msg } = window.addAssistant(JSON.stringify({ city: '西安', places: ['碑林博物馆', '钟楼', '同名景点'] }),
    { lang: 'dsui-map' });
  msg.id = 'map-keywords';
});
const keywordMap = page.locator('#map-keywords');
await keywordMap.scrollIntoViewIfNeeded();
check('关键词打点排除工地和外地同名结果，保留未匹配地点的搜索链接', await waitFor(async () =>
  await keywordMap.locator('.dsui-map-pin').count() === 2 &&
  await keywordMap.getByRole('link', { name: '3. 同名景点 · 搜索 ↗' }).isVisible() &&
  await keywordMap.getByRole('link', { name: '打开路线 ↗' }).count() === 0
));
await keywordMap.getByRole('button', { name: '1. 碑林博物馆' }).click();
check('地图标记使用搜索坐标，弹窗显示匹配地址', await waitFor(async () => {
  const popup = keywordMap.locator('.leaflet-popup');
  if (!await popup.isVisible()) return false;
  const href = await popup.getByRole('link').getAttribute('href');
  return href.includes('mlat=34.2550498&mlon=108.9481311') &&
    (await popup.locator('.dsui-map-address').innerText()).includes("Xi'an Stele Forest Museum");
}));
await page.evaluate(() => {
  const { msg } = window.addAssistant('{"city":"西安","places":["碑林博物馆"]}', { lang: 'dsui-map' });
  msg.id = 'map-keywords-cache';
});
const cachedMap = page.locator('#map-keywords-cache');
await cachedMap.scrollIntoViewIfNeeded();
check('同一地点重复展示复用查询结果', await waitFor(async () =>
  await cachedMap.locator('.dsui-map-pin').count() === 1 && placeLookups === 4
));
blockTiles = true;
await page.evaluate(() => {
  const { msg } = window.addAssistant('{"places":[["悉尼",-33.8688,151.2093]]}', { lang: 'dsui-map' });
  msg.id = 'map-offline';
});
const offlineMap = page.locator('#map-offline');
await offlineMap.scrollIntoViewIfNeeded();
check('底图失败时保留地点和外部地图入口', await waitFor(async () =>
  await offlineMap.locator('.dsui-map-canvas[hidden]').count() === 1 &&
  await offlineMap.getByRole('link', { name: '打开地图 ↗' }).isVisible()
));

await page.evaluate(() => {
  const { msg } = window.addAssistant('{"query":"red panda","count":2}', { lang: 'dsui-image' });
  msg.id = 'image-toggle';
});
const toggledGallery = page.locator('#image-toggle .dsui-image-gallery');
await toggledGallery.waitFor({ state: 'visible' });
const completionUrl = 'https://mock-deepseek.invalid/api/v0/chat/completion';
await page.route(completionUrl, (route) => route.fulfill({
  headers: { 'access-control-allow-origin': '*' },
  json: route.request().postDataJSON(),
}));
const sendMockPrompt = (chat_session_id) => page.evaluate(async ({ url, chat_session_id }) => {
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ chat_session_id, prompt: '你好' }),
  });
  return (await response.json()).prompt;
}, { url: completionUrl, chat_session_id });
const firstPrompt = await sendMockPrompt('cards-enabled');
const cardCommandsDisabled = (prompt) => ['dsui-image', 'dsui-weather', 'dsui-map']
  .every((lang) => prompt.includes(`不要输出 ${lang} 块`));

await page.locator('#dsui-fab').click();
await setting('weatherCards').uncheck();
await setting('inlineImages').uncheck();
await setting('mapCards').uncheck();
check('改卡片偏好后，已注入会话的下一轮不重复注入', firstPrompt.includes('⟦DS-UI v1⟧') &&
  await sendMockPrompt('cards-enabled') === '你好');
const newChatPrompt = await sendMockPrompt('cards-disabled');
check('新会话首轮使用关闭卡片后的偏好', cardCommandsDisabled(newChatPrompt));
await setting('customProtocol').fill('优先使用人民币');
const refreshedPrompt = await sendMockPrompt('cards-enabled');
check('当前会话更新文本偏好时，保留首轮的三种卡片指令',
  refreshedPrompt === firstPrompt.replace('\n⟦/DS-UI⟧', '\n附加呈现偏好（以本轮要求和组件约束为准）\n优先使用人民币\n⟦/DS-UI⟧'));
check('更新偏好后现有卡片继续显示', await weather.isVisible() &&
  await map.locator('.dsui-map').isVisible() && await toggledGallery.isVisible());
await page.keyboard.press('Escape');
await page.locator('#dsui-fab').click();
check('重新打开保留修改，面板隐藏滚动条且可滚动',
  await setting('customProtocol').inputValue() === '优先使用人民币' &&
  !await setting('inlineImages').isChecked() &&
  await page.locator('#dsui-settings-host .wrap').evaluate((panel) => {
    panel.scrollTop = panel.scrollHeight;
    return panel.scrollTop > 0 && getComputedStyle(panel).scrollbarWidth === 'none';
  }));
await setting('weatherCards').check();
await setting('inlineImages').check();
await setting('mapCards').check();
await setting('injectEveryTurn').check();
check('每轮注入也分别沿用各会话首轮的卡片设置',
  cardCommandsDisabled(await sendMockPrompt('cards-disabled')) &&
  await sendMockPrompt('cards-enabled') === refreshedPrompt);
await setting('injectEveryTurn').uncheck();
await page.keyboard.press('Escape');
await page.locator('#image-toggle').evaluate((msg) => msg.remove());
await page.locator('#weather-card, #no-weather, #map-card, #map-offline, #map-keywords, #map-keywords-cache')
  .evaluateAll((messages) => messages.forEach((msg) => msg.remove()));

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
