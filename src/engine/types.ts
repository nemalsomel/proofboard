/**
 * A terv (design) és a belőle számolt adatok típusai. A terv JSON-ként mentődik; a mezők
 * jelentése a README-ben és a `normalize` (app) függvényben.
 */
import type { LocalPin, PartDef, PartInstance } from '../core/schema';
import type { Cut } from './board';

/** Kézi forrasztóhíd: [sor1, oszlop1, sor2, oszlop2]. */
export type Bridge = [number, number, number, number];
/** Automatikus híd: a kapcsolatok azonosítóival, amelyekhez tartozik. */
export type AutoBridge = [number, number, number, number, string[]];
export type Hole = [number, number];

export interface Wire { a: Hole; b: Hole; color: string; links?: string[] }
/** Kapcsolat: `a` egy láb (alkatrész-azonosító.láb), `b` láb, 'GND' vagy 'GPIO'; `gpio` a kiosztott GPIO-láb. */
export interface Link { id: string; a: string; b: string; gpio: string | null }
export interface Note { id: string; r: number; c: number; w: number; h: number; text: string; color: string; target: string | null }
export interface PwmCfg { duty: number; freq: number }
export interface SignalCfg { preset: string; custom: string; pins: Array<string | null>; step: number; rate: number; dir: number }
export interface Settings { usb: boolean; btnMode: 'hold' | 'toggle'; autoRoute: boolean; autoCut?: boolean; vrot?: number }
export interface BoardSize { rows: number; cols: number; sec: number }

export interface Design {
  v?: number;
  board: BoardSize;
  parts: PartInstance[];
  bridges: Bridge[];
  wires: Wire[];
  links: Link[];
  auto: { bridges: AutoBridge[]; wires: Wire[]; cuts?: Cut[] };
  cuts?: Cut[];
  customParts: Record<string, PartDef>;
  notes: Note[];
  gpio: Record<string, string>;
  pwm: Record<string, PwmCfg>;
  settings: Settings;
  seq: number;
  signal?: SignalCfg;
}

/** Elhelyezett láb: panel-koordinátákkal és az alkatrésszel. */
export interface PlacedPin extends LocalPin { r: number; c: number; part: PartInstance }
/** Netlista-láb: a panelon van-e (`on`), csomópontja (`s`) és hálózata (`net`). */
export interface NetPin extends PlacedPin { on: boolean; s: number; net: number }
