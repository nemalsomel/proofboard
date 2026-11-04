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
| Alapozó kör (5.1) | Fájl menü (új, megnyitás, mentés, példák, könyvtár, JSON, téma), kezdőkép, állapotsor, szabad vászon, értesítés, ikonok, fogalomtár; „Vezérlés” → „Program”, „Ellenőrzés” → „Problémák”, „Forrasztóhíd” → „Híd” | A nézet-gombsor (Alkatrészoldal…Röntgen) az 5.2–5.3-ban rendeződik |
| Alkatrész-kör | Keresőmező, Kedvencek / Legutóbb használt / Projekt / Saját könyvtár csoportok (összecsukhatók), tervtől független könyvtár; szerkesztőben MCU-modell, képességek, buszfunkció | Húzással is lehessen lerakni? Kell-e a kategóriákra szűrő gomb a keresés mellé? |

## Felülvizsgálati szempontlista

1. Az első 5 percben egy új felhasználó végig tud-e menni a kör: példa → módosítás → szimuláció → mentés?
2. Hány kattintás a 10 leggyakoribb művelet (lerakás, forgatás, kapcsolat, útvonal, szimuláció, GPIO-mód, mentés…)?
3. Melyik panel látszik feleslegesen az adott munkafázisban?
4. Ugyanaz a fogalom ugyanazzal a szóval szerepel-e mindenhol (kapcsolat, híd, vezeték, kábel)?
5. A hibák és figyelmeztetések érthetőek-e, és egy kattintással odavisznek-e a hibához?
6. Billentyűzettel és képernyőolvasóval használható-e a fő folyamat?
