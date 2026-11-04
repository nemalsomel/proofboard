/**
 * Alkatrész-regiszter: a beépített és a terv saját alkatrészeinek lefordított leírásai.
 * Egyetlen, módosuló objektum: a saját alkatrészek változásakor a `syncDefs` frissíti.
 */
import { compileAll, compilePart, penvD } from '../core/compile';
import type { CompiledPart, Env, PartDef, PartInstance } from '../core/schema';
import { PARTS } from '../parts/builtin';

export const DEFS: Record<string, CompiledPart> = compileAll(PARTS);

/**
 * Saját könyvtár: a felhasználó alkatrészei, a tervtől függetlenül (projektváltáskor is megmaradnak).
 * A terv a ténylegesen használt saját alkatrészeit a `customParts` mezőjében hordozza (így megosztható).
 */
let LIBRARY: Record<string, PartDef> = {};
export const libraryParts = (): Record<string, PartDef> => LIBRARY;
export function setLibrary(parts: Record<string, PartDef>): void { LIBRARY = { ...parts }; }

/** A regiszter: beépített + saját könyvtár + a terv saját alkatrészei (azonos kulcsnál a tervé az erősebb). */
export function syncDefs(custom: Record<string, PartDef> | null | undefined): void {
  for (const k of Object.keys(DEFS)) if (!(k in PARTS)) delete DEFS[k];
  for (const [k, d] of [...Object.entries(LIBRARY), ...Object.entries(custom || {})]) {
    try { DEFS[k] = compilePart(k, { cat: 'Saját', ...d }); }
    catch (e) { console.warn('Saját alkatrész kihagyva:', k, e); }
  }
}

/** Az alkatrészpéldány paraméterkörnyezete (alapértékekkel). */
export const penv = (p: PartInstance): Env => penvD(DEFS[p.type].def, p);
/** Van-e nyomógomb-vezérlője (szimulációban kattintható). */
export const hasPress = (p: PartInstance): boolean => (DEFS[p.type].def.controls || []).some(c => c.kind === 'press');
/** Külső (panel mellé kerülő) alkatrész. */
export const isOff = (p: PartInstance): boolean => DEFS[p.type].def.mount === 'off';
/** Mikrovezérlő-lap (Pico, ESP32…): a GPIO-, GND- és tápcélok forrása. */
export const isMcu = (p: PartInstance | null | undefined): boolean => !!(p && DEFS[p.type] && DEFS[p.type].mcu);
