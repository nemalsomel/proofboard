/**
 * Claude-kapcsolat (MCP) ablak: a proofboard-mcp beállítása a Claude Desktophoz / Claude Code-hoz, csatlakozás a helyi
 * szerverhez (élő híd), csak olvasás, automatikus csatlakozás; a fejléc jelzője (chip) az állapottal.
 */
import type { Tr } from '../i18n/i18n';
import { BRIDGE_PORT, connectBridge, type BridgeClient, type BridgeState } from '../agent/bridge';
import type { ToolResult } from '../agent/tools';

export interface McpPrefs { port: number; auto: boolean; readOnly: boolean }
export const MCP_DEFAULTS: McpPrefs = { port: BRIDGE_PORT, auto: false, readOnly: false };

export interface McpHost {
  exec(name: string, input: Record<string, unknown>, readOnly: boolean): Promise<ToolResult>;
  hello(): { version: string; design: string };
  loadPrefs(): McpPrefs; savePrefs(p: McpPrefs): void;
  /** a kapcsolat megszűnt (a futó munkamenet lezárása) */ dropped(): void;
  tr: Tr;
  /** tesztekhez: más WebSocket-osztály */ WS?: new (url: string) => WebSocket;
}
export interface McpPanel { open(): void; connect(): void; disconnect(): void; state(): BridgeState; client(): string | undefined; render(): void; busy(on: boolean): void }

const CFG_DESKTOP = (port: number) => JSON.stringify({ mcpServers: { proofboard: { command: 'npx', args: ['-y', 'proofboard-mcp', ...(port !== BRIDGE_PORT ? ['--port', String(port)] : [])] } } }, null, 2);
const CFG_CODE = (port: number) => `claude mcp add proofboard -- npx -y proofboard-mcp${port !== BRIDGE_PORT ? ` --port ${port}` : ''}`;

export function mountMcpPanel(dlg: HTMLDialogElement, chip: HTMLElement, H: McpHost): McpPanel {
  const q = <T extends HTMLElement = HTMLInputElement>(s: string) => dlg.querySelector<T>(s)!;
  const tr = H.tr;
  let cl: BridgeClient | null = null, st: BridgeState = 'off', info: { server?: string; client?: string; error?: string } = {}, prefs = H.loadPrefs(), working = false;

  function render() {
    const s = q<HTMLElement>('#mcpState');
    const label = st === 'connected' ? tr('Kapcsolódva: {c}', { c: info.client || tr('Claude') }) + (info.server ? ` (${info.server})` : '')
      : st === 'connecting' ? tr('Kapcsolódás…')
      : st === 'waiting' ? tr('Várakozás a szerverre: fut a Claude, és be van állítva a proofboard-mcp?')
      : info.error ? tr('Nincs kapcsolat: {e}', { e: info.error }) : tr('Nincs kapcsolat.');
    s.textContent = label; s.className = 'mcp-state ' + (st === 'connected' ? 'ok' : st === 'off' ? (info.error ? 'err' : '') : 'wait');
    q<HTMLButtonElement>('#mcpConnect').textContent = st === 'off' ? tr('Csatlakozás') : tr('Leválasztás');
    q<HTMLButtonElement>('#mcpConnect').className = 'btn ' + (st === 'off' ? 'primary' : 'secondary');
    q('#mcpRead').checked = prefs.readOnly; q('#mcpAuto').checked = prefs.auto; q('#mcpPort').value = String(prefs.port);
    const code = (id: string, text: string) => { const el = q<HTMLElement>(id); el.textContent = text; const b = document.createElement('button'); b.className = 'btn secondary mcp-copy'; b.textContent = tr('Másolás'); b.dataset.copy = text; el.appendChild(b); };
    code('#mcpCfgDesktop', CFG_DESKTOP(prefs.port)); code('#mcpCfgCode', CFG_CODE(prefs.port));
    chip.hidden = st === 'off';
    chip.classList.toggle('on', st === 'connected'); chip.classList.toggle('busy', working);
    const ct = chip.querySelector<HTMLElement>('#mcpChipT')!;
    ct.textContent = st === 'connected' ? (working ? tr('Claude dolgozik') : (info.client || tr('Claude')) + (prefs.readOnly ? ' · ' + tr('csak olvasás') : '')) : tr('Claude: várakozás');
    chip.title = q<HTMLElement>('#mcpState').textContent || '';
  }
  function connect() {
    if (cl) return;
    info = {};
    cl = connectBridge(`ws://127.0.0.1:${prefs.port}`, {
      exec: (n, i) => H.exec(n, i, prefs.readOnly),
      hello: H.hello,
      onState: (s, inf) => { const was = st; st = s; info = inf; if (was === 'connected' && s !== 'connected') H.dropped(); if (s === 'off') cl = null; render(); },
    }, { WS: H.WS });
  }
  function disconnect() { const c = cl; cl = null; if (c) c.close(); st = 'off'; info = {}; H.dropped(); render(); }
  const save = () => { H.savePrefs(prefs); render(); };

  q('#mcpConnect').addEventListener('click', () => (st === 'off' ? connect() : disconnect()));
  q('#mcpRead').addEventListener('change', () => { prefs = { ...prefs, readOnly: q('#mcpRead').checked }; save(); });
  q('#mcpAuto').addEventListener('change', () => { prefs = { ...prefs, auto: q('#mcpAuto').checked }; save(); });
  q('#mcpPort').addEventListener('change', () => { const p = Math.round(+q('#mcpPort').value); prefs = { ...prefs, port: p >= 1024 && p <= 65535 ? p : BRIDGE_PORT }; save(); if (cl) { disconnect(); connect(); } });
  dlg.addEventListener('click', e => {
    const t = e.target as HTMLElement, w = t.closest<HTMLElement>('[data-mcp-where]'), c = t.closest<HTMLElement>('[data-copy]');
    if (w) for (const b of dlg.querySelectorAll<HTMLElement>('[data-mcp-where]')) { const on = b === w; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); dlg.querySelector<HTMLElement>(`[data-mcp-how="${b.dataset.mcpWhere}"]`)!.hidden = !on; }
    if (c) { void navigator.clipboard?.writeText(c.dataset.copy || '').then(() => { c.textContent = tr('Másolva'); setTimeout(() => (c.textContent = tr('Másolás')), 1500); }, () => {}); }
  });
  chip.addEventListener('click', () => { if (!dlg.open) dlg.showModal(); render(); });
  if (prefs.auto) connect();
  render();
  return {
    open() { prefs = H.loadPrefs(); render(); if (!dlg.open) dlg.showModal(); },
    connect, disconnect, render,
    state: () => st, client: () => info.client,
    busy(on) { working = on; render(); },
  };
}
