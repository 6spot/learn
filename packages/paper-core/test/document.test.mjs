import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPaperDocument, validatePaperInput, validateTrustedPreset, getDevelopmentPreset,
  getDefaultTextOptions, parseTextBlock, graphemeSegments, GRAPHEME_IMPLEMENTATION,
  PaperError, safePaperFailure, DEFAULT_RESOURCE_LIMITS, getDefaultPreset, buildPageGeometry,
} from '../dist/index.js';

const clone = value => JSON.parse(JSON.stringify(value));
const preset = id => getDevelopmentPreset(id ?? 'essay-grid');
const prepare = (input = {}, trusted = preset()) => createPaperDocument({ templateId: trusted.versions.templateId, ...input }, trusted);
const error = code => value => value instanceof PaperError && value.code === code;

test('only user-owned fields/options enter the document; trusted overrides are rejected', () => {
  assert.throws(() => getDevelopmentPreset('__proto__'), error('INVALID_INPUT'));
  assert.throws(() => parseTextBlock(123, 'body'), error('INVALID_INPUT'));
  for (const extra of [{ preset: {} }, { fontSize: 20 }, { geometry: {} }, { mode: 'filled' }, { engineVersion: 'forged' }]) {
    assert.throws(() => prepare(extra), error('UNKNOWN_FIELD'));
  }
  for (const options of [{ font: 'other' }, { rows: 20 }]) assert.throws(() => prepare({ options }), error('UNKNOWN_FIELD'));
  for (const options of [{ titleAlign: 'justify' }, { bodyIndent: 2 }, { bodyIndent: '2' }]) assert.throws(() => prepare({ options }), error('INVALID_INPUT'));
  for (const input of [null, [], 3, {}, { templateId: 'other' }, { templateId: 'essay-grid', title: null },
    { templateId: 'essay-grid', body: 4 }, { templateId: 'essay-grid', tracing: 'yes' }, { templateId: 'essay-grid', options: [] }]) {
    assert.throws(() => validatePaperInput(input), error('INVALID_INPUT'));
  }
});

test('JSON boundary rejects malicious keys and serialization hooks without evaluating them', () => {
  let invoked = false;
  const input = { templateId: 'essay-grid' };
  Object.defineProperty(input, 'body', { enumerable: true, get() { invoked = true; return 'changed'; } });
  assert.throws(() => validatePaperInput(input), error('INVALID_INPUT'));
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => validatePaperInput(JSON.parse(`{"templateId":"essay-grid","${key}":{}}`)), error('UNKNOWN_FIELD'));
  }
  const candidate = clone(preset());
  Object.defineProperty(candidate.geometry.origin, 'toJSON', { value() { invoked = true; return { x: 900, y: 900 }; } });
  assert.throws(() => prepare({}, candidate), error('INVALID_PRESET'));
  const dashCandidate = clone(preset());
  Object.defineProperty(dashCandidate.strokes.guide.dashMm, '0', {
    enumerable: true, get() { invoked = true; return 2; },
  });
  assert.throws(() => prepare({}, dashCandidate), error('INVALID_PRESET'));
  dashCandidate.strokes.guide.dashMm = [, 2];
  assert.throws(() => prepare({}, dashCandidate), error('INVALID_PRESET'));
  assert.equal(invoked, false);
});

test('approved alignment and default/none indentation resolve from trusted preset; reset only yields settings', () => {
  const trusted = clone(preset());
  trusted.defaults.titleAlign = 'right';
  trusted.defaults.bodyIndentUnits = 2;
  assert.deepEqual(getDefaultTextOptions(trusted), { titleAlign: 'right', bodyIndent: 'default' });
  for (const titleAlign of ['left', 'center', 'right']) {
    const doc = prepare({ title: '标题', body: '正文', tracing: true, options: { titleAlign, bodyIndent: 'none' } }, trusted);
    assert.deepEqual(doc.options, { titleAlign, bodyIndentUnits: 0 });
    assert.equal(doc.input.title, '标题');
    assert.equal(doc.input.body, '正文');
    assert.equal(doc.mode, 'tracing');
  }
  assert.deepEqual(prepare({}, trusted).options, { titleAlign: 'right', bodyIndentUnits: 2 });
});

