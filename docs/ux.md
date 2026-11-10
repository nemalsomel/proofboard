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
| Parancspaletta és gyorsbillentyűk | Ctrl+K (F1, ?): keresés minden parancs, alkatrész és példa között (ékezet nélkül is), Enter végrehajtja; üresen a teljes gyorsbillentyű-táblázat csoportonként, a kapcsolók pipával, a most nem elérhetők halványan. Új billentyűk: Alt+L megosztás, Alt+P példák, Alt+B panel beállításai, Alt+C Claude-kapcsolat, Alt+J JSON, Alt+K tömörítés, U útvonalak, +/− nagyítás, ⇧1–⇧5 a jobb sáv fülei, / alkatrészkeresés. Ctrl nyomva tartva minden látható gombon a billentyűje, fölül utalás a palettára. A billentyűk egy parancslistából (menü, címkék, paletta) | Billentyűk átállítása (később) |
| Megosztás linkkel | Fájl › Megosztás linkkel…: a teljes terv (saját alkatrészek, program, jegyzetek) tömörítve a link # része mögött, szerver nélkül; másolás, telefonon rendszer-megosztás; hossz kiírva, 8000 karakter fölött figyelmeztetés. A link megnyitásakor üres tervnél rögtön betölt, különben rákérdez (Mentés fájlba, majd megnyitás); visszavonható. Agent/MCP: `get_share_link`, `open_share_link` | Előnézeti kép a linkhez (közösségi előnézet szerver nélkül nem megy) |
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
| Példák ablak és tanító példák | Nagy ablak: balra a kategóriák darabszámmal, jobbra kártyák (szint, program, mit tanulsz), keresés minden kategóriában; új példák: Futófény (Sorozat), Két gomb ÉS blokkal, Fényerő lépcsőkben (Számláló → PWM), Lépcsőházi világítás (Késleltetés), Saját XOR modul belső kapcsolással (új kategória: Saját alkatrész); eszközsáv csak ikonokkal, ha nem fér ki; csíkvágásnál csak a szaggatott előnézet | Előnézeti kép a kártyákon (később) |
| Példák szűrő, Időzítő, szerkesztő visszavonása | Példák: a lábléc mindig alul, „Összes kategória”, címkeszűrő (kezdő/haladó/program; a kategóriában szűr, a kategóriák darabszáma követi); a Késleltetés blokkból Időzítő lett négy működéssel (utánfutás, bekapcsolási késleltetés, impulzus, szűrés; a régi mentés szűrés marad), a lépcsőházi példa utánfutással; az Alkatrész-szerkesztőnek saját visszavonása van (visszavonás, újra, elvetés, mentés a Lábak | Működés | JSON sor végén; a fejléc gombjai és a Ctrl+Z/Y is az övé, amíg látszik; teljes képernyős diagramon is), a panel előzményeitől független | – |
| Névjegy és PWA | Fájl → Névjegy: verzió és dátum, rövid leírás, GitHub-link, hibajelzés; telepíthető alkalmazás (manifest, ikonok, service worker), offline is indul, új verziónál „Frissítés” értesítés (nem frissít magától), Telepítés menüpont, ha a böngésző felajánlja | Landing oldal |
| Nyelv előkészítése | i18n alap (`t()`, `translateDom`, magyar kulcsú angol szótár, lefedettség-ellenőrzés); Fájl → Nyelv: Magyar / English, a választás megmarad; a statikus felület, az eszközsáv és az állapotsor angolul kész; a panel rajza kiemelve (`ui/drawboard.ts`, 18 jelenet képpontra azonos) ; a tulajdonságpanel, a kapcsolatok, a szimuláció, a Problémák/Napló kerete, az alkatrészlista kerete, a blokkszerkesztő (a blokkokkal), a Kód fül és a példák ablaka is fordítható, többes számmal ; az Alkatrész-szerkesztő, a belső kapcsolás, a Problémák és a leírás-ellenőrzés üzenetei és a generált kód kommentjei is ; az alkatrészadatok (név, lábkép, paraméterek, súgó, lábmegjegyzések) és a példák (kártya, jegyzetek) is: a felület teljesen angolul is használható | Keresés angol alkatrésznévre; böngészőnyelv szerinti alapértelmezés |
| Rövid vezeték a kábeleken; eszközök a Program elrendezésben | A külső alkatrészek kábelei is rövidítve (csonk és szakadásjel), rámutatva vagy kijelölve teljesen; a Program elrendezésben a panelen minden eszköz elérhető (csak a Szimulációban szűkül) | – |
| Csíkvágás típusa | A Csíkvágás eszköznél a sáv fölött (mint a vezeték színe): Hely szerint (a kattintás helye dönt; a szaggatott előnézet a lyukon belül is követi) \| Furat \| Rés; összecsukva csak a választott; a beállítás megmarad; `pcb.cutKind()` | – |
| Csíkvágás törlése | Kézi és automatikus vágás is: Kijelölés eszközzel rákattintva (tulajdonságok: fajta, hely, kézi/automatikus, magyarázat; Delete), Csíkvágás eszközzel ugyanoda kattintva, Törlés eszközzel; „Kézi vágások törlése (n)” a Csíkvágás sávjában. A törölt automatikus vágás helyére nem kerül újra (`cutBan`), a program a két láb között máshol vág; `pcb.uncut()`, `pcb.selectCut()`, `pcb.clearCuts()` | Kereten belüli vágások csoportos kijelölése |
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

