import { cpSync, createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(appRoot, '../..');
const packPublic = [
  join(repoRoot, 'packages/pack-smartphone/public'),
  join(repoRoot, 'packages/pack-archipelago/public'),
];

const mime: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
};

/** Serve and copy pack `public/` trees so image URLs stay `images/...`. */
function packAssets(): Plugin {
  return {
    name: 'pack-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
        if (url.includes('..')) {
          next();
          return;
        }
        for (const dir of packPublic) {
          const file = join(dir, url);
          if (!existsSync(file) || !statSync(file).isFile()) continue;
          res.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream');
          createReadStream(file).pipe(res);
          return;
        }
        next();
      });
    },
    writeBundle(options) {
      const outDir = options.dir;
      if (!outDir) return;
      for (const dir of packPublic) {
        cpSync(dir, outDir, { recursive: true, dereference: true });
      }
    },
  };
}

// Relative base so `vite dev`, `vite preview`, and GitHub project pages
// all resolve assets without a hardcoded repository name.
export default defineConfig({
  base: './',
  plugins: [packAssets()],
  build: {
    outDir: resolve(repoRoot, 'dist'),
    emptyOutDir: true,
  },
});
