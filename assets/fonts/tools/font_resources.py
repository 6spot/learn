#!/usr/bin/env python3
"""Verify/restore pinned local font candidates. Does not modify font data."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import urllib.request
import zipfile

from coverage import corpora, inventory, ranges, required_corpora

DEFAULT_ROOT = Path(__file__).resolve().parents[1]
FONTTOOLS_VERSION = "4.60.1"


class ResourceError(Exception):
    pass


def read_manifest(root):
    return json.loads((root / "manifest.json").read_text(encoding="utf-8"))


def verify_file(path, entry):
    if not path.is_file():
        raise ResourceError(f"Missing {entry['path']}. Run: python3 assets/fonts/tools/font_resources.py restore --download")
    size = path.stat().st_size
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    if size != entry["bytes"] or digest.hexdigest() != entry["sha256"]:
        raise ResourceError(f"Resource mismatch: {entry['path']}; expected {entry['bytes']} bytes / SHA-256 {entry['sha256']}. Existing file preserved; quarantine it before restoring. Do not update the pin to accept changed upstream bytes.")
    return {"path": entry["path"], "bytes": size, "sha256": digest.hexdigest()}


def verify_zip(path):
    with zipfile.ZipFile(path) as archive:
        bad_member = archive.testzip()
        if bad_member is not None:
            raise ResourceError("ZIP CRC failed: " + path.name)


def publish_missing(root, entry, source):
    """Validate a temporary file, then publish without clobbering any file."""
    destination = root / entry["path"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".partial", delete=False) as target:
            temporary = Path(target.name)
            # Bound downloads/extractions to the pinned size, including one byte
            # to detect a too-large stream; never publish partial/mismatched data.
            remaining = entry["bytes"] + 1
            while remaining:
                chunk = source.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                target.write(chunk)
                remaining -= len(chunk)
        verify_file(temporary, entry)
        try:
            os.link(temporary, destination)
        except FileExistsError:
            verify_file(destination, entry)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def acquire(root, entry, download):
    path = root / entry["path"]
    if path.exists():
        verify_file(path, entry)
        return
    if not download:
        raise ResourceError(f"Missing {entry['path']}. Restore from {entry['sourceUrl']} with --download; no network request was made.")
    request = urllib.request.Request(entry["sourceUrl"], headers={"User-Agent": "Learn-font-resource-check/1"})
    with urllib.request.urlopen(request, timeout=60) as response:
        publish_missing(root, entry, response)


def restore(root, manifest, download=False):
    # Licenses are required even for a fresh development checkout.
    for entry in manifest["licenses"]:
        acquire(root, entry, download)
    archives = {entry["path"]: entry for entry in manifest["archives"]}
    for entry in manifest["fonts"]:
        if (root / entry["path"]).exists() or not entry["sourceArchive"]:
            acquire(root, entry, download)
            continue
        archive_entry = archives[entry["sourceArchive"]]
        acquire(root, archive_entry, download)
        archive_path = root / archive_entry["path"]
        verify_zip(archive_path)
        with zipfile.ZipFile(archive_path) as archive:
            info = archive.getinfo(entry["archiveMember"])
            if info.file_size != entry["bytes"]:
                raise ResourceError("Archive member size mismatch: " + entry["path"])
            # Never extractall(): only copy the explicitly pinned member to the
            # pinned destination, independent of paths elsewhere inside the ZIP.
            with archive.open(info) as source:
                publish_missing(root, entry, source)


def check_sfnt_directory(path):
    data = path.read_bytes()
    if len(data) < 12 or data[:4] != b"\x00\x01\x00\x00":
        raise ResourceError("Expected original TrueType sfnt: " + path.name)
    count = struct.unpack_from(">H", data, 4)[0]
    table_end = 12 + count * 16
    if not count or table_end > len(data):
        raise ResourceError("Truncated sfnt directory: " + path.name)
    tables = {}
    for index in range(count):
        tag, _, offset, length = struct.unpack_from(">4sIII", data, 12 + index * 16)
        if tag in tables or offset < table_end or offset + length > len(data):
            raise ResourceError("Invalid sfnt table bounds: " + path.name)
        tables[tag] = (offset, length)
    required = {b"head", b"hhea", b"hmtx", b"maxp", b"name", b"cmap", b"OS/2", b"glyf", b"loca"}
    if not required.issubset(tables):
        raise ResourceError("Missing TrueType table: " + path.name)
    return sorted(tag.decode("ascii") for tag in tables)


def fonttools():
    try:
        import fontTools
        from fontTools.ttLib import TTFont
    except ImportError:
        raise ResourceError("Font inspection requires fonttools==4.60.1. Create assets/fonts/.venv and pip install -r assets/fonts/tools/requirements.txt; see assets/fonts/README.md. Hash-only verification is available with --hashes-only.") from None
    if fontTools.__version__ != FONTTOOLS_VERSION:
        raise ResourceError("Use pinned fonttools==" + FONTTOOLS_VERSION + "; installed version is " + fontTools.__version__)
    return TTFont


def inspect_font(root, entry, TTFont):
    path = root / entry["path"]
    tables = check_sfnt_directory(path)
    with TTFont(path, lazy=False, recalcBBoxes=False, recalcTimestamp=False) as font:
        names = font["name"]
        version = names.getDebugName(5)
        if version != entry["fontVersion"]:
            raise ResourceError("Font version metadata mismatch: " + entry["path"])
        cmap = font.getBestCmap()
        # Reject .notdef mappings too; a cmap entry is not necessarily a glyph.
        points = {point for point, glyph in cmap.items() if font.getGlyphID(glyph) != 0}
        required = required_corpora(entry["coverageProfile"])
        coverage = {}
        for name, requested in corpora().items():
            if name not in required and name not in {"cjk_unified_basic", "capability_probes"}:
                continue
            missing = requested - points
            coverage[name] = {"required": name in required, "requested": len(requested),
                              "present": len(requested) - len(missing), "missing": ranges(missing)}
        hhea, os2 = font["hhea"], font["OS/2"]
        variation = {}
        for table in font["cmap"].tables:
            if table.format == 14:
                for selector, variants in table.uvsDict.items():
                    variation[f"U+{selector:04X}"] = len(variants)
        # Raw advance widths diagnose combining placement, not shaping accuracy.
        probes = " MiW0āǖê\u0300\u0301\u0302\u0304\u0308\u030c"
        advances = {f"U+{ord(c):04X}": font["hmtx"][cmap[ord(c)]][0]
                    for c in sorted(set(probes)) if ord(c) in points}
        return {
            "path": entry["path"], "fontVersion": version,
            "family": names.getDebugName(1), "subfamily": names.getDebugName(2),
            "tables": tables, "unitsPerEm": font["head"].unitsPerEm,
            "glyphCount": font["maxp"].numGlyphs, "unicodeCmapCount": len(points),
            "os2FsType": os2.fsType,
            "metrics": {"hheaAscender": hhea.ascent, "hheaDescender": hhea.descent,
                        "hheaLineGap": hhea.lineGap, "typoAscender": os2.sTypoAscender,
                        "typoDescender": os2.sTypoDescender, "typoLineGap": os2.sTypoLineGap,
                        "winAscent": os2.usWinAscent, "winDescent": os2.usWinDescent,
                        "xHeight": getattr(os2, "sxHeight", None), "capHeight": getattr(os2, "sCapHeight", None)},
            "advanceWidthProbesFontUnits": advances,
            "variationSequenceCounts": variation, "coverage": coverage,
            "requiredCoveragePassed": all(not item["missing"] for item in coverage.values() if item["required"]),
        }


def verify(root, manifest, include_archives=False, hashes_only=False):
    resources = []
    for entry in manifest["licenses"] + manifest["fonts"]:
        resources.append(verify_file(root / entry["path"], entry))
    if include_archives:
        for entry in manifest["archives"]:
            result = verify_file(root / entry["path"], entry)
            verify_zip(root / entry["path"])
            result["zipCrcPassed"] = True
            resources.append(result)
    report = {"schemaVersion": 1, "resources": resources, "archivesChecked": include_archives}
    if not hashes_only:
        TTFont = fonttools()
        report.update({"fontToolsVersion": FONTTOOLS_VERSION, "corpora": inventory(),
                       "fonts": [inspect_font(root, entry, TTFont) for entry in manifest["fonts"]],
                       "limits": "Synthetic cmap coverage and raw metadata only; not shaping, glyph design, production permission, device loading or printing acceptance."})
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("verify", "restore"))
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="Directory containing manifest.json")
    parser.add_argument("--download", action="store_true", help="restore: download only missing pinned resources")
    parser.add_argument("--archives", action="store_true", help="verify: require archive hashes and ZIP CRC")
    parser.add_argument("--hashes-only", action="store_true", help="verify: no fontTools dependency; skips font/coverage inspection")
    parser.add_argument("--allow-coverage-gaps", action="store_true", help="verify: record known candidate coverage gaps without failing; never means full coverage passed")
    parser.add_argument("--report", type=Path, help="verify: write deterministic JSON report")
    args = parser.parse_args(argv)
    try:
        manifest = read_manifest(args.root)
        if args.command == "restore":
            restore(args.root, manifest, args.download)
            print("Pinned local font resources restored/verified; no existing files overwritten.")
            return 0
        report = verify(args.root, manifest, args.archives, args.hashes_only)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        failed = [font["path"] for font in report.get("fonts", []) if not font["requiredCoveragePassed"]]
        if failed:
            message = "Required synthetic coverage missing: " + ", ".join(failed) + "; inspect --report output. Do not silently substitute fonts."
            if not args.allow_coverage_gaps:
                raise ResourceError(message)
            print(message, file=sys.stderr)
            print(f"Verified {len(report['resources'])} pinned resources; coverage gaps recorded (not passed).")
            return 0
        print(f"Verified {len(report['resources'])} pinned resources" + (" (hashes only)." if args.hashes_only else "; required synthetic coverage passed."))
        return 0
    except (ResourceError, OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print("Font resource check failed: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
