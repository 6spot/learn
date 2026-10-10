import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const path = name => fileURLToPath(new URL(name, root));
const assets = new URL('../../assets/fonts/', root);
const manifest = JSON.parse(await readFile(new URL('manifest.json', assets), 'utf8'));
const licenses = [];
for (const resource of manifest.licenses) {
  const bytes = await readFile(new URL(resource.path, assets));
  if (bytes.length !== resource.bytes || createHash('sha256').update(bytes).digest('hex') !== resource.sha256) {
    throw new Error('License resource integrity check failed');
  }
  licenses.push({ key: resource.path, fileName: resource.path.split('/').at(-1),
    mimeType: resource.path.endsWith('.pdf') ? 'application/pdf' : 'text/plain', base64: bytes.toString('base64') });
}
await writeFile(path('src/licenses.generated.ts'), '// Generated from verified original license resources; never edit.\n'
  + `export const FONT_BUNDLE_VERSION = ${JSON.stringify(manifest.candidateResourceSetId)};\n`
  + `export const FONT_RESOURCES = ${JSON.stringify(manifest.fonts.map(({id, bytes, sha256}) => ({id, bytes, sha256})))} as const;\n`
  + `export const PDF_LICENSES = ${JSON.stringify(licenses)} as const;\n`
  + `export const FONT_LICENSE_KEYS: Readonly<Record<string, string>> = ${JSON.stringify(Object.fromEntries(manifest.fonts.map(font => [font.id, font.licensePath])))};\n`);
execFileSync(process.execPath, [path('node_modules/typescript/bin/tsc'), '-p', path('tsconfig.json')], { stdio: 'inherit' });
const built = await build({ entryPoints: [path('src/index.ts')], bundle: true, platform: 'browser',
  mainFields: ['browser', 'module', 'main'], target: 'es2017', format: 'esm', minify: true,
  outfile: path('dist/index.js'), legalComments: 'eof', logLevel: 'warning', metafile: true });
for (const output of Object.values(built.metafile.outputs)) if (output.imports.length) throw new Error('PDF runtime must be self-contained');
const source = await readFile(path('dist/index.js'), 'utf8');
if (/\b(?:eval|Function)\s*\(/.test(source)) throw new Error('PDF runtime must not use dynamic code execution');
for (const [target, js] of [['miniapp', 'es2017'], ['cloud', 'node20']]) {
  await build({ entryPoints: [path('dist/index.js')], bundle: true, platform: 'neutral', target: js,
    format: 'cjs', minify: true, outfile: path(`dist/${target}.cjs`), logLevel: 'warning' });
}
await mkdir(path('dist'), { recursive: true });
await writeFile(path('dist/build-info.json'), JSON.stringify({ pdfLibrary: 'pdf-lib@1.17.1',
  fontMode: 'complete-original-ttf', sharedBrowserImplementation: true, externalImports: [],
  hostCodecsRequired: false, bundleBytes: Buffer.byteLength(source), deviceVerified: false }, null, 2) + '\n');
console.log(`Built shared PDF renderer (${Buffer.byteLength(source)} bytes; complete original TTF embedding).`);
