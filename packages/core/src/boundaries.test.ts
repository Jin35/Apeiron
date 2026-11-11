import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.mjs')) found.push(path);
  }
  return found;
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:import|export)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier) found.push(specifier);
  }
  const sideEffect = /import\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(sideEffect)) {
    const specifier = match[1];
    if (specifier) found.push(specifier);
  }
  return found;
}

/** Banned words, built so this file does not contain them. */
function bannedWordPattern(): RegExp {
  const word = (codes: number[]) => String.fromCharCode(...codes);
  const names = [
    word([115, 109, 97, 114, 116, 112, 104, 111, 110, 101]),
    word([112, 104, 111, 110, 101]),
    word([98, 97, 116, 116, 101, 114, 121]),
  ];
  return new RegExp(`\\b(${names.join('|')})\\b`, 'i');
}

describe('package boundaries', () => {
  const coreFiles = sourceFiles(join(repoRoot, 'packages/core')).filter(
    (path) => !path.endsWith('boundaries.test.ts'),
  );

  it('keeps core from importing a pack or the app', () => {
    const leaks: string[] = [];
    for (const path of coreFiles) {
      const source = readFileSync(path, 'utf8');
      for (const specifier of specifiers(source)) {
        if (
          specifier.includes('pack-smartphone') ||
          specifier.includes('pack-archipelago') ||
          specifier.includes('/apps/') ||
          specifier.startsWith('@apeiron/pack') ||
          specifier.startsWith('@apeiron/app')
        ) {
          leaks.push(`${relative(repoRoot, path)} -> ${specifier}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('keeps pack names and pack themes out of core', () => {
    const banned = bannedWordPattern();
    const hits: string[] = [];
    for (const path of coreFiles) {
      const source = readFileSync(path, 'utf8');
      if (banned.test(source) || source.includes('paperTheme') || source.includes('darkTheme')) {
        hits.push(relative(repoRoot, path));
      }
    }
    expect(hits).toEqual([]);
  });

  it('makes packs import core through the public entry', () => {
    const leaks: string[] = [];
    for (const pack of ['pack-smartphone', 'pack-archipelago']) {
      for (const path of sourceFiles(join(repoRoot, 'packages', pack))) {
        const source = readFileSync(path, 'utf8');
        for (const specifier of specifiers(source)) {
          const deep =
            specifier.startsWith('@apeiron/core/') ||
            specifier.includes('packages/core/src') ||
            /(?:^|\/)core\/src(?:\/|$)/.test(specifier);
          if (deep) leaks.push(`${relative(repoRoot, path)} -> ${specifier}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
