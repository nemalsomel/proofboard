# Proofboard

Próbanyák-tervező és -szimulátor a böngészőben: 1×3-as szekciós (tripad), pontraszteres és csíkos panelekhez.

**Élő változat:** https://nemalsomel.github.io/proofboard/

## Mit tud

- **Panel:** állítható méret és szekcióhossz (pontraszter, 1×2…1×5, teljes csík), alkatrészoldali és tükrözött rézoldali nézet, 90°-os nézetforgatás.
- **Alkatrészek:** vezérlők: Raspberry Pi Pico W, ESP32 DevKit V1 (DOIT, 30 láb), ESP32-C3 SuperMini; modulok között SSD1306 OLED (I²C); továbbá 12 mm-es nyomógomb, ellenállás, kerámia és elektrolit kondenzátor, átkötő huzal, LED, dióda, NPN tranzisztor (BC547, 2N3904, 2N2222A), N-MOSFET, tüskesor, akkucsatlakozó, valamint modulok: TP4056 töltő, Nokia 5110 kijelző, KY-023 joystick, ULN2003 léptetőmotor-meghajtó, és külső alkatrészek: DC motor, SG90 szervó, 28BYJ-48 léptetőmotor. Forgatás, tükrözés, duplikálás, többes kijelölés, röntgen nézet.
- **Csíkvágás:** csíkos (és szekciós) panelen kézi vágás a Csíkvágás eszközzel (<kbd>K</kbd>): a lyuk közepére kattintva kifúrt lyuk, két sor közé kattintva rés; automatikus csíkvágás a kapcsolatok szerint (csíkos panelen alapból bekapcsolva), amely a forrás csíkján lévő szabad GPIO-t is hozzárendeli.
- **Bekötés:**
  - kézi forrasztóhidak a rézoldalon, szabad vezetékek az alkatrészoldalon;
  - kapcsolatok (pl. „gomb A → szabad GPIO”, „B → GND”) automatikus útvonalkereséssel, amely mozgatáskor csak az érintett útvonalakat tervezi újra;
  - átalakítás oda-vissza a kézi és az automatikus bekötés között;
  - külső alkatrészek (motor, szervó, léptetőmotor) a panel mellett, kábellel: lerakáskor a kábel egy tüskesorba dugva kerül a panelra (a lábszámával és lábneveivel, a kivezetésekhez legközelebbi szabad helyre), vagy egy modul meglévő csatlakozójába, ha a kapcsolatai oda mutatnak (pl. léptetőmotor → ULN2003). A tüskesor mozgatható, a bekötés onnan indul hidakkal; a kábel erei színkódoltak (föld fekete, táp piros, jelek narancs, sárga, kék…). A tulajdonságpanelen kihúzható és visszadugható; kihúzva a régi módon, szabad kábellel köt be.
  - tüskesor önállóan is: lábnevek a tulajdonságpanelen (pl. `GND,VCC,SDA,SCL`), feliratként a panelon.
