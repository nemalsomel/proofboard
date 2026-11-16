/**
 * Kézikönyv (guide/): a fejezetek Markdownban (`guide/content/<nyelv>/NN-<slug>.md`, fejléc: title, description),
 * ebből statikus HTML-oldalak készülnek a Vite több-oldalas buildjéhez:
 *   guide/index.html, guide/<slug>/index.html (angol, alapértelmezett) és guide/hu/… (magyar),
 * valamint a keresés indexe: public/guide/search-<nyelv>.json. A kimenet generált (.gitignore), a forrás a Markdown.
 * Kiegészítések a Markdownban:
 *   - kép: ![alt](img:<név> "felirat") → public/guide/img/<név>-<nyelv>.jpg, nagyítható
 *   - fejezetre mutató link: [szöveg](<slug>) vagy [szöveg](<slug>#horgony)
 *   - `> **Tipp:** …` / `> **Figyelem:** …` kiemelt doboz
 *   - {{shortcuts}}: a gyorsbillentyűk táblázata (guide/data/commands-<nyelv>.json, a képernyőkép-szkript írja)
 *   - {{glossary}}: a fogalomtár (magyarul a docs/fogalomtar.md táblázataiból)
 * A vite.config.ts hívja (buildGuide), így build és dev előtt is friss.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Marked, type Tokens } from 'marked';

type Lang = 'hu' | 'en';
const LANGS: Lang[] = ['en', 'hu'];
const SITE = 'https://nemalsomel.github.io/proofboard/guide/';
const REPO = 'https://github.com/nemalsomel/proofboard';
/** a képernyőképek mérete (px, 2× sűrűség) */
const SHOT_W = 2160, SHOT_H = 1350;

const L = {
  hu: {
    guide: 'Kézikönyv', open: 'Proofboard megnyitása', openSm: 'Megnyitás', chapters: 'Fejezetek', onPage: 'Ezen az oldalon',
    prev: 'Előző', next: 'Következő', edit: 'Javítás a GitHubon', search: 'Keresés a kézikönyvben', noHit: 'Nincs találat.',
    about: 'Bemutató oldal', skip: 'Ugrás a tartalomra', home: 'A kézikönyv kezdőlapja',
    lead: 'Hogyan tervezz, köss be, programozz, szimulálj és építs meg egy próbapanelt a Proofboarddal – lépésenként, képekkel.',
    title: 'Proofboard kézikönyv', group: 'Csoport', cmd: 'Parancs', keys: 'Billentyű', term: 'Fogalom', meaning: 'Jelentés',
    close: 'Bezárás', locale: 'hu_HU',
  },
  en: {
    guide: 'Guide', open: 'Open Proofboard', openSm: 'Open', chapters: 'Chapters', onPage: 'On this page',
    prev: 'Previous', next: 'Next', edit: 'Edit on GitHub', search: 'Search the guide', noHit: 'No results.',
    about: 'About Proofboard', skip: 'Skip to content', home: 'Guide home',
    lead: 'How to lay out, wire, program, simulate and build a perfboard circuit with Proofboard – step by step, with pictures.',
    title: 'Proofboard guide', group: 'Group', cmd: 'Command', keys: 'Keys', term: 'Term', meaning: 'Meaning',
    close: 'Close', locale: 'en_US',
  },
} as const;

interface Chapter { slug: string; file: string; title: string; description: string; md: string }
interface Section { t: string; h: string; u: string; x: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slugify = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function readChapters(dir: string): Chapter[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /^\d+-[a-z0-9-]+\.md$/.test(f)).sort().map(f => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
    const meta: Record<string, string> = {};
    if (m) for (const line of m[1].split('\n')) { const i = line.indexOf(':'); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
    return { slug: f.replace(/^\d+-/, '').replace(/\.md$/, ''), file: f, title: meta.title || f, description: meta.description || '', md: m ? src.slice(m[0].length) : src };
  });
}

