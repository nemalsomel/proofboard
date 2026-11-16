import { describe, expect, it } from 'vitest';
import { keepout, keepoutOf } from '../../src/engine/backside';
import { checkAll } from '../../src/engine/check';
import { normalize } from '../../src/engine/design';
import { analyze } from '../../src/engine/netlist';
import * as OPS from '../../src/engine/ops';
import { route } from '../../src/engine/route';
import { EXAMPLES } from '../../src/ui/examples';
import { placedPins } from '../../src/engine/geometry';

function load(id: string) {
  const raw = JSON.parse(JSON.stringify(EXAMPLES.find(e => e.id === id)!.design));
  const D = normalize({ ...raw, bridges: raw.bridges || [], wires: raw.wires || [], auto: { bridges: [], wires: [] }, notes: [], settings: { usb: true, btnMode: 'hold', autoRoute: true },
    links: (raw.links || []).map(([a, b]: [string, string], i: number) => ({ id: 'l' + i, a, b, gpio: null })) });
  route(D, { full: true });
  return D;
}
const ctx = (D: ReturnType<typeof load>) => { const A = analyze(D); return { A0: A, AS: A, SIM: null, linkState: new Map() } as unknown as Parameters<typeof checkAll>[1]; };

describe('rézoldali alkatrész', () => {
  it('a teste alatti lyukak tiltottak (a saját lábai nem); az alatta vezetés engedélyezhető', () => {
    const D = load('led-auto');
    const p = OPS.placePart(D, 'button', 2, D.board.cols - 8)!;
    expect(p).toBeTruthy();
    expect(keepoutOf(D, p).size).toBe(0);
    p.side = 'cu';
    const ko = keepoutOf(D, p), own = placedPins(p).map(q => q.r + ':' + q.c);
    expect(ko.size).toBeGreaterThan(4);
    for (const k of own) expect(ko.has(k)).toBe(false);
    p.under = true;
    expect(keepoutOf(D, p).size).toBe(0);
    // betöltéskor megmarad
    const d2 = normalize(JSON.parse(JSON.stringify(D)));
    expect(d2.parts.find(x => x.id === p.id)).toMatchObject({ side: 'cu', under: true });
  });

  it('az útvonalkereső nem tesz hidat a teste alá; a kézi híd és a láb alatta figyelmeztetés', () => {
    const D = load('led-auto');
    const holes = new Set(D.auto.bridges.flatMap(b => [b[0] + ':' + b[1], b[2] + ':' + b[3]]));
    expect(holes.size).toBeGreaterThan(0);
    // egy rézoldali gomb a hidak fölé: keresünk olyan helyet, ahol a lábai szabad lyukra esnek, és a teste hidat takar
    let placed = null as null | ReturnType<typeof OPS.placePart>;
    outer: for (let r = 0; r < D.board.rows; r++) for (let c = 0; c < D.board.cols; c++) {
      const p = OPS.placePart(D, 'button', r, c); if (!p) continue;
      p.side = 'cu';
      if ([...keepoutOf(D, p)].some(k => holes.has(k))) { placed = p; break outer; }
      OPS.removeParts(D, new Set([p.id]));
    }
    expect(placed).toBeTruthy();
    expect(checkAll(D, ctx(D)).some(i => /teste alatt forrasztóhíd/.test(i.msg))).toBe(true);
    route(D, { full: true });
    const KO = keepout(D);
    for (const b of D.auto.bridges) { expect(KO.has(b[0] + ':' + b[1])).toBe(false); expect(KO.has(b[2] + ':' + b[3])).toBe(false); }
    expect(checkAll(D, ctx(D)).some(i => /teste alatt forrasztóhíd/.test(i.msg))).toBe(false);
  });
});

describe('rézoldali alkatrész: újrabekötés', () => {
  it('a rézoldalra tett alkatrész alatti automatikus híd részleges útvonalkereséskor is eltűnik', () => {
    const D = load('led-auto');
    const holes = new Set(D.auto.bridges.flatMap(b => [b[0] + ':' + b[1], b[2] + ':' + b[3]]));
    let p = null as null | ReturnType<typeof OPS.placePart>;
    outer: for (let r = 0; r < D.board.rows; r++) for (let c = 0; c < D.board.cols; c++) {
      const x = OPS.placePart(D, 'button', r, c); if (!x) continue;
      x.side = 'cu';
      if ([...keepoutOf(D, x)].some(k => holes.has(k))) { p = x; break outer; }
      OPS.removeParts(D, new Set([x.id]));
    }
    expect(p).toBeTruthy();
    route(D, {});
    const KO = keepout(D);
    expect(D.auto.bridges.some(b => KO.has(b[0] + ':' + b[1]) || KO.has(b[2] + ':' + b[3]))).toBe(false);
  });
});
