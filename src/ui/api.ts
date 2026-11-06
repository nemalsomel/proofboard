/**
 * A program külső vezérlőfelülete (`window.pcb`): terv betöltése és lekérdezése, alkatrészek és kapcsolatok,
 * útvonalkeresés, csíkvágások, szimuláció, program és kódgenerálás, nézet. Az e2e tesztek, a szkriptek és a
 * későbbi agent-kapcsolat (MCP) ezen keresztül dolgoznak. A tervmódosítások az `engine/ops.ts`-re épülnek;
 * a módosító hívások visszavonhatók (a felület visszavonási listájába kerülnek).
 *
 * A gazda (`app.ts`) az `ApiHost`-ot adja: a pillanatnyi állapotot és a felület műveleteit.
 */
import type { PartDef, PartInstance } from '../core/schema';
import { hasErrors, validatePartDef, type Problem } from '../core/validate';
import type { Cut } from '../engine/board';
import { sameCut, type CutHit } from '../engine/cuts';
import { normalize } from '../engine/design';
import { hasPress, isOff } from '../engine/defs';
import { placedPins } from '../engine/geometry';
import type { Issue } from '../engine/check';
import { findPin, pinRows, setPinLink, type LinkGeom, type LinkState } from '../engine/links';
import { gpioModeOk } from '../engine/mcu';
import { pinLabel, type Netlist } from '../engine/netlist';
import * as OPS from '../engine/ops';
import { plugOf, plugPairs } from '../engine/plug';
import { presetMacropad, presetRouted } from '../engine/presets';
import { normProgram, type Program } from '../engine/program';
import { gpioLevel, type SimResult } from '../engine/simulate';
import type { Design, Hole, Link, Note } from '../engine/types';
import { PARTS } from '../parts/builtin';
import { EXAMPLES } from './examples';
import { grp, type Group } from './hit';

/* ---------- Eredménytípusok ---------- */

/** A kapcsolat az állapotával (bekötve-e, hidak, kiosztott GPIO); a `gpio` a kiosztott GPIO neve, ha van. */
export type ApiLink = Omit<Link, 'gpio'> & Omit<Partial<LinkState>, 'gpio'> & { gpio?: string | null; /** olvasható alak, pl. „R1.2 → LED1.A” */ text: string };
export interface ApiLinkInfo { text: string; start: Hole | null; end: Hole | null; endPin: string | null; bridges: number }
export interface ApiPin { id: string; name: string; r: number; c: number; /** hálózat sorszáma (a panelon kívüli lábnál null) */ net: number | null }
export interface ApiPinRow { ref: string; label: string; name: string; role: string; target: string | null; net: string[]; floating: boolean }
export interface ApiIssue { sev: Issue['sev']; msg: string; holes: Hole[] }
export interface ApiGpioRead { pin: string; mode: string; V: number; level: string }
export interface ApiCuts { manual: Cut[]; auto: Cut[]; ban: Cut[] }
export interface ApiPlug { header: string; pins: Array<{ from: string; to: string; name: string; r: number; c: number }> }
export interface ApiCode { file: string; code: string; warnings: string[]; lines: unknown }
export interface ApiProgState { t: number; vals: Record<string, unknown>; errors: Record<string, string>; gpio: Record<string, string>; pwm: Record<string, unknown> }
export interface ApiSwap { dropped: string[]; fits: boolean; msg: string }
export interface ApiExample { id: string; cat: string; title: string }

/** A `window.pcb` felülete. A címke (`label`) az alkatrész neve a tervben (pl. „R1”, „PICO1”). */
export interface PcbApi {
  /* terv */
  /** Terv betöltése (objektum vagy JSON-szöveg); a kijelölés törlődik. */ load(d: Design | string): boolean;
  /** A terv mély másolata. */ get(): Design;
  /** Előre elkészített minták (tesztekhez). */ preset(): void; presetRouted(): void;
  /** Példák listája és betöltése azonosító szerint. */ examples(): ApiExample[]; example(id: string): boolean;
  /** Bővített tervformátum (alkatrészek és kapcsolatok címkékkel) beolvasása. */ importPlan(o: unknown): unknown;
  /** Jegyzetek másolata. */ notes(): Note[];
  undo(): void; redo(): void;

