/** Kapcsolatok (links): lábhivatkozások feloldása, egyenértékű lábak, feliratok és a bekötöttségi állapot. */
import { N_, fmt, type Tr } from '../i18n/i18n';
import type { PartInstance } from '../core/schema';
import { DEFS, isMcu, isOff } from './defs';
import { plugOf } from './plug';
import { placedPins } from './geometry';
import { hasCap } from './mcu';
import { pinLabel, type Netlist } from './netlist';
import type { AutoBridge, Design, Hole, Link, PlacedPin, Wire } from './types';

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
  gnd: N_('föld'), vin: N_('tápbemenet'), pwr: N_('táp'), p33: N_('3,3 V'), gpio: 'GPIO', sig: N_('jel'), adc: N_('analóg jel'), out: N_('kimenet'), pout: N_('tápkimenet'),
  A: N_('kapcsoló A'), B: N_('kapcsoló B'), base: N_('bázis'), col: N_('kollektor'), emit: N_('emitter'), g: N_('gate'), d: N_('drain'), s: N_('source'),
  an: N_('anód'), ka: N_('katód'), cp: '+', cn: '−', bp: '+', bn: '−', coil: N_('tekercs'), chg: N_('töltés'), r: N_('ellenállás'), c: N_('kondenzátor'), j: N_('átkötés'), h: N_('tüske'), mech: N_('rögzítés'),
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
export function linkTargets(D: Design, A: Netlist, exceptPart?: string, tr: Tr = fmt): TargetOpt[] {
  const o: TargetOpt[] = [{ value: 'GND', label: tr('GND (föld)'), group: tr('Általános') }, { value: 'GPIO', label: tr('szabad GPIO (az útvonalkereső választ)'), group: tr('Általános') }];
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
        if (q.role === 'gpio') { const u = usedGpio.get(ref); o.push({ value: ref, label: u ? tr('{x} (foglalt: {y})', { x: q.name, y: u }) : q.name, group: `${p.label}: GPIO` }); }
        else o.push({ value: ref, label: q.name, group: tr('{x}: táp', { x: p.label }) });
      } else o.push({ value: ref, label: `${groupLabel(q)}${ROLE_HU[q.role] ? ` · ${tr(ROLE_HU[q.role])}` : ''}`, group: `${p.label} (${tr(DEFS[p.type].def.name)})` });
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

/* ---------- Kapcsolati geometria: a kiemelés és a kapcsolati vonalak végpontjai ---------- */

const onBoard = (D: Design, r: number, c: number) => r >= 0 && c >= 0 && r < D.board.rows && c < D.board.cols;
type Pt = Pick<PlacedPin, 'r' | 'c'>;

/**
 * A kapcsolat célpontja a megadott forráslábtól (kapcsolati vonalhoz): láb–láb kapcsolatnál a cél azonos lábai közül
 * a legközelebbi; GPIO-nál a kiosztott (vagy javasolt) GPIO, különben a legközelebbi szabad, megfelelő képességű;
 * GND-nél a legközelebbi GND-hálózati láb (bekötött kapcsolatnál a saját hálózatán belül a vezérlő GND-je).
 */
export function ratTarget(D: Design, A: Netlist, l: Link, st: LinkState | null | undefined, a?: PlacedPin | null): PlacedPin | null {
  a = a || findPin(D, l.a); if (!a) return null;
  const near = <T extends PlacedPin>(qs: Iterable<T>, w: (q: T) => number, ok: (q: T) => boolean = () => true): T | null => {
    let bt: T | null = null, bd = 1e9; for (const q of qs) { if (!ok(q)) continue; const d = w(q); if (d < bd) { bd = d; bt = q; } } return bt;
  };
  const A0 = a, man = (q: Pt) => Math.abs(q.r - A0.r) / 3 + Math.abs(q.c - A0.c);
  if (l.b !== 'GND' && l.b !== 'GPIO') return near(equivPins(findPin(D, l.b)), t => Math.hypot(t.r - A0.r, t.c - A0.c));
  const na = onBoard(D, a.r, a.c) ? A.find(A.sid(a.r, a.c)) : -1;
  if (l.b === 'GPIO') {
    const ref = (st && st.gpioRef) || l.gpio, t = ref && findPin(D, ref); if (t) return t;
    const an = a.role === 'adc';
    return near(A.pins, man, q => isMcu(q.part) && q.role === 'gpio' && q.on && !(an && !hasCap(q, 'adc'))
      && !((A.netPins.get(q.net) || []).length > 1 || (A.netSecs.get(q.net) || 0) > 1));
  }
  let bt: PlacedPin | null = null, bd = 1e9;
  for (const [net, qs] of A.netPins) {
    if (!qs.some(q => isMcu(q.part) && q.role === 'gnd')) continue;
    if (st && st.ok) { if (net !== na) continue; for (const q of qs) { if (!isMcu(q.part) || q.role !== 'gnd') continue; const d = man(q); if (d < bd) { bd = d; bt = q; } } }
    else { if (net === na) continue; for (const q of qs) { if (q.part === a.part) continue; const d = man(q); if (d < bd) { bd = d; bt = q; } } }
  }
  return bt;
}

