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

import type {DamageReport} from './damage.js';
import type {KnownOption} from './types.js';

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
  if (r.approximate || !r.hits || !r.perHit) return 'multi-hit (approx.)';
  const hits = `≈${Math.round(r.hits.expected * 10) / 10} hits`;
  const perHit = `${asPercent(r.perHit.min, r.defenderMaxHP)}–${asPercent(r.perHit.max, r.defenderMaxHP)}% per hit`;
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

/** A trailing caveat block (form change, data drift), or '' when there are none. */
function notesBlock(notes: readonly string[]): string {
  if (notes.length === 0) return '';
  return block(notes.map((n) => `<span class="hichu-note">⚠ ${esc(n)}</span>`));
}

// --- Move-button hover: one move vs the current target ----------------------

export interface MoveRenderModel {
  /** Defender current HP as a fraction in [0,1] — KO chance is relative to it. */
  readonly defenderHpPercent: number;
  /** Active Tera types, if terastallized — shown so a surprising number explains itself. */
  readonly attackerTera?: string;
  readonly defenderTera?: string;
  /** Absent for status moves and moves the calc can't model. */
  readonly report?: DamageReport;
  readonly extraNotes: readonly string[];
}

function teraTag(attackerTera: string | undefined, defenderTera: string | undefined): string {
  const bits: string[] = [];
  if (attackerTera) bits.push(`Tera ${esc(attackerTera)}`);
  if (defenderTera) bits.push(`vs Tera ${esc(defenderTera)}`);
  return bits.length ? ` <small>[${bits.join(' ')}]</small>` : '';
}

/**
 * The move-tooltip section, at parity with the native "Damage: X% - Y%" line — no
 * "vs <target>" preamble (the native tooltip already names the target and typing).
 * A non-damaging move gets NO section at all (returns ''), matching the original,
 * which inserts nothing when there's no damage to show. Our better-calc value — the
 * true KO chance and the real multi-hit breakdown — rides along only when it applies.
 */
export function renderMoveSection(model: MoveRenderModel): string {
  const r = model.report;
  if (!r) return ''; // status / unmodellable move → insert nothing

  const tera = teraTag(model.attackerTera, model.defenderTera);
  const ko = koText(r.koChance);
  const koCtx = model.defenderHpPercent < 0.995 ? ` at ${pct1(model.defenderHpPercent)} HP` : '';
  const multi = multiHitDetail(r);

  return (
    block([
      `<small>Damage:</small> ${moveDamageText(r)}${tera}`,
      ko ? `<small>KO:</small> <span class="hichu-ko">${ko}</span>${koCtx}` : '',
      multi ? `<small>Hits:</small> ${esc(multi)}` : '',
    ]) + notesBlock(model.extraNotes)
  );
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
  readonly abilities: readonly KnownOption[];
  readonly items: readonly KnownOption[];
  readonly teraTypes: readonly KnownOption[];
  readonly moves: readonly MoveKnowledgeRow[];
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

/** One candidate set's lines: underlined name (native weight), then labelled lines. */
function setLines(c: CandidateBlock): string[] {
  const name = c.name ? `<span style="text-decoration: underline;">${esc(c.name)}</span>` : '';
  return [
    name,
    optionLine('Abilities', c.abilities),
    optionLine('Items', c.items),
    optionLine('Tera Types', c.teraTypes),
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
