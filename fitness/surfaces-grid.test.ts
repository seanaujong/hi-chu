import {describe, it, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {SURFACES, previewsSwitchInHazards, type Cell, type HoverTarget, type SectionName} from '../src/core/surfaces.js';

/**
 * `CLAUDE.md`'s Surfaces table and `core/surfaces.ts` state the same 48 decisions, for two
 * different readers: the table orients someone asking "should X show Y?", the grid is what
 * the tooltips actually consult. Two statements of one fact drift, and this one drifts
 * silently — a cell flipped in code changes the product while the table goes on describing
 * what it used to do, which is worse than no table at all, because the doc is what a
 * stranger trusts.
 *
 * So the duplication is allowed and then CHECKED, rather than resolved by deleting one
 * side. Deleting the table would cost the orientation the doc exists to give; deleting the
 * grid would put the policy back into scattered conditionals. Pinning them together keeps
 * both and makes the pair falsifiable — the same trade `invariant-index.test.ts` already
 * makes for the invariant index next to it.
 *
 * `section.test.ts` closes the third side: that the grid matches the HTML the six surfaces
 * really render. Doc ⟺ grid ⟺ product.
 */

const CLAUDE_MD = readFileSync(join(process.cwd(), 'CLAUDE.md'), 'utf8');

/** The doc's row labels, in the order the table lists them. */
const ROW_LABELS: Readonly<Record<string, HoverTarget>> = {
  'Our move button': 'move-button',
  'Our active': 'own-active',
  'Our benched icon': 'own-bench',
  'Our switch menu': 'switch-menu',
  'Foe active': 'foe-active',
  'Foe roster icon': 'foe-bench',
};

/** The doc's column headers, in the order the table lists them. */
const COLUMN_LABELS: Readonly<Record<string, SectionName>> = {
  'Damage': 'damage',
  '⚡ lead': 'speedLead',
  'Outgoing': 'outgoing',
  '⚡ per block': 'speedPerBlock',
  '`Incoming:`': 'incoming',
  'Our dmg into them': 'ourDamageInto',
  'Sets': 'sets',
  'Mirror': 'mirror',
};

/**
 * A table cell as the grid would state it. The doc writes the hazard preview as a suffix on
 * the ✓ ("✓ +hazards") because it is a property of the SURFACE rather than a section of its
 * own — see `previewsSwitchInHazards`, which derives it from the same fact the withholding
 * rests on — so it is stripped here and checked separately below.
 */
function toCell(text: string): Cell {
  if (text.startsWith('✓')) return 'shown';
  if (text === '—') return 'absent';
  if (text === 'withheld') return 'withheld';
  if (text === 'never') return 'private';
  throw new Error(`unrecognised Surfaces cell: ${JSON.stringify(text)}`);
}

interface DocRow {
  readonly target: HoverTarget;
  readonly cells: readonly {section: SectionName; cell: Cell; claimsHazards: boolean}[];
}

/** The one table under "### Which target gets which section", parsed into grid terms. */
function docRows(): DocRow[] {
  const start = CLAUDE_MD.indexOf('| Hover target |');
  if (start === -1) throw new Error('CLAUDE.md has no Surfaces table');
  const lines = CLAUDE_MD.slice(start).split('\n');
  const cellsOf = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim());
  const headers = cellsOf(lines[0]!).slice(1);
  const sections = headers.map((h) => {
    const section = COLUMN_LABELS[h];
    if (!section) throw new Error(`unrecognised Surfaces column: ${JSON.stringify(h)}`);
    return section;
  });
  // Stop at the table's own end — the blank line after its last row. Filtering for '|'
  // instead would run on into the next table in the file and read ITS header as a row.
  const body = lines.slice(2); // the header row and the |---|---| rule
  const end = body.findIndex((line) => !line.startsWith('|'));
  return body
    .slice(0, end === -1 ? undefined : end)
    .map((line) => {
      const [label, ...values] = cellsOf(line);
      const target = ROW_LABELS[label!];
      if (!target) throw new Error(`unrecognised Surfaces row: ${JSON.stringify(label)}`);
      return {
        target,
        cells: values.map((text, i) => ({
          section: sections[i]!,
          cell: toCell(text),
          claimsHazards: text.includes('hazards'),
        })),
      };
    });
}

describe("CLAUDE.md's Surfaces table says exactly what core/surfaces.ts does", () => {
  const rows = docRows();

  it('describes all six targets — a silent parse failure must not pass vacuously', () => {
    expect(rows.map((r) => r.target).sort()).toEqual(Object.values(ROW_LABELS).sort());
    expect(rows.every((r) => r.cells.length === Object.keys(COLUMN_LABELS).length)).toBe(true);
  });

  it('agrees with the grid on every one of the 48 cells', () => {
    const disagreements = rows.flatMap((r) =>
      r.cells
        .filter(({section, cell}) => SURFACES[r.target][section] !== cell)
        .map(({section, cell}) => `${r.target}.${section}: doc says ${cell}, grid says ${SURFACES[r.target][section]}`),
    );
    expect(disagreements).toEqual([]);
  });

  it('marks the hazard preview on exactly the surfaces that apply it', () => {
    // The doc hangs "+hazards" off whichever damage column a surface shows; the grid derives
    // it from the target alone. They agree when a row claims it iff the target previews it.
    const wrong = rows
      .filter((r) => r.cells.some((c) => c.claimsHazards) !== previewsSwitchInHazards(r.target))
      .map((r) => r.target);
    expect(wrong).toEqual([]);
  });
});
