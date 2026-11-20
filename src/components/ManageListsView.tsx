import { useEffect, useMemo, useRef, useState } from 'react';
import { AppData, DesignItem, ModelItem, SalespersonItem } from '../types';
import { ci, mk, nk, uid } from '../utils';

export interface CatalogHandlers {
  onImportMissing: (entries: {
    salespeople: SalespersonItem[];
    designs: DesignItem[];
    models: ModelItem[];
  }) => Promise<boolean>;
  onAddSalesperson: (item: SalespersonItem) => Promise<boolean>;
  onAddDesign: (item: DesignItem) => Promise<boolean>;
  onAddModel: (item: ModelItem) => Promise<boolean>;
  onRenameSalesperson: (id: string, oldName: string, newName: string) => Promise<boolean>;
  onRenameDesign: (id: string, oldName: string, newName: string) => Promise<boolean>;
  onRenameModel: (
    id: string,
    oldDesign: string,
    oldName: string,
    newDesign: string,
    newName: string,
  ) => Promise<boolean>;
  onDeleteCatalogItem: (
    kind: 'salesperson' | 'design' | 'model',
    id: string,
    label: string,
  ) => Promise<boolean>;
}

interface ManageListsViewProps {
  data: AppData;
  isSheetConnected?: boolean;
  catalogHandlers: CatalogHandlers;
  onBackToRecords: () => void;
}

type EditingTarget =
  | { kind: 'salesperson'; id: string; name: string }
  | { kind: 'design'; id: string; name: string }
  | { kind: 'model'; id: string; name: string; design: string }
  | null;

