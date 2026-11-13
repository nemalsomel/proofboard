import { describe, expect, it } from 'vitest';
import { engineCtx, runTool } from '../../src/agent/tools';
import { emptyDesign, normalize } from '../../src/engine/design';
import { assembly, bom, bomCsv, boardKind, boardMm, marks, partValue } from '../../src/engine/manufacture';
import { sheetSvg } from '../../src/engine/mfgsheet';
import { route } from '../../src/engine/route';
import * as OPS from '../../src/engine/ops';
import { printHtml } from '../../src/ui/mfgprint';
import { EXAMPLES } from '../../src/ui/examples';

/** Példa betöltése úgy, ahogy az app teszi (útvonalkereséssel). */
function load(id: string) {
  const raw = JSON.parse(JSON.stringify(EXAMPLES.find(e => e.id === id)!.design));
  const D = normalize({ ...raw, bridges: raw.bridges || [], wires: raw.wires || [], auto: { bridges: [], wires: [] }, notes: [], settings: { usb: true, btnMode: 'hold', autoRoute: true },
    links: (raw.links || []).map(([a, b]: [string, string], i: number) => ({ id: 'l' + i, a, b, gpio: null })) });
  route(D, { full: true });
  return D;
}

describe('gyártás: anyaglista', () => {
  it('a csíkos példa: panel, alkatrészek értékkel, vágások és hidak', () => {
    const D = load('strip');
    expect(boardKind(D)).toBe('strip');
    expect(boardMm(D)).toEqual({ w: 66.04, h: 53.34 });
    const b = bom(D);
    expect(b.rows.map(r => [r.qty, r.labels.join(','), r.value])).toEqual([[1, 'BT1', '3.7V'], [1, 'LED1', 'sárga'], [1, 'R1', '330Ω']]);
    expect(b.extra.cuts).toBe(3);
    expect(b.extra.bridges).toBe(3);
    expect(bomCsv(D).split('\n')[0]).toContain(';');
  });

  it('azonos típus és érték egy sorba kerül, a jelölések természetes sorrendben', () => {
    const D = emptyDesign();
    for (const [r, c] of [[2, 2], [2, 10], [2, 18]]) OPS.placePart(D, 'res', r, c, { props: { ohm: 1000 } });
    OPS.placePart(D, 'res', 10, 2, { props: { ohm: 220 } });
    const rows = bom(D).rows;
    expect(rows.map(r => [r.qty, r.labels.join(','), partValue(D.parts.find(p => p.label === r.labels[0])!)])).toEqual([[3, 'R1,R2,R3', '1kΩ'], [1, 'R4', '220Ω']]);
  });
});

