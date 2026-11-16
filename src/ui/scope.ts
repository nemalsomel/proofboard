/**
 * Szkóp / logikai analizátor (a Műszerek fül műszere): legfeljebb 4 csatorna, mindegyik egy lyuk feszültsége a GND-hez,
 * valós időben mintavételezve, amíg a szimuláció fut. Csatornánként saját sáv (0 V-tól a 3,3 / 5 V-os skáláig),
 * ablakhossz 0,5–10 s, indítójel az 1. csatorna felfutó / lefutó élére (1,5 V), megállítás, kurzor (idő és értékek).
 * A gyors PWM a szimulációban átlag: a csatornán a beállított frekvencia és kitöltés felirata jelzi.
 * DOM-ot rajzol, de a mintavétel és a rajz a gazdától kapja az adatot (`meters.ts`).
 */
import type { Tr } from '../i18n/i18n';
import type { Meter, ProbeAt } from '../engine/types';
import { icon } from './icons';
import { esc } from './links';

export const SCOPE_COLORS = ['#f59f00', '#4dabf7', '#69db7c', '#e599f7'];
export const SPANS = [500, 1000, 2000, 5000, 10000];
export const MAX_CH = 4;
/** az indítójel küszöbe (V) */
export const TRIG_V = 1.5;
/** a pufferben tartott idő (ms) */
const KEEP = 10500;

/** Egy szkóp mintái (valós idő, ms) és a futás állapota (nem része a tervnek). */
export interface ScopeBuf { t: number[]; v: Array<Array<number | null>>; run: boolean; /** indítójeles kép jobb széle (ms) */ frame: number | null; /** megállításkor az idő */ stopAt: number | null; cursor: number | null }
export const newBuf = (): ScopeBuf => ({ t: [], v: [], run: true, frame: null, stopAt: null, cursor: null });

/** Minta hozzáadása; a régieket eldobja. */
export function pushSample(b: ScopeBuf, t: number, vals: Array<number | null>): void {
  if (!b.run) return;
  b.t.push(t); b.v.push(vals);
  let k = 0; while (k < b.t.length && b.t[k] < t - KEEP) k++;
  if (k) { b.t.splice(0, k); b.v.splice(0, k); }
}

/** A legutóbbi él az 1. csatornán, amely után már `post` ms eltelt (indítójel); null: nincs. */
export function findTrigger(b: Pick<ScopeBuf, 't' | 'v'>, edge: 'rise' | 'fall', now: number, post: number): number | null {
  for (let i = b.t.length - 1; i > 0; i--) {
    if (b.t[i] > now - post) continue;
    const a = b.v[i - 1][0], c = b.v[i][0];
    if (a == null || c == null) continue;
    if (edge === 'rise' ? a < TRIG_V && c >= TRIG_V : a >= TRIG_V && c < TRIG_V) return b.t[i];
  }
  return null;
}

