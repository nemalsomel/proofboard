import { describe, expect, it } from 'vitest';
import { planCuts, type Cut } from '../../src/engine/board';
import { cutAt, cutCheck, hitCut, removeCut, toggleCut, clearManualCuts } from '../../src/engine/cuts';
import { emptyDesign, normalize } from '../../src/engine/design';
import { grp, gSize, groupApply, groupOk, groupSnap, hitBridge, hitNote, hitPart, noteCorner, segDist } from '../../src/ui/hit';
import { DEFS } from '../../src/engine/defs';
import type { Design } from '../../src/engine/types';

const STRIP = { rows: 20, cols: 5, sec: 20 };
const strip = (): Design => { const D = emptyDesign(); D.board = { ...STRIP }; D.cuts = []; D.auto.cuts = []; return D; };
const h = (rf: number, cf: number) => ({ rf, cf, r: Math.round(rf), c: Math.round(cf) });

describe('csíkvágás szerkesztése', () => {
  it('a kattintás helye: hely szerint lyukban furat, a lyukak között rés; a típus felülírja', () => {
    expect(cutAt(STRIP, h(4.05, 2), 'auto')).toEqual([4, 2, 1]);
    expect(cutAt(STRIP, h(4.6, 2), 'auto')).toEqual([4, 2, 0]);
    expect(cutAt(STRIP, h(4.4, 2), 'auto')).toEqual([4, 2, 0]);
    expect(cutAt(STRIP, h(4.6, 2), 'hole')).toEqual([5, 2, 1]);
    expect(cutAt(STRIP, h(4.0, 2), 'gap')).toEqual([4, 2, 0]);
    expect(cutAt(STRIP, h(19.2, 2), 'gap')).toEqual([18, 2, 0]); // a csík vége előtt
  });
  it('tehető-e vágás: a csík végén és szekcióhatáron nincs mit vágni', () => {
    expect(cutCheck(STRIP, [4, 2, 0])).toBe('ok');
    expect(cutCheck(STRIP, [19, 2, 0])).toBe('nothing');
    expect(cutCheck({ rows: 9, cols: 5, sec: 3 }, [2, 1, 0])).toBe('nothing');
    expect(cutCheck(STRIP, [4, 9, 1])).toBe('bad-hole');
  });
  it('kézi vágás ki és be ugyanott; a hozzáadás feloldja a tiltást és kiveszi az azonos automatikusat', () => {
    const D = strip(); D.auto.cuts = [[4, 2, 0]]; D.cutBan = [[4, 2, 0]];
    expect(toggleCut(D, [4, 2, 0])).toBe('added');
    expect(D.cuts).toEqual([[4, 2, 0]]); expect(D.auto.cuts).toEqual([]); expect(D.cutBan).toBeUndefined();
    expect(toggleCut(D, [4, 2, 0])).toBe('removed'); expect(D.cuts).toEqual([]);
    expect(toggleCut(D, [19, 2, 0])).toBe('nothing');
  });
  it('a kurzor alatti vágás: kézi és automatikus is, a legközelebbi; tűréshatáron kívül semmi', () => {
    const D = strip(); D.cuts = [[4, 2, 1]]; D.auto.cuts = [[7, 2, 0]];
    expect(hitCut(D, 4.1, 2.1)).toEqual({ src: 'manual', cut: [4, 2, 1] });
    expect(hitCut(D, 7.5, 2)).toEqual({ src: 'auto', cut: [7, 2, 0] });
    expect(hitCut(D, 10, 2)).toBeNull();
    expect(hitCut(D, 4.5, 2, 0.3)).toBeNull();
  });
  it('törlés: a kézi egyszerűen eltűnik, az automatikus helye tiltólistára kerül (egyszer)', () => {
    const D = strip(); D.cuts = [[4, 2, 1]]; D.auto.cuts = [[7, 2, 0]];
    removeCut(D, { src: 'manual', cut: [4, 2, 1] }); expect(D.cuts).toEqual([]); expect(D.cutBan).toBeUndefined();
    removeCut(D, { src: 'auto', cut: [7, 2, 0] }); removeCut(D, { src: 'auto', cut: [7, 2, 0] });
    expect(D.auto.cuts).toEqual([]); expect(D.cutBan).toEqual([[7, 2, 0]]);
    D.cuts = [[1, 1, 0], [2, 2, 1]]; expect(clearManualCuts(D)).toBe(2); expect(D.cuts).toEqual([]);
  });
  it('az automatikus javaslat kikerüli a tiltott helyet: a két láb között a legközelebbi szabad rés, ha nincs, nem vág', () => {
    const pins = [{ r: 2, c: 0, net: 'a' }, { r: 8, c: 0, net: 'b' }];
    expect(planCuts(STRIP, [], pins)).toEqual([[4, 0, 0]]);
    expect(planCuts(STRIP, [], pins, [[4, 0, 0]])).toEqual([[3, 0, 0]]);
    expect(planCuts(STRIP, [], pins, [[4, 0, 0], [3, 0, 0]])).toEqual([[5, 0, 0]]);
    const all: Cut[] = [2, 3, 4, 5, 6, 7].map(r => [r, 0, 0]);
    expect(planCuts(STRIP, [], pins, all)).toEqual([]);
    expect(planCuts(STRIP, [], pins, [[4, 0, 1]])).toEqual([[4, 0, 0]]); // furat nem tiltja a rést
  });
  it('a tiltólista a mentéssel megmarad, üresen nem kerül a tervbe', () => {
    const D = normalize({ ...strip(), cutBan: [[4, 2, 0], ['x']] });
    expect(D.cutBan).toEqual([[4, 2, 0]]);
    expect('cutBan' in normalize(strip())).toBe(false);
  });
});

