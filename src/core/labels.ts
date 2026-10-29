/**
 * Lábnevek helye: a lábak alatt/felett, vagy befelé (a test közepe felé) / kifelé.
 * Kétsoros (DIP-szerű) lábkiosztásnál a befelé írt nevek egymás felé néznek a testen,
 * a kifelé írtak a test két oldalán, kívül vannak. Egyetlen oszlopban álló lábaknál a nevek
 * oldalra kerülnek.
 */
export type LabelSide = 'below' | 'above' | 'in' | 'out';

export interface LabelPos { r: number; c: number; /** vízszintes elhelyezésnél a szöveg igazítása */ align: 'center' | 'left' | 'right' }

export function pinLabelPositions(
  pins: ReadonlyArray<{ lr: number; lc: number }>,
  side: LabelSide,
  off: number,
  center: { r: number; c: number },
): LabelPos[] {
  const a = Math.abs(off) || 0.75;
  if (side === 'below' || side === 'above') return pins.map(p => ({ r: p.lr + (side === 'below' ? a : -a), c: p.lc, align: 'center' }));
  const out = side === 'out' ? -1 : 1;
  const rows = pins.map(p => p.lr), cols = pins.map(p => p.lc);
  const oneCol = pins.length > 1 && new Set(cols).size === 1 && new Set(rows).size > 1;
  if (oneCol) {
    return pins.map(p => {
      const s = (Math.sign(center.c - p.lc) || 1) * out;
      return { r: p.lr, c: p.lc + s * (a - 0.35), align: s > 0 ? 'left' : 'right' };
    });
  }
  const mid = (Math.min(...rows) + Math.max(...rows)) / 2;
  return pins.map(p => {
    const s = (p.lr < mid - 1e-9 ? 1 : p.lr > mid + 1e-9 ? -1 : Math.sign(center.r - p.lr) || 1) * out;
    return { r: p.lr + s * a, c: p.lc, align: 'center' };
  });
}
