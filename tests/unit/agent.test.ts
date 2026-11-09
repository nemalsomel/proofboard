import { describe, expect, it } from 'vitest';
import { emptyDesign } from '../../src/engine/design';
import { engineCtx, partOf, pinOf, runTool, summarize, toolSpecs, TOOLS } from '../../src/agent/tools';
import { systemPrompt } from '../../src/agent/prompt';

const call = (ctx: ReturnType<typeof engineCtx>, name: string, input: Record<string, unknown> = {}) => runTool(ctx, name, input);

describe('agent-eszközök', () => {
  it('eszközleírások: egyedi név, objektumséma, a kötelező mezők a tulajdonságok között; Megbeszélés módban csak olvasók', () => {
    const names = TOOLS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.input_schema.type).toBe('object');
      for (const r of t.input_schema.required || []) expect(Object.keys(t.input_schema.properties || {})).toContain(r);
      expect(t.description.length).toBeGreaterThan(20);
    }
    const ro = toolSpecs('discuss').map(t => t.name);
    expect(ro).toContain('get_design'); expect(ro).toContain('simulate');
    expect(ro).not.toContain('place_part'); expect(ro).not.toContain('connect');
    expect(toolSpecs('build').length).toBe(TOOLS.length);
  });

  it('egy LED-es kör csak eszközhívásokkal: lerakás, bekötés, útvonal, ellenőrzés, szimuláció', async () => {
    const ctx = engineCtx(emptyDesign());
    let r = await call(ctx, 'list_part_types', { query: 'pico' });
    expect(r.text).toMatch(/^pico: /m);
    r = await call(ctx, 'place_part', { type: 'pico', row: 2, col: 2 });
    expect(r.isError).toBeFalsy(); expect(r.changed).toBe(true);
    r = await call(ctx, 'place_part', { type: 'res', params: { ohm: 330 }, near_row: 40, near_col: 30 });
    expect(r.text).toMatch(/^Placed R1/);
    r = await call(ctx, 'place_part', { type: 'led', near_row: 50, near_col: 30 });
    expect(r.text).toMatch(/^Placed LED1/);
    // a lábak címkével és névvel is elérhetők
    expect(pinOf(ctx.D(), 'r1.2')).not.toBeNull();
    expect(pinOf(ctx.D(), 'PICO1.GP15')).not.toBeNull();
    for (const [from, to] of [['PICO1.GP15', 'R1.1'], ['R1.2', 'LED1.A'], ['LED1.K', 'GND']]) {
      r = await call(ctx, 'connect', { from, to });
      expect(r.isError, r.text).toBeFalsy();
    }
    expect(ctx.D().links.length).toBe(3);
    expect(ctx.D().auto.bridges.length + ctx.D().auto.wires.length).toBeGreaterThan(0); // az automatikus útvonal lefutott
    r = await call(ctx, 'set_gpio_mode', { pin: 'GP15', mode: 'out_high' });
    expect(r.isError, r.text).toBeFalsy();
    r = await call(ctx, 'simulate');
    expect(r.text).toMatch(/LED1: [\d.]+ mA, lit/);
    const sum = summarize(ctx.D());
    expect(sum).toMatch(/Parts \(3\)/);
    expect(sum).toMatch(/R1: .*ohm=330/);
    expect(sum).toMatch(/PICO1\.GP15 → R1\.1: via/);
  });

  it('hibás bemenet: érthető hibaüzenet, a terv változatlan', async () => {
    const ctx = engineCtx(emptyDesign());
    await call(ctx, 'place_part', { type: 'res', row: 10, col: 10 });
    const snap = JSON.stringify(ctx.D());
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['place_part', { type: 'nincs' }, /Unknown part type/],
      ['place_part', { type: 'res', row: 10, col: 10 }, /overlap R1/],
      ['place_part', { type: 'res', row: -30, col: 5 }, /Does not fit/],
      ['place_part', { type: 'res', params: { ohm: 'sok' } }, /must be a number/],
      ['place_part', { type: 'res', params: { szin: 1 } }, /has no parameter "szin"/],
      ['connect', { from: 'R9.1', to: 'GND' }, /Unknown pin/],
      ['connect', { from: 'R1.1', to: 'R1.1' }, /cannot connect to itself/],
      ['remove_parts', { labels: ['X1'] }, /Unknown label/],
      ['set_gpio_mode', { pin: 'GP15', mode: 'out_high' }, /No GPIO named/],
      ['simulate', { pressed: ['R1'] }, /not a button/],
      ['connect', {}, /Missing required input "from"/],
      ['nincs_ilyen', {}, /Unknown tool/],
    ];
    for (const [n, inp, re] of cases) {
      const r = await call(ctx, n, inp);
      expect(r.isError, n + ' ' + JSON.stringify(inp)).toBe(true);
      expect(r.text).toMatch(re);
    }
    expect(JSON.stringify(ctx.D())).toBe(snap);
  });

  it('mozgatás, paraméter, kapcsolat törlése, alkatrész törlése', async () => {
    const ctx = engineCtx(emptyDesign());
    await call(ctx, 'place_part', { type: 'res', row: 10, col: 10 });
    await call(ctx, 'place_part', { type: 'led', row: 10, col: 20 });
    let r = await call(ctx, 'move_part', { label: 'R1', row: 14, rotation: 90 });
    expect(r.isError, r.text).toBeFalsy();
    expect([partOf(ctx.D(), 'R1')!.r, partOf(ctx.D(), 'R1')!.rot]).toEqual([14, 1]);
    r = await call(ctx, 'set_params', { label: 'R1', params: { ohm: 1000 } });
    expect(r.text).toMatch(/ohm=1000/);
    await call(ctx, 'connect', { from: 'R1.2', to: 'LED1.A' });
    await call(ctx, 'connect', { from: 'LED1.K', to: 'GND' });
    r = await call(ctx, 'disconnect', { from: 'LED1.A' });
    expect(r.text).toMatch(/Removed 1/);
    r = await call(ctx, 'remove_parts', { labels: ['LED1'] });
    expect(ctx.D().parts.map(p => p.label)).toEqual(['R1']);
    expect(ctx.D().links).toEqual([]);
  });

  it('külső alkatrész: a csatlakozó automatikusan; új terv; panelkép csak ha a gazda tud rajzolni', async () => {
    const ctx = engineCtx(emptyDesign());
    const r = await call(ctx, 'place_part', { type: 'servo' });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/plugged into header/);
    expect((await call(ctx, 'get_board_image')).isError).toBe(true);
    const ctx2 = engineCtx(emptyDesign(), { snapshot: () => 'AAAA' });
    expect((await call(ctx2, 'get_board_image')).image).toBe('AAAA');
    await call(ctx, 'new_design', { rows: 20, cols: 30, section: 1 });
    expect(ctx.D().board).toEqual({ rows: 20, cols: 30, sec: 1 });
    expect(ctx.D().parts).toEqual([]);
  });

  it('elhelyezés a csíkok szerint: az automatikus nem zár rövidre és nem köt idegen lábhoz; a kézi figyelmeztet', async () => {
    const ctx = engineCtx(emptyDesign()); // 3 soros szakaszok, függőleges csíkok
    let r = await call(ctx, 'place_part', { type: 'button', near_row: 30, near_col: 30 });
    expect(r.text).not.toMatch(/Warning/);
    expect((await call(ctx, 'get_problems')).text).not.toMatch(/rövidre zárt/);
    r = await call(ctx, 'place_part', { type: 'res', near_row: 30, near_col: 30 });
    expect(r.text).not.toMatch(/Warning/);
    // kézzel: a gomb két oldala egy csíkszakaszba esik → figyelmeztetés
    r = await call(ctx, 'place_part', { type: 'button', row: 60, col: 5 });
    expect(r.text).toMatch(/Warning: S2\.[AB]\d and S2\.[AB]\d share a strip section \(shorted\)/);
    // kézzel: a LED anódja az ellenállás lábával közös szakaszba
    await call(ctx, 'place_part', { type: 'res', row: 69, col: 10, label: 'R5' }); // lábak: 69,10 és 69,14
    r = await call(ctx, 'place_part', { type: 'led', row: 70, col: 14 });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/Warning: LED1\.A shares a strip section with R5\.2/);
  });

  it('rendszerprompt: mód és nyelv szerint, a terv összefoglalójával', () => {
    const d = systemPrompt({ mode: 'discuss', lang: 'hu', summary: 'Board: X' });
    expect(d).toMatch(/Mode: Discuss/); expect(d).toMatch(/Reply in Hungarian/); expect(d).toMatch(/Board: X/);
    const b = systemPrompt({ mode: 'build', lang: 'en' });
    expect(b).toMatch(/Mode: Build/); expect(b).toMatch(/ask for confirmation/); expect(b).toMatch(/Reply in English/);
  });
});
