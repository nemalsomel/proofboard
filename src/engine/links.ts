/** Kapcsolatok (links): lábhivatkozások feloldása, egyenértékű lábak, feliratok és a bekötöttségi állapot. */
import type { PartInstance } from '../core/schema';
import { DEFS, isMcu, isOff } from './defs';
import { plugOf } from './plug';
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
    const offRef = (ref: string) => { const q = findPin(D, ref); return !!q && isOff(q.part) && !plugOf(D, q.part); }; // csatlakozóba dugva nem szabad kábel
    out.set(l.id, { ok, gpio: gp ? gp.name : null, gpioRef: gp ? gp.part.id + '.' + gp.id : null, nb, wire, cable: offRef(l.a) || offRef(l.b) });
  }
  return out;
}

/* ---------- Bekötés lábanként (tulajdonságok) és a kapcsolat célja ---------- */
/** A lábszerepek magyar neve a lábtáblázathoz. */
export const ROLE_HU: Record<string, string> = {
  gnd: 'föld', vin: 'tápbemenet', pwr: 'táp', p33: '3,3 V', gpio: 'GPIO', sig: 'jel', adc: 'analóg jel', out: 'kimenet', pout: 'tápkimenet',
  A: 'kapcsoló A', B: 'kapcsoló B', base: 'bázis', col: 'kollektor', emit: 'emitter', g: 'gate', d: 'drain', s: 'source',
  an: 'anód', ka: 'katód', cp: '+', cn: '−', bp: '+', bn: '−', coil: 'tekercs', chg: 'töltés', r: 'ellenállás', c: 'kondenzátor', j: 'átkötés', h: 'tüske',
};
/** Kötelező lábak: ha az alkatrész már be van kötve, de ezek lebegnek, a Problémák között jelezzük. */
export const REQUIRED_ROLES = new Set(['gnd', 'vin']);

export interface PinRow {
  /** az egyenértékű lábcsoport képviselője (pl. gomb A1 az A1/A2-ből) */ ref: string;
  label: string; name: string; role: string;
  /** a lábat érintő kapcsolat és annak másik vége ('GND', 'GPIO' vagy lábhivatkozás) */ link: Link | null; target: string | null;
  /** a vele egy hálón lévő más alkatrészek lábai */ net: string[];
  /** a panelon van-e (külső alkatrésznél a kivezetés mindig) */ on: boolean;
  /** sehova sincs kötve: se háló, se kapcsolat */ floating: boolean;
}
/** A kijelölt alkatrész lábai bekötöttséggel: lábcsoportonként egy sor. */
export function pinRows(D: Design, A: Netlist, p: PartInstance): PinRow[] {
  const g = partGroups(p), bp = A.byPart.get(p.id), out: PinRow[] = [], seen = new Set<string>();
  for (const q of placedPins(p)) {
    const k = g[q.id];
    if (seen.has(k)) continue;
    seen.add(k);
    const grp = placedPins(p).filter(x => g[x.id] === k), refs = new Set(grp.map(x => p.id + '.' + x.id));
    const link = D.links.find(l => refs.has(l.a) || refs.has(l.b)) || null;
    const target = link ? (refs.has(link.a) ? link.b : link.a) : null;
    const np = bp && bp.map[q.id], on = !!np && (np.on || isOff(p));
    const net = on && np ? [...new Set((A.netPins.get(np.net) || []).filter(x => x.part !== p || g[x.id] !== k).map(x => groupLabel(x)))] : [];
    out.push({ ref: p.id + '.' + q.id, label: groupLabel(q), name: grp.map(x => x.name).filter((v, i, a) => a.indexOf(v) === i).join('/'), role: q.role, link, target, net, on, floating: !link && !net.length });
  }
  return out;
}

export interface TargetOpt { value: string; label: string; group: string }
/** Kapcsolat lehetséges céljai: föld, szabad GPIO, a vezérlő táplábai és GPIO-i, a többi alkatrész lábai. */
export function linkTargets(D: Design, A: Netlist, exceptPart?: string): TargetOpt[] {
  const o: TargetOpt[] = [{ value: 'GND', label: 'GND (föld)', group: 'Általános' }, { value: 'GPIO', label: 'szabad GPIO (az útvonalkereső választ)', group: 'Általános' }];
  const st = linkStates(D, A), usedGpio = new Map<string, string>();
  for (const l of D.links) { const s = st.get(l.id); if (s && s.gpioRef) usedGpio.set(s.gpioRef, linkText(D, l).split(' → ')[0]); }
  for (const p of D.parts) {
    if (p.id === exceptPart) continue;
    const g = partGroups(p), seen = new Set<string>();
    for (const q of placedPins(p)) {
      if (seen.has(g[q.id])) continue;
      seen.add(g[q.id]);
      const ref = p.id + '.' + q.id;
      if (isMcu(p)) {
        if (q.role === 'gnd') continue; // a föld az Általános csoportban
        if (q.role === 'gpio') { const u = usedGpio.get(ref); o.push({ value: ref, label: `${q.name}${u ? ` (foglalt: ${u})` : ''}`, group: `${p.label}: GPIO` }); }
        else o.push({ value: ref, label: q.name, group: `${p.label}: táp` });
      } else o.push({ value: ref, label: `${groupLabel(q)}${ROLE_HU[q.role] ? ` · ${ROLE_HU[q.role]}` : ''}`, group: `${p.label} (${DEFS[p.type].def.name})` });
    }
  }
  return o;
}

/**
 * A láb (vagy lábcsoportja) kapcsolatának beállítása: üres cél → a kapcsolat törlődik; meglévőnél a másik vég
 * cserélődik (a GPIO-hozzárendelés újraszámolódik), különben új kapcsolat. Igazat ad, ha változott valami.
 */
export function setPinLink(D: Design, ref: string, target: string, newId: () => string): boolean {
  const q = findPin(D, ref);
  if (!q) return false;
  const refs = new Set(equivPins(q).map(x => q.part.id + '.' + x.id));
  const i = D.links.findIndex(l => refs.has(l.a) || refs.has(l.b));
  if (refs.has(target)) return false;
  if (!target) { if (i < 0) return false; D.links.splice(i, 1); return true; }
  if (i >= 0) {
    const l = D.links[i], cur = refs.has(l.a) ? l.b : l.a;
    if (cur === target) return false;
    D.links[i] = { id: l.id, a: ref, b: target, gpio: null };
    return true;
  }
  D.links.push({ id: newId(), a: ref, b: target, gpio: null });
  return true;
}
/** Kapcsolat céljának (másik végének) cseréje a Kapcsolatok fülön. */
export function setLinkTarget(D: Design, id: string, target: string): boolean {
  const l = D.links.find(x => x.id === id);
  if (!l || !target || l.b === target || l.a === target) return false;
  l.b = target; l.gpio = null;
  return true;
}
