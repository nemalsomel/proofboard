/**
 * Parancsok: egy helyen a felület minden művelete (név, csoport, gyorsbillentyű, végrehajtás, elérhetőség).
 * Ebből dolgozik a billentyűkezelés, a parancspaletta (Ctrl+K) és a Ctrl nyomva tartásakor látható címkék.
 * Ez a rész tiszta, DOM-mentes (unit tesztelt); a parancslistát a gazda (app.ts) építi.
 */

/** Hol él a gyorsbillentyű: `global` – a szerkesztőkben és párbeszédablakokban is (beviteli mezőn kívül);
 *  `input` – beviteli mezőben is; `board` – csak a panelen (alapértelmezés). */
export type CmdScope = 'board' | 'global' | 'input';

export interface Command {
  id: string;
  /** a megjelenő név (magyar forrásszöveg, `N_`-vel jelölve; a felület fordítja) */ label: string;
  /** csoport a paletta táblázatában (`N_`) */ group: string;
  /** gyorsbillentyűk, pl. `Ctrl+S`, `Alt+1`, `Shift+W`, `Delete`, `?`; az első a kiírt */ keys?: string[];
  /** további keresőszavak (pl. angolul vagy rokon szavak) */ words?: string;
  scope?: CmdScope;
  /** a felület eleme(i), amelyen a Ctrl nyomva tartásakor a címke látszik (CSS-szelektor) */ target?: string;
  run(): void;
  /** végrehajtható-e most (különben a palettán halvány, a billentyű nem él) */ enabled?(): boolean;
  /** be van-e kapcsolva (kapcsoló jellegű parancs) */ checked?(): boolean;
  /** most nem létezik a felületen (pl. Egyszerű módban rejtett): a palettán nem látszik, a billentyű nem él */ hidden?(): boolean;
  /** a palettán nem szerepel külön sorként (pl. egy másik parancs második billentyűje) */ unlisted?: boolean;
}

export interface KeySpec { ctrl: boolean; alt: boolean; shift: boolean; key: string }
export interface KeyEventLike { key: string; code?: string; ctrlKey: boolean; metaKey?: boolean; altKey: boolean; shiftKey: boolean }

/** `Ctrl+Shift+K` → { ctrl, shift, key: 'k' }; a `+` billentyű: `+` vagy `Ctrl++`. */
export function parseKey(s: string): KeySpec {
  const o: KeySpec = { ctrl: false, alt: false, shift: false, key: '' };
  let rest = s;
  for (;;) {
    const m = /^(Ctrl|Alt|Shift)\+(.+)$/.exec(rest);
    if (!m) break;
    if (m[1] === 'Ctrl') o.ctrl = true; else if (m[1] === 'Alt') o.alt = true; else o.shift = true;
    rest = m[2];
  }
  o.key = rest.length === 1 ? rest.toLowerCase() : rest;
  return o;
}

const isAlnum = (k: string) => /^[a-z0-9]$/i.test(k);

/** Illeszkedik-e a billentyűesemény a leíráshoz. A betűk a billentyű feliratát nézik (QWERTZ-en is a Z a Z),
 *  a számjegyek a fizikai helyet (Shift+1 a magyar kiosztáson is), az írásjelek a keletkező karaktert
 *  (a Shift és az AltGr – Ctrl+Alt – nem számít, hiszen azzal jön létre). */
export function matches(spec: KeySpec, ev: KeyEventLike): boolean {
  const ctrl = ev.ctrlKey || !!ev.metaKey;
  if (/^[0-9]$/.test(spec.key)) {
    const at = ev.code ? ev.code === 'Digit' + spec.key || ev.code === 'Numpad' + spec.key : ev.key === spec.key;
    return at && ctrl === spec.ctrl && ev.altKey === spec.alt && ev.shiftKey === spec.shift;
  }
  if (isAlnum(spec.key)) {
    return ev.key.toLowerCase() === spec.key && ctrl === spec.ctrl && ev.altKey === spec.alt && ev.shiftKey === spec.shift;
  }
  if (spec.key.length === 1) {
    if (ev.key !== spec.key) return false;
    const altGr = ctrl && ev.altKey;
    return altGr ? !spec.ctrl && !spec.alt : ctrl === spec.ctrl && ev.altKey === spec.alt;
  }
  return ev.key === spec.key && ctrl === spec.ctrl && ev.altKey === spec.alt && ev.shiftKey === spec.shift;
}

/** A parancs, amelyhez a billentyű tartozik (az elérhetők közül, a megadott hatókörökben). */
export function commandFor(cmds: readonly Command[], ev: KeyEventLike, scopes: readonly CmdScope[]): Command | null {
  for (const c of cmds) {
    if (!c.keys || !scopes.includes(c.scope || 'board')) continue;
    if (!c.keys.some(k => matches(parseKey(k), ev))) continue;
    if ((c.enabled && !c.enabled()) || (c.hidden && c.hidden())) continue;
    return c;
  }
  return null;
}

/** Kiírás: `Shift+W` → `⇧W`, `Delete` → `Del`. */
export function fmtKey(s: string): string {
  const p = parseKey(s);
  const names: Record<string, string> = { Delete: 'Del', Backspace: '⌫', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Enter: '↵' };
  const k = names[p.key] || (p.key.length === 1 ? p.key.toUpperCase() : p.key);
  return (p.ctrl ? 'Ctrl+' : '') + (p.alt ? 'Alt+' : '') + (p.shift ? '⇧' : '') + k;
}

/** Ékezet- és kisbetű-független alak a kereséshez. */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Keresési pontszám (nagyobb = jobb; 0 = nincs találat). Minden szónak illeszkednie kell valahol;
 *  előny: a név eleje, szó eleje, a szavak kezdőbetűi (pl. „ml” → „Megosztás linkkel”). */
export function score(q: string, label: string, words = ''): number {
  const Q = fold(q).trim(); if (!Q) return 1;
  const L = fold(label), W = fold(words), all = L + ' ' + W;
  let s = 0;
  for (const t of Q.split(/\s+/)) {
    const i = L.indexOf(t);
    if (i === 0) s += 30;
    else if (i > 0 && /[\s\-–(›/]/.test(L[i - 1])) s += 20;
    else if (i > 0) s += 10;
    else if (W.includes(t)) s += 6;
    else if (all.includes(t)) s += 4;
    else {
      const ini = L.split(/[\s\-–(›/]+/).filter(Boolean).map(w => w[0]).join('');
      if (t.length > 1 && ini.includes(t)) s += 8; else return 0;
    }
  }
  return s + Math.max(0, 10 - L.length / 6);
}

/** Szűrés és rangsor; azonos pontszámnál az eredeti sorrend marad. */
export function rank<T>(items: readonly T[], q: string, text: (x: T) => [string, string?]): T[] {
  return items.map((x, i) => ({ x, i, s: score(q, ...text(x)) })).filter(o => o.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i).map(o => o.x);
}

/** Ütköző gyorsbillentyűk (ugyanaz a billentyű két parancson, átfedő hatókörben) – a teszt ellenőrzi. */
export function conflicts(cmds: readonly Command[]): string[] {
  const seen = new Map<string, string>(), out: string[] = [];
  for (const c of cmds) for (const k of c.keys || []) {
    const p = parseKey(k), id = `${p.ctrl}${p.alt}${p.shift && isAlnum(p.key)}${p.key}`;
    const prev = seen.get(id);
    if (prev && prev !== c.id) out.push(`${k}: ${prev} / ${c.id}`); else seen.set(id, c.id);
  }
  return out;
}
