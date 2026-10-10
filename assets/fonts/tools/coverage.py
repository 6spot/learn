"""Public, synthetic codepoint probes; never consumes application text."""

import hashlib
import unicodedata


def gb2312_han(first, last):
    points = set()
    for lead in range(first, last + 1):
        for trail in range(0xA1, 0xFF):
            try:
                character = bytes((lead, trail)).decode("gb2312")
            except UnicodeDecodeError:
                continue
            points.add(ord(character))
    return points


def pinyin_clusters():
    # Generate every tone for lower/upper a e i o u ü ê m n. Some combinations
    # have no precomposed Unicode equivalent; both NFC and NFD are inspected.
    return [base + tone for base in "aeiouüêmnAEIOUÜÊMN"
            for tone in ("", "\u0304", "\u0301", "\u030c", "\u0300")]


def corpora():
    clusters = pinyin_clusters()
    precomposed = {ord(c) for s in clusters for c in unicodedata.normalize("NFC", s)}
    decomposed = {ord(c) for s in clusters for c in unicodedata.normalize("NFD", s)}
    return {
        "ascii_printable": set(range(0x20, 0x7F)),
        "gb2312_level1": gb2312_han(0xB0, 0xD7),
        "gb2312_level2": gb2312_han(0xD8, 0xF7),
        "chinese_punctuation": {ord(c) for c in "，。！？；：、‘’“”（）〔〕【】《》〈〉「」『』［］｛｝…—·﹏～　"},
        "fullwidth_ascii": set(range(0xFF01, 0xFF5F)) | {0x3000},
        "pinyin_nfc_codepoints": precomposed,
        "pinyin_nfd_codepoints": decomposed,
        # No textbook claim: exhaustive block inventory, not a mandated charset.
        "cjk_unified_basic": set(range(0x4E00, 0xA000)),
        # Presence alone says nothing about emoji sequences or variation support.
        "capability_probes": {0x20000, 0x20BB7, 0x1F600, 0x1F469, 0x1F4BB,
                              0x200D, 0xFE0F, 0xE0100},
    }


def required_corpora(profile):
    shared = {"ascii_printable", "pinyin_nfc_codepoints", "pinyin_nfd_codepoints"}
    if profile == "han":
        return shared | {"gb2312_level1", "gb2312_level2", "chinese_punctuation", "fullwidth_ascii"}
    if profile == "latin":
        return shared
    raise ValueError("Unknown font coverage profile: " + profile)


def ranges(points):
    """Compact deterministic U+ ranges, including supplementary codepoints."""
    result = []
    for value in sorted(points):
        if result and result[-1][1] + 1 == value:
            result[-1][1] = value
        else:
            result.append([value, value])
    return [f"U+{a:04X}" if a == b else f"U+{a:04X}-U+{b:04X}" for a, b in result]


def inventory():
    return {name: {"count": len(points), "sha256": hashlib.sha256(
        "".join(chr(c) for c in sorted(points)).encode("utf-8")).hexdigest()}
        for name, points in corpora().items()}
