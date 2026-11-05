import { N_ } from '../i18n/i18n';
import { hasErrors, validatePartDef, type Problem } from './validate';
import type { PartDef } from './schema';

export const LIBRARY_FORMAT = 'proofboard-parts';

export interface LibraryFile {
  format: typeof LIBRARY_FORMAT;
  version: 1;
  parts: Record<string, PartDef>;
}

/** Saját alkatrész típusneve a nevéből: "c_" + ékezet nélküli rövid azonosító, ütközés esetén sorszámmal. */
export function typeKeyFor(name: string, taken: (k: string) => boolean): string {
  const base = 'c_' + (name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'alkatresz');
  let k = base, i = 2;
  while (taken(k)) k = `${base}_${i++}`;
  return k;
}

export function exportLibrary(parts: Record<string, PartDef>): LibraryFile {
  return { format: LIBRARY_FORMAT, version: 1, parts: JSON.parse(JSON.stringify(parts)) };
}

export interface ImportResult {
  /** Bekerülő leírások (az új kulccsal). */
  parts: Record<string, PartDef>;
  /** Átnevezett kulcsok: régi → új. */
  renamed: Record<string, string>;
  /** Kihagyott leírások és okuk. */
  rejected: Array<{ key: string; problems: Problem[] }>;
}

/** Könyvtárfájl beolvasása: csak a hibátlan leírások kerülnek be; foglalt kulcsnál új kulcsot kap. */
export function importLibrary(data: unknown, taken: (k: string) => boolean): ImportResult {
  const res: ImportResult = { parts: {}, renamed: {}, rejected: [] };
  const obj = data as Partial<LibraryFile> | null;
  if (!obj || typeof obj !== 'object' || obj.format !== LIBRARY_FORMAT || !obj.parts || typeof obj.parts !== 'object') {
    throw new Error(N_('Ez nem Proofboard alkatrészkönyvtár (hiányzik a "format": "proofboard-parts").'));
  }
  for (const [key, def] of Object.entries(obj.parts)) {
    const problems = validatePartDef(def);
    if (hasErrors(problems)) { res.rejected.push({ key, problems }); continue; }
    const isTaken = (k: string) => taken(k) || k in res.parts;
    let k = /^c_[a-z0-9_]+$/.test(key) ? key : typeKeyFor(def.name, isTaken);
    if (isTaken(k)) k = typeKeyFor(def.name, isTaken);
    if (k !== key) res.renamed[key] = k;
    res.parts[k] = def;
  }
  return res;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Keresési szöveg egy alkatrészhez: név, lábkép, kategória, előtag, lábnevek, szerepek, képességek és buszfunkciók. */
export function partSearchText(def: PartDef): string {
  const pins = Array.isArray(def.pins) ? def.pins : [];
  const words = [def.name, def.fp, def.cat || '', def.prefix,
    ...pins.flatMap(p => [p.name != null ? String(p.name) : '', p.role || '', p.fn || '', ...(p.caps || [])]),
    ...Object.values(def.pinTable || {}).flatMap(t => [t[0], t[1], ...((t[2] as readonly string[] | undefined) || [])]),
    ...(def.model || []).map(e => e.el)];
  return fold(words.filter(Boolean).join(' '));
}
/** Minden szóközzel elválasztott keresőszó szerepel-e (kis- és nagybetű, ékezet nem számít). */
export function matchPart(def: PartDef, query: string): boolean {
  const q = fold(query).split(/\s+/).filter(Boolean);
  if (!q.length) return true;
  const t = partSearchText(def);
  return q.every(w => t.includes(w));
}
