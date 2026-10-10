import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPublicBuildConfig } from './public-build-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = (...parts) => join(root, ...parts);
const args = process.argv.slice(2);
const production = args[0] === '--production';
if (args.length && !(production && args.length === 3 && args[1] === '--config')) {
  throw new Error('Usage: node scripts/build.mjs [--production --config <public-config-file>]');
}
const publicConfig = production ? await readPublicBuildConfig(args[2]) : null;
const nativeRoot = production ? 'dist/release/miniprogram' : 'dist/miniprogram';
const diagnostics = ['pages/runtime/', 'pages/canvas-diagnostics/'];
// Generate declaration/runtime dependencies from source, including fresh clones.
execFileSync(process.execPath, [path('packages/font-metrics/tools/build.mjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [path('node_modules/typescript/bin/tsc'), '-p', path('packages/canvas-renderer/tsconfig.json')], { stdio: 'inherit' });
// Only own these output paths: other packages may build into dist too.
if (!production) await rm(path('dist/runtime'), { recursive: true, force: true });
await rm(path(nativeRoot), { recursive: true, force: true });

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
for (const target of production ? [] : targets) {
  for (const [entry, filename] of [
    ['packages/paper-core/src/index.ts', 'paper-core.cjs'],
    ['packages/runtime-smoke/src/index.ts', 'runtime-smoke.cjs'],
  ]) {
    await build({ ...options, platform: target.platform, target: target.target,
      entryPoints: [path(entry)], outfile: path('dist/runtime', target.name, filename) });
  }
}

const hostFiles = (await sourceFiles(path('miniprogram'))).filter(file => !production || !diagnostics.some(prefix => relative(path('miniprogram'), file).startsWith(prefix)));
const entries = hostFiles.filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'));
// The verified T04 browser bundle is shared by all native entry points. Resolve
// the external require relative to each emitted file; native CommonJS does not
// promise support for absolute /vendor imports.
await mkdir(path(nativeRoot, 'vendor'), { recursive: true });
await cp(path('packages/font-metrics/dist/miniapp.cjs'), path(nativeRoot, 'vendor/font-metrics.js'));
for (const entry of entries) {
  const destination = path(nativeRoot, relative(path('miniprogram'), entry).replace(/\.ts$/, '.js'));
  const vendor = relative(dirname(destination), path(nativeRoot, 'vendor/font-metrics.js')).replaceAll('\\', '/');
  await build({ ...options, platform: 'neutral', target: 'es2017', entryPoints: [entry], outfile: destination,
    plugins: [{ name: 'public-release-configuration', setup(builder) {
      if (!publicConfig) return;
      builder.onLoad({ filter: /miniprogram\/lib\/service-config\.ts$/ }, () => ({ contents: `export const SERVICE_CONFIG = ${JSON.stringify({ environmentId: publicConfig.environmentId, functionName: publicConfig.functionName })};`, loader: 'ts' }));
      builder.onLoad({ filter: /miniprogram\/lib\/font-sources\.ts$/ }, () => ({ contents: `export const PREVIEW_FONT_URLS = Object.freeze(${JSON.stringify(publicConfig.fontUrls)});`, loader: 'ts' }));
    } }, { name: 'shared-original-font-provider', setup(builder) {
      builder.onResolve({ filter: /font-metrics\/dist\/index\.js$/ }, () => ({ path: vendor.startsWith('.') ? vendor : `./${vendor}`, external: true }));
    } }] });
}
for (const source of hostFiles.filter(file => /\.(?:json|wxml|wxss|png)$/.test(file))) {
  const destination = path(nativeRoot, relative(path('miniprogram'), source));
  await mkdir(join(destination, '..'), { recursive: true });
  await cp(source, destination);
}
if (production) {
  const app = JSON.parse(await readFile(path(nativeRoot, 'app.json'), 'utf8'));
  app.pages = app.pages.filter(page => !diagnostics.some(prefix => page.startsWith(prefix)));
  await writeFile(path(nativeRoot, 'app.json'), JSON.stringify(app, null, 2) + '\n');
  await writeFile(path('dist/release/project.config.json'), JSON.stringify({
    projectname: 'learn', appid: publicConfig.appId, miniprogramRoot: 'miniprogram/', compileType: 'miniprogram',
    setting: { es6: false, minified: true, urlCheck: true },
  }, null, 2) + '\n');
}
if (!production) await writeFile(path('dist/runtime/build-info.json'), JSON.stringify({
  sharedSource: 'packages/paper-core/src/index.ts',
  targets: targets.map(({ name, target }) => ({ name, target })),
  targetRuntimeVerified: false,
}, null, 2) + '\n');
console.log(production ? 'Built configured miniapp at dist/release; real acceptance and publication remain external.' : 'Built shared core + smoke for miniapp/cloud and native development host.');
