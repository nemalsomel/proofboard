/**
 * Alkatrész-szerkesztő: saját modulok leírása űrlappal (lábak, csoportok, test, villamos modell,
 * vezérlő) vagy közvetlenül JSON-ban. Az eredmény szabályos PartDef, amit a többi rész ugyanúgy
 * használ, mint a beépített alkatrészeket.
 */
import { fmtSI, parseSI } from '../core/expr';
import { hasErrors, validatePartDef, type Problem } from '../core/validate';
import type { ModelEl, PartDef, Prim } from '../core/schema';

export interface EditorHost {
  builtin: Record<string, PartDef>;
  custom(): Record<string, PartDef>;
  /** Mentés; `type` null új alkatrésznél. Visszaadja a típuskulcsot. */
  save(type: string | null, def: PartDef): string;
  remove(type: string): void;
  /** Hány példány van a tervben. */
  usage(type: string): number;
  /** Lerakás indítása a panelon. */
  place(type: string): void;
  roleColor(role: string): string;
}

/** Saját alkatrészeknél választható lábszerepek. */
export const ROLES: Array<[string, string]> = [
  ['sig', 'jel / adat'], ['vin', 'tápbemenet'], ['gnd', 'föld (GND)'], ['adc', 'analóg jel'],
  ['an', 'anód / +'], ['ka', 'katód / −'], ['nc', 'nincs bekötve'], ['h', 'általános'],
];

type ModelKind = 'resistor' | 'diode' | 'source' | 'nmos' | 'capacitor' | 'npn' | 'motor';
const MODEL_UI: Record<ModelKind, { label: string; pins: Array<[string, string]>; vals: Array<[string, string, string, number]> }> = {
  resistor: { label: 'Ellenállás', pins: [['a', '1. vég'], ['b', '2. vég']], vals: [['ohm', 'Érték', 'Ω', 1000]] },
  diode: { label: 'Dióda', pins: [['a', 'anód'], ['k', 'katód']], vals: [['vf', 'Nyitófesz.', 'V', 0.7]] },
  source: { label: 'Feszültségforrás', pins: [['p', '+'], ['n', '−']], vals: [['v', 'Feszültség', 'V', 3.3]] },
  nmos: { label: 'N-MOSFET', pins: [['d', 'drain'], ['g', 'gate'], ['s', 'source']], vals: [['vth', 'Küszöb', 'V', 2], ['ron', 'Nyitott ell.', 'Ω', 1]] },
  capacitor: { label: 'Kondenzátor', pins: [['a', '1. vég (+)'], ['b', '2. vég']], vals: [['f', 'Kapacitás', 'F', 100e-9], ['vmax', 'Névleges fesz.', 'V', 16]] },
  motor: { label: 'DC motor', pins: [['a', '+'], ['b', '−']], vals: [['ohm', 'Üzemi ell.', 'Ω', 20], ['vnom', 'Névleges fesz.', 'V', 3]] },
  npn: { label: 'NPN tranzisztor', pins: [['c', 'kollektor'], ['b', 'bázis'], ['e', 'emitter']], vals: [['beta', 'Erősítés (β)', '', 200]] },
};

interface PinRow { id: string; name: string; lr: number; lc: number; role: string; group: string; volt?: string }
interface ModelRow { el: ModelKind; pins: string[]; vals: string[] }
interface Form {
  name: string; prefix: string; cat: string; bodyText: string;
  pad: number; fill: string; showLabel: boolean; names: 'below' | 'above' | 'none';
  /** Külső alkatrész (motor, szenzor kábelen): a panel mellé kerül, a lábai kivezetések. */
  off?: boolean;
  /** A test kiterjesztése a lábakon túl (lyukban): fent, lent, balra, jobbra. */
  ext: { t: number; b: number; l: number; r: number };
  pins: PinRow[]; model: ModelRow[]; press: [string, string] | null;
}

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));
const FILLS = ['#1b4f8a', '#1f6b4a', '#7a1f2b', '#2a2a2a', '#5f3dc4', '#c2410c', '#d9d2bf'];

