// Turn calc results and set knowledge into the HTML we splice into Showdown's
// tooltips. The layout deliberately mirrors the original Randbats Tooltip — the
// point of this extension is that familiar look with better numbers underneath:
//
//   renderMoveSection — a "Damage:" line for one move vs the current target
//     (move-button hover), plus KO chance and the true multi-hit breakdown.
//   renderSetsSection — per-set blocks (Pokémon hover): each candidate set kept
//     whole with its Abilities/Items/Tera Types/Moves lines, reveals marked ✓,
//     and damage ranges beside the opponent's possible moves.
//
// Pure: a model in, a string out. That is deliberate — rendering is the part most
// tempting to "just eyeball in the browser", so we make the frame a value and
// snapshot it. No DOM, no @smogon/calc here.

import type {DamageReport, PainSplitReport} from './damage.js';
import type {DamageBucket} from './variants.js';
import type {SpeedOrder, SpeedOutcome} from './speed.js';
import type {Gimmick, KnownOption} from './types.js';

/** Escape the few characters that matter when injecting into innerHTML. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!);
}

/** A 0..1 fraction as a tidy percentage string ("100%", "62.5%"). */
function pct1(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`;
}

/** A raw HP amount as a percentage of the defender's max HP. */
function asPercent(raw: number, maxHP: number): number {
  return Math.round((raw / maxHP) * 1000) / 10;
}

/** Human-readable single-use KO chance. */
export function koText(chance: number): string {
  if (chance >= 0.9995) return 'guaranteed KO';
  if (chance <= 0) return '';
  if (chance < 0.005) return '<1% to KO';
  return `${Math.round(chance * 100)}% to KO`;
}

/** The "≈3.1 hits" / per-hit detail for a multi-hit move. */
function multiHitDetail(r: DamageReport): string {
  if (!r.multiHit) return '';
  const hits = `≈${Math.round(r.multiHit.hits.expected * 10) / 10} hits`;
  const perHit = `${asPercent(r.multiHit.perHit.min, r.defenderMaxHP)}–${asPercent(r.multiHit.perHit.max, r.defenderMaxHP)}% per hit`;
  return `${hits} · ${perHit}`;
}

/** "14.5–17.2%" — compact range for the set-view move lists (parens spot). */
function rangeText(r: DamageReport): string {
  return `${r.percent.min}–${r.percent.max}%`;
}

/** "14.5% - 17.2%" — the native move tooltip's exact "Damage:" number format. */
function moveDamageText(r: DamageReport): string {
  return `${r.percent.min}% - ${r.percent.max}%`;
}

const STYLE_ID = 'hichu-style';

/**
 * A one-time <style> block; the content script injects it once into the page.
 *
 * Near-minimal by design. The original Randbats Tooltip looks crisp because it
 * reuses Showdown's native tooltip markup (`<p>` at 12px black, `<small>` grey
 * labels) and inherits every font/size/colour; we do the same. `.hichu-block` is
 * the one structural rule: it reproduces the native `.tooltip-section` divider
 * (`border-top:1px solid #888; padding:2px 4px`) AND adds the slight grey panel
 * behind our content, so each block is visually separated the way the original's
 * per-set blocks are. Everything else here is our "better calc" surface with no
 * native equivalent — the red KO figure and the orange caveat line.
 */
export const TOOLTIP_STYLE = `
<style id="${STYLE_ID}">
.hichu-block { border-top: 1px solid #888; padding: 2px 4px; background: rgba(0,0,0,.045); }
.hichu-block p { margin: 0; }
.hichu-ko { color: #c0392b; font-weight: bold; }
.hichu-note { color: #b9770e; }
</style>`;

/**
 * One visually-separated block: the native `.tooltip-section` divider + slight grey
 * panel, holding plain native `<p>`s (empty lines dropped, so an absent KO/Hits line
 * leaves no gap). Each candidate set is its own block; the move tooltip is one block.
 */
function block(lines: readonly string[]): string {
  const ps = lines
    .filter((l) => l !== '')
    .map((l) => `<p>${l}</p>`)
    .join('');
  return ps ? `<div class="hichu-block">${ps}</div>` : '';
}

/** A trailing caveat block (form change, data drift), or '' when there are none.
 *  Exported as `renderNotes` for the shell's tooltip-wide notes — the open-format
 *  "foe EVs/item assumed" line attaches ONCE per tooltip, after the per-foe sections,
 *  so a doubles hover doesn't repeat it. */
function notesBlock(notes: readonly string[]): string {
  if (notes.length === 0) return '';
  return block(notes.map((n) => `<span class="hichu-note">⚠ ${esc(n)}</span>`));
}

export const renderNotes = notesBlock;

// --- Move-button hover: one move vs the current target ----------------------

export interface MoveRenderModel {
  /** Defender current HP as a fraction in [0,1] — KO chance is relative to it. */
  readonly defenderHpPercent: number;
  /** Active Tera types, if terastallized — shown so a surprising number explains itself. */
  readonly attackerTera?: string;
  readonly defenderTera?: string;
  /**
   * The distinct damage outcomes vs the target. Empty for status/unmodellable moves
   * (→ no section). One bucket (item known, or every possible item deals the same) →
   * the plain "Damage:" line. Two or more (an Assault Vest that changes the number) →
   * one labelled line each.
   */
  readonly buckets: readonly DamageBucket[];
  /** Whether the foe's Leftovers is 'certain' (revealed) or 'possible' (a still-open item),
   *  which decides how the nHKO ladder reflects between-turn recovery. Undefined = neither. */
  readonly leftovers?: 'certain' | 'possible';
  /** Whether the foe's Focus Sash is 'certain' (revealed, unconsumed) or 'possible'. From
   *  full HP it turns a single-hit KO into surviving at 1 HP, so the KO line carries a
   *  caveat — for single-hit moves only (a multi-hit move breaks the Sash mid-sequence
   *  and usually KOes anyway). Undefined = neither. */
  readonly focusSash?: 'certain' | 'possible';
  /** The target's name — shown as a header only in doubles, where "which foe" is ambiguous;
   *  singles omits it (native tooltips already name the sole target). */
  readonly targetLabel?: string;
  readonly extraNotes: readonly string[];
}

/** A "vs Corviknight" header, or '' — used to tell doubles' two targets apart. */
function targetHeader(label: string | undefined): string {
  return label ? `<small>vs</small> <b>${esc(label)}</b>` : '';
}

/** "2HKO 96% · 3HKO 100%" from a cumulative KO-by-turn ladder, stopping at the first
 *  guaranteed turn. Starts at 2HKO — the OHKO chance is already on the KO line. */
function nhkoLadderText(ladder: readonly number[]): string {
  const parts: string[] = [];
  for (let i = 1; i < ladder.length; i++) {
    const p = ladder[i] ?? 0;
    if (p < 0.005) continue; // skip turns with no real KO chance — only relevant lines
    parts.push(`${i + 1}HKO ${Math.round(p * 100)}%`);
    if (p >= 0.995) break; // guaranteed by this turn — nothing more to say
  }
  return parts.join(' · ');
}

/** The nHKO line — shown only when there's a relevant multi-turn KO (not a guaranteed OHKO,
 *  not a can't-even-3HKO). `certain` Leftovers bakes recovery into the figure; `possible`
 *  shows it as an "if Leftovers" aside. */
function nhkoLine(nhko: DamageReport['nhko'], leftovers: MoveRenderModel['leftovers']): string {
  if (!nhko || (nhko.base[0] ?? 0) >= 0.995) return '';
  const body = nhkoLadderText(leftovers === 'certain' ? nhko.withLeftovers : nhko.base);
  if (!body) return '';
  const asideBody = leftovers === 'possible' ? nhkoLadderText(nhko.withLeftovers) : '';
  const aside = asideBody ? ` <small>(${asideBody} w/ Leftovers)</small>` : '';
  return `${body}${aside}`; // no label — "2HKO 91% · 3HKO 100%" reads for itself
}

/** The Focus Sash caveat on a KO claim, or ''. Only an honest case shows it: a single-hit
 *  move (a multi-hit move pops the Sash mid-sequence and the remaining hits still land)
 *  into a full-HP foe (the Sash does nothing once damaged) with a real KO chance to deny. */
function sashAside(r: DamageReport, model: MoveRenderModel): string {
  if (!model.focusSash || r.multiHit || r.koChance <= 0) return '';
  if (model.defenderHpPercent < 0.995) return '';
  const prefix = model.focusSash === 'possible' ? 'if ' : '';
  return ` <small>(${prefix}Focus Sash: survives at 1 HP)</small>`;
}

function teraTag(attackerTera: string | undefined, defenderTera: string | undefined): string {
  const bits: string[] = [];
  if (attackerTera) bits.push(`Tera ${esc(attackerTera)}`);
  if (defenderTera) bits.push(`vs Tera ${esc(defenderTera)}`);
  return bits.length ? ` <small>[${bits.join(' ')}]</small>` : '';
}

/** One labelled outcome when the target's item is uncertain: "Damage (Assault Vest):
 *  53% - 63% · no KO", compact on one line so several buckets stay in one block. */
function variantLine(bucket: DamageBucket, model: MoveRenderModel, tera: string): string {
  const r = bucket.report;
  const ko = koText(r.koChance);
  const koCtx = ko && model.defenderHpPercent < 0.995 ? ` at ${pct1(model.defenderHpPercent)} HP` : '';
  const koPart = ko ? ` · <span class="hichu-ko">${ko}</span>${koCtx}` : ''; // omit entirely when there's no KO
  const multi = multiHitDetail(r);
  return `<small>Damage (${esc(bucket.label)}):</small> ${moveDamageText(r)}${tera}${koPart}${multi ? ` · ${esc(multi)}` : ''}`;
}

/**
 * The move-tooltip section, at parity with the native "Damage: X% - Y%" line — no
 * "vs <target>" preamble (the native tooltip already names the target and typing).
 * A non-damaging move gets NO section at all (returns ''), matching the original,
 * which inserts nothing when there's no damage to show. Our better-calc value — the
 * true KO chance and the real multi-hit breakdown — rides along only when it applies.
 *
 * When the target's item is unknown and it changes the number (an Assault Vest that
 * might or might not be there), each distinct outcome gets its own labelled line;
 * when it's known — or every possible item deals the same — it's the plain line.
 */
export function renderMoveSection(model: MoveRenderModel): string {
  if (model.buckets.length === 0) return ''; // status / unmodellable move → insert nothing

  const tera = teraTag(model.attackerTera, model.defenderTera);

  if (model.buckets.length === 1) {
    const r = model.buckets[0]!.report;
    const ko = koText(r.koChance);
    const koCtx = model.defenderHpPercent < 0.995 ? ` at ${pct1(model.defenderHpPercent)} HP` : '';
    const multi = multiHitDetail(r);
    return (
      block([
        targetHeader(model.targetLabel),
        `<small>Damage:</small> ${moveDamageText(r)}${tera}`,
        ko ? `<span class="hichu-ko">${ko}</span>${koCtx}${sashAside(r, model)}` : '', // "12% to KO" reads for itself
        nhkoLine(r.nhko, model.leftovers),
        multi ? `<small>Hits:</small> ${esc(multi)}` : '',
      ]) + notesBlock(model.extraNotes)
    );
  }

  const lines = model.buckets.map((b, i) => variantLine(b, model, i === 0 ? tera : ''));
  return block([targetHeader(model.targetLabel), ...lines]) + notesBlock(model.extraNotes);
}

/** One side's HP swing: "28% → 61% (+33%)", the delta signed (negative when it loses). */
function hpSwing(side: {before: number; after: number}): string {
  const delta = Math.round((side.after - side.before) * 10) / 10;
  return `${side.before}% → ${side.after}% (${delta >= 0 ? '+' : ''}${delta}%)`;
}

/**
 * Pain Split's HP redistribution as its own block — the move deals no damage, so the
 * normal move section shows nothing; this replaces the blank with the swing on both sides.
 */
export function renderPainSplit(r: PainSplitReport, targetLabel?: string): string {
  return block([targetHeader(targetLabel), `<small>Pain Split:</small> you ${hpSwing(r.user)} · foe ${hpSwing(r.foe)}`]);
}

// --- Pokémon hover: the speed-order line -------------------------------------

/** One our-active × hovered-foe speed verdict; `ourName` names our side of the pair,
 *  shown only in doubles (singles has one active — naming it would be noise). */
export interface SpeedLineModel {
  readonly order: SpeedOrder;
  readonly ourName?: string;
}

/** The verdict, red when the foe acts first (that's the threat, like the KO figure). */
function verdictText(first: SpeedOutcome['first'], long: boolean): string {
  if (first === 'tie') return 'speed tie';
  if (first === 'ours') return long ? 'you move first' : 'you do';
  const text = long ? 'they move first' : 'they do';
  return `<span class="hichu-ko">${text}</span>`;
}

/** "⚡ you move first — 231 vs 213 · if Choice Scarf: they do (319)". The lead outcome
 *  is the one most surviving sets share (speedBuckets orders it first); every other
 *  possible speed rides along as an "if <what differs>" aside. Numbers are always
 *  OURS vs THEIRS. Trick Room already flipped the verdicts in core/speed.ts — the
 *  prefix here just says why the slower number is winning. */
function speedLine(model: SpeedLineModel): string {
  const {order, ourName} = model;
  const [lead, ...asides] = order.outcomes;
  if (!lead) return '';
  const name = ourName ? `<small>your ${esc(ourName)}:</small> ` : '';
  const room = order.trickRoom ? '<small>Trick Room:</small> ' : '';
  const head = `⚡ ${name}${room}${verdictText(lead.first, true)} — ${order.ourSpeed} vs ${lead.speed}`;
  const tail = asides.map((a) => `<small>if ${esc(a.label)}:</small> ${verdictText(a.first, false)} (${a.speed})`);
  return [head, ...tail].join(' · ');
}

/** The speed-order block: one line per our active (one in singles, two in doubles).
 *  Rendered above the candidate-set blocks — it's the at-a-glance answer. */
export function renderSpeedSection(lines: readonly SpeedLineModel[]): string {
  return block(lines.map(speedLine));
}

// --- Pokémon hover (own side): your moves' damage vs the foe active ---------

/** One of OUR moves vs the foe: its distinct damage outcomes. Usually one bucket;
 *  a hidden defensive item on the foe (Assault Vest) splits it, labelled like the
 *  move tooltip's variant lines. */
export interface OwnMoveLineModel {
  readonly name: string;
  readonly buckets: readonly DamageBucket[];
}

/** One foe active's worth of our-move damage (one in singles, two in doubles). */
export interface OwnMovesModel {
  readonly foeName: string;
  /** Foe current HP as a fraction in [0,1] — KO chances are relative to it. */
  readonly defenderHpPercent: number;
  readonly moves: readonly OwnMoveLineModel[];
}

/** "Draco Meteor: 62.5% - 74.1% · 43% to KO" — one line per damaging move, each
 *  distinct outcome labelled by what sets it apart when the foe's item splits it. */
function ownMoveLine(row: OwnMoveLineModel, model: OwnMovesModel): string {
  const outcomes = row.buckets.map((b) => {
    const r = b.report;
    const ko = koText(r.koChance);
    const koCtx = ko && model.defenderHpPercent < 0.995 ? ` at ${pct1(model.defenderHpPercent)} HP` : '';
    const koPart = ko ? ` · <span class="hichu-ko">${ko}</span>${koCtx}` : '';
    const label = b.label ? `<small>(${esc(b.label)})</small> ` : '';
    return `${label}${moveDamageText(r)}${koPart}`;
  });
  return `${esc(row.name)}: ${outcomes.join(' · ')}`;
}

/**
 * The own-hover matchup block: OUR Pokémon's real moves, each with its damage into
 * the current foe active — the switch-decision view (a benched Pokémon's move
 * buttons aren't hoverable, so this is where its numbers live, mirroring how the
 * foe view attaches threat numbers to their unhoverable moves). One block per foe,
 * headed "vs <name>" — the tooltip is about OUR Pokémon, so the target needs
 * naming even in singles. Status moves never reach the model; a foe with no
 * modellable move yields no block.
 */
export function renderOwnMovesSection(sections: readonly OwnMovesModel[]): string {
  return sections
    .filter((s) => s.moves.length > 0)
    .map((s) => block([targetHeader(s.foeName), ...s.moves.map((row) => ownMoveLine(row, s))]))
    .join('');
}

// --- Pokémon hover: per-set blocks, the original's layout -------------------

/** One move in a set block; `report` carries its damage vs our active (foe view). */
export interface MoveKnowledgeRow {
  readonly name: string;
  readonly known: boolean;
  readonly report?: DamageReport;
}

/** One candidate set rendered as its own block, exactly like the original. */
export interface CandidateBlock {
  readonly name: string;
  /** Set only for an Illusion candidate: the species the mon might SECRETLY be (Zoroark),
   *  which differs from the hovered species. Rendered as a "possible Illusion" header. */
  readonly species?: string;
  readonly abilities: readonly KnownOption[];
  readonly items: readonly KnownOption[];
  readonly moves: readonly MoveKnowledgeRow[];
  readonly gimmicks: readonly Gimmick[];
}

export interface SetsRenderModel {
  readonly candidates: readonly CandidateBlock[];
  readonly extraNotes: readonly string[];
}

/** "✓ Leftovers" in bold once confirmed; plain names while still open. */
function optionText(o: KnownOption): string {
  return o.known ? `<b>✓ ${esc(o.name)}</b>` : esc(o.name);
}

/** A labelled line ("Abilities: …"), or '' when the dimension has no options. */
function optionLine(label: string, options: readonly KnownOption[]): string {
  if (options.length === 0) return '';
  return `<small>${label}:</small> ${options.map(optionText).join(', ')}`;
}

/** A move entry: "✓ Giga Drain (63.9–75.3%)" — damage in the original's parens spot. */
function moveText(row: MoveKnowledgeRow): string {
  const name = row.known ? `<b>✓ ${esc(row.name)}</b>` : esc(row.name);
  return row.report ? `${name} (${rangeText(row.report)})` : name;
}

/** One gimmick's labelled line. The exhaustive switch is the whole point of the
 *  variant: a new gimmick (a `zmove` case) won't compile until it's rendered. */
function gimmickLine(g: Gimmick): string {
  switch (g.kind) {
    case 'tera':
      return optionLine('Tera Types', g.types);
    case 'mega':
      return `<small>Mega:</small> ${optionText(g.stone)} → ${esc(g.forme)}`;
    case 'zmove':
      return `<small>Z-Move:</small> ${optionText(g.crystal)}`;
    default:
      return ((_: never) => '')(g); // exhaustiveness guard — unreachable
  }
}

/** One candidate set's lines: underlined name (native weight), then labelled lines. An
 *  Illusion candidate leads with the species it might secretly be, flagged as a maybe. */
function setLines(c: CandidateBlock): string[] {
  const underline = (t: string): string => `<span style="text-decoration: underline;">${esc(t)}</span>`;
  const name = c.species
    ? `⚠ ${underline(c.species)} <small>(if Illusion${c.name ? ` · ${esc(c.name)}` : ''})</small>`
    : c.name ? underline(c.name) : '';
  return [
    name,
    optionLine('Abilities', c.abilities),
    optionLine('Items', c.items),
    ...c.gimmicks.map(gimmickLine),
    `<small>Moves:</small> ${c.moves.map(moveText).join(', ')}`,
  ];
}

/**
 * The Pokémon-tooltip section: one underlined-named, grey-panelled block per
 * still-possible set — the original Randbats Tooltip's layout, native markup
 * throughout, each set divided from the next. No summary header (the blocks speak
 * for themselves); confirmed facts are bold with a ✓. The foe view's move lists
 * carry damage vs our active in parens (their move buttons aren't hoverable for us,
 * so threat numbers live here); the own-side mirror simply omits the numbers.
 */
export function renderSetsSection(model: SetsRenderModel): string {
  const blocks = model.candidates.map((c) => block(setLines(c))).join('');
  return blocks + notesBlock(model.extraNotes);
}
