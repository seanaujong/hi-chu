import {describe, it, expect} from 'vitest';
import {koText, renderMoveSection, renderNotes, renderOwnMovesSection, renderSetsSection, renderSpeedSection, renderStrengthSap, type MoveRenderModel, type OwnMovesModel, type SetsRenderModel} from './render.js';
import type {DamageReport} from './damage.js';

function report(over: Partial<DamageReport> & {move: string}): DamageReport {
  return {
    category: 'Physical',
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
  // Tests still pass a single `report`; wrap it as the one bucket the plain line renders.
  function model(over: Partial<MoveRenderModel> & {report?: DamageReport} = {}): MoveRenderModel {
    const {report, ...rest} = over;
    return {
      defenderHpPercent: 1,
      extraNotes: [],
      buckets: report ? [{label: '', report}] : [],
      ...rest,
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
          multiHit: {
            perHit: {min: 49, max: 60},
            hits: {expected: 3.1, distribution: [[2, 0.35], [3, 0.35], [4, 0.15], [5, 0.15]]},
          },
          percent: {min: 29.4, max: 90.1, mean: 45.6},
        }),
      }),
    );
    expect(html).toContain('<small>Hits:</small>');
    expect(html).toContain('≈3.1 hits');
    expect(html).toContain('per hit'); // 14.7–18% per hit (49/333, 60/333)
  });

  it('caveats a KO claim when the foe might hold Focus Sash — "if" only while unconfirmed', () => {
    const possible = renderMoveSection(model({focusSash: 'possible', report: report({move: 'Earthquake', koChance: 0.8})}));
    expect(possible).toContain('(if Focus Sash: survives at 1 HP)');
    const certain = renderMoveSection(model({focusSash: 'certain', report: report({move: 'Earthquake', koChance: 0.8})}));
    expect(certain).toContain('(Focus Sash: survives at 1 HP)');
    expect(certain).not.toContain('if Focus Sash');
  });

  it('keeps the Sash caveat OFF whenever it would lie', () => {
    // A damaged foe: the Sash only works from full HP.
    const damaged = renderMoveSection(
      model({focusSash: 'possible', defenderHpPercent: 0.78, report: report({move: 'Earthquake', koChance: 0.8})}),
    );
    expect(damaged).not.toContain('Focus Sash');
    // A multi-hit move: the Sash pops mid-sequence and the remaining hits still land.
    const multi = renderMoveSection(
      model({
        focusSash: 'possible',
        report: report({
          move: 'Bullet Seed',
          koChance: 0.8,
          multiHit: {perHit: {min: 49, max: 60}, hits: {expected: 3.1, distribution: [[2, 0.35], [3, 0.35], [4, 0.15], [5, 0.15]]}},
        }),
      }),
    );
    expect(multi).not.toContain('Focus Sash');
    // No KO chance to deny.
    const noKo = renderMoveSection(model({focusSash: 'possible', report: report({move: 'Earthquake', koChance: 0})}));
    expect(noKo).not.toContain('Focus Sash');
  });

  it('inserts nothing for a non-damaging move (no report → empty section)', () => {
    expect(renderMoveSection(model())).toBe('');
  });

  it('tags active Tera for attacker and defender', () => {
    const html = renderMoveSection(model({attackerTera: 'Flying', defenderTera: 'Steel', report: report({move: 'X'})}));
    expect(html).toContain('Tera Flying');
    expect(html).toContain('vs Tera Steel');
  });

  it('splits into one labelled line per distinct outcome when the item is unknown', () => {
    const html = renderMoveSection(
      model({
        buckets: [
          {label: 'Leftovers', report: report({move: 'Surf', percent: {min: 78, max: 92, mean: 85}, koChance: 0.71})},
          {label: 'Assault Vest', report: report({move: 'Surf', percent: {min: 53, max: 63, mean: 58}, koChance: 0})},
        ],
      }),
    );
    // Both outcomes are shown, each named by the item that produces it, in one block.
    expect(html).toContain('<small>Damage (Leftovers):</small> 78% - 92%');
    expect(html).toContain('<small>Damage (Assault Vest):</small> 53% - 63%');
    expect(html.match(/<div class="hichu-block">/g)).toHaveLength(1);
    expect(html).not.toContain('<small>Damage:</small>'); // the plain line only appears when there's one outcome
  });

  it('shows a target header only when labelled (doubles names each foe; singles doesn’t)', () => {
    expect(renderMoveSection(model({report: report({move: 'Surf'}), targetLabel: 'Corviknight'}))).toContain('<small>vs</small> <b>Corviknight</b>');
    expect(renderMoveSection(model({report: report({move: 'Surf'})}))).not.toContain('<small>vs</small> <b>');
  });

  it('shows the KO flip: the item that saves the KO simply omits its KO clause', () => {
    const html = renderMoveSection(
      model({
        buckets: [
          {label: 'Leftovers', report: report({move: 'Surf', koChance: 0.71})},
          {label: 'Assault Vest', report: report({move: 'Surf', koChance: 0})},
        ],
      }),
    );
    expect(html).toContain('71% to KO'); // the KO'ing item keeps its clause
    expect(html).not.toContain('no KO'); // the saving item shows no blaring "no KO"
    expect(html).toContain('Damage (Assault Vest):'); // …but still shows its damage line
  });

  const withNhko = (base: number[], withLeftovers = base) =>
    model({buckets: [{label: '', report: report({move: 'Surf', koChance: base[0]!, nhko: {base, withLeftovers}})}]});

  it('shows a 2HKO/3HKO ladder (unlabelled — it reads for itself), skipping the sure OHKO', () => {
    const html = renderMoveSection(withNhko([0.08, 0.91, 1]));
    expect(html).toContain('2HKO 91% · 3HKO 100%');
  });

  it('omits the ladder for a guaranteed OHKO', () => {
    expect(renderMoveSection(withNhko([1, 1, 1]))).not.toContain('HKO');
  });

  it('omits the ladder when it can’t even 3HKO', () => {
    expect(renderMoveSection(withNhko([0, 0, 0]))).not.toContain('HKO');
  });

  it('appends an "if Leftovers" aside when Leftovers is still possible', () => {
    const html = renderMoveSection({...withNhko([0.08, 0.91, 1], [0.08, 0.6, 0.95]), leftovers: 'possible'});
    expect(html).toContain('2HKO 91% · 3HKO 100%');
    expect(html).toContain('(2HKO 60% · 3HKO 95% w/ Leftovers)');
  });

  it('uses the Leftovers ladder as the figure when Leftovers is certain', () => {
    const html = renderMoveSection({...withNhko([0.08, 0.91, 1], [0.08, 0.6, 0.95]), leftovers: 'certain'});
    expect(html).toContain('2HKO 60% · 3HKO 95%');
    expect(html).not.toContain('w/ Leftovers');
  });
});

