/**
 * Ellenőrzés: a netlistából (és ha fut, a szimulációból) zárlatok, ütközések, rossz bekötések,
 * túláram, hiányzó táp, lábképesség- és buszfunkció-hibák. Minden hiba helyet (lyukakat) is ad.
 */
import { fmtSI } from '../core/expr';
import { fmt, type Tr } from '../i18n/i18n';
import type { PartInstance } from '../core/schema';
import { DEFS, hasPress, isMcu, isOff } from './defs';
import { plugOf } from './plug';
import { inBoard, placedPins, xf } from './geometry';
import { findPin, linkText, partGroups, pinRows, REQUIRED_ROLES, ROLE_HU, type LinkState } from './links';
import { fnCaps, fnName, fnWant, GPIO_MODES, hasAdc, hasCap, mcuMux, SPECIAL_CAPS } from './mcu';
import { layoutOf, pinLabel, type Netlist } from './netlist';
import { gpioMode, pwmCfg, type SimResult } from './simulate';
import type { Design, Hole, NetPin } from './types';
import { layoutStats } from './compact';
import { drillOf, headOf, PITCH } from './manufacture';
/** e kitöltés alatt jelez a Problémák a szellős tervre */
export const SPARSE_FILL = 0.21;

/** err: nem fog működni; warn: gyanús; info: tájékoztatás (pl. lebegő kötelező láb egy részben bekötött alkatrészen). */
/** `act`: a felület a sorhoz gombot tesz (pl. 'compact': Tömörítés…). */
export interface Issue { sev: 'err' | 'warn' | 'info'; msg: string; holes: Hole[]; act?: 'compact' }
export interface CheckCtx {
  /** Fordító az üzenetekhez (alapból magyar). */
  tr?: Tr;
  /** Netlista lenyomott gombok nélkül. */
  A0: Netlist;
  /** A szimulációhoz használt netlista (lenyomott gombokkal). */
  AS: Netlist;
  SIM: SimResult | null;
  linkState: Map<string, LinkState>;
}

/** Szabad lyuk ugyanabban a csíkdarabban (vezetékvég áthelyezéséhez). */
export function freeHoleNear(D: Design, r: number, c: number, pinHole: Set<string>): string | null {
  const LY = layoutOf(D), g = LY.segs[LY.cell(r, c)];
  if (g.drilled) return null;
  for (let i = g.r0; i <= g.r1; i++) {
    if (i === r || !inBoard(D.board, i, c)) continue;
    const k = i + ':' + c;
    if (!pinHole.has(k) && !D.wires.some(w => (w.a[0] === i && w.a[1] === c) || (w.b[0] === i && w.b[1] === c))) return k;
  }
  return null;
}

