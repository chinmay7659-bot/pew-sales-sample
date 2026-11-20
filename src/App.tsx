import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import ConfirmDialog, { ConfirmRequest } from './components/ConfirmDialog';
import GoogleSheetsPanel from './components/GoogleSheetsPanel';
import ManageListsView, { CatalogHandlers } from './components/ManageListsView';
import PWAInstallBanner from './components/PWAInstallBanner';
import RecordsView from './components/RecordsView';
import {
  clearAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from './firebaseAuth';
import {
  appendCatalogEntriesToSheet,
  appendSampleToSheet,
  createStockSpreadsheet,
  deleteCatalogItemFromSheet,
  deleteSampleFromSheet,
  ensureSheetTabs,
  fetchSheetAppData,
  renameDesignInSheet,
  renameModelInSheet,
  renameSalespersonInSheet,
  SheetsApiError,
  updateSampleInSheet,
} from './googleSheets';
import { webBridgeApi } from './googleSheetsBridge';
import { createStarterData, loadAppData, saveAppData } from './storage';
import { AppData, DesignItem, ModelItem, SalespersonItem, SampleRecord } from './types';
import { buildCsvContent, downloadCsvFile, mk, nk } from './utils';

type ActiveView = 'records' | 'manage';

const SHEET_ID_STORAGE_KEY = 'sample_stock_log_sheet_id_v1';
const BRIDGE_URL_STORAGE_KEY = 'sample_stock_log_bridge_url_v1';
const MEMBER_NAME_STORAGE_KEY = 'sample_stock_log_member_name_v1';
const AUTO_SYNC_MS = 12000;

function viewFromHash(): ActiveView {
  return window.location.hash === '#manage' ? 'manage' : 'records';
}

function initialSpreadsheetId(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('sheet')?.trim();
  if (fromUrl) {
    try {
      localStorage.setItem(SHEET_ID_STORAGE_KEY, fromUrl);
    } catch {
      // Ignore storage error
    }
    return fromUrl;
  }
  try {
    return localStorage.getItem(SHEET_ID_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function initialBridgeUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('bridge')?.trim();
  if (fromUrl) {
    try {
      localStorage.setItem(BRIDGE_URL_STORAGE_KEY, fromUrl);
    } catch {
      // Ignore storage error
    }
    return fromUrl;
  }
  if (params.get('sheet')?.trim()) {
    return null;
  }
  try {
    return localStorage.getItem(BRIDGE_URL_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function initialMemberName(): string {
  try {
    return localStorage.getItem(MEMBER_NAME_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export default function App() {
  const [data, setData] = useState<AppData>(() => loadAppData());
  const [view, setView] = useState<ActiveView>(() => viewFromHash());

  // Google Auth + Sheets sync state
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(() => initialSpreadsheetId());
  const [bridgeUrl, setBridgeUrl] = useState<string | null>(() => initialBridgeUrl());
  const [memberName, setMemberName] = useState<string>(() => initialMemberName());
  const [spreadsheetTitle, setSpreadsheetTitle] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);

  // Confirmation modal state
  const [confirmState, setConfirmState] = useState<{
    request: ConfirmRequest;
    resolve: (confirmed: boolean) => void;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const isBridgeConnected = Boolean(bridgeUrl);
  const isOAuthConnected = Boolean(!bridgeUrl && accessToken && spreadsheetId);
  const isSheetConnected = isBridgeConnected || isOAuthConnected;
  const confirmOpenRef = useRef(false);
  confirmOpenRef.current = Boolean(confirmState);

  // Persist local fallback data only when not in active sheet mode
  useEffect(() => {
    if (!isSheetConnected) {
      saveAppData(data);
    }
  }, [data, isSheetConnected]);

  useEffect(() => {
    const onHashChange = () => {
      setView(viewFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser, token) => {
        setUser(authedUser);
        setAccessToken(token);
        setSheetError(null);
      },
      (maybeUser) => {
        setUser(maybeUser);
        setAccessToken(null);
      },
    );
    return unsubscribe;
  }, []);

  const persistSpreadsheetId = useCallback((id: string | null) => {
    setSpreadsheetId(id);
    try {
      if (id) {
        localStorage.setItem(SHEET_ID_STORAGE_KEY, id);
      } else {
        localStorage.removeItem(SHEET_ID_STORAGE_KEY);
      }
    } catch {
      // Ignore storage error
    }
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set('sheet', id);
    } else {
      url.searchParams.delete('sheet');
    }
    window.history.replaceState(null, '', url.toString());
  }, []);

  const persistBridgeUrl = useCallback((nextUrl: string | null) => {
    setBridgeUrl(nextUrl);
    try {
      if (nextUrl) {
        localStorage.setItem(BRIDGE_URL_STORAGE_KEY, nextUrl);
      } else {
        localStorage.removeItem(BRIDGE_URL_STORAGE_KEY);
      }
    } catch {
      // Ignore storage error
    }
    const url = new URL(window.location.href);
    if (nextUrl) {
      url.searchParams.set('bridge', nextUrl);
    } else {
      url.searchParams.delete('bridge');
    }
    window.history.replaceState(null, '', url.toString());
  }, []);

  const handleUpdateMemberName = useCallback((name: string) => {
    setMemberName(name);
    try {
      if (name) {
        localStorage.setItem(MEMBER_NAME_STORAGE_KEY, name);
      } else {
        localStorage.removeItem(MEMBER_NAME_STORAGE_KEY);
      }
    } catch {
      // Ignore storage error
    }
  }, []);

  const handleApiError = useCallback((err: unknown) => {
    if (err instanceof SheetsApiError && err.status === 401) {
      clearAccessToken();
      setAccessToken(null);
    }
    const msg = err instanceof Error ? err.message : 'Google Sheets request failed.';
    setSheetError(msg);
  }, []);

  const syncFromBridge = useCallback(
    async (targetUrl: string, seedData?: AppData) => {
      setSyncing(true);
      try {
        const res = seedData
          ? await webBridgeApi.seedIfEmpty(targetUrl, seedData)
          : await webBridgeApi.fetchAll(targetUrl);
        setData(res.data);
        setSpreadsheetTitle(res.title);
        setLastSyncedAt(Date.now());
        setSheetError(null);
      } catch (err) {
        handleApiError(err);
      } finally {
        setSyncing(false);
      }
    },
    [handleApiError],
  );

  const syncFromSheet = useCallback(
    async (targetId: string, token: string, ensureTabs = false) => {
      setSyncing(true);
      try {
        if (ensureTabs) {
          const meta = await ensureSheetTabs(targetId, token);
          setSpreadsheetTitle(meta.title);
        }
        const sheetData = await fetchSheetAppData(targetId, token);
        setData(sheetData);
        setLastSyncedAt(Date.now());
        setSheetError(null);
      } catch (err) {
        handleApiError(err);
      } finally {
        setSyncing(false);
      }
    },
    [handleApiError],
  );

  // Initial sync when bridgeUrl or OAuth token + spreadsheetId are ready
  useEffect(() => {
    if (bridgeUrl) {
      syncFromBridge(bridgeUrl);
      return;
    }
    if (accessToken && spreadsheetId) {
      syncFromSheet(spreadsheetId, accessToken, true);
    }
  }, [accessToken, bridgeUrl, spreadsheetId, syncFromBridge, syncFromSheet]);

  // Background polling so up to 20 remote teammates see updates automatically
  useEffect(() => {
    if (!bridgeUrl && (!accessToken || !spreadsheetId)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (confirmOpenRef.current) return;
      if (bridgeUrl) {
        syncFromBridge(bridgeUrl);
      } else if (accessToken && spreadsheetId) {
        syncFromSheet(spreadsheetId, accessToken, false);
      }
    }, AUTO_SYNC_MS);
    return () => window.clearInterval(timer);
  }, [accessToken, bridgeUrl, spreadsheetId, syncFromBridge, syncFromSheet]);

  const requestConfirm = useCallback((request: ConfirmRequest): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ request, resolve });
    });
  }, []);

  const handleConfirmCancel = () => {
    if (!confirmState || confirmBusy) return;
    confirmState.resolve(false);
    setConfirmState(null);
  };

  const handleConfirmProceed = async () => {
    if (!confirmState || confirmBusy) return;
    setConfirmBusy(true);
    try {
      await confirmState.request.onConfirm();
      confirmState.resolve(true);
      setConfirmState(null);
    } catch (err) {
      handleApiError(err);
      confirmState.resolve(false);
      setConfirmState(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleSignIn = async () => {
    setAuthBusy(true);
    setSheetError(null);
    try {
      const result = await googleSignIn();
      setUser(result.user);
      setAccessToken(result.accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Sign-In failed.';
      setSheetError(msg);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setAccessToken(null);
    setSpreadsheetTitle(null);
    setLastSyncedAt(null);
    setSheetError(null);
    if (!bridgeUrl) {
      setData(loadAppData());
    }
  };

  const handleConnectSheet = useCallback(
    async (id: string) => {
      if (!accessToken) return;
      setSheetError(null);
      persistBridgeUrl(null);
      persistSpreadsheetId(id);
      await syncFromSheet(id, accessToken, true);
    },
    [accessToken, persistBridgeUrl, persistSpreadsheetId, syncFromSheet],
  );

  const handleCreateSheet = useCallback(
    async (seedCurrentData: boolean) => {
      if (!accessToken) return;
      await requestConfirm({
        title: 'Create shared Google Sheet?',
        description: seedCurrentData
          ? 'Create a new Google Sheet named "pew sales-sample — Stock Log" in your Google Drive and copy the current sample records and lists into it?'
          : 'Create a new empty Google Sheet named "pew sales-sample — Stock Log" in your Google Drive?',
        confirmLabel: 'Create Google Sheet',
        onConfirm: async () => {
          const initial = seedCurrentData ? data : undefined;
          const { meta, data: createdData } = await createStockSpreadsheet(
            'pew sales-sample — Stock Log',
            accessToken,
            initial,
          );
          persistBridgeUrl(null);
          setSpreadsheetTitle(meta.title);
          persistSpreadsheetId(meta.spreadsheetId);
          setData(createdData);
          setLastSyncedAt(Date.now());
          setSheetError(null);
        },
      });
    },
    [accessToken, data, persistBridgeUrl, persistSpreadsheetId, requestConfirm],
  );

  const handleDisconnectSheet = useCallback(() => {
    persistSpreadsheetId(null);
    setSpreadsheetTitle(null);
    setLastSyncedAt(null);
    setSheetError(null);
    setData(loadAppData());
  }, [persistSpreadsheetId]);

  const handleConnectBridge = useCallback(
    async (nextUrl: string) => {
      const cleaned = nextUrl.trim();
      if (!/^https?:\/\//i.test(cleaned)) {
        setSheetError('Please paste a valid https://script.google.com/macros/s/.../exec URL.');
        return;
      }
      setSheetError(null);
      persistBridgeUrl(cleaned);
      await syncFromBridge(cleaned, data);
    },
    [data, persistBridgeUrl, syncFromBridge],
  );

  const handleDisconnectBridge = useCallback(() => {
    persistBridgeUrl(null);
    setSpreadsheetTitle(null);
    setLastSyncedAt(null);
    setSheetError(null);
    setData(loadAppData());
  }, [persistBridgeUrl]);

  const navigate = useCallback((next: ActiveView) => {
    setView(next);
    const targetHash = next === 'manage' ? '#manage' : '';
    if (window.location.hash !== targetHash) {
      if (targetHash) {
        window.location.hash = targetHash;
      } else {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
    window.scrollTo(0, 0);
  }, []);

  const actorLabel =
    (isBridgeConnected ? memberName.trim() : '') || user?.displayName || user?.email || undefined;

  const handleAddRecord = useCallback(
    async (record: SampleRecord): Promise<boolean> => {
      const stamped: SampleRecord = actorLabel ? { ...record, by: actorLabel } : record;
      if (!isSheetConnected) {
        setData((prev) => ({
          ...prev,
          samples: [stamped, ...prev.samples],
        }));
        return true;
      }

      return requestConfirm({
        title: 'Save record to Google Sheet?',
        description: `Add "${stamped.salesperson} · ${stamped.item} (${stamped.design}) × ${stamped.qty} — ${stamped.status}" on ${stamped.date} to "${spreadsheetTitle || 'Shared Google Sheet'}"?`,
        confirmLabel: 'Confirm & Save',
        onConfirm: async () => {
          if (bridgeUrl) {
            const res = await webBridgeApi.appendSample(bridgeUrl, stamped);
            setData(res.data);
            setSpreadsheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSheetError(null);
          } else if (spreadsheetId && accessToken) {
            await appendSampleToSheet(spreadsheetId, accessToken, stamped);
            await syncFromSheet(spreadsheetId, accessToken, false);
          }
        },
      });
    },
    [
      accessToken,
      actorLabel,
      bridgeUrl,
      isSheetConnected,
      requestConfirm,
      spreadsheetId,
      spreadsheetTitle,
      syncFromSheet,
    ],
  );

  const handleUpdateRecord = useCallback(
    async (updated: SampleRecord): Promise<boolean> => {
      const stamped: SampleRecord = actorLabel ? { ...updated, by: actorLabel } : updated;
      if (!isSheetConnected) {
        setData((prev) => ({
          ...prev,
          samples: prev.samples.map((r) => (r.id === stamped.id ? stamped : r)),
        }));
        return true;
      }

      return requestConfirm({
        title: 'Update record in Google Sheet?',
        description: `Update "${stamped.salesperson} · ${stamped.item} (${stamped.design})" to × ${stamped.qty}, ${stamped.status} on ${stamped.date} in "${spreadsheetTitle || 'Shared Google Sheet'}"?`,
        confirmLabel: 'Save Changes',
        onConfirm: async () => {
          if (bridgeUrl) {
            const res = await webBridgeApi.updateSample(bridgeUrl, stamped);
            setData(res.data);
            setSpreadsheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSheetError(null);
          } else if (spreadsheetId && accessToken) {
            await updateSampleInSheet(spreadsheetId, accessToken, stamped);
            await syncFromSheet(spreadsheetId, accessToken, false);
          }
        },
      });
    },
    [
      accessToken,
      actorLabel,
      bridgeUrl,
      isSheetConnected,
      requestConfirm,
      spreadsheetId,
      spreadsheetTitle,
      syncFromSheet,
    ],
  );

  const handleDeleteRecord = useCallback(
    async (id: string): Promise<boolean> => {
      if (!isSheetConnected) {
        setData((prev) => ({
          ...prev,
          samples: prev.samples.filter((r) => r.id !== id),
        }));
        return true;
      }

      const target = data.samples.find((r) => r.id === id);
      const summary = target
        ? `${target.salesperson} · ${target.item} (${target.design}) × ${target.qty} (${target.status}, ${target.date})`
        : id;

      return requestConfirm({
        title: 'Delete record from Google Sheet?',
        description: `Permanently delete "${summary}" from "${spreadsheetTitle || 'Shared Google Sheet'}"? This affects all team members.`,
        confirmLabel: 'Delete Record',
        tone: 'danger',
        onConfirm: async () => {
          if (bridgeUrl) {
            const res = await webBridgeApi.deleteSample(bridgeUrl, id);
            setData(res.data);
            setSpreadsheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSheetError(null);
          } else if (spreadsheetId && accessToken) {
            await deleteSampleFromSheet(spreadsheetId, accessToken, id);
            await syncFromSheet(spreadsheetId, accessToken, false);
          }
        },
      });
    },
    [
      accessToken,
      bridgeUrl,
      data.samples,
      isSheetConnected,
      requestConfirm,
      spreadsheetId,
      spreadsheetTitle,
      syncFromSheet,
    ],
  );

  const catalogHandlers = useMemo<CatalogHandlers>(
    () => ({
      onImportMissing: async (entries) => {
        const count = entries.salespeople.length + entries.designs.length + entries.models.length;
        if (count === 0) return true;
        if (!isSheetConnected) {
          setData((prev) => ({
            ...prev,
            salespeople: [...prev.salespeople, ...entries.salespeople],
            designs: [...prev.designs, ...entries.designs],
            models: [...prev.models, ...entries.models],
          }));
          return true;
        }
        return requestConfirm({
          title: 'Import items into Google Sheet?',
          description: `Add ${count} item(s) found in sample records into the editable lists in "${spreadsheetTitle || 'Shared Google Sheet'}"?`,
          confirmLabel: 'Import Items',
          onConfirm: async () => {
            if (bridgeUrl) {
              const res = await webBridgeApi.appendCatalog(bridgeUrl, entries);
              setData(res.data);
              setSpreadsheetTitle(res.title);
              setLastSyncedAt(Date.now());
              setSheetError(null);
            } else if (spreadsheetId && accessToken) {
              await appendCatalogEntriesToSheet(spreadsheetId, accessToken, entries);
              await syncFromSheet(spreadsheetId, accessToken, false);
            }
          },
        });
      },

      onAddSalesperson: async (item: SalespersonItem) => {
        if (!isSheetConnected) {
          setData((prev) => ({ ...prev, salespeople: [...prev.salespeople, item] }));
          return true;
        }
        return requestConfirm({
          title: 'Add salesperson to Google Sheet?',
          description: `Add "${item.name}" to the Salespeople list in "${spreadsheetTitle || 'Shared Google Sheet'}"?`,
          confirmLabel: 'Add Salesperson',
          onConfirm: async () => {
            if (bridgeUrl) {
              const res = await webBridgeApi.appendCatalog(bridgeUrl, { salespeople: [item] });
              setData(res.data);
              setSpreadsheetTitle(res.title);
              setLastSyncedAt(Date.now());
              setSheetError(null);
            } else if (spreadsheetId && accessToken) {
              await appendCatalogEntriesToSheet(spreadsheetId, accessToken, { salespeople: [item] });
              await syncFromSheet(spreadsheetId, accessToken, false);
            }
          },
        });
      },

      onAddDesign: async (item: DesignItem) => {
        if (!isSheetConnected) {
          setData((prev) => ({ ...prev, designs: [...prev.designs, item] }));
          return true;
        }
        return requestConfirm({
          title: 'Add design to Google Sheet?',
          description: `Add "${item.name}" to the Designs list in "${spreadsheetTitle || 'Shared Google Sheet'}"?`,
          confirmLabel: 'Add Design',
          onConfirm: async () => {
            if (bridgeUrl) {
              const res = await webBridgeApi.appendCatalog(bridgeUrl, { designs: [item] });
              setData(res.data);
              setSpreadsheetTitle(res.title);
              setLastSyncedAt(Date.now());
              setSheetError(null);
            } else if (spreadsheetId && accessToken) {
              await appendCatalogEntriesToSheet(spreadsheetId, accessToken, { designs: [item] });
              await syncFromSheet(spreadsheetId, accessToken, false);
            }
          },
        });
      },

      onAddModel: async (item: ModelItem) => {
        if (!isSheetConnected) {
          setData((prev) => ({ ...prev, models: [...prev.models, item] }));
          return true;
        }
        return requestConfirm({
          title: 'Add model number to Google Sheet?',
          description: `Add model "${item.name}" under "${item.design}" in "${spreadsheetTitle || 'Shared Google Sheet'}"?`,
          confirmLabel: 'Add Model',
          onConfirm: async () => {
            if (bridgeUrl) {
              const res = await webBridgeApi.appendCatalog(bridgeUrl, { models: [item] });
              setData(res.data);
              setSpreadsheetTitle(res.title);
              setLastSyncedAt(Date.now());
              setSheetError(null);
            } else if (spreadsheetId && accessToken) {
              await appendCatalogEntriesToSheet(spreadsheetId, accessToken, { models: [item] });
              await syncFromSheet(spreadsheetId, accessToken, false);
            }
          },
        });
      },

      onRenameSalesperson: async (id, oldName, newName) => {
        if (!isSheetConnected) {
          const oldKey = nk(oldName);
          setData((prev) => ({
            ...prev,
            salespeople: prev.salespeople.map((s) => (s.id === id ? { ...s, name: newName } : s)),
            samples: prev.samples.map((rec) =>
              nk(rec.salesperson) === oldKey ? { ...rec, salesperson: newName } : rec,
            ),
          }));
          return true;
        }
        return requestConfirm({
          title: 'Rename salesperson in Google Sheet?',
          description: `Rename "${oldName}" to "${newName}" and update all matching sample records in "${spreadsheetTitle || 'Shared Google Sheet'}"?`,
          confirmLabel: 'Save Changes',
          onConfirm: async () => {
            if (bridgeUrl) {
              const res = await webBridgeApi.renameSalesperson(bridgeUrl, id, oldName, newName);
              setData(res.data);
              setSpreadsheetTitle(res.title);
              setLastSyncedAt(Date.now());
              setSheetError(null);
            } else if (spreadsheetId && accessToken) {
              await renameSalespersonInSheet(spreadsheetId, accessToken, id, oldName, newName);
              await syncFromSheet(spreadsheetId, accessToken, false);
            }
          },
        });
      },

      onRenameDesign: async (id, oldName, newName) => {
        if (!isSheetConnected) {
          const oldKey = nk(oldName);
          setData((prev) => ({
            ...prev,
            designs: prev.designs.map((d) => (d.id === id ? { ...d, name: newName } : d)),
            models: prev.models.map((m) =>
              nk(m.design) === oldKey ? { ...m, design: newName } : m,
            ),
            samples: prev.samples.map((rec) =>
              nk(rec.design) === oldKey ? { ...rec, design: newName } : rec,
            ),
          }));
          return true;
        }
        return requestConfirm({
          title: 'Rename design in Google Sheet?',
          description: `Rename design "${oldName}" to "${newName}" and update all linked models and records in "${spreadsheetTitle || 'Shared Google Sheet'}"?`,
          confirmLabel: 'Save Changes',
          onConfirm: async () => {
            if (bridgeUrl) {
              const res = await webBridgeApi.renameDesign(bridgeUrl, id, oldName, newName);
              setData(res.data);
              setSpreadsheetTitle(res.title);
              setLastSyncedAt(Date.now());
              setSheetError(null);
            } else if (spreadsheetId && accessToken) {
              await renameDesignInSheet(spreadsheetId, accessToken, id, oldName, newName);
              await syncFromSheet(spreadsheetId, accessToken, false);
            }
          },
        });
      },

      onRenameModel: async (id, oldDesign, oldName, newDesign, newName) => {
        if (!isSheetConnected) {
          const oldPair = mk(oldDesign, oldName);
          setData((prev) => ({
            ...prev,
            models: prev.models.map((m) =>
              m.id === id ? { ...m, name: newName, design: newDesign } : m,
            ),
            samples: prev.samples.map((rec) =>
              mk(rec.design, rec.item) === oldPair
                ? { ...rec, design: newDesign, item: newName }
                : rec,
            ),
          }));
          return true;
        }
        return requestConfirm({
          title: 'Update model in Google Sheet?',
          description: `Update "${oldName} (${oldDesign})" to "${newName} (${newDesign})" and update all matching records in "${spreadsheetTitle || 'Shared Google Sheet'}"?`,
          confirmLabel: 'Save Changes',
          onConfirm: async () => {
            if (bridgeUrl) {
              const res = await webBridgeApi.renameModel(
                bridgeUrl,
                id,
                oldDesign,
                oldName,
                newDesign,
                newName,
              );
              setData(res.data);
              setSpreadsheetTitle(res.title);
              setLastSyncedAt(Date.now());
              setSheetError(null);
            } else if (spreadsheetId && accessToken) {
              await renameModelInSheet(
                spreadsheetId,
                accessToken,
                id,
                oldDesign,
                oldName,
                newDesign,
                newName,
              );
              await syncFromSheet(spreadsheetId, accessToken, false);
            }
          },
        });
      },

      onDeleteCatalogItem: async (kind, id, label) => {
        if (!isSheetConnected) {
          setData((prev) => {
            if (kind === 'salesperson') {
              return { ...prev, salespeople: prev.salespeople.filter((s) => s.id !== id) };
            }
            if (kind === 'design') {
              return { ...prev, designs: prev.designs.filter((d) => d.id !== id) };
            }
            return { ...prev, models: prev.models.filter((m) => m.id !== id) };
          });
          return true;
        }
        return requestConfirm({
          title: `Delete ${kind} from Google Sheet?`,
          description: `Remove "${label}" from the ${kind}s list in "${spreadsheetTitle || 'Shared Google Sheet'}"?`,
          confirmLabel: 'Delete',
          tone: 'danger',
          onConfirm: async () => {
            if (bridgeUrl) {
              const res = await webBridgeApi.deleteCatalog(bridgeUrl, kind, id);
              setData(res.data);
              setSpreadsheetTitle(res.title);
              setLastSyncedAt(Date.now());
              setSheetError(null);
            } else if (spreadsheetId && accessToken) {
              await deleteCatalogItemFromSheet(spreadsheetId, accessToken, kind, id);
              await syncFromSheet(spreadsheetId, accessToken, false);
            }
          },
        });
      },
    }),
    [
      accessToken,
      bridgeUrl,
      isSheetConnected,
      requestConfirm,
      spreadsheetId,
      spreadsheetTitle,
      syncFromSheet,
    ],
  );

  const handleExportAllCsv = () => {
    const csv = buildCsvContent(data.samples);
    downloadCsvFile('sample-stock-log.csv', csv);
  };

  const handleResetDemo = () => {
    setData(createStarterData());
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-8">
          <a
            href="#records"
            onClick={(e) => {
              e.preventDefault();
              navigate('records');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Sample Stock Log
          </a>

          <nav className="flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => navigate('records')}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
                view === 'records'
                  ? 'text-slate-900 font-semibold border-b-2 border-slate-900'
                  : 'hover:text-slate-900'
              }`}
            >
              Records
            </button>
            <button
              type="button"
              onClick={() => navigate('manage')}
              className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors cursor-pointer ${
                view === 'manage'
                  ? 'text-slate-900 font-semibold border-b-2 border-slate-900'
                  : 'hover:text-slate-900'
              }`}
            >
              Manage Lists
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleExportAllCsv}
              className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Export All CSV
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-6">
        <PWAInstallBanner />
        <GoogleSheetsPanel
          user={user}
          hasToken={Boolean(accessToken)}
          authBusy={authBusy}
          spreadsheetId={spreadsheetId}
          bridgeUrl={bridgeUrl}
          memberName={memberName}
          spreadsheetTitle={spreadsheetTitle}
          syncing={syncing}
          lastSyncedAt={lastSyncedAt}
          sheetError={sheetError}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          onConnectSheet={handleConnectSheet}
          onCreateSheet={handleCreateSheet}
          onDisconnectSheet={handleDisconnectSheet}
          onConnectBridge={handleConnectBridge}
          onDisconnectBridge={handleDisconnectBridge}
          onUpdateMemberName={handleUpdateMemberName}
          onRefresh={() => {
            if (bridgeUrl) {
              syncFromBridge(bridgeUrl);
            } else if (spreadsheetId && accessToken) {
              syncFromSheet(spreadsheetId, accessToken, false);
            }
          }}
        />
        {view === 'records' ? (
          <RecordsView
            data={data}
            isSheetConnected={isSheetConnected}
            onAddRecord={handleAddRecord}
            onUpdateRecord={handleUpdateRecord}
            onDeleteRecord={handleDeleteRecord}
            onNavigateManage={() => navigate('manage')}
          />
        ) : (
          <ManageListsView
            data={data}
            isSheetConnected={isSheetConnected}
            catalogHandlers={catalogHandlers}
            onBackToRecords={() => navigate('records')}
          />
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white px-6 py-3">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>
            {isSheetConnected
              ? `Sample Stock Log · Synced with Google Sheets (${spreadsheetTitle || spreadsheetId || 'Web App URL'})`
              : 'Sample Stock Log · Local browser storage mode'}
          </span>
          {!isSheetConnected && (
            <button
              type="button"
              onClick={handleResetDemo}
              className="text-slate-500 hover:text-slate-900 underline cursor-pointer"
            >
              Restore starter sample data
            </button>
          )}
        </div>
      </footer>

      <ConfirmDialog
        request={confirmState?.request ?? null}
        busy={confirmBusy}
        onCancel={handleConfirmCancel}
        onConfirm={handleConfirmProceed}
      />
    </div>
  );
}
