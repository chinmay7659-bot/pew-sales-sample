import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, AppStateStatus, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import ManageListsScreen, { MobileCatalogHandlers } from './src/screens/ManageListsScreen';
import NewRecordScreen from './src/screens/NewRecordScreen';
import RecordsScreen from './src/screens/RecordsScreen';
import SyncScreen from './src/screens/SyncScreen';
import { isRemoteSyncEnabled, remoteApi } from './src/services/apiClient';
import {
  appendCatalogOAuth,
  appendSampleOAuth,
  bridgeApi,
  createStockSpreadsheet,
  deleteCatalogOAuth,
  deleteSampleOAuth,
  ensureSheetTabs,
  fetchSheetAppDataOAuth,
  MobileSheetsError,
  renameDesignOAuth,
  renameModelOAuth,
  renameSalespersonOAuth,
  updateSampleOAuth,
} from './src/services/googleSheetsClient';
import { createStarterData, loadLocalData, saveLocalData } from './src/storage/localStore';
import { defaultSyncSettings, loadSyncSettings, saveSyncSettings, SyncSettings } from './src/storage/syncSettings';
import { COLORS } from './src/theme';
import { AppData, DesignItem, ModelItem, SalespersonItem, SampleRecord } from './src/types/stock';
import { mk, nk } from './src/utils/stockUtils';

