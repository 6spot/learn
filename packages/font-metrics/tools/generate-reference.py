#!/usr/bin/env python3
"""Independent fontTools outline/advance baseline; synthetic public charset only."""
import hashlib
import json
from pathlib import Path
import sys
from collections import defaultdict

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'assets/fonts/tools'))
from coverage import corpora
from font_resources import read_manifest, verify, fonttools
from fontTools.pens.boundsPen import BoundsPen

font_root = ROOT / 'assets/fonts'
manifest = read_manifest(font_root)
verify(font_root, manifest, hashes_only=True)
TTFont = fonttools()
sets = corpora()
han = sets['gb2312_level1'] | sets['gb2312_level2']
shared = sets['ascii_printable'] | sets['pinyin_nfc_codepoints'] | sets['pinyin_nfd_codepoints']
fonts = []
for entry in manifest['fonts']:
    requested = sorted(shared | han if entry['coverageProfile'] == 'han' else shared)
    with TTFont(font_root / entry['path']) as font:
        cmap = font.getBestCmap()
        aliases = defaultdict(list)
        for point, glyph_name in sorted(cmap.items()):
            aliases[glyph_name].append(point)
        glyphs = font.getGlyphSet()
        records = []
        points = []
        for point in requested:
            if point not in cmap:
                continue
            name = cmap[point]
            pen = BoundsPen(glyphs)
            glyphs[name].draw(pen)
            bounds = [round(value * 1000000) for value in pen.bounds] if pen.bounds else None
            # Integer millionths make JSON/hash formatting independent of language.
            records.append([point, font.getGlyphID(name), font['hmtx'][name][0], bounds])
            points.append(point)
        encoded = json.dumps(records, separators=(',', ':')).encode('ascii')
        fonts.append({'id': entry['id'], 'fontSha256': entry['sha256'], 'points': points,
                      'cmapAliases': [group for group in aliases.values() if len(group) > 1],
                      'recordCount': len(records), 'metricsSha256': hashlib.sha256(encoded).hexdigest()})
report = {'schemaVersion': 1, 'generator': 'fontTools 4.60.1 BoundsPen + hmtx; exact outlines rounded to integer millionths', 'fonts': fonts}
target = ROOT / 'packages/font-metrics/test/reference.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(report, separators=(',', ':')) + '\n')
print('Generated independent metric digests:', [(f['id'], f['recordCount']) for f in fonts])
