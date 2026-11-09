/**
 * Alkatrészek rajza a vásznon (a leírás `graphics` primitívjei, a lábak és a lábfeliratok). A rajzoló a gazdától
 * kapja a vászon kontextusát és a nézet adatait (`PaintView`); a terv és a szimuláció állapotát nem olvassa
 * globálisan. A nézetmódok: tömör (alkatrészoldal), röntgen (csak körvonal és lábak), réz (a rézoldali nézetben
 * halványan, körvonallal).
 */
import { num, tpl } from '../core/expr';
import { pinLabelPositions } from '../core/labels';
import type { PartInstance, Prim } from '../core/schema';
import type { Design, PlacedPin } from '../engine/types';
import { DEFS, isMcu, penv } from '../engine/defs';
import { xf, xv, placedPins } from '../engine/geometry';
import { pluggedInto, plugPairs } from '../engine/plug';
import { gpioLevel, type SimResult } from '../engine/simulate';

/** Lábszerepek színei (a lábak pöttye és a lábnevek). */
export const ROLEC: Record<string, string> = { out: '#e8590c', c: '#868e96', cp: '#e03131', cn: '#1f2328', col: '#5c666e', base: '#2563eb', emit: '#1f2328', vin: '#d6336c', pout: '#e8590c', chg: '#e8590c', sig: '#2563eb', adc: '#0ca678', nc: '#adb5bd', j: '#aeb5bb', s: '#1f2328', g: '#2563eb', d: '#868e96', A: '#2563eb', B: '#d97706', an: '#e03131', ka: '#1f2328', gnd: '#1f2328', p33: '#e03131', pwr: '#be4bdb', gpio: '#2563eb', misc: '#868e96', r: '#868e96', h: '#868e96', bp: '#e03131', bn: '#1f2328' };
/** LED fényereje (0–1) az áramból, 15 mA-nél teljes. */
export const ledLevel = (I: number): number => Math.sqrt(Math.max(0, Math.min(1, I / 0.015)));
export const rgba = (hex: string, a: number | string): string => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
/** Csatlakozóba dugott kábel erei: föld fekete, táp piros, a jelek sorban narancs, sárga, kék, zöld, lila. */
const PLUG_POW = new Set(['p33', 'pwr', 'bp', 'chg', 'pout', 'vin', 'mp', 'vp', 'cp']), PLUG_SIG = ['#e8590c', '#f59f00', '#1c7ed6', '#2f9e44', '#9c36b5'];
export function plugColor(q: { role: string; name: string }, i: number): string {
  return q.role === 'gnd' || /^(gnd|−|-)$/i.test(q.name) ? '#212529' : PLUG_POW.has(q.role) || /^(v\+|vcc|vdd|5v|3v3|\+)$/i.test(q.name) ? '#c92a2a' : PLUG_SIG[i % PLUG_SIG.length];
}
const BANDC = ['#000', '#7b3f00', '#e03131', '#f76707', '#fab005', '#2f9e44', '#1c7ed6', '#7048e8', '#868e96', '#fff'];
/** Ellenállás színkódja (három gyűrű) az értékből. */
export function resBands(o: number): string[] {
  let e = 0, v = o;
  while (v >= 100) { v /= 10; e++; }
  while (v < 10 && e > -2) { v *= 10; e--; }
  v = Math.round(v); if (v >= 100) { v = 10; e++; }
  return [BANDC[Math.floor(v / 10)], BANDC[v % 10], e >= 0 ? BANDC[e] : '#d4af37'];
}
export const fmtOhm = (o: number): string => (o >= 1e6 ? +(o / 1e6).toFixed(2) + 'M' : o >= 1000 ? +(o / 1000).toFixed(2) + 'k' : o + 'Ω');

