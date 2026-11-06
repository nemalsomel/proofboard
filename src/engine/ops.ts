/**
 * Tervműveletek: a terv (`Design`) módosításai böngésző nélkül, a felület és a külső vezérlés (API, MCP-szerver)
 * közös alapja. Minden függvény a tervet paraméterként kapja és helyben módosítja; visszavonást, újraszámolást,
 * mentést nem végez (ez a hívó dolga: a felületen `pushUndo` előtte, `commit` utána).
 * Ha egy művelet nem hajtható végre, a terv változatlan marad, és a visszatérési érték ezt jelzi (`null` / `false`).
 */
import type { PartInstance } from '../core/schema';
import { DEFS, isOff } from './defs';
import { placedPins, xf } from './geometry';
import { buildLayout } from './board';
import { GPIO_MODES, gpioModeOk } from './mcu';
import { matchingSocket, plugRedundantLinks, plugSpot, socketProps, socketType } from './plug';
import { pwmCfg } from './simulate';
import type { Bridge, Design, Hole, Link, Note, PlacedPin, PwmCfg } from './types';

/** Ennyi lyuknyit lóghat ki egy alkatrész a panelról (a külső alkatrész teste a panel mellett ennyin belül). */
export const EXT = 8;

export const onBoard = (D: Design, r: number, c: number): boolean => r >= 0 && c >= 0 && r < D.board.rows && c < D.board.cols;
const inCanvas = (D: Design, r: number, c: number) => r >= -EXT - 0.5 && c >= -EXT - 0.5 && r <= D.board.rows + EXT - 0.5 && c <= D.board.cols + EXT - 0.5;

/**
 * Elfér-e az alkatrész: panelra szerelt alkatrésznél legalább egy láb a panelon és egyik sem lóg ki `EXT`-nél jobban;
 * külső alkatrésznél (`mount: 'off'`) egyik kivezetése sincs a panelon, és a teste a panel körüli sávban marad.
 */
export function partFits(D: Design, p: PartInstance): boolean {
  const g = placedPins(p);
  if (isOff(p)) {
    const b = DEFS[p.type].bounds(p), cs = [[b.r0, b.c0], [b.r0, b.c1], [b.r1, b.c0], [b.r1, b.c1]].map(([r, c]) => xf(p, r, c));
    return g.every(q => !onBoard(D, q.r, q.c)) && cs.every(([r, c]) => inCanvas(D, r, c));
  }
  return g.some(q => onBoard(D, q.r, q.c)) && g.every(q => q.r >= -EXT && q.c >= -EXT && q.r < D.board.rows + EXT && q.c < D.board.cols + EXT);
}

/** A következő szabad címke a típus előtagjával (R1, R2… → a legnagyobb sorszám + 1). */
export function nextLabel(D: Design, type: string): string {
  const pre = DEFS[type].prefix; let n = 0;
  for (const p of D.parts) { const m = new RegExp('^' + pre + '(\\d+)$').exec(p.label); if (m) n = Math.max(n, +m[1]); }
  return pre + (n + 1);
}

export interface PlaceOpts { rot?: number; mir?: boolean; props?: Record<string, unknown>; xray?: boolean; label?: string }

/** Az alkatrész példánya lerakás előtt (azonosító és címke nélkül is használható előnézetnek). */
export function partAt(D: Design, type: string, r: number, c: number, o: PlaceOpts = {}): PartInstance {
  return { id: 'ghost', type, label: DEFS[type].prefix, r, c, rot: o.rot || 0, mir: !!o.mir, xray: !!o.xray, props: { ...DEFS[type].props, ...(o.props || {}) } } as PartInstance;
}

/** Alkatrész lerakása; ha nem fér el, `null`. Külső alkatrésznél a csatlakozót nem teszi fel (ld. `attachPlug`). */
export function placePart(D: Design, type: string, r: number, c: number, o: PlaceOpts = {}): PartInstance | null {
  if (!DEFS[type]) return null;
  const g = partAt(D, type, r, c, o); if (!partFits(D, g)) return null;
  const p: PartInstance = { ...g, id: 'p' + (D.seq++), label: o.label || nextLabel(D, type) };
  if (!p.xray) delete p.xray;
  D.parts.push(p); return p;
}

/** Alkatrész eltolása; ha így nem fér el, `false`. */
export function movePart(D: Design, p: PartInstance, dr: number, dc: number): boolean {
  if (!partFits(D, { ...p, r: p.r + dr, c: p.c + dc })) return false;
  p.r += dr; p.c += dc; return true;
}

