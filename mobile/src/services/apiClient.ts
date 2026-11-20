import { AppData, DesignItem, ModelItem, SalespersonItem, SampleRecord } from '../types/stock';

/**
 * Optional remote REST API client for multi-user cloud synchronization.
 * Configured via EXPO_PUBLIC_API_BASE_URL in .env (no secrets hardcoded).
 * When EXPO_PUBLIC_API_BASE_URL is unset, the app operates in offline-first AsyncStorage mode.
 */
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || '';

export function isRemoteSyncEnabled(): boolean {
  return API_BASE_URL.length > 0;
}

async function request<T>(path: string, authToken: string | null, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

export const remoteApi = {
  fetchSnapshot: (token: string | null) => request<AppData>('/api/stock-log', token),
  createSample: (token: string | null, record: SampleRecord) =>
    request<SampleRecord>('/api/samples', token, { method: 'POST', body: JSON.stringify(record) }),
  updateSample: (token: string | null, record: SampleRecord) =>
    request<SampleRecord>(`/api/samples/${encodeURIComponent(record.id)}`, token, {
      method: 'PATCH',
      body: JSON.stringify(record),
    }),
  deleteSample: (token: string | null, id: string) =>
    request<{ ok: boolean }>(`/api/samples/${encodeURIComponent(id)}`, token, { method: 'DELETE' }),
  upsertSalesperson: (token: string | null, item: SalespersonItem) =>
    request<SalespersonItem>('/api/catalog/salespeople', token, {
      method: 'PUT',
      body: JSON.stringify(item),
    }),
  deleteSalesperson: (token: string | null, id: string) =>
    request<{ ok: boolean }>(`/api/catalog/salespeople/${encodeURIComponent(id)}`, token, {
      method: 'DELETE',
    }),
  upsertDesign: (token: string | null, item: DesignItem) =>
    request<DesignItem>('/api/catalog/designs', token, {
      method: 'PUT',
      body: JSON.stringify(item),
    }),
  deleteDesign: (token: string | null, id: string) =>
    request<{ ok: boolean }>(`/api/catalog/designs/${encodeURIComponent(id)}`, token, {
      method: 'DELETE',
    }),
  upsertModel: (token: string | null, item: ModelItem) =>
    request<ModelItem>('/api/catalog/models', token, {
      method: 'PUT',
      body: JSON.stringify(item),
    }),
  deleteModel: (token: string | null, id: string) =>
    request<{ ok: boolean }>(`/api/catalog/models/${encodeURIComponent(id)}`, token, {
      method: 'DELETE',
    }),
};
