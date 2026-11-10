/**
 * Alkatrész-szerkesztő: saját modulok leírása űrlappal (lábak, csoportok, test, villamos modell,
 * vezérlő) vagy közvetlenül JSON-ban. Az eredmény szabályos PartDef, amit a többi rész ugyanúgy
 * használ, mint a beépített alkatrészeket.
 */
import { pinLabelPositions } from '../core/labels';
import { logicMsg, parseExpr, pinRef, renameVars, varsOf } from '../core/logic';
import { EL_KINDS, addModelToGraph, emptyGraph, graphToLogic, graphToModel, logicToGraph, nextNodeId, nodeTitle, setPortExpr, type CGraph, type ElKind, type GraphProblem } from '../core/circuit';
import { mountCircEditor, type CircEditor, type CircHost } from './circedit';
import { isFull } from './fullscreen';
import { tableVars, toggleCell, truthTable, TABLE_MAX_VARS } from './logicview';
import { fmtSI, parseSI } from '../core/expr';
import { BUS_FNS, hasErrors, validatePartDef, type Problem } from '../core/validate';
import type { ModelEl, PartDef, Prim } from '../core/schema';
import { icon } from './icons';
import { History } from './history';
import { N_, t as tr } from '../i18n/i18n';
import { bodyRect, darken, defToForm, FILLS, formOf, lightText, formToDef, guessRole, MODEL_UI, newForm, parseRange, splitCaps, type Form, type LogicForm, type ModelKind, type ModelRow, type PinRow } from '../core/partform';
export { defToForm, formToDef, guessRole, parseRange, splitCaps };
export type { Form, LogicForm };

export interface EditorHost {
  builtin: Record<string, PartDef>;
  custom(): Record<string, PartDef>;
  /** Mentés; `type` null új alkatrésznél. Visszaadja a típuskulcsot. */
  save(type: string | null, def: PartDef): string;
  remove(type: string): void;
  /** Hány lerakott példány törlődik az alkatrésszel együtt. */
  usage(type: string): number;
  /** Lerakás indítása a panelon. */
  place(type: string): void;
  roleColor(role: string): string;
  /**
   * A szerkesztők helye (5.6): középső nézet a gazdánál, alkatrészenként egy fül a nézetsávban (`id`: a piszkozatkulcs).
   * `onClose`: a fül × gombja.
   */
  view: {
    open(id: string, el: HTMLElement, title: string, onClose: () => void, show?: boolean, acts?: HTMLElement): void;
    title(id: string, t: string): void;
    close(id: string): void;
    /** Háttérbe tétel: a nézet eltűnik, a fül marad (mint a Panel gombra váltva). */
    hide(id: string): void;
    /** Előtérbe hozás (a fülre kattintva, vagy ha a már nyitott alkatrészt nyitnák meg újra). */
    show(id: string): void;
    /** Ez a szerkesztő látszik-e most. */
    visible(id: string): boolean;
  };
  /** A látható szerkesztő visszavonási állapota változott (a fejléc gombjai ezt mutatják). */
  histChanged?(): void;
}

/** A nyitott szerkesztők piszkozatkulcs szerint: több alkatrész is szerkeszthető egyszerre, mindegyik saját füllel. */
/** A szerkesztő saját visszavonása, a gazda fejlécének gombjaihoz. */
export interface EditorHist { canUndo: boolean; canRedo: boolean; go(redo: boolean): void }
const OPEN = new Map<string, { close(keep?: boolean, force?: boolean): void; hist(): EditorHist | null; rerender(): void }>();
/** Nyelvváltáskor: minden nyitott szerkesztő újrarajzol (a felirataival együtt). */
export function rerenderEditors(): void { for (const e of OPEN.values()) e.rerender(); }
/** A látható (előtérben lévő) szerkesztő visszavonása; ha nincs ilyen, null: a fejléc a panelé. */
export function editorHistory(): EditorHist | null { for (const e of OPEN.values()) { const h = e.hist(); if (h) return h; } return null; }
/** Nyitva van-e Alkatrész-szerkesztő (akár háttérben). */
export const editorOpen = (): boolean => OPEN.size > 0;
export function closeEditor(): void { for (const e of [...OPEN.values()]) e.close(true, true); }
/** A háttérben hagyott, nem mentett szerkesztések piszkozatkulcsai: újratöltés után a fülük visszajön. */
const PARKED_KEY = 'proofboard.editor.parked';
function parkedList(): string[] {
  try { const v = localStorage.getItem(PARKED_KEY); if (!v) return []; const a = v.startsWith('[') ? JSON.parse(v) : [v]; return Array.isArray(a) ? a.filter(x => typeof x === 'string') : []; } catch { return []; }
}
function setParked(k: string, on: boolean): void {
  const a = parkedList().filter(x => x !== k); if (on) a.push(k);
  try { if (a.length) localStorage.setItem(PARKED_KEY, JSON.stringify(a)); else localStorage.removeItem(PARKED_KEY); } catch { /* tárhely nélkül */ }
}
/** Induláskor: a háttérben hagyott, nem mentett szerkesztések fülei visszakerülnek a nézetsávba (háttérben nyílnak). */
export function restoreParked(host: EditorHost): void {
  for (const k of parkedList()) {
    if (OPEN.has(k)) continue;
    if (!drafts()[k]) { setParked(k, false); continue; }
    let opts: { type?: string; from?: PartDef } | null = null;
    if (k === 'new') opts = {};
    else if (k.startsWith('type:') && host.custom()[k.slice(5)]) opts = { type: k.slice(5) };
    else if (k.startsWith('from:')) { const d = Object.values(host.builtin).find(x => x.name === k.slice(5)); if (d) opts = { from: d }; }
    if (opts) openEditor(host, opts, false); else setParked(k, false);
  }
}

/** Saját alkatrészeknél választható lábszerepek. */
export const ROLES: Array<[string, string]> = [
  ['sig', N_('jel / adat')], ['out', N_('kimenet')], ['vin', N_('tápbemenet')], ['gnd', N_('föld (GND)')], ['adc', N_('analóg jel')],
  ['an', N_('anód / +')], ['ka', N_('katód / −')], ['nc', N_('nincs bekötve')], ['h', N_('általános')],
  ['gpio', N_('GPIO (vezérlőlap)')], ['p33', N_('3,3 V kimenet')], ['pwr', N_('táp (VSYS, 5V…)')], ['misc', N_('egyéb (RUN, EN…)')],
];
/** A GPIO-képességek magyarázata a szerkesztőben (a buszfunkciók pl. i2c0.sda, spi1.mosi, uart0.tx, pwm3.a). */
const CAP_HELP = N_('adc, adc2, in (csak bemenet), nopull, strap, uart0, led, valamint buszfunkciók: i2c0.sda, spi1.mosi, uart0.tx, pwm3.a…');

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
type Tab = 'pins' | 'func' | 'json';
/** Régi piszkozatok fülnevei (Űrlap → Lábak, Logika → Működés). */
const tabOf = (t: unknown): Tab => (t === 'json' ? 'json' : t === 'logic' || t === 'func' ? 'func' : 'pins');
interface Draft { tab: Tab; form: Form | null; jsonText: string }
const DRAFT_KEY = 'proofboard.editor.drafts';
function drafts(): Record<string, Draft> { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {}; } catch { return {}; } }
function putDraft(k: string, d: Draft | null): void {
  const all = drafts(); if (d) all[k] = d; else delete all[k];
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(all)); } catch { /* tárhely nélkül csak a munkamenetben */ }
}

/** A Működés fül szakaszai (ugrás a fül tetején lévő sávból). */
const SECTIONS: Array<[string, string]> = [['model', N_('Villamos modell')], ['logic', N_('Logika')], ['ctl', N_('Vezérlő')]];

