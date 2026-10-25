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
    throw new Error('Ez nem Proofboard alkatrészkönyvtár (hiányzik a "format": "proofboard-parts").');
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