test('every fixed template uses its own carrier without changing any centerline coordinates', () => {
  for (const id of ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines']) {
    const trusted = preset(id);
    validateTrustedPreset(trusted);
    assert.equal(trusted.stage, 'development-candidate');
    assert.equal(prepare({}, trusted).mode, 'blank');
    assert.equal(trusted.carrier.kind, id === 'pinyin-lines' ? 'pinyin-lines' : 'square-grid');
    const geometry = buildPageGeometry(trusted.geometry);
    const old = buildPageGeometry(getDefaultPreset(id));
    assert.deepEqual({ ...geometry, templateVersion: old.templateVersion }, old);
    assert.equal(trusted.textStyles.body.canonicalFontId, id === 'pinyin-lines' ? 'misans-latin-regular' : 'misans-regular');
    assert.equal(trusted.textStyles.body.tracingHanFontId,
      id === 'tian-grid' || id === 'mi-grid' ? 'lxgw-wenkai-gb-regular' : trusted.textStyles.body.canonicalFontId);
  }
});

test('trusted configuration rejects even plausible geometry changes, invalid styles and mismatched versions', () => {
  const mutations = [
    p => { p.geometry.columns = 18; p.geometry.margin.right = 20; },
    p => { p.geometry.origin.x = NaN; },
    p => { p.geometry.version = 'different'; },
    p => { p.versions.engineVersion = ''; },
    p => { p.carrier = { kind: 'pinyin-lines', baselineOffsetMm: 8, indentUnitMm: 4 }; },
    p => { p.textStyles.body.fontSizeMm = 0; },
    p => { p.textStyles.body.tracingGray = 2; },
    p => { p.textStyles.body.id = p.textStyles.title.id; },
    p => { p.textStyles.body.tracingHanFontId = 'lxgw-wenkai-gb-regular'; },
    p => { p.strokes.grid.widthMm = Infinity; },
    p => { p.strokes.guide.dashMm = [2]; },
    p => { p.defaults.bodyIndentUnits = 19; },
    p => { p.limits.maxPages = 0; },
    p => { p.extra = 'private payload must not survive a snapshot'; },
  ];
  for (const mutate of mutations) {
    const candidate = clone(preset()); mutate(candidate);
    assert.throws(() => validateTrustedPreset(candidate), error('INVALID_PRESET'));
  }
  assert.throws(() => createPaperDocument({ templateId: 'mi-grid' }, preset()), error('VERSION_MISMATCH'));
});

test('original CR/LF/CRLF, spaces, Unicode normalization and trailing empty paragraphs are lossless', () => {
  const body = '\r\n春e\u0301👨‍👩‍👧‍👦𠀀 \r夏\n\n';
  const doc = prepare({ body });
  assert.equal(doc.input.body, body);
  const block = doc.blocks[1];
  assert.equal(block.sourceText, body);
  assert.deepEqual(block.paragraphs.map(p => p.separator), ['\r\n', '\r', '\n', '\n', '']);
  assert.deepEqual(block.paragraphs.map(p => p.units.length), [0, 5, 1, 0, 0]);
  assert.equal(block.paragraphs.map(p => body.slice(p.source.start, p.source.end) + p.separator).join(''), body);
  for (const paragraph of block.paragraphs) {
    assert.equal(body.slice(paragraph.separatorSource.start, paragraph.separatorSource.end), paragraph.separator);
    for (const unit of paragraph.units) assert.equal(body.slice(unit.source.start, unit.source.end), unit.text);
  }
  assert.equal(prepare({ body: 'é' }).input.body, 'é');
  assert.notEqual(prepare({ body: 'é' }).input.body, prepare({ body: 'e\u0301' }).input.body);
});

test('all trailing newlines survive in contract for downstream page allocation', () => {
  const block = parseTextBlock('春' + '\n'.repeat(60), 'body');
  assert.equal(block.paragraphs.length, 61);
  assert.equal(block.paragraphs.filter(p => p.units.length === 0).length, 60);
  assert.equal(block.paragraphs[60].source.end, 61);
  assert.equal(parseTextBlock('', 'title').paragraphs.length, 1);
});

