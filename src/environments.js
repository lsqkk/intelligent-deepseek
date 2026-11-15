const TYPES = new Map([
  ['note', '提示'], ['tip', '技巧'], ['important', '重要'], ['warning', '警告'], ['caution', '注意'],
  ['info', '说明'], ['danger', '危险'], ['success', '成功'],
  ['theorem', '定理'], ['lemma', '引理'], ['definition', '定义'], ['proposition', '命题'],
  ['corollary', '推论'], ['axiom', '公理'], ['proof', '证明'], ['example', '例'],
  ['remark', '注记'], ['exercise', '练习'], ['conjecture', '猜想'],
]);
const ACADEMIC = /^(theorem|lemma|definition|proposition|corollary|axiom|proof|example|remark|exercise|conjecture|定理|引理|定义|命题|推论|公理|证明|例|注记|练习|猜想)$/;
const TYPE = '[\\p{L}\\p{N}_-]{1,32}';
const ALERT = new RegExp(`^\\[!(${TYPE})\\](?:[ \\t]+(.*))?$`, 'u');
const OPEN = new RegExp(`^(:{3,})[ \\t]*(${TYPE})(?:[ \\t]+(.*))?$`, 'u');

function toneFor(type) {
  if (ACADEMIC.test(type)) return 'academic';
  if (/^(warning|caution|important|警告|注意|重要)$/.test(type)) return 'warning';
  if (/^(danger|危险)$/.test(type)) return 'danger';
  if (/^(tip|success|技巧|成功)$/.test(type)) return 'tip';
  return 'note';
}

// DeepSeek may put several Markdown lines into one paragraph, using text newlines or <br>.
function readLines(paragraph, originals) {
  const lines = [{ text: '', parts: [] }];
  const line = () => lines.at(-1);
  const addBreak = (part) => {
    line().after = part;
    lines.push({ text: '', parts: [], before: part });
  };
  for (const node of paragraph.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const previous = originals.get(node);
      const text = previous?.rendered === node.data ? previous.text : node.data;
      let offset = 0;
      const segments = text.split('\n');
      for (const [index, segment] of segments.entries()) {
        if (segment) {
          if (!line().parts.length) line().plainStart = true;
          line().text += segment;
          line().parts.push({ node, start: offset, end: offset + segment.length });
        }
        offset += segment.length;
        if (index < segments.length - 1) addBreak({ node, start: offset, end: ++offset });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && !node.hasAttribute('data-dsui-env-heading')) {
      if (node.tagName === 'BR') addBreak({ node });
      else {
        line().text += node.textContent;
        line().parts.push({ node });
      }
    }
  }
  return lines;
}

export class MessageEnvironments {
  constructor() {
    this.text = new Map();
    this.hidden = new Set();
    this.headings = new Map();
    this.styled = new Map();
  }

