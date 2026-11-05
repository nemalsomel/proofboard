/**
 * Telepíthető alkalmazás (PWA): a service worker regisztrálása, frissítés kérésre, telepítés gombra.
 * A service workert a build (vite-plugin-pwa, Workbox) készíti; az önálló HTML (`--mode single`) és a fejlesztői
 * szerver nem regisztrál. Új verziónál nem frissít magától: a gazda értesítést ad, és a felhasználó dönt
 * (a terv addig is a böngészőben van mentve, így az újratöltés után megmarad).
 */
export interface PwaHost {
  /** Új verzió érhető el; `apply` átvált rá és újratölt. */
  onUpdate(apply: () => void): void;
  /** Az első telepítés kész: innentől offline is működik. */
  onOfflineReady?(): void;
  /** Megváltozott, hogy telepíthető-e (a böngésző felajánlja-e). */
  onInstallable?(can: boolean): void;
}

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallPrompt | null = null;
let offline = false;

/** Fut-e már service worker az oldal alatt (offline is használható). */
export const offlineReady = (): boolean => offline || !!(typeof navigator !== 'undefined' && navigator.serviceWorker?.controller);
/** Telepíthető-e most (a böngésző eltette a telepítési ajánlatot). */
export const canInstall = (): boolean => !!deferred;
/** Telepítés: a böngésző saját ablaka; igaz, ha a felhasználó elfogadta. */
export async function install(): Promise<boolean> {
  const d = deferred; if (!d) return false;
  deferred = null;
  await d.prompt();
  return (await d.userChoice).outcome === 'accepted';
}
/** Önálló ablakban (telepítve) fut-e. */
export const standalone = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches;

export function registerPwa(host: PwaHost): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as InstallPrompt; host.onInstallable?.(true); });
  window.addEventListener('appinstalled', () => { deferred = null; host.onInstallable?.(false); });
  if (import.meta.env.MODE === 'single' || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const base = import.meta.env.BASE_URL;
  const start = async () => {
    // tiltott service worker (pl. egyes böngészőbeállítások) mellett üres is lehet
    const reg = await navigator.serviceWorker.register(base + 'sw.js', { scope: base }).catch(() => undefined) as ServiceWorkerRegistration | undefined;
    if (!reg) return;
    const offer = (w: ServiceWorker) => host.onUpdate(() => {
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      w.postMessage({ type: 'SKIP_WAITING' });
    });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing; if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state !== 'installed') return;
        if (navigator.serviceWorker.controller) offer(w); // volt már régi: frissítés
        else { offline = true; host.onOfflineReady?.(); } // első telepítés
      });
    });
    // hosszan nyitva hagyott lapnál óránként ránéz, van-e új verzió
    setInterval(() => { reg.update().catch(() => { /* offline */ }); }, 60 * 60 * 1000);
  };
  if (document.readyState === 'complete') void start(); else window.addEventListener('load', () => void start(), { once: true });
}