export function checkAll(D: Design, { A0: A, AS, SIM, linkState, tr = fmt }: CheckCtx): Issue[] {
  const iss: Issue[] = [], add = (sev: Issue['sev'], msg: string, holes?: Hole[]) => iss.push({ sev, msg, holes: holes || [] });
  const inb = (r: number, c: number) => inBoard(D.board, r, c), at = (q: { r: number; c: number }): Hole[] => [[q.r, q.c]];
  const hasMcu = D.parts.some(p => isMcu(p));
  for (const p of D.parts) { const bp = A.byPart.get(p.id)!; if (!isOff(p) && bp.pins.every(q => !q.on)) add('warn', tr('{a}: teljesen a panelon kívül esik', { a: p.label }), []); }
  for (const p of D.parts) if (p.plug && !plugOf(D, p)) {
    const h = D.parts.find(x => x.id === p.plug);
    if (h) add('warn', tr('{a}: a {b} csatlakozónak kevesebb lába van, mint a kábelnek ({c}), így nincs bedugva', { a: p.label, b: h.label, c: DEFS[p.type].pins(p).length }), placedPins(h).map(q => [q.r, q.c] as Hole));
  }
  // lebegő kötelező láb (föld, tápbemenet) egy már bekötött alkatrészen; a vezérlőlap kimarad (sok lába szabad)
  for (const p of D.parts) {
    if (isMcu(p)) continue;
    const rows = pinRows(D, A, p);
    if (!rows.some(r => !r.floating)) continue;
    for (const r of rows) if (r.floating && r.on && REQUIRED_ROLES.has(r.role)) add('info', tr('{a}: a {b} láb sehova sincs kötve', { a: r.label, b: tr(ROLE_HU[r.role]) }), (() => { const q = findPin(D, r.ref); return q ? at(q) : []; })());
  }
  const hole = new Map<string, NetPin[]>();
  for (const q of A.pins) { if (!q.on) continue; const k = q.r + ':' + q.c; if (!hole.has(k)) hole.set(k, []); hole.get(k)!.push(q); }
  for (const [k, a] of hole) if (a.length > 1) add('err', tr('Ütközés a {a} lyukban: {b}', { a: k, b: a.map(pinLabel).join(', ') }), at(a[0]));
  // rögzítőfurat: a csavarfej helyén ne legyen láb; a furat csíkján lévő más bekötést a fém csavar összeköti
  for (const p of D.parts) {
    const dr = drillOf(p); if (!dr || isOff(p)) continue;
    const rad = (headOf(p) || dr * 2) / 2 / PITCH, me = A.byPart.get(p.id)?.pins[0];
    const near = A.pins.filter(q => q.on && q.part.id !== p.id && Math.hypot(q.r - p.r, q.c - p.c) < rad + 0.35);
    if (near.length) add('warn', tr('{a}: a csavarfej helyén alkatrészláb van ({b})', { a: p.label, b: near.slice(0, 4).map(pinLabel).join(', ') }), [[p.r, p.c]]);
    else if (me && me.on) {
      const same = A.pins.filter(q => q.on && q.net === me.net && q.part.id !== p.id);
      if (same.length) add('info', tr('{a}: a furat csíkján bekötés is van ({b}); fém csavar ezt a házzal is összeköti – vágd el a csíkot a furat mellett, vagy használj műanyag csavart', { a: p.label, b: same.slice(0, 3).map(pinLabel).join(', ') }), [[p.r, p.c]]);
    }
  }
  // kifúrt (vágott) lyuk: nincs alatta réz
  {
    const LY = layoutOf(D);
    for (const [k, a] of hole) { const q = a[0]; if (LY.drilled(q.r, q.c)) add('err', tr('{a} kifúrt lyukban van ({b}), nincs alatta réz: a láb sehová sem csatlakozik', { a: pinLabel(q), b: k }), at(q)); }
    for (const w of D.wires) for (const e of [w.a, w.b]) if (inb(e[0], e[1]) && LY.drilled(e[0], e[1])) add('warn', tr('Vezetékvég kifúrt lyukban ({a}:{b}): nincs alatta réz', { a: e[0], b: e[1] }), [e]);
    for (const b of D.bridges) if (LY.drilled(b[0], b[1]) || LY.drilled(b[2], b[3])) add('warn', tr('Híd kifúrt lyuknál ({a}:{b}–{c}:{d})', { a: b[0], b: b[1], c: b[2], d: b[3] }), [[b[0], b[1]]]);
  }
  // alkatrészen belüli rövidzár (vezérlőlap kivételével)
  for (const p of D.parts) {
    if (isMcu(p)) continue;
    const bp = A.byPart.get(p.id)!;
    const g: Record<string, string> = {}, f = (x: string): string => (g[x] === x ? x : (g[x] = f(g[x])));
    bp.pins.forEach(q => (g[q.id] = q.id));
    for (const [a, b] of DEFS[p.type].internal(p)) g[f(a)] = f(b);
    const byNet = new Map<number, Map<string, NetPin>>();
    for (const q of bp.pins) { const k = f(q.id); if (!byNet.has(q.net)) byNet.set(q.net, new Map()); const m = byNet.get(q.net)!; if (!m.has(k)) m.set(k, q); }
    const lg = (DEFS[p.type].def.model || []).some(e => e.el === 'logic'); // logikai IC-nél a bemenetek GND-re/VCC-re vagy egymásra kötése szokásos
    for (const [, m] of byNet) if (m.size > 1) {
      const qs = [...m.values()];
      if (lg) { const rs = new Set(qs.map(q => q.role)); if (!(rs.has('vin') && rs.has('gnd'))) continue; }
      const same = qs.some((x, i) => qs.some((y, j) => j > i && x.s === y.s));
      let msg = p.type === 'button' ? tr('{a}: az A és B oldal közös neten van, a gomb rövidre zárt', { a: p.label })
        : p.type === 'bat' ? tr('{a}: az akku + és − pólusa össze van kötve', { a: p.label }) : tr('{a}: {b} össze van kötve', { a: p.label, b: qs.map(q => q.name).join(' ' + tr('és') + ' ') });
      if (same) msg += tr(' (egy szekcióba esnek)');
      add(p.type === 'button' || p.type === 'bat' ? 'err' : 'warn', msg, qs.map(q => [q.r, q.c] as Hole));
    }
  }
  // net-szintű szabályok
  const picoSec: NetPin[][] = [];
  for (const [, qs] of A.netPins) {
    const pq = qs.filter(q => isMcu(q.part));
    const distinct = new Map<string, NetPin>();
    pq.forEach(q => { const k = q.part.id + '.' + (q.role === 'gnd' ? 'GND' : q.id); if (!distinct.has(k)) distinct.set(k, q); });
    const dq = [...distinct.values()];
    if (dq.length > 1) { const same = dq.some((x, i) => dq.some((y, j) => j > i && x.s === y.s && x.part === y.part)); if (same) { picoSec.push(dq); continue; } }
    const rails = new Set<string>();
    for (const q of qs) {
      if (isMcu(q.part)) { if (q.role === 'gnd') rails.add('GND'); else if (q.role === 'p33') rails.add('3V3'); else if (q.role === 'pwr') rails.add(q.name); }
      else if (q.role === 'bp' || q.role === 'chg' || q.role === 'pout') rails.add('BAT+');
    }
    const holes = qs.map(q => [q.r, q.c] as Hole);
    if (rails.has('GND') && rails.size > 1) add('err', tr('Zárlat: GND – {a}', { a: [...rails].filter(x => x !== 'GND').join(', ') }), holes);
    else if (rails.has('3V3') && rails.size > 1) add('err', tr('Zárlat: 3V3 – {a}', { a: [...rails].filter(x => x !== '3V3').join(', ') }), holes);
    const gp = dq.filter(q => q.role === 'gpio');
    if (gp.length > 1) add('warn', tr('{a} közös neten van', { a: gp.map(q => q.name).join(', ') }), holes);
    if (gp.length && rails.size) add('warn', tr('{a} közvetlenül {b}-re kötve', { a: gp.map(q => q.name).join(', '), b: [...rails].join('/') }), holes);
  }
  {
    const srcSig = new Map<string, { sg: string; q: NonNullable<ReturnType<typeof findPin>> }>();
    for (const l of D.links) {
      if (l.b !== 'GND' && l.b !== 'GPIO') continue;
      const q = findPin(D, l.a);
      if (!q) continue;
      const k = q.part.id + ':' + partGroups(q.part)[q.id];
      if (!srcSig.has(k)) srcSig.set(k, { sg: l.b === 'GND' ? 'GND' : 'G' + l.id, q });
    }
    for (const [, qs] of A.netPins) {
      const sigs = new Map<string, { part: PartInstance; name: string; id: string } | null>();
      if (qs.some(q => isMcu(q.part) && q.role === 'gnd')) sigs.set('GND', null);
      for (const q of qs) { const e = srcSig.get(q.part.id + ':' + partGroups(q.part)[q.id]); if (e && !sigs.has(e.sg)) sigs.set(e.sg, e.q); }
      if (sigs.size > 1) {
        const names = [...sigs.entries()].map(([, q]) => (q ? pinLabel(q) : 'GND'));
        add('err', tr('Összeérő jelek: {a}', { a: names.join(' · ') }), qs.map(q => [q.r, q.c] as Hole));
      } else {
        const btnA = new Map<string, NetPin>();
        for (const q of qs) if (q.part.type === 'button' && q.role === 'A') btnA.set(q.part.id, q);
        const gp = qs.find(q => isMcu(q.part) && q.role === 'gpio');
        if (gp && btnA.size > 1) add('warn', `${[...btnA.values()].map(q => q.part.label).join(', ')} ugyanazon a GPIO-n (${gp.name})`, [...btnA.values()].map(q => [q.r, q.c] as Hole));
      }
    }
  }
  {
    const box = (p: PartInstance) => {
      const b = DEFS[p.type].bounds(p), pts = ([[b.r0, b.c0], [b.r0, b.c1], [b.r1, b.c0], [b.r1, b.c1]] as const).map(([r, c]) => xf(p, r, c));
      const rs = pts.map(x => x[0]), cs = pts.map(x => x[1]);
      return [Math.min(...rs) + 0.25, Math.max(...rs) - 0.25, Math.min(...cs) + 0.25, Math.max(...cs) - 0.25];
    };
    const bx = D.parts.filter(p => !isOff(p)).map(p => [p, box(p)] as const);
    for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) {
      const [p, a] = bx[i], [q, b] = bx[j];
      if (a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3]) add('warn', tr('{a} és {b} teste átfed', { a: p.label, b: q.label }), [[p.r, p.c], [q.r, q.c]]);
    }
  }
  if (picoSec.length > 3) {
    const p = picoSec[0][0].part;
    add('err', tr('{a}: {b} szekcióban több láb közös szekcióba esik. A lábsor nem futhat szekcióirányban, forgasd 90°-kal.', { a: p.label, b: picoSec.length }), picoSec.flatMap(a => a.map(q => [q.r, q.c] as Hole)));
  } else for (const dq of picoSec) add('err', tr('Zárlat: {a} egy szekcióba esik', { a: dq.map(pinLabel).join(' · ') }), dq.map(q => [q.r, q.c] as Hole));
  // vezetékvégek
  const pinHole = new Set(A.pins.map(q => q.r + ':' + q.c)), wend = new Map<string, number>();
  D.wires.forEach(w => {
    for (const e of [w.a, w.b]) {
      if (!inb(e[0], e[1])) continue;
      const k = e[0] + ':' + e[1];
      wend.set(k, (wend.get(k) || 0) + 1);
      if (pinHole.has(k)) {
        const sug = freeHoleNear(D, e[0], e[1], pinHole);
        add('warn', tr('Vezetékvég a {a} lyukban egy alkatrészlábbal közösen, ez nem elég stabil.', { a: k }) + ' ' + (sug ? tr('Tedd át a {a} lyukba (ugyanaz a szekció).', { a: sug }) : tr('A szekcióban nincs szabad lyuk: hídd át egy oldalszomszédos szekcióba, és onnan vezesd tovább.')), [e]);
      }
    }
  });
  for (const [k, n] of wend) if (n > 1) { const [r, c] = k.split(':').map(Number); add('warn', tr('{a} vezetékvég ugyanabban a {b} lyukban', { a: n, b: k }), [[r, c]]); }
  // kapcsolatok, gombok GPIO nélkül
  for (const l of D.links) {
    const st = linkState.get(l.id);
    if (st && !st.ok) { const q = findPin(D, l.a); add('warn', tr('Kapcsolat nincs bekötve: {a}', { a: linkText(D, l) }), q ? at(q) : []); }
    else if (st && st.wire && !st.cable) { const q = findPin(D, l.a); add('warn', tr('{a}: csak vezetékkel köthető be (nincs szabad hídút)', { a: linkText(D, l) }), q ? at(q) : []); }
  }
  if (hasMcu) for (const p of D.parts) {
    if (p.type !== 'button') continue;
    if (D.links.some(l => l.a.startsWith(p.id + '.'))) continue;
    const m = A.byPart.get(p.id)!.map;
    const ok = ['A1', 'B1'].some(id => (A.netPins.get(m[id].net) || []).some(q => isMcu(q.part) && q.role === 'gpio'));
    if (!ok) add('warn', tr('{a}: egyik oldala sincs GPIO-ra kötve', { a: p.label }), at(m.A1));
  }
  // szimulációs áramok
  if (SIM) checkSim(D, AS, A, SIM, add, tr);
  // motorok (induktív terhelés): visszacsapó dióda és meghajtás
  for (const p of D.parts) for (const el of DEFS[p.type].def.model || []) {
    if (el.el !== 'motor') continue;
    const m = A.byPart.get(p.id)!.map, na = m[el.a].net, nb = m[el.b].net, qa = A.netPins.get(na) || [], qb = A.netPins.get(nb) || [];
    if (qa.length < 2 || qb.length < 2) continue;
    if (qa.some(q => q.role === 'gpio') || qb.some(q => q.role === 'gpio')) add('err', tr('{a}: a motor közvetlenül GPIO-ra van kötve. Tranzisztor vagy MOSFET kell a meghajtásához.', { a: p.label }), []);
    const fly = D.parts.some(o => (DEFS[o.type].def.model || []).some(e => {
      if (e.el !== 'diode') return false;
      const om = A.byPart.get(o.id)!.map, a = om[e.a].net, k = om[e.k].net;
      return (a === na && k === nb) || (a === nb && k === na);
    }));
    if (!fly) add('warn', tr('{a}: nincs visszacsapó dióda a motoron. Tegyél egy diódát (pl. 1N5817) a motor kapcsaira, a katódjával a + felé, különben kikapcsoláskor a feszültségtüske tönkreteheti a tranzisztort.', { a: p.label }), []);
  }
  // tápbemenetek: feszültség a saját GND-lábhoz képest
  if (SIM) for (const p of D.parts) {
    const bp = AS.byPart.get(p.id)!, vins = bp.pins.filter(q => q.role === 'vin');
    if (!vins.length) continue;
    const gq = bp.pins.find(q => q.role === 'gnd'), model = DEFS[p.type].def.model || [];
    const V = (q: NetPin) => (SIM.floating.has(q.net) ? null : SIM.netV.get(q.net) ?? null);
    for (const q of vins) {
      const own = model.some(el => el.el === 'source' && el.p === q.id);
      const v = V(q), g = gq ? V(gq) : 0, U = v == null || g == null ? null : v - g;
      if (U == null || U < 0.5) { if (!own) add('warn', tr('{a}.{b}: nincs tápfeszültség', { a: p.label, b: q.name }) + (v != null && gq && g == null ? ' ' + tr('(a {a} nincs bekötve)', { a: gq.name }) : ''), at(q)); }
      else if (q.vmax != null && U > q.vmax + 0.05) add('err', tr('{a}.{b}: {c} V, több a megengedett {d} V-nál', { a: p.label, b: q.name, c: U.toFixed(2), d: q.vmax }), at(q));
      else if (q.vmin != null && U < q.vmin - 0.05) add('warn', tr('{a}.{b}: csak {c} V, legalább {d} V kell', { a: p.label, b: q.name, c: U.toFixed(2), d: q.vmin }), at(q));
    }
  }
  // vezérlő lábak különleges szereppel (indítási/strapping láb, soros port, USB, beépített LED): használat esetén figyelmeztetés
  for (const p of D.parts) {
    if (!isMcu(p)) continue;
    const notes = ((DEFS[p.type].def.meta || {}) as { pinNotes?: Record<string, string> }).pinNotes || {};
    for (const q of A.byPart.get(p.id)!.pins) {
      if (q.role !== 'gpio' || !q.on) continue;
      const used = (A.netPins.get(q.net) || []).length > 1 || (A.netSecs.get(q.net) || 0) > 1;
      if (!used) continue;
      const c = SPECIAL_CAPS.find(x => hasCap(q, x[0]));
      if (c) add('warn', `${p.label}.${q.name}: ${tr(notes[q.name] || c[1])}`, at(q));
    }
  }
  // buszfunkciók (I²C, SPI, UART): a periféria lába a vezérlő megfelelő lábán, egy perifériához egy busz
  for (const p of D.parts) {
    if (isMcu(p)) continue;
    const used = new Map<string, Array<{ q: NetPin; g: NetPin; b: Set<string> }>>();
    for (const q of A.byPart.get(p.id)!.pins) {
      if (!q.fn) continue;
      const g = (A.netPins.get(q.net) || []).find(x => isMcu(x.part) && x.role === 'gpio');
      if (!g) continue;
      const m = fnCaps(g, q.fn), bus = q.fn.split('.')[0], want = fnName(fnWant(q.fn));
      if (!m.length) {
        if (mcuMux(g.part) !== 'matrix') {
          const ok = [...new Set(placedPins(g.part).filter(x => x.role === 'gpio' && fnCaps(x, q.fn!).length).map(x => x.name))];
          add('warn', tr('{a}.{b} ({c}) → {d}: ez a láb nem {e}, így a hardveres {f} nem használható rajta, csak szoftveres. Alkalmas lábak: {g}', { a: p.label, b: q.name, c: fnName(q.fn), d: g.name, e: want, f: bus.toUpperCase(), g: ok.slice(0, 8).join(', ') }), at(g));
        }
        continue;
      }
      if (!used.has(bus)) used.set(bus, []);
      used.get(bus)!.push({ q, g, b: new Set(m.map(c => c.split('.')[0])) });
    }
    for (const [bus, list] of used) {
      if (list.length < 2 || mcuMux(list[0].g.part) === 'matrix') continue;
      const inter = list.slice(1).reduce((acc, x) => new Set([...acc].filter(b => x.b.has(b))), new Set(list[0].b));
      if (!inter.size) add('warn', tr('{a}: az {b}-lábai különböző buszokra kerültek ({c}). Egy perifériát egy buszra köss.', { a: p.label, b: bus.toUpperCase(), c: list.map(x => `${x.q.name} → ${x.g.name}: ${[...x.b].map(b => b.toUpperCase()).join('/')}`).join(', ') }), list.map(x => at(x.g)[0]));
    }
  }
  // PWM-szeletek (Pico): egy szelet két csatornája csak azonos frekvencián mehet
  {
    const sl = new Map<string, Array<{ q: NetPin; f: number; c: string }>>();
    for (const p of D.parts) {
      if (!isMcu(p)) continue;
      for (const q of A.byPart.get(p.id)!.pins) {
        if (q.role !== 'gpio' || gpioMode(D, p, q.id, q, A) !== 'pwm') continue;
        const c = (q.caps || []).find(x => /^pwm\d+\.[ab]$/.test(x));
        if (!c) continue;
        const k = p.id + ':' + c.split('.')[0];
        if (!sl.has(k)) sl.set(k, []);
        sl.get(k)!.push({ q, f: pwmCfg(D, p.id + '.' + q.id).freq, c });
      }
    }
    for (const [, list] of sl) {
      if (list.length < 2) continue;
      const fs = [...new Set(list.map(x => +x.f))];
      if (fs.length > 1) add('warn', tr('{a} ugyanazon a PWM-szeleten ({b}) van, csak azonos frekvenciával működhetnek (most: {c}).', { a: list.map(x => x.q.name).join(' ' + tr('és') + ' '), b: list[0].c.split('.')[0].toUpperCase(), c: list.map(x => x.f + ' Hz').join(', ') }), list.map(x => at(x.q)[0]));
    }
  }
  // analóg jelek: csak ADC-képes GPIO-ra
  for (const [, qs] of A.netPins) {
    const an = qs.filter(q => q.role === 'adc');
    if (!an.length) continue;
    for (const g of qs.filter(q => q.role === 'gpio')) {
      const src = an.map(pinLabel).join(', ');
      const ok = () => [...new Set(placedPins(g.part).filter(x => hasCap(x, 'adc')).map(x => x.name))].join(', ') || '–';
      if (!hasAdc(g)) add('warn', tr('{a}: analóg jel a {b}-n, de azon nincs ADC. Erre alkalmas: {c}', { a: src, b: g.name, c: ok() }), at(g));
      else {
        if (!hasCap(g, 'adc')) add('warn', tr('{a}: ADC2-csatorna, bekapcsolt WiFi mellett nem mér. Analóg jelhez inkább ADC1-es lábat válassz: {b}', { a: g.name, b: ok() }), at(g));
        const m = gpioMode(D, g.part, g.id, g, A);
        if (m !== 'adc' && m !== 'float') add('warn', tr('{a}: az analóg méréshez állítsd ADC módba (most: {b})', { a: g.name, b: tr(GPIO_MODES.find(x => x[0] === m)![1]) }), at(g));
      }
    }
  }
  // szellős terv: az alkatrészek a foglalt terület kis részét töltik ki (tömöríthető)
  { const st = layoutStats(D);
    if (st.parts >= 3 && D.links.length >= 2 && st.fill < SPARSE_FILL && st.area >= 0.25 * st.boardArea)
      iss.push({ sev: 'info', msg: tr('A terv szellős: az alkatrészek a foglalt terület {f}%-át töltik ki – tömörítve kisebb panel és rövidebb bekötés lehet.', { f: Math.round(st.fill * 100) }), holes: [], act: 'compact' }); }
  return iss;
}