type RootTabParamList = {
  Records: undefined;
  LogSample: undefined;
  ManageLists: undefined;
  Sync: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const AUTO_SYNC_MS = 12000;

export default function App() {
  const [data, setData] = useState<AppData>(() => createStarterData());
  const [ready, setReady] = useState(false);

  const [settings, setSettings] = useState<SyncSettings>(() => defaultSyncSettings());
  const [oauthToken, setOAuthToken] = useState<string | null>(null);
  const [sheetTitle, setSheetTitle] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const syncInFlightRef = useRef(false);

  const isBridgeConnected = settings.mode === 'bridge' && settings.bridgeUrl.trim().length > 0;
  const isOAuthConnected =
    settings.mode === 'oauth' && Boolean(oauthToken) && settings.spreadsheetId.trim().length > 0;

  const persistSettings = useCallback((next: SyncSettings) => {
    setSettings(next);
    saveSyncSettings(next);
  }, []);

  const handleSyncFailure = useCallback((err: unknown, showAlert = false) => {
    if (err instanceof MobileSheetsError && err.status === 401) {
      setOAuthToken(null);
    }
    const msg = err instanceof Error ? err.message : 'Google Sheets sync failed.';
    setSyncError(msg);
    if (showAlert) {
      Alert.alert('Google Sheets Sync', msg);
    }
  }, []);

  const syncNow = useCallback(
    async (ensureTabs = false, targetSettings?: SyncSettings, targetToken?: string | null) => {
      if (syncInFlightRef.current) return;
      const activeSettings = targetSettings ?? settings;
      const activeToken = targetToken !== undefined ? targetToken : oauthToken;

      const useBridge =
        activeSettings.mode === 'bridge' && activeSettings.bridgeUrl.trim().length > 0;
      const useOAuth =
        activeSettings.mode === 'oauth' &&
        Boolean(activeToken) &&
        activeSettings.spreadsheetId.trim().length > 0;

      if (!useBridge && !useOAuth && !isRemoteSyncEnabled()) {
        return;
      }

      syncInFlightRef.current = true;
      setSyncing(true);
      try {
        if (useBridge) {
          const res = await bridgeApi.fetchAll(activeSettings.bridgeUrl);
          setData(res.data);
          await saveLocalData(res.data);
          setSheetTitle(res.title);
          setLastSyncedAt(Date.now());
          setSyncError(null);
        } else if (useOAuth && activeToken) {
          if (ensureTabs) {
            const meta = await ensureSheetTabs(activeSettings.spreadsheetId, activeToken);
            setSheetTitle(meta.title);
          }
          const sheetData = await fetchSheetAppDataOAuth(activeSettings.spreadsheetId, activeToken);
          setData(sheetData);
          await saveLocalData(sheetData);
          setLastSyncedAt(Date.now());
          setSyncError(null);
        } else if (isRemoteSyncEnabled()) {
          const remote = await remoteApi.fetchSnapshot(null);
          if (remote) {
            setData(remote);
            await saveLocalData(remote);
            setLastSyncedAt(Date.now());
            setSyncError(null);
          }
        }
      } catch (err) {
        handleSyncFailure(err, false);
      } finally {
        syncInFlightRef.current = false;
        setSyncing(false);
      }
    },
    [handleSyncFailure, oauthToken, settings],
  );

  // Initial load of local data + sync settings + first remote sync
  useEffect(() => {
    let active = true;
    (async () => {
      const [local, loadedSettings] = await Promise.all([loadLocalData(), loadSyncSettings()]);
      if (!active) return;
      setData(local);
      setSettings(loadedSettings);

      if (loadedSettings.mode === 'bridge' && loadedSettings.bridgeUrl.trim()) {
        try {
          const res = await bridgeApi.fetchAll(loadedSettings.bridgeUrl);
          if (active) {
            setData(res.data);
            await saveLocalData(res.data);
            setSheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSyncError(null);
          }
        } catch (err) {
          if (active) handleSyncFailure(err, false);
        }
      } else if (isRemoteSyncEnabled()) {
        try {
          const remote = await remoteApi.fetchSnapshot(null);
          if (active && remote) {
            setData(remote);
            await saveLocalData(remote);
          }
        } catch {
          // Offline-first fallback
        }
      }

      if (active) setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [handleSyncFailure]);

  // Foreground polling + immediate sync when returning to active app state
  useEffect(() => {
    if (!ready) return;
    if (!isBridgeConnected && !isOAuthConnected && !isRemoteSyncEnabled()) return;

    const timer = setInterval(() => {
      if (appStateRef.current === 'active') {
        syncNow(false);
      }
    }, AUTO_SYNC_MS);

    const sub = AppState.addEventListener('change', (nextState) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (prev !== 'active' && nextState === 'active') {
        syncNow(false);
      }
    });

    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [isBridgeConnected, isOAuthConnected, ready, syncNow]);

  const updateLocalData = useCallback((updater: (prev: AppData) => AppData) => {
    setData((prev) => {
      const next = updater(prev);
      saveLocalData(next);
      return next;
    });
  }, []);

  const checkOAuthSessionReady = useCallback((): boolean => {
    if (settings.mode === 'oauth' && !oauthToken) {
      Alert.alert(
        'Google Sign-In Required',
        'Please sign in with Google in the Sync tab before editing the shared sheet, or disconnect to switch to Local Mode.',
      );
      return false;
    }
    if (settings.mode === 'oauth' && !settings.spreadsheetId.trim()) {
      Alert.alert('No Sheet Selected', 'Connect or create a Google Sheet in the Sync tab first.');
      return false;
    }
    return true;
  }, [oauthToken, settings.mode, settings.spreadsheetId]);

  const handleAddRecord = useCallback(
    async (record: SampleRecord): Promise<boolean> => {
      if (!checkOAuthSessionReady()) return false;
      const actor = settings.memberName.trim();
      const stamped: SampleRecord = actor && !record.by ? { ...record, by: actor } : record;

      if (isBridgeConnected) {
        setSyncing(true);
        try {
          const res = await bridgeApi.appendSample(settings.bridgeUrl, stamped);
          setData(res.data);
          await saveLocalData(res.data);
          setSheetTitle(res.title);
          setLastSyncedAt(Date.now());
          setSyncError(null);
          return true;
        } catch (err) {
          handleSyncFailure(err, true);
          return false;
        } finally {
          setSyncing(false);
        }
      }

      if (isOAuthConnected && oauthToken) {
        setSyncing(true);
        try {
          await appendSampleOAuth(settings.spreadsheetId, oauthToken, stamped);
          const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
          setData(fresh);
          await saveLocalData(fresh);
          setLastSyncedAt(Date.now());
          setSyncError(null);
          return true;
        } catch (err) {
          handleSyncFailure(err, true);
          return false;
        } finally {
          setSyncing(false);
        }
      }

      updateLocalData((prev) => ({
        ...prev,
        samples: [stamped, ...prev.samples],
      }));
      if (isRemoteSyncEnabled()) {
        remoteApi.createSample(null, stamped).catch(() => {});
      }
      return true;
    },
    [
      checkOAuthSessionReady,
      handleSyncFailure,
      isBridgeConnected,
      isOAuthConnected,
      oauthToken,
      settings.bridgeUrl,
      settings.memberName,
      settings.spreadsheetId,
      updateLocalData,
    ],
  );

  const handleUpdateRecord = useCallback(
    async (updated: SampleRecord): Promise<boolean> => {
      if (!checkOAuthSessionReady()) return false;
      const actor = settings.memberName.trim();
      const stamped: SampleRecord = actor ? { ...updated, by: actor } : updated;

      if (isBridgeConnected) {
        setSyncing(true);
        try {
          const res = await bridgeApi.updateSample(settings.bridgeUrl, stamped);
          setData(res.data);
          await saveLocalData(res.data);
          setSheetTitle(res.title);
          setLastSyncedAt(Date.now());
          setSyncError(null);
          return true;
        } catch (err) {
          handleSyncFailure(err, true);
          return false;
        } finally {
          setSyncing(false);
        }
      }

      if (isOAuthConnected && oauthToken) {
        setSyncing(true);
        try {
          await updateSampleOAuth(settings.spreadsheetId, oauthToken, stamped);
          const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
          setData(fresh);
          await saveLocalData(fresh);
          setLastSyncedAt(Date.now());
          setSyncError(null);
          return true;
        } catch (err) {
          handleSyncFailure(err, true);
          return false;
        } finally {
          setSyncing(false);
        }
      }

      updateLocalData((prev) => ({
        ...prev,
        samples: prev.samples.map((r) => (r.id === stamped.id ? stamped : r)),
      }));
      if (isRemoteSyncEnabled()) {
        remoteApi.updateSample(null, stamped).catch(() => {});
      }
      return true;
    },
    [
      checkOAuthSessionReady,
      handleSyncFailure,
      isBridgeConnected,
      isOAuthConnected,
      oauthToken,
      settings.bridgeUrl,
      settings.memberName,
      settings.spreadsheetId,
      updateLocalData,
    ],
  );

  const handleDeleteRecord = useCallback(
    async (id: string): Promise<boolean> => {
      if (!checkOAuthSessionReady()) return false;

      if (isBridgeConnected) {
        setSyncing(true);
        try {
          const res = await bridgeApi.deleteSample(settings.bridgeUrl, id);
          setData(res.data);
          await saveLocalData(res.data);
          setSheetTitle(res.title);
          setLastSyncedAt(Date.now());
          setSyncError(null);
          return true;
        } catch (err) {
          handleSyncFailure(err, true);
          return false;
        } finally {
          setSyncing(false);
        }
      }

      if (isOAuthConnected && oauthToken) {
        setSyncing(true);
        try {
          await deleteSampleOAuth(settings.spreadsheetId, oauthToken, id);
          const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
          setData(fresh);
          await saveLocalData(fresh);
          setLastSyncedAt(Date.now());
          setSyncError(null);
          return true;
        } catch (err) {
          handleSyncFailure(err, true);
          return false;
        } finally {
          setSyncing(false);
        }
      }

      updateLocalData((prev) => ({
        ...prev,
        samples: prev.samples.filter((r) => r.id !== id),
      }));
      if (isRemoteSyncEnabled()) {
        remoteApi.deleteSample(null, id).catch(() => {});
      }
      return true;
    },
    [
      checkOAuthSessionReady,
      handleSyncFailure,
      isBridgeConnected,
      isOAuthConnected,
      oauthToken,
      settings.bridgeUrl,
      settings.spreadsheetId,
      updateLocalData,
    ],
  );

  const catalogHandlers = useMemo<MobileCatalogHandlers>(
    () => ({
      onImportMissing: async (entries) => {
        const count =
          entries.salespeople.length + entries.designs.length + entries.models.length;
        if (count === 0) return true;
        if (!checkOAuthSessionReady()) return false;

        if (isBridgeConnected) {
          setSyncing(true);
          try {
            const res = await bridgeApi.appendCatalog(settings.bridgeUrl, entries);
            setData(res.data);
            await saveLocalData(res.data);
            setSheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        if (isOAuthConnected && oauthToken) {
          setSyncing(true);
          try {
            await appendCatalogOAuth(settings.spreadsheetId, oauthToken, entries);
            const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
            setData(fresh);
            await saveLocalData(fresh);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        updateLocalData((prev) => ({
          ...prev,
          salespeople: [...prev.salespeople, ...entries.salespeople],
          designs: [...prev.designs, ...entries.designs],
          models: [...prev.models, ...entries.models],
        }));
        return true;
      },

      onAddSalesperson: async (item: SalespersonItem) => {
        if (!checkOAuthSessionReady()) return false;

        if (isBridgeConnected) {
          setSyncing(true);
          try {
            const res = await bridgeApi.appendCatalog(settings.bridgeUrl, {
              salespeople: [item],
            });
            setData(res.data);
            await saveLocalData(res.data);
            setSheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        if (isOAuthConnected && oauthToken) {
          setSyncing(true);
          try {
            await appendCatalogOAuth(settings.spreadsheetId, oauthToken, {
              salespeople: [item],
            });
            const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
            setData(fresh);
            await saveLocalData(fresh);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        updateLocalData((prev) => ({ ...prev, salespeople: [...prev.salespeople, item] }));
        if (isRemoteSyncEnabled()) {
          remoteApi.upsertSalesperson(null, item).catch(() => {});
        }
        return true;
      },

      onAddDesign: async (item: DesignItem) => {
        if (!checkOAuthSessionReady()) return false;

        if (isBridgeConnected) {
          setSyncing(true);
          try {
            const res = await bridgeApi.appendCatalog(settings.bridgeUrl, { designs: [item] });
            setData(res.data);
            await saveLocalData(res.data);
            setSheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        if (isOAuthConnected && oauthToken) {
          setSyncing(true);
          try {
            await appendCatalogOAuth(settings.spreadsheetId, oauthToken, { designs: [item] });
            const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
            setData(fresh);
            await saveLocalData(fresh);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        updateLocalData((prev) => ({ ...prev, designs: [...prev.designs, item] }));
        if (isRemoteSyncEnabled()) {
          remoteApi.upsertDesign(null, item).catch(() => {});
        }
        return true;
      },

      onAddModel: async (item: ModelItem) => {
        if (!checkOAuthSessionReady()) return false;

        if (isBridgeConnected) {
          setSyncing(true);
          try {
            const res = await bridgeApi.appendCatalog(settings.bridgeUrl, { models: [item] });
            setData(res.data);
            await saveLocalData(res.data);
            setSheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        if (isOAuthConnected && oauthToken) {
          setSyncing(true);
          try {
            await appendCatalogOAuth(settings.spreadsheetId, oauthToken, { models: [item] });
            const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
            setData(fresh);
            await saveLocalData(fresh);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        updateLocalData((prev) => ({ ...prev, models: [...prev.models, item] }));
        if (isRemoteSyncEnabled()) {
          remoteApi.upsertModel(null, item).catch(() => {});
        }
        return true;
      },

      onRenameSalesperson: async (id, oldName, newName) => {
        if (!checkOAuthSessionReady()) return false;

        if (isBridgeConnected) {
          setSyncing(true);
          try {
            const res = await bridgeApi.renameSalesperson(
              settings.bridgeUrl,
              id,
              oldName,
              newName,
            );
            setData(res.data);
            await saveLocalData(res.data);
            setSheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        if (isOAuthConnected && oauthToken) {
          setSyncing(true);
          try {
            await renameSalespersonOAuth(
              settings.spreadsheetId,
              oauthToken,
              id,
              oldName,
              newName,
            );
            const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
            setData(fresh);
            await saveLocalData(fresh);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        const oldKey = nk(oldName);
        updateLocalData((prev) => ({
          ...prev,
          salespeople: prev.salespeople.map((s) => (s.id === id ? { ...s, name: newName } : s)),
          samples: prev.samples.map((rec) =>
            nk(rec.salesperson) === oldKey ? { ...rec, salesperson: newName } : rec,
          ),
        }));
        return true;
      },

      onRenameDesign: async (id, oldName, newName) => {
        if (!checkOAuthSessionReady()) return false;

        if (isBridgeConnected) {
          setSyncing(true);
          try {
            const res = await bridgeApi.renameDesign(settings.bridgeUrl, id, oldName, newName);
            setData(res.data);
            await saveLocalData(res.data);
            setSheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        if (isOAuthConnected && oauthToken) {
          setSyncing(true);
          try {
            await renameDesignOAuth(settings.spreadsheetId, oauthToken, id, oldName, newName);
            const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
            setData(fresh);
            await saveLocalData(fresh);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        const oldKey = nk(oldName);
        updateLocalData((prev) => ({
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
      },

      onRenameModel: async (id, oldDesign, oldName, newDesign, newName) => {
        if (!checkOAuthSessionReady()) return false;

        if (isBridgeConnected) {
          setSyncing(true);
          try {
            const res = await bridgeApi.renameModel(
              settings.bridgeUrl,
              id,
              oldDesign,
              oldName,
              newDesign,
              newName,
            );
            setData(res.data);
            await saveLocalData(res.data);
            setSheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        if (isOAuthConnected && oauthToken) {
          setSyncing(true);
          try {
            await renameModelOAuth(
              settings.spreadsheetId,
              oauthToken,
              id,
              oldDesign,
              oldName,
              newDesign,
              newName,
            );
            const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
            setData(fresh);
            await saveLocalData(fresh);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        const oldPair = mk(oldDesign, oldName);
        updateLocalData((prev) => ({
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
      },

      onDeleteCatalogItem: async (kind, id) => {
        if (!checkOAuthSessionReady()) return false;

        if (isBridgeConnected) {
          setSyncing(true);
          try {
            const res = await bridgeApi.deleteCatalog(settings.bridgeUrl, kind, id);
            setData(res.data);
            await saveLocalData(res.data);
            setSheetTitle(res.title);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        if (isOAuthConnected && oauthToken) {
          setSyncing(true);
          try {
            await deleteCatalogOAuth(settings.spreadsheetId, oauthToken, kind, id);
            const fresh = await fetchSheetAppDataOAuth(settings.spreadsheetId, oauthToken);
            setData(fresh);
            await saveLocalData(fresh);
            setLastSyncedAt(Date.now());
            setSyncError(null);
            return true;
          } catch (err) {
            handleSyncFailure(err, true);
            return false;
          } finally {
            setSyncing(false);
          }
        }

        updateLocalData((prev) => {
          if (kind === 'salesperson') {
            return { ...prev, salespeople: prev.salespeople.filter((s) => s.id !== id) };
          }
          if (kind === 'design') {
            return { ...prev, designs: prev.designs.filter((d) => d.id !== id) };
          }
          return { ...prev, models: prev.models.filter((m) => m.id !== id) };
        });
        return true;
      },
    }),
    [
      checkOAuthSessionReady,
      handleSyncFailure,
      isBridgeConnected,
      isOAuthConnected,
      oauthToken,
      settings.bridgeUrl,
      settings.spreadsheetId,
      updateLocalData,
    ],
  );

  // Sync tab handlers
  const handleUpdateMemberName = useCallback(
    (memberName: string) => {
      persistSettings({ ...settings, memberName });
      Alert.alert('Saved', memberName ? `Records will be tagged "by ${memberName}".` : 'Name cleared.');
    },
    [persistSettings, settings],
  );

  const handleConnectBridge = useCallback(
    async (bridgeUrl: string, seedIfEmpty: boolean) => {
      const cleaned = bridgeUrl.trim();
      if (!/^https:\/\/script\.google\.com\//i.test(cleaned) && !/^https?:\/\//i.test(cleaned)) {
        setSyncError('Please paste a valid https://script.google.com/macros/s/.../exec URL.');
        return;
      }

      setSyncing(true);
      setSyncError(null);
      try {
        const res = seedIfEmpty
          ? await bridgeApi.seedIfEmpty(cleaned, data)
          : await bridgeApi.fetchAll(cleaned);
        const next: SyncSettings = {
          ...settings,
          mode: 'bridge',
          bridgeUrl: cleaned,
        };
        persistSettings(next);
        setData(res.data);
        await saveLocalData(res.data);
        setSheetTitle(res.title);
        setLastSyncedAt(Date.now());
      } catch (err) {
        handleSyncFailure(err, true);
      } finally {
        setSyncing(false);
      }
    },
    [data, handleSyncFailure, persistSettings, settings],
  );

  const handleDisconnect = useCallback(() => {
    persistSettings({ ...settings, mode: 'none' });
    setSheetTitle(null);
    setLastSyncedAt(null);
    setSyncError(null);
  }, [persistSettings, settings]);

  const handleOAuthToken = useCallback(
    (token: string) => {
      setOAuthToken(token);
      setSyncError(null);
      if (settings.spreadsheetId.trim()) {
        const next: SyncSettings = { ...settings, mode: 'oauth' };
        persistSettings(next);
        syncNow(true, next, token);
      }
    },
    [persistSettings, settings, syncNow],
  );

  const handleConnectOAuthSheet = useCallback(
    async (spreadsheetId: string) => {
      if (!oauthToken) return;
      setSyncing(true);
      setSyncError(null);
      try {
        const meta = await ensureSheetTabs(spreadsheetId, oauthToken);
        const fresh = await fetchSheetAppDataOAuth(spreadsheetId, oauthToken);
        const next: SyncSettings = {
          ...settings,
          mode: 'oauth',
          spreadsheetId,
        };
        persistSettings(next);
        setData(fresh);
        await saveLocalData(fresh);
        setSheetTitle(meta.title);
        setLastSyncedAt(Date.now());
      } catch (err) {
        handleSyncFailure(err, true);
      } finally {
        setSyncing(false);
      }
    },
    [handleSyncFailure, oauthToken, persistSettings, settings],
  );

  const handleCreateOAuthSheet = useCallback(async () => {
    if (!oauthToken) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const { meta, data: createdData } = await createStockSpreadsheet(
        'pew sales-sample — Stock Log',
        oauthToken,
        data,
      );
      const next: SyncSettings = {
        ...settings,
        mode: 'oauth',
        spreadsheetId: meta.spreadsheetId,
      };
      persistSettings(next);
      setData(createdData);
      await saveLocalData(createdData);
      setSheetTitle(meta.title);
      setLastSyncedAt(Date.now());
    } catch (err) {
      handleSyncFailure(err, true);
    } finally {
      setSyncing(false);
    }
  }, [data, handleSyncFailure, oauthToken, persistSettings, settings]);

  const handleSignOutOAuth = useCallback(() => {
    setOAuthToken(null);
    if (settings.mode === 'oauth') {
      persistSettings({ ...settings, mode: 'none' });
      setSheetTitle(null);
      setLastSyncedAt(null);
    }
    setSyncError(null);
  }, [persistSettings, settings]);

  if (!ready) {
    return (
      <SafeAreaProvider>
        <View style={styles.loadingScreen}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading Sample Stock Log…</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerStyle: {
              backgroundColor: COLORS.surface,
            },
            headerShadowVisible: false,
            headerTitleStyle: {
              fontSize: 18,
              fontWeight: '700',
              color: COLORS.text,
            },
            tabBarActiveTintColor: COLORS.primary,
            tabBarInactiveTintColor: COLORS.textMuted,
            tabBarStyle: {
              backgroundColor: COLORS.surface,
              borderTopColor: COLORS.border,
              height: 62,
              paddingBottom: 8,
              paddingTop: 6,
            },
            tabBarLabelStyle: {
              fontSize: 12,
              fontWeight: '600',
            },
            tabBarIcon: ({ color, size, focused }) => {
              let iconName: keyof typeof Ionicons.glyphMap = 'cube-outline';
              if (route.name === 'Records') {
                iconName = focused ? 'layers' : 'layers-outline';
              } else if (route.name === 'LogSample') {
                iconName = focused ? 'add-circle' : 'add-circle-outline';
              } else if (route.name === 'ManageLists') {
                iconName = focused ? 'list' : 'list-outline';
              } else if (route.name === 'Sync') {
                iconName = focused
                  ? isBridgeConnected || isOAuthConnected
                    ? 'cloud-done'
                    : 'cloud'
                  : isBridgeConnected || isOAuthConnected
                    ? 'cloud-done-outline'
                    : 'cloud-outline';
              }
              return <Ionicons name={iconName} size={size} color={color} />;
            },
          })}
        >
          <Tab.Screen name="Records" options={{ title: 'Sample Records' }}>
            {({ navigation }) => (
              <RecordsScreen
                data={data}
                refreshing={syncing}
                onRefresh={() => syncNow(false)}
                onUpdateRecord={handleUpdateRecord}
                onDeleteRecord={handleDeleteRecord}
                onGoToNewRecord={() => navigation.navigate('LogSample')}
              />
            )}
          </Tab.Screen>

          <Tab.Screen name="LogSample" options={{ title: 'Log Sample' }}>
            {({ navigation }) => (
              <NewRecordScreen
                data={data}
                onAddRecord={handleAddRecord}
                onGoToManage={() => navigation.navigate('ManageLists')}
              />
            )}
          </Tab.Screen>

          <Tab.Screen name="ManageLists" options={{ title: 'Manage Lists' }}>
            {() => <ManageListsScreen data={data} catalogHandlers={catalogHandlers} />}
          </Tab.Screen>

          <Tab.Screen name="Sync" options={{ title: 'Sheet Sync' }}>
            {() => (
              <SyncScreen
                settings={settings}
                hasOAuthToken={Boolean(oauthToken)}
                sheetTitle={sheetTitle}
                syncing={syncing}
                lastSyncedAt={lastSyncedAt}
                syncError={syncError}
                onUpdateMemberName={handleUpdateMemberName}
                onConnectBridge={handleConnectBridge}
                onDisconnect={handleDisconnect}
                onSyncNow={() => syncNow(false)}
                onOAuthToken={handleOAuthToken}
                onConnectOAuthSheet={handleConnectOAuthSheet}
                onCreateOAuthSheet={handleCreateOAuthSheet}
                onSignOutOAuth={handleSignOutOAuth}
              />
            )}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
});
