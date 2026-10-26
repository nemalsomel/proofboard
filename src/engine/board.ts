/**
 * Panel-elrendezés: a réz csíkdarabok (cellák) a szekcióhatárok és a csíkvágások szerint.
 *
 * A panel oszlopai függőleges rézcsíkok, amelyeket a szekcióhossz (`sec`) és a vágások darabolnak:
 *  - rés-vágás (kind 0): a csík megszakad az r. és az r+1. sor között (késsel vágva);
 *  - kifúrt lyuk (kind 1): az r. lyuk körül nincs réz, a lyuk szigetelt, a csík ott megszakad.
 * A cellák sorszáma oszlopfolytonos (oszloponként felülről lefelé), így vágás nélkül megegyezik
 * a régi `c * SR + floor(r / sec)` számozással.
 */

export interface BoardSpec { rows: number; cols: number; sec: number }
/** [sor, oszlop, fajta]: 0 = rés az r. és r+1. sor között, 1 = kifúrt lyuk. */
export type Cut = readonly [number, number, number];

export interface Segment {
  c: number;
  r0: number;
  r1: number;
  /** Kifúrt lyuk: egyetlen, réz nélküli lyuk. */
  drilled: boolean;
}

/** Szomszédos cellák közti lehetséges forrasztóhíd. dir: 0 fel, 1 le, 2 balra, 3 jobbra. */
export interface Edge { to: number; dir: 0 | 1 | 2 | 3; br: [number, number, number, number] }

export interface Layout {
  readonly N: number;
  readonly segs: readonly Segment[];
  /** A lyuk cellája (a panelon belül). */
  cell(r: number, c: number): number;
  drilled(r: number, c: number): boolean;
  /** Szomszédok a régi rácsos bejárás sorrendjében: fel, le, balra, jobbra. */
  adj(cell: number): readonly Edge[];
  edge(a: number, b: number): Edge | undefined;
  /** A cella lyukai (kifúrt cellánál maga a lyuk). */
  holes(cell: number): Array<[number, number]>;
  /** A vágások, amelyek ténylegesen elválasztanak (szekcióhatáron lévő rés nem számít). */
  readonly cuts: readonly Cut[];
}

const keyOf = (r: number, c: number) => r * 100000 + c;

export function normCuts(b: BoardSpec, cuts: readonly Cut[]): Cut[] {
  const out = new Map<string, Cut>();
  for (const x of cuts) {
    const r = Math.round(+x[0]), c = Math.round(+x[1]), k = +x[2] ? 1 : 0;
    if (!(c >= 0 && c < b.cols && r >= 0 && r < b.rows)) continue;
    if (k === 0 && (r >= b.rows - 1 || (r + 1) % b.sec === 0)) continue; // a csík vége vagy szekcióhatár: nincs mit vágni
    out.set(`${r}:${c}:${k}`, [r, c, k]);
  }
  return [...out.values()].sort((x, y) => x[1] - y[1] || x[0] - y[0] || x[2] - y[2]);
}

