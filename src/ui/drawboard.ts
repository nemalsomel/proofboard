/**
 * A panel rajza (vászon): panel, vonalzók, rézcellák a hálózat színével, lyukak, csíkvágások, hidak, vezetékek,
 * forrpontok, alkatrészek (ui/drawpart.ts), lerakási előnézet és a kiemelések. Kiemelve az app.ts-ből, a viselkedés
 * változatlan. A gazda a pillanatnyi állapotot (`BoardScene`) adja; a még az app.ts-ben lévő rétegeket (kábeles
 * dugók, jegyzetek, kapcsolati vonalak) a `layers` hívja a megfelelő sorrendben.
 */
import { makePainter, rgba } from './drawpart';
import { applyRotation } from './viewport';
import { isMcu } from '../engine/defs';
import type { Cut, Layout } from '../engine/board';
import type { Netlist } from '../engine/netlist';
import type { SimResult } from '../engine/simulate';
import type { Design, Wire } from '../engine/types';
import type { PartInstance } from '../core/schema';

/** A kurzor alatti lyuk: egész és törtrész-koordinátákkal. */
export interface HoverHole { r: number; c: number; rf: number; cf: number }

export interface BoardScene {
  ctx: CanvasRenderingContext2D;
  dpr: number;
  /** lyuktávolság és margó (px) */ P: number; M: number;
  /** a nézet forgatása negyedfordulatban (0…3) */ vrot: number;
  /** rézoldali (tükrözött) nézet */ cu: boolean;
  design: Design;
  /** a rajzolt netlista (szimulációban a szimulációs) */ A: Netlist;
  layout: Layout;
  /** fut-e a szimuláció, és a (pillanatnyi) eredménye */ simOn: boolean; sim: SimResult | null;
  colors: { stage: string; accent: string; muted: string; mono: string; monoFont: string };
  hover: HoverHole | null;
  tool: string;
  /** lerakás alatt álló alkatrész előnézete (null: nincs lerakás) */ ghost: { part: PartInstance; fits: boolean } | null;
  xray: boolean;
  pressed(id: string): boolean;
  phase(id: string): number;
  selPart(p: PartInstance): boolean;
  selBridge(i: number): boolean;
  selWire(i: number): boolean;
  /** rövid vezeték nézet; a rámutatott vezeték indexe; a kijelölt kapcsolat */ stub: boolean; hoverWire: number; selLink: string | null;
  /** kapcsolati vonalak nézet: az automatikus hidak halványan */ rats: boolean;
  /** rejtett automatikus elem (pl. kézi → automatikus előnézetnél) */ autoHidden(ids?: readonly string[]): boolean;
  /** csíkvágás eszköznél a kurzor alatti vágás */ cutAt(h: HoverHole): Cut;
  wireStart: readonly [number, number] | null; wireColor: string;
  /** kapcsolat húzása ettől a lábtól; a programban kijelölt láb */ linkStart: string | null; progHi: string | null;
  findPin(ref: string): { r: number; c: number } | null | undefined;
  /** hibás lyukak villantása */ flash: { holes: ReadonlyArray<readonly [number, number]>; until: number } | null;
  /** kijelölő keret */ box: { h0: HoverHole; h1: HoverHole } | null;
  layers: { plugs(alpha: number): void; notes(): void; rats(A: Netlist): void; linkSel(): void };
}

/**
 * A hálózat színe (`A` helyén az átlátszóság): szimulációban a feszültség (kék → piros), egyébként a vezérlőlap
 * lába szerint (GND sötét, 3V3 piros, táp lila, GPIO a száma szerint), lábak nélkül null.
 */
