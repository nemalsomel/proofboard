/**
 * Az Alkatrész-szerkesztő űrlapmodellje (DOM nélkül): az űrlap (`Form`) és a szabályos alkatrész-leírás (`PartDef`)
 * közötti átalakítás. `formToDef` az űrlapból leírást készít (a `meta.form`-ban az űrlap is megmarad), `defToForm` a
 * leírásból űrlapot, és megmondja, mi az, amit az űrlap nem tud visszaadni (`lost`). A felület (ui/editor.ts) és az
 * agent eszközei is ezt használják. A szövegeket a fordító (`tr`) adja.
 */
import { EL_KINDS, type CGraph, type ElKind } from './circuit';
import { fmtSI, parseSI } from './expr';
import type { ModelEl, PartDef, Prim } from './schema';
import { fmt, N_, type Tr } from '../i18n/i18n';

export type ModelKind = ElKind;
/** A villamos elemek kivezetései és értékei (a belső kapcsolás adatmodelljéből). */
export const MODEL_UI = EL_KINDS;

export interface LogicOutRow { pin: string; expr: string; oe: string; type: 'pp' | 'od' }
export interface LogicRegRow { name: string; clk: string; d: string; edge: 'rise' | 'fall'; reset: string; set: string }
export interface LogicForm {
  vcc: string; gnd: string; outs: LogicOutRow[];
  /** Tárolók (órajeles állapotbitek). */
  regs?: LogicRegRow[];
  /** A szerkesztő nézete: kapcsolás (diagram) vagy igazságtábla; a régi 'expr' / 'gates' a kapcsolás. */
  view?: 'graph' | 'table' | 'expr' | 'gates';
  /** A belső kapcsolás diagramja: ez a forrás, az `outs` és a `regs` belőle számolt kifejezések. */
  graph?: CGraph;
  /** Az igazságtábla bemenetei (lábnevek) a kifejezésekben szereplőkön felül. */
  tableVars?: string[];
  vih?: number; vil?: number; rout?: number;
}
export interface PinRow { id: string; name: string; lr: number; lc: number; role: string; group: string; volt?: string; /** GPIO-nál: képességek szóközzel/vesszővel */ caps?: string; /** perifériánál: buszfunkció */ fn?: string }
export interface ModelRow { el: ModelKind; pins: string[]; vals: string[]; /** MCU: 'matrix' = bármely GPIO bármely buszfunkcióra kiosztható */ mux?: 'fixed' | 'matrix' }
/** Paraméter (szám vagy érték mértékegységgel); `slider`: szimuláció közben csúszkával állítható. A villamos elemek értéke
 * kifejezés is lehet, pl. „{ohm*pos/100}” – a paraméterekre a kulcsukkal hivatkozik. */
export interface ParamRow { key: string; label: string; unit: string; def: string; min: string; max: string; step: string; slider: boolean; /** érték típus (SI-előtaggal írható, pl. 10k) */ value?: boolean; /** a csúszka felirata, ha eltér */ sliderLabel?: string; help?: string; /** ↑/↓ léptetés szabványsor szerint */ series?: 'E12' }
export interface Form {
  /** Paraméterek (a lerakott példányon állíthatók). */
  params?: ParamRow[];
  name: string; prefix: string; cat: string; bodyText: string;
  pad: number; fill: string; showLabel: boolean; names: 'below' | 'above' | 'in' | 'out' | 'none';
  /** Külső alkatrész (motor, szenzor kábelen): a panel mellé kerül, a lábai kivezetések. */
  off?: boolean;
  /** Digitális logika: táp, GND, és a belső kapcsolásból számolt kifejezések. */
  logic?: LogicForm;
  /** Belső kapcsolás (Működés fül): ez a forrás; a `model`, a `press` és a `logic` kifejezései belőle számolódnak. */
  graph?: CGraph;
  /** A test kiterjesztése a lábakon túl (lyukban): fent, lent, balra, jobbra. */
  ext: { t: number; b: number; l: number; r: number };
  pins: PinRow[]; model: ModelRow[]; press: [string, string] | null;
}

export const FILLS = ['#1b4f8a', '#1f6b4a', '#7a1f2b', '#2a2a2a', '#5f3dc4', '#c2410c', '#d9d2bf'];

