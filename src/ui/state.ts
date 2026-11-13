/**
 * A felület pillanatnyi állapota (`ui`): eszköz, kijelölés, húzás, szimuláció, nézetek, panelek.
 * A kiemelt komponensek a saját részüket típusként kérik (`InteractState`, `PropsState`, `LinksState`, `ApiUiState`);
 * ez a típus mindet lefedi, a gazda (`app.ts`) egyetlen ilyen objektumot ad nekik.
 */
import type { LinkState } from '../engine/links';
import type { ProgOut, ProgRuntime } from '../engine/program';
import type { SimResult } from '../engine/simulate';
import type { Hole } from '../engine/types';
import type { Drag, Ghost, InteractState, Selection } from './interact';

/** Program futás közben: futtatókörnyezet, eltelt idő, a legutóbbi kiértékelés eredménye. */
export interface ProgRun {
  rt: ProgRuntime; t: number; key: string; out: ProgOut | null;
}

/** Villogó jelzés a panelon (pl. a Problémák egy sorára kattintva). */
export interface Flash { holes: Hole[]; until: number; sev?: string }

export interface UiState extends InteractState {
  /* panel és eszközök */
  stub: boolean; hoverWire: number; anim: boolean; rats: boolean; xray: boolean;
  sel: Selection | null; drag: Drag | null; ghost: Ghost;
  flash: Flash | null; confirmClear: number;
  /** motorok forgásfázisa alkatrészenként */ phase: Record<string, number>;
  /** a panel körüli margó (px), a görgetés megtartásához */ padX?: number; padY?: number;
  /* kapcsolatok */
  selLink: string | null; linkState: Map<string, LinkState>;
  /* szimuláció és program */
  blinkSim?: SimResult | null; blinkOn?: boolean; simGen?: number;
  prog?: ProgRun | null; progTimer?: ReturnType<typeof setInterval> | null; progAuto?: boolean;
  progSel?: string | null; progHi?: string | null;
  /* nézetek és panelek */
  work?: string; pvTab?: string; part?: boolean; /** a Gyártás nézet látszik */ mfg?: boolean;
  ltab?: string; rtab?: string; rtabProps?: string; rtabBeforeCode?: string; btab?: string;
  layBack?: string | null; layApplying?: boolean; pwHad?: boolean;
  libQ?: string; exCat?: string; exF?: Set<string>;
  lastBoard?: string; introOff?: boolean;
}
