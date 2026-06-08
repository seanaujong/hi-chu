import {describe, it, expect} from 'vitest';
import {renderDamageSection, koText, type RenderModel} from './render.js';
import type {DamageReport} from './damage.js';

function report(over: Partial<DamageReport> & {move: string}): DamageReport {
  return {
    category: 'Physical',
    multiHit: false,
    approximate: false,
    total: {min: 100, max: 120, mean: 110},
    percent: {min: 30, max: 36, mean: 33},
    koChance: 0,
    defenderMaxHP: 333,
    defenderRemainingHP: 333,
    calcDesc: '',
    notes: [],
    ...over,
  };
}

function model(over: Partial<RenderModel> = {}): RenderModel {
  return {
    defenderName: 'Tyranitar',
    defenderHpPercent: 1,
    reports: [],
    extraNotes: [],
    ...over,
  };
}

describe('koText', () => {
  it('describes the KO chance in plain words', () => {
    expect(koText(1)).toBe('guaranteed KO');
    expect(koText(0)).toBe('');
    expect(koText(0.003)).toBe('<1% to KO');
    expect(koText(0.5)).toBe('50% to KO');
  });
});

describe('renderDamageSection', () => {
  it('shows expected hits and per-hit % for a uniform multi-hit move', () => {
    const html = renderDamageSection(
      model({
        reports: [
          report({
            move: 'Bullet Seed',
            multiHit: true,
            perHit: {min: 49, max: 60},
            hits: {expected: 3.1, distribution: [[2, 0.35], [3, 0.35], [4, 0.15], [5, 0.15]]},
            percent: {min: 29.4, max: 90.1, mean: 45.6},
            koChance: 0.52,
          }),
        ],
      }),
    );
    expect(html).toContain('Bullet Seed');
    expect(html).toContain('≈3.1 hits');
    expect(html).toContain('per hit'); // 14.7–18% per hit (49/333, 60/333)
    expect(html).toContain('52% to KO');
  });

  it('marks variable-power multi-hit as approximate', () => {
    const html = renderDamageSection(model({reports: [report({move: 'Triple Axel', multiHit: true, approximate: true})]}));
    expect(html).toContain('multi-hit (approx.)');
  });

  it('lists status moves separately and keeps them out of the damage rows', () => {
    const html = renderDamageSection(
      model({
        reports: [
          report({move: 'Earthquake', percent: {min: 40, max: 48, mean: 44}}),
          report({move: 'Swords Dance', category: 'Status', percent: {min: 0, max: 0, mean: 0}}),
        ],
      }),
    );
    expect(html).toContain('Status: Swords Dance');
    // Swords Dance must not appear as a damage row (only in the status line).
    expect(html.match(/rbtb-mv">Swords Dance/)).toBeNull();
    expect(html).toContain('rbtb-mv">Earthquake');
  });

  it('ranks damaging moves by mean damage, highest first', () => {
    const html = renderDamageSection(
      model({
        reports: [
          report({move: 'Weak', percent: {min: 5, max: 7, mean: 6}}),
          report({move: 'Strong', percent: {min: 80, max: 95, mean: 88}}),
        ],
      }),
    );
    expect(html.indexOf('Strong')).toBeLessThan(html.indexOf('Weak'));
  });

  it('surfaces active Tera for attacker and defender', () => {
    const html = renderDamageSection(model({attackerTera: 'Flying', defenderTera: 'Steel'}));
    expect(html).toContain('Tera Flying');
    expect(html).toContain('vs Tera Steel');
  });

  it('renders caveats as note lines', () => {
    const html = renderDamageSection(model({extraNotes: ['field effects not yet included']}));
    expect(html).toContain('field effects not yet included');
  });
});
