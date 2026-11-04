/**
 * Program réteg: adatfolyam-gráf (csomópontok és élek), amely a szimuláció futása közben ütemenként
 * kiértékelődik, és a vezérlő GPIO-it állítja (kimenet, PWM, bemeneti felhúzás). A csomópontok alkatrészlábra
 * hivatkoznak (pl. K1.A1, R1.1): a hozzá tartozó GPIO-t a netlista adja, így vezérlőcsere vagy új útvonal után
 * is ugyanazt jelentik. A csomóponttípusok adatként vannak leírva (NODE_DEFS), a kiértékelés DOM-mentes.
 */
import { isMcu } from './defs';
import { findPin } from './links';
import type { Netlist } from './netlist';
import type { Design, PwmCfg } from './types';

export type PortKind = 'bool' | 'num';
export type Val = boolean | number;
export interface PNode { id: string; type: string; x: number; y: number; props: Record<string, unknown> }
/** Él: `from` = 'csomópont.kimenet', `to` = 'csomópont.bemenet'. */
export interface PEdge { id: string; from: string; to: string }
export interface Program { nodes: PNode[]; edges: PEdge[] }

export interface PortDef { id: string; label: string; kind: PortKind }
export interface NodeParam {
  key: string; label: string;
  /** pin: alkatrészláb (hivatkozás), number: szám, select: választás. */
  type: 'pin' | 'number' | 'select';
  default: unknown; min?: number; max?: number; unit?: string;
  options?: ReadonlyArray<readonly [string, string]>;
}
/** Egy csomópont kiértékelése: bemenetek, paraméterek, saját állapot, idő (ms) és a GPIO-olvasás. */
export interface EvalCtx {
  in: Record<string, Val | undefined>;
  p: Record<string, unknown>;
  st: Record<string, unknown>;
  t: number;
  read(ref: unknown): { level: 0 | 1 | null; V: number } | null;
}
export interface NodeDef {
  label: string; cat: 'Bemenet' | 'Logika' | 'Idő' | 'Kimenet'; help: string;
  ins: PortDef[]; outs: PortDef[]; params: NodeParam[];
  eval(c: EvalCtx): Record<string, Val>;
  /** A csomópont által igényelt GPIO-mód (bemenet felhúzása, ADC, kimenet), a paraméterekből és a bemenetekből. */
  gpio?(p: Record<string, unknown>, inp: Record<string, Val | undefined>): { ref: unknown; mode: string; pwm?: PwmCfg } | null;
}