/** A szerkesztő megnyitása. `type`: meglévő saját alkatrész; `from`: kiindulási leírás (pl. beépített másolata). */
export function openEditor(host: EditorHost, opts: { type?: string; from?: PartDef } = {}, show = true): void {
  const draftKey = opts.type ? 'type:' + opts.type : opts.from ? 'from:' + opts.from.name : 'new';
  if (OPEN.has(draftKey)) { if (show) host.view.show(draftKey); return; } // már nyitva: csak előre jön
  const existing = opts.type ? host.custom()[opts.type] : undefined;
  const start = existing || opts.from;
  let form: Form | null = null, jsonDef: PartDef | null = null, tab: Tab = 'pins';
  /** Kiinduló állapot: űrlap, ha a leírás veszteség nélkül megjeleníthető rajta, különben JSON. */
  const initial = (): void => {
    jsonDef = null; jsonText = ''; jsonErr = ''; pending = null;
    if (!start) { form = newForm(tr); tab = 'pins'; return; }
    const d: PartDef = JSON.parse(JSON.stringify(start));
    if (opts.from && !existing) { d.name = d.name + ' ' + tr('(másolat)'); delete d.meta; }
    const m = formOf(d), conv = m ? { form: m, lost: [] } : defToForm(d, undefined, tr);
    if (conv.form && !conv.lost.length) { form = conv.form; if (opts.from && !existing) form.name = d.name; tab = 'pins'; }
    else { form = null; jsonDef = d; tab = 'json'; }
  };
  /** A bal oldali fül az előnézet alatt: Alapadatok, Megjelenés vagy Problémák. */
  let vtab: 'basic' | 'look' | 'probs' = 'basic';
  /** Az előnézeten húzott láb (a rács közben rögzített). */
  let drag: { i: number; moved: boolean; frame: { r0: number; r1: number; c0: number; c1: number } } | null = null, dragEnd = 0;
  /** A lábtáblázat minden oszloppal (különben a kijelölt láb további adatai a sora alatt). */
  let wide = false;
  let sel = -1, selModel = -1, nameBefore: string | null = null;
  let jsonText = '';
  let jsonErr = '';
  let confirmDel = 0, confirmDiscard = 0;
  /** JSON → Űrlap váltáskor a veszteséggel járó átalakítás, megerősítésre várva. */
  let pending: { form: Form; lost: string[]; to: Tab } | null = null;
  /** Az utolsó űrlap → JSON váltáskor előállított rajz és test (ha a JSON-ban változatlan, az űrlapé marad). */
  let lastGen: { form: Form; graphics: unknown; bounds: unknown } | null = null;
  initial();
  const dr = drafts()[draftKey];
  const restored = !!dr;
  if (dr) { tab = tabOf(dr.tab); form = dr.form; jsonText = dr.jsonText || ''; if (tab === 'json') { try { jsonDef = JSON.parse(jsonText); } catch (e) { jsonErr = tr('Hibás JSON: {x}', { x: e instanceof Error ? e.message : String(e) }); } } }
  const snapshot = () => JSON.stringify({ tab, form, jsonText: tab === 'json' ? jsonText : '' });
  let clean = restored ? '' : snapshot();
  /**
   * Saját visszavonás (a panel előzményeitől független): az űrlap pillanatképei. Egy lépés egy mozdulat
   * (kattintás, húzás, billentyű); a szövegmezőbe gépelés mezőnként egy lépés. JSON-nézetben a szövegdoboz sajátja érvényes.
   */
  const H = new History(100, () => histUI());
  let hSnap = '', hInit = false, hGest = -1, hEl: Element | null = null, hAt = 0, gest = 0;
  const onGest = (e: Event) => { if (e.type === 'keydown' && ((e as KeyboardEvent).ctrlKey || (e as KeyboardEvent).metaKey)) return; gest++; };
  document.addEventListener('pointerdown', onGest, true);
  document.addEventListener('keydown', onGest, true);
  /** A módosítás előtti állapot a listára (refresh hívja: minden változás ezen megy át). */
  function track(): void {
    if (!form || tab === 'json') return;
    const s = JSON.stringify(form); if (!hInit) { hInit = true; hSnap = s; return; } // az első rajz (a származtatott mezők kitöltése) még nem módosítás
    if (s === hSnap) return;
    const ae = document.activeElement as HTMLInputElement | null;
    const typing = !!ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(ae.type));
    const same = typing ? ae === hEl && Date.now() - hAt < 1500 : gest === hGest && !hEl;
    if (!same) H.push(hSnap);
    hSnap = s; hGest = gest; hEl = typing ? ae : null; hAt = Date.now();
  }
  /** A fejléc visszavonás-gombjai a látható szerkesztőét mutatják. */
  function histUI(): void {
    const on = !!form && tab !== 'json';
    acts.querySelector<HTMLButtonElement>('[data-act="undo"]')!.disabled = !(on && H.canUndo);
    acts.querySelector<HTMLButtonElement>('[data-act="redo"]')!.disabled = !(on && H.canRedo);
    host.histChanged?.();
  }
  function histGo(redo: boolean): void {
    if (!form || tab === 'json') return;
    track();
    const s = redo ? H.redo(hSnap) : H.undo(hSnap); if (s === null) return;
    form = JSON.parse(s) as Form; hSnap = s; hGest = -1; hEl = null;
    sel = -1; selModel = -1; pending = null;
    render(); circ?.refresh();
  }
  const histReset = () => { hInit = false; hGest = -1; hEl = null; H.clear(); };

  const back = document.createElement('div');
  back.className = 'pe-view';
  back.innerHTML = `
    <div class="pe" role="region" aria-label="Alkatrész-szerkesztő">
      <div class="pe-body">
        <div class="pe-right pe-vis" data-ref="right">
          <canvas class="pe-cv" data-ref="cv" aria-label="Előnézet"></canvas>
          <p class="help" data-ref="cvhelp">Kattints egy üres lyukra: új láb oda. Kattints egy lábra: kijelölés a táblázatban; húzva áthelyezhető.</p>
          <div class="grp seg pe-vtabs" role="tablist" aria-label="Az alkatrész adatai"><button class="btn" data-vtab="basic" role="tab">Alapadatok</button><button class="btn" data-vtab="look" role="tab">Megjelenés</button><button class="btn" data-vtab="probs" role="tab">Problémák <span class="badge" data-ref="pcount" hidden></span></button></div>
          <div class="pe-vscroll" data-ref="vscroll">
            <div data-ref="basic"></div>
            <section class="pe-probs" data-vpane="probs" aria-label="Az alkatrész problémái"><ul class="issues" data-ref="probs"></ul></section>
          </div>
        </div>
        <div class="pe-parcol">
          <div class="pe-ptabs"><div class="grp seg pe-tabs" role="tablist" aria-label="Szerkesztési mód"><button class="btn" data-tab="pins" role="tab" title="Lábak: hely, név, szerep, csoport, funkció">Lábak</button><button class="btn" data-tab="func" role="tab" title="Működés: villamos modell, digitális logika, vezérlő a szimulációban">Működés</button><button class="btn" data-tab="json" role="tab" title="A leírás teljes JSON-formája">JSON</button></div>
            <span class="muted small pe-sub" data-ref="sub"></span></div>
          <div class="pe-left pe-par" data-ref="left"></div>
        </div>
      </div>
    </div>`;
  /** A fül gombjai a nézetsávban (a gazda a látható szerkesztő füléhez teszi): Elvetés, Mentés. */
  const acts = document.createElement('span');
  acts.className = 'pe-acts';
  acts.innerHTML = `<button class="btn icon ghost" data-act="undo" disabled>${icon('undo')}</button><button class="btn icon ghost" data-act="redo" disabled>${icon('redo')}</button><span class="pe-acts-sep" aria-hidden="true"></span><button class="btn icon" data-act="discard" disabled>${icon('trash')}</button><button class="btn icon" data-act="save">${icon('disk')}</button>`;
  const titleOf = () => tr('Alkatrész: {x}', { x: (form && tab !== 'json' ? form.name : jsonDef?.name) || (existing ? existing.name : tr('új')) });
  back.querySelector('.pe-ptabs')!.append(acts); // a szerkesztő saját gombjai a módválasztó sorának végén
  host.view.open(draftKey, back, titleOf(), () => close(), show);
  const $ = <T extends HTMLElement = HTMLElement>(ref: string) => back.querySelector(`[data-ref="${ref}"]`) as T;
  const left = $('left'), cv = $<HTMLCanvasElement>('cv'), probsEl = $('probs');
  const prevFocus = document.activeElement as HTMLElement | null;

  const currentDef = (): PartDef | null => (tab !== 'json' && form ? formToDef(form, tr) : jsonDef);
  /** Váltás a fülek között: az aktuális állapot átkerül a másik nézetbe. */
  function switchTab(t: Tab): void {
    if (t === tab && !pending) return;
    if (tab !== 'json' && t !== 'json') { tab = t; pending = null; render(); left.scrollTop = 0; return; } // Lábak ↔ Működés: ugyanaz az adat
    if (t === 'json') {
      if (form) { const d = formToDef(form, tr); delete d.meta; jsonDef = d; jsonText = JSON.stringify(d, null, 2); jsonErr = ''; lastGen = { form: JSON.parse(JSON.stringify(form)), graphics: d.graphics, bounds: d.bounds }; }
      tab = 'json'; pending = null; render(); return;
    }
    const ta = left.querySelector<HTMLTextAreaElement>('#pe_json'); if (ta) jsonText = ta.value;
    let d: PartDef;
    try { d = JSON.parse(jsonText); jsonDef = d; jsonErr = ''; }
    catch (e) { jsonErr = tr('Hibás JSON: {x}', { x: e instanceof Error ? e.message : String(e) }) + ' – ' + tr('javítsd, mielőtt az űrlapra váltasz.'); render(); return; }
    const conv = defToForm(d, lastGen || undefined, tr);
    if (!conv.form) { jsonErr = tr('Az űrlapon legalább egy, fix helyű láb kell (számmal megadott sor és oszlop).'); render(); return; }
    if (conv.lost.length) { pending = { form: conv.form, lost: conv.lost, to: t }; render(); return; }
    form = conv.form; tab = t; pending = null; histReset(); render();
  }
  const problems = (): Problem[] => {
    if (tab === 'json' && jsonErr) return [{ level: 'error', path: 'json', msg: jsonErr }];
    const d = currentDef();
    if (!d) return [{ level: 'error', path: '', msg: tr('Nincs leírás.') }];
    const hu = validatePartDef(d), ps = validatePartDef(d, tr).map((p, i) => ({ ...p, hu: hu[i]?.msg }));
    if (form && tab !== 'json' && !form.pins.length) return [{ level: 'error', path: 'pins', msg: tr('Adj hozzá lábakat: kattints az előnézetre, vagy használd a lábsor-generátort.') }];
    if (form && tab !== 'json') return [...graphProblems.map(p => ({ level: p.warn ? 'warn' as const : 'error' as const, path: 'graph.' + p.node, msg: p.msg })), ...ps];
    return ps;
  };

  /** Hol van a hiba az űrlapon: rövid hely („Lábak › VCC”), a fül és az ugrás célja. */
  function whereOf(p: Problem): { at: string; tab?: Tab; sel?: string; node?: string; msg: string } {
    const f = form, msg = p.msg, msg0 = p.hu ?? p.msg;
    if (!f || tab === 'json') return { at: '', msg };
    const m = /^(\w+)(?:\[(\d+)\])?(?:\.(\w+))?(?:\[(\d+)\])?/.exec(p.path) || [];
    const [, key, i0, sub, j0] = m, i = i0 == null ? -1 : +i0, j = j0 == null ? -1 : +j0;
    if (key === 'name' || key === 'prefix' || key === 'cat') return { at: tr('Alapadatok'), sel: `#pe_${key}`, msg };
    if (key === 'pins' || key === 'groups') {
      const q = i >= 0 && key === 'pins' ? f.pins[i] : null;
      return { at: q ? `${tr('Lábak')} › ${q.name || q.id}` : tr('Lábak'), tab: 'pins', sel: q ? `[data-pin="${i}"][data-k="${sub === 'id' ? 'id' : sub === 'lr' ? 'lr' : 'name'}"]` : '#pe_gnames', msg };
    }
    if (key === 'model' && i >= 0 && i < f.model.length) {
      const el = f.model[i], ui = MODEL_UI[el.el], pj = ui.pins.findIndex(([k]) => k === sub), node = (f.graph?.nodes || []).filter(n => n.k === 'el')[i]?.id;
      const what = `${tr('Működés')} › ${tr(ui.label)}`;
      if (pj >= 0) return { at: what, tab: 'func', sel: '#pe_s_logic', node, msg: /^(Hiányzik|Nincs ilyen láb: ?$)/.test(msg0) ? `${tr(ui.pins[pj][1])}: ${tr('nincs lábhoz kötve.')}` : `${tr(ui.pins[pj][1])}: ${msg}` };
      return { at: what, tab: 'func', sel: '#pe_s_logic', node, msg };
    }
    if (key === 'graph') {
      const id = p.path.slice(6), n = f.graph?.nodes.find(x => x.id === id);
      return { at: `${tr('Működés')}${n ? ' › ' + nodeTitle(n, pinList(f), tr) : ''}`, tab: 'func', sel: '#pe_s_logic', node: id, msg };
    }
    if (key === 'model') {
      if (sub === 'vcc' || sub === 'gnd') return { at: tr('Lábak'), tab: 'pins', sel: '.pe-pins select[data-k="role"]', msg: sub === 'vcc' ? tr('A logikához kell egy tápbemenet szerepű láb.') : tr('A logikához kell egy föld (GND) szerepű láb.') };
      const G = f.graph?.nodes || [];
      if (sub === 'regs' && j >= 0) { const r = G.filter(n => n.k === 'reg')[j]; return { at: `${tr('Működés')} › ${tr('Logika')} › ${tr('Tároló')} ${r?.name || ''}`.trim(), tab: 'func', sel: '#pe_s_logic', node: r?.id, msg }; }
      const o = sub === 'outs' && j >= 0 ? f.logic?.outs[j] : null;
      if (!o) return { at: `${tr('Működés')} › ${tr('Logika')}`, tab: 'func', sel: '#pe_s_logic', msg };
      const pn = f.pins.find(q => q.id === o.pin), name = pn ? pn.name || pn.id : '';
      let tail = name && msg.startsWith(name + ': ') ? msg.slice(name.length + 2) : msg; // a láb neve már a helyben szerepel
      const tail0 = name && msg0.startsWith(name + ': ') ? msg0.slice(name.length + 2) : msg0;
      if (/^hiányzik a kifejezés/.test(tail0)) tail = tr('az érték bemenete nincs bekötve.');
      return { at: `${tr('Működés')} › ${tr('Logika')} › ${tr('Kimenet')} ${name || '–'}`, tab: 'func', sel: '#pe_s_logic', node: G.filter(n => n.k === 'out')[j]?.id, msg: tail.charAt(0).toUpperCase() + tail.slice(1) };
    }
    if (key === 'controls') return { at: `${tr('Működés')} › ${tr('Nyomógomb')}`, tab: 'func', sel: '#pe_s_logic', node: (f.graph?.nodes || []).find(n => n.k === 'press')?.id, msg };
    if (key === 'graphics' || key === 'bounds') return { at: tr('Megjelenés'), sel: '#pe_s_look', msg };
    return { at: '', msg };
  }
  /** Ugrás a hibás mezőhöz: fülváltás, görgetés, fókusz. */
  function goTo(w: { tab?: Tab; sel?: string; node?: string }): void {
    if (w.tab && w.tab !== tab) switchTab(w.tab);
    if (w.node && form) { if (form.logic?.view === 'table') { form.logic.view = 'graph'; render(); } circ?.select(w.node); circ?.el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    const pane = w.sel ? back.querySelector(w.sel)?.closest<HTMLElement>('[data-vpane]') : null;
    if (pane && pane.dataset.vpane !== vtab) { vtab = pane.dataset.vpane as typeof vtab; showVtab(); }
    const el = w.sel ? back.querySelector<HTMLElement>(w.sel) || (w.sel.startsWith('#pe_lx_') ? back.querySelector<HTMLElement>('#pe_s_logic') : null) : null;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) el.focus({ preventScroll: true });
  }

  /**
   * Bezárás (× vagy Esc): a nem mentett állapot piszkozatként megmarad. Ha van nem mentett módosítás és a szerkesztő
   * látszik, csak háttérbe kerül – a fül marad, onnan egy kattintással visszahozható (újratöltés után is). A háttérben
   * lévő fül × gombja, illetve `force` már bezárja (a piszkozat akkor is megmarad: az Új alkatrész folytatja).
   */
  const close = (keep = true, force = false) => {
    if (tab === 'json') { const ta = left.querySelector<HTMLTextAreaElement>('#pe_json'); if (ta) jsonText = ta.value; }
    const dirty = snapshot() !== clean;
    if (keep && dirty) putDraft(draftKey, { tab, form, jsonText: tab === 'json' ? jsonText : '' });
    if (keep && dirty && !force && host.view.visible(draftKey)) { setParked(draftKey, true); host.view.hide(draftKey); return; }
    setParked(draftKey, false); // teljes bezárás: a fül nem jön vissza (a piszkozat igen, az Új alkatrész folytatja)
    if (circ && isFull(circ.el)) circ.el.remove(); // teljes képernyős diagram is bezárul
    ro.disconnect(); OPEN.delete(draftKey); host.view.close(draftKey); document.removeEventListener('keydown', onDocKey, true); document.removeEventListener('pointerdown', onGest, true); document.removeEventListener('keydown', onGest, true); window.removeEventListener('pagehide', onPageHide);
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus?.();
  };
  OPEN.set(draftKey, { close, rerender: () => { render(); host.view.title(draftKey, titleOf() + (snapshot() !== clean ? ' •' : '')); circ?.refresh(); }, hist: () => (host.view.visible(draftKey) ? { canUndo: H.canUndo && !!form && tab !== 'json', canRedo: H.canRedo && !!form && tab !== 'json', go: histGo } : null) });
  /** Oldalelhagyáskor (újratöltés, bezárás) a nem mentett szerkesztés piszkozat lesz, és a füle legközelebb visszajön. */
  const onPageHide = () => {
    if (tab === 'json') { const ta = left.querySelector<HTMLTextAreaElement>('#pe_json'); if (ta) jsonText = ta.value; }
    if (snapshot() !== clean) { putDraft(draftKey, { tab, form, jsonText: tab === 'json' ? jsonText : '' }); setParked(draftKey, true); }
  };
  window.addEventListener('pagehide', onPageHide);
  /** Esc: bezárás, ha a szerkesztő látszik, és nem egy párbeszédablakban vagy menüben vagyunk. */
  const onDocKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !host.view.visible(draftKey)) return;
    const t = e.target as HTMLElement | null;
    if (t && t !== document.body && !back.contains(t)) return;
    if (t && t.closest && t.closest('.cg')) return; // a diagram saját Esc-je (kijelölés megszüntetése)
    e.preventDefault(); e.stopPropagation(); close();
  };
  document.addEventListener('keydown', onDocKey, true);
  back.addEventListener('keydown', e => {
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); acts.querySelector<HTMLButtonElement>('[data-act="save"]')?.click(); }
    else histKey(e);
  });
  /** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y; szövegmezőben a mező saját visszavonása marad. */
  function histKey(e: KeyboardEvent): boolean {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    const k = e.key.toLowerCase(); if (k !== 'z' && k !== 'y') return false;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type))) return false;
    e.preventDefault(); e.stopPropagation(); histGo(k === 'y' || e.shiftKey); return true;
  }
  /** Az Űrlap szakaszai közül az, amelyiknél tartunk, kiemelve a navigációban. */
  const navSync = () => {
    const nav = left.querySelector<HTMLElement>('.pe-nav'); if (!nav) return;
    const top = nav.getBoundingClientRect().bottom + 12; let cur = SECTIONS[0][0];
    for (const [k] of SECTIONS) { const el = left.querySelector(`#pe_s_${k}`); if (el && el.getBoundingClientRect().top <= top) cur = k; }
    if (left.scrollHeight > left.clientHeight + 4 && left.scrollTop + left.clientHeight >= left.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1][0];
    nav.querySelectorAll<HTMLElement>('[data-jump]').forEach(b => b.classList.toggle('on', b.dataset.jump === cur));
  };
  left.addEventListener('scroll', navSync, { passive: true });
  /** Az előnézet a jobb oldali sáv szélességéhez igazodik. */
  let roW = 0;
  const ro = new ResizeObserver(() => { const w = $('right').clientWidth; if (w !== roW) { roW = w; drawPreview(); } });
  ro.observe($('right'));

  // ---------- megjelenítés ----------
  /** A szerkesztő vázának feliratai (egyszer épül; nyelvváltáskor is innen frissül). */
  function relabel(): void {
    const set = (sel: string, text: string | null, attrs: Record<string, string> = {}) => { back.querySelectorAll<HTMLElement>(sel).forEach(e => { if (text !== null) e.textContent = text; for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); }); };
    set('.pe', null, { 'aria-label': tr('Alkatrész-szerkesztő') });
    set('.pe-cv', null, { 'aria-label': tr('Előnézet') });
    set('.pe-vtabs', null, { 'aria-label': tr('Az alkatrész adatai') });
    set('[data-vtab="basic"]', tr('Alapadatok')); set('[data-vtab="look"]', tr('Megjelenés'));
    { const b = back.querySelector('[data-vtab="probs"]'); if (b && b.firstChild) b.firstChild.textContent = tr('Problémák') + ' '; }
    set('.pe-probs', null, { 'aria-label': tr('Az alkatrész problémái') });
    set('.pe-tabs', null, { 'aria-label': tr('Szerkesztési mód') });
    set('[data-tab="pins"]', tr('Lábak'), { title: tr('Lábak: hely, név, szerep, csoport, funkció') });
    set('[data-tab="func"]', tr('Működés'), { title: tr('Működés: villamos modell, digitális logika, vezérlő a szimulációban') });
    set('[data-tab="json"]', null, { title: tr('A leírás teljes JSON-formája') });
    const A = (k: string, l: string, tt: string) => { const e = acts.querySelector<HTMLElement>(`[data-act="${k}"]`); if (e) { e.setAttribute('aria-label', l); e.title = tt; } };
    A('undo', tr('Visszavonás'), tr('Visszavonás (Ctrl+Z)')); A('redo', tr('Újra'), tr('Újra (Ctrl+Y)'));
    A('discard', tr('Elvetés'), tr('Elvetés: a nem mentett módosítások eldobása, vissza a kiinduló állapotra'));
    A('save', tr('Mentés'), existing ? tr('Mentés a saját könyvtárba (Ctrl+S)') : tr('Mentés a saját könyvtárba, és a lerakás indítása a panelon (Ctrl+S)'));
  }
  function render(): void {
    relabel();
    $('sub').textContent = (existing ? tr('saját alkatrész') : opts.from ? tr('új, másolatból') : tr('új alkatrész')) + (restored && snapshot() !== clean ? ' · ' + tr('nem mentett módosítások') : '');
    back.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });
    syncLogic(tab !== 'json' ? form : null);
    left.innerHTML = tab === 'pins' && form ? pinsHtml(form) : tab === 'func' && form ? funcHtml(form) : jsonHtml();
    if (tab === 'func') placeCirc();
    $('basic').innerHTML = form && tab !== 'json' ? basicHtml(form) : `<p class="help pe-sec" data-vpane="basic">${tr('JSON-nézetben az alapadatok a leírásban szerkeszthetők.')}</p><p class="help pe-sec" data-vpane="look">${tr('JSON-nézetben a megjelenés a leírásban szerkeszthető.')}</p>`
    if (existing) $('basic').insertAdjacentHTML('beforeend', `<div class="pe-sec pe-danger" data-vpane="basic"><button class="btn danger" data-act="delete" title="${tr('Az alkatrész törlése a saját könyvtárból')}">${icon('trash')}${tr('Alkatrész törlése')}</button><p class="help">${tr('A tervben már lerakott példányok megmaradnak (a terv saját leírásával).')}</p></div>`);
    showVtab();
    refresh(); navSync();
  }
  /** A bal oldali fül megjelenítése (csak a választott panel látszik). */
  function showVtab(): void {
    back.querySelectorAll<HTMLElement>('[data-vtab]').forEach(b => { const on = b.dataset.vtab === vtab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    back.querySelectorAll<HTMLElement>('[data-vpane]').forEach(e => { e.hidden = e.dataset.vpane !== vtab; });
  }
  function refresh(): void {
    syncLogic(tab !== 'json' ? form : null);
    track(); histUI();
    drawPreview();
    const ps = problems(), err = hasErrors(ps);
    probsEl.innerHTML = ps.length
      ? ps.map((p, k) => { const w = whereOf(p); return `<li class="${p.level === 'error' ? 'c-err' : 'c-warn'}" data-prob="${k}" tabindex="0" title="${w.sel ? tr('Kattints: ugrás a mezőhöz') : ''}"><span class="dot"></span><span class="pe-pmsg">${w.at ? `<b class="pe-where">${esc(w.at)}</b>` : ''}${esc(w.msg)}</span></li>`; }).join('')
      : `<li class="c-ok" style="cursor:default"><span class="dot"></span><span style="color:var(--fg)">${tr('A leírás rendben, menthető.')}</span></li>`;
    acts.querySelectorAll<HTMLButtonElement>('[data-act="save"]').forEach(b => { b.disabled = err; });
    const pc = $('pcount'); pc.hidden = !ps.length; pc.textContent = String(ps.length); pc.classList.toggle('err', err);
    const dirty = snapshot() !== clean, dis = acts.querySelector<HTMLButtonElement>('[data-act="discard"]')!;
    dis.disabled = !dirty && !confirmDiscard;
    host.view.title(draftKey, titleOf() + (dirty ? ' •' : ''));
  }
  const opt = (v: string, l: string, cur: string) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  /** A láb a lábneve szerint (ahogy az előnézeten látszik), ha eltér, zárójelben az azonosító. */
  const pinOpts = (f: Form, cur: string) => '<option value="">–</option>' + f.pins.map(p => opt(p.id, `${p.name || p.id}${p.name && p.name !== p.id ? ` (azon. ${p.id})` : ''}`, cur)).join('');

  /** A láb további adatainak mezői (csoport, táp, funkció / képességek). */
  function pinCells(p: PinRow, i: number): { grp: string; vlt: string; fn: string } {
    const grp = `<input type="text" data-pin="${i}" data-k="group" value="${esc(p.group)}" style="width:52px" aria-label="${tr('csoport')}" title="${tr('Az azonos csoportú lábak gyárilag össze vannak kötve')}">`;
    const vlt = `<input type="text" data-pin="${i}" data-k="volt" value="${esc(p.volt || '')}" placeholder="${p.role === 'vin' ? tr('pl. 3-5.5') : '–'}" ${p.role === 'vin' ? '' : `disabled title="${tr('Csak tápbemenetnél (vin) adható meg')}"`} style="width:64px" aria-label="${tr('tápfeszültség-tartomány')}">`;
    const fn = p.role === 'gpio' ? `<input type="text" data-pin="${i}" data-k="caps" value="${esc(p.caps || '')}" placeholder="${tr('pl. adc i2c0.sda')}" title="${tr(CAP_HELP)}" style="width:96px" aria-label="${tr('képességek')}">`
              : `<select data-pin="${i}" data-k="fn" aria-label="${tr('buszfunkció')}" title="${tr('A buszfunkció, amire a láb vár')}">${opt('', '–', p.fn || '')}${BUS_FNS.map(x => opt(x, x.toUpperCase().replace('.', ' '), p.fn || '')).join('')}</select>`;
    return { grp, vlt, fn };
  }
  /** A kijelölt láb sora alatti részletsor (keskeny táblázatnál). */
  function detHtml(p: PinRow, i: number): string {
    const { grp, vlt, fn } = pinCells(p, i);
    return `<tr class="pe-det on" data-det="${i}"><td colspan="6"><div class="pe-detrow">
              <label class="small">Csoport ${grp}</label>
              <label class="small">${p.role === 'gpio' ? 'Képességek' : 'Funkció'} ${fn}</label>
              ${p.role === 'vin' ? `<label class="small">Táp (V) ${vlt}</label>` : ''}</div></td></tr>`;
  }
  /** Bal oldal, az előnézet alatt: alapadatok és megjelenés. */
  function basicHtml(f: Form): string {
    return `
      <section class="pe-sec" id="pe_s_basic" data-vpane="basic">
        <p class="h">${tr('Alapadatok')}</p>
        <div class="pe-grid">
          <label for="pe_name">${tr('Név')}</label><input type="text" id="pe_name" data-f="name" value="${esc(f.name)}">
          <label for="pe_prefix">${tr('Előtag')}</label><input type="text" id="pe_prefix" data-f="prefix" value="${esc(f.prefix)}" style="width:90px" title="${tr('A példányok neve: előtag + sorszám, pl. U1, LCD1')}">
          <label for="pe_cat">${tr('Kategória')}</label><input type="text" id="pe_cat" data-f="cat" value="${esc(f.cat)}">
          <label></label><label class="check small" title="${tr('A panel mellé kerül; a lábaihoz kábel (vezeték) köt be')}"><input type="checkbox" data-f="off" ${f.off ? 'checked' : ''}> ${tr('Külső alkatrész (kábellel bekötve)')}</label>
        </div>
      </section>
      <section class="pe-sec" id="pe_s_look" data-vpane="look">
        <p class="h">${tr('Megjelenés')}</p>
        <div class="pe-grid">
          <label>${tr('Szín')}</label><div class="swatches">${FILLS.map(c => `<button class="sw ${c === f.fill ? 'on' : ''}" data-fill="${c}" style="background:${c}" aria-label="${c}" title="${c}"></button>`).join('')}</div>
          <label for="pe_pad">${tr('Margó')}</label><input type="number" id="pe_pad" data-f="pad" value="${f.pad}" step="0.1" min="0.3" max="3" style="width:72px">
          <label>${tr('Kiterjesztés')}</label><div class="pe-ext">
            ${(['t', 'b', 'l', 'r'] as const).map(k => `<label class="small">${tr({ t: N_('fent'), b: N_('lent'), l: N_('balra'), r: N_('jobbra') }[k])}<input type="number" id="pe_ext_${k}" data-ext="${k}" value="${f.ext[k]}" min="0" max="40" step="0.5" style="width:58px"></label>`).join('')}
            <span class="help" style="flex:1 1 100%;margin:0">${tr('A test mérete a lábakon túl, lyukban (pl. egy kijelzőpanel nagyobb a lábsoránál).')}</span></div>
          <label for="pe_btext">${tr('Felirat a testen')}</label><input type="text" id="pe_btext" data-f="bodyText" value="${esc(f.bodyText)}" placeholder="${tr('pl. TP4056')}">
          <label for="pe_names">${tr('Lábnevek')}</label><select id="pe_names" data-f="names">${opt('below', tr('a lábak alatt'), f.names)}${opt('above', tr('a lábak felett'), f.names)}${opt('in', tr('befelé (a test közepe felé)'), f.names)}${opt('out', tr('kifelé (a test szélén túl)'), f.names)}${opt('none', tr('nincsenek'), f.names)}</select>
          <label></label><label class="check small"><input type="checkbox" data-f="showLabel" ${f.showLabel ? 'checked' : ''}> ${tr('Példánynév kiírása (pl. U1)')}</label>
        </div>
      </section>
`;
  }
  /** Lábak fül: lábsor-generátor és lábtáblázat. */
  function pinsHtml(f: Form): string {
    const nextR = f.pins.length ? Math.max(...f.pins.map(p => p.lr)) + 2 : 0, nextC = f.pins.length ? Math.min(...f.pins.map(p => p.lc)) : 0;
    const volt = f.pins.some(p => p.role === 'vin');
    return `
      <section class="pe-sec" id="pe_s_pins">
        <p class="h">${tr('Lábak')} <span class="muted">(${f.pins.length})</span></p>
        <div class="pe-gen">
          <span class="small">${tr('Lábsor:')}</span>
          <input type="number" id="pe_gn" value="${f.pins.length ? 4 : 8}" min="1" max="40" style="width:56px" aria-label="${tr('lábszám')}">
          <span class="small">${tr('db,')}</span>
          <select id="pe_gdir" aria-label="${tr('irány')}"><option value="h">${tr('vízszintes')} →</option><option value="v">${tr('függőleges')} ↓</option></select>
          <span class="small">${tr('innen:')}</span>
          <input type="number" id="pe_gr" value="${nextR}" style="width:56px" aria-label="${tr('kezdő sor')}"><span class="small">:</span><input type="number" id="pe_gc" value="${nextC}" style="width:56px" aria-label="${tr('kezdő oszlop')}">
          <input type="text" id="pe_gnames" placeholder="${tr('nevek vesszővel, pl. RST,CE,DC,DIN,CLK,VCC,BL,GND')}" style="flex:1 1 100%">
          <button class="btn" data-act="gen">${tr('Lábsor hozzáadása')}</button>
          <span class="help" style="flex:1 1 100%;margin:0">${tr('A szerepet a névből tippeli (GND, VCC, VIN…), utána a táblázatban állítható.')}</span>
        </div>
        <div class="pe-tblbar"><span class="small muted">${wide ? tr('Minden oszlop látszik.') : tr('A kijelölt láb további adatai (csoport, funkció, táp) a sora alatt.')}</span><label class="check small"><input type="checkbox" id="pe_wide" ${wide ? 'checked' : ''}> ${tr('Minden oszlop')}</label></div>
        <div class="tablewrap"><table class="tbl pe-pins ${wide ? 'wide' : ''}">
          <thead><tr><th>${tr('Azon.')}</th><th>${tr('Név')}</th><th>${tr('Sor')}</th><th>${tr('Oszl.')}</th><th>${tr('Szerep')}</th>${wide ? `<th title="${tr('Az azonos csoportú lábak gyárilag össze vannak kötve')}">${tr('Csoport')}</th>${volt ? `<th title="${tr('Tápbemenetnél a megengedett feszültség, pl. 2.7-3.6')}">${tr('Táp (V)')}</th>` : ''}<th title="${tr('GPIO-nál a képességek ({x}); perifériánál a buszfunkció, amire a láb vár', { x: tr(CAP_HELP) })}">${tr('Funkció')}</th>` : ''}<th></th></tr></thead>
          <tbody>${f.pins.map((p, i) => {
            const { grp, vlt, fn } = pinCells(p, i);
            const row = `<tr class="${i === sel ? 'on' : ''}" data-row="${i}">
            <td><input type="text" data-pin="${i}" data-k="id" value="${esc(p.id)}" style="width:48px" aria-label="${tr('azonosító')}"></td>
            <td><input type="text" data-pin="${i}" data-k="name" value="${esc(p.name)}" style="width:84px" aria-label="${tr('név')}"></td>
            <td><input type="number" data-pin="${i}" data-k="lr" value="${p.lr}" style="width:52px" aria-label="${tr('sor')}"></td>
            <td><input type="number" data-pin="${i}" data-k="lc" value="${p.lc}" style="width:52px" aria-label="${tr('oszlop')}"></td>
            <td><select data-pin="${i}" data-k="role" aria-label="${tr('szerep')}">${ROLES.map(([v, l]) => opt(v, tr(l), p.role)).join('')}</select></td>
            ${wide ? `<td>${grp}</td>${volt ? `<td>${vlt}</td>` : ''}<td>${fn}</td>` : ''}
            <td><button class="btn" data-act="delpin" data-i="${i}" aria-label="${tr('Láb törlése')}" title="${tr('Láb törlése')}">×</button></td></tr>`;
            const det = !wide && i === sel ? detHtml(p, i) : '';
            return row + det;
          }).join('')}</tbody>
        </table></div>
        ${f.pins.length ? `<p class="help">${tr('Az első láb lesz a lerakási pont (0:0); mentéskor a többi ehhez igazodik.')}</p>` : ''}
      </section>
`;
  }
  /** Működés fül: villamos modell, logika, vezérlő – az alkatrész belső viselkedése. */
  function funcHtml(f: Form): string {
    return `${paramsHtml(f)}<section class="pe-sec" id="pe_s_logic">${logicHtml(f)}</section>`;
  }
  /** Paraméterek (a lerakott példányon állíthatók; csúszkával szimuláció közben is) – a villamos elemek értékében {kulcs}-ként. */
  function paramsHtml(f: Form): string {
    const ps = f.params || [];
    const cell = (i: number, k: string, v: string, w: number, lab: string) => `<td><input type="text" data-par="${i}" data-k="${k}" value="${esc(v)}" style="width:${w}px" aria-label="${esc(lab)}"></td>`;
    return `<section class="pe-sec" id="pe_s_params">
      <p class="h">${tr('Paraméterek')} <span class="muted">(${ps.length})</span></p>
      ${ps.length ? `<div class="tablewrap"><table class="tbl pe-params"><thead><tr><th>${tr('Kulcs')}</th><th>${tr('Felirat')}</th><th>${tr('Egység')}</th><th>${tr('Alapérték')}</th><th>${tr('Min.')}</th><th>${tr('Max.')}</th><th title="${tr('Szimuláció közben csúszkával állítható')}">${tr('Csúszka')}</th><th></th></tr></thead><tbody>
        ${ps.map((p, i) => `<tr>${cell(i, 'key', p.key, 64, tr('kulcs'))}${cell(i, 'label', p.label, 110, tr('felirat'))}${cell(i, 'unit', p.unit, 40, tr('egység'))}${cell(i, 'def', p.def, 64, tr('alapérték'))}${cell(i, 'min', p.min, 52, tr('minimum'))}${cell(i, 'max', p.max, 52, tr('maximum'))}
          <td><input type="checkbox" data-par="${i}" data-k="slider" ${p.slider ? 'checked' : ''} aria-label="${tr('csúszka')}"></td>
          <td><button class="btn" data-act="delpar" data-i="${i}" aria-label="${tr('Paraméter törlése')}" title="${tr('Paraméter törlése')}">×</button></td></tr>`).join('')}
      </tbody></table></div>` : ''}
      <button class="btn" data-act="addpar">${tr('Paraméter hozzáadása')}</button>
      <p class="help">${tr('A villamos elemek értéke kifejezés is lehet a paraméterekkel, pl. egy potméter két fele: {ohm*pos/100} és {ohm*(100-pos)/100}. A csúszkás paraméter szimuláció közben állítható.')}</p>
    </section>`;
  }


  function jsonHtml(): string {
    const d = currentDef();
    if (!jsonText) { const c: PartDef | null = d ? JSON.parse(JSON.stringify(d)) : null; if (c) delete c.meta; jsonText = c ? JSON.stringify(c, null, 2) : ''; }
    const warn = pending ? `<div class="pe-warn" role="alert"><b>${tr('Az űrlap ezeket nem tudja megjeleníteni:')}</b> ${pending.lost.map(esc).join(', ')}.
        ${tr('Ha mégis átváltasz, ezek elvesznek.')}<div class="grp" style="margin-top:6px"><button class="btn" data-act="toform">${tr('Váltás az űrlapra (elhagyja őket)')}</button><button class="btn" data-act="stayjson">${tr('Maradok a JSON-nál')}</button></div></div>` : '';
    return `
      <section class="pe-sec">${warn}
        <p class="help">${tr('A leírás teljes JSON-formája; az űrlapon beállítottak itt is megjelennek, és az itteni módosítások az űrlapra váltáskor visszakerülnek. Ha a leírás olyat tartalmaz, amit az űrlap nem tud (kifejezések, paraméterek, saját rajzelemek), a váltás előtt szól. A mezők leírása: {x}.', { x: 'src/core/schema.ts' })}</p>
        <textarea class="pe-json" id="pe_json" spellcheck="false" aria-label="${tr('Leírás JSON')}">${esc(jsonText)}</textarea>
        <div class="grp" style="margin-top:8px"><button class="btn" data-act="applyjson">${tr('JSON alkalmazása')}</button>
          <label class="small muted">${tr('Kiindulás beépítettből:')} <select id="pe_from" aria-label="${tr('beépített alkatrész')}"><option value="">–</option>${Object.entries(host.builtin).map(([k, d]) => `<option value="${k}">${esc(tr(d.name))}</option>`).join('')}</select></label></div>
      </section>`;
  }

  // ---------- Logika (Működés fül): belső kapcsolás diagramon (ui/circedit.ts), mellette igazságtábla ----------
  const pinName = (f: Form, id: string) => { const p = f.pins.find(x => x.id === id); return p ? p.name || p.id : id; };
  const pinList = (f: Form) => f.pins.map(p => ({ id: p.id, name: p.name || p.id, role: p.role }));
  /** A diagram hibái (bekötetlen kapubemenet, kör, láb nélküli bemenet) az utolsó szinkron szerint. */
  let graphProblems: GraphProblem[] = [];
  /** A diagramon kijelölt csomópont (az előnézet kiemeléséhez). */
  let circSel: string | null = null;
  function ensureLogic(f: Form): LogicForm {
    if (!f.logic) f.logic = { vcc: f.pins.find(p => p.role === 'vin')?.id || '', gnd: f.pins.find(p => p.role === 'gnd')?.id || '', outs: [], view: 'graph' };
    return f.logic;
  }
  const LOGIC_KINDS = new Set(['gate', 'out', 'reg', 'const']);
  const hasLogic = (f: Form) => !!f.graph?.nodes.some(n => LOGIC_KINDS.has(n.k));
  /**
   * A belső kapcsolás a forrás: belőle a logika kifejezései, a villamos elemek és a nyomógomb. Régi (diagram nélküli)
   * leírásnál a kifejezésekből, elemekből és vezérlőből épül fel.
   */
  function syncLogic(f: Form | null): void {
    graphProblems = [];
    if (!f) return;
    if (!f.graph) {
      const L = f.logic, base = L?.graph || (L && L.outs.length ? logicToGraph({ outs: L.outs, regs: L.regs }, pinList(f)) : emptyGraph());
      f.graph = addModelToGraph(base, f.model, f.press);
    }
    if (f.logic) delete f.logic.graph;
    if (hasLogic(f)) {
      const L = ensureLogic(f); if (L.view !== 'table') L.view = 'graph';
      // a logika tápja és földje a lábak szerepéből (tápbemenet, föld); több ilyen lábnál a korábban választott marad
      const role = (id: string) => f.pins.find(p => p.id === id)?.role;
      for (const [k, r] of [['vcc', 'vin'], ['gnd', 'gnd']] as const) if (role(L[k]) !== r) { const p = f.pins.find(x => x.role === r); if (p) L[k] = p.id; }
      const r = graphToLogic(f.graph, pinList(f), tr);
      L.outs = r.outs; L.regs = r.regs.length ? r.regs : undefined; graphProblems.push(...r.problems);
    } else if (f.logic) { f.logic.outs = []; f.logic.regs = undefined; }
    const m = graphToModel(f.graph, tr);
    f.model = m.model; f.press = m.press; graphProblems.push(...m.problems);
  }
  const outNodes = (f: Form) => (f.graph?.nodes || []).filter(n => n.k === 'out');
  /** A kijelölt csomópont lábai, kimenetnél a kifejezésében szereplő bemenetekkel (előnézeti kiemeléshez). */
  function logicPins(f: Form): string[] {
    const G = f.graph, n = G?.nodes.find(x => x.id === circSel); if (!G || !n) return [];
    if (n.k === 'el' || n.k === 'press') return G.edges.filter(e => e.to === n.id).map(e => G.nodes.find(m => m.id === e.from)?.pin || '').filter(Boolean);
    if (!n.pin) return [];
    const ids = [n.pin];
    if (n.k === 'out') {
      const o = f.logic!.outs[outNodes(f).indexOf(n)];
      try { if (o) for (const v of varsOf(parseExpr(o.expr))) { const id = pinRef(v, pinList(f)); if (id && !ids.includes(id)) ids.push(id); } } catch { /* üres vagy hibás */ }
    }
    return ids;
  }
  let circ: CircEditor | null = null;
  const circHost: CircHost = {
    get: () => form?.graph || emptyGraph(),
    set(g, layoutOnly) { if (!form) return; form.graph = g; if (layoutOnly) { refresh(); return; } syncLogic(form); render(); },
    pins: () => (form ? pinList(form) : []),
    problems: () => new Map(graphProblems.map(p => [p.node, p.msg])),
    exprOf(id) { if (!form?.logic || !hasLogic(form)) return null; const i = outNodes(form).findIndex(n => n.id === id), o = form.logic.outs[i]; return o ? { v: o.expr, oe: o.oe } : null; },
    setExpr(id, which, src) {
      if (!form?.graph) return null;
      try { form.graph = setPortExpr(form.graph, id, which, src, pinList(form), tr); }
      catch (x) { return logicMsg(x, tr); }
      syncLogic(form); refresh(); circ?.refresh(); return null;
    },
    onSelect(id) { circSel = id; drawPreview(); },
    reattach() { render(); },
    key: e => histKey(e),
  };
  /** A diagram a helyére (a Működés fül újrarajzolásakor a komponens megmarad, csak visszakerül). */
  function placeCirc(): void {
    const slot = left.querySelector('[data-circ]'); if (!slot || !form) return;
    if (!circ) circ = mountCircEditor(circHost);
    if (isFull(circ.el)) { slot.remove(); return; } // teljes képernyőn marad; kilépéskor a gazda újrarajzol
    slot.replaceWith(circ.el); circ.refresh();
    if (circSel && form.graph?.nodes.some(n => n.id === circSel)) circ.select(circSel);
  }
  function logicHtml(f: Form): string {
    if (!f.pins.length) return `<p class="help">${tr('Előbb adj lábakat az alkatrészhez a Lábak fülön.')}</p>`;
    if (!hasLogic(f)) return '<div data-circ></div>';
    const L = ensureLogic(f);
    const view = L.view === 'table' ? 'table' : 'graph';
    const seg = (['graph', 'table'] as const).map(v => `<button class="btn ${v === view ? 'on' : ''}" data-act="lgview" data-v="${v}" role="tab" aria-selected="${v === view}">${tr({ graph: N_('Kapcsolás'), table: N_('Igazságtábla') }[v])}</button>`).join('');
    const head = `<div class="pe-seg" role="tablist" aria-label="${tr('Logika nézete')}">${seg}</div>`;
    if (view === 'graph') return `${head}<div data-circ></div>`;

    const outsT = L.outs.map(o => ({ name: pinName(f, o.pin), expr: o.expr, oe: o.oe }));
    const ins = f.pins.filter(p => p.id !== L.vcc && p.id !== L.gnd && !L.outs.some(o => o.pin === p.id)).map(p => p.name || p.id);
    const order = f.pins.map(p => p.name || p.id), vars = tableVars(outsT, (L.tableVars || []).filter(v => order.includes(v)), order);
    const used = tableVars(outsT, [], order);
    const chips = ins.map(v => `<label class="lg-chip"><input type="checkbox" data-lvar="${esc(v)}" ${vars.includes(v) ? 'checked' : ''} ${used.includes(v) ? 'disabled title="Szerepel a kapcsolásban"' : ''}> ${esc(v)}</label>`).join('');
    const data = truthTable(outsT, vars);
    let tbl = '';
    if ((L.regs || []).length) tbl = `<p class="help">${tr('Tárolós (sorrendi) logikánál a táblázat a tárolók pillanatnyi értékét is bemenetnek veszi.')}</p>`;
    if (data.tooMany) tbl += `<p class="c-err small">${tr('Legfeljebb {max} bemenet fér a táblázatba (most {n}); ennél többnél a Kapcsolás nézetet használd.', { max: TABLE_MAX_VARS, n: vars.length })}</p>`;
    else tbl += `<div class="tablewrap"><table class="tbl lg-tt"><thead><tr>${vars.map(v => `<th>${esc(v)}</th>`).join('')}<th class="sep"></th>${outsT.map(o => `<th class="o">${esc(o.name)}</th>`).join('')}</tr></thead><tbody>` +
      data.cells.map((row, r) => `<tr>${vars.map((_, j) => `<td>${(r >> (vars.length - 1 - j)) & 1}</td>`).join('')}<td class="sep"></td>${row.map((v, oi) => `<td><button class="lg-cell v${v}" data-act="lgcell" data-i="${oi}" data-r="${r}" ${v === 'Z' ? `disabled title="${tr('Itt az engedélyezés 0: a kimenet nem hajt')}"` : ''}>${v}</button></td>`).join('')}</tr>`).join('') + '</tbody></table></div>';
    return `${head}<p class="help">${tr('Kattints egy kimeneti cellára: 0 ↔ 1. A kimenet előtti kapuk a táblázatból a legrövidebb alakban (az ÉS-ek VAGY-a) újraépülnek; a {z} sorokban az engedélyezés 0, ott mindegy.', { z: '<b>Z</b>' })}</p>
      <div class="lg-chips"><span class="small muted">Bemenetek a táblázatban:</span> ${chips || '<span class="small muted">–</span>'}</div>${data.errors.map(e => `<p class="c-err small">${esc(e)}</p>`).join('')}${tbl}`;
  }
  /** A Logika eseményei (a diagramé a komponensben); true, ha kezelte. */
  function logicEvent(kind: 'input' | 'change' | 'click', t: HTMLElement & { value?: string; checked?: boolean }): boolean {
    if (!form || tab !== 'func') return false;
    const f = form, act = t.dataset.act;
    if (kind === 'click') {
      if (act === 'lgview') { ensureLogic(f).view = t.dataset.v === 'table' ? 'table' : 'graph'; render(); return true; }
      if (act === 'lgcell') {
        const L = f.logic!, outsT = L.outs.map(o => ({ name: pinName(f, o.pin), expr: o.expr, oe: o.oe }));
        const order = f.pins.map(p => p.name || p.id), data = truthTable(outsT, tableVars(outsT, (L.tableVars || []).filter(v => order.includes(v)), order));
        const i = +t.dataset.i!, on = outNodes(f)[i];
        if (on && f.graph) { try { f.graph = setPortExpr(f.graph, on.id, 'v', toggleCell(data, i, +t.dataset.r!), pinList(f)); } catch { /* a táblázat kifejezése mindig érvényes */ } }
        // a táblázat oszlopai ne tűnjenek el, ha egy bemenet kiesik a kifejezésből
        L.tableVars = [...new Set([...(L.tableVars || []), ...data.vars])];
        syncLogic(f); render(); return true;
      }
      return false;
    }
    if (t.dataset.lsup) { const L = ensureLogic(f); L[t.dataset.lsup as 'vcc' | 'gnd'] = t.value || ''; if (kind === 'change') render(); else refresh(); return true; }
    if (t.dataset.lvar != null && kind === 'change') {
      const L = ensureLogic(f), v = t.dataset.lvar, cur = new Set(L.tableVars || []);
      if (t.checked) cur.add(v); else cur.delete(v);
      L.tableVars = [...cur]; render(); return true;
    }
    return false;
  }

  // ---------- előnézet ----------
  function drawPreview(): void {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const narrow = back.clientWidth > 0 && back.clientWidth <= 820; // keskenyen az előnézet fent, a képernyő kb. harmada
    const W = cv.clientWidth || 400, room = narrow ? back.clientHeight * 0.36 : Math.min(460, (back.clientHeight || 700) * 0.5);
    const H = Math.round(Math.max(narrow ? 180 : 220, Math.min(W * 0.75, room)));
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = currentDef();
    const pts = (tab !== 'json' && form ? form.pins.map(p => ({ id: p.id, name: p.name, lr: p.lr, lc: p.lc, role: p.role })) : pinsOfJson(d));
    const rs = pts.map(p => p.lr), cs = pts.map(p => p.lc);
    const BB = pts.length && form && tab !== 'json' ? bodyRect(form, pts) : null;
    let r0 = Math.floor(Math.min(0, ...rs, BB ? BB.r0 : 0)) - 1, r1 = Math.ceil(Math.max(0, ...rs, BB ? BB.r1 : 0)) + 1;
    let c0 = Math.floor(Math.min(0, ...cs, BB ? BB.c0 : 0)) - 1, c1 = Math.ceil(Math.max(0, ...cs, BB ? BB.c1 : 0)) + 1;
    if (drag) ({ r0, r1, c0, c1 } = drag.frame); // húzás közben a rács nem méreteződik át (a mutató alatti lyuk ne csússzon el)
    const S = Math.max(10, Math.min(44, Math.floor(Math.min((W - 20) / (c1 - c0 + 1), (H - 20) / (r1 - r0 + 1)))));
    const ox = (W - (c1 - c0 + 1) * S) / 2, oy = (H - (r1 - r0 + 1) * S) / 2;
    const X = (c: number) => ox + (c - c0 + 0.5) * S, Y = (r: number) => oy + (r - r0 + 0.5) * S;
    (cv as any)._map = { r0, c0, r1, c1, S, ox, oy };
    ctx.fillStyle = '#ead6a8'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#4a3c24';
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { ctx.beginPath(); ctx.arc(X(c), Y(r), S * 0.14, 0, 7); ctx.fill(); }
    // test
    const body = form && tab !== 'json' ? { fill: form.fill, text: form.bodyText } : null;
    if (pts.length) {
      const fill = body ? body.fill : '#7d8b84';
      const B = bodyRect(form && tab !== 'json' ? form : { pad: 0.6, ext: { t: 0, b: 0, l: 0, r: 0 }, bodyText: '' }, pts);
      const br0 = B.r0 + 0.5, br1 = B.r1 - 0.5, bc0 = B.c0 + 0.5, bc1 = B.c1 - 0.5;
      ctx.fillStyle = fill; ctx.globalAlpha = body ? 0.92 : 0.35;
      ctx.fillRect(X(bc0) - S / 2, Y(br0) - S / 2, (bc1 - bc0 + 1) * S, (br1 - br0 + 1) * S);
      ctx.globalAlpha = 1; ctx.strokeStyle = darken(fill); ctx.lineWidth = 1.2;
      ctx.strokeRect(X(bc0) - S / 2, Y(br0) - S / 2, (bc1 - bc0 + 1) * S, (br1 - br0 + 1) * S);
      if (body && body.text) { const pinTop = Math.min(...rs) - 0.5, tr = pinTop - B.r0 >= 1 ? (B.r0 + pinTop) / 2 : (B.r0 + B.r1) / 2;
        ctx.fillStyle = lightText(fill) ? '#f1f3f5' : '#1d231f'; ctx.font = `600 ${Math.max(9, S * 0.5)}px ui-monospace,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(body.text, X((B.c0 + B.c1) / 2), Y(tr)); }
    }
    // lábak (a kijelölt modellelem kivezetései lilával, sorszámmal: 1. vég, 2. vég…)
    const modelPins = form && tab === 'func' && selModel >= 0 && form.model[selModel] ? form.model[selModel].pins : form && tab === 'func' ? logicPins(form) : [];
    ctx.font = `600 ${Math.max(8, S * 0.36)}px ui-monospace,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const nm = form && tab !== 'json' ? form.names : 'below';
    const Bc = pts.length ? bodyRect(form && tab !== 'json' ? form : { pad: 0.6, ext: { t: 0, b: 0, l: 0, r: 0 }, bodyText: '' }, pts) : { r0: 0, r1: 0, c0: 0, c1: 0 };
    const LP = nm === 'none' ? [] : pinLabelPositions(pts, nm, 0.62, { r: (Bc.r0 + Bc.r1) / 2, c: (Bc.c0 + Bc.c1) / 2 });
    pts.forEach((p, i) => {
      const x = X(p.lc), y = Y(p.lr);
      if (i === sel) { ctx.strokeStyle = '#a8571f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, S * 0.48, 0, 7); ctx.stroke(); }
      const mk = modelPins.indexOf(p.id);
      if (mk >= 0) { ctx.strokeStyle = '#7048e8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, S * 0.5, 0, 7); ctx.stroke();
        ctx.fillStyle = '#7048e8'; ctx.font = `700 ${Math.max(8, S * 0.34)}px ui-monospace,monospace`; ctx.fillText(String(mk + 1), x + S * 0.42, y - S * 0.42);
        ctx.font = `600 ${Math.max(8, S * 0.36)}px ui-monospace,monospace`; }
      ctx.fillStyle = host.roleColor(p.role); ctx.beginPath(); ctx.arc(x, y, S * 0.3, 0, 7); ctx.fill();
      ctx.fillStyle = '#e9ecef'; ctx.beginPath(); ctx.arc(x, y, S * 0.12, 0, 7); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,252,240,.9)'; ctx.fillStyle = '#1d231f';
      const L = LP[i];
      if (L) { ctx.textAlign = L.align; const tx = X(L.c), ty = Y(L.r); ctx.strokeText(p.name || p.id, tx, ty); ctx.fillText(p.name || p.id, tx, ty); ctx.textAlign = 'center'; }
    });
    if (pts.length) { ctx.strokeStyle = '#a8571f'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.strokeRect(X(pts[0].lc) - S * 0.45, Y(pts[0].lr) - S * 0.45, S * 0.9, S * 0.9); ctx.setLineDash([]); }
    $('cvhelp').textContent = tab === 'func' && form ? tr('A kijelölt elem vagy kimenet lábai kiemelve. Kattints egy lábra: a Lábak fülön kijelöli.') : tab === 'pins' && form
      ? tr('Kattints egy üres lyukra: új láb oda. Kattints egy lábra: kijelölés a táblázatban; húzva áthelyezhető. A szaggatott keret a lerakási pont.')
      : tr('JSON-nézetben az előnézet csak a lábakat mutatja (alapértékekkel).');
  }
  function pinsOfJson(d: PartDef | null): Array<{ id: string; name: string; lr: number; lc: number; role: string }> {
    if (!d || !Array.isArray(d.pins)) return [];
    return d.pins.filter(p => typeof p.lr === 'number' && typeof p.lc === 'number' && p.repeat == null)
      .map(p => ({ id: p.id, name: p.name || p.id, lr: p.lr as number, lc: p.lc as number, role: p.role || 'h' }));
  }

  // ---------- műveletek ----------
  const nextId = (f: Form) => { const n = f.pins.map(p => +p.id).filter(x => isFinite(x)); return String(n.length ? Math.max(...n) + 1 : f.pins.length + 1); };

  function addPins(f: Form, n: number, dir: 'h' | 'v', r: number, c: number, names: string[]): void {
    const taken = new Set(f.pins.map(p => p.lr + ':' + p.lc));
    for (let i = 0; i < n; i++) {
      const lr = dir === 'v' ? r + i : r, lc = dir === 'h' ? c + i : c;
      if (taken.has(lr + ':' + lc)) continue;
      const id = nextId(f), name = (names[i] || '').trim() || id;
      f.pins.push({ id, name, lr, lc, role: names[i] ? guessRole(name) : 'sig', group: '' });
    }
  }

  /** Az előnézet lyuka a mutató alatt (az aktuális rajz szerint). */
  const cellAt = (e: PointerEvent | MouseEvent): { r: number; c: number } | null => {
    const m = (cv as any)._map; if (!m) return null;
    const rc = cv.getBoundingClientRect();
    return { c: Math.round((e.clientX - rc.left - m.ox) / m.S - 0.5) + m.c0, r: Math.round((e.clientY - rc.top - m.oy) / m.S - 0.5) + m.r0 };
  };
  /** Láb áthelyezése húzással: a megfogott láb a mutató alatti szabad lyukba kerül. */
  cv.addEventListener('pointerdown', e => {
    if (!form || tab === 'json' || e.button !== 0) return;
    const at = cellAt(e); if (!at) return;
    const i = form.pins.findIndex(p => p.lr === at.r && p.lc === at.c); if (i < 0) return;
    const m = (cv as any)._map;
    drag = { i, moved: false, frame: { r0: m.r0, r1: m.r1, c0: m.c0, c1: m.c1 } }; sel = i; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; drawPreview();
  });
  cv.addEventListener('pointermove', e => {
    if (!form || tab === 'json') return;
    const at = cellAt(e); if (!at) return;
    if (!drag) { cv.style.cursor = form.pins.some(p => p.lr === at.r && p.lc === at.c) ? 'grab' : ''; return; }
    const p = form.pins[drag.i], F = drag.frame;
    if (at.r < F.r0 || at.r > F.r1 || at.c < F.c0 || at.c > F.c1) return; // a látható rácson belül
    if ((p.lr === at.r && p.lc === at.c) || form.pins.some(q => q !== p && q.lr === at.r && q.lc === at.c)) return;
    p.lr = at.r; p.lc = at.c; drag.moved = true; refresh();
  });
  const dragStop = (e: PointerEvent) => {
    if (!drag) return;
    const d = drag; drag = null; cv.style.cursor = ''; if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
    if (d.moved) { dragEnd = Date.now(); if (tab !== 'pins') tab = 'pins'; render(); left.querySelector(`tr[data-row="${sel}"]`)?.scrollIntoView({ block: 'nearest' }); }
  };
  cv.addEventListener('pointerup', dragStop);
  cv.addEventListener('pointercancel', dragStop);
  cv.addEventListener('click', e => {
    if (Date.now() - dragEnd < 300) return; // húzás után nincs kattintás (új láb)
    if (!form || tab === 'json') return;
    if (tab !== 'pins') tab = 'pins';
    const m = (cv as any)._map; if (!m) return;
    const rc = cv.getBoundingClientRect();
    const c = Math.round((e.clientX - rc.left - m.ox) / m.S - 0.5) + m.c0, r = Math.round((e.clientY - rc.top - m.oy) / m.S - 0.5) + m.r0;
    const i = form.pins.findIndex(p => p.lr === r && p.lc === c);
    if (i >= 0) sel = i;
    else { addPins(form, 1, 'h', r, c, []); sel = form.pins.length - 1; }
    render();
    const row = left.querySelector(`tr[data-row="${sel}"]`); row?.scrollIntoView({ block: 'nearest' });
  });

  back.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'pe_json') { // élő ellenőrzés gépelés közben
      jsonText = t.value;
      try { jsonDef = JSON.parse(jsonText); jsonErr = ''; } catch (err) { jsonErr = tr('Hibás JSON: {x}', { x: err instanceof Error ? err.message : String(err) }); }
      refresh(); return;
    }
    if (logicEvent('input', t)) return;
    if (!form || tab === 'json') return;
    if (t.dataset.f) {
      const k = t.dataset.f as keyof Form;
      if (k === 'pad') form.pad = Math.max(0.3, Math.min(3, +t.value || 0.6));
      else if (k === 'showLabel') form.showLabel = t.checked;
      else if (k === 'off') form.off = t.checked;
      else if (k === 'names') form.names = t.value as Form['names'];
      else if (k === 'name' || k === 'prefix' || k === 'cat' || k === 'bodyText') form[k] = t.value;
      refresh(); return;
    }
    if (t.dataset.ext) { form.ext[t.dataset.ext as keyof Form['ext']] = Math.max(0, Math.min(40, +t.value || 0)); refresh(); return; }
    if (t.dataset.pin != null) {
      const p = form.pins[+t.dataset.pin], k = t.dataset.k as keyof PinRow;
      if (k === 'lr' || k === 'lc') p[k] = Math.round(+t.value || 0);
      else if (k === 'id') {
        const old = p.id; p.id = t.value.trim();
        for (const m of form.model) m.pins = m.pins.map(x => (x === old ? p.id : x));
        if (form.press) form.press = form.press.map(x => (x === old ? p.id : x)) as [string, string];
        if (form.logic) { const L = form.logic; if (L.vcc === old) L.vcc = p.id; if (L.gnd === old) L.gnd = p.id; for (const o of L.outs) if (o.pin === old) o.pin = p.id; }
        for (const n of form.graph?.nodes || []) if (n.pin === old) n.pin = p.id;
      } else p[k] = t.value;
      sel = +t.dataset.pin; refresh(); return;
    }
    if (t.dataset.model != null && t.dataset.k?.startsWith('val')) { form.model[+t.dataset.model].vals[+t.dataset.k.slice(3)] = t.value; refresh(); return; }
    if (t.dataset.par != null && form.params) {
      const p = form.params[+t.dataset.par], k = t.dataset.k as 'key' | 'label' | 'unit' | 'def' | 'min' | 'max' | 'slider';
      if (!p) return;
      if (k === 'slider') p.slider = t.checked;
      else { p[k] = t.value; if (k === 'unit') { if (t.value.trim()) p.value = true; else delete p.value; } }
      refresh(); return;
    }
  });
  back.addEventListener('change', e => {
    const t = e.target as HTMLSelectElement & HTMLInputElement;
    if (t.id === 'pe_wide') { wide = t.checked; render(); return; }
    if (t.id === 'pe_from' && t.value) {
      const d: PartDef = JSON.parse(JSON.stringify(host.builtin[t.value])); d.name += ' ' + tr('(másolat)'); delete d.meta;
      jsonDef = d; jsonText = ''; jsonErr = ''; tab = 'json'; pending = null; render(); return;
    }
    if (logicEvent('change', t)) return;
    if (!form || tab === 'json') return;
    if (t.dataset.pin != null && t.dataset.k === 'name' && form.logic && nameBefore != null) {
      // lábátnevezés: a logikai kifejezésekben is
      const nw = t.value.trim(), old = nameBefore; nameBefore = nw;
      if (nw && old && nw !== old && /^[A-Za-z0-9_]+$/.test(nw)) { for (const o of form.logic.outs) { o.expr = renameVars(o.expr, old, nw); o.oe = renameVars(o.oe, old, nw); } if (form.logic.tableVars) form.logic.tableVars = form.logic.tableVars.map(v => (v === old ? nw : v)); }
      return;
    }
    if (t.dataset.pin != null && t.dataset.k === 'role') {
      form.pins[+t.dataset.pin].role = t.value;
      // a további adatok (Táp, Funkció) a szerephez igazodnak: keskeny táblázatnál a részletsor cserélődik, különben újrarajzolás
      const i = +t.dataset.pin, det = left.querySelector(`.pe-det[data-det="${i}"]`);
      if (!wide && det) { det.outerHTML = detHtml(form.pins[i], i); refresh(); return; }
      render(); left.querySelector<HTMLElement>(`[data-pin="${i}"][data-k="role"]`)?.focus(); return;
    }
    if (t.dataset.model != null) {
      const m = form.model[+t.dataset.model], k = t.dataset.k || '';
      if (k === 'el') { m.el = t.value as ModelKind; m.pins = MODEL_UI[m.el].pins.map((_, j) => m.pins[j] || ''); m.vals = MODEL_UI[m.el].vals.map(v => fmtSI(v[3])); render(); return; }
      if (k === 'mux') { m.mux = t.checked ? 'matrix' : 'fixed'; refresh(); return; }
      if (k.startsWith('pin')) { m.pins[+k.slice(3)] = t.value; refresh(); }
      return;
    }
    if (t.dataset.pin != null && t.dataset.k === 'fn') { form.pins[+t.dataset.pin].fn = t.value || undefined; refresh(); return; }
    if (t.dataset.press === 'on') { form.press = t.checked ? [form.pins[0]?.id || '', form.pins[1]?.id || ''] : null; render(); return; }
    if (t.dataset.press === '0' || t.dataset.press === '1') { if (form.press) form.press[+t.dataset.press] = t.value; refresh(); }
  });
  back.addEventListener('focusin', e => {
    const t = e.target as HTMLElement;
    if (t.dataset.pin != null && t.dataset.k === 'name' && form) nameBefore = form.pins[+t.dataset.pin]?.name ?? null;
    const mi = t.dataset.model != null ? +t.dataset.model : -1;
    if (mi !== selModel) { selModel = mi; drawPreview(); }
    if (t.dataset.pin != null && +t.dataset.pin !== sel) {
      sel = +t.dataset.pin;
      if (!wide && tab === 'pins' && form) { // a részletsor a kijelölt láb alá kerül (a fókuszban lévő mező marad)
        left.querySelector('.pe-det')?.remove();
        left.querySelector(`tr[data-row="${sel}"]`)?.insertAdjacentHTML('afterend', detHtml(form.pins[sel], sel));
      }
      left.querySelectorAll('tr[data-row]').forEach(tr => tr.classList.toggle('on', (tr as HTMLElement).dataset.row === String(sel)));
      drawPreview();
    }
  });
  probsEl.addEventListener('click', e => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-prob]'); if (!li) return;
    const p = problems()[+li.dataset.prob!]; if (p) goTo(whereOf(p));
  });
  probsEl.addEventListener('keydown', e => { if (e.key === 'Enter') (e.target as HTMLElement).click(); });
  const onClick = (e: MouseEvent) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (logicEvent('click', b)) return;
    if (b.dataset.tab) { switchTab(b.dataset.tab as Tab); return; }
    if (b.dataset.vtab) { vtab = b.dataset.vtab as typeof vtab; showVtab(); $('vscroll').scrollTop = 0; return; }
    if (b.dataset.jump) { left.querySelector(`#pe_s_${b.dataset.jump}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
    if (b.dataset.fill && form) { form.fill = b.dataset.fill; render(); return; }
    const act = b.dataset.act;
    if (act === 'close') return close();
    if (act === 'undo' || act === 'redo') { histGo(act === 'redo'); return; }
    if (act === 'toform' && pending) { form = pending.form; tab = pending.to; pending = null; histReset(); render(); return; }
    if (act === 'stayjson') { pending = null; render(); return; }
    if (act === 'discard') {
      const idle = () => { b.innerHTML = icon('trash'); b.classList.remove('danger', 'confirm'); };
      if (Date.now() - confirmDiscard > 3000) { confirmDiscard = Date.now(); b.innerHTML = `${icon('trash')}<span>${tr('Biztos? Kattints újra')}</span>`; b.classList.add('danger', 'confirm'); setTimeout(() => { if (Date.now() - confirmDiscard >= 2900) idle(); }, 3000); return; }
      confirmDiscard = 0; idle(); b.disabled = true; putDraft(draftKey, null); setParked(draftKey, false); initial(); sel = -1; selModel = -1; clean = snapshot(); histReset(); render(); return;
    }
    if (act === 'addpar' && form) {
      const ps = form.params || (form.params = []);
      let k = 'p1'; for (let i = 1; ps.some(x => x.key === k); i++) k = 'p' + (i + 1);
      ps.push({ key: k, label: tr('Új paraméter'), unit: '', def: '0', min: '', max: '', step: '', slider: false }); render(); return;
    }
    if (act === 'delpar' && form && form.params) { form.params.splice(+(b.dataset.i || 0), 1); if (!form.params.length) delete form.params; render(); return; }
    if (act === 'gen' && form) {
      const n = Math.max(1, Math.min(40, +(left.querySelector<HTMLInputElement>('#pe_gn')!.value) || 1));
      const dir = left.querySelector<HTMLSelectElement>('#pe_gdir')!.value as 'h' | 'v';
      const r = Math.round(+left.querySelector<HTMLInputElement>('#pe_gr')!.value || 0), c = Math.round(+left.querySelector<HTMLInputElement>('#pe_gc')!.value || 0);
      const names = left.querySelector<HTMLInputElement>('#pe_gnames')!.value.split(',').map(s => s.trim()).filter(Boolean);
      addPins(form, names.length || n, dir, r, c, names);
      render(); return;
    }
    if (act === 'delpin' && form) {
      const i = +b.dataset.i!, id = form.pins[i].id; form.pins.splice(i, 1); sel = -1;
      for (const m of form.model) m.pins = m.pins.map(x => (x === id ? '' : x));
      if (form.press) form.press = form.press.map(x => (x === id ? '' : x)) as [string, string];
      if (form.logic) { const L = form.logic; if (L.vcc === id) L.vcc = ''; if (L.gnd === id) L.gnd = ''; for (const o of L.outs) if (o.pin === id) o.pin = ''; }
      for (const n of form.graph?.nodes || []) if (n.pin === id) n.pin = '';
      render(); return;
    }
    if (act === 'addmodel' && form) { form.model.push({ el: 'resistor', pins: [form.pins[0]?.id || '', form.pins[1]?.id || ''], vals: ['1k'] }); render(); return; }
    if (act === 'delmodel' && form) { form.model.splice(+b.dataset.i!, 1); render(); return; }
    if (act === 'applyjson') {
      const ta = left.querySelector<HTMLTextAreaElement>('#pe_json')!; jsonText = ta.value;
      try { const d = JSON.parse(jsonText); jsonErr = ''; jsonDef = d; }
      catch (err) { jsonErr = tr('Hibás JSON: {x}', { x: err instanceof Error ? err.message : String(err) }); }
      render(); return;
    }
    if (act === 'save') {
      const d = currentDef(); if (!d || hasErrors(problems())) return refresh();
      const t = host.save(opts.type ?? null, d);
      putDraft(draftKey, null); close(false);
      if (!existing) host.place(t); // új alkatrész: rögtön lerakható
      return;
    }
    if (act === 'delete' && opts.type) {
      const n = host.usage(opts.type);
      if (n && Date.now() - confirmDel > 3000) { confirmDel = Date.now(); b.textContent = tr('Biztos? {n} példány is törlődik', { n }); return; }
      host.remove(opts.type); putDraft(draftKey, null); close(false); return;
    }
  };
  back.addEventListener('click', onClick);
  // a gombsor (acts) a szerkesztőben van: a kattintása a back-en keresztül érkezik

  render();
  if (!restored && snapshot() !== clean) { clean = snapshot(); refresh(); } // a JSON-szöveg az első megjelenítéskor áll elő: az még nem módosítás
  (back.querySelector('#pe_name') as HTMLInputElement | null)?.focus();
}
