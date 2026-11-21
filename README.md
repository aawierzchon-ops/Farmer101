# Mapa dla rolnika – cała Polska

Mapa z qgis2web (OpenLayers) z działkami ewidencyjnymi i wyszukiwarką działek
+ automatycznie odświeżane warstwy analityczne.

| Folder | Co zawiera |
|---|---|
| `mapa/` | **eksport z qgis2web** (index.html, resources/, layers/, …) – podkłady, działki GUGiK KIEG, wyszukiwarka działek (`resources/parcel-search.js`) |
| `rolnik/` | dodatek do mapy: panel warstw, legenda, okienko po kliknięciu |
| `skrypty/` | pobieranie i liczenie danych (Landsat, ERA5-Land, gleba) i składanie strony |
| `.github/workflows/mapa.yml` | codzienne uruchamianie i publikacja na GitHub Pages |

## Warstwy (siatka ok. 500 m, EPSG:3857)

| Źródło | Warstwy | Odświeżanie |
|---|---|---|
| Landsat 8/9 C2 L2 (USGS, przez Planetary Computer) | NDVI, NDWI, NDDI, temperatura powierzchni | codziennie, najnowszy bezchmurny piksel z 90 dni, sceny < 10% chmur |
| ERA5-Land / ERA5 (Copernicus, przez Open-Meteo) | temperatura i wilgotność gleby 0–7 cm (ERA5-Land), opady 7 dni (ERA5) | codziennie (dane z ok. 5-dniowym opóźnieniem) |
| SoilGrids 2.0 (ISRIC) | typ gleby (USDA), porowatość | raz |
| Open-Meteo (w przeglądarce) | temperatura powierzchni teraz, prognoza 7 dni, gotowość do siewu | przy każdym kliknięciu |

## Test u siebie (opcjonalnie)

```
pip install -r requirements.txt
python skrypty/gleba_mapa.py --wyjscie _dane
python skrypty/landsat_mapa.py --wyjscie _dane
python skrypty/era5_mapa.py --wyjscie _dane
python skrypty/siatka.py --polacz _dane
python skrypty/zbuduj_strone.py --mapa mapa --dane _dane --wyjscie _site
cd _site && python -m http.server 8000
```
Potem otwórz http://localhost:8000 (nie przez dwuklik – przeglądarka blokuje wtedy wczytywanie danych).

Inne możliwości:

- `python skrypty/zbuduj_strone.py --jeden-plik` – dodatek i dane trafiają do środka `_site/index.html`,
  więc tę stronę **można otworzyć dwuklikiem** (plik ma ok. 11 MB).
- `pip install cryptography`, potem `python skrypty/serwer_https.py` – udostępnia `_site/` przez HTTPS (https://localhost:8443 i adres
  komputera w sieci), np. żeby otworzyć mapę na telefonie z działającym przyciskiem lokalizacji.
  Certyfikat tworzy się sam w `_certyfikat/` (nie trafia do repozytorium).
- `python skrypty/susza.py --demo` – osobna analiza prawdopodobieństwa suszy (ERA5-Land z Copernicus CDS),
  wymaga `pip install earthkit-data cdsapi xarray pandas` i klucza CDS; opis na początku pliku.

Foldery `_dane/`, `_cache_gleba/`, `_site/` powstają przy budowaniu i są w `.gitignore` –
na GitHubie dane pobiera i stronę składa workflow, więc nie trzeba ich wgrywać.

Dane: Landsat – USGS; ERA5-Land/ERA5 – Copernicus Climate Change Service / ECMWF; Open-Meteo (CC BY 4.0, użycie niekomercyjne);
SoilGrids – ISRIC (CC BY 4.0); działki – GUGiK (KIEG).