test('blank/filled/tracing derive without discarding whitespace or changing logical paragraph units', () => {
  const body = ' \r\n\n\u3000';
  const blank = prepare({ body, tracing: true });
  assert.equal(blank.mode, 'blank');
  assert.equal(blank.input.body, body);
  assert.equal(blank.blocks[1].paragraphs.length, 3);
  const filled = prepare({ body: '春e\u0301\n\n' });
  const tracing = prepare({ body: '春e\u0301\n\n', tracing: true });
  assert.equal(filled.mode, 'filled'); assert.equal(tracing.mode, 'tracing');
  assert.deepEqual(filled.blocks, tracing.blocks);
  assert.deepEqual(filled.options, tracing.options);
});

test('resource limits, malformed UTF-16 and unsupported controls fail explicitly without partial input', () => {
  assert.throws(() => validatePaperInput({ templateId: 'essay-grid', body: '春夏秋' },
    { ...DEFAULT_RESOURCE_LIMITS, maxInputCodeUnits: 2 }), error('INPUT_LIMIT_EXCEEDED'));
  assert.throws(() => validatePaperInput({ templateId: 'essay-grid', body: '春夏秋' },
    { ...DEFAULT_RESOURCE_LIMITS, maxGraphemes: 2 }), error('INPUT_LIMIT_EXCEEDED'));
  assert.equal(validatePaperInput({ templateId: 'essay-grid', body: '👨‍👩‍👧‍👦' },
    { ...DEFAULT_RESOURCE_LIMITS, maxGraphemes: 1 }).body, '👨‍👩‍👧‍👦');
  for (const body of ['\uD800', '\uDC00', '春\uD800秋']) assert.throws(() => prepare({ body }), error('INVALID_UNICODE'));
  for (const body of ['春\t秋', '\u0000', '\u0080']) assert.throws(() => prepare({ body }), error('UNSUPPORTED_CONTROL'));
});

test('snapshots are deeply immutable and independent of later input and registry mutation', () => {
  const input = { title: '原始标题', options: { titleAlign: 'left' } };
  const candidate = clone(preset());
  const doc = prepare(input, candidate);
  candidate.defaults.titleAlign = 'right';
  candidate.textStyles.body.gray = 0.3;
  input.title = '后来标题'; input.options.titleAlign = 'right';
  assert.equal(doc.input.title, '原始标题');
  assert.equal(doc.options.titleAlign, 'left');
  assert.equal(doc.preset.defaults.titleAlign, 'center');
  assert.equal(doc.preset.textStyles.body.gray, 0);
  assert.throws(() => { doc.blocks[1].paragraphs.push({}); }, TypeError);
  assert.throws(() => { preset().geometry.origin.x = 500; }, TypeError);
  assert.equal(getDefaultPreset('essay-grid').origin.x, 10);
});

test('pinned grapheme implementation covers combining marks, emoji, flags and Indic conjuncts', () => {
  assert.equal(GRAPHEME_IMPLEMENTATION, 'unicode-segmenter@0.17.3');
  for (const text of ['e\u0301', '👨‍👩‍👧‍👦', '🇨🇳', '👍🏽', 'क्‍ष', '𠀀\u{E0100}']) {
    const units = Array.from(graphemeSegments(text));
    assert.equal(units.length, 1, text);
    assert.equal(units[0].segment, text);
    assert.equal(units[0].index, 0);
  }
});

test('safe errors never expose input values or raw upstream exception messages', () => {
  const secret = 'private essay';
  try { prepare({ body: secret, [secret]: true }); } catch (failure) {
    assert.equal(JSON.stringify(safePaperFailure(failure)), '{"code":"UNKNOWN_FIELD","details":{"field":"input"}}');
    assert.ok(!failure.message.includes(secret));
  }
  assert.deepEqual(safePaperFailure(new Error(secret)), { code: 'INTERNAL_LAYOUT_ERROR', details: {} });
});
