import { useEffect, useMemo, useRef, useState } from 'react';
import { AppData, SampleRecord, SampleStatus } from '../types';
import {
  buildCsvContent,
  ci,
  computeHeldQty,
  downloadCsvFile,
  formatDate,
  mk,
  nk,
  signForStatus,
} from '../utils';
import NewRecordCard from './NewRecordCard';

interface RecordsViewProps {
  data: AppData;
  isSheetConnected?: boolean;
  onAddRecord: (record: SampleRecord) => Promise<boolean> | boolean;
  onUpdateRecord: (record: SampleRecord) => Promise<boolean> | boolean;
  onDeleteRecord: (id: string) => Promise<boolean> | boolean;
  onNavigateManage: () => void;
}

interface ItemSummary {
  key: string;
  model: string;
  design: string;
  sentQty: number;
  outQty: number;
  sentTrays: number;
  outTrays: number;
  hasSearchMatch: boolean;
}

interface PersonGroup {
  key: string;
  name: string;
  units: number;
  trays: number;
  items: ItemSummary[];
  allHistory: SampleRecord[];
  matchedHistory: SampleRecord[];
}

export default function RecordsView({
  data,
  isSheetConnected = false,
  onAddRecord,
  onUpdateRecord,
  onDeleteRecord,
  onNavigateManage,
}: RecordsViewProps) {
  const [search, setSearch] = useState('');
  const [filterSp, setFilterSp] = useState('');
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const armTimerRef = useRef<number | null>(null);
  const [csvFeedback, setCsvFeedback] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);

  // Inline record edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editQty, setEditQty] = useState('');
  const [editTrays, setEditTrays] = useState('');
  const [editStatus, setEditStatus] = useState<SampleStatus>('Sent');
  const [editNotes, setEditNotes] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (armTimerRef.current) window.clearTimeout(armTimerRef.current);
    };
  }, []);

  // Normalized salesperson options from existing records
  const filterOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of data.samples) {
      const k = nk(e.salesperson);
      if (k && !map.has(k)) map.set(k, e.salesperson.trim());
    }
    return Array.from(map.entries())
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => ci(a.name, b.name));
  }, [data.samples]);

  // Reset stale filter before filtering records
  const effectiveFilterSp = useMemo(() => {
    if (!filterSp) return '';
    return filterOptions.some((o) => o.key === filterSp) ? filterSp : '';
  }, [filterOptions, filterSp]);

  // Global KPI stats
  const stats = useMemo(() => {
    const people = new Set<string>();
    let units = 0;
    let trays = 0;
    for (const e of data.samples) {
      const k = nk(e.salesperson);
      if (k) people.add(k);
      const sg = signForStatus(e.status);
      units += sg * (Number(e.qty) || 0);
      trays += sg * (Number(e.trays) || 0);
    }
    return {
      records: data.samples.length,
      units,
      trays,
      salespeople: people.size,
    };
  }, [data.samples]);

  const query = search.trim().toLowerCase();

  const matchesQuery = (e: SampleRecord, q: string) => {
    if (!q) return true;
    const hay = [e.salesperson, e.item, e.design, e.notes, e.status, e.date, formatDate(e.date), e.by ?? '']
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  };

  // Group records by salesperson; search filters visibility without distorting net balances
  const peopleGroups = useMemo<PersonGroup[]>(() => {
    const map = new Map<string, {
      key: string;
      name: string;
      units: number;
      trays: number;
      itemMap: Map<string, ItemSummary>;
      allHistory: SampleRecord[];
      matchedHistory: SampleRecord[];
    }>();

    const nameLookup = new Map(filterOptions.map((o) => [o.key, o.name]));

    for (const e of data.samples) {
      const k = nk(e.salesperson);
      if (!k) continue;
      if (effectiveFilterSp && k !== effectiveFilterSp) continue;

      let group = map.get(k);
      if (!group) {
        group = {
          key: k,
          name: nameLookup.get(k) || e.salesperson.trim(),
          units: 0,
          trays: 0,
          itemMap: new Map(),
          allHistory: [],
          matchedHistory: [],
        };
        map.set(k, group);
      }

      const itemKey = mk(e.design, e.item);
      let item = group.itemMap.get(itemKey);
      if (!item) {
        item = {
          key: itemKey,
          model: e.item,
          design: e.design,
          sentQty: 0,
          outQty: 0,
          sentTrays: 0,
          outTrays: 0,
          hasSearchMatch: false,
        };
        group.itemMap.set(itemKey, item);
      }

      const sg = signForStatus(e.status);
      const qn = Number(e.qty) || 0;
      const tn = Number(e.trays) || 0;
      if (sg > 0) {
        item.sentQty += qn;
        item.sentTrays += tn;
      } else {
        item.outQty += qn;
        item.outTrays += tn;
      }

      group.units += sg * qn;
      group.trays += sg * tn;
      group.allHistory.push(e);

      if (matchesQuery(e, query)) {
        group.matchedHistory.push(e);
        item.hasSearchMatch = true;
      }
    }

    const sortHistory = (arr: SampleRecord[]) =>
      arr.slice().sort((a, b) => {
        if (a.date !== b.date) return b.date < a.date ? -1 : 1;
        return (b.ts || 0) - (a.ts || 0);
      });

    return Array.from(map.values())
      .filter((g) => !query || g.matchedHistory.length > 0)
      .map((g) => ({
        key: g.key,
        name: g.name,
        units: g.units,
        trays: g.trays,
        items: Array.from(g.itemMap.values())
          .filter((i) => !query || i.hasSearchMatch)
          .sort((a, b) => b.sentQty - b.outQty - (a.sentQty - a.outQty)),
        allHistory: sortHistory(g.allHistory),
        matchedHistory: sortHistory(g.matchedHistory),
      }))
      .sort((a, b) => b.units - a.units);
  }, [data.samples, effectiveFilterSp, filterOptions, query]);

  const filteredRecordsForCsv = useMemo(() => {
    return peopleGroups.flatMap((g) => g.matchedHistory);
  }, [peopleGroups]);

  const handleExportCsv = () => {
    try {
      const content = buildCsvContent(filteredRecordsForCsv);
      downloadCsvFile('sample-stock-log.csv', content);
      const count = filteredRecordsForCsv.length;
      setCsvFeedback({
        text: `Exported ${count} record${count === 1 ? '' : 's'}`,
        tone: 'ok',
      });
      setTimeout(() => {
        setCsvFeedback((cur) => (cur?.text.startsWith('Exported') ? null : cur));
      }, 3000);
    } catch {
      setCsvFeedback({ text: 'Could not export CSV.', tone: 'bad' });
    }
  };

  const handleDeleteClick = async (id: string) => {
    if (isSheetConnected) {
      const deleted = await onDeleteRecord(id);
      if (deleted && editingId === id) setEditingId(null);
      return;
    }

    if (armedDeleteId !== id) {
      if (armTimerRef.current) window.clearTimeout(armTimerRef.current);
      setArmedDeleteId(id);
      armTimerRef.current = window.setTimeout(() => {
        setArmedDeleteId((cur) => (cur === id ? null : cur));
      }, 4000);
      return;
    }

    if (armTimerRef.current) window.clearTimeout(armTimerRef.current);
    setArmedDeleteId(null);
    if (editingId === id) setEditingId(null);
    onDeleteRecord(id);
  };

  const startEditRecord = (e: SampleRecord) => {
    setEditingId(e.id);
    setEditDate(e.date);
    setEditQty(String(e.qty));
    setEditTrays(e.trays == null ? '' : String(e.trays));
    setEditStatus(e.status);
    setEditNotes(e.notes);
    setEditError(null);
  };

  const saveEditRecord = async (original: SampleRecord) => {
    if (!editDate) {
      setEditError('Date is required.');
      return;
    }
    const qty = Number(editQty.trim());
    if (!editQty.trim() || !Number.isInteger(qty) || qty < 1) {
      setEditError('Quantity must be a whole number >= 1.');
      return;
    }
    const trimmedTrays = editTrays.trim();
    const trays = trimmedTrays === '' ? null : Number(trimmedTrays);
    if (trays !== null && (!Number.isInteger(trays) || trays < 0)) {
      setEditError('Trays must be a whole number >= 0.');
      return;
    }
    if (editStatus === 'Returned' || editStatus === 'Converted to sale') {
      const heldExcluding = computeHeldQty(
        data.samples,
        original.salesperson,
        original.design,
        original.item,
        original.id,
      );
      if (qty > heldExcluding) {
        setEditError(
          `Cannot mark ${qty} as ${editStatus.toLowerCase()}: only ${heldExcluding} unit(s) held excluding this entry.`,
        );
        return;
      }
    }

    const ok = await onUpdateRecord({
      ...original,
      date: editDate,
      qty,
      trays,
      status: editStatus,
      notes: editNotes.trim(),
    });
    if (ok) {
      setEditingId(null);
      setEditError(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500">Records</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
            {stats.records}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500">Units with salespeople</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
            {stats.units}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500">Trays with salespeople</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
            {stats.trays}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3.5">
          <div className="text-xs font-medium text-slate-500">Salespeople</div>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums mt-1">
            {stats.salespeople}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: New Record Entry */}
        <div className="lg:col-span-5">
          <NewRecordCard
            data={data}
            onAddRecord={onAddRecord}
            onNavigateManage={onNavigateManage}
          />
        </div>

        {/* Right: Sample Record List */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Sample Records</h2>
            {csvFeedback && (
              <span
                className={`text-xs font-semibold ${
                  csvFeedback.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {csvFeedback.text}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[180px]">
              <label htmlFor="q" className="block text-xs font-medium text-slate-700 mb-1">
                Search
              </label>
              <input
                id="q"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Salesperson, model, design, status, date…"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              />
            </div>

            <div className="min-w-[160px]">
              <label htmlFor="fsp" className="block text-xs font-medium text-slate-700 mb-1">
                Salesperson
              </label>
              <select
                id="fsp"
                value={effectiveFilterSp}
                onChange={(e) => setFilterSp(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              >
                <option value="">All</option>
                {filterOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleExportCsv}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Export CSV
            </button>
          </div>

          {peopleGroups.length === 0 ? (
            <div className="py-10 text-center border border-dashed border-slate-200 rounded-lg">
              <p className="text-sm text-slate-500">
                {data.samples.length === 0
                  ? 'No records yet. Add the first sample record on the left.'
                  : 'No matching records.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {peopleGroups.map((person) => {
                const isOpen = !!openHistory[person.key] || (!!query && person.matchedHistory.length > 0);
                return (
                  <div
                    key={person.key}
                    className="border border-slate-200 rounded-xl overflow-hidden"
                  >
                    {/* Salesperson Header */}
                    <div className="px-4 py-3 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold inline-flex items-center justify-center shrink-0">
                          {person.name.charAt(0).toUpperCase()}
                        </span>
                        <span className="font-semibold text-slate-900 truncate">{person.name}</span>
                      </div>

                      <div className="text-xs text-slate-600 font-mono tabular-nums whitespace-nowrap">
                        <strong className="text-slate-900">{person.units}</strong> units
                        <span className="mx-2 text-slate-300">·</span>
                        <strong className="text-slate-900">{person.trays}</strong> trays
                      </div>
                    </div>

                    {/* Per-item balances */}
                    <div className="divide-y divide-slate-200">
                      {person.items.map((item) => {
                        const held = item.sentQty - item.outQty;
                        const heldTrays = item.sentTrays - item.outTrays;
                        return (
                          <div
                            key={item.key}
                            className={`px-4 py-2.5 flex items-center justify-between gap-4 ${
                              held <= 0 ? 'opacity-55' : ''
                            }`}
                          >
                            <div className="min-w-0">
                              <span className="text-sm font-semibold text-slate-900">{item.model}</span>
                              {item.design && (
                                <span className="text-xs text-slate-500 ml-1.5">· {item.design}</span>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-sm text-slate-700 font-mono tabular-nums">
                                <strong className="text-base text-slate-900">{held}</strong> with them
                              </div>
                              {heldTrays !== 0 && (
                                <div className="text-xs text-slate-500 font-mono tabular-nums">
                                  {heldTrays} tray{Math.abs(heldTrays) === 1 ? '' : 's'}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* History Accordion */}
                    <div className="border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenHistory((prev) => ({ ...prev, [person.key]: !prev[person.key] }))
                        }
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-slate-600 hover:bg-slate-50 flex items-center justify-between cursor-pointer"
                      >
                        <span>
                          History ({person.matchedHistory.length}
                          {query && person.matchedHistory.length !== person.allHistory.length
                            ? ` of ${person.allHistory.length}`
                            : ''}{' '}
                          {person.matchedHistory.length === 1 ? 'entry' : 'entries'})
                        </span>
                        <span className="text-slate-400">{isOpen ? 'Hide' : 'Show'}</span>
                      </button>

                      {isOpen && (
                        <div className="divide-y divide-dashed divide-slate-200 border-t border-slate-200">
                          {person.matchedHistory.map((entry) => {
                            const isEditing = editingId === entry.id;
                            const statusColor =
                              entry.status === 'Sent'
                                ? 'text-blue-700'
                                : entry.status === 'Returned'
                                  ? 'text-amber-700'
                                  : 'text-emerald-700';

                            if (isEditing) {
                              return (
                                <div key={entry.id} className="px-4 py-3 bg-slate-50 space-y-2.5">
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-700">
                                    <span>
                                      Editing {entry.item} · {entry.design}
                                    </span>
                                  </div>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div>
                                      <label className="block text-[11px] text-slate-500 mb-0.5">Date</label>
                                      <input
                                        type="date"
                                        value={editDate}
                                        onChange={(ev) => setEditDate(ev.target.value)}
                                        className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded-md font-mono"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] text-slate-500 mb-0.5">Qty</label>
                                      <input
                                        type="number"
                                        min={1}
                                        step={1}
                                        value={editQty}
                                        onChange={(ev) => setEditQty(ev.target.value)}
                                        className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded-md font-mono"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] text-slate-500 mb-0.5">Trays</label>
                                      <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        placeholder="0"
                                        value={editTrays}
                                        onChange={(ev) => setEditTrays(ev.target.value)}
                                        className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded-md font-mono"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[11px] text-slate-500 mb-0.5">Status</label>
                                      <select
                                        value={editStatus}
                                        onChange={(ev) => setEditStatus(ev.target.value as SampleStatus)}
                                        className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded-md"
                                      >
                                        <option value="Sent">Sent</option>
                                        <option value="Returned">Returned</option>
                                        <option value="Converted to sale">Converted to sale</option>
                                      </select>
                                    </div>
                                  </div>
                                  <div>
                                    <label className="block text-[11px] text-slate-500 mb-0.5">Notes</label>
                                    <input
                                      type="text"
                                      value={editNotes}
                                      onChange={(ev) => setEditNotes(ev.target.value)}
                                      placeholder="Notes"
                                      className="w-full px-2 py-1 text-xs bg-white border border-slate-300 rounded-md"
                                    />
                                  </div>
                                  {editError && (
                                    <p className="text-xs font-semibold text-rose-700">{editError}</p>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => saveEditRecord(entry)}
                                      className="px-3 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                                    >
                                      Save
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingId(null);
                                        setEditError(null);
                                      }}
                                      className="px-3 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-100 rounded-md cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div
                                key={entry.id}
                                className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                              >
                                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
                                  <span className="text-slate-500 font-mono tabular-nums">
                                    {formatDate(entry.date)}
                                  </span>
                                  <span className="font-semibold text-slate-900">{entry.item}</span>
                                  <span className="text-slate-500">{entry.design}</span>
                                  <span className="font-mono tabular-nums text-slate-800">
                                    × {entry.qty}
                                  </span>
                                  {entry.trays != null && (
                                    <span className="text-slate-500 font-mono tabular-nums">
                                      · {entry.trays} tray{entry.trays === 1 ? '' : 's'}
                                    </span>
                                  )}
                                  <span className={`font-semibold ${statusColor}`}>
                                    · {entry.status}
                                  </span>
                                  {entry.notes && (
                                    <span className="text-slate-500 truncate max-w-[220px]">
                                      · {entry.notes}
                                    </span>
                                  )}
                                  {entry.by && (
                                    <span className="text-slate-400 truncate max-w-[160px]">
                                      · by {entry.by}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => startEditRecord(entry)}
                                    className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteClick(entry.id)}
                                    className={`text-xs cursor-pointer ${
                                      armedDeleteId === entry.id
                                        ? 'font-bold text-rose-700'
                                        : 'font-medium text-rose-600 hover:text-rose-700'
                                    }`}
                                  >
                                    {armedDeleteId === entry.id ? 'Tap again to delete' : 'Delete'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-slate-500">
            “With them” equals sent minus returned and converted to sale. Open “History” under a salesperson to edit or delete entries.
          </p>
        </div>
      </div>
    </div>
  );
}
