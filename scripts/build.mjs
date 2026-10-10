import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = (...parts) => join(root, ...parts);
// Generate declaration/runtime dependencies from source, including fresh clones.
execFileSync(process.execPath, [path('packages/font-metrics/tools/build.mjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path('node_modules/typescript/bin/tsc'), '-p', path('packages/canvas-renderer/tsconfig.json')], { stdio: 'inherit' });
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
// The verified T04 browser bundle is shared by all native entry points. Resolve
// the external require relative to each emitted file; native CommonJS does not
// promise support for absolute /vendor imports.
await mkdir(path('dist/miniprogram/vendor'), { recursive: true });
await cp(path('packages/font-metrics/dist/miniapp.cjs'), path('dist/miniprogram/vendor/font-metrics.js'));
for (const entry of entries) {
  const destination = path('dist/miniprogram', relative(path('miniprogram'), entry).replace(/\.ts$/, '.js'));
  const vendor = relative(dirname(destination), path('dist/miniprogram/vendor/font-metrics.js')).replaceAll('\\', '/');
  await build({ ...options, platform: 'neutral', target: 'es2017', entryPoints: [entry], outfile: destination,
    plugins: [{ name: 'shared-original-font-provider', setup(builder) {
      builder.onResolve({ filter: /font-metrics\/dist\/index\.js$/ }, () => ({ path: vendor.startsWith('.') ? vendor : `./${vendor}`, external: true }));
    } }] });
}
for (const source of hostFiles.filter(file => /\.(?:json|wxml|wxss|png)$/.test(file))) {
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
