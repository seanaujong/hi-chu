// Fetch + cache the randbats set data from pkmn.github.io.
//
// The feed is public and CORS-open (`access-control-allow-origin: *`), so the
// content script can fetch it directly from the page. We cache per format in
// memory for the session and in localStorage with a TTL so repeat visits are
// instant and resilient to the feed being briefly unreachable.

import type {RandbatsData, RandbatsEntry, RandbatsRole, StatID, StatsTable} from '../core/types.js';

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
    } catch {
      return null;
    } finally {
      inFlight.delete(formatId);
    }
  })();
  inFlight.set(formatId, promise);
  return promise;
}

// The raw feed omits any array dimension that would be empty. The
// gen9championsrandombattle feed ships NO `teraTypes` on any role and NO `items`
// on item-less roles (Charizard, Emolga); older gens omit others. So a straight
// `as RandbatsData` cast lies about the shape. These loose views name that truth
// at the boundary; `normalizeEntry` totalizes so the core reads clean arrays and
// never has to branch on which format's feed it was handed.
interface RawRole {
  readonly abilities?: readonly string[];
  readonly items?: readonly string[];
  readonly teraTypes?: readonly string[];
  readonly moves?: readonly string[];
  readonly evs?: StatsTable;
  readonly ivs?: StatsTable;
}
interface RawEntry {
  readonly level: number;
  readonly abilities?: readonly string[];
  readonly items?: readonly string[];
  readonly teraTypes?: readonly string[];
  readonly moves?: readonly string[];
  readonly roles?: Readonly<Record<string, RawRole>>;
  readonly evs?: StatsTable;
  readonly ivs?: StatsTable;
}

// Champions has no EVs or IVs — each stat carries 0+ "stat points", and the feed's
// `evs` field holds those POINTS, not EVs. Showdown's Champions mod substitutes
// `max(2·points − 1, 0)` where the mainline stat formula has `IV + ⌊EV/4⌋`, with
// IVs hardcoded to 31 (data/mods/champions/scripts.ts, statModify). @smogon/calc
// only speaks the mainline formula, so feeding it points literally deflates every
// stat on both mons (e.g. the feed-wide `11` reads as ⌊11/4⌋ = 2 formula points
// instead of the real 2·11 − 1 = 21 ≡ 85 mainline EVs). The conversion that makes
// both formulas agree exactly, for any point count: EV = 8·points − 4, since
// ⌊(8p − 4)/4⌋ = 2p − 1. Keyed on the format id — mainline feeds' `evs` ARE EVs
// and must pass through untouched. fetchRandbats is the only live entry point, so
// converting there covers every consumer (a captured champions FIXTURE must apply
// championsStatPointsToEvs itself).
const isChampionsFormat = (formatId: string): boolean => formatId.includes('champions');

function pointsToEvs(stats: StatsTable): StatsTable {
  const out: StatsTable = {};
  for (const [k, points] of Object.entries(stats) as [StatID, number][]) {
    out[k] = points <= 0 ? 0 : 8 * points - 4;
  }
  return out;
}

/** Convert a Champions feed's stat points to the mainline-EV currency the calc speaks. */
export function championsStatPointsToEvs(data: RandbatsData): RandbatsData {
  const raw = data as unknown as Readonly<Record<string, RawEntry>>;
  const convertRole = (r: RawRole): RawRole => ({...r, ...(r.evs !== undefined ? {evs: pointsToEvs(r.evs)} : {})});
  const convertEntry = (e: RawEntry): RawEntry => ({
    ...e,
    ...(e.evs !== undefined ? {evs: pointsToEvs(e.evs)} : {}),
    ...(e.roles ? {roles: Object.fromEntries(Object.entries(e.roles).map(([n, r]) => [n, convertRole(r)]))} : {}),
  });
  return Object.fromEntries(Object.entries(raw).map(([name, e]) => [name, convertEntry(e)])) as unknown as RandbatsData;
}

function normalizeRole(r: RawRole): RandbatsRole {
  return {
    abilities: r.abilities ?? [],
    items: r.items ?? [],
    teraTypes: r.teraTypes ?? [],
    moves: r.moves ?? [],
    ...(r.evs !== undefined ? {evs: r.evs} : {}),
    ...(r.ivs !== undefined ? {ivs: r.ivs} : {}),
  };
}

/** Totalize one raw feed entry so every array the core reads is present (possibly empty). */
function normalizeEntry(e: RawEntry): RandbatsEntry {
  return {
    level: e.level,
    abilities: e.abilities ?? [],
    items: e.items ?? [],
    teraTypes: e.teraTypes ?? [],
    moves: e.moves ?? [],
    ...(e.roles ? {roles: Object.fromEntries(Object.entries(e.roles).map(([n, r]) => [n, normalizeRole(r)]))} : {}),
    ...(e.evs !== undefined ? {evs: e.evs} : {}),
    ...(e.ivs !== undefined ? {ivs: e.ivs} : {}),
  };
}

/**
 * Find a species' entry, tolerating forme names the feed may not key exactly.
 * Tries the full forme, then progressively drops trailing "-suffix" segments
 * (e.g. "Greninja-Bond" → "Greninja"), so cosmetic/battle formes still resolve.
 * The found entry is normalized — this is the single seam between the loose feed
 * and the core, so every entry the core sees has total array dimensions.
 */
export function pickEntry(data: RandbatsData, speciesForme: string): RandbatsEntry | undefined {
  const raw = data as unknown as Readonly<Record<string, RawEntry>>;
  if (raw[speciesForme]) return normalizeEntry(raw[speciesForme]!);
  const parts = speciesForme.split('-');
  for (let n = parts.length - 1; n >= 1; n--) {
    const candidate = parts.slice(0, n).join('-');
    if (raw[candidate]) return normalizeEntry(raw[candidate]!);
  }
  return undefined;
}

const asId = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The Mega-forme entry a held item unlocks, or undefined if the item isn't a Mega stone in
 * this feed. A mon holding a Mega stone is running the MEGA set even before it evolves, but
 * its live forme is still the base one — so a plain `pickEntry` on the forme returns the
 * wrong (non-Mega) set. Champions also keys Mega sets irregularly (a Floette-Eternal holding
 * Floettite becomes "Floette-Mega", dropping "Eternal"), so we find the set by its STONE —
 * the one Mega entry whose item pool holds it — rather than by mangling the species name.
 */
export function megaEntryForItem(data: RandbatsData, item: string | undefined): RandbatsEntry | undefined {
  if (!item) return undefined;
  const wanted = asId(item);
  const raw = data as unknown as Readonly<Record<string, RawEntry>>;
  for (const [key, entry] of Object.entries(raw)) {
    if (!/-Mega(-[XY])?$/.test(key)) continue; // only Mega-forme entries hold stones
    const e = normalizeEntry(entry);
    const items = e.roles ? Object.values(e.roles).flatMap((r) => r.items) : e.items;
    if (items.some((i) => asId(i) === wanted)) return e;
  }
  return undefined;
}
