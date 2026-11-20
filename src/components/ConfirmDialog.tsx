export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<void> | void;
}

interface ConfirmDialogProps {
  request: ConfirmRequest | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function ConfirmDialog({
  request,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!request) return null;

  const isDanger = request.tone === 'danger';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white border border-slate-200 shadow-xl p-5 space-y-4">
        <div className="space-y-1.5">
          <h3 id="confirm-dialog-title" className="text-base font-bold text-slate-900">
            {request.title}
          </h3>
          <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
            {request.description}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`px-4 py-2 text-xs font-semibold text-white rounded-lg cursor-pointer disabled:opacity-50 ${
              isDanger
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {busy ? 'Saving…' : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