export function netTint(root: number, A: Pick<Netlist, 'netPins' | 'netSecs'>, sim: Pick<SimResult, 'floating' | 'netV'> | null): string | null {
  const qs = A.netPins.get(root) || [];
  if (sim) {
    if (!qs.length) return null;
    if (sim.floating.has(root)) return 'hsla(210,8%,62%,A)';
    const v = sim.netV.get(root) || 0;
    const h = v <= 3.3 ? 215 - 190 * Math.max(0, v) / 3.3 : Math.max(0, 25 - 25 * (v - 3.3) / 1.7);
    return `hsla(${h},78%,50%,A)`;
  }
  if (!qs.length && (A.netSecs.get(root) || 0) < 2) return null;
  const pq = qs.filter(q => isMcu(q.part));
  if (pq.some(q => q.role === 'gnd')) return 'hsla(210,10%,20%,A)';
  if (pq.some(q => q.role === 'p33')) return 'hsla(0,75%,52%,A)';
  if (pq.some(q => q.role === 'pwr')) return 'hsla(290,60%,55%,A)';
  const g = pq.find(q => q.role === 'gpio');
  if (g) return `hsla(${(((g as { num?: number }).num ?? (+String(g.name).replace(/\D/g, '') || 0)) * 67) % 360},65%,48%,A)`;
  return `hsla(${(root * 137.5) % 360},55%,50%,A)`;
}

/** Rövidített vezeték: hosszú vezetéknél csak a két vég csonkja látszik, szakadásjellel. */
const STUB_MIN = 5; // lyuk: ennél rövidebb vezeték mindig teljes
export function stubOf(w: Pick<Wire, 'a' | 'b'>, on: boolean): { k: number; len: number } | null {
  if (!on) return null;
  const dr = w.b[0] - w.a[0], dc = w.b[1] - w.a[1], len = Math.hypot(dr, dc);
  if (len < STUB_MIN) return null;
  return { k: Math.min(1.6, len * 0.25) / len, len };
}