/** Szerep tippelése a láb nevéből (generátorhoz). */
export function guessRole(name: string): string {
  const n = name.trim().toUpperCase();
  if (/^(GND|VSS|0V|GROUND|−|-)$/.test(n)) return 'gnd';
  if (/^(VCC|VDD|VIN|V\+|\+|5V|3V3|3\.3V|VBAT|BAT\+|IN\+|OUT\+|B\+)$/.test(n)) return 'vin';
  if (/^(NC|N\/C)$/.test(n)) return 'nc';
  if (/^(A\d|VR[XY]|AIN\d*|ADC\d*)$/.test(n)) return 'adc';
  return 'sig';
}

function darken(hex: string, k = 0.6): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}
function lightText(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 150;
}

/** A test téglalapja a lábak és a beállítások alapján (felirat esetén legalább 2,4 lyuk magas). */
/** Feszültségtartomány szövegből: "2.7-3.6", "–5.5" (csak max), "4.5-" (csak min). */
export function parseRange(t: string | undefined): { vmin?: number; vmax?: number } {
  const m = /^\s*([\d.,]*)\s*[-–]\s*([\d.,]*)\s*$/.exec(t || '');
  if (!m) return {};
  const n = (x: string) => (x ? parseFloat(x.replace(',', '.')) : NaN);
  const o: { vmin?: number; vmax?: number } = {};
  if (isFinite(n(m[1]))) o.vmin = n(m[1]);
  if (isFinite(n(m[2]))) o.vmax = n(m[2]);
  return o;
}

export function bodyRect(f: Pick<Form, 'pad' | 'ext' | 'bodyText'>, pins: ReadonlyArray<{ lr: number; lc: number }>) {
  const rs = pins.map(p => p.lr), cs = pins.map(p => p.lc);
  const pr0 = Math.min(...rs, Infinity) === Infinity ? 0 : Math.min(...rs), pr1 = pins.length ? Math.max(...rs) : 0;
  const pc0 = pins.length ? Math.min(...cs) : 0, pc1 = pins.length ? Math.max(...cs) : 0;
  const e = f.ext || { t: 0, b: 0, l: 0, r: 0 };
  let t = Math.max(0, e.t);
  const h = pr1 - pr0 + 2 * f.pad + t + Math.max(0, e.b);
  if (f.bodyText.trim() && h < 2.4) t += 2.4 - h;
  return { r0: pr0 - f.pad - t, r1: pr1 + f.pad + Math.max(0, e.b), c0: pc0 - f.pad - Math.max(0, e.l), c1: pc1 + f.pad + Math.max(0, e.r) };
}

