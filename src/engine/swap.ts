/** Vezérlőcsere: egy vezérlőlap (Pico, ESP32…) másikra cserélése a kapcsolatok megtartásával. */
import type { LocalPin } from '../core/schema';
import { DEFS, isMcu } from './defs';
import { findPin, linkText } from './links';
import { gpioModeOk } from './mcu';
import { route } from './route';
import type { Design, Link, PwmCfg } from './types';

type PowerKind = 'gnd' | '33' | 'usb' | 'sys';
const mcuEl = (type: string) => {
  const el = (DEFS[type].def.model || []).find(e => e.el === 'mcu');
  return el && el.el === 'mcu' ? el : null;
};
/** A vezérlőlap tápláb-szerepe a modell szerint: usb (VBUS), sys (tápbemenet), 33, gnd. */
export function mcuPowerKind(type: string, q: Pick<LocalPin, 'id' | 'role'>): PowerKind | null {
  const el = mcuEl(type);
  if (!el) return null;
  if (q.role === 'gnd') return 'gnd';
  if (q.id === el.v33 || q.role === 'p33') return '33';
  if (el.vbus && q.id === el.vbus && el.vbus !== el.vsys) return 'usb';
  if (q.id === el.vsys) return 'sys';
  return null;
}
/** Az adott tápszerep lába a vezérlőn (USB 5 V híján a tápbemenet). */
export function mcuPowerPin(type: string, kind: PowerKind): string | null {
  const el = mcuEl(type);
  if (!el) return null;
  return kind === '33' ? el.v33 : kind === 'sys' ? el.vsys : kind === 'usb' ? el.vbus || el.vsys : null;
}

/**
 * Másik vezérlőlapra cserél, ugyanott: a GND- és GPIO-kapcsolatok maradnak (a GPIO-k újra kiosztódnak, a módjuk és
 * PWM-beállításuk átkerül), a táplábra mutatók a megfelelő tápra (3V3, tápbemenet, USB 5 V) kerülnek, a többi elvész.
 * `before`: a módosítás előtt hívódik (visszavonás); `nextLabel`: új címke, ha a régi a típus alapértelmezett mintája volt.
 */
export function swapMcu(D: Design, pid: string, type: string, hooks: { before(): void; nextLabel(type: string): string }): { dropped: string[] } | null {
  const p = D.parts.find(x => x.id === pid);
  if (!p || !isMcu(p) || !DEFS[type] || !DEFS[type].mcu || type === p.type) return null;
  hooks.before();
  const old = p.type, oq = new Map(DEFS[old].pins(p).map(q => [q.id, q])), pre = p.id + '.', dropped: string[] = [];
  const carry: Array<{ l: Link; old: string; mode?: string; pwm?: PwmCfg }> = [];
  const sig = D.signal && Array.isArray(D.signal.pins) ? D.signal.pins.map(k => (k && k.startsWith(pre) ? k : null)) : [];
  const links: Link[] = [];
  for (const l of D.links) {
    let { a, b } = l, g = l.gpio && l.gpio.startsWith(pre) ? l.gpio : null;
    if (a.startsWith(pre) && !b.startsWith(pre)) { const t = a; a = b; b = t; } // a vezérlő lába legyen a cél
    if (a.startsWith(pre)) { dropped.push(linkText(D, l)); continue; }
    if (b.startsWith(pre)) {
      const q = oq.get(b.slice(pre.length)), kind = q && mcuPowerKind(old, q);
      if (q && q.role === 'gpio') { g = b; b = 'GPIO'; }
      else if (kind === 'gnd') b = 'GND';
      else if (kind) { const id = mcuPowerPin(type, kind); if (id) b = pre + id; else { dropped.push(linkText(D, l)); continue; } }
      else { dropped.push(linkText(D, l)); continue; }
    }
    const nl: Link = { ...l, a, b, gpio: null };
    if (b === 'GPIO' && g) carry.push({ l: nl, old: g, mode: D.gpio[g], pwm: (D.pwm || {})[g] });
    links.push(nl);
  }
  for (const k of Object.keys(D.gpio)) if (k.startsWith(pre)) delete D.gpio[k];
  if (D.pwm) for (const k of Object.keys(D.pwm)) if (k.startsWith(pre)) delete D.pwm[k];
  const sameLabel = new RegExp('^' + DEFS[old].prefix + '\\d*$').test(p.label);
  p.type = type;
  p.props = { ...DEFS[type].props };
  if (sameLabel) p.label = hooks.nextLabel(type);
  D.links = links;
  if (D.settings.autoRoute && D.links.length) route(D, { full: true });
  const map = new Map<string, string>();
  for (const c of carry) {
    const nk = c.l.gpio;
    if (!nk) continue;
    map.set(c.old, nk);
    const q = findPin(D, nk);
    if (c.mode && q && gpioModeOk(q, c.mode)) D.gpio[nk] = c.mode;
    if (c.pwm && q && gpioModeOk(q, 'pwm')) D.pwm = { ...(D.pwm || {}), [nk]: c.pwm };
  }
  if (sig.length && D.signal) D.signal = { ...D.signal, pins: D.signal.pins.map((k, i) => (sig[i] ? map.get(sig[i]!) || null : k)) };
  return { dropped };
}