/** A lábat érintő kapcsolatok törlése. */
export function dropLinks(D: Design, pid: string): void { D.links = D.links.filter(l => !l.a.startsWith(pid + '.') && !l.b.startsWith(pid + '.')); }

/** Alkatrészek törlése a kapcsolataikkal; a külső alkatrésszel a csatlakozója is megy, a törölt csatlakozóból a dugó kikerül. */
export function removeParts(D: Design, ids0: Iterable<string>): void {
  const ids = new Set(ids0);
  for (const p of D.parts) if (ids.has(p.id) && p.plug) ids.add(p.plug);
  D.parts = D.parts.filter(p => !ids.has(p.id)); ids.forEach(id => dropLinks(D, id));
  for (const p of D.parts) if (p.plug && ids.has(p.plug)) delete p.plug;
}

/** Kapcsolat felvétele (láb → láb | 'GND' | 'GPIO'); ha már van ilyen (bármely irányban), `null`. */
export function addLink(D: Design, a: string, b: string): Link | null {
  if (D.links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a))) return null;
  const l: Link = { id: 'l' + (D.seq++), a, b, gpio: null }; D.links.push(l); return l;
}

/**
 * Külső alkatrészhez csatlakozó: ha van rá illő csatlakozó (pl. modul motorcsatlakozója, amelyre a kapcsolatai mutatnak),
 * abba dugja; különben tüskesort tesz a panelra a lábszámával és lábneveivel, a lábaihoz legközelebbi szabad helyre.
 * A csatlakozót adja vissza, vagy `null`, ha nem külső alkatrész, vagy nincs hely.
 */
export function attachPlug(D: Design, p: PartInstance): PartInstance | null {
  if (!isOff(p)) return null;
  { const h = matchingSocket(D, p); if (h) { p.plug = h.id; const red = plugRedundantLinks(D); D.links = D.links.filter(l => !red.has(l.id)); return h; } }
  const t = socketType(); if (!t) return null;
  const s = plugSpot(D, p, DEFS[p.type].pins(p).length); if (!s) return null;
  const h = { id: 'p' + (D.seq++), type: t, label: nextLabel(D, t), r: s.r, c: s.c, rot: s.rot, mir: false, props: { ...DEFS[t].props, ...socketProps(DEFS[t].def, p) } } as PartInstance;
  D.parts.push(h); p.plug = h.id; return h;
}

/** Kézi híd két szomszédos, különböző csíkdarabon lévő lyuk között; ha nem tehető (vagy már van), `false`. */
export function addBridge(D: Design, r1: number, c1: number, r2: number, c2: number): boolean {
  if (!onBoard(D, r1, c1) || !onBoard(D, r2, c2)) return false;
  const L = buildLayout(D.board, D.cuts || []);
  if (L.drilled(r1, c1) || L.drilled(r2, c2)) return false;
  if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;
  if (L.cell(r1, c1) === L.cell(r2, c2)) return false;
  if (D.bridges.some(b => (b[0] === r1 && b[1] === c1 && b[2] === r2 && b[3] === c2) || (b[0] === r2 && b[1] === c2 && b[2] === r1 && b[3] === c1))) return false;
  D.bridges.push([r1, c1, r2, c2]); return true;
}

/** Elemek egy csoportja: alkatrész-azonosítók, kézi hidak és vezetékek indexei. */
export interface Items { parts: Iterable<string>; bridges?: Iterable<number>; wires?: Iterable<number> }

/**
 * Csoport forgatása (90°, órajárással) vagy tükrözése a közös középpont körül. Ha az eredmény lelógna a panelról,
 * a terv változatlan, és `false` a válasz; üres csoportnál `null`.
 */
