import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutSquareDocument, getDefaultPreset } from '../dist/index.js';

const essay = getDefaultPreset('essay-grid');
const tian = getDefaultPreset('tian-grid');
const mi = getDefaultPreset('mi-grid');
const metrics = { measureTextMm: str => Array.from(str).length * 2 };
const text = (body, opts={}) => layoutSquareDocument({preset:essay,body,...opts}, metrics);

test('empty or whitespace-only input produces one complete blank page', () => {
  for(const body of ['', '  \n\r\n  ']) {
    const a = text(body, {tracing:true});
    assert.equal(a.mode,'blank'); assert.equal(a.pages.length,1);
    assert.equal(a.pages[0].placements.length,0);
    assert.equal(a.pages[0].geometry.segments.length,48);
  }
});

test('body first line indents two cells and natural wrap does not reindent', () => {
  const r = text('春'.repeat(19));
  assert.equal(r.pages[0].placements.length,19);
  assert.deepEqual(r.pages[0].placements.slice(0,2).map(p=>p.xMm),[30,40]);
  assert.equal(r.pages[0].placements[17].row,1);
  assert.equal(r.pages[0].placements[17].xMm,10);
});

test('one enter starts new paragraph; double enter leaves an extra empty row', () => {
  const one = text('春\n夏').pages[0].placements;
  assert.deepEqual(one.map(p=>[p.text,p.row,p.xMm]),[['春',0,30],['夏',1,30]]);
  const two = text('春\n\n夏').pages[0].placements;
  assert.deepEqual(two.map(p=>[p.text,p.row]),[['春',0],['夏',2]]);
});

test('title is centered and followed by one empty row before body', () => {
  const r = text('春天', {title:'题目'}).pages[0].placements;
  assert.deepEqual(r.map(p=>[p.text,p.row,p.xMm]),[['题',0,95],['目',0,105],['春',2,30],['天',2,40]]);
});

test('end-of-line Chinese stop shares last Hanzi cell and no text disappears', () => {
  const r = text('春'.repeat(17)+'。夏').pages[0].placements;
  assert.equal(r[16].xMm,190);
  assert.equal(r[17].text,'。'); assert.equal(r[17].sharesCell,true);
  assert.equal(r[18].row,1); assert.equal(r[18].text,'夏');
});

test('Latin text is measured, words wrap whole, decimals remain grouped', () => {
  const r=text('春'.repeat(17)+'hello 3.14').pages[0].placements;
  assert.equal(r.at(-3).text,'hello');
  assert.equal(r.at(-3).row,1);
  assert.equal(r.at(-2).text,' ');
  assert.equal(r.at(-1).text,'3.14');
});

test('very long Latin word breaks safely, emoji grapheme is not split', () => {
  const str='a'.repeat(100)+'👨‍👩‍👧‍👦';
  const placements=text(str).pages[0].placements;
  assert.equal(placements.filter(p=>p.text==='👨‍👩‍👧‍👦').length,1);
  assert.equal(placements.filter(p=>p.text==='a').length,100);
});

test('pagination retains full grid geometry and paragraph continuation', () => {
  const r=text('春'.repeat(19*28));
  assert.equal(r.pages.length,2);
  assert.equal(r.pages[0].geometry.segments.length,48);
  assert.equal(r.pages[1].geometry.segments.length,48);
  assert.equal(r.pages[1].placements[0].row,0);
  assert.equal(r.pages[1].placements[0].xMm,10);
  assert.equal(r.pages.flatMap(p=>p.placements).map(p=>p.text).join(''), '春'.repeat(19*28));
});

test('layout for Tian/Mi shares logical placements and tracing does not repaginate', () => {
  const a=layoutSquareDocument({preset:tian,body:'春夏秋冬'},metrics);
  const b=layoutSquareDocument({preset:mi,body:'春夏秋冬',tracing:true},metrics);
  assert.equal(a.mode,'filled'); assert.equal(b.mode,'tracing');
  assert.deepEqual(a.pages.map(p=>p.placements), b.pages.map(p=>p.placements));
});

test('missing font metrics refuses Latin, maxPages refuses truncation', () => {
  assert.throws(()=>layoutSquareDocument({preset:essay,body:'abc'}), /measureTextMm/);
  assert.throws(()=>layoutSquareDocument({preset:essay,body:'春'.repeat(513*2)}, {maxPages:1}),/maxPages/);
});

test('exactly full page never emits a phantom extra page', () => {
  // First paragraph leaves two indent slots; all later rows use nineteen.
  const r = text('春'.repeat(17+19*26));
  assert.equal(r.pages.length, 1);
  assert.equal(r.pages[0].placements.at(-1).row, 26);
});

test('explicit CRLF and multiple blank rows survive a page transition', () => {
  const r = text('春'+ '\r\n'.repeat(28)+'夏');
  assert.equal(r.pages.length, 2);
  assert.equal(r.pages[1].placements[0].text, '夏');
  assert.equal(r.pages[1].placements[0].row, 1);
  assert.equal(r.pages[1].placements[0].xMm, 30);
});

test('the selected font cannot return missing, zero or oversized single-glyph metrics', () => {
  assert.throws(()=>layoutSquareDocument({preset:essay,body:'abc'}, { measureTextMm:()=>0 }),RangeError);
  assert.throws(()=>layoutSquareDocument({preset:essay,body:'abc'}, { measureTextMm:()=>Infinity }),RangeError);
  assert.throws(()=>layoutSquareDocument({preset:essay,body:'a'}, { measureTextMm:()=>200 }),/one glyph/);
});

test('combining accents are not split in alphabetic runs', () => {
  const r=text('e\u0301cole').pages[0].placements;
  assert.equal(r.length,1);
  assert.equal(r[0].text,'e\u0301cole');
});

test('reject pinyin row-band presets rather than producing invalid square coordinates', () => {
  assert.throws(()=>layoutSquareDocument({preset:getDefaultPreset('pinyin-lines'),body:'nǐ'}),/square-grid/);
});
