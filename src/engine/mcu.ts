/**
 * Vezérlőlapok GPIO-képességei (caps): ADC, csak bemenet, felhúzás nélkül, indítási láb, soros port,
 * beépített LED, buszfunkciók (I²C, SPI, UART, PWM-szelet). Ellenőrzés, GPIO-módok és útvonalkereső közös alapja.
 */
import type { LocalPin, PartInstance } from '../core/schema';
import { DEFS, isMcu } from './defs';

type CapPin = Pick<LocalPin, 'caps'> | null | undefined;
type GpioPin = Pick<LocalPin, 'caps' | 'role'> & { part: PartInstance };

export const hasCap = (q: CapPin, c: string): boolean => !!(q && q.caps && q.caps.includes(c));
/** ADC-képes (ADC1 vagy ADC2). */
export const hasAdc = (q: CapPin): boolean => hasCap(q, 'adc') || hasCap(q, 'adc2');

/** Különleges GPIO-képességek: az útvonalkereső kerüli őket, használatuk figyelmeztetés (a lábankénti szöveg a leírás meta.pinNotes-ában). */
export const SPECIAL_CAPS: ReadonlyArray<readonly [string, string]> = [
  ['strap', 'indítási (strapping) láb: bekapcsoláskor számít a szintje, rossz szintnél a lap nem indul el vagy letöltő módba kerül. Ha lehet, válassz másik GPIO-t.'],
  ['uart0', 'a soros port (USB-soros átalakító) használja: feltöltéskor és soros kiíráskor zavarhat. Ha lehet, válassz másik GPIO-t.'],
  ['usb', 'a beépített USB használja. Ha lehet, válassz másik GPIO-t.'],
  ['led', 'a lap beépített LED-je is ezen a lábon van.'],
];

/*
 * Buszfunkciók: a periféria lába (fn: 'spi.mosi'…) a vezérlő megfelelő képességű GPIO-jára (caps: 'spi0.mosi'…) kerüljön.
 * A periféria UART RX-e a vezérlő TX-ére megy, és fordítva. 'matrix' vezérlőn (ESP32) bármely láb kiosztható, a képesség az alapértelmezés.
 */
const FN_WANT: Record<string, string> = { 'uart.rx': 'uart.tx', 'uart.tx': 'uart.rx' };
export const fnWant = (fn: string): string => FN_WANT[fn] || fn;
/** A láb képességei közül azok, amelyek a periféria `fn` funkciójához illenek. */
export function fnCaps(q: CapPin, fn: string): string[] {
  const [bus, sig] = fnWant(fn).split('.');
  const re = new RegExp('^' + bus + '\\d+\\.' + sig + '$');
  return ((q && q.caps) || []).filter(c => re.test(c));
}
/** A vezérlő lábkiosztása: 'fixed' (Pico) vagy 'matrix' (ESP32: bármely láb bármely funkcióra). */
export function mcuMux(p: PartInstance): 'fixed' | 'matrix' {
  const el = (DEFS[p.type].def.model || []).find(e => e.el === 'mcu');
  return (el && el.el === 'mcu' && el.mux) || 'fixed';
}
export function capLabel(c: string): string {
  const m = /^(i2c|spi|uart|pwm)(\d*)\.([a-z]+)$/.exec(c);
  return m ? `${m[1].toUpperCase()}${m[2]} ${m[3].toUpperCase()}` : c.toUpperCase();
}
export const fnName = (fn: string): string => capLabel(fn);
/** A vezérlőláb funkciói olvasható formában (busz, PWM, DAC, ADC). */
export const pinFns = (q: Pick<LocalPin, 'caps'>): string[] => [
  ...(hasCap(q, 'adc') ? ['ADC'] : hasCap(q, 'adc2') ? ['ADC2'] : []),
  ...(q.caps || []).filter(c => c.includes('.') || c === 'dac').map(capLabel),
  ...(hasCap(q, 'in') ? ['csak bemenet'] : []),
];
/** Útvonalkereső-büntetés, ha a cél-GPIO nem a periféria buszfunkciójára való. */
export const fnPenalty = (fn: string | undefined, q: GpioPin | null | undefined): number =>
  !fn || !q || fnCaps(q, fn).length ? 0 : mcuMux(q.part) === 'matrix' ? 10 : 16;
/** Útvonalkereső-büntetés a különleges (indítási, soros, LED) lábakra. */
export const gpioPenalty = (q: CapPin): number => (q && SPECIAL_CAPS.some(x => hasCap(q, x[0])) ? 10 : 0);
/** Szabad GPIO-kapcsolatra alkalmas láb: analóghoz ADC1 kell, digitálishoz nem lehet csak bemeneti. */
export const gpioFits = (q: GpioPin | null | undefined, an: boolean): boolean =>
  !!q && isMcu(q.part) && q.role === 'gpio' && (an ? hasCap(q, 'adc') : !hasCap(q, 'in'));

export const GPIO_MODES: ReadonlyArray<readonly [string, string]> = [
  ['pullup', 'be, felhúzva'], ['pulldown', 'be, lehúzva'], ['float', 'be, lebegő'], ['adc', 'analóg (ADC)'],
  ['out_high', 'ki: 1'], ['out_low', 'ki: 0'], ['pwm', 'ki: PWM'],
];
/** A GPIO-mód a láb képességei szerint választható-e: csak bemeneti lábon nincs kimenet, felhúzás nélkülin nincs belső felhúzás. */
export function gpioModeOk(q: CapPin, m: string): boolean {
  if (m === 'out_high' || m === 'out_low' || m === 'pwm') return !hasCap(q, 'in');
  if (m === 'pullup' || m === 'pulldown') return !hasCap(q, 'nopull');
  if (m === 'adc') return hasAdc(q);
  return m === 'float';
}
/** Alapmód: analóg forrás a hálózaton → ADC; felhúzás nélküli lábon lebegő; egyébként felhúzva. */
export function gpioDefault(q: Pick<LocalPin, 'caps'> & { net: number }, A?: { netPins: Map<number, Array<{ role: string }>> } | null): string {
  const qs = (A && A.netPins.get(q.net)) || [];
  return hasAdc(q) && qs.some(x => x.role === 'adc') ? 'adc' : hasCap(q, 'nopull') ? 'float' : 'pullup';
}
