/**
 * Kódgenerálás a programból (engine/program.ts): MicroPython és Arduino (C++) forrás, valamint
 * PlatformIO-projekt. A kód a szimulátor kiértékelését követi: ütemenként (20 ms) beolvassa a bemeneteket,
 * az élek sorrendjében kiszámolja a csomópontokat (körben az előző ütem értékével), majd beállítja a kimeneteket.
 * A lapfüggő részleteket (Arduino-lap, PlatformIO-platform, PWM-frekvencia, ADC) a vezérlőlap leírása adja
 * (`meta.target`), a csomópont-sablonok itt vannak, nyelvenként.
 */
import { DEFS, isMcu } from './defs';
import { findPin } from './links';
import type { Netlist } from './netlist';
import { gpioOf, NODE_DEFS, seqRows, type PNode, type Program } from './program';
import type { Design } from './types';

export type CodeLang = 'micropython' | 'arduino';
/** A vezérlőlap célkörnyezete (a lap leírásában: `meta.target`). */
export interface McuTarget {
  /** Arduino-lap (FQBN), pl. rp2040:rp2040:rpipicow; az alaplapkezelő URL-je, ha nem az alapcsomag része. */
  fqbn: string; boardUrl?: string;
  /** PWM-frekvencia beállítása Arduinón: {pin}, {f} helyettesítéssel. */
  pwmFreq: string;
  /** PlatformIO: platform (név vagy URL), lap, és további sorok a platformio.ini-be. */
  pio: { platform: string; board: string; extra?: string[] };
  /** MicroPython: az ADC teljes 0–3,3 V-os tartományához kell-e csillapítás (ESP32). */
  mpyAtten?: boolean;
}
export interface CodeOut {
  lang: CodeLang; file: string; code: string;
  /** Csomópontonként a hozzá tartozó sorok (1-től), a szerkesztő kiemeléséhez. */
  lines: Record<string, Array<[number, number]>>;
  warnings: string[];
  board: string | null; target: McuTarget | null;
}

const safe = (id: string) => (/^[A-Za-z_]\w*$/.test(id) ? id : 'n_' + id.replace(/\W/g, '_'));
const num = (x: unknown, d: number) => { const n = Number(x); return isFinite(n) ? n : d; };
const lit = (x: number) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(6)));

/** A program lábai: csomópont → GPIO-szám, név, és a hivatkozott alkatrészláb neve a megjegyzéshez. */
function pinInfo(D: Design, A: Netlist, n: PNode): { gpio: number; name: string; ref: string } | null {
  const ref = n.props.pin, key = gpioOf(D, A, ref);
  if (!key) return null;
  const g = findPin(D, key), src = findPin(D, String(ref));
  const m = g && /(\d+)$/.exec(g.name);
  if (!g || !m) return null;
  return { gpio: +m[1], name: g.name, ref: src ? `${src.part.label}.${src.name}` : String(ref) };
}

