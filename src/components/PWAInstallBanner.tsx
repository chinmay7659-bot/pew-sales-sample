import { usePWAInstall } from '../hooks/usePWAInstall';

export default function PWAInstallBanner() {
  const { isOnline } = usePWAInstall();

  if (isOnline) {
    return null;
  }

  return (
    <div className="mb-5">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-amber-800">
        Offline mode — local browser storage is active and works without internet.
      </div>
    </div>
  );
}
