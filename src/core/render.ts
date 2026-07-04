// Turn calc results and set knowledge into the HTML we splice into Showdown's
// tooltips. Two views:
//
//   renderMoveSection — one move's damage vs the current target (move-button hover).
//   renderSetsSection — the information game (Pokémon hover): which sets are still
//     possible given what the battle has revealed. Pointed at the opponent it also
//     carries each move's damage vs our active; pointed at our own side it shows
//     what the opponent can deduce about us.
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

/** The "≈3.1 hits" / per-hit detail line for a multi-hit move. */
function multiHitDetail(r: DamageReport): string {
  if (!r.multiHit) return '';
  if (r.approximate || !r.hits || !r.perHit) return 'multi-hit (approx.)';
  const hits = `≈${Math.round(r.hits.expected * 10) / 10} hits`;
  const perHit = `${asPercent(r.perHit.min, r.defenderMaxHP)}–${asPercent(r.perHit.max, r.defenderMaxHP)}% per hit`;
  return `${hits} · ${perHit}`;
}

/** The compact damage figures for one report: "74–88% (81%)" plus the KO tail. */
function damageText(r: DamageReport): string {
  const dmg = `<span class="hichu-dmg">${r.percent.min}–${r.percent.max}% (${r.percent.mean}%)</span>`;
  const ko = koText(r.koChance);
  return ko ? `${dmg} <span class="hichu-ko">${ko}</span>` : dmg;
}

const STYLE_ID = 'hichu-style';

/** A one-time <style> block; the content script injects it once into the page. */
export const TOOLTIP_STYLE = `
<style id="${STYLE_ID}">
.hichu { margin-top: 5px; padding-top: 4px; border-top: 1px solid rgba(128,128,128,.4); font-size: 10px; }
.hichu-h { margin: 0 0 2px; font-size: 10px; font-weight: bold; opacity: .85; }
.hichu-row { line-height: 1.35; }
.hichu-mv { font-weight: bold; }
.hichu-dmg { opacity: .95; }
.hichu-ko { color: #c0392b; font-weight: bold; }
.hichu-sub { opacity: .7; padding-left: 6px; }
.hichu-line, .hichu-note { margin-top: 2px; }
.hichu-note { color: #b9770e; opacity: .8; }
.hichu-known { font-weight: bold; }
.hichu-maybe { opacity: .6; }
.hichu-lbl { opacity: .65; }
.hichu-tera { color: #8e44ad; font-weight: bold; }
</style>`;

// --- Move-button hover: one move vs the current target ----------------------

export interface MoveRenderModel {
  readonly moveName: string;
  readonly defenderName: string;
  /** Defender current HP as a fraction in [0,1]. */
  readonly defenderHpPercent: number;
  /** Active Tera types, if terastallized — shown so a surprising number explains itself. */
  readonly attackerTera?: string;
  readonly defenderTera?: string;
  /** Absent for status moves and moves the calc can't model. */
  readonly report?: DamageReport;
  readonly extraNotes: readonly string[];
}

function teraLine(attackerTera: string | undefined, defenderTera: string | undefined): string {
  const bits: string[] = [];
  if (attackerTera) bits.push(`Tera ${esc(attackerTera)}`);
  if (defenderTera) bits.push(`vs Tera ${esc(defenderTera)}`);
  return bits.length ? ` <span class="hichu-tera">[${bits.join(' ')}]</span>` : '';
}

function noteDivs(notes: readonly string[]): string {
  return notes.map((n) => `<div class="hichu-note">⚠ ${esc(n)}</div>`).join('');
}

/** The move-tooltip section: this move's damage into the current opposing active. */
export function renderMoveSection(model: MoveRenderModel): string {
  const header =
    `<h4 class="hichu-h">vs ${esc(model.defenderName)} ` +
    `(${pct1(model.defenderHpPercent)} HP)${teraLine(model.attackerTera, model.defenderTera)}</h4>`;

  const r = model.report;
  const body = r
    ? `<div class="hichu-row">${damageText(r)}</div>` +
      (multiHitDetail(r) ? `<div class="hichu-sub">${esc(multiHitDetail(r))}</div>` : '')
    : `<div class="hichu-row hichu-maybe">no damage (status move)</div>`;

  return `<div class="hichu">${header}${body}${noteDivs(model.extraNotes)}</div>`;
}

