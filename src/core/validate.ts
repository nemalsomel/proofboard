import { logicMsg, parseExpr, pinRef, varsOf } from './logic';
import { fmt, type Tr } from '../i18n/i18n';
import { compilePart, penvD } from './compile';
import { num } from './expr';
import type { ModelEl, PartDef, PartInstance } from './schema';

export interface Problem {
  level: 'error' | 'warn';
  /** Hol a hiba, pl. "pins[3].lr" vagy "model[0].k". */
  path: string;
  msg: string;
  /** A magyar üzenet, ha a `msg` más nyelvű (a szerkesztő ebből ismeri fel a hiba fajtáját). */
  hu?: string;
}

const SHAPES = new Set(['rect', 'circle', 'poly', 'line', 'text', 'axial', 'radial', 'link', 'dial']);
const PARAM_TYPES = new Set(['value', 'number', 'int', 'select', 'color', 'span', 'names']);
/** A modell-elemek lábhivatkozásai. */
export const MODEL_PINS: Record<ModelEl['el'], string[]> = {
  resistor: ['a', 'b'],
  diode: ['a', 'k'],
  source: ['p', 'n'],
  nmos: ['d', 'g', 's'],
  capacitor: ['a', 'b'],
  npn: ['c', 'b', 'e'],
  motor: ['a', 'b'],
  servo: ['vp', 'gnd', 'sig'],
  logic: ['vcc', 'gnd'],
  stepper: ['com', 'a', 'b', 'c', 'd'],
  mcu: ['gnd', 'vsys', 'v33'],
};
const MODEL_NUMS: Record<ModelEl['el'], string[]> = {
  resistor: ['ohm'], diode: ['vf', 'ron', 'imax'], source: ['v', 'rint'], nmos: ['vth', 'ron', 'imax'], capacitor: ['f', 'vmax'], npn: ['beta', 'vbe', 'vcesat', 'imax'], motor: ['ohm', 'vnom'], servo: ['ohm', 'pmin', 'pmax'], logic: ['vih', 'vil', 'rout', 'imax'], stepper: ['ohm', 'steps', 'rotor'], mcu: ['vreg', 'vmax', 'igpio'],
};

/** Perifériaoldali buszfunkciók (PinSpec.fn). */
export const BUS_FNS = ['i2c.sda', 'i2c.scl', 'spi.mosi', 'spi.miso', 'spi.sck', 'spi.cs', 'uart.rx', 'uart.tx'];

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Alkatrész-leírás ellenőrzése. A hibás (error) leírás nem kerülhet a könyvtárba;
 * a figyelmeztetés (warn) csak jelzés.
 */
