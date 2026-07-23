// Fetch + cache the randbats set data from pkmn.github.io.
//
// The feed is public and CORS-open (`access-control-allow-origin: *`), so the
// content script can fetch it directly from the page. We cache per format in
// memory for the session and in localStorage with a TTL so repeat visits are
// instant and resilient to the feed being briefly unreachable.
//
// This is the ONLY file in the codebase that touches the network — `lookup.ts` holds
// every pure read over the data once it's in hand (pickEntry, the Mega lookups, the
// Champions stat-point conversion), so a caller that only needs those, like
// `section.ts`, never has to import a file that also calls `fetch`.

import type {RandbatsData} from '../core/types.js';
import {championsStatPointsToEvs} from './lookup.js';

const BASE_URL = 'https://pkmn.github.io/randbats/data';
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const STORAGE_PREFIX = 'hichu:randbats:';
// Data-shape version of what writeStorage persists. A mismatch (or absence, for
// pre-versioning entries) discards the cached copy and refetches, so a shipped
// change to the conversion below can never serve a stale unconverted feed.
const STORAGE_VERSION = 2; // v2: Champions stat points arrive converted to mainline EVs

const memory = new Map<string, RandbatsData>();
const inFlight = new Map<string, Promise<RandbatsData | null>>();

function readStorage(formatId: string): RandbatsData | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + formatId);
    if (!raw) return null;
    const {t, v, data} = JSON.parse(raw) as {t: number; v?: number; data: RandbatsData};
    if (v !== STORAGE_VERSION) return null;
    if (Date.now() - t > TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeStorage(formatId: string, data: RandbatsData): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + formatId, JSON.stringify({t: Date.now(), v: STORAGE_VERSION, data}));
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

const isChampionsFormat = (formatId: string): boolean => formatId.includes('champions');

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
      const fetched = (await res.json()) as RandbatsData;
      const data = isChampionsFormat(formatId) ? championsStatPointsToEvs(fetched) : fetched;
      memory.set(formatId, data);
      writeStorage(formatId, data);
      return data;
    } catch (error) {
      // Unlike the !res.ok branch above (an expected "no feed for this format"), a
      // thrown error here is genuinely unexpected — a network failure or a response
      // that isn't valid JSON — so it's worth surfacing, not just silently going info-less.
      console.error(`[hi-chu] failed to fetch randbats data for ${formatId}:`, error);
      return null;
    } finally {
      inFlight.delete(formatId);
    }
  })();
  inFlight.set(formatId, promise);
  return promise;
}
