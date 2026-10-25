# Proofboard

Próbanyák-tervező és -szimulátor a böngészőben: 1×3-as szekciós (tripad), pontraszteres és csíkos panelekhez.

**Élő változat:** https://nemalsomel.github.io/proofboard/

## Mit tud

- **Panel:** állítható méret és szekcióhossz (pontraszter, 1×2…1×5, teljes csík), alkatrészoldali és tükrözött rézoldali nézet, 90°-os nézetforgatás.
- **Alkatrészek:** Raspberry Pi Pico W, 12 mm-es nyomógomb, ellenállás, átkötő huzal, LED, dióda, N-MOSFET, tüskesor, akkucsatlakozó. Forgatás, tükrözés, duplikálás, többes kijelölés, röntgen nézet.
- **Bekötés:**
  - kézi forrasztóhidak a rézoldalon, szabad vezetékek az alkatrészoldalon;
  - kapcsolatok (pl. „gomb A → szabad GPIO”, „B → GND”) automatikus útvonalkereséssel, amely mozgatáskor csak az érintett útvonalakat tervezi újra;
  - átalakítás oda-vissza a kézi és az automatikus bekötés között.
- **Ellenőrzés:** zárlat, összeérő jelek, rövidre zárt alkatrész, ütközés, átfedés, túláram, lebegő gate.
- **Szimuláció:** egyenáramú csomóponti analízis (diódák, MOSFET, Pico táp és GPIO-módok), gombnyomás, LED-fény, GPIO-szintek.

## Fejlesztés

```bash
npm install
npm run dev          # fejlesztői szerver
npm test             # unit tesztek (Vitest)
npm run test:e2e     # böngészős tesztek (Playwright; előtte: npm run build)
npm run check        # minden: típus, unit, build, e2e — ugyanez fut a CI-ban
npm run build:single # egyetlen önálló HTML-fájl (dist-single/index.html)
```

## Felépítés

```
src/core/     séma (típusok), kifejezés-értelmező, alkatrész-fordító — tiszta, típusos
src/parts/    beépített alkatrészleírások (adat)
src/engine/   egyenletmegoldó (csomóponti analízis)
src/app.ts    felület, netlista, szimuláció, ellenőrzés, útvonalkereső — folyamatosan bomlik modulokra
tests/unit/   Vitest
tests/e2e/    Playwright, a window.pcb API-n keresztül
```

### Alkatrész hozzáadása

Az alkatrészek adatként vannak leírva (`src/core/schema.ts`): lábak, összekötött lábcsoportok, paraméterek, rajzelemek rétegekben, villamos modell és vezérlők. Új alkatrészhez egy új bejegyzés kell a `src/parts/builtin.ts`-ben; a rajzolás, a tulajdonságpanel, az ellenőrzés és a szimuláció ebből dolgozik. A `tests/unit/parts.test.ts` minden beépített leírást automatikusan ellenőriz.

## Kitelepítés

Minden `main`-re érkező push után a GitHub Actions lefuttatja az ellenőrzéseket, és siker esetén kitelepít a GitHub Pagesre. Egyszeri beállítás: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
