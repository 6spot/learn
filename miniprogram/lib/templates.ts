import type { TemplateId } from '../../packages/paper-core/src/types.js';
export const PAPER_TEMPLATES = Object.freeze([
  { id: 'essay-grid', name: '作文方格', description: '作文与文字练习' },
  { id: 'tian-grid', name: '田字格', description: '观察结构，练习书写' },
  { id: 'mi-grid', name: '米字格', description: '辅助定位，掌握笔画' },
  { id: 'pinyin-lines', name: '拼音四线三格', description: '拼音与字母练习' },
] as const);
export function templateId(value: unknown): TemplateId | null {
  return PAPER_TEMPLATES.find(item => item.id === value)?.id ?? null;
}
export function templateName(id: TemplateId): string { return PAPER_TEMPLATES.find(item => item.id === id)!.name; }
