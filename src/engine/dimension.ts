/**
 * Méretrajz (felülnézet): a panel körvonala, az alkatrészek körvonala, és a kívülről fontos elemek
 * (kezelőszervek, csatlakozók, LED-ek, kijelzők, a vezérlőlap USB-je) helye koordinátaméretezéssel.
 * Az origó a panel bal alsó sarka, x jobbra, y fölfelé, milliméterben (ahogy egy házat tervező CAD-program várja).
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

interface Geo {
  W: number; H: number; bw: number; bh: number; ox: number; oy: number;
  /** oldalnézetek: a legmagasabb pont (mm), az elölnézet alapvonala és az oldalnézet panelsíkja a rajzon (0: nincs) */ zmax: number; fy: number; sx: number;
  /** mm (y fölfelé) → rajz (y lefelé) */ X(x: number): number; Y(y: number): number;
  items: DimItem[]; shown: DimItem[];
  xs: Array<{ it: DimItem; at: number }>; ys: Array<{ it: DimItem; at: number }>;
}

const GAP = 3.8, LEG = 4, ML = 28, MB = 28, MT = 14, MR = 14;

/** Elöl- és oldalnézet helye: a felülnézet méretei után ennyi hely (mm). */
const VGAP = 10;

/** A legmagasabb alkatrész (mm a panel fölött) és a jelölése. */
export function maxHeight(D: Design): { z: number; label: string } {
  let z = 0, label = '';
  for (const it of dimItems(D)) if (!it.feature && it.z > z) { z = it.z; label = it.label; }
  return { z, label };
}

function geo(D: Design, show: ReadonlySet<string> | null, side = true): Geo {
  const { w: bw, h: bh } = boardMm(D), items = dimItems(D), shown = items.filter(i => (show ? show.has(i.id) : i.def));
  const ox = ML, oy = MT;
  const X = (x: number) => r2(ox + x), Y = (y: number) => r2(oy + bh - y);
  // egyedi értékek (azonos koordinátájú elemek egy méretet kapnak)
  const ux = [...new Map(shown.map(it => [fmtMm(it.x), it])).values()], uy = [...new Map(shown.map(it => [fmtMm(it.y), it])).values()];
  const px = spread(ux.map(i => i.x), GAP), py = spread(uy.map(i => i.y), GAP);
  const zmax = side ? Math.max(0, ...items.filter(i => !i.feature).map(i => i.z)) : 0;
  const fy = side ? r2(MT + bh + MB + VGAP + zmax) : 0, sx = side ? r2(ML + bw + MR + VGAP) : 0;
  const W = side ? r2(sx + LEGS + BOARD_T + zmax + 16) : r2(ML + bw + MR), H = side ? r2(fy + BOARD_T + LEGS + 16) : r2(MT + bh + MB);
  return { W, H, zmax, fy, sx, bw, bh, ox, oy, X, Y, items, shown, xs: ux.map((it, k) => ({ it, at: px[k] })), ys: uy.map((it, k) => ({ it, at: py[k] })) };
}