/** A fogalomtár táblázatai (az első két oszlop) a docs/fogalomtar.md-ből. */
function glossaryFromDocs(root: string): string {
  const src = fs.readFileSync(path.join(root, 'docs', 'fogalomtar.md'), 'utf8');
  const out: string[] = [];
  for (const line of src.split('\n')) {
    if (line.startsWith('## ')) out.push('', line.replace(/^## /, '### '), '', '| Fogalom | Jelentés |', '| --- | --- |');
    else if (/^\| \*\*/.test(line)) { const c = line.split('|').map(s => s.trim()); out.push(`| ${c[1]} | ${c[2]} |`); }
  }
  return out.join('\n');
}

interface Cmd { group: string; name: string; keys: string[] }
function shortcutsMd(root: string, lang: Lang): string {
  const f = path.join(root, 'guide', 'data', `commands-${lang}.json`);
  if (!fs.existsSync(f)) return '';
  const cmds = JSON.parse(fs.readFileSync(f, 'utf8')) as Cmd[];
  const groups = [...new Set(cmds.map(c => c.group))];
  return groups.map(g => [`### ${g}`, '', `| ${L[lang].cmd} | ${L[lang].keys} |`, '| --- | --- |',
    ...cmds.filter(c => c.group === g).map(c => `| ${c.name.replace(/\|/g, '\\|')} | ${c.keys.map(k => k.split('+').map(x => `<kbd>${esc(x)}</kbd>`).join('+')).join(' / ')} |`)].join('\n')).join('\n\n');
}

function render(md: string, lang: Lang, rel: string, slugs: Set<string>) {
  const toc: Array<{ id: string; text: string }> = [];
  const used = new Set<string>();
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Heading) {
        const html = this.parser.parseInline(t.tokens);
        let id = slugify(plain(html)) || 'h', k = 2; while (used.has(id)) id = slugify(plain(html)) + '-' + k++;
        used.add(id);
        if (t.depth === 2) toc.push({ id, text: plain(html) });
        return `<h${t.depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${html}</h${t.depth}>\n`;
      },
      image(t: Tokens.Image) {
        const m = /^img:([a-z0-9-]+)$/.exec(t.href);
        if (!m) return `<img src="${esc(t.href)}" alt="${esc(t.text)}">`;
        const file = `${m[1]}-${lang}.jpg`;
        return `<figure class="shot"><a href="${rel}img/${file}"><img src="/guide/img/${file}" width="${SHOT_W}" height="${SHOT_H}" alt="${esc(t.text)}" loading="lazy"></a>${t.title ? `<figcaption>${esc(t.title)}</figcaption>` : ''}</figure>`;
      },
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Link) {
        const text = this.parser.parseInline(t.tokens);
        const m = /^([a-z0-9-]+)(#.*)?$/.exec(t.href);
        if (m && slugs.has(m[1])) return `<a href="${rel}${lang === 'hu' ? 'hu/' : ''}${m[1]}/${m[2] || ''}">${text}</a>`;
        const ext = /^https?:/.test(t.href);
        return `<a href="${esc(t.href)}"${ext ? ' rel="noopener"' : ''}>${text}</a>`;
      },
      blockquote(this: { parser: { parse(t: Tokens.Generic[]): string } }, t: Tokens.Blockquote) {
        const body = this.parser.parse(t.tokens);
        const kind = /^<p><strong>(Figyelem|Warning|Careful)/.test(body) ? 'warn' : 'tip';
        return `<aside class="note ${kind}">${body}</aside>\n`;
      },
      table(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: string) => `<${tag}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        const keys = t.header.length === 2 && ['Billentyű', 'Keys'].includes(plain(this.parser.parseInline(t.header[1].tokens)));
        return `<div class="tbl"><table${keys ? ' class="keys"' : ''}><thead><tr>${t.header.map(c => cell(c, 'th')).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map(c => cell(c, 'td')).join('')}</tr>`).join('')}</tbody></table></div>\n`;
      },
    },
  });
  const html = marked.parse(md, { async: false }) as string;
  return { html, toc };
}

