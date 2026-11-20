import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { Check, ChevronDown, ChevronUp, Copy, ExternalLink, Link2, LogOut, Plus, RefreshCw, Sheet } from 'lucide-react';
import { APPS_SCRIPT_TEMPLATE } from '../googleSheetsBridge';
import { extractSpreadsheetId } from '../utils';

interface GoogleSheetsPanelProps {
  user: User | null;
  hasToken: boolean;
  authBusy: boolean;
  spreadsheetId: string | null;
  bridgeUrl: string | null;
  memberName: string;
  spreadsheetTitle: string | null;
  syncing: boolean;
  lastSyncedAt: number | null;
  sheetError: string | null;
  onSignIn: () => void;
  onSignOut: () => void;
  onConnectSheet: (spreadsheetId: string) => void;
  onCreateSheet: (seedCurrentData: boolean) => void;
  onDisconnectSheet: () => void;
  onConnectBridge: (bridgeUrl: string) => void;
  onDisconnectBridge: () => void;
  onUpdateMemberName: (name: string) => void;
  onRefresh: () => void;
}

export default function GoogleSheetsPanel({
  user,
  hasToken,
  authBusy,
  spreadsheetId,
  bridgeUrl,
  memberName,
  spreadsheetTitle,
  syncing,
  lastSyncedAt,
  sheetError,
  onSignIn,
  onSignOut,
  onConnectSheet,
  onCreateSheet,
  onDisconnectSheet,
  onConnectBridge,
  onDisconnectBridge,
  onUpdateMemberName,
  onRefresh,
}: GoogleSheetsPanelProps) {
  const [sheetInput, setSheetInput] = useState(spreadsheetId ?? '');
  const [bridgeInput, setBridgeInput] = useState(bridgeUrl ?? '');
  const [nameInput, setNameInput] = useState(memberName);
  const [methodTab, setMethodTab] = useState<'bridge' | 'oauth'>(bridgeUrl ? 'bridge' : 'oauth');
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [changingSheet, setChangingSheet] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    setBridgeInput(bridgeUrl ?? '');
    if (bridgeUrl) setMethodTab('bridge');
  }, [bridgeUrl]);

  useEffect(() => {
    setNameInput(memberName);
  }, [memberName]);

  const isBridgeActive = Boolean(bridgeUrl);
  const isOAuthActive = Boolean(hasToken && spreadsheetId);
  const isConnected = isBridgeActive || isOAuthActive;

  const handleConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = extractSpreadsheetId(sheetInput);
    if (!id) return;
    setChangingSheet(false);
    onConnectSheet(id);
  };

  const handleBridgeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = bridgeInput.trim();
    if (!cleaned) return;
    setChangingSheet(false);
    onConnectBridge(cleaned);
  };

  const handleCopyTeamLink = async () => {
    const url = new URL(`${window.location.origin}${window.location.pathname}`);
    if (isBridgeActive && bridgeUrl) {
      url.searchParams.set('bridge', bridgeUrl);
    } else if (spreadsheetId) {
      url.searchParams.set('sheet', spreadsheetId);
    } else {
      return;
    }

    try {
      await navigator.clipboard.writeText(url.toString());
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      setCopiedLink(false);
    }
  };

  const handleCopyAppsScript = async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_TEMPLATE);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      setCopiedCode(false);
    }
  };

  const formattedSyncTime = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <section className="mb-5 bg-white border border-slate-200 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
            <Sheet className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">
              {isConnected
                ? spreadsheetTitle || 'Shared Google Sheet'
                : 'Team Sync via Google Sheets'}
            </div>
            <div className="text-xs text-slate-500 truncate">
              {isBridgeActive
                ? `Synced via Sheet Sync URL (works in APK & outside AI Studio)${
                    formattedSyncTime ? ` · Synced ${formattedSyncTime}` : ''
                  }`
                : isOAuthActive
                  ? `Connected as ${user?.email || user?.displayName || 'Google user'}${
                      formattedSyncTime ? ` · Synced ${formattedSyncTime}` : ''
                    }`
                  : hasToken
                    ? `Signed in as ${user?.email || user?.displayName} — create or link a shared Google Sheet`
                    : 'Connect via Google Sign-In or Sheet Sync URL to share live records with mobile & team'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!isConnected && !hasToken ? (
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMethodTab('oauth')}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  methodTab === 'oauth' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Google Sign-In
              </button>
              <button
                type="button"
                onClick={() => setMethodTab('bridge')}
                className={`px-3 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  methodTab === 'bridge' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Sheet Sync URL (Mobile / APK)
              </button>
            </div>
          ) : null}

          {isConnected ? (
            <>
              <button
                type="button"
                onClick={onRefresh}
                disabled={syncing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>

              <button
                type="button"
                onClick={handleCopyTeamLink}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5" />
                {copiedLink ? 'Team link copied!' : 'Copy Team Link'}
              </button>

              {isOAuthActive && spreadsheetId && (
                <a
                  href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Sheet
                </a>
              )}

              <button
                type="button"
                onClick={() => {
                  if (spreadsheetId) setSheetInput(spreadsheetId);
                  if (bridgeUrl) setBridgeInput(bridgeUrl);
                  setChangingSheet((v) => !v);
                }}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                {changingSheet ? 'Close' : 'Settings'}
              </button>

              {isBridgeActive ? (
                <button
                  type="button"
                  onClick={onDisconnectBridge}
                  className="px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:underline cursor-pointer"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  title="Sign out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              )}
            </>
          ) : hasToken ? (
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          ) : null}
        </div>
      </div>

      {/* Unconnected method: Google Sign-In */}
      {!isConnected && !hasToken && methodTab === 'oauth' && (
        <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-600">
            Sign in with Google to create or open a shared spreadsheet directly in Google Drive.
          </p>
          <button
            type="button"
            onClick={onSignIn}
            disabled={authBusy}
            className="gsi-material-button"
          >
            <div className="gsi-material-button-content-wrapper">
              <div className="gsi-material-button-icon">
                <svg
                  version="1.1"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 48 48"
                  className="block w-full h-full"
                >
                  <path
                    fill="#EA4335"
                    d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                  />
                  <path
                    fill="#34A853"
                    d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                  />
                </svg>
              </div>
              <span>
                {authBusy
                  ? 'Connecting…'
                  : user
                    ? 'Reconnect Google Sheets'
                    : 'Sign in with Google'}
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Bridge Setup / Settings (works on Web outside AI Studio & matches Mobile APK) */}
      {((!isConnected && !hasToken && methodTab === 'bridge') || (isBridgeActive && changingSheet)) && (
        <div className="pt-2 border-t border-slate-200 space-y-2.5">
          <form onSubmit={handleBridgeSubmit} className="flex flex-wrap items-center gap-2">
            <input
              type="url"
              value={bridgeInput}
              onChange={(e) => setBridgeInput(e.target.value)}
              placeholder="Paste Google Apps Script Web App URL (https://script.google.com/macros/s/.../exec)"
              className="flex-1 min-w-[260px] px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={() => onUpdateMemberName(nameInput.trim())}
              placeholder="Your name (optional)"
              className="w-40 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="submit"
              disabled={!bridgeInput.trim() || syncing}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {syncing ? 'Connecting…' : 'Connect & Sync'}
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <button
              type="button"
              onClick={() => setShowGuide((v) => !v)}
              className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline cursor-pointer"
            >
              {showGuide ? 'Hide 2-minute Google Sheet setup' : 'How to create your free Sheet Sync URL (for Mobile APK + Web)'}
              {showGuide ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              onClick={handleCopyAppsScript}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedCode ? 'Apps Script copied!' : 'Copy Apps Script Code'}
            </button>
          </div>

          {showGuide && (
            <ol className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1 list-decimal list-inside">
              <li>Open a Google Sheet (<code className="font-mono">sheets.new</code>) and go to <strong>Extensions → Apps Script</strong>.</li>
              <li>Click <strong>Copy Apps Script Code</strong> above, replace the editor contents, and save.</li>
              <li>Click <strong>Deploy → New deployment → Web app</strong>. Set <em>Execute as</em> to <strong>Me</strong> and <em>Who has access</em> to <strong>Anyone</strong>, then click Deploy.</li>
              <li>Paste the <code className="font-mono">/exec</code> URL above (or in the mobile app’s <strong>Sheet Sync</strong> tab) so Mobile APK and Web stay synced.</li>
            </ol>
          )}
        </div>
      )}

      {/* OAuth Sheet Linker / Switcher */}
      {hasToken && !isBridgeActive && (!spreadsheetId || changingSheet) && (
        <div className="pt-2 border-t border-slate-200 space-y-2.5">
          <form onSubmit={handleConnectSubmit} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={sheetInput}
              onChange={(e) => setSheetInput(e.target.value)}
              placeholder="Paste shared Google Sheet URL or Spreadsheet ID…"
              className="flex-1 min-w-[240px] px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="submit"
              disabled={!sheetInput.trim() || syncing}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-50"
            >
              Connect Sheet
            </button>
            <button
              type="button"
              disabled={syncing}
              onClick={() => onCreateSheet(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              Create New Shared Sheet
            </button>
            {spreadsheetId && changingSheet && (
              <button
                type="button"
                onClick={() => {
                  setChangingSheet(false);
                  onDisconnectSheet();
                }}
                className="px-3 py-2 text-xs font-medium text-rose-700 hover:underline cursor-pointer"
              >
                Use local mode
              </button>
            )}
          </form>
          <p className="text-[11px] text-slate-500">
            Tip: After creating a new sheet, click <strong>Open Sheet</strong> and share it as <strong>Editor</strong> with your 20 team members, then share the <strong>Copy Team Link</strong> URL with them.
          </p>
        </div>
      )}

      {sheetError && (
        <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800">
          {sheetError}
        </div>
      )}
    </section>
  );
}
