import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPublicBuildConfig } from '../../../scripts/public-build-config.mjs';

test('release settings require real-shaped public fields and never accept secrets or partial fonts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'learn-public-config-')), path = join(directory, 'config.json');
  const config = { appId: 'wx0123456789abcdef', environmentId: 'test-env', functionName: 'learn-service',
    fontUrls: Object.fromEntries(['misans-regular', 'misans-latin-regular', 'lxgw-wenkai-gb-regular'].map(id => [id, `https://example.invalid/${id}.ttf`])) };
  try {
    await writeFile(path, JSON.stringify(config)); assert.deepEqual(await readPublicBuildConfig(path), config);
    for (const change of [value => { value.appId = 'touristappid'; }, value => { value.secret = 'private'; },
      value => { value.environmentId = ''; }, value => { delete value.fontUrls['misans-regular']; },
      value => { value.fontUrls['misans-regular'] = 'https://user:secret@example.invalid/font'; },
      value => { value.fontUrls['misans-regular'] = 'http://example.invalid/font'; }]) {
      const invalid = structuredClone(config); change(invalid); await writeFile(path, JSON.stringify(invalid));
      await assert.rejects(readPublicBuildConfig(path), { message: 'Invalid public release configuration; see config/public.example.json.' });
    }
  } finally { await rm(directory, { recursive: true }); }
});
