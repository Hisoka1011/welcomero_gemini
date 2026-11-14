// Browser client for /api/sources-monitor (live official government & university source verification).

export type SourceMonitorStatus = 'verified_unchanged' | 'updated' | 'unreachable' | 'pending';

export interface MonitoredSourceState {
  id: string;
  title: string;
  url: string;
  kind: 'government' | 'university' | 'eu' | 'ngo';
  status: SourceMonitorStatus;
  httpStatus: number | null;
  lastCheckedAt: string | null;
  lastChangedAt: string | null;
  lastModifiedHeader: string | null;
  contentHash: string | null;
  snippet: string | null;
  highlights: string[];
  changeSummary: string | null;
}

export interface MonitorSnapshot {
  lastSweepAt: string | null;
  sources: Record<string, MonitoredSourceState>;
}

export async function fetchMonitorSnapshot(): Promise<MonitorSnapshot | null> {
  try {
    const res = await fetch('/api/sources-monitor', { method: 'GET' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('application/json')) return null;
    return (await res.json()) as MonitorSnapshot;
  } catch {
    return null;
  }
}

export async function triggerMonitorSweep(): Promise<MonitorSnapshot | null> {
  try {
    const res = await fetch('/api/sources-monitor', { method: 'POST' });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('application/json')) return null;
    return (await res.json()) as MonitorSnapshot;
  } catch {
    return null;
  }
}
