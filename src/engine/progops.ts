/**
 * Programműveletek (DOM nélkül): blokk felvétele, beállítása, összekötése, törlése, automatikus elrendezés.
 * A tervet helyben módosítják (D.program), visszavonást és újraszámolást nem végeznek; hibás bemenetnél a terv
 * változatlan, a válasz hibaszöveg. Az agent eszközei (src/agent/progtools.ts) erre épülnek.
 */
import { NODE_DEFS, type PNode, type PEdge, type Program } from './program';
import type { Design } from './types';

/** a felület blokkjainak mérete (ui/progedit.ts) – az elrendezéshez */
export const BLOCK_W = 184, COL_GAP = 56, ROW_GAP = 28;
/** a blokk magassága, mint a szerkesztőben: fejléc + portsorok + legfeljebb 3 összefoglaló sor (+ hibasor) */
const BLOCK_H = (n: PNode) => { const d = NODE_DEFS[n.type]; return 26 + 4 + 22 * Math.max(d.ins.length, d.outs.length, 1) + 16 * 3 + 12 + 16; };

export const progOf = (D: Design): Program => (D.program || (D.program = { nodes: [], edges: [] }));
export const nextId = (pre: string, list: Array<{ id: string }>) => { let i = 1; while (list.some(x => x.id === pre + i)) i++; return pre + i; };
const nodeOfPort = (ref: string) => ref.slice(0, ref.lastIndexOf('.'));
const portOf = (ref: string) => ref.slice(ref.lastIndexOf('.') + 1);

/** Paraméterek ellenőrzése és átalakítása a blokktípus szerint; `pin` a belső lábhivatkozás (pl. p3.A1). */
export function coerceProps(type: string, input: Record<string, unknown>, resolvePin: (s: string) => string | null): { props: Record<string, unknown> } | { error: string } {
  const d = NODE_DEFS[type], out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const p = d.params.find(x => x.key === k);
    if (!p) return { error: `Block type "${type}" has no parameter "${k}" (has: ${d.params.map(x => x.key).join(', ') || 'none'}).` };
    if (p.type === 'pin') { if (v === '' || v == null) { out[k] = ''; continue; } const r = resolvePin(String(v)); if (!r) return { error: `Unknown pin "${String(v)}" for ${k} (use "LABEL.PIN", e.g. "S1.A1" or "PICO1.GP15").` }; out[k] = r; }
    else if (p.type === 'number') { const n = Number(v); if (!isFinite(n)) return { error: `${k} must be a number.` }; if ((p.min != null && n < p.min) || (p.max != null && n > p.max)) return { error: `${k} must be between ${p.min ?? '-∞'} and ${p.max ?? '∞'}${p.unit ? ' ' + p.unit : ''}.` }; out[k] = n; }
    else if (p.type === 'select') { const s = String(v); if (!p.options!.some(o => o[0] === s)) return { error: `${k} must be one of: ${p.options!.map(o => o[0]).join(', ')}.` }; out[k] = s; }
    else out[k] = String(v);
  }
  return { props: out };
}

/** Új blokk (a paraméterek alapértékkel kiegészülnek); a helye a többi alá, vagy a megadott. */
export function addBlock(D: Design, type: string, props: Record<string, unknown> = {}, at?: { x: number; y: number }): PNode | null {
  const d = NODE_DEFS[type]; if (!d) return null;
  const prog = progOf(D), p: Record<string, unknown> = {};
  for (const pr of d.params) p[pr.key] = pr.default;
  Object.assign(p, props);
  const pos = at || { x: 40, y: prog.nodes.length ? Math.max(...prog.nodes.map(n => n.y + BLOCK_H(n))) + ROW_GAP : 40 };
  const n: PNode = { id: nextId('n', prog.nodes), type, x: pos.x, y: pos.y, props: p };
  prog.nodes.push(n); return n;
}

