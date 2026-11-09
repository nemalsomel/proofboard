import { describe, expect, it } from 'vitest';
import { applyCompaction, compactMetrics, layoutStats, partRect, planCompaction } from '../../src/engine/compact';
import { presetMacropad, presetRouted } from '../../src/engine/presets';
import { route } from '../../src/engine/route';
import { emptyDesign, normalize } from '../../src/engine/design';
import { placePart } from '../../src/engine/ops';
import { engineCtx, runTool, summarize } from '../../src/agent/tools';

describe('tömörség', () => {
  it('üres terv: nincs foglalt terület', () => {
    const s = layoutStats(emptyDesign());
    expect(s.box).toBeNull(); expect(s.fill).toBe(0); expect(s.boardArea).toBeGreaterThan(0);
  });

  it('foglalt terület: az alkatrésztestek és a hidak befoglalója; a kitöltés a testek aránya', () => {
    const D = emptyDesign();
    const r = placePart(D, 'res', 10, 10)!, l = placePart(D, 'led', 30, 20)!;
    const a = partRect(r), b = partRect(l);
    let s = layoutStats(D);
    expect(s.box).toEqual({ r0: Math.min(a.r0, b.r0), r1: Math.max(a.r1, b.r1), c0: Math.min(a.c0, b.c0), c1: Math.max(a.c1, b.c1) });
    expect(s.parts).toBe(2);
    const body = (q: typeof a) => (q.r1 - q.r0 + 1) * (q.c1 - q.c0 + 1);
    expect(s.partArea).toBe(body(a) + body(b));
    expect(s.fill).toBeCloseTo(s.partArea / s.area);
    // közelebb téve kisebb a terület, nagyobb a kitöltés
    const far = s.area;
    l.r = 12; l.c = 16;
    s = layoutStats(D);
    expect(s.area).toBeLessThan(far);
    // a híd is a foglalt területhez tartozik
    D.bridges.push([40, 2, 40, 4]);
    expect(layoutStats(D).box!.r1).toBe(40);
    expect(layoutStats(D).box!.c0).toBe(2);
  });

  it('rögzített alkatrész: a terv megőrzi, az agent nem mozdítja, az összefoglaló jelzi', async () => {
    const D = emptyDesign();
    const p = placePart(D, 'button', 20, 20)!; p.fixed = true;
    const n = normalize(JSON.parse(JSON.stringify(D)));
    expect(n.parts[0].fixed).toBe(true);
    expect(layoutStats(n).fixed).toBe(1);
    const ctx = engineCtx(n);
    const r = await runTool(ctx, 'move_part', { label: p.label, row: 30 });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/fixed in place by the user/);
    expect(ctx.D().parts[0].r).toBe(20);
    const sum = summarize(ctx.D());
    expect(sum).toMatch(/FIXED by the user/);
    expect(sum).toMatch(/Footprint: rows \d+–\d+/);
  });
});

/** Szellős terv: Pico fent, két kör messze lent (a felhasználó képernyőképe nyomán). */
async function spread() {
  const ctx = engineCtx(emptyDesign());
  await runTool(ctx, 'place_part', { type: 'pico', row: 2, col: 2 });
  await runTool(ctx, 'place_part', { type: 'res', row: 30, col: 22 });
  await runTool(ctx, 'place_part', { type: 'led', row: 40, col: 20 });
  await runTool(ctx, 'place_part', { type: 'button', row: 44, col: 4 });
  await runTool(ctx, 'place_part', { type: 'res', row: 36, col: 8 });
  for (const [a, b] of [['PICO1.GP15', 'R1.1'], ['R1.2', 'LED1.A'], ['LED1.K', 'GND'], ['S1.A1', 'PICO1.GP2'], ['S1.B1', 'R2.1'], ['R2.2', 'GND']]) await runTool(ctx, 'connect', { from: a, to: b });
  return ctx.D();
}

describe('tömörítés', () => {
  it('szellős terv: kisebb terület, minden kapcsolat bekötve, vezeték nélkül; a vezérlőlap és a gomb a helyén; a terv nem változik', async () => {
    const D = await spread(), snap = JSON.stringify(D);
    const r = planCompaction(D, { strength: 0.5, keepControls: false });
    expect(JSON.stringify(D)).toBe(snap);
    expect(r.after.linksOk).toBe(6); expect(r.after.wires).toBe(0);
    expect(r.after.stats.area).toBeLessThan(r.before.stats.area * 0.7);
    expect(r.after.bridges).toBeLessThan(r.before.bridges);
    expect(r.kept).toEqual({ PICO1: 'mcu' });
    // alapból a kezelőszerv (gomb) is marad
    const r2 = planCompaction(D, { strength: 0.5 });
    expect(r2.kept.S1).toBe('control');
    expect(r2.moves.map(m => m.label)).not.toContain('S1');
    // alkalmazás + útvonal: ugyanaz az eredmény
    expect(applyCompaction(D, r)).toBe(true);
    route(D, { full: true });
    const m = compactMetrics(D);
    expect([m.stats.area, m.linksOk, m.wires, m.bridges]).toEqual([r.after.stats.area, 6, 0, r.after.bridges]);
  });

  it('a szorosság számít: szorosabbnál nem nagyobb a terület; determinisztikus', async () => {
    const D = await spread();
    const area = (s: number) => planCompaction(D, { strength: s, keepControls: false }).after.stats.area;
    const [a0, a1] = [area(0), area(1)];
    expect(a1).toBeLessThanOrEqual(a0);
    expect(JSON.stringify(planCompaction(D, { strength: 0.7 }))).toBe(JSON.stringify(planCompaction(D, { strength: 0.7 })));
  });

  it('rögzített, hatókörön kívüli és kézzel bekötött alkatrész nem mozdul', async () => {
    const D = await spread();
    D.parts.find(p => p.label === 'R1')!.fixed = true;
    const r = planCompaction(D, { only: D.parts.filter(p => p.label !== 'R2').map(p => p.id) });
    expect(r.kept).toMatchObject({ R1: 'fixed', R2: 'scope' });
    expect(r.moves.map(m => m.label).sort()).toEqual(['LED1']);
    // a kézi minta: hidakkal bekötve, kapcsolatok nélkül → semmi sem mozdul
    const M = planCompaction(presetMacropad(), { strength: 1, keepMcu: false, keepControls: false });
    expect(M.moves).toEqual([]);
    expect(Object.values(M.kept).every(x => x === 'manual')).toBe(true);
  });

  it('regresszió: a 29 kapcsolatos minta tömörítés után is 29/29, vezeték nélkül, és nem lesz rosszabb', () => {
    for (const s of [0, 1]) {
      const r = planCompaction(presetRouted(), { strength: s });
      expect([r.after.linksOk, r.after.wires]).toEqual([29, 0]);
      expect(r.after.bridges + r.after.stats.area * 0.05).toBeLessThanOrEqual(r.before.bridges + r.before.stats.area * 0.05);
    }
  });
});
