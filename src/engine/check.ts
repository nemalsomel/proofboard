/**
 * Ellenőrzés: a netlistából (és ha fut, a szimulációból) zárlatok, ütközések, rossz bekötések,
 * túláram, hiányzó táp, lábképesség- és buszfunkció-hibák. Minden hiba helyet (lyukakat) is ad.
 */
import { fmtSI } from '../core/expr';
import type { PartInstance } from '../core/schema';
import { DEFS, hasPress, isMcu, isOff } from './defs';
import { inBoard, placedPins, xf } from './geometry';
import { findPin, linkText, partGroups, type LinkState } from './links';
import { fnCaps, fnName, fnWant, GPIO_MODES, hasAdc, hasCap, mcuMux, SPECIAL_CAPS } from './mcu';
import { layoutOf, pinLabel, type Netlist } from './netlist';
import { gpioMode, pwmCfg, type SimResult } from './simulate';
import type { Design, Hole, NetPin } from './types';

export interface Issue { sev: 'err' | 'warn'; msg: string; holes: Hole[] }
export interface CheckCtx {
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

export function checkAll(D: Design, { A0: A, AS, SIM, linkState }: CheckCtx): Issue[] {
  const iss: Issue[] = [], add = (sev: Issue['sev'], msg: string, holes?: Hole[]) => iss.push({ sev, msg, holes: holes || [] });
  const inb = (r: number, c: number) => inBoard(D.board, r, c), at = (q: { r: number; c: number }): Hole[] => [[q.r, q.c]];
  const hasMcu = D.parts.some(p => isMcu(p));
  for (const p of D.parts) { const bp = A.byPart.get(p.id)!; if (!isOff(p) && bp.pins.every(q => !q.on)) add('warn', `${p.label}: teljesen a panelon kívül esik`, []); }
  const hole = new Map<string, NetPin[]>();
  for (const q of A.pins) { if (!q.on) continue; const k = q.r + ':' + q.c; if (!hole.has(k)) hole.set(k, []); hole.get(k)!.push(q); }
  for (const [k, a] of hole) if (a.length > 1) add('err', `Ütközés a ${k} lyukban: ${a.map(pinLabel).join(', ')}`, at(a[0]));
  // kifúrt (vágott) lyuk: nincs alatta réz
  {
    const LY = layoutOf(D);
    for (const [k, a] of hole) { const q = a[0]; if (LY.drilled(q.r, q.c)) add('err', `${pinLabel(q)} kifúrt lyukban van (${k}), nincs alatta réz: a láb sehová sem csatlakozik`, at(q)); }
    for (const w of D.wires) for (const e of [w.a, w.b]) if (inb(e[0], e[1]) && LY.drilled(e[0], e[1])) add('warn', `Vezetékvég kifúrt lyukban (${e[0]}:${e[1]}): nincs alatta réz`, [e]);
    for (const b of D.bridges) if (LY.drilled(b[0], b[1]) || LY.drilled(b[2], b[3])) add('warn', `Forrasztóhíd kifúrt lyuknál (${b[0]}:${b[1]}–${b[2]}:${b[3]})`, [[b[0], b[1]]]);
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
      let msg = p.type === 'button' ? `${p.label}: az A és B oldal közös neten van, a gomb rövidre zárt`
        : p.type === 'bat' ? `${p.label}: az akku + és − pólusa össze van kötve` : `${p.label}: ${qs.map(q => q.name).join(' és ')} össze van kötve`;
      if (same) msg += ' (egy szekcióba esnek)';
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
    if (rails.has('GND') && rails.size > 1) add('err', `Zárlat: GND – ${[...rails].filter(x => x !== 'GND').join(', ')}`, holes);
    else if (rails.has('3V3') && rails.size > 1) add('err', `Zárlat: 3V3 – ${[...rails].filter(x => x !== '3V3').join(', ')}`, holes);
    const gp = dq.filter(q => q.role === 'gpio');
    if (gp.length > 1) add('warn', `${gp.map(q => q.name).join(', ')} közös neten van`, holes);
    if (gp.length && rails.size) add('warn', `${gp.map(q => q.name).join(', ')} közvetlenül ${[...rails].join('/')}-re kötve`, holes);
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
        add('err', `Összeérő jelek: ${names.join(' · ')}`, qs.map(q => [q.r, q.c] as Hole));
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
      if (a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3]) add('warn', `${p.label} és ${q.label} teste átfed`, [[p.r, p.c], [q.r, q.c]]);
    }
  }
  if (picoSec.length > 3) {
    const p = picoSec[0][0].part;
    add('err', `${p.label}: ${picoSec.length} szekcióban több láb közös szekcióba esik. A lábsor nem futhat szekcióirányban, forgasd 90°-kal.`, picoSec.flatMap(a => a.map(q => [q.r, q.c] as Hole)));
  } else for (const dq of picoSec) add('err', `Zárlat: ${dq.map(pinLabel).join(' · ')} egy szekcióba esik`, dq.map(q => [q.r, q.c] as Hole));
  // vezetékvégek
  const pinHole = new Set(A.pins.map(q => q.r + ':' + q.c)), wend = new Map<string, number>();
  D.wires.forEach(w => {
    for (const e of [w.a, w.b]) {
      if (!inb(e[0], e[1])) continue;
      const k = e[0] + ':' + e[1];
      wend.set(k, (wend.get(k) || 0) + 1);
      if (pinHole.has(k)) {
        const sug = freeHoleNear(D, e[0], e[1], pinHole);
        add('warn', `Vezetékvég a ${k} lyukban egy alkatrészlábbal közösen, ez nem elég stabil. ${sug ? `Tedd át a ${sug} lyukba (ugyanaz a szekció).` : 'A szekcióban nincs szabad lyuk: hídd át egy oldalszomszédos szekcióba, és onnan vezesd tovább.'}`, [e]);
      }
    }
  });
  for (const [k, n] of wend) if (n > 1) { const [r, c] = k.split(':').map(Number); add('warn', `${n} vezetékvég ugyanabban a ${k} lyukban`, [[r, c]]); }
  // kapcsolatok, gombok GPIO nélkül
  for (const l of D.links) {
    const st = linkState.get(l.id);
    if (st && !st.ok) { const q = findPin(D, l.a); add('warn', `Kapcsolat nincs bekötve: ${linkText(D, l)}`, q ? at(q) : []); }
    else if (st && st.wire && !st.cable) { const q = findPin(D, l.a); add('warn', `${linkText(D, l)}: csak vezetékkel köthető be (nincs szabad hídút)`, q ? at(q) : []); }
  }
  if (hasMcu) for (const p of D.parts) {
    if (p.type !== 'button') continue;
    if (D.links.some(l => l.a.startsWith(p.id + '.'))) continue;
    const m = A.byPart.get(p.id)!.map;
    const ok = ['A1', 'B1'].some(id => (A.netPins.get(m[id].net) || []).some(q => isMcu(q.part) && q.role === 'gpio'));
    if (!ok) add('warn', `${p.label}: egyik oldala sincs GPIO-ra kötve`, at(m.A1));
  }
  // szimulációs áramok
  if (SIM) checkSim(D, AS, A, SIM, add);
  // motorok (induktív terhelés): visszacsapó dióda és meghajtás
  for (const p of D.parts) for (const el of DEFS[p.type].def.model || []) {
    if (el.el !== 'motor') continue;
    const m = A.byPart.get(p.id)!.map, na = m[el.a].net, nb = m[el.b].net, qa = A.netPins.get(na) || [], qb = A.netPins.get(nb) || [];
    if (qa.length < 2 || qb.length < 2) continue;
    if (qa.some(q => q.role === 'gpio') || qb.some(q => q.role === 'gpio')) add('err', `${p.label}: a motor közvetlenül GPIO-ra van kötve. Tranzisztor vagy MOSFET kell a meghajtásához.`, []);
    const fly = D.parts.some(o => (DEFS[o.type].def.model || []).some(e => {
      if (e.el !== 'diode') return false;
      const om = A.byPart.get(o.id)!.map, a = om[e.a].net, k = om[e.k].net;
      return (a === na && k === nb) || (a === nb && k === na);
    }));
    if (!fly) add('warn', `${p.label}: nincs visszacsapó dióda a motoron. Tegyél egy diódát (pl. 1N5817) a motor kapcsaira, a katódjával a + felé, különben kikapcsoláskor a feszültségtüske tönkreteheti a tranzisztort.`, []);
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
      if (U == null || U < 0.5) { if (!own) add('warn', `${p.label}.${q.name}: nincs tápfeszültség${v != null && gq && g == null ? ` (a ${gq.name} nincs bekötve)` : ''}`, at(q)); }
      else if (q.vmax != null && U > q.vmax + 0.05) add('err', `${p.label}.${q.name}: ${U.toFixed(2)} V, több a megengedett ${q.vmax} V-nál`, at(q));
      else if (q.vmin != null && U < q.vmin - 0.05) add('warn', `${p.label}.${q.name}: csak ${U.toFixed(2)} V, legalább ${q.vmin} V kell`, at(q));
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
      if (c) add('warn', `${p.label}.${q.name}: ${notes[q.name] || c[1]}`, at(q));
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
          add('warn', `${p.label}.${q.name} (${fnName(q.fn)}) → ${g.name}: ez a láb nem ${want}, így a hardveres ${bus.toUpperCase()} nem használható rajta, csak szoftveres. Alkalmas lábak: ${ok.slice(0, 8).join(', ')}`, at(g));
        }
        continue;
      }
      if (!used.has(bus)) used.set(bus, []);
      used.get(bus)!.push({ q, g, b: new Set(m.map(c => c.split('.')[0])) });
    }
    for (const [bus, list] of used) {
      if (list.length < 2 || mcuMux(list[0].g.part) === 'matrix') continue;
      const inter = list.slice(1).reduce((acc, x) => new Set([...acc].filter(b => x.b.has(b))), new Set(list[0].b));
      if (!inter.size) add('warn', `${p.label}: az ${bus.toUpperCase()}-lábai különböző buszokra kerültek (${list.map(x => `${x.q.name} → ${x.g.name}: ${[...x.b].map(b => b.toUpperCase()).join('/')}`).join(', ')}). Egy perifériát egy buszra köss.`, list.map(x => at(x.g)[0]));
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
      if (fs.length > 1) add('warn', `${list.map(x => x.q.name).join(' és ')} ugyanazon a PWM-szeleten (${list[0].c.split('.')[0].toUpperCase()}) van, csak azonos frekvenciával működhetnek (most: ${list.map(x => x.f + ' Hz').join(', ')}).`, list.map(x => at(x.q)[0]));
    }
  }
  // analóg jelek: csak ADC-képes GPIO-ra
  for (const [, qs] of A.netPins) {
    const an = qs.filter(q => q.role === 'adc');
    if (!an.length) continue;
    for (const g of qs.filter(q => q.role === 'gpio')) {
      const src = an.map(pinLabel).join(', ');
      const ok = () => [...new Set(placedPins(g.part).filter(x => hasCap(x, 'adc')).map(x => x.name))].join(', ') || '–';
      if (!hasAdc(g)) add('warn', `${src}: analóg jel a ${g.name}-n, de azon nincs ADC. Erre alkalmas: ${ok()}`, at(g));
      else {
        if (!hasCap(g, 'adc')) add('warn', `${g.name}: ADC2-csatorna, bekapcsolt WiFi mellett nem mér. Analóg jelhez inkább ADC1-es lábat válassz: ${ok()}`, at(g));
        const m = gpioMode(D, g.part, g.id, g, A);
        if (m !== 'adc' && m !== 'float') add('warn', `${g.name}: az analóg méréshez állítsd ADC módba (most: ${GPIO_MODES.find(x => x[0] === m)![1]})`, at(g));
      }
    }
  }
  return iss;
}

