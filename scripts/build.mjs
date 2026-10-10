import { build } from 'esbuild';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = (...parts) => join(root, ...parts);
// Only own these output paths: other packages may build into dist too.
await rm(path('dist/runtime'), { recursive: true, force: true });
await rm(path('dist/miniprogram'), { recursive: true, force: true });

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory()
    ? sourceFiles(join(directory, entry.name)) : [join(directory, entry.name)]));
  return files.flat();
}

const options = { bundle: true, format: 'cjs', logLevel: 'warning', sourcemap: false };
const targets = [
  { name: 'miniapp', platform: 'neutral', target: 'es2017' },
  { name: 'cloud', platform: 'node', target: 'node20' },
];
for (const target of targets) {
  for (const [entry, filename] of [
    ['packages/paper-core/src/index.ts', 'paper-core.cjs'],
    ['packages/runtime-smoke/src/index.ts', 'runtime-smoke.cjs'],
  ]) {
    await build({ ...options, platform: target.platform, target: target.target,
      entryPoints: [path(entry)], outfile: path('dist/runtime', target.name, filename) });
  }
}

const hostFiles = await sourceFiles(path('miniprogram'));
const entries = hostFiles.filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'));
await build({ ...options, platform: 'neutral', target: 'es2017',
  entryPoints: entries, outbase: path('miniprogram'), outdir: path('dist/miniprogram') });
for (const source of hostFiles.filter(file => /\.(?:json|wxml|wxss)$/.test(file))) {
  const destination = path('dist/miniprogram', relative(path('miniprogram'), source));
  await mkdir(join(destination, '..'), { recursive: true });
  await cp(source, destination);
}
await writeFile(path('dist/runtime/build-info.json'), JSON.stringify({
  sharedSource: 'packages/paper-core/src/index.ts',
  targets: targets.map(({ name, target }) => ({ name, target })),
  targetRuntimeVerified: false,
}, null, 2) + '\n');
console.log('Built shared core + smoke for miniapp/cloud and native development host.');