describe('renderSetsSection', () => {
  const bulkySupport = {
    name: 'Bulky Support',
    abilities: [{name: 'Clear Body', known: false}, {name: 'Liquid Ooze', known: false}],
    items: [{name: 'Leftovers', known: true}],
    gimmicks: [{kind: 'tera' as const, types: [{name: 'Flying', known: false}, {name: 'Grass', known: false}]}],
    moves: [
      {name: 'Surf', known: true, buckets: [{label: '', report: report({move: 'Surf', percent: {min: 30, max: 36, mean: 33}})}]},
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

  it('renders a Z-Move gimmick as its own line (gen7)', () => {
    const zUser = {
      ...bulkySupport,
      name: 'Z-Move user',
      gimmicks: [{kind: 'zmove' as const, crystal: {name: 'Firium Z', known: false}}],
    };
    const html = renderSetsSection(model({candidates: [zUser]}));
    expect(html).toContain('<small>Z-Move:</small> Firium Z');
  });

  it('flags an Illusion candidate by the species it might secretly be', () => {
    const zoroark = {...bulkySupport, name: 'Bulky Attacker', species: 'Zoroark-Hisui'};
    const html = renderSetsSection(model({candidates: [zoroark]}));
    expect(html).toContain('<span style="text-decoration: underline;">Zoroark-Hisui</span>');
    expect(html).toContain('(if Illusion · Bulky Attacker)');
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

  /** A move split by a hidden item. `koChance` makes an outcome OHKO-tier; `twoHko` gives
   *  it an nHKO ladder that reaches the '2hko' tier without any single-use KO chance. */
  const split = (
    name: string,
    outcomes: readonly {label: string; min: number; max: number; koChance?: number; twoHko?: number}[],
  ) => ({
    name,
    known: true,
    buckets: outcomes.map((o) => ({
      label: o.label,
      report: report({
        move: name,
        percent: {min: o.min, max: o.max, mean: (o.min + o.max) / 2},
        koChance: o.koChance ?? 0,
        ...(o.twoHko !== undefined ? {nhko: {base: [0, o.twoHko], withLeftovers: [0, o.twoHko]}} : {}),
      }),
    })),
  });

  it('folds a move with 2+ distinct outcomes into ONE spanning range, lowest low to highest high', () => {
    // The size rule: a role holding several items multiplies out to a different number per
    // item on every move, and enumerating each one ran a hover past the screen. The span
    // covers them all and stays a single entry in the Moves: line.
    const uncertainItem = {
      ...bulkySupport,
      moves: [
        split('Draco Meteor', [
          {label: 'Choice Specs', min: 62, max: 74},
          {label: 'Leftovers', min: 41, max: 49},
        ]),
        {name: 'Haze', known: false},
      ],
    };
    const html = renderSetsSection(model({candidates: [uncertainItem]}));
    expect(html).toContain('<b>✓ Draco Meteor</b> (41–74%)');
    expect(html).not.toContain('<small>Draco Meteor:</small>'); // no per-item break-out
    expect(html).not.toContain('Choice Specs)'); // …and no per-item label
  });

  it('spells out the ONE outcome that decides a KO, naming the set it rests on', () => {
    // What the span can't say: the top of it kills and the bottom doesn't. The KO chance
    // rides along because a 106% maximum roll says nothing about how much of the
    // distribution clears the HP bar.
    const decided = {
      ...bulkySupport,
      moves: [
        split('Tri Attack', [
          {label: 'Choice Specs · Download', min: 89, max: 106, koChance: 0.62},
          {label: 'Choice Scarf · Adaptability', min: 53, max: 63},
        ]),
      ],
    };
    const html = renderSetsSection(model({candidates: [decided]}));
    expect(html).toContain('<b class="hichu-ko"><b>✓ Tri Attack</b> (53–106%)</b>'); // span wears the danger
    expect(html).toContain(
      '<small>Tri Attack:</small> <span class="hichu-ko">62% to KO</span> <small>if</small> Choice Specs · Download',
    );
    expect(html).not.toContain('Choice Scarf'); // the surviving outcome needs no line of its own
  });

  it('conditions nothing when EVERY outcome KOes — an "if" would invent a doubt', () => {
    const alwaysLethal = {
      ...bulkySupport,
      moves: [
        split('Overkill', [
          {label: 'Life Orb', min: 120, max: 140, koChance: 1},
          {label: 'Leftovers', min: 100, max: 118, koChance: 0.9},
        ]),
      ],
    };
    const html = renderSetsSection(model({candidates: [alwaysLethal]}));
    expect(html).toContain('<b class="hichu-ko"><b>✓ Overkill</b> (100–140%)</b>');
    expect(html).not.toContain('<small>if</small>');
  });

  it('conditions nothing on a 2HKO/3HKO split — the sets view grades danger, not every move', () => {
    // Life Orb reaches the '2hko' tier and Leftovers doesn't, so this move DOES split on a
    // tier boundary — just not the one worth a line. Only a KO gets spelled out.
    const graded = {
      ...bulkySupport,
      moves: [
        split('Middling', [
          {label: 'Life Orb', min: 45, max: 55, twoHko: 0.6},
          {label: 'Leftovers', min: 30, max: 38},
        ]),
      ],
    };
    const html = renderSetsSection(model({candidates: [graded]}));
    expect(html).toContain('<span class="hichu-note"><b>✓ Middling</b> (30–55%)</span>'); // amber span
    expect(html).not.toContain('<small>Middling:</small>');
  });

  it('colors an OHKO-risk outcome red+bold and a realistic 2HKO one amber, but leaves a 3HKO+ move plain', () => {
    const graded = {
      ...bulkySupport,
      moves: [
        {name: 'Ohko Move', known: false, buckets: [{label: '', report: report({move: 'Ohko Move', koChance: 0.4})}]},
        {name: 'Twohko Move', known: false, buckets: [
          {label: '', report: report({move: 'Twohko Move', koChance: 0, nhko: {base: [0, 0.6], withLeftovers: [0, 0.6]}})},
        ]},
        {name: 'Threehko Move', known: false, buckets: [
          {label: '', report: report({move: 'Threehko Move', koChance: 0, nhko: {base: [0, 0, 0.9], withLeftovers: [0, 0, 0.9]}})},
        ]},
      ],
    };
    const html = renderSetsSection(model({candidates: [graded]}));
    expect(html).toContain('<b class="hichu-ko">Ohko Move (30–36%)</b>');
    expect(html).toContain('<span class="hichu-note">Twohko Move (30–36%)</span>');
    expect(html).not.toMatch(/class="hichu-(ko|note)">Threehko Move/);
  });

  it('renders caveats as a trailing note block', () => {
    const html = renderSetsSection(model({extraNotes: ['revealed moves/item/ability matched no known set']}));
    expect(html).toContain('matched no known set');
    expect(html).toContain('hichu-note');
  });
});

describe('renderSpeedSection', () => {
  const order = (ourSpeed: number, outcomes: {speed: number; label?: string; first: 'ours' | 'theirs' | 'tie'}[], trickRoom = false) => ({
    ourSpeed,
    trickRoom,
    outcomes: outcomes.map((o) => ({speed: o.speed, label: o.label ?? '', first: o.first})),
  });

  it('renders the single-outcome verdict, numbers always OURS vs THEIRS', () => {
    const html = renderSpeedSection([{order: order(231, [{speed: 213, first: 'ours'}])}]);
    expect(html).toContain('⚡ you move first — 231 vs 213');
    expect(html).toContain('hichu-block'); // its own native-style divider block
  });

  it('paints a foe-first verdict red — being outsped is the threat, like the KO figure', () => {
    const html = renderSpeedSection([{order: order(166, [{speed: 213, first: 'theirs'}])}]);
    expect(html).toContain('<span class="hichu-note">they move first</span> — 166 vs 213');
  });

  it('leads with the majority outcome and rides the Scarf case along as an "if" aside', () => {
    const html = renderSpeedSection([
      {order: order(231, [{speed: 213, first: 'ours'}, {speed: 319, label: 'Choice Scarf', first: 'theirs'}])},
    ]);
    expect(html).toContain('you move first — 231 vs 213');
    expect(html).toContain('<small>if Choice Scarf:</small> <span class="hichu-note">they do</span> (319)');
  });

  it('drops an aside that reaches the same verdict — "faster unless X, still faster" says nothing', () => {
    const html = renderSpeedSection([
      {order: order(231, [{speed: 213, first: 'ours'}, {speed: 150, label: 'Iron Ball', first: 'ours'}])},
    ]);
    expect(html).toContain('⚡ you move first — 231 vs 213');
    expect(html).not.toContain('Iron Ball');
    expect(html).not.toContain('·'); // no aside at all, so no separator either
  });

  it('keeps a tie aside — a 50/50 is a different answer from "you move first", not a restatement', () => {
    const html = renderSpeedSection([
      {order: order(231, [{speed: 213, first: 'ours'}, {speed: 231, label: 'Choice Scarf', first: 'tie'}])},
    ]);
    expect(html).toContain('<small>if Choice Scarf:</small> speed tie (231)');
  });

  it('keeps only the contradicting aside when the foe has both a slower and a faster possibility', () => {
    const html = renderSpeedSection([
      {
        order: order(231, [
          {speed: 213, first: 'ours'},
          {speed: 150, label: 'Iron Ball', first: 'ours'},
          {speed: 319, label: 'Choice Scarf', first: 'theirs'},
        ]),
      },
    ]);
    expect(html).toContain('<small>if Choice Scarf:</small> <span class="hichu-note">they do</span> (319)');
    expect(html).not.toContain('Iron Ball');
  });

  it('labels a Trick Room verdict (already flipped upstream) so the slower-wins read explains itself', () => {
    const html = renderSpeedSection([{order: order(166, [{speed: 213, first: 'ours'}], true)}]);
    expect(html).toContain('<small>Trick Room:</small> you move first — 166 vs 213');
  });

  it('calls a tie a tie', () => {
    const html = renderSpeedSection([{order: order(231, [{speed: 231, first: 'tie'}])}]);
    expect(html).toContain('speed tie — 231 vs 231');
  });

  it('names our active only when given one (doubles — singles omits the noise)', () => {
    const html = renderSpeedSection([
      {order: order(231, [{speed: 213, first: 'ours'}]), ourName: 'Kyurem'},
      {order: order(166, [{speed: 213, first: 'theirs'}]), ourName: 'Iron Hands'},
    ]);
    expect(html).toContain('<small>your Kyurem:</small> you move first');
    expect(html).toContain('<small>your Iron Hands:</small>');
  });

  it('renders nothing when there are no outcomes to judge', () => {
    expect(renderSpeedSection([{order: order(231, [])}])).toBe('');
    expect(renderSpeedSection([])).toBe('');
  });
});

describe('renderOwnMovesSection (own hover: your moves vs the foe active)', () => {
  const section = (over: Partial<OwnMovesModel> = {}): OwnMovesModel => ({
    foeName: 'Tentacruel',
    defenderHpPercent: 1,
    moves: [{name: 'Draco Meteor', buckets: [{label: '', report: report({move: 'Draco Meteor'})}]}],
    ...over,
  });

  it('heads the block with the target — the tooltip is about OUR mon, so the foe needs naming', () => {
    const html = renderOwnMovesSection([section()]);
    expect(html).toContain('<small>vs</small> <b>Tentacruel</b>');
    expect(html).toContain('<div class="hichu-block">');
  });

  it('gives each move a line in the native damage format', () => {
    const html = renderOwnMovesSection([section()]);
    expect(html).toContain('Draco Meteor: 30% - 36%');
  });

  it('adds a red KO figure, with HP context only when the foe is damaged', () => {
    const hurt = renderOwnMovesSection([
      section({defenderHpPercent: 0.78, moves: [{name: 'Surf', buckets: [{label: '', report: report({move: 'Surf', koChance: 0.52})}]}]}),
    ]);
    expect(hurt).toContain('<span class="hichu-ko">52% to KO</span> at 78% HP');
    const full = renderOwnMovesSection([
      section({moves: [{name: 'Surf', buckets: [{label: '', report: report({move: 'Surf', koChance: 0.52})}]}]}),
    ]);
    expect(full).toContain('<span class="hichu-ko">52% to KO</span>');
    expect(full).not.toContain('at 100% HP');
  });

  it("labels each distinct outcome when the foe's hidden item splits the number", () => {
    const html = renderOwnMovesSection([
      section({
        moves: [{
          name: 'Draco Meteor',
          buckets: [
            {label: 'Assault Vest', report: report({move: 'Draco Meteor', percent: {min: 20, max: 24, mean: 22}})},
            {label: 'Leftovers', report: report({move: 'Draco Meteor'})},
          ],
        }],
      }),
    ]);
    expect(html).toContain('Draco Meteor: <small>(Assault Vest)</small> 20% - 24% · <small>(Leftovers)</small> 30% - 36%');
  });

  it('renders one headed block per foe (doubles) and nothing for a foe with no modellable move', () => {
    const html = renderOwnMovesSection([section(), section({foeName: 'Noivern', moves: []})]);
    expect(html).toContain('<b>Tentacruel</b>');
    expect(html).not.toContain('<b>Noivern</b>');
    expect(renderOwnMovesSection([])).toBe('');
  });

  it('puts the ⚡ verdict between the target header and the move lines', () => {
    const html = renderOwnMovesSection([
      section({speed: {ourSpeed: 249, trickRoom: false, outcomes: [{speed: 216, label: '', first: 'ours'}]}}),
    ]);
    expect(html).toContain('⚡ you move first — 249 vs 216');
    expect(html.indexOf('<b>Tentacruel</b>')).toBeLessThan(html.indexOf('⚡'));
    expect(html.indexOf('⚡')).toBeLessThan(html.indexOf('Draco Meteor:'));
  });

  it("carries the foe's 'if …' asides, exactly as the foe hover's line does", () => {
    const html = renderOwnMovesSection([
      section({
        speed: {
          ourSpeed: 249,
          trickRoom: false,
          outcomes: [{speed: 216, label: '', first: 'ours'}, {speed: 324, label: 'Choice Scarf', first: 'theirs'}],
        },
      }),
    ]);
    expect(html).toContain('<small>if Choice Scarf:</small> <span class="hichu-note">they do</span> (324)');
  });

  it('omits the ⚡ line when there is no speed — an open format has no foe pool to read one from', () => {
    expect(renderOwnMovesSection([section()])).not.toContain('⚡');
  });

  describe('the incoming half — what the foe’s own moves would do INTO this mon', () => {
    it('lists each incoming move under its own "Incoming:" label, after the outgoing lines', () => {
      const html = renderOwnMovesSection([
        section({
          incoming: {
            attackerHpPercent: 1,
            moves: [{name: 'Sludge Bomb', buckets: [{label: '', report: report({move: 'Sludge Bomb', percent: {min: 30, max: 36, mean: 33}})}]}],
          },
        }),
      ]);
      expect(html).toContain('<small>Incoming:</small>');
      expect(html).toContain('Sludge Bomb: 30% - 36%');
      expect(html.indexOf('Draco Meteor:')).toBeLessThan(html.indexOf('<small>Incoming:</small>'));
      expect(html.indexOf('<small>Incoming:</small>')).toBeLessThan(html.indexOf('Sludge Bomb:'));
    });

    it('puts the incoming half in its own .hichu-block, divided from the outgoing half', () => {
      const html = renderOwnMovesSection([
        section({
          incoming: {
            attackerHpPercent: 1,
            moves: [{name: 'Sludge Bomb', buckets: [{label: '', report: report({move: 'Sludge Bomb'})}]}],
          },
        }),
      ]);
      expect(html.match(/<div class="hichu-block">/g)).toHaveLength(2);
      const outgoingBlockEnd = html.indexOf('</div>');
      expect(html.indexOf('Draco Meteor:')).toBeLessThan(outgoingBlockEnd);
      expect(outgoingBlockEnd).toBeLessThan(html.indexOf('<small>Incoming:</small>'));
    });

    it('grades the incoming KO chance against OUR OWN hp, not the foe’s', () => {
      const html = renderOwnMovesSection([
        section({
          defenderHpPercent: 1, // the foe is at full — must NOT drive the incoming KO context
          incoming: {
            attackerHpPercent: 0.4,
            moves: [{name: 'Knock Off', buckets: [{label: '', report: report({move: 'Knock Off', koChance: 0.8})}]}],
          },
        }),
      ]);
      expect(html).toContain('<span class="hichu-ko">80% to KO</span> at 40% HP');
    });

    it('marks a move the foe has actually used with the sets view’s own ✓', () => {
      const html = renderOwnMovesSection([
        section({
          incoming: {
            attackerHpPercent: 1,
            moves: [
              {name: 'Surf', known: true, buckets: [{label: '', report: report({move: 'Surf'})}]},
              {name: 'Sludge Bomb', known: false, buckets: [{label: '', report: report({move: 'Sludge Bomb'})}]},
            ],
          },
        }),
      ]);
      expect(html).toContain('<b>✓ Surf</b>:');
      expect(html).toContain('Sludge Bomb:');
      expect(html).not.toContain('✓ Sludge Bomb');
    });

    it('labels a distinct outcome when the foe’s hidden item changes the incoming damage', () => {
      const html = renderOwnMovesSection([
        section({
          incoming: {
            attackerHpPercent: 1,
            moves: [{
              name: 'Knock Off',
              buckets: [
                {label: 'Life Orb', report: report({move: 'Knock Off', percent: {min: 25, max: 30, mean: 27}})},
                {label: 'Leftovers', report: report({move: 'Knock Off'})},
              ],
            }],
          },
        }),
      ]);
      expect(html).toContain('Knock Off: <small>(Life Orb)</small> 25% - 30% · <small>(Leftovers)</small> 30% - 36%');
    });

    it('omits the Incoming label entirely when there is nothing to show (open format, or no modellable move)', () => {
      const html = renderOwnMovesSection([section()]);
      expect(html).not.toContain('Incoming');
      expect(renderOwnMovesSection([section({incoming: {attackerHpPercent: 1, moves: []}})])).not.toContain('Incoming');
    });

    it('still renders the block when only the incoming half has anything to show', () => {
      const html = renderOwnMovesSection([
        section({
          moves: [], // nothing modellable outgoing — a status-only set, say
          incoming: {
            attackerHpPercent: 1,
            moves: [{name: 'Surf', buckets: [{label: '', report: report({move: 'Surf'})}]}],
          },
        }),
      ]);
      expect(html).toContain('<b>Tentacruel</b>');
      expect(html).toContain('Surf:');
    });
  });
});

describe('renderNotes (tooltip-wide caveats)', () => {
  it('renders one ⚠ line per note in its own block, and nothing for none', () => {
    expect(renderNotes(['foe EVs/item assumed'])).toBe(
      '<div class="hichu-block"><p><span class="hichu-note">⚠ foe EVs/item assumed</span></p></div>',
    );
    expect(renderNotes([])).toBe('');
  });
});

describe('a Substitute on the move tooltip', () => {
  const model = (over: Partial<MoveRenderModel> & {report: DamageReport}): MoveRenderModel => {
    const {report, ...rest} = over;
    return {defenderHpPercent: 1, extraNotes: [], buckets: [{label: '', report}], ...rest};
  };
  const absorbs = (hits: {min: number; max: number}, dented = false) =>
    ({kind: 'absorbs', hits, dented}) as const;

  it('says how many hits break it, in the same shape as the damage range above', () => {
    const html = renderMoveSection(model({report: report({move: 'Waterfall', substitute: absorbs({min: 2, max: 2})})}));
    expect(html).toContain('<small>Sub:</small> 2 hits to break');
  });

  it('gives a range when the rolls decide it, and singular when it is one hit', () => {
    expect(renderMoveSection(model({report: report({move: 'Bullet Seed', substitute: absorbs({min: 2, max: 3})})})))
      .toContain('<small>Sub:</small> 2-3 hits to break');
    expect(renderMoveSection(model({report: report({move: 'Boomburst', substitute: absorbs({min: 1, max: 1})})})))
      .toContain('<small>Sub:</small> 1 hit to break');
  });

  it('caps a DENTED doll rather than bracketing it — a chipped sub only breaks sooner', () => {
    const html = renderMoveSection(model({report: report({move: 'Waterfall', substitute: absorbs({min: 2, max: 2}, true)})}));
    expect(html).toContain('at most 2 hits to break');
    // …and stays grammatical at the one-hit end, where the cap still reads.
    expect(renderMoveSection(model({report: report({move: 'Waterfall', substitute: absorbs({min: 1, max: 1}, true)})})))
      .toContain('at most 1 hit to break');
  });

  it('says a bypassing move ignores it, and gives no count for a doll it never meets', () => {
    const html = renderMoveSection(model({report: report({move: 'Boomburst', substitute: {kind: 'bypassed'}})}));
    expect(html).toContain('<small>Sub:</small> ignored');
    expect(html).not.toContain('to break');
  });

  it('adds nothing at all when there is no sub', () => {
    expect(renderMoveSection(model({report: report({move: 'Waterfall'})}))).not.toContain('Sub:');
  });

  it('makes NO KO claim while a sub stands, however lethal the damage', () => {
    // The whole point: a foe on 40% HP behind a doll takes nothing from a 45% hit, so red —
    // which this stylesheet defines as "a Pokémon faints" — would be claiming a KO that
    // cannot happen this turn. The damage range itself is untouched and still shown.
    const lethal = report({
      move: 'Waterfall',
      percent: {min: 42, max: 50, mean: 46},
      koChance: 1,
      nhko: {base: [1, 1, 1], withLeftovers: [1, 1, 1]},
      substitute: absorbs({min: 1, max: 1}),
    });
    const html = renderMoveSection(model({report: lethal, defenderHpPercent: 0.4}));
    expect(html).not.toContain('hichu-ko');
    expect(html).not.toContain('guaranteed KO');
    expect(html).not.toContain('HKO');
    expect(html).toContain('<small>Damage:</small> 42% - 50%');
  });

  it('keeps the KO claim when the move goes straight through the doll', () => {
    const html = renderMoveSection(model({
      report: report({move: 'Boomburst', koChance: 1, substitute: {kind: 'bypassed'}}),
    }));
    expect(html).toContain('hichu-ko');
    expect(html).toContain('guaranteed KO');
  });

  it('withholds the Focus Sash aside too — it also rests on the hit landing', () => {
    const html = renderMoveSection(model({
      report: report({move: 'Waterfall', koChance: 1, substitute: absorbs({min: 1, max: 1})}),
      focusSash: 'certain',
    }));
    expect(html).not.toContain('Focus Sash');
  });

  it('folds several possible defending sets into ONE count spanning them', () => {
    // An Assault Vest halves the hit, so the doll in front of it stands for longer. One
    // range covering both is the same honest shape the damage lines above already use.
    const html = renderMoveSection({
      defenderHpPercent: 1,
      extraNotes: [],
      buckets: [
        {label: 'Assault Vest', report: report({move: 'Surf', substitute: absorbs({min: 4, max: 5})})},
        {label: 'no Assault Vest', report: report({move: 'Surf', percent: {min: 60, max: 71, mean: 65}, substitute: absorbs({min: 2, max: 2})})},
      ],
    });
    expect(html).toContain('<small>Sub:</small> 2-5 hits to break');
  });
});

describe('a Substitute on the matchup view’s compact lines', () => {
  const section = (over: Partial<OwnMovesModel> = {}): OwnMovesModel => ({
    foeName: 'Tentacruel',
    defenderHpPercent: 1,
    moves: [{name: 'Draco Meteor', buckets: [{label: '', report: report({move: 'Draco Meteor'})}]}],
    ...over,
  });
  const absorbs = (hits: {min: number; max: number}, dented = false) =>
    ({kind: 'absorbs', hits, dented}) as const;

  it('carries the same hit count inline, where a line of its own would cost more than it says', () => {
    const html = renderOwnMovesSection([section({
      moves: [{name: 'Surf', buckets: [{label: '', report: report({move: 'Surf', substitute: absorbs({min: 2, max: 3})})}]}],
    })]);
    expect(html).toContain('<small>sub:</small> 2-3 hits to break');
  });

  it('drops the KO claim on those lines too, in either direction', () => {
    const outgoing = renderOwnMovesSection([section({
      moves: [{name: 'Surf', buckets: [{label: '', report: report({move: 'Surf', koChance: 1, substitute: absorbs({min: 2, max: 2})})}]}],
    })]);
    expect(outgoing).not.toContain('hichu-ko');
    const incoming = renderOwnMovesSection([section({
      moves: [],
      incoming: {
        attackerHpPercent: 0.3,
        moves: [{name: 'Sludge Bomb', buckets: [{label: '', report: report({move: 'Sludge Bomb', koChance: 1, substitute: absorbs({min: 2, max: 2})})}]}],
      },
    })]);
    expect(incoming).not.toContain('hichu-ko');
  });

  it('stays silent about a move that goes straight through — its damage line is the whole truth', () => {
    const html = renderOwnMovesSection([section({
      moves: [{name: 'Boomburst', buckets: [{label: '', report: report({move: 'Boomburst', koChance: 1, substitute: {kind: 'bypassed'}})}]}],
    })]);
    expect(html).not.toContain('sub:');
    expect(html).toContain('hichu-ko'); // …and it still claims its KO
  });
});

describe('the sets view behind a Substitute', () => {
  it('keeps every damage number but strips the danger tiers', () => {
    // koTier is the single place the sets view decides red-or-amber, so one guard covers
    // both: nothing a doll is absorbing is close to a KO, of any tier.
    const model = (substitute?: DamageReport['substitute']): SetsRenderModel => ({
      candidates: [{
        name: 'Bulky Support',
        abilities: [],
        items: [],
        gimmicks: [],
        moves: [{name: 'Surf', known: true, buckets: [{label: '', report: report({move: 'Surf', koChance: 1, ...(substitute ? {substitute} : {})})}]}],
      }],
      extraNotes: [],
    });
    expect(renderSetsSection(model())).toContain('hichu-ko');
    const blocked = renderSetsSection(model({kind: 'absorbs', hits: {min: 2, max: 2}, dented: false}));
    expect(blocked).not.toContain('hichu-ko');
    expect(blocked).toContain('(30\u201336%)'); // the number itself is true and stays
  });
});

describe('renderStrengthSap', () => {
  it('states the swing on one line when the target’s sets agree', () => {
    const html = renderStrengthSap({before: 20.1, outcomes: [{after: 93.7, label: '', weight: 1}]});
    expect(html).toContain('<small>Strength Sap:</small> you 20.1% → 93.7% (+73.6%)');
    expect(html).not.toContain('hichu-note'); // a gain reads as good news, uncoloured
  });

  it('gives each distinct outcome its own labelled line', () => {
    const html = renderStrengthSap({
      before: 20.1,
      outcomes: [
        {after: 93.7, label: 'Bulky Attacker', weight: 1},
        {after: 76.8, label: 'Bulky Support', weight: 1},
      ],
    });
    expect(html).toContain('<small>Strength Sap (Bulky Attacker):</small> you 20.1% → 93.7%');
    expect(html).toContain('<small>Strength Sap (Bulky Support):</small> you 20.1% → 76.8%');
  });

  it('marks a swing that goes the WRONG way — Liquid Ooze, not a KO claim', () => {
    const html = renderStrengthSap({before: 90.2, outcomes: [{after: 24.8, label: '', weight: 1}]});
    expect(html).toContain('<span class="hichu-note">');
    expect(html).toContain('you 90.2% → 24.8% (-65.4%)');
    expect(html).not.toContain('hichu-ko'); // red means "this KOes THEM"; never our own cost
  });

  it('renders nothing at all when there is no outcome to state', () => {
    expect(renderStrengthSap({before: 0, outcomes: []}, 'Tentacruel')).toBe('');
  });
});
