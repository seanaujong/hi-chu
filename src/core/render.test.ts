import {describe, it, expect} from 'vitest';
import {koText, renderMoveSection, renderSetsSection, type MoveRenderModel, type SetsRenderModel} from './render.js';
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

describe('koText', () => {
  it('describes the KO chance in plain words', () => {
    expect(koText(1)).toBe('guaranteed KO');
    expect(koText(0)).toBe('');
    expect(koText(0.003)).toBe('<1% to KO');
    expect(koText(0.5)).toBe('50% to KO');
  });
});

describe('renderMoveSection', () => {
  function model(over: Partial<MoveRenderModel> = {}): MoveRenderModel {
    return {
      moveName: 'Earthquake',
      defenderName: 'Tyranitar',
      defenderHpPercent: 0.941,
      extraNotes: [],
      ...over,
    };
  }

  it('names the target and its current HP so the numbers explain themselves', () => {
    const html = renderMoveSection(model({report: report({move: 'Earthquake'})}));
    expect(html).toContain('vs Tyranitar (94.1% HP)');
    expect(html).toContain('30–36% (33%)');
  });

  it('shows expected hits and per-hit % for a uniform multi-hit move', () => {
    const html = renderMoveSection(
      model({
        moveName: 'Bullet Seed',
        report: report({
          move: 'Bullet Seed',
          multiHit: true,
          perHit: {min: 49, max: 60},
          hits: {expected: 3.1, distribution: [[2, 0.35], [3, 0.35], [4, 0.15], [5, 0.15]]},
          percent: {min: 29.4, max: 90.1, mean: 45.6},
          koChance: 0.52,
        }),
      }),
    );
    expect(html).toContain('≈3.1 hits');
    expect(html).toContain('per hit'); // 14.7–18% per hit (49/333, 60/333)
    expect(html).toContain('52% to KO');
  });

  it('marks variable-power multi-hit as approximate', () => {
    const html = renderMoveSection(model({report: report({move: 'Triple Axel', multiHit: true, approximate: true})}));
    expect(html).toContain('multi-hit (approx.)');
  });

  it('says so plainly when the move deals no damage', () => {
    const html = renderMoveSection(model({moveName: 'Swords Dance'}));
    expect(html).toContain('no damage (status move)');
  });

  it('surfaces active Tera for attacker and defender', () => {
    const html = renderMoveSection(model({attackerTera: 'Flying', defenderTera: 'Steel'}));
    expect(html).toContain('Tera Flying');
    expect(html).toContain('vs Tera Steel');
  });
});

describe('renderSetsSection', () => {
  function model(over: Partial<SetsRenderModel> = {}): SetsRenderModel {
    return {
      perspective: 'foe',
      roles: ['Bulky Support'],
      totalRoles: 1,
      moves: [],
      abilities: [],
      items: [],
      teraTypes: [],
      extraNotes: [],
      ...over,
    };
  }

  it('marks confirmed facts with ✓ and open options with a dimmed trailing ?', () => {
    const html = renderSetsSection(
      model({
        moves: [{name: 'Surf', known: true}, {name: 'Haze', known: false}],
        items: [{name: 'Leftovers', known: true}],
        abilities: [{name: 'Clear Body', known: false}, {name: 'Liquid Ooze', known: false}],
      }),
    );
    expect(html).toContain('✓ <span class="hichu-mv">Surf</span>');
    expect(html).toMatch(/hichu-maybe"><span class="hichu-mv">Haze<\/span>\?/);
    expect(html).toContain('✓ Leftovers');
    expect(html).toContain('Clear Body?');
    expect(html).toContain('Liquid Ooze?');
  });

  it('counts how far the roles have been narrowed and names the survivors', () => {
    const html = renderSetsSection(model({roles: ['Fast Support'], totalRoles: 2}));
    expect(html).toContain('1 of 2 sets');
    expect(html).toContain('Fast Support');
  });

  it('skips the survivor list when nothing has been ruled out yet', () => {
    const html = renderSetsSection(model({roles: ['A', 'B'], totalRoles: 2}));
    expect(html).toContain('2 of 2 sets');
    expect(html).not.toContain(': A, B');
  });

  it('titles the two perspectives differently', () => {
    expect(renderSetsSection(model({perspective: 'foe'}))).toContain('Possible sets');
    expect(renderSetsSection(model({perspective: 'own'}))).toContain('Their read on you');
  });

  it('names the damage target in the foe view header', () => {
    const html = renderSetsSection(model({perspective: 'foe', defenderName: 'Noivern', defenderHpPercent: 1}));
    expect(html).toContain('dmg vs Noivern (100% HP)');
  });

  it('puts known moves first, then ranks the rest by mean damage', () => {
    const html = renderSetsSection(
      model({
        moves: [
          {name: 'Weak', known: false, report: report({move: 'Weak', percent: {min: 5, max: 7, mean: 6}})},
          {name: 'Strong', known: false, report: report({move: 'Strong', percent: {min: 80, max: 95, mean: 88}})},
          {name: 'Seen', known: true, report: report({move: 'Seen', percent: {min: 10, max: 12, mean: 11}})},
        ],
      }),
    );
    expect(html.indexOf('Seen')).toBeLessThan(html.indexOf('Strong'));
    expect(html.indexOf('Strong')).toBeLessThan(html.indexOf('Weak'));
  });

  it('renders caveats as note lines', () => {
    const html = renderSetsSection(model({extraNotes: ['revealed moves/item/ability matched no known set']}));
    expect(html).toContain('matched no known set');
  });
});
