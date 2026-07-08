import {describe, it, expect} from 'vitest';
import {survivingItems} from './deductions.js';
import {liveFacts} from './sets.testfixtures.js';

// survivingItems(abilities, items, facts) is the deduction layer's whole public surface:
// given a role's ability pool and item pool, which items survive the behavioural rule-outs
// (and the Boots rule-in). Tested directly here with minimal hand-built facts.

describe('Life Orb rule-out (no recoil after a landed hit ⇒ not holding it)', () => {
  const pool = ['Life Orb', 'Choice Band'];

  it('removes Life Orb after a landed hit with a non-suppressing known ability', () => {
    const facts = liveFacts({landedDamagingHit: true, baseAbility: 'Overgrow'});
    expect(survivingItems(['Overgrow'], pool, facts)).toEqual(['Choice Band']);
  });

  it('keeps Life Orb when the known ability suppresses the recoil (Sheer Force / Magic Guard)', () => {
    for (const a of ['Sheer Force', 'Magic Guard']) {
      const facts = liveFacts({landedDamagingHit: true, baseAbility: a});
      expect(survivingItems([a], pool, facts)).toEqual(pool);
    }
  });

  it('never lies: keeps Life Orb while the ability is hidden and the pool could be Sheer Force', () => {
    const facts = liveFacts({landedDamagingHit: true}); // ability unknown
    expect(survivingItems(['Overgrow', 'Sheer Force'], pool, facts)).toEqual(pool);
  });

  it('does nothing without a landed hit, or once an item is already revealed', () => {
    expect(survivingItems(['Overgrow'], pool, liveFacts({landedDamagingHit: false}))).toEqual(pool);
    expect(survivingItems(['Overgrow'], pool, liveFacts({landedDamagingHit: true, item: 'Choice Band'}))).toEqual(pool);
  });
});

describe('Heavy-Duty Boots rule-out (took hazard damage ⇒ not holding them)', () => {
  const pool = ['Heavy-Duty Boots', 'Leftovers'];

  it('removes Heavy-Duty Boots once the mon has taken entry-hazard damage', () => {
    expect(survivingItems(['Overgrow'], pool, liveFacts({tookEntryHazardDamage: true}))).toEqual(['Leftovers']);
  });

  it('needs no ability guard — taking the damage also excludes Magic Guard', () => {
    // Even a could-be-Magic-Guard pool: if it TOOK the damage, it has neither Boots nor MG.
    expect(survivingItems(['Magic Guard', 'Overgrow'], pool, liveFacts({tookEntryHazardDamage: true}))).toEqual(['Leftovers']);
  });
});

describe('Heavy-Duty Boots rule-in (dodged Stealth Rock ⇒ holding them)', () => {
  const pool = ['Heavy-Duty Boots', 'Leftovers'];

  it('pins the pool to Boots when the mon switched into Stealth Rock unharmed', () => {
    const facts = liveFacts({switchedIntoStealthRockUnharmed: true, baseAbility: 'Overgrow'});
    expect(survivingItems(['Overgrow'], pool, facts)).toEqual(['Heavy-Duty Boots']);
  });

  it('never lies: does not pin while the ability is hidden and could be Magic Guard', () => {
    const facts = liveFacts({switchedIntoStealthRockUnharmed: true}); // ability unknown
    expect(survivingItems(['Magic Guard', 'Overgrow'], pool, facts)).toEqual(pool);
  });

  it('does not pin once an item is already revealed', () => {
    const facts = liveFacts({switchedIntoStealthRockUnharmed: true, baseAbility: 'Overgrow', item: 'Leftovers'});
    expect(survivingItems(['Overgrow'], pool, facts)).toEqual(pool);
  });
});