/** Kódgenerálás a megadott nyelven. */
export function generateCode(D: Design, A: Netlist, prog: Program, lang: CodeLang): CodeOut {
  const py = lang === 'micropython', warnings: string[] = [];
  const mcu = D.parts.find(p => isMcu(p)) || null;
  const target = mcu ? ((DEFS[mcu.type].def.meta || {}) as { target?: McuTarget }).target || null : null;
  const board = mcu ? DEFS[mcu.type].def.name : null;
  if (!mcu) warnings.push('Nincs vezérlőlap a tervben; a lábszámok nem ismertek.');
  else if (!target && !py) warnings.push(`${board}: nincs Arduino-célkörnyezet a leírásában; az általános Arduino-függvényekkel készült.`);

  // sorrend: mint a kiértékelésben (topologikus, a kör maradéka a végén)
  const deps = new Map(prog.nodes.map(n => [n.id, new Set(prog.edges.filter(e => e.to.startsWith(n.id + '.')).map(e => e.from.slice(0, e.from.lastIndexOf('.'))))]));
  const order: PNode[] = [], done = new Set<string>();
  for (let progress = true; progress;) {
    progress = false;
    for (const n of prog.nodes) if (!done.has(n.id) && [...deps.get(n.id)!].every(d => done.has(d) || d === n.id)) { order.push(n); done.add(n.id); progress = true; }
  }
  for (const n of prog.nodes) if (!done.has(n.id)) order.push(n);

  const byTo = new Map(prog.edges.map(e => [e.to, e.from]));
  const v = (ref: string) => { const i = ref.lastIndexOf('.'); return `${safe(ref.slice(0, i))}_${ref.slice(i + 1)}`; };
  /** Bemenet kifejezése: a bekötött kimenet változója, vagy alapérték; a típus szerint átalakítva. */
  const inp = (n: PNode, port: string, want: 'bool' | 'num'): string => {
    const f = byTo.get(n.id + '.' + port);
    if (!f) return want === 'bool' ? (py ? 'False' : 'false') : '0';
    const fi = f.lastIndexOf('.'), fn = prog.nodes.find(x => x.id === f.slice(0, fi))!;
    const kind = NODE_DEFS[fn.type].outs.find(o => o.id === f.slice(fi + 1))!.kind, x = v(f);
    if (kind === want) return x;
    return want === 'bool' ? `(${x} > 0.5)` : (py ? `(1 if ${x} else 0)` : `(${x} ? 1.0f : 0.0f)`);
  };
  const T = py ? 'True' : 'true', F = py ? 'False' : 'false', NOT = py ? 'not ' : '!', AND = py ? ' and ' : ' && ', OR = py ? ' or ' : ' || ';

  const setup: Array<[string, string[]]> = [], vars: Array<[string, string[]]> = [], step: Array<[string, string[]]> = [];
  const used = new Map<number, string>();
  for (const n of order) {
    const d = NODE_DEFS[n.type], id = safe(n.id), p = n.props, S: string[] = [], V: string[] = [], L: string[] = [];
    const out = (port: string) => v(n.id + '.' + port);
    // kimeneti változók: globálisak, így körben az előző ütem értékét adják
    for (const o of d.outs) V.push(py ? `${out(o.id)} = ${o.kind === 'bool' ? F : '0'}` : `${o.kind === 'bool' ? 'bool' : 'float'} ${out(o.id)} = ${o.kind === 'bool' ? F : '0'};`);
    let pin: ReturnType<typeof pinInfo> = null;
    if (d.params.some(x => x.type === 'pin')) {
      pin = pinInfo(D, A, n);
      if (!pin) { warnings.push(`${d.label} (${n.id}): ${p.pin ? 'a láb nincs GPIO-ra kötve' : 'nincs kiválasztva láb'}; kimaradt.`); continue; }
      if (used.has(pin.gpio) && used.get(pin.gpio) !== n.id) warnings.push(`${pin.name}: több blokk is használja (${used.get(pin.gpio)}, ${n.id}).`);
      used.set(pin.gpio, n.id);
    }
    const c = (s: string) => (py ? `# ${s}` : `// ${s}`);
    switch (n.type) {
      case 'in': {
        const pull = p.pull === 'pulldown' ? (py ? 'Pin.PULL_DOWN' : 'INPUT_PULLDOWN') : p.pull === 'float' ? (py ? 'None' : 'INPUT') : (py ? 'Pin.PULL_UP' : 'INPUT_PULLUP');
        const lvl = p.active === 'high' ? 1 : 0;
        S.push(py ? `${id}_pin = Pin(${pin!.gpio}, Pin.IN, ${pull})  ${c(`${pin!.ref} → ${pin!.name}`)}` : `pinMode(${pin!.gpio}, ${pull});  ${c(`${pin!.ref} → ${pin!.name}`)}`);
        L.push(py ? `${out('v')} = ${id}_pin.value() == ${lvl}` : `${out('v')} = digitalRead(${pin!.gpio}) == ${lvl ? 'HIGH' : 'LOW'};`);
        break;
      }
      case 'adc':
        if (py) S.push(`${id}_adc = ADC(Pin(${pin!.gpio}))  ${c(`${pin!.ref} → ${pin!.name}`)}`, ...(target && target.mpyAtten ? [`${id}_adc.atten(ADC.ATTN_11DB)  ${c('0–3,3 V-os tartomány')}`] : []));
        else S.push(c(`analóg bemenet: ${pin!.ref} → ${pin!.name}`));
        L.push(py ? `${out('v')} = ${id}_adc.read_u16() / 65535` : `${out('v')} = analogRead(${pin!.gpio}) / 4095.0f;`);
        break;
      case 'const': L.push(py ? `${out('v')} = ${lit(num(p.value, 1))}` : `${out('v')} = ${lit(num(p.value, 1))};`); break;
      case 'not': L.push(py ? `${out('v')} = ${NOT}${inp(n, 'a', 'bool')}` : `${out('v')} = ${NOT}${inp(n, 'a', 'bool')};`); break;
      case 'and': case 'or': case 'xor': {
        const a = inp(n, 'a', 'bool'), b = inp(n, 'b', 'bool'), e = n.type === 'and' ? a + AND + b : n.type === 'or' ? a + OR + b : `${a} != ${b}`;
        L.push(py ? `${out('v')} = ${e}` : `${out('v')} = ${e};`);
        break;
      }
      case 'compare': L.push(py ? `${out('v')} = ${inp(n, 'a', 'num')} ${p.op === '<' ? '<' : '>'} ${lit(num(p.value, 0.5))}` : `${out('v')} = ${inp(n, 'a', 'num')} ${p.op === '<' ? '<' : '>'} ${lit(num(p.value, 0.5))}f;`); break;
      case 'blink': {
        const per = Math.max(20, Math.round(num(p.period, 1000))), on = Math.round(per * Math.max(0, Math.min(100, num(p.duty, 50))) / 100);
        L.push(py ? `${out('v')} = t % ${per} < ${on}` : `${out('v')} = t % ${per} < ${on};`);
        break;
      }
      case 'toggle':
        V.push(py ? `${id}_elozo = False` : `bool ${id}_elozo = false;`);
        L.push(...(py ? [`_be = ${inp(n, 'a', 'bool')}`, `if _be and not ${id}_elozo:  ${c('felfutó él')}`, `    ${out('v')} = not ${out('v')}`, `${id}_elozo = _be`]
          : [`{ bool be = ${inp(n, 'a', 'bool')};`, `  if (be && !${id}_elozo) ${out('v')} = !${out('v')};  ${c('felfutó él')}`, `  ${id}_elozo = be; }`]));
        break;
      case 'counter': {
        const m = Math.max(1, Math.round(num(p.max, 4)));
        V.push(py ? `${id}_elozo = False` : `bool ${id}_elozo = false;`, py ? `${id}_db = 0` : `int ${id}_db = 0;`);
        L.push(...(py ? [`_be = ${inp(n, 'a', 'bool')}`, `if _be and not ${id}_elozo:`, `    ${id}_db = (${id}_db + 1) % ${m}`, `${id}_elozo = _be`, `if ${inp(n, 'r', 'bool')}:`, `    ${id}_db = 0`,
          `${out('n')} = ${id}_db`, `${out('f')} = ${m > 1 ? `${id}_db / ${m - 1}` : '0'}`]
          : [`{ bool be = ${inp(n, 'a', 'bool')};`, `  if (be && !${id}_elozo) ${id}_db = (${id}_db + 1) % ${m};`, `  ${id}_elozo = be;`, `  if (${inp(n, 'r', 'bool')}) ${id}_db = 0; }`,
            `${out('n')} = ${id}_db;`, `${out('f')} = ${m > 1 ? `${id}_db / ${m - 1}.0f` : '0'};`]));
        break;
      }
      case 'delay': {
        const ms = Math.max(0, Math.round(num(p.ms, 500))), mode = String(p.mode ?? 'filter');
        const be = inp(n, 'a', 'bool');
        if (mode === 'off') {
          V.push(py ? `${id}_mikor = -${ms}` : `long ${id}_mikor = -${ms};`);
          L.push(...(py ? [`_be = ${be}`, `if _be:`, `    ${id}_mikor = t`, `${out('v')} = _be or t - ${id}_mikor < ${ms}  ${c('utánfutás')}`]
            : [`{ bool be = ${be};`, `  if (be) ${id}_mikor = (long)t;`, `  ${out('v')} = be || (long)t - ${id}_mikor < ${ms}; }  ${c('utánfutás')}`]));
        } else if (mode === 'pulse') {
          V.push(py ? `${id}_mikor = -${ms}` : `long ${id}_mikor = -${ms};`, py ? `${id}_elozo = False` : `bool ${id}_elozo = false;`);
          L.push(...(py ? [`_be = ${be}`, `if _be and not ${id}_elozo and t - ${id}_mikor >= ${ms}:  ${c('felfutó él: impulzus')}`, `    ${id}_mikor = t`, `${id}_elozo = _be`, `${out('v')} = t - ${id}_mikor < ${ms}`]
            : [`{ bool be = ${be};`, `  if (be && !${id}_elozo && (long)t - ${id}_mikor >= ${ms}) ${id}_mikor = (long)t;  ${c('felfutó él: impulzus')}`, `  ${id}_elozo = be;`, `  ${out('v')} = (long)t - ${id}_mikor < ${ms}; }`]));
        } else {
          V.push(py ? `${id}_utolso = None` : `int ${id}_utolso = -1;`, py ? `${id}_mikor = 0` : `unsigned long ${id}_mikor = 0;`);
          const on = mode === 'on';
          L.push(...(py ? [`_be = ${be}`, `if _be != ${id}_utolso:`, `    ${id}_utolso = _be`, `    ${id}_mikor = t`,
            ...(on ? [`${out('v')} = _be and t - ${id}_mikor >= ${ms}  ${c('bekapcsolási késleltetés')}`] : [`if t - ${id}_mikor >= ${ms}:`, `    ${out('v')} = _be`])]
            : [`{ bool be = ${be};`, `  if ((int)be != ${id}_utolso) { ${id}_utolso = be; ${id}_mikor = t; }`,
              on ? `  ${out('v')} = be && t - ${id}_mikor >= ${ms}; }  ${c('bekapcsolási késleltetés')}` : `  if (t - ${id}_mikor >= ${ms}) ${out('v')} = be; }`]));
        }
        break;
      }
      case 'seq': {
        const rows = seqRows(p.preset, p.custom), cnt = rows.length, back = p.dir === 'back';
        V.push(...(py ? [`${id}_minta = [${rows.map(r => `'${r}'`).join(', ')}]`, `${id}_i = 0`, `${id}_elozo = True  ${c('induláskor nem lép')}`]
          : [`const char* ${id}_minta[${cnt}] = {${rows.map(r => `"${r}"`).join(', ')}};`, `int ${id}_i = 0;`, `bool ${id}_elozo = true;  ${c('induláskor nem lép')}`]));
        const r = inp(n, 'r', 'bool'), lep = inp(n, 'a', 'bool');
        const dirE = back ? (py ? `1 if ${r} else -1` : `${r} ? 1 : -1`) : (py ? `-1 if ${r} else 1` : `${r} ? -1 : 1`);
        L.push(...(py ? [`_be = ${lep}`, `if _be and not ${id}_elozo:  ${c('felfutó él: következő sor')}`, `    ${id}_i = (${id}_i + (${dirE})) % ${cnt}`, `${id}_elozo = _be`,
          ...[0, 1, 2, 3].map(k => `${out('c' + k)} = ${id}_minta[${id}_i][${k}] == '1'`), `${out('n')} = ${id}_i`]
          : [`{ bool be = ${lep};`, `  if (be && !${id}_elozo) ${id}_i = (${id}_i + (${dirE}) + ${cnt}) % ${cnt};  ${c('felfutó él: következő sor')}`, `  ${id}_elozo = be; }`,
            ...[0, 1, 2, 3].map(k => `${out('c' + k)} = ${id}_minta[${id}_i][${k}] == '1';`), `${out('n')} = ${id}_i;`]));
        break;
      }
      case 'out':
        S.push(py ? `${id}_pin = Pin(${pin!.gpio}, Pin.OUT)  ${c(`${pin!.ref} → ${pin!.name}`)}` : `pinMode(${pin!.gpio}, OUTPUT);  ${c(`${pin!.ref} → ${pin!.name}`)}`);
        L.push(py ? `${id}_pin.value(1 if ${inp(n, 'a', 'bool')} else 0)` : `digitalWrite(${pin!.gpio}, ${inp(n, 'a', 'bool')} ? HIGH : LOW);`);
        break;
      case 'pwm': {
        const f = Math.max(1, Math.round(num(p.freq, 1000)));
        if (py) S.push(`${id}_pwm = PWM(Pin(${pin!.gpio}))  ${c(`${pin!.ref} → ${pin!.name}`)}`, `${id}_pwm.freq(${f})`);
        else S.push(`pinMode(${pin!.gpio}, OUTPUT);  ${c(`${pin!.ref} → ${pin!.name}`)}`, (target ? target.pwmFreq : 'analogWriteFreq({f});').replace('{pin}', String(pin!.gpio)).replace('{f}', String(f)));
        const duty = byTo.has(n.id + '.a') ? inp(n, 'a', 'num') : lit(Math.max(0, Math.min(100, num(p.duty, 50))) / 100); // bemenet nélkül a beállított kitöltés
        L.push(py ? `${id}_pwm.duty_u16(int(max(0, min(1, ${duty})) * 65535))` : `analogWrite(${pin!.gpio}, (int)(constrain(${duty}, 0.0f, 1.0f) * 255));`);
        break;
      }
    }
    const head = c(`${n.id} · ${d.label}`);
    setup.push([n.id, S]); vars.push([n.id, V]); step.push([n.id, L.length ? [head, ...L] : []]);
  }

  // összeállítás, a csomópontok sorainak nyilvántartásával
  const lines: Record<string, Array<[number, number]>> = {}, outL: string[] = [];
  const emit = (id: string | null, ls: string[], ind: string) => {
    if (!ls.length) return;
    const a = outL.length + 1;
    for (const l of ls) outL.push(ind + l);
    if (id) (lines[id] = lines[id] || []).push([a, outL.length]);
  };
  const title = `Proofboard – generált program${board ? ` (${board})` : ''}`;
  if (py) {
    emit(null, [`# ${title}`, '# Ütemenként (20 ms) beolvassa a bemeneteket, kiszámolja a blokkokat, és beállítja a kimeneteket.', 'from machine import Pin, ADC, PWM', 'import time', '', '# --- lábak ---'], '');
    for (const [id, S] of setup) emit(id, S, '');
    emit(null, ['', '# --- blokkok értékei és állapota ---'], '');
    for (const [id, V] of vars) emit(id, V, '');
    emit(null, ['', 'kezdet = time.ticks_ms()', 'while True:', '    t = time.ticks_diff(time.ticks_ms(), kezdet)'], '');
    for (const [id, L] of step) emit(id, L, '    ');
    emit(null, ['    time.sleep_ms(20)'], '');
  } else {
    emit(null, [`// ${title}`, '// Ütemenként (20 ms) beolvassa a bemeneteket, kiszámolja a blokkokat, és beállítja a kimeneteket.',
      ...(target ? [`// Lap: ${target.fqbn}${target.boardUrl ? ` (alaplapkezelő: ${target.boardUrl})` : ''}`] : []), '', '// --- blokkok értékei és állapota ---'], '');
    for (const [id, V] of vars) emit(id, V, '');
    emit(null, ['', 'void setup() {', '  analogReadResolution(12);'], '');
    for (const [id, S] of setup) emit(id, S, '  ');
    emit(null, ['}', '', 'void loop() {', '  unsigned long t = millis();'], '');
    for (const [id, L] of step) emit(id, L, '  ');
    emit(null, ['  delay(20);', '}'], '');
  }
  return { lang, file: py ? 'main.py' : 'proofboard.ino', code: outL.join('\n') + '\n', lines, warnings, board, target };
}

/** PlatformIO-projekt fájljai: platformio.ini és src/main.cpp (az Arduino-kód, Arduino.h-val). */
export function platformioFiles(c: CodeOut): Array<{ name: string; text: string }> {
  const t = c.target;
  const ini = ['; Proofboard – PlatformIO-projekt' + (c.board ? ` (${c.board})` : ''), '[env:proofboard]',
    `platform = ${t ? t.pio.platform : 'espressif32'}`, `board = ${t ? t.pio.board : 'esp32dev'}`, 'framework = arduino', 'monitor_speed = 115200', ...(t && t.pio.extra ? t.pio.extra : [])];
  return [{ name: 'platformio.ini', text: ini.join('\n') + '\n' }, { name: 'src/main.cpp', text: '#include <Arduino.h>\n\n' + c.code }];
}
