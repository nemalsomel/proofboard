/**
 * Méretrajz (felülnézet): a panel körvonala, az alkatrészek körvonala, és a kívülről fontos elemek
 * (kezelőszervek, csatlakozók, LED-ek, kijelzők, a vezérlőlap USB-je) helye – láncméretekkel (a szélektől és
 * egymástól), a legközelebbi széltől, vagy koordinátákkal egy választott origótól (`DimMode`).
 * Az elemek helye (`DimItem.x/y`) a panel bal alsó sarkától, x jobbra, y fölfelé, milliméterben.
 * Kívülről fontos: a leírás `meta.front` jelzője (és minden vezérlőlap); a kiemelt pontok a `meta.features`-ből
 * (`[{ name: 'USB', at: [sor, oszlop] }]`, a lábakéval azonos helyi koordinátában, kifejezés is lehet).
 * Valós méret: a leírás `meta.size` ([szélesség a helyi oszlopok mentén, mélység a sorok mentén], mm) – ha nincs,
 * a test befoglalója; magasság a panel fölött: `meta.h` (mm, becslés). Rögzítőfurat: `meta.drill` / `meta.head`.
 * A rajzon a felülnézet mellett elölnézet (lent) és oldalnézet (jobbra), a legmagasabb pont méretével.
 * DOM-mentes: SVG- és DXF-szöveget ad vissza.
 */
import { num } from '../core/expr';
import { fmt, type Tr } from '../i18n/i18n';
import { DEFS, isMcu, isOff, penv } from './defs';
import { xf } from './geometry';
import { boardMm, drillOf, headOf, partHeight, PITCH } from './manufacture';
import { bodyBox } from './mfgsheet';
import type { Design } from './types';

export interface DimItem {
  /** alkatrész-azonosító, kiemelt pontnál `id:név` */ id: string;
  /** a rajzon: „SW1”, „PICO1 USB” */ label: string;
  name: string;
  /** a középpont (mm, origó a bal alsó sarok, y fölfelé) */ x: number; y: number;
  /** befoglaló méret (mm); kiemelt pontnál 0 */ w: number; h: number;
  /** alapból méretezett (kívülről fontos) */ def: boolean;
  /** kiemelt pont (pl. USB) a test szélén */ feature?: string;
  /** magasság a panel fölött (mm) */ z: number;
  /** rögzítőfurat átmérője és a csavarfej helye (mm) */ drill?: number; head?: number;
}
/** A panel vastagsága és a lábak kilógása alul (mm), az oldalnézetekhez. */
export const BOARD_T = 1.6, LEGS = 2.5;
export interface Drawing { svg: string; w: number; h: number }

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmtMm = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const FONT = 'IBM Plex Mono, ui-monospace, monospace';

interface Feature { name: string; at: readonly [unknown, unknown] }
const metaOf = (type: string) => (DEFS[type]?.def.meta || {}) as { front?: boolean; features?: Feature[]; size?: [number, number] };

/** Lyukkoordináta (tört is) → mm, origó a bal alsó sarok. */
export function holeMm(D: Design, r: number, c: number): { x: number; y: number } {
  return { x: r2(c * PITCH + PITCH / 2), y: r2(D.board.rows * PITCH - (r * PITCH + PITCH / 2)) };
}

/** A méretezhető elemek: a panelen lévő alkatrészek (és kiemelt pontjaik), a sorrend balról jobbra, fentről le. */
export function dimItems(D: Design): DimItem[] {
  const out: DimItem[] = [];
  for (const p of D.parts) {
    if (isOff(p)) continue;
    const b = bodyBox(D, p.id); if (!b) continue;
    const m = metaOf(p.type), a = holeMm(D, b.r1, b.c0), z = holeMm(D, b.r0, b.c1);
    const front = !!m.front || isMcu(p), drill = drillOf(p), zh = partHeight(p);
    if (drill) {
      const q = holeMm(D, p.r, p.c), head = headOf(p) || drill * 2;
      out.push({ id: p.id, label: p.label, name: DEFS[p.type].name, x: q.x, y: q.y, w: head, h: head, def: front, z: 0, drill, head });
      continue;
    }
    let w = r2(z.x - a.x), h = r2(z.y - a.y);
    if (Array.isArray(m.size) && m.size.length === 2 && m.size.every(v => typeof v === 'number' && v > 0)) [w, h] = p.rot & 1 ? [m.size[1], m.size[0]] : [m.size[0], m.size[1]];
    out.push({ id: p.id, label: p.label, name: DEFS[p.type].name, x: r2((a.x + z.x) / 2), y: r2((a.y + z.y) / 2), w, h, def: front, z: zh });
    if (m.features) {
      const env = penv(p);
      for (const f of m.features) {
        const [r, c] = xf(p, num(f.at[0], env), num(f.at[1], env)), q = holeMm(D, r, c);
        out.push({ id: p.id + ':' + f.name, label: p.label + ' ' + f.name, name: f.name, x: q.x, y: q.y, w: 0, h: 0, def: true, feature: f.name, z: zh });
      }
    }
  }
  return out.sort((u, v) => u.x - v.x || v.y - u.y);
}

/** A méretezett elemek: az alapértelmezés a felhasználó felülírásaival (`+id` bekapcsolva, `-id` kikapcsolva). */
export function shownItems(items: DimItem[], over: readonly string[]): Set<string> {
  const on = new Set(items.filter(i => i.def).map(i => i.id));
  for (const o of over) { const id = o.slice(1); if (o[0] === '+') on.add(id); else if (o[0] === '-') on.delete(id); }
  return on;
}

