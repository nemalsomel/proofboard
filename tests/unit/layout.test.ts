import { describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS, isCustom, parseStore, remember, resetLayout, stateOf, switchTo } from '../../src/ui/layout';
import { WIN_DEFAULT, WIN_MIN_W, clampWin, parseWin } from '../../src/ui/floatwin';

describe('elrendezések', () => {
  it('üres tárolóból Tervezés, alapértékekkel; a régi beállítás a Tervezésbe kerül', () => {
    expect(stateOf(parseStore(null))).toEqual(LAYOUT_DEFAULTS.design);
    const s = parseStore(null, { l: true, work: 'split' as const });
    expect(stateOf(s)).toMatchObject({ l: true, work: 'split', r: false });
    expect(stateOf(s, 'prog')).toEqual(LAYOUT_DEFAULTS.prog);
  });
  it('a kézi módosítás elrendezésenként megmarad, váltáskor visszajön', () => {
    let s = parseStore(null);
    s = remember(s, { bottom: true, r: true });
    let x = switchTo(s, 'sim');
    expect(x.state).toEqual(LAYOUT_DEFAULTS.sim);
    s = remember(x.store, { l: false });
    x = switchTo(s, 'design');
    expect(x.state).toMatchObject({ bottom: true, r: true });
    expect(stateOf(x.store, 'sim').l).toBe(false);
    expect(isCustom(x.store)).toBe(true);
    expect(isCustom(resetLayout(x.store))).toBe(false);
  });
  it('a sérült tárolt értékeket eldobja', () => {
    const s = parseStore({ cur: 'xyz', saved: { design: { l: 'igen', work: 'semmi', bottom: true }, foo: { l: true } } });
    expect(s.cur).toBe('design');
    expect(s.saved).toEqual({ design: { bottom: true } });
  });
});

describe('lebegő ablak', () => {
  it('beolvasás alapértékekkel, minimális szélesség', () => {
    expect(parseWin(undefined)).toEqual(WIN_DEFAULT);
    expect(parseWin({ w: 50, h: 10, collapsed: true, docked: 'x' })).toMatchObject({ w: WIN_MIN_W, h: null, collapsed: true, docked: false });
  });
  it('a területen belül marad', () => {
    const a = { w: 800, h: 600 };
    expect(clampWin({ ...WIN_DEFAULT, x: -2000, y: 5000 }, a)).toMatchObject({ x: -WIN_DEFAULT.w + 80, y: 600 - 34 });
    expect(clampWin({ ...WIN_DEFAULT, x: 5000, y: -10 }, a)).toMatchObject({ x: 720, y: 0 });
    expect(clampWin({ ...WIN_DEFAULT, w: 2000 }, a).w).toBe(784);
  });
});
