/** Build-injected lexical codecs for the fixed TTF/fontkit surface. Never patches
 * globals. Explicitly supports UTF-8, UTF-16 and ASCII/Windows-1252; other legacy
 * encodings fail instead of depending on whichever codecs a host provides. */
export class TextEncoder {
  readonly encoding = 'utf-8';
  encode(text = ''): Uint8Array {
    const bytes: number[] = [];
    for (const character of String(text)) {
      let point = character.codePointAt(0)!;
      if (point >= 0xd800 && point <= 0xdfff) point = 0xfffd;
      if (point < 0x80) bytes.push(point);
      else if (point < 0x800) bytes.push(0xc0 | point >> 6, 0x80 | point & 63);
      else if (point < 0x10000) bytes.push(0xe0 | point >> 12, 0x80 | point >> 6 & 63, 0x80 | point & 63);
      else bytes.push(0xf0 | point >> 18, 0x80 | point >> 12 & 63, 0x80 | point >> 6 & 63, 0x80 | point & 63);
    }
    return new Uint8Array(bytes);
  }
}

export class TextDecoder {
  readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
  constructor(label = 'utf-8') {
    const value = label.toLowerCase().trim();
    if (value === 'utf-8' || value === 'utf8') this.encoding = 'utf-8';
    else if (['utf-16', 'utf-16le', 'utf16le', 'ucs2'].includes(value)) this.encoding = 'utf-16le';
    else if (value === 'utf-16be' || value === 'utf16be') this.encoding = 'utf-16be';
    else if (['ascii', 'us-ascii', 'latin1', 'iso-8859-1', 'windows-1252'].includes(value)) this.encoding = 'windows-1252';
    else throw new RangeError('Unsupported font metadata encoding');
  }
  decode(input: ArrayBuffer | ArrayBufferView = new Uint8Array()): string {
    const bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
    const output: string[] = [];
    if (this.encoding === 'windows-1252') {
      const extra = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
      for (const byte of bytes) output.push(byte >= 0x80 && byte <= 0x9f ? extra[byte - 0x80]! : String.fromCharCode(byte));
    } else if (this.encoding === 'utf-16be' || this.encoding === 'utf-16le') {
      const little = this.encoding === 'utf-16le';
      const unit = (i: number) => little ? bytes[i]! | bytes[i + 1]! << 8 : bytes[i]! << 8 | bytes[i + 1]!;
      for (let i = 0; i < bytes.length; i += 2) {
        if (i + 1 >= bytes.length) { output.push('\ufffd'); break; }
        const value = unit(i);
        if (value >= 0xd800 && value <= 0xdbff) {
          // A pending high surrogate plus a truncated code unit is one decoder
          // end-of-stream error, matching WHATWG/native UTF-16 decoding.
          if (i + 3 >= bytes.length) { output.push('\ufffd'); break; }
          const next = unit(i + 2);
          if (next >= 0xdc00 && next <= 0xdfff) { output.push(String.fromCharCode(value, next)); i += 2; }
          else output.push('\ufffd');
        } else output.push(value >= 0xdc00 && value <= 0xdfff ? '\ufffd' : String.fromCharCode(value));
      }
    } else {
      for (let i = 0; i < bytes.length;) {
        const first = bytes[i++]!;
        if (first < 0x80) { output.push(String.fromCharCode(first)); continue; }
        const count = first >= 0xc2 && first <= 0xdf ? 1 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : 0;
        if (!count) { output.push('\ufffd'); continue; }
        let point = first & (count === 1 ? 31 : count === 2 ? 15 : 7);
        let read = 0;
        for (; read < count && i < bytes.length; read++) {
          const byte = bytes[i]!;
          const low = read === 0 && first === 0xe0 ? 0xa0 : read === 0 && first === 0xf0 ? 0x90 : 0x80;
          const high = read === 0 && first === 0xed ? 0x9f : read === 0 && first === 0xf4 ? 0x8f : 0xbf;
          if (byte < low || byte > high) break;
          point = point << 6 | byte & 63; i++;
        }
        output.push(read === count ? String.fromCodePoint(point) : '\ufffd');
      }
    }
    const result = output.join('');
    return result.charCodeAt(0) === 0xfeff ? result.slice(1) : result;
  }
}