/** Koordinátaméretek elhelyezése: a feliratok legalább `gap` távolságra, a pont körül középre igazítva. */
function spread(vals: number[], gap: number): number[] {
  const idx = vals.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const pos = idx.map(x => x[0]);
  for (let k = 0; k < 40; k++) {
    let moved = false;
    for (let i = 1; i < pos.length; i++) if (pos[i] - pos[i - 1] < gap - 1e-6) {
      const d = (gap - (pos[i] - pos[i - 1])) / 2; pos[i - 1] -= d; pos[i] += d; moved = true;
    }
    if (!moved) break;
  }
  const out = new Array<number>(vals.length);
  idx.forEach(([, i], k) => { out[i] = pos[k]; });
  return out;
}

/**
 * Méretezés módja:
 *  - `chain` (lánc): a panel szélétől az első elemig, elemtől elemig, az utolsótól a túlsó szélig (alul az x, balra az y);
 *  - `gap` (térköz, alapértelmezés): minden elem testétől mind a négy irányban a legközelebbi szomszéd testéig vagy a panel széléig
 *    (a szabad hely; csak a méretezett elemek számítanak, a pár egyszer);
 *  - `edge` (széltől): minden elem a hozzá legközelebbi függőleges és vízszintes széltől;
 *  - `ord` (koordináta): egy közös origótól – a panel bal alsó sarka vagy egy kiválasztott elem középpontja.
 * Minden méret a középpontig (furatnál a furat közepéig) mér.
 */
export type DimMode = 'gap' | 'chain' | 'edge' | 'ord';
export const DIM_MODES: readonly DimMode[] = ['gap', 'chain', 'edge', 'ord'];
/** Mire mér a lánc és a széltől mért méret: a test szélére (`body`, alapértelmezés – szabad hely, térköz) vagy a középpontra. */
export type DimTo = 'body' | 'center';
export interface DimOpts {
  show?: ReadonlySet<string> | null;
  mode?: DimMode;
  /** lánc és széltől: a test széléig (alapból) vagy a középpontig; koordinátánál mindig a középpont */ to?: DimTo;
  /** koordinátaméretezésnél az origó: elemazonosító (üres: a panel bal alsó sarka) */ origin?: string | null;
  tr?: Tr;
}

/** Az elem fél kiterjedése a tengely mentén (mm): a test fele, furatnál a furat sugara, kiemelt pontnál 0. */
export function halfExt(it: DimItem, axis: 'x' | 'y'): number {
  return it.feature ? 0 : it.drill ? it.drill / 2 : (axis === 'x' ? it.w : it.h) / 2;
}
/** Az elem távolsága a panel négy szélétől (mm): `to = 'body'` a test szélétől (szabad hely), `'center'` a középponttól. */
export function edgeDist(D: Design, it: DimItem, to: DimTo = 'center'): { left: number; right: number; bottom: number; top: number } {
  const { w, h } = boardMm(D), hx = to === 'body' ? halfExt(it, 'x') : 0, hy = to === 'body' ? halfExt(it, 'y') : 0;
  return { left: r2(it.x - hx), right: r2(w - it.x - hx), bottom: r2(it.y - hy), top: r2(h - it.y - hy) };
}

/** Lineáris méret (mm, y fölfelé): `axis` irányban a..b, a méretvonal a másik tengely `at` helyén; `row` 1: a felirat a vonal túloldalán. */
interface Lin { axis: 'x' | 'y'; a: number; b: number; at: number; text: string; row: 0 | 1; id?: string; arrows?: boolean; strong?: boolean }
/** Segédvonal (mm, y fölfelé): a mért ponttól a méretvonalig. */
interface Ext { x1: number; y1: number; x2: number; y2: number; id?: string; dashed?: boolean }
/** Koordinátaméret: a pont (`v`) és a felirat helye (`at`, széthúzva). */
interface Ord { it: DimItem; v: number; at: number }

interface Geo {
  W: number; H: number; bw: number; bh: number; ox: number; oy: number;
  /** oldalnézetek: a legmagasabb pont (mm), az elölnézet alapvonala és az oldalnézet panelsíkja a rajzon (0: nincs) */ zmax: number; fy: number; sx: number;
  /** mm (y fölfelé) → rajz (y lefelé) */ X(x: number): number; Y(y: number): number;
  items: DimItem[]; shown: DimItem[];
  mode: DimMode; to: DimTo; o: { x: number; y: number; it: DimItem | null };
  lins: Lin[]; exts: Ext[]; xs: Ord[]; ys: Ord[];
}

const GAP = 3.8, LEG = 4, ML = 28, MB = 28, MT = 14, MR = 14;
/** a lánc-méretvonal távolsága a panel szélétől (mm) */
const CH = 7;
/** Elöl- és oldalnézet helye: a felülnézet méretei után ennyi hely (mm). */
const VGAP = 10;
/** méretszám betűmérete (mm) és becsült szélessége */
const TS = 2.1, textW = (s: string) => s.length * TS * 0.62;

/** A legmagasabb alkatrész (mm a panel fölött) és a jelölése. */
export function maxHeight(D: Design): { z: number; label: string } {
  let z = 0, label = '';
  for (const it of dimItems(D)) if (!it.feature && it.z > z) { z = it.z; label = it.label; }
  return { z, label };
}

