# Fogalomtár

Egy dologra egy szó: a felületen, a súgóban, a példák jegyzeteiben és a hibaüzenetekben is ezek a nevek szerepelnek. Új szöveg írásakor ehhez igazodj; ha új fogalom kell, előbb ide kerüljön.

## Panel és bekötés

| Fogalom | Jelentés | Nem így |
| --- | --- | --- |
| **panel** | a próbanyák, amire tervezel (méret, lyukak, rézosztás) | nyák, board, lap |
| **lyuk** | a panel egy furata; helye `sor:oszlop` | pont, pad |
| **szekció** | szekciós panelen az egymással összekötött lyukak rézdarabja (pl. 1×3) | sziget, csoport |
| **csík** | csíkos panelen (stripboard) a teljes hosszú rézcsík vagy annak elvágott darabja | sáv |
| **pontraszter** | olyan panel, ahol minden lyuk külön rézzel áll | perfboard |
| **csíkvágás** | a réz megszakítása két lyuk között, vagy egy lyuk kifúrása | vágás, szakítás |
| **híd** | forrasztással (ónnal) összekötött két szomszédos lyuk; az eszköz neve is *Híd* | forrasztóhíd (csak magyarázatban) |
| **vezeték** | huzal két tetszőleges lyuk között | drót, jumper |
| **kapcsolat** | kívánt összeköttetés két láb között; a hidakat és vezetékeket hozzá az útvonalkereső keresi meg | link, net, kötés |
| **útvonal** | egy kapcsolat megvalósítása hidakkal és vezetékekkel | nyomvonal |
| **kézi** / **automatikus** | a híd vagy vezeték a felhasználótól, illetve az útvonalkeresőtől származik | saját / gépi |
| **háló** | egymással vezető kapcsolatban lévő lábak és réz összessége (a hover-sávban: *net*) | hálózat |

## Alkatrészek

| Fogalom | Jelentés | Nem így |
| --- | --- | --- |
| **alkatrész** | a panelra rakott elem (ellenállás, LED, vezérlőlap…) | komponens, elem |
| **láb** | az alkatrész kivezetése, egy lyukba kerül | pin, tüske |
| **lebegő láb** | sehova sincs kötve: se kapcsolat, se háló | szabad, bekötetlen |
| **vezérlőlap** | mikrovezérlős fejlesztőlap (Pico W, ESP32…) | MCU, kontroller |
| **GPIO** | a vezérlőlap programozható lába | port |
| **külső alkatrész** | a panel mellé kerülő alkatrész (motor, kijelző), kábellel csatlakozik | panelen kívüli elem |
| **csatlakozó** | tüskesor vagy modulcsatlakozó a panelon, ebbe dugható a külső alkatrész kábele | aljzat, header |
| **saját alkatrész** | a felhasználó által leírt alkatrész | egyedi alkatrész |
| **saját könyvtár** | a saját alkatrészek gyűjteménye a böngészőben, tervtől függetlenül | könyvtáram |
| **projekt** (alkatrészcsoport) | a tervvel érkező saját alkatrészek | — |

## Terv, program, ellenőrzés

| Fogalom | Jelentés | Nem így |
| --- | --- | --- |
| **terv** | minden, ami egy fájlba menthető: panel, alkatrészek, bekötés, program, jegyzetek | projekt, dokumentum |
| **példa** | betölthető, magyarázó jegyzetekkel ellátott terv | minta, demó |
| **sablon** | üres kiindulás egy választott panellal (*Tiszta sablon*) | — |
| **jegyzet** | szöveges cédula a panelon, mutathat egy alkatrészre | megjegyzés, címke |
| **program** | blokkokból álló vezérlés, amely futás közben a GPIO-kat állítja; a nézet neve is *Program* | vezérlés (régi név) |
| **blokk** / **él** | a program egy művelete (bemenet, feltétel, időzítő, kimenet…), illetve két blokk összekötése | csomópont, node / kapcsolat (az *kapcsolat* a panelé) |
| **sorozat** | a minta soronkénti léptetése a kimenetekre (pl. léptetőmotor tekercsei); a régi „Jelsorozat” helyett | jelsorozat, szekvencia |
| **kód** | a programból generált MicroPython vagy Arduino forrás | szkript |
| **szimuláció** | a kör egyenáramú számítása, futás közben a programmal | futtatás |
| **Problémák** | az ellenőrzés eredménye: **hiba** (nem fog működni), **figyelmeztetés** (gyanús) és **megjegyzés** (tájékoztatás, pl. lebegő föld- vagy tápláb) | Ellenőrzés (régi fülnév), alert |
| **napló** | események időrendben: betöltés, mentés, útvonalkeresés, szimuláció (az alsó panel Napló füle) | log, konzol |

## Felület

| Fogalom | Jelentés |
| --- | --- |
| **eszköz** | amivel a panelon dolgozol: Kijelölés, Híd, Vezeték, Kapcsolat, Csíkvágás, Jegyzet, Törlés, Mozgatás |
| **kijelölés** | a kiválasztott alkatrészek, hidak, vezetékek; az állapotsor mutatja |
| **nézet** | ugyanannak a tervnek egy megjelenítése: Panel, Program, Alkatrész-szerkesztő (saját alkatrész leírása; fül a nézetsávban) |
| **elrendezés** | a panelek kiinduló állapota egy munkához: Tervezés, Program, Szimuláció; a kézi módosítás elrendezésenként megmarad |
| **eszközsáv** | a vászon alján az eszközök sora (ikon és név); összecsukva csak az aktív eszköz látszik |
| **Panel beállításai** | a panel mérete és rézosztása (párbeszédablak) |
| **tulajdonságablak** | a kijelölés beállításai; lebeg a vászon fölött, vagy a jobb sávba rögzítve *Tulajdonságok* szakasz |
| **alsó panel** | a vászon alatti, összecsukható sáv: Problémák és Napló |
| **állapotsor** | a vászon alatti sor: rámutatott lyuk, eszköz, kijelölés, problémák, szimuláció |
| **Fájl menü** | új terv, megnyitás, mentés, példák, saját könyvtár export/import, JSON, téma |
