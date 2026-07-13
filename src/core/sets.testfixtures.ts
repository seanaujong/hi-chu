// Shared fixtures for the set-inference tests (narrow → resolve → knowledge → deductions).
// The suites are split by observable entry point but exercise the same handful of entries,
// so the entries and their fact factories live here rather than being duplicated. Not a
// `*.test.ts` file, so vitest doesn't run it as a suite.

import type {LiveFacts, RandbatsEntry} from './types.js';

/** A fully-defaulted LiveFacts; override only what a test cares about. */
export function liveFacts(over: Partial<LiveFacts> = {}): LiveFacts {
  return {
    speciesForme: 'Testmon',
    level: 80,
    hpPercent: 1,
    boosts: {},
    terastallized: false,
    revealedMoves: [],
    landedDamagingHit: false,
    tookEntryHazardDamage: false,
    switchedIntoStealthRockUnharmed: false,
    ...over,
  };
}

export const DRAGONITE: RandbatsEntry = {
  level: 74,
  abilities: ['Multiscale'],
  items: ['Heavy-Duty Boots'],
  roles: {
    'Bulky Setup': {
      abilities: ['Multiscale'],
      items: ['Heavy-Duty Boots'],
      teraTypes: ['Ground', 'Steel'],
      moves: ['Dragon Dance', 'Earthquake', 'Outrage', 'Roost'],
    },
    'Setup Sweeper': {
      abilities: ['Multiscale'],
      items: ['Heavy-Duty Boots'],
      teraTypes: ['Steel'],
      moves: ['Dragon Dance', 'Earthquake', 'Iron Head', 'Outrage'],
    },
  },
};
export const dragoniteFacts = (over: Partial<LiveFacts> = {}): LiveFacts => liveFacts({speciesForme: 'Dragonite', level: 74, ...over});

// Roles that differ by item and ability, so non-move evidence can tell them apart
// (modelled on real feed shapes like Noivern's Choice Specs vs Heavy-Duty Boots).
export const NOIVERN: RandbatsEntry = {
  level: 80,
  abilities: ['Frisk', 'Infiltrator'],
  items: [],
  roles: {
    'Fast Attacker': {
      abilities: ['Infiltrator'],
      items: ['Choice Specs'],
      teraTypes: ['Normal'],
      moves: ['Boomburst', 'Draco Meteor', 'Flamethrower', 'Hurricane', 'U-turn'],
    },
    'Fast Support': {
      abilities: ['Frisk', 'Infiltrator'],
      items: ['Heavy-Duty Boots'],
      teraTypes: ['Fire'],
      moves: ['Defog', 'Draco Meteor', 'Flamethrower', 'Hurricane', 'Roost'],
    },
  },
};
export const noivernFacts = (over: Partial<LiveFacts> = {}): LiveFacts => liveFacts({speciesForme: 'Noivern', ...over});

// A single-role set whose ability (Trace) copies the opponent's mid-battle. Its
// CURRENT ability then differs from what the set was built with.
export const GARDEVOIR: RandbatsEntry = {
  level: 83,
  abilities: ['Trace'],
  items: [],
  roles: {
    'Fast Attacker': {
      abilities: ['Trace'],
      items: ['Choice Scarf', 'Choice Specs', 'Life Orb'],
      teraTypes: ['Fairy', 'Fighting', 'Fire'],
      moves: ['Calm Mind', 'Focus Blast', 'Moonblast', 'Psychic', 'Psyshock', 'Trick'],
    },
  },
};
export const gardevoirFacts = (over: Partial<LiveFacts> = {}): LiveFacts => liveFacts({speciesForme: 'Gardevoir', level: 83, ...over});

// One Life-Orb-only role (drops when ruled out), one that pairs it with a second item
// (survives, minus Life Orb), and one Sheer Force role (recoil suppressed — Life Orb kept).
export const ORB_MON: RandbatsEntry = {
  level: 80,
  abilities: ['Overgrow', 'Sheer Force'],
  items: [],
  roles: {
    'Orb Sweeper': {abilities: ['Overgrow'], items: ['Life Orb'], teraTypes: ['Grass'], moves: ['Leaf Storm', 'Earthquake']},
    'Mixed Attacker': {abilities: ['Overgrow'], items: ['Life Orb', 'Choice Band'], teraTypes: ['Grass'], moves: ['Leaf Storm', 'Earthquake']},
    'Force Sweeper': {abilities: ['Sheer Force'], items: ['Life Orb'], teraTypes: ['Grass'], moves: ['Leaf Storm', 'Earthquake']},
  },
};
// landedDamagingHit defaults TRUE here — these fixtures exist to exercise the recoil rule.
export const orbFacts = (over: Partial<LiveFacts> = {}): LiveFacts =>
  liveFacts({speciesForme: 'Orbmon', revealedMoves: ['Leaf Storm'], landedDamagingHit: true, ...over});

