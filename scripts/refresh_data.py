"""
Odświeża dane dodatku „rolnik” i wbudowuje je w web/index.html (mapa qgis2web).

Uruchamia skrypty z scripts/ (Landsat 8/9, ERA5-Land/ERA5, gleba SoilGrids),
łączy opisy warstw w data/meta.json, a potem wstawia do web/index.html jeden blok
(między znacznikami <!-- farmer add-on: start/end -->) zawierający:
  - style  addon/farmer.css,
  - dane   (meta.json + warstwy PNG jako data:image/png;base64) w window.ROLNIK_DANE,
  - skrypt addon/farmer.js.
Mapa nie potrzebuje więc osobnych plików z danymi – wszystko jest w index.html.

  python scripts/refresh_data.py                 # Landsat + ERA5 (gleba tylko, gdy jej brak)
  python scripts/refresh_data.py --soil          # także przelicz glebę (zmienia się rzadko)
  python scripts/refresh_data.py --inject-only   # bez pobierania, tylko wstaw data/ do index.html
"""
import argparse
import base64
import json
import os
import re
import subprocess
import sys

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPTS)
ADDON = os.path.join(ROOT, "addon")   # farmer.js, farmer.css
DATA = os.path.join(ROOT, "data")     # warstwy PNG + meta*.json
WEB = os.path.join(ROOT, "web")       # eksport qgis2web (index.html)

START = "<!-- farmer add-on: start -->"
END = "<!-- farmer add-on: end -->"
AFTER_SCRIPT = '<script src="./resources/parcel-search.js"></script>'


def run(script, *args):
    print(f"\n=== {script} {' '.join(args)}")
    subprocess.run([sys.executable, os.path.join(SCRIPTS, script), *args], check=True,
                   env={**os.environ, "PYTHONIOENCODING": "utf-8"})


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def safe_script(text):
    """Treść do <script>/<style> w HTML – nie może zawierać zamykającego znacznika."""
    return re.sub(r"</(script|style)", r"<\\/\1", text, flags=re.I)


def html_block():
    meta = json.loads(read(os.path.join(DATA, "meta.json")))
    png = {}
    for w in meta["warstwy"]:
        path = os.path.join(DATA, w["plik"])
        if os.path.exists(path):
            with open(path, "rb") as f:
                png[w["id"]] = "data:image/png;base64," + base64.b64encode(f.read()).decode("ascii")
    data = json.dumps({"meta": meta, "png": png}, ensure_ascii=False, separators=(",", ":"))
    return (f"{START}\n"
            f"        <style>\n{read(os.path.join(ADDON, 'farmer.css'))}\n        </style>\n"
            f"        <script>window.ROLNIK_DANE = {safe_script(data)};</script>\n"
            f"        <script>\n{safe_script(read(os.path.join(ADDON, 'farmer.js')))}\n        </script>\n"
            f"        {END}"), len(png)


def inject_into_index(web_dir):
    index = os.path.join(web_dir, "index.html")
    html = read(index)
    block, count = html_block()
    if START in html and END in html:
        a = html.index(START)
        b = html.index(END) + len(END)
        html = html[:a] + block + html[b:]
    elif AFTER_SCRIPT in html:
        html = html.replace(AFTER_SCRIPT, AFTER_SCRIPT + "\n        " + block, 1)
    elif "</body>" in html:
        # świeży eksport z qgis2web (bez wyszukiwarki działek) - dodatek na końcu strony
        html = html.replace("</body>", "        " + block + "\n    </body>", 1)
    else:
        sys.exit(f"W {index} nie ma znaczników dodatku ani </body> – nie wiem, gdzie go wstawić.")
    with open(index, "w", encoding="utf-8", newline="") as f:
        f.write(html)
    print(f"\nWstawiono dodatek i {count} warstw do {index} ({os.path.getsize(index) / 1e6:.1f} MB)")


def main():
    p = argparse.ArgumentParser(description="Pobiera dane dla dodatku „rolnik” i wstawia je do mapy.")
    p.add_argument("--soil", action="store_true", help="przelicz także glebę")
    p.add_argument("--inject-only", action="store_true", help="nie pobieraj, tylko wstaw data/ do index.html")
    p.add_argument("--web-dir", default=WEB, help="folder eksportu qgis2web (domyślnie web/)")
    a = p.parse_args()

    if not a.inject_only:
        if a.soil or not os.path.exists(os.path.join(DATA, "meta_soil.json")):
            run("fetch_soil.py", "--output", DATA)
        run("fetch_era5.py", "--output", DATA)
        run("fetch_landsat.py", "--output", DATA, "--max-cloud", "10", "--days", "90")
    run("grid.py", "--merge", DATA)
    inject_into_index(a.web_dir)


if __name__ == "__main__":
    main()
