/**
 * Agent-ciklus az Anthropic Messages API-val: a modell válaszol, eszközt hív, az eredmény visszamegy, amíg kész
 * nem lesz (vagy el nem éri a lépéskorlátot, vagy meg nem szakítják). DOM-mentes; a hálózati hívás (`fetch`)
 * cserélhető, így tesztben és a későbbi MCP-oldalon is használható.
 *
 * Saját kulccsal (BYOK) a böngészőből közvetlenül hív: ehhez az API az `anthropic-dangerous-direct-browser-access`
 * fejlécet kéri. A kulcs csak a felhasználó böngészőjében van, a kérés közvetlenül az Anthropichoz megy.
 */
import type { JsonSchema, ToolResult } from './tools';

export const API_URL = 'https://api.anthropic.com/v1/messages';
export const API_VERSION = '2023-06-01';

/** Választható modellek (az API azonosítója és a felületen látható név). */
export const MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
];
export const DEFAULT_MODEL = MODELS[0].id;

/* ---------- Üzenetformátum (a Messages API részhalmaza) ---------- */

export interface TextBlock { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
export interface ImageBlock { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: Array<TextBlock | ImageBlock>; is_error?: boolean }
export type Block = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;
export interface Message { role: 'user' | 'assistant'; content: string | Block[] }
export interface ToolSpec { name: string; description: string; input_schema: JsonSchema; cache_control?: { type: 'ephemeral' } }

interface ApiResponse {
  content: Block[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'pause_turn' | 'refusal' | string;
  usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

/* ---------- Események a felületnek ---------- */

export type AgentEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; id: string; name: string; result: ToolResult }
  | { kind: 'usage'; input: number; output: number }
  | { kind: 'done'; reason: string }
  | { kind: 'error'; error: AgentError };

/** Hibák a felhasználónak érthető fajtákra bontva (a felület fordítja). */
export interface AgentError { code: 'auth' | 'rate' | 'overloaded' | 'network' | 'aborted' | 'steps' | 'api' | 'billing'; message: string; status?: number }

export interface RunOpts {
  apiKey: string;
  model: string;
  system: string;
  tools: ToolSpec[];
  /** a beszélgetés eddig (helyben bővül: a modell válaszai és az eszközeredmények is bekerülnek) */ messages: Message[];
  exec(name: string, input: unknown): Promise<ToolResult>;
  onEvent?(e: AgentEvent): void;
  signal?: AbortSignal;
  /** legfeljebb ennyi modellhívás egy feladatban */ maxSteps?: number;
  maxTokens?: number;
  fetch?: typeof fetch;
}

/** Hibakód a HTTP-válaszból. */
export function errorOf(status: number, body: string): AgentError {
  let message = body;
  try { const j = JSON.parse(body) as { error?: { message?: string; type?: string } }; if (j.error && j.error.message) message = j.error.message; } catch { /* nem JSON */ }
  const code: AgentError['code'] = status === 401 || status === 403 ? 'auth' : status === 429 ? 'rate' : status === 529 || status === 503 ? 'overloaded'
    : status === 400 && /credit|billing|balance/i.test(message) ? 'billing' : 'api';
  return { code, message, status };
}

/** Az eszközeredmény a modellnek: szöveg, és ha van, a kép. */
export function toolResultBlock(id: string, r: ToolResult): ToolResultBlock {
  const content: Array<TextBlock | ImageBlock> = [{ type: 'text', text: r.text || '(empty)' }];
  if (r.image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: r.image } });
  return { type: 'tool_result', tool_use_id: id, content, ...(r.isError ? { is_error: true } : {}) };
}

