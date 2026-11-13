/**
 * Gyártás nézet (a Gyártás elrendezés középső része): Anyaglista | Beültetés | Lapok.
 *  - Anyaglista: táblázat, a panel és a fogyóanyagok (vezeték színenként, hidak, vágások); CSV.
 *  - Beültetés: lépések alacsonytól a magasig, pipálható tételekkel (tervenként megmaradnak), mellette a lépés
 *    oldala (alkatrész- vagy rézoldal) a tételek kiemelésével; rámutatva egy tétel külön is kiemelődik.
 *  - Lapok: az alkatrész- és a rézoldal előnézete, a nyomtatás tartalmának kiválasztása.
 * A tartalom az engine-ből (`manufacture.ts`, `mfgsheet.ts`); a nyomtatás a gazdáé (`print`).
 */
import type { Tr } from '../i18n/i18n';
import { assembly, bom, bomCsv, boardKindName, marks, type AsmStep } from '../engine/manufacture';
import { sheetSvg, type Side } from '../engine/mfgsheet';
import type { Design } from '../engine/types';
import { icon } from './icons';
import { esc } from './links';
import type { PrintOpts } from './mfgprint';

export type MfgTab = 'bom' | 'asm' | 'sheets';
export interface MfgHost {
  design(): Design;
  tr: Tr;
  /** a terv neve a lapokon (pl. a projektjegyzet első sora) */ title(): string;
  print(o: Omit<PrintOpts, 'title' | 'lang'>): void;
  download(name: string, text: string, mime: string): void;
  /** a pipák tárolása tervenként */ load(key: string): string[];
  save(key: string, done: string[]): void;
}
export interface MfgView { el: HTMLElement; render(): void; tab(t?: MfgTab): MfgTab; step(id?: string): string; /** nyomtatás a kiválasztott tartalommal */ print(): void }

