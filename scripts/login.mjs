#!/usr/bin/env node
/**
 * 打开一个可见的 Edge 窗口，让用户手动登录 chat.deepseek.com。
 * 登录成功后：
 *  - 保存 storageState 到 .auth/deepseek-state.json
 *  - 保存已登录页面的 DOM 快照 .auth/dom-snapshot.html
 *  - 保存 localStorage / sessionStorage 的键名 .auth/storage-keys.json
 *  - 保存截图 .auth/logged-in.png
 * 然后退出。
 *
 * 用法：node scripts/login.mjs [--timeout-minutes 15]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authDir = path.join(root, '.auth');
const profileDir = path.join(root, '.browser-profile');
fs.mkdirSync(authDir, { recursive: true });

const timeoutArg = process.argv.indexOf('--timeout-minutes');
const timeoutMinutes = timeoutArg > -1 ? Number(process.argv[timeoutArg + 1]) || 15 : 15;

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'msedge',
  headless: false,
  viewport: { width: 1440, height: 940 },
  locale: 'zh-CN',
  args: ['--disable-blink-features=AutomationControlled'],
});

const pages = ctx.pages();
const page = pages[0] ?? (await ctx.newPage());
await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });

console.log('[login] 浏览器已打开。请在窗口中登录 DeepSeek（手机号/微信扫码均可）。');
console.log('[login] 正在等待登录完成（检测 URL 离开 /sign_in）...');

const deadline = Date.now() + timeoutMinutes * 60 * 1000;
let loggedIn = false;
while (Date.now() < deadline) {
  await page.waitForTimeout(2000);
  const url = page.url();
  if (!url.includes('/sign_in') && !url.includes('/sign_up')) {
    loggedIn = true;
    break;
  }
}

if (!loggedIn) {
  console.error('[login] 等待超时，未检测到登录。请重试：node scripts/login.mjs');
  await ctx.close();
  process.exit(2);
}

// 等 SPA 完成首屏渲染与本地状态写入
await page.waitForTimeout(6000);

const statePath = path.join(authDir, 'deepseek-state.json');
await ctx.storageState({ path: statePath });

const dom = await page.content();
fs.writeFileSync(path.join(authDir, 'dom-snapshot.html'), dom, 'utf8');

const storageKeys = await page.evaluate(() => ({
  url: location.href,
  origin: location.origin,
  localStorage: Object.keys(localStorage),
  sessionStorage: Object.keys(sessionStorage),
  cookieKeys: document.cookie
    .split(';')
    .map((c) => c.trim().split('=')[0])
    .filter(Boolean),
}));
fs.writeFileSync(path.join(authDir, 'storage-keys.json'), JSON.stringify(storageKeys, null, 2), 'utf8');

await page.screenshot({ path: path.join(authDir, 'logged-in.png'), fullPage: false });
console.log('[login] 登录成功，已保存：');
console.log('  -', statePath);
console.log('  -', path.join(authDir, 'dom-snapshot.html'));
console.log('  -', path.join(authDir, 'storage-keys.json'));
console.log('  -', path.join(authDir, 'logged-in.png'));
console.log('LOGIN_OK');

await ctx.close();
