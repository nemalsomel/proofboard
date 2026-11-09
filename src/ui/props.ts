/**
 * Tulajdonságpanel: a kijelölés szerinti tartalom (alkatrész: név, műveletek, paraméterek, lábak és bekötés, csere,
 * csatlakozó; csoport; vezeték; jegyzet; csíkvágás; híd; kapcsolat kezdete; különben az eszköz súgója).
 * A HTML-t építő részek (`paramsHtml`, `pinsHtml`) tiszták, a `createPropsPanel` a gazda (`app.ts`) műveleteivel köt be.
 * Kiemelve az app.ts-ből, a viselkedés változatlan.
 */
import { N_, type Tr } from '../i18n/i18n';
import { fmtSI, parseSI, stepE12, tpl } from '../core/expr';
import type { Env, ParamDef, PartDef, PartInstance } from '../core/schema';
import { sameCut, type CutHit } from '../engine/cuts';
import { DEFS, isMcu, isOff, penv } from '../engine/defs';
import { findPin, pinRows, ROLE_HU, setPinLink, type LinkState, type PinRow } from '../engine/links';
import { pinLabel, type Netlist } from '../engine/netlist';
import { plugOf, pluggedInto, socketProps } from '../engine/plug';
import { NOTE_COL } from '../engine/design';
import type { Design } from '../engine/types';
import { icon, type IconName } from './icons';
import { esc, targetSelectHtml } from './links';
import type { Group } from './hit';

