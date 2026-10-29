# Proofboard

Próbanyák-tervező és -szimulátor a böngészőben: 1×3-as szekciós (tripad), pontraszteres és csíkos panelekhez.

**Élő változat:** https://nemalsomel.github.io/proofboard/

## Mit tud

- **Panel:** állítható méret és szekcióhossz (pontraszter, 1×2…1×5, teljes csík), alkatrészoldali és tükrözött rézoldali nézet, 90°-os nézetforgatás.
- **Alkatrészek:** Raspberry Pi Pico W, 12 mm-es nyomógomb, ellenállás, kerámia és elektrolit kondenzátor, átkötő huzal, LED, dióda, NPN tranzisztor (BC547, 2N3904, 2N2222A), N-MOSFET, tüskesor, akkucsatlakozó, valamint modulok: TP4056 töltő, Nokia 5110 kijelző, KY-023 joystick, és külső alkatrészek: DC motor, SG90 szervó. Forgatás, tükrözés, duplikálás, többes kijelölés, röntgen nézet.
- **Csíkvágás:** csíkos (és szekciós) panelen kézi vágás a Csíkvágás eszközzel (<kbd>K</kbd>): a lyuk közepére kattintva kifúrt lyuk, két sor közé kattintva rés; automatikus csíkvágás a kapcsolatok szerint (csíkos panelen alapból bekapcsolva), amely a forrás csíkján lévő szabad GPIO-t is hozzárendeli.
- **Bekötés:**
  - kézi forrasztóhidak a rézoldalon, szabad vezetékek az alkatrészoldalon;
  - kapcsolatok (pl. „gomb A → szabad GPIO”, „B → GND”) automatikus útvonalkereséssel, amely mozgatáskor csak az érintett útvonalakat tervezi újra;
  - átalakítás oda-vissza a kézi és az automatikus bekötés között;
  - külső alkatrészek (motor, szervó) a panel mellett, kábellel: a kábel a cél szekciójának legközelebbi szabad lyukába fut (föld fekete, táp piros, jel narancs).
- **Ellenőrzés:** zárlat, összeérő jelek, rövidre zárt alkatrész, ütközés, átfedés, túláram, lebegő gate és bázis, telítésbe nem jutó tranzisztor, fordított vagy túlfeszültségű kondenzátor, motor visszacsapó dióda nélkül vagy közvetlenül GPIO-ról, szervó érvényes jel nélkül; a tápbemenetek feszültsége (pl. 5 V-ra kötött 3,3 V-os kijelző), analóg jel ADC nélküli GPIO-n, akkutöltés Schottky-dióda nélkül.
- **Szerepek:** a lábak szerepe (föld, tápbemenet, jel, analóg jel…) vezérli az ellenőrzést és az útvonalkeresőt: az analóg jelek csak ADC-képes GPIO-ra (GP26–GP28) kerülnek, ezeket a többi kapcsolat elől tartogatja.
- **Digitális logika:** a 74HC00 (4× NAND) és 74HC139 (2× 2→4 dekóder) beépítve; saját alkatrészhez a szerkesztő Logika fülén kimenetenként logikai kifejezés, három egymásba váltható nézettel: kifejezés, igazságtábla (cellára kattintva minimalizált kifejezést ír), kapuk (AND/NAND/OR/NOR/XOR/XNOR/NOT kapurajzzal). A szimuláció a táp arányában olvassa a bemeneti szinteket, a kimenet push-pull vagy nyitott drain, engedélyezéssel.
- **Saját alkatrészek:** alkatrész-szerkesztő űrlappal (lábsor-generátor, szerepek, test, villamos modell, nyomógomb-vezérlő) és JSON nézettel, élő előnézettel és ellenőrzéssel. A saját alkatrészek a tervvel együtt mentődnek, és könyvtárfájlként exportálhatók/importálhatók; beépített alkatrészből másolat is készíthető.
- **Szimuláció:** egyenáramú csomóponti analízis (diódák, MOSFET, NPN lezárt/aktív/telített tartománnyal, kondenzátor feszültsége és τ = R·C időállandója, Pico táp és GPIO-módok), PWM (kitöltés, frekvencia; időszeletekre bontva, így a tranzisztoros/MOSFET-es kapcsolás is helyes), motorfordulat, szervószög, gombnyomás, csúszkák (pl. joystick-tengely), LED-fény és háttérvilágítás, GPIO-szintek és analóg feszültségek.

- **Oldalsávok:** balra Szerkesztés (eszközök, a vezetékszín csak Vezeték eszköznél, Kijelölés és Jelmagyarázat harmonikában) és Alkatrészek (könyvtár, saját alkatrészek, import/export); jobbra Terv (Kapcsolatok, Panel, Terv harmonikában), Ellenőrzés (összegzés a fülön) és Szimuláció (indításkor erre vált).
- **Mobilon:** a panel kitölti a képernyőt, az eszközök és az ellenőrzés alsó lapon nyílik; egy ujjal görgetés vagy alkatrész húzása, hosszan nyomva kijelölő keret, két ujjal nagyítás; lerakáskor az előnézet az ujj fölött jár; lebegő gombok a forgatáshoz, tükrözéshez, másoláshoz és törléshez.

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
src/core/     séma (típusok), kifejezés-értelmező, logikai kifejezések (értelmező, kapufa, igazságtábla, Quine–McCluskey), lábnév-elhelyezés, alkatrész-fordító, leírás-ellenőrző, könyvtárformátum — tiszta, típusos
src/parts/    beépített alkatrészleírások (adat)
src/engine/   egyenletmegoldó (csomóponti analízis), panel-elrendezés (csíkdarabok, vágások, vágásjavaslat)
src/ui/       alkatrész-szerkesztő
src/app.ts    felület, netlista, szimuláció, ellenőrzés, útvonalkereső — folyamatosan bomlik modulokra
tests/unit/   Vitest
tests/e2e/    Playwright, a window.pcb API-n keresztül
```

### Alkatrész hozzáadása

Az alkatrészek adatként vannak leírva (`src/core/schema.ts`): lábak, összekötött lábcsoportok, paraméterek, rajzelemek rétegekben, villamos modell és vezérlők. Új alkatrészhez egy új bejegyzés kell a `src/parts/builtin.ts`-ben; a rajzolás, a tulajdonságpanel, az ellenőrzés és a szimuláció ebből dolgozik. A `tests/unit/parts.test.ts` minden beépített leírást automatikusan ellenőriz. Kísérletezni a felületen is lehet („+ Saját alkatrész”): a szerkesztő ugyanezt a leírást állítja elő, a JSON fül pedig bemásolható a `builtin.ts`-be.

## Kitelepítés

Minden `main`-re érkező push után a GitHub Actions lefuttatja az ellenőrzéseket, és siker esetén kitelepít a GitHub Pagesre. Egyszeri beállítás: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
