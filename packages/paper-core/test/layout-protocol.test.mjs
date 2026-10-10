import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPaperDocument, getDevelopmentPreset, layoutPaperDocument, layoutSquarePaperDocument, layoutPinyinPaperDocument,
  serializePaperLayout, createLayoutDigest, validateLayoutDigest, assertLayoutDigestMatches,
  validateLayoutVersions, assertLayoutVersionsMatch, assertLayoutVersionsSupported,
  DEVELOPMENT_ENGINE_VERSION, LAYOUT_DIGEST_PREFIX, PaperError } from '../dist/index.js';
import { syntheticFont } from './synthetic-font.mjs';

const prepare = (templateId, input = {}, preset = getDevelopmentPreset(templateId)) => createPaperDocument({ templateId, ...input }, preset);
const layoutFor = (templateId, input = {}) => layoutPaperDocument(prepare(templateId, input), syntheticFont);
const error = code => value => value instanceof PaperError && value.code === code;
const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object'
  ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)])) : value;

test('unified layout dispatch preserves exactly the established square and independent pinyin layouts', () => {
  for (const templateId of ['essay-grid', 'tian-grid', 'mi-grid', 'pinyin-lines']) {
    const input = templateId === 'pinyin-lines' ? { title: 'Pīn yīn', body: 'nǐ hǎo\n' } : { title: '学习', body: '春秋e\u0301 3.14\n' };
    for (const tracing of [false, true]) {
      const doc = prepare(templateId, { ...input, tracing });
      const direct = templateId === 'pinyin-lines' ? layoutPinyinPaperDocument : layoutSquarePaperDocument;
      assert.deepEqual(layoutPaperDocument(doc, syntheticFont), direct(doc, syntheticFont));
    }
  }
});

test('protocol fixed vectors match independent standard SHA-256 and contain no original text', () => {
  const vectors = [
    ['pinyin-lines', { body: 'ni' }, 'c484987460352c89555697d9c5c5c70c563ce24d44ba52ba782e4f10cec44b62'],
    ['essay-grid', { body: '' }, '1a23ff5ca682d8d9b3861913ac41a7c4c37194710ac4490297393ab27f9ff749'],
  ];
  for (const [templateId, input, hash] of vectors) {
    const layout = layoutFor(templateId, input);
    const serialized = serializePaperLayout(layout);
    assert.equal(createHash('sha256').update(serialized, 'utf8').digest('hex'), hash);
    assert.equal(createLayoutDigest(layout), LAYOUT_DIGEST_PREFIX + hash);
    assert.match(serialized, /^[\x00-\x7f]+$/);
    assert.equal(JSON.parse(serialized).protocol, 'learn-layout-v1');
  }
  const privateText = 'neverrecordthisarticle';
  const serialized = serializePaperLayout(layoutFor('pinyin-lines', { body: privateText }));
  assert.equal(serialized.includes(privateText), false);
});

test('canonical object ordering and negative zero are independent of construction history', () => {
  const layout = layoutFor('pinyin-lines', { body: 'nǐ\nhao' });
  const reordered = reverseKeys(layout);
  reordered.pages[0].glyphs[0].advanceMm.y = -0;
  assert.equal(serializePaperLayout(layout), serializePaperLayout(reordered));
  assert.equal(createLayoutDigest(layout), createLayoutDigest(reordered));
});