/** Az alkatrész paramétereinek beviteli mezői (és a leírás súgója). */
export function paramsHtml(def: PartDef, E: Env, tr: Tr): string {
  let h = def.meta && typeof def.meta.help === 'string' ? `<p class="help" style="margin:4px 0 8px">${esc(tr(def.meta.help))}</p>` : '';
  for (const pr of (def.params || []) as ParamDef[]) {
    const k = pr.key, id = 'pp_' + k, opts = pr.options || [];
    if (pr.type === 'span') h += `<div class="row"><label>${esc(tr(pr.label))}</label><input type="number" id="pp_dr" data-pk="dr" min="-12" max="12" value="${E.dr}" style="width:58px" aria-label="${tr('sor eltolás')}"><span class="muted small">${tr('sor')}</span><input type="number" id="pp_dc" data-pk="dc" min="-12" max="12" value="${E.dc}" style="width:58px" aria-label="${tr('oszlop eltolás')}"><span class="muted small">${tr('oszlop')}</span></div>`;
    else if (pr.type === 'select') h += `<div class="row"><label for="${id}">${esc(tr(pr.label))}</label><select id="${id}" data-pk="${k}" style="flex:1;min-width:0">${opts.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(E[k]) ? 'selected' : ''}>${esc(tr(o.label))}</option>`).join('')}</select></div>`;
    else if (pr.type === 'color') h += `<div class="row"><label>${esc(tr(pr.label))}</label><div class="swatches" role="group" aria-label="${esc(tr(pr.label))}">${opts.map(o => `<button class="sw ${String(o.v) === String(E[k]) ? 'on' : ''}" data-pk="${k}" data-pv="${esc(o.v)}" title="${esc(tr(o.label))}" aria-label="${esc(tr(o.label))}" style="background:${o.hex}"></button>`).join('')}</div></div>`;
    else if (pr.type === 'names') h += `<div class="row"><label for="${id}">${esc(tr(pr.label))}</label><input type="text" id="${id}" data-pk="${k}" value="${esc(E[k] || '')}" placeholder="${tr('pl. GND,VCC,SDA,SCL')}" autocomplete="off" style="flex:1;min-width:0"></div>`;
    else if (pr.type === 'value') h += `<div class="row"><label for="${id}">${esc(tr(pr.label))}</label><input type="text" id="${id}" data-pk="${k}" value="${fmtSI(E[k] as number)}" inputmode="decimal" autocomplete="off" style="width:96px;flex:0 1 auto" title="${tr('Pl. 4,7k · 4k7 · 100n · 2.1 — ↑/↓: {x}', { x: pr.series === 'E12' ? tr('E12-sor') : tr('léptetés') })}"><span class="muted small">${esc(tr(pr.unit || ''))}</span></div>`;
    else h += `<div class="row"><label for="${id}">${esc(tr(pr.label))}</label><input type="number" id="${id}" data-pk="${k}" value="${E[k]}" ${pr.min != null ? `min="${pr.min}"` : ''} ${pr.max != null ? `max="${pr.max}"` : ''} step="${pr.step || (pr.type === 'int' ? 1 : 'any')}" style="width:80px"><span class="muted small">${esc(tr(pr.unit || ''))}</span></div>`;
    if (pr.help) h += `<p class="help">${esc(tpl(tr(pr.help), E))}</p>`;
  }
  return h;
}

/** Lábak és bekötés: lábcsoportonként a szerep, a mostani bekötés (háló vagy kapcsolat) és a kapcsolat célja. */
export function pinsHtml(rows: PinRow[], open: boolean, state: Map<string, LinkState>, select: (r: PinRow) => string, tr: Tr): string {
  const nf = rows.filter(r => r.floating && r.on).length;
  return `<details class="pr-sec" id="pinsSec" ${open ? 'open' : ''}><summary>${tr('Lábak és bekötés')} <span class="muted small">${tr('{n} láb', { n: rows.length })}${nf ? ` · <span class="c-warn">${tr('{n} lebeg', { n: nf })}</span>` : ''}</span></summary><div class="pins">${rows.map(r => {
    const st = !r.on ? `<span class="muted">${tr('a panelon kívül')}</span>`
      : r.link ? `<span class="muted">${tr('kapcsolat')}${(state.get(r.link.id) || { ok: false }).ok ? ', ' + tr('bekötve') : `, <span class="c-err">${tr('nincs bekötve')}</span>`}</span>`
        : r.net.length ? `<span class="muted" title="${esc(r.net.join(', '))}">${tr('háló')}: ${esc(r.net.slice(0, 3).join(', '))}${r.net.length > 3 ? ` +${r.net.length - 3}` : ''}</span>`
          : `<span class="c-warn">${tr('lebeg (sehova sincs kötve)')}</span>`;
    return `<div class="pin${r.floating && r.on ? ' float' : ''}"><div class="pin-n"><b>${esc(tr(r.name))}</b>${ROLE_HU[r.role] ? `<span class="muted small"> ${esc(tr(ROLE_HU[r.role]))}</span>` : ''}</div>${select(r)}<div class="pin-s small">${st}</div></div>`;
  }).join('')}</div></details>`;
}

/** Tulajdonság-művelet gomb: ikon + név, a gyorsbillentyű súgóban és Ctrl-címkén. */
export const actBtn = (tr: Tr, id: string, ic: IconName, l: string, k: string, t = '', cls = '') =>
  `<button class="btn${cls}" id="${id}" data-kbd="${k}" title="${t ? esc(tr(t)) + ' ' : ''}(${k})">${icon(ic)}${esc(tr(l))}</button>`;

/** Kijelölés a tulajdonságpanel szempontjából. */
export type PropsSel = Group | { kind: 'wire'; i: number } | { kind: 'bridge'; i: number } | { kind: 'note'; id: string } | { kind: 'cut'; hit: CutHit };

export interface PropsState {
  sel: PropsSel | null; tool: string; placing: string | null; ghost: { from?: string };
  linkStart: string | null; linkState: Map<string, LinkState>; moved?: Set<string> | null;
}

export interface PropsHost {
  readonly ui: PropsState;
  readonly el: HTMLElement;
  D(): Design; A(): Netlist; tr: Tr;
  /** a kijelölt egyetlen alkatrész */ selPart(): PartInstance | null;
  wireColors: ReadonlyArray<readonly [string, string]>;
  pinsOpen(): boolean; setPinsOpen(open: boolean): void;
  pushUndo(): void; dropUndo(): void; commit(noRoute?: boolean): void; save(): void; draw(): void; renderLeft(): void;
  flashMsg(m: string): void;
  partFits(p: PartInstance): boolean;
  rotate(): void; mirror(): void; delSel(): void; duplicate(p: PartInstance): void;
  /** saját alkatrész szerkesztése / beépített másolata saját alkatrészként */ editPart(type: string): void; copyPart(type: string): void;
  isBuiltin(type: string): boolean;
  manualToAuto(ids: string | Set<string>): number;
  swapMcu(pid: string, type: string): { msg: string } | null;
  attachPlug(p: PartInstance): PartInstance | null;
  addLink(a: string, b: string): void;
}

export interface PropsPanel { render(): void }

export function createPropsPanel(H: PropsHost): PropsPanel {
  const { ui, tr } = H;
  const ACT = (id: string, ic: IconName, l: string, k: string, t = '', cls = '') => actBtn(tr, id, ic, l, k, t, cls);
  const q = <T extends HTMLElement = HTMLElement>(s: string) => H.el.querySelector<T>(s);
  const qq = <T extends HTMLElement = HTMLElement>(s: string) => q<T>(s)!;

  function bindParams(p: PartInstance) {
    const def = DEFS[p.type].def, params = (def.params || []) as ParamDef[];
    const find = (k: string) => params.find(x => x.key === k) || ((k === 'dr' || k === 'dc') ? params.find(x => x.type === 'span') : undefined);
    const set = (k: string, raw: string) => {
      const pr = find(k); if (!pr) return; let v: unknown;
      if (pr.type === 'span') v = Math.round(+raw) || 0;
      else if (pr.type === 'value') { v = parseSI(raw); if (!isFinite(v as number)) { H.flashMsg(tr('Nem értelmezhető érték (pl. 4,7k · 4k7 · 100n)')); H.renderLeft(); return; } }
      else if (pr.type === 'number' || pr.type === 'int') { v = +raw; if (!isFinite(v as number)) { H.renderLeft(); return; } if (pr.type === 'int') v = Math.round(v as number); }
      else if (pr.type === 'names') v = String(raw).split(',').map(x => x.trim()).join(',').replace(/,+$/, '');
      else { const o = (pr.options || []).find(o => String(o.v) === String(raw)); v = o ? o.v : raw; }
      if (typeof v === 'number' && pr.type !== 'span') { if (pr.min != null) v = Math.max(pr.min, v as number); if (pr.max != null) v = Math.min(pr.max, v as number); }
      const t = { ...p, props: { ...p.props, [k]: v } }, geo = pr.geo || pr.type === 'span';
      if (pr.type === 'span') { const dr = +(t.props.dr ?? pr.default[0]) || 0, dc = +(t.props.dc ?? pr.default[1]) || 0; if (!dr && !dc) { H.flashMsg(tr('A két láb nem lehet ugyanabban a lyukban')); H.renderLeft(); return; } }
      if (geo && !H.partFits(t)) { H.flashMsg(tr('Ennyire nem lóghat ki (legalább egy láb a panelon, legfeljebb 8 lyuknyi túllógás)')); H.renderLeft(); return; }
      if (p.props[k] === v) { H.renderLeft(); return; }
      H.pushUndo(); p.props[k] = v; if (geo) ui.moved = new Set([p.id]); H.commit(!geo);
    };
    H.el.querySelectorAll<HTMLInputElement>('[data-pk]').forEach(el => {
      if (el.tagName === 'BUTTON') { el.onclick = () => set(el.dataset.pk!, el.dataset.pv!); return; }
      el.addEventListener('change', () => set(el.dataset.pk!, el.value));
      const pr = find(el.dataset.pk!);
      if (pr && pr.type === 'value') el.addEventListener('keydown', ev => {
        if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return; ev.preventDefault();
        const dir = ev.key === 'ArrowUp' ? 1 : -1, cur = parseSI(el.value), base = isFinite(cur) ? cur : pr.default;
        const nv = pr.series === 'E12' ? stepE12(base, dir) : +(base + dir * (pr.step || Math.max(1e-6, Math.abs(base) * 0.05))).toPrecision(4);
        el.value = fmtSI(nv); set(el.dataset.pk!, el.value);
      });
    });
  }

  function bindPins() {
    const D = H.D(), d = q<HTMLDetailsElement>('#pinsSec'); if (d) d.addEventListener('toggle', () => H.setPinsOpen(d.open));
    H.el.querySelectorAll<HTMLSelectElement>('[data-pinlink]').forEach(s => s.addEventListener('change', () => {
      H.pushUndo(); if (!setPinLink(D, s.dataset.pinlink!, s.value, () => 'l' + (D.seq++))) { H.dropUndo(); H.renderLeft(); return; } H.commit();
    }));
  }

  function partProps(pr: HTMLElement, p: PartInstance) {
    const D = H.D(), A = H.A(), d = DEFS[p.type];
    const pins = pinsHtml(pinRows(D, A, p), H.pinsOpen(), ui.linkState, r => targetSelectHtml(D, A, 'data-pinlink', r.ref, r.target || '', p.id, tr), tr);
    pr.innerHTML = `<div class="row"><label for="pLabel">${tr('Név')}</label><input type="text" id="pLabel" value="${esc(p.label)}"></div>
      <div class="small muted">${esc(tr(d.name))} · ${tr('origó')} <span class="mono">${p.r}:${p.c}</span> · ${p.rot * 90}°${p.mir ? ' · ' + tr('tükrözve') : ''}</div>
      <div class="pr-acts">${ACT('pRot', 'rotate', N_('Forgatás'), 'R')}${ACT('pMir', 'mirror', N_('Tükrözés'), 'M')}${ACT('pDup', 'copy', N_('Duplikálás'), 'D', N_('Új példány ugyanezekkel a beállításokkal'))}${ACT('pDel', 'trash', N_('Törlés'), 'Del', '', ' danger')}</div>
      <label class="check small"><input type="checkbox" id="pXray" ${p.xray ? 'checked' : ''}> ${tr('Röntgen (csak körvonal és lábak)')}</label>${paramsHtml(d.def, penv(p), tr)}
      ${pins}
      <div class="pr-more" id="pMore"></div>`;
    { const e = qq<HTMLInputElement>('#pLabel'); e.addEventListener('change', () => { H.pushUndo(); p.label = e.value.trim() || p.label; H.commit(); }); }
    bindParams(p); bindPins();
    qq('#pRot').onclick = H.rotate; qq('#pMir').onclick = H.mirror; qq('#pDel').onclick = H.delSel;
    const more = qq('#pMore');
    qq('#pDup').onclick = () => H.duplicate(p);
    qq<HTMLInputElement>('#pXray').onchange = e => { H.pushUndo(); if ((e.target as HTMLInputElement).checked) p.xray = true; else delete p.xray; H.commit(true); };
    {
      const own = !H.isBuiltin(p.type);
      more.innerHTML = own ? `<button class="btn" data-adv id="pEditDef">✎ ${tr('Alkatrész szerkesztése')}</button>` : `<button class="btn" data-adv id="pCopyDef" title="${tr('A beépített leírásból saját, szerkeszthető alkatrész')}">${tr('Másolat saját alkatrészként')}</button>`;
      pr.appendChild(more);
      if (own) qq('#pEditDef').onclick = () => H.editPart(p.type); else qq('#pCopyDef').onclick = () => H.copyPart(p.type);
    }
    more.insertAdjacentHTML('beforeend', `<button class="btn" id="pToAuto" title="${tr('Az alkatrész kézi bekötését kapcsolatokká alakítja, így mozgatáskor követi')}">${tr('Bekötés automatikusra')}</button>`);
    qq('#pToAuto').onclick = () => { if (!H.manualToAuto(p.id)) H.flashMsg(tr('Ennek az alkatrésznek nincs kézi bekötése')); };
    if (isMcu(p)) {
      const ts = Object.entries(DEFS).filter(([k, d]) => d.mcu && k !== p.type);
      if (ts.length) {
        const row = document.createElement('div'); row.className = 'row';
        row.innerHTML = `<label for="pSwap">${tr('Csere')}</label><select id="pSwap" style="flex:1">${ts.map(([k, d]) => `<option value="${k}">${esc(tr(d.name))}</option>`).join('')}</select><button class="btn" id="pSwapGo" title="${tr('Másik vezérlőre cseréli; a kapcsolatok megmaradnak, a GPIO-k újra kiosztódnak')}">${tr('Csere')}</button>`;
        pr.appendChild(row);
        qq('#pSwapGo').onclick = () => { const r = H.swapMcu(p.id, qq<HTMLSelectElement>('#pSwap').value); if (r) H.flashMsg(r.msg); };
      }
    }
    if (isOff(p)) {
      const h = plugOf(D, p), row = document.createElement('div'); row.className = 'row';
      row.innerHTML = h ? `<span class="small">${tr('Csatlakozó: {x} (tüskesor a panelon)', { x: `<b>${esc(h.label)}</b>` })}</span><button class="btn" id="pUnplug" title="${tr('A kábel kihúzása: a tüskesor a panelon marad, a lábak szabad kábelként köthetők be')}">${tr('Kihúzás')}</button>`
        : `<button class="btn" id="pPlug" title="${tr('Tüskesor a panelra a lábszámával és lábneveivel; a kábel abba dugva, a bekötés onnan indul')}">${tr('Csatlakozó (tüskesor) a panelra')}</button>`;
      pr.appendChild(row);
      if (h) qq('#pUnplug').onclick = () => { H.pushUndo(); delete p.plug; H.commit(); };
      else qq('#pPlug').onclick = () => {
        H.pushUndo(); const nh = H.attachPlug(p);
        if (!nh) { H.dropUndo(); H.flashMsg(tr('Nincs elég szabad hely a panelon a csatlakozónak')); return; }
        H.commit(); H.flashMsg(tr('{x}: a csatlakozó a panelon, a kábel bedugva. Mozgasd oda, ahová forrasztanád.', { x: nh.label }));
      };
    }
    if (d.def.socket) {
      const o = pluggedInto(D, p), offs = D.parts.filter(x => isOff(x) && !plugOf(D, x) && DEFS[x.type].pins(x).length <= d.pins(p).length);
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = o ? `<span class="small">${tr('Ide csatlakozik: {x} ({y}). A lábak sorrendje a kábelé.', { x: `<b>${esc(o.label)}</b>`, y: esc(tr(DEFS[o.type].name)) })}</span>`
        : offs.length ? `<label for="pPlugTo">${tr('Kábel')}</label><select id="pPlugTo" style="flex:1">${offs.map(x => `<option value="${x.id}">${esc(x.label)} · ${esc(tr(DEFS[x.type].name))}</option>`).join('')}</select><button class="btn" id="pPlugGo" title="${tr('A külső alkatrész kábele ebbe a csatlakozóba')}">${tr('Bedugás')}</button>`
          : `<span class="help">${tr('Csatlakozó: külső alkatrész (motor, szervó, szenzor) kábele dugható bele. A lábnevek a feliratokhoz valók.')}</span>`;
      pr.appendChild(row);
      if (!o && offs.length) qq('#pPlugGo').onclick = () => {
        const x = D.parts.find(y => y.id === qq<HTMLSelectElement>('#pPlugTo').value); if (!x) return;
        H.pushUndo(); x.plug = p.id; const sp = d.def.socket!;
        if (sp.names && !p.props[sp.names]) p.props[sp.names] = socketProps(d.def, x)[sp.names];
        H.commit();
      };
    }
    if (p.type === 'button') {
      more.insertAdjacentHTML('afterbegin', `<button class="btn" id="pAuto" title="${tr('Kapcsolatok: az A láb szabad GPIO-ra, a B láb a földre')}">A → GPIO, B → GND</button>`);
      qq('#pAuto').onclick = () => {
        const a = p.id + '.A1', b = p.id + '.B1'; H.pushUndo();
        if (!D.links.some(l => l.a === a)) D.links.push({ id: 'l' + (D.seq++), a, b: 'GPIO' } as Design['links'][number]);
        if (!D.links.some(l => l.a === b)) D.links.push({ id: 'l' + (D.seq++), a: b, b: 'GND' } as Design['links'][number]);
        H.commit();
      };
    }
  }

  function render() {
    const D = H.D(), pr = H.el, p = H.selPart(), sel = ui.sel;
    if (p) { partProps(pr, p); return; }
    if (sel && sel.kind === 'group' && sel.parts.size + sel.bridges.size + sel.wires.size) {
      const g = sel;
      pr.innerHTML = `<div class="small">${tr('Kijelölve: {p} alkatrész, {b} kézi híd, {w} vezeték', { p: `<b>${g.parts.size}</b>`, b: `<b>${g.bridges.size}</b>`, w: `<b>${g.wires.size}</b>` })}</div>
      <div class="small muted">${tr('Húzással együtt mozognak. Shift+kattintás: hozzáadás/elvétel.')}</div>
      <div class="pr-acts">${ACT('gRot', 'rotate', N_('Forgatás'), 'R')}${ACT('gMir', 'mirror', N_('Tükrözés'), 'M')}${ACT('gDel', 'trash', N_('Törlés'), 'Del', '', ' danger')}</div>
      ${g.parts.size ? `<div class="pr-more"><button class="btn" id="gAuto">${tr('Bekötés automatikusra')}</button><button class="btn" id="gXray">${tr('Röntgen be/ki')}</button></div>` : ''}`;
      const gx = q('#gXray');
      if (gx) gx.onclick = () => { H.pushUndo(); const ps = D.parts.filter(p => g.parts.has(p.id)); const on = !ps.every(p => p.xray); ps.forEach(p => { if (on) p.xray = true; else delete p.xray; }); H.commit(true); };
      qq('#gRot').onclick = H.rotate; qq('#gMir').onclick = H.mirror; qq('#gDel').onclick = H.delSel;
      const ga = q('#gAuto'); if (ga) ga.onclick = () => { if (!H.manualToAuto(new Set(g.parts))) H.flashMsg(tr('A kijelölésnek nincs kézi bekötése')); };
      return;
    }
    if (sel && sel.kind === 'wire') {
      const w = D.wires[sel.i];
      pr.innerHTML = `<div class="small">${tr('Vezeték')} <span class="mono">${w.a.join(':')} → ${w.b.join(':')}</span></div><div class="swatches">${H.wireColors.map(([c, l0]) => { const l = esc(tr(l0)); return `<button class="sw ${w.color === c ? 'on' : ''}" data-wcol="${c}" title="${l}" aria-label="${l}" style="background:${c}"></button>`; }).join('')}</div><div class="row"><button class="btn danger" id="pDel">${tr('Törlés')}</button></div>`;
      pr.querySelectorAll<HTMLElement>('[data-wcol]').forEach(b => b.onclick = () => { H.pushUndo(); w.color = b.dataset.wcol!; H.commit(); }); qq('#pDel').onclick = H.delSel;
      return;
    }
    if (sel && sel.kind === 'note' && (D.notes || []).some(n => n.id === sel.id)) {
      const n = D.notes.find(x => x.id === sel.id)!;
      pr.innerHTML = `<div class="small">${tr('Jegyzet')} <span class="muted">(${tr('nem villamos elem')})</span></div>
      <textarea id="nText" class="note-text" rows="6" spellcheck="true" aria-label="${tr('Jegyzet szövege')}">${esc(n.text)}</textarea>
      <p class="help" style="margin:2px 0 6px">${tr('Új sor: Enter. {x} sor félkövér címsor. Méret: húzd a jobb alsó sarkát, vagy add meg.', { x: `<code># ${tr('Cím')}</code>` })}</p>
      <div class="row nowrap"><label for="nW">${tr('Méret')}</label><input type="number" id="nW" min="3" max="60" value="${n.w}" aria-label="${tr('szélesség')}"><span class="muted small">×</span><input type="number" id="nH" min="2" max="60" value="${n.h}" aria-label="${tr('magasság')}"><span class="muted small">${tr('lyuk')}</span></div>
      <div class="row"><label>${tr('Szín')}</label><div class="swatches">${NOTE_COL.map(([c, l0]) => { const l = esc(tr(l0)); return `<button class="sw ${n.color === c ? 'on' : ''}" data-ncol="${c}" title="${l}" aria-label="${l}" style="background:${c}"></button>`; }).join('')}</div></div>
      <div class="row"><label for="nTarget" title="${tr('Szaggatott nyíl a jegyzettől az alkatrészig; csak jelölés, nem kapcsolat')}">${tr('Mutat')}</label><select id="nTarget" style="flex:1"><option value="">– ${tr('semmire')} –</option>${D.parts.map(p => `<option value="${p.id}" ${n.target === p.id ? 'selected' : ''}>${esc(p.label)} · ${esc(tr(DEFS[p.type].name))}</option>`).join('')}</select></div>
      <div class="row"><button class="btn danger" id="pDel">${tr('Törlés')}</button></div>`;
      let undoPushed = false; const ta = qq<HTMLTextAreaElement>('#nText');
      ta.addEventListener('input', () => { if (!undoPushed) { H.pushUndo(); undoPushed = true; } n.text = ta.value; H.save(); H.draw(); });
      const sz = () => { H.pushUndo(); n.w = Math.max(3, Math.min(60, +qq<HTMLInputElement>('#nW').value || n.w)); n.h = Math.max(2, Math.min(60, +qq<HTMLInputElement>('#nH').value || n.h)); H.save(); H.draw(); };
      qq('#nW').onchange = sz; qq('#nH').onchange = sz;
      pr.querySelectorAll<HTMLElement>('[data-ncol]').forEach(b => b.onclick = () => { H.pushUndo(); n.color = b.dataset.ncol!; H.save(); H.renderLeft(); H.draw(); });
      qq<HTMLSelectElement>('#nTarget').onchange = e => { H.pushUndo(); n.target = (e.target as HTMLSelectElement).value || null; H.save(); H.draw(); }; qq('#pDel').onclick = H.delSel;
      return;
    }
    if (sel && sel.kind === 'cut') {
      // a kijelölt vágás közben eltűnhetett (pl. az automatikus vágás újratervezésekor)
      if (![...(D.cuts || []), ...(D.auto.cuts || [])].some(x => sameCut(x, sel.hit.cut))) { ui.sel = null; H.renderLeft(); return; }
      const { src, cut: [r, c, k] } = sel.hit;
      pr.innerHTML = `<div class="small">${k ? tr('Csíkvágás: furat') : tr('Csíkvágás: rés')} <span class="mono">${k ? `${r}:${c}` : `${r}:${c} | ${r + 1}:${c}`}</span> <span class="muted">(${src === 'auto' ? tr('automatikus') : tr('kézi')})</span></div>`
        + (src === 'auto' ? `<p class="help" style="margin:2px 0 6px">${tr('Az automatikus csíkvágás tette ide, mert a csíkon két különböző hálózat lába van. Törlés után ide nem kerül újra; ha lehet, a program a két láb között máshol vág.')}</p>` : '')
        + `<div class="row"><button class="btn danger" id="pDel">${tr('Törlés')}</button></div>`;
      qq('#pDel').onclick = H.delSel;
      return;
    }
    if (sel && sel.kind === 'bridge') {
      const b = D.bridges[sel.i];
      pr.innerHTML = `<div class="small">${tr('Híd')} <span class="mono">${b[0]}:${b[1]} – ${b[2]}:${b[3]}</span></div><div class="row"><button class="btn danger" id="pDel">${tr('Törlés')}</button></div>`; qq('#pDel').onclick = H.delSel;
      return;
    }
    if (ui.linkStart) {
      const qp = findPin(D, ui.linkStart);
      pr.innerHTML = `<div class="small">${tr('Kapcsolat innen: {x}', { x: `<b class="mono">${qp ? esc(pinLabel(qp)) : '?'}</b>` })}</div><div class="small muted">${tr('Kattints a cél lábra, vagy válassz:')}</div><div class="row"><button class="btn" id="lkGnd">→ GND</button><button class="btn" id="lkGpio">→ ${tr('szabad GPIO')}</button><button class="btn" id="lkNo">${tr('Mégse')}</button></div>`;
      qq('#lkGnd').onclick = () => { H.addLink(ui.linkStart!, 'GND'); ui.linkStart = null; H.renderLeft(); };
      qq('#lkGpio').onclick = () => { H.addLink(ui.linkStart!, 'GPIO'); ui.linkStart = null; H.renderLeft(); };
      qq('#lkNo').onclick = () => { ui.linkStart = null; H.renderLeft(); H.draw(); };
      return;
    }
    pr.innerHTML = `<span class="muted small">${ui.tool === 'link' && !ui.placing ? tr('Kattints egy lábra, majd a cél lábra (vagy GND / szabad GPIO).') : ''}${ui.placing ? tr('Lerakás: {x}{y}. Kattints a panelra; Shift+kattintással több példány.', { x: `<b>${esc(tr(DEFS[ui.placing].name))}</b>`, y: ui.ghost.from ? ' ' + tr('({x} másolata)', { x: esc(ui.ghost.from) }) : '' }) : ui.tool === 'bridge' ? tr('Húzd az egeret szomszédos lyukakon át: minden szekcióhatárnál híd keletkezik.') : ui.tool === 'wire' ? tr('Kattints a kezdő, majd a cél lyukra.') : ui.tool === 'erase' ? tr('Kattints vagy húzz a törlendő elemen.') : tr('Kattints egy alkatrészre, vezetékre vagy hídra. Shift+kattintás vagy keret húzása üres helyen: több elem. Ctrl+A: minden.')}</span>`;
  }

  return { render };
}
