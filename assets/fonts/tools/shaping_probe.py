#!/usr/bin/env python3
"""Optional installed HarfBuzz probe; not the product's shaping implementation."""

import argparse
import json
from pathlib import Path
import subprocess
import sys
import unicodedata

from coverage import pinyin_clusters
from font_resources import DEFAULT_ROOT, ResourceError, read_manifest, verify


def shape(executable, path, text):
    result = subprocess.run([executable, str(path), text, "--output-format=json", "--no-glyph-names"],
                            check=True, capture_output=True, text=True)
    # Source cluster indices can differ between NFC/NFD; compare glyph selection,
    # placement and advance without mistaking different encodings for failure.
    return [{key: value for key, value in glyph.items() if key != "cl"}
            for glyph in json.loads(result.stdout)]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--hb-shape", default="hb-shape", help="Installed HarfBuzz CLI executable")
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        manifest = read_manifest(args.root)
        verify(args.root, manifest, hashes_only=True)
        version = subprocess.run([args.hb_shape, "--version"], check=True, capture_output=True, text=True).stdout.strip()
        results = []
        for entry in manifest["fonts"]:
            failures = []
            for cluster in pinyin_clusters():
                nfc, nfd = unicodedata.normalize("NFC", cluster), unicodedata.normalize("NFD", cluster)
                first = shape(args.hb_shape, args.root / entry["path"], nfc)
                second = shape(args.hb_shape, args.root / entry["path"], nfd)
                if first != second or not first or any(glyph["g"] == 0 for glyph in first + second):
                    failures.append({"nfc": nfc, "nfd": nfd, "nfcGlyphs": first, "nfdGlyphs": second})
            results.append({"path": entry["path"], "sha256": entry["sha256"],
                            "clustersChecked": len(pinyin_clusters()), "failures": failures,
                            "capitalNGrave": shape(args.hb_shape, args.root / entry["path"], "Ǹ")})
        report = {"schemaVersion": 1, "harfBuzzVersion": version, "fonts": results,
                  "limits": "Local synthetic HarfBuzz canonical-equivalence/no-.notdef probe only; not shared TS, Canvas, PDF, placement bounds, device or printing acceptance."}
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        passed = all(not result["failures"] for result in results)
        print("HarfBuzz canonical-equivalence probe " + ("passed." if passed else "failed; inspect report."))
        return 0 if passed else 1
    except (ResourceError, OSError, ValueError, subprocess.CalledProcessError) as error:
        print("Shaping probe failed: " + str(error) + "; requires an installed hb-shape executable.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
