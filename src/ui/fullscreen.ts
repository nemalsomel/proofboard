/**
 * Teljes képernyő a blokk- és a belsőkapcsolás-szerkesztőnek: az elem a <body> közvetlen gyermeke lesz, így egyetlen
 * réteg (nézetsáv, eszközsáv, tulajdonságablak, alsó panel) sem kerül fölé; kilépéskor visszakerül a helyére.
 * Ha a helye közben eltűnt (a gazda újrarajzolt), az `onReturn` dönti el, hová kerül.
 */
const PH = new WeakMap<HTMLElement, Comment>();
export function setFull(el: HTMLElement, on: boolean, onReturn?: () => void): void {
  const ph = PH.get(el);
  if (on && !ph) { const c = document.createComment('teljes képernyő'); el.replaceWith(c); PH.set(el, c); document.body.appendChild(el); }
  else if (!on && ph) { PH.delete(el); if (ph.isConnected) ph.replaceWith(el); else { el.remove(); onReturn?.(); } }
  el.classList.toggle('pg-full', on);
}
export const isFull = (el: HTMLElement): boolean => PH.has(el);