/** Szerep tippelése a láb nevéből (generátorhoz). */
export function guessRole(name: string): string {
  const n = name.trim().toUpperCase();
  if (/^(GND|VSS|0V|GROUND|−|-)$/.test(n)) return 'gnd';
  if (/^(VCC|VDD|VIN|V\+|\+|5V|3V3|3\.3V|VBAT|BAT\+|IN\+|OUT\+|B\+)$/.test(n)) return 'vin';
  if (/^(NC|N\/C)$/.test(n)) return 'nc';
  if (/^(A\d|VR[XY]|AIN\d*|ADC\d*)$/.test(n)) return 'adc';
  return 'sig';
}

export function darken(hex: string, k = 0.6): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.round(((n >> s) & 255) * k).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}
export function lightText(hex: string): boolean {
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
export function formToDef(f: Form, tr: Tr = fmt): PartDef {
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
    // kifejezés ({…}) szövegként marad; különben szám (SI-előtaggal is)
    const v = (i: number): number => { const s0 = String(m.vals[i] ?? '').trim(); if (/^\{.*\}$/.test(s0)) return s0 as unknown as number; const x = parseSI(s0); return isFinite(x) ? x : MODEL_UI[m.el].vals[i][3]; };
    switch (m.el) {
      case 'resistor': return { el: 'resistor', a: m.pins[0], b: m.pins[1], ohm: v(0) };
      case 'diode': return { el: 'diode', a: m.pins[0], k: m.pins[1], vf: v(0), ron: 0.5 };
      case 'source': return { el: 'source', p: m.pins[0], n: m.pins[1], v: v(0), rint: 0.1 };
      case 'nmos': return { el: 'nmos', d: m.pins[0], g: m.pins[1], s: m.pins[2], vth: v(0), ron: v(1) };
      case 'capacitor': return { el: 'capacitor', a: m.pins[0], b: m.pins[1], f: v(0), vmax: v(1) };
      case 'motor': return { el: 'motor', a: m.pins[0], b: m.pins[1], ohm: v(0), vnom: v(1) };
      case 'npn': return { el: 'npn', c: m.pins[0], b: m.pins[1], e: m.pins[2], beta: v(0) };
      case 'mcu': return { el: 'mcu', gnd: m.pins[0], vsys: m.pins[1], v33: m.pins[2], ...(m.pins[3] ? { vbus: m.pins[3] } : {}), vreg: v(0), vmax: v(1), igpio: v(2), ...(m.mux === 'matrix' ? { mux: 'matrix' as const } : {}) };
    }
  });
  const oneRow = new Set(rs).size === 1 || new Set(cs).size === 1;
  const def: PartDef = {
    name: f.name.trim(), prefix: f.prefix.trim(), cat: f.cat.trim() || 'Saját',
    fp: oneRow && pins.length > 1 ? tr('{n} láb egy sorban', { n: pins.length }) : tr('{n} láb', { n: pins.length }),
    pins: pins.map(p => Object.assign({ id: p.id, name: p.name || p.id, lr: p.lr, lc: p.lc, role: p.role }, p.role === 'vin' ? parseRange(p.volt) : {},
      p.role === 'gpio' && splitCaps(p.caps).length ? { caps: splitCaps(p.caps) } : {}, p.role !== 'gpio' && p.fn ? { fn: p.fn } : {})),
    bounds: { r: [B.r0, B.r1], c: [B.c0, B.c1] },
    graphics,
    meta: { editor: 1, form: JSON.parse(JSON.stringify(f)) },
  };
  if (groups.length) def.groups = groups;
  if (f.off) { def.mount = 'off'; def.fp = tr('külső · {n} kivezetés', { n: pins.length }); }
  if (f.names === 'below' || f.names === 'above') def.pinLabels = { mode: 'name', off: f.names === 'below' ? 0.75 : -0.75 };
  else if (f.names === 'in' || f.names === 'out') def.pinLabels = { mode: 'name', off: 0.75, side: f.names };
  if (f.logic && f.logic.outs.length) {
    const L = f.logic;
    const el: ModelEl = { el: 'logic', vcc: L.vcc, gnd: L.gnd, outs: L.outs.map(o => ({ pin: o.pin, expr: o.expr.trim(), ...(o.oe.trim() ? { oe: o.oe.trim() } : {}), ...(o.type === 'od' ? { type: 'od' as const } : {}) })) };
    if (L.regs && L.regs.length) el.regs = L.regs.map(r => ({ name: r.name.trim(), clk: r.clk.trim(), d: r.d.trim(), ...(r.edge === 'fall' ? { edge: 'fall' as const } : {}), ...(r.reset.trim() ? { reset: r.reset.trim() } : {}), ...(r.set.trim() ? { set: r.set.trim() } : {}) }));
    if (L.vih != null) el.vih = L.vih; if (L.vil != null) el.vil = L.vil; if (L.rout != null) el.rout = L.rout;
    model.push(el);
  }
  if (model.length) def.model = model;
  const ctl: NonNullable<PartDef['controls']> = [];
  if (f.press && f.press[0] && f.press[1]) ctl.push({ kind: 'press', closes: [[f.press[0], f.press[1]]] });
  const prs = (f.params || []).filter(p => p.key.trim());
  if (prs.length) {
    const num = (x: string) => { const n = parseSI(x); return isFinite(n) ? n : undefined; };
    def.params = prs.map(p => {
      const o: NonNullable<PartDef['params']>[number] = { key: p.key.trim(), label: p.label.trim() || p.key.trim(), type: p.value ? 'value' : 'number', default: num(p.def) ?? 0 };
      if (p.unit.trim()) o.unit = p.unit.trim();
      const mn = num(p.min), mx = num(p.max), st = num(p.step);
      if (mn != null) o.min = mn; if (mx != null) o.max = mx; if (st != null) o.step = st;
      if (p.help && p.help.trim()) o.help = p.help.trim();
      if (p.series) o.series = p.series;
      return o;
    });
    for (const p of prs) if (p.slider) ctl.push({ kind: 'slider', key: p.key.trim(), label: (p.sliderLabel || '').trim() || p.label.trim() || p.key.trim() });
  }
  if (ctl.length) def.controls = ctl;
  return def;
}

