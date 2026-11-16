/**
 * Mérőműszerek (DOM-mentes): a szimuláció eredményéből feszültség két pont között, áram egy alkatrész lábán,
 * és – a táp nélküli áramkörön – ellenállás és szakadásvizsgálat. A mérőpont egy lyuk ([sor, oszlop]);
 * a fekete csúcs hiányában a GND a viszonyítás (a vezérlőlap vagy bármely alkatrész GND lába).
 */
import { fmtSI, num } from '../core/expr';
import { fmt, type Tr } from '../i18n/i18n';
import { DEFS, isMcu, penv } from './defs';
import { pinLabel, type Netlist } from './netlist';
import type { SimResult } from './simulate';
import { solve, type Branch } from './solve';
import type { Design, Meter, MeterMode, NetPin, ProbeAt } from './types';

export type ReadingStatus = 'ok' | 'nosim' | 'float' | 'open' | 'noprobe' | 'nopin' | 'nognd';
export interface Reading {
  mode: MeterMode;
  /** a mért érték (V, A vagy Ω; szakadásnál Ω), ha van */ value: number | null;
  status: ReadingStatus;
  /** szakadásvizsgálatnál: van-e átvezetés (csipog) */ cont?: boolean;
  /** áramnál a mért láb címkéje (pl. „R1.2”) */ pin?: string;
}
/** Ennél kisebb ellenállás: átvezetés (szakadásvizsgálat csipog). */
export const CONT_OHM = 30;
/** Ennél nagyobb: nyitott (OL). */
export const OPEN_OHM = 50e6;

const inBoard = (D: Design, at: ProbeAt | null): at is ProbeAt => !!at && at[0] >= 0 && at[1] >= 0 && at[0] < D.board.rows && at[1] < D.board.cols;
/** A lyuk hálózata (a netlista gyökere). */
export function netAt(A: Netlist, at: ProbeAt): number { return A.find(A.sid(at[0], at[1])); }
/** A lyukba forrasztott láb (ha van). */
export function pinAt(A: Netlist, at: ProbeAt): NetPin | null { return A.pins.find(q => q.on && q.r === at[0] && q.c === at[1]) || null; }
/** A GND hálózata: a vezérlőlap GND lába, különben bármely GND szerepű láb, végül egy telep / tápforrás negatív sarka. */
export function gndNet(A: Netlist): number | null {
  const q = A.pins.find(x => x.role === 'gnd' && isMcu(x.part)) || A.pins.find(x => x.role === 'gnd');
  if (q) return q.net;
  for (const bp of A.byPart.values()) {
    const p = bp.pins[0]?.part, model = p && DEFS[p.type]?.def.model; if (!model) continue;
    for (const el of model as Array<Record<string, unknown>>) if (el.el === 'source' && bp.map[String(el.n)]) return bp.map[String(el.n)].net;
  }
  return null;
}

/** Feszültség egy lyukon a GND-hez képest (szondához); null: nincs szimuláció vagy lebeg. */
export function probeVoltage(D: Design, A: Netlist, sim: SimResult | null, at: ProbeAt): number | null {
  if (!sim || !inBoard(D, at)) return null;
  const n = netAt(A, at), g = gndNet(A);
  if (!sim.netV.has(n) || sim.floating.has(n)) return null;
  return (sim.netV.get(n) || 0) - (g != null ? sim.netV.get(g) || 0 : 0);
}

/**
 * Ellenállás két hálózat között a táp nélküli áramkörben: ellenállások, motorok, tekercsek (a félvezetők, a kondenzátorok
 * és a források nyitottak). Azonos hálózat: 0; nincs út: Infinity.
 */
