import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { countMark, parseHierarchy, parseRepeat, perParentCount, presentedJson } from '../scripts/generate-hierarchy';

const packRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('smartphone data', () => {
  it('matches a fresh run of the generator', () => {
    const checked = readFileSync(join(packRoot, 'data/smartphone.json'), 'utf8');
    expect(checked).toBe(presentedJson());
  });

  it('reads a plain integer count and a Repeat line', () => {
    expect(countMark('~15 billion transistors/chip')).toBe('×~15 billion');
    expect(perParentCount('~15 billion transistors/chip')).toBe(1.5e10);
    expect(countMark('4 per parent (2-input NAND)')).toBe('×4');
    expect(perParentCount('4 per parent (2-input NAND)')).toBe(4);
    expect(countMark('13,924 per parent')).toBe('×13924');
    expect(perParentCount('13,924 per parent')).toBe(13924);
    expect(perParentCount('2,965,950 per parent')).toBe(2965950);
    expect(perParentCount('1,024 per parent')).toBe(1024);
    expect(perParentCount('1 per parent')).toBeNull();
    expect(countMark('1 representative item')).toBeNull();
    expect(parseRepeat('grid 2 × 2, pitch 51 nm')).toEqual({
      kind: 'grid',
      cols: 2,
      rows: 2,
      pitchXMm: 51e-6,
      pitchYMm: 51e-6,
    });
    expect(parseRepeat('rows, pitch 0.2 mm, no stagger')).toEqual({ kind: 'rows', pitchMm: 0.2 });
    expect(parseRepeat('rows, pitch 0.335 nm, stagger 0.1 nm')?.kind).toBe('rows');
    expect(parseRepeat('scatter seed 3 density 4 /nm²')?.kind).toBe('scatter');
    expect(parseRepeat('lattice honeycomb, a 0.246 nm, 2 × 1')).toEqual({
      kind: 'lattice',
      lattice: 'honeycomb',
      aMm: 0.246e-6,
      cols: 2,
      rows: 1,
    });
    expect(parseRepeat('lattice diamond, a 0.543099 nm, 1 × 1, basis 4')?.kind).toBe('lattice');
    expect(parseRepeat('lattice diamond, a 0.543099 nm, 1 × 1, basis 8')).toBeNull();

    const parsed = parseHierarchy(`### Example (\`example\`)
- Parent: none
- Status: planned
- Kind: part
- Characteristic size: 50 nm
- Count: 4 per parent
- Repeat: grid 2 × 2, pitch 51 nm
`);
    expect(parsed[0]?.repeat).toMatchObject({ count: 4, pattern: { kind: 'grid', cols: 2, rows: 2 } });
    expect(() =>
      parseHierarchy(`### Bad (\`bad\`)
- Parent: none
- Status: planned
- Kind: part
- Characteristic size: 50 nm
- Count: 3 per parent
- Repeat: grid 2 × 2, pitch 51 nm
`),
    ).toThrow(/grid/);
  });

  it('keeps pack ids out of the layout code', () => {
    const source = readFileSync(join(packRoot, 'src/treeLayout.ts'), 'utf8');
    expect(source).not.toMatch(/\bphone\b|\bbattery\b|\binternals\b/);
  });
});
