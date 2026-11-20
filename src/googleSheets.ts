import { AppData, DesignItem, ModelItem, SalespersonItem, SampleRecord, SampleStatus } from './types';
import { mk, nk } from './utils';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export const SHEET_TABS = {
  samples: 'Samples',
  salespeople: 'Salespeople',
  designs: 'Designs',
  models: 'Models',
} as const;

const HEADERS = {
  samples: ['id', 'date', 'salesperson', 'design', 'item', 'qty', 'trays', 'status', 'notes', 'ts', 'by'],
  salespeople: ['id', 'name', 'ts'],
  designs: ['id', 'name', 'ts'],
  models: ['id', 'name', 'design', 'ts'],
} as const;

export interface SheetTabMeta {
  sheetId: number;
  title: string;
}

export interface SpreadsheetMeta {
  spreadsheetId: string;
  title: string;
  sheets: SheetTabMeta[];
}

export class SheetsApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SheetsApiError';
    this.status = status;
  }
}

async function sheetsFetch<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });

  if (!res.ok) {
    let message = `Google Sheets error (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch {
      // Ignore JSON parse error
    }
    if (res.status === 401) {
      message = 'Google session expired. Please sign in again to continue syncing.';
    } else if (res.status === 403) {
      message = 'You do not have edit access to this Google Sheet. Ask the owner to share it with your Google email as Editor.';
    } else if (res.status === 404) {
      message = 'Google Sheet not found. Double-check the URL or Spreadsheet ID.';
    }
    throw new SheetsApiError(res.status, message);
  }

  return (await res.json()) as T;
}

export async function getSpreadsheetMetadata(
  spreadsheetId: string,
  accessToken: string,
): Promise<SpreadsheetMeta> {
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets.properties(sheetId,title)`;
  const raw = await sheetsFetch<{
    spreadsheetId: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  }>(url, accessToken);

  return {
    spreadsheetId: raw.spreadsheetId,
    title: raw.properties?.title || 'Shared Stock Sheet',
    sheets: (raw.sheets || []).map((s) => ({
      sheetId: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? '',
    })),
  };
}

function sampleToRow(r: SampleRecord): (string | number)[] {
  return [
    r.id,
    r.date,
    r.salesperson,
    r.design,
    r.item,
    r.qty,
    r.trays === null || r.trays === undefined ? '' : r.trays,
    r.status,
    r.notes ?? '',
    r.ts || Date.now(),
    r.by ?? '',
  ];
}

function parseStatus(raw: string): SampleStatus {
  if (raw === 'Returned' || raw === 'Converted to sale' || raw === 'Sent') return raw;
  return 'Sent';
}

function rowToSample(row: string[]): SampleRecord | null {
  const id = String(row[0] ?? '').trim();
  if (!id || id === 'id') return null;
  const traysRaw = String(row[6] ?? '').trim();
  const parsedTrays = traysRaw === '' ? null : Number(traysRaw);
  return {
    id,
    date: String(row[1] ?? '').trim(),
    salesperson: String(row[2] ?? '').trim(),
    design: String(row[3] ?? '').trim(),
    item: String(row[4] ?? '').trim(),
    qty: Math.max(1, Math.round(Number(row[5]) || 1)),
    trays: parsedTrays !== null && Number.isFinite(parsedTrays) ? Math.max(0, Math.round(parsedTrays)) : null,
    status: parseStatus(String(row[7] ?? '').trim()),
    notes: String(row[8] ?? ''),
    ts: Number(row[9]) || 0,
    by: String(row[10] ?? '').trim() || undefined,
  };
}

