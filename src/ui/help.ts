/**
 * Súgó: a felület „?” gombjai a kézikönyv (guide/) megfelelő fejezetére és címére visznek, a felület nyelvén, új lapon.
 * A célok egy helyen (`HELP`: téma → fejezet#horgony nyelvenként; a horgony a kézikönyv címének ékezet nélküli slugja).
 * Statikus HTML-ben: `<a data-help="téma">`, kódból épített felületen `helpBtn('téma', tr)`. A `@…` téma helyzetfüggő:
 * a kattintás pillanatában a regisztrált feloldó adja (pl. a jobb sáv aktív füle). Az e2e minden célt ellenőriz.
 */
import type { Tr } from '../i18n/i18n';
import { icon } from './icons';

export type Lang = 'hu' | 'en';
/** téma → [magyar cél, angol cél] (fejezet slug + horgony) */
export const HELP = {
  start: ['start/', 'start/'],
  examples: ['start/#az-elso-terv-egy-peldabol', 'start/#a-first-design-from-an-example'],
  boardTypes: ['board/#paneltipusok', 'board/#board-types'],
  parts: ['board/#alkatresz-lerakasa', 'board/#placing-a-part'],
  props: ['board/#tulajdonsagok', 'board/#properties'],
  mcu: ['board/#vezerlolapok-es-vezerlocsere', 'board/#controllers-and-swapping'],
  copper: ['board/#rezoldali-alkatresz', 'board/#copper-side-parts'],
  links: ['wiring/#kapcsolatok', 'wiring/#connections'],
  routing: ['wiring/#utvonalkereses', 'wiring/#routing'],
  cuts: ['wiring/#csikvagas', 'wiring/#strip-cuts'],
  problems: ['wiring/#problemak', 'wiring/#problems'],
  compact: ['wiring/#tomorites', 'wiring/#compact'],
  blocks: ['program/#blokkok', 'program/#blocks'],
  code: ['program/#kod', 'program/#code'],
  codeImport: ['program/#kod-importalasa', 'program/#importing-code'],
  sim: ['simulation/#gpio-k-es-tap', 'simulation/#gpios-and-power'],
  meters: ['simulation/#muszerek', 'simulation/#instruments'],
  power: ['simulation/#aramfelvetel', 'simulation/#current-consumption'],
  editor: ['custom-parts/', 'custom-parts/'],
  editorPins: ['custom-parts/#labak', 'custom-parts/#pins'],
  editorFunc: ['custom-parts/#mukodes', 'custom-parts/#behavior'],
  editorJson: ['custom-parts/#json', 'custom-parts/#json'],
  bom: ['manufacturing/#anyaglista', 'manufacturing/#bill-of-materials'],
  assembly: ['manufacturing/#beultetes', 'manufacturing/#assembly'],
  sheets: ['manufacturing/#lapok', 'manufacturing/#sheets'],
  dims: ['manufacturing/#meretrajz', 'manufacturing/#drawing'],
  agent: ['claude/#beepitett-agent', 'claude/#built-in-agent'],
  mcp: ['claude/#claude-desktop-es-claude-code-mcp', 'claude/#claude-desktop-and-claude-code-mcp'],
  saving: ['saving/', 'saving/'],
  share: ['saving/#megosztas-linkkel', 'saving/#sharing-as-a-link'],
  json: ['saving/#haladoknak', 'saving/#for-advanced-users'],
  shortcuts: ['shortcuts/', 'shortcuts/'],
} as const satisfies Record<string, readonly [string, string]>;
export type HelpTopic = keyof typeof HELP;

/** A kézikönyv címe (az app gyökeréhez képest), pl. `guide/hu/wiring/#kapcsolatok`. */
export function helpUrl(topic: HelpTopic, lang: Lang): string {
  const [hu, en] = HELP[topic];
  return lang === 'hu' ? 'guide/hu/' + hu : 'guide/' + en;
}

const resolvers = new Map<string, () => HelpTopic>();
/** Helyzetfüggő téma (`@név`) feloldója, pl. a jobb sáv aktív füléből. */
export function setHelpResolver(name: string, f: () => HelpTopic): void { resolvers.set(name.replace(/^@/, ''), f); }
function resolve(key: string): HelpTopic | null {
  if (key.startsWith('@')) { const f = resolvers.get(key.slice(1)); return f ? f() : null; }
  return key in HELP ? (key as HelpTopic) : null;
}

/** „?” gomb kódból épített felülethez. */
export function helpBtn(topic: HelpTopic | `@${string}`, tr: Tr, cls = 'btn icon ghost hlp'): string {
  const t = tr('Súgó: a kézikönyv erről szóló része (új lapon)');
  return `<a class="${cls}" data-help="${topic}" href="#" target="_blank" rel="noopener" title="${t}" aria-label="${t}">${icon('help')}</a>`;
}

/**
 * A `[data-help]` linkek kezelése: a cím a kattintás (és a fölé állás) pillanatában a felület nyelve és a helyzet szerint áll be,
 * így a nyelvváltás és a fülváltás után is jó helyre visz. A statikus gombok ikonját és feliratát is beállítja (`sync`).
 */
export function mountHelp(root: Document | HTMLElement, lang: () => Lang, tr: Tr): { sync(): void; url(key: string): string | null } {
  const url = (key: string) => { const t = resolve(key); return t ? helpUrl(t, lang()) : null; };
  const fix = (a: HTMLAnchorElement) => { const u = url(a.dataset.help || ''); if (u) a.href = u; };
  const on = (e: Event) => { const a = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a[data-help]'); if (a) fix(a); };
  root.addEventListener('pointerdown', on, true);
  root.addEventListener('pointerover', on, true);
  root.addEventListener('focusin', on, true);
  root.addEventListener('click', on, true);
  const sync = () => {
    const t = tr('Súgó: a kézikönyv erről szóló része (új lapon)');
    for (const a of (root instanceof Document ? root.body : root).querySelectorAll<HTMLAnchorElement>('a[data-help]')) {
      if (!a.firstElementChild) a.innerHTML = icon('help');
      a.title = t; a.setAttribute('aria-label', t); a.target = '_blank'; a.rel = 'noopener';
      fix(a);
    }
  };
  return { sync, url };
}