/** Láncméretek egy tengelyen: a szélek és az elemek (azonos érték egyszer) közti szakaszok. */
/** Láncpont: a mért érték, az elem, és ahonnan a segédvonal indul (a másik tengelyen). */
interface ChainPt { v: number; it: DimItem | null; from: number }
function chain(axis: 'x' | 'y', len: number, shown: DimItem[], at: number, to: DimTo): { lins: Lin[]; pts: ChainPt[] } {
  const key = (v: number) => Math.round(v * 20), oth = axis === 'x' ? 'y' : 'x';
  const m = new Map<number, ChainPt>();
  m.set(key(0), { v: 0, it: null, from: 0 }); m.set(key(len), { v: len, it: null, from: 0 });
  // a segédvonal a test alsó (x) / bal (y) széléről indul a méretvonal felé; középpontnál a jel mellől
  const add = (v: number, it: DimItem) => { if (!m.has(key(v))) m.set(key(v), { v, it, from: it[oth] - (to === 'body' && halfExt(it, oth) ? halfExt(it, oth) : 1.4) }); };
  for (const it of shown) {
    const c = it[axis], hlf = to === 'body' ? halfExt(it, axis) : 0;
    if (hlf) { add(c - hlf, it); add(c + hlf, it); } else add(c, it);
  }
  const pts = [...m.values()].sort((a, b) => a.v - b.v), lins: Lin[] = [];
  let prevShort = false, row: 0 | 1 = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].v, b = pts[i].v, text = fmtMm(b - a);
    if (b - a < 0.05) continue;
    const short = b - a < textW(text) + 1;
    row = short && prevShort ? (row ? 0 : 1) : 0;
    prevShort = short;
    lins.push({ axis, a, b, at, text, row, id: pts[i].it?.id || pts[i - 1].it?.id });
  }
  return { lins, pts };
}

/**
 * Térközök: minden elem testétől a négy irányban a legközelebbi, vele átfedő sávban lévő elem testéig vagy a panel széléig.
 * A méretvonal a két test közös sávjának közepén fut (a szélig az elem közepén); egy pár csak egyszer kerül a rajzra.
 */
function gaps(shown: DimItem[], bw: number, bh: number): Lin[] {
  const box = (it: DimItem) => { const hx = halfExt(it, 'x'), hy = halfExt(it, 'y'); return { it, x0: it.x - hx, x1: it.x + hx, y0: it.y - hy, y1: it.y + hy }; };
  // a kiemelt pont (pl. USB) nem akadály, és csak a hozzá legközelebbi függőleges és vízszintes szélig mér
  const B = shown.filter(i => !i.feature).map(box), out: Lin[] = [], seen = new Set<string>(), EPS = 0.05;
  for (const f of shown) if (f.feature) {
    const l = f.x, r = bw - f.x, b = f.y, t = bh - f.y;
    if (Math.min(l, r) > EPS) out.push({ axis: 'x', a: l <= r ? 0 : f.x, b: l <= r ? f.x : bw, at: f.y, text: fmtMm(Math.min(l, r)), row: 0, id: f.id, arrows: true });
    if (Math.min(b, t) > EPS) out.push({ axis: 'y', a: b <= t ? 0 : f.y, b: b <= t ? f.y : bh, at: f.x, text: fmtMm(Math.min(b, t)), row: 0, id: f.id, arrows: true });
  }
  for (const a of B) {
    for (const dir of ['l', 'r', 'b', 't'] as const) {
      const horiz = dir === 'l' || dir === 'r';
      // a vele átfedő sávban lévő, az adott irányban levő testek közül a legközelebbi
      let best: typeof a | null = null, dist = horiz ? (dir === 'l' ? a.x0 : bw - a.x1) : (dir === 'b' ? a.y0 : bh - a.y1);
      for (const b of B) {
        if (b === a) continue;
        const over = horiz ? Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) : Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        if (over <= EPS) continue;
        const d = dir === 'l' ? a.x0 - b.x1 : dir === 'r' ? b.x0 - a.x1 : dir === 'b' ? a.y0 - b.y1 : b.y0 - a.y1;
        if (d >= -EPS && d < dist) { dist = d; best = b; }
      }
      if (dist < EPS) continue;
      const key = best ? [a.it.id, best.it.id].sort().join('|') + (horiz ? 'h' : 'v') : a.it.id + dir;
      if (seen.has(key)) continue; seen.add(key);
      const at = best ? (horiz ? (Math.max(a.y0, best.y0) + Math.min(a.y1, best.y1)) / 2 : (Math.max(a.x0, best.x0) + Math.min(a.x1, best.x1)) / 2) : (horiz ? a.it.y : a.it.x);
      const [lo, hi] = dir === 'l' ? [a.x0 - dist, a.x0] : dir === 'r' ? [a.x1, a.x1 + dist] : dir === 'b' ? [a.y0 - dist, a.y0] : [a.y1, a.y1 + dist];
      out.push({ axis: horiz ? 'x' : 'y', a: lo, b: hi, at, text: fmtMm(dist), row: 0, id: a.it.id, arrows: true });
    }
  }
  return out;
}

