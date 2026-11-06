/**
 * A panel rajzának felső rétegei: kábeles dugók (külső alkatrész → csatlakozó), jegyzetek, kapcsolati vonalak
 * (nem bekötött kapcsolatok, vagy mind, ha be van kapcsolva) és a kijelölt kapcsolat kiemelése. A `drawBoard`
 * hívja őket a megfelelő sorrendben, ugyanazzal a jelenettel (`BoardScene`). Kiemelve az app.ts-ből, a kép változatlan.
 */
import { DEFS } from '../engine/defs';
import { xf } from '../engine/geometry';
import { equivPins, findPin, linkGeom, ratTarget } from '../engine/links';
import { plugPairs } from '../engine/plug';
import type { Netlist } from '../engine/netlist';
import type { Hole, Note } from '../engine/types';
import { plugColor } from './drawpart';
import { fmt } from '../i18n/i18n';
import type { BoardScene } from './drawboard';

/** A rétegek rajzolási segédjei (a `drawBoard` adja, a nézethez igazítva). */
export interface Gfx {
  hx(c: number): number; hy(r: number): number;
  line(x1: number, y1: number, x2: number, y2: number): void;
  rr(x: number, y: number, w: number, h: number, r: number): void;
  /** felirat a nézet forgatásától függetlenül vízszintesen, opcionális körvonallal */
  stext(x: number, y: number, str: string, size: number, color: string, halo?: string): void;
}

/** Kábelkötegek: a külső alkatrész lábaitól a csatlakozóig ívelt erek, amelyek a köteg közepén összefutnak. */
export function drawPlugs(S: BoardScene, g: Gfx, alpha: number): void {
  const { ctx, P, design: D } = S, { hx, hy, line, stext } = g;
  ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round';
  for (const p of D.parts) {
    const pr = plugPairs(D, p); if (!pr.length) continue;
    // az erek a külső alkatrész testéből kifelé indulnak, és a csatlakozó lábsorára merőlegesen érkeznek: párhuzamos szalagkábel
    const avg = (a: number[]) => a.reduce((t, x) => t + x, 0) / a.length, nrm = (x: number, y: number): [number, number] => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    const bb = DEFS[p.type].bounds(p), [orr, occ] = xf(p, (bb.r0 + bb.r1) / 2, (bb.c0 + bb.c1) / 2);
    const ax = avg(pr.map(([q]) => hx(q.c))), ay = avg(pr.map(([q]) => hy(q.r))), bx = avg(pr.map(([, h]) => hx(h.c))), by = avg(pr.map(([, h]) => hy(h.r)));
    const [ux, uy] = nrm(ax - hx(occ), ay - hy(orr));
    const h0 = pr[0][1], h1 = pr[pr.length - 1][1];
    let [vx, vy] = pr.length < 2 ? nrm(ax - bx, ay - by) : nrm(hy(h1.r) - hy(h0.r), -(hx(h1.c) - hx(h0.c)));
    const side = vx * (ax - bx) + vy * (ay - by);
    if (side < -P || (Math.abs(side) <= P && ux * vx + uy * vy < 0)) { vx = -vx; vy = -vy; } // a csatlakozó a kábel felé néz (egy vonalban: a kábellel egy irányba)
    const Lk = Math.max(P * 1.6, Math.hypot(bx - ax, by - ay) * 0.35), sel = S.selPart(p) || D.parts.some(h => h.id === p.plug && S.selPart(h));
    const hv = S.hover, short = S.stub && !(hv && pr.some(([q, h]) => (q.r === hv.r && q.c === hv.c) || (h.r === hv.r && h.c === hv.c))); // rámutatva a teljes kábel
    pr.forEach(([q, h], i) => {
      const x1 = hx(q.c), y1 = hy(q.r), x2 = hx(h.c), y2 = hy(h.r), col = plugColor(q, i);
      const curve = () => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.bezierCurveTo(x1 + ux * Lk, y1 + uy * Lk, x2 + vx * Lk, y2 + vy * Lk, x2, y2); ctx.stroke(); };
      // rövid vezeték nézet: a kábelből csak a két vég csonkja látszik szakadásjellel; kijelölve vagy rámutatva a teljes
      const B = (t: number, a: number, b: number, c: number, d: number) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
      const bxt = (t: number) => B(t, x1, x1 + ux * Lk, x2 + vx * Lk, x2), byt = (t: number) => B(t, y1, y1 + uy * Lk, y2 + vy * Lk, y2);
      const part = (t0: number, t1: number) => { ctx.beginPath(); ctx.moveTo(bxt(t0), byt(t0)); for (let k = 1; k <= 12; k++) { const t = t0 + (t1 - t0) * k / 12; ctx.lineTo(bxt(t), byt(t)); } ctx.stroke(); };
      const stub = short && !sel ? Math.min(0.45, (P * 1.8) / (Math.hypot(x2 - x1, y2 - y1) || 1)) : 0;
      const draw3 = (f: () => void) => { if (sel) { ctx.strokeStyle = S.colors.accent; ctx.lineWidth = P * 0.42; f(); } ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = P * 0.26; f(); ctx.strokeStyle = col; ctx.lineWidth = P * 0.17; f(); };
      if (!stub) draw3(curve);
      else {
        draw3(() => part(0, stub)); draw3(() => part(1 - stub, 1));
        for (const [t, s] of [[stub, 1], [1 - stub, -1]]) {
          const dx = bxt(t + 0.01 * s) - bxt(t), dy = byt(t + 0.01 * s) - byt(t), l = Math.hypot(dx, dy) || 1, tx = dx / l, ty = dy / l, nx = -ty * P * 0.3, ny = tx * P * 0.3;
          ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.4, P * 0.1);
          for (const o of [0.2, 0.42]) { const cx = bxt(t) + tx * P * o, cy = byt(t) + ty * P * o; line(cx - nx, cy - ny, cx + nx, cy + ny); }
        }
      }
      ctx.fillStyle = '#1d1d1d'; ctx.fillRect(x2 - P * 0.22, y2 - P * 0.22, P * 0.44, P * 0.44); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x2, y2, P * 0.12, 0, 7); ctx.fill();
    });
    // lábnevek a csatlakozón, a kábellel átellenes oldalon (ahová forrasztasz)
    if (alpha >= 1 && P >= 12) pr.forEach(([q], i) => { const h = pr[i][1]; stext(hx(h.c) - vx * P * 0.85, hy(h.r) - vy * P * 0.85, q.name, Math.max(7, P * 0.4), q.role === 'gnd' ? '#212529' : plugColor(q, i) === '#c92a2a' ? '#c92a2a' : '#5c3d0a', 'rgba(255,252,240,.9)'); });
  }
  ctx.restore();
}