/** A korábbi eszközeredmények képeit szöveges jelzésre cseréli (csak a legutóbbi kép marad), hogy a kérés ne nőjön. */
export function compactImages(messages: Message[]): Message[] {
  let lastImg = -1;
  messages.forEach((m, i) => { if (typeof m.content !== 'string' && JSON.stringify(m.content).includes('"type":"image"')) lastImg = i; });
  return messages.map((m, i) => {
    if (i === lastImg || typeof m.content === 'string') return m;
    return { ...m, content: m.content.map(b => (b.type === 'tool_result' && b.content.some(x => x.type === 'image') ? { ...b, content: b.content.map(x => (x.type === 'image' ? { type: 'text' as const, text: '[earlier board image omitted]' } : x)) } : b)) };
  });
}

/**
 * Egy feladat lefuttatása: modellhívás → eszközhívások → eredmények → újra, amíg a modell be nem fejezi.
 * A `messages` helyben bővül, így a beszélgetés folytatható. Hibánál `error` eseményt küld és visszatér.
 */
export async function runAgent(o: RunOpts): Promise<{ ok: boolean; reason: string }> {
  const f = o.fetch || fetch.bind(globalThis), max = o.maxSteps ?? 30, emit = o.onEvent || (() => {});
  const tools = o.tools.map((t, i) => (i === o.tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t));
  const system: TextBlock[] = [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }];
  for (let step = 0; step < max; step++) {
    if (o.signal && o.signal.aborted) { emit({ kind: 'error', error: { code: 'aborted', message: 'aborted' } }); return { ok: false, reason: 'aborted' }; }
    let res: Response;
    try {
      res = await f(API_URL, {
        method: 'POST', signal: o.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': o.apiKey, 'anthropic-version': API_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: o.model, max_tokens: o.maxTokens ?? 4096, system, tools, messages: compactImages(o.messages) }),
      });
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError' || !!(o.signal && o.signal.aborted);
      emit({ kind: 'error', error: { code: aborted ? 'aborted' : 'network', message: (e as Error).message } });
      return { ok: false, reason: aborted ? 'aborted' : 'network' };
    }
    if (!res.ok) { const error = errorOf(res.status, await res.text().catch(() => '')); emit({ kind: 'error', error }); return { ok: false, reason: error.code }; }
    const r = await res.json() as ApiResponse;
    if (r.usage) emit({ kind: 'usage', input: r.usage.input_tokens + (r.usage.cache_read_input_tokens || 0) + (r.usage.cache_creation_input_tokens || 0), output: r.usage.output_tokens });
    o.messages.push({ role: 'assistant', content: r.content });
    for (const b of r.content) if (b.type === 'text' && b.text.trim()) emit({ kind: 'text', text: b.text });
    const uses = r.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    if (r.stop_reason !== 'tool_use' || !uses.length) { emit({ kind: 'done', reason: r.stop_reason }); return { ok: true, reason: r.stop_reason }; }
    const results: ToolResultBlock[] = [];
    for (const u of uses) {
      if (o.signal && o.signal.aborted) { results.push(toolResultBlock(u.id, { text: 'Stopped by the user.', isError: true })); continue; }
      emit({ kind: 'tool', id: u.id, name: u.name, input: u.input });
      const out = await o.exec(u.name, u.input);
      emit({ kind: 'tool_result', id: u.id, name: u.name, result: out });
      results.push(toolResultBlock(u.id, out));
    }
    o.messages.push({ role: 'user', content: results });
    if (o.signal && o.signal.aborted) { emit({ kind: 'error', error: { code: 'aborted', message: 'aborted' } }); return { ok: false, reason: 'aborted' }; }
  }
  emit({ kind: 'error', error: { code: 'steps', message: `stopped after ${max} steps` } });
  return { ok: false, reason: 'steps' };
}

/**
 * A beszélgetés megtisztítása megszakítás vagy hiba után: ha az utolsó asszisztensüzenet eszközt hívott, de az
 * eredmény nem került be, az API a következő kérést elutasítaná; ilyenkor az eredményt pótolja.
 */
export function repairHistory(messages: Message[]): void {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || typeof last.content === 'string') return;
  const uses = last.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
  if (uses.length) messages.push({ role: 'user', content: uses.map(u => toolResultBlock(u.id, { text: 'Not executed: the task was stopped.', isError: true })) });
}
