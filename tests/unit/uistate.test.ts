import { describe, expect, it } from 'vitest';
import { History } from '../../src/ui/history';
import { EventLog } from '../../src/ui/log';
import { favToggled, libraryHtml, recentWith, type LibEntry } from '../../src/ui/library';
import { fromScreen, toScreen } from '../../src/ui/viewport';

describe('felületi állapot (ui/)', () => {
  it('visszavonás és újra: egy helyen, korláttal, eldobható lépéssel', () => {
    let n = 0; const h = new History(3, () => n++);
    expect(h.canUndo).toBe(false);
    h.push('a'); h.push('b'); h.push('c'); h.push('d'); // a legrégebbi kiesik
    expect(h.undo('e')).toBe('d'); expect(h.canRedo).toBe(true);
    expect(h.redo('d')).toBe('e');
    expect(h.drop()).toBe('d'); // az utolsó mentés eldobható (a művelet mégsem történt meg)
    expect(h.undo('x')).toBe('c'); expect(h.undo('c')).toBe('b'); expect(h.undo('b')).toBeNull();
    h.push('z'); expect(h.canRedo).toBe(false); // új lépés: az újra-lista kiürül
    expect(n).toBeGreaterThan(5);
  });
  it('napló: olvasatlan-számláló, legújabb elöl, korlát', () => {
    const L = new EventLog(2);
    L.add('egy'); L.add('kettő', true); L.add('három', false, true);
    expect(L.entries.map(e => e.m)).toEqual(['kettő', 'három']);
    expect(L.unread).toBe(2);
    expect(L.html()).toMatch(/három[\s\S]*kettő/);
    L.read(); expect(L.unread).toBe(0); L.clear(); expect(L.html()).toMatch(/Még nincs/);
  });
  it('alkatrészlista: csoportok, keresés, rejtett kategória; kedvenc és legutóbbi', () => {
    const def = (name: string, cat: string): LibEntry => ({ def: { name, prefix: 'X', fp: '', pins: [] } as never, name, fp: '2 láb', cat });
    const defs = { r: def('Ellenállás', 'Passzív'), u: def('74HC00', 'Logika'), mine: def('Saját modul', 'Saját') };
    const base = { defs, builtin: new Set(['r', 'u']), library: new Set(['mine']), project: [], pref: { fav: ['r'] }, query: '', placing: null, sim: false };
    const h = libraryHtml(base);
    expect(h).toContain('data-grp="fav"'); expect(h).toContain('data-grp="lib"'); expect(h).toContain('data-grp="cat:Logika"');
    expect(libraryHtml({ ...base, hideCats: new Set(['Logika']) })).not.toContain('cat:Logika');
    expect(libraryHtml({ ...base, query: 'zzz' })).toContain('Nincs találat');
    expect(favToggled({ fav: ['r'] }, 'r')).toEqual([]);
    expect(recentWith({ recent: ['a', 'b', 'c', 'd', 'e', 'f'] }, 'c')).toEqual(['c', 'a', 'b', 'd', 'e', 'f']);
  });
  it('nézetforgatás: oda-vissza ugyanaz a pont', () => {
    for (const r of [0, 1, 2, 3]) { const [x, y] = toScreen(10, 20, 100, 200, r); expect(fromScreen(x, y, 100, 200, r)).toEqual([10, 20]); }
  });
});