function geo(D: Design, o: DimOpts, side = true): Geo {
  const { w: bw, h: bh } = boardMm(D), items = dimItems(D), show = o.show ?? null;
  const shown = items.filter(i => (show ? show.has(i.id) : i.def));
  const mode: DimMode = o.mode && DIM_MODES.includes(o.mode) ? o.mode : 'gap', to: DimTo = o.to === 'center' ? 'center' : 'body';
  const ox = ML, oy = MT;
  const X = (x: number) => r2(ox + x), Y = (y: number) => r2(oy + bh - y);
  const oit = mode === 'ord' && o.origin ? items.find(i => i.id === o.origin) || null : null;
  const org = { x: oit ? oit.x : 0, y: oit ? oit.y : 0, it: oit };
  const lins: Lin[] = [], exts: Ext[] = [];
  let xs: Ord[] = [], ys: Ord[] = [];
  if (mode === 'chain') {
    const cx = chain('x', bw, shown, -CH, to), cy = chain('y', bh, shown, -CH, to);
    lins.push(...cx.lins, ...cy.lins);
    for (const p of cx.pts) exts.push(p.it ? { x1: p.v, y1: p.from, x2: p.v, y2: -CH - 1, id: p.it.id, dashed: true } : { x1: p.v, y1: -0.8, x2: p.v, y2: -CH - 1 });
    for (const p of cy.pts) exts.push(p.it ? { x1: p.from, y1: p.v, x2: -CH - 1, y2: p.v, id: p.it.id, dashed: true } : { x1: -0.8, y1: p.v, x2: -CH - 1, y2: p.v });
  } else if (mode === 'gap') {
    lins.push(...gaps(shown, bw, bh));
  } else if (mode === 'edge') {
    for (const it of shown) {
      const e = edgeDist(D, it, to), toL = e.left <= e.right, toB = e.bottom <= e.top;
      const hx = to === 'body' ? halfExt(it, 'x') : 0, hy = to === 'body' ? halfExt(it, 'y') : 0;
      if ((toL ? e.left : e.right) > 0.05) lins.push({ axis: 'x', a: toL ? 0 : it.x + hx, b: toL ? it.x - hx : bw, at: it.y, text: fmtMm(toL ? e.left : e.right), row: 0, id: it.id, arrows: true });
      if ((toB ? e.bottom : e.top) > 0.05) lins.push({ axis: 'y', a: toB ? 0 : it.y + hy, b: toB ? it.y - hy : bh, at: it.x, text: fmtMm(toB ? e.bottom : e.top), row: 0, id: it.id, arrows: true });
    }
  } else {
    // egyedi értékek (azonos koordinátájú elemek egy méretet kapnak); az origó maga a 0
    const ux = [...new Map(shown.filter(i => i !== oit).map(it => [fmtMm(it.x - org.x), it])).values()].filter(it => fmtMm(it.x - org.x) !== fmtMm(0));
    const uy = [...new Map(shown.filter(i => i !== oit).map(it => [fmtMm(it.y - org.y), it])).values()].filter(it => fmtMm(it.y - org.y) !== fmtMm(0));
    const px = spread([org.x, ...ux.map(i => i.x)], GAP), py = spread([org.y, ...uy.map(i => i.y)], GAP);
    const o0: DimItem = oit || { id: '', label: '0', name: '', x: 0, y: 0, w: 0, h: 0, def: false, z: 0 };
    xs = [{ it: o0, v: 0, at: px[0] }, ...ux.map((it, k) => ({ it, v: it.x - org.x, at: px[k + 1] }))];
    ys = [{ it: o0, v: 0, at: py[0] }, ...uy.map((it, k) => ({ it, v: it.y - org.y, at: py[k + 1] }))];
  }
  // befoglaló méretek: szélesség fölül, magasság jobbra
  lins.push({ axis: 'x', a: 0, b: bw, at: bh + 6, text: fmtMm(bw), row: 0, arrows: true, strong: true }, { axis: 'y', a: 0, b: bh, at: bw + 6, text: fmtMm(bh), row: 1, arrows: true, strong: true });
  exts.push({ x1: 0, y1: bh + 0.8, x2: 0, y2: bh + 7 }, { x1: bw, y1: bh + 0.8, x2: bw, y2: bh + 7 }, { x1: bw + 0.8, y1: 0, x2: bw + 7, y2: 0 }, { x1: bw + 0.8, y1: bh, x2: bw + 7, y2: bh });
  const zmax = side ? Math.max(0, ...items.filter(i => !i.feature).map(i => i.z)) : 0;
  const fy = side ? r2(MT + bh + MB + VGAP + zmax) : 0, sx = side ? r2(ML + bw + MR + VGAP) : 0;
  const W = side ? r2(sx + LEGS + BOARD_T + zmax + 16) : r2(ML + bw + MR), H = side ? r2(fy + BOARD_T + LEGS + 16) : r2(MT + bh + MB);
  return { W, H, zmax, fy, sx, bw, bh, ox, oy, X, Y, items, shown, mode, to, o: org, lins, exts, xs, ys };
}

/** A felirat a rajz alján: a nézetek, a mérés módja. */
function caption(g: Geo, tr: Tr, title?: string): string {
  const how = g.mode === 'gap' ? tr('térközök: a testek között és a panel széléig')
    : g.mode === 'chain' ? (g.to === 'body' ? tr('láncméretek: a panel szélétől és egymástól, a testek széléig') : tr('láncméretek: a szélektől és egymástól, a középpontokig'))
    : g.mode === 'edge' ? (g.to === 'body' ? tr('a legközelebbi széltől a test széléig') : tr('a legközelebbi széltől a középpontig'))
      : g.o.it ? tr('origó: {x} középpontja', { x: g.o.it.label }) : tr('origó: a panel bal alsó sarka');
  return `${title ? title + ' · ' : ''}${g.fy ? tr('Méretrajz: felül-, elöl- és oldalnézet') : tr('Méretrajz, felülnézet')} · mm · ${how}${g.fy ? ' · ' + tr('a magasságok becslések') : ''}`;
}

