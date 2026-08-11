// Switch-in hazard damage — the one place hazards ARE modelled, deliberately narrow.
//
// Everywhere else in this tooltip, hazards are excluded: they change switch-in HP, not
// a move's damage, and an already-active mon's live HP already reflects them. That
// stops being true for a BENCHED mon under preview — switching it in would trigger
// Stealth Rock/Spikes on our own side before the foe's next hit lands, so the "does it
// survive?" check needs the POST-switch-in HP, not the current one. This module is that
// one correction: how much of a Pokémon's max HP it loses on the way in.
//
// Grounded-ness isn't modelled anywhere else in this codebase, but @smogon/calc has it:
// isGrounded lives in the same non-public module as getFinalSpeed (core/speed.ts already
// deep-imports that one, with the same rationale reused here — no `exports` map on the
// package, so the path is reachable, and a pinned test catches a future calc upgrade that
// moves or changes it). That deep import is why dependency-boundaries.test.ts's
// @smogon/calc allow-list names this file alongside damage.ts and speed.ts.
//
// Applied ONCE per hover, before the per-foe loop in section.ts's ownMovesSection: hazards
// are one-time and side-wide, so doubles is safe by construction rather than by a guard.
// Both call sites preview a mon NOT yet on the field — buildSwitchSection (always: a
// switch-menu candidate is benched by definition) and ownHoverMatchup's non-active branch.
//
// Nothing here is ever UNCERTAIN, unlike the hidden-item bucketing elsewhere in the
// codebase: a switch candidate is our OWN mon, always resolved from the private team, so
// its Boots/Magic Guard is known outright rather than fanned out into labelled outcomes.
//
// Explicit v1 cuts, not oversights: Toxic Spikes (poisons at end of turn — it doesn't
// change whether the mon survives the next hit), G-Max Steelsurge (Dynamax-only), and
// forced grounding from Gravity / Ingrain / Smack Down.
import {groundedOn} from './calcinternals.js';
import {Field, Generations, TYPE_CHART, type GenerationNum} from '@smogon/calc';
import {buildPokemon} from './damage.js';
import type {ResolvedMon} from './types.js';

/** Hazards up on OUR side of the field — the ones a mon switching in would trigger. */
export interface OwnSideHazards {
  readonly stealthRock: boolean;
  /** 0 when none are up; Spikes stacks to 3 layers. */
  readonly spikesLayers: number;
}

const SPIKES_FRACTION: readonly number[] = [0, 1 / 8, 1 / 6, 1 / 4];

/** The fraction of max HP `mon` loses switching in under `hazards` — 0 when it holds
 *  Heavy-Duty Boots or Magic Guard (both block every hazard outright), or when nothing
 *  is up. Stealth Rock scales with Rock's effectiveness against the mon's CURRENT typing
 *  (Tera-aware — a mon that terastallized before switching out keeps that typing, the
 *  same check `Pokemon.hasType` itself makes); Spikes is a flat per-layer fraction, but
 *  only when the mon is grounded. */
export function computeHazardFraction(mon: ResolvedMon, hazards: OwnSideHazards, gen: number): number {
  const g = Generations.get(gen as GenerationNum);
  const pokemon = buildPokemon(g, mon);
  if (pokemon.hasItem('Heavy-Duty Boots') || pokemon.hasAbility('Magic Guard')) return 0;

  const types = pokemon.teraType && pokemon.teraType !== 'Stellar' ? [pokemon.teraType] : pokemon.types;
  const rockChart = TYPE_CHART[g.num]?.['Rock'] ?? {};
  const rockEffectiveness = types.reduce((product, t) => product * (rockChart[t] ?? 1), 1);
  const stealthRockFraction = hazards.stealthRock ? rockEffectiveness / 8 : 0;

  const layers = Math.max(0, Math.min(SPIKES_FRACTION.length - 1, hazards.spikesLayers));
  const spikesFraction = layers > 0 && groundedOn(pokemon, new Field({})) ? SPIKES_FRACTION[layers]! : 0;

  return stealthRockFraction + spikesFraction;
}

/** `mon`, previewed as it would land after switching in under `hazards` — its `hpPercent`
 *  reduced by whatever it would lose to entry hazards, floored at 0 (can't preview past
 *  fainting). Every other field is untouched. */
export function applySwitchInHazards(mon: ResolvedMon, hazards: OwnSideHazards, gen: number): ResolvedMon {
  const fraction = computeHazardFraction(mon, hazards, gen);
  return fraction > 0 ? {...mon, hpPercent: Math.max(0, mon.hpPercent - fraction)} : mon;
}