  /* alkatrészek */
  /** Alkatrész eltolása lyukakban; ha nem fér el, false. */ move(label: string, dr: number, dc: number): boolean;
  /** Kijelölés címkék szerint; a kijelöltek száma. */ select(labels: string[]): number;
  /** A kijelölés forgatása / tükrözése. */ rotate(): void; mirror(): void;
  /** Az alkatrész lábai a hálózatukkal. */ pins(label: string): ApiPin[] | null;
  /** A lábak bekötöttsége (a tulajdonságpanel Lábak táblázata). */ pinRows(label: string): ApiPinRow[] | null;
  /** A láb kapcsolata: 'GND' | 'GPIO' | lábhivatkozás (pl. 'p3.A') | '' (törlés). */ setPin(label: string, pin: string, target: string): boolean;
  /** Külső alkatrész csatlakozója és lábpárjai. */ plug(label: string): ApiPlug | null;
  /** Csatlakozó (tüskesor) a külső alkatrészhez; a címkéje vagy null. */ attachPlug(label: string): string | null;
  /** Vezérlőcsere a megadott típusra. */ swapMcu(label: string, type: string): ApiSwap | null;
  /** Beépített alkatrészleírások. */ defs(): Record<string, PartDef>;
  /** Saját alkatrészek: könyvtár + terv, csak könyvtár, csak terv. */ customParts(): Record<string, PartDef>; library(): Record<string, PartDef>; projectParts(): Record<string, PartDef>;
  /** Keresés az alkatrészlistában; a találatok típusai. */ libSearch(q: string): string[];
  /** Saját alkatrész felvétele a leírásából (ellenőrzéssel). */ addPart(def: PartDef): { type: string | null; problems: Problem[] };
  /** Az Alkatrész-szerkesztő megnyitása. */ openEditor(type?: string): void;

  /* kapcsolatok és útvonal */
  /** A kapcsolatok az állapotukkal. */ links(): ApiLink[];
  /** A kapcsolatok kezdő- és végpontja, hídjai. */ linkInfo(): ApiLinkInfo[];
  /** Kapcsolat kiemelése sorszám szerint; az állapotsor szövege. */ selectLink(i: number): string;
  /** Teljes automatikus bekötés. */ route(): ApiLink[];
  /** Kézi bekötés → kapcsolatok (alkatrész-azonosító, elhagyva mind); az átalakítottak száma. */ toAuto(pid?: string): number;

  /* csíkvágások */
  cuts(): ApiCuts;
  /** Kézi vágás ki/be (kind: 0 rés, 1 furat). */ cut(r: number, c: number, kind?: number): ApiCuts;
  /** Vágás törlése (automatikusnál a hely tiltólistára kerül). */ uncut(r: number, c: number, kind?: number): ApiCuts;
  /** Vágás kijelölése; 'manual' | 'auto' | null. */ selectCut(r: number, c: number, kind?: number): CutHit['src'] | null;
  /** Minden kézi vágás törlése. */ clearCuts(): ApiCuts;
  /** A Csíkvágás eszköz típusa. */ cutKind(k?: string): string;

