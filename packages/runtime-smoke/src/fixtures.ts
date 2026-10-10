import { getDefaultPreset, layoutSquareDocument } from '../../paper-core/src/index.js';
import type { DocumentLayout, TemplateId } from '../../paper-core/src/index.js';

/** Public synthetic data. These fixtures contain no user writing or licensed font data. */
export const TEXT_FIXTURES = [
  { id: 'essay-paragraphs', templateId: 'essay-grid', title: '合成样例', body: '春天\r\n夏天\n\n秋天' },
  { id: 'essay-unicode', templateId: 'essay-grid', body: '春e\u0301cole 👨‍👩‍👧‍👦𠀀' },
  { id: 'essay-multipage', templateId: 'essay-grid', body: '春'.repeat(19 * 28) },
  { id: 'essay-last-cell-stop', templateId: 'essay-grid', body: '春'.repeat(17) + '。夏' },
  { id: 'tian-filled', templateId: 'tian-grid', body: '春夏秋冬' },
  { id: 'mi-tracing', templateId: 'mi-grid', body: '春夏秋冬', tracing: true },
  { id: 'essay-whitespace', templateId: 'essay-grid', body: ' \n\r\n ', tracing: true },
] as const;

export const TEMPLATE_IDS: readonly TemplateId[] = ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines'];

/** Deliberately synthetic width for algorithm regression only; never use for preview/export. */
function syntheticWidthMm(text: string): number {
  return Array.from(text).length * 2;
}

export function runTextFixture(id: string): DocumentLayout {
  const fixture = TEXT_FIXTURES.find(entry => entry.id === id);
  if (!fixture) throw new RangeError('Unknown synthetic fixture');
  const preset = getDefaultPreset(fixture.templateId);
  if (preset.kind !== 'square-grid') throw new TypeError('Synthetic text fixture requires a square grid');
  return layoutSquareDocument({ ...fixture, preset }, { measureTextMm: syntheticWidthMm });
}