export function resistance(D: Design, A: Netlist, na: number, nb: number): number {
  if (na === nb) return 0;
  const idx = new Map<number, number>(), nd = (net: number) => { if (!idx.has(net)) idx.set(net, idx.size); return idx.get(net)!; };
  nd(na); nd(nb);
  const els: Branch[] = [];
  for (const p of D.parts) {
    const bp = A.byPart.get(p.id), model = DEFS[p.type]?.def.model; if (!bp || !model) continue;
    const E = penv(p), net = (id: unknown) => { const q = bp.map[String(id)]; return q ? nd(q.net) : null; };
    const res = (a: unknown, b: unknown, ohm: unknown) => { const x = net(a), y = net(b), R = num(ohm, E); if (x != null && y != null && x !== y && isFinite(R) && R > 0) els.push({ a: x, b: y, g: 1 / Math.max(1e-3, R), E: 0 }); };
    for (const el of model as Array<Record<string, unknown>>) {
      if (el.el === 'resistor') res(el.a, el.b, el.ohm);
      else if (el.el === 'motor') res(el.a, el.b, el.ohm);
      else if (el.el === 'stepper') for (const k of ['a', 'b', 'c', 'd']) res(el.com, el[k], el.ohm);
    }
  }
  const n = idx.size, ia = idx.get(na)!, ib = idx.get(nb)!;
  for (let i = 0; i < n; i++) els.push({ a: i, b: -1, g: 1e-12, E: 0 });
  els.push({ a: ib, b: -1, g: 1e6, E: 0 });
  // 1 mA a mért pontból a referenciába
  els.push({ a: ia, b: -1, g: 1e-9, E: -1e6 });
  const V = solve(n, els), R = Math.abs(V[ia] - V[ib]) / 1e-3;
  return R > OPEN_OHM ? Infinity : R;
}

/** A multiméter leolvasása a mód szerint. `sim`: a futó szimuláció eredménye (V és A módhoz kell). */
export function readMeter(D: Design, A: Netlist, sim: SimResult | null, m: Pick<Meter, 'mode' | 'red' | 'black'>): Reading {
  const mode = m.mode;
  if (!inBoard(D, m.red)) return { mode, value: null, status: 'noprobe' };
  if (mode === 'A') {
    if (!sim) return { mode, value: null, status: 'nosim' };
    const q = pinAt(A, m.red);
    if (!q) return { mode, value: null, status: 'nopin' };
    return { mode, value: sim.pinI?.get(q.part.id + '.' + q.id) ?? 0, status: 'ok', pin: pinLabel(q) };
  }
  const na = netAt(A, m.red), nb = inBoard(D, m.black) ? netAt(A, m.black) : gndNet(A);
  if (nb == null) return { mode, value: null, status: 'nognd' };
  if (mode === 'V') {
    if (!sim) return { mode, value: null, status: 'nosim' };
    if (!sim.netV.has(na) || !sim.netV.has(nb) || sim.floating.has(na) || sim.floating.has(nb)) return { mode, value: null, status: 'float' };
    return { mode, value: (sim.netV.get(na) || 0) - (sim.netV.get(nb) || 0), status: 'ok' };
  }
  const R = resistance(D, A, na, nb);
  if (!isFinite(R)) return { mode, value: null, status: 'open', cont: false };
  return { mode, value: R, status: 'ok', cont: R < CONT_OHM };
}

const UNIT: Record<MeterMode, string> = { V: 'V', A: 'A', R: 'Ω', C: 'Ω' };
/** A kijelzőn látszó érték: „3,28 V”, „12,4 mA”, „1,2 kΩ”, „OL”, „– – –”. */
export function fmtReading(r: Reading, tr: Tr = fmt): string {
  if (r.status === 'open') return 'OL';
  if (r.value == null) return '– – –';
  if (r.mode === 'V') return `${r.value.toFixed(Math.abs(r.value) >= 10 ? 2 : 3)} V`;
  if (r.mode === 'C' && r.cont) return `${fmtSI(r.value)}Ω · ${tr('átvezet')}`;
  return `${fmtSI(r.value)}${UNIT[r.mode]}`;
}
/** Magyarázat, ha nincs érték (a kijelző alatt). */
export function readingHint(r: Reading, tr: Tr = fmt): string {
  switch (r.status) {
    case 'nosim': return tr('Indítsd el a szimulációt a méréshez.');
    case 'noprobe': return tr('Tedd le a piros mérőcsúcsot egy lyukra.');
    case 'nopin': return tr('Árammérés: a piros csúcsot egy alkatrész lábára tedd.');
    case 'nognd': return tr('Nincs GND a tervben: tedd le a fekete csúcsot is.');
    case 'float': return tr('A mért pont nincs bekötve, vagy lebeg (nincs táphoz kötve).');
    case 'open': return tr('Nincs összeköttetés (szakadás).');
    default: return r.mode === 'A' && r.pin ? tr('A(z) {p} lábon befolyó áram (negatív: kifolyik).', { p: r.pin }) : r.mode === 'R' || r.mode === 'C' ? tr('Táp nélküli áramkörön mérve (ellenállások, motorok, tekercsek).') : '';
  }
}

