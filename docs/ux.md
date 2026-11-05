# UX-keret és felülvizsgálati jegyzet

Ez a jegyzet a későbbi UX-felülvizsgálat (ütemterv 5. lépés) alapanyaga. Minden fejlesztési kör bővíti:
mi került a felületre, hova, és milyen kérdést hagyott nyitva. A felülvizsgálat ebből a kész anyagból dolgozik.

## Célok

- **Átlátható:** egy új felhasználó 1 percen belül megtalálja, hol kezdjen (példa betöltése, alkatrész lerakása, szimuláció).
- **Könnyen elérhető:** a gyakori műveletek legfeljebb 2 kattintásra vagy egy billentyűre vannak.
- **Gyors:** minden fő eszköznek van gyorsbillentyűje; később parancspaletta és keresés.
- **Ismerős:** a Wokwi, a Tinkercad Circuits és a Fritzing mintái (könyvtár balra, tulajdonságok jobbra, szimuláció felül).
- **Nem vész el az információban:** fokozatos felfedés; alapból a lényeg, a részlet kijelöléskor vagy kinyitva.

## Tervezett keret

| Elem | Állapot | Megjegyzés |
| --- | --- | --- |
| Összecsukható oldalsávok (`[` és `]`) | kész | ikonsáv a fülekkel, a Problémákon hibaszám |
| Harmonikák a jobb sávban (Kapcsolatok, Panel) | kész | állapotuk megmarad; a Terv harmonika tartalma a Fájl menübe került |
| Fülek: Szerkesztés / Alkatrészek, Terv / Problémák / Szimuláció | kész | szimuláció indításakor a Szimuláció fülre vált |
| Elrendezések (Tervezés, Program, Szimuláció) | kész (5.2) | `src/ui/layout.ts`; a döntések a UX-felülvizsgálat dokumentumban |
| Parancspaletta (pl. Ctrl+K) | terv | alkatrész, eszköz, példa és beállítás keresése egy helyen |
| Kezdőkép üres tervnél | kész (5.1) | bevezető, Tiszta sablon panelválasztással, Példa betöltése |
| Fájl menü, téma, állapotsor, szabad vászon | kész (5.1) | tokenek (elsődleges/másodlagos szín, lépték), komponenskészlet, ikonok, fogalomtár |
| Láb-súgó rámutatásra | részben | az állapotsor mutatja a GPIO funkcióit (I²C, SPI, UART, PWM, ADC) |
| Mobil: alsó lapok, lebegő gombok | kész | külön vizsgálni a sűrűségüket |

## Körönkénti napló

