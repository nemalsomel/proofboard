# Proofboard – munkautasítások

Próbanyák-tervező és -szimulátor (Vite + TypeScript, keretrendszer nélkül, canvas + DOM). A felület nyelve magyar; az új szövegek is magyarul készülnek.

## Parancsok
- `npm run check` – típusellenőrzés, unit tesztek, build, e2e. Commit előtt mindig fusson le hibátlanul.
- `npm test` / `npm run test:e2e` külön is futtatható (az e2e a `dist/`-et szolgálja ki, ezért előtte `npm run build`).

## Szerkezet és szabályok
- `src/core/` (séma, kifejezések, fordító), `src/parts/` (beépített alkatrészek), `src/engine/solve.ts` – szigorúan típusos, DOM-mentes, unit tesztelt.
- `src/app.ts` még `// @ts-nocheck`. Folyamatosan bontjuk `src/engine/` (netlista, szimuláció, ellenőrzés, útvonalkereső) és `src/ui/` (rajzolás, panelek, állapot) modulokra; kiemeléskor a kód típust kap, a viselkedés nem változik.
- Alkatrész = adat (`src/core/schema.ts`). Új alkatrészhez a `src/parts/builtin.ts`-be kerül leírás; típusnévre (`p.type==='…'`) új kódot ne írj, ha a séma kifejezi.
- Az e2e tesztek csak a `window.pcb` API-t és a DOM-ot használják. Ha egy tesztnek új belső állapot kell, az API bővüljön.
- Viselkedésváltozásnál az érintett e2e/unit teszt is frissüljön; a meglévő forgatókönyvek (kézi minta 157 híd, gombtérkép, kézi→automatikus, útvonalkereső 29/29 vezeték nélkül) regressziós alapok.
