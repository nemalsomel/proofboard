/**
 * Egységes ikonkészlet: 24×24-es, vonalas SVG-ikonok (currentColor, 1,8 px vonal), saját rajz.
 * Használat: `icon('undo')` → SVG-szöveg, amely a gomb szövegszínét veszi át; a gomb felirata
 * vagy `aria-label`-je adja a jelentést, az ikon `aria-hidden`.
 */
const P: Record<string, string> = {
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  filePlus: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
  open: '<path d="M3 18V6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v2"/><path d="M3 18 6 11h15l-3 8H4a1 1 0 0 1-1-1z"/>',
  save: '<path d="M12 3v11m-5-5 5 5 5-5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  load: '<path d="M12 14V3m-5 5 5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  book: '<path d="M4 19V5a2 2 0 0 1 2-2h14v14H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14"/><path d="M9 7h7"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  dock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M7 12h5m-2-2.5L12.5 12 10 14.5"/>',
  undock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16M12 12H7m2.5-2.5L7 12l2.5 2.5"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  check: '<path d="M5 12.5 10 17l9-10"/>',
  warn: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  parts: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h.01M11 8h.01M15 8h.01M7 12h.01M11 12h.01M15 12h.01M7 16h.01M11 16h.01M15 16h.01"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>',
  sideL: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  sideR: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  sideB: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 15h18"/>',
  tSelect: '<path d="M5.5 3.5 18 11l-5.5 1.5L10 18z"/><path d="m12.5 12.5 5 5"/>',
  tBridge: '<circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="12" r="2.6"/><path d="M8.6 12h6.8" stroke-width="3.2"/>',
  tWire: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M6.5 16.5C9 8 15 16 17.5 7.5"/>',
  tLink: '<circle cx="5" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="M7.5 12h9" stroke-dasharray="2 2.4"/>',
  tCut: '<circle cx="6" cy="7" r="2.6"/><circle cx="6" cy="17" r="2.6"/><path d="M8.2 8.6 20 17M8.2 15.4 20 7"/>',
  tNote: '<path d="M5 4h14v10l-5 6H5z"/><path d="M14 20v-6h5M8 9h7M8 12.5h4"/>',
  tErase: '<path d="M8 20 3.6 15.6a1.6 1.6 0 0 1 0-2.2L12.9 4a1.6 1.6 0 0 1 2.2 0l4.9 4.9a1.6 1.6 0 0 1 0 2.2L11 20"/><path d="M8 20h12M8.5 9.5l6 6"/>',
  tHand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v6M11 11.5V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.5 0-4-1-5.5-3l-2-3.3a1.5 1.5 0 0 1 2.4-1.8L8 15"/>',
  restore: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5M12 8v4.5l3 2"/>',
  swap: '<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>',
  comp: '<rect x="3" y="14" width="18" height="5" rx="1"/><rect x="7" y="6" width="10" height="8" rx="1.5"/><path d="M9 14v-1M15 14v-1"/>',
  copper: '<rect x="3" y="5" width="18" height="5" rx="1"/><path d="M6 13v6M10 13v6M14 13v6M18 13v6"/>',
  rats: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="9" r="2"/><circle cx="9" cy="19" r="2"/><path d="M7 6.5l10 2M17.5 10.5l-7 7" stroke-dasharray="2 2.2"/>',
  xray: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3" stroke-dasharray="2 1.6"/>',
  stub: '<circle cx="4" cy="12" r="2"/><circle cx="20" cy="12" r="2"/><path d="M6 12h3M15 12h3M10 15.5l2-7M13 15.5l2-7"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2.2"/><path d="M9 7 4 17h5zM15 7l5 10h-5z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  expandAll: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  collapseAll: '<path d="m7 20 5-5 5 5M7 4l5 5 5-5"/>',
  disk: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M8 3v5h7V3M7 21v-7h10v7"/>',
  /** háttérbe tétel: nyíl a felső vonal (a fülsor) felé */
  minimize: '<path d="M5 5h14M7 16l5-5 5 5"/>',
  full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  fullExit: '<path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4"/>',
  ext: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  install: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  pulse: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
};
export type IconName = keyof typeof P;
export const ICONS = Object.keys(P) as IconName[];

/** SVG-ikon szövegként (a gomb szövegszínével, `aria-hidden`). */
export function icon(name: IconName, cls = ''): string {
  const body = P[name];
  if (!body) return '';
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** A `data-icon="név"` attribútumú elemek elejére beszúrja az ikont (az index.html statikus gombjaihoz). */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => {
    if (el.querySelector(':scope > svg.ic')) return;
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon as IconName));
  });
}
