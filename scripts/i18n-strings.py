"""A fordítandó szövegek: a statikus HTML szövegei és jellemzői, valamint a kódban t('…') hívások.
Használat: python3 scripts/i18n-strings.py [--missing]  (--missing: csak ami az angol szótárból hiányzik)."""
import json, re, sys, pathlib
from html.parser import HTMLParser
ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP = {'script', 'style', 'svg', 'textarea', 'code', 'pre', 'kbd'}
class P(HTMLParser):
    def __init__(s): super().__init__(); s.t = []; s.stack = []
    def handle_starttag(s, tag, a):
        a = dict(a)
        void = tag in ('input', 'meta', 'link', 'br', 'img', 'hr')
        skip = tag in SKIP or 'data-i18n-skip' in a
        if not void: s.stack.append(skip)
        if any(s.stack) and not skip: pass
        if not any(s.stack) or (void and not any(s.stack)):
            for k in ('title', 'aria-label', 'placeholder', 'alt'):
                v = a.get(k)
                if v and re.search(r'[^\W\d_]', v): s.t.append(re.sub(r'\s+', ' ', v.strip()))
    def handle_endtag(s, tag):
        if s.stack and tag not in ('input', 'meta', 'link', 'br', 'img', 'hr'): s.stack.pop()
    def handle_data(s, d):
        d = re.sub(r'\s+', ' ', d.strip())
        if d and not any(s.stack) and re.search(r'[^\W\d_]', d): s.t.append(d)
def html_strings():
    p = P(); p.feed((ROOT / 'index.html').read_text()); return p.t
def code_strings():
    out = []
    for f in (ROOT / 'src').rglob('*.ts'):
        if 'i18n' in f.parts: continue
        for m in re.finditer(r"\b(?:t|tr|N_)\(\s*'((?:[^'\\]|\\.)*)'", f.read_text()): out.append(m.group(1).replace("\\'", "'"))
    return out
def en_keys():
    src = (ROOT / 'src/i18n/en.ts').read_text()
    return set(json.loads(x) for x in re.findall(r'^\s*("(?:[^"\\]|\\.)*")\s*:', src, re.M))
if __name__ == '__main__':
    allk = list(dict.fromkeys(html_strings() + code_strings()))
    if '--missing' in sys.argv:
        have = en_keys(); miss = [k for k in allk if k not in have]
        print(json.dumps(miss, ensure_ascii=False, indent=1)); print(f'{len(allk) - len(miss)}/{len(allk)} lefordítva', file=sys.stderr)
    else: print(json.dumps(allk, ensure_ascii=False, indent=1))
