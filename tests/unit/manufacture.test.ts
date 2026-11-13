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
