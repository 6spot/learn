import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const path = name => fileURLToPath(new URL(name, root));
const manifest = JSON.parse(await readFile(new URL('../../../assets/fonts/manifest.json', import.meta.url), 'utf8'));
const resources = manifest.fonts.map(({ id, bytes, sha256, fontVersion }) => ({ id, bytes, sha256, fontVersion }));
await writeFile(path('src/resources.generated.ts'), '// Generated from assets/fonts/manifest.json. Do not edit pins here.\n'
  + `export const FONT_BUNDLE_VERSION = ${JSON.stringify(manifest.candidateResourceSetId)};\n`
  + `export const FONT_RESOURCES = Object.freeze((${JSON.stringify(resources, null, 2)} as const).map(resource => Object.freeze(resource)));\n`
  + 'export type FontId = typeof FONT_RESOURCES[number]["id"];\n');
execFileSync(process.execPath, [path('node_modules/typescript/bin/tsc'), '-p', fileURLToPath(new URL('../paper-core/tsconfig.json', root))], { stdio: 'inherit' });
execFileSync(process.execPath, [path('node_modules/typescript/bin/tsc'), '-p', path('tsconfig.json')], { stdio: 'inherit' });
await mkdir(path('dist'), { recursive: true });
// Both runtimes consume this same browser-resolved implementation. Cloud's
// optional Node fontkit/crypto entries must not enter the shared artifact.
const built = await build({ entryPoints: [path('src/index.ts')], bundle: true,
  inject: [path('src/font-codecs.ts')],
  platform: 'browser', mainFields: ['browser', 'module', 'main'], target: 'es2017',
  format: 'esm', minify: true, outfile: path('dist/index.js'), metafile: true,
  legalComments: 'eof', logLevel: 'warning' });
for (const output of Object.values(built.metafile.outputs)) {
  if (output.imports.length) throw new Error('Shared font bundle must have no external runtime imports');
}
const source = await readFile(path('dist/index.js'), 'utf8');
if (/\b(?:eval|Function)\s*\(/.test(source)) throw new Error('Shared font bundle contains dynamic code execution');
for (const [name, target] of [['miniapp', 'es2017'], ['cloud', 'node20']]) {
  await build({ entryPoints: [path('dist/index.js')], bundle: true, platform: 'neutral',
    target, format: 'cjs', outfile: path(`dist/${name}.cjs`), minify: true, logLevel: 'warning' });
}
await writeFile(path('dist/build-info.json'), JSON.stringify({ fontBundleVersion: manifest.candidateResourceSetId,
  shapingLibrary: 'fontkit@2.0.4', browserResolved: true, externalImports: [], hostTextCodecsRequired: false,
  bundleBytes: Buffer.byteLength(source), targets: ['es2017', 'node20'],
  targetDeviceVerified: false }, null, 2) + '\n');
console.log(`Built shared font provider (${Buffer.byteLength(source)} bytes; browser-resolved, no external imports).`);
