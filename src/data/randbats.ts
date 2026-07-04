// Fetch + cache the randbats set data from pkmn.github.io.
//
// The feed is public and CORS-open (`access-control-allow-origin: *`), so the
// content script can fetch it directly from the page. We cache per format in
// memory for the session and in localStorage with a TTL so repeat visits are
// instant and resilient to the feed being briefly unreachable.

import type {RandbatsData, RandbatsEntry} from '../core/types.js';

const BASE_URL = 'https://pkmn.github.io/randbats/data';
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STORAGE_PREFIX = 'hichu:randbats:';

const memory = new Map<string, RandbatsData>();
const inFlight = new Map<string, Promise<RandbatsData | null>>();

function readStorage(formatId: string): RandbatsData | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + formatId);
    if (!raw) return null;
    const {t, data} = JSON.parse(raw) as {t: number; data: RandbatsData};
    if (Date.now() - t > TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeStorage(formatId: string, data: RandbatsData): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + formatId, JSON.stringify({t: Date.now(), data}));
  } catch {
    // Quota or disabled storage — the in-memory cache still serves this session.
  }
}

/** Synchronous cache lookup — returns data only if already in memory. */
export function cachedRandbats(formatId: string): RandbatsData | null {
  const mem = memory.get(formatId);
  if (mem) return mem;
  const stored = readStorage(formatId);
  if (stored) memory.set(formatId, stored);
  return stored;
}

/** Fetch (or reuse a cached copy of) the set data for a format. */
export async function fetchRandbats(formatId: string): Promise<RandbatsData | null> {
  const cached = cachedRandbats(formatId);
  if (cached) return cached;

  const existing = inFlight.get(formatId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/${formatId}.json`);
      if (!res.ok) return null; // unsupported format (e.g. Challenge Cup) → no data
      const data = (await res.json()) as RandbatsData;
      memory.set(formatId, data);
      writeStorage(formatId, data);
      return data;
    } catch {
      return null;
    } finally {
      inFlight.delete(formatId);
    }
  })();
  inFlight.set(formatId, promise);
  return promise;
}

/**
 * Find a species' entry, tolerating forme names the feed may not key exactly.
 * Tries the full forme, then progressively drops trailing "-suffix" segments
 * (e.g. "Greninja-Bond" → "Greninja"), so cosmetic/battle formes still resolve.
 */
export function pickEntry(data: RandbatsData, speciesForme: string): RandbatsEntry | undefined {
  if (data[speciesForme]) return data[speciesForme];
  const parts = speciesForme.split('-');
  for (let n = parts.length - 1; n >= 1; n--) {
    const candidate = parts.slice(0, n).join('-');
    if (data[candidate]) return data[candidate];
  }
  return undefined;
}