export function buildLayout(b: BoardSpec, cutsIn: readonly Cut[] = []): Layout {
  const cuts = normCuts(b, cutsIn);
  const gap = new Set<number>(), hole = new Set<number>();
  for (const [r, c, k] of cuts) (k ? hole : gap).add(keyOf(r, c));
  const segs: Segment[] = [];
  const cellAt = new Int32Array(b.rows * b.cols).fill(-1);
  const colSegs: number[][] = [];
  for (let c = 0; c < b.cols; c++) {
    const list: number[] = [];
    let r0 = -1;
    const close = (r1: number) => { if (r0 >= 0 && r1 >= r0) { list.push(segs.length); segs.push({ c, r0, r1, drilled: false }); } r0 = -1; };
    for (let r = 0; r < b.rows; r++) {
      if (hole.has(keyOf(r, c))) { close(r - 1); list.push(segs.length); segs.push({ c, r0: r, r1: r, drilled: true }); continue; }
      if (r0 < 0) r0 = r;
      if ((r + 1) % b.sec === 0 || gap.has(keyOf(r, c)) || r === b.rows - 1) close(r);
    }
    colSegs.push(list);
  }
  segs.forEach((s, i) => { for (let r = s.r0; r <= s.r1; r++) cellAt[r * b.cols + s.c] = i; });

  const adjL: Edge[][] = segs.map(() => []);
  const pos = new Map<number, number>(); // cella → index az oszlop listájában
  colSegs.forEach(l => l.forEach((s, i) => pos.set(s, i)));
  segs.forEach((s, i) => {
    if (s.drilled) return;
    const col = colSegs[s.c], j = pos.get(i)!;
    // fel / le: ugyanabban az oszlopban, csak szekcióhatáron át (vágáson át nem)
    const up = col[j - 1], dn = col[j + 1];
    if (up != null && !segs[up].drilled && segs[up].r1 === s.r0 - 1 && s.r0 % b.sec === 0) adjL[i].push({ to: up, dir: 0, br: [s.r0 - 1, s.c, s.r0, s.c] });
    if (dn != null && !segs[dn].drilled && segs[dn].r0 === s.r1 + 1 && segs[dn].r0 % b.sec === 0) adjL[i].push({ to: dn, dir: 1, br: [s.r1, s.c, s.r1 + 1, s.c] });
    // balra / jobbra: az átfedő sorok közepén
    for (const [dc, dir] of [[-1, 2], [1, 3]] as const) {
      const nc = s.c + dc;
      if (nc < 0 || nc >= b.cols) continue;
      for (const t of colSegs[nc]) {
        const o = segs[t];
        if (o.drilled || o.r1 < s.r0 || o.r0 > s.r1) continue;
        const lo = Math.max(o.r0, s.r0), hi = Math.min(o.r1, s.r1);
        // a szekció közepe (mint vágás nélkül), vagy ha a vágás miatt kiesik, az átfedés közepe
        const row = lo + (b.sec >> 1) <= hi ? lo + (b.sec >> 1) : lo + ((hi - lo + 1) >> 1);
        adjL[i].push({ to: t, dir, br: dc < 0 ? [row, nc, row, s.c] : [row, s.c, row, nc] });
      }
    }
  });
  const edgeMap = new Map<number, Edge>();
  adjL.forEach((l, i) => l.forEach(e => { if (!edgeMap.has(i * segs.length + e.to)) edgeMap.set(i * segs.length + e.to, e); }));

  return {
    N: segs.length,
    segs,
    cuts,
    cell: (r, c) => cellAt[r * b.cols + c],
    drilled: (r, c) => hole.has(keyOf(r, c)),
    adj: i => adjL[i],
    edge: (a, z) => edgeMap.get(a * segs.length + z),
    holes: i => { const s = segs[i], o: Array<[number, number]> = []; for (let r = s.r0; r <= s.r1; r++) o.push([r, s.c]); return o; },
  };
}

/**
 * Javasolt csíkvágások: minden csíkdarabban a szomszédos, eltérő hálózatú lábak közé
 * (a két láb közti sorköz közepére) rés-vágás kerül. `net` lábanként egy hálózatazonosító;
 * az azonos azonosítójúak egy csíkon maradhatnak.
 */
export function planCuts(b: BoardSpec, manual: readonly Cut[], pins: ReadonlyArray<{ r: number; c: number; net: string }>): Cut[] {
  const L = buildLayout(b, manual);
  const by = new Map<number, Array<{ r: number; net: string }>>();
  for (const p of pins) {
    if (p.r < 0 || p.c < 0 || p.r >= b.rows || p.c >= b.cols || L.drilled(p.r, p.c)) continue;
    const k = L.cell(p.r, p.c);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(p);
  }
  const out: Cut[] = [];
  for (const [k, list] of by) {
    const c = L.segs[k].c;
    list.sort((x, y) => x.r - y.r);
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i], z = list[i + 1];
      if (a.net === z.net || a.r === z.r) continue;
      out.push([(a.r + z.r - 1) >> 1, c, 0]);
    }
  }
  return normCuts(b, out);
}
