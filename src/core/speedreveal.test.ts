import {describe, it, expect} from 'vitest';
import {variantsConsistentWithOrder, type OrderContext} from './speedreveal.js';
import {finalSpeed} from './speed.js';
import type {FieldFacts, OrderedMove, ResolvedMon, SetVariant, TurnOrder} from './types.js';

const noField: FieldFacts = {defenderScreens: {reflect: false, lightScreen: false, auroraVeil: false}};

function mon(over: Partial<ResolvedMon> & {speciesForme: string}): ResolvedMon {
  return {
    level: 100,
    nature: 'Serious',
    evs: {hp: 85, atk: 85, def: 85, spa: 85, spd: 85, spe: 85},
    ivs: {hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31},
    ability: undefined,
    item: undefined,
    status: undefined,
    boosts: {},
    hpPercent: 1,
    teraType: undefined,
    terastallized: false,
    possibleMoves: [],
    timesAttacked: 0,
    ...over,
  };
}

/** A move record in the shape the client dex hands back. */
function move(over: Partial<OrderedMove> & {name: string}): OrderedMove {
  return {priority: 0, category: 'Physical', type: 'Normal', healing: false, ...over};
}

const ctx: OrderContext = {gen: 9, field: noField, ourTailwind: false, theirTailwind: false};

const TACKLE = move({name: 'Tackle'});
const order = (theyMovedFirst: boolean, over: Partial<TurnOrder> = {}): TurnOrder =>
  ({ours: TACKLE, theirs: TACKLE, theyMovedFirst, ...over});

// A Gholdengo whose surviving role could be holding a Scarf or a Band — the shape the whole
// reading exists for, since the two are damage-identical on the special side and the calc
// can never tell them apart from a number.
const banded: SetVariant = {mon: mon({speciesForme: 'Gholdengo', item: 'Choice Band'}), role: 'Fast Attacker'};
const scarfed: SetVariant = {mon: mon({speciesForme: 'Gholdengo', item: 'Choice Scarf'}), role: 'Fast Attacker'};
const both = [banded, scarfed];

describe('the two candidate speeds this all turns on', () => {
  it('are genuinely different, and straddle our attacker', () => {
    // Asserted rather than assumed: if a calc upgrade moved these, every test below would
    // still pass while testing nothing. Talonflame sits BETWEEN the two Gholdengo speeds,
    // which is the only arrangement in which an observed order can separate them at all.
    expect(finalSpeed(banded.mon, {gen: 9})).toBe(225);
    expect(finalSpeed(mon({speciesForme: 'Talonflame'}), {gen: 9})).toBe(309);
    expect(finalSpeed(scarfed.mon, {gen: 9})).toBe(337);
  });
});

describe('an observed order rules out the sets that contradict it', () => {
  const ours = mon({speciesForme: 'Talonflame'}); // 309 — faster than Band, slower than Scarf

  it('rules out the Scarf when they moved SECOND', () => {
    const kept = variantsConsistentWithOrder(both, ours, order(false), ctx);
    expect(kept.map((v) => v.mon.item)).toEqual(['Choice Band']);
  });

  it('rules out the Band when they moved FIRST', () => {
    const kept = variantsConsistentWithOrder(both, ours, order(true), ctx);
    expect(kept.map((v) => v.mon.item)).toEqual(['Choice Scarf']);
  });

  it('rules out nothing when both candidates predict the same order', () => {
    // Against something slower than both, moving first is what either set would have done.
    const slow = mon({speciesForme: 'Snorlax'});
    expect(variantsConsistentWithOrder(both, slow, order(true), ctx)).toHaveLength(2);
  });
});

describe('Trick Room inverts the verdict without touching a number', () => {
  const ours = mon({speciesForme: 'Talonflame'});
  const trickRoom: OrderContext = {...ctx, field: {...noField, trickRoom: true}};

  it('reads moving second as FASTER', () => {
    // Outside Trick Room this same observation convicts the Scarf; inside it, the Scarf is
    // the only set slow enough to have gone second.
    const kept = variantsConsistentWithOrder(both, ours, order(false), trickRoom);
    expect(kept.map((v) => v.mon.item)).toEqual(['Choice Scarf']);
  });
});

