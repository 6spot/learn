import unittest
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from unittest.mock import patch
from PIL import Image, ImageDraw
from measure import bounds_mm, check_bounds, check_glyph_regions, ink_mask, measure_line, main


class PixelMeasurementRegression(unittest.TestCase):
    def test_shifted_or_clipped_outer_ink_fails(self):
        expected = dict(x=10, y=20, width=30, height=40)
        check_bounds(expected, expected, 0.1)
        for bad in [dict(expected, x=11), dict(expected, width=29), None]:
            with self.assertRaises(AssertionError):
                check_bounds(bad, expected, 0.1)

    def test_missing_and_moved_centerlines_fail(self):
        image = Image.new('L', (1000, 1000), 255)
        line = dict(axis='y', at=10, **{'from': 10, 'to': 80})
        with self.assertRaises(AssertionError):
            measure_line(image, line, 254, 1.5)
        ImageDraw.Draw(image).line((0, 99, 999, 99), fill=140, width=2)
        result = measure_line(image, line, 254, 1.5)
        self.assertLess(result['errorMm'], 0.11)
        with self.assertRaises(AssertionError):
            measure_line(image, dict(line, at=10.4), 254, 1.5)

    def test_unpainted_and_outside_glyph_regions_fail(self):
        mask = Image.new('1', (100, 100))
        box = dict(x=2, y=2, width=1, height=1)
        with self.assertRaises(AssertionError):
            check_glyph_regions(mask, [box], 254, 2)
        ImageDraw.Draw(mask).rectangle((20, 20, 29, 29), fill=1)
        self.assertEqual(check_glyph_regions(mask, [box], 254, 2), 1)
        mask.putpixel((70, 70), 1)
        with self.assertRaises(AssertionError):
            check_glyph_regions(mask, [box], 254, 2)

    def test_gray_tracing_and_pixel_cell_bounds_are_retained(self):
        image = Image.new('L', (100, 100), 255)
        ImageDraw.Draw(image).rectangle((20, 30, 29, 49), fill=166)
        mask = ink_mask(image, 250)
        actual = bounds_mm(mask.getbbox(), 254)
        for key, value in dict(x=2, y=3, width=1, height=2).items():
            self.assertAlmostEqual(actual[key], value)
        self.assertIsNone(ink_mask(image, 128).getbbox())


class FailedRunRegression(unittest.TestCase):
    def test_missing_build_modules_clear_previous_generation_evidence(self):
        self.check_startup_failure('generate.mjs', ['node'], 'ERR_MODULE_NOT_FOUND',
                                   ['manifest.json', 'measurements.json', 'index.html'])

    def test_missing_pillow_clears_previous_measurement_evidence(self):
        self.check_startup_failure('measure.py', [sys.executable, '-S'], "No module named 'PIL'",
                                   ['measurements.json', 'index.html'])

    def check_startup_failure(self, filename, command, error, reports):
        with tempfile.TemporaryDirectory(prefix='learn-print-failure-') as temporary:
            root = Path(temporary)
            script = root / 'scripts' / 'print-acceptance' / filename
            script.parent.mkdir(parents=True)
            shutil.copyfile(Path(__file__).with_name(filename), script)
            output = root / 'dist' / 'print-acceptance'
            output.mkdir(parents=True)
            for name in reports:
                (output / name).write_text('OLD PASS')
            result = subprocess.run([*command, str(script)], capture_output=True, text=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(error, result.stderr)
            for name in reports:
                self.assertFalse((output / name).exists(), name)

    def test_changed_pdf_clears_previous_measurement_evidence(self):
        with tempfile.TemporaryDirectory(prefix='learn-print-hash-') as temporary:
            output = Path(temporary)
            for name in ['measurements.json', 'index.html']:
                (output / name).write_text('OLD PASS')
            (output / 'sample.pdf').write_bytes(b'changed')
            (output / 'manifest.json').write_text(json.dumps(dict(
                schema='learn-print-acceptance-v1', syntheticOnly=True, dpi=600,
                threshold=250, rasterTolerancePixels=2,
                outputs=[dict(file='sample.pdf', sha256='0' * 64)])))
            with patch('measure.OUTPUT', output), self.assertRaisesRegex(AssertionError, 'File changed'):
                main()
            for name in ['measurements.json', 'index.html']:
                self.assertFalse((output / name).exists(), name)


if __name__ == '__main__':
    unittest.main()