/** Szakaszok a kereséshez: a h2/h3 címek mentén. */
function sections(html: string, title: string, url: string): Section[] {
  const out: Section[] = [];
  const parts = html.split(/(?=<h[23] id=")/);
  for (const p of parts) {
    const m = /^<h[23] id="([^"]+)">([\s\S]*?)<\/h[23]>/.exec(p);
    const h = m ? plain(m[2]).replace(/^#/, '').trim() : '';
    const x = plain(m ? p.slice(m[0].length) : p);
    if (!h && !x) continue;
    out.push({ t: title, h, u: url + (m ? '#' + m[1] : ''), x: x.slice(0, 600) });
  }
  return out;
}

function page(o: { lang: Lang; rel: string; path: string; title: string; description: string; body: string; nav: string; toc: string; alt: string; appRel: string; editUrl?: string }): string {
  const t = L[o.lang], other: Lang = o.lang === 'hu' ? 'en' : 'hu';
  const canon = SITE + (o.lang === 'hu' ? 'hu/' : '') + o.path;
  const altUrl = SITE + (other === 'hu' ? 'hu/' : '') + o.path;
  return `<!doctype html>
<html lang="${o.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">
<meta name="theme-color" content="#0f5c66">
<link rel="canonical" href="${canon}">
<link rel="alternate" hreflang="${o.lang}" href="${canon}">
<link rel="alternate" hreflang="${other}" href="${altUrl}">
<link rel="alternate" hreflang="x-default" href="${o.lang === 'en' ? canon : altUrl}">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Proofboard">
<meta property="og:locale" content="${t.locale}">
<meta property="og:title" content="${esc(o.title)}">
<meta property="og:description" content="${esc(o.description)}">
<meta property="og:url" content="${canon}">
<meta property="og:image" content="https://nemalsomel.github.io/proofboard/about/img/og-${o.lang}.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${o.rel}guide.css">
</head>
<body data-root="${o.rel}" data-lang="${o.lang}">
<a class="skip" href="#tartalom">${t.skip}</a>
<header class="top">
  <a class="brand" href="${o.rel}${o.lang === 'hu' ? 'hu/' : ''}" title="${t.home}"><img src="/icon.svg" alt="" width="26" height="26">Proofboard <span>${t.guide}</span></a>
  <div class="search" role="search">
    <input type="search" id="q" placeholder="${t.search}" aria-label="${t.search}" autocomplete="off" data-nohit="${t.noHit}">
    <kbd class="q-key" aria-hidden="true">/</kbd>
    <ol id="hits" hidden></ol>
  </div>
  <div class="langsw" role="group" aria-label="Nyelv / Language">${o.lang === 'en' ? `<a aria-current="page">EN</a><a href="${o.alt}" hreflang="hu" lang="hu">HU</a>` : `<a href="${o.alt}" hreflang="en" lang="en">EN</a><a aria-current="page">HU</a>`}</div>
  <a class="btn go sm" href="${o.appRel}">${t.openSm}</a>
</header>
<div class="strip" aria-hidden="true"></div>
<div class="layout">
  <nav class="side" aria-label="${t.chapters}">
    <details open><summary>${t.chapters}</summary>${o.nav}</details>
  </nav>
  <main id="tartalom">
${o.body}
${o.editUrl ? `<p class="edit"><a href="${o.editUrl}" rel="noopener">${t.edit}</a></p>` : ''}
  </main>
  <aside class="toc" aria-label="${t.onPage}">${o.toc}</aside>
</div>
<footer><div><a href="${o.appRel}">${t.open}</a><a href="${o.appRel}about/${o.lang === 'hu' ? 'hu/' : ''}">${t.about}</a><a href="${REPO}" rel="noopener">GitHub</a></div></footer>
<script type="module" src="${o.rel}guide.ts"></script>
</body>
</html>
`;
}

/** A kézikönyv oldalainak elkészítése; a visszatérés a HTML-fájlok útvonala (a Vite bemenetei). */
export function buildGuide(root: string): string[] {
  const G = path.join(root, 'guide');
  const inputs: string[] = [];
  const byLang = Object.fromEntries(LANGS.map(l => [l, readChapters(path.join(G, 'content', l))])) as Record<Lang, Chapter[]>;
  // a hiányzó fordítás helyén a másik nyelv fejezete (amíg elkészül)
  for (const l of LANGS) {
    const o: Lang = l === 'hu' ? 'en' : 'hu';
    for (const c of byLang[o]) if (!byLang[l].some(x => x.slug === c.slug)) byLang[l].push(c);
    byLang[l].sort((a, b) => a.file.localeCompare(b.file));
  }
  const pub = path.join(root, 'public', 'guide');
  fs.mkdirSync(pub, { recursive: true });
  for (const lang of LANGS) {
    const chs = byLang[lang], t = L[lang], slugs = new Set(chs.map(c => c.slug));
    const base = lang === 'hu' ? path.join(G, 'hu') : G;
    const index: Section[] = [];
    const navFor = (rel: string, cur: string | null) => `<ol>${chs.map(c => `<li><a href="${rel}${lang === 'hu' ? 'hu/' : ''}${c.slug}/"${c.slug === cur ? ' aria-current="page"' : ''}>${esc(c.title)}</a></li>`).join('')}</ol>`;
    const write = (dir: string, html: string) => { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, 'index.html'); fs.writeFileSync(f, html); inputs.push(f); };
    // kezdőlap
    {
      const rel = lang === 'hu' ? '../' : '';
      const body = `<h1>${t.title}</h1>
<p class="lead">${t.lead}</p>
<ol class="chapters">${chs.map(c => `<li><a href="${c.slug}/"><b>${esc(c.title)}</b><span>${esc(c.description)}</span></a></li>`).join('')}</ol>`;
      write(base, page({ lang, rel, path: '', title: t.title, description: t.lead, body, nav: navFor(rel, null), toc: '', alt: lang === 'hu' ? '../' : 'hu/', appRel: rel + '../' }));
    }
    chs.forEach((c, i) => {
      const rel = lang === 'hu' ? '../../' : '../';
      let md = c.md.replace('{{shortcuts}}', () => shortcutsMd(root, lang));
      md = md.replace('{{glossary}}', () => (lang === 'hu' ? glossaryFromDocs(root) : ''));
      const { html, toc } = render(md, lang, rel, slugs);
      const prev = chs[i - 1], next = chs[i + 1];
      const pn = `<nav class="pn" aria-label="${t.prev} / ${t.next}">${prev ? `<a class="prev" href="../${prev.slug}/"><small>${t.prev}</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="../${next.slug}/"><small>${t.next}</small>${esc(next.title)}</a>` : ''}</nav>`;
      const tocHtml = toc.length > 1 ? `<p>${t.onPage}</p><ol>${toc.map(h => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol>` : '';
      const srcLang = fs.existsSync(path.join(G, 'content', lang, c.file)) ? lang : (lang === 'hu' ? 'en' : 'hu');
      write(path.join(base, c.slug), page({
        lang, rel, path: c.slug + '/', title: `${c.title} – ${t.title}`, description: c.description, body: `<article>\n<h1>${esc(c.title)}</h1>\n${html}\n</article>\n${pn}`,
        nav: navFor(rel, c.slug), toc: tocHtml, alt: lang === 'hu' ? `../../${c.slug}/` : `../hu/${c.slug}/`, appRel: rel + '../',
        editUrl: `${REPO}/edit/main/guide/content/${srcLang}/${c.file}`,
      }));
      index.push(...sections(html, c.title, (lang === 'hu' ? 'hu/' : '') + c.slug + '/'));
    });
    fs.writeFileSync(path.join(pub, `search-${lang}.json`), JSON.stringify(index));
  }
  return inputs;
}
