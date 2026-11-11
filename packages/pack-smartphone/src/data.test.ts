import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { presentedJson } from '../scripts/generate-hierarchy';

const packRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('smartphone data', () => {
  it('matches a fresh run of the generator', () => {
    const checked = readFileSync(join(packRoot, 'data/smartphone.json'), 'utf8');
    expect(checked).toBe(presentedJson());
  });

  it('keeps pack ids out of the layout code', () => {
    const source = readFileSync(join(packRoot, 'src/treeLayout.ts'), 'utf8');
    expect(source).not.toMatch(/\bphone\b|\bbattery\b|\binternals\b/);
  });
});