// --- Pokémon hover: the information game -------------------------------------

/** One move in the sets view; `report` carries its damage vs our active (foe view). */
export interface MoveKnowledgeRow {
  readonly name: string;
  readonly known: boolean;
  readonly report?: DamageReport;
}

export interface SetsRenderModel {
  /** 'foe' = what could they have; 'own' = what can they deduce about us. */
  readonly perspective: 'foe' | 'own';
  readonly roles: readonly string[];
  readonly totalRoles: number;
  readonly moves: readonly MoveKnowledgeRow[];
  readonly abilities: readonly KnownOption[];
  readonly items: readonly KnownOption[];
  readonly teraTypes: readonly KnownOption[];
  /** Foe view: who their moves are being calculated against, at what HP. */
  readonly defenderName?: string;
  readonly defenderHpPercent?: number;
  readonly attackerTera?: string;
  readonly defenderTera?: string;
  readonly extraNotes: readonly string[];
}

/** "✓ Flame Orb" for confirmed facts, a dimmed "Guts?" for still-open options. */
function optionSpan(o: KnownOption): string {
  return o.known
    ? `<span class="hichu-known">✓ ${esc(o.name)}</span>`
    : `<span class="hichu-maybe">${esc(o.name)}?</span>`;
}

function optionLine(label: string, options: readonly KnownOption[]): string {
  if (options.length === 0) return '';
  const parts = options.map(optionSpan).join(' · ');
  return `<div class="hichu-line"><span class="hichu-lbl">${label}:</span> ${parts}</div>`;
}

function moveRow(row: MoveKnowledgeRow): string {
  const mark = row.known
    ? `<span class="hichu-known">✓ <span class="hichu-mv">${esc(row.name)}</span></span>`
    : `<span class="hichu-maybe"><span class="hichu-mv">${esc(row.name)}</span>?</span>`;
  const dmg = row.report ? ` ${damageText(row.report)}` : '';
  const sub = row.report && multiHitDetail(row.report)
    ? `<div class="hichu-sub">${esc(multiHitDetail(row.report))}</div>`
    : '';
  return `<div class="hichu-row">${mark}${dmg}</div>${sub}`;
}

/**
 * The Pokémon-tooltip section. Confirmed facts are ✓ and bold; open possibilities
 * are dimmed with a trailing "?". Foe view ranks damaging moves by mean damage and
 * appends each move's numbers vs our active.
 */
export function renderSetsSection(model: SetsRenderModel): string {
  const narrowed = model.totalRoles > 0 && model.roles.length < model.totalRoles;
  const roleCount = model.totalRoles > 0 ? `${model.roles.length} of ${model.totalRoles} sets` : 'possible set';
  const roleNames = narrowed && model.roles.length > 0 ? `: ${model.roles.map(esc).join(', ')}` : '';

  const vsTarget =
    model.perspective === 'foe' && model.defenderName !== undefined && model.defenderHpPercent !== undefined
      ? ` · dmg vs ${esc(model.defenderName)} (${pct1(model.defenderHpPercent)} HP)`
      : '';

  const title = model.perspective === 'foe' ? `Possible sets — ${roleCount}` : `Their read on you — ${roleCount}`;
  const header =
    `<h4 class="hichu-h">${title}${esc(roleNames)}${vsTarget}` +
    `${teraLine(model.attackerTera, model.defenderTera)}</h4>`;

  // Known moves first, then damaging possibilities by mean damage, then the rest.
  const rank = (r: MoveKnowledgeRow): number => (r.report ? r.report.percent.mean : -1);
  const rows = [...model.moves]
    .sort((a, b) => Number(b.known) - Number(a.known) || rank(b) - rank(a))
    .map(moveRow)
    .join('');

  const lines =
    optionLine('Ability', model.abilities) +
    optionLine('Item', model.items) +
    optionLine('Tera', model.teraTypes);

  return `<div class="hichu">${header}${rows}${lines}${noteDivs(model.extraNotes)}</div>`;
}
