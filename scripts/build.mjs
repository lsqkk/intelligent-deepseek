#!/usr/bin/env node
/** 构建油猴脚本：src/*.js -> dist/intelligent-deepseek.user.js（单文件 IIFE） */
import { build, transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { Script } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const infographicDir = path.dirname(path.dirname(require.resolve('@antv/infographic')));
const plantumlDir = path.dirname(require.resolve('@plantuml/core/package.json'));
const packageDirs = {
  exceljs: path.dirname(require.resolve('exceljs/package.json')),
  leaflet: path.dirname(require.resolve('leaflet/package.json')),
  '@antv/infographic': infographicDir,
  '@plantuml/core': plantumlDir,
};
const licenses = Object.entries(packageDirs).map(([name, directory]) => {
  const filename = path.join(directory, 'LICENSE');
  return `/* ${name}\n${fs.readFileSync(filename, 'utf8').trimEnd().replaceAll('*/', '* /')}\n*/`;
}).join('\n');
const readScript = (directory, file) => fs.readFileSync(path.join(directory, file), 'utf8')
  .replace(/^\/\/# sourceMappingURL=.*$/gm, '').trim();
const infographic = readScript(infographicDir, 'dist/infographic.min.js');
const plantuml = await transform(readScript(plantumlDir, 'plantuml.js'), {
  format: 'iife', globalName: 'PlantUML', legalComments: 'inline',
});
const plantumlScript = `${readScript(plantumlDir, 'viz-global.js')}\n${plantuml.code}`;
const packScript = (source) => {
  new Script(source);
  return JSON.stringify(gzipSync(source).toString('base64'));
};
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
// @connect      geocoding-api.open-meteo.com
// @connect      api.open-meteo.com
// @connect      photon.komoot.io
// @noframes
// ==/UserScript==
`;

const { outputFiles } = await build({
  entryPoints: [path.join(root, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'edge110'],
  outfile: path.join(outDir, 'intelligent-deepseek.user.js'),
  write: false,
  define: {
    __DS_VERSION__: JSON.stringify(pkg.version),
    __DS_LEAFLET_CSS__: JSON.stringify(fs.readFileSync(require.resolve('leaflet/dist/leaflet.css'), 'utf8')),
    __DS_INFOGRAPHIC_JS__: packScript(infographic),
    __DS_PLANTUML_JS__: packScript(plantumlScript),
  },
  banner: { js: header + licenses },
  legalComments: 'inline',
  charset: 'utf8',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
});

const outFile = path.join(outDir, 'intelligent-deepseek.user.js');
fs.writeFileSync(outFile, outputFiles[0].text.replace(/^[ \t]+$/gm, ''));
const size = fs.statSync(outFile).size;
console.log(`\n[build] ${outFile} (${(size / 1024).toFixed(1)} KB)`);
