import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppData } from '../types/stock';
import { localToday, shiftYmd } from '../utils/stockUtils';

const STORAGE_KEY = 'sample_stock_log_mobile_v1';

export function createStarterData(): AppData {
  const now = Date.now();
  const today = localToday();
  const yesterday = shiftYmd(today, -1);

  return {
    salespeople: [
      { id: 'sp_1', name: 'Alice Chen', ts: now - 50000 },
      { id: 'sp_2', name: 'Bob Patel', ts: now - 49000 },
    ],
    designs: [
      { id: 'dn_1', name: 'Classic', ts: now - 48000 },
      { id: 'dn_2', name: 'Modern', ts: now - 47000 },
    ],
    models: [
      { id: 'md_1', name: '101', design: 'Classic', ts: now - 46000 },
      { id: 'md_2', name: '204', design: 'Modern', ts: now - 45000 },
    ],
    samples: [
      {
        id: 'rec_1',
        date: yesterday,
        salesperson: 'Alice Chen',
        design: 'Classic',
        item: '101',
        qty: 5,
        trays: 2,
        status: 'Sent',
        notes: 'Showroom sample kit',
        ts: now - 40000,
      },
      {
        id: 'rec_2',
        date: today,
        salesperson: 'Alice Chen',
        design: 'Classic',
        item: '101',
        qty: 2,
        trays: 1,
        status: 'Returned',
        notes: 'Client passed on gold finish',
        ts: now - 30000,
      },
      {
        id: 'rec_3',
        date: today,
        salesperson: 'Bob Patel',
        design: 'Modern',
        item: '204',
        qty: 4,
        trays: 1,
        status: 'Sent',
        notes: 'Trade fair booth',
        ts: now - 20000,
      },
    ],
  };
}

export async function loadLocalData(): Promise<AppData> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return createStarterData();
    const parsed = JSON.parse(raw) as Partial<AppData>;
    return {
      salespeople: Array.isArray(parsed.salespeople) ? parsed.salespeople : [],
      designs: Array.isArray(parsed.designs) ? parsed.designs : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
      samples: Array.isArray(parsed.samples) ? parsed.samples : [],
    };
  } catch {
    return createStarterData();
  }
}

export async function saveLocalData(data: AppData): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage write errors
  }
}