test('every version, physical shape, source, glyph and style field contributes to the digest', () => {
  const original = layoutFor('pinyin-lines', { title: 'ni', body: 'a' + '\n'.repeat(14), tracing: true });
  const baseline = createLayoutDigest(original);
  const changes = [
    l => { l.versions.engineVersion = 'other'; }, l => { l.versions.fontBundleVersion = 'other'; },
    l => { l.versions.templateVersion = 'other'; l.pages.forEach(p => { p.geometry.templateVersion = 'other'; }); },
    l => { l.mode = 'filled'; }, l => { l.pages.reverse(); },
    l => { l.pages[0].geometry.page.width += 0.001; }, l => { l.pages[0].geometry.bounds.x += 0.001; },
    l => { l.pages[0].geometry.segments[0].from.x += 0.001; }, l => { l.pages[0].geometry.segments[0].to.y += 0.001; },
    l => { l.pages[0].geometry.segments[0].role = 'guide'; },
    l => { l.pages[0].lines[0].source.end++; }, l => { l.pages[0].lines[0].paragraphIndex++; },
    l => { l.pages[0].lines[0].row++; }, l => { l.pages[0].lines[0].breakAfter = 'wrap'; },
    l => { l.pages[0].lines[0].empty = true; }, l => { l.pages[0].slots[0].boundsMm.width += 0.001; },
    l => { l.pages[0].slots[0].sharesCell = true; }, l => { l.pages[0].slots[0].row++; },
    l => { l.pages[0].glyphs[0].glyphId++; }, l => { l.pages[0].glyphs[0].fontId = 'other'; },
    l => {
      l.textStyles.title.id = 'other';
      l.pages.forEach(page => page.glyphs.filter(glyph => glyph.source.block === 'title').forEach(glyph => { glyph.styleId = 'other'; }));
    }, l => { l.pages[0].glyphs[0].fontSizeMm += 0.001; },
    l => { l.pages[0].glyphs[0].originMm.x += 0.000001; }, l => { l.pages[0].glyphs[0].advanceMm.x += 0.000001; },
    l => { l.pages[0].glyphs[0].inkBoundsMm.height += 0.000001; }, l => { l.pages[0].glyphs.reverse(); },
    l => { l.textStyles.body.tracingGray += 0.01; }, l => { l.textStyles.title.canonicalFontId = 'other'; },
    l => { l.strokes.guide.dashMm = [3, 3]; }, l => { l.strokes.grid.widthMm += 0.01; },
    l => { l.strokes['writing-line'].lineCap = 'square'; }, l => { l.strokes.grid.lineJoin = 'round'; },
    l => { l.strokes.grid.miterLimit++; },
  ];
  for (const mutate of changes) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.notEqual(createLayoutDigest(changed), baseline, mutate.toString());
  }
});

test('nonfinite/overflow, malformed data and serialization hooks cannot produce a valid digest', () => {
  const original = layoutFor('pinyin-lines', { body: 'ni' });
  let invoked = false;
  const mutations = [
    l => { l.pages[0].glyphs[0].originMm.x = NaN; }, l => { l.strokes.grid.widthMm = Infinity; },
    l => { l.pages[0].glyphs[0].fontSizeMm = 1e300; }, l => { l.pages = []; },
    l => { delete l.mode; }, l => { l.body = 'private'; }, l => { l.pages[0].slots[0].source.end = -1; },
    l => { l.pages[0].glyphs[0].glyphId = 0; }, l => { l.pages[0].geometry.templateVersion = 'other'; },
    l => { l.textStyles.body.gray = 2; }, l => { l.strokes.guide.dashMm = [1]; },
    l => { l.pages[0].glyphs[0].fontId = 'private汉'; }, l => { l.pages[0].glyphs[0].fontId += '\n'; }, l => { delete l.pages[0].glyphs[0]; },
    l => { Object.defineProperty(l, 'mode', { get() { invoked = true; return 'filled'; } }); },
    l => { Object.defineProperty(l, 'toJSON', { value() { invoked = true; return {}; } }); },
    l => { l.pages.extra = true; }, l => { l.pages[Symbol('hidden')] = true; },
    l => { Object.setPrototypeOf(l, { toJSON() { invoked = true; } }); },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.throws(() => createLayoutDigest(changed), error('INVALID_LAYOUT'));
  }
  assert.equal(invoked, false);
});

test('glyphs must reference a unique style belonging to their original title or body block', () => {
  const original = layoutFor('pinyin-lines', { title: 'ni', body: 'hao' });
  const mutations = [
    layout => { layout.pages[0].glyphs[0].styleId = 'missing-style'; },
    layout => { layout.pages[0].glyphs[0].styleId = layout.textStyles.body.id; },
    layout => { layout.pages[0].glyphs.find(glyph => glyph.source.block === 'body').styleId = layout.textStyles.title.id; },
    layout => { layout.textStyles.body.id = layout.textStyles.title.id; },
    layout => {
      layout.textStyles.body.id = layout.textStyles.title.id;
      layout.pages[0].glyphs.forEach(glyph => { glyph.styleId = layout.textStyles.title.id; });
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original);
    mutate(changed);
    assert.throws(() => serializePaperLayout(changed), error('INVALID_LAYOUT'));
    assert.throws(() => createLayoutDigest(changed), error('INVALID_LAYOUT'));
  }
});

test('digest validation distinguishes malformed protocols, valid mismatches and font resource failure', () => {
  const layout = layoutFor('pinyin-lines', { body: 'ni' });
  const digest = createLayoutDigest(layout);
  assert.equal(validateLayoutDigest(digest), digest);
  assert.doesNotThrow(() => assertLayoutDigestMatches(layout, digest));
  assert.throws(() => assertLayoutDigestMatches(layout, LAYOUT_DIGEST_PREFIX + '0'.repeat(64)), error('LAYOUT_DIGEST_MISMATCH'));
  for (const invalid of ['', digest.toUpperCase(), digest.replace('v1', 'v2'), '0'.repeat(64), {}, digest + '0', digest + '\n', digest + '\r\n']) {
    assert.throws(() => validateLayoutDigest(invalid), error('LAYOUT_DIGEST_INVALID'));
  }
  assert.throws(() => layoutPaperDocument(prepare('pinyin-lines', { body: 'ni' }), {
    ...syntheticFont, shape() { throw { code: 'FONT_RESOURCE_MISSING', secret: 'private article' }; },
  }), error('FONT_RESOURCE_MISSING'));
});

