import { mkdirSync, writeFileSync } from 'node:fs';
import { createPaperDocument, getDevelopmentPreset, layoutPinyinPaperDocument } from '../dist/index.js';
import { syntheticFont } from './synthetic-font.mjs';

const fixtures = [
  { id: 'empty', input: { body: ' \n', tracing: true } },
  { id: 'title-and-exact-source', input: { title: 'Pīn yīn', body: "nǐ  hǎo\r\nu\u0308\u0304 xi'an\n", options: { titleAlign: 'right', bodyIndent: 'none' } } },
  { id: 'long-graphemes-tracing', input: { body: 'u\u0308\u0304'.repeat(43), tracing: true } },
  { id: 'trailing-empty-page', input: { body: 'a' + '\n'.repeat(14) } },
].map(fixture => {
  const doc = createPaperDocument({ templateId: 'pinyin-lines', ...fixture.input }, getDevelopmentPreset('pinyin-lines'));
  const layout = layoutPinyinPaperDocument(doc, syntheticFont);
  return { ...fixture, pages: layout.pages.map(({ lines, slots, glyphs }) => ({ lines, slots, glyphs })) };
});
mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('./fixtures/pinyin-layout.json', import.meta.url), JSON.stringify(fixtures, null, 2) + '\n');
console.log('Updated synthetic pinyin baselines; review before accepting layout changes.');
