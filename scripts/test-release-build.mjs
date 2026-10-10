import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'learn-release-check-'));
try {
  const manifest = JSON.parse(await readFile(join(root, 'assets/fonts/manifest.json'), 'utf8'));
  const config = { appId: 'wx0123456789abcdef', environmentId: 'diagnostic-release-env', functionName: 'learn-service',
    fontUrls: Object.fromEntries(manifest.fonts.map(font => [font.id, `https://example.invalid/${font.id}.ttf`])) };
  const file = join(temporary, 'public.json'); await writeFile(file, JSON.stringify(config));
  const result = spawnSync(process.execPath, ['scripts/build.mjs', '--production', '--config', file], { cwd: root, stdio: 'inherit' });
  assert.equal(result.status, 0);
  const directory = join(root, 'dist/release/miniprogram');
  const files = (await readdir(directory, { recursive: true })).filter(file => !file.includes('node_modules'));
  let bytes = 0;
  for (const file of files) {
    const info = await stat(join(directory, file)); if (!info.isFile()) continue;
    bytes += info.size;
    assert.ok(!/pages\/(?:runtime|canvas-diagnostics)/.test(file));
    assert.ok(!/\.(?:ttf|otf|pdf|map)$/.test(file));
    if (file.endsWith('.js')) {
      const source = await readFile(join(directory, file), 'utf8');
      for (const marker of ['StaticIdentityProvider', 'MemoryMetadataStore', '__learnDiagnosticRpc',
        'diagnostic-bootstrap', 'diagnostic-app', 'LEARN_SECRET_KEYS', 'trusted-test-user', 'synthetic execution fixture']) {
        assert.ok(!source.includes(marker), `${file} contains forbidden development/server marker: ${marker}`);
      }
    }
  }
  const app = JSON.parse(await readFile(join(directory, 'app.json'), 'utf8'));
  assert.ok(app.pages.length >= 4);
  for (const page of app.pages) {
    assert.ok(!/runtime|diagnostics/.test(page));
    for (const extension of ['js', 'json', 'wxml', 'wxss']) assert.ok((await stat(join(directory, `${page}.${extension}`))).isFile());
  }
  assert.ok(bytes <= 2 * 1024 * 1024, 'raw main package must fit the conservative 2 MiB budget');
  assert.ok((await readFile(join(directory, 'lib/service-config.js'), 'utf8')).includes(config.environmentId));
  const appSource = await readFile(join(directory, 'app.js'), 'utf8');
  const fontSource = await readFile(join(directory, 'lib/font-sources.js'), 'utf8');
  for (const url of Object.values(config.fontUrls)) {
    assert.ok(fontSource.includes(url));
    assert.ok(appSource.includes(url));
  }
  assert.equal(JSON.parse(await readFile(join(root, 'dist/release/project.config.json'), 'utf8')).appid, config.appId);
  console.log(JSON.stringify({ releaseStructurePassed: true, pages: app.pages.length, bytes, testConfigurationOnly: true }));
} finally { await rm(temporary, { recursive: true, force: true }); }