// One role that can run EITHER a recoil-suppressing ability or a plain one, with Life Orb
// plus an alternative — isolates the ability guard: same behaviour, opposite outcomes by
// which ability the battle revealed.
export const DUAL_ABILITY: RandbatsEntry = {
  level: 80,
  abilities: ['Overgrow', 'Sheer Force'],
  items: [],
  roles: {
    Attacker: {abilities: ['Overgrow', 'Sheer Force'], items: ['Life Orb', 'Choice Band'], teraTypes: ['Grass'], moves: ['Leaf Storm']},
  },
};

// A role that can run Magic Guard alongside a plain ability, with Heavy-Duty Boots plus an
// alternative — checks the "never lie" guard on the Boots rule-in (Magic Guard also dodges
// Stealth Rock, so a hidden ability that could be Magic Guard mustn't confirm Boots).
export const GUARD_MON: RandbatsEntry = {
  level: 80,
  abilities: ['Magic Guard', 'Overgrow'],
  items: [],
  roles: {
    Attacker: {abilities: ['Magic Guard', 'Overgrow'], items: ['Heavy-Duty Boots', 'Leftovers'], teraTypes: ['Grass'], moves: ['Leaf Storm']},
  },
};
export const guardFacts = (over: Partial<LiveFacts> = {}): LiveFacts =>
  liveFacts({speciesForme: 'Guardmon', revealedMoves: ['Leaf Storm'], switchedIntoStealthRockUnharmed: true, ...over});

// A [Gen 9] Champions Mega set, verbatim from the feed's "Meganium-Mega" entry. The live
// client reports its ability as "Mega Sol" (a Champions custom name) while the feed lists
// "Leaf Guard", so matching on the ability would reject the only role — forme + stone match.
export const MEGANIUM_MEGA: RandbatsEntry = {
  level: 50,
  abilities: ['Leaf Guard'],
  items: ['Meganiumite'],
  roles: {
    'Bulky Attacker': {
      abilities: ['Leaf Guard'],
      items: ['Meganiumite'],
      teraTypes: [],
      moves: ['Dazzling Gleam', 'Solar Beam', 'Synthesis', 'Weather Ball'],
    },
  },
};
// The facts a mega-evolved Meganium presents, captured live from replay 2646169772.
export const megaMeganiumFacts = (over: Partial<LiveFacts> = {}): LiveFacts =>
  liveFacts({
    speciesForme: 'Meganium-Mega', level: 50, revealedMoves: ['Solar Beam', 'Synthesis'],
    ability: 'Mega Sol', baseAbility: 'Mega Sol', item: 'Meganiumite', ...over,
  });

// A composite ability, verbatim from the gen9randombattle feed. The sim announces one under
// an UMBRELLA name the dex has never heard of — `|-ability| As One`, then its components —
// so the client stamps `As One` into `baseAbility` while the feed keys the set to
// `As One (Spectrier)`. The species' own dex slots (below) are what tell the two apart.
export const CALYREX_SHADOW: RandbatsEntry = {
  level: 64,
  abilities: ['As One (Spectrier)'],
  items: ['Choice Specs', 'Life Orb'],
  roles: {
    'Fast Attacker': {
      abilities: ['As One (Spectrier)'],
      items: ['Choice Specs', 'Life Orb'],
      teraTypes: ['Dark', 'Ghost'],
      moves: ['Astral Barrage', 'Nasty Plot', 'Pollen Puff', 'Psyshock', 'Trick'],
    },
  },
};
// The facts a Calyrex-Shadow presents, captured live from replay 2648347259: `Grim Neigh`
// live (the component that proc'd on a KO), `As One` innate (the umbrella).
export const calyrexShadowFacts = (over: Partial<LiveFacts> = {}): LiveFacts =>
  liveFacts({
    speciesForme: 'Calyrex-Shadow', level: 64,
    ability: 'Grim Neigh', baseAbility: 'As One',
    speciesData: {
      baseStats: {hp: 100, atk: 85, def: 80, spa: 165, spd: 100, spe: 150},
      types: ['Psychic', 'Ghost'],
      abilities: ['As One (Spectrier)'],
    },
    ...over,
  });

// One role whose hidden item could be Assault Vest OR Leftovers — the shape that makes a
// single move deal two different amounts (AV halves the special hit).
export const TENTACRUEL: RandbatsEntry = {
  level: 82,
  abilities: ['Liquid Ooze'],
  items: [],
  roles: {
    'Bulky Support': {
      abilities: ['Liquid Ooze'],
      items: ['Assault Vest', 'Leftovers'],
      teraTypes: ['Flying', 'Grass'],
      moves: ['Surf', 'Haze', 'Rapid Spin', 'Toxic Spikes'],
    },
  },
};
export const tentacruelFacts = (over: Partial<LiveFacts> = {}): LiveFacts => liveFacts({speciesForme: 'Tentacruel', level: 82, ...over});
