import { describe, expect, it } from 'vitest';
import { emptyDesign } from '../../src/engine/design';
import { engineCtx, runTool } from '../../src/agent/tools';
import { applyImport, importCode } from '../../src/engine/codeimport';
import { detectLang } from '../../src/engine/codeparse';
import { generateCode } from '../../src/engine/codegen';
import { analyze } from '../../src/engine/netlist';
import type { Program } from '../../src/engine/program';

async function pico() {
  const ctx = engineCtx(emptyDesign());
  await runTool(ctx, 'place_part', { type: 'pico', row: 2, col: 2 });
  return ctx.D();
}
/** a program tömör leírása: blokkonként típus(paraméterek) ← bemenetek */
function desc(p: Program, D: ReturnType<typeof emptyDesign>): string[] {
  const pin = (r: unknown) => { const s = String(r || ''); const m = /\.(\d+)$/.exec(s); if (!m) return s; const q = D.parts[0]; void q; return 'pin' + m[1]; };
  return p.nodes.map(n => {
    const ins = p.edges.filter(e => e.to.startsWith(n.id + '.')).map(e => `${e.to.split('.')[1]}=${e.from}`);
    const pr = Object.entries(n.props).filter(([k]) => !['custom'].includes(k) || n.props.preset === 'custom').map(([k, v]) => `${k}:${k === 'pin' ? pin(v) : v}`).join(',');
    return `${n.id} ${n.type}(${pr})${ins.length ? ' ← ' + ins.join(' ') : ''}`;
  });
}

const SAMPLES: Record<string, [string, string]> = {
  blink: ['arduino', `
#define LED 15
void setup() { pinMode(LED, OUTPUT); }
void loop() {
  digitalWrite(LED, HIGH);
  delay(200);
  digitalWrite(LED, LOW);
  delay(800);
}`],
  button: ['arduino', `
const int BTN = 2, LED = 15;
void setup() { pinMode(BTN, INPUT_PULLUP); pinMode(LED, OUTPUT); }
void loop() {
  if (digitalRead(BTN) == LOW) digitalWrite(LED, HIGH);
  else digitalWrite(LED, LOW);
}`],
  toggle: ['arduino', `
int ledState = LOW; int lastBtn = HIGH;
void setup() { pinMode(2, INPUT_PULLUP); pinMode(15, OUTPUT); }
void loop() {
  int b = digitalRead(2);
  if (b == LOW && lastBtn == HIGH) { ledState = !ledState; delay(50); }
  lastBtn = b;
  digitalWrite(15, ledState);
}`],
  millis: ['arduino', `
unsigned long prev = 0; bool on = false;
void setup() { pinMode(15, OUTPUT); }
void loop() {
  if (millis() - prev >= 500) { prev = millis(); on = !on; digitalWrite(15, on); }
}`],
  chase: ['arduino', `
int leds[] = {10, 11, 12, 13};
void setup() { for (int i = 0; i < 4; i++) pinMode(leds[i], OUTPUT); }
void loop() {
  for (int i = 0; i < 4; i++) { digitalWrite(leds[i], HIGH); delay(150); digitalWrite(leds[i], LOW); }
}`],
  pot: ['arduino', `
void setup() { pinMode(16, OUTPUT); }
void loop() { int v = analogRead(26); analogWrite(16, map(v, 0, 1023, 0, 255)); delay(10); }`],
  thresh: ['arduino', `
void setup() { pinMode(15, OUTPUT); }
void loop() { digitalWrite(15, analogRead(26) > 512 ? HIGH : LOW); }`],
  pyblink: ['micropython', `
from machine import Pin
import time
led = Pin(15, Pin.OUT)
while True:
    led.toggle()
    time.sleep(0.5)
`],
  pybtn: ['micropython', `
from machine import Pin
btn = Pin(2, Pin.IN, Pin.PULL_UP)
led = Pin(15, Pin.OUT)
while True:
    led.value(not btn.value())
`],
  debounce: ['arduino', `
const int buttonPin = 2; const int ledPin = 15;
int ledState = HIGH; int buttonState; int lastButtonState = LOW;
unsigned long lastDebounceTime = 0; unsigned long debounceDelay = 50;
void setup() { pinMode(buttonPin, INPUT); pinMode(ledPin, OUTPUT); digitalWrite(ledPin, ledState); }
void loop() {
  int reading = digitalRead(buttonPin);
  if (reading != lastButtonState) { lastDebounceTime = millis(); }
  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading != buttonState) {
      buttonState = reading;
      if (buttonState == HIGH) { ledState = !ledState; }
    }
  }
  digitalWrite(ledPin, ledState);
  lastButtonState = reading;
}`],
  counter: ['arduino', `
int n = 0; int last = HIGH;
void setup() { pinMode(2, INPUT_PULLUP); pinMode(16, OUTPUT); }
void loop() {
  int b = digitalRead(2);
  if (b == LOW && last == HIGH) { n = (n + 1) % 4; }
  last = b;
  analogWrite(16, n * 85);
}`],
  and: ['micropython', `
from machine import Pin
a = Pin(2, Pin.IN, Pin.PULL_UP)
b = Pin(3, Pin.IN, Pin.PULL_UP)
led = Pin(15, Pin.OUT)
while True:
    if a.value() == 0 and b.value() == 0:
        led.on()
    else:
        led.off()
`],
};