/** A jegyzet sorai tördelve (`# ` kezdetű sor: címsor). */
export function noteLines(ctx: CanvasRenderingContext2D, P: number, font: string, n: Note, maxW: number): Array<{ t: string; head: boolean }> {
  ctx.font = `500 ${Math.max(9, P * 0.62)}px ${font}`; const out: Array<{ t: string; head: boolean }> = [];
  for (const raw of String(n.text).split('\n')) {
    const head = /^#\s+/.test(raw), line = raw.replace(/^#\s+/, ''), words = line.split(/\s+/); let cur = '';
    ctx.font = `${head ? 700 : 500} ${Math.max(9, P * (head ? 0.75 : 0.62))}px ${font}`;
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { out.push({ t: cur, head }); cur = w; } else cur = t; }
    out.push({ t: cur, head });
  }
  return out;
}

/** Jegyzetek: szöveges megjegyzés a vásznon, opcionális szaggatott mutatóval egy alkatrészre (nem vezeték). */
export function drawNotes(S: BoardScene, g: Gfx): void {
  const { ctx, P, design: D } = S, { hx, hy, line, rr } = g, font = S.colors.display;
  if (!(D.notes || []).length) return;
  ctx.save();
  for (const n of D.notes) {
    const x = hx(n.c) - P / 2, y = hy(n.r) - P / 2, w = n.w * P, h = n.h * P, sel = S.selNote === n.id;
    const t = n.target && D.parts.find(p => p.id === n.target);
    if (t) {
      const b = DEFS[t.type].bounds(t), [tr, tc] = xf(t, (b.r0 + b.r1) / 2, (b.c0 + b.c1) / 2), tx = hx(tc), ty = hy(tr);
      const ex = Math.max(x, Math.min(x + w, tx)), ey = Math.max(y, Math.min(y + h, ty));
      ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(73,80,87,.85)'; ctx.lineWidth = 1.6; line(ex, ey, tx, ty); ctx.setLineDash([]);
      const a = Math.atan2(ty - ey, tx - ex), L = 9; ctx.fillStyle = 'rgba(73,80,87,.9)'; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx - L * Math.cos(a - 0.4), ty - L * Math.sin(a - 0.4)); ctx.lineTo(tx - L * Math.cos(a + 0.4), ty - L * Math.sin(a + 0.4)); ctx.closePath(); ctx.fill();
    }
    ctx.shadowColor = 'rgba(0,0,0,.18)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; ctx.fillStyle = n.color; rr(x, y, w, h, 6); ctx.fill(); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = sel ? S.colors.accent : 'rgba(0,0,0,.18)'; ctx.lineWidth = sel ? 2 : 1; rr(x, y, w, h, 6); ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.rect(x + 4, y + 4, w - 8, h - 8); ctx.clip(); ctx.translate(x, y); ctx.fillStyle = '#2b2f33'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    let yy = P * 0.35;
    for (const l of noteLines(ctx, P, font, n, w - P * 0.8)) { ctx.font = `${l.head ? 700 : 500} ${Math.max(9, P * (l.head ? 0.75 : 0.62))}px ${font}`; ctx.fillText(l.t, P * 0.4, yy); yy += Math.max(11, P * (l.head ? 0.95 : 0.8)); }
    ctx.restore();
    if (sel) { ctx.fillStyle = S.colors.accent; ctx.fillRect(x + w - 7, y + h - 7, 7, 7); }
  }
  ctx.restore();
}

