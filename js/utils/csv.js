// CSV helpers. Cells can be:
//   null/undefined -> empty      number -> as is        string -> text (made safe)
//   { raw: "-500.00" }  -> written exactly as given (for money, may be negative)
//   { text: "01712345678" } -> forced to stay text in Excel (keeps leading zero)
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'object') {
    if ('raw' in value) return String(value.raw ?? '');
    if ('text' in value) {
      const s = String(value.text ?? '');
      if (!s) return '';
      if (/^[A-Za-z0-9+]+$/.test(s)) return `"=""${s}"""`;
      return csvCell(s);
    }
    return '';
  }

  let s = String(value);
  // stop spreadsheet programs from running a cell as a formula
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

// BOM at the start makes Excel show Bengali text correctly.
export function downloadCsv(filename, csvText) {
  const blob = new Blob(['\uFEFF', csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
