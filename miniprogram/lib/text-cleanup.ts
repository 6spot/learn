/** D-046: explicit, conservative editing aid. Layout never calls this function. */
const terminal = /[。！？.!?；;：:][”’"'）)\]】}》〉」』]*\s*$/;
const listStart = /^(?:[-*+·]\s+|[•●▪◦]|\d+[.．](?!\d)|\d+[、)）]|[一二三四五六七八九十百]+[、.．)）]|[（(](?:\d+|[一二三四五六七八九十百]+)[)）]|[A-Za-z][.)]\s+|\[[ xX]\]\s+)/;
function latinUnit(char: string): boolean {
  const point = char.codePointAt(0) ?? 0;
  return /[A-Za-z0-9]/.test(char) ||
    ((point >= 0xc0 && point <= 0x24f) || (point >= 0x1e00 && point <= 0x1eff)) && char.toUpperCase() !== char.toLowerCase();
}
function needsSpace(before: string, after: string): boolean {
  if (/\s$/.test(before) || /^\s/.test(after)) return false;
  const left = [...before.replace(/[,，”’"')\]】}》〉」』]+$/, '')];
  const right = [...after.replace(/^[“‘"'(\[【{《〈「『]+/, '')];
  while (left.length && /[\u0300-\u036f]/.test(left[left.length - 1]!)) left.pop();
  return latinUnit(left[left.length - 1] ?? '') && latinUnit(right[0] ?? '');
}
export function cleanBodyNewlines(body: string): string {
  const parts = body.split(/(\r\n|\r|\n)/);
  let output = parts[0] ?? '';
  for (let index = 1; index < parts.length; index += 2) {
    const before = parts[index - 1]!, separator = parts[index]!, after = parts[index + 1] ?? '';
    const preserve = before.trim().length === 0 || after.trim().length === 0 ||
      terminal.test(before) || /^\s/.test(after) || listStart.test(after);
    output += (preserve ? separator : needsSpace(before, after) ? ' ' : '') + after;
  }
  return output;
}