/** Összekötés: kimenet → bemenet; egy bemenetre egy él (a régi lecserélődik). Hibánál szöveg. */
export function connectBlocks(D: Design, from: string, to: string): PEdge | string {
  const prog = progOf(D), a = prog.nodes.find(n => n.id === nodeOfPort(from)), b = prog.nodes.find(n => n.id === nodeOfPort(to));
  if (!a) return `No block "${nodeOfPort(from)}".`;
  if (!b) return `No block "${nodeOfPort(to)}".`;
  const da = NODE_DEFS[a.type], db = NODE_DEFS[b.type];
  if (!da.outs.some(p => p.id === portOf(from))) return `Block ${a.id} (${a.type}) has no output "${portOf(from)}" (outputs: ${da.outs.map(p => p.id).join(', ') || 'none'}).`;
  if (!db.ins.some(p => p.id === portOf(to))) return `Block ${b.id} (${b.type}) has no input "${portOf(to)}" (inputs: ${db.ins.map(p => p.id).join(', ') || 'none'}).`;
  prog.edges = prog.edges.filter(e => e.to !== to);
  const e: PEdge = { id: nextId('e', prog.edges), from, to };
  prog.edges.push(e); return e;
}

/** Blokkok törlése a hozzájuk tartozó élekkel; a törölt darabszám. */
export function removeBlocks(D: Design, ids: Iterable<string>): number {
  const prog = progOf(D), s = new Set(ids), n0 = prog.nodes.length;
  prog.nodes = prog.nodes.filter(n => !s.has(n.id));
  prog.edges = prog.edges.filter(e => !s.has(nodeOfPort(e.from)) && !s.has(nodeOfPort(e.to)));
  return n0 - prog.nodes.length;
}

/** Él törlése a bemenete (vagy kimenete és bemenete) szerint; a törölt darabszám. */
export function disconnectBlocks(D: Design, to: string, from?: string): number {
  const prog = progOf(D), n0 = prog.edges.length;
  prog.edges = prog.edges.filter(e => !(e.to === to && (!from || e.from === from)));
  return n0 - prog.edges.length;
}

/**
 * Elrendezés balról jobbra: oszlop = a leghosszabb út a forrásoktól (a visszacsatolás nem számít), a kimenetek
 * a legutolsó oszlopba; oszlopon belül a bemenetek átlagos sorrendje szerint. A blokkok egymás alá, átfedés nélkül.
 */
export function arrangeProgram(prog: Program): void {
  const ids = prog.nodes.map(n => n.id), pre = new Map(ids.map(i => [i, [] as string[]]));
  for (const e of prog.edges) { const a = nodeOfPort(e.from), b = nodeOfPort(e.to); if (a !== b && pre.has(b)) pre.get(b)!.push(a); }
  const col = new Map<string, number>(), visiting = new Set<string>();
  const depth = (i: string): number => {
    if (col.has(i)) return col.get(i)!; if (visiting.has(i)) return 0; visiting.add(i);
    const d = Math.max(-1, ...pre.get(i)!.map(depth)) + 1; visiting.delete(i); col.set(i, d); return d;
  };
  ids.forEach(depth);
  const maxCol = Math.max(0, ...col.values());
  for (const n of prog.nodes) if (!NODE_DEFS[n.type].outs.length && pre.get(n.id)!.length) col.set(n.id, maxCol); // kimenetek a végére
  const cols: PNode[][] = [];
  for (const n of prog.nodes) (cols[col.get(n.id)!] ||= []).push(n);
  const rank = new Map<string, number>();
  cols.forEach((c, ci) => {
    if (!c) return;
    const key = (n: PNode) => { const ps = pre.get(n.id)!.filter(p => rank.has(p)); return ps.length ? ps.reduce((s, p) => s + rank.get(p)!, 0) / ps.length : ci === 0 ? prog.nodes.indexOf(n) : 1e6 + prog.nodes.indexOf(n); };
    c.sort((a, b) => key(a) - key(b));
    let y = 40;
    c.forEach((n, k) => { rank.set(n.id, k); n.x = 40 + ci * (BLOCK_W + COL_GAP); n.y = y; y += BLOCK_H(n) + ROW_GAP; });
  });
}
