const NAMES = { infographic: 'Infographic', plantuml: 'PlantUML' };
const libraries = new Map();

export function diagramKind(lang) {
  if (lang === 'puml') return 'plantuml';
  return Object.hasOwn(NAMES, lang) ? lang : null;
}

export function readDiagram(kind, code, theme) {
  const source = code.trim();
  if (!source || source.length > 50000) return null;
  if (kind === 'plantuml') {
    const start = /^@start([a-z]+)\b[^\n]*\n/i.exec(source);
    if (!start || !new RegExp(`^@end${start[1]}[ \\t]*$`, 'im').test(source)) return null;
  } else if (!/^infographic[ \t]+[\w-]+[ \t]*\r?\n/i.test(source)) return null;
  return { kind, source, theme };
}

// Runs inside the diagram iframe. Source is data and generated SVG is displayed as an image.
async function renderInFrame({ kind, source, theme }) {
  const report = (height) => parent.postMessage({ type: 'dsui:diagram', height }, '*');
  const container = document.querySelector('main');
  try {
    let url;
    if (kind === 'infographic') {
      AntVInfographic.setDefaultFont('system-ui, sans-serif');
      for (const font of AntVInfographic.getFonts()) font.fontWeight = {};
      const chart = new AntVInfographic.Infographic({ container, padding: 16, theme: theme === 'dark' ? 'dark' : 'light' });
      chart.render(source);
      url = await chart.toDataURL({ type: 'svg', embedResources: false });
      chart.destroy();
    } else {
      const svg = await new Promise((resolve, reject) => {
        PlantUML.renderToString(source.split(/\r?\n/), resolve, reject, { dark: theme === 'dark' });
      });
      url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    }
    const image = new Image();
    image.alt = kind === 'infographic' ? 'Infographic' : 'PlantUML';
    image.src = url;
    await image.decode();
    container.replaceChildren(image);
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    const reportSize = () => report(Math.ceil(container.getBoundingClientRect().height));
    reportSize();
    new ResizeObserver(reportSize).observe(container);
  } catch (error) {
    console.debug('[DS-UI] diagram rendering:', error);
    report(0);
  }
}

function getLibrary(kind) {
  if (!libraries.has(kind)) {
    const packed = kind === 'infographic' ? __DS_INFOGRAPHIC_JS__ : __DS_PLANTUML_JS__;
    const bytes = Uint8Array.from(atob(packed), (character) => character.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    libraries.set(kind, new Response(stream).text());
  }
  return libraries.get(kind);
}

async function createDocument(request) {
  const nonce = crypto.randomUUID();
  const library = await getLibrary(request.kind);
  const data = JSON.stringify(request).replaceAll('<', '\\u003c');
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>body{margin:0}img{display:block;max-width:100%;height:auto;margin:auto}</style></head><body><main></main>
<script nonce="${nonce}">${library.replace(/<\/script/gi, '<\\/script')}</script>
<script nonce="${nonce}">(${renderInFrame.toString()})(${data});</script></body></html>`;
}

export class DiagramCard {
  constructor(block, request) {
    this.block = block;
    this.request = request;
    this.key = JSON.stringify(request);
    this.el = document.createElement('div');
    this.el.className = 'dsui-diagram';
  }

  mount() {
    this.block.after(this.el);
    // Wait for a pause in streamed edits before starting the rendering engine.
    this.timer = setTimeout(() => this.watchVisibility(), 450);
  }

  watchVisibility() {
    if (typeof IntersectionObserver !== 'function') return this.render();
    this.visibility = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      this.visibility.disconnect();
      this.render();
    }, { rootMargin: '240px' });
    this.visibility.observe(this.block);
  }

  render() {
    if (!this.el.isConnected) return;
    const title = NAMES[this.request.kind];
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('aria-hidden', 'true');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.textContent = `${title} 源码`;
    toggle.addEventListener('click', () => {
      const show = this.block.hasAttribute('data-dsui-hidden');
      if (show) this.block.removeAttribute('data-dsui-hidden');
      else this.block.setAttribute('data-dsui-hidden', '1');
      toggle.setAttribute('aria-expanded', String(show));
    });
    this.onMessage = (event) => {
      if (event.source !== frame.contentWindow || event.data?.type !== 'dsui:diagram') return;
      const { height } = event.data;
      if (!Number.isFinite(height)) return;
      clearTimeout(this.timer);
      if (height <= 0) return this.stopFrame();
      if (toggle.hidden) this.block.setAttribute('data-dsui-hidden', '1');
      toggle.hidden = false;
      this.el.dataset.dsuiDiagramReady = '';
      frame.removeAttribute('aria-hidden');
      frame.style.height = `${Math.min(height, 4000)}px`;
    };
    window.addEventListener('message', this.onMessage);
    this.frame = frame;
    this.timer = setTimeout(() => this.stopFrame(), 15000);
    this.el.append(toggle, frame);
    createDocument(this.request).then((html) => {
      if (frame.isConnected) frame.srcdoc = html;
    }).catch(() => this.stopFrame());
  }

  stopFrame() {
    if (this.onMessage) window.removeEventListener('message', this.onMessage);
    this.frame?.remove();
  }

  destroy() {
    clearTimeout(this.timer);
    this.visibility?.disconnect();
    this.stopFrame();
    this.el.remove();
    if (this.el.hasAttribute('data-dsui-diagram-ready')) this.block.removeAttribute('data-dsui-hidden');
  }
}
