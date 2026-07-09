// The shell's orchestration, made pure and testable: given the live battle, the
// hovered thing, and the randbats data for the format, fold
//   read → infer/resolve → calc → render
// into tooltip section HTML. No DOM, no cache, no network — content.ts owns that
// plumbing and hands the cached data in. Keeping this pure is what lets the
// real-battle fixture test (section.test.ts) drive the exact code path a live hover
// runs, instead of a copy that can drift from it.
//
// Two entry points, one per tooltip we augment:
//   buildMoveSection    — a move-button hover: that move's damage vs the opposing active.
//   buildPokemonSection — a Pokémon hover: the still-possible sets (narrowed by reveals),
//     with damage numbers attached when the hovered mon is the opponent's.

import {calcDamage, painSplit, type DamageReport} from './core/damage.js';
import {resolveByRole, resolveMon, resolveVariants} from './core/resolve.js';
import {inferSets} from './core/knowledge.js';
import {bucketByDamage, type DamageBucket} from './core/variants.js';
import {compareSpeed, finalSpeed, speedBuckets} from './core/speed.js';
import {illusionSuspects, ILLUSION_SPECIES, type IllusionSuspect} from './core/illusion.js';
import {
  renderMoveSection,
  renderPainSplit,
  renderSetsSection,
  renderSpeedSection,
  type CandidateBlock,
  type MoveKnowledgeRow,
  type SetsRenderModel,
  type SpeedLineModel,
} from './core/render.js';
import type {CandidateSet, LiveFacts, RandbatsData, RandbatsEntry, ResolvedMon, SetVariant} from './core/types.js';
import {pickEntry, megaEntryForItem} from './data/randbats.js';
import {
  toLiveFacts,
  readBehaviors,
  readOwnItem,
  readOwnTeraType,
  readSpeciesData,
  findOpposingActive,
  findOpposingActives,
  detectFormat,
  readFieldFacts,
  type ClientBattle,
  type ClientPokemon,
} from './battle/readState.js';

/** All of one Pokémon's live facts: the snapshot, the log-derived behaviours, and the
 *  client dex's species data (the calc's fallback for formes its own dex lacks). */
function factsFor(battle: ClientBattle, mon: ClientPokemon): LiveFacts {
  return toLiveFacts(mon, readBehaviors(battle, mon), readSpeciesData(battle, mon));
}

/** Showdown id form: lowercase, alphanumerics only ("Ice Punch" → "icepunch"). */
function toId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A defender entry when the feed doesn't cover it: facts only, default spread. */
function entryOrMinimal(entry: RandbatsEntry | undefined, facts: LiveFacts): RandbatsEntry {
  return entry ?? {level: facts.level, abilities: [], items: []};
}

/** The mon's set entry: the Mega set when it holds a Mega stone (it's running that set even
 *  before it evolves — see `megaEntryForItem`), otherwise the forme's own entry. */
function entryFor(data: RandbatsData, facts: LiveFacts): RandbatsEntry | undefined {
  return megaEntryForItem(data, facts.item) ?? pickEntry(data, facts.speciesForme);
}

/**
 * The viewer's OWN item for their active, as a display name the calc honours — read from
 * the private team and matched to `entry`'s item pool by id. Move buttons are always your
 * own Pokémon, and you know your item even when it's silent to the opponent (Heavy-Duty
 * Boots), so this makes your own damage exact instead of assuming the set's first item.
 * `undefined` when spectating, when nothing matches, or when the pool is unknown — in
 * which case the caller keeps the public-info behaviour. Matching by id is what bridges
 * the client's id form ("heavydutyboots") to the name @smogon/calc needs.
 */
function ownItemName(battle: ClientBattle, pokemon: ClientPokemon, entry: RandbatsEntry): string | undefined {
  const raw = readOwnItem(battle, pokemon);
  if (!raw) return undefined;
  const roleItems = entry.roles ? Object.values(entry.roles).flatMap((r) => r.items) : [];
  const pool = [...roleItems, ...(entry.items ?? [])];
  return pool.find((i) => toId(i) === toId(raw));
}

/**
 * If a revealed move betrays that the defender might be a disguised Zoroark (see
 * illusion.ts), a resolution of that Zoroark as an extra defender — so the move tooltip
 * shows a second "vs Zoroark-Hisui" damage line rather than one confidently-wrong number.
 * One representative set per suspect (not the full item fan-out) keeps the extra line to
 * a single, clearly-labelled bucket. Its own species/level drive the calc.
 */