/** A méretrajz SVG-ben (mm, 1:1-ben nyomtatható). `show`: a méretezett elemek; hiányzóként az alapértelmezés. */
export function dimSvg(D: Design, o: DimOpts & { title?: string; hi?: string | null; side?: boolean } = {}): Drawing {
  const tr = o.tr || fmt, g = geo(D, o, o.side !== false), { X, Y, bw, bh } = g, out: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, st: string, w = 0.18, extra = '') => out.push(`<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${st}" stroke-width="${w}"${extra}/>`);
  const text = (x: number, y: number, s: string, size: number, fill: string, anchor = 'middle', rot = 0, weight = 500, bg = false) => {
    if (bg) { const tw = s.length * size * 0.62 + 0.8, th = size + 0.6; out.push(`<rect x="${r2(rot ? x - th / 2 : x - tw / 2)}" y="${r2(rot ? y - tw / 2 : y - th / 2)}" width="${r2(rot ? th : tw)}" height="${r2(rot ? tw : th)}" fill="#fff" fill-opacity="0.85"/>`); }
    out.push(`<text x="${r2(x)}" y="${r2(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central" font-family="${FONT}" font-weight="${weight}"${rot ? ` transform="rotate(${rot} ${r2(x)} ${r2(y)})"` : ''}>${esc(s)}</text>`);
  };
  const arrow = (x: number, y: number, dx: number, dy: number, st: string) => {
    const L = 1.6, Wd = 0.55, nx = -dy, ny = dx;
    out.push(`<path d="M${r2(x)} ${r2(y)}L${r2(x - dx * L + nx * Wd)} ${r2(y - dy * L + ny * Wd)}L${r2(x - dx * L - nx * Wd)} ${r2(y - dy * L - ny * Wd)}Z" fill="${st}"/>`);
  };
  /** ferde vonalka (láncméret vége) */
  const tick = (x: number, y: number, st: string) => line(x - 0.7, y + 0.7, x + 0.7, y - 0.7, st, 0.3);
  const DIM = '#1c4f7c', PART = '#8a948d', HI = '#e8590c';
  const col = (id?: string) => (id && o.hi === id ? HI : DIM);

  out.push(`<rect x="0" y="0" width="${g.W}" height="${g.H}" fill="#fff"/>`);
  // lyukak (halványan, a tájékozódáshoz)
  const hp: string[] = [];
  for (let r = 0; r < D.board.rows; r++) for (let c = 0; c < D.board.cols; c++) { const q = holeMm(D, r, c); hp.push(`M${r2(X(q.x) - 0.25)} ${r2(Y(q.y))}h0.5`); }
  out.push(`<path d="${hp.join('')}" stroke="#d5dad3" stroke-width="0.5" stroke-linecap="round"/>`);
  // alkatrészek körvonala
  for (const it of g.items) if (!it.feature) {
    const on = g.shown.includes(it), hi = o.hi === it.id;
    if (it.drill) {
      const st = hi ? HI : '#1d231f';
      out.push(`<circle cx="${X(it.x)}" cy="${Y(it.y)}" r="${r2((it.head || 0) / 2)}" fill="none" stroke="${PART}" stroke-width="0.18" stroke-dasharray="0.7 0.5"/><circle cx="${X(it.x)}" cy="${Y(it.y)}" r="${r2(it.drill / 2)}" fill="#fff" stroke="${st}" stroke-width="0.35"/>`);
      text(X(it.x), Y(it.y - (it.head || 0) / 2) + 1.6, `${it.label} ⌀${fmtMm(it.drill)}`, 1.7, st, 'middle', 0, 600);
      continue;
    }
    out.push(`<rect x="${r2(X(it.x - it.w / 2))}" y="${r2(Y(it.y + it.h / 2))}" width="${it.w}" height="${it.h}" rx="0.4" fill="${hi ? '#fff4e6' : on ? '#f3f6f8' : 'none'}" stroke="${hi ? HI : on ? '#3d4a42' : PART}" stroke-width="${on || hi ? 0.3 : 0.2}"${on || hi ? '' : ' stroke-dasharray="0.8 0.6"'}/>`);
    text(X(it.x), it.h < 5 ? Y(it.y) : Y(it.y + it.h / 2) + 1.9, it.label, it.h < 5 ? Math.min(1.8, it.w / Math.max(1, it.label.length * 0.62)) : 1.9, on || hi ? '#1d231f' : PART, 'middle', 0, 600);
  }
  // panel körvonala
  out.push(`<rect x="${X(0)}" y="${Y(bh)}" width="${bw}" height="${bh}" fill="none" stroke="#1d231f" stroke-width="0.45"/>`);
  // középpontok
  for (const it of g.shown) {
    const x = X(it.x), y = Y(it.y), st = col(it.id);
    if (it.feature) { out.push(`<circle cx="${x}" cy="${y}" r="0.9" fill="none" stroke="${st}" stroke-width="0.3"/>`); text(x + (it.x < 2 ? 1.6 : it.x > bw - 2 ? -1.6 : 0), y + (it.x < 2 || it.x > bw - 2 ? -1.7 : -1.8), it.label, 1.7, st, it.x < 2 ? 'start' : it.x > bw - 2 ? 'end' : 'middle', 0, 600); }
    line(x - 1.2, y, x + 1.2, y, st, 0.2); line(x, y - 1.2, x, y + 1.2, st, 0.2);
  }
  // segédvonalak, majd a lineáris méretek
  for (const e of g.exts) line(X(e.x1), Y(e.y1), X(e.x2), Y(e.y2), col(e.id), e.dashed ? 0.13 : 0.15, e.dashed ? ' stroke-dasharray="0.6 0.5"' : '');
  for (const l of g.lins) {
    const st = l.strong ? DIM : col(l.id), size = l.strong ? 2.5 : TS, w = l.strong ? 0.2 : 0.18;
    if (l.axis === 'x') {
      const y = Y(l.at), x1 = X(l.a), x2 = X(l.b);
      line(x1, y, x2, y, st, w);
      if (l.arrows) { arrow(x1, y, -1, 0, st); arrow(x2, y, 1, 0, st); } else { tick(x1, y, st); tick(x2, y, st); }
      text((x1 + x2) / 2, l.row ? y + size * 0.85 + 0.4 : y - size * 0.85 - 0.2, l.text, size, st, 'middle', 0, l.strong ? 700 : 600, (g.mode === 'edge' || g.mode === 'gap') && !l.strong);
    } else {
      const x = X(l.at), y1 = Y(l.a), y2 = Y(l.b);
      line(x, y1, x, y2, st, w);
      if (l.arrows) { arrow(x, y1, 0, 1, st); arrow(x, y2, 0, -1, st); } else { tick(x, y1, st); tick(x, y2, st); }
      text(l.row ? x + size * 0.85 + 0.4 : x - size * 0.85 - 0.2, (y1 + y2) / 2, l.text, size, st, 'middle', l.row && l.strong ? 90 : -90, l.strong ? 700 : 600, (g.mode === 'edge' || g.mode === 'gap') && !l.strong);
    }
  }
  // koordinátaméretek: x a panel alatt, y balra
  if (g.mode === 'ord') {
    const by = Y(0), bx = X(0), xb = by + LEG + 2.5, yb = bx - LEG - 2.5;
    if (g.o.it) { const x = X(g.o.x), y = Y(g.o.y); out.push(`<circle cx="${x}" cy="${y}" r="1.6" fill="none" stroke="${DIM}" stroke-width="0.3"/><path d="M${x} ${r2(y - 1.6)}A1.6 1.6 0 0 1 ${r2(x + 1.6)} ${y}L${x} ${y}ZM${x} ${r2(y + 1.6)}A1.6 1.6 0 0 1 ${r2(x - 1.6)} ${y}L${x} ${y}Z" fill="${DIM}"/>`); }
    for (const { it, v, at } of g.xs) {
      const x = X(it.x), ax = X(at), st = col(it.id);
      line(x, it.id ? Y(it.y) + 1.4 : by + 0.6, x, by + 1.2, st, 0.13, it.id ? ' stroke-dasharray="0.6 0.5"' : '');
      out.push(`<polyline points="${x},${r2(by + 1.2)} ${x},${r2(by + LEG - 1)} ${ax},${r2(xb - 0.4)} ${ax},${r2(xb + 0.6)}" fill="none" stroke="${st}" stroke-width="0.18"/>`);
      text(ax, xb + 2.4, v === 0 ? '0' : fmtMm(v), TS, st, 'end', -90, 600);
    }
    for (const { it, v, at } of g.ys) {
      const y = Y(it.y), ay = Y(at), st = col(it.id);
      line(it.id ? X(it.x) - 1.4 : bx - 0.6, y, bx - 1.2, y, st, 0.13, it.id ? ' stroke-dasharray="0.6 0.5"' : '');
      out.push(`<polyline points="${r2(bx - 1.2)},${y} ${r2(bx - LEG + 1)},${y} ${r2(yb + 0.4)},${ay} ${r2(yb - 0.6)},${ay}" fill="none" stroke="${st}" stroke-width="0.18"/>`);
      text(yb - 2.4, ay, v === 0 ? '0' : fmtMm(v), TS, st, 'end', 0, 600);
    }
  }
  if (g.fy) sideViews();
  const cap = caption(g, tr, o.title);
  text(2, g.H - 3, cap, Math.max(1.3, Math.min(2.1, (g.W - 4) / (cap.length * 0.62))), '#333', 'start', 0, 600);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${g.W}mm" height="${g.H}mm" viewBox="0 0 ${g.W} ${g.H}">${out.join('')}</svg>`, w: g.W, h: g.H };

  /** Elölnézet (a panel alsó éle felől, a felülnézet alatt, x egyezik) és oldalnézet (jobbról, a felülnézet mellett, y egyezik). */
  function sideViews() {
    const parts = g.items.filter(i => !i.feature && !i.drill && i.z > 0), fy = g.fy, sx = g.sx, zmax = g.zmax;
    const body = (on: boolean, hi: boolean) => `fill="${hi ? '#fff4e6' : '#fff'}" stroke="${hi ? HI : on ? '#3d4a42' : PART}" stroke-width="${on || hi ? 0.28 : 0.2}"`;
    // elölnézet: a hátsók előbb, az elsők takarják őket
    text(X(0), fy - zmax - 3.2, tr('Elölnézet'), 2, '#333', 'start', 0, 700);
    out.push(`<rect x="${X(0)}" y="${fy}" width="${bw}" height="${BOARD_T}" fill="#e9d8b4" stroke="#1d231f" stroke-width="0.3"/>`);
    line(X(0), fy + BOARD_T + LEGS, X(bw), fy + BOARD_T + LEGS, PART, 0.15, ' stroke-dasharray="0.8 0.6"');
    // a felirat csak ott, ahol egy elöl lévő alkatrész nem takarja
    const hidden = (it: DimItem, u: number, z: number, along: 'x' | 'y') => parts.some(n => n !== it && (along === 'x' ? n.y < it.y : n.x > it.x) && Math.abs((along === 'x' ? n.x : n.y) - u) < (along === 'x' ? n.w : n.h) / 2 + 2 && n.z > z - 1.2);
    for (const it of [...parts].sort((a, b) => b.y - a.y)) out.push(`<rect x="${r2(X(it.x - it.w / 2))}" y="${r2(fy - it.z)}" width="${it.w}" height="${it.z}" ${body(g.shown.includes(it), o.hi === it.id)}/>`);
    for (const it of parts) if (it.z >= 3 && it.w >= it.label.length * 1.1 && !hidden(it, it.x, it.z / 2, 'x')) text(X(it.x), fy - it.z / 2, it.label, Math.min(1.6, it.z * 0.45), g.shown.includes(it) ? '#1d231f' : PART, 'middle', 0, 600);
    for (const it of g.items) if (it.drill) out.push(`<rect x="${r2(X(it.x - it.drill / 2))}" y="${fy}" width="${it.drill}" height="${BOARD_T}" fill="#fff" stroke="#1d231f" stroke-width="0.2" stroke-dasharray="0.5 0.4"/>`);
    // magasságméret balra: a panel alja → a legmagasabb pont
    const lx = X(0) - 6;
    line(X(0) - 0.8, fy + BOARD_T, lx - 1, fy + BOARD_T, DIM, 0.15); line(X(0) - 0.8, fy - zmax, lx - 1, fy - zmax, DIM, 0.15);
    line(lx, fy + BOARD_T, lx, fy - zmax, DIM, 0.2); arrow(lx, fy + BOARD_T, 0, 1, DIM); arrow(lx, fy - zmax, 0, -1, DIM);
    text(lx - 1.8, fy - (zmax - BOARD_T) / 2, fmtMm(zmax + BOARD_T), 2.3, DIM, 'middle', -90, 700);
    text(lx - 5, fy - (zmax - BOARD_T) / 2, tr('max. magasság'), 1.6, DIM, 'middle', -90, 500);
    text(X(bw) + 1.5, fy + BOARD_T / 2, `${fmtMm(BOARD_T)} ${tr('panel')}`, 1.5, '#555', 'start', 0, 500);
    text(X(bw) + 1.5, fy + BOARD_T + LEGS, `${fmtMm(LEGS)} ${tr('lábak')}`, 1.5, '#555', 'start', 0, 500);
    // oldalnézet: jobbról; a panel függőleges, a magasság jobbra nő; a bal oldaliak előbb
    text(sx, Y(bh) - 3.2, tr('Oldalnézet'), 2, '#333', 'start', 0, 700);
    const px = sx + LEGS; // a panel alsó síkja
    line(sx, Y(0), sx, Y(bh), PART, 0.15, ' stroke-dasharray="0.8 0.6"');
    out.push(`<rect x="${r2(px)}" y="${Y(bh)}" width="${BOARD_T}" height="${bh}" fill="#e9d8b4" stroke="#1d231f" stroke-width="0.3"/>`);
    const top = px + BOARD_T;
    for (const it of [...parts].sort((a, b) => a.x - b.x)) out.push(`<rect x="${r2(top)}" y="${r2(Y(it.y + it.h / 2))}" width="${it.z}" height="${it.h}" ${body(g.shown.includes(it), o.hi === it.id)}/>`);
    for (const it of parts) if (it.h >= 3 && it.z >= it.label.length * 1.1 && !hidden(it, it.y, it.z / 2, 'y')) text(top + it.z / 2, Y(it.y), it.label, Math.min(1.6, it.h * 0.45), g.shown.includes(it) ? '#1d231f' : PART, 'middle', 0, 600);
    const ry = Y(0) + 6 + (g.mode === 'chain' ? 0 : 0);
    line(px, Y(0) + 0.8, px, ry + 1, DIM, 0.15); line(top + zmax, Y(0) + 0.8, top + zmax, ry + 1, DIM, 0.15);
    line(px, ry, top + zmax, ry, DIM, 0.2); arrow(px, ry, -1, 0, DIM); arrow(top + zmax, ry, 1, 0, DIM);
    text((px + top + zmax) / 2, ry + 2.2, fmtMm(zmax + BOARD_T), 2.3, DIM, 'middle', 0, 700);
  }
}

