import { describe, expect, it } from 'vitest';
import { engineCtx, runTool } from '../../src/agent/tools';
import { normalize } from '../../src/engine/design';
import { simulateFor } from '../../src/engine/headless';
import { fmtReading, gndNet, probeVoltage, readMeter, resistance } from '../../src/engine/measure';
import { analyze } from '../../src/engine/netlist';
import { route } from '../../src/engine/route';
import { EXAMPLES } from '../../src/ui/examples';
import type { ProbeAt } from '../../src/engine/types';

function load(id: string) {
  const raw = JSON.parse(JSON.stringify(EXAMPLES.find(e => e.id === id)!.design));
  const D = normalize({ ...raw, bridges: raw.bridges || [], wires: raw.wires || [], auto: { bridges: [], wires: [] }, notes: [], settings: { usb: true, btnMode: 'hold', autoRoute: true },
    links: (raw.links || []).map(([a, b]: [string, string], i: number) => ({ id: 'l' + i, a, b, gpio: null })) });
  route(D, { full: true });
  return D;
}
const at = (A: ReturnType<typeof analyze>, label: string, id: string): ProbeAt => { const q = A.pins.find(x => x.part.label === label && x.id === id)!; return [q.r, q.c]; };

describe('mérőműszerek', () => {
  it('feszültség, áram és lábáram a csíkos példán (akku, ellenállás, LED)', () => {
    const D = load('strip'), { A, SIM } = simulateFor(D);
    const r1a = at(A, 'R1', '1'), r1b = at(A, 'R1', '2');
    const va = readMeter(D, A, SIM, { mode: 'V', red: r1a, black: null }), vb = readMeter(D, A, SIM, { mode: 'V', red: r1b, black: null });
    expect(va.status).toBe('ok'); expect(vb.status).toBe('ok');
    const hi = Math.max(va.value!, vb.value!), lo = Math.min(va.value!, vb.value!);
    expect(hi).toBeGreaterThan(3.5);
    // a két láb közti feszültség (piros–fekete) = ellenálláson eső
    const drop = readMeter(D, A, SIM, { mode: 'V', red: va.value! > vb.value! ? r1a : r1b, black: va.value! > vb.value! ? r1b : r1a }).value!;
    expect(drop).toBeCloseTo(hi - lo, 6);
    const led = SIM.leds[0].I;
    expect(led).toBeGreaterThan(1e-3);
    // az ellenállás lábán befolyó áram = a LED árama (az egyik lábon be, a másikon ki)
    const ia = readMeter(D, A, SIM, { mode: 'A', red: r1a, black: null }), ib = readMeter(D, A, SIM, { mode: 'A', red: r1b, black: null });
    expect(Math.abs(ia.value!)).toBeCloseTo(led, 6);
    expect(ia.value! + ib.value!).toBeCloseTo(0, 9);
    expect(ia.pin).toMatch(/^R1\./);
    expect(fmtReading({ mode: 'A', value: 0.0124, status: 'ok' })).toBe('12.4mA');
    expect(probeVoltage(D, A, SIM, r1a)).toBeCloseTo(va.value!, 9);
    // szimuláció nélkül V/A nincs, R/C van
    expect(readMeter(D, A, null, { mode: 'V', red: r1a, black: null }).status).toBe('nosim');
  });

  it('ellenállás és szakadás a táp nélküli áramkörön', () => {
    const D = load('strip'), A = analyze(D);
    const r1a = at(A, 'R1', '1'), r1b = at(A, 'R1', '2');
    expect(resistance(D, A, A.find(A.sid(...r1a)), A.find(A.sid(...r1b)))).toBeCloseTo(330, 3);
    const r = readMeter(D, A, null, { mode: 'R', red: r1a, black: r1b });
    expect(r.value).toBeCloseTo(330, 3);
    expect(fmtReading(r)).toBe('330Ω');
    const c = readMeter(D, A, null, { mode: 'C', red: r1a, black: r1a });
    expect(c).toMatchObject({ value: 0, cont: true });
    // két nem összekötött pont: nyitott
    const free: ProbeAt = [D.board.rows - 1, D.board.cols - 1];
    expect(readMeter(D, A, null, { mode: 'R', red: free, black: r1a }).status).toBe('open');
    expect(gndNet(A)).not.toBeNull();
  });

  it('agent: measure eszköz', async () => {
    const ctx = engineCtx(load('strip'));
    const v = (await runTool(ctx, 'measure', { kind: 'voltage', at: 'R1.1' })).text;
    expect(v).toMatch(/V/);
    const i = (await runTool(ctx, 'measure', { kind: 'current', at: 'R1.1' })).text;
    expect(i).toMatch(/mA/);
    const r = (await runTool(ctx, 'measure', { kind: 'resistance', at: 'R1.1', to: 'R1.2' })).text;
    expect(r).toMatch(/330/);
  });
});

describe('áramfelvétel', () => {
  it('csíkos példa (akku): a forrás leadott teljesítménye = a fogyasztók felvett teljesítménye', async () => {
    const { powerSummary, batteryHours } = await import('../../src/engine/measure');
    const D = load('strip'), { A, SIM } = simulateFor(D), s = powerSummary(D, A, SIM);
    expect(s.sources).toHaveLength(1);
    expect(s.sources[0]).toMatchObject({ label: 'BT1', kind: 'battery' });
    expect(s.sources[0].I).toBeCloseTo(SIM.leds[0].I, 6);
    expect(s.parts.map(p => p.label).sort()).toEqual(['LED1', 'R1']);
    expect(s.parts.reduce((t, p) => t + p.P, 0)).toBeCloseTo(s.P, 4);
    expect(batteryHours(1000, 0.01)).toBe(100);
    expect(batteryHours(1000, 0)).toBeNull();
  });

  it('ESP32 USB-ről: a forrás az USB, a LED fogyaszt', async () => {
    const { powerSummary } = await import('../../src/engine/measure');
    const D = load('esp32'), { A, SIM } = simulateFor(D), s = powerSummary(D, A, SIM);
    expect(s.sources.map(x => x.kind)).toContain('usb');
    expect(s.parts.some(p => p.label === 'LED1')).toBe(true);
    expect(s.I).toBeGreaterThan(0);
  });
});

describe('agent: idővonal szondákkal, áramfelvétel', () => {
  it('run_program szondákkal program nélkül is; get_power', async () => {
    const ctx = engineCtx(load('strip'));
    const t = (await runTool(ctx, 'run_program', { ms: 100, probes: ['R1.1', 'R1.2'] })).text;
    expect(t.split('\n')[0]).toContain('V(R1.1)');
    expect(t).toMatch(/\d\.\d\d/);
    expect((await runTool(ctx, 'run_program', { ms: 100, probes: ['X9.9'] })).text).toMatch(/Unknown probe point/);
    const p = (await runTool(ctx, 'get_power', { battery_mah: 1000 })).text;
    expect(p).toMatch(/source BT1 \(battery\)/);
    expect(p).toMatch(/Battery life/);
  });
});
