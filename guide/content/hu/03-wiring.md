---
title: Bekötés és útvonalkeresés
description: Kapcsolatok, automatikus hidak és vezetékek, kézi bekötés, csíkvágás, Problémák és Tömörítés.
---

A Proofboardban kétféleképpen köthetsz be. **Kapcsolattal** csak azt adod meg, hogy mit mivel kell összekötni, a hidakat és vezetékeket hozzá az útvonalkereső keresi meg. **Kézzel** te rakod le a hidakat és vezetékeket. A kettő keverhető.

## Kapcsolatok

Egy kapcsolat két láb (vagy egy láb és a GND / egy szabad GPIO) között azt jelenti: ezeknek egy hálón kell lenniük.

- **Kapcsolat eszköz** (<kbd>C</kbd>): kattints az egyik lábra, aztán a másikra.
- **Tulajdonságpanel › Lábak és bekötés:** lábanként választod ki a célt: egy másik lábat, a **GND**-t, vagy egy **szabad GPIO**-t. Ilyenkor a program a legközelebbi alkalmas GPIO-t adja (bemenethez, analóg jelhez ADC-t).
- **Gyors gomb:** nyomógomb kijelölésekor „A → GPIO, B → GND” egy kattintással beköti.

![A Kapcsolatok fül: a kapcsolatok listája hídszámmal, fölötte az állapot, a panelen a kiemelt kapcsolat útvonala.](img:links "A Kapcsolatok fül. A listában egy kapcsolatra kattintva a panelen kiemelődik az útvonala.")

A **Kapcsolatok** fülön (<kbd>Shift</kbd>+<kbd>2</kbd>) látod mindet: mi mivel van összekötve, melyik GPIO-ra került, és hány híd viszi. Fölötte a „10/10 bekötve” jelzi, hány kapcsolatot sikerült megvalósítani. A **Kapcsolati vonalak** (<kbd>N</kbd>) a panelen szaggatott vonallal mutatják a még bekötetlen kapcsolatokat.

## Útvonalkeresés

Ha be van kapcsolva az **Automatikus útvonaltervezés**, minden módosítás után újratervez. Kézzel az **Útvonalak keresése** (<kbd>U</kbd>) indítja.

- A szekciós és a csíkos rezet kihasználja: ahol a réz már összeköt, oda nem tesz hidat.
- Ha hidakkal nem megy, vezetéket tesz (huzal két lyuk között).
- Kerüli a foglalt lyukakat, a más hálóhoz tartozó rezet, és a [rézoldali alkatrész](board#rezoldali-alkatresz) alatti területet.
- A kézi hidakhoz és vezetékekhez nem nyúl.

Hasznos gombok a Kapcsolatok fülön:

| Gomb | Mit csinál |
| --- | --- |
| Rögzítés kézire | az automatikus hidakat és vezetékeket kézivé alakítja: többé nem tervezi újra őket |
| Kézi → automatikus | a kézi bekötésből kapcsolatokat csinál, a hidakat az útvonalkereső tervezi újra |
| Auto hidak törlése | eltávolítja az automatikus hidakat (a kapcsolatok megmaradnak) |

## Kézi bekötés

- **Híd** (<kbd>B</kbd>): két szomszédos lyuk összeforrasztása; húzással egymás után több is.
- **Vezeték** (<kbd>W</kbd>): huzal két tetszőleges lyuk között. A színét a tulajdonságpanelen állítod.
- **Törlés** (<kbd>E</kbd>): kattintásra vagy húzással töröl hidat, vezetéket, vágást.

A **Rövid vezeték** nézet (<kbd>Shift</kbd>+<kbd>W</kbd>) a hosszú vezetékekből csak a két végét mutatja, hogy átlátható maradjon a rajz; rámutatva a teljes vonal látszik.

## Csíkvágás

Csíkos panelen a réz végigfut a soron, ezért ahol két különböző jel ugyanarra a csíkra kerülne, el kell vágni. Kétféle vágás van:

- **rés:** a réz megszakítása két lyuk között (késsel),
- **furat:** egy lyuk kifúrása (a lyukon átmenő réz megszakad).

Az **Automatikus csíkvágás** a kapcsolatok szerint vág, a két láb között a legközelebbi szabad helyre. A **Csíkvágás** eszközzel (<kbd>K</kbd>) kézzel vágsz; a típusa az eszközsáv fölött választható: **Hely szerint** (a lyuk közepére kattintva furat, két lyuk közé rés), **Furat** vagy **Rés**. Egy automatikus vágást kijelölve törölhetsz is; ilyenkor oda többé nem tesz újat.

> **Tipp:** a rézoldali nézetben (<kbd>F</kbd>) úgy látod a panelt, ahogy forrasztáskor: tükrözve, a vágásokkal és a hidakkal.

## Problémák

Az alsó panel **Problémák** füle (<kbd>P</kbd>) folyamatosan ellenőrzi a tervet. Egy sorra kattintva odavisz, ahol a gond van.

![A Problémák fül két figyelmeztetéssel: lebegő bemenet a gomb lábán, és túl nagy áram a LED-en a kis ellenállás miatt.](img:problems "Két figyelmeztetés: a gomb GPIO-ja felhúzó ellenállás nélkül lebeg, és a 22 Ω-os előtét-ellenállással túl nagy a LED árama.")

Amit figyel, többek között:

- **zárlat:** a táp és a GND egy hálón,
- **lebegő bemenet** és bekötetlen láb,
- **túl nagy áram** egy LED-en vagy egy GPIO-n, előtét-ellenállás nélküli LED,
- **rossz GPIO:** analóg jel ADC nélküli lábon, ESP32-n ADC2 bekapcsolt WiFi mellett, hardveres busz rossz lábon, PWM-szeleten eltérő frekvencia,
- **motor** közvetlenül GPIO-n, visszacsapó dióda nélkül; lebegő tranzisztorbázis,
- a megengedett tartományon kívüli feszültség,
- forrasztás a rézoldali alkatrész alatt, csavarfej alatti láb a rögzítőfuratnál.

Egyszerű módban csak a hibák látszanak, a figyelmeztetések és a megjegyzések nem.

## Tömörítés

Ha a terv szellős, a **Tömörítés…** (<kbd>Alt</kbd>+<kbd>K</kbd>, vagy a Kapcsolatok fülön) közelebb rendezi az alkatrészeket egymáshoz és a bekötött lábakhoz, hogy kisebb panel is elég legyen.

![A Tömörítés ablak: Laza–Szoros csúszka, rögzítési kapcsolók, előtte/utána táblázat; a panelen az előnézet, halványan az eredeti helyekkel.](img:compact)

- A **Laza ↔ Szoros** csúszkával állítod, mennyire mozgasson.
- Rögzítheted a vezérlőlapot és a kezelőszerveket (gomb, potméter), hogy ne mozduljanak; a **Rögzített hely** jelzős alkatrészek sem mozdulnak.
- A panelen élő előnézet látszik, alatta előtte/utána táblázat: terület, hidak, vezetékek.
- Az **Alkalmaz** egyetlen visszavonási lépés.
