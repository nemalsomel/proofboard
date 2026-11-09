/**
 * Az alkatrészleírások felületi szövegei (név, kategória, lábkép, paraméterek, súgó, lábmegjegyzések, vezérlők):
 * adatok, ezért futásidőben gyűjthetők ki (a forrásban összefűzés is van). A fordítás a megjelenítéskor `t()`-vel;
 * a unit teszt ebből ellenőrzi, hogy mindnek van angol párja.
 */
import type { PartDef } from '../core/schema';

export function partStrings(defs: Readonly<Record<string, PartDef>>): string[] {
  const out = new Set<string>(), add = (s: unknown) => { if (typeof s === 'string' && /\p{L}/u.test(s)) out.add(s); };
  for (const d of Object.values(defs)) {
    add(d.name); add(d.cat); add(d.fp);
    for (const p of d.params || []) {
      add(p.label); add(p.help); add(p.unit);
      for (const o of (p as { options?: Array<{ label?: string }> }).options || []) add(o.label);
    }
    for (const c of d.controls || []) add((c as { label?: string }).label);
    // lábnevek: csak a szavakat tartalmazók (anód, katód…), a jelölések (GP15, VCC, 1Qn) nem fordulnak
    for (const q of d.pins || []) { const n = (q as { name?: string }).name; if (typeof n === 'string' && /[a-záéíóöőúüű]{3,}/.test(n)) add(n); }
    for (const v of Object.values(d.pinTable || {})) if (/[a-záéíóöőúüű]{3,}/.test(v[0])) add(v[0]);
    const m = (d.meta || {}) as { help?: string; pinNotes?: Record<string, string> };
    add(m.help);
    for (const v of Object.values(m.pinNotes || {})) add(v);
  }
  return [...out];
}

/** A példák felületi szövegei: cím, leírás, „Mit tanulsz” pontok, jegyzetek (a betöltéskor fordulnak). */
export function exampleStrings(examples: ReadonlyArray<{ title: string; desc: string; learn?: string[]; design: { notes: Array<{ text: string }> } }>): string[] {
  const out = new Set<string>();
  for (const e of examples) { out.add(e.title); out.add(e.desc); for (const l of e.learn || []) out.add(l); for (const n of e.design.notes) out.add(n.text); }
  return [...out];
}