## Beépített agent (2026. november)
- **Hely:** jobb sáv, „Agent” fül (és ikon az összecsukott sávon). Saját Anthropic API-kulccsal (BYOK), a kulcs a böngészőben marad („Megjegyzés ebben a böngészőben”, vagy csak a munkamenetre); modell választható.
- **Módok:** *Megbeszélés* (olvas, elemez, számol, javasol, nem módosít) és *Megvalósítás* (épít; nagyobb változtatás előtt tervet mutat és rákérdez).
- **Visszajelzés:** az eszközlépések sorai a csevegésben (✓ / hiba, lenyitva a részletek), a terv élőben változik; futás közben a panel fölött „Az agent dolgozik…” sáv Leállítás gombbal, a panel kerete kiemelt, a kézi szerkesztés szünetel, Esc leállít.
- **Visszavonás:** egy feladat egy lépés (Ctrl+Z); ha a terv nem változott, nincs visszavonási lépés.
- **Hibák:** érvénytelen kulcs, egyenleg, sebességkorlát, túlterhelés, hálózat – érthető szöveggel; a beszélgetés utána folytatható.
- **Beszélgetések:** projektenként (a terv azonosítója szerint) mentve, a böngészőben; újratöltéskor a legutóbbi nyílik meg, a „Korábbi beszélgetések” listából megnyitható vagy törölhető (projektenként legfeljebb 20; képek nélkül). Másik terv betöltésekor annak a beszélgetései jönnek.
- **Hosszú beszélgetés:** a régi eszközeredmények rövidülnek, majd a korábbi rész egy modellhívással összefoglalóra cserélődik (megjegyzés a csevegésben), hogy a kérések ne dráguljanak.
- **Projektjegyzet:** a terv része (vele mentődik, exportálódik); a panel tetején szerkeszthető, az agent minden beszélgetés elején megkapja, és a `set_project_notes` eszközzel frissíti (a felhasználó egyetértésével). Visszavonható.

## Claude-kapcsolat – MCP (2026. november)
- **Cél:** a Claude Desktopból / Claude Code-ból (a felhasználó saját előfizetésével, API-kulcs nélkül) is lehessen tervezni, és az eredmény itt, élőben látsszon.
- **Felépítés:** a `proofboard-mcp` helyi szerver (npx) a Claude felé MCP, az app felé WebSocket-híd (127.0.0.1:47615). Az app csak a „Csatlakozás” gombra (vagy bekapcsolt automatikus csatlakozásnál) kapcsolódik; app nélkül a szerver memóriabeli terven dolgozik, fájlba menthet.
- **Visszajelzés:** a fejlécben „Claude” jelző (kapcsolódva / várakozás / dolgozik); munka közben a panel fölött a „dolgozik” sáv (a kézi szerkesztés szünetel), a végén üzenet. Egy munkamenet (a hívások 2,5 s szünetig) egy visszavonási lépés; a sáv gombja bontja a kapcsolatot.
- **Csak olvasás:** a Claude látja, ellenőrzi, szimulálja a tervet, de a módosító hívásokat az app elutasítja.
- **Ütközések:** amíg a beépített agent fut vagy a Tömörítés ablak nyitva van, az app a Claude hívásait udvariasan elutasítja; új lap kapcsolódásakor a régi leválik.