const B = (v: Val | undefined): boolean => (typeof v === 'number' ? v > 0.5 : !!v);
const N = (v: Val | undefined): number => (typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' && isFinite(v) ? v : 0);
const num = (x: unknown, d: number): number => { const n = Number(x); return isFinite(n) ? n : d; };
const bin = (id: string, label: string): PortDef => ({ id, label, kind: 'bool' });
const nin = (id: string, label: string): PortDef => ({ id, label, kind: 'num' });
const PIN = (label = 'Láb'): NodeParam => ({ key: 'pin', label, type: 'pin', default: '' });
/** Felfutó él: az előző ütem óta 0 → 1. */
const rise = (st: Record<string, unknown>, k: string, v: boolean): boolean => { const was = !!st[k]; st[k] = v; return v && !was; };

export const NODE_DEFS: Record<string, NodeDef> = {
  in: {
    label: 'Digitális bemenet', cat: 'Bemenet', help: 'Egy láb szintje (pl. nyomógomb). Felhúzással a lenyomott gomb alacsony szintet ad, ezért az „aktív” alapból az alacsony.',
    ins: [], outs: [bin('v', 'aktív')],
    params: [PIN(), { key: 'pull', label: 'Felhúzás', type: 'select', default: 'pullup', options: [['pullup', 'fel (3,3 V)'], ['pulldown', 'le (GND)'], ['float', 'nincs']] },
      { key: 'active', label: 'Aktív', type: 'select', default: 'low', options: [['low', 'alacsony szinten'], ['high', 'magas szinten']] }],
    eval: c => { const r = c.read(c.p.pin), lv = r ? r.level : null; return { v: lv == null ? false : (c.p.active === 'high') === (lv === 1) }; },
    gpio: p => ({ ref: p.pin, mode: String(p.pull || 'pullup') }),
  },
  adc: {
    label: 'Analóg bemenet', cat: 'Bemenet', help: 'Egy ADC-képes láb feszültsége 0…1 között (0 V → 0, 3,3 V → 1), pl. potméter vagy joystick.',
    ins: [], outs: [nin('v', 'érték')], params: [PIN()],
    eval: c => { const r = c.read(c.p.pin); return { v: r ? Math.max(0, Math.min(1, r.V / 3.3)) : 0 }; },
    gpio: p => ({ ref: p.pin, mode: 'adc' }),
  },
  const: {
    label: 'Állandó', cat: 'Bemenet', help: 'Rögzített szám (0…1 között PWM-kitöltéshez, vagy összehasonlításhoz).',
    ins: [], outs: [nin('v', 'érték')], params: [{ key: 'value', label: 'Érték', type: 'number', default: 1 }],
    eval: c => ({ v: num(c.p.value, 1) }),
  },
  not: { label: 'NEM', cat: 'Logika', help: 'Megfordítja a jelet.', ins: [bin('a', 'be')], outs: [bin('v', 'ki')], params: [], eval: c => ({ v: !B(c.in.a) }) },
  and: { label: 'ÉS', cat: 'Logika', help: 'Akkor igaz, ha mindkét bemenet igaz.', ins: [bin('a', 'A'), bin('b', 'B')], outs: [bin('v', 'ki')], params: [], eval: c => ({ v: B(c.in.a) && B(c.in.b) }) },
  or: { label: 'VAGY', cat: 'Logika', help: 'Akkor igaz, ha legalább az egyik bemenet igaz.', ins: [bin('a', 'A'), bin('b', 'B')], outs: [bin('v', 'ki')], params: [], eval: c => ({ v: B(c.in.a) || B(c.in.b) }) },
  xor: { label: 'KIZÁRÓ VAGY', cat: 'Logika', help: 'Akkor igaz, ha pontosan az egyik bemenet igaz.', ins: [bin('a', 'A'), bin('b', 'B')], outs: [bin('v', 'ki')], params: [], eval: c => ({ v: B(c.in.a) !== B(c.in.b) }) },
  compare: {
    label: 'Összehasonlítás', cat: 'Logika', help: 'Igaz, ha a bemenet nagyobb (vagy kisebb) a határnál, pl. „a potméter félnél tovább van tekerve”.',
    ins: [nin('a', 'érték')], outs: [bin('v', 'igaz')],
    params: [{ key: 'op', label: 'Feltétel', type: 'select', default: '>', options: [['>', 'nagyobb, mint'], ['<', 'kisebb, mint']] }, { key: 'value', label: 'Határ', type: 'number', default: 0.5 }],
    eval: c => ({ v: c.p.op === '<' ? N(c.in.a) < num(c.p.value, 0.5) : N(c.in.a) > num(c.p.value, 0.5) }),
  },
  blink: {
    label: 'Ütemadó', cat: 'Idő', help: 'Négyszögjel: periódusonként a kitöltés arányában igaz (villogó LED).',
    ins: [], outs: [bin('v', 'ki')],
    params: [{ key: 'period', label: 'Periódus', type: 'number', default: 1000, min: 20, unit: 'ms' }, { key: 'duty', label: 'Kitöltés', type: 'number', default: 50, min: 0, max: 100, unit: '%' }],
    eval: c => { const T = Math.max(20, num(c.p.period, 1000)); return { v: (c.t % T) < T * Math.max(0, Math.min(100, num(c.p.duty, 50))) / 100 }; },
  },
  toggle: {
    label: 'Váltókapcsoló', cat: 'Idő', help: 'Minden felfutó élre (pl. gombnyomásra) átvált: be, ki, be…',
    ins: [bin('a', 'váltás')], outs: [bin('v', 'állapot')], params: [],
    eval: c => { if (rise(c.st, 'a', B(c.in.a))) c.st.v = !c.st.v; return { v: !!c.st.v }; },
  },
  counter: {
    label: 'Számláló', cat: 'Idő', help: 'Felfutó élenként eggyel nő, a határnál elölről kezdi; a törlés lenullázza. Az „arány” 0…1 között (PWM-hez).',
    ins: [bin('a', 'számol'), bin('r', 'törlés')], outs: [nin('n', 'érték'), nin('f', 'arány')],
    params: [{ key: 'max', label: 'Lépésszám', type: 'number', default: 4, min: 1 }],
    eval: c => {
      const m = Math.max(1, Math.round(num(c.p.max, 4)));
      let n = num(c.st.n, 0);
      if (rise(c.st, 'a', B(c.in.a))) n = (n + 1) % m;
      if (B(c.in.r)) n = 0;
      c.st.n = n;
      return { n, f: m > 1 ? n / (m - 1) : 0 };
    },
  },
  delay: {
    label: 'Késleltetés', cat: 'Idő', help: 'A bemenet változását a megadott idő múlva adja tovább (pl. „a gomb elengedése után még 2 s-ig világít”).',
    ins: [bin('a', 'be')], outs: [bin('v', 'ki')], params: [{ key: 'ms', label: 'Késés', type: 'number', default: 500, min: 0, unit: 'ms' }],
    eval: c => {
      const v = B(c.in.a), d = Math.max(0, num(c.p.ms, 500));
      if (c.st.last !== v) { c.st.last = v; c.st.at = c.t; }
      if (c.t - num(c.st.at, 0) >= d) c.st.v = v;
      return { v: !!c.st.v };
    },
  },
  out: {
    label: 'Digitális kimenet', cat: 'Kimenet', help: 'Igaz → a láb magas (3,3 V), hamis → alacsony (pl. LED, relé, MOSFET kapuja).',
    ins: [bin('a', 'be')], outs: [], params: [PIN()],
    eval: () => ({}),
    gpio: (p, i) => ({ ref: p.pin, mode: B(i.a) ? 'out_high' : 'out_low' }),
  },
  pwm: {
    label: 'PWM kimenet', cat: 'Kimenet', help: 'A bemenet (0…1) a kitöltés: LED fényereje, motor fordulatszáma. Szervóhoz 50 Hz és 0,025…0,125.',
    ins: [nin('a', 'kitöltés')], outs: [], params: [PIN(), { key: 'freq', label: 'Frekvencia', type: 'number', default: 1000, min: 1, unit: 'Hz' }],
    eval: () => ({}),
    gpio: (p, i) => ({ ref: p.pin, mode: 'pwm', pwm: { duty: Math.round(Math.max(0, Math.min(1, N(i.a))) * 1000) / 10, freq: Math.max(1, num(p.freq, 1000)) } }),
  },
};

/** Program beolvasása (mentésből): ismeretlen csomópont, hibás él kimarad; a paraméterek alapértékkel kiegészülnek. */
export function normProgram(raw: unknown): Program | undefined {
  const r = raw as { nodes?: unknown; edges?: unknown } | null;
  if (!r || !Array.isArray(r.nodes)) return undefined;
  const nodes: PNode[] = [];
  for (const n of r.nodes as Array<Record<string, unknown>>) {
    if (!n || typeof n.id !== 'string' || typeof n.type !== 'string' || !NODE_DEFS[n.type]) continue;
    const d = NODE_DEFS[n.type], props: Record<string, unknown> = {};
    for (const pr of d.params) props[pr.key] = (n.props as Record<string, unknown> | undefined)?.[pr.key] ?? pr.default;
    nodes.push({ id: n.id, type: n.type, x: num(n.x, 0), y: num(n.y, 0), props });
  }
  const ids = new Map(nodes.map(n => [n.id, n]));
  const port = (ref: unknown, side: 'ins' | 'outs') => {
    if (typeof ref !== 'string') return false;
    const i = ref.lastIndexOf('.'), n = ids.get(ref.slice(0, i));
    return !!n && NODE_DEFS[n.type][side].some(p => p.id === ref.slice(i + 1));
  };
  const edges: PEdge[] = [], taken = new Set<string>();
  for (const e of (Array.isArray(r.edges) ? r.edges : []) as Array<Record<string, unknown>>) {
    if (!e || typeof e.id !== 'string' || !port(e.from, 'outs') || !port(e.to, 'ins') || taken.has(e.to as string)) continue;
    taken.add(e.to as string); // egy bemenetre egy él
    edges.push({ id: e.id, from: e.from as string, to: e.to as string });
  }
  return { nodes, edges };
}

/** Alkatrészláb → a vele egy hálózaton lévő vezérlő-GPIO kulcsa (alkatrész.láb), ha van ilyen. */
export function gpioOf(D: Design, A: Netlist, ref: unknown): string | null {
  if (typeof ref !== 'string' || !ref) return null;
  const q = findPin(D, ref);
  if (!q) return null;
  if (isMcu(q.part) && q.role === 'gpio') return q.part.id + '.' + q.id;
  const bp = A.byPart.get(q.part.id), nq = bp && bp.map[q.id];
  if (!nq) return null;
  const g = (A.netPins.get(nq.net) || []).find(x => isMcu(x.part) && x.role === 'gpio');
  return g ? g.part.id + '.' + g.id : null;
}

/** A program futásállapota: csomópontonként a saját állapot és az utolsó kimeneti értékek. */
export interface ProgRuntime { st: Map<string, Record<string, unknown>>; vals: Map<string, Val> }
export const newRuntime = (): ProgRuntime => ({ st: new Map(), vals: new Map() });

export interface ProgOut {
  /** GPIO-módok (kulcs: vezérlő.láb), a terv beállításai fölé. */
  gpio: Record<string, string>;
  pwm: Record<string, PwmCfg>;
  /** Hibák: csomópont → üzenet (pl. a láb nincs GPIO-ra kötve). */
  errors: Map<string, string>;
}

/**
 * Egy ütem: a csomópontok kiértékelése az élek szerinti sorrendben (körben az előző ütem értékével),
 * majd a kimeneti csomópontok GPIO-módjai. `read`: a GPIO szintje az előző szimulációból (kulcs: vezérlő.láb).
 */
export function evalProgram(D: Design, A: Netlist, prog: Program, rt: ProgRuntime, t: number,
  read: (gpioKey: string) => { level: 0 | 1 | null; V: number } | null): ProgOut {
  const out: ProgOut = { gpio: {}, pwm: {}, errors: new Map() };
  const byTo = new Map(prog.edges.map(e => [e.to, e.from]));
  const deps = new Map(prog.nodes.map(n => [n.id, new Set(prog.edges.filter(e => e.to.startsWith(n.id + '.')).map(e => e.from.slice(0, e.from.lastIndexOf('.'))))]));
  // topologikus sorrend; ami körben marad, az a végére (az előző ütem értékeit olvassa)
  const order: string[] = [], done = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    for (const n of prog.nodes) if (!done.has(n.id) && [...deps.get(n.id)!].every(d => done.has(d) || d === n.id)) { order.push(n.id); done.add(n.id); progress = true; }
  }
  for (const n of prog.nodes) if (!done.has(n.id)) order.push(n.id);
  const nodeBy = new Map(prog.nodes.map(n => [n.id, n]));
  const resolve = (ref: unknown, nid: string): string | null => {
    const g = gpioOf(D, A, ref);
    if (!g) out.errors.set(nid, typeof ref === 'string' && ref ? 'A láb nincs GPIO-ra kötve' : 'Nincs kiválasztva láb');
    return g;
  };
  const inputsOf = (n: PNode) => {
    const r: Record<string, Val | undefined> = {};
    for (const p of NODE_DEFS[n.type].ins) { const f = byTo.get(n.id + '.' + p.id); r[p.id] = f ? rt.vals.get(f) : undefined; }
    return r;
  };
  for (const id of order) {
    const n = nodeBy.get(id)!, d = NODE_DEFS[n.type];
    if (!rt.st.has(id)) rt.st.set(id, {});
    const res = d.eval({ in: inputsOf(n), p: n.props, st: rt.st.get(id)!, t, read: ref => { const g = resolve(ref, id); return g ? read(g) : null; } });
    for (const [k, v] of Object.entries(res)) rt.vals.set(id + '.' + k, v);
  }
  for (const n of prog.nodes) {
    const d = NODE_DEFS[n.type];
    if (!d.gpio) continue;
    const g = d.gpio(n.props, inputsOf(n));
    if (!g) continue;
    const key = resolve(g.ref, n.id);
    if (!key) continue;
    if (out.gpio[key] && out.gpio[key] !== g.mode) out.errors.set(n.id, 'Ezt a GPIO-t egy másik blokk is használja');
    out.gpio[key] = g.mode;
    if (g.pwm) out.pwm[key] = g.pwm;
  }
  return out;
}

/** A terv a program GPIO-beállításaival (a szimuláció és az ellenőrzés ezt kapja futás közben). */
export const withProgram = (D: Design, o: ProgOut | null): Design =>
  o ? { ...D, gpio: { ...D.gpio, ...o.gpio }, pwm: { ...(D.pwm || {}), ...o.pwm } } : D;