describe('priority decides the turn, and a bracket alibi beats a speed argument', () => {
  const ours = mon({speciesForme: 'Talonflame'}); // 309

  it('rules out nothing when THEIR move outranks ours — the bracket explains it', () => {
    const bracketed = order(true, {theirs: move({name: 'Aqua Jet', priority: 1})});
    expect(variantsConsistentWithOrder(both, ours, bracketed, ctx)).toHaveLength(2);
  });

  it('rules out EVERY set when a higher bracket somehow went second — so keeps them all', () => {
    // Nothing can explain this, which means the reading is what is wrong, not the sets.
    const impossible = order(false, {theirs: move({name: 'Aqua Jet', priority: 1})});
    expect(variantsConsistentWithOrder(both, ours, impossible, ctx)).toHaveLength(2);
  });

  it('does not put a NEGATIVE bracket down to being slow', () => {
    // Dragon Tail is -6. A foe that moved second with it proves nothing about its Speed, and
    // this is the case @smogon/calc's own move data would get wrong — it carries no negative
    // priority at all, which is why the bracket is read from the client dex.
    const tail = order(false, {theirs: move({name: 'Dragon Tail', priority: -6})});
    expect(variantsConsistentWithOrder(both, ours, tail, ctx)).toHaveLength(2);
  });

  it('lifts a Prankster status move a bracket, so the set is not convicted of being fast', () => {
    const prankster: SetVariant = {mon: mon({speciesForme: 'Whimsicott', ability: 'Prankster'}), role: 'Support'};
    const plain: SetVariant = {mon: mon({speciesForme: 'Whimsicott', ability: 'Chlorophyll'}), role: 'Sun Abuser'};
    const wisp = order(true, {theirs: move({name: 'Will-O-Wisp', category: 'Status', type: 'Fire'})});
    // Whimsicott is 289 and our Talonflame 309, so on raw Speed neither should have gone
    // first — but Prankster explains it, and Chlorophyll (no sun) does not.
    const kept = variantsConsistentWithOrder([prankster, plain], ours, wisp, ctx);
    expect(kept.map((v) => v.mon.ability)).toEqual(['Prankster']);
  });

  it('leaves a Prankster set alone on a DAMAGING move, which it never lifts', () => {
    const prankster: SetVariant = {mon: mon({speciesForme: 'Whimsicott', ability: 'Prankster'}), role: 'Support'};
    const kept = variantsConsistentWithOrder([prankster], ours, order(true), ctx);
    expect(kept).toHaveLength(1); // survives only because nothing else is left, i.e. unruled
  });
});

describe('an ability whose ordering we do not model is never convicted', () => {
  const ours = mon({speciesForme: 'Dragapult'}); // 341 — faster than Talonflame's 309

  it('keeps a Gale Wings set — its bracket depended on HP we cannot recover', () => {
    const galeWings: SetVariant = {mon: mon({speciesForme: 'Talonflame', ability: 'Gale Wings'}), role: 'Attacker'};
    const plain: SetVariant = {mon: mon({speciesForme: 'Talonflame', ability: 'Flame Body'}), role: 'Attacker'};
    const brave = order(true, {theirs: move({name: 'Brave Bird', type: 'Flying'})});
    // Talonflame is 309 — slower than our 341, so on speed alone both would be ruled out.
    // Gale Wings has an alibi and Flame Body does not.
    const kept = variantsConsistentWithOrder([galeWings, plain], ours, brave, ctx);
    expect(kept.map((v) => v.mon.ability)).toEqual(['Gale Wings']);
  });

  it('abstains entirely when OUR OWN ability puts the bracket out of reach', () => {
    const stallOurs = mon({speciesForme: 'Talonflame', ability: 'Stall'});
    expect(variantsConsistentWithOrder(both, stallOurs, order(false), ctx)).toHaveLength(2);
  });
});

describe('a speed TIE is consistent with either order — the sim breaks it at random', () => {
  it('rules out nothing against an identical Pokémon', () => {
    const ours = mon({speciesForme: 'Gholdengo', item: 'Choice Band'});
    expect(variantsConsistentWithOrder([banded], ours, order(true), ctx)).toHaveLength(1);
    expect(variantsConsistentWithOrder([banded], ours, order(false), ctx)).toHaveLength(1);
  });
});

describe('Tailwind is read per SIDE, and the two must not be swapped', () => {
  it('changes which set survives depending on whose side it blows on', () => {
    const ours = mon({speciesForme: 'Talonflame'}); // 309
    // Their Tailwind doubles the Band set to 450, so moving first no longer convicts anyone.
    const theirs: OrderContext = {...ctx, theirTailwind: true};
    expect(variantsConsistentWithOrder(both, ours, order(true), theirs)).toHaveLength(2);
    // Ours doubles US to 618, above both — so moving first is impossible for either, and the
    // reading rather than the sets is what gives way.
    const oursTw: OrderContext = {...ctx, ourTailwind: true};
    expect(variantsConsistentWithOrder(both, ours, order(true), oursTw)).toHaveLength(2);
    // …while moving second under our own Tailwind is what both sets would do: no rule-out.
    expect(variantsConsistentWithOrder(both, ours, order(false), oursTw)).toHaveLength(2);
  });
});