/** A méretrajz SVG-ben (mm, 1:1-ben nyomtatható). `show`: a méretezett elemek; hiányzóként az alapértelmezés. */
export function dimSvg(D: Design, o: { show?: ReadonlySet<string> | null; tr?: Tr; title?: string; hi?: string | null; side?: boolean } = {}): Drawing {
  const tr = o.tr || fmt, g = geo(D, o.show ?? null, o.side !== false), { X, Y, bw, bh } = g, out: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, st: string, w = 0.18, extra = '') => out.push(`<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${st}" stroke-width="${w}"${extra}/>`);
  const text = (x: number, y: number, s: string, size: number, fill: string, anchor = 'middle', rot = 0, weight = 500) =>
    out.push(`<text x="${r2(x)}" y="${r2(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central" font-family="${FONT}" font-weight="${weight}"${rot ? ` transform="rotate(${rot} ${r2(x)} ${r2(y)})"` : ''}>${esc(s)}</text>`);
  const arrow = (x: number, y: number, dx: number, dy: number, st: string) => {
    const L = 1.6, Wd = 0.55, nx = -dy, ny = dx;
    out.push(`<path d="M${r2(x)} ${r2(y)}L${r2(x - dx * L + nx * Wd)} ${r2(y - dy * L + ny * Wd)}L${r2(x - dx * L - nx * Wd)} ${r2(y - dy * L - ny * Wd)}Z" fill="${st}"/>`);
  };
  const DIM = '#1c4f7c', PART = '#8a948d', HI = '#e8590c';

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
    const x = X(it.x), y = Y(it.y), st = o.hi === it.id ? HI : DIM;
    if (it.feature) { out.push(`<circle cx="${x}" cy="${y}" r="0.9" fill="none" stroke="${st}" stroke-width="0.3"/>`); text(x + (it.x < 2 ? 1.6 : it.x > bw - 2 ? -1.6 : 0), y + (it.x < 2 || it.x > bw - 2 ? -1.7 : -1.8), it.label, 1.7, st, it.x < 2 ? 'start' : it.x > bw - 2 ? 'end' : 'middle', 0, 600); }
    line(x - 1.2, y, x + 1.2, y, st, 0.2); line(x, y - 1.2, x, y + 1.2, st, 0.2);
  }
  // koordinátaméretek: x a panel alatt, y balra; origó 0
  const by = Y(0), bx = X(0);
  const xb = by + LEG + 2.5, yb = bx - LEG - 2.5;
  text(bx, xb + 2.4, '0', 2.1, DIM, 'end', -90, 600); line(bx, by + 0.6, bx, xb + 0.6, DIM);
  text(yb - 2.4, by, '0', 2.1, DIM, 'end', 0, 600); line(bx - 0.6, by, yb - 0.6, by, DIM);
  for (const { it, at } of g.xs) {
    const x = X(it.x), ax = X(at), st = o.hi === it.id ? HI : DIM;
    line(x, Y(it.y) + 1.4, x, by + 1.2, st, 0.13, ' stroke-dasharray="0.6 0.5"');
    out.push(`<polyline points="${x},${r2(by + 1.2)} ${x},${r2(by + LEG - 1)} ${ax},${r2(xb - 0.4)} ${ax},${r2(xb + 0.6)}" fill="none" stroke="${st}" stroke-width="0.18"/>`);
    text(ax, xb + 2.4, fmtMm(it.x), 2.1, st, 'end', -90, 600);
  }
  for (const { it, at } of g.ys) {
    const y = Y(it.y), ay = Y(at), st = o.hi === it.id ? HI : DIM;
    line(X(it.x) - 1.4, y, bx - 1.2, y, st, 0.13, ' stroke-dasharray="0.6 0.5"');
    out.push(`<polyline points="${r2(bx - 1.2)},${y} ${r2(bx - LEG + 1)},${y} ${r2(yb + 0.4)},${ay} ${r2(yb - 0.6)},${ay}" fill="none" stroke="${st}" stroke-width="0.18"/>`);
    text(yb - 2.4, ay, fmtMm(it.y), 2.1, st, 'end', 0, 600);
  }
  // befoglaló méretek: szélesség fölül, magasság jobbra
  const ty = Y(bh) - 6, rx = X(bw) + 6;
  line(X(0), Y(bh) - 0.8, X(0), ty - 1, DIM, 0.15); line(X(bw), Y(bh) - 0.8, X(bw), ty - 1, DIM, 0.15);
  line(X(0), ty, X(bw), ty, DIM, 0.2); arrow(X(0), ty, -1, 0, DIM); arrow(X(bw), ty, 1, 0, DIM);
  text(X(bw / 2), ty - 1.8, fmtMm(bw), 2.5, DIM, 'middle', 0, 700);
  line(X(bw) + 0.8, Y(0), rx + 1, Y(0), DIM, 0.15); line(X(bw) + 0.8, Y(bh), rx + 1, Y(bh), DIM, 0.15);
  line(rx, Y(0), rx, Y(bh), DIM, 0.2); arrow(rx, Y(0), 0, 1, DIM); arrow(rx, Y(bh), 0, -1, DIM);
  text(rx + 2, Y(bh / 2), fmtMm(bh), 2.5, DIM, 'middle', 90, 700);
  if (g.fy) sideViews();
  // felirat
  const cap = `${o.title ? o.title + ' · ' : ''}${g.fy ? tr('Méretrajz: felül-, elöl- és oldalnézet') : tr('Méretrajz, felülnézet')} · mm · ${tr('origó: a panel bal alsó sarka')}${g.fy ? ' · ' + tr('a magasságok becslések') : ''}`;
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
    const ry = Y(0) + 6;
    line(px, Y(0) + 0.8, px, ry + 1, DIM, 0.15); line(top + zmax, Y(0) + 0.8, top + zmax, ry + 1, DIM, 0.15);
    line(px, ry, top + zmax, ry, DIM, 0.2); arrow(px, ry, -1, 0, DIM); arrow(top + zmax, ry, 1, 0, DIM);
    text((px + top + zmax) / 2, ry + 2.2, fmtMm(zmax + BOARD_T), 2.3, DIM, 'middle', 0, 700);
  }
}

