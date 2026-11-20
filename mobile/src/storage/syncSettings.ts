import AsyncStorage from '@react-native-async-storage/async-storage';

const SYNC_SETTINGS_KEY = 'sample_stock_log_sync_settings_v1';

export type SyncMode = 'none' | 'bridge' | 'oauth';

export interface SyncSettings {
  mode: SyncMode;
  bridgeUrl: string;
  spreadsheetId: string;
  memberName: string;
}

export function defaultSyncSettings(): SyncSettings {
  const envBridge = process.env.EXPO_PUBLIC_SHEETS_BRIDGE_URL?.trim() || '';
  const envSheetId = process.env.EXPO_PUBLIC_DEFAULT_SPREADSHEET_ID?.trim() || '';

  return {
    mode: envBridge ? 'bridge' : envSheetId ? 'oauth' : 'none',
    bridgeUrl: envBridge,
    spreadsheetId: envSheetId,
    memberName: '',
  };
}

export async function loadSyncSettings(): Promise<SyncSettings> {
  const defaults = defaultSyncSettings();
  try {
    const raw = await AsyncStorage.getItem(SYNC_SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    const mode: SyncMode =
      parsed.mode === 'bridge' || parsed.mode === 'oauth' || parsed.mode === 'none'
        ? parsed.mode
        : defaults.mode;
    return {
      mode,
      bridgeUrl: typeof parsed.bridgeUrl === 'string' && parsed.bridgeUrl ? parsed.bridgeUrl : defaults.bridgeUrl,
      spreadsheetId:
        typeof parsed.spreadsheetId === 'string' && parsed.spreadsheetId
          ? parsed.spreadsheetId
          : defaults.spreadsheetId,
      memberName: typeof parsed.memberName === 'string' ? parsed.memberName : '',
    };
  } catch {
    return defaults;
  }
}

export async function saveSyncSettings(settings: SyncSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage write errors
  }
}
