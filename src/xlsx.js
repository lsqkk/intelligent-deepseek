import { downloadFile } from './files.js';

const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NUMERIC = /^[+\-−]?(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d+))?([%％])?$/;

function writeValue(cell, text) {
  const match = NUMERIC.exec(text);
  if (!match || text.replace(/\D/g, '').length > 15) {
    if (text) cell.value = text;
    return;
  }
  const [, decimals, percent] = match;
  const number = Number(text.replace(/[,％%]/g, '').replace('−', '-'));
  cell.value = percent ? number / 100 : number;
  if (decimals || percent) cell.numFmt = '0' + (decimals ? '.' + '0'.repeat(decimals.length) : '') + (percent ? '%' : '');
}

export async function exportWorkbook(rows, hasHeader) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('表格');
  const columns = [];
  rows.forEach((values, y) => {
    const row = sheet.getRow(y + 1);
    values.forEach((value, x) => {
      const cell = row.getCell(x + 1);
      if (y === 0 && hasHeader) cell.value = value;
      else writeValue(cell, value);
      columns[x] = Math.min(42, Math.max(columns[x] ?? 10, Array.from(value).length + 2));
    });
  });
  columns.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  if (hasHeader && columns.length) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }
  const bytes = await workbook.xlsx.writeBuffer();
  downloadFile(new Blob([bytes], { type: MIME }), 'DeepSeek-表格.xlsx');
}
