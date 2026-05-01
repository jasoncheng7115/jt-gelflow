import type { Config, MappingConfig, FieldsResponse, GraphData } from './types';

const API_BASE = '/api';

export async function getConfig(): Promise<Config> {
  const res = await fetch(`${API_BASE}/config`);
  return res.json();
}

export async function updateConfig(config: Partial<Config>): Promise<Config> {
  const res = await fetch(`${API_BASE}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  return res.json();
}

export async function getMapping(): Promise<MappingConfig> {
  const res = await fetch(`${API_BASE}/mapping`);
  return res.json();
}

export async function updateMapping(mapping: Partial<MappingConfig>): Promise<MappingConfig> {
  const res = await fetch(`${API_BASE}/mapping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mapping),
  });
  return res.json();
}

export async function getFields(): Promise<FieldsResponse> {
  const res = await fetch(`${API_BASE}/fields`);
  return res.json();
}

export async function clearFields(): Promise<void> {
  await fetch(`${API_BASE}/fields/clear`, { method: 'POST' });
}

export async function getGraph(): Promise<GraphData> {
  const res = await fetch(`${API_BASE}/graph`);
  return res.json();
}

export async function getStats(): Promise<{ messageCount: number; flowCount: number }> {
  const res = await fetch(`${API_BASE}/stats`);
  return res.json();
}

export async function previewTemplate(template: string): Promise<{ result: string; error?: string; sample?: Record<string, unknown> }> {
  const res = await fetch(`${API_BASE}/template/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ template }),
  });
  return res.json();
}

export async function clearData(): Promise<void> {
  await fetch(`${API_BASE}/clear`, { method: 'POST' });
}

export interface DetectLocationResult {
  success: boolean;
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  ip?: string;
  error?: string;
}

export async function detectLocation(): Promise<DetectLocationResult> {
  const res = await fetch(`${API_BASE}/detect-location`);
  return res.json();
}

export function createWebSocket(): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  return new WebSocket(wsUrl);
}