export function transformItems(D: Design, it: Items, kind: 'rot' | 'mir'): boolean | null {
  const parts = [...it.parts], bridges = [...(it.bridges || [])], wires = [...(it.wires || [])], pts: Array<[number, number]> = [];
  for (const id of parts) { const p = D.parts.find(x => x.id === id); if (!p) continue; const ps = placedPins(p); pts.push([ps.reduce((t, q) => t + q.r, 0) / ps.length, ps.reduce((t, q) => t + q.c, 0) / ps.length]); } // a lábak középpontja körül
  for (const i of bridges) { const b = D.bridges[i]; pts.push([b[0], b[1]], [b[2], b[3]]); }
  for (const i of wires) { const w = D.wires[i]; pts.push(w.a, w.b); }
  if (!pts.length) return null;
  // kétszeres középpont: fél lyukra eső tengely is lehet (pl. 20 lábú sor közepe)
  const R2 = Math.round(2 * pts.reduce((s, p) => s + p[0], 0) / pts.length); let C2 = Math.round(2 * pts.reduce((s, p) => s + p[1], 0) / pts.length);
  if (kind === 'rot' && ((R2 - C2) & 1)) C2 += 1; // forgatásnál azonos paritás kell, hogy rácspontra képezzen
  const T = kind === 'rot' ? (r: number, c: number): Hole => [(R2 + 2 * c - C2) / 2, (C2 - 2 * r + R2) / 2] : (r: number, c: number): Hole => [r, C2 - c];
  // próba másolaton: így lelógás esetén a terv érintetlen
  const pp = new Map(parts.map(id => [id, D.parts.find(x => x.id === id)]).filter((x): x is [string, PartInstance] => !!x[1]).map(([id, p]) => {
    const [r, c] = T(p.r, p.c); return [id, { ...p, r, c, rot: kind === 'rot' ? (p.rot + 1) & 3 : (4 - p.rot) & 3, mir: kind === 'rot' ? p.mir : !p.mir }];
  }));
  const nb = new Map(bridges.map(i => { const b = D.bridges[i], [a1, a2] = T(b[0], b[1]), [b1, b2] = T(b[2], b[3]); return [i, [a1, a2, b1, b2, ...b.slice(4)] as unknown as Bridge]; }));
  const nw = new Map(wires.map(i => { const w = D.wires[i]; return [i, { a: T(w.a[0], w.a[1]), b: T(w.b[0], w.b[1]) }]; }));
  const ok = [...pp.values()].every(p => partFits(D, p)) && [...nb.values()].every(b => onBoard(D, b[0], b[1]) && onBoard(D, b[2], b[3]))
    && [...nw.values()].every(w => onBoard(D, w.a[0], w.a[1]) && onBoard(D, w.b[0], w.b[1]));
  if (!ok) return false;
  for (const [id, n] of pp) { const p = D.parts.find(x => x.id === id)!; p.r = n.r; p.c = n.c; p.rot = n.rot; p.mir = n.mir; }
  for (const [i, b] of nb) D.bridges[i] = b;
  for (const [i, w] of nw) { D.wires[i].a = w.a; D.wires[i].b = w.b; }
  return true;
}

/** Elemek törlése (alkatrészek a kapcsolataikkal, hidak, vezetékek). */
export function removeItems(D: Design, it: Items): void {
  const br = new Set(it.bridges || []), wi = new Set(it.wires || []);
  removeParts(D, it.parts);
  D.bridges = D.bridges.filter((_, i) => !br.has(i)); D.wires = D.wires.filter((_, i) => !wi.has(i));
}

/** Jegyzet a vásznon (nem villamos elem); az alapméret 12×6 lyuk. */
export function addNote(D: Design, r: number, c: number, text: string, color: string, o: Partial<Pick<Note, 'w' | 'h' | 'target'>> = {}): Note {
  const n: Note = { id: 'n' + (D.seq++), r, c, w: o.w ?? 12, h: o.h ?? 6, text, color, target: o.target ?? null };
  D.notes = [...(D.notes || []), n]; return n;
}

/** Láb keresése a terv alkatrészei között: a címkéjű alkatrész lába azonosító vagy név szerint. */
export function partByLabel(D: Design, label: string): PartInstance | null { return D.parts.find(p => p.label === label) || null; }

/** A vezérlőlap GPIO-lába a neve szerint (pl. 'GP15', 'IO4'). */
export function gpioPin(D: Design, name: string): PlacedPin | null {
  return D.parts.flatMap(placedPins).find(q => q.name === name && q.role === 'gpio') || null;
}

/** GPIO mód beállítása a láb neve szerint; ha a láb vagy a mód nem megfelelő, `false`. */
export function setGpioMode(D: Design, name: string, mode: string): boolean {
  const q = gpioPin(D, name);
  if (!q || !GPIO_MODES.some(m => m[0] === mode) || !gpioModeOk(q, mode)) return false;
  D.gpio[q.part.id + '.' + q.id] = mode; return true;
}

/** PWM a láb neve szerint: a mód PWM lesz, a kitöltés (%) és a frekvencia (Hz) a megadott, a többi marad. */
export function setPwm(D: Design, name: string, duty?: number | null, freq?: number | null, cur: (key: string) => PwmCfg = k => pwmCfg(D, k)): boolean {
  const q = gpioPin(D, name);
  if (!q || !gpioModeOk(q, 'pwm')) return false;
  const k = q.part.id + '.' + q.id;
  D.gpio[k] = 'pwm';
  D.pwm = { ...(D.pwm || {}), [k]: { ...cur(k), ...(duty != null ? { duty } : {}), ...(freq != null ? { freq } : {}) } };
  return true;
}
