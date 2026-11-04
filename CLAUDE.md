# Proofboard – munkautasítások

Próbanyák-tervező és -szimulátor (Vite + TypeScript, keretrendszer nélkül, canvas + DOM). A felület nyelve magyar; az új szövegek is magyarul készülnek.

## Parancsok
- `npm run check` – típusellenőrzés, unit tesztek, build, e2e. Commit előtt mindig fusson le hibátlanul.
- `npm test` / `npm run test:e2e` külön is futtatható (az e2e a `dist/`-et szolgálja ki, ezért előtte `npm run build`).

## Szerkezet és szabályok
- `src/core/` (séma, kifejezések, fordító), `src/parts/` (beépített alkatrészek), `src/engine/` (terv, netlista, szimuláció, ellenőrzés, útvonalkereső, vezérlőcsere stb.) – szigorúan típusos, DOM-mentes, unit tesztelt. Az engine függvényei a tervet (`Design`) paraméterként kapják, globális állapotot nem olvasnak (kivétel: az alkatrész-regiszter `DEFS` és a szimulációs állapot `LSTATE`/`STSTATE`).
- A rézcsík-darabok (cellák) egyetlen forrása a `buildLayout` (szekciók + csíkvágások): netlista, útvonalkereső és rajzolás is ezt használja, fix szekcióhosszal ne számolj.
- `src/app.ts` még `// @ts-nocheck`: csak a felület (rajzolás, interakció, panelek, API) maradt benne, a motor hívásai vékony burkolók (`analyze`, `simulate`, `checkAll`, `route`…). Új logika az `engine/`-be kerüljön, ne az app.ts-be. A felület bontása (`src/ui/`: állapot, rajzolás, panelek) a UX-körrel együtt történik; kiemeléskor a kód típust kap, a viselkedés nem változik.
- Alkatrész = adat (`src/core/schema.ts`). Új alkatrészhez a `src/parts/builtin.ts`-be kerül leírás; típusnévre (`p.type==='…'`) új kódot ne írj, ha a séma kifejezi: ellenőrzés és útvonalkereső a lábszerepekből (`role`), képességekből (`caps`, pl. `adc`) és a `vmin`/`vmax` tartományból dolgozik. A vezérlőlap (Pico, ESP32…) a `mcu` modell-elemtől az (`isMcu`), a GPIO-k különlegességei képességek (`adc`, `adc2`, `in`, `nopull`, `strap`, `uart0`, `led`), lábankénti magyarázat a `meta.pinNotes`-ban. A külső alkatrész (`mount: 'off'`) a panel mellé kerül, a lábai kivezetések; a kábele egy csatlakozóba dugva (`plug`: a csatlakozó példány azonosítója) köt be, csatlakozó az az alkatrész, amelynek leírásában `socket` van (tüskesor: `count`/`names` paraméterrel újonnan is készül; modul: `pins` a csatlakozó lábai). A dugó engine-oldala az `engine/plug.ts` (netlista-összevonás, útvonalkeresés a csatlakozó lábáról); dugó nélkül a régi, szabad kábel (vezetékvég a kivezetésen) is működik.
- Az e2e tesztek csak a `window.pcb` API-t és a DOM-ot használják. Ha egy tesztnek új belső állapot kell, az API bővüljön.
- Viselkedésváltozásnál az érintett e2e/unit teszt is frissüljön; a meglévő forgatókönyvek (kézi minta 157 híd, gombtérkép, kézi→automatikus, útvonalkereső 29/29 vezeték nélkül) regressziós alapok.
