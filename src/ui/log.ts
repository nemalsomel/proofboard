/**
 * Napló (az alsó panel Napló füle): események időrendben, olvasatlan-számlálóval. Tiszta, DOM-mentes;
 * a megjelenítés HTML-szövegként (`logHtml`).
 */
export interface LogEntry { t: Date; m: string; err: boolean }
export const hhmm = (t: Date): string => [t.getHours(), t.getMinutes(), t.getSeconds()].map(x => String(x).padStart(2, '0')).join(':');
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]!));

export class EventLog {
  readonly entries: LogEntry[] = [];
  unread = 0;
  constructor(private readonly max = 300) {}
  /** Új bejegyzés; `seen`: a Napló épp nyitva van, így nem olvasatlan. */
  add(m: unknown, err = false, seen = false): void {
    this.entries.push({ t: new Date(), m: String(m), err: !!err });
    if (this.entries.length > this.max) this.entries.shift();
    if (!seen) this.unread++;
  }
  read(): void { this.unread = 0; }
  clear(): void { this.entries.length = 0; this.unread = 0; }
  /** A lista HTML-je, a legújabb elöl; az olvasatlanok kiemelve. */
  html(): string {
    if (!this.entries.length) return '<li class="muted">Még nincs bejegyzés. Ide kerül a betöltés, a mentés, az útvonalkeresés és a szimuláció indítása.</li>';
    return this.entries.slice().reverse().map((x, i) => `<li class="${x.err ? 'err' : ''}${i < this.unread ? ' unread' : ''}"><time>${hhmm(x.t)}</time><span>${esc(x.m)}</span></li>`).join('');
  }
}
