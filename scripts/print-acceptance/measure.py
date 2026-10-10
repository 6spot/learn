#!/usr/bin/env python3
"""Measure synthetic acceptance PDFs using Poppler pixels, not renderer formulas."""
import hashlib
import html
import json
import math
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'dist' / 'print-acceptance'


def invalidate_reports(output):
    (output / 'measurements.json').unlink(missing_ok=True)
    (output / 'index.html').unlink(missing_ok=True)


# A missing Pillow installation must not leave a previous passing report behind.
if __name__ == '__main__':
    invalidate_reports(OUTPUT)

from PIL import Image, ImageDraw, ImageStat, __version__ as pillow_version


def ink_mask(image, threshold):
    return image.point(lambda value: 255 if value < threshold else 0, mode='1')


def bounds_mm(box, dpi):
    if box is None:
        return None
    unit = 25.4 / dpi
    return dict(x=box[0] * unit, y=box[1] * unit,
                width=(box[2] - box[0]) * unit, height=(box[3] - box[1]) * unit)


def edges(bounds):
    return [bounds['x'], bounds['y'], bounds['x'] + bounds['width'], bounds['y'] + bounds['height']]


def check_bounds(actual, expected, tolerance):
    if actual is None or expected is None:
        if actual != expected:
            raise AssertionError('Missing or unexpected full ink')
        return 0
    error = max(abs(a - e) for a, e in zip(edges(actual), edges(expected)))
    if error > tolerance + 1e-8:
        raise AssertionError(f'Ink edge deviation {error:.6f} mm exceeds {tolerance:.6f} mm')
    return error


def measure_line(image, line, dpi, tolerance_pixels):
    """Use a 2 mm transverse strip away from guides/intersections, weighted by ink."""
    scale = dpi / 25.4
    along = line['from'] + (line['to'] - line['from']) * 0.2
    lo, hi = math.floor((line['at'] - 0.5) * scale), math.ceil((line['at'] + 0.5) * scale)
    a, b = math.floor((along - 1) * scale), math.ceil((along + 1) * scale)
    # The fixture's solid main lines are well separated at these sample strips.
    values = []
    for position in range(lo, hi):
        crop = (a, position, b, position + 1) if line['axis'] == 'y' else (position, a, position + 1, b)
        with image.crop(crop) as strip:
            values.append(255 - ImageStat.Stat(strip).mean[0])
    mass = sum(values)
    if mass <= 0:
        raise AssertionError('Missing main grid line')
    center = sum((lo + i + 0.5) * value for i, value in enumerate(values)) / mass / scale
    error = abs(center - line['at'])
    if error * scale > tolerance_pixels + 1e-8:
        raise AssertionError(f'Centerline deviation {error:.6f} mm')
    painted = [lo + i for i, value in enumerate(values) if value >= 5]
    if not painted:
        raise AssertionError('Main grid line too faint to measure')
    return dict(axis=line['axis'], expectedMm=line['at'], measuredMm=center,
                errorMm=error, thresholdWidthMm=(painted[-1] + 1 - painted[0]) / scale)


def check_glyph_regions(mask, boxes, dpi, tolerance_pixels):
    """Check every ink-bearing region and reject pixels outside their tolerated union.

    This is not an optical character recognizer: overlapping glyphs can share ink.
    Exact emitted glyph IDs/matrices are checked separately by generate.mjs.
    """
    scale = dpi / 25.4
    allowed = Image.new('1', mask.size)
    draw = ImageDraw.Draw(allowed)
    for box in boxes:
        x, y, right, bottom = edges(box)
        rectangle = (max(0, math.floor(x * scale) - tolerance_pixels),
                     max(0, math.floor(y * scale) - tolerance_pixels),
                     min(mask.width, math.ceil(right * scale) + tolerance_pixels),
                     min(mask.height, math.ceil(bottom * scale) + tolerance_pixels))
        with mask.crop(rectangle) as region:
            if region.getbbox() is None:
                raise AssertionError('Glyph region has no rendered ink')
        draw.rectangle((rectangle[0], rectangle[1], rectangle[2] - 1, rectangle[3] - 1), fill=1)
    # Black out every expected region. Any remaining ink is unexpected.
    outside = mask.copy()
    outside.paste(0, mask=allowed)
    if outside.getbbox() is not None:
        raise AssertionError('Glyph ink outside expected regions')
    allowed.close()
    outside.close()
    return len(boxes)


def raster(pdf, page, dpi, target, temporary):
    stem = Path(temporary) / 'page'
    subprocess.run(['pdftoppm', '-f', str(page), '-l', str(page), '-singlefile', '-r', str(dpi),
                    '-gray', '-aa', 'yes', '-aaVector', 'yes', '-thinlinemode', 'none', str(pdf), str(stem)],
                   check=True, capture_output=True, timeout=60)
    with Image.open(stem.with_suffix('.pgm')) as source:
        image = source.convert('L')
    expected = (math.ceil(210 * dpi / 25.4), math.ceil(297 * dpi / 25.4))
    if image.size != expected:
        raise AssertionError(f'PDF is not exact A4 at requested DPI: {image.size}')
    image.save(target)
    return image


def verify_hash(path, expected):
    if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise AssertionError(f'File changed after operator verification: {path.name}')


