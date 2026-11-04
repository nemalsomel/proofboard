import { describe, expect, it } from 'vitest';
import { generateCode, platformioFiles } from '../../src/engine/codegen';
import { normalize } from '../../src/engine/design';
import { analyze } from '../../src/engine/netlist';
import { route } from '../../src/engine/route';
import { crc32, makeZip } from '../../src/core/zip';
import { EXAMPLES } from '../../src/ui/examples';

/** Példa betöltése úgy, ahogy az app teszi (útvonalkereséssel). */
function load(id: string, mcu?: string) {
  const ex = EXAMPLES.find(e => e.id === id)!, raw = JSON.parse(JSON.stringify(ex.design));
  if (mcu) raw.parts[0] = { ...raw.parts[0], type: mcu, props: {} };
  const D = normalize({ ...raw, bridges: [], wires: [], auto: { bridges: [], wires: [] }, notes: [], settings: { usb: true, btnMode: 'hold', autoRoute: true },
    links: raw.links.map(([a, b]: [string, string], i: number) => ({ id: 'l' + i, a, b, gpio: null })) });
  route(D, { full: true });
  return { D, A: analyze(D) };
}

describe('kódgenerálás', () => {
  it('MicroPython: gomb → váltókapcsoló → LED; a GPIO a bekötésből, a csomópontok sorai nyilvántartva', () => {
    const { D, A } = load('prog-toggle'), c = generateCode(D, A, D.program!, 'micropython');
    const gp = (ref: string) => { const l = D.links.find(x => x.a === ref)!; return +/(\d+)$/.exec(A.byPart.get(l.gpio!.split('.')[0])!.map[l.gpio!.split('.')[1]].name)![1]; };
    expect(c.file).toBe('main.py');
    expect(c.warnings).toEqual([]);
    expect(c.code).toContain(`n1_pin = Pin(${gp('p2.A1')}, Pin.IN, Pin.PULL_UP)`);
    expect(c.code).toContain(`n3_pin = Pin(${gp('p3.1')}, Pin.OUT)`);
    expect(c.code).toContain('n1_v = n1_pin.value() == 0');
    expect(c.code).toContain('n3_pin.value(1 if n2_v else 0)');
    const lines = c.code.split('\n'), [a, b] = c.lines.n2.at(-1)!;
    expect(lines.slice(a - 1, b).join('\n')).toContain('n2_v = not n2_v');
    expect(lines.findIndex(l => l.includes('# n1 ·'))).toBeLessThan(lines.findIndex(l => l.includes('# n2 ·'))); // élek szerinti sorrend
  });

  it('Arduino: lapfüggő PWM-frekvencia és ADC; Picón analogWriteFreq, ESP32-n analogWriteFrequency(pin, f)', () => {
    const pico = load('prog-dimmer'), c = generateCode(pico.D, pico.A, pico.D.program!, 'arduino');
    expect(c.file).toBe('proofboard.ino');
    expect(c.code).toContain('analogWriteFreq(1000);');
    expect(c.code).toMatch(/n1_v = analogRead\(\d+\) \/ 4095\.0f;/);
    expect(c.code).toMatch(/analogWrite\(\d+, \(int\)\(constrain\(n1_v, 0\.0f, 1\.0f\) \* 255\)\);/);
    expect(c.code).toContain('n3_v = n1_v > 0.75f;');
    expect(c.target!.fqbn).toBe('rp2040:rp2040:rpipicow');
    const esp = load('prog-dimmer', 'esp32'), e = generateCode(esp.D, esp.A, esp.D.program!, 'arduino'), m = generateCode(esp.D, esp.A, esp.D.program!, 'micropython');
    expect(e.code).toMatch(/analogWriteFrequency\(\d+, 1000\);/);
    expect(m.code).toContain('.atten(ADC.ATTN_11DB)');
    const [ini, cpp] = platformioFiles(e);
    expect(ini.text).toContain('platform = https://github.com/pioarduino/platform-espressif32');
    expect(ini.text).toContain('board = esp32doit-devkit-v1');
    expect(cpp.name).toBe('src/main.cpp');
    expect(cpp.text.startsWith('#include <Arduino.h>')).toBe(true);
  });

  it('láb nélküli csomópont kimarad, figyelmeztetéssel; vezérlő nélkül is készül kód', () => {
    const { D, A } = load('prog-blink');
    D.program!.nodes[1].props.pin = '';
    const c = generateCode(D, A, D.program!, 'micropython');
    expect(c.warnings).toEqual(['Digitális kimenet (n2): nincs kiválasztva láb; kimaradt.']);
    expect(c.code).not.toContain('Pin.OUT');
  });
});

describe('zip', () => {
  it('CRC32 és szerkezet', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const z = makeZip([{ name: 'a/platformio.ini', text: '[env]\n' }, { name: 'a/src/main.cpp', text: 'void setup(){}' }]);
    expect([...z.slice(0, 4)]).toEqual([0x50, 0x4b, 3, 4]);
    expect([...z.slice(-22, -18)]).toEqual([0x50, 0x4b, 5, 6]);
    expect(new TextDecoder().decode(z)).toContain('a/src/main.cpp');
    expect(new DataView(z.buffer).getUint16(z.length - 12, true)).toBe(2); // bejegyzések száma
  });
});
