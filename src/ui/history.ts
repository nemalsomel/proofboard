/**
 * Visszavonás és újra (központi állapotkezelés): a terv pillanatképei szövegként. Egy lépés = a változás előtti
 * állapot. Tiszta, DOM-mentes; a gazda dönti el, mit ment el (`snap`) és hogyan állítja vissza.
 */
export class History {
  private u: string[] = [];
  private r: string[] = [];
  constructor(private readonly limit = 150, private readonly onChange?: () => void) {}
  /** A változás előtti állapot mentése; az újra-lista ilyenkor kiürül. */
  push(snap: string): void {
    this.u.push(snap);
    if (this.u.length > this.limit) this.u.shift();
    this.r = [];
    this.onChange?.();
  }
  /** Az utolsó mentés eldobása (a művelet mégsem történt meg); visszaadja, ha vissza kell állítani. */
  drop(): string | undefined {
    const s = this.u.pop();
    this.onChange?.();
    return s;
  }
  /** Visszavonás: a mostani állapot az újra-listára kerül, a visszaállítandó állapotot adja (vagy null). */
  undo(current: string): string | null {
    const s = this.u.pop();
    if (s === undefined) return null;
    this.r.push(current);
    this.onChange?.();
    return s;
  }
  /** Újra: a visszavonás fordítottja. */
  redo(current: string): string | null {
    const s = this.r.pop();
    if (s === undefined) return null;
    this.u.push(current);
    this.onChange?.();
    return s;
  }
  get canUndo(): boolean { return this.u.length > 0; }
  get canRedo(): boolean { return this.r.length > 0; }
  clear(): void { this.u = []; this.r = []; this.onChange?.(); }
}