export function drawBoard(S: BoardScene): void {
  const { ctx, P, M, design: D, A, cu: C } = S, B = D.board, hv = S.hover, acc = S.colors.accent;
  const angle = S.vrot * Math.PI / 2;
  const hx = (c: number) => M + (C ? B.cols - 1 - c : c) * P + P / 2, hy = (r: number) => M + r * P + P / 2;
  const inb = (r: number, c: number) => r >= 0 && c >= 0 && r < B.rows && c < B.cols;
  const rr = (x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };
  const line = (x1: number, y1: number, x2: number, y2: number) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const ring = (r: number, c: number, col: string, rad?: number, w?: number) => { ctx.strokeStyle = col; ctx.lineWidth = w || 2.5; ctx.beginPath(); ctx.arc(hx(c), hy(r), rad || P * 0.48, 0, 7); ctx.stroke(); };
  const vlabel = (x: number, y: number, str: string | number, col: string) => { ctx.save(); ctx.translate(x, y); ctx.rotate(-angle); ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(str), 0, 0); ctx.restore(); };

  /* vezetékek: rámutatva (bármelyik végére vagy csonkjára), kijelölve vagy kapcsolatkiemeléskor a teljes vonal */
  const wireFull = (w: Wire, i: number, auto: boolean) => {
    if (hv && ((hv.r === w.a[0] && hv.c === w.a[1]) || (hv.r === w.b[0] && hv.c === w.b[1]))) return true;
    if (!auto && S.selWire(i)) return true;
    if (!auto && hv && S.hoverWire === i) return true;
    return !!(auto && S.selLink && (w.links || []).includes(S.selLink));
  };
  const wireStroke = (x1: number, y1: number, x2: number, y2: number, w: Wire, dash: boolean, full: boolean) => {
    const sb = full ? null : stubOf(w, S.stub);
    const seg = (a: number, b: number, c: number, d: number) => {
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = P * 0.26; line(a, b, c, d);
      if (dash) ctx.setLineDash([P * 0.4, P * 0.2]);
      ctx.strokeStyle = w.color || '#1c7ed6'; ctx.lineWidth = P * 0.17; line(a, b, c, d); ctx.setLineDash([]);
    };
    if (!sb) { seg(x1, y1, x2, y2); return; }
    const dx = (x2 - x1) * sb.k, dy = (y2 - y1) * sb.k, ux = dx / Math.hypot(dx, dy), uy = dy / Math.hypot(dx, dy), nx = -uy * P * 0.32, ny = ux * P * 0.32;
    for (const [x, y, sx, sy] of [[x1, y1, dx, dy], [x2, y2, -dx, -dy]]) {
      seg(x, y, x + sx, y + sy);
      // szakadásjel: két ferde vonás a csonk végén
      const ex = x + sx, ey = y + sy, s = Math.sign(sx * ux + sy * uy) || 1;
      ctx.strokeStyle = w.color || '#1c7ed6'; ctx.lineWidth = Math.max(1.4, P * 0.1);
      for (const o of [0.18, 0.42]) { const cx = ex + ux * s * P * o, cy = ey + uy * s * P * o; line(cx - nx + ux * s * P * 0.12, cy - ny + uy * s * P * 0.12, cx + nx - ux * s * P * 0.12, cy + ny - uy * s * P * 0.12); }
    }
  };
  const drawWires = (alpha: number) => {
    ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round';
    for (const w of D.auto.wires) {
      if (S.autoHidden(w.links)) continue;
      const x1 = hx(w.a[1]), y1 = hy(w.a[0]), x2 = hx(w.b[1]), y2 = hy(w.b[0]);
      wireStroke(x1, y1, x2, y2, w, true, wireFull(w, -1, true));
      for (const [x, y] of [[x1, y1], [x2, y2]]) { ctx.fillStyle = w.color; ctx.beginPath(); ctx.arc(x, y, P * 0.2, 0, 7); ctx.fill(); }
    }
    D.wires.forEach((w, i) => {
      const x1 = hx(w.a[1]), y1 = hy(w.a[0]), x2 = hx(w.b[1]), y2 = hy(w.b[0]), sel = S.selWire(i), full = wireFull(w, i, false);
      if (sel) { ctx.strokeStyle = acc; ctx.lineWidth = P * 0.42; line(x1, y1, x2, y2); }
      else if (full && stubOf(w, S.stub)) { ctx.strokeStyle = 'rgba(168,87,31,.35)'; ctx.lineWidth = P * 0.42; line(x1, y1, x2, y2); }
      wireStroke(x1, y1, x2, y2, w, false, full);
      for (const [x, y] of [[x1, y1], [x2, y2]]) {
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(x, y, P * 0.24, 0, 7); ctx.fill();
        ctx.fillStyle = w.color || '#1c7ed6'; ctx.beginPath(); ctx.arc(x, y, P * 0.17, 0, 7); ctx.fill();
      }
    });
    ctx.restore();
  };

  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  const W = 2 * M + B.cols * P, H = 2 * M + B.rows * P;
  ctx.fillStyle = S.colors.stage; ctx.fillRect(0, 0, Math.max(W, H), Math.max(W, H));
  ctx.save(); applyRotation(ctx, W, H, S.vrot);
  // panel
  ctx.fillStyle = C ? '#d7b68a' : '#ead6a8'; ctx.fillRect(M - 4, M - 4, B.cols * P + 8, B.rows * P + 8);
  // vonalzók
  ctx.font = `${Math.max(8, Math.min(11, P * 0.55))}px ${S.colors.mono}`; ctx.textBaseline = 'middle';
  for (let r = 0; r < B.rows; r++) { if (r % B.sec && !(hv && hv.r === r)) continue; vlabel(M - 14, hy(r), r, hv && hv.r === r ? acc : S.colors.muted); }
  const step = P >= 17 ? 1 : 2;
  for (let c = 0; c < B.cols; c++) { if (c % step && !(hv && hv.c === c)) continue; vlabel(hx(c), M - 12, c, hv && hv.c === c ? acc : S.colors.muted); }
  // szekciók (rézcellák) a hálózat színével
  const hoverNet = hv && inb(hv.r, hv.c) ? A.find(A.sid(hv.r, hv.c)) : -1;
  const tints = new Map<number, string | null>(), simTint = S.simOn ? S.sim : null;
  for (const sg of S.layout.segs) {
    if (sg.drilled) continue;
    const c = sg.c, s = sg.r0, x = hx(c) - P * 0.44, y = hy(s) - P * 0.45, w = P * 0.88, h = (sg.r1 - sg.r0) * P + P * 0.9;
    const root = A.find(A.sid(s, c));
    if (!tints.has(root)) tints.set(root, netTint(root, A, simTint));
    const t = tints.get(root);
    if (C) { ctx.fillStyle = '#c4844f'; rr(x, y, w, h, P * 0.12); ctx.fill(); if (t) { ctx.fillStyle = t.replace('A', S.simOn ? '.55' : '.38'); ctx.fill(); } }
    else {
      if (t) { ctx.fillStyle = t.replace('A', S.simOn ? '.42' : '.24'); rr(x, y, w, h, P * 0.12); ctx.fill(); }
      ctx.strokeStyle = 'rgba(120,88,40,.22)'; ctx.lineWidth = 1; rr(x, y, w, h, P * 0.12); ctx.stroke();
    }
    if (root === hoverNet && S.tool !== 'cut') { ctx.strokeStyle = acc; ctx.lineWidth = 2; rr(x - 1, y - 1, w + 2, h + 2, P * 0.14); ctx.stroke(); }
  }
  // lyukak
  ctx.fillStyle = C ? '#3a2414' : '#4a3c24';
  for (let r = 0; r < B.rows; r++) for (let c = 0; c < B.cols; c++) { ctx.beginPath(); ctx.arc(hx(c), hy(r), P * 0.16, 0, 7); ctx.fill(); }
  // csíkvágások: rés a sorok között, kifúrt lyuk (az automatikusak szaggatottan)
  const autoK = new Set(((D.auto && D.auto.cuts) || []).map(x => x.join(',')));
  for (const [r, c, k] of S.layout.cuts) {
    const au = autoK.has([r, c, k].join(','));
    ctx.save();
    if (k) {
      ctx.fillStyle = C ? '#d7b68a' : '#ead6a8'; ctx.beginPath(); ctx.arc(hx(c), hy(r), P * 0.4, 0, 7); ctx.fill();
      ctx.strokeStyle = C ? '#7a4a22' : '#b0473a'; ctx.lineWidth = 1.6; if (au) ctx.setLineDash([3, 2]); ctx.stroke();
      ctx.fillStyle = C ? '#3a2414' : '#4a3c24'; ctx.beginPath(); ctx.arc(hx(c), hy(r), P * 0.2, 0, 7); ctx.fill();
    } else {
      const y = (hy(r) + hy(r + 1)) / 2, x0 = hx(c) - P * 0.5, x1 = hx(c) + P * 0.5;
      if (C) { ctx.fillStyle = '#d7b68a'; ctx.fillRect(x0, y - P * 0.09, x1 - x0, P * 0.18); }
      ctx.strokeStyle = C ? '#7a4a22' : '#b0473a'; ctx.lineWidth = Math.max(1.5, P * 0.1); if (au) ctx.setLineDash([3, 2]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    }
    ctx.restore();
  }
  if (S.tool === 'cut' && hv && inb(hv.r, hv.c) && !S.simOn) {
    const ct = S.cutAt(hv);
    ctx.save(); ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    if (ct[2]) { ctx.beginPath(); ctx.arc(hx(ct[1]), hy(ct[0]), P * 0.42, 0, 7); ctx.stroke(); }
    else { const y = (hy(ct[0]) + hy(ct[0] + 1)) / 2; ctx.beginPath(); ctx.moveTo(hx(ct[1]) - P * 0.55, y); ctx.lineTo(hx(ct[1]) + P * 0.55, y); ctx.stroke(); }
    ctx.restore();
  }
  // hidak
  D.bridges.forEach((b, i) => {
    const x1 = hx(b[1]), y1 = hy(b[0]), x2 = hx(b[3]), y2 = hy(b[2]), sel = S.selBridge(i);
    ctx.lineCap = 'round';
    if (C) { ctx.strokeStyle = sel ? acc : '#a9aeb4'; ctx.lineWidth = P * 0.58; line(x1, y1, x2, y2); ctx.strokeStyle = '#dde1e5'; ctx.lineWidth = P * 0.2; line(x1, y1, x2, y2); }
    else { ctx.setLineDash([P * 0.18, P * 0.14]); ctx.strokeStyle = sel ? acc : 'rgba(105,112,120,.8)'; ctx.lineWidth = P * 0.13; line(x1, y1, x2, y2); ctx.setLineDash([]); }
  });
  for (const b of D.auto.bridges) {
    if (S.autoHidden(b[4])) continue;
    ctx.save(); if (S.rats) ctx.globalAlpha = 0.3;
    const x1 = hx(b[1]), y1 = hy(b[0]), x2 = hx(b[3]), y2 = hy(b[2]);
    ctx.lineCap = 'round';
    if (C) { ctx.strokeStyle = '#8fa9c2'; ctx.lineWidth = P * 0.58; line(x1, y1, x2, y2); ctx.strokeStyle = '#d7e6f4'; ctx.lineWidth = P * 0.2; line(x1, y1, x2, y2); }
    else { ctx.setLineDash([P * 0.18, P * 0.14]); ctx.strokeStyle = 'rgba(56,120,190,.9)'; ctx.lineWidth = P * 0.15; line(x1, y1, x2, y2); ctx.setLineDash([]); }
    ctx.restore();
  }
  // forrpontok rézoldalon
  if (C) for (const q of A.pins) {
    if (!q.on) continue;
    ctx.fillStyle = '#b8bdc3'; ctx.beginPath(); ctx.arc(hx(q.c), hy(q.r), P * 0.36, 0, 7); ctx.fill();
    ctx.fillStyle = '#e6e9ec'; ctx.beginPath(); ctx.arc(hx(q.c) - P * 0.08, hy(q.r) - P * 0.08, P * 0.12, 0, 7); ctx.fill();
  }
  // vezetékek (alatta a rézoldali nézetben)
  if (C) { drawWires(0.28); S.layers.plugs(0.28); }
  // alkatrészek (ui/drawpart.ts)
  const PNT = makePainter({ ctx, P, M, cols: B.cols, cu: C, angle, xray: S.xray, accent: acc, mono: S.colors.monoFont, design: D, sim: S.simOn ? S.sim : null, pressed: S.pressed, phase: S.phase });
  for (const p of D.parts) PNT.drawPart(p, C ? 0.32 : 1, S.selPart(p));
  if (!C) { drawWires(1); S.layers.plugs(1); }
  S.layers.notes();
  // lerakási előnézet
  if (S.ghost && hv) PNT.drawPart(S.ghost.part, 0.6, false, !S.ghost.fits);
  if (S.tool === 'wire' && S.wireStart && hv) { ctx.setLineDash([5, 4]); ctx.strokeStyle = S.wireColor; ctx.lineWidth = P * 0.18; line(hx(S.wireStart[1]), hy(S.wireStart[0]), hx(hv.c), hy(hv.r)); ctx.setLineDash([]); }
  if (S.tool === 'wire' && S.wireStart) ring(S.wireStart[0], S.wireStart[1], acc);
  S.layers.rats(A);
  S.layers.linkSel();
  if (S.linkStart) {
    const q = S.findPin(S.linkStart);
    if (q) { ring(q.r, q.c, acc, P * 0.55, 3); if (hv) { ctx.setLineDash([4, 4]); ctx.strokeStyle = acc; ctx.lineWidth = 2; line(hx(q.c), hy(q.r), hx(hv.c), hy(hv.r)); ctx.setLineDash([]); } }
  }
  if (hv && inb(hv.r, hv.c) && !S.ghost && S.tool !== 'pan' && S.tool !== 'cut') { ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hx(hv.c), hy(hv.r), P * 0.42, 0, 7); ctx.stroke(); }
  if (S.progHi) { const q = S.findPin(S.progHi); if (q) { ring(q.r, q.c, acc, P * 0.62, 3.5); ring(q.r, q.c, 'rgba(255,255,255,.8)', P * 0.78, 1.5); } } // a programban kijelölt csomópont lába
  if (S.flash && performance.now() < S.flash.until) for (const [r, c] of S.flash.holes) ring(r, c, '#e03131', P * 0.62, 3);
  if (S.box) {
    const a = S.box.h0, b2 = S.box.h1;
    const x1 = hx(Math.min(a.cf, b2.cf)), x2 = hx(Math.max(a.cf, b2.cf)), y1 = hy(Math.min(a.rf, b2.rf)), y2 = hy(Math.max(a.rf, b2.rf));
    ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.fillStyle = rgba(acc, 0.08);
    ctx.beginPath(); ctx.rect(Math.min(x1, x2), y1, Math.abs(x2 - x1), y2 - y1); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  ctx.restore();
}
