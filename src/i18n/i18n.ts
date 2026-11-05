/**
 * Többnyelvű felület (előkészítés). A forrásnyelv a magyar: a kódban és a HTML-ben a magyar szöveg áll, és ugyanez
 * a fordítás kulcsa (gettext-stílus). Más nyelven a szótár adja a fordítást; ami még nincs benne, magyarul marad.
 *
 * - kódban: `t('Kijelölés')` (az app.ts-ben `tr` néven, mert ott sok a `t` nevű helyi változó), adattáblában `N_('…')`, paraméterrel `t('{n} híd', { n: 3 })` (a `{név}` helyére kerül az érték);
 * - statikus HTML: `translateDom(root)` a szövegcsomópontokat és a `title` / `aria-label` / `placeholder` / `alt`
 *   jellemzőket fordítja (az eredetit megjegyzi, így oda-vissza váltható); `data-i18n-skip` alatt nem fordít.
 *
 * Tiszta, DOM-ot csak a `translateDom` használ; unit tesztelt.
 */
import { EN } from './en';

export type Lang = 'hu' | 'en';
export const LANGS: ReadonlyArray<readonly [Lang, string]> = [['hu', 'Magyar'], ['en', 'English']];
const DICTS: Record<Exclude<Lang, 'hu'>, Readonly<Record<string, string>>> = { en: EN };

let cur: Lang = 'hu';
const subs = new Set<(l: Lang) => void>();

export const getLang = (): Lang => cur;
export function setLang(l: Lang): void {
  if (l === cur) return;
  cur = l;
  for (const f of subs) f(l);
}
/** Nyelvváltáskor hívódik; a visszaadott függvény leiratkoztat. */
export function onLang(f: (l: Lang) => void): () => void { subs.add(f); return () => subs.delete(f); }
export const isLang = (x: unknown): x is Lang => x === 'hu' || x === 'en';

/** Kezdő nyelv: a mentett választás, különben a böngésző első ismert nyelve, végül magyar. */
export function detectLang(stored: unknown, prefs: ReadonlyArray<string> = []): Lang {
  if (isLang(stored)) return stored;
  for (const p of prefs) { const b = p.toLowerCase().split('-')[0]; if (isLang(b)) return b; }
  return 'hu';
}

/** Fordítás (a megadott nyelvre, alapból az aktuálisra); `{név}` helyére a paraméter. */
export function t(src: string, params?: Readonly<Record<string, string | number>>, lang: Lang = cur): string {
  const tr = lang === 'hu' ? src : DICTS[lang][src] ?? src;
  return params ? tr.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : tr;
}
/** Csak jelöli a szöveget a kigyűjtésnek (adattáblákban); a fordítás a felhasználás helyén, `t()`-vel történik. */
export const N_ = (src: string): string => src;
/** Van-e fordítás (a szótár lefedettségéhez). */
export const hasTr = (src: string, lang: Exclude<Lang, 'hu'>): boolean => src in DICTS[lang];
export const dict = (lang: Exclude<Lang, 'hu'>): Readonly<Record<string, string>> => DICTS[lang];

const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'] as const;
const SKIP = new Set(['SCRIPT', 'STYLE', 'svg', 'TEXTAREA', 'CODE', 'PRE', 'KBD']);
/** Szövegcsomópontonként és jellemzőnként: az eredeti (magyar) és amit utoljára beleírtunk. */
const memText = new WeakMap<Text, { o: string; w: string }>();
const memAttr = new WeakMap<Element, Partial<Record<(typeof ATTRS)[number], { o: string; w: string }>>>();
const hasLetter = /\p{L}/u;

/** Egy szöveg fordítása a környező szóközök megtartásával. */
function trKeepSpace(s: string, lang: Lang): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s)!;
  return m[2] && hasLetter.test(m[2]) ? m[1] + t(m[2].replace(/\s+/g, ' '), undefined, lang) + m[3] : s;
}

/**
 * A DOM-részlet szövegei a nyelvre (az eredeti magyart elsőre megjegyzi, így a visszaváltás pontos).
 * A program által később átírt szöveg a következő hívásnál az új szövegből indul.
 */
export function translateDom(root: Element, lang: Lang = cur): void {
  const doc = root.ownerDocument;
  const walk = doc.createTreeWalker(root, 1 | 4, {
    acceptNode: n => (n.nodeType === 1 && (SKIP.has((n as Element).tagName) || (n as Element).hasAttribute('data-i18n-skip')) ? 2 : 1),
  });
  /** `m`: az előző állapot; ha azóta a program átírta (nem az van benne, amit mi írtunk), az új szöveg az eredeti. */
  const next = (now: string, m: { o: string; w: string } | undefined) => {
    const o = m && now === m.w ? m.o : now;
    return { o, w: trKeepSpace(o, lang) };
  };
  const visit = (n: Node) => {
    if (n.nodeType === 3) {
      const tn = n as Text, m = next(tn.data, memText.get(tn));
      memText.set(tn, m); if (tn.data !== m.w) tn.data = m.w;
      return;
    }
    const el = n as Element;
    for (const a of ATTRS) {
      const now = el.getAttribute(a); if (now === null) continue;
      let ma = memAttr.get(el); if (!ma) { ma = {}; memAttr.set(el, ma); }
      const m = next(now, ma[a]); ma[a] = m;
      if (now !== m.w) el.setAttribute(a, m.w);
    }
  };
  visit(root);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) visit(n);
}