test('strict version tuples bind all four fields and unsupported engines never run under false labels', () => {
  const preset = getDevelopmentPreset('pinyin-lines');
  const version = validateLayoutVersions(preset.versions);
  assert.ok(Object.isFrozen(version));
  assertLayoutVersionsSupported(version, [version]);
  for (const field of ['engineVersion', 'templateId', 'templateVersion', 'fontBundleVersion']) {
    const other = { ...version, [field]: field === 'templateId' ? 'mi-grid' : 'other' };
    assert.throws(() => assertLayoutVersionsMatch(version, other), error('VERSION_MISMATCH'));
    assert.throws(() => assertLayoutVersionsSupported(other, [version]), error('UNSUPPORTED_VERSION'));
  }
  for (const other of [{ ...version, extra: 1 }, { ...version, engineVersion: undefined }, { ...version, templateId: 'unknown' }]) {
    assert.throws(() => validateLayoutVersions(other), error('VERSION_MISMATCH'));
  }
  const old = structuredClone(preset);
  old.versions.engineVersion = 'learn-engine-dev.3';
  assert.throws(() => layoutPaperDocument(prepare('pinyin-lines', { body: 'ni' }, old), syntheticFont), error('UNSUPPORTED_VERSION'));
  assert.throws(() => layoutPinyinPaperDocument(prepare('pinyin-lines', { body: 'ni' }, old), syntheticFont), error('UNSUPPORTED_VERSION'));
  const oldSquare = structuredClone(getDevelopmentPreset('essay-grid'));
  oldSquare.versions.engineVersion = 'old';
  assert.throws(() => layoutSquarePaperDocument(prepare('essay-grid', { body: 'ni' }, oldSquare), syntheticFont), error('UNSUPPORTED_VERSION'));
  const document = prepare('pinyin-lines', { body: 'ni' });
  assert.throws(() => layoutPaperDocument({ ...document, versions: { ...version, templateVersion: 'forged' } }, syntheticFont), error('VERSION_MISMATCH'));
  assert.throws(() => layoutPaperDocument(document, { ...syntheticFont, fontBundleVersion: 'wrong' }), error('VERSION_MISMATCH'));
  assert.equal(version.engineVersion, DEVELOPMENT_ENGINE_VERSION);
});

test('active preset switching leaves an explicitly locked supported version unchanged', () => {
  const older = structuredClone(getDevelopmentPreset('pinyin-lines'));
  const newer = structuredClone(older);
  newer.versions.templateVersion = 'next-candidate';
  newer.geometry.version = 'next-candidate';
  newer.defaults.bodyIndentUnits = 0;
  const locked = prepare('pinyin-lines', { body: 'ni' }, older);
  const before = createLayoutDigest(layoutPaperDocument(locked, syntheticFont));
  const supported = [older.versions, newer.versions];
  assertLayoutVersionsSupported(locked.versions, supported);
  assert.equal(createLayoutDigest(layoutPaperDocument(locked, syntheticFont)), before);
  assert.notEqual(createLayoutDigest(layoutPaperDocument(prepare('pinyin-lines', { body: 'ni' }, newer), syntheticFont)), before);
  assert.throws(() => assertLayoutVersionsSupported(older.versions, [newer.versions]), error('UNSUPPORTED_VERSION'));
});

test('original spaces, line endings and canonical text forms remain input-owned', () => {
  for (const [a, b] of [['ni hao', 'ni  hao'], ['ni\nhao', 'ni\r\nhao'], ['ǖ', 'u\u0308\u0304']]) {
    const aDoc = prepare('pinyin-lines', { body: a });
    const bDoc = prepare('pinyin-lines', { body: b });
    assert.equal(aDoc.input.body, a);
    assert.equal(bDoc.input.body, b);
    assert.notEqual(createLayoutDigest(layoutPaperDocument(aDoc, syntheticFont)), createLayoutDigest(layoutPaperDocument(bDoc, syntheticFont)));
  }
  // Equal blank rendering is intentionally not an input fingerprint: T14 owns that HMAC.
  assert.equal(createLayoutDigest(layoutFor('pinyin-lines', { body: ' ' })), createLayoutDigest(layoutFor('pinyin-lines', { body: '\n' })));
});
