import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PDFDocument, PDFDict, PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { renderPdf, MAX_PDF_BYTES, PdfRenderError } from '../dist/index.js';
import { provider, originalFonts, manifest, layoutFor, templateIds, sampleInput } from './fixtures.mjs';

const error = code => value => value instanceof PdfRenderError && value.code === code;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = stream => stream.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode' ? inflateSync(stream.getContents()) : stream.getContents();
function contents(doc, page) {
  const refs = page.node.Contents();
  return Array.from({ length: refs.size() }, (_, i) => Buffer.from(decode(doc.context.lookup(refs.get(i), PDFRawStream))).toString('ascii')).join('\n');
}
function embeddedFonts(doc) {
  return doc.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFDict && object.has(PDFName.of('FontFile2')))
    .map(([, descriptor]) => {
      const stream = descriptor.lookup(PDFName.of('FontFile2'), PDFRawStream);
      return { name: descriptor.get(PDFName.of('FontName')).toString(), bytes: decode(stream),
        length1: stream.dict.lookup(PDFName.of('Length1'), PDFNumber).asNumber() };
    });
}
function attachmentBytes(doc) {
  return doc.context.enumerateIndirectObjects().filter(([, object]) => object instanceof PDFRawStream &&
    object.dict.get(PDFName.of('Type'))?.toString() === '/EmbeddedFile').map(([, stream]) => decode(stream));
}

for (const templateId of templateIds) {
  test(`${templateId}: actual A4 pages, complete fonts, license attachments and exact glyph operators`, async () => {
    for (const mode of ['blank', 'filled', 'tracing']) {
      const input = sampleInput(templateId, mode);
      const layout = layoutFor(templateId, input);
      const original = JSON.stringify(layout);
      const bytes = await renderPdf(layout, mode === 'blank' ? null : provider);
      assert.ok(bytes.length < MAX_PDF_BYTES);
      const doc = await PDFDocument.load(bytes, { updateMetadata: false });
      assert.equal(doc.getPageCount(), layout.pages.length);
      assert.equal(JSON.stringify(layout), original);
      assert.equal(doc.getTitle(), 'Learn A4 paper');
      assert.equal(doc.getCreationDate(), undefined);
      for (let index = 0; index < doc.getPageCount(); index++) {
        const page = doc.getPage(index), source = layout.pages[index];
        assert.ok(Math.abs(page.getWidth() - 210 * 72 / 25.4) < 1e-9);
        assert.ok(Math.abs(page.getHeight() - 297 * 72 / 25.4) < 1e-9);
        const operations = contents(doc, page);
        assert.equal((operations.match(/^S$/gm) ?? []).length, source.geometry.segments.length);
        const glyphs = [...operations.matchAll(/<([a-fA-F0-9]+)> Tj/g)].map(match => parseInt(match[1], 16));
        assert.deepEqual(glyphs, source.glyphs.map(g => g.glyphId));
        const origins = [...operations.matchAll(/1 0 0 1 ([-\d.]+) ([-\d.]+) Tm/g)].map(match => [+match[1], +match[2]]);
        assert.equal(origins.length, source.glyphs.length);
        for (let i = 0; i < origins.length; i++) {
          assert.ok(Math.abs(origins[i][0] - source.glyphs[i].originMm.x * 72 / 25.4) < 1e-9);
          assert.ok(Math.abs(origins[i][1] - (297 - source.glyphs[i].originMm.y) * 72 / 25.4) < 1e-9);
        }
        assert.equal(/\b(?:W|W\*)\b/.test(operations), false, 'no clipping to centerline bounds');
        if (source.glyphs.length) assert.ok(operations.includes(mode === 'tracing' ? '0.65 g' : '0 g'));
      }
      const expectedIds = [...new Set(layout.pages.flatMap(page => page.glyphs.map(g => g.fontId)))];
      const embedded = embeddedFonts(doc);
      assert.equal(embedded.length, expectedIds.length);
      const found = new Set();
      for (const file of embedded) {
        assert.equal(file.length1, file.bytes.length);
        const resource = manifest.fonts.find(font => font.sha256 === hash(file.bytes));
        assert.ok(resource, 'decoded complete FontFile2 matches an original byte pin');
        assert.deepEqual(new Uint8Array(file.bytes), originalFonts[resource.id]);
        assert.equal(/^[A-Z]{6}\+/.test(file.name), false);
        found.add(resource.id);
      }
      assert.deepEqual(found, new Set(expectedIds));
      const licenseHashes = attachmentBytes(doc).map(hash);
      const expectedLicenses = new Set(manifest.fonts.filter(font => expectedIds.includes(font.id)).map(font => font.licensePath));
      assert.equal(licenseHashes.length, expectedLicenses.size);
      for (const path of expectedLicenses) assert.ok(licenseHashes.includes(manifest.licenses.find(value => value.path === path).sha256));
    }
  });
}

