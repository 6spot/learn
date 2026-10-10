import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.argv.length > 2) throw new Error('Usage: node scripts/build-cloud.mjs');
for (const name of ['font-metrics', 'cloud-service', 'pdf-renderer']) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: resolve(root, 'packages', name), stdio: 'inherit', shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const name of ['learn-service', 'learn-maintenance']) {
  const destination = resolve(root, 'dist/cloudfunctions', name);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const entry = `cloudfunctions/${name}/index.mjs`;
  const result = await build({ entryPoints: [resolve(root, entry)],
    outfile: resolve(destination, 'index.js'), bundle: true, platform: 'node', target: 'node20', format: 'cjs',
    external: ['wx-server-sdk'], minify: false, sourcemap: false, legalComments: 'eof', metafile: true,
  });
  // Both entry points use the exact same independently locked SDK.
  for (const file of ['package.json', 'package-lock.json']) await cp(resolve(root, 'cloudfunctions/learn-service', file), resolve(destination, file));
  await writeFile(resolve(destination, 'build-info.json'), JSON.stringify({
    entry, target: 'node20', runtimeVerified: false,
    inputs: Object.keys(result.metafile.inputs).sort(), bytes: Object.values(result.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0),
  }, null, 2) + '\n');
}
console.log('Built dist/cloudfunctions/{learn-service,learn-maintenance}; deployment configuration and platform acceptance remain external.');
