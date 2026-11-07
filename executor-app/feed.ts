export const FEED_URL = 'https://sdhwex-data.enderium42.workers.dev/v1/triage.json';
export const ACCOUNT_ID = '2fa4104b17af8808577f12883fa657b1';
export const WORKER_NAME = 'sdhwex-data';
// Two copies are stored in one backup row (SQLite's per-row limit is 2 MiB).
export const MAX_FEED_BYTES = 750000;
export type Stage = 'build' | 'design';
export type Project = {
  project_id: string; title: string; submitted: string;
  verdict: 'ready' | 'not_shipped'; fail: string[]; warn: string[];
  [key: string]: unknown;
};
export type Snapshot = { checkedAt: string; projects: Project[]; [key: string]: unknown };
export type Feed = {
  schemaVersion: 1; guidelines: string; build: Snapshot; design: Snapshot;
  [key: string]: unknown;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function stage(value: string): Stage {
  if (value !== 'build' && value !== 'design') throw new Error('Stage must be build or design.');
  return value;
}
export function validateFeed(value: unknown): Feed {
  const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 20000;
  const list = (v: unknown) => Array.isArray(v) && v.length <= 1000 && v.every(text);
  if (!record(value) || value.schemaVersion !== 1 || !text(value.guidelines) || !value.guidelines.trim())
    throw new Error('Expected schemaVersion 1 and a nonempty guidelines sentence.');
  for (const key of ['build', 'design']) {
    const snapshot = value[key];
    if (!record(snapshot) || typeof snapshot.checkedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.checkedAt) ||
        !Number.isFinite(Date.parse(snapshot.checkedAt + 'T00:00:00Z')) ||
        new Date(snapshot.checkedAt + 'T00:00:00Z').toISOString().slice(0, 10) !== snapshot.checkedAt ||
        !Array.isArray(snapshot.projects) || snapshot.projects.length > 10000)
      throw new Error('Snapshot needs a real YYYY-MM-DD checkedAt and at most 10000 projects.');
    const ids = new Set<string>();
    for (const p of snapshot.projects) {
      if (!record(p) || typeof p.project_id !== 'string' || !/^\d+$/.test(p.project_id) ||
          ids.has(p.project_id) || !text(p.title) || !text(p.submitted) ||
          !['ready', 'not_shipped'].includes(String(p.verdict)) || !list(p.fail) || !list(p.warn))
        throw new Error('Project needs a unique numeric-string project_id, title, submitted, verdict, fail and warn.');
      for (const field of ['repo', 'demo'])
        if (p[field] != null && !text(p[field])) throw new Error('Project links must be strings or null.');
      if (key === 'design') {
        if (!text(p.tier) || typeof p.requested !== 'number' || !Number.isFinite(p.requested) || p.requested < 0 ||
            (p.bom_total != null && (typeof p.bom_total !== 'number' || !Number.isFinite(p.bom_total) || p.bom_total < 0)))
          throw new Error('Design projects need tier and nonnegative numeric requested / optional bom_total.');
      } else if (![p.devlogs, p.build_devlogs].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0)) {
        throw new Error('Build projects need nonnegative integer devlogs and build_devlogs.');
      }
      ids.add(p.project_id);
    }
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_FEED_BYTES)
    throw new Error('Feed exceeds the editor limit of 750000 bytes.');
  return value as Feed;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export async function feedHash(feed: Feed): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(feed)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
}

export async function boundedJSON(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new Error('Remote service returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) { await reader.cancel(); throw new Error('Remote response exceeds the size limit.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

type Reader = { fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>; signal: AbortSignal };
export async function readLive(ctx: Reader): Promise<Feed> {
  const response = await ctx.fetch(FEED_URL + '?editor=' + crypto.randomUUID(), {
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15000)]),
    cache: 'no-store', redirect: 'manual', headers: { Accept: 'application/json' }
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
    throw new Error('Cannot read the live Cloudflare feed (HTTP ' + response.status + ').');
  return validateFeed(await boundedJSON(response, MAX_FEED_BYTES));
}
