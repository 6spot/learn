import type { SourceRange, TextParagraph, TextUnit } from './contracts.js';
import { isWhitespace } from './unicode.js';

export type TextToken = Readonly<{
  text: string;
  source: SourceRange;
  units: readonly TextUnit[];
  kind: 'cell' | 'flow';
  role: 'han' | 'word' | 'space' | 'open' | 'close' | 'stop' | 'other';
}>;
export const CHINESE_STOPS = new Set(['。', '，', '、', '；', '：', '！', '？']);
const OPEN = new Set(['（', '［', '｛', '《', '〈', '「', '『', '【', '〔', '“', '‘', '(', '[', '{']);
const CLOSE = new Set(['）', '］', '｝', '》', '〉', '」', '』', '】', '〕', '”', '’', ')', ']', '}']);

/** Fixed CJK ideograph ranges; variation selectors remain in the same grapheme for provider validation. */
export function isHanUnit(text: string): boolean {
  const cp = text.codePointAt(0) ?? 0;
  return cp === 0x3007 || (cp >= 0x3400 && cp <= 0x4DBF) || (cp >= 0x4E00 && cp <= 0x9FFF) ||
    (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x20000 && cp <= 0x2EE5F) ||
    (cp >= 0x2F800 && cp <= 0x2FA1F) || (cp >= 0x30000 && cp <= 0x3347F);
}
function latinUnit(text: string): boolean {
  const cp = text.codePointAt(0) ?? 0;
  return (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) ||
    (cp >= 0xC0 && cp <= 0x2AF && cp !== 0xD7 && cp !== 0xF7) || (cp >= 0x1E00 && cp <= 0x1EFF) ||
    (cp >= 0xFF21 && cp <= 0xFF3A) || (cp >= 0xFF41 && cp <= 0xFF5A);
}
const digit = (text: string) => text.length === 1 && ((text >= '0' && text <= '9') || (text >= '０' && text <= '９'));
function token(units: readonly TextUnit[], kind: TextToken['kind'], role: TextToken['role']): TextToken {
  return { text: units.map(unit => unit.text).join(''), units, kind, role,
    source: { ...units[0]!.source, end: units[units.length - 1]!.source.end } };
}

/** Only lexical grouping; no line/page decisions or rewriting of the original text. */
export function tokenizeParagraph(paragraph: TextParagraph): readonly TextToken[] {
  const tokens: TextToken[] = [];
  const units = paragraph.units;
  const quoteOpen = new Set<string>();
  for (let i = 0; i < units.length;) {
    const unit = units[i]!;
    if (latinUnit(unit.text) || digit(unit.text)) {
      let end = i + 1;
      while (end < units.length) {
        const current = units[end]!.text;
        const previous = units[end - 1]!.text;
        const next = units[end + 1]?.text ?? '';
        if (latinUnit(current) || digit(current) || ((current === '.' || current === '．') && digit(previous) && digit(next)) ||
          ((current === "'" || current === '’') && latinUnit(previous) && latinUnit(next))) end++;
        else break;
      }
      tokens.push(token(units.slice(i, end), 'flow', 'word'));
      i = end;
      continue;
    }
    if ((unit.text === '…' || unit.text === '—') && units[i + 1]?.text === unit.text) {
      tokens.push(token(units.slice(i, i + 2), 'cell', 'other'));
      i += 2;
      continue;
    }
    const han = isHanUnit(unit.text);
    let role: TextToken['role'] = han ? 'han' : CHINESE_STOPS.has(unit.text) ? 'stop' :
      OPEN.has(unit.text) ? 'open' : CLOSE.has(unit.text) ? 'close' : isWhitespace(unit.text) ? 'space' : 'other';
    if (unit.text === '"' || unit.text === "'") {
      role = quoteOpen.has(unit.text) ? 'close' : 'open';
      if (role === 'open') quoteOpen.add(unit.text); else quoteOpen.delete(unit.text);
    }
    const cp = unit.text.codePointAt(0)!;
    const kind = han || (cp >= 0x2000 && role !== 'space') ? 'cell' : 'flow';
    tokens.push(token([unit], kind, role));
    i++;
  }
  return tokens;
}

/** Break bonds are for brackets/quotes; never bind a Han+stop as a fallback for D-025. */
export function punctuationAtoms(tokens: readonly TextToken[]): readonly (readonly TextToken[])[] {
  const bonds = new Set<number>(); // index i means tokens[i] and tokens[i + 1] cannot wrap apart.
  for (let i = 0; i < tokens.length; i++) {
    const current = tokens[i]!;
    if (current.role === 'open') {
      let next = i + 1;
      while (next < tokens.length && tokens[next]!.role === 'space') bonds.add(next++ - 1);
      if (next < tokens.length) for (let j = i; j < next; j++) bonds.add(j);
    }
    if (current.role === 'close') {
      let previous = i - 1;
      while (previous >= 0 && tokens[previous]!.role === 'space') previous--;
      if (previous >= 0 && tokens[previous]!.role !== 'stop') for (let j = previous; j < i; j++) bonds.add(j);
    }
    if (current.role === 'stop' && i > 0 && !['han', 'stop', 'space'].includes(tokens[i - 1]!.role)) bonds.add(i - 1);
  }
  const atoms: TextToken[][] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i === 0 || !bonds.has(i - 1)) atoms.push([]);
    atoms[atoms.length - 1]!.push(tokens[i]!);
  }
  return atoms;
}

export function sliceWord(tokenToSplit: TextToken, start: number, end: number): TextToken {
  return token(tokenToSplit.units.slice(start, end), 'flow', 'word');
}