export async function ensureSheetTabs(
  spreadsheetId: string,
  accessToken: string,
): Promise<SpreadsheetMeta> {
  let meta = await getSpreadsheetMetadata(spreadsheetId, accessToken);
  const existingTitles = new Set(meta.sheets.map((s) => s.title));
  const neededTabs = [SHEET_TABS.samples, SHEET_TABS.salespeople, SHEET_TABS.designs, SHEET_TABS.models];
  const missing = neededTabs.filter((t) => !existingTitles.has(t));

  if (missing.length > 0) {
    await sheetsFetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
      }),
    });
    meta = await getSpreadsheetMetadata(spreadsheetId, accessToken);
  }

  // Ensure row 1 headers exist on each tab
  const ranges = neededTabs.map((t) => `ranges=${encodeURIComponent(`${t}!A1:K1`)}`).join('&');
  const headerCheck = await sheetsFetch<{
    valueRanges?: Array<{ range?: string; values?: string[][] }>;
  }>(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${ranges}`, accessToken);

  const headerUpdates: Array<{ range: string; values: string[][] }> = [];
  const tabPairs: Array<{ tab: string; header: readonly string[] }> = [
    { tab: SHEET_TABS.samples, header: HEADERS.samples },
    { tab: SHEET_TABS.salespeople, header: HEADERS.salespeople },
    { tab: SHEET_TABS.designs, header: HEADERS.designs },
    { tab: SHEET_TABS.models, header: HEADERS.models },
  ];

  tabPairs.forEach((pair, idx) => {
    const firstRow = headerCheck.valueRanges?.[idx]?.values?.[0];
    if (!firstRow || firstRow.length === 0 || firstRow[0] !== 'id') {
      headerUpdates.push({
        range: `${pair.tab}!A1`,
        values: [[...pair.header]],
      });
    }
  });

  if (headerUpdates.length > 0) {
    await sheetsFetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: headerUpdates,
      }),
    });
  }

  return meta;
}

export async function createStockSpreadsheet(
  title: string,
  accessToken: string,
  initialData?: AppData,
): Promise<{ meta: SpreadsheetMeta; data: AppData }> {
  const created = await sheetsFetch<{
    spreadsheetId: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  }>(SHEETS_API, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: SHEET_TABS.samples, gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: SHEET_TABS.salespeople, gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: SHEET_TABS.designs, gridProperties: { frozenRowCount: 1 } } },
        { properties: { title: SHEET_TABS.models, gridProperties: { frozenRowCount: 1 } } },
      ],
    }),
  });

  const spreadsheetId = created.spreadsheetId;
  const seed = initialData ?? { salespeople: [], designs: [], models: [], samples: [] };

  const dataRanges = [
    {
      range: `${SHEET_TABS.samples}!A1`,
      values: [[...HEADERS.samples], ...seed.samples.map(sampleToRow)],
    },
    {
      range: `${SHEET_TABS.salespeople}!A1`,
      values: [[...HEADERS.salespeople], ...seed.salespeople.map((s) => [s.id, s.name, s.ts])],
    },
    {
      range: `${SHEET_TABS.designs}!A1`,
      values: [[...HEADERS.designs], ...seed.designs.map((d) => [d.id, d.name, d.ts])],
    },
    {
      range: `${SHEET_TABS.models}!A1`,
      values: [[...HEADERS.models], ...seed.models.map((m) => [m.id, m.name, m.design, m.ts])],
    },
  ];

  await sheetsFetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: dataRanges,
    }),
  });

  const meta: SpreadsheetMeta = {
    spreadsheetId,
    title: created.properties?.title || title,
    sheets: (created.sheets || []).map((s) => ({
      sheetId: s.properties?.sheetId ?? 0,
      title: s.properties?.title ?? '',
    })),
  };

  return { meta, data: seed };
}

export async function fetchSheetAppData(
  spreadsheetId: string,
  accessToken: string,
): Promise<AppData> {
  const ranges = [
    `${SHEET_TABS.samples}!A2:K`,
    `${SHEET_TABS.salespeople}!A2:C`,
    `${SHEET_TABS.designs}!A2:C`,
    `${SHEET_TABS.models}!A2:D`,
  ]
    .map((r) => `ranges=${encodeURIComponent(r)}`)
    .join('&');

  const raw = await sheetsFetch<{
    valueRanges?: Array<{ values?: string[][] }>;
  }>(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${ranges}`, accessToken);

  const sampleRows = raw.valueRanges?.[0]?.values || [];
  const spRows = raw.valueRanges?.[1]?.values || [];
  const dnRows = raw.valueRanges?.[2]?.values || [];
  const mdRows = raw.valueRanges?.[3]?.values || [];

  const samples: SampleRecord[] = [];
  for (const row of sampleRows) {
    const parsed = rowToSample(row);
    if (parsed) samples.push(parsed);
  }
  samples.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const salespeople: SalespersonItem[] = spRows
    .filter((r) => String(r[0] ?? '').trim() && String(r[1] ?? '').trim())
    .map((r) => ({
      id: String(r[0]).trim(),
      name: String(r[1]).trim(),
      ts: Number(r[2]) || 0,
    }));

  const designs: DesignItem[] = dnRows
    .filter((r) => String(r[0] ?? '').trim() && String(r[1] ?? '').trim())
    .map((r) => ({
      id: String(r[0]).trim(),
      name: String(r[1]).trim(),
      ts: Number(r[2]) || 0,
    }));

  const models: ModelItem[] = mdRows
    .filter((r) => String(r[0] ?? '').trim() && String(r[1] ?? '').trim())
    .map((r) => ({
      id: String(r[0]).trim(),
      name: String(r[1]).trim(),
      design: String(r[2] ?? '').trim(),
      ts: Number(r[3]) || 0,
    }));

  return { salespeople, designs, models, samples };
}

