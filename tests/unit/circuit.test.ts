import { describe, expect, it } from 'vitest';
import { addModelToGraph, canConnect, connect, dropUnused, graphToLogic, graphToModel, setPortExpr, logicToGraph, portsOf, pruneEdges, removeNode, type CGraph } from '../../src/core/circuit';
import { evalExpr, parseExpr } from '../../src/core/logic';

const pins = [{ id: '1', name: 'GND' }, { id: '2', name: 'VCC' }, { id: '3', name: 'A' }, { id: '4', name: 'B' }, { id: '5', name: 'Y' }, { id: '6', name: 'Q' }];
const ev = (src: string, env: Record<string, 0 | 1>) => evalExpr(parseExpr(src), n => env[n] ?? 'X');

describe('belső kapcsolás: diagram ↔ kifejezés', () => {
  it('NAND a diagramból', () => {
    const g: CGraph = {
      nodes: [{ id: 'i1', k: 'in', pin: '3', x: 0, y: 0 }, { id: 'i2', k: 'in', pin: '4', x: 0, y: 0 }, { id: 'g1', k: 'gate', g: 'nand', n: 2, x: 0, y: 0 }, { id: 'o1', k: 'out', pin: '5', x: 0, y: 0 }],
      edges: [{ from: 'i1', to: 'g1', port: 'i0' }, { from: 'i2', to: 'g1', port: 'i1' }, { from: 'g1', to: 'o1', port: 'v' }],
    };
    const r = graphToLogic(g, pins);
    expect(r.problems).toEqual([]);
    expect(r.outs).toEqual([{ pin: '5', expr: '!(A & B)', oe: '', type: 'pp' }]);
  });

  it('bekötetlen kapubemenet és kapukör hiba; a hiányzó kimeneti érték üres kifejezés', () => {
    const g: CGraph = {
      nodes: [{ id: 'g1', k: 'gate', g: 'and', n: 2, x: 0, y: 0 }, { id: 'g2', k: 'gate', g: 'not', x: 0, y: 0 }, { id: 'o1', k: 'out', pin: '5', x: 0, y: 0 }, { id: 'o2', k: 'out', pin: '6', x: 0, y: 0 }],
      edges: [{ from: 'g2', to: 'g1', port: 'i0' }, { from: 'g1', to: 'g2', port: 'i0' }, { from: 'g1', to: 'o1', port: 'v' }],
    };
    const r = graphToLogic(g, pins);
    expect(r.problems.map(p => p.msg).join(' | ')).toMatch(/kör/);
    expect(r.problems.map(p => p.msg).join(' | ')).toMatch(/2\. bemenete nincs bekötve/);
    expect(r.outs[1].expr).toBe('');
  });

  it('tároló: a neve a hivatkozás, a bemenetei kifejezések', () => {
    const g: CGraph = {
      nodes: [{ id: 'i1', k: 'in', pin: '3', x: 0, y: 0 }, { id: 'i2', k: 'in', pin: '4', x: 0, y: 0 }, { id: 'r1', k: 'reg', name: 'F1', edge: 'fall', x: 0, y: 0 }, { id: 'o1', k: 'out', pin: '6', od: true, x: 0, y: 0 }],
      edges: [{ from: 'i1', to: 'r1', port: 'd' }, { from: 'i2', to: 'r1', port: 'clk' }, { from: 'r1', to: 'o1', port: 'v' }],
    };
    const r = graphToLogic(g, pins);
    expect(r.regs).toEqual([{ name: 'F1', clk: 'B', d: 'A', edge: 'fall', reset: '', set: '' }]);
    expect(r.outs).toEqual([{ pin: '6', expr: 'F1', oe: '', type: 'od' }]);
  });

  it('nem egyértelmű vagy nem azonosító lábnév: #azonosító', () => {
    const ps = [{ id: '1', name: 'A' }, { id: '2', name: 'A' }, { id: '3', name: '5V' }, { id: '4', name: 'Y' }];
    const g: CGraph = { nodes: [{ id: 'i1', k: 'in', pin: '2', x: 0, y: 0 }, { id: 'i2', k: 'in', pin: '3', x: 0, y: 0 }, { id: 'g', k: 'gate', g: 'or', n: 2, x: 0, y: 0 }, { id: 'o', k: 'out', pin: '4', x: 0, y: 0 }],
      edges: [{ from: 'i1', to: 'g', port: 'i0' }, { from: 'i2', to: 'g', port: 'i1' }, { from: 'g', to: 'o', port: 'v' }] };
    expect(graphToLogic(g, ps).outs[0].expr).toBe('#2 | #3');
  });

  it('kifejezésből diagram és vissza: ugyanaz a logika, lábanként egy bemenet', () => {
    const L = { outs: [{ pin: '5', expr: 'A & !B | !A & B', oe: '!Q', type: 'pp' as const }] };
    const g = logicToGraph(L, pins);
    expect(g.nodes.filter(n => n.k === 'in').length).toBe(3);
    const back = graphToLogic(g, pins).outs[0];
    for (const A of [0, 1] as const) for (const B of [0, 1] as const) expect(ev(back.expr, { A, B })).toBe(ev(L.outs[0].expr, { A, B }));
    expect(back.oe).toBe('!Q');
    // a bemenetek balra, a kimenet jobbra
    const xs = (k: string) => g.nodes.filter(n => n.k === k).map(n => n.x);
    expect(Math.max(...xs('in'))).toBeLessThan(Math.min(...xs('out')));
  });

  it('kifejezésből diagram: tárolóra hivatkozás, és az előző diagram helyei megmaradnak', () => {
    const L = { outs: [{ pin: '6', expr: 'MEM', oe: '', type: 'pp' as const }], regs: [{ name: 'MEM', clk: 'B', d: 'A', edge: 'rise' as const, reset: '', set: '' }] };
    const g1 = logicToGraph(L, pins);
    const out = g1.nodes.find(n => n.k === 'out')!; out.x = 999; out.y = 7;
    const g2 = logicToGraph(L, pins, g1);
    expect(g2.nodes.find(n => n.k === 'out')).toMatchObject({ x: 999, y: 7 });
    const r = graphToLogic(g2, pins);
    expect(r.regs[0]).toMatchObject({ name: 'MEM', d: 'A', clk: 'B' });
    expect(r.outs[0].expr).toBe('MEM');
  });

  it('élek: egy bemenetre egy él; kevesebb kapubemenetnél a fölösleges él kiesik; törléssel az élei is', () => {
    let g: CGraph = { nodes: [{ id: 'a', k: 'in', pin: '3', x: 0, y: 0 }, { id: 'b', k: 'in', pin: '4', x: 0, y: 0 }, { id: 'g', k: 'gate', g: 'and', n: 3, x: 0, y: 0 }], edges: [] };
    g = connect(g, 'a', 'g', 'i0'); g = connect(g, 'b', 'g', 'i0'); g = connect(g, 'a', 'g', 'i2');
    expect(g.edges).toEqual([{ from: 'b', to: 'g', port: 'i0' }, { from: 'a', to: 'g', port: 'i2' }]);
    g.nodes[2].n = 2; g = pruneEdges(g);
    expect(g.edges).toEqual([{ from: 'b', to: 'g', port: 'i0' }]);
    expect(removeNode(g, 'b').edges).toEqual([]);
    expect(portsOf({ id: 'x', k: 'gate', g: 'not', x: 0, y: 0 }).ins.length).toBe(1);
  });

  it('kimenet kifejezésből: a régi kapuk eltűnnek, a bemenetek újrahasznosulnak, hibás névre hiba', () => {
    let g = logicToGraph({ outs: [{ pin: '5', expr: 'A & B', oe: '', type: 'pp' }] }, pins);
    const o = g.nodes.find(n => n.k === 'out')!.id, inA = g.nodes.find(n => n.k === 'in' && n.pin === '3')!.id;
    g = setPortExpr(g, o, 'v', '!(A | Q)', pins);
    expect(g.nodes.filter(n => n.k === 'gate').map(n => n.g)).toEqual(['nor']);
    expect(g.nodes.find(n => n.k === 'in' && n.pin === '3')!.id).toBe(inA);
    expect(graphToLogic(g, pins).outs[0].expr).toBe('!(A | Q)');
    expect(() => setPortExpr(g, o, 'v', 'A & X9', pins)).toThrow(/X9/);
    expect(() => setPortExpr(g, o, 'v', 'A &', pins)).toThrow();
    expect(graphToLogic(setPortExpr(g, o, 'v', '', pins), pins).outs[0].expr).toBe('');
    expect(dropUnused(g)).toEqual(g);
  });

  it('bemenet láb nélkül: hiba, a kifejezésbe 0 kerül', () => {
    const g: CGraph = { nodes: [{ id: 'i', k: 'in', x: 0, y: 0 }, { id: 'o', k: 'out', pin: '5', x: 0, y: 0 }], edges: [{ from: 'i', to: 'o', port: 'v' }] };
    const r = graphToLogic(g, pins);
    expect(r.problems[0].msg).toMatch(/nincs láb/);
    expect(r.outs[0].expr).toBe('0');
  });

  it('villamos elemek és nyomógomb: a régi leírásból a diagramra és vissza; a lábak csomópontjai közösek', () => {
    const rows = [{ el: 'resistor' as const, pins: ['3', '4'], vals: ['4.7k'] }, { el: 'diode' as const, pins: ['4', '1'], vals: ['0.7'] }];
    const g = addModelToGraph(logicToGraph({ outs: [{ pin: '5', expr: 'A', oe: '', type: 'pp' }] }, pins), rows, ['3', '1']);
    expect(g.nodes.filter(n => n.k === 'in').map(n => n.pin).sort()).toEqual(['1', '3', '4']); // az A láb a logikával közös
    const m = graphToModel(g);
    expect(m.model).toEqual(rows);
    expect(m.press).toEqual(['3', '1']);
    expect(m.problems).toEqual([]);
    expect(graphToLogic(g, pins).outs[0].expr).toBe('A'); // a villamos élek a logikát nem zavarják
  });

  it('villamos elem kivezetése csak lábhoz köthető; a félig bekötött nyomógomb hiba', () => {
    const g: CGraph = { nodes: [{ id: 'i', k: 'in', pin: '3', x: 0, y: 0 }, { id: 'n', k: 'gate', g: 'not', x: 0, y: 0 }, { id: 'e', k: 'el', el: 'resistor', vals: ['1k'], x: 0, y: 0 }, { id: 'p', k: 'press', x: 0, y: 0 }, { id: 'o', k: 'out', pin: '5', x: 0, y: 0 }], edges: [{ from: 'i', to: 'p', port: 'a' }] };
    expect(canConnect(g, 'i', 'e')).toBeNull();
    expect(canConnect(g, 'n', 'e')).toMatch(/csak lábhoz/);
    expect(canConnect(g, 'o', 'n')).toMatch(/nincs kimenete/);
    const m = graphToModel(g);
    expect(m.press).toBeNull();
    expect(m.problems[0].msg).toMatch(/Nyomógomb/);
    expect(m.model).toEqual([{ el: 'resistor', pins: ['', ''], vals: ['1k'] }]);
  });
});