def main():
    report_path = OUTPUT / 'measurements.json'
    invalidate_reports(OUTPUT)
    manifest = json.loads((OUTPUT / 'manifest.json').read_text())
    if manifest['schema'] != 'learn-print-acceptance-v1' or not manifest['syntheticOnly']:
        raise AssertionError('This tool accepts its synthetic fixture manifest only')
    dpi, threshold = manifest['dpi'], manifest['threshold']
    tolerance = manifest['rasterTolerancePixels'] * 25.4 / dpi
    png_dir = OUTPUT / 'raster'
    png_dir.mkdir(exist_ok=True)
    records, gallery = [], []
    with tempfile.TemporaryDirectory(prefix='learn-print-raster-') as temporary:
        for specimen in manifest['outputs']:
            pdf = OUTPUT / specimen['file']
            verify_hash(pdf, specimen['sha256'])
            if specimen['diagnostic']:
                verify_hash(OUTPUT / specimen['diagnostic'], specimen['diagnosticSha256'])
            for expected in specimen['pages']:
                number = expected['page']
                name = f'{pdf.stem}-{number}'
                with raster(pdf, number, dpi, png_dir / f'{name}.png', temporary) as image:
                    mask = ink_mask(image, threshold)
                    actual = bounds_mm(mask.getbbox(), dpi)
                    full_error = check_bounds(actual, expected['fullInkMm'], tolerance)
                    mask.close()
                    lines = []
                    if specimen['specimen'] == 'blank':
                        lines = [measure_line(image, line, dpi, manifest['centerlineTolerancePixels'])
                                 for line in specimen['expectedLines']]
                        expected_width = specimen['strokes']['writing-line' if specimen['templateId'] == 'pinyin-lines' else 'grid']['widthMm']
                        for line in lines:
                            if abs(line['thresholdWidthMm'] - expected_width) > tolerance:
                                raise AssertionError('Main line width differs from candidate stroke')
                    thumbnail = image.copy()
                    thumbnail.thumbnail((600, 900))
                    thumbnail.save(png_dir / f'{name}-screen.png')
                    thumbnail.close()
                glyph_actual, glyph_error, checked = None, 0, 0
                if specimen['diagnostic']:
                    with raster(OUTPUT / specimen['diagnostic'], number, dpi,
                                png_dir / f'{name}-text-only.png', temporary) as glyph_image:
                        mask = ink_mask(glyph_image, threshold)
                        glyph_actual = bounds_mm(mask.getbbox(), dpi)
                        glyph_error = check_bounds(glyph_actual, expected['glyphInkMm'], tolerance)
                        checked = check_glyph_regions(mask, expected['glyphBoxes'], dpi, manifest['rasterTolerancePixels'])
                        mask.close()
                records.append(dict(file=specimen['file'], page=number, fullInkMm=actual,
                                    fullInkMaxEdgeErrorMm=full_error, glyphInkMm=glyph_actual,
                                    glyphInkMaxEdgeErrorMm=glyph_error, glyphRegionsChecked=checked, centerlines=lines))
                label = html.escape(f'{pdf.stem} / page {number}')
                gallery.append(f'<article><h2>{label}</h2><a href="{specimen["file"]}">PDF · A4 · 100%</a>'
                               f'<a href="raster/{name}.png"><img src="raster/{name}-screen.png" alt="{label}"></a></article>')
                print(f'Measured {pdf.stem} page {number}', flush=True)
    version = subprocess.run(['pdftoppm', '-v'], capture_output=True, text=True, check=True)
    result = dict(schema='learn-print-measurements-v1', dpi=dpi, pixelSizeMm=25.4 / dpi,
                  threshold=threshold, rasterToleranceMm=tolerance,
                  centerlineToleranceMm=manifest['centerlineTolerancePixels'] * 25.4 / dpi,
                  poppler=(version.stdout + version.stderr).splitlines()[0], pillow=pillow_version,
                  manifestSha256=hashlib.sha256((OUTPUT / 'manifest.json').read_bytes()).hexdigest(),
                  physicalPrintVerified=False, intendedUseLicenseVerified=False, canvasPixelsVerified=False,
                  pages=records, checkedGlyphRegions=sum(r['glyphRegionsChecked'] for r in records),
                  checkedCenterlines=sum(len(r['centerlines']) for r in records),
                  maxFullInkEdgeErrorMm=max(r['fullInkMaxEdgeErrorMm'] for r in records),
                  maxGlyphInkEdgeErrorMm=max(r['glyphInkMaxEdgeErrorMm'] for r in records),
                  maxCenterlineErrorMm=max(line['errorMm'] for r in records for line in r['centerlines']))
    report_path.write_text(json.dumps(result, indent=2) + '\n')
    (OUTPUT / 'index.html').write_text('''<!doctype html><html lang="zh"><meta charset="utf-8"><title>Learn 候选打印样张</title>
<style>body{font:16px system-ui;background:#eee;margin:24px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px}h2{font-size:16px}article{min-width:0}img{display:block;width:100%;margin-top:12px}a{color:#164c78}</style>
<h1>Learn 开发候选打印样张</h1><p>仅合成内容。此页面为光栅索引；打印请打开原 PDF，选择 A4、实际大小 100%，关闭适合页面。真实打印和许可未验收。</p>
<p><a href="OWNER-CHECKLIST.md">Owner 验收表</a> · <a href="manifest.json">版本与文件哈希</a> · <a href="measurements.json">光栅量测</a></p><main>'''
        + ''.join(gallery) + '</main></html>')
    print(f'PASS: {len(records)} PDF pages; {result["checkedCenterlines"]} centerlines; '
          f'{result["checkedGlyphRegions"]} glyph ink regions. Physical printing remains pending.')


if __name__ == '__main__':
    main()