/** Kapcsolati vonalak: a nem bekötött kapcsolatok mindig (piros), a bekötöttek csak bekapcsolva (szaggatott). */
export function drawRats(S: BoardScene, g: Gfx, A: Netlist): void {
  const { ctx, P, design: D } = S, { hx, hy, line } = g;
  if (!D.links.length) return;
  ctx.save(); ctx.lineCap = 'round';
  for (const l of D.links) {
    const st = S.linkState.get(l.id); if (!st) continue; if (st.ok && !S.rats) continue;
    let a = null, t = null, bd = 1e9;
    for (const a0 of equivPins(findPin(D, l.a))) { const t0 = ratTarget(D, A, l, st, a0); if (!t0) continue; const d = Math.hypot(t0.r - a0.r, t0.c - a0.c); if (d < bd) { bd = d; a = a0; t = t0; } }
    if (!a || !t) continue;
    const col = !st.ok ? '#ff1744' : l.b === 'GND' ? '#00b8ff' : l.b === 'GPIO' ? '#00e676' : '#ffab00';
    const x1 = hx(a.c), y1 = hy(a.r), x2 = hx(t.c), y2 = hy(t.r);
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(20,20,20,.55)'; ctx.lineWidth = Math.max(4, P * 0.3); line(x1, y1, x2, y2);
    ctx.setLineDash(st.ok ? [P * 0.5, P * 0.3] : [P * 0.35, P * 0.25]); ctx.strokeStyle = col; ctx.lineWidth = Math.max(2.5, P * 0.17); line(x1, y1, x2, y2);
    ctx.setLineDash([]);
    for (const [x, y] of [[x1, y1], [x2, y2]]) { ctx.fillStyle = 'rgba(20,20,20,.6)'; ctx.beginPath(); ctx.arc(x, y, P * 0.3, 0, 7); ctx.fill(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, P * 0.21, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}

/** A kijelölt kapcsolat kiemelése: a saját útvonala narancssárgán, a kezdő- (zöld) és a végpont (lila) felirattal. */
export function drawLinkSel(S: BoardScene, g: Gfx, A: Netlist): void {
  const { ctx, P, design: D } = S, { hx, hy, line, stext } = g;
  if (!S.selLink) return;
  const l = D.links.find(x => x.id === S.selLink); if (!l) return;
  const gm = linkGeom(D, A, l, S.linkState.get(l.id)); if (!gm) return;
  ctx.save(); ctx.lineCap = 'round';
  for (const b of gm.bridges) { ctx.strokeStyle = 'rgba(255,145,0,.55)'; ctx.lineWidth = P * 0.75; line(hx(b[1]), hy(b[0]), hx(b[3]), hy(b[2])); }
  for (const w of gm.wires) { ctx.strokeStyle = 'rgba(255,145,0,.55)'; ctx.lineWidth = P * 0.6; line(hx(w.a[1]), hy(w.a[0]), hx(w.b[1]), hy(w.b[0])); }
  if (!gm.bridges.length && !gm.wires.length && gm.end) { ctx.setLineDash([P * 0.4, P * 0.25]); ctx.strokeStyle = 'rgba(255,145,0,.9)'; ctx.lineWidth = Math.max(2.5, P * 0.16); line(hx(gm.start[1]), hy(gm.start[0]), hx(gm.end[1]), hy(gm.end[0])); ctx.setLineDash([]); }
  const mark = ([r, c]: Hole, col: string, txt: string) => {
    const x = hx(c), y = hy(r);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(x, y, P * 0.7, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(20,20,20,.6)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, P * 0.62, 0, 7); ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.stroke();
    stext(x, y - P * 1.1, txt, Math.max(9, P * 0.55), col, 'rgba(255,252,240,.95)');
  };
  if (gm.end) mark(gm.end, '#c000e8', (S.tr || fmt)('cél'));
  mark(gm.start, '#00a844', (S.tr || fmt)('kezdet'));
  ctx.restore();
}

