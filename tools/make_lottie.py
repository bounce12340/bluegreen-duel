"""產生大絕招的 Lottie 動畫（site/assets/lottie/*.json），不用外部素材，全部用程式畫。
用法：python3 tools/make_lottie.py
- ult_swap.json   變換人設（綠營）：藍、綠兩張面具繞圈互換位置，外圈箭頭旋轉、閃光爆開
- ult_steady.json 始終如一（藍營）：盾牌落下、白色勾勾一筆畫出，一圈圈波紋掃過但盾牌紋風不動
"""
import json
import math
from pathlib import Path

FR, W, H, OP = 60, 400, 400, 96
OUT = Path(__file__).resolve().parent.parent / 'site' / 'assets' / 'lottie'

BLUE = [0.184, 0.435, 0.839, 1]
GREEN = [0.122, 0.604, 0.333, 1]
GOLD = [1, 0.812, 0.239, 1]
WHITE = [1, 1, 1, 1]
INK = [0.12, 0.14, 0.2, 1]


def static(v):
    return {'a': 0, 'k': v}


def anim(*keys, ease=(0.3, 1, 0.7, 0)):
    """keys: (frame, value) ...；預設 ease-out 曲線"""
    ix, iy, ox, oy = ease
    k = []
    for n, (t, v) in enumerate(keys):
        v = v if isinstance(v, list) else [v]
        item = {'t': t, 's': v}
        if n < len(keys) - 1:
            item['i'] = {'x': [ix], 'y': [iy]}
            item['o'] = {'x': [ox], 'y': [oy]}
        k.append(item)
    return {'a': 1, 'k': k}


def tr(p=(0, 0), s=100, r=0, o=100):
    return {'ty': 'tr', 'p': p if isinstance(p, dict) else static(list(p)), 'a': static([0, 0]),
            's': s if isinstance(s, dict) else static([s, s]), 'r': r if isinstance(r, dict) else static(r),
            'o': o if isinstance(o, dict) else static(o)}


def ellipse(w, h=None, p=(0, 0)):
    return {'ty': 'el', 'p': static(list(p)), 's': static([w, h or w]), 'd': 1}


def rect(w, h, r=0, p=(0, 0)):
    return {'ty': 'rc', 'p': static(list(p)), 's': static([w, h]), 'r': static(r), 'd': 1}


def path(points, closed=False, tangents=None):
    n = len(points)
    tin = tangents[0] if tangents else [[0, 0]] * n
    tout = tangents[1] if tangents else [[0, 0]] * n
    return {'ty': 'sh', 'ks': static({'i': tin, 'o': tout, 'v': [list(p) for p in points], 'c': closed})}


def fill(c, o=100):
    return {'ty': 'fl', 'c': static(c), 'o': static(o), 'r': 1}


def stroke(c, w, o=100):
    return {'ty': 'st', 'c': static(c), 'o': o if isinstance(o, dict) else static(o), 'w': w if isinstance(w, dict) else static(w), 'lc': 2, 'lj': 2}


def trim(e, s=None):
    return {'ty': 'tm', 's': s or static(0), 'e': e, 'o': static(0), 'm': 1}


def group(*items, t=None):
    return {'ty': 'gr', 'it': [*items, t or tr()]}


_ind = [0]


def layer(name, shapes, p=(W / 2, H / 2), s=None, r=None, o=None, ip=0, op=OP, parent=None):
    _ind[0] += 1
    L = {'ddd': 0, 'ind': _ind[0], 'ty': 4, 'nm': name, 'sr': 1,
         'ks': {'o': o or static(100), 'r': r or static(0), 'p': p if isinstance(p, dict) else static([*p, 0]),
                'a': static([0, 0, 0]), 's': s or static([100, 100, 100])},
         'ao': 0, 'shapes': shapes, 'ip': ip, 'op': op, 'st': 0, 'bm': 0}
    if parent:
        L['parent'] = parent
    return L


def null(name, p=(W / 2, H / 2), r=None, s=None):
    _ind[0] += 1
    return {'ddd': 0, 'ind': _ind[0], 'ty': 3, 'nm': name, 'sr': 1,
            'ks': {'o': static(0), 'r': r or static(0), 'p': static([*p, 0]), 'a': static([0, 0, 0]), 's': s or static([100, 100, 100])},
            'ao': 0, 'ip': 0, 'op': OP, 'st': 0}


def fade_all(start=OP - 18):
    return anim((0, 0), (8, 100), (start, 100), (OP, 0))


def doc(name, layers):
    # Lottie 的圖層順序：陣列前面的畫在上面
    return {'v': '5.7.4', 'fr': FR, 'ip': 0, 'op': OP, 'w': W, 'h': H, 'nm': name, 'ddd': 0, 'assets': [], 'layers': layers}


def burst_rays(color, n=12, inner=70, outer=190, t0=0, t1=22):
    items = []
    for i in range(n):
        a = 2 * math.pi * i / n
        items.append(group(path([(math.cos(a) * inner, math.sin(a) * inner), (math.cos(a) * outer, math.sin(a) * outer)]),
                           trim(anim((t0, 0), (t1, 100)), anim((t0 + 6, 0), (t1 + 10, 100))), stroke(color, 8)))
    return items