/** Űrlapból szabályos alkatrész-leírás. Az első láb kerül a 0:0 (lerakási) pontra. */
export function formToDef(f: Form): PartDef {
  const o = f.pins[0] || { lr: 0, lc: 0 };
  const pins = f.pins.map(p => ({ ...p, lr: p.lr - o.lr, lc: p.lc - o.lc }));
  const rs = pins.map(p => p.lr), cs = pins.map(p => p.lc);
  const B = bodyRect(f, pins), mc = (B.c0 + B.c1) / 2;
  const graphics: Prim[] = [{ shape: 'rect', layer: 'body', r: [B.r0, B.r1], c: [B.c0, B.c1], fill: f.fill, stroke: darken(f.fill), width: 1.2 }];
  if (f.bodyText.trim()) {
    // a felirat a lábsoron kívüli részre kerül, ha van ilyen
    const pinTop = Math.min(...rs) - 0.5, free = pinTop - B.r0;
    const tr = free >= 1 ? (B.r0 + pinTop) / 2 : (B.r0 + B.r1) / 2;
    graphics.push({ shape: 'text', layer: 'detail', at: [tr, mc], text: f.bodyText.trim(), size: 0.5, min: 8, color: lightText(f.fill) ? '#f1f3f5' : '#1d231f', xray: { color: '#1d231f' } });
  }
  if (f.showLabel) graphics.push({ shape: 'text', layer: 'label', at: f.names === 'above' ? [B.r1 + 0.6, mc] : [B.r0 - 0.6, mc], text: '{label}', size: 0.42 });
  const groups: string[][] = [];
  const byG = new Map<string, string[]>();
  for (const p of pins) if (p.group.trim()) { const k = p.group.trim(); byG.set(k, [...(byG.get(k) || []), p.id]); }
  for (const ids of byG.values()) if (ids.length > 1) groups.push(ids);
  const model: ModelEl[] = f.model.map(m => {
    const v = (i: number) => { const x = parseSI(m.vals[i]); return isFinite(x) ? x : MODEL_UI[m.el].vals[i][3]; };
    switch (m.el) {
      case 'resistor': return { el: 'resistor', a: m.pins[0], b: m.pins[1], ohm: v(0) };
      case 'diode': return { el: 'diode', a: m.pins[0], k: m.pins[1], vf: v(0), ron: 0.5 };
      case 'source': return { el: 'source', p: m.pins[0], n: m.pins[1], v: v(0), rint: 0.1 };
      case 'nmos': return { el: 'nmos', d: m.pins[0], g: m.pins[1], s: m.pins[2], vth: v(0), ron: v(1) };
      case 'capacitor': return { el: 'capacitor', a: m.pins[0], b: m.pins[1], f: v(0), vmax: v(1) };
      case 'motor': return { el: 'motor', a: m.pins[0], b: m.pins[1], ohm: v(0), vnom: v(1) };
      case 'npn': return { el: 'npn', c: m.pins[0], b: m.pins[1], e: m.pins[2], beta: v(0) };
    }
  });
  const oneRow = new Set(rs).size === 1 || new Set(cs).size === 1;
  const def: PartDef = {
    name: f.name.trim(), prefix: f.prefix.trim(), cat: f.cat.trim() || 'Saját',
    fp: `${pins.length} láb${oneRow && pins.length > 1 ? ' egy sorban' : ''}`,
    pins: pins.map(p => Object.assign({ id: p.id, name: p.name || p.id, lr: p.lr, lc: p.lc, role: p.role }, p.role === 'vin' ? parseRange(p.volt) : {})),
    bounds: { r: [B.r0, B.r1], c: [B.c0, B.c1] },
    graphics,
    meta: { editor: 1, form: JSON.parse(JSON.stringify(f)) },
  };
  if (groups.length) def.groups = groups;
  if (f.off) { def.mount = 'off'; def.fp = `külső · ${pins.length} kivezetés`; }
  if (f.names !== 'none') def.pinLabels = { mode: 'name', off: f.names === 'below' ? 0.75 : -0.75 };
  if (model.length) def.model = model;
  if (f.press && f.press[0] && f.press[1]) def.controls = [{ kind: 'press', closes: [[f.press[0], f.press[1]]] }];
  return def;
}

const newForm = (): Form => ({ name: 'Új modul', prefix: 'U', cat: 'Saját', bodyText: '', pad: 0.6, ext: { t: 0, b: 0, l: 0, r: 0 }, fill: FILLS[0], showLabel: true, names: 'below', pins: [], model: [], press: null });
const formOf = (def: PartDef): Form | null => {
  const f = def.meta && (def.meta as { form?: Form }).form;
  if (!f || !Array.isArray(f.pins)) return null;
  const c: Form = JSON.parse(JSON.stringify(f));
  c.ext = Object.assign({ t: 0, b: 0, l: 0, r: 0 }, c.ext || {});
  return c;
};

