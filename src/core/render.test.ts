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
      defenderHpPercent: 1,
      extraNotes: [],
      ...over,
    };
  }

  it("matches the native Damage line format exactly, no vs-target preamble", () => {
    const html = renderMoveSection(model({report: report({move: 'Earthquake'})}));
    expect(html).toContain('<small>Damage:</small> 30% - 36%');
    expect(html).not.toContain('vs '); // the native tooltip already names the target
  });

  it('wraps its lines in a grey-panelled divider block', () => {
    const html = renderMoveSection(model({report: report({move: 'Earthquake'})}));
    expect(html).toContain('<div class="hichu-block">');
  });

  it('adds a KO line, with HP context only when the target is damaged', () => {
    const hurt = renderMoveSection(
      model({defenderHpPercent: 0.78, report: report({move: 'Earthquake', koChance: 0.52})}),
    );
    expect(hurt).toContain('52% to KO');
    expect(hurt).toContain('at 78% HP');
    const full = renderMoveSection(model({report: report({move: 'Earthquake', koChance: 0.52})}));
    expect(full).toContain('52% to KO');
    expect(full).not.toContain('at 100% HP');
  });

  it('shows the true multi-hit breakdown on its own Hits line', () => {
    const html = renderMoveSection(
      model({
        report: report({
          move: 'Bullet Seed',
          multiHit: true,
          perHit: {min: 49, max: 60},
          hits: {expected: 3.1, distribution: [[2, 0.35], [3, 0.35], [4, 0.15], [5, 0.15]]},
          percent: {min: 29.4, max: 90.1, mean: 45.6},
        }),
      }),
    );
    expect(html).toContain('<small>Hits:</small>');
    expect(html).toContain('≈3.1 hits');
    expect(html).toContain('per hit'); // 14.7–18% per hit (49/333, 60/333)
  });

  it('marks variable-power multi-hit as approximate', () => {
    const html = renderMoveSection(model({report: report({move: 'Triple Axel', multiHit: true, approximate: true})}));
    expect(html).toContain('multi-hit (approx.)');
  });

  it('inserts nothing for a non-damaging move (no report → empty section)', () => {
    expect(renderMoveSection(model())).toBe('');
  });

  it('tags active Tera for attacker and defender', () => {
    const html = renderMoveSection(model({attackerTera: 'Flying', defenderTera: 'Steel', report: report({move: 'X'})}));
    expect(html).toContain('Tera Flying');
    expect(html).toContain('vs Tera Steel');
  });
});

describe('renderSetsSection', () => {
  const bulkySupport = {
    name: 'Bulky Support',
    abilities: [{name: 'Clear Body', known: false}, {name: 'Liquid Ooze', known: false}],
    items: [{name: 'Leftovers', known: true}],
    gimmicks: [{kind: 'tera' as const, types: [{name: 'Flying', known: false}, {name: 'Grass', known: false}]}],
    moves: [
      {name: 'Surf', known: true, report: report({move: 'Surf', percent: {min: 30, max: 36, mean: 33}})},
      {name: 'Haze', known: false},
    ],
  };
  function model(over: Partial<SetsRenderModel> = {}): SetsRenderModel {
    return {candidates: [bulkySupport], extraNotes: [], ...over};
  }

  it("renders one block per set in the original's layout: name, then labelled lines", () => {
    const html = renderSetsSection(model());
    expect(html).toContain('<span style="text-decoration: underline;">Bulky Support</span>');
    expect(html).toContain('<small>Abilities:</small> Clear Body, Liquid Ooze');
    expect(html).toContain('<small>Tera Types:</small> Flying, Grass');
    expect(html).toContain('<small>Moves:</small>');
  });

  it('renders a Mega gimmick as its own line (Champions format)', () => {
    const charizard = {
      ...bulkySupport,
      name: 'Setup Sweeper',
      gimmicks: [{kind: 'mega' as const, stone: {name: 'Charizardite Y', known: true}, forme: 'Charizard-Mega-Y'}],
    };
    const html = renderSetsSection(model({candidates: [charizard]}));
    expect(html).toContain('<small>Mega:</small> <b>✓ Charizardite Y</b> → Charizard-Mega-Y');
    expect(html).not.toContain('Tera Types'); // a Mega-only set shows no Tera line
  });

  it('gives each set its own grey-panelled divider block', () => {
    const twoSets = renderSetsSection(model({candidates: [bulkySupport, {...bulkySupport, name: 'Fast Attacker'}]}));
    expect(twoSets.match(/<div class="hichu-block">/g)).toHaveLength(2);
  });

  it('omits the summary header entirely — the blocks speak for themselves', () => {
    const html = renderSetsSection(model());
    expect(html).not.toContain('Possible sets');
    expect(html).not.toContain('dmg vs');
    expect(html).not.toContain('sets)'); // no "1 of 2 sets" count line
  });

  it('bolds confirmed facts with a ✓ and leaves open options plain', () => {
    const html = renderSetsSection(model());
    expect(html).toContain('<b>✓ Leftovers</b>');
    expect(html).toContain('<b>✓ Surf</b>');
    expect(html).toContain('Haze');
    expect(html).not.toContain('✓ Haze');
  });

  it("puts damage in the original's parens spot, only for moves that deal any", () => {
    const html = renderSetsSection(model());
    expect(html).toContain('<b>✓ Surf</b> (30–36%)');
    expect(html).not.toContain('Haze (');
  });

  it('renders caveats as a trailing note block', () => {
    const html = renderSetsSection(model({extraNotes: ['revealed moves/item/ability matched no known set']}));
    expect(html).toContain('matched no known set');
    expect(html).toContain('hichu-note');
  });
});