/** A nézet, amelyben a rajz készül. */
export interface PaintView {
  ctx: CanvasRenderingContext2D;
  /** lyuktávolság és margó pixelben */ P: number; M: number;
  /** a panel oszlopszáma (rézoldali tükrözéshez) */ cols: number;
  /** rézoldali nézet (tükrözve) */ cu: boolean;
  /** a nézet forgatásának szöge (a feliratok vízszintesen maradnak) */ angle: number;
  /** minden alkatrész röntgenben */ xray: boolean;
  accent: string; mono: string;
  design: Design;
  /** fut-e a szimuláció, és az eredménye */ sim: SimResult | null;
  pressed(id: string): boolean;
  /** motor forgási fázisa (radián) */ phase(id: string): number;
}

export function makePainter(V: PaintView) {
  const { ctx, P } = V;
  const hx = (c: number) => V.M + (V.cu ? V.cols - 1 - c : c) * P + P / 2, hy = (r: number) => V.M + r * P + P / 2;
  const L = (p: PartInstance, lr: number, lc: number): [number, number] => { const [r, c] = xf(p, lr, lc); return [hx(c), hy(r)]; };
  const vdir = (p: PartInstance, dr: number, dc: number): [number, number] => { const [r, c] = xv(p, dr, dc); return [V.cu ? -c : c, r]; };
  const line = (x1: number, y1: number, x2: number, y2: number) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const poly = (p: PartInstance, r0: number, r1: number, c0: number, c1: number) => {
    const pts = [L(p, r0, c0), L(p, r0, c1), L(p, r1, c1), L(p, r1, c0)];
    ctx.beginPath(); ctx.moveTo(...pts[0]); for (let i = 1; i < 4; i++) ctx.lineTo(...pts[i]); ctx.closePath();
  };
  /** Felirat az alkatrész lokális pontján; `dir`: lokális irány, amerre a szöveg fut. */
  function text(p: PartInstance, lr: number, lc: number, str: string, size: number, color: string, dir: [number, number] | null, halo: string | null) {
    const [x, y] = L(p, lr, lc); ctx.save(); ctx.translate(x, y); ctx.rotate(-V.angle);
    if (dir) {
      const [dx0, dy0] = vdir(p, dir[0], dir[1]), ca = Math.cos(V.angle), sa = Math.sin(V.angle);
      const dx = dx0 * ca - dy0 * sa, dy = dx0 * sa + dy0 * ca;
      let a = Math.atan2(dy, dx), al: CanvasTextAlign = 'left';
      if (Math.abs(a) > Math.PI / 2 + 0.01) { a += Math.PI; al = 'right'; }
      ctx.rotate(a); ctx.textAlign = al;
    } else ctx.textAlign = 'center';
    ctx.textBaseline = 'middle'; ctx.font = `600 ${size}px ${V.mono}`;
    if (halo) { ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = halo; ctx.strokeText(str, 0, 0); }
    ctx.fillStyle = color; ctx.fillText(str, 0, 0); ctx.restore();
  }
  function stext(x: number, y: number, str: string, size: number, color: string, halo: string | null) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(-V.angle); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 ${size}px ${V.mono}`;
    if (halo) { ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = halo; ctx.strokeText(str, 0, 0); }
    ctx.fillStyle = color; ctx.fillText(str, 0, 0); ctx.restore();
  }
  interface PrimOpts { mode: 'cu' | 'xr' | 'solid'; env: Record<string, unknown>; pressed: boolean; lit: boolean; halo: string | null; alpha: number; pinAt: Record<string, { lr: number; lc: number }> }

  function drawPrim(p: PartInstance, g: Prim, o: PrimOpts) {
    const LY = g.layer || 'body', m = o.mode, S = V.sim;
    if (LY === 'xray' && m !== 'xr') return;
    if ((LY === 'detail' || LY === 'label' || LY === 'xray') && m === 'cu') return;
    const gx = g as Prim & Record<string, any>;
    if (LY === 'detail' && m === 'xr' && !gx.xray) return;
    let st: Record<string, any> = { ...g };
    if (m === 'xr' && gx.xray) { st = { ...st, ...gx.xray }; if (o.pressed && gx.xray.pressed) st = { ...st, ...gx.xray.pressed }; }
    else if (o.pressed && gx.pressed) st = { ...st, ...gx.pressed };
    if (o.lit && gx.lit && m === 'solid') st = { ...st, ...gx.lit };
    const E = o.env, N = (x: unknown) => num(x, E);
    const col = (c: unknown): string | null => (c == null ? null : c === 'accent' ? V.accent : String(c).includes('{') ? tpl(c, E) : String(c));
    const pt = (v: unknown): [number, number] => (Array.isArray(v) ? [N(v[0]), N(v[1])] : o.pinAt[String(v)] ? [o.pinAt[String(v)].lr, o.pinAt[String(v)].lc] : [0, 0]);
    const paint = () => {
      if (LY === 'body') {
        if (m === 'solid') { if (st.fill) { ctx.fillStyle = col(st.fill)!; ctx.fill(); } if (st.stroke) { ctx.strokeStyle = col(st.stroke)!; ctx.lineWidth = st.width || 1.2; ctx.stroke(); } }
        else if (m === 'xr') { ctx.fillStyle = 'rgba(60,60,60,.06)'; ctx.fill(); ctx.setLineDash([P * 0.32, P * 0.2]); ctx.strokeStyle = col(st.stroke || '#333')!; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]); }
        else { ctx.strokeStyle = col(st.stroke || '#333')!; ctx.lineWidth = 2; ctx.stroke(); }
      } else {
        if (st.fill) { ctx.fillStyle = col(st.fill)!; ctx.fill(); }
        if (st.stroke) { if (st.dash) ctx.setLineDash([3, 3]); ctx.strokeStyle = col(st.stroke)!; ctx.lineWidth = st.width || 1.2; ctx.stroke(); ctx.setLineDash([]); }
      }
    };
    const ends = () => {
      const a = pt(st.from), b = pt(st.to), [x1, y1] = L(p, a[0], a[1]), [x2, y2] = L(p, b[0], b[1]);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      return { x1, y1, x2, y2, len, ux: (x2 - x1) / len, uy: (y2 - y1) / len, mx: (x1 + x2) / 2, my: (y1 + y2) / 2, ang: Math.atan2(y2 - y1, x2 - x1) };
    };
    switch (st.shape) {
      case 'dial': { // forgó mutató: szervónál a szög (0° bal, 90° fel, 180° jobb), motornál a forgási fázis
        const [r0, c0] = pt(st.at), R = N(st.rad || 1); let dr = -1, dc = 0;
        if (S) {
          const s = S.servos.find(x => x.p === p);
          if (s) { if (s.angle != null && s.U > 3) { const a = s.angle * Math.PI / 180; dr = -Math.sin(a); dc = -Math.cos(a); } }
          else if (S.steppers.some(x => x.p === p)) { const a = (S.steppers.find(x => x.p === p)!.rotorAngle ?? 0) * Math.PI / 180; dr = -Math.cos(a); dc = Math.sin(a); }
          else if (S.motors.some(x => x.p === p)) { const f = V.phase(p.id); dr = Math.sin(f); dc = Math.cos(f); }
        }
        const [x0, y0] = L(p, r0, c0), [x1, y1] = L(p, r0 + dr * R, c0 + dc * R);
        ctx.lineCap = 'round'; ctx.strokeStyle = col(st.color || '#495057')!; ctx.lineWidth = N(st.width || 0.3) * P; line(x0, y0, x1, y1);
        ctx.fillStyle = col(st.color || '#495057')!; ctx.beginPath(); ctx.arc(x1, y1, N(st.width || 0.3) * P * 0.6, 0, 7); ctx.fill(); break;
      }
      case 'rect': poly(p, N(st.r[0]), N(st.r[1]), N(st.c[0]), N(st.c[1])); paint(); break;
      case 'circle': { const [r, c] = pt(st.at), [x, y] = L(p, r, c); ctx.beginPath(); ctx.arc(x, y, N(st.rad) * P, 0, 7); paint(); break; }
      case 'poly': {
        const ps = (st.pts as unknown[]).map(pt).map(([r, c]) => L(p, r, c));
        ctx.beginPath(); ctx.moveTo(ps[0][0], ps[0][1]); for (const q of ps.slice(1)) ctx.lineTo(q[0], q[1]); ctx.closePath(); paint(); break;
      }
      case 'line': { const e = ends(); ctx.strokeStyle = col(st.stroke || '#8d959c')!; ctx.lineWidth = N(st.width || 0.12) * P; ctx.lineCap = 'round'; line(e.x1, e.y1, e.x2, e.y2); break; }
      case 'link': {
        const e = ends(); ctx.lineCap = 'round';
        ctx.strokeStyle = col(st.edge || '#5f676e')!; ctx.lineWidth = N(st.width || 0.22) * P + 2; line(e.x1, e.y1, e.x2, e.y2);
        ctx.strokeStyle = col(st.stroke || '#b8bec4')!; ctx.lineWidth = N(st.width || 0.22) * P; line(e.x1, e.y1, e.x2, e.y2); break;
      }
      case 'text': {
        const str = tpl(st.text, E), sz = Math.max(st.min || 7, P * N(st.size || 0.42)), c = col(st.color || '#3a2c14')!;
        if (st.between) {
          const [a, b] = (st.between as unknown[]).map(pt).map(([r, cc]) => L(p, r, cc));
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len, k = P * N(st.perp || 0);
          stext((a[0] + b[0]) / 2 + nx * k, (a[1] + b[1]) / 2 + ny * k, str, sz, c, o.halo);
        } else { const [r, cc] = pt(st.at); text(p, r, cc, str, sz, c, null, o.halo); }
        break;
      }
      case 'axial': {
        const e = ends(); ctx.strokeStyle = '#8d959c'; ctx.lineWidth = P * 0.12; line(e.x1, e.y1, e.x2, e.y2);
        const BLw = N(st.len || 2.3);
        if (e.len >= (BLw + 0.3) * P) {
          ctx.save(); ctx.translate(e.mx, e.my); ctx.rotate(e.ang);
          const BL = Math.min(BLw * P, e.len - 0.9 * P), BH = N(st.w || 0.76) * P;
          ctx.beginPath(); ctx.rect(-BL / 2, -BH / 2, BL, BH); paint();
          if (m === 'solid' && st.bands) resBands(N(st.bands)).forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(-BL / 2 + 0.4 * P + i * 0.42 * P, -BH / 2, 0.2 * P, BH); });
          if (st.stripe) {
            const sx = BL * (st.stripe.at - 0.5);
            if (m === 'solid') { ctx.fillStyle = st.stripe.color; ctx.fillRect(sx - 0.1 * P, -BH / 2, 0.2 * P, BH); }
            else { ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.lineWidth = 2; line(sx, -BH / 2, sx, BH / 2); }
          }
          ctx.restore();
        } else { ctx.beginPath(); ctx.arc(e.x1, e.y1, P * 0.5, 0, 7); paint(); }
        break;
      }
      case 'radial': {
        const e = ends(), nx = -e.uy, ny = e.ux, fc = col(st.fill) || '#e03131', R = P * N(st.rad || 0.62);
        if (e.len > 1.3 * P) { ctx.strokeStyle = '#8d959c'; ctx.lineWidth = P * 0.1; line(e.x1, e.y1, e.x2, e.y2); }
        if (st.glow && S) {
          const l = S.leds.find(x => x.p === p);
          if (l && l.I > 2e-4) {
            const k = ledLevel(l.I), RR = P * (0.9 + 2.7 * k), gr = ctx.createRadialGradient(e.mx, e.my, 0, e.mx, e.my, RR);
            gr.addColorStop(0, `rgba(255,255,255,${(0.15 + 0.8 * k * k).toFixed(3)})`); gr.addColorStop(0.18, rgba(fc, (0.55 + 0.4 * k).toFixed(3)));
            gr.addColorStop(0.5, rgba(fc, (0.15 + 0.35 * k).toFixed(3))); gr.addColorStop(1, rgba(fc, 0));
            ctx.save(); ctx.globalAlpha = o.alpha * (0.35 + 0.65 * k); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(e.mx, e.my, RR, 0, 7); ctx.fill(); ctx.restore();
          }
        }
        ctx.beginPath(); ctx.arc(e.mx, e.my, R, 0, 7);
        if (m === 'solid') { ctx.fillStyle = fc; ctx.globalAlpha = o.alpha * 0.85; ctx.fill(); ctx.globalAlpha = o.alpha; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5; ctx.stroke(); }
        else if (m === 'xr') { ctx.fillStyle = fc; ctx.globalAlpha = o.alpha * 0.2; ctx.fill(); ctx.globalAlpha = o.alpha; ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]); }
        else { ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1.5; ctx.stroke(); }
        const fx = e.mx + e.ux * R * 0.65, fy = e.my + e.uy * R * 0.65; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2;
        line(fx + nx * R * 0.9, fy + ny * R * 0.9, fx - nx * R * 0.9, fy - ny * R * 0.9);
        break;
      }
    }
  }

  /** Rögzített alkatrész jele: kis lakat a test sarkánál (a nézet forgatásától függetlenül állva). */
  function lockMark(p: PartInstance, b: { r0: number; c1: number }): void {
    const [x, y] = L(p, b.r0 - 0.15, b.c1 + 0.15), s = Math.max(9, P * 0.75);
    ctx.save(); ctx.globalAlpha = 1; ctx.translate(x, y); ctx.rotate(-V.angle);
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.beginPath(); ctx.arc(0, 0, s * 0.72, 0, 7); ctx.fill();
    ctx.strokeStyle = '#495057'; ctx.fillStyle = '#495057'; ctx.lineWidth = Math.max(1.2, s * 0.13);
    ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.22, Math.PI, 0); ctx.stroke();
    ctx.fillRect(-s * 0.32, -s * 0.12, s * 0.64, s * 0.46);
    ctx.restore();
  }

  /** Egy alkatrész: test, lábak, lábfeliratok; kijelölve vagy rossz helyen (lerakáskor) keret. */
  function drawPart(p: PartInstance, alpha: number, selected: boolean, bad = false): void {
    const CD = DEFS[p.type], def = CD.def, b = CD.bounds(p), C = V.cu && !bad && alpha < 1, XR = !C && (V.xray || !!p.xray), S = V.sim;
    const o: PrimOpts = {
      mode: C ? 'cu' : XR ? 'xr' : 'solid', env: penv(p), pressed: !!(S && V.pressed(p.id)),
      lit: !!(S && S.leds.some(l => l.p === p && l.light && l.I > 2e-4)), halo: XR ? 'rgba(255,252,240,.92)' : null, alpha, pinAt: {},
    };
    for (const q of CD.pins(p)) o.pinAt[q.id] = q;
    ctx.save(); ctx.globalAlpha = alpha;
    for (const g of def.graphics || []) drawPrim(p, g, o);
    const PL = def.pinLabels as (Record<string, any> | undefined);
    const gp: PlacedPin[] = placedPins(p), mid = gp.reduce((t, q) => t + q.lr, 0) / (gp.length || 1);
    const LP = PL && PL.mode === 'name' && PL.side ? pinLabelPositions(gp, PL.side, PL.off ?? 0.75, { r: (b.r0 + b.r1) / 2, c: (b.c0 + b.c1) / 2 }) : null;
    let PC: Record<string, string> | null = null; // csatlakozó: az erek színe
    if (def.socket) { const pl = pluggedInto(V.design, p); if (pl) { PC = {}; plugPairs(V.design, pl).forEach(([q, h], i) => { PC![h.id] = plugColor(q, i); }); } }
    gp.forEach((q, qi) => {
      const x = hx(q.c), y = hy(q.r);
      ctx.fillStyle = (PC && PC[q.id]) || ROLEC[q.role] || '#888'; ctx.beginPath(); ctx.arc(x, y, P * 0.28, 0, 7); ctx.fill();
      ctx.fillStyle = isMcu(p) ? '#d4b25c' : '#e9ecef'; ctx.beginPath(); ctx.arc(x, y, P * 0.12, 0, 7); ctx.fill();
      if (!PL || C || P < (PL.minP || 12) || (PL.named && q.name === q.id) || (PC && PC[q.id])) return; // bedugott csatlakozó lábneveit a kábel rajza írja ki
      if (PL.mode === 'role') text(p, q.lr + (q.lr ? PL.off : -PL.off), q.lc, q.role, Math.max(7, P * 0.45), (PL.colors || {})[q.role] || '#333', null, o.halo);
      else if (PL.mode === 'sign') {
        const plus = (PL.plus || []).includes(q.role);
        text(p, q.lr + PL.off, q.lc, plus ? (PL.plusText || '+') : (PL.minusText || '−'), Math.max(8, P * 0.6), plus ? '#c92a2a' : '#1f2328', null, o.halo);
      } else if (PL.mode === 'name' && PL.inward) {
        const inward = q.lr <= mid ? 1 : -1;
        let colr = XR || !PL.onBody ? (q.role === 'gpio' ? '#1c4fd1' : q.role === 'gnd' ? '#212529' : q.role === 'p33' ? '#c92a2a' : q.role === 'pwr' ? '#9c36b5' : '#5c666e')
          : (q.role === 'gpio' ? '#bfe0ff' : q.role === 'gnd' ? '#9fb3a8' : q.role === 'p33' ? '#ffb3b3' : q.role === 'pwr' ? '#f3c4ff' : '#c8d1cc');
        if (S && q.role === 'gpio') {
          const g = S.gpios.find(x => x.q.part === p && x.q.id === q.id);
          if (g) { const l = gpioLevel(g); colr = XR ? (l === '1' ? '#d9480f' : l === '0' ? '#1864ab' : '#5c666e') : (l === '1' ? '#ffb27a' : l === '0' ? '#8fc2ff' : '#c8d1cc'); }
        }
        text(p, q.lr + inward * 0.5, q.lc, (PL.rename || {})[q.name] || q.name, Math.max(6, P * 0.4), colr, [inward, 0], o.halo);
      } else if (PL.mode === 'name') {
        const colr = XR ? (ROLEC[q.role] || '#333') : (PL.colors || {})[q.role] || '#333';
        if (LP) { const Lp = LP[qi]; text(p, Lp.r, Lp.c, q.name, Math.max(7, P * 0.42), colr, Lp.align === 'center' ? null : Lp.align === 'left' ? [0, 1] : [0, -1], o.halo); }
        else text(p, q.lr + PL.off, q.lc, q.name, Math.max(7, P * 0.42), colr, null, o.halo);
      }
    });
    if (p.fixed && !bad && P >= 8) lockMark(p, b);
    if (selected || bad) {
      poly(p, b.r0 - 0.2, b.r1 + 0.2, b.c0 - 0.2, b.c1 + 0.2); ctx.setLineDash([5, 4]);
      ctx.strokeStyle = bad ? '#e03131' : V.accent; ctx.lineWidth = 2; ctx.globalAlpha = 1; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }
  return { drawPart, text, stext, poly };
}
