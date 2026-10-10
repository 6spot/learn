import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const [suite, ...extra] = process.argv.slice(2);
if (extra.length || !['canvas', 'editor', 'compatibility', 'product'].includes(suite)) {
  console.error('Use node scripts/run-devtools-test.mjs canvas|editor|compatibility|product.');
  process.exit(1);
}

const root = fileURLToPath(new URL('../', import.meta.url));
// Build/import failures must not leave an earlier passing report as current.
await rm(new URL(`../dist/${suite}-evidence/report.json`, import.meta.url), { force: true });
for (const args of [['scripts/build.mjs'], [`scripts/test-${suite}-devtools.mjs`, '--diagnostics']]) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', shell: false });
  if (result.error) console.error('Unable to start the requested diagnostics process.');
  if (result.status !== 0) process.exit(result.status ?? 1);
}
