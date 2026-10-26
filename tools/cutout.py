"""把白底角色圖去背：從四邊做洪水填充，只移除與邊緣相連的近白色，
保留角色身上的白色（襯衫、眼鏡反光）。輸出裁切後的透明 WebP。

用法：python3 cutout.py <輸入.png> <輸出.webp> [最長邊像素]
"""
import sys
from collections import deque

from PIL import Image, ImageFilter

TOL = 28  # 與純白的容許差距；太大會吃掉淺色衣服邊緣


def is_bg(px):
    r, g, b = px[:3]
    return (255 - r) + (255 - g) + (255 - b) <= TOL * 3 and max(r, g, b) - min(r, g, b) < 18


def cutout(src, dst, max_side=512):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    pix = im.load()
    mask = Image.new("L", (w, h), 255)
    mp = mask.load()
    seen = bytearray(w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        if not is_bg(pix[x, y]):
            continue
        mp[x, y] = 0
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    # 邊緣柔化，避免鋸齒白邊
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = im.convert("RGBA")
    out.putalpha(mask)
    bbox = mask.point(lambda v: 255 if v > 20 else 0).getbbox()
    if bbox:
        pad = 8
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(w, bbox[2] + pad), min(h, bbox[3] + pad))
        out = out.crop(bbox)
    out.thumbnail((max_side, max_side), Image.LANCZOS)
    out.save(dst, "WEBP", quality=88, method=6)
    print(dst, out.size)


if __name__ == "__main__":
    cutout(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 512)