/** Az összehasonlításhoz: a leírás azon része, amelyet az űrlap is előállít (meta és fp nélkül). */
export const SHAPE_KEYS: Array<[keyof PartDef, string]> = [
  ['name', N_('név')], ['prefix', N_('előtag')], ['cat', N_('kategória')], ['mount', N_('szerelés')], ['pins', N_('lábak (kifejezések, ismétlés vagy extra mezők)')], ['groups', N_('lábcsoportok')],
  ['params', N_('paraméterek')], ['pinTable', N_('lábtábla')], ['bounds', N_('a test mérete')], ['graphics', N_('saját rajzelemek')], ['pinLabels', N_('lábfeliratok')],
  ['model', N_('a villamos modell részletei')], ['controls', N_('vezérlők')],
];
export const MODEL_FIELDS: Record<ModelKind, { pins: string[]; vals: string[] }> = {
  resistor: { pins: ['a', 'b'], vals: ['ohm'] }, diode: { pins: ['a', 'k'], vals: ['vf'] }, source: { pins: ['p', 'n'], vals: ['v'] },
  nmos: { pins: ['d', 'g', 's'], vals: ['vth', 'ron'] }, capacitor: { pins: ['a', 'b'], vals: ['f', 'vmax'] },
  motor: { pins: ['a', 'b'], vals: ['ohm', 'vnom'] }, npn: { pins: ['c', 'b', 'e'], vals: ['beta'] },
  mcu: { pins: ['gnd', 'vsys', 'v33', 'vbus'], vals: ['vreg', 'vmax', 'igpio'] },
};
/** Képességlista szövegből: szóköz, vessző vagy pontosvessző választja el. */
export const splitCaps = (s?: string): string[] => [...new Set(String(s || '').split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];

/**
 * Leírásból űrlap (a JSON → Űrlap váltáshoz). `lost`: mi az, amit az űrlap nem tud visszaadni
 * (a leírás és az űrlapból újra előállított leírás eltérései); üres, ha a váltás veszteségmentes.
 */
export function defToForm(def: PartDef, base?: { form: Form; graphics: unknown; bounds: unknown }, tr: Tr = fmt): { form: Form | null; lost: string[] } {
  if (!def || !Array.isArray(def.pins)) return { form: null, lost: [tr('lábak')] };
  // ha a rajz és a test még az űrlapé (a JSON-ban nem nyúltak hozzá), az űrlap megjelenési beállításai maradnak
  const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const gen = base && same(def.graphics, base.graphics) && same(def.bounds, base.bounds);
  const meta = (def.meta && (def.meta as { form?: Form }).form) || (gen ? base!.form : undefined);
  const f: Form = meta && Array.isArray(meta.pins) ? JSON.parse(JSON.stringify(meta)) : newForm(tr);
  // a belső kapcsolás diagramja csak akkor marad, ha a JSON villamos modellje és vezérlője változatlan; különben ezekből épül újra
  if (f.graph && meta) { const ref = formToDef(meta, tr); if (!same(ref.model, def.model) || !same(ref.controls, def.controls)) delete f.graph; }
  if (f.logic) delete f.logic.graph;
  f.ext = Object.assign({ t: 0, b: 0, l: 0, r: 0 }, f.ext || {});
  f.name = String(def.name ?? ''); f.prefix = String(def.prefix ?? ''); f.cat = String(def.cat ?? '');
  f.off = def.mount === 'off';
  const gOf = new Map<string, string>();
  (def.groups || []).forEach((g, i) => { if (Array.isArray(g)) for (const id of g) gOf.set(id, 'g' + (i + 1)); });
  const lost = new Set<string>();
  f.pins = [];
  for (const p of def.pins) {
    if (!p || p.repeat != null || typeof p.lr !== 'number' || typeof p.lc !== 'number') { lost.add(tr('lábak (kifejezések, ismétlés vagy extra mezők)')); continue; }
    const volt = p.vmin != null || p.vmax != null ? `${p.vmin ?? ''}-${p.vmax ?? ''}` : '';
    f.pins.push({ id: String(p.id), name: p.name != null ? String(p.name) : String(p.id), lr: p.lr, lc: p.lc, role: p.role || 'sig', group: gOf.get(String(p.id)) || '', ...(volt ? { volt } : {}),
      ...(Array.isArray(p.caps) && p.caps.length ? { caps: p.caps.join(' ') } : {}), ...(p.fn ? { fn: String(p.fn) } : {}) });
  }
  f.model = [];
  f.logic = undefined;
  for (const el of def.model || []) {
    if (el.el === 'logic') {
      if (f.logic || !Array.isArray(el.outs)) { lost.add(tr('a villamos modell részletei')); continue; }
      const view = meta && meta.logic ? meta.logic.view : undefined, tv = meta && meta.logic ? meta.logic.tableVars : undefined;
      f.logic = { vcc: String(el.vcc ?? ''), gnd: String(el.gnd ?? ''), outs: el.outs.map(o => ({ pin: String(o.pin), expr: String(o.expr ?? ''), oe: String(o.oe ?? ''), type: o.type === 'od' ? 'od' : 'pp' })),
        ...(view ? { view } : {}), ...(tv ? { tableVars: tv } : {}) };
      if (Array.isArray(el.regs) && el.regs.length) f.logic.regs = el.regs.map(r => ({ name: String(r.name ?? ''), clk: String(r.clk ?? ''), d: String(r.d ?? ''), edge: r.edge === 'fall' ? 'fall' : 'rise', reset: String(r.reset ?? ''), set: String(r.set ?? '') }));
      if ((el.regs || []).some(r => r.init != null)) lost.add(tr('a villamos modell részletei'));
      for (const k of ['vih', 'vil', 'rout'] as const) { const v = el[k]; if (typeof v === 'number') f.logic[k] = v; else if (v != null) lost.add(tr('a villamos modell részletei')); }
      continue;
    }
    const k = el.el as ModelKind, mf = MODEL_FIELDS[k];
    if (!mf) { lost.add(tr('a villamos modell részletei')); continue; }
    const e = el as unknown as Record<string, unknown>;
    f.model.push({ el: k, pins: mf.pins.map(x => String(e[x] ?? '')), vals: mf.vals.map((x, i) => (typeof e[x] === 'number' ? fmtSI(e[x] as number) : e[x] != null ? String(e[x]) : fmtSI(MODEL_UI[k].vals[i][3]))), ...(e.mux === 'matrix' ? { mux: 'matrix' as const } : {}) });
  }
  const press = (def.controls || []).find(c => c.kind === 'press') as { closes: string[][] } | undefined;
  f.press = press && press.closes[0] ? [press.closes[0][0], press.closes[0][1]] : null;
  // paraméterek: szám és érték (mértékegységgel) típus; a csúszkák a paraméterekhez tartoznak
  const sliders = new Map((def.controls || []).filter(c => c.kind === 'slider').map(c => [(c as { key: string }).key, (c as { label?: string }).label || ''] as const));
  f.params = [];
  for (const p of def.params || []) {
    if (!p || (p.type !== 'number' && p.type !== 'value') || typeof p.default !== 'number' || p.options || p.geo) { lost.add(tr('paraméterek')); continue; }
    const n = (x: number | undefined) => (x == null ? '' : p.type === 'value' ? fmtSI(x) : String(x)), sl = sliders.get(p.key);
    f.params.push({ key: p.key, label: p.label || p.key, unit: p.unit || '', def: n(p.default), min: n(p.min), max: n(p.max), step: p.step == null ? '' : String(p.step), slider: sl != null,
      ...(p.type === 'value' ? { value: true } : {}), ...(sl && sl !== (p.label || p.key) ? { sliderLabel: sl } : {}), ...(p.help ? { help: p.help } : {}), ...(p.series ? { series: p.series } : {}) });
  }
  if (!f.params.length) delete f.params;
  if (!meta) {
    const body = (def.graphics || []).find(g => g.shape === 'rect' && (g.layer || 'body') === 'body');
    if (body && typeof body.fill === 'string' && /^#[0-9a-f]{6}$/i.test(body.fill)) f.fill = body.fill;
    const txt = (def.graphics || []).find(g => g.shape === 'text' && g.layer === 'detail');
    f.bodyText = txt && txt.text ? String(txt.text) : '';
    f.showLabel = (def.graphics || []).some(g => g.shape === 'text' && g.layer === 'label' && g.text === '{label}');
    f.names = !def.pinLabels ? 'none' : def.pinLabels.side ? def.pinLabels.side : (def.pinLabels.off ?? 0.75) < 0 ? 'above' : 'below';
  }
  if (def.pinTable) lost.add(tr('lábtábla'));
  // veszteség: az újra előállított leírás eltér-e (a lábak eltolása a 0:0 pontra nem számít)
  if (f.pins.length) {
    const back = formToDef(f, tr), o = def.pins[0] as { lr: number; lc: number };
    const shift = (d: PartDef) => JSON.parse(JSON.stringify(d, (k, v) => (k === 'meta' || k === 'fp' ? undefined : v)));
    const a = shift(def), b = shift(back);
    if (typeof o.lr === 'number' && (o.lr || o.lc)) b.pins = b.pins.map((p: { lr: number; lc: number }) => ({ ...p, lr: p.lr + o.lr, lc: p.lc + o.lc }));
    const canon = (x: unknown) => JSON.stringify(x, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, y]) => y !== undefined).sort(([p], [q]) => p.localeCompare(q))) : v));
    for (const [k, label] of SHAPE_KEYS) {
      if (k === 'graphics' || k === 'bounds') { if (meta) continue; } // a meta.form alapján épült rajz és test megegyezik
      if (k === 'pins' && b.pins) { if (canon(a.pins.map((p: Record<string, unknown>) => ({ ...p, name: p.name ?? p.id }))) !== canon(b.pins.map((p: Record<string, unknown>, i: number) => ({ ...p, name: a.pins[i]?.name ?? p.name })))) lost.add(tr(label)); continue; }
      if (canon(a[k] ?? null) !== canon(b[k] ?? null) && !(k === 'cat' && !a.cat && b.cat === 'Saját')) lost.add(tr(label));
    }
  }
  return { form: f.pins.length ? f : null, lost: [...lost] };
}

export const newForm = (tr: Tr = fmt): Form => ({ name: tr('Új modul'), prefix: 'U', cat: 'Saját', bodyText: '', pad: 0.6, ext: { t: 0, b: 0, l: 0, r: 0 }, fill: FILLS[0], showLabel: true, names: 'below', pins: [], model: [], press: null });
export const formOf = (def: PartDef): Form | null => {
  const f = def.meta && (def.meta as { form?: Form }).form;
  if (!f || !Array.isArray(f.pins)) return null;
  const c: Form = JSON.parse(JSON.stringify(f));
  c.ext = Object.assign({ t: 0, b: 0, l: 0, r: 0 }, c.ext || {});
  return c;
};

/* Piszkozatok: a bezárt (nem mentett) szerkesztés állapota alkatrészenként; az Elvetés törli. */
