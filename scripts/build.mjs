#!/usr/bin/env node
/** 构建油猴脚本：src/*.js -> dist/intelligent-deepseek.user.js（单文件 IIFE） */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });

const header = `// ==UserScript==
// @name         DeepSeek Intelligent UI
// @name:zh-CN   DeepSeek 智能交互界面
// @namespace    lsqkk.intelligent-deepseek
// @version      ${pkg.version}
// @description  Bring GPT-6 Intelligent-UI style interactive HTML rendering to chat.deepseek.com: first-turn protocol injection, streaming dsui widgets, and widget-to-chat actions.
// @description:zh-CN  给 chat.deepseek.com 引入类似 GPT-6 Intelligent UI 的机制：新会话首条消息注入界面协议、流式渲染可交互 HTML 组件、组件可回传消息继续对话。
// @author       lsqkk
// @license      MIT
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      commons.wikimedia.org
// @noframes
// ==/UserScript==
`;

await build({
  entryPoints: [path.join(root, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'edge110'],
  outfile: path.join(outDir, 'intelligent-deepseek.user.js'),
  define: {
    __DS_VERSION__: JSON.stringify(pkg.version),
  },
  banner: { js: header },
  legalComments: 'none',
  charset: 'utf8',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

const outFile = path.join(outDir, 'intelligent-deepseek.user.js');
const size = fs.statSync(outFile).size;
console.log(`\n[build] ${outFile} (${(size / 1024).toFixed(1)} KB)`);
