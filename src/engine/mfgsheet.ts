/**
 * A gyártási lapok rajza SVG-ben, milliméterben (1:1-ben nyomtatható): alkatrészoldal (alkatrészek körvonala,
 * jelölése, lábai; átkötő vezetékek) és rézoldal (tükrözve: rézcsíkok, vágások, forrasztóhidak, a lábak
 * forrasztási pontjai). A jelölések a `marks`-ból (X vágás, H hídlánc, V vezeték), a lépésekkel azonosak.
 * DOM-mentes: szöveget ad vissza.
 */
import { fmt, type Tr } from '../i18n/i18n';
import { buildLayout } from './board';
import { DEFS, isOff } from './defs';
import { placedPins, xf } from './geometry';
import { boardMm, drillOf, headOf, marks, PITCH, type Marks } from './manufacture';
import type { Design } from './types';

export type Side = 'comp' | 'cu';
export interface SheetOpts {
  side: Side;
  tr?: Tr;
  /** kiemelt jelölések / alkatrész-azonosítók (a többi halvány); üres vagy hiányzó: mind teljes */ hi?: ReadonlySet<string> | null;
  /** felirat a lap alján (pl. a terv neve) */ title?: string;
  /** lépték-ellenőrző vonalzó (50 mm) a nyomtatáshoz */ ruler?: boolean;
  mk?: Marks;
}
export interface Sheet { svg: string; w: number; h: number }

const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const n2 = (v: number) => +v.toFixed(2);
const FONT = 'IBM Plex Mono, ui-monospace, monospace';

/** Az alkatrész befoglaló téglalapja lyukkoordinátában (tört értékkel, a test széléig). */
export function bodyBox(D: Design, id: string): { r0: number; r1: number; c0: number; c1: number } | null {
  const p = D.parts.find(x => x.id === id); if (!p) return null;
  const b = DEFS[p.type].bounds(p), cs = [[b.r0, b.c0], [b.r0, b.c1], [b.r1, b.c0], [b.r1, b.c1]].map(([r, c]) => xf(p, r, c));
  const rs = cs.map(x => x[0]), ks = cs.map(x => x[1]);
  return { r0: Math.min(...rs), r1: Math.max(...rs), c0: Math.min(...ks), c1: Math.max(...ks) };
}