function illusionVariants(defenderFacts: LiveFacts, defenderEntry: RandbatsEntry | undefined, data: RandbatsData): SetVariant[] {
  // The suspect is a DIFFERENT species than shown, so the shown forme's dex data
  // (facts.speciesData) must not ride along into the Zoroark's resolution.
  const {speciesData: _shownFormes, ...publicFacts} = defenderFacts;
  return suspectsFor(defenderFacts, defenderEntry, data).map(({species, entry}) => ({
    mon: resolveMon({...publicFacts, speciesForme: species, level: entry.level}, entry),
    role: species,
  }));
}

/** The Zoroark species the hovered mon might secretly be, given the feed's entries. */
function suspectsFor(facts: LiveFacts, entry: RandbatsEntry | undefined, data: RandbatsData): IllusionSuspect[] {
  const impostors = ILLUSION_SPECIES
    .map((species): IllusionSuspect | null => {
      const e = pickEntry(data, species);
      return e ? {species, entry: e} : null;
    })
    .filter((x): x is IllusionSuspect => x !== null);
  return illusionSuspects(facts, entry, impostors);
}

/**
 * The ⚡ speed-order line(s) for a hovered FOE: one per our active (one in singles,
 * both in doubles), each judging OUR effective speed against the foe's distinct
 * possible speeds (Scarf and weather-ability sets split into "if …" asides; a
 * possible disguised Zoroark rides along as its own outcome). Our side of the pair
 * uses our REAL item — private facts may feed any our-view surface; the own-side
 * mirror never gets this line at all, so it stays strictly public.
 */
function speedSection(
  battle: ClientBattle,
  foeVariants: readonly SetVariant[],
  ourActives: readonly ClientPokemon[],
  data: RandbatsData,
  format: {gen: number},
): string {
  if (foeVariants.length === 0) return '';
  const lines = ourActives.map((our): SpeedLineModel => {
    const publicFacts = factsFor(battle, our);
    const ourEntry = entryFor(data, publicFacts);
    const realItem = ourEntry ? ownItemName(battle, our, ourEntry) : undefined;
    const ourFacts = realItem ? {...publicFacts, item: realItem} : publicFacts;
    const ourMon = resolveMon(ourFacts, entryOrMinimal(ourEntry, ourFacts));
    // Field read with OUR side as the defender, so defenderTailwind is ours and
    // attackerTailwind the foe's; weather/terrain/Trick Room are battle-wide.
    const field = readFieldFacts(battle, our.side);
    const ourSpeed = finalSpeed(ourMon, {gen: format.gen, field, tailwind: Boolean(field.defenderTailwind)});
    const foe = speedBuckets(foeVariants, {gen: format.gen, field, tailwind: Boolean(field.attackerTailwind)});
    const order = compareSpeed(ourSpeed, foe, Boolean(field.trickRoom));
    return {order, ...(ourActives.length > 1 ? {ourName: publicFacts.speciesForme} : {})};
  });
  return renderSpeedSection(lines);
}

/** True when the hovered Pokémon belongs to the opponent (the far side, from our seat). */
function isFoe(battle: ClientBattle, pokemon: ClientPokemon): boolean {
  if (pokemon.side?.isFar !== undefined) return pokemon.side.isFar;
  return pokemon.side === battle.sides[1]; // client default: near side is sides[0]
}

/**
 * The damage reports for `attacker`'s moves into `defender`, keyed by move id.
 * Status moves and moves the calc can't model are simply absent.
 */
function reportsByMove(
  attacker: ResolvedMon,
  defender: ResolvedMon,
  moves: readonly string[],
  gen: number,
  field: ReturnType<typeof readFieldFacts>,
): Map<string, DamageReport> {
  const out = new Map<string, DamageReport>();
  for (const move of moves) {
    try {
      const report = calcDamage(attacker, defender, move, {gen, field});
      if (report.category !== 'Status') out.set(toId(move), report);
    } catch {
      // One unmodellable move shouldn't drop the whole section.
    }
  }
  return out;
}

/**
 * The distinct damage outcomes for `moveName` from `attacker` into the target, one
 * per still-possible defending set, merged where they land on the same number. Status
 * and unmodellable variants are dropped; an all-dropped move yields no buckets (→ '').
 */
function moveDamageBuckets(
  attacker: ResolvedMon,
  defenderVariants: readonly SetVariant[],
  moveName: string,
  gen: number,
  field: ReturnType<typeof readFieldFacts>,
  doubles: boolean,
): DamageBucket[] {
  const scored: {variant: SetVariant; report: DamageReport}[] = [];
  for (const variant of defenderVariants) {
    try {
      const report = calcDamage(attacker, variant.mon, moveName, {gen, field, nhkoTurns: 3, doubles});
      if (report.category !== 'Status') scored.push({variant, report});
    } catch {
      // A move outside the calc's world for this variant shouldn't drop the section.
    }
  }
  return bucketByDamage(scored);
}