export function scopeHtml(m: Meter, tr: Tr, pwm: (at: ProbeAt) => string): string {
  const ch = m.ch || [], span = m.span || 2000;
  const fmtSpan = (ms: number) => (ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`);
  return `<canvas class="sc-cv" data-scope="${esc(m.id)}" height="150" aria-label="${esc(tr('Szkóp: a csatornák feszültsége az idő függvényében'))}"></canvas>
    <div class="sc-ctl">
      <button class="btn sm" data-act="sc-run" data-m="${esc(m.id)}"></button>
      <label class="small"><span class="muted">${esc(tr('Ablak'))}</span> <select data-sc="span" data-m="${esc(m.id)}">${SPANS.map(s => `<option value="${s}"${s === span ? ' selected' : ''}>${fmtSpan(s)}</option>`).join('')}</select></label>
      <label class="small"><span class="muted">${esc(tr('Indítás'))}</span> <select data-sc="trig" data-m="${esc(m.id)}">${([['off', tr('szabadon fut')], ['rise', tr('1. csatorna ↑')], ['fall', tr('1. csatorna ↓')]] as const).map(([k, l]) => `<option value="${k}"${k === (m.trig || 'off') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    </div>
    <ul class="sc-chs">${ch.map((at, k) => `<li><span class="sc-dot" style="background:${SCOPE_COLORS[k]}"></span><b>${k + 1}</b><code>${at[0]}:${at[1]}</code><span class="small muted">${esc(pwm(at))}</span><span class="sp"></span><button class="btn icon" data-act="sc-move" data-m="${esc(m.id)}" data-k="${k}" title="${esc(tr('Áthelyezés'))}" aria-label="${esc(tr('Áthelyezés'))}">${icon('move')}</button><button class="btn icon" data-act="sc-del" data-m="${esc(m.id)}" data-k="${k}" title="${esc(tr('Csatorna törlése'))}" aria-label="${esc(tr('Csatorna törlése'))}">${icon('trash')}</button></li>`).join('')}</ul>
    ${ch.length < MAX_CH ? `<button class="btn sm" data-act="sc-add" data-m="${esc(m.id)}">${icon('plus')}${esc(tr('Csatorna'))}</button>` : ''}`;
}

/** 2 tizedesre, a −0,00 nélkül */
const fmtV = (v: number) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2);

/** A szkóp képe: sávonként a csatorna lépcsős görbéje, rács, feliratok, kurzor. */
export function drawScope(cv: HTMLCanvasElement, m: Meter, b: ScopeBuf, now: number, tr: Tr): void {
  const dpr = window.devicePixelRatio || 1, W = Math.max(120, cv.clientWidth), H = Math.max(80, cv.clientHeight);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const ctx = cv.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ch = m.ch || [], span = m.span || 2000, n = Math.max(1, ch.length), PADB = 14;
  ctx.fillStyle = '#10201a'; ctx.fillRect(0, 0, W, H);
  // az ablak jobb széle: most, megállítva a megállás ideje, indítójellel az utolsó él + 80 %
  let t1 = b.run ? now : (b.stopAt ?? now), waiting = false;
  if (m.trig && m.trig !== 'off') {
    const tg = findTrigger(b, m.trig, b.run ? now : t1, span * 0.8);
    if (tg != null) b.frame = tg + span * 0.8;
    if (b.frame != null) t1 = b.frame; else waiting = true;
  }
  const t0 = t1 - span, X = (t: number) => ((t - t0) / span) * W, lh = (H - PADB) / n;
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
  for (let i = 1; i < 10; i++) { const x = Math.round((W * i) / 10) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - PADB); ctx.stroke(); }
  if (m.trig && m.trig !== 'off') { ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([3, 3]); const x = Math.round(W * 0.2) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - PADB); ctx.stroke(); ctx.setLineDash([]); }
  ctx.font = '600 10px ui-monospace, monospace'; ctx.textBaseline = 'top';
  const at = (k: number, t: number): number | null => { let v: number | null = null; for (let i = 0; i < b.t.length && b.t[i] <= t; i++) v = b.v[i][k] ?? null; return v; };
  for (let k = 0; k < ch.length; k++) {
    const y0 = k * lh, vis: number[] = [];
    for (let i = 0; i < b.t.length; i++) if (b.t[i] >= t0 && b.t[i] <= t1) { const v = b.v[i][k]; if (v != null) vis.push(v); }
    const vmax = Math.max(3.3, ...vis) > 3.45 ? Math.max(5, Math.ceil(Math.max(...vis))) : 3.3;
    const Y = (v: number) => y0 + 4 + (lh - 8) * (1 - Math.max(0, Math.min(1, v / vmax)));
    if (k) { ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.moveTo(0, Math.round(y0) + 0.5); ctx.lineTo(W, Math.round(y0) + 0.5); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke();
    ctx.strokeStyle = SCOPE_COLORS[k]; ctx.lineWidth = 1.6; ctx.beginPath();
    let pen = false, prev: number | null = null;
    // lépcsős görbe: az ablak előtti utolsó mintától
    let i0 = 0; while (i0 < b.t.length && b.t[i0] < t0) i0++;
    if (i0 > 0) i0--;
    for (let i = i0; i < b.t.length && b.t[i] <= t1; i++) {
      const v = b.v[i][k], x = Math.max(0, X(b.t[i]));
      if (v == null) { pen = false; prev = null; continue; }
      if (!pen) { ctx.moveTo(x, Y(v)); pen = true; } else { ctx.lineTo(x, Y(prev!)); ctx.lineTo(x, Y(v)); }
      prev = v;
    }
    if (pen && prev != null) ctx.lineTo(Math.min(W, X(Math.min(t1, b.run ? now : t1))), Y(prev));
    ctx.stroke();
    const last = at(k, t1);
    ctx.fillStyle = SCOPE_COLORS[k]; ctx.textAlign = 'left'; ctx.fillText(`${k + 1}  ${vmax} V`, 4, y0 + 3);
    ctx.textAlign = 'right'; ctx.fillText(last == null ? '–' : `${fmtV(last)} V`, W - 4, y0 + 3);
  }
  ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.textBaseline = 'bottom';
  const div = span / 10;
  if (b.cursor == null) ctx.fillText(tr('{d}/osztás', { d: div >= 1000 ? `${div / 1000} s` : `${div} ms` }), 4, H - 1);
  if (!ch.length) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tr('Adj hozzá egy csatornát'), W / 2, (H - PADB) / 2); }
  else if (waiting) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tr('Vár az indítójelre…'), W / 2, (H - PADB) / 2); }
  else if (!b.t.length) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(tr('Indítsd el a szimulációt'), W / 2, (H - PADB) / 2); }
  // kurzor: idő az ablak jobb széléhez képest és az értékek
  if (b.cursor != null && ch.length) {
    const x = b.cursor * W, t = t0 + b.cursor * span;
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H - PADB); ctx.stroke();
    const dt = t - t1, vals = ch.map((_, k) => { const v = at(k, t); return v == null ? '–' : fmtV(v); }).join(' · ');
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.fillText(`${dt <= -1000 || dt >= 1000 ? (dt / 1000).toFixed(2) + ' s' : Math.round(dt) + ' ms'}  ${vals} V`, W - 4, H - 1);
  }
}