test('renderer never calls shaping and outputs reproducible bytes without input in metadata', async () => {
  const layout = layoutFor('pinyin-lines', { body: 'privatearticle nǐ' });
  const restricted = { fontBundleVersion: provider.fontBundleVersion,
    originalFontBytes: id => provider.originalFontBytes(id), glyphOutline: (id, glyph) => provider.glyphOutline(id, glyph),
    shape() { throw new Error('Renderer must not shape'); } };
  const first = await renderPdf(layout, restricted);
  assert.deepEqual(first, await renderPdf(layout, restricted));
  const doc = await PDFDocument.load(first, { updateMetadata: false });
  const metadata = [doc.getTitle(), doc.getSubject(), doc.getAuthor(), doc.getCreator(), doc.getKeywords()].join(' ');
  assert.equal(metadata.includes('privatearticle'), false);
});

test('asynchronous rendering embeds the verified font snapshot despite later provider-buffer mutation', async () => {
  const fontId = 'misans-latin-regular';
  const supplied = originalFonts[fontId].slice();
  const layout = layoutFor('pinyin-lines', { body: 'nǐ hǎo' });
  let reads = 0;
  const rendering = renderPdf(layout, {
    fontBundleVersion: provider.fontBundleVersion,
    glyphOutline: (id, glyphId) => provider.glyphOutline(id, glyphId),
    originalFontBytes(id) { assert.equal(id, fontId); reads++; return supplied; },
  });
  supplied.fill(0);
  const document = await PDFDocument.load(await rendering, { updateMetadata: false });
  const embedded = embeddedFonts(document);
  assert.equal(reads, 1); assert.equal(embedded.length, 1);
  assert.deepEqual(new Uint8Array(embedded[0].bytes), originalFonts[fontId]);
  assert.equal(hash(embedded[0].bytes), manifest.fonts.find(font => font.id === fontId).sha256);
});

test('maxBytes is exact, cannot exceed the hard cap, and page/resource failures return no partial result', async () => {
  const blank = layoutFor('pinyin-lines');
  const bytes = await renderPdf(blank, null);
  assert.equal((await renderPdf(blank, null, { maxBytes: bytes.length })).length, bytes.length);
  for (const maxBytes of [bytes.length - 1, 0, -1, 1.5, NaN, Infinity, MAX_PDF_BYTES + 1]) {
    await assert.rejects(renderPdf(blank, null, { maxBytes }), error('PDF_RESOURCE_LIMIT'));
  }
  const tooManyPages = structuredClone(blank);
  tooManyPages.pages = Array(51).fill(tooManyPages.pages[0]);
  await assert.rejects(renderPdf(tooManyPages, null), error('PDF_RESOURCE_LIMIT'));
  const text = layoutFor('pinyin-lines', { body: 'ni' });
  await assert.rejects(renderPdf(text, null), error('PDF_RESOURCE_MISSING'));
  await assert.rejects(renderPdf(text, provider, { maxBytes: 1000 }), error('PDF_RESOURCE_LIMIT'));
  await assert.rejects(renderPdf(text, { ...provider, fontBundleVersion: 'other' }), error('PDF_RESOURCE_MISMATCH'));
  await assert.rejects(renderPdf(text, { ...provider, originalFontBytes(id) { const bytes = provider.originalFontBytes(id); bytes[0] ^= 1; return bytes; } }), error('PDF_RESOURCE_MISMATCH'));
});

test('malformed geometry, glyphs and unsafe provider exceptions are rejected safely', async () => {
  const original = layoutFor('pinyin-lines', { body: 'ni' });
  for (const mutate of [
    l => { l.pages[0].geometry.page.width = 200; }, l => { l.pages[0].glyphs[0].glyphId = 0; },
    l => { l.pages[0].glyphs[0].originMm.x = NaN; }, l => { l.pages[0].glyphs[0].inkBoundsMm.width += 1; },
    l => { l.pages[0].glyphs[0].styleId = 'wrong'; },
    l => { l.strokes['writing-line'].widthMm = 100; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    await assert.rejects(renderPdf(changed, provider), error('PDF_INVALID_LAYOUT'));
  }
  await assert.rejects(renderPdf(original, { ...provider, glyphOutline() { throw new Error('private article'); } }), value => {
    assert.ok(error('PDF_RENDER_FAILED')(value));
    assert.deepEqual(value.toJSON(), { code: 'PDF_RENDER_FAILED' });
    assert.equal(value.message.includes('private'), false);
    return true;
  });
});

test('PDF preserves cap, join, miter, dash and gray without moving stroke centerlines', async () => {
  for (const lineCap of ['butt', 'round', 'square']) {
    const layout = structuredClone(layoutFor('pinyin-lines'));
    const style = layout.strokes['writing-line'];
    Object.assign(style, { lineCap, lineJoin: 'bevel', miterLimit: 6, dashMm: [2, 1], widthMm: 0.3, gray: 0.4 });
    const doc = await PDFDocument.load(await renderPdf(layout, null), { updateMetadata: false });
    const operations = contents(doc, doc.getPage(0));
    assert.ok(operations.includes(`${['butt', 'round', 'square'].indexOf(lineCap)} J`));
    assert.ok(operations.includes('2 j'));
    assert.ok(operations.includes('6 M'));
    assert.ok(operations.includes('0.4 G'));
    assert.ok(operations.includes(`[${2 * 72 / 25.4} ${72 / 25.4}] 0 d`));
  }
});