/** A szimuláció eredményéből: túláram, táp, lebegő bemenetek, tranzisztorok, kondenzátorok, akkutöltés. */
function checkSim(D: Design, AS: Netlist, A: Netlist, SIM: SimResult, add: (sev: Issue['sev'], msg: string, holes?: Hole[]) => void): void {
  for (const s of SIM.srcI) {
    if (s.kind === 'vbus' && s.I > 1) add('err', `Zárlat a VBUS-on (${s.I.toFixed(1)} A)`, []);
    if (s.kind === 'v33' && s.I > 0.3) add('err', `3V3 túlterhelve vagy zárlatos (${(s.I * 1000).toFixed(0)} mA)`, []);
  }
  for (const g of SIM.gpios) {
    const mA = Math.abs(g.I) * 1000, lim = Math.round(((SIM.picos.find(x => x.p === g.p) || { igpio: 0 }).igpio || 0.012) * 1000);
    if (mA > 50) add('err', `${g.q.name}: ${mA.toFixed(0)} mA, kimenet zárlatban`, [[g.q.r, g.q.c]]);
    else if (mA > lim) add('warn', `${g.q.name}: ${mA.toFixed(1)} mA, sok (ajánlott max. ~${lim} mA)`, [[g.q.r, g.q.c]]);
    // bemenet belső felhúzás nélkül, gombbal: elengedve lebeg
    if (g.powered && g.float && (g.mode === 'float' || g.mode === 'adc')) {
      const qs = AS.netPins.get(AS.pins.find(x => x.part === g.p && x.id === g.q.id)!.net) || [];
      if (qs.some(x => hasPress(x.part))) add('warn', `${g.q.name}: lebeg, amíg a gomb nincs lenyomva${hasCap(g.q, 'nopull') ? ' (ezen a lábon nincs belső felhúzó ellenállás)' : ''}. Tegyél külső felhúzó ellenállást (pl. 10 kΩ a 3V3-ra), vagy válassz másik GPIO-t.`, [[g.q.r, g.q.c]]);
    }
  }
  // vezérlőlap tápbemenete: túlfeszültség, vagy kevés a stabilizátornak
  for (const pc of SIM.picos) {
    const q = A.byPart.get(pc.p.id)!.pins.find(x => x.name === pc.vsysName), at: Hole[] = q ? [[q.r, q.c]] : [];
    if (pc.vmax != null && pc.Usys > pc.vmax + 0.05) add('err', `${pc.p.label}.${pc.vsysName}: ${pc.Usys.toFixed(2)} V, több a megengedett ${pc.vmax} V-nál`, at);
    else if (!pc.powered && pc.Usys > 0.5) add('warn', `${pc.p.label}: a tápbemeneten (${pc.vsysName}) csak ${pc.Usys.toFixed(2)} V van, a stabilizátornak legalább ${pc.vreg} V kell, így nincs 3,3 V`, at);
  }
  for (const l of SIM.leds) {
    if (l.light && l.I > 0.03) add('warn', `${l.p.label}: ${(l.I * 1000).toFixed(0)} mA, előtét-ellenállás kell`, []);
    else if (!l.light && l.imax && l.I > l.imax) add('warn', `${l.p.label}: ${fmtSI(l.I)}A, több a megengedett ${fmtSI(l.imax)}A-nél`, []);
  }
  for (const L of SIM.logics) {
    if (L.vdd < 1) continue;
    const op = L.ins.filter(x => x.open).map(x => x.name);
    if (op.length) add('warn', `${L.p.label}: lebegő bemenet: ${op.join(', ')}. CMOS-bemenetet ne hagyj szabadon: kösd jelre, vagy a nem használtat GND-re (vagy VCC-re).`, []);
    for (const o of L.outs) if (o.I > L.imax) add('warn', `${L.p.label}.${o.name}: ${(o.I * 1000).toFixed(0)} mA kimeneti áram, több a megengedett ${fmtSI(L.imax)}A-nél${L.imax < 0.1 ? ' (két kimenet egymás ellen?)' : ''}`, []);
  }
  for (const m of SIM.motors) if (Math.abs(m.U) > m.vnom * 1.25) add('warn', `${m.p.label}: ${Math.abs(m.U).toFixed(2)} V, több a névleges ${m.vnom} V-nál`, []);
  for (const s of SIM.servos) if (s.U > 3 && s.angle == null) add('warn', `${s.p.label}: nincs érvényes szervójel. A jel lábát kösd egy PWM módú GPIO-ra: 50 Hz, 2,5–12,5 % kitöltés (7,5 % = középállás).`, []);
  for (const t of SIM.bjts) {
    const L = t.p.label;
    if (t.floatBase) add('warn', `${L}: a bázis lebeg. Tegyél lehúzó ellenállást a B és az E közé (pl. 10 kΩ), vagy kösd kimenetre.`, []);
    if (t.imax && Math.abs(t.ic) > t.imax) add('warn', `${L}: ${fmtSI(Math.abs(t.ic))}A kollektoráram, több a megengedett ${fmtSI(t.imax)}A-nél`, []);
    else if (t.st === 'act' && t.ic > 1e-3) add('warn', `${L}: nem telítődik (Uce ${t.vce.toFixed(2)} V, Ic ${fmtSI(t.ic)}A = β·Ib). Kapcsolónak kisebb bázisellenállás kell: a bázisáram (most ${fmtSI(t.ib)}A) legyen a kívánt kollektoráram kb. tizede.`, []);
  }
  for (const k of SIM.caps) {
    if (k.float) continue;
    if (k.polar && k.U < -0.5) add('err', `${k.p.label}: fordítva van bekötve (${k.U.toFixed(2)} V). Az elektrolit kondenzátor + lába kerüljön a magasabb feszültségre.`, []);
    else if (k.vmax != null && Math.abs(k.U) > k.vmax) add('err', `${k.p.label}: ${Math.abs(k.U).toFixed(2)} V, több a névleges ${k.vmax} V-nál`, []);
  }
  for (const f of SIM.fets) {
    if (f.floatGate) add('warn', `${f.p.label}: a gate lebeg. Tegyél lehúzó ellenállást a G és az S közé (pl. 100 kΩ), vagy kösd kimenetre.`, []);
    if (f.imax && Math.abs(f.I) > f.imax) add('warn', `${f.p.label}: ${fmtSI(Math.abs(f.I))}A, több a megengedett ${fmtSI(f.imax)}A-nél`, []);
  }
  for (const b of SIM.bats) {
    if (b.kind === 'supply') { if (b.I < -2) add('err', `${b.p.label}: zárlat a tápbemeneten (${(-b.I).toFixed(1)} A)`, []); continue; }
    // töltőmodulról (chg láb) tölt-e, vagy közvetlenül a vezérlőlap USB-jéről a tápbemenetén (VSYS, VIN, 5V) át
    const bq = AS.byPart.get(b.p.id)!.pins, dpc = SIM.picos.find(pc => pc.feeds && pc.vsys === b.node), direct = !!dpc;
    const charger = !direct && bq.some(q => (AS.netPins.get(q.net) || []).some(x => x.role === 'chg' && x.part !== b.p));
    if (dpc && b.I > 0.1) { add('err', `${b.p.label}: a ${dpc.p.label} USB-je a tápbemeneten (${dpc.vsysName}) át közvetlenül tölti az akkut (${b.I.toFixed(1)} A). Az akku és a tápbemenet közé Schottky-dióda kell.`, []); continue; }
    if (charger && b.I > 0) { if (b.I > 1.2) add('warn', `${b.p.label}: ${b.I.toFixed(1)} A töltőáram, sok`, []); continue; }
    if (b.I > 2) add('err', `${b.p.label}: zárlat (${b.I.toFixed(1)} A)`, []);
    else if (b.I > 0.1) add('err', `${b.p.label}: az USB közvetlenül tölti az akkut (${b.I.toFixed(1)} A). A VSYS elé Schottky-dióda kell.`, []);
    else if (b.I < -2) add('err', `${b.p.label}: zárlat (${(-b.I).toFixed(1)} A)`, []);
  }
}
