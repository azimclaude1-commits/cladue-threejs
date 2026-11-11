"""Subset LXGW WenKai (SIL OFL 1.1) to the characters the film uses and write src/font.css with base64 @font-face rules.
usage: python3 -I tools/font.py <path to lxgw-wenkai-webfont package dir>
"""
import base64, io, os, re, sys
from fontTools import subset
from fontTools.ttLib import TTFont

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
pkg = sys.argv[1]
text = ''
for d, _, fs in os.walk(os.path.join(root, 'src')):
    for f in fs:
        if f.endswith('.js'): text += open(os.path.join(d, f), encoding='utf-8').read()
text += open(os.path.join(root, 'index.html'), encoding='utf-8').read()
chars = sorted({c for c in text if ord(c) > 0x2E7F} | set('0123456789:/ ·—'))
need = {ord(c) for c in chars}
css = open(os.path.join(pkg, 'lxgwwenkai-regular.css'), encoding='utf-8').read()
out = ['/* LXGW WenKai, SIL Open Font License 1.1 — subset to the characters used here by tools/font.py */']
covered = set()
for m in re.finditer(r'@font-face\s*{([^}]*)}', css):
    body = m.group(1)
    src = re.search(r'url\(["\']?([^"\')]+\.woff2)', body)
    rng = re.search(r'unicode-range:\s*([^;}]+)', body)
    if not src or not rng: continue
    cps = set()
    for part in rng.group(1).split(','):
        part = part.strip().upper().replace('U+', '')
        if '-' in part: a, b = part.split('-'); cps.update(range(int(a, 16), int(b, 16) + 1))
        else: cps.add(int(part, 16))
    want = (need & cps) - covered
    if not want: continue
    path = os.path.join(pkg, src.group(1).lstrip('./'))
    font = TTFont(path)
    cmap = font.getBestCmap()
    want = {c for c in want if c in cmap}
    if not want: continue
    opts = subset.Options(); opts.flavor = 'woff2'; opts.layout_features = ['vert', 'vrt2', 'kern', 'liga']; opts.name_IDs = ['*']
    s = subset.Subsetter(opts); s.populate(unicodes=want); s.subset(font)
    buf = io.BytesIO(); font.flavor = 'woff2'; font.save(buf)
    covered |= want
    rng_s = ','.join('U+%X' % c for c in sorted(want))
    out.append("@font-face{font-family:'WenKai';font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,%s) format('woff2');unicode-range:%s}" % (base64.b64encode(buf.getvalue()).decode(), rng_s))
open(os.path.join(root, 'src', 'font.css'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
missing = [chr(c) for c in need - covered]
print(len(chars), 'chars;', len(out) - 1, 'faces;', os.path.getsize(os.path.join(root, 'src', 'font.css')), 'bytes; missing:', ''.join(missing))