/**
 * The move-button tooltip section: `moveName` from our active `pokemon` into the
 * opposing active. When the target's item is still unknown and it changes the number
 * (an Assault Vest that may or may not be there), the distinct outcomes each get a
 * labelled line; otherwise it's the plain "Damage:" line. Returns '' when there's
 * nothing to show (not a Random Battle, no target, untracked species, no modellable
 * outcome). `teraSelected` is the move panel's Terastallize checkbox (content.ts reads
 * the DOM): when ticked, the damage previews the Tera as already active.
 */
export function buildMoveSection(
  battle: ClientBattle,
  pokemon: ClientPokemon,
  moveName: string,
  data: RandbatsData,
  teraSelected = false,
): string {
  const format = detectFormat(battle);
  if (!format) return '';

  // Both foes in doubles, one in singles — a damage section per target.
  const foes = findOpposingActives(battle, pokemon);
  if (foes.length === 0) return '';

  const publicFacts = factsFor(battle, pokemon);
  const attackerEntry = entryFor(data, publicFacts);
  if (!attackerEntry) return '';

  // Your move, your damage: prefer your REAL item over the set's assumed first item, so a
  // Heavy-Duty Boots Iron Bundle isn't calculated as Choice Specs. Treated like a revealed
  // fact for resolution — but only here, never in the opponent's-knowledge views.
  const realItem = ownItemName(battle, pokemon, attackerEntry);
  // Terastallize is ticked for this turn: preview the damage with the Tera active, using
  // OUR private Tera type (an our-view surface, like realItem). Not speculation — the type
  // is our own truth and activating it is the user's declared intent. Moot once actually
  // terastallized (the public facts already carry it); absent when spectating.
  const pendingTera = teraSelected && !publicFacts.terastallized ? readOwnTeraType(battle, pokemon) : undefined;
  const attackerFacts = {
    ...publicFacts,
    ...(realItem ? {item: realItem} : {}),
    ...(pendingTera ? {terastallized: true, teraType: pendingTera} : {}),
  };
  const attacker = resolveMon(attackerFacts, attackerEntry);

  // Name each target only when there's more than one (doubles) — singles keeps native parity.
  return foes.map((foe) => moveVsFoe(attacker, foe, moveName, format, data, battle, foes.length > 1)).join('');
}

/** One target's damage section: `attacker`'s `moveName` into `defenderMon`. `label` names the
 *  target (doubles, where "which foe" is ambiguous). The doubles game type flows to the calc
 *  so spread moves take their 0.75×. */
function moveVsFoe(
  attacker: ResolvedMon,
  defenderMon: ClientPokemon,
  moveName: string,
  format: {gen: number; doubles: boolean},
  data: RandbatsData,
  battle: ClientBattle,
  label: boolean,
): string {
  const defenderFacts = factsFor(battle, defenderMon);
  const defenderEntry = entryFor(data, defenderFacts);
  const targetLabel = label ? defenderFacts.speciesForme : undefined;

  // Pain Split deals no damage — it averages both mons' HP — so @smogon/calc has nothing to
  // say and the normal damage path would insert a blank. Show the HP swing instead.
  if (toId(moveName) === 'painsplit') {
    const defender = resolveMon(defenderFacts, entryOrMinimal(defenderEntry, defenderFacts));
    return renderPainSplit(painSplit(attacker, defender, format.gen), targetLabel);
  }

  // The defender's hidden item/ability can each split the damage — enumerate the
  // still-possible sets and let identical outcomes collapse back to one bucket.
  const defenderVariants = [
    ...resolveVariants(defenderFacts, entryOrMinimal(defenderEntry, defenderFacts)),
    ...illusionVariants(defenderFacts, defenderEntry, data),
  ];
  const field = readFieldFacts(battle, defenderMon.side);

  const buckets = moveDamageBuckets(attacker, defenderVariants, moveName, format.gen, field, format.doubles);
  if (buckets.length === 0) return ''; // status / unmodellable move

  // The live Tera is shared by every variant (it's a revealed fact, not a hidden set).
  const defenderTera = defenderVariants[0]?.mon.teraType;
  // How firmly the foe holds `itemId`, read from the RESOLVED variants — so a revealed item
  // is 'certain', a still-open pool entry 'possible', and a knocked-off/consumed item counts
  // as nothing at all (resolveVariants already dropped it; a gone Leftovers heals no one).
  const itemStanding = (itemId: string): 'certain' | 'possible' | undefined => {
    const holders = defenderVariants.filter((v) => toId(v.mon.item ?? '') === itemId).length;
    if (holders === 0) return undefined;
    return holders === defenderVariants.length ? 'certain' : 'possible';
  };
  // Leftovers changes the nHKO ladder (recovery between turns) and Focus Sash denies a
  // single-hit KO from full HP — foe-level facts that qualify the lines without changing
  // the damage rolls, shown only when there's a single outcome to attach them to.
  const leftovers = buckets.length === 1 ? itemStanding('leftovers') : undefined;
  const focusSash = buckets.length === 1 ? itemStanding('focussash') : undefined;
  return renderMoveSection({
    defenderHpPercent: defenderFacts.hpPercent,
    extraNotes: [],
    buckets,
    ...(targetLabel ? {targetLabel} : {}),
    ...(leftovers ? {leftovers} : {}),
    ...(focusSash ? {focusSash} : {}),
    ...(attacker.teraType ? {attackerTera: attacker.teraType} : {}),
    ...(defenderTera ? {defenderTera} : {}),
  });
}

