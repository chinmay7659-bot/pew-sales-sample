import { useMemo, useState } from 'react';
import { AppData, SampleRecord, SampleStatus } from '../types';
import { ci, computeHeldQty, localToday, mk, nk, uid } from '../utils';

interface NewRecordCardProps {
  data: AppData;
  onAddRecord: (record: SampleRecord) => Promise<boolean> | boolean;
  onNavigateManage: () => void;
}

const STATUS_OPTIONS: SampleStatus[] = ['Sent', 'Returned', 'Converted to sale'];

export default function NewRecordCard({
  data,
  onAddRecord,
  onNavigateManage,
}: NewRecordCardProps) {
  const [salesperson, setSalesperson] = useState('');
  const [date, setDate] = useState(localToday);
  const [design, setDesign] = useState('');
  const [model, setModel] = useState('');
  const [qtyInput, setQtyInput] = useState('1');
  const [traysInput, setTraysInput] = useState('');
  const [status, setStatus] = useState<SampleStatus>('Sent');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);

  const salespeopleOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data.samples) {
      const k = nk(s.salesperson);
      if (k && !map.has(k)) map.set(k, s.salesperson.trim());
    }
    for (const sp of data.salespeople) {
      const k = nk(sp.name);
      if (k) map.set(k, sp.name);
    }
    return Array.from(map.values()).sort(ci);
  }, [data.salespeople, data.samples]);

  const designOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data.samples) {
      const k = nk(s.design);
      if (k && !map.has(k)) map.set(k, s.design.trim());
    }
    for (const m of data.models) {
      const k = nk(m.design);
      if (k && !map.has(k)) map.set(k, m.design.trim());
    }
    for (const d of data.designs) {
      const k = nk(d.name);
      if (k) map.set(k, d.name);
    }
    return Array.from(map.values()).sort(ci);
  }, [data.designs, data.models, data.samples]);

  const modelOptions = useMemo(() => {
    const dk = nk(design);
    if (!dk) return [];
    const map = new Map<string, string>();
    for (const s of data.samples) {
      if (nk(s.design) === dk && nk(s.item)) {
        const key = mk(s.design, s.item);
        if (!map.has(key)) map.set(key, s.item.trim());
      }
    }
    for (const m of data.models) {
      if (nk(m.design) === dk && nk(m.name)) {
        map.set(mk(m.design, m.name), m.name);
      }
    }
    return Array.from(map.values()).sort(ci);
  }, [design, data.models, data.samples]);

  const effectiveSalesperson = salespeopleOptions.includes(salesperson) ? salesperson : '';
  const effectiveDesign = designOptions.includes(design) ? design : '';
  const effectiveModel = modelOptions.includes(model) ? model : '';

  const currentHeld = useMemo(() => {
    if (!effectiveSalesperson || !effectiveDesign || !effectiveModel) return null;
    return computeHeldQty(data.samples, effectiveSalesperson, effectiveDesign, effectiveModel);
  }, [data.samples, effectiveSalesperson, effectiveDesign, effectiveModel]);

  const stepValue = (current: string, delta: number, min: number) => {
    const parsed = parseInt(current, 10);
    const base = Number.isNaN(parsed) ? 0 : parsed;
    return String(Math.max(min, base + delta));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveSalesperson || !effectiveDesign || !effectiveModel || !date) {
      setFeedback({
        text: 'Please choose salesperson, date, design, and model number.',
        tone: 'bad',
      });
      return;
    }

    const trimmedQty = qtyInput.trim();
    const qty = Number(trimmedQty);
    if (!trimmedQty || !Number.isInteger(qty) || qty < 1) {
      setFeedback({
        text: 'Quantity must be a whole number of 1 or more.',
        tone: 'bad',
      });
      return;
    }

    const trimmedTrays = traysInput.trim();
    const trays = trimmedTrays === '' ? null : Number(trimmedTrays);
    if (trays !== null && (!Number.isInteger(trays) || trays < 0)) {
      setFeedback({
        text: 'No. of trays must be a whole number of 0 or more.',
        tone: 'bad',
      });
      return;
    }

    if (status === 'Returned' || status === 'Converted to sale') {
      const held = computeHeldQty(
        data.samples,
        effectiveSalesperson,
        effectiveDesign,
        effectiveModel,
      );
      if (qty > held) {
        setFeedback({
          text: `Cannot mark ${qty} as ${status.toLowerCase()}: ${effectiveSalesperson} currently holds ${held} unit(s) of ${effectiveModel} (${effectiveDesign}).`,
          tone: 'bad',
        });
        return;
      }
    }

    setSaving(true);
    try {
      const saved = await onAddRecord({
        id: uid('rec'),
        date,
        salesperson: effectiveSalesperson,
        design: effectiveDesign,
        item: effectiveModel,
        qty,
        trays,
        status,
        notes: notes.trim(),
        ts: Date.now(),
      });

      if (!saved) return;

      setModel('');
      setQtyInput('1');
      setTraysInput('');
      setNotes('');
      setFeedback({ text: 'Record saved', tone: 'ok' });
      setTimeout(() => {
        setFeedback((cur) => (cur?.text === 'Record saved' ? null : cur));
      }, 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-slate-900">New Record</h2>
        {currentHeld !== null && (
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            Held by {effectiveSalesperson}: {currentHeld} unit{currentHeld === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* Section 1: Who & when */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3.5 space-y-2.5">
        <div className="text-xs font-semibold text-blue-700">1. Who and when</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-sp" className="block text-xs font-medium text-slate-700 mb-1">
              Salesperson <span className="text-slate-400 font-normal">(required)</span>
            </label>
            <select
              id="f-sp"
              value={effectiveSalesperson}
              onChange={(e) => setSalesperson(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
            >
              <option value="">Select salesperson…</option>
              {salespeopleOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-date" className="block text-xs font-medium text-slate-700 mb-1">
              Date
            </label>
            <input
              id="f-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent font-mono tabular-nums"
            />
          </div>
        </div>
      </div>

      {/* Section 2: What was given */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3.5 space-y-2.5">
        <div className="text-xs font-semibold text-blue-700">2. What was given</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-design" className="block text-xs font-medium text-slate-700 mb-1">
              Design <span className="text-slate-400 font-normal">(required)</span>
            </label>
            <select
              id="f-design"
              value={effectiveDesign}
              onChange={(e) => {
                setDesign(e.target.value);
                setModel('');
              }}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
            >
              <option value="">Select design…</option>
              {designOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="f-item" className="block text-xs font-medium text-slate-700 mb-1">
              Model number <span className="text-slate-400 font-normal">(required)</span>
            </label>
            <select
              id="f-item"
              value={effectiveModel}
              onChange={(e) => setModel(e.target.value)}
              disabled={!effectiveDesign}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">
                {effectiveDesign ? 'Select model number…' : 'Choose a design first'}
              </option>
              {modelOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {designOptions.length === 0 && (
          <p className="text-xs text-slate-500">
            No designs available yet.{' '}
            <button
              type="button"
              onClick={onNavigateManage}
              className="text-blue-600 font-semibold hover:underline cursor-pointer"
            >
              Add them in Manage Lists
            </button>
            .
          </p>
        )}
      </div>

      {/* Section 3: How many */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3.5 space-y-2.5">
        <div className="text-xs font-semibold text-blue-700">3. How many</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-qty" className="block text-xs font-medium text-slate-700 mb-1">
              Quantity <span className="text-slate-400 font-normal">(required)</span>
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => setQtyInput((v) => stepValue(v, -1, 1))}
                className="w-10 h-10 bg-white border border-slate-300 rounded-lg text-lg font-medium text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
              >
                −
              </button>
              <input
                id="f-qty"
                type="number"
                min={1}
                step={1}
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                className="w-full h-10 px-3 text-center text-sm font-semibold font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              />
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => setQtyInput((v) => stepValue(v, 1, 1))}
                className="w-10 h-10 bg-white border border-slate-300 rounded-lg text-lg font-medium text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
              >
                +
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="f-trays" className="block text-xs font-medium text-slate-700 mb-1">
              No. of trays <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Decrease trays"
                onClick={() => setTraysInput((v) => stepValue(v, -1, 0))}
                className="w-10 h-10 bg-white border border-slate-300 rounded-lg text-lg font-medium text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
              >
                −
              </button>
              <input
                id="f-trays"
                type="number"
                min={0}
                step={1}
                placeholder="0"
                value={traysInput}
                onChange={(e) => setTraysInput(e.target.value)}
                className="w-full h-10 px-3 text-center text-sm font-semibold font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              />
              <button
                type="button"
                aria-label="Increase trays"
                onClick={() => setTraysInput((v) => stepValue(v, 1, 0))}
                className="w-10 h-10 bg-white border border-slate-300 rounded-lg text-lg font-medium text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Status */}
      <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-3.5 space-y-2.5">
        <div className="text-xs font-semibold text-blue-700">4. Status</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {STATUS_OPTIONS.map((opt) => {
            const active = status === opt;
            const activeClasses =
              opt === 'Sent'
                ? 'bg-blue-50 text-blue-800 border-blue-600'
                : opt === 'Returned'
                  ? 'bg-amber-50 text-amber-800 border-amber-600'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-600';
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setStatus(opt)}
                className={`px-3 py-2 text-xs font-semibold rounded-lg border-2 transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? activeClasses
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="f-note" className="block text-xs font-medium text-slate-700 mb-1">
          Notes <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          id="f-note"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything worth remembering"
          className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save record'}
        </button>
        {feedback && (
          <p
            className={`text-xs font-semibold ${
              feedback.tone === 'ok' ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {feedback.text}
          </p>
        )}
      </div>
    </form>
  );
}