export function sheetSvg(D: Design, o: SheetOpts): Sheet {
  const tr = o.tr || fmt, cu = o.side === 'cu', B = D.board, P = PITCH, mk = o.mk || marks(D);
  const { w: bw, h: bh } = boardMm(D);
  const ML = 8, MT = 8, MR = 6, MB = o.ruler === false ? 8 : 20;
  // a lépték-vonalzó és a felirata kisebb panelnél is kiférjen
  const rulerTxt = tr('50 mm – nyomtatás után vonalzóval ellenőrizd');
  const W = n2(Math.max(ML + bw + MR, o.ruler !== false ? ML + 52 + rulerTxt.length * 1.6 * 0.62 + 2 : 0)), H = n2(MT + bh + MB);
  const hx = (c: number) => n2(ML + (cu ? B.cols - 1 - c : c) * P + P / 2), hy = (r: number) => n2(MT + r * P + P / 2);
  const hi = o.hi && o.hi.size ? o.hi : null, dim = (k: string) => (hi && !hi.has(k) ? ' opacity="0.22"' : '');
  const out: string[] = [];
  const text = (x: number, y: number, s: string, size: number, fill: string, anchor = 'middle', weight = 600, extra = '') =>
    out.push(`<text x="${n2(x)}" y="${n2(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="central" font-weight="${weight}" font-family="${FONT}"${extra}>${esc(s)}</text>`);
  const tag = (x: number, y: number, s: string, col: string, k: string) => {
    const w = s.length * 1.0 + 0.9;
    out.push(`<g${dim(k)}><rect x="${n2(x - w / 2)}" y="${n2(y - 0.95)}" width="${n2(w)}" height="1.9" rx="0.5" fill="#fff" stroke="${col}" stroke-width="0.18"/>`);
    text(x, y, s, 1.45, col); out.push('</g>');
  };

  // panel
  out.push(`<rect x="${ML}" y="${MT}" width="${bw}" height="${bh}" rx="0.6" fill="${cu ? '#f1e6cf' : '#f6efdf'}" stroke="#9c8a64" stroke-width="0.3"/>`);
  // réz (rézoldalon teljes, alkatrészoldalon halvány körvonal a tájékozódáshoz)
  const L = buildLayout(B, [...(D.cuts || []), ...(D.auto.cuts || [])]);
  for (const s of L.segs) {
    if (s.drilled) continue;
    const x = hx(s.c), y0 = hy(s.r0), y1 = hy(s.r1);
    if (cu) out.push(s.r0 === s.r1 ? `<circle cx="${x}" cy="${y0}" r="0.98" fill="#e7c49c" stroke="#b5814f" stroke-width="0.14"/>` : `<rect x="${n2(x - 0.98)}" y="${n2(y0 - 0.98)}" width="1.96" height="${n2(y1 - y0 + 1.96)}" rx="0.98" fill="#e7c49c" stroke="#b5814f" stroke-width="0.14"/>`);
    else if (s.r0 !== s.r1) out.push(`<rect x="${n2(x - 0.98)}" y="${n2(y0 - 0.98)}" width="1.96" height="${n2(y1 - y0 + 1.96)}" rx="0.98" fill="none" stroke="#e2d4b4" stroke-width="0.14"/>`);
  }
  // lyukak
  const holes: string[] = [];
  for (let r = 0; r < B.rows; r++) for (let c = 0; c < B.cols; c++) holes.push(`M${n2(hx(c) + 0.5)} ${hy(r)}a0.5 0.5 0 1 0 -1 0a0.5 0.5 0 1 0 1 0z`);
  out.push(`<path d="${holes.join('')}" fill="#fff" stroke="#8a7b5c" stroke-width="0.12"/>`);
  // vonalzó: minden 5. oszlop és sor száma
  for (let c = 0; c < B.cols; c += 5) text(hx(c), MT - 2.4, String(c), 1.5, '#7a7062', 'middle', 500);
  for (let r = 0; r < B.rows; r += 5) text(ML - 1.6, hy(r), String(r), 1.5, '#7a7062', 'end', 500);

  // alkatrészek
  const tags: Array<() => void> = [];
  for (const p of D.parts) {
    if (!DEFS[p.type] || isOff(p)) continue;
    const bb = bodyBox(D, p.id)!, k = p.id;
    const x0 = cu ? n2(ML + (B.cols - 1 - bb.c1) * P + P / 2) : n2(ML + bb.c0 * P + P / 2), x1 = cu ? n2(ML + (B.cols - 1 - bb.c0) * P + P / 2) : n2(ML + bb.c1 * P + P / 2);
    const y0 = n2(MT + bb.r0 * P + P / 2), y1 = n2(MT + bb.r1 * P + P / 2), w = n2(x1 - x0), h = n2(y1 - y0);
    const pins = placedPins(p), drill = drillOf(p);
    out.push(`<g${dim(k)}>`);
    if (drill) { // rögzítőfurat: a furat és a csavarfej helye, mindkét oldalon
      const cx = hx(p.c), cy = hy(p.r), head = headOf(p) || drill * 2;
      out.push(`<circle cx="${cx}" cy="${cy}" r="${n2(head / 2)}" fill="none" stroke="#868e96" stroke-width="0.18" stroke-dasharray="0.7 0.5"/><circle cx="${cx}" cy="${cy}" r="${n2(drill / 2)}" fill="#fff" stroke="#22262a" stroke-width="0.3"/><path d="M${n2(cx - drill / 2 - 0.6)} ${cy}h${n2(drill + 1.2)}M${cx} ${n2(cy - drill / 2 - 0.6)}v${n2(drill + 1.2)}" stroke="#22262a" stroke-width="0.14"/>`);
      text(cx, n2(cy + head / 2 + 1.3), p.label, 1.5, '#22262a', 'middle', 600);
    } else if (cu) {
      out.push(`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="0.4" fill="none" stroke="#9aa0a6" stroke-width="0.16" stroke-dasharray="0.8 0.6"/>`);
      for (const q of pins) out.push(`<circle cx="${hx(q.c)}" cy="${hy(q.r)}" r="0.82" fill="#5f666d"/>`);
    } else {
      out.push(`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="0.45" fill="#ffffff" fill-opacity="0.82" stroke="#22262a" stroke-width="0.26"/>`);
      pins.forEach((q, i) => out.push(i === 0 && pins.length > 2 ? `<rect x="${n2(hx(q.c) - 0.62)}" y="${n2(hy(q.r) - 0.62)}" width="1.24" height="1.24" fill="#22262a"/>` : `<circle cx="${hx(q.c)}" cy="${hy(q.r)}" r="0.6" fill="#22262a"/>`));
      const pol = pins.find(q => q.role === 'an' || /^\+|\+$/.test(q.name || ''));
      if (pol && pins.length <= 3) text(hx(pol.c) + (pol.c <= (bb.c0 + bb.c1) / 2 ? -1.35 : 1.35), hy(pol.r) - 1.3, '+', 1.9, '#c92a2a', 'middle', 700);
    }
    out.push('</g>');
    const size = Math.max(1.2, Math.min(2.3, Math.min(h * 0.42, (w / Math.max(2, p.label.length)) * 1.55)));
    if (!drill) tags.push(() => { out.push(`<g${dim(k)}>`); text((x0 + x1) / 2, (y0 + y1) / 2, p.label, size, cu ? '#868e96' : '#111', 'middle', 700, ' paint-order="stroke" stroke="#fff" stroke-width="0.5"'); out.push('</g>'); });
  }

  // vezetékek (alkatrészoldalon színesen, rézoldalon csak a forrasztási pontjuk)
  for (const x of mk.wires) {
    const a = x.wire.a, b = x.wire.b, k = x.n;
    if (cu) { out.push(`<g${dim(k)}>${[a, b].map(e => `<circle cx="${hx(e[1])}" cy="${hy(e[0])}" r="0.7" fill="#5f666d"/>`).join('')}</g>`); continue; }
    const col = x.wire.color || '#1c7ed6';
    out.push(`<g${dim(k)}><line x1="${hx(a[1])}" y1="${hy(a[0])}" x2="${hx(b[1])}" y2="${hy(b[0])}" stroke="#222" stroke-width="0.95" stroke-linecap="round"/><line x1="${hx(a[1])}" y1="${hy(a[0])}" x2="${hx(b[1])}" y2="${hy(b[0])}" stroke="${col}" stroke-width="0.62" stroke-linecap="round"/>${[a, b].map(e => `<circle cx="${hx(e[1])}" cy="${hy(e[0])}" r="0.55" fill="#222"/>`).join('')}</g>`);
    tags.push(() => tag((hx(a[1]) + hx(b[1])) / 2, (hy(a[0]) + hy(b[0])) / 2, x.n, '#1c5e8c', k));
  }
  if (cu) {
    // forrasztóhidak, lánconként egy jelöléssel
    for (const ch of mk.chains) {
      const k = ch.n;
      out.push(`<g${dim(k)}>` + ch.bridges.map(b => {
        const long = Math.abs(b[0] - b[2]) + Math.abs(b[1] - b[3]) > 1;
        return `<line x1="${hx(b[1])}" y1="${hy(b[0])}" x2="${hx(b[3])}" y2="${hy(b[2])}" stroke="${long ? '#495057' : '#9aa3ab'}" stroke-width="${long ? 0.5 : 1.25}" stroke-linecap="round"/>`;
      }).join('') + '</g>');
      tags.push(() => tag(hx(ch.from[1]) + (cu ? 1.9 : -1.9), hy(ch.from[0]) - 1.6, ch.n, '#2b6cb0', k));
    }
    // vágások
    for (const x of mk.cuts) {
      const [r, c, kind] = x.cut, k = x.n, X = hx(c);
      if (kind) out.push(`<g${dim(k)}><circle cx="${X}" cy="${hy(r)}" r="1.12" fill="#fff" stroke="#e03131" stroke-width="0.45"/><circle cx="${X}" cy="${hy(r)}" r="0.45" fill="#e03131"/></g>`);
      else { const y = n2(MT + (r + 1) * P); out.push(`<g${dim(k)}><line x1="${n2(X - 1.45)}" y1="${y}" x2="${n2(X + 1.45)}" y2="${y}" stroke="#e03131" stroke-width="0.55" stroke-linecap="round"/></g>`); }
      tags.push(() => tag(X + 2.3, kind ? hy(r) : MT + (r + 1) * P, x.n, '#c92a2a', k));
    }
  }
  for (const f of tags) f();

  // felirat és lépték-ellenőrző vonalzó
  const y = MT + bh + 5;
  const cap = `${o.title ? o.title + ' · ' : ''}${cu ? tr('Rézoldal (tükrözve, alulról nézve)') : tr('Alkatrészoldal (felülről nézve)')} · 1:1 · ${bw}×${bh} mm`;
  text(ML, y, cap, n2(Math.max(1.3, Math.min(2, (W - ML - 1) / (cap.length * 0.62)))), '#333', 'start', 600);
  if (o.ruler !== false) {
    const rx = ML, ry = y + 6.5;
    out.push(`<line x1="${rx}" y1="${ry}" x2="${rx + 50}" y2="${ry}" stroke="#333" stroke-width="0.25"/>`);
    for (let i = 0; i <= 50; i += 5) out.push(`<line x1="${rx + i}" y1="${ry}" x2="${rx + i}" y2="${n2(ry - (i % 10 ? 1 : 2))}" stroke="#333" stroke-width="0.2"/>`);
    text(rx + 52, ry - 1, rulerTxt, 1.6, '#555', 'start', 500);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
  return { svg, w: W, h: H };
}
