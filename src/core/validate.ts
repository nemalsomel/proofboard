import { compilePart, penvD } from './compile';
import { num } from './expr';
import type { ModelEl, PartDef, PartInstance } from './schema';

export interface Problem {
  level: 'error' | 'warn';
  /** Hol a hiba, pl. "pins[3].lr" vagy "model[0].k". */
  path: string;
  msg: string;
}

const SHAPES = new Set(['rect', 'circle', 'poly', 'line', 'text', 'axial', 'radial', 'link']);
const PARAM_TYPES = new Set(['value', 'number', 'int', 'select', 'color', 'span']);
/** A modell-elemek lábhivatkozásai. */
export const MODEL_PINS: Record<ModelEl['el'], string[]> = {
  resistor: ['a', 'b'],
  diode: ['a', 'k'],
  source: ['p', 'n'],
  nmos: ['d', 'g', 's'],
  pico: ['gnd', 'vbus', 'vsys', 'v33'],
};
const MODEL_NUMS: Record<ModelEl['el'], string[]> = {
  resistor: ['ohm'], diode: ['vf', 'ron', 'imax'], source: ['v', 'rint'], nmos: ['vth', 'ron', 'imax'], pico: [],
};

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Alkatrész-leírás ellenőrzése. A hibás (error) leírás nem kerülhet a könyvtárba;
 * a figyelmeztetés (warn) csak jelzés.
 */
export function validatePartDef(def: unknown): Problem[] {
  const out: Problem[] = [];
  const err = (path: string, msg: string) => out.push({ level: 'error', path, msg });
  const warn = (path: string, msg: string) => out.push({ level: 'warn', path, msg });
  if (!isObj(def)) { err('', 'A leírás nem objektum.'); return out; }
  const d = def as PartDef;
  if (typeof d.name !== 'string' || !d.name.trim()) err('name', 'Hiányzik a név.');
  if (typeof d.prefix !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,5}$/.test(d.prefix)) err('prefix', 'Az előtag 1–6 karakter, betűvel kezdődik (pl. U, MOD, J).');
  if (typeof d.fp !== 'string') warn('fp', 'Hiányzik a lábkép rövid leírása.');
  if (!Array.isArray(d.pins) || !d.pins.length) { err('pins', 'Legalább egy láb kell.'); return out; }

  // paraméterek
  const keys = new Set<string>();
  (d.params || []).forEach((pr, i) => {
    const at = `params[${i}]`;
    if (!isObj(pr) || typeof pr.key !== 'string' || !/^[A-Za-z_]\w*$/.test(pr.key)) { err(at + '.key', 'Érvénytelen paraméterkulcs.'); return; }
    if (keys.has(pr.key)) err(at + '.key', `Kétszer szerepel: ${pr.key}`);
    keys.add(pr.key);
    if (!PARAM_TYPES.has(pr.type)) err(at + '.type', `Ismeretlen paramétertípus: ${String(pr.type)}`);
    if ((pr.type === 'select' || pr.type === 'color') && (!Array.isArray(pr.options) || !pr.options.length)) err(at + '.options', 'A választható típushoz opciók kellenek.');
    if (pr.default === undefined) err(at + '.default', 'Hiányzik az alapérték.');
  });

  // lábak kiértékelése alapértékekkel
  let pins: ReturnType<ReturnType<typeof compilePart>['pins']> = [];
  try {
    const c = compilePart('_check', d);
    const inst: PartInstance = { id: '_', type: '_check', label: (d.prefix || 'X') + '1', r: 0, c: 0, rot: 0, mir: false, props: { ...c.props } };
    pins = c.pins(inst);
    c.bounds(inst);
  } catch (e) {
    err('pins', 'A lábak nem értékelhetők ki: ' + (e instanceof Error ? e.message : String(e)));
    return out;
  }
  d.pins.forEach((sp, i) => {
    if (!isObj(sp) || typeof sp.id !== 'string' || !sp.id.trim()) err(`pins[${i}].id`, 'Hiányzik a láb azonosítója.');
  });
  if (!pins.length) err('pins', 'A lábak listája alapértékekkel üres.');
  const ids = new Set<string>(), pos = new Map<string, string>();
  pins.forEach((q, i) => {
    if (!isFinite(q.lr) || !isFinite(q.lc)) err(`pins[${i}]`, `${q.id}: a helye nem szám.`);
    if (Math.round(q.lr) !== q.lr || Math.round(q.lc) !== q.lc) err(`pins[${i}]`, `${q.id}: a láb csak egész lyukpozíción lehet.`);
    if (ids.has(q.id)) err(`pins[${i}].id`, `Kétszer szerepel a láb: ${q.id}`);
    ids.add(q.id);
    const k = q.lr + ':' + q.lc;
    if (pos.has(k)) err(`pins[${i}]`, `${q.id} és ${pos.get(k)} ugyanabban a lyukban (${k}).`);
    pos.set(k, q.id);
  });

  // csoportok
  const inGroup = new Map<string, number>();
  (d.groups || []).forEach((g, i) => {
    if (!Array.isArray(g) || g.length < 2) { err(`groups[${i}]`, 'Egy csoportban legalább két láb kell.'); return; }
    for (const id of g) {
      if (!ids.has(id)) err(`groups[${i}]`, `Nincs ilyen láb: ${id}`);
      if (inGroup.has(id)) warn(`groups[${i}]`, `${id} több csoportban is szerepel.`);
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
      if (typeof e[k] !== 'string') err(`${at}.${k}`, `Hiányzik a(z) ${k} láb.`);
      else if (!ids.has(e[k] as string)) err(`${at}.${k}`, `Nincs ilyen láb: ${e[k]}`);
    }
    const used = MODEL_PINS[el.el].map(k => e[k]);
    if (new Set(used).size !== used.length) err(at, 'Egy elem két kivezetése nem lehet ugyanaz a láb.');
    for (const k of MODEL_NUMS[el.el]) {
      if (e[k] == null) continue;
      try { const v = num(e[k], env); if (!isFinite(v)) throw new Error('nem szám'); }
      catch { err(`${at}.${k}`, `${k}: nem értelmezhető érték.`); }
    }
  });

  // vezérlők
  (d.controls || []).forEach((c, i) => {
    if (!isObj(c) || c.kind !== 'press') { err(`controls[${i}]`, 'Ismeretlen vezérlő.'); return; }
    if (!Array.isArray(c.closes) || !c.closes.length) err(`controls[${i}]`, 'Meg kell adni, mely lábak záródnak össze.');
    (c.closes || []).forEach(pair => { for (const id of pair) if (!ids.has(id)) err(`controls[${i}]`, `Nincs ilyen láb: ${id}`); });
  });

  // grafika
  (d.graphics || []).forEach((g, i) => { if (!isObj(g) || !SHAPES.has(g.shape)) err(`graphics[${i}].shape`, `Ismeretlen rajzelem: ${isObj(g) ? String(g.shape) : '?'}`); });
  if (!(d.graphics || []).some(g => (g.layer || 'body') === 'body')) warn('graphics', 'Nincs test (body réteg): az alkatrész csak lábakként látszik.');

  return out;
}

export const hasErrors = (ps: Problem[]) => ps.some(p => p.level === 'error');
