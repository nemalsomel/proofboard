/**
 * Megosztás linkkel: a terv JSON-ja tömörítve (deflate-raw) és base64url-kódolva a link `#` része mögé kerül,
 * így szerverre nem jut el, és szerver nélkül is megosztható. DOM-mentes (a böngésző és a Node is tudja a
 * `CompressionStream`-et).
 *
 * Formátum: `#d=1.<base64url>` – az `1` a formátum változata.
 */

export const SHARE_KEY = 'd';
const VER = '1';
/** Ennél hosszabb linket a csevegőprogramok, e-mailek egy része levághat: a felület figyelmeztet. */
export const SHARE_LONG = 8000;

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export function toB64url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/'), pad = t.length % 4 ? '='.repeat(4 - t.length % 4) : '';
  const bin = atob(t + pad), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

export function canShare(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
}

/** A terv (bármilyen JSON-ná alakítható érték) kódolva, a `#` utáni rész nélkül: `1.<base64url>`. */
export async function encodeShare(design: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(design));
  return VER + '.' + toB64url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** A kódolt rész visszafejtve (a JSON-objektum, normalizálás nélkül). Hibás vagy ismeretlen formátumnál kivételt dob. */
export async function decodeShare(code: string): Promise<unknown> {
  const m = /^(\d+)\.([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) throw new Error('bad link');
  if (m[1] !== VER) throw new Error('unknown link version ' + m[1]);
  const raw = await pipe(fromB64url(m[2]), new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(raw));
}

/** Teljes link: az alap-URL (`#` nélkül) + `#d=…`. */
export async function shareUrl(base: string, design: unknown): Promise<string> {
  return base.replace(/#.*$/, '') + '#' + SHARE_KEY + '=' + await encodeShare(design);
}

/** A link (vagy csak a `#…` rész) kódolt terve, ha megosztott terv; különben `null`. */
export function shareCode(urlOrHash: string): string | null {
  const i = urlOrHash.indexOf('#'), h = i >= 0 ? urlOrHash.slice(i + 1) : urlOrHash;
  for (const kv of h.split('&')) { const j = kv.indexOf('='); if (j > 0 && kv.slice(0, j) === SHARE_KEY) return decodeURIComponent(kv.slice(j + 1)); }
  return null;
}
