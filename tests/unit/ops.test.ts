import { describe, expect, it } from 'vitest';
import { emptyDesign } from '../../src/engine/design';
import { placedPins } from '../../src/engine/geometry';
import { analyze } from '../../src/engine/netlist';
import { addBridge, addLink, addNote, attachPlug, gpioPin, movePart, nextLabel, partFits, placePart, removeItems, removeParts, setGpioMode, setPwm, transformItems, EXT } from '../../src/engine/ops';
import type { Design } from '../../src/engine/types';

const fresh = (): Design => emptyDesign();

describe('tervműveletek (engine/ops)', () => {
  it('lerakás: címke a következő sorszámmal, alapparaméterek; ha nem fér el, a terv változatlan', () => {
    const D = fresh();
    const r1 = placePart(D, 'res', 4, 4)!, r2 = placePart(D, 'res', 8, 4, { props: { ohm: 330 } })!;
    expect([r1.label, r2.label]).toEqual(['R1', 'R2']);
    expect(r2.props.ohm).toBe(330);
    expect('xray' in r1).toBe(false);
    r1.label = 'R7'; expect(nextLabel(D, 'res')).toBe('R8');
    expect(placePart(D, 'res', -50, 4)).toBeNull();
    expect(placePart(D, 'nincs-ilyen', 1, 1)).toBeNull();
    expect(D.parts.length).toBe(2);
  });
  it('elférés: legalább egy láb a panelon, legfeljebb EXT lyuknyi túllógás; mozgatás csak ha elfér', () => {
    const D = fresh(), p = placePart(D, 'res', 0, 0)!;
    expect(partFits(D, { ...p, c: -1 })).toBe(true); // egy láb még a panelon
    expect(partFits(D, { ...p, r: -1 })).toBe(false); // mindkét láb kint
    expect(partFits(D, { ...p, r: 3, c: -EXT - 1 })).toBe(false); // túl messze lóg ki
    expect(movePart(D, p, 2, 3)).toBe(true); expect([p.r, p.c]).toEqual([2, 3]);
    expect(movePart(D, p, -100, 0)).toBe(false); expect([p.r, p.c]).toEqual([2, 3]);
  });
  it('kapcsolat: nincs kettőzés (egyik irányban sem); alkatrész törlése a kapcsolataival', () => {
    const D = fresh(), a = placePart(D, 'res', 4, 4)!, b = placePart(D, 'led', 4, 8)!;
    const l = addLink(D, a.id + '.1', b.id + '.A')!;
    expect(l.gpio).toBeNull();
    expect(addLink(D, b.id + '.A', a.id + '.1')).toBeNull();
    addLink(D, b.id + '.K', 'GND');
    removeParts(D, [b.id]);
    expect(D.parts.map(p => p.label)).toEqual(['R1']);
    expect(D.links).toEqual([]);
  });
  it('kézi híd: szomszédos lyukak, különböző csíkdarab, nem kettőzve', () => {
    const D = fresh();
    D.board = { rows: 10, cols: 10, sec: 10 }; // teljes csík: soron belül egy darab, oszlopok között különböző
    expect(addBridge(D, 2, 2, 2, 3)).toBe(true);
    expect(addBridge(D, 2, 3, 2, 2)).toBe(false); // ugyanaz fordítva
    expect(addBridge(D, 2, 2, 3, 2)).toBe(false); // egy csíkon
    expect(addBridge(D, 2, 2, 2, 4)).toBe(false); // nem szomszédos
    expect(addBridge(D, 2, 9, 2, 10)).toBe(false); // a panelon kívül
  });
  it('csoport forgatása és tükrözése a közös középpont körül; lelógásnál a terv érintetlen', () => {
    const D = fresh(), p = placePart(D, 'res', 5, 5)!; D.bridges.push([10, 1, 10, 2]);
    const before = placedPins(p).map(q => [q.r, q.c]);
    expect(transformItems(D, { parts: [p.id] }, 'rot')).toBe(true);
    expect(p.rot).toBe(1);
    const after = placedPins(p).map(q => [q.r, q.c]);
    expect(after).not.toEqual(before);
    expect(transformItems(D, { parts: [p.id] }, 'mir')).toBe(true); expect(p.mir).toBe(true);
    const edge = fresh(); edge.bridges.push([0, 0, 0, 1]); // a panel sarkán: forgatva lelógna
    const snap = JSON.stringify(edge);
    expect(transformItems(edge, { parts: [], bridges: [0] }, 'rot')).toBe(false);
    expect(JSON.stringify(edge)).toBe(snap);
    expect(transformItems(D, { parts: [] }, 'rot')).toBeNull();
  });
  it('elemek törlése: alkatrész, híd, vezeték egyszerre', () => {
    const D = fresh(), p = placePart(D, 'res', 5, 5)!;
    D.bridges.push([1, 1, 1, 2], [2, 1, 2, 2]); D.wires.push({ a: [3, 1], b: [3, 6], color: '#000' });
    removeItems(D, { parts: [p.id], bridges: [0], wires: [0] });
    expect(D.parts).toEqual([]); expect(D.bridges).toEqual([[2, 1, 2, 2]]); expect(D.wires).toEqual([]);
  });
  it('jegyzet: azonosító, alapméret, mutató', () => {
    const D = fresh(), n = addNote(D, 2, 3, 'Szia', '#fff3bf', { target: 'p9' });
    expect([n.w, n.h, n.target]).toEqual([12, 6, 'p9']);
    expect(D.notes).toEqual([n]);
  });
  it('külső alkatrész: csatlakozó tüskesor a panelra, törléskor a csatlakozó is megy', () => {
    const D = fresh(), m = placePart(D, 'stepper', -1, 10, { rot: 2 })!; // a kivezetések a panel fölött, a test a panelon kívül nem lóghat túl
    expect(placePart(D, 'stepper', 5, 10)).toBeNull(); // kivezetés a panelon: nem
    expect(m).not.toBeNull();
    const h = attachPlug(D, m)!;
    expect(h).not.toBeNull(); expect(m.plug).toBe(h.id);
    expect(placedPins(h).every(q => q.r >= 0 && q.c >= 0)).toBe(true);
    expect(attachPlug(D, placePart(D, 'res', 4, 4)!)).toBeNull(); // panelra szerelt alkatrészhez nem
    removeParts(D, [m.id]);
    expect(D.parts.map(p => p.type)).toEqual(['res']);
    expect(analyze(D)).toBeTruthy();
  });
  it('GPIO mód és PWM a láb neve szerint; rossz lábra vagy módra false', () => {
    const D = fresh(), pico = placePart(D, 'pico', 2, 2)!;
    expect(pico).not.toBeNull();
    expect(gpioPin(D, 'GP15')).not.toBeNull();
    expect(setGpioMode(D, 'GP15', 'out_high')).toBe(true);
    expect(D.gpio[pico.id + '.' + gpioPin(D, 'GP15')!.id]).toBe('out_high');
    expect(setGpioMode(D, 'GP15', 'nincs')).toBe(false);
    expect(setGpioMode(D, 'GND', 'out_high')).toBe(false);
    expect(setPwm(D, 'GP15', 25)).toBe(true);
    const k = pico.id + '.' + gpioPin(D, 'GP15')!.id;
    expect(D.gpio[k]).toBe('pwm'); expect(D.pwm![k]).toEqual({ duty: 25, freq: 1000 });
    expect(setPwm(D, 'GP15', null, 50)).toBe(true); expect(D.pwm![k]).toEqual({ duty: 25, freq: 50 });
  });
});
