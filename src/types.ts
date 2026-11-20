export type SampleStatus = 'Sent' | 'Returned' | 'Converted to sale';

export interface SalespersonItem {
  id: string;
  name: string;
  ts: number;
}

export interface DesignItem {
  id: string;
  name: string;
  ts: number;
}

export interface ModelItem {
  id: string;
  name: string;
  design: string;
  ts: number;
}

export interface SampleRecord {
  id: string;
  date: string;
  salesperson: string;
  design: string;
  item: string;
  qty: number;
  trays: number | null;
  status: SampleStatus;
  notes: string;
  by?: string;
  ts: number;
}

export interface AppData {
  salespeople: SalespersonItem[];
  designs: DesignItem[];
  models: ModelItem[];
  samples: SampleRecord[];
}