  update(roots) {
    const cuts = new Map();
    const hidden = new Set();
    const headings = new Map();
    const styled = new Map();
    const removeLine = ({ parts, before, after }, opening) => {
      for (const part of [...parts, opening ? after : before].filter(Boolean)) {
        if (part.node.nodeType === Node.ELEMENT_NODE) hidden.add(part.node);
        else {
          if (!cuts.has(part.node)) cuts.set(part.node, []);
          cuts.get(part.node).push(part);
        }
      }
    };
    const heading = (p, type, title) => {
      const label = TYPES.get(type) ?? type;
      headings.set(p, title?.trim() ? `${label} · ${title.trim()}` : label);
    };

    for (const root of roots) {
      const groups = new Map();
      for (const p of root.querySelectorAll('p')) {
        if (p.closest('.md-code-block, .dsui-data-card, .dsui-diagram')) continue;
        const lines = readLines(p, this.text);
        const first = lines[0];
        if (p.parentElement.matches('blockquote') && p === p.parentElement.firstElementChild) {
          const alert = first.plainStart && ALERT.exec(first.text.trim());
          if (alert) {
            const type = alert[1].toLowerCase();
            removeLine(first, true);
            heading(p, type, alert[2]);
            styled.set(p.parentElement, { tone: toneFor(type), edge: 'both' });
            continue;
          }
        }
        const open = first.plainStart && OPEN.exec(first.text.trim());
        const last = lines.at(-1);
        const close = last.plainStart && /^:{3,}$/.test(last.text.trim()) && last.text.trim();
        if (!open && !close) continue;
        if (!groups.has(p.parentElement)) groups.set(p.parentElement, []);
        groups.get(p.parentElement).push({ p, first, last, lines, open, close });
      }

      for (const [parent, markers] of groups) {
        const children = [...parent.children];
        const stack = [];
        for (const { p, first, last, lines, open, close } of markers) {
          if (open) {
            const [, fence, rawType, title] = open;
            const type = rawType.toLowerCase();
            const compact = lines.length === 1 && title?.endsWith(` ${fence}`);
            if (compact) {
              removeLine(first, true);
              heading(p, type, title.slice(0, -fence.length));
              styled.set(p, { tone: toneFor(type), edge: 'both' });
              continue;
            }
            stack.push({ p, first, fence, type, title });
          }
          if (!close || stack.at(-1)?.fence !== close) continue;
          const start = stack.pop();
          removeLine(start.first, true);
          removeLine(last, false);
          heading(start.p, start.type, start.title);
          const standaloneClose = lines.length === 1;
          if (standaloneClose) hidden.add(p);
          const body = children.slice(children.indexOf(start.p), children.indexOf(p) + (standaloneClose ? 0 : 1));
          for (const [index, child] of body.entries()) {
            if (styled.has(child)) continue;
            const edge = body.length === 1 ? 'both' : index === 0 ? 'start' : index === body.length - 1 ? 'end' : '';
            styled.set(child, { tone: toneFor(start.type), edge });
          }
        }
      }
    }

    for (const [node, { text, rendered }] of this.text) {
      if (!cuts.has(node) && node.data === rendered) node.data = text;
    }
    const nextText = new Map();
    for (const [node, parts] of cuts) {
      const previous = this.text.get(node);
      const text = previous?.rendered === node.data ? previous.text : node.data;
      let rendered = '';
      let cursor = 0;
      for (const { start, end } of parts.sort((a, b) => a.start - b.start)) {
        if (start > cursor) rendered += text.slice(cursor, start);
        cursor = Math.max(cursor, end);
      }
      rendered += text.slice(cursor);
      if (node.data !== rendered) node.data = rendered;
      nextText.set(node, { text, rendered });
    }
    this.text = nextText;

    for (const node of this.hidden) if (!hidden.has(node)) node.removeAttribute('data-dsui-env-hidden');
    for (const node of hidden) if (!this.hidden.has(node)) node.setAttribute('data-dsui-env-hidden', '');
    this.hidden = hidden;
    for (const [p, element] of this.headings) {
      if (headings.has(p)) continue;
      element.remove();
      this.headings.delete(p);
    }
    for (const [p, title] of headings) {
      let element = this.headings.get(p);
      if (element?.parentNode !== p) {
        element = p.ownerDocument.createElement('strong');
        element.setAttribute('data-dsui-env-heading', '');
        p.prepend(element);
        this.headings.set(p, element);
      }
      if (element.textContent !== title) element.textContent = title;
    }
    for (const node of this.styled.keys()) {
      if (!styled.has(node)) {
        node.removeAttribute('data-dsui-env');
        node.removeAttribute('data-dsui-env-edge');
      }
    }
    for (const [node, { tone, edge }] of styled) {
      if (node.dataset.dsuiEnv !== tone) node.dataset.dsuiEnv = tone;
      if (node.dataset.dsuiEnvEdge !== edge) node.dataset.dsuiEnvEdge = edge;
    }
    this.styled = styled;
  }
}
