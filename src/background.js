import { validateRemoteData } from './remote-data.js';

const DATA_URL = 'https://sdhwex-data.enderium42.workers.dev/v1/triage.json';
const TTL = 5 * 60 * 1000;
const KEY = 'sdhwex-feed-v1';
let pending;

async function loadData() {
  let cached;
  try {
    cached = (await chrome.storage.local.get(KEY))[KEY];
    validateRemoteData(cached.data);
    if (!Number.isFinite(cached.fetchedAt) || cached.fetchedAt > Date.now()) cached = null;
  } catch { cached = null; }
  if (cached && Date.now() - cached.fetchedAt < TTL)
    return { ok: true, ...cached, source: 'cache' };
  try {
    const response = await fetch(DATA_URL, {
      credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
      redirect: 'error', signal: AbortSignal.timeout(10000)
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
      throw new Error('Feed unavailable');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Feed too large');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const data = validateRemoteData(JSON.parse(new TextDecoder().decode(bytes)));
    const entry = { data, fetchedAt: Date.now() };
    try { await chrome.storage.local.set({ [KEY]: entry }); } catch { /* Still use fresh data. */ }
    return { ok: true, ...entry, source: 'cloudflare' };
  } catch {
    return cached ? { ok: true, ...cached, source: 'offline-cache' } : { ok: false };
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'sdhwex:get-data' || sender.id !== chrome.runtime.id) return;
  try {
    if (new URL(sender.url).origin !== 'https://stardance.hackclub.com') return;
  } catch { return; }
  if (!pending) pending = loadData().finally(() => { pending = null; });
  pending.then(respond, () => respond({ ok: false }));
  return true;
});
