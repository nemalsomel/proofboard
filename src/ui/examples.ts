/**
 * Példatervek: egy-egy alkatrész vagy funkció bemutatása, magyarázó jegyzetekkel.
 * Tiszta adat (DOM nélkül): a betöltést az app végzi (útvonaltervezés, kézi rögzítés, jelsorozat).
 */

export interface ExPart { id: string; type: string; label: string; r: number; c: number; rot?: number; mir?: boolean; props?: Record<string, unknown> }
export interface ExNote { r: number; c: number; w: number; h: number; text: string; color?: string; target?: string }
export interface ExDesign {
  board: { rows: number; cols: number; sec: number };
  parts: ExPart[];
  links: Array<[string, string]>;
  notes: ExNote[];
  gpio?: Record<string, string>;
  pwm?: Record<string, { duty: number; freq: number }>;
  settings?: Record<string, unknown>;
}
export interface Example {
  id: string;
  cat: string;
  title: string;
  desc: string;
  design: ExDesign;
  /** Betöltés után az útvonalkereső hídjai kézi hidakká válnak, a kapcsolatok törlődnek. */
  freeze?: boolean;
  /** Jelsorozat: a csatornák azok a GPIO-k, amelyekre a megadott lábak kapcsolata került. */
  signal?: { preset: string; custom?: string; from: string[]; rate?: number };
}

export const EX_CATS = ['Alapok', 'Bemenet', 'Félvezető', 'Passzív', 'Motor', 'Logika', 'Modul'] as const;

const YEL = '#fff3bf', GRN = '#d3f9d8', BLU = '#d0ebff';
const PICO: ExPart = { id: 'p1', type: 'pico', label: 'PICO', r: 12, c: 32, rot: 2, props: { span: 6 } };
const B = { rows: 48, cols: 39, sec: 3 };
const two = (id: string, type: string, label: string, r: number, c: number, dc: number, props: Record<string, unknown> = {}, rot = 0): ExPart =>
  ({ id, type, label, r, c, rot, props: { dr: 0, dc, ...props } });
const res = (id: string, label: string, r: number, c: number, ohm: number, dc = 4, rot = 0) => two(id, 'res', label, r, c, dc, { ohm }, rot);
const led = (id: string, label: string, r: number, c: number, color = 'red', rot = 0) => two(id, 'led', label, r, c, 1, { color }, rot);
const note = (r: number, c: number, w: number, h: number, text: string, color = YEL, target?: string): ExNote => ({ r, c, w, h, text, color, ...(target ? { target } : {}) });
const pico = (parts: ExPart[], links: Array<[string, string]>, notes: ExNote[], extra: Partial<ExDesign> = {}): ExDesign =>
  ({ board: { ...B }, parts: [PICO, ...parts], links, notes, ...extra });

/* ---------- Alapok: akku + ellenállás + LED ---------- */
const ledParts: ExPart[] = [
  { id: 'p1', type: 'bat', label: 'BT1', r: 4, c: 3, props: { volt: 3.7 } },
  res('p2', 'R1', 10, 3, 330),
  led('p3', 'LED1', 16, 7, 'green'),
];
const ledLinks: Array<[string, string]> = [['p1.+', 'p2.1'], ['p2.2', 'p3.A'], ['p3.K', 'p1.-']];
const SMALL = { rows: 21, cols: 26, sec: 3 };