/** A kijelölt kapcsolat kiemelése: kezdő- és végpont, a saját automatikus hídjai és vezetékei. */
export interface LinkGeom { start: Hole; end: Hole | null; endPin: PlacedPin | null; bridges: AutoBridge[]; wires: Wire[] }

/**
 * Kezdő- és végpont: ha a kapcsolatnak saját automatikus útvonala van, a forrás cellájától a legtávolabbi elért cella
 * (ott a legközelebbi idegen láb, ha van); különben a legközelebbi cél (`ratTarget`).
 */
export function linkGeom(D: Design, A: Netlist, l: Link | null | undefined, st?: LinkState | null): LinkGeom | null {
  if (!l) return null;
  const as = equivPins(findPin(D, l.a)).filter(q => onBoard(D, q.r, q.c)); if (!as.length) return null;
  const own = D.auto.bridges.filter(b => (b[4] || []).includes(l.id)), ownW = D.auto.wires.filter(w => (w.links || []).includes(l.id));
  if (own.length || ownW.length) {
    const adj = new Map<number, Array<[number, Hole]>>(), add = (x: number, y: number, h: Hole) => { if (!adj.has(x)) adj.set(x, []); adj.get(x)!.push([y, h]); };
    for (const b of own) { const x = A.sid(b[0], b[1]), y = A.sid(b[2], b[3]); add(x, y, [b[2], b[3]]); add(y, x, [b[0], b[1]]); }
    for (const w of ownW) { const x = A.sid(w.a[0], w.a[1]), y = A.sid(w.b[0], w.b[1]); add(x, y, w.b); add(y, x, w.a); }
    const srcCells = new Set(as.map(q => A.sid(q.r, q.c)));
    const start = as.find(q => adj.has(A.sid(q.r, q.c))) || as[0];
    const dist = new Map<number, number>(), hole = new Map<number, Hole>(), qu: number[] = [];
    for (const c of srcCells) { dist.set(c, 0); qu.push(c); }
    let far: number | null = null;
    while (qu.length) {
      const x = qu.shift()!;
      for (const [y, h] of adj.get(x) || []) { if (dist.has(y)) continue; dist.set(y, dist.get(x)! + 1); hole.set(y, h); qu.push(y); if (far == null || dist.get(y)! > dist.get(far)!) far = y; }
    }
    let end: Pt | null = null, endPin: PlacedPin | null = null;
    if (far != null) {
      const h = hole.get(far)!, cand = A.pins.filter(q => q.on && A.sid(q.r, q.c) === far && q.part !== start.part);
      if (cand.length) { cand.sort((a, b) => Math.hypot(a.r - h[0], a.c - h[1]) - Math.hypot(b.r - h[0], b.c - h[1])); end = endPin = cand[0]; } else end = { r: h[0], c: h[1] };
    }
    return { start: [start.r, start.c], end: end ? [end.r, end.c] : null, endPin, bridges: own, wires: ownW };
  }
  let best: LinkGeom | null = null, bd = 1e9;
  for (const a0 of as) { const t = ratTarget(D, A, l, st, a0); if (!t) continue; const d = Math.hypot(t.r - a0.r, t.c - a0.c); if (d < bd) { bd = d; best = { start: [a0.r, a0.c], end: [t.r, t.c], endPin: t, bridges: [], wires: [] }; } }
  return best || { start: [as[0].r, as[0].c], end: null, endPin: null, bridges: [], wires: [] };
}