const EXTRA: Record<string, [string, string]> = {
  ledc: ['arduino', `
void setup() { ledcSetup(0, 5000, 8); ledcAttachPin(16, 0); }
void loop() { ledcWrite(0, analogRead(26) / 16); }`],
  pymain: ['micropython', `
from machine import Pin, PWM, ADC
import time

def main():
    pot = ADC(Pin(26))
    pwm = PWM(Pin(16))
    pwm.freq(500)
    while True:
        pwm.duty_u16(pot.read_u16())
        time.sleep_ms(20)

main()
`],
  fade: ['arduino', `
void setup() { pinMode(16, OUTPUT); }
void loop() {
  for (int b = 0; b < 255; b += 5) { analogWrite(16, b); delay(10); }
  for (int b = 255; b > 0; b -= 5) { analogWrite(16, b); delay(10); }
}`],
  broken: ['arduino', `
#include <Servo.h>
Servo s;
void setup() { pinMode(15, OUTPUT); s.attach(9); }
void loop() {
  switch (x) { case 1: break; }
  digitalWrite(15, HIGH);
  foo(3);
}`],
  pychase: ['micropython', `
from machine import Pin
from time import sleep_ms
leds = [Pin(n, Pin.OUT) for n in (10, 11)]
`],
  pylist: ['micropython', `
from machine import Pin
import time
pins = [Pin(10, Pin.OUT), Pin(11, Pin.OUT), Pin(12, Pin.OUT)]
while True:
    for p in pins:
        p.on()
        time.sleep_ms(200)
        p.off()
`],
};

