# Etykiety kurierskie → 100 × 150 mm

Wrzucasz PDF-y z etykietami z Vinted (albo podobnej platformy), aplikacja
przycina, obraca i skaluje każdą etykietę na stronę 100 × 150 mm i oddaje
jeden scalony plik do druku.

Wyjście zostaje wektorowe — strony źródłowe są osadzane przez `embedPage()`,
nigdy rasteryzowane, więc kody kreskowe nie miękną.

## Uruchomienie

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # 61 testów, kryteria odbioru 1–10
npm run fixtures     # przebudowa katalogu fixtures/
```

## Deploy na Vercel

Projekt jest gotowy do `vercel deploy` bez dodatkowej konfiguracji. Oba
handlery mają `runtime = "nodejs"` i `maxDuration = 60`; pdfium jest czystym
WASM-em, więc nie ma natywnych zależności do zbudowania.

Jedyna zmienna środowiskowa to `BLOB_READ_WRITE_TOKEN` (dodawana automatycznie
po podpięciu Vercel Blob w zakładce Storage). Bez niej aplikacja nadal działa —
frontend wykrywa brak przechowalni i wysyła pliki zwykłym `multipart/form-data`,
co wystarcza do ok. 4,5 MB na żądanie. Przy trzydziestu etykietach limit ciała
funkcji zostaje przekroczony, dlatego produkcyjnie Blob jest potrzebny.

## Jak to działa

Cały pipeline to kilkadziesiąt linii analizy obrazu — bez OpenCV, bez sharp,
bez `canvas`. pdfium oddaje surową bitmapę, reszta to arytmetyka na
`Uint8Array`.

| Krok | Plik | Co robi |
| --- | --- | --- |
| 1 | `lib/raster.ts` | rasteryzacja 150 DPI w skali szarości (pdfium/WASM) |
| 2 | `lib/mask.ts` | maska tuszu: piksel to tusz gdy jasność < 200 |
| 3 | `lib/mask.ts` | odcięcie nazwy oferty doklejonej nad etykietą |
| 4 | `lib/mask.ts` | segmentacja kolumn, odrzucenie pasków instrukcji, wybór lewej kopii |
| 5 | `lib/mask.ts` | dylatacja 0,5″, spójne obszary, wybór bloku etykiety |
| 6 | `lib/mask.ts` | ścieżki awaryjne: etykieta rozstrzelona i dwie kopie jedna pod drugą |
| 7 | `lib/analyze.ts` | linie wewnętrzne i podział etykiet dwuczęściowych |
| 8 | `lib/text.ts` | orientacja z macierzy transformacji warstwy tekstowej |
| 9 | `lib/text.ts` | nazwa produktu, filtrowana po foncie i rozmiarze |
| 10 | `lib/generate.ts` | złożenie strony 283,465 × 425,197 pt, margines adaptacyjny, nagłówek |

Progi są podane w calach × DPI, więc zmiana rozdzielczości rasteryzacji niczego
nie psuje.

### Trzy miejsca, w których łatwo się pomylić

**Wybór bloku etykiety idzie po liczbie pikseli tuszu, nie po polu bounding
boxa.** Na arkuszach GLS blok instrukcji jest wyższy i szerszy od etykiety, więc
kryterium pola wybiera błędny obszar. Etykieta wygrywa gęstością — ma kody
kreskowe, QR i czarne belki.

**Nazwa oferty jest odcinana dwa razy.** Krok 3 zeruje wąski pas z góry strony,
ale dwuwierszowa nazwa tworzy pas o wysokości ~0,41 cala i tego progu nie
złapie. Dlatego krok 9 liczy dolną krawędź nazwy niezależnie, z warstwy
tekstowej, i ta krawędź jest twardym ogranicznikiem kadru (`clearAbove`).
Bez tego nazwa wydrukowałaby się dwa razy — test `kryterium 9` tego pilnuje.

**Przestrzeń obrazu ma oś Y w dół, przestrzeń PDF w górę.** Pole `rotate` to
obrót zgodnie z ruchem wskazówek zegara, a `pdf-lib` liczy stopnie
przeciwnie — konwersja siedzi w `pdfLibAngle()` i `placement()`. Test
`kryterium 4` renderuje gotowe strony z powrotem i sprawdza, że dominujący kąt
tekstu wynosi 0°, więc żadna etykieta nie wyjdzie do góry nogami.

### Margines adaptacyjny

Domyślnie 1,5 mm. Etykiety w ramce (InPost, Orlen, GLS, DPD) mają własny biały
zapas wewnątrz obramowania, więc przy krawędzi naklejki jest tylko cienka
kreska. Etykiety bez ramki (Poczta Polska) mają kod kreskowy dosłownie na skraju
kadru — takie strony dostają flagę `sparse` i margines 6 mm, żeby przesunięcie
rolki w drukarce nie przycięło kodu.

## Katalog `fixtures/`

Osiem syntetycznych arkuszy odtwarzających układy, na których pipeline był
walidowany: etykieta w ramce, arkusz GLS z większym blokiem instrukcji,
frameless Poczta Polska, dwie kopie obok siebie, arkusz zagraniczny
InPost + Zásilkovna, etykieta położona bokiem, strona z kodem QR do automatu
i arkusz z dwuwierszową nazwą oferty.

Fixtures są generowane deterministycznie (`npm run fixtures`) i nie zawierają
żadnych prawdziwych danych osobowych.

## Prywatność

Etykiety zawierają imiona, nazwiska, adresy i numery telefonów odbiorców, czyli
dane osobowe osób trzecich.

* pliki są przetwarzane wyłącznie w pamięci, nic nie ląduje na dysku,
* obiekty w Vercel Blob mają krótki TTL i są kasowane natychmiast po zbudowaniu
  wyniku (`discardBlobs`), a także przy usunięciu pliku z kolejki,
* logi zawierają tylko liczby stron i czasy — nigdy treści, nazw ani adresów,
* nie ma żadnej analityki zdarzeń z zawartości plików,
* nie ma bazy, logowania ani historii konwersji.

## Znane ograniczenia

* Słownik w `lib/diacritics.ts` jest heurystyczny — podmienia całe słowa i
  czasem trafi źle, dlatego każda nazwa jest edytowalna w interfejsie przed
  generowaniem.
* Przewoźnik jest rozpoznawany wyłącznie z warstwy tekstowej. Etykieta bez
  warstwy tekstowej (skan) da poprawny kadr, ale bez nazwy produktu, bez
  przewoźnika i z obniżoną pewnością orientacji.
