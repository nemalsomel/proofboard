/**
 * A panel nézetének forgatása (0–3 negyedfordulat): panelkoordináta ↔ képernyő-koordináta. Tiszta; a `W`×`H`
 * a forgatás előtti (álló) panel mérete pixelben.
 */
export type Rot = 0 | 1 | 2 | 3;
export function toScreen(x: number, y: number, W: number, H: number, r: number): [number, number] {
  switch (r & 3) { case 1: return [H - y, x]; case 2: return [W - x, H - y]; case 3: return [y, W - x]; default: return [x, y]; }
}
export function fromScreen(x: number, y: number, W: number, H: number, r: number): [number, number] {
  switch (r & 3) { case 1: return [y, H - x]; case 2: return [W - x, H - y]; case 3: return [W - y, x]; default: return [x, y]; }
}
/** A rajzolás transzformációja a forgatáshoz (a vászon kontextusára). */
export function applyRotation(ctx: Pick<CanvasRenderingContext2D, 'translate' | 'rotate'>, W: number, H: number, r: number): void {
  switch (r & 3) {
    case 1: ctx.translate(H, 0); ctx.rotate(Math.PI / 2); break;
    case 2: ctx.translate(W, H); ctx.rotate(Math.PI); break;
    case 3: ctx.translate(0, W); ctx.rotate(-Math.PI / 2); break;
  }
}