  /* szimuláció */
  sim(on?: boolean): void;
  /** Gomb lenyomása / felengedése (szimulációt indít). */ press(label: string, down?: boolean): boolean;
  /** A GPIO-k állapota. */ read(): ApiGpioRead[];
  /** Csúszka (pl. joystick) értéke. */ slider(label: string, key: string, v: number): boolean;
  /** GPIO mód a láb neve szerint. */ gpio(pin: string, mode: string): boolean;
  /** PWM a láb neve szerint (kitöltés %, frekvencia Hz). */ pwm(pin: string, duty?: number | null, freq?: number | null): boolean;
  /** Problémák (all: a megjegyzésekkel együtt). */ issues(all?: boolean): ApiIssue[];
  /** A szimuláció részletei alkatrészenként. */ simInfo(): Record<string, unknown[]> | null;
  /** A rajzon látható LED-áramok. */ ledView(): Array<{ label: string; I: number }>;
  /** A láb hálózatának feszültsége. */ netV(label: string, pin: string): number | null;

  /* program és kód */
  /** Program lekérdezése, vagy beállítása (visszavonható). */ program(p?: Program | null): Program | null;
  /** Program léptetése kézzel (ms). */ progStep(ms?: number): ApiProgState | null;
  progAuto(on: boolean): void;
  progState(): ApiProgState | null;
  /** Generált kód: 'micropython' | 'arduino'. */ code(lang?: string): ApiCode | null;

  /* felület */
  /** Munkaterület: 'board' | 'prog' | 'split'. */ work(v?: string): string;
  /** A Vezérlés nézet füle: 'nodes' | 'code'. */ pvTab(t?: string): string;
  /** Elrendezés: 'design' | 'prog' | 'sim'. */ layout(id?: string): string;
  /** Alsó panel: nyitás/csukás és fül. */ bottom(open?: boolean, tab?: string): unknown;
  propWin(): unknown;
  /** A napló bejegyzései. */ log(): string[];
  /** Oldalsáv összecsukása: k = 'l' | 'r'. */ sides(k?: 'l' | 'r', on?: boolean): unknown;
  /** Egyszerű mód. */ simple(on?: boolean): boolean;
  /** Nyelv: 'hu' | 'en'. */ lang(l?: string): string;
  /** A lyuk helye a képernyőn; a reveal előbb odagörget. */ at(r: number, c: number): { x: number; y: number }; reveal(r: number, c: number): { x: number; y: number };
  readonly version: string;
}

/* ---------- Gazda ---------- */

/** A felület állapotának az a része, amelyet az API olvas és ír. */
export interface ApiUiState {
  sel: unknown; selLink?: string | null; moved?: Set<string> | null;
  pressed: Record<string, boolean>; linkState: Map<string, LinkState>;
  sim: boolean; prog?: { t: number; rt: { vals: Map<string, unknown> }; out: { errors: Map<string, string>; gpio: Record<string, string>; pwm: Record<string, unknown> } } | null;
  progAuto?: boolean; work?: string; pvTab?: string; blinkSim?: SimResult | null;
}

