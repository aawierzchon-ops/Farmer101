# Farm map – Poland

Interactive web map for farmers covering the whole of Poland. The base map is a
[qgis2web](https://github.com/qgis2web/qgis2web) export (OpenLayers) with cadastral parcels
(GUGiK KIEG) and parcel search. A custom **farmer add-on** adds analytical layers and point data:

| Group | Layers |
|---|---|
| Landsat 8/9 | NDVI, NDWI, NDDI (drought), land surface temperature – latest cloud-free pixel, scenes < 10 % cloud |
| ERA5-Land | soil temperature and moisture 0–7 cm (3-day mean), 7-day precipitation |
| Soil (SoilGrids) | USDA texture class, porosity (+ sand, clay, bulk density in the click popup) |

Clicking anywhere on the map shows the soil at that point and the current weather from Open-Meteo.
The map interface itself is in Polish.

## Repository layout

```
.
├── web/                    # the map – this folder is what you open / host
│   ├── index.html          # qgis2web export + add-on and data embedded (generated, ~11 MB)
│   ├── layers/layers.js    # base maps and parcel layer
│   ├── resources/          # OpenLayers, qgis2web libraries, parcel-search.js
│   └── webfonts/
├── addon/                  # farmer add-on source (copied into web/index.html)
│   ├── farmer.js
│   └── farmer.css
├── data/                   # latest data layers (8-bit PNG, EPSG:3857) + meta*.json
├── scripts/
│   ├── refresh_data.py     # download everything and rebuild web/index.html
│   ├── fetch_landsat.py    # NDVI, NDWI, NDDI, LST (Landsat C2 L2, Microsoft Planetary Computer)
│   ├── fetch_era5.py       # soil temperature/moisture, precipitation (ERA5-Land/ERA5 via Open-Meteo)
│   ├── fetch_soil.py       # soil texture and porosity (SoilGrids 2.0)
│   ├── grid.py             # shared map grid, PNG layer writer, meta.json merge
│   └── serve_https.py      # local HTTPS server for web/ (e.g. to open the map on a phone)
├── analysis/
│   ├── drought_probability.py   # stand-alone drought probability model (ERA5-Land via CDS/earthkit)
│   └── requirements.txt
└── requirements.txt        # for scripts/
```

## Viewing the map

Open `web/index.html` in a browser (double-click is enough – all data is embedded, no server needed;
base maps and live weather need an internet connection).

To open it from other devices in the same network, e.g. a phone (browsers allow the
"my location" button only over HTTPS):

```
pip install -r requirements.txt
python scripts/serve_https.py            # https://localhost:8443 and https://<computer-ip>:8443
```

The first run creates a self-signed certificate in `.certs/` (git-ignored). The browser will show a
"connection is not private" warning once per device – choose *Advanced → Proceed*.

## Refreshing the data

```
pip install -r requirements.txt
python scripts/refresh_data.py                 # new Landsat + ERA5 (soil only if missing)
python scripts/refresh_data.py --soil          # also recompute soil (rarely changes)
python scripts/refresh_data.py --inject-only   # after editing addon/farmer.js or .css – no downloads
```

Each run writes the layers to `data/` and embeds them, together with `addon/farmer.js` and
`addon/farmer.css`, into `web/index.html` between the `<!-- farmer add-on: start/end -->` markers.

Note: `web/` is a hand-modified qgis2web export (parcel layer in `layers/layers.js`, parcel search in
`resources/parcel-search.js` with its styles in `index.html`). A fresh export from QGIS would
overwrite these changes.

The individual steps can also be run on their own, e.g.
`python scripts/fetch_landsat.py --output data --max-cloud 10 --days 90`.

## Drought probability analysis

Separate from the map. Requires a [Copernicus CDS](https://cds.climate.copernicus.eu) account and
API key in `~/.cdsapirc`.

```
pip install -r analysis/requirements.txt
python analysis/drought_probability.py --demo                  # synthetic data, no download
python analysis/drought_probability.py --from-year 1995 --point 51.65 20.95
```

Results are saved to `analysis/output/` (git-ignored).

## Data sources

- Landsat 8/9 Collection 2 Level-2 – USGS, via Microsoft Planetary Computer
- ERA5-Land / ERA5 – Copernicus Climate Change Service / ECMWF, via [Open-Meteo](https://open-meteo.com) (CC BY 4.0)
- SoilGrids 2.0 – ISRIC (CC BY 4.0)
- Cadastral parcels – GUGiK, Krajowa Integracja Ewidencji Gruntów
- Base maps – OpenTopoMap (CC-BY-SA), Esri World Imagery
