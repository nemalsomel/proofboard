---
title: Panel és alkatrészek
description: Paneltípusok és méret, alkatrészek lerakása, mozgatása, tulajdonságai; külső alkatrészek, vezérlőcsere, rézoldali alkatrész.
---

A panel a próbanyák, amire tervezel. Az alkatrészek lábai a lyukaiba kerülnek, a réz a panel típusától függően köti össze őket.

## Paneltípusok

**Fájl › Panel beállításai…** (<kbd>Alt</kbd>+<kbd>B</kbd>), új tervnél pedig a **Fájl › Új terv…**:

- **Pontraszter** (nincs szekció): minden lyuk külön rézzel áll, mindent hidakkal vagy vezetékkel kötsz össze.
- **Szekciós** (1×2 … 1×5): a szomszédos lyukak kis rézdarabokban vannak összekötve. Kevesebb híd kell.
- **Csíkos** (teljes csík, stripboard): a sorok végig össze vannak kötve, ezért a csíkot ott el kell vágni, ahol két különböző jel találkozna. Lásd: [Csíkvágás](wiring#csikvagas).

![A Panel beállításai ablak: típus, méret lyukban, szekció.](img:boardset)

A méret vagy a rézosztás módosítása visszavonható. A panelról lelógó hidak és vezetékek törlődnek.

## Alkatrész lerakása

1. Keresd meg a bal oldali listában. A keresőmező (<kbd>/</kbd>) névre, lábra és funkcióra is keres (pl. „pwm”, „adc”, „i2c”).
2. Kattints rá, majd a panelen a kívánt lyukra. Lerakás előtt <kbd>R</kbd> forgat, <kbd>M</kbd> tükröz.
3. A csillaggal a gyakran használt alkatrészt a kedvencekhez adod.

A lista kategóriák szerint csoportosít (Vezérlő, Bemenet, Passzív, Félvezető, Modul…); a csoportok összecsukhatók.

## Kijelölés és mozgatás

- Kattintás: kijelöl. <kbd>Shift</kbd> + kattintás vagy keret: több elem.
- Húzás: mozgat; a lábak mindig lyukba kerülnek. Ha az új helyen nem fér el (ütközik egy másik alkatrésszel), nem mozdul.
- <kbd>R</kbd> forgatás, <kbd>M</kbd> tükrözés, <kbd>D</kbd> duplikálás, <kbd>Delete</kbd> törlés, <kbd>Ctrl</kbd>+<kbd>A</kbd> mindent kijelöl.

## Tulajdonságok

A kijelölt alkatrész adatai a tulajdonságpanelen látszanak (lebegő ablak a panel fölött, vagy a jobb sávba rögzítve):

![A kijelölt nyomógomb tulajdonságai: név, forgatás, tükrözés, jelölők, és a lábak bekötése.](img:props)

- **Név:** a címke (R1, LED1, SW1…). Erre hivatkoznak a kapcsolatok és a program is.
- **Paraméterek:** érték (pl. ellenállás Ω-ban), szín, potméter állása; a csúszkás paraméterek szimuláció közben is állíthatók.
- **Röntgen:** csak a körvonal és a lábak látszanak, hogy lásd, mi van alatta.
- **Rögzített hely:** a [Tömörítés](wiring#tomorites) és a Claude nem mozdítja el; kézzel továbbra is mozgatható. A rajzon lakat jelzi.
- **Rézoldalra (alulra):** lásd lent.
- **Lábak és bekötés:** lábanként, hová kell kötni (GND, egy szabad GPIO, egy másik láb). Ebből kapcsolat lesz. Lásd: [Bekötés](wiring).
- **Másolat saját alkatrészként:** a leírásából saját alkatrész készül, a szerkesztőben átírható. Lásd: [Saját alkatrész](custom-parts).

## Vezérlőlapok és vezérlőcsere

Beépített vezérlőlap a **Raspberry Pi Pico W**, az **ESP32 DevKit V1** (30 láb) és az **ESP32-C3 SuperMini**. A lábak képességeit is ismeri: melyik tud analóg jelet mérni (ADC), melyik csak bemenet, melyik indítási láb (strapping), melyik a soros port. Az egérrel a láb fölé állva a magyarázatát is látod.

A vezérlőlap kijelölésekor a tulajdonságpanel **Csere** gombjával másik lapra válthatsz: a kapcsolatok megmaradnak, a GPIO-kat újra kiosztja, és a program is követi, mert a blokkok lábakra, nem GPIO-számokra hivatkoznak.

## Külső alkatrészek és csatlakozók

Ami nem a panelra kerül (kijelző kábellel, motor, joystick-modul), a panel mellé kerül, a lábai kivezetésekként látszanak. A kábel egy **csatlakozóba** (tüskesorba) dugható: ilyenkor a csatlakozó lábáról vezet tovább az útvonal. Kijelöléskor a tulajdonságpanelen tehetsz hozzá csatlakozót a panelra.

## Rézoldali alkatrész

Néha egy alkatrész a panel másik oldalára kerül (pl. egy gomb, ami a dobozon kívül nyomható). A tulajdonságpanelen a **Rézoldalra (alulra)** jelölővel állítod be, vagy a parancspalettán a „Rézoldalra” paranccsal.

- A test alatt alapból **nem mehet híd, és nem lehet más forrasztási pont**, mert a forrasztás nem fér el alatta. Az útvonalkereső kikerüli ezt a területet, a rajzon piros vonalkázás jelzi.
- Ha mégis kell, kapcsold be: **Alatta is mehet híd, lehet forrasztás**.
- Alkatrészoldali nézetben halványan, rézoldaliban teljesen látszik. A beültetési sorrendben külön lépés lesz, a hidak után.

![Csíkos panel rézoldalról: a csíkok, a vágások és a hidak.](img:copper "Rézoldali nézet (F): tükrözve, ahogy forrasztáskor látod.")

## Jegyzet

A **Jegyzet** eszközzel (<kbd>J</kbd>) szöveges cédulát teszel a panelra: magyarázatnak, emlékeztetőnek. A példák is így magyaráznak.
