import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const listOnly = process.argv.length === 3 && process.argv[2] === '--list';
if (process.argv.length > 2 && !listOnly) {
  throw new Error('Usage: node scripts/setup.mjs [--list]');
}
if (Number(process.versions.node.split('.')[0]) < 20) {
  throw new Error('Learn requires Node.js 20 or newer.');
}
const packages = [root, ...readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => join(root, 'packages', entry.name))
  .filter(directory => existsSync(join(directory, 'package.json')))
  .sort(), join(root, 'cloudfunctions', 'learn-service')];

// Root-only npm install does not install the independently locked packages.
// Validate all package roots before installing anything.
for (const directory of packages) {
  JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  if (!existsSync(join(directory, 'package-lock.json'))) {
    throw new Error(`Missing lockfile: ${relative(root, directory) || '.'}`);
  }
}
for (const directory of packages) {
  const name = relative(root, directory) || '.';
  if (listOnly) {
    console.log(name);
    continue;
  }
  console.log(`Installing locked dependencies: ${name}`);
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci'], {
    cwd: directory, stdio: 'inherit', shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
