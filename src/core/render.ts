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

/** "14.5–17.2%" — the damage range alone, matching the original's density. */
function rangeText(r: DamageReport): string {
  return `${r.percent.min}–${r.percent.max}%`;
}

const STYLE_ID = 'hichu-style';

/**
 * A one-time <style> block; the content script injects it once into the page.
 * Native tooltip font size throughout — crispness comes from structure (labelled
 * lines, underlined set names), not from shrinking and dimming.
 */
export const TOOLTIP_STYLE = `
<style id="${STYLE_ID}">
.hichu { margin: 4px 0 0; padding: 2px 0 0; border-top: 1px solid #aaa; }
.hichu p { margin: 2px 0; }
.hichu-set { text-decoration: underline; font-weight: bold; }
.hichu-known { font-weight: bold; }
.hichu-ko { color: #c0392b; font-weight: bold; }
.hichu-note { color: #b9770e; }
</style>`;

// --- Move-button hover: one move vs the current target ----------------------

export interface MoveRenderModel {
  readonly moveName: string;
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

function noteParas(notes: readonly string[]): string {
  return notes.map((n) => `<p class="hichu-note">⚠ ${esc(n)}</p>`).join('');
}

/**
 * The move-tooltip section, in the original's voice: a single bold-labelled
 * "Damage:" line (the native tooltip already names the target and typing), with
 * our KO chance and true multi-hit numbers underneath when they apply.
 */
export function renderMoveSection(model: MoveRenderModel): string {
  const r = model.report;
  const tera = teraTag(model.attackerTera, model.defenderTera);

  if (!r) {
    return `<div class="hichu"><p><b>Damage:</b> — (status move)${tera}</p>${noteParas(model.extraNotes)}</div>`;
  }

  const damage = `<p><b>Damage:</b> ${rangeText(r)} (avg ${r.percent.mean}%)${tera}</p>`;

  const ko = koText(r.koChance);
  const koCtx = model.defenderHpPercent < 0.995 ? ` at ${pct1(model.defenderHpPercent)} HP` : '';
  const koLine = ko ? `<p><b>KO:</b> <span class="hichu-ko">${ko}</span>${koCtx}</p>` : '';

  const multi = multiHitDetail(r);
  const multiLine = multi ? `<p><b>Hits:</b> ${esc(multi)}</p>` : '';

  return `<div class="hichu">${damage}${koLine}${multiLine}${noteParas(model.extraNotes)}</div>`;
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
  /** 'foe' = what could they have; 'own' = what can they deduce about us. */
  readonly perspective: 'foe' | 'own';
  readonly totalRoles: number;
  readonly candidates: readonly CandidateBlock[];
  /** Foe view: who their moves are being calculated against, at what HP. */
  readonly defenderName?: string;
  readonly defenderHpPercent?: number;
  readonly attackerTera?: string;
  readonly defenderTera?: string;
  readonly extraNotes: readonly string[];
}

/** "✓ Leftovers" in bold once confirmed; plain names while still open. */
function optionText(o: KnownOption): string {
  return o.known ? `<span class="hichu-known">✓ ${esc(o.name)}</span>` : esc(o.name);
}

function optionLine(label: string, options: readonly KnownOption[]): string {
  if (options.length === 0) return '';
  return `<p><small>${label}:</small> ${options.map(optionText).join(', ')}</p>`;
}

/** A move entry: "✓ Giga Drain (63.9–75.3%)" — damage in the original's parens spot. */
function moveText(row: MoveKnowledgeRow): string {
  const name = row.known ? `<span class="hichu-known">✓ ${esc(row.name)}</span>` : esc(row.name);
  return row.report ? `${name} (${rangeText(row.report)})` : name;
}

function setBlock(c: CandidateBlock): string {
  const title = c.name ? `<p class="hichu-set">${esc(c.name)}</p>` : '';
  return (
    title +
    optionLine('Abilities', c.abilities) +
    optionLine('Items', c.items) +
    optionLine('Tera Types', c.teraTypes) +
    `<p><small>Moves:</small> ${c.moves.map(moveText).join(', ')}</p>`
  );
}

/**
 * The Pokémon-tooltip section: one block per still-possible set, confirmed facts
 * bold with a ✓. The foe view's move lists carry damage vs our active in parens
 * (their move buttons aren't hoverable for us, so threat numbers live here).
 */
export function renderSetsSection(model: SetsRenderModel): string {
  const count = model.totalRoles > 1 ? ` (${model.candidates.length} of ${model.totalRoles} sets)` : '';
  const vsTarget =
    model.perspective === 'foe' && model.defenderName !== undefined && model.defenderHpPercent !== undefined
      ? ` · dmg vs ${esc(model.defenderName)} (${pct1(model.defenderHpPercent)} HP)`
      : '';
  const title = model.perspective === 'foe' ? 'Possible sets' : 'Their read on you';
  const header =
    `<p><b>${title}</b>${count}${esc(vsTarget)}${teraTag(model.attackerTera, model.defenderTera)}</p>`;

  const blocks = model.candidates.map(setBlock).join('');
  return `<div class="hichu">${header}${blocks}${noteParas(model.extraNotes)}</div>`;
}