export const EXAMPLES: Example[] = [
  {
    id: 'led-manual', cat: 'Alapok', title: 'LED akkuról – kézi hidakkal',
    desc: 'Akku, előtét-ellenállás és LED, forrasztóhidakkal bekötve.',
    freeze: true,
    design: {
      board: { ...SMALL }, parts: ledParts, links: ledLinks, settings: { autoRoute: false },
      notes: [note(1, 12, 13, 8, 'Kézi hidak\nA réz 3 lyukas szakaszokból áll; a hidak (Forrasztóhíd eszköz, B) kötik össze a szomszédos szakaszokat.\nAz áramkör: akku + → R1 → LED1 → akku −.'),
        note(11, 12, 13, 8, 'Próbáld ki\nIndítsd a szimulációt: a LED világít, kb. 6 mA folyik.\nTörölj ki egy hidat (E): a kör megszakad, a LED kialszik.', GRN, 'p3')],
    },
  },
  {
    id: 'led-auto', cat: 'Alapok', title: 'LED akkuról – útvonalkeresővel',
    desc: 'Ugyanaz a kör kapcsolatokkal: a hidakat az útvonalkereső húzza be.',
    design: {
      board: { ...SMALL }, parts: ledParts, links: ledLinks,
      notes: [note(1, 12, 13, 8, 'Kapcsolatok\nItt nincs kézi híd: a Terv fül Kapcsolatok listája mondja meg, mit mivel kell összekötni, a hidakat az útvonalkereső tervezi.'),
        note(11, 12, 13, 8, 'Próbáld ki\nMozgasd el az R1-et vagy a LED-et (húzással): a hidak automatikusan újraterveződnek.', GRN, 'p2')],
    },
  },
  {
    id: 'strip', cat: 'Alapok', title: 'Csíkos panel, csíkvágással',
    desc: 'Teljes hosszú rézcsíkok; a csíkvágás választja szét a hálózatokat.',
    design: {
      board: { rows: 21, cols: 26, sec: 21 },
      parts: [{ id: 'p1', type: 'bat', label: 'BT1', r: 3, c: 3, props: { volt: 3.7 } }, res('p2', 'R1', 9, 4, 330, 4, 1), led('p3', 'LED1', 15, 4, 'yellow', 1)],
      links: [['p1.+', 'p2.1'], ['p2.2', 'p3.A'], ['p3.K', 'p1.-']], settings: { autoCut: true },
      notes: [note(1, 12, 13, 9, 'Csíkos panel\nMinden oszlop egyetlen hosszú rézcsík. Ha egy csíkon több hálózat lába van, a csíkot el kell vágni közöttük.\nAz „Automatikus csíkvágás” ezt a kapcsolatokból megteszi.'),
        note(12, 12, 13, 8, 'Próbáld ki\nCsíkvágás eszköz (K): kattints két lyuk közé (rés) vagy egy lyuk közepére (kifúrás).', GRN)],
    },
  },
  /* ---------- Bemenet ---------- */
  {
    id: 'button', cat: 'Bemenet', title: 'Nyomógomb a Picón',
    desc: 'Gomb a GPIO és a GND között, belső felhúzással; mellette egy kimenetre kötött LED.',
    design: pico([
      { id: 'p2', type: 'button', label: 'SW1', r: 20, c: 8 },
      res('p3', 'R1', 20, 26, 330), led('p4', 'LED1', 26, 30),
    ], [['p2.A1', 'GPIO'], ['p2.B1', 'GND'], ['p3.1', 'p1.20'], ['p3.2', 'p4.A'], ['p4.K', 'GND']], [
      note(31, 2, 16, 9, 'Bemenet felhúzással\nA GPIO belső felhúzó ellenállással alapból 1 (3,3 V). A gomb lenyomva a földre húzza: 0.\nSzimulációban kattints a gombra, és figyeld a GPIO táblát.', YEL, 'p2'),
      note(31, 20, 16, 9, 'Kimenet\nA GP15 „ki: 1” módban van: R1-en át a LED világít. A Szimuláció fülön átállíthatod 0-ra.', GRN, 'p4'),
    ], { gpio: { 'p1.20': 'out_high' } }),
  },
  {
    id: 'joystick', cat: 'Bemenet', title: 'Joystick – analóg bemenet',
    desc: 'Két potméter (X, Y) az ADC-képes GPIO-kon, a gomb digitális bemenet.',
    design: pico([{ id: 'p2', type: 'joystick', label: 'JS1', r: 22, c: 14 }],
      [['p2.GND', 'GND'], ['p2.5V', 'p1.36'], ['p2.VRX', 'GPIO'], ['p2.VRY', 'GPIO'], ['p2.SW', 'GPIO']], [
        note(31, 2, 17, 9, 'ADC\nA VRx és VRy feszültsége a kar állásától függ. Csak a GP26–28 tud analóg értéket mérni: az útvonalkereső ezekre köti őket.\nA tápot a 3V3 adja (nem 5 V!), különben túllépnénk az ADC tartományát.', YEL, 'p2'),
        note(31, 21, 15, 9, 'Próbáld ki\nSzimulációban a Vezérlők csúszkáival mozgasd a kart: a GPIO táblában változik a mért feszültség.', GRN),
      ]),
  },
  /* ---------- Félvezető ---------- */
  {
    id: 'npn', cat: 'Félvezető', title: 'NPN tranzisztor kapcsolóként',
    desc: 'A GPIO bázisárama kapcsolja a VBUS-ról táplált LED-et.',
    design: pico([
      res('p2', 'R1', 20, 22, 1000), { id: 'p3', type: 'npn', label: 'Q1', r: 24, c: 14, props: { kind: 'BC547' } },
      res('p4', 'R2', 20, 6, 220), led('p5', 'LED1', 26, 6, 'blue'),
    ], [['p2.1', 'p1.20'], ['p2.2', 'p3.B'], ['p3.E', 'GND'], ['p3.C', 'p5.K'], ['p5.A', 'p4.2'], ['p4.1', 'p1.40']], [
      note(31, 2, 17, 9, 'Alsó oldali kapcsoló\nA GPIO (GP15) R1-en át kis bázisáramot ad; a tranzisztor telítésbe megy, és a LED a föld felé záródik. A LED árama nem a GPIO-ból jön.', YEL, 'p3'),
      note(31, 21, 15, 9, 'Próbáld ki\nÁllítsd a GP15-öt 0-ra: a tranzisztor lezár. Növeld R1-et 100 kΩ-ra: aktív tartományba kerül, a LED halványabb.', GRN, 'p2'),
    ], { gpio: { 'p1.20': 'out_high' } }),
  },
  {
    id: 'mosfet-pwm', cat: 'Félvezető', title: 'MOSFET és PWM – LED fényereje',
    desc: 'N-MOSFET a LED alatt, a kapura PWM jel; a fényerő a kitöltéssel arányos.',
    design: pico([
      { id: 'p2', type: 'nmos', label: 'Q1', r: 24, c: 16 }, res('p3', 'R1', 20, 6, 150), led('p4', 'LED1', 26, 8, 'white'),
      res('p5', 'R2', 28, 22, 100000),
    ], [['p2.G', 'p1.20'], ['p2.S', 'GND'], ['p2.D', 'p4.K'], ['p4.A', 'p3.2'], ['p3.1', 'p1.40'], ['p5.1', 'p2.G'], ['p5.2', 'GND']], [
      note(32, 2, 17, 9, 'PWM\nA GP15 1 kHz-es PWM-jele gyorsan ki-be kapcsolja a MOSFET-et, ami az 5 V-ról (VBUS) táplált LED-et kapcsolja. A szimuláció az átlagáramot mutatja: 30 % kitöltésnél kb. a teljes áram 30 %-a.', YEL, 'p2'),
      note(32, 21, 15, 9, 'Lehúzó ellenállás\nR2 (100 kΩ) indításkor, amíg a GPIO még bemenet, zárva tartja a MOSFET-et.', GRN, 'p5'),
    ], { gpio: { 'p1.20': 'pwm' }, pwm: { 'p1.20': { duty: 30, freq: 1000 } } }),
  },
  /* ---------- Passzív ---------- */
  {
    id: 'rc', cat: 'Passzív', title: 'RC tag – időállandó',
    desc: 'Ellenállás és elektrolit kondenzátor: τ = R·C.',
    design: pico([
      res('p2', 'R1', 20, 12, 10000), two('p3', 'elko', 'C1', 26, 16, 1, { f: 0.0001, volt: 16 }),
    ], [['p2.1', 'p1.36'], ['p2.2', 'p3.+'], ['p3.-', 'GND']], [
      note(31, 2, 17, 9, 'Időállandó\nR1 = 10 kΩ és C1 = 100 µF: τ = 1 s. Ennyi idő alatt töltődik fel a kondenzátor kb. 63 %-ra, 5τ alatt gyakorlatilag teljesen.', YEL, 'p3'),
      note(31, 21, 15, 9, 'Próbáld ki\nA Szimuláció fülön a kondenzátor sorában látod a τ-t. Írd át R1 értékét, és figyeld, hogyan változik.', GRN, 'p2'),
    ]),
  },
  /* ---------- Motor ---------- */
  {
    id: 'dc-motor', cat: 'Motor', title: 'DC motor MOSFET-tel és PWM-mel',
    desc: 'Külső motor kábellel; visszacsapó dióda, fordulatszám PWM-mel.',
    design: pico([
      { id: 'p2', type: 'motor', label: 'M1', r: 26, c: -5 }, { id: 'p3', type: 'nmos', label: 'Q1', r: 24, c: 16 },
      two('p4', 'diode', 'D1', 20, 6, 4, { kind: '1N5817' }),
    ], [['p2.+', 'p1.40'], ['p2.-', 'p3.D'], ['p3.S', 'GND'], ['p3.G', 'p1.20'], ['p4.K', 'p2.+'], ['p4.A', 'p2.-']], [
      note(31, 2, 17, 9, 'Visszacsapó dióda\nA motor tekercse kikapcsoláskor feszültségcsúcsot ad. D1 (Schottky) ezt rövidre zárja, és védi a MOSFET-et.', YEL, 'p4'),
      note(31, 21, 15, 9, 'Próbáld ki\nIndítsd a szimulációt: a motor forog. A GP15 kitöltését állítva változik a fordulat.', GRN, 'p2'),
    ], { gpio: { 'p1.20': 'pwm' }, pwm: { 'p1.20': { duty: 60, freq: 1000 } } }),
  },
  {
    id: 'servo', cat: 'Motor', title: 'Szervó (SG90)',
    desc: '50 Hz-es PWM: az impulzus szélessége adja a szöget.',
    design: pico([{ id: 'p2', type: 'servo', label: 'SV1', r: 26, c: -6 }],
      [['p2.GND', 'GND'], ['p2.V+', 'p1.40'], ['p2.SIG', 'p1.20']], [
        note(31, 2, 17, 9, 'Szervójel\n50 Hz (20 ms periódus): 0,5 ms impulzus = 0°, 1,5 ms = 90°, 2,5 ms = 180°. Kitöltésben: 2,5 % … 12,5 %.', YEL, 'p2'),
        note(31, 21, 15, 9, 'Próbáld ki\nA GP15 kitöltése most 7,5 % (középállás). Írd át 5 %-ra vagy 10 %-ra.', GRN),
      ], { gpio: { 'p1.20': 'pwm' }, pwm: { 'p1.20': { duty: 7.5, freq: 50 } } }),
  },
  {
    id: 'stepper', cat: 'Motor', title: 'Léptetőmotor ULN2003-mal',
    desc: '28BYJ-48 léptetőmotor meghajtóval; a Jelsorozat lépteti a tekercseket.',
    signal: { preset: 'half', from: ['p2.IN1', 'p2.IN2', 'p2.IN3', 'p2.IN4'], rate: 8 },
    design: pico([{ id: 'p2', type: 'uln2003', label: 'U1', r: 22, c: 14 }, { id: 'p3', type: 'stepper', label: 'M1', r: 26, c: -8 }],
      [['p2.IN1', 'GPIO'], ['p2.IN2', 'GPIO'], ['p2.IN3', 'GPIO'], ['p2.IN4', 'GPIO'], ['p2.GND', 'GND'], ['p2.VCC', 'p1.40'],
        ['p3.A', 'p2.A'], ['p3.B', 'p2.B'], ['p3.C', 'p2.C'], ['p3.D', 'p2.D'], ['p3.COM', 'p2.COM']], [
        note(31, 2, 17, 10, 'Meghajtó\nA GPIO nem bír el egy tekercset (kb. 100 mA). A ULN2003 bemenete a 3,3 V-os jelet fogadja, a kimenete a tekercset a föld felé kapcsolja; a közös + a VBUS 5 V-ja.', YEL, 'p2'),
        note(31, 21, 15, 10, 'Próbáld ki\nIndítsd a szimulációt, majd a Szimuláció fülön a Jelsorozatban ▶ Lejátszás. Félléptetésben 8 minta ismétlődik; a mutató a forgórész szöge.', GRN, 'p3'),
      ]),
  },
  /* ---------- Logika ---------- */
  {
    id: 'nand', cat: 'Logika', title: 'NAND kapu két gombbal',
    desc: '74HC00 felhúzott bemenetekkel: a LED akkor világít, ha legalább az egyik gomb le van nyomva.',
    design: pico([
      { id: 'p2', type: 'hc00', label: 'U1', r: 22, c: 16 },
      { id: 'p3', type: 'button', label: 'SW1', r: 29, c: 2 }, { id: 'p4', type: 'button', label: 'SW2', r: 29, c: 9 },
      res('p5', 'R1', 18, 4, 10000), res('p6', 'R2', 18, 10, 10000), res('p7', 'R3', 20, 26, 330), led('p8', 'LED1', 26, 30, 'red'),
    ], [['p2.14', 'p1.36'], ['p2.7', 'GND'], ['p2.1', 'p5.2'], ['p5.1', 'p1.36'], ['p2.2', 'p6.2'], ['p6.1', 'p1.36'],
      ['p3.A1', 'p2.1'], ['p3.B1', 'GND'], ['p4.A1', 'p2.2'], ['p4.B1', 'GND'], ['p2.3', 'p7.1'], ['p7.2', 'p8.A'], ['p8.K', 'GND'],
      ['p2.4', 'GND'], ['p2.5', 'GND'], ['p2.9', 'GND'], ['p2.10', 'GND'], ['p2.12', 'GND'], ['p2.13', 'GND']], [
      note(36, 2, 17, 10, 'NAND = NEM-ÉS\nY = !(A & B): a kimenet csak akkor 0, ha mindkét bemenet 1. R1 és R2 felhúz, a gomb lenyomva 0-t ad. Elengedett gomboknál Y = 0, a LED sötét; bármelyik gombot nyomva Y = 1, a LED világít.', YEL, 'p2'),
      note(36, 21, 15, 10, 'Ki nem használt bemenetek\nA többi kapu bemenete a földre van kötve: CMOS bemenetet nem szabad lebegve hagyni.\nAz 1B-t körbezárják a szomszéd lábak, ezért oda vezeték kell (lásd Ellenőrzés).', GRN),
    ]),
  },
  {
    id: 'decoder', cat: 'Logika', title: '2→4 dekóder (74HC139)',
    desc: 'Két bemeneti bitből pontosan egy kimenet aktív (alacsony); a Jelsorozat számol.',
    signal: { preset: 'custom', custom: '00 10 01 11', from: ['p2.2', 'p2.3'], rate: 2 },
    design: pico([
      { id: 'p2', type: 'hc139', label: 'U1', r: 20, c: 8 },
      ...[0, 1, 2, 3].map(i => res('p' + (3 + i), 'R' + (1 + i), 29 + 3 * i, 6 + i, 220)),
      ...[0, 1, 2, 3].map(i => led('p' + (7 + i), 'LED' + (1 + i), 27 + 3 * i, 10 + i, ['red', 'orange', 'yellow', 'green'][i])),
    ], [['p2.16', 'p1.36'], ['p2.8', 'GND'], ['p2.1', 'GND'], ['p2.2', 'GPIO'], ['p2.3', 'GPIO'],
      ...[0, 1, 2, 3].flatMap(i => [['p' + (7 + i) + '.K', 'p2.' + (4 + i)], ['p' + (7 + i) + '.A', 'p' + (3 + i) + '.2'], ['p' + (3 + i) + '.1', 'p1.36']] as Array<[string, string]>),
      ['p2.15', 'p1.36'], ['p2.13', 'GND'], ['p2.14', 'GND']], [
      note(27, 21, 17, 10, 'Dekóder\nAz A1A0 kétbites szám (0–3) kiválasztja az egyik kimenetet: az lesz 0, a többi 1. A LED-ek a 3V3 felől kapnak áramot, ezért az aktív (alacsony) kimenetnél világítanak.', YEL, 'p2'),
      note(38, 21, 17, 10, 'Próbáld ki\nSzimulációban a Jelsorozat 00 → 10 → 01 → 11 sorrendben lépteti az A0, A1 bemenetet: a fény végigfut a LED-eken.\nAz 1A0 lábat körbezárják a szomszédai: oda vezeték kell.', GRN),
    ]),
  },
  {
    id: 'toggle', cat: 'Logika', title: 'D tároló: be-ki kapcsoló gombbal',
    desc: '74HC74, a D-t a negált kimenetre kötve: minden gombnyomásra vált.',
    design: pico([
      { id: 'p2', type: 'hc74', label: 'U1', r: 22, c: 16 },
      { id: 'p3', type: 'button', label: 'SW1', r: 29, c: 4 }, res('p4', 'R1', 20, 4, 10000),
      res('p5', 'R2', 20, 26, 330), led('p6', 'LED1', 26, 30, 'green'), two('p7', 'jumper', 'J1', 28, 17, 4),
    ], [['p2.14', 'p1.36'], ['p2.7', 'GND'], ['p2.1', 'p1.36'], ['p2.4', 'p1.36'], ['p2.2', 'p7.1'], ['p7.2', 'p2.6'],
      ['p2.3', 'p4.2'], ['p4.1', 'GND'], ['p3.A1', 'p2.3'], ['p3.B1', 'p1.36'],
      ['p2.5', 'p5.1'], ['p5.2', 'p6.A'], ['p6.K', 'GND'],
      ['p2.13', 'p1.36'], ['p2.10', 'p1.36'], ['p2.12', 'GND'], ['p2.11', 'GND']], [
      note(36, 2, 17, 10, 'Tároló\nA CLK felfutó élén a Q felveszi a D értékét, és megtartja. J1 átkötés miatt D = Q̅, így minden élnél az ellenkezőjére vált: két gombnyomás = egy teljes periódus (osztó).', YEL, 'p2'),
      note(36, 21, 15, 10, 'Próbáld ki\nSzimulációban kattints a gombra (Kapcsoló módban is): a LED minden nyomásra vált. A Szimuláció fülön látod a tároló állapotát.', GRN, 'p3'),
    ]),
  },
  /* ---------- Modul ---------- */
  {
    id: 'nokia', cat: 'Modul', title: 'Nokia 5110 kijelző bekötése',
    desc: 'SPI vezérlőjelek a GPIO-kra, 3,3 V-os táp, háttérvilágítás ellenálláson át.',
    design: pico([{ id: 'p2', type: 'nokia5110', label: 'LCD1', r: 26, c: 14 }, res('p3', 'R1', 20, 26, 330)],
      [['p2.RST', 'GPIO'], ['p2.CE', 'GPIO'], ['p2.DC', 'GPIO'], ['p2.DIN', 'GPIO'], ['p2.CLK', 'GPIO'], ['p2.VCC', 'p1.36'], ['p2.GND', 'GND'], ['p2.BL', 'p3.2'], ['p3.1', 'p1.36']], [
        note(38, 2, 17, 9, 'Modul\nA modul lábszerepei (táp, föld, jel) alapján az ellenőrzés figyeli, hogy a tápja a megengedett tartományban van-e. A jeleket az útvonalkereső szabad GPIO-kra köti.', YEL, 'p2'),
        note(38, 21, 15, 9, 'Háttérvilágítás\nA BL egy LED: R1 korlátozza az áramát.', GRN, 'p3'),
      ]),
  },
  {
    id: 'tp4056', cat: 'Modul', title: 'Akkus táp TP4056 töltővel',
    desc: 'Li-ion akku a töltőmodulon, a Pico VSYS-e Schottky-diódán át.',
    design: pico([
      { id: 'p2', type: 'tp4056', label: 'U1', r: 20, c: 10 }, { id: 'p3', type: 'bat', label: 'BT1', r: 34, c: 4, props: { volt: 3.7 } },
      two('p4', 'diode', 'D1', 20, 24, 4, { kind: '1N5817' }),
    ], [['p2.B+', 'p3.+'], ['p2.B-', 'p3.-'], ['p2.OUT+', 'p4.A'], ['p4.K', 'p1.39'], ['p2.OUT-', 'GND']], [
      note(37, 12, 13, 10, 'Miért kell a dióda?\nHa USB is csatlakozik, a VBUS a VSYS-en át az akkut töltené a töltő megkerülésével. A Schottky-dióda ezt megakadályozza.', YEL, 'p4'),
      note(37, 26, 12, 10, 'Próbáld ki\nKapcsold ki az USB-t a Szimuláció fülön: a Pico az akkuról megy.', GRN),
    ]),
  },
];
