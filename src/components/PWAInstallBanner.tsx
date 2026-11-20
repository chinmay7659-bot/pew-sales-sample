import { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export default function PWAInstallBanner() {
  const { isInstallable, isInstalled, isIOS, isOnline, install } = usePWAInstall();
  const [showApkGuide, setShowApkGuide] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled && isOnline) {
    return null;
  }

  return (
    <div className="mb-5 space-y-2">
      {!isOnline && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs font-semibold text-amber-800">
          Offline mode — local browser storage is active and works without internet.
        </div>
      )}

      {!isInstalled && (
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <img
              src="/icon.svg"
              alt="pew sales-sample icon"
              className="w-8 h-8 rounded-lg shrink-0"
            />
            <div>
              <span className="font-semibold text-slate-900">pew sales-sample:</span>{' '}
              {isInstallable
                ? 'Install directly onto your Android home screen for offline app use.'
                : isIOS
                  ? 'Add to your iPhone Home Screen via Safari for full-screen offline use.'
                  : 'Open this app URL in Android Chrome to install directly onto your phone, or build pew-sales-sample.apk via GitHub Actions.'}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isInstallable && (
              <button
                type="button"
                onClick={install}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                Install App
              </button>
            )}

            {isIOS && (
              <button
                type="button"
                onClick={() => setShowIOSGuide(true)}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                Install on iPhone
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowApkGuide((v) => !v)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              {showApkGuide ? 'Hide .apk steps' : 'How to get .apk'}
            </button>
          </div>
        </div>
      )}

      {showApkGuide && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-700 space-y-2">
          <div className="font-semibold text-slate-900">
            Building pew-sales-sample.apk
          </div>
          <p className="leading-relaxed text-slate-600">
            This cloud workspace does not include the Android SDK or Java JDK required to compile a native{' '}
            <code className="font-mono text-slate-800">.apk</code> binary on the spot. You have two direct options:
          </p>
          <ol className="list-decimal pl-5 space-y-1 text-slate-600">
            <li>
              <strong>Fastest (no build):</strong> Open the Shared App URL on Android Chrome and tap{' '}
              <strong>Install App</strong> (or Chrome menu → <strong>Add to Home screen</strong>). It installs as <strong>pew sales</strong> with the gold eyeglasses icon and runs offline.
            </li>
            <li>
              <strong>Generate pew-sales-sample.apk without Android Studio:</strong> Export this project to GitHub (or download the ZIP and push it), then open the <strong>Actions</strong> tab and run <strong>Build Direct Android APK</strong> (<code className="font-mono">.github/workflows/android-apk.yml</code>). Download <code className="font-mono">pew-sales-sample.apk</code> from the completed workflow run and install it on your Android phone.
            </li>
          </ol>
        </div>
      )}

      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white border border-slate-200 p-5 space-y-3">
            <h3 className="text-base font-bold text-slate-900">Install on iPhone / iPad</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              1. Tap the <strong>Share</strong> icon in Safari&apos;s toolbar.
              <br />
              2. Scroll down and tap <strong>Add to Home Screen</strong>.
            </p>
            <button
              type="button"
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
