import { copyText, downloadFile } from './files.js';
import { exportWorkbook } from './xlsx.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const NUMBER = /^[+−-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

function cellText(cell) {
  return cell.innerText.trim();
}

function delimitedText(table, separator) {
  return [...table.rows].map((row) => [...row.cells].map((cell) => {
    let value = cellText(cell);
    // A spreadsheet may interpret a text cell as a formula when opened or pasted.
    if (/^[=+\-@＝＋－＠]/.test(value) && !NUMBER.test(value.replace(/[%％]$/, ''))) value = "'" + value;
    if (value.includes(separator) || /["\r\n]/.test(value)) return '"' + value.replaceAll('"', '""') + '"';
    return value;
  }).join(separator)).join('\r\n');
}

function sortableColumns(table) {
  const head = table.tHead;
  const body = table.tBodies[0];
  if (head?.rows.length !== 1 || table.tBodies.length !== 1 || !body.rows.length) return [];
  const cells = [...head.rows[0].cells];
  const regular = (row) => row.cells.length === cells.length &&
    [...row.cells].every((cell) => cell.colSpan === 1 && cell.rowSpan === 1);
  return regular(head.rows[0]) && [...body.rows].every(regular) ? cells : [];
}

export class TableTools {
  constructor(table, onToast) {
    this.table = table;
    this.onToast = onToast;
    this.originalRows = [];
    this.headers = new Map();
    this.bar = document.createElement('div');
    this.bar.className = 'dsui-table-tools';
    this.bar.setAttribute('role', 'group');
    this.bar.setAttribute('aria-label', '表格操作');
    this.bar.append(this.action('复制表格', async () => {
      const ok = await copyText(delimitedText(table, '\t'));
      this.onToast?.(ok ? '已复制表格' : '复制表格失败');
    }), this.action('下载 CSV', () => {
      try {
        const csv = new Blob(['\uFEFF', delimitedText(table, ',')], { type: 'text/csv;charset=utf-8' });
        downloadFile(csv, 'DeepSeek-表格.csv');
      } catch {
        this.onToast?.('CSV 下载失败');
      }
    }), this.action('下载 XLSX', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const rows = [...table.rows].map((row) => [...row.cells].map(cellText));
        await exportWorkbook(rows, Boolean(table.tHead?.rows.length));
      } catch {
        this.onToast?.('XLSX 下载失败');
      } finally {
        button.disabled = false;
      }
    }));
    table.classList.add('dsui-table');
    this.placeToolbar();
  }

  placeToolbar() {
    const table = this.table;
    const parent = table.parentElement;
    if (this.scroller !== parent) {
      this.scroller?.classList.remove('dsui-table-scroll');
      this.scroller = parent.matches('.ds-scroll-area') ||
        (parent.matches('div:not(.ds-markdown)') && parent.childElementCount === 1) ? parent : null;
      if (!this.scroller) {
        this.scroller = document.createElement('div');
        this.scroller.dataset.dsuiTableWrapper = '';
        table.before(this.scroller);
        this.scroller.append(table);
      }
      this.scroller.classList.add('dsui-table-scroll');
    }
    if (this.bar.nextElementSibling !== this.scroller) this.scroller.before(this.bar);
  }

  action(label, run) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', run);
    return button;
  }

  refresh() {
    this.placeToolbar();
    const columns = sortableColumns(this.table);
    for (const [cell, button] of this.headers) {
      if (columns.includes(cell) && button.parentNode === cell) continue;
      if (this.active === cell) this.resetSort();
      button.remove();
      this.headers.delete(cell);
    }
    for (const cell of columns) {
      if (this.headers.has(cell)) continue;
      const button = this.action('', () => this.sort(cell));
      button.className = 'dsui-table-sort';
      cell.append(button);
      this.headers.set(cell, button);
    }
    for (const [cell, button] of this.headers) {
      button.setAttribute('aria-label', `排序：${cellText(cell)}`);
    }
    if (this.active) this.applySort();
  }

  sort(cell) {
    if (this.active === cell && this.direction === -1) {
      this.resetSort();
      return;
    }
    if (!this.active) this.originalRows = [...this.table.tBodies[0].rows];
    this.active?.removeAttribute('aria-sort');
    this.direction = this.active === cell ? -1 : 1;
    this.active = cell;
    cell.setAttribute('aria-sort', this.direction === 1 ? 'ascending' : 'descending');
    this.applySort();
  }

  applySort() {
    const body = this.table.tBodies[0];
    const rows = [...body.rows];
    this.originalRows = this.originalRows.filter((row) => row.parentNode === body);
    const known = new Set(this.originalRows);
    this.originalRows.push(...rows.filter((row) => !known.has(row)));
    const entries = this.originalRows.map((row) => ({ row, value: cellText(row.cells[this.active.cellIndex]) }));
    const filled = entries.filter(({ value }) => value);
    const percent = filled.length > 0 && filled.every(({ value }) => /[%％]$/.test(value));
    const numericText = (value) => (percent ? value.slice(0, -1).trim() : value).replace('−', '-');
    const numeric = filled.every(({ value }) => NUMBER.test(numericText(value)));
    const number = (value) => Number(numericText(value).replaceAll(',', ''));
    entries.sort((a, b) => {
      if (!a.value || !b.value) return Number(!a.value) - Number(!b.value);
      const order = numeric ? number(a.value) - number(b.value) : collator.compare(a.value, b.value);
      return this.direction * order;
    });
    this.reorder(body, entries.map(({ row }) => row));
  }

  reorder(body, rows) {
    rows.forEach((row, index) => {
      if (body.rows[index] !== row) body.insertBefore(row, body.rows[index] || null);
    });
  }

  resetSort() {
    if (!this.active) return;
    const body = this.table.tBodies[0];
    if (body) {
      const original = this.originalRows.filter((row) => row.parentNode === body);
      const known = new Set(original);
      this.reorder(body, [...original, ...[...body.rows].filter((row) => !known.has(row))]);
    }
    this.active.removeAttribute('aria-sort');
    this.active = null;
    this.originalRows = [];
  }

  destroy() {
    this.resetSort();
    for (const button of this.headers.values()) button.remove();
    this.bar.remove();
    this.table.classList.remove('dsui-table');
    this.scroller.classList.remove('dsui-table-scroll');
    if (this.scroller.hasAttribute('data-dsui-table-wrapper') && this.scroller.parentNode) {
      if (this.table.parentNode === this.scroller) this.scroller.before(this.table);
      this.scroller.remove();
    }
  }
}