export function mountMfgView(host: MfgHost): MfgView {
  const tr = host.tr;
  const el = document.createElement('div');
  el.className = 'mfg';
  let tab: MfgTab = 'asm', step = '', hover = '';
  const pr = { comp: true, cu: true, bom: true, steps: true };
  const doneKey = () => host.design().id || 'local';
  let done = new Set<string>();

  /** fit: a lépés előnézete a nézet magasságához igazodik (nem kell görgetni) */
  function sheet(side: Side, hi: string[] | null, fit = false) {
    const D = host.design(), s = sheetSvg(D, { side, tr, hi: hi && hi.length ? new Set(hi) : null, ruler: false, mk: marks(D) });
    const w = fit ? `min(100%, calc((100vh - 220px) * ${(s.w / s.h).toFixed(4)}))` : '100%';
    return s.svg.replace(/ width="[\d.]+mm" height="[\d.]+mm"/, ` style="width:${w};height:auto"`);
  }

  function bomHtml(): string {
    const D = host.design(), b = bom(D, tr), x = b.extra;
    const rows = b.rows.map(r => `<tr><td class="n">${r.qty}</td><td>${esc(r.labels.join(', '))}</td><td>${esc(r.name)}</td><td>${esc(r.value)}</td><td class="muted">${esc(r.note)}</td></tr>`).join('');
    const wires = x.wires.map(w => `<li><span class="mf-sw" style="background:${esc(w.color || '#1c7ed6')}"></span>${esc(tr('{n} szigetelt vezeték, összesen {mm} mm', { n: w.count, mm: w.mm }))}</li>`).join('');
    return `<div class="mf-scroll"><div class="mf-page">
      <p class="mf-board"><b>${esc(tr('Próbapanel, {k}', { k: boardKindName(D, tr) }))}</b> · ${x.board.cols}×${x.board.rows} ${esc(tr('lyuk'))} · ${x.board.w}×${x.board.h} mm</p>
      ${b.rows.length ? `<table class="tbl mf-tbl"><thead><tr><th>${esc(tr('Db'))}</th><th>${esc(tr('Jelölés'))}</th><th>${esc(tr('Alkatrész'))}</th><th>${esc(tr('Érték'))}</th><th>${esc(tr('Megjegyzés'))}</th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="help">${esc(tr('Még nincs alkatrész a tervben.'))}</p>`}
      <ul class="mf-extra">${wires}${x.bridges ? `<li>${esc(tr('{n} forrasztóhíd ({c} lánc)', { n: x.bridges, c: x.chains }))}</li>` : ''}${x.cuts ? `<li>${esc(tr('{n} csíkvágás', { n: x.cuts }))}</li>` : ''}</ul>
    </div></div>`;
  }

  function asmHtml(steps: AsmStep[]): string {
    if (!steps.find(s => s.id === step)) step = (steps.find(s => s.items.some(i => !done.has(i.key))) || steps[0]).id;
    const cur = steps.find(s => s.id === step)!;
    const total = steps.reduce((a, s) => a + s.items.length, 0), ok = steps.reduce((a, s) => a + s.items.filter(i => done.has(i.key)).length, 0);
    const list = steps.map((s, i) => {
      const n = s.items.filter(it => done.has(it.key)).length, all = n === s.items.length;
      return `<section class="mf-step${s.id === step ? ' on' : ''}${all ? ' done' : ''}" data-step="${esc(s.id)}">
        <button class="mf-sh" data-step="${esc(s.id)}" aria-expanded="${s.id === step}"><span class="mf-num">${all ? icon('check') : i + 1}</span><span class="mf-st">${esc(s.title)}</span><span class="mf-cnt">${n}/${s.items.length}</span></button>
        ${s.id === step ? `<p class="mf-tip">${esc(s.tip)}</p><ul class="mf-items">${s.items.map(it => `<li data-ref="${esc(it.ref)}"><label><input type="checkbox" data-key="${esc(it.key)}"${done.has(it.key) ? ' checked' : ''}>${it.mark ? `<b class="mf-mark">${esc(it.mark)}</b>` : ''}<span>${esc(it.text)}</span></label></li>`).join('')}</ul>` : ''}
      </section>`;
    }).join('');
    const side: Side = cur.side || (cur.id === 'cuts' || cur.id === 'bridges' ? 'cu' : 'comp');
    const hi = hover ? [hover] : cur.side ? cur.items.map(i => i.ref).filter(Boolean) : null;
    return `<div class="mf-asm">
      <div class="mf-steps"><div class="mf-prog"><span>${esc(tr('Kész: {a} / {b}', { a: ok, b: total }))}</span><progress max="${total}" value="${ok}"></progress><button class="btn ghost sm" data-mf="reset"${ok ? '' : ' disabled'}>${esc(tr('Pipák törlése'))}</button></div>${list}</div>
      <div class="mf-prev"><p class="mf-side">${esc(side === 'cu' ? tr('Rézoldal (tükrözve, alulról nézve)') : tr('Alkatrészoldal (felülről nézve)'))}</p><div class="mf-svg">${sheet(side, hi, true)}</div></div>
    </div>`;
  }

  function sheetsHtml(): string {
    const ck = (k: keyof typeof pr, label: string) => `<label class="mf-ck"><input type="checkbox" data-pr="${k}"${pr[k] ? ' checked' : ''}> ${esc(label)}</label>`;
    return `<div class="mf-scroll"><div class="mf-sheets">
      <div class="mf-opts"><span class="small muted">${esc(tr('Nyomtatásra:'))}</span>${ck('comp', tr('Alkatrészoldal 1:1'))}${ck('cu', tr('Rézoldal 1:1'))}${ck('bom', tr('Anyaglista'))}${ck('steps', tr('Beültetési sorrend'))}
        <span class="sp"></span><button class="btn primary" data-mf="print">${icon('print')}${esc(tr('Nyomtatás…'))}</button></div>
      <p class="help">${esc(tr('Nyomtatáskor a méretarány legyen 100 % (ne „Igazítás a laphoz”); a lap alján lévő 50 mm-es vonalzóval ellenőrizheted. A rézoldal tükrözve van, ahogy a panelt megfordítva látod.'))}</p>
      <div class="mf-two"><figure><figcaption>${esc(tr('Alkatrészoldal'))}</figcaption><div class="mf-svg">${sheet('comp', null)}</div></figure><figure><figcaption>${esc(tr('Rézoldal'))}</figcaption><div class="mf-svg">${sheet('cu', null)}</div></figure></div>
    </div></div>`;
  }

  function render() {
    done = new Set(host.load(doneKey()));
    const D = host.design();
    const tabs: Array<[MfgTab, string]> = [['bom', tr('Anyaglista')], ['asm', tr('Beültetés')], ['sheets', tr('Lapok')]];
    const head = `<div class="mf-bar"><div class="grp seg" role="tablist" aria-label="${esc(tr('Gyártás'))}">${tabs.map(([k, l]) => `<button class="btn${k === tab ? ' on' : ''}" role="tab" aria-selected="${k === tab}" data-mtab="${k}">${esc(l)}</button>`).join('')}</div>
      <span class="sp"></span>${tab === 'bom' ? `<button class="btn" data-mf="csv">${icon('download')}${esc(tr('CSV letöltése'))}</button>` : ''}<button class="btn${tab === 'sheets' ? '' : ' primary'}" data-mf="print"${tab === 'sheets' ? ' hidden' : ''}>${icon('print')}${esc(tr('Nyomtatás…'))}</button></div>`;
    let body = '';
    if (!D.parts.length && !D.bridges.length && !D.wires.length) body = `<div class="mf-empty"><p>${esc(tr('Üres a terv: rakj le alkatrészeket a Tervezés elrendezésben, és itt megjelenik az anyaglista, a beültetési sorrend és a nyomtatható lapok.'))}</p></div>`;
    else body = tab === 'bom' ? bomHtml() : tab === 'asm' ? asmHtml(assembly(D, tr)) : sheetsHtml();
    el.innerHTML = head + `<div class="mf-body">${body}</div>`;
  }

  el.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    const tb = t.closest<HTMLElement>('[data-mtab]'); if (tb) { tab = tb.dataset.mtab as MfgTab; render(); return; }
    const sh = t.closest<HTMLElement>('button[data-step]'); if (sh) { step = sh.dataset.step!; hover = ''; render(); return; }
    const b = t.closest<HTMLElement>('[data-mf]'); if (!b) return;
    if (b.dataset.mf === 'print') host.print({ ...pr });
    else if (b.dataset.mf === 'csv') host.download('anyaglista.csv', '﻿' + bomCsv(host.design(), tr), 'text/csv');
    else if (b.dataset.mf === 'reset') { host.save(doneKey(), []); render(); }
  });
  el.addEventListener('change', e => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.key) { const s = new Set(host.load(doneKey())); if (t.checked) s.add(t.dataset.key); else s.delete(t.dataset.key); host.save(doneKey(), [...s]); render(); return; }
    if (t.dataset.pr) { pr[t.dataset.pr as keyof typeof pr] = t.checked; }
  });
  // rámutatva a tétel külön kiemelődik a rajzon
  el.addEventListener('mouseover', e => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('.mf-items li'); const r = li ? li.dataset.ref || '' : '';
    if (r === hover) return; hover = r;
    const prev = el.querySelector<HTMLElement>('.mf-prev .mf-svg'); if (!prev) return;
    const D = host.design(), cur = assembly(D, tr).find(s => s.id === step); if (!cur) return;
    const side: Side = cur.side || 'comp';
    prev.innerHTML = sheet(side, hover ? [hover] : cur.side ? cur.items.map(i => i.ref).filter(Boolean) : null, true);
  });
  return { el, render, print: () => host.print({ ...pr }), tab(t) { if (t) { tab = t; render(); } return tab; }, step(id) { if (id) { step = id; render(); } return step; } };
}
