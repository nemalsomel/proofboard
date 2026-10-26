import { describe, expect, it } from 'vitest';
import { buildLayout, planCuts } from '../../src/engine/board';

const B3 = { rows: 78, cols: 39, sec: 3 }, STRIP = { rows: 20, cols: 5, sec: 20 };

describe('panel-elrendezés', () => {
  it('vágás nélkül a régi szekciószámozás és hídhelyek', () => {
    const L = buildLayout(B3), SR = 26;
    for (const [r, c] of [[0, 0], [5, 3], [77, 38], [40, 17]]) expect(L.cell(r, c)).toBe(c * SR + Math.floor(r / 3));
    expect(L.N).toBe(39 * 26);
    const a = L.cell(4, 10);
    expect(L.adj(a).map(e => [e.dir, e.br])).toEqual([[0, [2, 10, 3, 10]], [1, [5, 10, 6, 10]], [2, [4, 9, 4, 10]], [3, [4, 10, 4, 11]]]);
    expect(buildLayout(STRIP).edge(0, 1)?.br).toEqual([10, 0, 10, 1]); // teljes csík: a közepén
  });
  it('rés-vágás kettévágja a csíkot, a kifúrt lyuk szigetelt', () => {
    const L = buildLayout(STRIP, [[4, 0, 0], [10, 1, 1]]);
    expect(L.cell(4, 0)).not.toBe(L.cell(5, 0));
    expect(L.cell(3, 0)).toBe(L.cell(4, 0));
    expect(L.drilled(10, 1)).toBe(true);
    const h = L.cell(10, 1);
    expect(L.adj(h)).toEqual([]);
    expect(L.cell(9, 1)).not.toBe(L.cell(11, 1));
    // a csík-darabok közt nincs függőleges szomszéd (vágáson át nem lehet hidat tenni)
    expect(L.adj(L.cell(0, 0)).some(e => e.dir === 1)).toBe(false);
    // a szomszéd oszlopok darabjai az átfedésben érintkeznek
    expect(L.adj(L.cell(0, 0)).filter(e => e.dir === 3).map(e => e.br)).toEqual([[2, 0, 2, 1]]); // az átfedés (0–4. sor) közepén
  });
  it('a szekcióhatáron lévő vagy a panelon kívüli vágást figyelmen kívül hagyja', () => {
    expect(buildLayout(B3, [[2, 5, 0], [77, 5, 0], [3, 50, 1]]).cuts).toEqual([]);
  });
});

describe('vágásjavaslat', () => {
  it('az eltérő hálózatú szomszédos lábak közé, a sorköz közepére vág', () => {
    const pins = [{ r: 2, c: 0, net: 'a' }, { r: 8, c: 0, net: 'b' }, { r: 9, c: 0, net: 'b' }, { r: 12, c: 0, net: 'a' }, { r: 3, c: 1, net: 'x' }];
    expect(planCuts(STRIP, [], pins)).toEqual([[4, 0, 0], [10, 0, 0]]);
  });
  it('a kézi vágás már elválaszt: oda nem kell új', () => {
    expect(planCuts(STRIP, [[5, 0, 0]], [{ r: 2, c: 0, net: 'a' }, { r: 8, c: 0, net: 'b' }])).toEqual([]);
  });
});
