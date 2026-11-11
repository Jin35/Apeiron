/**
 * Run scripts/generate-hierarchy.ts and write data/smartphone.json.
 * `npm run generate` from the repo root calls this.
 */
import { createServer } from 'vite';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../..');
const server = await createServer({
  root: repoRoot,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

try {
  const loaded = await server.ssrLoadModule(pathToFileURL(join(here, 'generate-hierarchy.ts')).href);
  loaded.writePresented();
} finally {
  await server.close();
}