export default function ManageListsView({
  data,
  isSheetConnected = false,
  catalogHandlers,
  onBackToRecords,
}: ManageListsViewProps) {
  const [newSp, setNewSp] = useState('');
  const [newDesign, setNewDesign] = useState('');
  const [newModelDesign, setNewModelDesign] = useState('');
  const [newModel, setNewModel] = useState('');

  const [editing, setEditing] = useState<EditingTarget>(null);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [armedDeleteKey, setArmedDeleteKey] = useState<string | null>(null);
  const armTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (armTimerRef.current) window.clearTimeout(armTimerRef.current);
    };
  }, []);

  const showMessage = (text: string, tone: 'ok' | 'bad') => {
    setFeedback({ text, tone });
  };

  // Merge catalog entries with any legacy names found only in sample records
  const merged = useMemo(() => {
    const spMap = new Map<string, { name: string; item?: SalespersonItem; recordCount: number }>();
    const dnMap = new Map<string, { name: string; item?: DesignItem; modelCount: number; recordCount: number }>();
    const mdMap = new Map<string, { name: string; design: string; item?: ModelItem; recordCount: number }>();

    for (const s of data.samples) {
      const sk = nk(s.salesperson);
      if (sk) {
        const cur = spMap.get(sk) || { name: s.salesperson.trim(), recordCount: 0 };
        cur.recordCount += 1;
        spMap.set(sk, cur);
      }

      const dk = nk(s.design);
      if (dk) {
        const curD = dnMap.get(dk) || { name: s.design.trim(), modelCount: 0, recordCount: 0 };
        curD.recordCount += 1;
        dnMap.set(dk, curD);

        if (nk(s.item)) {
          const mkey = mk(s.design, s.item);
          const curM = mdMap.get(mkey) || {
            name: s.item.trim(),
            design: s.design.trim(),
            recordCount: 0,
          };
          curM.recordCount += 1;
          mdMap.set(mkey, curM);
        }
      }
    }

    for (const sp of data.salespeople) {
      const sk = nk(sp.name);
      if (!sk) continue;
      const cur = spMap.get(sk);
      spMap.set(sk, { name: sp.name, item: sp, recordCount: cur?.recordCount || 0 });
    }

    for (const dn of data.designs) {
      const dk = nk(dn.name);
      if (!dk) continue;
      const cur = dnMap.get(dk);
      dnMap.set(dk, {
        name: dn.name,
        item: dn,
        modelCount: 0,
        recordCount: cur?.recordCount || 0,
      });
    }

    for (const md of data.models) {
      const dk = nk(md.design);
      if (dk && !dnMap.has(dk)) {
        dnMap.set(dk, { name: md.design.trim(), modelCount: 0, recordCount: 0 });
      }
      const mkey = mk(md.design, md.name);
      const cur = mdMap.get(mkey);
      mdMap.set(mkey, {
        name: md.name,
        design: md.design,
        item: md,
        recordCount: cur?.recordCount || 0,
      });
    }

    // Count models per design
    for (const md of mdMap.values()) {
      const dk = nk(md.design);
      const dEntry = dnMap.get(dk);
      if (dEntry) dEntry.modelCount += 1;
    }

    const salespeople = Array.from(spMap.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => ci(a.name, b.name));

    const designs = Array.from(dnMap.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => ci(a.name, b.name));

    const models = Array.from(mdMap.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => ci(a.name, b.name));

    const missingCount =
      salespeople.filter((x) => !x.item).length +
      designs.filter((x) => !x.item).length +
      models.filter((x) => !x.item).length;

    return { spMap, dnMap, mdMap, salespeople, designs, models, missingCount };
  }, [data]);

  const effectiveNewModelDesign = merged.designs.some((d) => d.name === newModelDesign)
    ? newModelDesign
    : '';

  const handleImportAll = async () => {
    const now = Date.now();
    const existingSp = new Set(data.salespeople.map((x) => nk(x.name)));
    const existingDn = new Set(data.designs.map((x) => nk(x.name)));
    const existingMd = new Set(data.models.map((x) => mk(x.design, x.name)));

    const addSp: SalespersonItem[] = [];
    const addDn: DesignItem[] = [];
    const addMd: ModelItem[] = [];

    for (const s of merged.salespeople) {
      if (!s.item && !existingSp.has(s.key)) {
        existingSp.add(s.key);
        addSp.push({ id: uid('sp'), name: s.name, ts: now });
      }
    }
    for (const d of merged.designs) {
      if (!d.item && !existingDn.has(d.key)) {
        existingDn.add(d.key);
        addDn.push({ id: uid('dn'), name: d.name, ts: now });
      }
    }
    for (const m of merged.models) {
      if (!m.item && !existingMd.has(m.key)) {
        existingMd.add(m.key);
        addMd.push({ id: uid('md'), name: m.name, design: m.design, ts: now });
      }
    }

    const ok = await catalogHandlers.onImportMissing({
      salespeople: addSp,
      designs: addDn,
      models: addMd,
    });
    if (ok) {
      showMessage('Imported items from records into editable lists.', 'ok');
    }
  };

  // --- Add handlers ---
  const handleAddSalesperson = async () => {
    const trimmed = newSp.trim();
    if (!trimmed) return showMessage('Type a salesperson name first.', 'bad');
    if (merged.spMap.has(nk(trimmed))) return showMessage('Salesperson is already in the list.', 'bad');
    const ok = await catalogHandlers.onAddSalesperson({ id: uid('sp'), name: trimmed, ts: Date.now() });
    if (ok) {
      setNewSp('');
      showMessage('Salesperson added.', 'ok');
    }
  };

  const handleAddDesign = async () => {
    const trimmed = newDesign.trim();
    if (!trimmed) return showMessage('Type a design name first.', 'bad');
    if (merged.dnMap.has(nk(trimmed))) return showMessage('Design is already in the list.', 'bad');
    const ok = await catalogHandlers.onAddDesign({ id: uid('dn'), name: trimmed, ts: Date.now() });
    if (ok) {
      setNewDesign('');
      showMessage('Design added.', 'ok');
    }
  };

  const handleAddModel = async () => {
    const trimmed = newModel.trim();
    if (!effectiveNewModelDesign) return showMessage('Choose a design first.', 'bad');
    if (!trimmed) return showMessage('Type a model number first.', 'bad');
    if (merged.mdMap.has(mk(effectiveNewModelDesign, trimmed))) {
      return showMessage('That model number already exists under this design.', 'bad');
    }
    const ok = await catalogHandlers.onAddModel({
      id: uid('md'),
      name: trimmed,
      design: effectiveNewModelDesign,
      ts: Date.now(),
    });
    if (ok) {
      setNewModel('');
      showMessage('Model number added.', 'ok');
    }
  };

  // --- Edit / Rename handlers (with cascading updates across linked records & models) ---
  const saveEdit = async () => {
    if (!editing) return;
    const trimmedName = editing.name.trim();
    if (!trimmedName) {
      showMessage('Name cannot be empty.', 'bad');
      return;
    }

    if (editing.kind === 'salesperson') {
      const existing = data.salespeople.find((s) => s.id === editing.id);
      if (!existing) return;
      const oldKey = nk(existing.name);
      const newKey = nk(trimmedName);
      if (newKey !== oldKey && merged.spMap.has(newKey)) {
        showMessage('Another salesperson already has that name.', 'bad');
        return;
      }
      const ok = await catalogHandlers.onRenameSalesperson(existing.id, existing.name, trimmedName);
      if (ok) {
        setEditing(null);
        showMessage('Salesperson updated across list and records.', 'ok');
      }
      return;
    }

    if (editing.kind === 'design') {
      const existing = data.designs.find((d) => d.id === editing.id);
      if (!existing) return;
      const oldKey = nk(existing.name);
      const newKey = nk(trimmedName);
      if (newKey !== oldKey && merged.dnMap.has(newKey)) {
        showMessage('Another design already has that name.', 'bad');
        return;
      }
      const ok = await catalogHandlers.onRenameDesign(existing.id, existing.name, trimmedName);
      if (ok) {
        setEditing(null);
        showMessage('Design updated across list, models, and records.', 'ok');
      }
      return;
    }

    if (editing.kind === 'model') {
      const existing = data.models.find((m) => m.id === editing.id);
      if (!existing) return;
      const targetDesign = editing.design.trim();
      if (!targetDesign) {
        showMessage('Please choose a design for this model.', 'bad');
        return;
      }
      const oldPair = mk(existing.design, existing.name);
      const newPair = mk(targetDesign, trimmedName);
      if (newPair !== oldPair && merged.mdMap.has(newPair)) {
        showMessage(`Model "${trimmedName}" already exists under "${targetDesign}".`, 'bad');
        return;
      }
      const ok = await catalogHandlers.onRenameModel(
        existing.id,
        existing.design,
        existing.name,
        targetDesign,
        trimmedName,
      );
      if (ok) {
        setEditing(null);
        showMessage('Model number updated across list and records.', 'ok');
      }
    }
  };

  // --- Delete ---
  const handleDeleteClick = async (
    deleteKey: string,
    kind: 'salesperson' | 'design' | 'model',
    id: string,
    name: string,
    design?: string,
  ) => {
    if (!isSheetConnected) {
      if (armedDeleteKey !== deleteKey) {
        if (armTimerRef.current) window.clearTimeout(armTimerRef.current);
        setArmedDeleteKey(deleteKey);
        armTimerRef.current = window.setTimeout(() => {
          setArmedDeleteKey((cur) => (cur === deleteKey ? null : cur));
        }, 4000);
        return;
      }
      if (armTimerRef.current) window.clearTimeout(armTimerRef.current);
      setArmedDeleteKey(null);
    }

    if (kind === 'salesperson') {
      const key = nk(name);
      if (data.samples.some((r) => nk(r.salesperson) === key)) {
        showMessage('Records still use this salesperson. Edit it instead or delete those records first.', 'bad');
        return;
      }
      const ok = await catalogHandlers.onDeleteCatalogItem('salesperson', id, name);
      if (ok) showMessage('Salesperson deleted.', 'ok');
      return;
    }

    if (kind === 'design') {
      const key = nk(name);
      if (merged.models.some((m) => nk(m.design) === key)) {
        showMessage('Delete or move this design’s model numbers first.', 'bad');
        return;
      }
      if (data.samples.some((r) => nk(r.design) === key)) {
        showMessage('Records still use this design. Edit it instead or delete those records first.', 'bad');
        return;
      }
      const ok = await catalogHandlers.onDeleteCatalogItem('design', id, name);
      if (ok) showMessage('Design deleted.', 'ok');
      return;
    }

    const pair = mk(design, name);
    if (data.samples.some((r) => mk(r.design, r.item) === pair)) {
      showMessage('Records still use this model number. Edit it instead or delete those records first.', 'bad');
      return;
    }
    const ok = await catalogHandlers.onDeleteCatalogItem(
      'model',
      id,
      design ? `${name} (${design})` : name,
    );
    if (ok) showMessage('Model number deleted.', 'ok');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBackToRecords}
            className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer mb-1 inline-block"
          >
            ← Back to records
          </button>
          <h1 className="text-xl font-bold text-slate-900">Manage Lists</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Add, edit, rename, reassign, or remove salespeople, designs, and model numbers. Edits automatically update linked records.
          </p>
        </div>
      </div>

      {merged.missingCount > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-blue-900 font-medium">
            {merged.missingCount} item(s) found in sample records are not in your editable lists yet.
          </p>
          <button
            type="button"
            onClick={handleImportAll}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors cursor-pointer"
          >
            Import all into lists
          </button>
        </div>
      )}

      {feedback && (
        <div
          className={`px-4 py-2.5 rounded-lg border text-xs font-semibold ${
            feedback.tone === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* 1. Salespeople */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Salespeople</h2>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {merged.salespeople.length} total
          </span>
        </div>

        <div className="flex border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-600">
          <input
            type="text"
            value={newSp}
            onChange={(e) => setNewSp(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddSalesperson();
              }
            }}
            placeholder="New salesperson name"
            className="flex-1 px-3 py-2 text-sm bg-white border-0 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddSalesperson}
            className="px-4 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border-l border-slate-200 cursor-pointer whitespace-nowrap"
          >
            ＋ Add
          </button>
        </div>

        {merged.salespeople.length === 0 ? (
          <p className="text-xs text-slate-500 py-2">No salespeople yet.</p>
        ) : (
          <div className="divide-y divide-slate-200 border-t border-slate-200">
            {merged.salespeople.map((sp) => {
              const isEditing = editing?.kind === 'salesperson' && editing.id === sp.item?.id;
              const delKey = `sp:${sp.key}`;

              if (isEditing && editing?.kind === 'salesperson') {
                return (
                  <div key={sp.key} className="py-2.5 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      autoFocus
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveEdit();
                        } else if (e.key === 'Escape') {
                          setEditing(null);
                        }
                      }}
                      className="flex-1 min-w-[180px] px-2.5 py-1.5 text-sm bg-white border border-blue-500 rounded-lg focus:outline-none"
                    />
                    {sp.recordCount > 0 && (
                      <span className="text-xs text-slate-500">
                        Updates {sp.recordCount} record{sp.recordCount === 1 ? '' : 's'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={saveEdit}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                );
              }

              return (
                <div key={sp.key} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-semibold text-slate-900">{sp.name}</span>
                    <span className="text-xs text-slate-500 font-mono tabular-nums">
                      {sp.recordCount} record{sp.recordCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {sp.item ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setEditing({ kind: 'salesperson', id: sp.item!.id, name: sp.name })
                          }
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteClick(delKey, 'salesperson', sp.item!.id, sp.name)
                          }
                          className={`text-xs cursor-pointer ${
                            armedDeleteKey === delKey
                              ? 'font-bold text-rose-700'
                              : 'font-medium text-rose-600 hover:text-rose-700'
                          }`}
                        >
                          {armedDeleteKey === delKey ? 'Tap again to delete' : 'Delete'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await catalogHandlers.onAddSalesperson({
                            id: uid('sp'),
                            name: sp.name,
                            ts: Date.now(),
                          });
                          if (ok) showMessage(`Imported "${sp.name}" for editing.`, 'ok');
                        }}
                        className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                      >
                        Import to edit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 2. Designs */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Designs</h2>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {merged.designs.length} total
          </span>
        </div>

        <div className="flex border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-600">
          <input
            type="text"
            value={newDesign}
            onChange={(e) => setNewDesign(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddDesign();
              }
            }}
            placeholder="New design name"
            className="flex-1 px-3 py-2 text-sm bg-white border-0 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddDesign}
            className="px-4 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border-l border-slate-200 cursor-pointer whitespace-nowrap"
          >
            ＋ Add
          </button>
        </div>

        {merged.designs.length === 0 ? (
          <p className="text-xs text-slate-500 py-2">No designs yet.</p>
        ) : (
          <div className="divide-y divide-slate-200 border-t border-slate-200">
            {merged.designs.map((dn) => {
              const isEditing = editing?.kind === 'design' && editing.id === dn.item?.id;
              const delKey = `dn:${dn.key}`;

              if (isEditing && editing?.kind === 'design') {
                return (
                  <div key={dn.key} className="py-2.5 flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      autoFocus
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveEdit();
                        } else if (e.key === 'Escape') {
                          setEditing(null);
                        }
                      }}
                      className="flex-1 min-w-[180px] px-2.5 py-1.5 text-sm bg-white border border-blue-500 rounded-lg focus:outline-none"
                    />
                    {(dn.modelCount > 0 || dn.recordCount > 0) && (
                      <span className="text-xs text-slate-500">
                        Updates {dn.modelCount} model{dn.modelCount === 1 ? '' : 's'} · {dn.recordCount} record{dn.recordCount === 1 ? '' : 's'}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={saveEdit}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                );
              }

              return (
                <div key={dn.key} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-sm font-semibold text-slate-900">{dn.name}</span>
                    <span className="text-xs text-slate-500 font-mono tabular-nums">
                      {dn.modelCount} model{dn.modelCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {dn.item ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setEditing({ kind: 'design', id: dn.item!.id, name: dn.name })
                          }
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteClick(delKey, 'design', dn.item!.id, dn.name)
                          }
                          className={`text-xs cursor-pointer ${
                            armedDeleteKey === delKey
                              ? 'font-bold text-rose-700'
                              : 'font-medium text-rose-600 hover:text-rose-700'
                          }`}
                        >
                          {armedDeleteKey === delKey ? 'Tap again to delete' : 'Delete'}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await catalogHandlers.onAddDesign({
                            id: uid('dn'),
                            name: dn.name,
                            ts: Date.now(),
                          });
                          if (ok) showMessage(`Imported "${dn.name}" for editing.`, 'ok');
                        }}
                        className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                      >
                        Import to edit
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. Model Numbers */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Model Numbers</h2>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            {merged.models.length} total
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
          <div className="sm:col-span-5">
            <label htmlFor="m-md" className="block text-xs font-medium text-slate-700 mb-1">
              Under design
            </label>
            <select
              id="m-md"
              value={effectiveNewModelDesign}
              onChange={(e) => setNewModelDesign(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">Select design…</option>
              {merged.designs.map((d) => (
                <option key={d.key} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-7">
            <label htmlFor="m-m" className="block text-xs font-medium text-slate-700 mb-1">
              Model number
            </label>
            <div className="flex border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-600">
              <input
                id="m-m"
                type="text"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddModel();
                  }
                }}
                placeholder="New model number"
                className="flex-1 px-3 py-2 text-sm bg-white border-0 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddModel}
                className="px-4 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border-l border-slate-200 cursor-pointer whitespace-nowrap"
              >
                ＋ Add
              </button>
            </div>
          </div>
        </div>

        {merged.models.length === 0 ? (
          <p className="text-xs text-slate-500 py-2">No model numbers yet.</p>
        ) : (
          <div className="space-y-4 pt-1">
            {merged.designs.map((dn) => {
              const groupModels = merged.models.filter((m) => nk(m.design) === dn.key);
              if (groupModels.length === 0) return null;
              return (
                <div key={dn.key} className="space-y-1">
                  <div className="text-xs font-bold text-slate-700 uppercase tracking-wider pt-2">
                    {dn.name}
                  </div>
                  <div className="divide-y divide-slate-200 border-t border-slate-200">
                    {groupModels.map((md) => {
                      const isEditing = editing?.kind === 'model' && editing.id === md.item?.id;
                      const delKey = `md:${md.key}`;

                      if (isEditing && editing?.kind === 'model') {
                        return (
                          <div key={md.key} className="py-2.5 flex flex-wrap items-center gap-2">
                            <input
                              type="text"
                              autoFocus
                              value={editing.name}
                              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  saveEdit();
                                } else if (e.key === 'Escape') {
                                  setEditing(null);
                                }
                              }}
                              placeholder="Model number"
                              className="flex-1 min-w-[140px] px-2.5 py-1.5 text-sm bg-white border border-blue-500 rounded-lg focus:outline-none"
                            />
                            <select
                              value={editing.design}
                              onChange={(e) => setEditing({ ...editing, design: e.target.value })}
                              className="px-2.5 py-1.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none"
                            >
                              {merged.designs.map((optD) => (
                                <option key={optD.key} value={optD.name}>
                                  {optD.name}
                                </option>
                              ))}
                            </select>
                            {md.recordCount > 0 && (
                              <span className="text-xs text-slate-500">
                                Updates {md.recordCount} record{md.recordCount === 1 ? '' : 's'}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={saveEdit}
                              className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-md cursor-pointer"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={md.key}
                          className="py-2.5 flex flex-wrap items-center justify-between gap-2"
                        >
                          <div className="flex items-baseline gap-2 min-w-0">
                            <span className="text-sm font-semibold text-slate-900">{md.name}</span>
                            <span className="text-xs text-slate-500 font-mono tabular-nums">
                              {md.recordCount} record{md.recordCount === 1 ? '' : 's'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {md.item ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditing({
                                      kind: 'model',
                                      id: md.item!.id,
                                      name: md.name,
                                      design: md.design,
                                    })
                                  }
                                  className="text-xs font-medium text-blue-600 hover:text-blue-800 cursor-pointer"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteClick(
                                      delKey,
                                      'model',
                                      md.item!.id,
                                      md.name,
                                      md.design,
                                    )
                                  }
                                  className={`text-xs cursor-pointer ${
                                    armedDeleteKey === delKey
                                      ? 'font-bold text-rose-700'
                                      : 'font-medium text-rose-600 hover:text-rose-700'
                                  }`}
                                >
                                  {armedDeleteKey === delKey ? 'Tap again to delete' : 'Delete'}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={async () => {
                                  const ok = await catalogHandlers.onAddModel({
                                    id: uid('md'),
                                    name: md.name,
                                    design: md.design,
                                    ts: Date.now(),
                                  });
                                  if (ok) showMessage(`Imported "${md.name}" for editing.`, 'ok');
                                }}
                                className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                              >
                                Import to edit
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
