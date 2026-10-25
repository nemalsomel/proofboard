/**
 * Alkatrész-leírás séma. Minden beépített és (később) saját alkatrész ilyen adat:
 * a rajzolás, a tulajdonságpanel, a netlista és a szimuláció is ebből dolgozik.
 *
 * A számok helyén kifejezés is állhat (lásd core/expr.ts): "{span}+0.75", "{dc}/2", "{40-i}".
 */

/** Szám vagy kifejezés. */
export type Num = number | string;

/** Láb szerepe: színkód, ellenőrzés és útvonalkereső-cél (pl. 'gnd', 'gpio', 'an', 'ka', 'A', 'B'). */
export type Role = string;

/** Pont: [sor, oszlop] lokális koordinátában, vagy egy láb azonosítója. */
export type Pt = readonly [Num, Num] | string;

export interface PinSpec {
  id: string;
  name?: string;
  lr: Num;
  lc: Num;
  role?: Role;
  /** Ismétlés: a mezőkben az `i` változó 0..n-1. */
  repeat?: Num;
}

export interface ParamOption {
  v: string | number;
  label: string;
  hex?: string;
  [field: string]: unknown;
}

export type ParamType = 'value' | 'number' | 'int' | 'select' | 'color' | 'span';

export interface ParamDef {
  key: string;
  label: string;
  type: ParamType;
  default: any;
  /** Mértékegység a `value` típushoz (Ω, V, A, F…). */
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** ↑/↓ léptetés szabványsor szerint. */
  series?: 'E12';
  /** A lábak helyét befolyásolja (újra kell illeszteni, útvonalat tervezni). */
  geo?: boolean;
  options?: ParamOption[];
  /** Súgószöveg, kifejezés-helyettesítéssel ({color.vf}). */
  help?: string;
}

export type Layer = 'body' | 'detail' | 'label' | 'lead' | 'xray';
export type Shape = 'rect' | 'circle' | 'poly' | 'line' | 'text' | 'axial' | 'radial' | 'link';

export interface PrimStyle {
  layer?: Layer;
  r?: readonly [Num, Num];
  c?: readonly [Num, Num];
  at?: Pt;
  rad?: Num;
  pts?: readonly Pt[];
  from?: Pt;
  to?: Pt;
  between?: readonly [Pt, Pt];
  perp?: Num;
  text?: string;
  size?: Num;
  min?: number;
  color?: string;
  fill?: string | null;
  stroke?: string | null;
  edge?: string;
  width?: Num;
  dash?: boolean;
  len?: Num;
  w?: Num;
  bands?: string;
  stripe?: { at: number; color: string };
  glow?: boolean;
}

/** Rajzelem. `xray`: felülírás röntgen nézetben, `pressed`: felülírás lenyomott vezérlőnél. */
export interface Prim extends PrimStyle {
  shape: Shape;
  xray?: PrimStyle & { pressed?: PrimStyle };
  pressed?: PrimStyle;
}

export type ModelEl =
  | { el: 'resistor'; a: string; b: string; ohm: Num }
  | { el: 'diode'; a: string; k: string; vf: Num; ron?: Num; imax?: Num; light?: boolean }
  | { el: 'source'; p: string; n: string; v: Num; rint?: Num }
  | { el: 'nmos'; d: string; g: string; s: string; vth: Num; ron: Num; imax?: Num }
  | { el: 'pico'; gnd: string; vbus: string; vsys: string; v33: string };

export interface Control {
  /** press: lenyomva a megadott lábpárok egy hálózat. */
  kind: 'press';
  closes: ReadonlyArray<readonly [string, string]>;
}

export interface PinLabels {
  mode: 'role' | 'sign' | 'name';
  off?: number;
  colors?: Record<string, string>;
  plus?: string[];
  plusText?: string;
  minusText?: string;
  /** A Pico-féle, test felé forgatott lábnevek. */
  inward?: boolean;
  onBody?: boolean;
  minP?: number;
  rename?: Record<string, string>;
}

export interface Bounds {
  r?: readonly [Num, Num];
  c?: readonly [Num, Num];
  /** Automatikus test: a lábak köré ennyi margó. */
  pad?: number;
  /** Az első és utolsó láb közti középpont körüli margó (pl. LED-test). */
  mid?: number;
}

export interface PartDef {
  name: string;
  fp: string;
  prefix: string;
  cat?: string;
  params?: ParamDef[];
  pinTable?: Record<string, readonly [string, Role]>;
  pins: PinSpec[];
  /** Gyárilag összekötött lábak. */
  groups?: string[][];
  bounds?: Bounds;
  graphics?: Prim[];
  pinLabels?: PinLabels;
  model?: ModelEl[];
  controls?: Control[];
}

/** Kiértékelt, lokális koordinátájú láb. */
export interface LocalPin {
  id: string;
  name: string;
  lr: number;
  lc: number;
  role: Role;
  num?: number;
}

/** Alkatrész a tervben. */
export interface PartInstance {
  id: string;
  type: string;
  label: string;
  r: number;
  c: number;
  rot: number;
  mir: boolean;
  props: Record<string, any>;
  xray?: boolean;
}

export interface Rect { r0: number; r1: number; c0: number; c1: number }

export interface CompiledPart {
  type: string;
  def: PartDef;
  name: string;
  fp: string;
  prefix: string;
  cat: string;
  props: Record<string, any>;
  pins(p: PartInstance): LocalPin[];
  internal(p?: PartInstance): Array<[string, string]>;
  bounds(p: PartInstance): Rect;
}

/** Kiértékelési környezet: paraméterértékek, `$opt` a kiválasztott opciók, `label`, ismétlésnél `i`. */
export interface Env {
  [key: string]: unknown;
  $opt: Record<string, ParamOption>;
}