| Kör | Ami a felületre került | Nyitott kérdés |
| --- | --- | --- |
| Példatár | Példák a Terv harmonikában, kategóriákkal | Első indításkor is ajánlani? |
| Vezérlők | Vezérlőcsere a tulajdonságpanelen | A csere nem látszik, amíg nincs kijelölve a vezérlő |
| Lezáró kör | Összecsukható sávok, lábfunkciók az állapotsorban és a GPIO-táblában | Kell-e láb-súgó buborék a vásznon? |
| Elrendezés-rendszer (5.2) | Elrendezések (Tervezés, Program, Szimuláció; elrendezésenként megőrzött kézi módosítással), nézetsáv a vászon fölött, eszközsáv a vászon alján, lebegő és rögzíthető tulajdonságablak, alsó panel (Problémák több oszlopban, Napló), a Problémák fül és a bal Szerkesztés fül megszűnt | A Program elrendezés tartalma (csomóponttár, Kód a jobb sávban) az 5.4-ben; mobilon a tulajdonságablak csak a Beállítás gombra nyílik |
| Csíkvágás típusa | A Csíkvágás eszköznél a sáv fölött (mint a vezeték színe): Automatikus (a kattintás helye dönt) \| Furat \| Rés; összecsukva csak a választott; a beállítás megmarad; `pcb.cutKind()` | – |
| app.ts bontása (2. lépés folytatása) | Kívülről nincs változás. Típusos modulokba: visszavonás egy helyen (ui/history), alkatrészlista (ui/library), napló (ui/log), nézetforgatás (ui/viewport), alkatrészrajz (ui/drawpart); app.ts 1557 → 1451 sor | A panel rajza (csíkok, hidak, vezetékek, jegyzetek), az interakció és a tulajdonságpanel még az app.ts-ben |
| Egyszerű mód (5.5) | Fájl menü › Egyszerű mód (és jelvény a fejlécben, kattintásra kikapcsol): rejtve a csíkvágás, kézi ↔ automatikus bekötés, automatikus csíkvágás, JSON, könyvtár export/import, PlatformIO, saját alkatrész szerkesztése, a Logika és Csatlakozó kategória; a Problémák közül csak a hibák; `pcb.simple()` | Mobil erre építve |
| Panel a szerkesztő mellett | Kapcsoló a nézetsávban a szerkesztő füle mellett: bal fele a vászon (kijelölés, eszközök, nézetmódok), jobb fele a szerkesztő egy hasábban; a beállítás megmarad | – |
| Belső kapcsolás: több hely, teljes képernyő | A logika tápja és földje a lábak szerepéből (nincs külön választó, a bevezető szöveg is kikerült); a diagram magasabb; teljes képernyő gomb a belső kapcsoláson és a Program blokkszerkesztőjén (Esc: vissza); új elem szabad helyre kerül | – |
| Belső kapcsolás, 2. lépés: teljes kapcsolás egy diagramon | A villamos elemek (ellenállás, dióda, forrás, MOSFET, kondenzátor, motor, NPN, vezérlőlap) és a nyomógomb is a diagramon, a Láb elemhez kötve; a Villamos modell és a Vezérlő szakasz megszűnt; a hibás kivezetés a diagramon kijelölve | – |
| Belső kapcsolás: logika diagramon (1. lépés) | A Működés › Logika diagram: bemenet, állandó, kapuk, tároló, kimenet, élek húzással; a kimenet kifejezése szövegből is (a kapuk ebből épülnek); Igazságtábla második nézetként; a Kifejezés és a Kapuk nézet megszűnt; a diagram hibái (bekötetlen bemenet, kör, hatástalan kapu) az alkatrész problémái között, kattintásra kijelölve | 2. lépés: villamos elemek és nyomógomb a diagramon |
| Szerkesztő fejléc nélkül | A fülön ikongombok: Elvetés (kuka), Mentés (floppy), háttérbe (nem mentettnél) / bezárás; Lábak \| Működés \| JSON a jobb hasáb tetején; az alkatrész törlése az Alapadatok fülön; a lista kinyit / becsuk gombja dupla chevron | – |
| Alkatrészlista és szerkesztő-finomítások | Lista: kedvenc elöl, szerkesztés a végén, egybeolvadó gombsor; a kereső alatt Új alkatrész, minden csoport kinyitása / becsukása. Szerkesztő: az előnézet alatt Alapadatok \| Megjelenés \| Problémák fül (csak a fül tartalma görget), a láb húzással áthelyezhető, érthetőbb logikai hibaüzenetek | – |
| Alkatrész-szerkesztő átszervezése | Balra az előnézet, az alkatrész problémái (hely + ugrás a mezőhöz), alapadatok és megjelenés; jobbra Lábak \| Működés (villamos modell, logika, vezérlő) \| JSON; több alkatrész egyszerre, mindegyik saját füllel (csak a látható van a DOM-ban), a nem mentettek füle újratöltés után is visszajön | A Működés csomópontos diagramja külön kör |
| Alkatrész-szerkesztő (5.6) | Középső nézet ablak helyett, fül a nézetsávban (Alkatrész: név, • ha nem mentett; Panel/Program háttérbe teszi, × piszkozatként zárja); Űrlap / Logika / JSON gombsor; szakaszugrás; keskeny lábtáblázat, a kijelölt láb csoport/funkció/táp adatai a sora alatt („Minden oszlop” kapcsolóval a széles); egy fő Mentés (új alkatrésznél a lerakást is indítja), Elvetés csak módosítás után; Ctrl+S; csak a fülön van bezáró: nem mentett módosításnál előbb háttérbe tesz (a fül marad, újratöltés után is), háttérből bezárva a piszkozat megmarad | Az ellenőrzés még a szerkesztőben, nem az alsó Problémák panelen |
| Bekötés a tulajdonságokból | Lábak és bekötés táblázat (szerep, háló/kapcsolat/lebeg, cél lenyílóból), kapcsolat célja a Kapcsolatok fülön, lebegő kötelező láb megjegyzésként, PWM saját kitöltése | Több kapcsolat egy lábon: a táblázat az elsőt mutatja |
| Program elrendezés (5.4) | Kód a jobb sávban, Mindkettő egymás mellett / alatt, Sorozat blokk, Léptetőmotor sablon; a Jelsorozat megszűnt (régi tervekben programmá alakul) | A program saját neve még nyitott |
| Eszközsáv (5.3) és 5.2-javítások | Eszközök ikonnal és névvel, Alt-ra az ikon helyén a betű, elrendezésenkénti eszközkészlet, kijelölés szimulációban; nagyítás a bal felső sarokba, Panel beállításai ablakban, rögzített tulajdonságok saját fülön, oldalsáv-kapcsolók a fejlécben, nagyobb tér a panel körül (24 lyuk) | Szűk vásznon csak az ikonok látszanak (konténer-lekérdezés) |
| Alapozó kör (5.1) | Fájl menü (új, megnyitás, mentés, példák, könyvtár, JSON, téma), kezdőkép, állapotsor, szabad vászon, értesítés, ikonok, fogalomtár; „Vezérlés” → „Program”, „Ellenőrzés” → „Problémák”, „Forrasztóhíd” → „Híd” | A nézet-gombsor (Alkatrészoldal…Röntgen) az 5.2–5.3-ban rendeződik |
| Alkatrész-kör | Keresőmező, Kedvencek / Legutóbb használt / Projekt / Saját könyvtár csoportok (összecsukhatók), tervtől független könyvtár; szerkesztőben MCU-modell, képességek, buszfunkció | Húzással is lehessen lerakni? Kell-e a kategóriákra szűrő gomb a keresés mellé? |

## Felülvizsgálati szempontlista

1. Az első 5 percben egy új felhasználó végig tud-e menni a kör: példa → módosítás → szimuláció → mentés?
2. Hány kattintás a 10 leggyakoribb művelet (lerakás, forgatás, kapcsolat, útvonal, szimuláció, GPIO-mód, mentés…)?
3. Melyik panel látszik feleslegesen az adott munkafázisban?
4. Ugyanaz a fogalom ugyanazzal a szóval szerepel-e mindenhol (kapcsolat, híd, vezeték, kábel)?
5. A hibák és figyelmeztetések érthetőek-e, és egy kattintással odavisznek-e a hibához?
6. Billentyűzettel és képernyőolvasóval használható-e a fő folyamat?