/** A szerkesztő megnyitása. `type`: meglévő saját alkatrész; `from`: kiindulási leírás (pl. beépített másolata). */
export function openEditor(host: EditorHost, opts: { type?: string; from?: PartDef } = {}): void {
  const existing = opts.type ? host.custom()[opts.type] : undefined;
  const start = existing || opts.from;
  let form: Form | null = start ? formOf(start) : newForm();
  let jsonDef: PartDef | null = form ? null : JSON.parse(JSON.stringify(start));
  if (jsonDef && opts.from && !existing) { jsonDef.name = jsonDef.name + ' (másolat)'; delete jsonDef.meta; }
  let tab: 'form' | 'json' = form ? 'form' : 'json';
  let sel = -1;
  let jsonText = '';
  let jsonErr = '';
  let confirmDel = 0;

  const back = document.createElement('div');
  back.className = 'pe-back';
  back.innerHTML = `
    <div class="pe" role="dialog" aria-modal="true" aria-label="Alkatrész-szerkesztő">
      <header class="pe-head">
        <b>Alkatrész-szerkesztő</b><span class="muted small" data-ref="sub"></span>
        <div class="pe-tabs" role="tablist"><button class="btn" data-tab="form" role="tab">Űrlap</button><button class="btn" data-tab="json" role="tab">JSON</button></div>
        <button class="btn" data-act="close" aria-label="Bezárás" title="Bezárás (Esc)">✕</button>
      </header>
      <div class="pe-body">
        <div class="pe-left" data-ref="left"></div>
        <div class="pe-right">
          <canvas class="pe-cv" data-ref="cv" aria-label="Előnézet"></canvas>
          <p class="help" data-ref="cvhelp">Kattints egy üres lyukra: új láb oda. Kattints egy lábra: kijelölés a táblázatban.</p>
          <p class="h" style="margin:12px 0 6px">Ellenőrzés</p>
          <ul class="issues" data-ref="probs"></ul>
        </div>
      </div>
      <footer class="pe-foot">
        ${existing ? '<button class="btn danger" data-act="delete">Törlés</button>' : ''}
        <span style="flex:1"></span>
        <button class="btn" data-act="close">Mégse</button>
        <button class="btn" data-act="save">Mentés</button>
        <button class="btn on" data-act="saveplace">Mentés és lerakás</button>
      </footer>
    </div>`;
  document.body.appendChild(back);
  const $ = <T extends HTMLElement = HTMLElement>(ref: string) => back.querySelector(`[data-ref="${ref}"]`) as T;
  const left = $('left'), cv = $<HTMLCanvasElement>('cv'), probsEl = $('probs');
  const prevFocus = document.activeElement as HTMLElement | null;

  const currentDef = (): PartDef | null => (tab === 'form' && form ? formToDef(form) : jsonDef);
  const problems = (): Problem[] => {
    if (tab === 'json' && jsonErr) return [{ level: 'error', path: 'json', msg: jsonErr }];
    const d = currentDef();
    if (!d) return [{ level: 'error', path: '', msg: 'Nincs leírás.' }];
    const ps = validatePartDef(d);
    if (form && tab === 'form' && !form.pins.length) return [{ level: 'error', path: 'pins', msg: 'Adj hozzá lábakat: kattints az előnézetre, vagy használd a lábsor-generátort.' }];
    return ps;
  };

  const close = () => { back.remove(); document.removeEventListener('keydown', onDocKey, true); prevFocus?.focus?.(); };
  const onDocKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onDocKey, true);
  back.addEventListener('keydown', e => e.stopPropagation());
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });

  // ---------- megjelenítés ----------
  function render(): void {
    $('sub').textContent = existing ? ` · ${existing.name}` : opts.from ? ' · új, másolatból' : ' · új alkatrész';
    back.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
      if (b.dataset.tab === 'form') b.disabled = !form;
    });
    left.innerHTML = tab === 'form' && form ? formHtml(form) : jsonHtml();
    refresh();
  }
  function refresh(): void {
    drawPreview();
    const ps = problems(), err = hasErrors(ps);
    probsEl.innerHTML = ps.length
      ? ps.map(p => `<li class="${p.level === 'error' ? 'c-err' : 'c-warn'}"><span class="dot"></span><span style="color:var(--fg)">${esc(p.msg)}</span></li>`).join('')
      : '<li class="c-ok" style="cursor:default"><span class="dot"></span><span style="color:var(--fg)">A leírás rendben, menthető.</span></li>';
    back.querySelectorAll<HTMLButtonElement>('[data-act="save"],[data-act="saveplace"]').forEach(b => { b.disabled = err; });
  }
  const opt = (v: string, l: string, cur: string) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`;
  const pinOpts = (f: Form, cur: string) => '<option value="">–</option>' + f.pins.map(p => opt(p.id, `${p.id}${p.name && p.name !== p.id ? ' · ' + p.name : ''}`, cur)).join('');

  function formHtml(f: Form): string {
    const nextR = f.pins.length ? Math.max(...f.pins.map(p => p.lr)) + 2 : 0, nextC = f.pins.length ? Math.min(...f.pins.map(p => p.lc)) : 0;
    return `
      <section class="pe-sec">
        <p class="h">Alapadatok</p>
        <div class="pe-grid">
          <label for="pe_name">Név</label><input type="text" id="pe_name" data-f="name" value="${esc(f.name)}">
          <label for="pe_prefix">Előtag</label><input type="text" id="pe_prefix" data-f="prefix" value="${esc(f.prefix)}" style="width:90px" title="A példányok neve: előtag + sorszám, pl. U1, LCD1">
          <label for="pe_cat">Kategória</label><input type="text" id="pe_cat" data-f="cat" value="${esc(f.cat)}">
        </div>
      </section>
      <section class="pe-sec">
        <p class="h">Lábak <span class="muted">(${f.pins.length})</span></p>
        <div class="pe-gen">
          <span class="small">Lábsor:</span>
          <input type="number" id="pe_gn" value="${f.pins.length ? 4 : 8}" min="1" max="40" style="width:56px" aria-label="lábszám">
          <span class="small">db,</span>
          <select id="pe_gdir" aria-label="irány"><option value="h">vízszintes →</option><option value="v">függőleges ↓</option></select>
          <span class="small">innen:</span>
          <input type="number" id="pe_gr" value="${nextR}" style="width:56px" aria-label="kezdő sor"><span class="small">:</span><input type="number" id="pe_gc" value="${nextC}" style="width:56px" aria-label="kezdő oszlop">
          <input type="text" id="pe_gnames" placeholder="nevek vesszővel, pl. RST,CE,DC,DIN,CLK,VCC,BL,GND" style="flex:1 1 100%">
          <button class="btn" data-act="gen">Lábsor hozzáadása</button>
          <span class="help" style="flex:1 1 100%;margin:0">A szerepet a névből tippeli (GND, VCC, VIN…), utána a táblázatban állítható.</span>
        </div>
        <div class="tablewrap"><table class="tbl pe-pins">
          <thead><tr><th>Azon.</th><th>Név</th><th>Sor</th><th>Oszl.</th><th>Szerep</th><th title="Az azonos csoportú lábak gyárilag össze vannak kötve">Csoport</th><th title="Tápbemenetnél a megengedett feszültség, pl. 2.7-3.6">Táp (V)</th><th></th></tr></thead>
          <tbody>${f.pins.map((p, i) => `<tr class="${i === sel ? 'on' : ''}" data-row="${i}">
            <td><input type="text" data-pin="${i}" data-k="id" value="${esc(p.id)}" style="width:48px" aria-label="azonosító"></td>
            <td><input type="text" data-pin="${i}" data-k="name" value="${esc(p.name)}" style="width:84px" aria-label="név"></td>
            <td><input type="number" data-pin="${i}" data-k="lr" value="${p.lr}" style="width:52px" aria-label="sor"></td>
            <td><input type="number" data-pin="${i}" data-k="lc" value="${p.lc}" style="width:52px" aria-label="oszlop"></td>
            <td><select data-pin="${i}" data-k="role" aria-label="szerep">${ROLES.map(([v, l]) => opt(v, l, p.role)).join('')}</select></td>
            <td><input type="text" data-pin="${i}" data-k="group" value="${esc(p.group)}" style="width:52px" aria-label="csoport"></td>
            <td><input type="text" data-pin="${i}" data-k="volt" value="${esc(p.volt || '')}" placeholder="${p.role === 'vin' ? 'pl. 3-5.5' : ''}" ${p.role === 'vin' ? '' : 'disabled'} style="width:64px" aria-label="tápfeszültség-tartomány"></td>
            <td><button class="btn" data-act="delpin" data-i="${i}" aria-label="Láb törlése" title="Láb törlése">×</button></td></tr>`).join('')}</tbody>
        </table></div>
        ${f.pins.length ? '<p class="help">Az első láb lesz a lerakási pont (0:0); mentéskor a többi ehhez igazodik.</p>' : ''}
      </section>
      <section class="pe-sec">
        <p class="h">Test</p>
        <div class="pe-grid">
          <label>Szín</label><div class="swatches">${FILLS.map(c => `<button class="sw ${c === f.fill ? 'on' : ''}" data-fill="${c}" style="background:${c}" aria-label="${c}" title="${c}"></button>`).join('')}</div>
          <label for="pe_pad">Margó</label><input type="number" id="pe_pad" data-f="pad" value="${f.pad}" step="0.1" min="0.3" max="3" style="width:72px">
          <label>Kiterjesztés</label><div class="pe-ext">
            ${(['t', 'b', 'l', 'r'] as const).map(k => `<label class="small">${{ t: 'fent', b: 'lent', l: 'balra', r: 'jobbra' }[k]}<input type="number" id="pe_ext_${k}" data-ext="${k}" value="${f.ext[k]}" min="0" max="40" step="0.5" style="width:58px"></label>`).join('')}
            <span class="help" style="flex:1 1 100%;margin:0">A test mérete a lábakon túl, lyukban (pl. egy kijelzőpanel nagyobb a lábsoránál).</span></div>
          <label for="pe_btext">Felirat a testen</label><input type="text" id="pe_btext" data-f="bodyText" value="${esc(f.bodyText)}" placeholder="pl. TP4056">
          <label for="pe_names">Lábnevek</label><select id="pe_names" data-f="names">${opt('below', 'a lábak alatt', f.names)}${opt('above', 'a lábak felett', f.names)}${opt('none', 'nincsenek', f.names)}</select>
          <label></label><label class="check small"><input type="checkbox" data-f="showLabel" ${f.showLabel ? 'checked' : ''}> Példánynév kiírása (pl. U1)</label>
          <label></label><label class="check small" title="A panel mellé kerül; a lábaihoz kábel (vezeték) köt be"><input type="checkbox" data-f="off" ${f.off ? 'checked' : ''}> Külső alkatrész (kábellel bekötve)</label>
        </div>
      </section>
      <section class="pe-sec">
        <p class="h">Villamos modell</p>
        <p class="help">Mi történik az alkatrészen belül a szimulációban. Üresen az alkatrész csak lábakat ad (pl. egy csatlakozó vagy kijelző bemenetei).</p>
        ${f.model.map((m, i) => `<div class="pe-model">
          <select data-model="${i}" data-k="el" aria-label="elem típusa">${(Object.keys(MODEL_UI) as ModelKind[]).map(k => opt(k, MODEL_UI[k].label, m.el)).join('')}</select>
          ${MODEL_UI[m.el].pins.map(([, l], j) => `<label class="small">${esc(l)}</label><select data-model="${i}" data-k="pin${j}" aria-label="${esc(l)}">${pinOpts(f, m.pins[j] || '')}</select>`).join('')}
          ${MODEL_UI[m.el].vals.map(([, l, u], j) => `<label class="small">${esc(l)}</label><input type="text" data-model="${i}" data-k="val${j}" value="${esc(m.vals[j] ?? '')}" style="width:64px" aria-label="${esc(l)}"><span class="small muted">${u}</span>`).join('')}
          <button class="btn" data-act="delmodel" data-i="${i}" aria-label="Elem törlése">×</button></div>`).join('')}
        <button class="btn" data-act="addmodel" ${f.pins.length < 2 ? 'disabled' : ''}>+ Elem</button>
      </section>
      <section class="pe-sec">
        <p class="h">Vezérlő a szimulációban</p>
        <label class="check small"><input type="checkbox" data-press="on" ${f.press ? 'checked' : ''}> Nyomógombként működik: lenyomva összeköti</label>
        ${f.press ? `<div class="row" style="display:flex;gap:6px;align-items:center;margin-top:6px"><select data-press="0" aria-label="első láb">${pinOpts(f, f.press[0])}</select><span>↔</span><select data-press="1" aria-label="második láb">${pinOpts(f, f.press[1])}</select></div>` : ''}
      </section>`;
  }

  function jsonHtml(): string {
    const d = currentDef();
    if (!jsonText) { const c: PartDef | null = d ? JSON.parse(JSON.stringify(d)) : null; if (c) delete c.meta; jsonText = c ? JSON.stringify(c, null, 2) : ''; }
    return `
      <section class="pe-sec">
        <p class="help">${form ? 'A leírás teljes JSON-formája. Ha itt módosítod és alkalmazod, utána csak JSON-ban szerkeszthető tovább.' : 'Ez a leírás haladó elemeket tartalmaz (kifejezések, paraméterek, saját rajzelemek), ezért csak JSON-ban szerkeszthető. A mezők leírása: src/core/schema.ts.'}</p>
        <textarea class="pe-json" id="pe_json" spellcheck="false" aria-label="Leírás JSON">${esc(jsonText)}</textarea>
        <div class="grp" style="margin-top:8px"><button class="btn" data-act="applyjson">JSON alkalmazása</button>
          <label class="small muted">Kiindulás beépítettből: <select id="pe_from" aria-label="beépített alkatrész"><option value="">–</option>${Object.entries(host.builtin).map(([k, d]) => `<option value="${k}">${esc(d.name)}</option>`).join('')}</select></label></div>
      </section>`;
  }

  // ---------- előnézet ----------
  function drawPreview(): void {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.clientWidth || 400, H = Math.round(Math.min(360, Math.max(220, W * 0.75)));
    const dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = currentDef();
    const pts = (tab === 'form' && form ? form.pins.map(p => ({ id: p.id, name: p.name, lr: p.lr, lc: p.lc, role: p.role })) : pinsOfJson(d));
    const rs = pts.map(p => p.lr), cs = pts.map(p => p.lc);
    const BB = pts.length && form && tab === 'form' ? bodyRect(form, pts) : null;
    const r0 = Math.floor(Math.min(0, ...rs, BB ? BB.r0 : 0)) - 1, r1 = Math.ceil(Math.max(0, ...rs, BB ? BB.r1 : 0)) + 1;
    const c0 = Math.floor(Math.min(0, ...cs, BB ? BB.c0 : 0)) - 1, c1 = Math.ceil(Math.max(0, ...cs, BB ? BB.c1 : 0)) + 1;
    const S = Math.max(10, Math.min(34, Math.floor(Math.min((W - 20) / (c1 - c0 + 1), (H - 20) / (r1 - r0 + 1)))));
    const ox = (W - (c1 - c0 + 1) * S) / 2, oy = (H - (r1 - r0 + 1) * S) / 2;
    const X = (c: number) => ox + (c - c0 + 0.5) * S, Y = (r: number) => oy + (r - r0 + 0.5) * S;
    (cv as any)._map = { r0, c0, S, ox, oy };
    ctx.fillStyle = '#ead6a8'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#4a3c24';
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { ctx.beginPath(); ctx.arc(X(c), Y(r), S * 0.14, 0, 7); ctx.fill(); }
    // test
    const body = form && tab === 'form' ? { fill: form.fill, text: form.bodyText } : null;
    if (pts.length) {
      const fill = body ? body.fill : '#7d8b84';
      const B = bodyRect(form && tab === 'form' ? form : { pad: 0.6, ext: { t: 0, b: 0, l: 0, r: 0 }, bodyText: '' }, pts);
      const br0 = B.r0 + 0.5, br1 = B.r1 - 0.5, bc0 = B.c0 + 0.5, bc1 = B.c1 - 0.5;
      ctx.fillStyle = fill; ctx.globalAlpha = body ? 0.92 : 0.35;
      ctx.fillRect(X(bc0) - S / 2, Y(br0) - S / 2, (bc1 - bc0 + 1) * S, (br1 - br0 + 1) * S);
      ctx.globalAlpha = 1; ctx.strokeStyle = darken(fill); ctx.lineWidth = 1.2;
      ctx.strokeRect(X(bc0) - S / 2, Y(br0) - S / 2, (bc1 - bc0 + 1) * S, (br1 - br0 + 1) * S);
      if (body && body.text) { const pinTop = Math.min(...rs) - 0.5, tr = pinTop - B.r0 >= 1 ? (B.r0 + pinTop) / 2 : (B.r0 + B.r1) / 2;
        ctx.fillStyle = lightText(fill) ? '#f1f3f5' : '#1d231f'; ctx.font = `600 ${Math.max(9, S * 0.5)}px ui-monospace,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(body.text, X((B.c0 + B.c1) / 2), Y(tr)); }
    }
    // lábak
    ctx.font = `600 ${Math.max(8, S * 0.36)}px ui-monospace,monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    pts.forEach((p, i) => {
      const x = X(p.lc), y = Y(p.lr);
      if (i === sel) { ctx.strokeStyle = '#a8571f'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, S * 0.48, 0, 7); ctx.stroke(); }
      ctx.fillStyle = host.roleColor(p.role); ctx.beginPath(); ctx.arc(x, y, S * 0.3, 0, 7); ctx.fill();
      ctx.fillStyle = '#e9ecef'; ctx.beginPath(); ctx.arc(x, y, S * 0.12, 0, 7); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,252,240,.9)'; ctx.fillStyle = '#1d231f';
      const ty = y + (form && form.names === 'above' ? -S * 0.62 : S * 0.62);
      ctx.strokeText(p.name || p.id, x, ty); ctx.fillText(p.name || p.id, x, ty);
    });
    if (pts.length) { ctx.strokeStyle = '#a8571f'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5; ctx.strokeRect(X(pts[0].lc) - S * 0.45, Y(pts[0].lr) - S * 0.45, S * 0.9, S * 0.9); ctx.setLineDash([]); }
    $('cvhelp').textContent = tab === 'form' && form
      ? 'Kattints egy üres lyukra: új láb oda. Kattints egy lábra: kijelölés a táblázatban. A szaggatott keret a lerakási pont.'
      : 'JSON-nézetben az előnézet csak a lábakat mutatja (alapértékekkel).';
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

  cv.addEventListener('click', e => {
    if (!form || tab !== 'form') return;
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
    if (!form || tab !== 'form') return;
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
      } else p[k] = t.value;
      sel = +t.dataset.pin; refresh(); return;
    }
    if (t.dataset.model != null && t.dataset.k?.startsWith('val')) { form.model[+t.dataset.model].vals[+t.dataset.k.slice(3)] = t.value; refresh(); }
  });
  back.addEventListener('change', e => {
    const t = e.target as HTMLSelectElement & HTMLInputElement;
    if (t.id === 'pe_from' && t.value) {
      const d: PartDef = JSON.parse(JSON.stringify(host.builtin[t.value])); d.name += ' (másolat)'; delete d.meta;
      jsonDef = d; jsonText = ''; jsonErr = ''; form = null; tab = 'json'; render(); return;
    }
    if (!form || tab !== 'form') return;
    if (t.dataset.pin != null && t.dataset.k === 'role') {
      form.pins[+t.dataset.pin].role = t.value;
      const v = back.querySelector<HTMLInputElement>(`[data-pin="${t.dataset.pin}"][data-k="volt"]`);
      if (v) { v.disabled = t.value !== 'vin'; v.placeholder = t.value === 'vin' ? 'pl. 3-5.5' : ''; }
      refresh(); return;
    }
    if (t.dataset.model != null) {
      const m = form.model[+t.dataset.model], k = t.dataset.k || '';
      if (k === 'el') { m.el = t.value as ModelKind; m.pins = MODEL_UI[m.el].pins.map((_, j) => m.pins[j] || ''); m.vals = MODEL_UI[m.el].vals.map(v => fmtSI(v[3])); render(); return; }
      if (k.startsWith('pin')) { m.pins[+k.slice(3)] = t.value; refresh(); }
      return;
    }
    if (t.dataset.press === 'on') { form.press = t.checked ? [form.pins[0]?.id || '', form.pins[1]?.id || ''] : null; render(); return; }
    if (t.dataset.press === '0' || t.dataset.press === '1') { if (form.press) form.press[+t.dataset.press] = t.value; refresh(); }
  });
  back.addEventListener('focusin', e => {
    const t = e.target as HTMLElement;
    if (t.dataset.pin != null && +t.dataset.pin !== sel) {
      sel = +t.dataset.pin;
      left.querySelectorAll('tr[data-row]').forEach(tr => tr.classList.toggle('on', (tr as HTMLElement).dataset.row === String(sel)));
      drawPreview();
    }
  });
  back.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.tab) {
      const t = b.dataset.tab as 'form' | 'json';
      if (t === 'json') jsonText = '';
      tab = t; render(); return;
    }
    if (b.dataset.fill && form) { form.fill = b.dataset.fill; render(); return; }
    const act = b.dataset.act;
    if (act === 'close') return close();
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
      render(); return;
    }
    if (act === 'addmodel' && form) { form.model.push({ el: 'resistor', pins: [form.pins[0]?.id || '', form.pins[1]?.id || ''], vals: ['1k'] }); render(); return; }
    if (act === 'delmodel' && form) { form.model.splice(+b.dataset.i!, 1); render(); return; }
    if (act === 'applyjson') {
      const ta = left.querySelector<HTMLTextAreaElement>('#pe_json')!; jsonText = ta.value;
      try { const d = JSON.parse(jsonText); jsonErr = ''; jsonDef = d; form = null; }
      catch (err) { jsonErr = 'Hibás JSON: ' + (err instanceof Error ? err.message : String(err)); }
      render(); return;
    }
    if (act === 'save' || act === 'saveplace') {
      const d = currentDef(); if (!d || hasErrors(problems())) return refresh();
      const t = host.save(opts.type ?? null, d);
      close();
      if (act === 'saveplace') host.place(t);
      return;
    }
    if (act === 'delete' && opts.type) {
      const n = host.usage(opts.type);
      if (n && Date.now() - confirmDel > 3000) { confirmDel = Date.now(); b.textContent = `Biztos? ${n} példány is törlődik`; return; }
      host.remove(opts.type); close(); return;
    }
  });

  render();
  (left.querySelector('#pe_name') as HTMLInputElement | null)?.focus();
}
