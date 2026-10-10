"""Original code-drawn native tab icons and a share image containing no user text."""
from pathlib import Path
import math
import struct
import zlib

OUT = Path(__file__).resolve().parents[1] / 'miniprogram' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)

def png(name, width, height, pixel):
    data = b''.join(b'\x00' + bytes(channel for x in range(width) for channel in pixel(x, y)) for y in range(height))
    def chunk(tag, payload):
        return struct.pack('>I', len(payload)) + tag + payload + struct.pack('>I', zlib.crc32(tag + payload))
    content = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    (OUT / name).write_bytes(content + chunk(b'IDAT', zlib.compress(data)) + chunk(b'IEND', b''))

def distance(x, y, line):
    ax, ay, bx, by = line
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - ax - t * dx, y - ay - t * dy)

for active, color in [(False, (98, 107, 120)), (True, (53, 120, 229))]:
    suffix = '-active' if active else ''
    paper = [(17, 10, 43, 10), (43, 10, 48, 16), (48, 16, 48, 54), (48, 54, 17, 54),
             (17, 54, 17, 10), (24, 25, 40, 25), (24, 33, 40, 33), (24, 41, 36, 41)]
    png(f'paper{suffix}.png', 64, 64, lambda x, y: (*color, round(255 * max(0, min(1, 2.1 - min(distance(x, y, l) for l in paper))))))
    def person(x, y):
        head = abs(math.hypot(x - 32, y - 20) - 9)
        shoulder = abs(math.hypot((x - 32) / 1.3, y - 52) - 15) if y <= 52 else 99
        base = distance(x, y, (12.5, 52, 51.5, 52))
        return (*color, round(255 * max(0, min(1, 2.1 - min(head, shoulder, base)))))
    png(f'person{suffix}.png', 64, 64, person)

def share(x, y):
    for index, (left, top) in enumerate([(120, 75), (520, 75), (120, 430), (520, 430)]):
        if left <= x <= left + 320 and top <= y <= top + 285:
            if x in (left, left + 320) or y in (top, top + 285): return (221, 227, 236, 255)
            if left + 28 <= x <= left + 292 and top + 24 <= y <= top + 261:
                if index == 3:
                    if (y - top - 24) % 52 in (0, 11, 22, 33): return (150, 161, 180, 255)
                elif (x - left - 28) % 33 == 0 or (y - top - 24) % 33 == 0: return (156, 167, 186, 255)
                elif index in (1, 2) and ((x - left - 28) % 33 == 16 or (y - top - 24) % 33 == 16): return (211, 218, 230, 255)
                elif index == 2 and ((x - left - 28) % 33 == (y - top - 24) % 33 or (x - left - 28) % 33 + (y - top - 24) % 33 == 32): return (218, 224, 233, 255)
            return (255, 255, 255, 255)
    return (245, 247, 251, 255)

png('share-paper.png', 1000, 800, share)