export async function appendSampleToSheet(
  spreadsheetId: string,
  accessToken: string,
  record: SampleRecord,
): Promise<void> {
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
    `${SHEET_TABS.samples}!A:K`,
  )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  await sheetsFetch(url, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      values: [sampleToRow(record)],
    }),
  });
}

async function findRowNumberById(
  spreadsheetId: string,
  tabName: string,
  id: string,
  accessToken: string,
): Promise<number> {
  const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
    `${tabName}!A:A`,
  )}`;
  const raw = await sheetsFetch<{ values?: string[][] }>(url, accessToken);
  const rows = raw.values || [];
  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i]?.[0] ?? '').trim() === id) {
      return i + 1; // 1-based Sheets row number
    }
  }
  return -1;
}

async function deleteRowFromTab(
  spreadsheetId: string,
  tabName: string,
  rowNumber: number,
  accessToken: string,
): Promise<void> {
  if (rowNumber < 2) return;
  const meta = await getSpreadsheetMetadata(spreadsheetId, accessToken);
  const tab = meta.sheets.find((s) => s.title === tabName);
  if (!tab) return;

  await sheetsFetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: tab.sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    }),
  });
}

export async function updateSampleInSheet(
  spreadsheetId: string,
  accessToken: string,
  record: SampleRecord,
): Promise<void> {
  const rowNum = await findRowNumberById(spreadsheetId, SHEET_TABS.samples, record.id, accessToken);
  if (rowNum < 2) {
    await appendSampleToSheet(spreadsheetId, accessToken, record);
    return;
  }

  const range = `${SHEET_TABS.samples}!A${rowNum}:K${rowNum}`;
  await sheetsFetch(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({ values: [sampleToRow(record)] }),
    },
  );
}

export async function deleteSampleFromSheet(
  spreadsheetId: string,
  accessToken: string,
  id: string,
): Promise<void> {
  const rowNum = await findRowNumberById(spreadsheetId, SHEET_TABS.samples, id, accessToken);
  if (rowNum >= 2) {
    await deleteRowFromTab(spreadsheetId, SHEET_TABS.samples, rowNum, accessToken);
  }
}

export async function appendCatalogEntriesToSheet(
  spreadsheetId: string,
  accessToken: string,
  entries: {
    salespeople?: SalespersonItem[];
    designs?: DesignItem[];
    models?: ModelItem[];
  },
): Promise<void> {
  if (entries.salespeople && entries.salespeople.length > 0) {
    await sheetsFetch(
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
        `${SHEET_TABS.salespeople}!A:C`,
      )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          values: entries.salespeople.map((s) => [s.id, s.name, s.ts]),
        }),
      },
    );
  }

  if (entries.designs && entries.designs.length > 0) {
    await sheetsFetch(
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
        `${SHEET_TABS.designs}!A:C`,
      )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          values: entries.designs.map((d) => [d.id, d.name, d.ts]),
        }),
      },
    );
  }

  if (entries.models && entries.models.length > 0) {
    await sheetsFetch(
      `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(
        `${SHEET_TABS.models}!A:D`,
      )}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          values: entries.models.map((m) => [m.id, m.name, m.design, m.ts]),
        }),
      },
    );
  }
}

