/**
 * Mérőműszerek (bal sáv, Műszerek fül): multiméterek (feszültség, áram, ellenállás, szakadás) és feszültségszondák.
 * A műszer a fülön vagy lebegő ablakban látszik; az ablak a címsoránál húzható, a vászonterület bal széléhez húzva
 * visszakerül a fülre. Elrejtve az ablak eltűnik, a mérőcsúcsai a panelen maradnak. A csúcsok helye, a mód és a
 * szondák a terv részei (`Design.meters`, `Design.probes`); a leolvasás az engine-ből (`engine/measure.ts`).
 */
import type { Tr } from '../i18n/i18n';
import { fmtReading, probeVoltage, readingHint, readMeter } from '../engine/measure';
import type { Netlist } from '../engine/netlist';
import type { SimResult } from '../engine/simulate';
import type { Design, Meter, MeterMode, ProbeAt } from '../engine/types';
import type { MeterMarks } from './drawboard';
import { icon } from './icons';
import { esc } from './links';

export interface MeterHost {
  design(): Design;
  tr: Tr;
  /** a rajzolt netlista és a futó szimuláció eredménye (null: nem fut) */ live(): { A: Netlist; sim: SimResult | null };
  /** tervmódosítás (undo: visszavonási pont előtte), utána mentés és újrarajzolás */ change(fn: (D: Design) => void, undo?: boolean): void;
  /** mérőpont kijelölése a panelen: kattintás egy lyukra (null: megszakítva) */ pick(msg: string, done: (at: ProbeAt | null) => void): void;
  /** a lebegő ablakok területe (a vászon fölött) */ area: HTMLElement;
  /** a bal sáv Műszerek fülének megnyitása */ showTab(): void;
  /** kisképernyő: nincs lebegő ablak, minden a fülön */ compact(): boolean;
}
export interface MetersView {
  el: HTMLElement;
  /** teljes újraépítés (a terv változásakor) */ render(): void;
  /** csak az értékek (szimuláció közben, minden rajzoláskor) */ update(): void;
  /** rajzoláskor: ha a műszerek vagy a szondák változtak (szerkesztés, visszavonás, betöltés), újraépít, különben csak az értékek */ sync(): void;
  /** a panelen rajzolandó jelek */ marks(): MeterMarks | null;
  addMeter(): string;
  addProbe(): void;
}

const MODES: MeterMode[] = ['V', 'A', 'R', 'C'];
const hole = (at: ProbeAt | null) => (at ? `${at[0]}:${at[1]}` : '');
/** a vászonterület bal szélétől ennyi px-en belül elengedve az ablak a fülre kerül */
const SNAP = 36;

