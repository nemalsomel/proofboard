import { describe, expect, it } from 'vitest';
import { evalExpr, fromGates, LogicError, minimize, parseExpr, printExpr, renameVars, toGates, truthRow, varsOf, type Level } from '../../src/core/logic';

const env = (m: Record<string, Level>) => (n: string) => m[n] ?? 'X';

describe('logikai kifejezés', () => {
  it('értelmez, precedencia: NOT > AND > XOR > OR; többféle írásmód', () => {
    expect(printExpr(parseExpr('A | B & !C ^ D'))).toBe('A | (B & !C) ^ D'.replace('(B & !C) ^ D', 'B & !C ^ D'));
    expect(printExpr(parseExpr('not (a AND b) or c'))).toBe('!(a & b) | c');
    expect(printExpr(parseExpr('~A*B + 1A0'))).toBe('!A & B | 1A0');
    expect(printExpr(parseExpr('#5 & 0'))).toBe('#5 & 0');
    expect(printExpr(parseExpr('(A & B) & C'))).toBe('A & B & C');
    expect(printExpr(parseExpr('!(A ^ B)'))).toBe('!(A ^ B)');
  });
  it('érthető hibák', () => {
    expect(() => parseExpr('A &')).toThrow('Hiányzó tag a kifejezés végén');
    expect(() => parseExpr('(A | B')).toThrow('Hiányzik a záró zárójel');
    expect(() => parseExpr('A $ B')).toThrow(LogicError);
    expect(() => parseExpr('  ')).toThrow('Üres kifejezés');
  });
  it('háromértékű kiértékelés', () => {
    const e = parseExpr('A & B');
    expect(evalExpr(e, env({ A: 0 }))).toBe(0); // B ismeretlen, de A=0 eldönti
    expect(evalExpr(e, env({ A: 1 }))).toBe('X');
    expect(evalExpr(parseExpr('A | B'), env({ B: 1 }))).toBe(1);
    expect(evalExpr(parseExpr('A ^ B ^ C'), env({ A: 1, B: 1, C: 1 }))).toBe(1);
  });
  it('változók és átnevezés a szöveg megtartásával', () => {
    expect(varsOf(parseExpr('!(E & A1) | A0 & A1'))).toEqual(['E', 'A1', 'A0']);
    expect(renameVars('!(E & A1)  |  A10', 'A1', 'B')).toBe('!(E & B)  |  A10');
  });
});

describe('kapufa', () => {
  it('NAND/NOR/XNOR felismerése és oda-vissza alakítás', () => {
    expect(toGates(parseExpr('!(A & B)'))).toEqual({ g: 'nand', ins: [{ v: 'A' }, { v: 'B' }] });
    expect(toGates(parseExpr('!(A | B) & C'))).toEqual({ g: 'and', ins: [{ g: 'nor', ins: [{ v: 'A' }, { v: 'B' }] }, { v: 'C' }] });
    for (const s of ['!(A & B)', '!(A ^ B) | C', '!A & (B | 1)', 'A']) expect(printExpr(fromGates(toGates(parseExpr(s))))).toBe(printExpr(parseExpr(s)));
    expect(printExpr(fromGates({ g: 'buf', ins: [{ v: 'X1' }] }))).toBe('X1');
  });
});

describe('igazságtábla és minimalizálás', () => {
  const rows = (s: string, vars: string[]) => Array.from({ length: 1 << vars.length }, (_, r) => truthRow(parseExpr(s), vars, r));
  it('a táblából minimális alak, ugyanaz az igazságtábla', () => {
    for (const s of ['A & B | A & !B', '!(A & B)', 'A ^ B', '!E & !A1 & !A0', 'A & B | !A & C | B & C', '0', '1']) {
      const vars = varsOf(parseExpr(s)).length ? varsOf(parseExpr(s)) : ['A'];
      const t = rows(s, vars), ones = t.flatMap((v, i) => (v === 1 ? [i] : []));
      const m = minimize(vars, ones);
      expect(rows(printExpr(m), vars).map(x => (x === 'X' ? 0 : x))).toEqual(t);
    }
    expect(printExpr(minimize(['A', 'B'], [2, 3]))).toBe('A');
    expect(printExpr(minimize(['A', 'B', 'C'], [3, 5, 6, 7]))).toBe('A & B | A & C | B & C');
  });
  it('dekóder: D1 D0 → kimenetek (a kérdésbeli példa)', () => {
    // D0=0 D1=0 → 4; D0=1 D1=0 → 3; D0=0 D1=1 → 2; mindkettő → 1
    const vars = ['D1', 'D0'];
    expect(printExpr(minimize(vars, [0]))).toBe('!D1 & !D0');
    expect(printExpr(minimize(vars, [1]))).toBe('!D1 & D0');
    expect(printExpr(minimize(vars, [2]))).toBe('D1 & !D0');
    expect(printExpr(minimize(vars, [3]))).toBe('D1 & D0');
  });
});
