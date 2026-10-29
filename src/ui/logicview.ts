/**
 * A Logika fül nézetei: kapurajz (SVG) és igazságtábla-adatok. Tiszta függvények, DOM nélkül
 * (HTML/SVG szöveget adnak vissza), így unit tesztelhetők.
 */
import { fromGates, minimize, parseExpr, printExpr, truthRow, varsOf, type Expr, type GateKind, type GateNode, type Level } from '../core/logic';

const escX = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/* ---------- kapurajz ---------- */

interface Placed { n: GateNode; x: number; y: number; w: number; h: number; kids: Placed[] }
const COL = 74, ROW = 26, GW = 40, LEAF_W = 46;

/** A kapufa kapcsolási rajza: bemenetek balra, a kimenet jobbra; a kapuk szabványos (ANSI) jelöléssel. */
export function gateSvg(tree: GateNode, outName: string): string {
  let row = 0;
  const col = (n: GateNode): number => ('g' in n ? 1 + Math.max(0, ...n.ins.map(col)) : 0);
  const D = col(tree);
  const place = (n: GateNode, c: number): Placed => {
    if (!('g' in n)) { const y = row++ * ROW + ROW / 2; return { n, x: 0, y, w: LEAF_W, h: 0, kids: [] }; }
    const kids = n.ins.map(k => place(k, c - 1));
    const y = kids.length ? (kids[0].y + kids[kids.length - 1].y) / 2 : row++ * ROW + ROW / 2;
    const h = Math.max(26, (n.ins.length || 1) * 13 + 6);
    return { n, x: LEAF_W + 16 + (col(n) - 1) * COL, y, w: GW, h, kids };
  };
  const root = place(tree, D);
  const outX = (p: Placed) => (!('g' in p.n) ? p.x + p.w : p.x + p.w + (bubble(p.n.g) ? 8 : 0) + (p.n.g === 'xor' || p.n.g === 'xnor' ? 0 : 0));
  const parts: string[] = [];
  const draw = (p: Placed) => {
    if (!('g' in p.n)) {
      const t = 'v' in p.n ? p.n.v : String(p.n.c);
      parts.push(`<text x="${p.x + p.w - 4}" y="${p.y + 4}" text-anchor="end" class="lgv-pin">${escX(t)}</text>`);
      return;
    }
    const g = p.n.g, x = p.x, y0 = p.y - p.h / 2, w = p.w, h = p.h;
    // bemeneti vezetékek a gyerekektől
    p.kids.forEach((k, i) => {
      const iy = y0 + ((i + 1) * h) / (p.kids.length + 1), kx = outX(k), mx = x - 10;
      parts.push(`<path class="lgv-wire" d="M${kx},${k.y} H${mx} V${iy} H${x + (g === 'or' || g === 'nor' ? 6 : g === 'xor' || g === 'xnor' ? 4 : 0)}"/>`);
      draw(k);
    });
    parts.push(`<path class="lgv-gate" d="${shape(g, x, y0, w, h)}"/>`);
    if (g === 'xor' || g === 'xnor') parts.push(`<path class="lgv-gate lgv-open" d="M${x - 6},${y0} Q${x + w * 0.3 - 6},${y0 + h / 2} ${x - 6},${y0 + h}"/>`);
    if (bubble(g)) parts.push(`<circle class="lgv-gate" cx="${x + w + 4}" cy="${p.y}" r="4"/>`);
    parts.push(`<text x="${x + w * 0.42}" y="${p.y + 3.5}" text-anchor="middle" class="lgv-name">${GATE_SHORT[g]}</text>`);
  };
  draw(root);
  const ox = outX(root), W = ox + 70, H = Math.max(row * ROW, root.h + 8);
  parts.push(`<path class="lgv-wire" d="M${ox},${root.y} H${ox + 18}"/><text x="${ox + 22}" y="${root.y + 4}" class="lgv-out">${escX(outName)}</text>`);
  return `<svg class="lgv" viewBox="-8 -4 ${W + 8} ${H + 8}" width="${W + 8}" height="${H + 8}" role="img" aria-label="${escX(outName)} kapurajza">${parts.join('')}</svg>`;
}