/* ---------- DXF (AutoCAD R12, ASCII; mm, origó a bal alsó sarok) ---------- */

/** A méretrajz DXF-ben: rétegek BOARD (körvonal), HOLES (rögzítőfuratok), PARTS (alkatrészek), SIDE (elöl- és oldalnézet), CENTERS (középpontok), DIMS (méretvonalak), TEXT. */
export function dimDxf(D: Design, o: { show?: ReadonlySet<string> | null; tr?: Tr } = {}): string {
  const g = geo(D, o.show ?? null), { bw, bh } = g, e: string[] = [];
  const f = (v: number) => r2(v).toString();
  const ln = (layer: string, x1: number, y1: number, x2: number, y2: number) => e.push('0', 'LINE', '8', layer, '10', f(x1), '20', f(y1), '30', '0', '11', f(x2), '21', f(y2), '31', '0');
  const rect = (layer: string, x0: number, y0: number, x1: number, y1: number) => { ln(layer, x0, y0, x1, y0); ln(layer, x1, y0, x1, y1); ln(layer, x1, y1, x0, y1); ln(layer, x0, y1, x0, y0); };
  const txt = (layer: string, x: number, y: number, h: number, s: string, rot = 0, right = false) => {
    e.push('0', 'TEXT', '8', layer, '10', f(x), '20', f(y), '30', '0', '40', f(h), '1', s.replace(/[\r\n]/g, ' '));
    if (rot) e.push('50', String(rot));
    if (right) e.push('72', '2', '11', f(x), '21', f(y), '31', '0');
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
    if (it.feature) { e.push('0', 'CIRCLE', '8', 'CENTERS', '10', f(it.x), '20', f(it.y), '30', '0', '40', '0.9'); txt('TEXT', it.x + 1, it.y + 1, 1.1, it.label); }
  }
  // koordinátaméretek: az x-ek a panel alatt, az y-ok balra (méretvonal + szöveg, nem DIMENSION elem: minden olvasó érti)
  const xb = -(LEG + 2.5), yb = -(LEG + 2.5);
  ln('DIMS', 0, -0.6, 0, xb - 0.6); txt('DIMS', 0.6, xb - 1, 1.5, '0', 90, true);
  ln('DIMS', -0.6, 0, yb - 0.6, 0); txt('DIMS', yb - 1, -0.6, 1.5, '0', 0, true);
  for (const { it, at } of g.xs) { ln('DIMS', it.x, it.y - 1.4, it.x, -(LEG - 1)); ln('DIMS', it.x, -(LEG - 1), at, xb + 0.4); ln('DIMS', at, xb + 0.4, at, xb - 0.6); txt('DIMS', at + 0.6, xb - 1, 1.5, fmtMm(it.x), 90, true); }
  for (const { it, at } of g.ys) { ln('DIMS', it.x - 1.4, it.y, -(LEG - 1), it.y); ln('DIMS', -(LEG - 1), it.y, yb + 0.4, at); ln('DIMS', yb + 0.4, at, yb - 0.6, at); txt('DIMS', yb - 1, at - 0.6, 1.5, fmtMm(it.y), 0, true); }
  ln('DIMS', 0, bh + 6, bw, bh + 6); ln('DIMS', 0, bh + 0.8, 0, bh + 7); ln('DIMS', bw, bh + 0.8, bw, bh + 7); txt('DIMS', bw / 2 - 3, bh + 7, 1.8, fmtMm(bw));
  ln('DIMS', bw + 6, 0, bw + 6, bh); ln('DIMS', bw + 0.8, 0, bw + 7, 0); ln('DIMS', bw + 0.8, bh, bw + 7, bh); txt('DIMS', bw + 8, bh / 2 - 3, 1.8, fmtMm(bh), 90);
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
