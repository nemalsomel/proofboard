/**
 * Agent csevegőpanel (jobb sáv, „Agent” fül): saját API-kulcs és modell, Megbeszélés / Megvalósítás mód,
 * üzenetek, az eszközlépések sorai, bevitel, Küldés / Leállítás, a projekt beszélgetései (mentve, listából
 * megnyithatók), a projektjegyzet szerkesztője. Hosszú beszélgetésnél a régi eszközeredmények rövidülnek, majd a
 * korábbi rész összefoglalóra cserélődik, hogy a kérések ne dráguljanak. A modellhívások ciklusa az
 * `agent/client.ts`, az eszközök az `agent/tools.ts`; a gazda (`app.ts`) adja az élő terv környezetét, a
 * visszavonást (egy feladat = egy lépés) és a „vezérlés alatt” jelzést (`AgentHost`).
 */
import { compactImages, DEFAULT_MODEL, historyTokens, MODELS, pruneHistory, repairHistory, runAgent, summarizeHistory, type AgentError, type Block, type Message } from '../agent/client';
import { systemPrompt, type AgentMode } from '../agent/prompt';
import { runTool, summarize, TOOLS, toolSpecs, type ToolCtx, type ToolResult } from '../agent/tools';
import { N_, t as tr } from '../i18n/i18n';
import { icon } from './icons';

/** A böngészőben megjegyzett beállítások. */
export interface AgentPrefs { key?: string; model?: string; mode?: AgentMode }

export interface AgentHost {
  readonly root: HTMLElement;
  /** az élő terv környezete (a felület `commit`-jával, panelképpel, példákkal) */ ctx(): ToolCtx;
  lang(): 'hu' | 'en';
  /** a terv lenyomata: változott-e a terv a legutóbbi feladat óta */ designKey(): string;
  /** feladat kezdete: visszavonási pont, „Agent dolgozik” jelzés, kézi szerkesztés szünetel */ begin(stop: () => void): void;
  /** feladat vége: ha nem változott a terv, a visszavonási pont eldobódik */ end(changed: boolean): void;
  loadPrefs(): AgentPrefs; savePrefs(p: AgentPrefs, remember: boolean): void;
  /** a projekt azonosítója (a beszélgetések ehhez kötődnek; ha a tervnek még nincs, kap) */ projectId(): string;
  /** a projekt mentett beszélgetései, és a mentésük (sikertelen mentésnél false) */ loadChats(pid: string): StoredChat[]; saveChats(pid: string, list: StoredChat[]): boolean;
  /** a projektjegyzet (a terv része) és a módosítása (visszavonható) */ brief(): string; setBrief(t: string): void;
  /** tesztben cserélhető hálózati hívás */ fetch?: typeof fetch;
}

/** Az eszközök neve a felületen. */
const TOOL_HU: Record<string, string> = {
  get_design: N_('Terv áttekintése'), list_part_types: N_('Alkatrészek keresése'), describe_part_type: N_('Alkatrész adatai'), get_part: N_('Alkatrész lábai'),
  place_part: N_('Lerakás'), move_part: N_('Mozgatás'), set_params: N_('Paraméterek'), remove_parts: N_('Törlés'), connect: N_('Kapcsolat'), disconnect: N_('Kapcsolat törlése'),
  route: N_('Útvonalak'), get_problems: N_('Problémák'), simulate: N_('Szimuláció'), set_gpio_mode: N_('GPIO mód'), add_note: N_('Jegyzet'), generate_code: N_('Kód'),
  get_board_image: N_('Panelkép'), list_examples: N_('Példák'), load_example: N_('Példa betöltése'), new_design: N_('Új terv'), set_project_notes: N_('Projektjegyzet'), plan_compaction: N_('Tömörítés előnézete'), compact_layout: N_('Tömörítés'), set_fixed: N_('Rögzítés'), get_part_definition: N_('Alkatrészleírás'), get_part_form: N_('Alkatrész-űrlap'), get_part_schema: N_('Alkatrész-séma'), list_block_types: N_('Blokktípusok'), get_program: N_('Program'), add_block: N_('Blokk felvétele'), set_block_params: N_('Blokk beállítása'), connect_blocks: N_('Blokkok összekötése'), disconnect_blocks: N_('Blokkok szétkötése'), remove_blocks: N_('Blokk törlése'), arrange_program: N_('Program elrendezése'), run_program: N_('Program futtatása'), save_custom_part: N_('Saját alkatrész mentése'), get_share_link: N_('Megosztási link'), open_share_link: N_('Megosztott terv megnyitása'),
};

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));

