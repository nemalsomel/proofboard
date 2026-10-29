import { describe, expect, it } from 'vitest';
import { pinLabelPositions } from '../../src/core/labels';

const dip = [{ lr: 0, lc: 0 }, { lr: 0, lc: 1 }, { lr: 3, lc: 0 }, { lr: 3, lc: 1 }];
describe('lábnevek helye', () => {
  it('kétsoros: befelé egymás felé, kifelé a két szélen', () => {
    expect(pinLabelPositions(dip, 'in', 0.75, { r: 1.5, c: 0.5 }).map(p => p.r)).toEqual([0.75, 0.75, 2.25, 2.25]);
    expect(pinLabelPositions(dip, 'out', 0.75, { r: 1.5, c: 0.5 }).map(p => p.r)).toEqual([-0.75, -0.75, 3.75, 3.75]);
  });
  it('egysoros: a test közepe felé (fölötte lévő testnél fölfelé)', () => {
    const row = [{ lr: 0, lc: 0 }, { lr: 0, lc: 1 }];
    expect(pinLabelPositions(row, 'in', 0.75, { r: -3, c: 0.5 }).map(p => p.r)).toEqual([-0.75, -0.75]);
    expect(pinLabelPositions(row, 'out', 0.75, { r: -3, c: 0.5 }).map(p => p.r)).toEqual([0.75, 0.75]);
  });
  it('egy oszlop: oldalra, igazítással', () => {
    const col = [{ lr: 0, lc: 0 }, { lr: 1, lc: 0 }];
    expect(pinLabelPositions(col, 'in', 0.75, { r: 0.5, c: 2 })).toEqual([{ r: 0, c: 0.4, align: 'left' }, { r: 1, c: 0.4, align: 'left' }]);
    expect(pinLabelPositions(col, 'out', 0.75, { r: 0.5, c: 2 })[0].align).toBe('right');
  });
});
