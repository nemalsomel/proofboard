import { describe, expect, it } from 'vitest';
import { emptyDesign, normalize } from '../../src/engine/design';
import { defToForm } from '../../src/core/partform';
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

  it('projektjegyzet: az eszköz beírja, az összefoglaló elején látszik, mindkét módban használható; a terv megőrzi', async () => {
    const ctx = engineCtx(emptyDesign());
    expect(summarize(ctx.D())).toMatch(/^Project notes: none yet/);
    const r = await call(ctx, 'set_project_notes', { text: 'Cél: motorvezérlő ESP32-C3-mal.\n- Táp: 1S Li-ion' });
    expect(r.changed).toBe(true);
    expect(ctx.D().brief).toBe('Cél: motorvezérlő ESP32-C3-mal.\n- Táp: 1S Li-ion');
    expect(summarize(ctx.D())).toMatch(/^Project notes .*\nCél: motorvezérlő/);
    expect(TOOLS.find(t => t.name === 'set_project_notes')!.mutates).toBe(false);
    const n = normalize(JSON.parse(JSON.stringify({ ...ctx.D(), id: 'proj-1234' })));
    expect([n.id, n.brief]).toEqual(['proj-1234', ctx.D().brief]);
    expect(normalize({ ...emptyDesign(), id: 'rossz id!', brief: '  ' }).id).toBeUndefined();
    await call(ctx, 'set_project_notes', { text: '' });
    expect(ctx.D().brief).toBeUndefined();
  });
});

describe('saját alkatrész az agenttel', () => {
  it('leírás lekérése, módosított másolat mentése, lerakás; beépített nem írható felül; hibás leírás nem mentődik', async () => {
    const ctx = engineCtx(emptyDesign());
    const r0 = await call(ctx, 'get_part_definition', { type: 'res' });
    expect(r0.text).toMatch(/^res \(built-in/);
    const def = JSON.parse(r0.text.slice(r0.text.indexOf('\n') + 1));
    def.name = 'Ellenállás álló';
    let r = await call(ctx, 'save_custom_part', { definition: def, type: 'res' });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/built-in part and cannot be changed/);
    r = await call(ctx, 'save_custom_part', { definition: { ...def, pins: 'rossz' } });
    expect(r.isError).toBe(true); expect(r.text).toMatch(/has errors; nothing was saved/);
    expect(r.text).toMatch(/^The part has errors/);
    expect(Object.keys(ctx.D().customParts)).toEqual([]);
    r = await call(ctx, 'save_custom_part', { definition: def });
    expect(r.isError, r.text).toBeFalsy(); expect(r.changed).toBe(true);
    const key = /custom part "([^"]+)"/.exec(r.text)![1];
    expect(ctx.D().customParts[key].name).toBe('Ellenállás álló');
    r = await call(ctx, 'place_part', { type: key, row: 10, col: 10 });
    expect(r.isError, r.text).toBeFalsy();
    // frissítés kulccsal; a gazda menti (könyvtár)
    const saved: string[] = [];
    const ctx2 = engineCtx(ctx.D(), { saveCustomPart: (k, d) => { saved.push(k + ':' + d.name); ctx.D().customParts = { ...ctx.D().customParts, [k]: d }; } });
    r = await call(ctx2, 'save_custom_part', { type: key, definition: { ...def, name: 'Ellenállás álló 2' } });
    expect(r.text).toMatch(/^Updated custom part/); expect(saved).toEqual([key + ':Ellenállás álló 2']);
    expect((await call(ctx2, 'get_part_definition', { type: key })).text).toMatch(/custom part/);
  });
});

describe('saját alkatrész űrlapként (szerkeszthető a Lábak / Működés fülön)', () => {
  it('a beépített potméter űrlapja; mentés űrlapból: paraméterek, csúszka, kifejezéses értékek; a szerkesztő veszteség nélkül nyitja', async () => {
    const ctx = engineCtx(emptyDesign());
    expect((await call(ctx, 'get_part_schema')).text).toMatch(/Example – potentiometer/);
    const r0 = await call(ctx, 'get_part_form', { type: 'pot' });
    expect(r0.text).toMatch(/^pot as form \(not representable, would be lost: .*custom drawing elements/);
    const f = JSON.parse(r0.text.slice(r0.text.indexOf('\n') + 1));
    expect(f.params.map((p: { key: string; slider: boolean }) => [p.key, p.slider])).toEqual([['ohm', false], ['pos', true]]);
    expect(f.model[0].vals[0]).toBe('{ohm*pos/100+0.5}');
    f.name = 'Potméter 100k'; f.params[0].def = '100k';
    const r = await call(ctx, 'save_custom_part', { form: f });
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/Editable in the part editor/);
    const key = /custom part "([^"]+)"/.exec(r.text)![1], def = ctx.D().customParts[key];
    expect(def.params!.find(p => p.key === 'ohm')!.default).toBe(100000);
    expect(def.controls).toEqual([{ kind: 'slider', key: 'pos', label: 'Állás' }]);
    expect(def.model![1]).toMatchObject({ el: 'resistor', a: 'W', b: '3', ohm: '{ohm*(100-pos)/100+0.5}' });
    const back = defToForm(def);
    expect(back.lost).toEqual([]);
    expect((await call(ctx, 'place_part', { type: key, row: 10, col: 10 })).isError).toBeFalsy();
    // nyers leírás: ha az űrlap ki tudja fejezni, az is szerkeszthető lesz
    const r2 = await call(ctx, 'save_custom_part', { definition: { ...def, name: 'Másik potméter', meta: undefined } });
    expect(r2.text).toMatch(/Editable in the part editor/);
    expect((await call(ctx, 'save_custom_part', { form: { name: 'x' } })).text).toMatch(/form\.pins must be/);
  });
});