export interface ApiHost {
  readonly ui: ApiUiState;
  D(): Design; setD(d: Design): void;
  A0(): Netlist; SIM(): SimResult | null; issues(): Issue[];
  lib(): Record<string, PartDef>;
  /* tervmódosítás keretei */
  pushUndo(): void; dropUndo(): void; commit(noRoute?: boolean): void;
  recompute(): void; renderLeft(): void; renderLinks(): void; draw(): void; status(): void; statusText(): string;
  undo(): void; redo(): void; rotate(): void; mirror(): void;
  /* motor körüli felületi burkolók */
  route(opts: { full?: boolean }): void;
  manualToAuto(pid: string | null): number;
  swapMcu(pid: string, type: string): ApiSwap | null;
  linkGeom(l: Link): LinkGeom | null; linkText(l: Link): string;
  toggleCut(ct: Cut): void; deleteCut(hit: CutHit): void; hitCut(rf: number, cf: number): CutHit | null; clearCuts(): void;
  cutKind(k?: string): string;
  pwmCfg(key: string): { duty: number; freq: number };
  setSlider(p: PartInstance, key: string, v: number): boolean;
  /* szimuláció és program */
  setSim(on: boolean): void; progTick(ms: number): void; progStart(on: boolean): void; readonly PROG_MS: number;
  code(lang: string): ApiCode | null;
  /* nézet */
  setWork(v: string): void; hasProgEditor(): boolean; pvTab(t: string): void;
  applyLayout(id: string): void; layoutCur(): string;
  bottom(open?: boolean, tab?: string): unknown; propWin(): unknown; logEntries(): string[]; sides(k?: 'l' | 'r', on?: boolean): unknown;
  simple(on?: boolean): boolean; lang(l?: string): string;
  at(r: number, c: number): { x: number; y: number }; reveal(r: number, c: number): { x: number; y: number };
  loadExample(id: string): boolean;
  libSearch(q: string): string[]; saveCustom(def: PartDef): string; openEditor(type?: string): void;
  importPlan(o: unknown): unknown;
  readonly version: string;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function createApi(H: ApiHost): PcbApi {
  const { ui } = H;
  const byLabel = (label: string) => OPS.partByLabel(H.D(), label);
  /** egy visszavonható módosítás: ha a művelet false/null-t ad, a visszavonási lépés eldobódik */
  const change = <T>(fn: () => T, noRoute?: boolean): T => { H.pushUndo(); const r = fn(); if (r === false || r == null) { H.dropUndo(); return r; } H.commit(noRoute); return r; };
  const cutSrc = (ct: Cut): CutHit['src'] | null => {
    const D = H.D();
    return (D.cuts || []).some(x => sameCut(x, ct)) ? 'manual' : (D.auto.cuts || []).some(x => sameCut(x, ct)) ? 'auto' : null;
  };

  const api: PcbApi = {
    load(d) { H.setD(normalize(typeof d === 'string' ? JSON.parse(d) : d)); ui.sel = null; H.commit(); return true; },
    get() { return clone(H.D()); },
    preset() { H.setD(presetMacropad()); H.commit(); },
    presetRouted() { H.setD(presetRouted()); H.commit(); },
    examples() { return EXAMPLES.map(e => ({ id: e.id, cat: e.cat, title: e.title })); },
    example(id) { return H.loadExample(id); },
    importPlan(o) { return H.importPlan(typeof o === 'string' ? JSON.parse(o) : o); },
    notes() { return clone(H.D().notes || []); },
    undo() { H.undo(); }, redo() { H.redo(); },

    move(label, dr, dc) {
      const D = H.D(), p = byLabel(label); if (!p || !OPS.partFits(D, { ...p, r: p.r + dr, c: p.c + dc })) return false;
      H.pushUndo(); OPS.movePart(D, p, dr, dc); ui.moved = new Set([p.id]); H.commit(); return true;
    },
    select(labels) { const ids = H.D().parts.filter(p => labels.includes(p.label)).map(p => p.id); ui.sel = ids.length ? grp(ids) as Group : null; H.renderLeft(); H.draw(); return ids.length; },
    rotate() { H.rotate(); }, mirror() { H.mirror(); },
    pins(label) {
      const D = H.D(), p = byLabel(label); if (!p) return null;
      const m = H.A0().byPart.get(p.id)!.map;
      return placedPins(p).map(q => { const on = OPS.onBoard(D, q.r, q.c); return { id: q.id, name: q.name, r: q.r, c: q.c, net: on || isOff(p) ? m[q.id].net : null }; });
    },
    pinRows(label) { const p = byLabel(label); return p ? pinRows(H.D(), H.A0(), p).map(r => ({ ref: r.ref, label: r.label, name: r.name, role: r.role, target: r.target, net: r.net, floating: r.floating })) : null; },
    setPin(label, pin, target) {
      const D = H.D(), p = byLabel(label), q = p && placedPins(p).find(x => x.id === pin || x.name === pin); if (!p || !q) return false;
      H.pushUndo(); if (!setPinLink(D, p.id + '.' + q.id, target, () => 'l' + (D.seq++))) { H.dropUndo(); return false; } H.commit(); return true;
    },
    plug(label) { const D = H.D(), p = byLabel(label), h = p && plugOf(D, p); return p && h ? { header: h.label, pins: plugPairs(D, p).map(([q, x]) => ({ from: q.id, to: x.id, name: x.name, r: x.r, c: x.c })) } : null; },
    attachPlug(label) { const D = H.D(), p = byLabel(label); if (!p || plugOf(D, p)) return null; const h = change(() => OPS.attachPlug(D, p)); return h ? h.label : null; },
    swapMcu(label, type) { const p = byLabel(label); return p ? H.swapMcu(p.id, type) : null; },
    defs() { return clone(PARTS) as Record<string, PartDef>; },
    customParts() { return clone({ ...H.lib(), ...(H.D().customParts || {}) }); },
    library() { return clone(H.lib()); },
    projectParts() { return clone(H.D().customParts || {}); },
    libSearch(q) { return H.libSearch(q); },
    addPart(def) { const problems = validatePartDef(def); if (hasErrors(problems)) return { type: null, problems }; return { type: H.saveCustom(def), problems }; },
    openEditor(type) { H.openEditor(type); },

    links() { const D = H.D(); return D.links.map(l => ({ ...l, text: H.linkText(l), ...(ui.linkState.get(l.id) || {}) })); },
    linkInfo() { return H.D().links.map(l => { const g = H.linkGeom(l); return { text: H.linkText(l), start: g && g.start, end: g && g.end, endPin: g && g.endPin ? pinLabel(g.endPin) : null, bridges: g ? g.bridges.length : 0 }; }); },
    selectLink(i) { const l = H.D().links[i]; ui.selLink = l ? l.id : null; H.renderLinks(); H.draw(); H.status(); return H.statusText(); },
    route() { H.route({ full: true }); H.commit(true); return api.links(); },
    toAuto(pid) { return H.manualToAuto(pid || null); },

    cuts() { const D = H.D(); return { manual: clone(D.cuts || []), auto: clone(D.auto.cuts || []), ban: clone(D.cutBan || []) }; },
    cut(r, c, kind = 0) { H.toggleCut([r, c, kind ? 1 : 0]); return api.cuts(); },
    uncut(r, c, kind = 0) { const ct: Cut = [r, c, kind ? 1 : 0], src = cutSrc(ct); if (src) H.deleteCut({ src, cut: ct }); return api.cuts(); },
    selectCut(r, c, kind = 0) { const h = H.hitCut(kind ? r : r + 0.5, c); ui.sel = h ? { kind: 'cut', hit: h } : null; H.renderLeft(); H.draw(); return h ? h.src : null; },
    clearCuts() { H.clearCuts(); return api.cuts(); },
    cutKind(k) { return H.cutKind(k); },

    sim(on = true) { H.setSim(!!on); },
    press(label, down = true) { const p = H.D().parts.find(x => x.label === label && hasPress(x)); if (!p) return false; if (!ui.sim) H.setSim(true); ui.pressed[p.id] = !!down; H.recompute(); return true; },
    read() { const S = H.SIM(); return S ? S.gpios.map(g => ({ pin: g.q.name, mode: g.mode, V: +g.V.toFixed(3), level: gpioLevel(g) })) : []; },
    slider(label, key, v) { const p = byLabel(label); return !!p && H.setSlider(p, key, v); },
    gpio(pin, mode) { if (!OPS.setGpioMode(H.D(), pin, mode)) return false; H.commit(); return true; },
    pwm(pin, duty, freq) {
      const D = H.D(), q = OPS.gpioPin(D, pin); if (!q || !gpioModeOk(q, 'pwm')) return false;
      H.pushUndo(); OPS.setPwm(D, pin, duty, freq, H.pwmCfg); H.commit(); return true;
    },
    issues(all) { return H.issues().filter(i => all || i.sev !== 'info').map(i => ({ sev: i.sev, msg: i.msg, holes: i.holes })); },
    simInfo() {
      const S = H.SIM(); if (!S) return null;
      return {
        leds: S.leds.map(l => ({ label: l.p.label, I: l.I, light: !!l.light })), fets: S.fets.map(f => ({ label: f.p.label, on: f.on, vgs: f.vgs, I: f.I, floatGate: f.floatGate })),
        bats: S.bats.map(b => ({ label: b.p.label, I: b.I, kind: b.kind })), picos: S.picos.map(x => ({ label: x.p.label, powered: x.powered })),
        caps: S.caps.map(k => ({ label: k.p.label, U: k.U, R: k.R, tau: k.tau })), bjts: S.bjts.map(t => ({ label: t.p.label, st: t.st, ib: t.ib, ic: t.ic, vbe: t.vbe, vce: t.vce })),
        motors: S.motors.map(m => ({ label: m.p.label, U: m.U, I: m.I, speed: m.speed })),
        logics: S.logics.map(L => ({ label: L.p.label, vdd: L.vdd, ins: Object.fromEntries(L.ins.map(x => [x.name, x.lv])), outs: Object.fromEntries(L.outs.map(o => [o.name, o.st])), regs: Object.fromEntries(L.regs.map(r => [r.name, r.val])) })),
        servos: S.servos.map(s => ({ label: s.p.label, U: s.U, pulse: s.pulse, angle: s.angle })), steppers: S.steppers.map(s => ({ label: s.p.label, pos: s.pos, angle: s.angle, coils: s.coils })),
      };
    },
    ledView() { const S = (ui.sim && ui.blinkSim) || H.SIM(); return S ? S.leds.map(l => ({ label: l.p.label, I: l.I })) : []; },
    netV(label, pin) { const p = byLabel(label), S = H.SIM(), q = p && H.A0().pins.find(x => x.part === p && x.id === pin); return q && S ? S.netV.get(q.net) as number : null; },

    program(p) {
      const D = H.D();
      if (p === undefined) return D.program ? clone(D.program) : null;
      H.pushUndo(); const n = normProgram(p); if (n && n.nodes.length) D.program = n; else delete D.program;
      if (ui.sim) H.progStart(true); H.commit(); return api.program();
    },
    progStep(ms = H.PROG_MS) { H.progTick(ms); return api.progState(); },
    progAuto(on) { ui.progAuto = !!on; if (ui.sim) H.progStart(true); },
    progState() {
      const P = ui.prog; if (!P || !P.out) return null;
      const nm = (k: string) => { const q = findPin(H.D(), k); return q ? q.name : k; };
      return { t: P.t, vals: Object.fromEntries(P.rt.vals), errors: Object.fromEntries(P.out.errors), gpio: Object.fromEntries(Object.entries(P.out.gpio).map(([k, v]) => [nm(k), v])), pwm: Object.fromEntries(Object.entries(P.out.pwm).map(([k, v]) => [nm(k), v])) };
    },
    code(lang = 'micropython') { const c = H.code(lang); return c ? { file: c.file, code: c.code, warnings: c.warnings, lines: c.lines } : null; },

    work(v) { if (v) H.setWork(v); return ui.work || 'board'; },
    pvTab(t) { if (!H.hasProgEditor() && t !== 'code') H.setWork('prog'); if (t) H.pvTab(t); return ui.pvTab || 'nodes'; },
    layout(id) { if (id) H.applyLayout(id); return H.layoutCur(); },
    bottom(open, tab) { return H.bottom(open, tab); },
    propWin() { return H.propWin(); },
    log() { return H.logEntries(); },
    sides(k, on) { return H.sides(k, on); },
    simple(on) { return H.simple(on); },
    lang(l) { return H.lang(l); },
    at(r, c) { return H.at(r, c); },
    reveal(r, c) { return H.reveal(r, c); },
    version: H.version,
  };
  return api;
}