describe('kód → program', () => {
  const run = async (k: string) => { const D = await pico(); const [lang, code] = SAMPLES[k] || EXTRA[k]; const r = importCode(D, code, { lang: lang as 'arduino' }); return { r, d: desc(r.program, D), D }; };

  it('villogó delay-jel → Ütemadó a periódussal és a kitöltéssel', async () => {
    const { d, r } = await run('blink');
    expect(d).toEqual(['n1 out(pin:pin20) ← a=n2.v', 'n2 blink(period:1000,duty:20)']);
    expect(r.notes).toEqual([]);
    expect(r.summary[1]).toMatch(/1000 ms, 20 %/);
  });
  it('gomb if/else-szel és MicroPythonban (not) → Digitális bemenet, aktív alacsony, felhúzással', async () => {
    for (const k of ['button', 'pybtn']) expect((await run(k)).d).toEqual(['n1 out(pin:pin20) ← a=n2.v', 'n2 in(pin:pin4,pull:pullup,active:low)']);
  });
  it('élfigyelés last… változóval → Váltókapcsoló; a rövid várakozás megjegyzés', async () => {
    const { d, r } = await run('toggle');
    expect(d).toEqual(['n1 out(pin:pin20) ← a=n2.v', 'n2 toggle() ← a=n3.v', 'n3 in(pin:pin4,pull:pullup,active:low)']);
    expect(r.notes).toHaveLength(1); expect(r.notes[0].line).toBe(6); expect(r.notes[0].msg).toMatch(/pergésmentesítés/);
  });
  it('az Arduino Debounce példája: Váltókapcsoló, a kezdetben égő LED miatt NEM-mel', async () => {
    const { d } = await run('debounce');
    expect(d).toEqual(['n1 out(pin:pin20) ← a=n4.v', 'n2 toggle() ← a=n3.v', 'n3 in(pin:pin4,pull:float,active:high)', 'n4 not() ← a=n2.v']);
  });
  it('millis()-időzítő és a MicroPython toggle()+sleep → Ütemadó (kétszeres idővel)', async () => {
    for (const k of ['millis', 'pyblink']) expect((await run(k)).d).toEqual(['n1 out(pin:pin20) ← a=n2.v', 'n2 blink(period:1000,duty:50)']);
  });
  it('futófény (tömb + for, és MicroPython lista) → Ütemadó + Sorozat saját mintával', async () => {
    expect((await run('chase')).d.slice(0, 3)).toEqual(['n1 blink(period:150,duty:50)', 'n2 seq(preset:custom,custom:1000 0100 0010 0001,dir:fwd) ← a=n1.v', 'n3 out(pin:pin14) ← a=n2.c0']);
    const py = await run('pylist');
    expect(py.d[1]).toBe('n2 seq(preset:custom,custom:100 010 001,dir:fwd) ← a=n1.v');
    expect(py.d[0]).toBe('n1 blink(period:200,duty:50)');
  });
  it('analóg: potméter → PWM (map), küszöb → Összehasonlítás, ESP32 ledc, MicroPython main()-ből', async () => {
    expect((await run('pot')).d).toEqual(['n1 pwm(pin:pin21,duty:50,freq:1000) ← a=n2.v', 'n2 adc(pin:pin31)']);
    expect((await run('thresh')).d).toEqual(['n1 out(pin:pin20) ← a=n3.v', 'n2 adc(pin:pin31)', 'n3 compare(op:>,value:0.5005) ← a=n2.v']);
    const l = await run('ledc'); expect(l.d[0]).toMatch(/^n1 pwm\(pin:pin21,duty:50,freq:5000\) ← a=n2\.v$/); expect(l.d[1]).toBe('n2 adc(pin:pin31)');
    const m = await run('pymain'); expect(m.d).toEqual(['n1 pwm(pin:pin21,duty:50,freq:500) ← a=n2.v', 'n2 adc(pin:pin31)']); expect(m.r.notes).toEqual([]);
  });
  it('számláló élre, kitöltés a számlálóból; két gomb ÉS', async () => {
    expect((await run('counter')).d).toEqual(['n1 pwm(pin:pin21,duty:50,freq:1000) ← a=n2.f', 'n2 counter(max:4) ← a=n3.v', 'n3 in(pin:pin4,pull:pullup,active:low)']);
    expect((await run('and')).d).toEqual(['n1 out(pin:pin20) ← a=n4.v', 'n2 in(pin:pin4,pull:pullup,active:low)', 'n3 in(pin:pin5,pull:pullup,active:low)', 'n4 and() ← a=n2.v b=n3.v']);
  });
  it('fade: átlagos kitöltés megjegyzéssel; ismeretlen részek sorszámmal, a többi lefordul', async () => {
    const f = await run('fade'); expect(f.d).toHaveLength(1); expect(f.d[0]).toMatch(/^n1 pwm\(pin:pin21,duty:\d+(\.\d)?,/); expect(f.r.notes.map(n => n.msg).join()).toMatch(/fokozatosan/);
    const b = await run('broken');
    expect(b.d).toEqual(['n1 out(pin:pin20) ← a=n2.v', 'n2 const(value:1)']);
    const lines = b.r.notes.map(n => n.line);
    expect(lines).toContain(6); // switch
    expect(b.r.notes.map(n => n.msg).join('\n')).toMatch(/foo/);
  });
  it('lépcsőházi világítás millis()-szel → Időzítő (utánfutás)', async () => {
    const D = await pico();
    const r = importCode(D, `const int BTN = 2, LED = 15; unsigned long t0 = 0;
void setup() { pinMode(BTN, INPUT_PULLUP); pinMode(LED, OUTPUT); }
void loop() { if (digitalRead(BTN) == LOW) t0 = millis(); digitalWrite(LED, millis() - t0 < 5000 ? HIGH : LOW); }`);
    expect(desc(r.program, D)).toEqual(['n1 out(pin:pin20) ← a=n2.v', 'n2 delay(mode:off,ms:5000) ← a=n3.v', 'n3 in(pin:pin4,pull:pullup,active:low)']);
  });
  it('a generált kód visszaolvasva ugyanazt a programot adja (Arduino és MicroPython)', async () => {
    const ctx = engineCtx(emptyDesign()); await runTool(ctx, 'place_part', { type: 'pico', row: 2, col: 2 });
    const blocks: Array<[string, Record<string, unknown>]> = [['in', { pin: 'PICO1.GP2' }], ['toggle', {}], ['out', { pin: 'PICO1.GP15' }], ['blink', { period: 400, duty: 25 }], ['out', { pin: 'PICO1.GP16' }],
      ['adc', { pin: 'PICO1.GP26' }], ['compare', { op: '>', value: 0.3 }], ['and', {}], ['out', { pin: 'PICO1.GP17' }], ['in', { pin: 'PICO1.GP3' }], ['counter', { max: 5 }], ['pwm', { pin: 'PICO1.GP18' }]];
    for (const [t, p] of blocks) expect((await runTool(ctx, 'add_block', { type: t, params: p })).isError).toBeFalsy();
    for (const [a, b] of [['n1.v', 'n2.a'], ['n2.v', 'n3.a'], ['n4.v', 'n5.a'], ['n6.v', 'n7.a'], ['n7.v', 'n8.a'], ['n1.v', 'n8.b'], ['n8.v', 'n9.a'], ['n10.v', 'n11.a'], ['n11.f', 'n12.a']]) expect((await runTool(ctx, 'connect_blocks', { from: a, to: b })).isError).toBeFalsy();
    const D = ctx.D();
    const shape = (p: Program) => {
      const t = (ref: string) => { const n = p.nodes.find(x => x.id === ref.split('.')[0])!; return `${n.type}${n.props.pin ? '@' + n.props.pin : ''}.${ref.split('.')[1]}`; };
      return { nodes: p.nodes.map(n => n.type + JSON.stringify({ ...n.props, freq: undefined, duty: n.type === 'pwm' ? undefined : n.props.duty })).sort(), edges: p.edges.map(e => t(e.from) + '→' + t(e.to)).sort() };
    };
    for (const lang of ['arduino', 'micropython'] as const) {
      const c = generateCode(D, analyze(D), D.program!, lang);
      const r = importCode(D, c.code, { lang });
      expect(shape(r.program), lang).toEqual(shape(D.program!));
      expect(r.notes, lang).toEqual([]);
    }
  });
  it('nyelvfelismerés; vezérlőlap nélkül üres láb megjegyzéssel; alkalmazás cserével és hozzáadással', async () => {
    expect(detectLang(SAMPLES.pyblink[1])).toBe('micropython');
    expect(detectLang(SAMPLES.blink[1])).toBe('arduino');
    const r0 = importCode(emptyDesign(), SAMPLES.blink[1]);
    expect(r0.program.nodes.find(n => n.type === 'out')!.props.pin).toBe('');
    expect(r0.notes.map(n => n.msg).join()).toMatch(/Nincs vezérlőlap/);
    const D = await pico();
    applyImport(D, importCode(D, SAMPLES.blink[1]), 'replace');
    expect(D.program!.nodes).toHaveLength(2);
    const ids = applyImport(D, importCode(D, SAMPLES.button[1]), 'append');
    expect(D.program!.nodes).toHaveLength(4); expect(ids).toEqual(['n3', 'n4']);
    expect(D.program!.edges.map(e => e.from + '>' + e.to)).toEqual(['n2.v>n1.a', 'n4.v>n3.a']);
    expect(Math.min(...D.program!.nodes.filter(n => ids.includes(n.id)).map(n => n.x))).toBeGreaterThan(Math.max(...D.program!.nodes.filter(n => !ids.includes(n.id)).map(n => n.x)));
  });
  it('agent: import_code – próba (dry_run) nem változtat, utána csere; a jelentés angolul, megjegyzésekkel', async () => {
    const ctx = engineCtx(emptyDesign()); await runTool(ctx, 'place_part', { type: 'pico', row: 2, col: 2 });
    const code = SAMPLES.blink[1] + '\nvoid foo() { tone(3, 440); }';
    let r = await runTool(ctx, 'import_code', { code, dry_run: true });
    expect(r.isError).toBeFalsy(); expect(r.changed).toBeFalsy(); expect(r.text).toMatch(/Dry run/); expect(r.text).toMatch(/Clock: 1000 ms, 20 %/);
    expect(ctx.D().program?.nodes.length ?? 0).toBe(0);
    r = await runTool(ctx, 'import_code', { code: code.replace('delay(800);', 'delay(800); tone(3, 440);') });
    expect(r.changed).toBe(true); expect(r.text).toMatch(/Program replaced: blocks n1, n2/); expect(r.text).toMatch(/Line \d+: tone cannot be translated/);
    expect(ctx.D().program!.nodes).toHaveLength(2);
  });
});