/** A szimuláció eredményéből: túláram, táp, lebegő bemenetek, tranzisztorok, kondenzátorok, akkutöltés. */
function checkSim(D: Design, AS: Netlist, A: Netlist, SIM: SimResult, add: (sev: Issue['sev'], msg: string, holes?: Hole[]) => void, tr: Tr): void {
  for (const s of SIM.srcI) {
    if (s.kind === 'vbus' && s.I > 1) add('err', tr('Zárlat a VBUS-on ({a} A)', { a: s.I.toFixed(1) }), []);
    if (s.kind === 'v33' && s.I > 0.3) add('err', tr('3V3 túlterhelve vagy zárlatos ({a} mA)', { a: (s.I * 1000).toFixed(0) }), []);
  }
  for (const g of SIM.gpios) {
    const mA = Math.abs(g.I) * 1000, lim = Math.round(((SIM.picos.find(x => x.p === g.p) || { igpio: 0 }).igpio || 0.012) * 1000);
    if (mA > 50) add('err', tr('{a}: {b} mA, kimenet zárlatban', { a: g.q.name, b: mA.toFixed(0) }), [[g.q.r, g.q.c]]);
    else if (mA > lim) add('warn', tr('{a}: {b} mA, sok (ajánlott max. ~{c} mA)', { a: g.q.name, b: mA.toFixed(1), c: lim }), [[g.q.r, g.q.c]]);
    // bemenet belső felhúzás nélkül, gombbal: elengedve lebeg
    if (g.powered && g.float && (g.mode === 'float' || g.mode === 'adc')) {
      const qs = AS.netPins.get(AS.pins.find(x => x.part === g.p && x.id === g.q.id)!.net) || [];
      if (qs.some(x => hasPress(x.part))) add('warn', tr('{a}: lebeg, amíg a gomb nincs lenyomva{b}. Tegyél külső felhúzó ellenállást (pl. 10 kΩ a 3V3-ra), vagy válassz másik GPIO-t.', { a: g.q.name, b: hasCap(g.q, 'nopull') ? ' ' + tr('(ezen a lábon nincs belső felhúzó ellenállás)') : '' }), [[g.q.r, g.q.c]]);
    }
  }
  // vezérlőlap tápbemenete: túlfeszültség, vagy kevés a stabilizátornak
  for (const pc of SIM.picos) {
    const q = A.byPart.get(pc.p.id)!.pins.find(x => x.name === pc.vsysName), at: Hole[] = q ? [[q.r, q.c]] : [];
    if (pc.vmax != null && pc.Usys > pc.vmax + 0.05) add('err', tr('{a}.{b}: {c} V, több a megengedett {d} V-nál', { a: pc.p.label, b: pc.vsysName, c: pc.Usys.toFixed(2), d: pc.vmax }), at);
    else if (!pc.powered && pc.Usys > 0.5) add('warn', tr('{a}: a tápbemeneten ({b}) csak {c} V van, a stabilizátornak legalább {d} V kell, így nincs 3,3 V', { a: pc.p.label, b: pc.vsysName, c: pc.Usys.toFixed(2), d: pc.vreg }), at);
  }
  for (const l of SIM.leds) {
    if (l.light && l.I > 0.03) add('warn', tr('{a}: {b} mA, előtét-ellenállás kell', { a: l.p.label, b: (l.I * 1000).toFixed(0) }), []);
    else if (!l.light && l.imax && l.I > l.imax) add('warn', tr('{a}: {b}A, több a megengedett {c}A-nél', { a: l.p.label, b: fmtSI(l.I), c: fmtSI(l.imax) }), []);
  }
  for (const L of SIM.logics) {
    if (L.vdd < 1) continue;
    const op = L.ins.filter(x => x.open).map(x => x.name);
    if (op.length) add('warn', tr('{a}: lebegő bemenet: {b}. CMOS-bemenetet ne hagyj szabadon: kösd jelre, vagy a nem használtat GND-re (vagy VCC-re).', { a: L.p.label, b: op.join(', ') }), []);
    for (const o of L.outs) if (o.I > L.imax) add('warn', tr('{a}.{b}: {c} mA kimeneti áram, több a megengedett {d}A-nél{e}', { a: L.p.label, b: o.name, c: (o.I * 1000).toFixed(0), d: fmtSI(L.imax), e: L.imax < 0.1 ? ' ' + tr('(két kimenet egymás ellen?)') : '' }), []);
  }
  for (const m of SIM.motors) if (Math.abs(m.U) > m.vnom * 1.25) add('warn', tr('{a}: {b} V, több a névleges {c} V-nál', { a: m.p.label, b: Math.abs(m.U).toFixed(2), c: m.vnom }), []);
  for (const s of SIM.servos) if (s.U > 3 && s.angle == null) add('warn', tr('{a}: nincs érvényes szervójel. A jel lábát kösd egy PWM módú GPIO-ra: 50 Hz, 2,5–12,5 % kitöltés (7,5 % = középállás).', { a: s.p.label }), []);
  for (const t of SIM.bjts) {
    const L = t.p.label;
    if (t.floatBase) add('warn', tr('{a}: a bázis lebeg. Tegyél lehúzó ellenállást a B és az E közé (pl. 10 kΩ), vagy kösd kimenetre.', { a: L }), []);
    if (t.imax && Math.abs(t.ic) > t.imax) add('warn', tr('{a}: {b}A kollektoráram, több a megengedett {c}A-nél', { a: L, b: fmtSI(Math.abs(t.ic)), c: fmtSI(t.imax) }), []);
    else if (t.st === 'act' && t.ic > 1e-3) add('warn', tr('{a}: nem telítődik (Uce {b} V, Ic {c}A = β·Ib). Kapcsolónak kisebb bázisellenállás kell: a bázisáram (most {d}A) legyen a kívánt kollektoráram kb. tizede.', { a: L, b: t.vce.toFixed(2), c: fmtSI(t.ic), d: fmtSI(t.ib) }), []);
  }
  for (const k of SIM.caps) {
    if (k.float) continue;
    if (k.polar && k.U < -0.5) add('err', tr('{a}: fordítva van bekötve ({b} V). Az elektrolit kondenzátor + lába kerüljön a magasabb feszültségre.', { a: k.p.label, b: k.U.toFixed(2) }), []);
    else if (k.vmax != null && Math.abs(k.U) > k.vmax) add('err', tr('{a}: {b} V, több a névleges {c} V-nál', { a: k.p.label, b: Math.abs(k.U).toFixed(2), c: k.vmax }), []);
  }
  for (const f of SIM.fets) {
    if (f.floatGate) add('warn', tr('{a}: a gate lebeg. Tegyél lehúzó ellenállást a G és az S közé (pl. 100 kΩ), vagy kösd kimenetre.', { a: f.p.label }), []);
    if (f.imax && Math.abs(f.I) > f.imax) add('warn', tr('{a}: {b}A, több a megengedett {c}A-nél', { a: f.p.label, b: fmtSI(Math.abs(f.I)), c: fmtSI(f.imax) }), []);
  }
  for (const b of SIM.bats) {
    if (b.kind === 'supply') { if (b.I < -2) add('err', tr('{a}: zárlat a tápbemeneten ({b} A)', { a: b.p.label, b: (-b.I).toFixed(1) }), []); continue; }
    // töltőmodulról (chg láb) tölt-e, vagy közvetlenül a vezérlőlap USB-jéről a tápbemenetén (VSYS, VIN, 5V) át
    const bq = AS.byPart.get(b.p.id)!.pins, dpc = SIM.picos.find(pc => pc.feeds && pc.vsys === b.node), direct = !!dpc;
    const charger = !direct && bq.some(q => (AS.netPins.get(q.net) || []).some(x => x.role === 'chg' && x.part !== b.p));
    if (dpc && b.I > 0.1) { add('err', tr('{a}: a {b} USB-je a tápbemeneten ({c}) át közvetlenül tölti az akkut ({d} A). Az akku és a tápbemenet közé Schottky-dióda kell.', { a: b.p.label, b: dpc.p.label, c: dpc.vsysName, d: b.I.toFixed(1) }), []); continue; }
    if (charger && b.I > 0) { if (b.I > 1.2) add('warn', tr('{a}: {b} A töltőáram, sok', { a: b.p.label, b: b.I.toFixed(1) }), []); continue; }
    if (b.I > 2) add('err', tr('{a}: zárlat ({b} A)', { a: b.p.label, b: b.I.toFixed(1) }), []);
    else if (b.I > 0.1) add('err', tr('{a}: az USB közvetlenül tölti az akkut ({b} A). A VSYS elé Schottky-dióda kell.', { a: b.p.label, b: b.I.toFixed(1) }), []);
    else if (b.I < -2) add('err', tr('{a}: zárlat ({b} A)', { a: b.p.label, b: (-b.I).toFixed(1) }), []);
  }
}
