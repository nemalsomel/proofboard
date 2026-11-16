---
title: Első lépések
description: A felület részei, az első terv egy példából, és a legfontosabb mozdulatok.
---

A Proofboard a böngészőben fut, telepítés és regisztráció nélkül. Ugyanazon a terven rakod le az alkatrészeket, kötöd be őket, írod meg a vezérlőlap programját, próbálod ki szimulációban, és készíted el a gyártási lapokat.

## A felület

![A Proofboard Tervezés elrendezésben: balra az alkatrészlista, középen a panel egy ESP32-vel, gombbal, LED-del és joystickkal, a kijelölt LED tulajdonságaival, jobbra a Kapcsolatok fül.](img:ui "Tervezés elrendezés: balra az alkatrészek, középen a panel a kijelölt LED tulajdonságaival, jobbra a kapcsolatok.")

- **Fejléc:** a panel mérete, a **Fájl** menü, az elrendezések (**Tervezés**, **Program**, **Szimuláció**, **Gyártás**), az oldalsávok ki- és bekapcsolása, a visszavonás, és a **Szimuláció** indítógombja.
- **Bal sáv:** az **Alkatrészek** listája kereséssel, és a **Műszerek** (multiméter, szkóp, szondák).
- **Középen:** a munkaterület. Fölötte választhatsz **Panel**, **Program** vagy **Mindkettő** nézet között, és itt váltod az **Alkatrészoldal** és a **Rézoldal** nézetet. Alul az eszközsáv: Kijelölés, Híd, Vezeték, Kapcsolat, Csíkvágás, Jegyzet, Törlés, Mozgatás.
- **Jobb sáv:** **Kapcsolatok**, **Szimuláció**, **Kód** és **Agent** fül.
- **Alsó panel:** a **Problémák** és a **Napló**, alatta az állapotsor (alkatrészek száma, foglalt terület, az aktuális eszköz és a kijelölés).

## Az első terv egy példából

A leggyorsabb kezdés egy kész példa: **Fájl › Példák…** (<kbd>Alt</kbd>+<kbd>P</kbd>). A példák kategóriák szerint vannak (Alapok, Vezérlő, Bemenet, Program, Félvezető, Motor, Logika, Modul…), és mindegyikben jegyzetek magyarázzák, mit érdemes megnézni.

![A Példák ablak a kategóriákkal és a példák leírásával.](img:examples)

Jó első példák:

1. **LED akkuról – útvonalkeresővel:** három alkatrész és két kapcsolat; a hidakat a program rakja le.
2. **Nyomógomb a Picón:** egy bemenet a vezérlőlapon, a felhúzó ellenállással.
3. **Gomb kapcsolja a LED-et – váltókapcsoló:** az első program, három blokkból.

A betöltés visszavonható (<kbd>Ctrl</kbd>+<kbd>Z</kbd>), így a korábbi terved nem vész el.

## Saját terv a semmiből

1. **Fájl › Új terv…** (<kbd>Alt</kbd>+<kbd>N</kbd>): válaszd ki a panel méretét és típusát (pontraszter, szekciós vagy csíkos). Lásd: [Panel és alkatrészek](board).
2. Kattints egy alkatrészre a bal oldali listában, majd a panelen arra a lyukra, ahová kerüljön. Lerakás közben <kbd>R</kbd> forgat, <kbd>M</kbd> tükröz, <kbd>Esc</kbd> megszakítja.
3. Kösd be: a **Kapcsolat** eszközzel (<kbd>C</kbd>) kattints az egyik lábra, aztán a másikra. A hidakat az útvonalkereső keresi meg. Lásd: [Bekötés és útvonalkeresés](wiring).
4. Indítsd el a szimulációt (<kbd>S</kbd>), és nézd meg, világít-e a LED. Lásd: [Szimuláció és mérés](simulation).

## Mozgás a panelen

- **Nagyítás:** <kbd>Ctrl</kbd> + görgő, vagy a bal felső sarok gombjai; <kbd>0</kbd> az egész panelt mutatja.
- **Görgetés:** görgő, vagy <kbd>Szóköz</kbd> + húzás, vagy a **Mozgatás** eszköz (<kbd>H</kbd>).
- **Érintéssel:** egy ujjal görgetsz, alkatrészen húzva mozgatod, két ujjal nagyítasz.
- **Parancspaletta:** <kbd>Ctrl</kbd>+<kbd>K</kbd> vagy <kbd>F1</kbd>. Begépelve megtalálja a parancsokat, az alkatrészeket és a példákat is. A <kbd>Ctrl</kbd> nyomva tartásakor a gombokon megjelenik a gyorsbillentyűjük.
- **Súgó:** a fülsorok, ablakok és nézetek **?** gombja ennek a kézikönyvnek az arról szóló részét nyitja meg, új lapon; a teljes kézikönyv a **Fájl › Kézikönyv** alatt van.

> **Tipp:** az **Egyszerű mód** (Fájl menü; bekapcsolva a fejlécben jelzés mutatja, arra kattintva kikapcsol) elrejti a haladó részeket, és a Problémák közül csak a hibákat mutatja. Tanuláshoz és tanításhoz jó kiindulás.

## Hol vannak a terveim?

A böngésződ tárolójában, a saját gépeden: a munkád újratöltés után is megvan. Fájlba a **Fájl › Mentés fájlba** (<kbd>Ctrl</kbd>+<kbd>S</kbd>) ment, és a terv linkkel is megosztható. Lásd: [Mentés és megosztás](saving).
