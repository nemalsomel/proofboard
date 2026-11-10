import { describe, expect, it } from 'vitest';
import { type Command, commandFor, conflicts, fmtKey, fold, matches, parseKey, rank, score } from '../../src/ui/commands';

const ev = (key: string, o: Partial<{ code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) =>
  ({ key, code: o.code ?? (/^[a-z]$/i.test(key) ? 'Key' + key.toUpperCase() : /^[0-9]$/.test(key) ? 'Digit' + key : ''), ctrlKey: false, altKey: false, shiftKey: false, ...o });

describe('parancsok: billentyűk', () => {
  it('leírás értelmezése és kiírása', () => {
    expect(parseKey('Ctrl+Shift+K')).toEqual({ ctrl: true, alt: false, shift: true, key: 'k' });
    expect(parseKey('+')).toEqual({ ctrl: false, alt: false, shift: false, key: '+' });
    expect(parseKey('Ctrl++').key).toBe('+');
    expect(fmtKey('Shift+W')).toBe('⇧W');
    expect(fmtKey('Delete')).toBe('Del');
    expect(fmtKey('Ctrl+k')).toBe('Ctrl+K');
    expect(fmtKey('Shift+2')).toBe('⇧2');
  });

  it('betű: felirat szerint, módosítók pontosan; Ctrl és Cmd egyenrangú', () => {
    const s = parseKey('Ctrl+Z');
    expect(matches(s, ev('z', { ctrlKey: true }))).toBe(true);
    expect(matches(s, ev('Z', { ctrlKey: true, code: 'KeyY' }))).toBe(true); // QWERTZ
    expect(matches(s, ev('z', { metaKey: true }))).toBe(true);
    expect(matches(s, ev('z', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches(parseKey('R'), ev('r', { ctrlKey: true }))).toBe(false);
    expect(matches(parseKey('Shift+W'), ev('W', { shiftKey: true }))).toBe(true);
    expect(matches(parseKey('W'), ev('W', { shiftKey: true }))).toBe(false);
  });

  it('számjegy: fizikai hely (Shift+1 magyar kiosztáson is), számbillentyűzet is', () => {
    expect(matches(parseKey('Shift+1'), ev("'", { code: 'Digit1', shiftKey: true }))).toBe(true);
    expect(matches(parseKey('1'), ev("'", { code: 'Digit1', shiftKey: true }))).toBe(false);
    expect(matches(parseKey('1'), ev('1', { code: 'Numpad1' }))).toBe(true);
    expect(matches(parseKey('Alt+2'), ev('2', { altKey: true }))).toBe(true);
  });

  it('írásjel: a keletkező karakter számít, a Shift és az AltGr (Ctrl+Alt) nem', () => {
    expect(matches(parseKey('?'), ev('?', { shiftKey: true, code: 'Comma' }))).toBe(true);
    expect(matches(parseKey('['), ev('[', { ctrlKey: true, altKey: true, code: 'KeyF' }))).toBe(true);
    expect(matches(parseKey('['), ev('[', { ctrlKey: true }))).toBe(false);
    expect(matches(parseKey('Delete'), ev('Delete'))).toBe(true);
    expect(matches(parseKey('F1'), ev('F1'))).toBe(true);
  });

  it('parancs keresése hatókörrel és elérhetőséggel; ütközés', () => {
    let n = 0;
    const cmds: Command[] = [
      { id: 'a', label: 'A', group: 'g', keys: ['S'], run: () => { n++; }, enabled: () => false },
      { id: 'b', label: 'B', group: 'g', keys: ['S'], run: () => { n += 10; } },
      { id: 'c', label: 'C', group: 'g', keys: ['Ctrl+K'], scope: 'input', run: () => { n += 100; } },
    ];
    expect(commandFor(cmds, ev('s'), ['board'])?.id).toBe('b');
    expect(commandFor(cmds, ev('s'), ['input', 'global'])).toBeNull();
    expect(commandFor(cmds, ev('k', { ctrlKey: true }), ['input'])?.id).toBe('c');
    expect(conflicts(cmds)).toEqual(['S: a / b']);
    expect(conflicts(cmds.slice(1))).toEqual([]);
  });
});

describe('parancsok: keresés', () => {
  it('ékezet- és kisbetű-független, szavanként; kezdőbetűk', () => {
    expect(fold('Megosztás LINKKEL')).toBe('megosztas linkkel');
    expect(score('megoszt', 'Megosztás linkkel…')).toBeGreaterThan(score('link', 'Megosztás linkkel…'));
    expect(score('ml', 'Megosztás linkkel…')).toBeGreaterThan(0);
    expect(score('mentes fajl', 'Mentés fájlba')).toBeGreaterThan(0);
    expect(score('xyz', 'Mentés fájlba')).toBe(0);
    expect(score('save', 'Mentés fájlba', 'save file')).toBeGreaterThan(0);
  });

  it('rangsor: a név eleje előrébb, azonos pontnál az eredeti sorrend', () => {
    const items = ['Nagyítás', 'Kicsinyítés', 'Új terv…', 'Terv megnyitása'];
    expect(rank(items, 'terv', x => [x])).toEqual(['Terv megnyitása', 'Új terv…']);
    expect(rank(items, '', x => [x])).toEqual(items);
  });
});