/**
 * One candidate set → a render block, with each move's damage (foe view) attached from
 * THIS set's own item/spread/species. `species` is set only for an Illusion candidate (a
 * Zoroark the hovered mon might secretly be), which the renderer flags as such.
 */
function toBlock(c: CandidateSet, species: string | undefined, damage: Map<string, DamageReport> | undefined): CandidateBlock {
  return {
    name: c.name,
    ...(species ? {species} : {}),
    abilities: c.abilities,
    items: c.items,
    gimmicks: c.gimmicks,
    moves: c.moves.map((m): MoveKnowledgeRow => {
      const report = damage?.get(toId(m.name));
      return {name: m.name, known: m.known, ...(report ? {report} : {})};
    }),
  };
}

/**
 * The Pokémon tooltip section: the still-possible sets, one block per candidate,
 * in the original Randbats Tooltip's layout. Hovering the opponent narrows their
 * sets by every public reveal and attaches each move's damage vs our active;
 * hovering our own Pokémon shows the mirror — what the opponent can deduce from
 * what we've made public. Returns '' when the format or species isn't covered.
 */
export function buildPokemonSection(battle: ClientBattle, pokemon: ClientPokemon, data: RandbatsData): string {
  const format = detectFormat(battle);
  if (!format) return '';

  const facts = factsFor(battle, pokemon);
  const entry = entryFor(data, facts);
  if (!entry) return ''; // not a tracked randbats Pokémon

  const shown = inferSets(facts, entry);
  const notes = shown.uncertainReason ? [shown.uncertainReason] : [];

  // The hovered species, plus any Zoroark it might secretly be (Illusion), as candidate
  // sources. Each contributes its own blocks; an Illusion source tags its blocks with the
  // species it might really be (its own set + species drive that block's damage).
  const sources = [
    {facts, entry, species: undefined as string | undefined, knowledge: shown},
    ...suspectsFor(facts, entry, data).map(({species, entry: e}) => {
      const f: LiveFacts = {...facts, speciesForme: species, level: e.level};
      return {facts: f, entry: e, species: species as string | undefined, knowledge: inferSets(f, e)};
    }),
  ];

  // Foe view: attach each possible move's damage into OUR active (their move buttons
  // aren't hoverable for us). The own-side mirror carries no damage — public info only.
  const foe = isFoe(battle, pokemon);
  const ourMon = foe ? findOpposingActive(battle, pokemon) : null;
  const ourFacts = ourMon ? factsFor(battle, ourMon) : null;
  const defender = ourFacts ? resolveMon(ourFacts, entryOrMinimal(entryFor(data, ourFacts), ourFacts)) : null;
  const field = ourMon ? readFieldFacts(battle, ourMon.side) : undefined;

  const blocks: CandidateBlock[] = [];
  for (const s of sources) {
    const attackers = defender ? resolveByRole(s.facts, s.entry) : []; // aligned 1:1 with candidates
    s.knowledge.candidates.forEach((c, i) => {
      const attacker = attackers[i]?.mon ?? attackers[0]?.mon;
      const damage = defender && attacker && field
        ? reportsByMove(attacker, defender, c.moves.map((m) => m.name), format.gen, field)
        : undefined;
      blocks.push(toBlock(c, s.species, damage));
    });
  }
  if (blocks.every((b) => b.moves.length === 0)) return '';

  // The at-a-glance verdict, above the set blocks. Foe view only: putting a speed
  // read on our own tooltip would mean judging it with private facts, and the
  // mirror's honesty rests on staying strictly public.
  const speedHtml = foe
    ? speedSection(
        battle,
        [...resolveVariants(facts, entry), ...illusionVariants(facts, entry, data)],
        findOpposingActives(battle, pokemon),
        data,
        format,
      )
    : '';

  return speedHtml + renderSetsSection({candidates: blocks, extraNotes: notes});
}