/* ---------- DXF (AutoCAD R12, ASCII; mm, origó a bal alsó sarok) ---------- */

/** A méretrajz DXF-ben: rétegek BOARD (körvonal), HOLES (rögzítőfuratok), PARTS (alkatrészek), SIDE (elöl- és oldalnézet), CENTERS (középpontok), DIMS (méretvonalak), TEXT. A méretezés módja a rajzéval egyezik. */
export function dimDxf(D: Design, o: DimOpts = {}): string {
  const g = geo(D, o), { bw, bh } = g, e: string[] = [];
  const f = (v: number) => r2(v).toString();
  const ln = (layer: string, x1: number, y1: number, x2: number, y2: number) => e.push('0', 'LINE', '8', layer, '10', f(x1), '20', f(y1), '30', '0', '11', f(x2), '21', f(y2), '31', '0');
  const rect = (layer: string, x0: number, y0: number, x1: number, y1: number) => { ln(layer, x0, y0, x1, y0); ln(layer, x1, y0, x1, y1); ln(layer, x1, y1, x0, y1); ln(layer, x0, y1, x0, y0); };
  /** szöveg; `al`: 0 bal, 1 közép, 2 jobb (vízszintesen), a megadott pont a szöveg alapvonalán */
  const txt = (layer: string, x: number, y: number, h: number, s: string, rot = 0, al: 0 | 1 | 2 = 0) => {
    e.push('0', 'TEXT', '8', layer, '10', f(x), '20', f(y), '30', '0', '40', f(h), '1', s.replace(/[\r\n]/g, ' '));
    if (rot) e.push('50', String(rot));
    if (al) e.push('72', String(al), '11', f(x), '21', f(y), '31', '0');
  };
  rect('BOARD', 0, 0, bw, bh);
  const circle = (layer: string, x: number, y: number, r: number) => e.push('0', 'CIRCLE', '8', layer, '10', f(x), '20', f(y), '30', '0', '40', f(r));
  for (const it of g.items) if (it.drill) {
    circle('HOLES', it.x, it.y, it.drill / 2); circle('PARTS', it.x, it.y, (it.head || it.drill * 2) / 2);
    txt('TEXT', it.x + (it.head || 0) / 2 + 0.5, it.y - 0.6, 1.2, `${it.label} D${fmtMm(it.drill)}`);
  } else if (!it.feature) {
    rect('PARTS', it.x - it.w / 2, it.y - it.h / 2, it.x + it.w / 2, it.y + it.h / 2);
    txt('TEXT', it.x - it.w / 2 + 0.3, it.y + it.h / 2 - 1.5, 1.2, it.label);
  }
  for (const it of g.shown) {
    ln('CENTERS', it.x - 1.2, it.y, it.x + 1.2, it.y); ln('CENTERS', it.x, it.y - 1.2, it.x, it.y + 1.2);
    if (it.feature) { circle('CENTERS', it.x, it.y, 0.9); txt('TEXT', it.x + 1, it.y + 1, 1.1, it.label); }
  }
  // méretek: vonal + szöveg (nem DIMENSION elem: minden olvasó érti)
  for (const x of g.exts) ln('DIMS', x.x1, x.y1, x.x2, x.y2);
  for (const l of g.lins) {
    const h = l.strong ? 1.8 : 1.5;
    if (l.axis === 'x') {
      ln('DIMS', l.a, l.at, l.b, l.at);
      for (const v of [l.a, l.b]) ln('DIMS', v - 0.5, l.at - 0.5, v + 0.5, l.at + 0.5);
      txt('DIMS', (l.a + l.b) / 2, l.row ? l.at - 0.6 - h : l.at + 0.6, h, l.text, 0, 1);
    } else {
      ln('DIMS', l.at, l.a, l.at, l.b);
      for (const v of [l.a, l.b]) ln('DIMS', l.at - 0.5, v - 0.5, l.at + 0.5, v + 0.5);
      txt('DIMS', l.row ? l.at + 0.6 + h : l.at - 0.6, (l.a + l.b) / 2, h, l.text, 90, 1);
    }
  }
  if (g.mode === 'ord') {
    const xb = -(LEG + 2.5), yb = -(LEG + 2.5);
    for (const { it, v, at } of g.xs) { ln('DIMS', it.x, it.id ? it.y - 1.4 : -0.6, it.x, -(LEG - 1)); ln('DIMS', it.x, -(LEG - 1), at, xb + 0.4); ln('DIMS', at, xb + 0.4, at, xb - 0.6); txt('DIMS', at + 0.6, xb - 1, 1.5, v === 0 ? '0' : fmtMm(v), 90, 2); }
    for (const { it, v, at } of g.ys) { ln('DIMS', it.id ? it.x - 1.4 : -0.6, it.y, -(LEG - 1), it.y); ln('DIMS', -(LEG - 1), it.y, yb + 0.4, at); ln('DIMS', yb + 0.4, at, yb - 0.6, at); txt('DIMS', yb - 1, at - 0.6, 1.5, v === 0 ? '0' : fmtMm(v), 0, 2); }
    if (g.o.it) circle('DIMS', g.o.x, g.o.y, 1.6);
  }
  // elölnézet a panel alatt (a panel alsó síkja: fy), oldalnézet jobbra (a panel alsó síkja: sx); y fölfelé
  const parts = g.items.filter(i => !i.feature && !i.drill && i.z > 0), zmax = g.zmax;
  const fy = -(MB + VGAP + zmax), sx = bw + MR + VGAP + LEGS;
  rect('SIDE', 0, fy - BOARD_T, bw, fy);
  for (const it of parts) rect('SIDE', it.x - it.w / 2, fy, it.x + it.w / 2, fy + it.z);
  ln('DIMS', -6, fy - BOARD_T, -6, fy + zmax); txt('DIMS', -7, fy, 1.8, fmtMm(zmax + BOARD_T), 90);
  rect('SIDE', sx, 0, sx + BOARD_T, bh);
  for (const it of parts) rect('SIDE', sx + BOARD_T, it.y - it.h / 2, sx + BOARD_T + it.z, it.y + it.h / 2);
  ln('DIMS', sx, -6, sx + BOARD_T + zmax, -6); txt('DIMS', sx, -8.5, 1.8, fmtMm(zmax + BOARD_T));
  const layers = [['BOARD', 7], ['HOLES', 1], ['PARTS', 8], ['SIDE', 8], ['CENTERS', 5], ['DIMS', 5], ['TEXT', 7]] as const;
  const head = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1',
    '9', '$EXTMIN', '10', f(-ML), '20', f(fy - BOARD_T - LEGS - 4), '30', '0', '9', '$EXTMAX', '10', f(sx + BOARD_T + zmax + 4), '20', f(bh + MT), '30', '0', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(layers.length),
    ...layers.flatMap(([n, c]) => ['0', 'LAYER', '2', n, '70', '0', '62', String(c), '6', 'CONTINUOUS']), '0', 'ENDTAB', '0', 'ENDSEC'];
  return [...head, '0', 'SECTION', '2', 'ENTITIES', ...e, '0', 'ENDSEC', '0', 'EOF'].join('\n') + '\n';
}