/** Egyszerű, biztonságos markdown: bekezdés, felsorolás, félkövér, dőlt, kód, kódblokk, címsor, táblázat, vízszintes vonal. */
export function mdToHtml(src: string): string {
  const out: string[] = [], blocks = src.replace(/\r/g, '').split(/```/);
  blocks.forEach((b, i) => {
    if (i % 2) { const nl = b.indexOf('\n'); out.push(`<pre><code>${esc(nl >= 0 ? b.slice(nl + 1) : b).replace(/\n$/, '')}</code></pre>`); return; }
    const inline = (x: string) => esc(x).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
    let list: string[] | null = null, ol = false;
    const flush = () => { if (list) { out.push(`<${ol ? 'ol' : 'ul'}>${list.map(x => `<li>${x}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`); list = null; } };
    let para: string[] = [];
    const flushP = () => { if (para.length) { out.push(`<p>${para.join('<br>')}</p>`); para = []; } };
    const lines = b.split('\n');
    /** táblázatsor cellái: | a | b | → ['a','b'] (a szélső | elhagyható; \| a cellán belül) */
    const cells = (x: string) => x.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
    const isSep = (x: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(x) && x.includes('-');
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      // táblázat: fejléc | elválasztó (---) | sorok
      if (line.includes('|') && li + 1 < lines.length && isSep(lines[li + 1])) {
        flush(); flushP();
        const head = cells(line), al = cells(lines[li + 1]).map(c => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
        const rows: string[][] = []; li += 2;
        while (li < lines.length && lines[li].includes('|') && lines[li].trim()) { rows.push(cells(lines[li])); li++; }
        li--;
        const td = (tag: string, c: string, k: number) => `<${tag}${al[k] ? ` style="text-align:${al[k]}"` : ''}>${inline(c)}</${tag}>`;
        out.push(`<div class="ag-tablewrap"><table class="ag-table"><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => td('td', r[k] ?? '', k)).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); flushP(); out.push('<hr>'); continue; }
      const m = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line), h = /^#{1,4}\s+(.*)$/.exec(line);
      if (m) { flushP(); const o = /\d/.test(m[1]); if (list && o !== ol) flush(); ol = o; (list ||= []).push(inline(m[2])); continue; }
      flush();
      if (h) { flushP(); out.push(`<p><b>${inline(h[1])}</b></p>`); continue; }
      if (!line.trim()) { flushP(); continue; }
      para.push(inline(line));
    }
    flush(); flushP();
  });
  return out.join('');
}

/** A hibák a felhasználónak. */
function errorText(e: AgentError): string {
  switch (e.code) {
    case 'auth': return tr('Az API-kulcs érvénytelen vagy nincs jogosultsága. Ellenőrizd a beállításokban.');
    case 'billing': return tr('Az Anthropic-fiókodon nincs elég egyenleg. A console.anthropic.com oldalon töltheted fel.');
    case 'rate': return tr('Túl sok kérés rövid idő alatt (sebességkorlát). Várj egy kicsit, és próbáld újra.');
    case 'overloaded': return tr('Az API most túlterhelt. Próbáld újra kicsit később.');
    case 'network': return tr('Nem sikerült elérni az API-t (hálózati hiba). Ellenőrizd a kapcsolatot.');
    case 'aborted': return tr('Leállítva.');
    case 'steps': return tr('A feladat túl sok lépésből állt, ezért megállt. Írd meg, folytassa-e.');
    default: return tr('Hiba az API-hívásban: {x}', { x: e.message });
  }
}

/** Egy mentett beszélgetés: a modellnek szóló előzmények (képek nélkül), a felület sorai, az összefoglaló. */
export interface StoredChat {
  id: string; title: string; created: number; updated: number;
  messages: Message[]; entries: Entry[]; usage: { in: number; out: number };
  /** a korábbi, összefoglalóra cserélt rész */ summary?: string;
}
/** projektenként ennyi beszélgetés marad meg (a legrégebbiek törlődnek) */
export const MAX_CHATS = 20;
/** e fölött a régi eszközeredmények rövidülnek, illetve a korábbi rész összefoglalóra cserélődik (becsült token) */
export const PRUNE_AT = 40000, SUMMARIZE_AT = 80000;

/** Mentésre: a képek kimaradnak, a hosszú eszközeredmények rövidülnek. */
export function chatForStorage(c: StoredChat): StoredChat {
  const strip = (m: Message): Message => (typeof m.content === 'string' ? m : { ...m, content: m.content.map(b => (b.type === 'tool_result' ? { ...b, content: b.content.map(x => (x.type === 'image' ? { type: 'text' as const, text: '[board image]' } : x)) } : b)) });
  return { ...c, messages: compactImages(c.messages).map(strip), entries: c.entries.map(e => (e.k === 'tool' && e.result ? { ...e, result: { ...e.result, image: undefined, text: e.result.text.length > 3000 ? e.result.text.slice(0, 3000) + '…' : e.result.text } } : e)) };
}

export type Entry =
  | { k: 'user'; text: string }
  | { k: 'text'; text: string }
  | { k: 'tool'; id: string; name: string; input: unknown; result?: ToolResult }
  | { k: 'error'; text: string }
  | { k: 'info'; text: string };

export interface AgentPanel { render(): void; busy(): boolean; stop(): void; send(text: string): Promise<void>; entries(): number;
  /** a megnyitott beszélgetések projektje (ha a terv azonosítója ettől eltér, a panel rajzolása átvált) */ project(): string }

export function mountAgentPanel(H: AgentHost): AgentPanel {
  const root = H.root;
  root.innerHTML = `<div class="ag">
    <div class="ag-head">
      <div class="grp seg" id="agMode" role="group"><button class="btn" data-mode="discuss"></button><button class="btn" data-mode="build"></button></div>
      <span class="sp"></span>
      <button class="btn icon ghost" id="agHist" aria-expanded="false">${icon('list')}</button>
      <button class="btn icon ghost" id="agNew">${icon('plus')}</button>
      <button class="btn icon ghost" id="agCfg">${icon('key')}</button>
    </div>
    <form class="ag-setup" id="agSetup" hidden>
      <label class="small" for="agKey" id="agKeyL"></label>
      <input type="password" id="agKey" autocomplete="off" spellcheck="false" placeholder="sk-ant-…">
      <label class="small" for="agModel" id="agModelL"></label>
      <select id="agModel">${MODELS.map(m => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select>
      <label class="check small"><input type="checkbox" id="agRemember" checked> <span id="agRememberL"></span></label>
      <p class="help" id="agKeyHelp"></p>
      <div class="row"><button class="btn primary" id="agSave" type="submit"></button><button class="btn ghost" id="agForget" type="button"></button></div>
    </form>
    <div class="ag-hist" id="agHistList" hidden></div>
    <details class="ag-brief" id="agBriefBox"><summary><span id="agBriefL"></span> <span class="small muted" id="agBriefN"></span></summary>
      <textarea id="agBrief" rows="5" spellcheck="true"></textarea><p class="help" id="agBriefHelp"></p></details>
    <div class="ag-log" id="agLog" aria-live="polite"></div>
    <div class="ag-input">
      <textarea id="agText" rows="3"></textarea>
      <div class="row ag-acts"><span class="small muted" id="agUsage"></span><span class="sp"></span>
        <button class="btn danger" id="agStop" hidden>${icon('stop')}<span></span></button>
        <button class="btn primary" id="agSend">${icon('send')}<span></span></button></div>
    </div>
  </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(s: string) => root.querySelector<T>(s)!;
  let prefs: AgentPrefs = H.loadPrefs(), remember = true;
  let messages: Message[] = [], entries: Entry[] = [], running: AbortController | null = null, lastKey = '', usage = { in: 0, out: 0 };
  /** a megnyitott beszélgetés (mentéskor) és a projekt, amelyhez tartozik */
  let chatId = '', created = 0, summary: string | undefined, pid = '';
  const newId = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function open(c: StoredChat | null) {
    messages = c ? c.messages : []; entries = c ? c.entries : []; usage = c ? { ...c.usage } : { in: 0, out: 0 }; summary = c ? c.summary : undefined;
    chatId = c ? c.id : ''; created = c ? c.created : 0; lastKey = '';
  }
  /** a projekt beszélgetései: a legutóbbi nyílik meg */
  function switchProject(p: string) { pid = p; const list = H.loadChats(p).sort((a, b) => b.updated - a.updated); open(list[0] || null); }
  /** a beszélgetés mentése (ha van mit) */
  function persist() {
    if (!entries.length) return;
    if (!chatId) { chatId = newId(); created = Date.now(); }
    const first = entries.find(e => e.k === 'user') as { text: string } | undefined, title = (first ? first.text : '…').replace(/\s+/g, ' ').slice(0, 70);
    const c = chatForStorage({ id: chatId, title, created, updated: Date.now(), messages, entries, usage, ...(summary ? { summary } : {}) });
    let list = [c, ...H.loadChats(pid).filter(x => x.id !== chatId)].sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS);
    while (!H.saveChats(pid, list) && list.length > 1) list = list.slice(0, -1); // betelt a tárhely: a legrégebbiek mennek
  }
  const mode = (): AgentMode => prefs.mode || 'build';
  const model = () => prefs.model || DEFAULT_MODEL;

  /* felirat (nyelvváltáskor is) */
  function relabel() {
    $('#agMode').setAttribute('aria-label', tr('Agent mód'));
    $('[data-mode="discuss"]').textContent = tr('Megbeszélés'); $('[data-mode="discuss"]').title = tr('Megbeszélés: az agent olvassa és elemzi a tervet, javasol, de nem módosít');
    $('[data-mode="build"]').textContent = tr('Megvalósítás'); $('[data-mode="build"]').title = tr('Megvalósítás: az agent módosíthatja a tervet (egy feladat egy lépésben visszavonható)');
    for (const [id, l] of [['#agNew', tr('Új beszélgetés')], ['#agCfg', tr('API-kulcs és modell')], ['#agHist', tr('Korábbi beszélgetések')]]) { $(id).title = l; $(id).setAttribute('aria-label', l); }
    $('#agBriefL').textContent = tr('Projektjegyzet');
    $('#agBrief').setAttribute('placeholder', tr('Mit építünk, és mire jutottunk? Pl. „Motorvezérlő ESP32-C3-mal, 1 cellás akkuról; DRV8833 meghajtó; IN1 = GPIO4, IN2 = GPIO5.”'));
    $('#agBriefHelp').textContent = tr('A terv része: az agent minden beszélgetés elején megkapja, és a fontos döntéseket ide jegyzi. Te is szerkesztheted.');
    $('#agKeyL').textContent = tr('Anthropic API-kulcs'); $('#agModelL').textContent = tr('Modell'); $('#agRememberL').textContent = tr('Megjegyzés ebben a böngészőben');
    $('#agKeyHelp').innerHTML = tr('A kulcs csak ebben a böngészőben marad; a kérések közvetlenül az Anthropic API-hoz mennek, a használat díját a saját fiókod fizeti. Kulcsot a {x} oldalon kaphatsz.', { x: '<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>' });
    $('#agSave').textContent = tr('Mentés'); $('#agForget').textContent = tr('Kulcs törlése');
    $('#agText').setAttribute('placeholder', mode() === 'build' ? tr('Mit építsünk? Pl. „Tegyél egy LED-et előtét-ellenállással a GP15-re.”') : tr('Mit beszéljünk meg? Pl. „Milyen tranzisztorral kapcsoljak egy 12 V-os ventilátort?”'));
    $('#agText').setAttribute('aria-label', tr('Üzenet az agentnek'));
    $('#agSend span').textContent = tr('Küldés'); $('#agStop span').textContent = tr('Leállítás');
  }

  function toolLine(e: Extract<Entry, { k: 'tool' }>): string {
    const i = (e.input || {}) as Record<string, unknown>, r = e.result;
    const detail = i.label ? String(i.label) : i.type ? String(i.type) : i.from ? `${i.from} → ${i.to ?? '–'}` : i.pin ? `${i.pin} ${i.mode ?? ''}` : i.labels ? (i.labels as string[]).join(', ') : i.query != null ? `„${i.query}”` : i.id ? String(i.id) : '';
    const st = !r ? 'run' : r.isError ? 'err' : 'ok', first = r ? r.text.split('\n')[0] : '';
    return `<details class="ag-tool ${st}"><summary>${icon(st === 'err' ? 'warn' : st === 'ok' ? 'check' : 'pulse')}<b>${esc(tr(TOOL_HU[e.name] || e.name))}</b> <span class="muted">${esc(detail)}</span></summary>${r ? `<pre>${esc(r.text.length > 4000 ? r.text.slice(0, 4000) + '…' : r.text)}</pre>` : ''}</details>${r && r.isError ? `<div class="ag-terr small">${esc(first)}</div>` : ''}`;
  }

  function histHtml(): string {
    const list = H.loadChats(pid).sort((a, b) => b.updated - a.updated);
    if (!list.length) return `<div class="small muted">${tr('Ehhez a projekthez még nincs mentett beszélgetés.')}</div>`;
    const when = (t: number) => new Date(t).toLocaleString(H.lang() === 'hu' ? 'hu-HU' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return list.map(c => `<div class="ag-hrow${c.id === chatId ? ' on' : ''}"><button class="ag-hopen" data-chat="${c.id}"><span class="t">${esc(c.title)}</span><span class="small muted">${when(c.updated)} · ${tr('{n} üzenet', { n: c.entries.filter(e => e.k === 'user').length })}</span></button><button class="btn icon ghost" data-chatdel="${c.id}" title="${esc(tr('Beszélgetés törlése'))}" aria-label="${esc(tr('Beszélgetés törlése'))}">${icon('trash')}</button></div>`).join('');
  }

  function render() {
    relabel();
    { const p = H.projectId(); if (p !== pid && !running) switchProject(p); } // másik terv (betöltés, példa): annak a beszélgetései
    const hl = $('#agHistList'); if (!hl.hidden) hl.innerHTML = histHtml();
    { const b = H.brief(), ta = $<HTMLTextAreaElement>('#agBrief'); if (document.activeElement !== ta) ta.value = b; $('#agBriefN').textContent = b ? tr('{n} sor', { n: b.split('\n').length }) : tr('üres'); }
    const hasKey = !!prefs.key, busy = !!running;
    $('#agSetup').hidden = hasKey && !root.classList.contains('cfg');
    if (!$('#agSetup').hidden) { $<HTMLInputElement>('#agKey').value = prefs.key || ''; $<HTMLSelectElement>('#agModel').value = model(); $<HTMLInputElement>('#agRemember').checked = remember; $('#agForget').hidden = !prefs.key; }
    root.querySelectorAll<HTMLElement>('[data-mode]').forEach(b => { const on = b.dataset.mode === mode(); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); (b as HTMLButtonElement).disabled = busy; });
    $<HTMLTextAreaElement>('#agText').disabled = !hasKey; $<HTMLButtonElement>('#agSend').disabled = !hasKey || busy;
    $('#agSend').hidden = busy; $('#agStop').hidden = !busy; $<HTMLButtonElement>('#agNew').disabled = busy; $<HTMLButtonElement>('#agHist').disabled = busy;
    $<HTMLTextAreaElement>('#agBrief').disabled = busy;
    const log = $('#agLog');
    log.innerHTML = entries.length ? entries.map((e, idx) =>
      e.k === 'user' ? `<div class="ag-msg u">${esc(e.text).replace(/\n/g, '<br>')}</div>`
        : e.k === 'text' ? `<div class="ag-msg a">${mdToHtml(e.text)}<div class="ag-msg-acts"><button class="btn ghost ag-copy" data-copy="${idx}" title="${esc(tr('Válasz másolása (markdown)'))}">${icon('copy')}<span>${esc(tr('Másolás'))}</span></button></div></div>`
          : e.k === 'tool' ? toolLine(e)
            : `<div class="ag-msg ${e.k === 'error' ? 'err' : 'info'} small">${esc(e.text)}</div>`).join('')
      + (busy ? `<div class="ag-busy small muted">${icon('pulse')} ${tr('Dolgozik…')}</div>` : '')
      : `<div class="ag-empty small muted">${hasKey ? mdToHtml(mode() === 'build' ? tr('Írd le, mit szeretnél: az agent lerakja és beköti az alkatrészeket, ellenőrzi a Problémákat, és szimulál. Nagyobb változtatás előtt tervet mutat és rákérdez. Minden feladat egy lépésben visszavonható.') : tr('Megbeszélés mód: az agent látja a tervet, számol, magyaráz és javasol, de nem módosít. Építéshez válts Megvalósítás módra.')) : tr('Az agenthez saját Anthropic API-kulcs kell. Add meg fent; a kulcs csak ebben a böngészőben tárolódik.')}</div>`;
    log.scrollTop = log.scrollHeight;
    $('#agUsage').textContent = usage.in ? tr('{i} be / {o} ki token', { i: usage.in.toLocaleString(), o: usage.out.toLocaleString() }) : '';
  }

  /** Eszköz végrehajtása: Megbeszélés módban a módosítók tiltva (kemény határ). */
  async function exec(name: string, input: unknown): Promise<ToolResult> {
    const t = TOOLS.find(x => x.name === name);
    if (t && t.mutates && mode() === 'discuss') return { text: 'Discuss mode: changing the design is not allowed. Propose the change instead; the user can switch to Build mode.', isError: true };
    return runTool(H.ctx(), name, input);
  }

  async function send(text: string) {
    text = text.trim(); if (!text || running || !prefs.key) return;
    repairHistory(messages);
    const ac = new AbortController(); running = ac;
    let changed = false;
    H.begin(() => ac.abort());
    entries.push({ k: 'user', text }); render();
    // hosszú beszélgetés: előbb a régi eszközeredmények rövidülnek, ha az sem elég, a korábbi rész összefoglalóra cserélődik
    if (historyTokens(messages) > PRUNE_AT) messages = pruneHistory(messages);
    if (historyTokens(messages) > SUMMARIZE_AT) {
      const s = await summarizeHistory({ apiKey: prefs.key, model: model(), system: systemPrompt({ mode: mode(), lang: H.lang() }), messages, signal: ac.signal, fetch: H.fetch });
      if (s) { summary = (summary ? summary + '\n\n' : '') + s; messages = []; lastKey = ''; entries.push({ k: 'info', text: tr('A beszélgetés korábbi része összefoglalva (az agent az összefoglalót látja), hogy a kérések ne dráguljanak.') }); render(); }
    }
    // a terv állapota: az elején, és ha a felhasználó közben módosított
    const key = H.designKey(), blocks: Block[] = [];
    if (!messages.length && summary) blocks.push({ type: 'text', text: `Summary of the earlier part of this conversation:\n${summary}` });
    if (!messages.length || key !== lastKey) blocks.push({ type: 'text', text: `${messages.length ? 'The design was changed by the user. Current design:' : 'Current design:'}\n${summarize(H.ctx().D(), H.ctx().tr)}` });
    blocks.push({ type: 'text', text });
    const last = messages[messages.length - 1];
    if (last && last.role === 'user' && typeof last.content !== 'string' && !last.content.some(b => b.type === 'tool_result')) last.content.push(...blocks); // sikertelen előző kérés: összevonás
    else messages.push({ role: 'user', content: blocks });
    persist();
    await runAgent({
      apiKey: prefs.key, model: model(), system: systemPrompt({ mode: mode(), lang: H.lang() }), tools: toolSpecs('build'), messages, signal: ac.signal, fetch: H.fetch,
      exec, onEvent(e) {
        if (e.kind === 'text') entries.push({ k: 'text', text: e.text });
        else if (e.kind === 'tool') entries.push({ k: 'tool', id: e.id, name: e.name, input: e.input });
        else if (e.kind === 'tool_result') { const x = entries.find(y => y.k === 'tool' && y.id === e.id) as Extract<Entry, { k: 'tool' }> | undefined; if (x) x.result = e.result; if (e.result.changed) changed = true; }
        else if (e.kind === 'usage') { usage.in += e.input; usage.out += e.output; }
        else if (e.kind === 'error') entries.push({ k: e.error.code === 'aborted' ? 'info' : 'error', text: errorText(e.error) });
        render();
      },
    });
    running = null; repairHistory(messages); lastKey = H.designKey();
    H.end(changed);
    if (changed) entries.push({ k: 'info', text: tr('A változtatások egy lépésben visszavonhatók (Ctrl+Z).') });
    { const np = H.projectId(); if (np !== pid) { H.saveChats(pid, H.loadChats(pid).filter(c => c.id !== chatId)); pid = np; } } // az agent új tervet nyitott: a beszélgetés vele megy
    persist();
    render();
  }

  /* események */
  root.querySelector('#agMode')!.addEventListener('click', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]'); if (!b || running) return; prefs = { ...prefs, mode: b.dataset.mode as AgentMode }; H.savePrefs(prefs, remember); render(); });
  $('#agCfg').onclick = () => { root.classList.toggle('cfg'); render(); if (!$('#agSetup').hidden) $('#agKey').focus(); };
  $('#agNew').onclick = () => { if (running) return; persist(); open(null); $('#agHistList').hidden = true; $('#agHist').setAttribute('aria-expanded', 'false'); render(); $('#agText').focus(); };
  $('#agHist').onclick = () => { if (running) return; const h = $('#agHistList'); h.hidden = !h.hidden; $('#agHist').setAttribute('aria-expanded', String(!h.hidden)); render(); };
  $('#agHistList').addEventListener('click', e => {
    const t = e.target as HTMLElement, o = t.closest<HTMLElement>('[data-chat]'), d = t.closest<HTMLElement>('[data-chatdel]');
    if (running) return;
    if (d) { const id = d.dataset.chatdel!; H.saveChats(pid, H.loadChats(pid).filter(c => c.id !== id)); if (id === chatId) open(null); render(); return; }
    if (o) { persist(); open(H.loadChats(pid).find(c => c.id === o.dataset.chat) || null); $('#agHistList').hidden = true; $('#agHist').setAttribute('aria-expanded', 'false'); render(); }
  });
  $('#agBrief').addEventListener('change', () => { const v = $<HTMLTextAreaElement>('#agBrief').value.trim(); if (v !== H.brief()) { H.setBrief(v); render(); } });
  $('#agSetup').addEventListener('submit', e => {
    e.preventDefault(); const k = $<HTMLInputElement>('#agKey').value.trim(); remember = $<HTMLInputElement>('#agRemember').checked;
    prefs = { ...prefs, key: k || undefined, model: $<HTMLSelectElement>('#agModel').value }; H.savePrefs(prefs, remember); root.classList.remove('cfg'); render(); if (k) $('#agText').focus();
  });
  $('#agForget').onclick = () => { prefs = { ...prefs, key: undefined }; H.savePrefs(prefs, remember); root.classList.add('cfg'); render(); };
  /* válasz másolása: a modell szövege markdownként (táblázat, felsorolás megmarad beillesztéskor) */
  async function copyText(text: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* régi böngésző vagy nincs engedély */ }
    try { const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; } catch { return false; }
  }
  $('#agLog').addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy]'); if (!b) return;
    const x = entries[+b.dataset.copy!]; if (!x || x.k !== 'text') return;
    const ok = await copyText(x.text), sp = b.querySelector('span')!;
    b.classList.toggle('done', ok); sp.textContent = ok ? tr('Másolva') : tr('Nem sikerült másolni');
    setTimeout(() => { b.classList.remove('done'); sp.textContent = tr('Másolás'); }, 1600);
  });
  const ta = $<HTMLTextAreaElement>('#agText');
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); const v = ta.value; ta.value = ''; void send(v); } });
  $('#agSend').onclick = () => { const v = ta.value; ta.value = ''; void send(v); };
  $('#agStop').onclick = () => { if (running) running.abort(); };
  render();
  return { render, busy: () => !!running, stop: () => { if (running) running.abort(); }, send, entries: () => entries.length, project: () => pid };
}
