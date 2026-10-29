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
  /** Képességek, pl. 'adc' (analóg mérésre alkalmas GPIO). */
  caps?: string[];
  /** Tápbemenetnél (role 'vin') a megengedett feszültség a saját GND-lábhoz képest. */
  vmin?: Num;
  vmax?: Num;
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
/** dial: forgó mutató az `at` pont körül (motor: forgás, szervó: szög a szimulációból). */
export type Shape = 'rect' | 'circle' | 'poly' | 'line' | 'text' | 'axial' | 'radial' | 'link' | 'dial';

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
  /** Felülírás, amíg az alkatrész fénykibocsátó eleme (light dióda) világít. */
  lit?: PrimStyle;
}

export type ModelEl =
  | { el: 'resistor'; a: string; b: string; ohm: Num }
  | { el: 'diode'; a: string; k: string; vf: Num; ron?: Num; imax?: Num; light?: boolean }
  /** kind: 'battery' (alap; töltésre figyel) vagy 'supply' (tápegység, pl. USB-bemenet). */
  | { el: 'source'; p: string; n: string; v: Num; rint?: Num; kind?: 'battery' | 'supply' }
  | { el: 'nmos'; d: string; g: string; s: string; vth: Num; ron: Num; imax?: Num }
  /** Kondenzátor: egyenáramon szakadás. vmax: névleges feszültség, polar: elektrolit (a = +). */
  | { el: 'capacitor'; a: string; b: string; f: Num; vmax?: Num; polar?: boolean }
  /** NPN tranzisztor: B–E dióda (vbe), C–E lezárt / aktív (Ic = β·Ib) / telített (vcesat). */
  | { el: 'npn'; c: string; b: string; e: string; beta: Num; vbe?: Num; vcesat?: Num; imax?: Num }
  /** DC motor: üzemi ellenállás (a + → b), névleges feszültség; induktív, visszacsapó dióda kell mellé. */
  | { el: 'motor'; a: string; b: string; ohm: Num; vnom: Num }
  /** Szervó: tápfelvétel (vp–gnd), a szöget a sig lábon érkező PWM impulzusszélessége adja (min…max ms → 0…180°). */
  | { el: 'servo'; vp: string; gnd: string; sig: string; ohm: Num; pmin?: Num; pmax?: Num }
  | { el: 'pico'; gnd: string; vbus: string; vsys: string; v33: string }
  /**
   * Digitális logika: a kimenetek logikai kifejezései a bemeneti lábnevekkel (lásd core/logic.ts).
   * A bemeneti szint a VCC–GND közti feszültség aránya szerint: ≥ vih → 1, ≤ vil → 0, köztes/lebegő → X.
   * A kimenet push-pull ('pp', alap) vagy nyitott drain ('od'); `oe`: engedélyező kifejezés (0 → nagyimpedanciás).
   */
  | { el: 'logic'; vcc: string; gnd: string; outs: LogicOut[]; regs?: LogicReg[]; vih?: Num; vil?: Num; rout?: Num };

export interface LogicOut { pin: string; expr: string; oe?: string; type?: 'pp' | 'od' }
/**
 * Tároló (állapotbit): a `clk` kifejezés felfutó (vagy `edge: 'fall'` esetén lefutó) élén felveszi a `d` értékét.
 * `reset` / `set`: aszinkron törlés / beállítás, amíg a kifejezés 1. A nevére a kimenetek és más tárolók hivatkozhatnak.
 */
export interface LogicReg { name: string; clk: string; d: string; edge?: 'rise' | 'fall'; reset?: string; set?: string; init?: 0 | 1 }

/**
 * Szimuláció közbeni vezérlők.
 *  press   lenyomva a megadott lábpárok egy hálózat (kattintás az alkatrészre).
 *  slider  csúszka a szimulációs panelen, egy számparamétert állít (pl. joystick-tengely).
 */
export type Control =
  | { kind: 'press'; closes: ReadonlyArray<readonly [string, string]> }
  | { kind: 'slider'; key: string; label?: string };

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
  /** name módban: 'in' a test közepe felé, 'out' kifelé (alap: az `off` előjele szerint alá/fölé). */
  side?: 'in' | 'out';
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
  /** Lábszám → [név, szerep, képességek?]. */
  pinTable?: Record<string, readonly [string, Role] | readonly [string, Role, readonly string[]]>;
  pins: PinSpec[];
  /** Gyárilag összekötött lábak. */
  groups?: string[][];
  bounds?: Bounds;
  graphics?: Prim[];
  pinLabels?: PinLabels;
  model?: ModelEl[];
  controls?: Control[];
  /**
   * Szerelés: 'board' (alap) a lábak a panel lyukaiba kerülnek; 'off' külső alkatrész (motor, szervó…):
   * a panel mellett áll, a lábai kivezetések, amelyekhez vezeték (kábel) köt be a panelra.
   */
  mount?: 'board' | 'off';
  /** Szerkesztői adatok (a futás figyelmen kívül hagyja), pl. az űrlap állapota. */
  meta?: Record<string, unknown>;
}

/** Kiértékelt, lokális koordinátájú láb. */
export interface LocalPin {
  id: string;
  name: string;
  lr: number;
  lc: number;
  role: Role;
  num?: number;
  caps?: string[];
  vmin?: number;
  vmax?: number;
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