describe('találatvizsgálat és csoportok', () => {
  const D = (): Design => {
    const d = emptyDesign();
    d.parts = [{ id: 'p1', type: 'res', label: 'R1', r: 5, c: 5, rot: 0, mir: false, props: { ...DEFS.res.props } }];
    d.bridges = [[10, 1, 10, 2]]; d.wires = [{ a: [12, 1], b: [12, 9], color: '#000' }];
    d.notes = [{ id: 'n1', r: 20, c: 3, w: 6, h: 3, text: '', color: '#fff', target: null }];
    return d;
  };
  const bounds = (p: Parameters<typeof DEFS.res.bounds>[0]) => DEFS[p.type].bounds(p);
  it('alkatrész, híd, jegyzet a pont alatt', () => {
    const d = D();
    expect(hitPart(d, bounds, 5, 6)?.id).toBe('p1');
    expect(hitPart(d, bounds, 15, 15)).toBeNull();
    expect(hitBridge(d, 10.1, 1.5, 0.3)).toBe(0);
    expect(hitBridge(d, 11, 1.5, 0.3)).toBe(-1);
    expect(hitNote(d, 21, 5)?.id).toBe('n1');
    expect(noteCorner(d.notes[0], 22.4, 8.4)).toBe(true);
    expect(segDist(0, 5, 0, 0, 0, 10)).toBe(0);
    expect(segDist(3, 12, 0, 0, 0, 10)).toBeCloseTo(Math.hypot(3, 2));
  });
  it('csoport mozgatása: a panel szélén túl nem, egyébként együtt tolódik', () => {
    const d = D(), g = grp(['p1'], [0], [0]);
    expect(gSize(g)).toBe(3);
    const sn = groupSnap(d, g), inb = (r: number, c: number) => r >= 0 && c >= 0 && r < d.board.rows && c < d.board.cols;
    expect(groupOk(sn, 0, -2, () => true, inb)).toBe(false); // a híd bal vége lelógna
    expect(groupOk(sn, 3, 1, () => true, inb)).toBe(true);
    groupApply(d, sn, 3, 1);
    expect([d.parts[0].r, d.parts[0].c]).toEqual([8, 6]);
    expect(d.bridges[0]).toEqual([13, 2, 13, 3]);
    expect(d.wires[0].a).toEqual([15, 2]);
    groupApply(d, sn, 0, 0); // a kiinduló helyzethez képest
    expect(d.bridges[0]).toEqual([10, 1, 10, 2]);
  });
});
