'use client';

import { useCallback, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { apiPost } from '@/lib/api/client';

interface ParsedRow {
  name: string;
  email: string;
  company: string;
}

interface ImportError {
  row: number;
  message: string;
}

interface ImportResponse {
  imported: number;
  errors: ImportError[];
}

/**
 * Parses a CSV string into an array of client rows.
 * Supports headers: name, email, company (case-insensitive).
 * Falls back to positional columns if no header matches.
 */
function parseCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];

  // Detect header row
  const firstLine = lines[0]!.toLowerCase();
  let nameIdx = 0;
  let emailIdx = 1;
  let companyIdx = 2;
  let startRow = 0;

  if (firstLine.includes('name') || firstLine.includes('email')) {
    const headers = splitCsvLine(lines[0]!).map((h) => h.toLowerCase().trim());
    nameIdx = headers.indexOf('name');
    emailIdx = headers.indexOf('email');
    companyIdx = headers.indexOf('company');
    if (nameIdx === -1) nameIdx = 0;
    if (emailIdx === -1) emailIdx = 1;
    if (companyIdx === -1) companyIdx = 2;
    startRow = 1;
  }

  const rows: ParsedRow[] = [];
  for (let i = startRow; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]!);
    rows.push({
      name: (cols[nameIdx] ?? '').trim(),
      email: (cols[emailIdx] ?? '').trim(),
      company: (cols[companyIdx] ?? '').trim(),
    });
  }
  return rows;
}

/** Splits a CSV line respecting quoted fields. */
function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function ImportCsvDialog({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setRows([]);
    setFileName(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setResult(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = parseCsv(text);
      setRows(parsed);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setImporting(true);
    setResult(null);

    const res = await apiPost<ImportResponse>('/clients/import', { clients: rows });
    setImporting(false);

    if (!res.ok) {
      toast.error('Import failed', { description: res.error });
      return;
    }

    setResult(res.data);

    if (res.data.imported > 0) {
      toast.success(`${res.data.imported} client${res.data.imported !== 1 ? 's' : ''} imported!`);
      onImported();
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Import CSV
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import clients from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file with columns: <strong>name</strong>, <strong>email</strong>,{' '}
            <strong>company</strong> (optional). The first row can be a header.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* File input */}
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
            />
          </div>

          {/* Preview */}
          {rows.length > 0 && !result ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {fileName} — <strong>{rows.length}</strong> row{rows.length !== 1 ? 's' : ''}{' '}
                found
              </p>
              <div className="max-h-48 overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-2 py-1.5 text-left font-medium">#</th>
                      <th className="px-2 py-1.5 text-left font-medium">Name</th>
                      <th className="px-2 py-1.5 text-left font-medium">Email</th>
                      <th className="px-2 py-1.5 text-left font-medium">Company</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1.5">{row.name || '—'}</td>
                        <td className="px-2 py-1.5">{row.email || '—'}</td>
                        <td className="px-2 py-1.5">{row.company || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 10 ? (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    …and {rows.length - 10} more
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Result */}
          {result ? (
            <div className="space-y-2">
              {result.imported > 0 ? (
                <p className="text-sm font-medium text-green-600 dark:text-green-400">
                  ✓ {result.imported} client{result.imported !== 1 ? 's' : ''} imported
                  successfully.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No clients were imported.</p>
              )}
              {result.errors.length > 0 ? (
                <div className="max-h-32 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-2">
                  <p className="mb-1 text-xs font-medium text-destructive">
                    {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} skipped:
                  </p>
                  <ul className="space-y-0.5 text-xs text-destructive">
                    {result.errors.slice(0, 20).map((err, i) => (
                      <li key={i}>
                        Row {err.row}: {err.message}
                      </li>
                    ))}
                    {result.errors.length > 20 ? (
                      <li>…and {result.errors.length - 20} more</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {!result ? (
            <Button onClick={handleImport} disabled={rows.length === 0 || importing}>
              {importing ? 'Importing…' : `Import ${rows.length} client${rows.length !== 1 ? 's' : ''}`}
            </Button>
          ) : (
            <Button onClick={() => setOpen(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
