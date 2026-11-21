# Mapa dla rolnika

Mapa: **https://aawierzchon-ops.github.io/Farmer101/**

Cały projekt jest w folderze `mapa Qgis/`:

| Co | Do czego |
|---|---|
| `index.html`, `layers/`, `resources/`, `webfonts/` | mapa z qgis2web: wyszukiwarka adresów i działek (ULDK GUGiK), warstwa działek KIEG, panel „Analiza dla rolnika” (NDVI, NDWI, NDDI, temperatura i wilgotność gleby, opady, typ gleby, porowatość), dymek po kliknięciu: działka, gleba, aktualna temperatura i opady |
| `dodatek_rolnik/` | kod panelu (`rolnik/`), skrypty pobierające dane (`skrypty/`), ostatnie dane (`_dane/`), `requirements.txt` |
| `odswiez_dane_rolnik.py` | pobiera nowe dane i wbudowuje je w `index.html` |
| `serwer_https.py` | podgląd mapy lokalnie przez HTTPS |
| `testy.py` | prawdopodobieństwo suszy rolniczej z ERA5-Land (earthkit) |

Strona publikuje się sama (GitHub Actions, `.github/workflows/mapa.yml`): po każdej zmianie w `mapa Qgis/`
oraz codziennie ok. 4:37 – wtedy z nowymi danymi Landsat 8/9 i ERA5. Ręcznie: zakładka **Actions** → **Run workflow**.

Dane: Landsat – USGS; ERA5-Land/ERA5 – Copernicus/ECMWF przez Open-Meteo (CC BY 4.0); SoilGrids – ISRIC (CC BY 4.0);
działki – GUGiK (ULDK, KIEG); adresy – © OpenStreetMap (Nominatim).
