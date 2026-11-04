/**
 * Elrendezések (5.2): Tervezés, Program, Szimuláció. Egy elrendezés csak kiinduló állapot – melyik
 * oldalsáv van összecsukva, nyitva van-e az alsó panel, melyik nézet látszik, melyik a jobb sáv füle –,
 * a kézi módosítás elrendezésenként megmarad. Tiszta, DOM-mentes állapotkezelés; a tárolás a gazdáé.
 */
export type LayoutId = 'design' | 'prog' | 'sim';
export type Work = 'board' | 'prog' | 'split';
export type RightTab = 'design' | 'sim';
export interface LayoutState {
  /** bal sáv összecsukva */ l: boolean;
  /** jobb sáv összecsukva */ r: boolean;
  /** alsó panel (Problémák, Napló) nyitva */ bottom: boolean;
  /** nézet: panel, program vagy mindkettő */ work: Work;
  /** a jobb sáv füle */ rtab: RightTab;
}
export interface LayoutStore { cur: LayoutId; saved: Partial<Record<LayoutId, Partial<LayoutState>>> }

export const LAYOUTS: { id: LayoutId; name: string; hint: string }[] = [
  { id: 'design', name: 'Tervezés', hint: 'Alkatrészek lerakása és bekötése' },
  { id: 'prog', name: 'Program', hint: 'A panel és a program egymás mellett' },
  { id: 'sim', name: 'Szimuláció', hint: 'Vezérlők és GPIO-k; a szimuláció indításakor erre vált' },
];
export const LAYOUT_DEFAULTS: Record<LayoutId, LayoutState> = {
  design: { l: false, r: false, bottom: false, work: 'board', rtab: 'design' },
  prog: { l: true, r: true, bottom: false, work: 'split', rtab: 'design' },
  sim: { l: true, r: false, bottom: false, work: 'board', rtab: 'sim' },
};
const IDS = Object.keys(LAYOUT_DEFAULTS) as LayoutId[];
const WORKS: Work[] = ['board', 'prog', 'split'];
const RTABS: RightTab[] = ['design', 'sim'];
export const isLayout = (x: unknown): x is LayoutId => IDS.includes(x as LayoutId);

/** Csak az ismert, helyes típusú mezők maradnak meg (régi vagy sérült tárolt állapotból). */
function cleanState(x: unknown): Partial<LayoutState> {
  const o: Partial<LayoutState> = {}, r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  for (const k of ['l', 'r', 'bottom'] as const) if (typeof r[k] === 'boolean') o[k] = r[k] as boolean;
  if (WORKS.includes(r.work as Work)) o.work = r.work as Work;
  if (RTABS.includes(r.rtab as RightTab)) o.rtab = r.rtab as RightTab;
  return o;
}

/** Tárolt állapot beolvasása; `legacy` a régi, elrendezés nélküli beállítás (az lesz a Tervezés). */
export function parseStore(raw: unknown, legacy?: Partial<LayoutState>): LayoutStore {
  const r = (raw && typeof raw === 'object' ? raw : null) as { cur?: unknown; saved?: Record<string, unknown> } | null;
  if (!r) return { cur: 'design', saved: legacy ? { design: cleanState(legacy) } : {} };
  const saved: LayoutStore['saved'] = {};
  for (const id of IDS) if (r.saved && r.saved[id]) saved[id] = cleanState(r.saved[id]);
  return { cur: isLayout(r.cur) ? r.cur : 'design', saved };
}

/** Az elrendezés tényleges állapota: az alapértékek a megőrzött módosításokkal. */
export const stateOf = (s: LayoutStore, id: LayoutId = s.cur): LayoutState => ({ ...LAYOUT_DEFAULTS[id], ...(s.saved[id] || {}) });

/** Kézi módosítás a mostani elrendezésben (a többit nem érinti). */
export function remember(s: LayoutStore, patch: Partial<LayoutState>): LayoutStore {
  return { cur: s.cur, saved: { ...s.saved, [s.cur]: { ...(s.saved[s.cur] || {}), ...cleanState(patch) } } };
}

/** Váltás: az új elrendezés megőrzött (vagy alap) állapota. */
export function switchTo(s: LayoutStore, id: LayoutId): { store: LayoutStore; state: LayoutState } {
  const store = { cur: id, saved: s.saved };
  return { store, state: stateOf(store, id) };
}

/** Az elrendezés visszaállítása az alapértékekre. */
export function resetLayout(s: LayoutStore, id: LayoutId = s.cur): LayoutStore {
  const saved = { ...s.saved };
  delete saved[id];
  return { cur: s.cur, saved };
}

/** Az elrendezés el van-e térve az alapértékeitől (a gomb jelzi, és visszaállítható). */
export const isCustom = (s: LayoutStore, id: LayoutId = s.cur): boolean => {
  const a = stateOf(s, id), d = LAYOUT_DEFAULTS[id];
  return (Object.keys(d) as (keyof LayoutState)[]).some(k => a[k] !== d[k]);
};