- **Ellenőrzés:** zárlat, összeérő jelek, rövidre zárt alkatrész, ütközés, átfedés, túláram, lebegő gate és bázis, telítésbe nem jutó tranzisztor, fordított vagy túlfeszültségű kondenzátor, motor visszacsapó dióda nélkül vagy közvetlenül GPIO-ról, szervó érvényes jel nélkül; a tápbemenetek feszültsége (pl. 5 V-ra kötött 3,3 V-os kijelző), analóg jel ADC nélküli GPIO-n, akkutöltés Schottky-dióda nélkül.
- **Vezérlők és lábképességek:** a vezérlőlapok egy közös modellt (`mcu`) használnak: USB-táp, tápbemenet (VSYS / VIN / 5V) diódával vagy anélkül, stabilizátor minimális bemeneti feszültséggel, GPIO-nkénti ajánlott áram. A GPIO-k képességei (`adc`, `adc2`, csak bemenet, belső felhúzás nélkül, indítási/strapping láb, soros port, beépített LED) vezérlik a választható GPIO-módokat, az ellenőrzést (pl. gomb felhúzás nélküli lábon, indítási lábra kötött áramkör, analóg jel ADC2-n, kevés tápfeszültség a stabilizátornak) és az útvonalkeresőt (kerüli a különleges lábakat). **Vezérlőcsere** a tulajdonságpanelen: a GND-, GPIO- és tápkapcsolatok megmaradnak, a GPIO-k újra kiosztódnak, a módjuk, a PWM-beállítás és a Jelsorozat csatornái átkerülnek.
- **Szerepek:** a lábak szerepe (föld, tápbemenet, jel, analóg jel…) vezérli az ellenőrzést és az útvonalkeresőt: az analóg jelek csak ADC-képes GPIO-ra (GP26–GP28) kerülnek, ezeket a többi kapcsolat elől tartogatja.
- **Digitális logika:** a 74HC00 (4× NAND), 74HC139 (2× 2→4 dekóder), 74HC74 (2× D tároló) és 74HC595 (8 bites léptetőregiszter) beépítve; tárolók (órajeles állapotbitek felfutó/lefutó élre, aszinkron törléssel/beállítással), a szimuláció a beállt állapotok közti éleken léptet, a kaszkádolt (hullámos) számlálók is működnek; saját alkatrészhez a szerkesztő Logika fülén kimenetenként logikai kifejezés, három egymásba váltható nézettel: kifejezés, igazságtábla (cellára kattintva minimalizált kifejezést ír), kapuk (AND/NAND/OR/NOR/XOR/XNOR/NOT kapurajzzal). A szimuláció a táp arányában olvassa a bemeneti szinteket, a kimenet push-pull vagy nyitott drain, engedélyezéssel.
- **Saját alkatrészek:** alkatrész-szerkesztő űrlappal (lábsor-generátor, szerepek, GPIO-képességek és buszfunkciók, test, villamos modell a vezérlőlapig, nyomógomb-vezérlő) és JSON nézettel, élő előnézettel és ellenőrzéssel; beépített alkatrészből másolat is készíthető.
- **Alkatrészkönyvtár:** a saját könyvtár a böngészőben marad, a tervtől függetlenül (terv váltásakor is megvan), külön fájlba exportálható és importálható. A tervbe lerakott alkatrész leírása a terv része lesz, így a tervfájl csak a benne használt alkatrészeket viszi; ha a megnyitott terv alkatrésze ütközik a könyvtáradéval, a terv változata új nevet kap (a könyvtár nem változik), és ＋ gombbal a könyvtárba tehető. Keresés névre, kategóriára, lábnévre és -funkcióra (ékezet nélkül is, pl. „i2c”, „adc”), kedvencek (☆), legutóbb használtak, összecsukható csoportok.
- **Szimuláció:** egyenáramú csomóponti analízis (diódák, MOSFET, NPN lezárt/aktív/telített tartománnyal, kondenzátor feszültsége és τ = R·C időállandója, Pico táp és GPIO-módok), PWM (kitöltés, frekvencia; időszeletekre bontva, így a tranzisztoros/MOSFET-es kapcsolás is helyes; 25 Hz alatt a panelon valós időben villog, felette a kitöltéssel arányos átlag), LED-fényerő az áram szerint, motorfordulat, szervószög, léptetőmotor-lépések (félléptetéses fázisból), gombnyomás, csúszkák (pl. joystick-tengely), LED-fény és háttérvilágítás, GPIO-szintek és analóg feszültségek.
- **Jelsorozat:** a Szimuláció fülön GPIO-k léptetése mintasorok szerint (félléptetés, teljes lépés, egytekercses, bináris számláló vagy saját minta), lépésenként vagy lejátszással, állítható ütemmel és iránnyal.
- **Példák:** a Terv harmonikában kategóriánként (Alapok, Bemenet, Félvezető, Passzív, Motor, Logika, Modul) betölthető mintatervek magyarázó jegyzetekkel: LED kézi hidakkal és útvonalkeresővel, csíkos panel, gomb, joystick, NPN, MOSFET + PWM, RC tag, DC motor, szervó, léptetőmotor, NAND, dekóder, D tároló, Nokia 5110, TP4056. Betöltés után visszavonással (Ctrl+Z) visszahozható az előző terv.
- **Jegyzetek és megosztás:** Jegyzet eszköz (<kbd>J</kbd>) átméretezhető, színezhető cetlikhez, opcionálisan szaggatott mutatóval egy alkatrészre; a terv fájlba menthető és megnyitható, a benne használt saját alkatrészekkel együtt. Vezetékek opcionálisan „rövid” nézetben: csak a két vég látszik, megszakítás-jellel, rámutatva vagy kijelölve a teljes vonal.

