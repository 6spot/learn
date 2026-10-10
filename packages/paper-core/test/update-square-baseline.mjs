import { mkdirSync, writeFileSync } from 'node:fs';
import { createPaperDocument, getDevelopmentPreset, layoutSquarePaperDocument } from '../dist/index.js';
import { syntheticFont } from './synthetic-font.mjs';

const fixtures = [
  { id: 'essay-options-and-sources', templateId: 'essay-grid', input: { title: '春夏', body: '秋e\u0301 3.14\r\n\n冬\n', options: { titleAlign: 'right', bodyIndent: 'none' } } },
  { id: 'essay-last-stop', templateId: 'essay-grid', input: { body: '春'.repeat(17) + '。夏' } },
  { id: 'tian-tracing', templateId: 'tian-grid', input: { body: '春夏Wi\n秋', tracing: true } },
  { id: 'mi-brackets', templateId: 'mi-grid', input: { body: '（春夏）秋……冬' } },
].map(fixture => {
  const doc = createPaperDocument({ templateId: fixture.templateId, ...fixture.input }, getDevelopmentPreset(fixture.templateId));
  const layout = layoutSquarePaperDocument(doc, syntheticFont);
  return { ...fixture, pages: layout.pages.map(({ lines, slots, glyphs }) => ({ lines, slots, glyphs })) };
});
mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
writeFileSync(new URL('./fixtures/square-layout.json', import.meta.url), JSON.stringify(fixtures, null, 2) + '\n');
console.log('Updated synthetic square baselines; review the diff before accepting layout changes.');