/* ---------- Áramfelvétel ---------- */

export interface PowerSource { label: string; kind: 'usb' | 'battery'; /** feszültség (V) */ V: number; /** a leadott áram (A; negatív: töltődik) */ I: number; /** teljesítmény (W) */ P: number }
export interface PowerPart { label: string; type: string; /** a lábain befolyó áramok összege (A) */ I: number; /** a felvett teljesítmény (W): Σ U·I a lábain */ P: number }
export interface PowerSummary { sources: PowerSource[]; parts: PowerPart[]; /** a források összes árama és teljesítménye */ I: number; P: number }

/**
 * Áramfelvétel a szimuláció eredményéből: a források (USB, telepek) leadott árama és teljesítménye, és alkatrészenként
 * a felvett teljesítmény (Σ U·I a lábain, a GND-hez mérve) és áram (a befolyó áramok összege). A sorrend a teljesítmény szerint csökkenő.
 */
export function powerSummary(D: Design, A: Netlist, sim: SimResult): PowerSummary {
  const g = gndNet(A), V0 = g != null ? sim.netV.get(g) || 0 : 0, sources: PowerSource[] = [], parts: PowerPart[] = [];
  const srcParts = new Set<string>();
  // USB-ről táplált vezérlőlap: a forrás az USB (5 V), az árama a lap GND-lábain visszafolyó áram (a GPIO-k és a 3V3 terhelése)
  if (D.settings.usb) for (const m of sim.picos) {
    if (!m.powered) continue;
    const bp = A.byPart.get(m.p.id); if (!bp) continue;
    const I = bp.pins.filter(q => q.role === 'gnd').reduce((t, q) => t + (sim.pinI?.get(m.p.id + '.' + q.id) || 0), 0);
    srcParts.add(m.p.id);
    sources.push({ label: m.p.label + ' USB', kind: 'usb', V: 5, I: Math.max(0, I), P: 5 * Math.max(0, I) });
  }
  for (const b of sim.bats) {
    srcParts.add(b.p.id);
    const bp = A.byPart.get(b.p.id), pins = bp ? bp.pins : [];
    const vs = pins.map(q => (sim.netV.get(q.net) || 0) - V0), U = vs.length ? Math.max(...vs) - Math.min(...vs) : 0;
    sources.push({ label: b.p.label, kind: 'battery', V: U, I: -b.I, P: -b.I * U });
  }
  for (const p of D.parts) {
    if (srcParts.has(p.id)) continue;
    const bp = A.byPart.get(p.id); if (!bp) continue;
    let I = 0, P = 0;
    for (const q of bp.pins) {
      const i = sim.pinI?.get(p.id + '.' + q.id) || 0, u = (sim.netV.get(q.net) || 0) - V0;
      if (i > 0) I += i;
      P += u * i;
    }
    // a tápot továbbadó alkatrész (vezérlőlap szabályzója) nettó leadó: nem fogyasztó
    if (P > 1e-7) parts.push({ label: p.label, type: p.type, I, P });
  }
  parts.sort((a, b) => b.P - a.P);
  return { sources, parts, I: sources.reduce((t, s) => t + s.I, 0), P: sources.reduce((t, s) => t + s.P, 0) };
}

/** Becsült üzemidő (óra) a telep kapacitásából (mAh) és az áramából (A); null, ha nincs fogyasztás. */
export function batteryHours(mAh: number, I: number): number | null {
  return I > 1e-6 && mAh > 0 ? mAh / (I * 1000) : null;
}
