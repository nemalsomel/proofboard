import { describe, expect, it } from 'vitest';
import { findPin, linkGeom, linkStates, ratTarget } from '../../src/engine/links';
import { analyze } from '../../src/engine/netlist';
import { autoCutOn, manualToAuto, route } from '../../src/engine/route';
import { linkStatusLine, linksViewHtml, targetSelectHtml } from '../../src/ui/links';
import { fmt } from '../../src/i18n/i18n';
import { DEFS } from '../../src/engine/defs';
import type { Design } from '../../src/engine/types';

const part = (id: string, type: string, label: string, r: number, c: number, props: Record<string, unknown> = {}, rot = 0) =>
  ({ id, type, label, r, c, rot, mir: false, props: { ...DEFS[type].props, ...props } });
const ledDesign = (sec = 3): Design => ({
  board: { rows: 21, cols: 26, sec }, bridges: [], wires: [], auto: { bridges: [], wires: [] }, customParts: {}, notes: [], gpio: {}, pwm: {}, seq: 10,
  settings: { usb: true, btnMode: 'hold', autoRoute: true },
  parts: [part('p1', 'bat', 'BT1', 4, 3, { volt: 3.7 }), part('p2', 'res', 'R1', 10, 3, { ohm: 330, dr: 0, dc: 4 }), part('p3', 'led', 'LED1', 16, 7, { color: 'green', dr: 0, dc: 1 })],
  links: [{ id: 'l1', a: 'p1.+', b: 'p2.1', gpio: null }, { id: 'l2', a: 'p2.2', b: 'p3.A', gpio: null }, { id: 'l3', a: 'p3.K', b: 'p1.-', gpio: null }],
});

describe('útvonalkereső', () => {
  it('hidakkal köti be a kapcsolatokat, vezeték nélkül', () => {
    const D = ledDesign();
    route(D, { full: true });
    expect(D.auto.wires).toEqual([]);
    expect(D.auto.bridges.length).toBeGreaterThan(0);
    expect([...linkStates(D, analyze(D)).values()].every(s => s.ok)).toBe(true);
  });
  it('csíkos panelen automatikusan vág, és így is bekötött', () => {
    const D = ledDesign(21);
    // mint a „Csíkos panel” példában: R1 és LED1 függőlegesen ugyanabban az oszlopban, mint az akku − pólusa
    D.parts = [part('p1', 'bat', 'BT1', 3, 3, { volt: 3.7 }), part('p2', 'res', 'R1', 9, 4, { ohm: 330, dr: 0, dc: 4 }, 1), part('p3', 'led', 'LED1', 15, 4, { color: 'yellow', dr: 0, dc: 1 }, 1)];
    expect(autoCutOn(D)).toBe(true);
    route(D, { full: true });
    expect((D.auto.cuts || []).length).toBeGreaterThan(0);
    expect([...linkStates(D, analyze(D)).values()].every(s => s.ok)).toBe(true);
  });
  it('kézi → automatikus: a rögzített hidakból újra kapcsolatok lesznek', () => {
    const D = ledDesign();
    route(D, { full: true });
    D.bridges = D.auto.bridges.map(b => [b[0], b[1], b[2], b[3]]);
    D.auto = { bridges: [], wires: [] };
    D.links = [];
    let called = 0;
    const n = manualToAuto(D, analyze(D), null, () => called++);
    expect(n).toBe(3);
    expect(called).toBe(1);
    expect(D.bridges).toEqual([]);
    expect([...linkStates(D, analyze(D)).values()].every(s => s.ok)).toBe(true);
  });
});

describe('kapcsolati geometria', () => {
  it('bekötés előtt: a kapcsolati vonal a forrásláb és a cél legközelebbi lába között; a kiemelés ugyanezt mutatja', () => {
    const D = ledDesign(), A = analyze(D), st = linkStates(D, A), l = D.links[1];
    const t = ratTarget(D, A, l, st.get(l.id));
    expect(t && t.id).toBe('A');
    const g = linkGeom(D, A, l, st.get(l.id))!;
    const a = findPin(D, 'p2.2')!;
    expect(g.start).toEqual([a.r, a.c]);
    expect(g.end).toEqual([t!.r, t!.c]);
    expect(g.bridges).toEqual([]);
  });
  it('bekötve: a saját hidak a kiemelésben, a végpont a túloldali láb', () => {
    const D = ledDesign(); route(D, { full: true });
    const A = analyze(D), st = linkStates(D, A), l = D.links[1], g = linkGeom(D, A, l, st.get(l.id))!;
    expect(g.bridges.length).toBeGreaterThan(0);
    expect(g.bridges.every(b => b[4].includes(l.id))).toBe(true);
    expect(g.endPin && g.endPin.part.id).toBe('p3');
    expect(linkGeom(D, A, null)).toBeNull();
  });
});

describe('Kapcsolatok panel', () => {
  it('lista, bekötöttség, összesítő; a kiemelt kapcsolatnál célválasztó', () => {
    const D = ledDesign(), A0 = analyze(D);
    let v = linksViewHtml(D, A0, linkStates(D, A0), null, fmt);
    expect(v.sum).toContain('0/3 bekötve');
    expect((v.list.match(/data-li=/g) || []).length).toBe(3);
    expect(v.list).not.toContain('lkTo');
    expect(v.total).toContain('Összesen');
    route(D, { full: true });
    const A = analyze(D), st = linkStates(D, A);
    v = linksViewHtml(D, A, st, 'l2', fmt);
    expect(v.sum).toContain('3/3 bekötve');
    expect(v.list).toContain('id="lkTo"');
    expect(v.total).toMatch(/<b>\d+<\/b> híd <span class="muted">\(auto\)/);
    const g = linkGeom(D, A, D.links[1], st.get('l2'))!;
    expect(linkStatusLine(D, D.links[1], g, fmt)).toMatch(/^R1\.2 → LED1\.A · kezdet \d+:\d+ → cél/);
    expect(linksViewHtml({ ...D, links: [] }, A, new Map(), null, fmt).list).toContain('Még nincs kapcsolat.');
  });
  it('célválasztó: GND, szabad GPIO, lábak; a már nem választható jelenlegi cél is szerepel', () => {
    const D = ledDesign(), A = analyze(D);
    const h = targetSelectHtml(D, A, 'data-x', 'p2.2', 'p9.1', 'p2', fmt);
    expect(h).toContain('value="GND"');
    expect(h).toContain('label="Jelenlegi"');
    expect(h).toContain('value="p9.1" selected');
    expect(h.startsWith('<select data-x="p2.2">')).toBe(true);
  });
});