def mask(color, mood):
    """一張圓臉面具：mood='smile' 笑臉、'calm' 平嘴"""
    eyes = [group(ellipse(14, 20, (-20, -10)), fill(INK)), group(ellipse(14, 20, (20, -10)), fill(INK))]
    if mood == 'smile':
        mouth = group(path([(-26, 16), (26, 16)], tangents=([[0, 0], [-14, 22]], [[14, 22], [0, 0]])), stroke(INK, 7))
    else:
        mouth = group(path([(-22, 22), (22, 22)]), stroke(INK, 7))
    face = group(ellipse(110), fill(color), stroke(WHITE, 8))
    return [*eyes, mouth, face]


def make_swap():
    _ind[0] = 0
    pivot = null('pivot', r=anim((10, 0), (58, 180), ease=(0.6, 1, 0.4, 0)))
    # 兩張面具掛在旋轉軸上，自己反向轉保持正立
    counter = anim((10, 0), (58, -180), ease=(0.6, 1, 0.4, 0))
    pop = anim((0, [0, 0, 100]), (12, [112, 112, 100]), (18, [100, 100, 100]), (58, [100, 100, 100]), (66, [118, 118, 100]), (74, [100, 100, 100]))
    m_blue = layer('mask-blue', mask(BLUE, 'calm'), p=(-95, 0), r=counter, s=pop, parent=pivot['ind'])
    m_green = layer('mask-green', mask(GREEN, 'smile'), p=(95, 0), r=counter, s=pop, parent=pivot['ind'])
    # 外圈兩段弧線（像循環箭頭）一直轉
    arcs = layer('arcs', [
        group(ellipse(300), trim(static(4), static(40)), stroke(WHITE, 10)),
        group(ellipse(300), trim(static(54), static(90)), stroke(WHITE, 10)),
        group(path([(150, -8), (162, 14), (138, 14)], closed=True), fill(WHITE), t=tr(r=-24)),
    ], r=anim((0, 0), (OP, 400), ease=(0.4, 0.6, 0.6, 0.4)), s=anim((0, [40, 40, 100]), (16, [100, 100, 100])), o=fade_all())
    flash = layer('flash', [group(ellipse(60), fill(WHITE))], s=anim((56, [0, 0, 100]), (70, [600, 600, 100])), o=anim((56, 90), (72, 0)), ip=56)
    ring = layer('ring', [group(ellipse(120), stroke(GOLD, 10))], s=anim((0, [20, 20, 100]), (26, [330, 330, 100])), o=anim((0, 100), (26, 0)))
    rays = layer('rays', burst_rays(GOLD, t0=58, t1=76), ip=58)
    glow = layer('glow', [group(ellipse(360), fill(GOLD, 30))], s=anim((0, [0, 0, 100]), (18, [100, 100, 100])), o=fade_all())
    for L in (m_blue, m_green, arcs):
        L['ks']['o'] = fade_all()
    return doc('變換人設', [flash, m_blue, m_green, arcs, rays, ring, glow, pivot])


def make_steady():
    _ind[0] = 0
    drop = anim((0, [W / 2, -120, 0]), (16, [W / 2, H / 2 + 6, 0]), (22, [W / 2, H / 2 - 4, 0]), (28, [W / 2, H / 2, 0]))
    # 盾牌：上緣平、兩側微凸、底部收成尖角（i＝進入切線、o＝離開切線，相對於頂點）
    shield_path = path([(0, -120), (100, -84), (92, 30), (0, 128), (-92, 30), (-100, -84)], closed=True,
                       tangents=([[0, 0], [0, 0], [6, -40], [40, -40], [10, 46], [-4, 40]],
                                 [[0, 0], [4, 40], [-10, 46], [-40, -40], [-6, -40], [0, 0]]))
    shield = layer('shield', [group(shield_path, fill(BLUE), stroke(WHITE, 10))], p=drop, o=fade_all())
    check = layer('check', [group(path([(-46, 2), (-12, 40), (52, -40)]), trim(anim((26, 0), (46, 100))), stroke(WHITE, 22))], p=drop, o=fade_all())
    waves = []
    for n, t0 in enumerate((20, 38, 56)):
        waves.append(layer(f'wave{n}', [group(ellipse(200), stroke(GOLD, 9))],
                           s=anim((t0, [90, 90, 100]), (t0 + 30, [210, 210, 100]), ease=(0.2, 0.6, 0.4, 0)),
                           o=anim((t0, 0), (t0 + 4, 100), (t0 + 30, 0)), ip=t0))
    # 底下一條水平線慢慢畫開：穩定、不動搖
    level = layer('level', [group(path([(-150, 0), (150, 0)]), trim(anim((30, 50), (60, 100)), anim((30, 50), (60, 0))), stroke(WHITE, 8))],
                  p=(W / 2, H / 2 + 165), o=fade_all())
    sparkle = layer('sparkle', burst_rays(WHITE, n=8, inner=150, outer=185, t0=44, t1=60), ip=44)
    glow = layer('glow', [group(ellipse(330), fill(BLUE, 22))], s=anim((10, [0, 0, 100]), (30, [100, 100, 100])), o=fade_all())
    return doc('始終如一', [check, shield, sparkle, level, *waves, glow])


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, data in (('ult_swap', make_swap()), ('ult_steady', make_steady())):
        (OUT / f'{name}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
        print(name, (OUT / f'{name}.json').stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
