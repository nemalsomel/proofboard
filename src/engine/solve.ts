/**
 * Csomóponti analízis: minden elem egy "ág" két csomópont között,
 * vezetőképességgel (g) és sorba kapcsolt forrásfeszültséggel (E):
 *   az a → b irányú áram = g · (Va − Vb − E).
 * A −1 csomópont a referencia (0 V).
 */
export interface Branch {
  a: number;
  b: number;
  g: number;
  E: number;
  kind?: string;
  ref?: unknown;
}

/** Lineáris egyenletrendszer felírása és megoldása részleges főelem-kiválasztásos Gauss-eliminációval. */
export function solve(n: number, els: readonly Branch[]): Float64Array {
  const G = new Float64Array(n * n), I = new Float64Array(n);
  for (const { a, b, g, E } of els) {
    if (a >= 0) { G[a * n + a] += g; I[a] += g * E; }
    if (b >= 0) { G[b * n + b] += g; I[b] -= g * E; }
    if (a >= 0 && b >= 0) { G[a * n + b] -= g; G[b * n + a] -= g; }
  }
  for (let k = 0; k < n; k++) {
    let mx = k, mv = Math.abs(G[k * n + k]);
    for (let i = k + 1; i < n; i++) { const v = Math.abs(G[i * n + k]); if (v > mv) { mv = v; mx = i; } }
    if (mv < 1e-30) continue;
    if (mx !== k) {
      for (let j = 0; j < n; j++) { const t = G[k * n + j]; G[k * n + j] = G[mx * n + j]; G[mx * n + j] = t; }
      const t = I[k]; I[k] = I[mx]; I[mx] = t;
    }
    for (let i = k + 1; i < n; i++) {
      const f = G[i * n + k] / G[k * n + k];
      if (!f) continue;
      for (let j = k; j < n; j++) G[i * n + j] -= f * G[k * n + j];
      I[i] -= f * I[k];
    }
  }
  const V = new Float64Array(n);
  for (let k = n - 1; k >= 0; k--) {
    let s = I[k];
    for (let j = k + 1; j < n; j++) s -= G[k * n + j] * V[j];
    V[k] = G[k * n + k] ? s / G[k * n + k] : 0;
  }
  return V;
}