/** A leírás hibái és figyelmeztetései; `tr`: az üzenetek fordítója (alapból magyar). */
export function validatePartDef(def: unknown, tr: Tr = fmt): Problem[] {
  const out: Problem[] = [];
  const err = (path: string, msg: string) => out.push({ level: 'error', path, msg });
  const warn = (path: string, msg: string) => out.push({ level: 'warn', path, msg });
  if (!isObj(def)) { err('', tr('A leírás nem objektum.')); return out; }
  const d = def as PartDef;
  if (typeof d.name !== 'string' || !d.name.trim()) err('name', tr('Hiányzik a név.'));
  if (typeof d.prefix !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(d.prefix)) err('prefix', tr('Az előtag 1–6 karakter, betűvel kezdődik (pl. U, MOD, J).'));
  if (typeof d.fp !== 'string') warn('fp', tr('Hiányzik a lábkép rövid leírása.'));
  if (!Array.isArray(d.pins) || !d.pins.length) { err('pins', tr('Legalább egy láb kell.')); return out; }

  // paraméterek
  const keys = new Set<string>();
  (d.params || []).forEach((pr, i) => {
    const at = `params[${i}]`;
    if (!isObj(pr) || typeof pr.key !== 'string' || !/^[A-Za-z_]\w*$/.test(pr.key)) { err(at + '.key', tr('Érvénytelen paraméterkulcs.')); return; }
    if (keys.has(pr.key)) err(at + '.key', tr('Kétszer szerepel: {a}', { a: pr.key }));
    keys.add(pr.key);
    if (!PARAM_TYPES.has(pr.type)) err(at + '.type', tr('Ismeretlen paramétertípus: {a}', { a: String(pr.type) }));
    if ((pr.type === 'select' || pr.type === 'color') && (!Array.isArray(pr.options) || !pr.options.length)) err(at + '.options', tr('A választható típushoz opciók kellenek.'));
    if (pr.default === undefined) err(at + '.default', tr('Hiányzik az alapérték.'));
  });

  // lábak kiértékelése alapértékekkel
  let pins: ReturnType<ReturnType<typeof compilePart>['pins']> = [];
  try {
    const c = compilePart('_check', d);
    const inst: PartInstance = { id: '_', type: '_check', label: (d.prefix || 'X') + '1', r: 0, c: 0, rot: 0, mir: false, props: { ...c.props } };
    pins = c.pins(inst);
    c.bounds(inst);
  } catch (e) {
    err('pins', tr('A lábak nem értékelhetők ki: ') + (e instanceof Error ? e.message : String(e)));
    return out;
  }
  d.pins.forEach((sp, i) => {
    if (!isObj(sp) || typeof sp.id !== 'string' || !sp.id.trim()) err(`pins[${i}].id`, tr('Hiányzik a láb azonosítója.'));
  });
  if (!pins.length) err('pins', tr('A lábak listája alapértékekkel üres.'));
  const ids = new Set<string>(), pos = new Map<string, string>();
  pins.forEach((q, i) => {
    if (!isFinite(q.lr) || !isFinite(q.lc)) err(`pins[${i}]`, tr('{a}: a helye nem szám.', { a: q.id }));
    if (Math.round(q.lr) !== q.lr || Math.round(q.lc) !== q.lc) err(`pins[${i}]`, tr('{a}: a láb csak egész lyukpozíción lehet.', { a: q.id }));
    if (ids.has(q.id)) err(`pins[${i}].id`, tr('Kétszer szerepel a láb: {a}', { a: q.id }));
    ids.add(q.id);
    const k = q.lr + ':' + q.lc;
    if (pos.has(k)) err(`pins[${i}]`, tr('{a} és {b} ugyanabban a lyukban ({c}).', { a: q.id, b: pos.get(k) ?? '', c: k }));
    pos.set(k, q.id);
    for (const f of ['vmin', 'vmax'] as const) if (q[f] != null && !isFinite(q[f]!)) err(`pins[${i}].${f}`, tr('{a}: {b} nem szám.', { a: q.id, b: f }));
    if (q.vmin != null && q.vmax != null && q.vmin >= q.vmax) err(`pins[${i}]`, tr('{a}: a minimális feszültség nem lehet nagyobb a maximálisnál.', { a: q.id }));
    if (q.fn != null && !BUS_FNS.includes(q.fn)) warn(`pins[${i}].fn`, tr('{a}: ismeretlen buszfunkció: {b} (lehet: {c})', { a: q.id, b: q.fn, c: BUS_FNS.join(', ') }));
    if ((q.vmin != null || q.vmax != null) && q.role !== 'vin') warn(`pins[${i}]`, tr('{a}: feszültségtartomány csak tápbemenetnél (vin) számít.', { a: q.id }));
  });
  if (pins.some(q => q.role === 'vin') && !pins.some(q => q.role === 'gnd'))
    warn('pins', tr('Van tápbemenet, de nincs GND-láb: a tápfeszültség a panel földjéhez képest számít.'));

  // csoportok
  const inGroup = new Map<string, number>();
  (d.groups || []).forEach((g, i) => {
    if (!Array.isArray(g) || g.length < 2) { err(`groups[${i}]`, tr('Egy csoportban legalább két láb kell.')); return; }
    for (const id of g) {
      if (!ids.has(id)) err(`groups[${i}]`, tr('Nincs ilyen láb: {a}', { a: id }));
      if (inGroup.has(id)) warn(`groups[${i}]`, tr('{a} több csoportban is szerepel.', { a: id }));
      inGroup.set(id, i);
    }
  });

  // villamos modell
  const env = (() => { try { const c = compilePart('_check', d); return penvD(d, { label: 'X1', props: { ...c.props } }); } catch { return { $opt: {} }; } })();
  (d.model || []).forEach((el, i) => {
    const at = `model[${i}]`;
    if (!isObj(el) || !(el.el in MODEL_PINS)) { err(at + '.el', `Ismeretlen modell-elem: ${isObj(el) ? String(el.el) : '?'}`); return; }
    const e = el as Record<string, unknown>;
    for (const k of MODEL_PINS[el.el]) {
      if (typeof e[k] !== 'string' || !e[k]) err(`${at}.${k}`, tr('Hiányzik a(z) {a} kivezetés lába.', { a: k }));
      else if (!ids.has(e[k] as string)) err(`${at}.${k}`, tr('Nincs ilyen láb: {a}', { a: e[k] }));
    }
    if (el.el === 'mcu' && e.vbus != null && (typeof e.vbus !== 'string' || !ids.has(e.vbus))) err(`${at}.vbus`, tr('Nincs ilyen láb: {a}', { a: String(e.vbus) }));
    const used = MODEL_PINS[el.el].map(k => e[k]).filter(x => typeof x === 'string' && x); // a hiányzó lábat fent már jelezte
    if (new Set(used).size !== used.length) err(at, tr('Egy elem két kivezetése nem lehet ugyanaz a láb.'));
    for (const k of MODEL_NUMS[el.el]) {
      if (e[k] == null) continue;
      try { const v = num(e[k], env); if (!isFinite(v)) throw new Error(tr('nem szám')); }
      catch { err(`${at}.${k}`, tr('{a}: nem értelmezhető érték.', { a: k })); }
    }
    if (el.el === 'logic') {
      const outs = Array.isArray(e.outs) ? (e.outs as Array<Record<string, unknown>>) : [];
      const regs = Array.isArray(e.regs) ? (e.regs as Array<Record<string, unknown>>) : [];
      const regNames = new Set<string>();
      regs.forEach((r, j) => {
        const ra = `${at}.regs[${j}]`, nm = String(r.name ?? '');
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(nm)) err(ra, tr('Tároló neve: betűvel kezdődő azonosító kell (most: „{a}”).', { a: nm }));
        else if (regNames.has(nm)) err(ra, tr('Kétszer szerepel a tároló: {a}', { a: nm }));
        else if (pins.some(q => q.name === nm)) err(ra, tr('{a}: a tároló neve nem lehet egy láb neve.', { a: nm }));
        regNames.add(nm);
      });
      const known = (v: string) => regNames.has(v) || !!pinRef(v, pins);
      const chk = (src: unknown, where: string, req: boolean) => {
        if (src == null || String(src).trim() === '') { if (req) err(where.split('|')[0], tr('{a}: hiányzik.', { a: where.split('|')[1] })); return; }
        try { for (const v of varsOf(parseExpr(String(src)))) if (!known(v)) err(where.split('|')[0], tr('{a}: nincs ilyen láb vagy tároló: {b}', { a: where.split('|')[1], b: v })); }
        catch (x) { err(where.split('|')[0], `${where.split('|')[1]}: ${logicMsg(x, tr)}`); }
      };
      regs.forEach((r, j) => {
        const ra = `${at}.regs[${j}]`, nm = String(r.name ?? '?');
        chk(r.clk, tr('{a}|{b} órajele', { a: ra, b: nm }), true); chk(r.d, tr('{a}|{b} következő értéke (D)', { a: ra, b: nm }), true);
        chk(r.reset, tr('{a}|{b} törlése', { a: ra, b: nm }), false); chk(r.set, tr('{a}|{b} beállítása', { a: ra, b: nm }), false);
        if (r.edge != null && r.edge !== 'rise' && r.edge !== 'fall') err(ra, tr('{a}: az él rise vagy fall lehet.', { a: nm }));
      });
      if (!outs.length) err(`${at}.outs`, tr('A logikához legalább egy kimenet kell.'));
      const seen = new Set<string>();
      outs.forEach((o, j) => {
        const oa = `${at}.outs[${j}]`;
        const pid = String(o.pin ?? '');
        if (!ids.has(pid)) { err(oa, tr('Nincs ilyen kimeneti láb: {a}', { a: pid || '–' })); return; }
        const pn = pins.find(q => q.id === pid)!.name;
        if (seen.has(pid)) err(oa, tr('{a}: két kifejezés hajtja ugyanazt a kimenetet.', { a: pn }));
        seen.add(pid);
        if (pid === e.vcc || pid === e.gnd) err(oa, tr('{a}: a táp- vagy GND-láb nem lehet kimenet.', { a: pn }));
        for (const [k, label] of [['expr', tr('kifejezés')], ['oe', tr('engedélyezés')]] as const) {
          if (o[k] == null || String(o[k]).trim() === '') { if (k === 'expr') err(oa, tr('{a}: hiányzik a kifejezés.', { a: pn })); continue; }
          try {
            const ast = parseExpr(String(o[k]));
            for (const v of varsOf(ast)) if (!known(v)) err(oa, tr('{a} {b}: nincs ilyen (vagy nem egyértelmű) láb vagy tároló: {c}', { a: pn, b: label, c: v }));
          } catch (x) { err(oa, `${pn} ${label}: ${logicMsg(x, tr)}`); }
        }
        if (o.type != null && o.type !== 'pp' && o.type !== 'od') err(oa, tr('{a}: a kimenet típusa pp vagy od lehet.', { a: pn }));
      });
    }
  });

  // csatlakozó: a lábszám- és lábnév-paraméter létezzen
  if (d.socket != null) {
    const pk = (k: unknown, t: string[]) => (d.params || []).find(x => x.key === k && t.includes(x.type));
    if (!isObj(d.socket)) err('socket', tr('A csatlakozó leírása objektum.'));
    else {
      if (d.socket.count != null && !pk(d.socket.count, ['int'])) err('socket.count', tr('A csatlakozó lábszámához egész (int) paraméter kell.'));
      if (d.socket.names != null && !pk(d.socket.names, ['names'])) err('socket.names', tr('A csatlakozó lábneveihez names típusú paraméter kell.'));
      if (d.socket.pins != null && (!Array.isArray(d.socket.pins) || !d.socket.pins.length)) err('socket.pins', tr('A csatlakozó lábainak listája nem lehet üres.'));
      else for (const id of d.socket.pins || []) if (!ids.has(id)) err('socket.pins', tr('A csatlakozóban nincs ilyen láb: {a}', { a: id }));
    }
  }

  // vezérlők
  (d.controls || []).forEach((c, i) => {
    if (isObj(c) && c.kind === 'slider') {
      const pr = (d.params || []).find(x => x.key === c.key);
      if (!pr) err(`controls[${i}]`, tr('A csúszkához nincs ilyen paraméter: {a}', { a: String(c.key) }));
      else if (!['number', 'int', 'value'].includes(pr.type) || pr.min == null || pr.max == null)
        err(`controls[${i}]`, tr('A csúszka paramétere ({a}) szám legyen, min és max értékkel.', { a: pr.key }));
      return;
    }
    if (!isObj(c) || c.kind !== 'press') { err(`controls[${i}]`, tr('Ismeretlen vezérlő.')); return; }
    if (!Array.isArray(c.closes) || !c.closes.length) err(`controls[${i}]`, tr('Meg kell adni, mely lábak záródnak össze.'));
    (c.closes || []).forEach(pair => { for (const id of pair) if (!ids.has(id)) err(`controls[${i}]`, tr('Nincs ilyen láb: {a}', { a: id })); });
  });

  // grafika
  (d.graphics || []).forEach((g, i) => { if (!isObj(g) || !SHAPES.has(g.shape)) err(`graphics[${i}].shape`, `Ismeretlen rajzelem: ${isObj(g) ? String(g.shape) : '?'}`); });
  if (d.mount != null && d.mount !== 'board' && d.mount !== 'off') err('mount', tr('Ismeretlen szerelés: {a} (board vagy off).', { a: String(d.mount) }));
  if (!(d.graphics || []).some(g => (g.layer || 'body') === 'body')) warn('graphics', tr('Nincs test (body réteg): az alkatrész csak lábakként látszik.'));

  return out;
}

export const hasErrors = (ps: Problem[]) => ps.some(p => p.level === 'error');
