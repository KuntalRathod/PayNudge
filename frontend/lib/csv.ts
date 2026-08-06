/**
 * Lightweight client-side CSV export helper.
 *
 * No backend round trip is needed: the data is already loaded into frontend
 * state (invoices/clients lists), so we serialize it to CSV in the browser and
 * trigger a download via a Blob + temporary `<a>` element.
 */

/** Escapes a single CSV field: wraps in quotes if it contains a comma, quote, or newline. */
function escapeCsvField(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds a CSV string from column headers and row objects.
 *
 * @param columns Ordered list of `{ key, label }` pairs. `key` looks up the
 *   value on each row; `label` is the header text.
 * @param rows Data rows to serialize.
 */
export function buildCsv<T extends Record<string, unknown>>(
  columns: ReadonlyArray<{ key: keyof T; label: string }>,
  rows: readonly T[],
): string {
  const header = columns.map((c) => escapeCsvField(c.label)).join(',');
  const body = rows
    .map((row) => columns.map((c) => escapeCsvField(row[c.key])).join(','))
    .join('\r\n');
  // Prefix a UTF-8 BOM so Excel opens the file with correct encoding.
  return `\uFEFF${header}\r\n${body}`;
}

/** Triggers a browser download of the given text content as a named file. */
export function downloadTextFile(filename: string, content: string, mimeType = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Builds a CSV from columns/rows and immediately downloads it as `filename`. */
export function exportToCsv<T extends Record<string, unknown>>(
  filename: string,
  columns: ReadonlyArray<{ key: keyof T; label: string }>,
  rows: readonly T[],
): void {
  const csv = buildCsv(columns, rows);
  downloadTextFile(filename, csv);
}
