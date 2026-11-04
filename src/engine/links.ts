/** Kapcsolatok (links): lábhivatkozások feloldása, egyenértékű lábak, feliratok és a bekötöttségi állapot. */
import type { PartInstance } from '../core/schema';
import { DEFS, isMcu, isOff } from './defs';
import { placedPins } from './geometry';
import { hasCap } from './mcu';
import { pinLabel, type Netlist } from './netlist';
import type { Design, Link, PlacedPin } from './types';

/** 'p3.A1' → a láb panel-koordinátákkal, vagy null. */
export function findPin(D: Design, ref: string): PlacedPin | null {
  const i = ref.indexOf('.');
  if (i < 0) return null;
  const p = D.parts.find(x => x.id === ref.slice(0, i));
  if (!p) return null;
  return placedPins(p).find(q => q.id === ref.slice(i + 1)) || null;
}
/** Láb → a gyárilag összekötött csoportjának képviselője (pl. gomb A1/A2 → A1). */
export function partGroups(p: PartInstance): Record<string, string> {
  const g: Record<string, string> = {};
  const f = (x: string): string => (g[x] === x ? x : (g[x] = f(g[x])));
  DEFS[p.type].pins(p).forEach(pn => (g[pn.id] = pn.id));
  for (const [a, b] of DEFS[p.type].internal(p)) g[f(a)] = f(b);
  const o: Record<string, string> = {};
  for (const k in g) o[k] = f(k);
  return o;
}
/** A lábbal gyárilag összekötött lábak (önmagával együtt). */
export function equivPins(q: PlacedPin | null): PlacedPin[] {
  if (!q) return [];
  const g = partGroups(q.part), k = g[q.id];
  return placedPins(q.part).filter(x => g[x.id] === k);
}
export function groupLabel(q: PlacedPin | null): string {
  if (!q) return '?';
  const eq = equivPins(q);
  if (eq.length < 2) return pinLabel(q);
  if (q.part.type === 'button') return `${q.part.label}.${q.role}`;
  if (isMcu(q.part) && q.role === 'gnd') return `${q.part.label}.GND`;
  return `${q.part.label}.${eq.map(x => x.id).join('/')}`;
}
export function linkText(D: Design, l: Link): string {
  const a = findPin(D, l.a);
  const b = l.b === 'GND' ? 'GND' : l.b === 'GPIO' ? 'GPIO' : groupLabel(findPin(D, l.b));
  return `${groupLabel(a)} → ${b}`;
}

export interface LinkState { ok: boolean; gpio: string | null; gpioRef: string | null; nb: number; wire: boolean; cable: boolean }
/** Kapcsolatonként: be van-e kötve a netlista szerint, melyik GPIO-ra, hány automatikus híd, vezeték vagy kábel viszi. */
export function linkStates(D: Design, A: Netlist): Map<string, LinkState> {
  const out = new Map<string, LinkState>();
  const pinNet = (ref: string) => {
    const i = ref.indexOf('.'), bp = A.byPart.get(ref.slice(0, i)), q = bp && bp.map[ref.slice(i + 1)];
    if (!q || (!q.on && !isOff(q.part))) return -1;
    return q.net;
  };
  for (const l of D.links) {
    const na = pinNet(l.a);
    let ok = false, gp: PlacedPin | null | undefined = null;
    if (na >= 0) {
      const qs = A.netPins.get(na) || [];
      if (l.b === 'GND') ok = qs.some(q => isMcu(q.part) && q.role === 'gnd');
      else if (l.b === 'GPIO') {
        const an = (findPin(D, l.a) || { role: '' }).role === 'adc';
        gp = qs.find(q => isMcu(q.part) && q.role === 'gpio' && (!an || hasCap(q, 'adc')));
        ok = !!gp;
      } else ok = pinNet(l.b) === na;
    }
    const nb = D.auto.bridges.filter(b => (b[4] || []).includes(l.id)).length, wire = D.auto.wires.some(w => (w.links || []).includes(l.id));
    const offRef = (ref: string) => { const q = findPin(D, ref); return !!q && isOff(q.part); };
    out.set(l.id, { ok, gpio: gp ? gp.name : null, gpioRef: gp ? gp.part.id + '.' + gp.id : null, nb, wire, cable: offRef(l.a) || offRef(l.b) });
  }
  return out;
}