const GATE_SHORT: Record<GateKind, string> = { and: '&', nand: '&', or: '≥1', nor: '≥1', xor: '=1', xnor: '=1', not: '1', buf: '1' };
const bubble = (g: GateKind) => g === 'nand' || g === 'nor' || g === 'xnor' || g === 'not';

function shape(g: GateKind, x: number, y: number, w: number, h: number): string {
  if (g === 'and' || g === 'nand') return `M${x},${y} H${x + w - h / 2} A${h / 2},${h / 2} 0 0 1 ${x + w - h / 2},${y + h} H${x} Z`;
  if (g === 'not' || g === 'buf') return `M${x},${y + 2} L${x + w},${y + h / 2} L${x},${y + h - 2} Z`;
  return `M${x},${y} Q${x + w * 0.3},${y + h / 2} ${x},${y + h} Q${x + w * 0.7},${y + h} ${x + w},${y + h / 2} Q${x + w * 0.7},${y} ${x},${y} Z`;
}

/* ---------- igazságtábla ---------- */

export interface TableOut { name: string; expr: string; oe: string }
export interface TableData {
  vars: string[];
  /** soronként a kimenetek: 0, 1, 'X' (ismeretlen/hibás), 'Z' (engedélyezés = 0) */
  cells: Array<Array<Level | 'Z'>>;
  errors: string[];
  tooMany: boolean;
}
export const TABLE_MAX_VARS = 6;

/** A táblázat bemenetei: a kifejezésekben szereplők és a külön kiválasztottak, a lábak sorrendjében. */
export function tableVars(outs: readonly TableOut[], extra: readonly string[], pinOrder: readonly string[]): string[] {
  const set = new Set<string>(extra);
  for (const o of outs) for (const s of [o.expr, o.oe]) { try { if (s.trim()) varsOf(parseExpr(s)).forEach(v => set.add(v)); } catch { /* hibás kifejezés */ } }
  const idx = (v: string) => { const i = pinOrder.indexOf(v); return i < 0 ? 1e6 : i; };
  return [...set].sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
}

export function truthTable(outs: readonly TableOut[], vars: readonly string[]): TableData {
  const errors: string[] = [];
  const parsed = outs.map(o => {
    let e: Expr | null = null, oe: Expr | null = null;
    try { e = o.expr.trim() ? parseExpr(o.expr) : null; } catch (x) { errors.push(`${o.name}: ${(x as Error).message}`); }
    try { oe = o.oe.trim() ? parseExpr(o.oe) : null; } catch (x) { errors.push(`${o.name} engedélyezés: ${(x as Error).message}`); }
    return { e, oe };
  });
  if (vars.length > TABLE_MAX_VARS) return { vars: [...vars], cells: [], errors, tooMany: true };
  const cells = Array.from({ length: 1 << vars.length }, (_, r) => parsed.map(({ e, oe }) => {
    if (oe && truthRow(oe, vars, r) !== 1) return 'Z' as const;
    return e ? truthRow(e, vars, r) : ('X' as const);
  }));
  return { vars: [...vars], cells, errors, tooMany: false };
}

/** Egy cella átbillentése: az oszlop új igazságtáblájából minimalizált kifejezés. */
export function toggleCell(data: TableData, out: number, row: number): string {
  const col = data.cells.map(c => c[out]);
  const ones: number[] = [], dc: number[] = [];
  col.forEach((v, r) => {
    const nv = r === row ? (v === 1 ? 0 : 1) : v;
    if (nv === 1) ones.push(r); else if (nv === 'Z') dc.push(r); // ahol nem hajt, ott mindegy
  });
  return printExpr(minimize(data.vars, ones, dc));
}

/** Kapufából kifejezés-szöveg (a kapus szerkesztés után). */
export const gatesToText = (n: GateNode) => printExpr(fromGates(n));
