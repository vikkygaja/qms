export interface Health {
  status: 'ok' | 'degraded';
  version?: string;
  db: 'up' | 'down';
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch('/api/v1/health', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Health check failed (${res.status})`);
  return (await res.json()) as Health;
}
