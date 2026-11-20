import { SampleRecord, SampleStatus } from '../types/stock';

export function nk(s: string | undefined | null): string {
  return String(s ?? '').trim().toLowerCase();
}

export function mk(design: string | undefined | null, model: string | undefined | null): string {
  return `${nk(design)}|${nk(model)}`;
}

export function ci(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

export function localToday(): string {
  const d = new Date();
  return formatYmd(d);
}

export function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftYmd(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return localToday();
  d.setDate(d.getDate() + deltaDays);
  return formatYmd(d);
}

export function formatDateDisplay(s: string): string {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function signForStatus(status: SampleStatus): 1 | -1 {
  return status === 'Returned' || status === 'Converted to sale' ? -1 : 1;
}

export function computeHeldQty(
  samples: SampleRecord[],
  salesperson: string,
  design: string,
  item: string,
  excludeRecordId?: string,
): number {
  const sk = nk(salesperson);
  const ik = mk(design, item);
  let total = 0;
  for (const e of samples) {
    if (excludeRecordId && e.id === excludeRecordId) continue;
    if (nk(e.salesperson) === sk && mk(e.design, e.item) === ik) {
      total += signForStatus(e.status) * (Number(e.qty) || 0);
    }
  }
  return total;
}

export function csvSafeCell(v: string | number | null | undefined): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildCsvContent(records: SampleRecord[]): string {
  const header = ['Date', 'Salesperson', 'Model number', 'Design', 'Qty', 'Trays', 'Status', 'Notes', 'Logged by'];
  const lines = [
    header.join(','),
    ...records.map((e) =>
      [e.date, e.salesperson, e.item, e.design, e.qty, e.trays, e.status, e.notes, e.by ?? '']
        .map(csvSafeCell)
        .join(','),
    ),
  ];
  return `\uFEFF${lines.join('\r\n')}`;
}

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  return trimmed;
}
