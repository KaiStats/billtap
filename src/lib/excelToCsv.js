/**
 * An Excel workbook, as CSV text Claude can read.
 *
 * Claude reads PDFs and plain text, not .xlsx, so the browser converts the
 * workbook before upload. Every sheet is kept, each under a "# Sheet: name"
 * line, because a P&L workbook often puts the month on one tab and the detail
 * on another. Dates become YYYY-MM-DD; empty trailing cells are dropped.
 */
const cell = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function sheetsToCsv(sheets) {
  return (sheets || [])
    .map(({ sheet, data }) => {
      const rows = (data || [])
        .map((row) => {
          const cells = (row || []).map(cell);
          while (cells.length && cells[cells.length - 1] === '') cells.pop();
          return cells.join(',');
        })
        .filter((line) => line !== '');
      return rows.length ? `# Sheet: ${sheet}\n${rows.join('\n')}` : '';
    })
    .filter(Boolean)
    .join('\n\n');
}

export async function excelFileToCsv(file) {
  const { default: readExcelFile } = await import('read-excel-file/browser');
  return sheetsToCsv(await readExcelFile(file));
}
