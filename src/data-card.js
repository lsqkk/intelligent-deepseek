import { mountMap, readMap } from './map-card.js';
import { mountReferences, readReferenceCards } from './reference-card.js';
import { mountWeather, readWeather } from './weather-card.js';

const formats = {
  'dsui-map': { read: readMap, mount: mountMap },
  'dsui-reference': { parse: readReferenceCards, mount: mountReferences, keepInvalidSource: true },
  'dsui-weather': { read: readWeather, mount: (host, request) => { mountWeather(host, request).catch(() => {}); } },
};

export function readDataCard(lang, source) {
  if (!Object.hasOwn(formats, lang)) return null;
  let request = null;
  const format = formats[lang];
  try { request = format.parse ? format.parse(source) : format.read(JSON.parse(source)); } catch {}
  return { lang, request };
}

export class DataCard {
  constructor(block, payload) {
    this.block = block;
    this.payload = payload;
    this.key = JSON.stringify(payload);
    this.el = document.createElement('div');
    this.el.className = `dsui-data-card ${payload.lang}`;
    this.el.hidden = true;
  }

  mount() {
    const format = formats[this.payload.lang];
    if (this.payload.request || !format.keepInvalidSource) this.block.setAttribute('data-dsui-hidden', '1');
    this.block.after(this.el);
    if (this.payload.request) {
      this.dispose = format.mount(this.el, this.payload.request);
    }
  }

  destroy() {
    this.dispose?.();
    this.el.remove();
    this.block.removeAttribute('data-dsui-hidden');
  }
}