export async function renameSalespersonInSheet(
  spreadsheetId: string,
  accessToken: string,
  id: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const ranges = [
    `${SHEET_TABS.salespeople}!A2:C`,
    `${SHEET_TABS.samples}!A2:K`,
  ]
    .map((r) => `ranges=${encodeURIComponent(r)}`)
    .join('&');

  const raw = await sheetsFetch<{ valueRanges?: Array<{ values?: string[][] }> }>(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${ranges}`,
    accessToken,
  );

  const spRows = raw.valueRanges?.[0]?.values || [];
  const sampleRows = raw.valueRanges?.[1]?.values || [];
  const updates: Array<{ range: string; values: (string | number)[][] }> = [];

  spRows.forEach((row, idx) => {
    if (String(row[0] ?? '').trim() === id) {
      updates.push({
        range: `${SHEET_TABS.salespeople}!B${idx + 2}`,
        values: [[newName]],
      });
    }
  });

  const oldKey = nk(oldName);
  sampleRows.forEach((row, idx) => {
    if (nk(row[2]) === oldKey) {
      updates.push({
        range: `${SHEET_TABS.samples}!C${idx + 2}`,
        values: [[newName]],
      });
    }
  });

  if (updates.length > 0) {
    await sheetsFetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
    });
  }
}

export async function renameDesignInSheet(
  spreadsheetId: string,
  accessToken: string,
  id: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const ranges = [
    `${SHEET_TABS.designs}!A2:C`,
    `${SHEET_TABS.models}!A2:D`,
    `${SHEET_TABS.samples}!A2:K`,
  ]
    .map((r) => `ranges=${encodeURIComponent(r)}`)
    .join('&');

  const raw = await sheetsFetch<{ valueRanges?: Array<{ values?: string[][] }> }>(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${ranges}`,
    accessToken,
  );

  const dnRows = raw.valueRanges?.[0]?.values || [];
  const mdRows = raw.valueRanges?.[1]?.values || [];
  const sampleRows = raw.valueRanges?.[2]?.values || [];
  const updates: Array<{ range: string; values: (string | number)[][] }> = [];

  dnRows.forEach((row, idx) => {
    if (String(row[0] ?? '').trim() === id) {
      updates.push({
        range: `${SHEET_TABS.designs}!B${idx + 2}`,
        values: [[newName]],
      });
    }
  });

  const oldKey = nk(oldName);
  mdRows.forEach((row, idx) => {
    if (nk(row[2]) === oldKey) {
      updates.push({
        range: `${SHEET_TABS.models}!C${idx + 2}`,
        values: [[newName]],
      });
    }
  });

  sampleRows.forEach((row, idx) => {
    if (nk(row[3]) === oldKey) {
      updates.push({
        range: `${SHEET_TABS.samples}!D${idx + 2}`,
        values: [[newName]],
      });
    }
  });

  if (updates.length > 0) {
    await sheetsFetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
    });
  }
}

export async function renameModelInSheet(
  spreadsheetId: string,
  accessToken: string,
  id: string,
  oldDesign: string,
  oldName: string,
  newDesign: string,
  newName: string,
): Promise<void> {
  const ranges = [
    `${SHEET_TABS.models}!A2:D`,
    `${SHEET_TABS.samples}!A2:K`,
  ]
    .map((r) => `ranges=${encodeURIComponent(r)}`)
    .join('&');

  const raw = await sheetsFetch<{ valueRanges?: Array<{ values?: string[][] }> }>(
    `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${ranges}`,
    accessToken,
  );

  const mdRows = raw.valueRanges?.[0]?.values || [];
  const sampleRows = raw.valueRanges?.[1]?.values || [];
  const updates: Array<{ range: string; values: (string | number)[][] }> = [];

  mdRows.forEach((row, idx) => {
    if (String(row[0] ?? '').trim() === id) {
      updates.push({
        range: `${SHEET_TABS.models}!B${idx + 2}:C${idx + 2}`,
        values: [[newName, newDesign]],
      });
    }
  });

  const oldPair = mk(oldDesign, oldName);
  sampleRows.forEach((row, idx) => {
    if (mk(row[3], row[4]) === oldPair) {
      updates.push({
        range: `${SHEET_TABS.samples}!D${idx + 2}:E${idx + 2}`,
        values: [[newDesign, newName]],
      });
    }
  });

  if (updates.length > 0) {
    await sheetsFetch(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, accessToken, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
    });
  }
}

export async function deleteCatalogItemFromSheet(
  spreadsheetId: string,
  accessToken: string,
  kind: 'salesperson' | 'design' | 'model',
  id: string,
): Promise<void> {
  const tabName =
    kind === 'salesperson'
      ? SHEET_TABS.salespeople
      : kind === 'design'
        ? SHEET_TABS.designs
        : SHEET_TABS.models;

  const rowNum = await findRowNumberById(spreadsheetId, tabName, id, accessToken);
  if (rowNum >= 2) {
    await deleteRowFromTab(spreadsheetId, tabName, rowNum, accessToken);
  }
}
