import { readFile } from 'node:fs/promises';

export async function readPublicBuildConfig(filename) {
  try {
    const value = JSON.parse(await readFile(filename, 'utf8'));
    const manifest = JSON.parse(await readFile(new URL('../assets/fonts/manifest.json', import.meta.url), 'utf8'));
    const ids = manifest.fonts.map(font => font.id).sort();
    if (!value || Object.keys(value).sort().join(',') !== 'appId,environmentId,fontUrls,functionName' ||
        typeof value.appId !== 'string' || !/^wx[0-9a-f]{16}$/.test(value.appId) ||
        typeof value.environmentId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.environmentId) ||
        typeof value.functionName !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(value.functionName) ||
        !value.fontUrls || Object.keys(value.fontUrls).sort().join(',') !== ids.join(',')) throw new Error();
    for (const url of Object.values(value.fontUrls)) {
      if (typeof url !== 'string') throw new Error();
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new Error();
    }
    return value;
  } catch { throw new Error('Invalid public release configuration; see config/public.example.json.'); }
}
