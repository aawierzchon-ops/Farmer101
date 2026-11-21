/*
 * Dodatek „Rolnik” do mapy wyeksportowanej z qgis2web (OpenLayers lub Leaflet).
 *  - panel z warstwami analitycznymi (ERA5-Land, gleba) + legenda,
 *  - kliknięcie w dowolny punkt: gleba (z warstw) + aktualna temperatura i opady z Open-Meteo.
 * Warstwy to 8-bitowe PNG w EPSG:3857 opisane w dane/meta.json (tworzą je skrypty w skrypty/).
 */
(function () {
  'use strict';

  var BAZA = (document.currentScript && document.currentScript.src)
    ? document.currentScript.src.replace(/[^/]*$/, '') : 'rolnik/';
  var DANE = BAZA + 'dane/';
  var STREFA = 'Europe/Warsaw';
  var R = 6378137;
  // Dane wbudowane w index.html (window.ROLNIK_DANE = {meta: {...}, png: {id: 'data:image/png;base64,...'}})
  // - wtedy nie trzeba folderu rolnik/dane ani serwera; inaczej czytamy pliki z DANE.
  var WBUDOWANE = window.ROLNIK_DANE || null;


  var PALETY = {
    ndvi: ['#8c510a', '#d8b365', '#f6e8c3', '#c7e9a0', '#7fc97f', '#1a9641', '#00441b'],
    ndwi: ['#8c510a', '#dfc27d', '#f6f6f6', '#9ecae1', '#3182bd', '#08306b'],
    nddi: ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c', '#67000d'],
    temperatura: ['#313695', '#4575b4', '#74add1', '#e0f3f8', '#ffffbf', '#fee090', '#f46d43', '#a50026'],
    wilgotnosc: ['#8c510a', '#dfc27d', '#c7eae5', '#5ab4ac', '#01665e', '#003c30'],
    opady: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
    porowatosc: ['#fde725', '#7ad151', '#22a884', '#2a788e', '#414487', '#440154'],
    szara: ['#000000', '#ffffff'],
    kategorie_gleba: ['#fff7bc', '#fee391', '#fec44f', '#c2a45a', '#d9c7a0', '#e8dccb',
      '#d6604d', '#b2654a', '#a6761d', '#e7298a', '#9e6ab8', '#6a3d9a']
  };

  // ================================================================== narzędzia

  function hex(c) { return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)]; }

  function tablicaKolorow(w) {
    var lut = new Uint8ClampedArray(256 * 4), i, k;
    var pal = PALETY[w.paleta] || PALETY.szara;
    if (w.kategorie) {
      for (i = 1; i <= w.kategorie.length && i < 256; i++) {
        k = hex(pal[(i - 1) % pal.length]);
        lut.set([k[0], k[1], k[2], 255], i * 4);
      }
      return lut;
    }
    var stopy = pal.map(hex);
    for (i = 1; i < 256; i++) {
      var t = (i - 1) / 254 * (stopy.length - 1), j = Math.min(Math.floor(t), stopy.length - 2), f = t - j;
      lut.set([0, 1, 2].map(function (c) { return Math.round(stopy[j][c] + f * (stopy[j + 1][c] - stopy[j][c])); })
        .concat([255]), i * 4);
    }
    return lut;
  }

  function format(v, miejsca) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    return Number(v).toFixed(miejsca === undefined ? 2 : miejsca);
  }

  function doMerkatora(lon, lat) {
    return [lon * Math.PI / 180 * R, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * R];
  }

  // ================================================================== dane rastrowe

  var meta = null, warstwy = {};

  function wczytajWarstwe(w) {
    if (warstwy[w.id]) return warstwy[w.id].obietnica;
    var st = warstwy[w.id] = { meta: w };
    st.obietnica = new Promise(function (ok, blad) {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        var ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        var px = ctx.getImageData(0, 0, c.width, c.height);
        var q = new Uint8Array(c.width * c.height);
        for (var i = 0, n = q.length; i < n; i++) q[i] = px.data[i * 4];
        st.q = q; st.szer = c.width; st.wys = c.height; st.canvas = c; st.ctx = ctx; st.px = px;
        ok(st);
      };
      img.onerror = function () { blad(new Error('Nie można wczytać ' + w.plik)); };
      img.src = (WBUDOWANE && WBUDOWANE.png && WBUDOWANE.png[w.id]) ||
        (DANE + w.plik + '?v=' + encodeURIComponent(meta.wersja || ''));
    });
    return st.obietnica;
  }

  function obrazKolorowy(st) {
    if (st.url) return st.url;
    var lut = tablicaKolorow(st.meta), d = st.px.data, q = st.q;
    for (var i = 0, n = q.length; i < n; i++) {
      var o = q[i] * 4;
      d[i * 4] = lut[o]; d[i * 4 + 1] = lut[o + 1]; d[i * 4 + 2] = lut[o + 2]; d[i * 4 + 3] = lut[o + 3];
    }
    st.ctx.putImageData(st.px, 0, 0);
    st.url = st.canvas.toDataURL('image/png');
    st.px = null;
    return st.url;
  }

  function wartoscW(st, x, y) {      // x, y w EPSG:3857
    var s = meta.siatka;
    var kol = Math.floor((x - s.xmin) / s.piksel_m), wiersz = Math.floor((s.ymax - y) / s.piksel_m);
    if (kol < 0 || wiersz < 0 || kol >= st.szer || wiersz >= st.wys) return null;
    var q = st.q[wiersz * st.szer + kol];
    if (q === 0) return null;
    var w = st.meta;
    if (w.kategorie) return { tekst: w.kategorie[q - 1], kod: q };
    return { liczba: w.min + (q - 1) / 254 * (w.max - w.min) };
  }

  // ================================================================== adaptery map

  // OpenLayers (qgis2web: resources/qgis2web.js tworzy globalną zmienną `map`)
  function adapterOL(map) {
    var warstwaObrazu = null, nakladkaPopup = null, elPopup = null, elTresc = null;
    var s = meta.siatka;
    var zasieg = [s.xmin, s.ymin, s.xmax, s.ymax];
    function rzutMapy() { return map.getView().getProjection(); }
    return {
      nazwa: 'openlayers',
      dodajPanel: function (div) {
        div.classList.add('ol-unselectable', 'rolnik-ol');
        map.addControl(new ol.control.Control({ element: div }));
      },
      pokazObraz: function (url, przezr) {
        var zrodlo = new ol.source.ImageStatic({ url: url, imageExtent: zasieg, projection: 'EPSG:3857', interpolate: false });
        if (!warstwaObrazu) {
          // własność 'title' nieustawiona -> warstwa nie pojawia się w przełączniku warstw qgis2web
          warstwaObrazu = new ol.layer.Image({ source: zrodlo, opacity: przezr, zIndex: 50 });
          warstwaObrazu.set('interactive', false);
          map.addLayer(warstwaObrazu);
        } else {
          warstwaObrazu.setSource(zrodlo);
          warstwaObrazu.setOpacity(przezr);
          warstwaObrazu.setVisible(true);
        }
      },
      ukryjObraz: function () { if (warstwaObrazu) warstwaObrazu.setVisible(false); },
      ustawPrzezroczystosc: function (p) { if (warstwaObrazu) warstwaObrazu.setOpacity(p); },
      naKlikniecie: function (fn) {
        map.on('singleclick', function (evt) {
          // nie przeszkadzamy narzędziu pomiaru qgis2web
          try { if (typeof measuring !== 'undefined' && measuring) return; } catch (e) { /* brak */ }
          try { if (typeof sketch !== 'undefined' && sketch) return; } catch (e) { /* brak */ }
          var proj = rzutMapy();
          var ll = ol.proj.toLonLat(evt.coordinate, proj);
          var m = ol.proj.transform(evt.coordinate, proj, 'EPSG:3857');
          // czy pod kursorem jest obiekt z warstwy mapy (wtedy swoje okienko otworzy też qgis2web)
          var obiekt = false;
          try {
            obiekt = map.hasFeatureAtPixel(evt.pixel, {
              layerFilter: function (l) { return l.get('interactive') !== false; }
            });
          } catch (e) { /* brak */ }
          fn({ lat: ll[1], lng: ll[0], x: m[0], y: m[1], kotwica: evt.coordinate, obiekt: obiekt });
        });
      },
      otworzPopup: function (pkt, html) {
        // Mapa z wyszukiwarką działek (resources/parcel-search.js): jeden wspólny dymek –
        // dane rolnika dopisywane pod informacją o działce zamiast osobnego okienka.
        if (window.mapPopup && typeof window.mapPopup.setExtra === 'function') {
          var wspolny = function (h) { window.mapPopup.setExtra('<div class="rolnik-w-dymku">' + h + '</div>'); };
          wspolny(html);
          return { ustaw: wspolny };
        }
        if (!nakladkaPopup) {
          elPopup = document.createElement('div');
          elPopup.className = 'rolnik-ol-popup';
          elPopup.innerHTML = '<a href="#" class="rolnik-ol-zamknij" title="Zamknij">×</a><div class="rolnik-ol-tresc"></div>';
          elTresc = elPopup.querySelector('.rolnik-ol-tresc');
          nakladkaPopup = new ol.Overlay({ element: elPopup, positioning: 'bottom-center', offset: [0, -14],
            stopEvent: true, autoPan: { animation: { duration: 250 }, margin: 40 } });
          map.addOverlay(nakladkaPopup);
          elPopup.querySelector('.rolnik-ol-zamknij').onclick = function (e) {
            e.preventDefault(); nakladkaPopup.setPosition(undefined);
          };
        }
        // nad obiektem z mapy okienko qgis2web pokazuje się NAD punktem - nasze dajemy wtedy POD punktem
        var pod = !!pkt.obiekt;
        elPopup.classList.toggle('pod', pod);
        nakladkaPopup.setPositioning(pod ? 'top-center' : 'bottom-center');
        nakladkaPopup.setOffset(pod ? [0, 14] : [0, -14]);
        elTresc.innerHTML = html;
        nakladkaPopup.setPosition(pkt.kotwica);
        return {
          ustaw: function (h) {
            elTresc.innerHTML = h;
            nakladkaPopup.setPosition(undefined); nakladkaPopup.setPosition(pkt.kotwica); // ponowne dopasowanie widoku
          }
        };
      }
    };
  }

  // Leaflet (qgis2web: `var map = L.map(...)` w index.html)
  function adapterLeaflet(map) {
    var nakladka = null;
    var PUSTY = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    return {
      nazwa: 'leaflet',
      dodajPanel: function (div) {
        div.classList.add('leaflet-bar', 'rolnik-leaflet');
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        var Panel = L.Control.extend({ options: { position: 'topright' }, onAdd: function () { return div; } });
        new Panel().addTo(map);
      },
      pokazObraz: function (url, przezr) {
        if (!nakladka) nakladka = L.imageOverlay(PUSTY, meta.siatka.granice_wgs, { opacity: przezr, className: 'rolnik-warstwa' });
        nakladka.setUrl(url).setOpacity(przezr);
        if (!map.hasLayer(nakladka)) nakladka.addTo(map);
      },
      ukryjObraz: function () { if (nakladka) map.removeLayer(nakladka); },
      ustawPrzezroczystosc: function (p) { if (nakladka) nakladka.setOpacity(p); },
      naKlikniecie: function (fn) {
        map.on('click', function (e) {
          var p = L.CRS.EPSG3857.project(e.latlng);
          fn({ lat: e.latlng.lat, lng: e.latlng.lng, x: p.x, y: p.y, kotwica: e.latlng });
        });
      },
      otworzPopup: function (pkt, html) {
        var popup = L.popup({ maxWidth: 360, className: 'rolnik-popup', autoPanPaddingTopLeft: [10, 60] })
          .setLatLng(pkt.kotwica).setContent(html).openOn(map);
        return { ustaw: function (h) { popup.setContent(h); } };
      }
    };
  }

  // ================================================================== panel

  function zbudujPanel(A) {
    var div = document.createElement('div');
    div.className = 'rolnik-panel';
    var html = '<div class="rolnik-naglowek"><span>Detailed data</span>' +
      '<button type="button" class="rolnik-zwin" title="Collapse / expand">+</button></div>' +
      '<div class="rolnik-tresc">';
    var grupy = {};
    meta.warstwy.forEach(function (w) {
      if (!w.ukryta) (grupy[w.grupa] = grupy[w.grupa] || []).push(w);
    });
    var kolejnosc = ['Landsat', 'ERA5-Land', 'Gleba'];
    var poz = function (g) { var i = kolejnosc.indexOf(g); return i < 0 ? 99 : i; };
    Object.keys(grupy).sort(function (a, b) { return poz(a) - poz(b); }).forEach(function (g) {
      html += '<div class="rolnik-grupa">' + g + '</div>';
      grupy[g].forEach(function (w) {
        html += '<label class="rolnik-opcja"><input type="radio" name="rolnik-w" value="' + w.id + '"' +
          (w.pokrycie === 0 ? ' disabled' : '') + '> ' + w.nazwa + (w.pokrycie === 0 ? ' <i>(brak danych)</i>' : '') + '</label>';
      });
    });
    html += '<div class="rolnik-przezr">Transparency <input type="range" min="0.2" max="1" step="0.05" value="0.75"></div>' +
      '<div class="rolnik-legenda"></div>' +
      '<div class="rolnik-stopka">Kliknij w dowolne miejsce mapy, aby zobaczyć dane dla punktu.<br>' +
      'Dane: Landsat – USGS · ERA5-Land – Copernicus/ECMWF przez <a href="https://open-meteo.com" target="_blank">Open-Meteo</a> · ' +
      'Soil – SoilGrids/ISRIC</div></div>';
    div.innerHTML = html;
    var zwin = div.querySelector('.rolnik-zwin');
    div.classList.add('zwiniety');   // na starcie zwinięty, jak pozostałe panele
    zwin.onclick = function () { zwin.textContent = div.classList.toggle('zwiniety') ? '+' : '–'; };
    var suwak = div.querySelector('.rolnik-przezr input');
    // kliknięcie wybranej już warstwy odznacza ją (mapa bez warstwy analitycznej)
    div.querySelectorAll('input[name=rolnik-w]').forEach(function (r) {
      r.onclick = function () {
        if (aktywna === r.value) {
          r.checked = false;
          pokazWarstwe(A, '', div, +suwak.value);
        } else {
          pokazWarstwe(A, r.value, div, +suwak.value);
        }
      };
    });
    suwak.oninput = function () { A.ustawPrzezroczystosc(+suwak.value); };
    A.dodajPanel(div);
  }

  var aktywna = '';
  function pokazWarstwe(A, id, div, przezr) {
    aktywna = id;
    var leg = div.querySelector('.rolnik-legenda');
    if (!id) { A.ukryjObraz(); leg.innerHTML = ''; return; }
    var w = meta.warstwy.filter(function (x) { return x.id === id; })[0];
    // warstwa z osią czasu (opady dzienne) - suwak okresu; gdy brak archiwum, zwykła warstwa
    if (w.czas && !WBUDOWANE) { pokazOkres(A, w, div); return; }
    pokazStala(A, w, div, przezr);
  }

  function pokazStala(A, w, div, przezr, uwaga) {
    var id = w.id, leg = div.querySelector('.rolnik-legenda');
    leg.innerHTML = '<i>Wczytywanie…</i>';
    wczytajWarstwe(w).then(function (st) {
      if (aktywna !== id) return;          // użytkownik zdążył wybrać inną warstwę
      A.pokazObraz(obrazKolorowy(st), przezr);
      leg.innerHTML = (uwaga ? '<div class="rolnik-blad">' + uwaga + '</div>' : '') + legenda(w);
    }).catch(function (e) { leg.innerHTML = '<span class="rolnik-blad">' + e.message + '</span>'; });
  }

  // ================================================================== oś czasu: opady dzienne
  // Archiwum (skrypty/era5_mapa.py -> dane/opady_dzienne.json): dzienne opady ERA5 na siatce 0,25°,
  // uint16 w dziesiątych częściach mm (base64). W przeglądarce sumujemy wybrany okres, interpolujemy
  // dwuliniowo na siatkę mapy (EPSG:3857) i kolorujemy.

  var archiwa = {};
  function wczytajArchiwum(w) {
    if (archiwa[w.id]) return archiwa[w.id];
    archiwa[w.id] = fetch(DANE + w.czas.plik + '?v=' + encodeURIComponent(meta.wersja || ''))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (a) {
        var bin = atob(a.dane), n = bin.length >> 1, v = new Uint16Array(n), i;
        for (i = 0; i < n; i++) v[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
        a.v = v; a.n = a.nx * a.ny; delete a.dane;
        a.srednie = a.dni.map(function (_, d) {     // średni opad dzienny w kadrze (do wykresu)
          var s = 0, ile = 0, off = d * a.n;
          for (var k = 0; k < a.n; k++) { var x = v[off + k]; if (x !== a.brak) { s += x; ile++; } }
          return ile ? s * a.skala / ile : 0;
        });
        return a;
      });
    archiwa[w.id].catch(function () { delete archiwa[w.id]; });
    return archiwa[w.id];
  }

  function sumaOkresu(a, i0, i1) {
    var s = new Float32Array(a.n), ile = new Uint16Array(a.n), d, k;
    for (d = i0; d <= i1; d++) {
      var off = d * a.n;
      for (k = 0; k < a.n; k++) { var x = a.v[off + k]; if (x !== a.brak) { s[k] += x * a.skala; ile[k]++; } }
    }
    for (k = 0; k < a.n; k++) if (!ile[k]) s[k] = NaN;
    return s;
  }

  var LADNE = [2, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200, 250, 300, 400, 500, 750, 1000];
  function ladnaSkala(suma) {
    var x = Array.prototype.filter.call(suma, isFinite).sort(function (p, q) { return p - q; });
    var p98 = x.length ? x[Math.floor(0.98 * (x.length - 1))] : 10;
    for (var i = 0; i < LADNE.length; i++) if (LADNE[i] >= p98) return LADNE[i];
    return LADNE[LADNE.length - 1];
  }

  function obrazOkresu(a, suma, vmax, w) {
    var s = meta.siatka, W = s.szer, H = s.wys, c, r;
    if (!a.fi) {
      a.fi = new Float32Array(W); a.fj = new Float32Array(H);
      for (c = 0; c < W; c++) a.fi[c] = ((s.xmin + (c + 0.5) * s.piksel_m) / R * 180 / Math.PI - a.lon0) / a.krok;
      for (r = 0; r < H; r++) {
        var y = s.ymax - (r + 0.5) * s.piksel_m;
        a.fj[r] = (a.lat0 - (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI) / a.krok;
      }
      a.canvas = document.createElement('canvas'); a.canvas.width = W; a.canvas.height = H;
      a.ctx = a.canvas.getContext('2d'); a.obraz = a.ctx.createImageData(W, H);
    }
    var lut = tablicaKolorow({ paleta: w.paleta }), d = a.obraz.data, nx = a.nx, ny = a.ny;
    for (r = 0; r < H; r++) {
      var fj = a.fj[r], j0 = Math.min(Math.max(Math.floor(fj), 0), ny - 2), fy = Math.min(Math.max(fj - j0, 0), 1);
      for (c = 0; c < W; c++) {
        var fi = a.fi[c], i0 = Math.min(Math.max(Math.floor(fi), 0), nx - 2), fx = Math.min(Math.max(fi - i0, 0), 1);
        var k = j0 * nx + i0;
        var v = (suma[k] * (1 - fx) + suma[k + 1] * fx) * (1 - fy) + (suma[k + nx] * (1 - fx) + suma[k + nx + 1] * fx) * fy;
        var o = (r * W + c) * 4;
        if (v !== v) { d[o + 3] = 0; continue; }       // NaN - brak danych
        var q = (1 + Math.round(Math.min(Math.max(v / vmax, 0), 1) * 254)) * 4;
        d[o] = lut[q]; d[o + 1] = lut[q + 1]; d[o + 2] = lut[q + 2]; d[o + 3] = 255;
      }
    }
    a.ctx.putImageData(a.obraz, 0, 0);
    return a.canvas.toDataURL('image/png');
  }

  function ileDni(n) { return n + (n === 1 ? ' day' : ' days'); }

  function pokazOkres(A, w, div) {
    var leg = div.querySelector('.rolnik-legenda');
    leg.innerHTML = '<i>Loading…</i>';
    wczytajArchiwum(w).then(function (a) {
      if (aktywna !== w.id) return;
      var n = a.dni.length;
      var i1 = n - 1, i0 = Math.max(0, n - (w.czas.domyslnie_dni || 7));
      leg.innerHTML =
        '<div class="rolnik-czas">' +
        '<div class="rolnik-czas-okres"></div>' +
        '<canvas class="rolnik-czas-wykres" width="250" height="46" title="Drag to select a period"></canvas>' +
        '<label class="rolnik-czas-suwak"><span>From</span><input type="range" class="rolnik-czas-od" min="0" step="1"></label>' +
        '<label class="rolnik-czas-suwak"><span>To</span><input type="range" class="rolnik-czas-do" min="0" step="1"></label>' +
        '<div class="rolnik-czas-przyciski">' +
        [1, 7, 14, 30].filter(function (k) { return k < n; }).map(function (k) {
          return '<button type="button" data-dni="' + k + '">' + ileDni(k) + '</button>';
        }).join('') + '<button type="button" data-dni="' + n + '">All</button></div>' +
        '</div><div class="rolnik-czas-leg"></div>';
      var od = leg.querySelector('.rolnik-czas-od'), doo = leg.querySelector('.rolnik-czas-do');
      var opis = leg.querySelector('.rolnik-czas-okres'), wyk = leg.querySelector('.rolnik-czas-wykres');
      var legDol = leg.querySelector('.rolnik-czas-leg');
      od.max = doo.max = n - 1;
      var zegar = null;

      function wykres() {
        var g = wyk.getContext('2d'), Wd = wyk.width, Hd = wyk.height, maks = Math.max.apply(null, a.srednie) || 1;
        var bw = Wd / n;
        g.clearRect(0, 0, Wd, Hd);
        g.fillStyle = 'rgba(46,94,42,.12)';
        g.fillRect(i0 * bw, 0, (i1 - i0 + 1) * bw, Hd);
        for (var d = 0; d < n; d++) {
          var h = Math.max(1, a.srednie[d] / maks * (Hd - 4)), odstep = bw > 3 ? 0.5 : 0;
          g.fillStyle = (d >= i0 && d <= i1) ? '#2171b5' : '#c6dbef';
          g.fillRect(d * bw + odstep, Hd - h, Math.max(1, bw - 2 * odstep), h);
        }
      }

      function rysuj(natychmiast) {
        od.value = i0; doo.value = i1;
        opis.innerHTML = '<b>' + a.dni[i0] + (i1 > i0 ? ' – ' + a.dni[i1] : '') + '</b> (' + ileDni(i1 - i0 + 1) + ')';
        wykres();
        clearTimeout(zegar);
        zegar = setTimeout(function () {
          if (aktywna !== w.id) return;
          var suma = sumaOkresu(a, i0, i1), vmax = ladnaSkala(suma);
          A.pokazObraz(obrazOkresu(a, suma, vmax, w), +div.querySelector('.rolnik-przezr input').value);
          var pal = PALETY[w.paleta] || PALETY.szara;
          legDol.innerHTML = '<div class="rolnik-leg-tytul">Precipitation total [mm]</div>' +
            '<div class="rolnik-pasek" style="background:linear-gradient(to right,' + pal.join(',') + ')"></div>' +
            '<div class="rolnik-skala"><span>0</span><span>' + format(vmax / 2, vmax < 10 ? 1 : 0) + '</span><span>' +
            format(vmax, 0) + '+</span></div>' +
            '<div class="rolnik-data">ERA5 (Copernicus) via Open-Meteo, daily data ' + a.dni[0] + ' – ' + a.dni[n - 1] + '</div>';
        }, natychmiast ? 0 : 150);
      }

      od.oninput = function () { i0 = +od.value; if (i0 > i1) i1 = i0; rysuj(); };
      doo.oninput = function () { i1 = +doo.value; if (i1 < i0) i0 = i1; rysuj(); };
      leg.querySelectorAll('.rolnik-czas-przyciski button').forEach(function (b) {
        b.onclick = function () {
          var k = +b.getAttribute('data-dni');
          if (k >= n) { i0 = 0; i1 = n - 1; } else { i0 = Math.max(0, i1 - k + 1); }
          rysuj();
        };
      });

      // zaznaczanie przedziału przeciągnięciem po wykresie
      var kotwica = null;
      function dzienZ(e) {
        var b = wyk.getBoundingClientRect();
        return Math.min(n - 1, Math.max(0, Math.floor((e.clientX - b.left) / b.width * n)));
      }
      wyk.addEventListener('pointerdown', function (e) {
        kotwica = dzienZ(e); i0 = i1 = kotwica;
        try { wyk.setPointerCapture(e.pointerId); } catch (x) { /* brak */ }
        rysuj(); e.preventDefault();
      });
      wyk.addEventListener('pointermove', function (e) {
        if (kotwica === null) return;
        var d = dzienZ(e); i0 = Math.min(kotwica, d); i1 = Math.max(kotwica, d); rysuj();
      });
      wyk.addEventListener('pointerup', function () { kotwica = null; });
      wyk.addEventListener('pointercancel', function () { kotwica = null; });

      rysuj(true);
    }).catch(function (e) {
      if (aktywna !== w.id) return;
      pokazStala(A, w, div, +div.querySelector('.rolnik-przezr input').value,
        'Daily data unavailable (' + e.message + ') – showing the last 7 days.');
    });
  }

  function legenda(w) {
    var pal = PALETY[w.paleta] || PALETY.szara;
    var h = '<div class="rolnik-leg-tytul">' + w.nazwa + (w.jednostka ? ' [' + w.jednostka + ']' : '') + '</div>';
    if (w.kategorie) {
      h += w.kategorie.map(function (k, i) {
        return '<div class="rolnik-kat"><span style="background:' + pal[i % pal.length] + '"></span>' + k + '</div>';
      }).join('');
    } else {
      h += '<div class="rolnik-pasek" style="background:linear-gradient(to right,' + pal.join(',') + ')"></div>' +
        '<div class="rolnik-skala"><span>' + format(w.min, w.miejsca) + '</span><span>' +
        format((w.min + w.max) / 2, w.miejsca) + '</span><span>' + format(w.max, w.miejsca) + '</span></div>';
    }
    if (w.opis) h += '<div class="rolnik-opis">' + w.opis + '</div>';
    if (w.data) h += '<div class="rolnik-data">' + w.data + '</div>';
    return h;
  }

  // ================================================================== okienko po kliknięciu
  // Pokazuje tylko: glebę (z warstw mapy) oraz aktualną temperaturę i opady (Open-Meteo, na żywo).

  function pobierz(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('Open-Meteo ' + r.status + ': ' + t.slice(0, 120)); });
      return r.json();
    });
  }

  function pogodaTeraz(pkt) {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + pkt.lat.toFixed(4) + '&longitude=' + pkt.lng.toFixed(4) +
      '&current=temperature_2m,precipitation&daily=precipitation_sum&past_days=7&forecast_days=1' +
      '&timezone=' + encodeURIComponent(STREFA);
    return pobierz(url).then(function (d) {
      var opady = (d.daily && d.daily.precipitation_sum) || [];
      var suma7 = 0, ile = 0;
      opady.slice(0, -1).forEach(function (v) { if (v !== null && v !== undefined) { suma7 += v; ile++; } });
      return {
        czas: d.current && d.current.time ? d.current.time.replace('T', ' ') : null,
        temp: d.current ? d.current.temperature_2m : null,
        opadTeraz: d.current ? d.current.precipitation : null,
        opadDzis: opady.length ? opady[opady.length - 1] : null,
        opad7: ile ? suma7 : null
      };
    });
  }

  function htmlPogoda(o) {
    return '<div class="rolnik-sekcja">Weather now' + (o.czas ? ' <small>(' + o.czas + ')</small>' : '') + '</div>' +
      '<table class="rolnik-tab">' +
      '<tr><td>Air temperature</td><td><b>' + format(o.temp, 1) + ' °C</b></td></tr>' +
      '<tr><td>Precipitation right now</td><td>' + format(o.opadTeraz, 1) + ' mm</td></tr>' +
      '<tr><td>Precipitation today (incl. forecast to end of day)</td><td>' + format(o.opadDzis, 1) + ' mm</td></tr>' +
      '<tr><td>Precipitation – last 7 days</td><td>' + format(o.opad7, 1) + ' mm</td></tr></table>';
  }

  function htmlGleba(wart) {
    function wiersz(id, etykieta) {
      var w = wart[id];
      if (!w) return '';
      var m = w.meta, v = w.v;
      var tekst = !v ? '–' : (v.tekst !== undefined ? (KLASY_EN[v.tekst] || v.tekst) : format(v.liczba, m.miejsca) + (m.jednostka ? ' ' + m.jednostka : ''));
      return '<tr><td>' + (etykieta || m.nazwa) + '</td><td>' + tekst + '</td></tr>';
    }
    if (!meta.zrodla.gleba) return '';
    var p = wart.piasek && wart.piasek.v, i = wart.il && wart.il.v;
    return '<div class="rolnik-sekcja">Soil (SoilGrids, 0–30 cm)</div><table class="rolnik-tab">' +
      wiersz('gleba_klasa', 'Soil type') + wiersz('porowatosc', 'Porosity') +
      (p && i ? '<tr><td>Sand / silt / clay</td><td>' + Math.round(p.liczba) + ' / ' +
        Math.max(0, Math.round(100 - p.liczba - i.liczba)) + ' / ' + Math.round(i.liczba) + ' %</td></tr>' : '') +
      wiersz('gestosc', 'Bulk density') + '</table>';
  }

  // klasy uziarnienia USDA – angielskie nazwy do dymka (w danych są po polsku)
  var KLASY_EN = { 'piasek': 'sand', 'piasek gliniasty': 'loamy sand', 'glina piaszczysta': 'sandy loam', 'glina': 'loam',
    'pył gliniasty': 'silt loam', 'pył': 'silt', 'glina piaszczysto-ilasta': 'sandy clay loam', 'glina ilasta': 'clay loam',
    'glina pylasto-ilasta': 'silty clay loam', 'ił piaszczysty': 'sandy clay', 'ił pylasty': 'silty clay', 'ił': 'clay' };

  var WARSTWY_GLEBY = ['gleba_klasa', 'porowatosc', 'piasek', 'il', 'gestosc'];

  function poKliknieciu(A, pkt) {
    var okno = A.otworzPopup(pkt, '<div class="rolnik-okno"><i>Loading data…</i></div>');
    var wart = {};
    var czesc1 = '', czesc2 = '<div class="rolnik-sekcja">Weather now</div><i>Loading…</i>';
    function odswiez() { okno.ustaw('<div class="rolnik-okno">' + czesc1 + czesc2 + '</div>'); }
    Promise.all(meta.warstwy.filter(function (w) {
      return w.pokrycie > 0 && WARSTWY_GLEBY.indexOf(w.id) >= 0;
    }).map(function (w) {
      return wczytajWarstwe(w).then(function (st) { wart[w.id] = { meta: w, v: wartoscW(st, pkt.x, pkt.y) }; })
        .catch(function () { wart[w.id] = { meta: w, v: null }; });
    })).then(function () { czesc1 = htmlGleba(wart); odswiez(); });
    pogodaTeraz(pkt).then(function (o) { czesc2 = htmlPogoda(o); odswiez(); })
      .catch(function (err) { czesc2 = '<div class="rolnik-blad">Could not load the weather: ' + err.message + '</div>'; odswiez(); });
  }

  // ================================================================== start

  function znajdzMape() {
    var kandydat = null;
    try { if (typeof map !== 'undefined') kandydat = map; } catch (e) { /* brak zmiennej */ }
    var jestOL = function (m) { return window.ol && ol.Map && m instanceof ol.Map; };
    var jestL = function (m) { return window.L && L.Map && m instanceof L.Map; };
    if (kandydat && jestOL(kandydat)) return adapterOL(kandydat);
    if (kandydat && jestL(kandydat)) return adapterLeaflet(kandydat);
    for (var k in window) {
      try {
        if (jestOL(window[k])) return adapterOL(window[k]);
        if (jestL(window[k])) return adapterLeaflet(window[k]);
      } catch (e) { /* pomijamy */ }
    }
    return null;
  }

  function start() {
    var zrodloMeta = (WBUDOWANE && WBUDOWANE.meta) ? Promise.resolve(WBUDOWANE.meta)
      : fetch(DANE + 'meta.json', { cache: 'no-cache' }).then(function (r) { return r.json(); });
    zrodloMeta.then(function (m) {
      meta = m;
      var A = znajdzMape();
      if (!A) { console.error('Rolnik: nie znaleziono mapy OpenLayers ani Leaflet.'); return; }
      zbudujPanel(A);
      A.naKlikniecie(function (pkt) { poKliknieciu(A, pkt); });
      document.documentElement.setAttribute('data-rolnik', A.nazwa);
    }).catch(function (e) { console.error('Rolnik: brak danych (rolnik/dane/meta.json)', e); });
  }

  (function czekaj(proby) {
    var gotowe = false;
    try { gotowe = typeof map !== 'undefined' && !!map; } catch (e) { /* brak */ }
    if (gotowe || proby > 100) return start();
    setTimeout(function () { czekaj(proby + 1); }, 100);
  })(0);
})();