- **Buszfunkciók:** a vezérlők lábainak I²C-, SPI-, UART- és PWM-funkciói (Pico: az RP2040 kiosztása; ESP32/C3: az alapértelmezett lábak, mert ott bármely láb kiosztható). A perifériák buszlábai (pl. kijelző SDA/SCL, DIN/CLK) a megfelelő, egy buszon lévő GPIO-ra kerülnek; rossz lábra vagy szétszórt buszra, illetve azonos PWM-szeleten eltérő frekvenciára figyelmeztet. A láb funkciói az állapotsorban és a GPIO-táblában látszanak.
- **Vezérlés (program):** fent a munkaterület-váltó: *Panel*, *Vezérlés* vagy *Mindkettő* (asztali gépen egymás mellett). A Vezérlés csomópontos program: bemenet (gomb, analóg), logika (NEM, ÉS, VAGY, KIZÁRÓ VAGY, összehasonlítás), idő (ütemadó, váltókapcsoló, számláló, késleltetés), kimenet (digitális, PWM). A csomópont alkatrészlábra hivatkozik (pl. SW1.A1, R1.1), a GPIO-t a bekötés adja. Él húzással vagy két koppintással (kimenet, majd bemenet); szimuláció közben az élek és portok az aktuális értéket mutatják, a kijelölt csomópont lába a panelon kiemelődik. Példák a *Program* kategóriában.
- **Kód:** a Vezérlés nézet *Kód* fülén a programból generált MicroPython (`main.py`, Thonny/mpremote) vagy Arduino kód (`.ino`, Arduino IDE 2: a lap és az alaplapkezelő URL-je kiírva), másolható, letölthető; Arduinóhoz PlatformIO-projekt is (zip: `platformio.ini` + `src/main.cpp`; ESP32-n pioarduino, Picón a maxgerhardt-féle platform). A kijelölt csomópont sorai kiemelődnek, sorra kattintva a csomópont lesz kijelölve. A lapfüggő részletek a vezérlőlap leírásában vannak (`meta.target`).
- **Oldalsávok:** összecsukhatók keskeny ikonsávvá (gomb, <kbd>[</kbd> és <kbd>]</kbd>); balra Szerkesztés (eszközök, a vezetékszín csak Vezeték eszköznél, Kijelölés és Jelmagyarázat harmonikában) és Alkatrészek (keresés, kedvencek, legutóbb használt, Projekt, Saját könyvtár, beépített kategóriák, könyvtár import/export); jobbra Terv (Kapcsolatok, Panel, Terv harmonikában), Ellenőrzés (összegzés a fülön) és Szimuláció (indításkor erre vált).
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
src/engine/   típusos, DOM-mentes motor:
                types (terv), defs (alkatrész-regiszter), geometry, mcu (GPIO-képességek, buszfunkciók),
                board (csíkdarabok, vágások), netlist, solve (csomóponti analízis), simulate (PWM, logika, léptető),
                links, check (ellenőrzés), route (útvonalkereső, csíkvágás, kézi→automatikus),
                design (beolvasás, üres terv), signal (Jelsorozat), swap (vezérlőcsere), presets (regressziós minták)
src/ui/       alkatrész-szerkesztő, logikai nézetek, példatár
src/app.ts    felület: rajzolás, egér- és érintéskezelés, oldalsávok, panelek, window.pcb API (még típus nélkül)
tests/unit/   Vitest
tests/e2e/    Playwright, a window.pcb API-n keresztül
```

### Alkatrész hozzáadása

Az alkatrészek adatként vannak leírva (`src/core/schema.ts`): lábak, összekötött lábcsoportok, paraméterek, rajzelemek rétegekben, villamos modell és vezérlők. Új alkatrészhez egy új bejegyzés kell a `src/parts/builtin.ts`-ben; a rajzolás, a tulajdonságpanel, az ellenőrzés és a szimuláció ebből dolgozik. A `tests/unit/parts.test.ts` minden beépített leírást automatikusan ellenőriz. Kísérletezni a felületen is lehet („+ Saját alkatrész”): a szerkesztő ugyanezt a leírást állítja elő, a JSON fül pedig bemásolható a `builtin.ts`-be.

## Kitelepítés

Minden `main`-re érkező push után a GitHub Actions lefuttatja az ellenőrzéseket, és siker esetén kitelepít a GitHub Pagesre. Egyszeri beállítás: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
