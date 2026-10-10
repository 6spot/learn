"""Resource safety checks with synthetic bytes; no copyrighted font fixtures."""

import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import font_resources as resources
from coverage import corpora, inventory, ranges


def entry(path, data, **extra):
    return {"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "sourceUrl": "https://invalid.example/fixture", **extra}


class ResourceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def test_mismatch_preserves_existing_file(self):
        target = self.root / "font.ttf"
        target.write_bytes(b"unrelated")
        expected = entry("font.ttf", b"original")
        with self.assertRaisesRegex(resources.ResourceError, "Resource mismatch"):
            resources.acquire(self.root, expected, True)
        self.assertEqual(target.read_bytes(), b"unrelated")

    def test_missing_without_download_makes_no_network_request(self):
        with patch("urllib.request.urlopen") as network:
            with self.assertRaisesRegex(resources.ResourceError, "--download"):
                resources.acquire(self.root, entry("font.ttf", b"original"), False)
            network.assert_not_called()

    def test_download_verifies_then_publishes_and_is_idempotent(self):
        expected = entry("files/font.ttf", b"original")
        with patch("urllib.request.urlopen", return_value=io.BytesIO(b"original")) as network:
            resources.acquire(self.root, expected, True)
            resources.acquire(self.root, expected, True)
            self.assertEqual(network.call_count, 1)
        self.assertEqual((self.root / expected["path"]).read_bytes(), b"original")
        self.assertEqual(list(self.root.rglob("*.partial")), [])

    def test_wrong_download_never_publishes_or_leaves_partial_files(self):
        expected = entry("font.ttf", b"original")
        for data in (b"changed!", b"tiny", b"original-extra"):
            with self.subTest(data=data), patch("urllib.request.urlopen", return_value=io.BytesIO(data)):
                with self.assertRaisesRegex(resources.ResourceError, "Resource mismatch"):
                    resources.acquire(self.root, expected, True)
                self.assertFalse((self.root / "font.ttf").exists())
                self.assertEqual(list(self.root.iterdir()), [])

    def test_interrupted_download_never_publishes(self):
        class BrokenStream(io.BytesIO):
            def read(self, size):
                raise OSError("connection interrupted")
        with patch("urllib.request.urlopen", return_value=BrokenStream()):
            with self.assertRaisesRegex(OSError, "interrupted"):
                resources.acquire(self.root, entry("font.ttf", b"original"), True)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_atomic_publish_does_not_replace_racing_write(self):
        expected = entry("font.ttf", b"original")
        target = self.root / "font.ttf"
        target.write_bytes(b"different")
        with self.assertRaisesRegex(resources.ResourceError, "Resource mismatch"):
            resources.publish_missing(self.root, expected, io.BytesIO(b"original"))
        self.assertEqual(target.read_bytes(), b"different")

    def test_restore_reads_only_pinned_zip_member(self):
        archive_path = self.root / "source.zip"
        with zipfile.ZipFile(archive_path, "w") as archive:
            archive.writestr("Original/ttf/font.ttf", b"original")
            archive.writestr("../must-not-extract", b"bad")
            archive.writestr("unused.ttf", b"other")
        manifest = {"licenses": [], "archives": [entry("source.zip", archive_path.read_bytes())],
                    "fonts": [entry("files/font.ttf", b"original", sourceArchive="source.zip",
                                    archiveMember="Original/ttf/font.ttf")]}
        with patch("urllib.request.urlopen") as network:
            resources.restore(self.root, manifest)
            network.assert_not_called()
        self.assertEqual((self.root / "files/font.ttf").read_bytes(), b"original")
        self.assertEqual(sorted(p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file()),
                         ["files/font.ttf", "source.zip"])
        # A byte-identical archive cannot stand in for a different font pin.
        (self.root / "files/font.ttf").unlink()
        manifest["fonts"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(resources.ResourceError, "Resource mismatch"):
            resources.restore(self.root, manifest)
        self.assertFalse((self.root / "files/font.ttf").exists())

    def test_cli_missing_resource_is_actionable_and_nonzero(self):
        manifest = {"licenses": [], "archives": [], "fonts": [entry("files/font.ttf", b"font")]}
        (self.root / "manifest.json").write_text(json.dumps(manifest))
        error = io.StringIO()
        with contextlib.redirect_stderr(error):
            code = resources.main(["verify", "--root", str(self.root), "--hashes-only"])
        self.assertEqual(code, 1)
        self.assertIn("files/font.ttf", error.getvalue())
        self.assertIn("restore --download", error.getvalue())

    def test_cli_full_coverage_fails_unless_gap_is_explicitly_allowed(self):
        (self.root / "manifest.json").write_text("{}")
        report = {"resources": [], "fonts": [{"path": "fixture.ttf", "requiredCoveragePassed": False}]}
        with patch.object(resources, "verify", return_value=report), contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(resources.main(["verify", "--root", str(self.root)]), 1)
            self.assertEqual(resources.main(["verify", "--root", str(self.root), "--allow-coverage-gaps"]), 0)

    def test_rejects_truncated_sfnt_before_parser(self):
        path = self.root / "font.ttf"
        path.write_bytes(b"\x00\x01\x00\x00\x00\x01" + b"\x00" * 6)
        with self.assertRaisesRegex(resources.ResourceError, "Truncated sfnt"):
            resources.check_sfnt_directory(path)


class CorpusTests(unittest.TestCase):
    def test_han_corpus_is_complete_disjoint_and_reproducible(self):
        all_sets = corpora()
        self.assertEqual(len(all_sets["gb2312_level1"]), 3755)
        self.assertEqual(len(all_sets["gb2312_level2"]), 3008)
        self.assertFalse(all_sets["gb2312_level1"] & all_sets["gb2312_level2"])
        self.assertEqual(inventory()["gb2312_level1"]["sha256"], "8a2c560cd533c9698323870d4487dc879d49c2558f47a19b4166af6f1271194e")
        self.assertEqual(inventory()["gb2312_level2"]["sha256"], "643cb7d404b42ce3d164e5e5c6609d525f4e9ee7de717eabb2fad0ea92eb3595")

    def test_pinyin_contains_uppercase_grave_n_and_decomposed_tones(self):
        all_sets = corpora()
        self.assertTrue({ord(c) for c in "Ǹǹǖǘǚǜêḿ"} <= all_sets["pinyin_nfc_codepoints"])
        self.assertTrue(set(range(0x300, 0x303)) | {0x304, 0x308, 0x30C} <= all_sets["pinyin_nfd_codepoints"])
        self.assertTrue({ord("N"), ord("U")} <= all_sets["pinyin_nfd_codepoints"])

    def test_ranges_keep_supplementary_characters(self):
        self.assertEqual(ranges({0x9FF1, 0x9FF0, 0x20000}), ["U+9FF0-U+9FF1", "U+20000"])


if __name__ == "__main__":
    unittest.main()