export function mountMeters(host: MeterHost): MetersView {
  const tr = host.tr, el = document.createElement('div');
  el.className = 'mtr';
  const wins = new Map<string, HTMLElement>();
  const lastCont = new Map<string, boolean>();
  let audio: AudioContext | null = null;

  const meters = () => host.design().meters || [];
  const probes = () => host.design().probes || [];
  const floating = (m: Meter) => !!m.win && !m.hidden && !host.compact();
  const modeName = (k: MeterMode) => ({ V: tr('Feszültségmérés'), A: tr('Árammérés'), R: tr('Ellenállásmérés'), C: tr('Szakadásvizsgálat') })[k];
  const modeShort = (k: MeterMode) => ({ V: 'V', A: 'A', R: 'Ω', C: '·))' })[k];

  function card(m: Meter, inWin: boolean): string {
    const black = m.mode !== 'A';
    return `<div class="mtr-card" data-meter="${esc(m.id)}">
      <div class="mtr-head"${inWin ? ' data-drag' : ''}><b class="mtr-name">${esc(m.name)}</b><span class="mtr-mode small muted">${esc(modeName(m.mode))}</span><span class="sp"></span>
        <button class="btn icon" data-act="${inWin ? 'dock' : 'float'}" data-m="${esc(m.id)}" title="${esc(inWin ? tr('Vissza a Műszerek fülre') : tr('Lebegő ablakba'))}" aria-label="${esc(inWin ? tr('Vissza a Műszerek fülre') : tr('Lebegő ablakba'))}"${host.compact() ? ' hidden' : ''}>${icon(inWin ? 'dock' : 'popout')}</button>
        <button class="btn icon" data-act="hide" data-m="${esc(m.id)}" title="${esc(tr('Elrejtés (a mérőcsúcsok a panelen maradnak)'))}" aria-label="${esc(tr('Elrejtés'))}">${icon('eyeOff')}</button>
        <button class="btn icon" data-act="del" data-m="${esc(m.id)}" title="${esc(tr('Műszer törlése'))}" aria-label="${esc(tr('Műszer törlése'))}">${icon('trash')}</button></div>
      <div class="mtr-disp" aria-live="polite"><span class="mtr-val">– – –</span></div>
      <p class="mtr-hint small muted"></p>
      <div class="grp seg mtr-modes" role="radiogroup" aria-label="${esc(tr('Mérés módja'))}">${MODES.map(k => `<button class="btn${k === m.mode ? ' on' : ''}" role="radio" aria-checked="${k === m.mode}" data-act="mode" data-m="${esc(m.id)}" data-v="${k}" title="${esc(modeName(k))}">${modeShort(k)}</button>`).join('')}</div>
      <div class="mtr-tips">
        <div class="mtr-tip"><span class="mtr-dot red"></span><span>${esc(m.mode === 'A' ? tr('Láb') : tr('Piros'))}</span><code>${esc(hole(m.red) || '—')}</code><span class="sp"></span><button class="btn sm" data-act="pick-red" data-m="${esc(m.id)}">${esc(m.red ? tr('Áthelyez') : tr('Letesz'))}</button></div>
        ${black ? `<div class="mtr-tip"><span class="mtr-dot black"></span><span>${esc(tr('Fekete'))}</span><code>${esc(m.black ? hole(m.black) : 'GND')}</code><span class="sp"></span>${m.black ? `<button class="btn sm ghost" data-act="gnd" data-m="${esc(m.id)}" title="${esc(tr('A fekete csúcs a GND-re'))}">GND</button>` : ''}<button class="btn sm" data-act="pick-black" data-m="${esc(m.id)}">${esc(m.black ? tr('Áthelyez') : tr('Letesz'))}</button></div>` : ''}
      </div>
    </div>`;
  }

  function render() {
    const ms = meters(), ps = probes(), docked = ms.filter(m => !m.hidden && !floating(m)), away = ms.filter(m => m.hidden || floating(m));
    el.innerHTML = `<div class="mtr-bar"><button class="btn" data-act="add-meter">${icon('plus')}${esc(tr('Multiméter'))}</button><button class="btn" data-act="add-probe">${icon('plus')}${esc(tr('Szonda'))}</button></div>
      ${ms.length || ps.length ? '' : `<p class="help">${esc(tr('Adj hozzá egy multimétert, és tedd le a mérőcsúcsait a panel lyukaira; vagy tegyél szondákat, amelyek a szimuláció alatt a feszültséget mutatják a panelen.'))}</p>`}
      ${docked.map(m => card(m, false)).join('')}
      ${away.length ? `<ul class="mtr-away">${away.map(m => `<li><b>${esc(m.name)}</b><span class="small muted">${esc(m.hidden ? tr('elrejtve') : tr('lebegő ablakban'))} · ${esc(modeName(m.mode))}</span><span class="sp"></span>${m.hidden ? `<button class="btn sm" data-act="show" data-m="${esc(m.id)}">${icon('eye')}${esc(tr('Megjelenítés'))}</button>` : `<button class="btn sm ghost" data-act="dock" data-m="${esc(m.id)}">${esc(tr('Vissza ide'))}</button>`}</li>`).join('')}</ul>` : ''}
      ${ps.length ? `<p class="h">${esc(tr('Szondák'))}</p><ul class="mtr-probes">${ps.map((p, i) => `<li data-probe="${esc(p.id)}"><span class="mtr-pdot"></span><b>S${i + 1}</b><code>${esc(hole(p.at))}</code><span class="mtr-pv"></span><span class="sp"></span><button class="btn icon" data-act="probe-move" data-p="${esc(p.id)}" title="${esc(tr('Áthelyezés'))}" aria-label="${esc(tr('Áthelyezés'))}">${icon('move')}</button><button class="btn icon" data-act="probe-del" data-p="${esc(p.id)}" title="${esc(tr('Szonda törlése'))}" aria-label="${esc(tr('Szonda törlése'))}">${icon('trash')}</button></li>`).join('')}</ul>` : ''}
      <p class="help mtr-legend">${esc(tr('Szimuláció közben a rézcsíkok színe a feszültségüket mutatja:'))} <span class="mtr-scale" aria-hidden="true"></span> <span class="small">0 V → 3,3 V → 5 V</span></p>`;
    // lebegő ablakok
    const want = new Set(ms.filter(floating).map(m => m.id));
    for (const [id, w] of wins) if (!want.has(id)) { w.remove(); wins.delete(id); }
    for (const m of ms) if (floating(m)) {
      let w = wins.get(m.id);
      if (!w) { w = document.createElement('div'); w.className = 'mtr-win'; w.addEventListener('click', onClick); w.addEventListener('pointerdown', onDrag); host.area.appendChild(w); wins.set(m.id, w); }
      w.innerHTML = card(m, true);
      place(w, m.win!);
    }
    update();
  }

  function place(w: HTMLElement, p: { x: number; y: number }) {
    const a = host.area, x = Math.max(0, Math.min(p.x, Math.max(0, a.clientWidth - 120))), y = Math.max(0, Math.min(p.y, Math.max(0, a.clientHeight - 40)));
    w.style.left = x + 'px'; w.style.top = y + 'px';
  }

  function update() {
    const D = host.design(), { A, sim } = host.live();
    const cards = [...el.querySelectorAll<HTMLElement>('[data-meter]'), ...[...wins.values()].map(w => w.querySelector<HTMLElement>('[data-meter]')).filter((x): x is HTMLElement => !!x)];
    for (const c of cards) {
      const m = meters().find(x => x.id === c.dataset.meter); if (!m) continue;
      const r = readMeter(D, A, sim, m), txt = fmtReading(r, tr), hint = readingHint(r, tr);
      const v = c.querySelector<HTMLElement>('.mtr-val')!, h = c.querySelector<HTMLElement>('.mtr-hint')!;
      if (v.textContent !== txt) v.textContent = txt;
      if (h.textContent !== hint) h.textContent = hint;
      c.classList.toggle('cont', m.mode === 'C' && !!r.cont);
      c.classList.toggle('neg', r.value != null && r.value < 0);
      if (m.mode === 'C') { const was = lastCont.get(m.id); if (r.cont && was === false) beep(); lastCont.set(m.id, !!r.cont); }
      else lastCont.delete(m.id);
    }
    probes().forEach((p, i) => {
      const li = el.querySelector<HTMLElement>(`[data-probe="${CSS.escape(p.id)}"] .mtr-pv`); if (!li) return;
      const v = probeVoltage(D, A, sim, p.at), t = v == null ? (sim ? tr('lebeg') : '') : `${v.toFixed(2)} V`;
      if (li.textContent !== t) li.textContent = t;
      void i;
    });
  }

  function beep() {
    try {
      audio = audio || new AudioContext();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = 2400; g.gain.value = 0.05; o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.12);
    } catch { /* nincs hang */ }
  }

  function marks(): MeterMarks | null {
    const D = host.design(), ms = meters(), ps = probes();
    if (!ms.length && !ps.length) return null;
    const { A, sim } = host.live(), out: MeterMarks = { probes: [], tips: [] };
    ps.forEach((p, i) => { const v = probeVoltage(D, A, sim, p.at); out.probes.push({ at: p.at, label: 'S' + (i + 1), value: v == null ? '' : v.toFixed(2) + ' V' }); });
    for (const m of ms) {
      if (m.red) out.tips.push({ at: m.red, color: '#e03131', label: m.name + (m.mode === 'A' ? '' : '+'), dim: !!m.hidden });
      if (m.black && m.mode !== 'A') out.tips.push({ at: m.black, color: '#212529', label: m.name + '−', dim: !!m.hidden });
    }
    return out;
  }

  const mod = (id: string, fn: (m: Meter) => void, undo = true) => host.change(D => { const m = (D.meters || []).find(x => x.id === id); if (m) fn(m); }, undo);

  function addMeter(): string {
    const D = host.design(), used = new Set((D.meters || []).map(m => m.name));
    let n = 1; while (used.has('M' + n)) n++;
    const id = 'm' + Date.now().toString(36) + n;
    host.change(d => { (d.meters ||= []).push({ id, name: 'M' + n, mode: 'V', red: null, black: null }); });
    return id;
  }
  function addProbe() {
    host.pick(tr('Kattints egy lyukra: új szonda'), at => {
      if (!at) return;
      host.change(D => { (D.probes ||= []).push({ id: 'pr' + Date.now().toString(36), at }); });
    });
  }

  function onClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (!b) return;
    const act = b.dataset.act!, id = b.dataset.m || '', pid = b.dataset.p || '';
    const m = meters().find(x => x.id === id);
    switch (act) {
      case 'add-meter': addMeter(); break;
      case 'add-probe': addProbe(); break;
      case 'mode': mod(id, x => { x.mode = b.dataset.v as MeterMode; }); break;
      case 'pick-red': case 'pick-black': {
        const red = act === 'pick-red';
        host.pick(tr('Kattints egy lyukra: {m} {c} csúcsa', { m: m ? m.name : '', c: red ? tr('piros') : tr('fekete') }), at => { if (at) mod(id, x => { if (red) x.red = at; else x.black = at; }); });
        break;
      }
      case 'gnd': mod(id, x => { x.black = null; }); break;
      case 'float': {
        const r = (b.closest('.mtr-card') as HTMLElement | null)?.getBoundingClientRect(), a = host.area.getBoundingClientRect();
        mod(id, x => { x.win = { x: r ? Math.max(8, Math.round(r.right - a.left + 12)) : 16, y: r ? Math.max(8, Math.round(r.top - a.top)) : 16 }; }, false);
        break;
      }
      case 'dock': mod(id, x => { delete x.win; }, false); host.showTab(); break;
      case 'hide': mod(id, x => { x.hidden = true; }, false); break;
      case 'show': mod(id, x => { delete x.hidden; }, false); break;
      case 'del': host.change(D => { D.meters = (D.meters || []).filter(x => x.id !== id); if (!D.meters.length) delete D.meters; }); break;
      case 'probe-del': host.change(D => { D.probes = (D.probes || []).filter(x => x.id !== pid); if (!D.probes.length) delete D.probes; }); break;
      case 'probe-move': host.pick(tr('Kattints egy lyukra: a szonda új helye'), at => { if (at) host.change(D => { const p = (D.probes || []).find(x => x.id === pid); if (p) p.at = at; }); }); break;
    }
  }
  el.addEventListener('click', onClick);

  /** lebegő ablak húzása a címsoránál; a bal szélhez engedve a fülre kerül */
  function onDrag(e: PointerEvent) {
    const hd = (e.target as HTMLElement).closest<HTMLElement>('[data-drag]');
    if (!hd || (e.target as HTMLElement).closest('button') || e.button !== 0) return;
    const w = hd.closest<HTMLElement>('.mtr-win')!, id = (hd.closest('[data-meter]') as HTMLElement).dataset.meter!;
    e.preventDefault(); hd.setPointerCapture(e.pointerId); w.classList.add('dragging');
    const x0 = e.clientX, y0 = e.clientY, l0 = w.offsetLeft, t0 = w.offsetTop, a = host.area.getBoundingClientRect();
    const near = (ev: PointerEvent) => ev.clientX - a.left < SNAP;
    const mv = (ev: PointerEvent) => { place(w, { x: l0 + ev.clientX - x0, y: t0 + ev.clientY - y0 }); w.classList.toggle('snap', near(ev)); };
    const up = (ev: PointerEvent) => {
      hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up);
      w.classList.remove('dragging', 'snap');
      if (near(ev)) { mod(id, x => { delete x.win; }, false); host.showTab(); }
      else mod(id, x => { x.win = { x: w.offsetLeft, y: w.offsetTop }; }, false);
    };
    hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  }

  let sig = '';
  function sync() {
    const D = host.design(), k = JSON.stringify([D.meters || [], D.probes || [], host.compact()]);
    if (k !== sig) { sig = k; render(); } else update();
  }
  return { el, render, update, sync, marks, addMeter, addProbe };
}