describe('gyártás: jelölések és beültetési sorrend', () => {
  it('vágások X1…, hídláncok H1…, vezetékek V1… mm-ben', () => {
    const D = load('strip'), m = marks(D);
    expect(m.cuts.map(x => x.n)).toEqual(['X1', 'X2', 'X3']);
    expect(m.chains.length).toBe(3);
    expect(m.chains[0].n).toBe('H1');
    D.wires.push({ a: [0, 0], b: [0, 10], color: '#e03131' });
    const w = marks(D).wires;
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ n: 'V1', mm: 25.4 });
  });

  it('lépések: panel → vágások → alacsonytól a magasig → hidak → ellenőrzés; minden tétel kulcsa egyedi', () => {
    const D = load('strip'), st = assembly(D);
    expect(st.map(s => s.id)).toEqual(['board', 'cuts', 'parts:low', 'parts:small', 'parts:conn', 'bridges', 'check']);
    expect(st.find(s => s.id === 'cuts')!.side).toBe('cu');
    const keys = st.flatMap(s => s.items.map(i => i.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('nagy terv (ESP32): a vezérlőlap a modulok között, a végén', () => {
    const D = load('esp32');
    const ids = assembly(D).map(s => s.id);
    expect(ids.indexOf('parts:module')).toBeGreaterThan(ids.indexOf('parts:low'));
    expect(ids.at(-1)).toBe('check');
  });
});

describe('gyártás: lapok', () => {
  it('SVG milliméterben, a rézoldal tükrözve, a jelölések rajta; kiemeléskor a többi halvány', () => {
    const D = load('strip');
    const comp = sheetSvg(D, { side: 'comp' }), cu = sheetSvg(D, { side: 'cu' });
    expect(comp.svg).toMatch(/^<svg [^>]*width="[\d.]+mm"/);
    expect(comp.w).toBeGreaterThan(66);
    expect(cu.svg).toContain('>X1<');
    expect(cu.svg).toContain('>H1<');
    expect(comp.svg).not.toContain('>X1<');
    expect(sheetSvg(D, { side: 'cu', hi: new Set(['X1']) }).svg).toContain('opacity="0.22"');
  });

  it('nyomtatás: A4-es lapok, a kiválasztott tartalom', () => {
    const D = load('strip');
    const all = printHtml(D, { comp: true, cu: true, bom: true, steps: true, title: 'Teszt', lang: 'hu' }, (s, p) => p ? s.replace(/\{(\w+)\}/g, (m, k: string) => String(p[k] ?? m)) : s);
    expect(all.match(/<section class="page/g)).toHaveLength(4);
    expect(all).toContain('@page');
    const only = printHtml(D, { comp: false, cu: false, bom: true, steps: false, title: 'T', lang: 'hu' }, s => s);
    expect(only.match(/<section class="page/g)).toHaveLength(1);
  });
});

describe('gyártás: agent', () => {
  it('get_manufacturing: angol anyaglista és lépések', async () => {
    const ctx = engineCtx(load('strip'));
    const r = await runTool(ctx, 'get_manufacturing', {});
    expect(r.text).toContain('Bill of materials');
    expect(r.text).toContain('330Ω');
    expect(r.text).toMatch(/X1 strip of column/);
    const b = await runTool(ctx, 'get_manufacturing', { part: 'bom' });
    expect(b.text).not.toContain('Assembly order');
  });
});

describe('gyártás: méretrajz', () => {
  it('elemek: mm-ben, origó a bal alsó sarok; kívülről fontos alapból; az USB kiemelt pont', async () => {
    const { dimItems, holeMm, shownItems } = await import('../../src/engine/dimension');
    const D = load('esp32');
    expect(holeMm(D, D.board.rows - 1, 0)).toEqual({ x: 1.27, y: 1.27 });
    const it = dimItems(D), by = (l: string) => it.find(i => i.label === l)!;
    expect(by('R1').def).toBe(false);
    expect(by('SW1').def).toBe(true);
    const usb = by('ESP1 USB');
    expect(usb).toMatchObject({ feature: 'USB', w: 0, def: true });
    // a vezérlőlap szélén (a csatlakozó kicsit kilóghat a lapból)
    const esp = by('ESP1');
    expect(Math.min(Math.abs(usb.x - (esp.x - esp.w / 2)), Math.abs(usb.x - (esp.x + esp.w / 2)))).toBeLessThan(2);
    const on = shownItems(it, ['+' + by('R1').id, '-' + by('SW1').id]);
    expect(on.has(by('R1').id)).toBe(true);
    expect(on.has(by('SW1').id)).toBe(false);
  });

  it('SVG: körvonal-méretek és koordináták; kikapcsolt elem nem méretezett', async () => {
    const { dimItems, dimSvg } = await import('../../src/engine/dimension');
    const D = load('esp32'), sw = dimItems(D).find(i => i.label === 'SW1')!;
    const all = dimSvg(D).svg;
    expect(all).toContain('>99.1<');
    expect(all).toContain('>121.9<');
    expect(all).toContain(`>${sw.x.toFixed(1)}<`);
    const none = dimSvg(D, { show: new Set() }).svg;
    expect(none).not.toContain(`>${sw.x.toFixed(1)}<`);
  });

  it('DXF: R12, mm, rétegek; a panel körvonala 4 vonal', async () => {
    const { dimDxf } = await import('../../src/engine/dimension');
    const dxf = dimDxf(load('strip'));
    expect(dxf).toContain('AC1009');
    expect(dxf).toMatch(/\$INSUNITS\n70\n4/);
    expect(dxf.match(/^LINE\n8\nBOARD$/gm)).toHaveLength(4);
    expect(dxf.trim().endsWith('EOF')).toBe(true);
  });

  it('agent: get_dimensions táblázat és DXF', async () => {
    const ctx = engineCtx(load('esp32'));
    const t = (await runTool(ctx, 'get_dimensions', {})).text;
    expect(t).toContain('Board outline: 99.1 × 121.9 mm');
    expect(t).toMatch(/ESP1 USB \| USB \(feature point\)/);
    expect((await runTool(ctx, 'get_dimensions', { format: 'dxf' })).text).toContain('ENTITIES');
  });
});

describe('gyártás: magasság, rögzítőfurat', () => {
  it('magasság a leírásból (meta.h), valós méret (meta.size) elforgatva; a legmagasabb', async () => {
    const { dimItems, maxHeight } = await import('../../src/engine/dimension');
    const D = load('esp32'), it = dimItems(D), by = (l: string) => it.find(i => i.label === l)!;
    expect(by('SW1')).toMatchObject({ w: 12, h: 12, z: 7.3 });
    const esp = by('ESP1'), rot = D.parts.find(p => p.label === 'ESP1')!.rot;
    expect([esp.w, esp.h]).toEqual(rot & 1 ? [28.3, 51.5] : [51.5, 28.3]);
    expect(maxHeight(D)).toEqual({ z: 32, label: 'JS1' });
  });

  it('rögzítőfurat: anyaglistában, a panel előkészítésében, a méretrajzon körként; ütközés a csavarfejjel', async () => {
    const { dimItems, dimSvg, dimDxf } = await import('../../src/engine/dimension');
    const { checkAll } = await import('../../src/engine/check');
    const { analyze } = await import('../../src/engine/netlist');
    const D = load('strip');
    const mh = OPS.placePart(D, 'mhole', 1, 24)!;
    expect(mh).toBeTruthy();
    expect(mh.label).toBe('MH1');
    expect(bom(D).rows.find(r => r.labels[0] === 'MH1')).toMatchObject({ value: 'M3 (⌀3,2 mm furat)', note: 'csavar, anya vagy távtartó' });
    const prep = assembly(D)[0];
    expect(prep.items.map(i => i.text)).toContain('⌀3.2 mm rögzítőfurat a 1:24 lyuknál');
    expect(assembly(D).some(s => s.items.some(i => i.key === 'part:' + mh.id && s.id !== 'board'))).toBe(false);
    const it = dimItems(D).find(i => i.label === 'MH1')!;
    expect(it).toMatchObject({ drill: 3.2, head: 6.5, def: true, z: 0 });
    expect(dimSvg(D).svg).toContain('MH1 ⌀3.2');
    expect(dimDxf(D)).toMatch(/CIRCLE\n8\nHOLES/);
    const ctx = (d: typeof D) => ({ A0: analyze(d), AS: null, SIM: null, linkState: new Map() } as unknown as Parameters<typeof checkAll>[1]);
    expect(checkAll(D, ctx(D)).filter(x => x.msg.startsWith('MH1'))).toEqual([]);
    expect(OPS.placePart(D, 'led', 2, 24)).toBeTruthy();
    expect(checkAll(D, ctx(D)).some(x => /MH1: a csavarfej helyén/.test(x.msg))).toBe(true);
  });

  it('alkatrész-szerkesztő: a mechanikai adatok oda-vissza (meta.h, size, front; az USB helye átvitt)', async () => {
    const { defToForm, formToDef } = await import('../../src/core/partform');
    const { PARTS } = await import('../../src/parts/builtin');
    const feats = [{ name: 'USB', at: [1, -1] }];
    const f = defToForm({ ...PARTS.button, meta: { ...PARTS.button.meta, features: feats } }).form!;
    expect(f.mech).toMatchObject({ h: 7.3, w: 12, d: 12, front: true });
    f.mech!.h = 9;
    const m = formToDef(f).meta as Record<string, unknown>;
    expect(m).toMatchObject({ h: 9, size: [12, 12], front: true });
    expect(m.features).toEqual(feats);
  });
});
