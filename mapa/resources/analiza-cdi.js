/*
 * Panel „Final analysis”: zaznaczanie działek do analizy i obliczanie wskaźnika suszy CDI.
 *
 * 1. „Select parcels” włącza tryb zaznaczania – kliknięcie mapy dodaje działkę (ULDK GUGiK),
 *    kliknięcie zaznaczonej działki ją usuwa. Można zaznaczyć jedną lub więcej działek.
 * 2. Dla każdej dodanej działki od razu pobierane są dane:
 *    - NDDI – Sentinel-2 L2A (10 m) z Microsoft Planetary Computer, statystyki liczone w obrysie działki,
 *      sceny z ostatnich NDDI_DNI dni z ≥ 80% czystych pikseli (maska SCL); średnia z median scen,
 *    - opady dzienne i wilgotność gleby 0–100 cm (ERA5 / ERA5-Land przez Open-Meteo) od 1991 r.
 *      dla środka działki -> SPI-1 (30 dni), SPI-3 (90 dni) i SMA (anomalia wilgotności, 10 dni).
 * 3. „Calculate CDI” liczy wskaźnik dla każdej działki i dla całego obszaru (średnie ważone powierzchnią).
 *
 * CDI wg schematu European Drought Observatory (Sepulcre-Canto i in., 2012), z NDDI zamiast anomalii fAPAR:
 *   Watch   – SPI-3 < -1 lub SPI-1 < -2
 *   Warning – Watch i SMA < -1
 *   Alert   – Warning i NDDI ≥ NDDI_PROG (stres roślin)
 * Próg NDDI jest umowny (NDDI nie ma ustalonej normy) – można go zmienić niżej.
 */
(function () {
  'use strict';
  if (typeof map === 'undefined' || !window.ol) return;

  var NDDI_DNI = 60, NDDI_MAKS_SCEN = 8, NDDI_CZYSTE = 0.8, NDDI_PROG = 0.5;
  var OD_ROKU = 1991, SMA_DNI = 10;
  var PC = 'https://planetarycomputer.microsoft.com/api';
  var OPEN_METEO = 'https://archive-api.open-meteo.com/v1/archive';
  var POZIOMY = [
    { nazwa: 'No drought', kolor: '#2e7d32' },
    { nazwa: 'Watch', kolor: '#f9a825' },
    { nazwa: 'Warning', kolor: '#ef6c00' },
    { nazwa: 'Alert', kolor: '#c62828' }
  ];

  var stan = { zaznaczanie: false, dzialki: [] };
  window.analizaCDI = stan;   // parcel-search.js i rolnik.js nie otwierają dymka, gdy zaznaczanie jest włączone

  // ------------------------------------------------------------------ style
  var css = document.createElement('style');
  css.textContent =
    '.cdi-przyciski{display:flex;gap:6px;margin:2px 0 6px}' +
    '.cdi-przyciski button,.cdi-oblicz{font:600 12px system-ui,sans-serif;padding:4px 8px;border-radius:4px;cursor:pointer;' +
    'border:1px solid #2e5e2a;background:#fff;color:#2e5e2a}' +
    '.cdi-przyciski button.aktywny,.cdi-oblicz{background:#2e5e2a;color:#fff}' +
    '.cdi-oblicz{width:100%;margin-top:6px;padding:6px}.cdi-oblicz:disabled{opacity:.45;cursor:default}' +
    '.cdi-pomoc{font-size:11px;color:#666;margin-bottom:4px}' +
    '.cdi-lista{list-style:none;margin:0;padding:0;font-size:12px}' +
    '.cdi-lista li{display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid #eee}' +
    '.cdi-lista .cdi-nazwa{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.cdi-lista .cdi-status{font-size:11px;color:#888;white-space:nowrap}' +
    '.cdi-lista button{border:0;background:none;color:#999;cursor:pointer;font-size:15px;padding:0 2px;line-height:1}' +
    '.cdi-wynik{margin-top:8px;font-size:12px}' +
    '.cdi-poziom{color:#fff;border-radius:4px;padding:6px 8px;font-weight:700;font-size:14px;margin-bottom:6px}' +
    '.cdi-poziom small{display:block;font-weight:400;font-size:11px;opacity:.9}' +
    '.cdi-tab{width:100%;border-collapse:collapse;font-size:11.5px}' +
    '.cdi-tab td,.cdi-tab th{padding:2px 3px;border-bottom:1px solid #f0f0f0;text-align:right;min-width:0;white-space:nowrap}' +
    '.cdi-tab td:first-child,.cdi-tab th:first-child{text-align:left}' +
    '.cdi-tab th{color:#666;font-weight:500}' +
    '.cdi-kropka{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px;vertical-align:middle}' +
    '.cdi-uwaga{font-size:11px;color:#666;margin-top:6px}' +
    '.cdi-zaznaczanie .ol-viewport{cursor:copy}';
  document.head.appendChild(css);

  // ------------------------------------------------------------------ warstwa zaznaczonych działek
  function stylDzialki(f) {
    var d = f.get('dzialka'), poziom = d && d.cdi ? d.cdi.poziom : -1;
    var kolor = poziom >= 0 ? POZIOMY[poziom].kolor : '#1565c0';
    return new ol.style.Style({
      stroke: new ol.style.Stroke({ color: kolor, width: 3 }),
      fill: new ol.style.Fill({ color: kolor + '33' }),
      text: new ol.style.Text({
        text: d ? d.numer : '', font: 'bold 14px Arial, sans-serif', overflow: true,
        fill: new ol.style.Fill({ color: '#fff' }), stroke: new ol.style.Stroke({ color: kolor, width: 4 })
      })
    });
  }
  var zrodlo = new ol.source.Vector();
  map.addLayer(new ol.layer.Vector({ source: zrodlo, zIndex: 999, style: stylDzialki }));

  // ------------------------------------------------------------------ panel
  var tresc = document.querySelector('.panel-analiza-koncowa');
  if (!tresc) return;
  tresc.innerHTML =
    '<div class="cdi-przyciski"><button type="button" class="cdi-zaznacz">Select parcels</button>' +
    '<button type="button" class="cdi-wyczysc">Clear</button></div>' +
    '<div class="cdi-pomoc">Turn on “Select parcels”, then click parcels on the map (click again to remove).</div>' +
    '<ul class="cdi-lista"></ul>' +
    '<button type="button" class="cdi-oblicz" disabled>Calculate CDI</button>' +
    '<div class="cdi-wynik"></div>';
  var $ = function (s) { return tresc.querySelector(s); };
  var przyciskZaznacz = $('.cdi-zaznacz'), lista = $('.cdi-lista'), przyciskOblicz = $('.cdi-oblicz'), wynik = $('.cdi-wynik');

  przyciskZaznacz.onclick = function () {
    stan.zaznaczanie = !stan.zaznaczanie;
    przyciskZaznacz.classList.toggle('aktywny', stan.zaznaczanie);
    przyciskZaznacz.textContent = stan.zaznaczanie ? 'Selecting… (click to stop)' : 'Select parcels';
    document.documentElement.classList.toggle('cdi-zaznaczanie', stan.zaznaczanie);
    if (stan.zaznaczanie && window.container) container.style.display = 'none';   // chowamy dymek działki
  };
  $('.cdi-wyczysc').onclick = function () {
    stan.dzialki = []; zrodlo.clear(); wynik.innerHTML = ''; odswiezListe();
  };
  przyciskOblicz.onclick = function () { oblicz(); };

  function f2(v) { return isFinite(v) ? v.toFixed(2) : '–'; }
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; }

  function odswiezListe() {
    lista.innerHTML = '';
    stan.dzialki.forEach(function (d) {
      var li = document.createElement('li');
      var status = d.blad ? 'error' : (d.gotowe ? (d.cdi ? POZIOMY[d.cdi.poziom].nazwa : 'ready') : 'loading…');
      li.innerHTML = '<span class="cdi-nazwa" title="' + esc(d.teryt) + '">' + esc(d.numer) + ' · ' + esc(d.obreb) +
        ' <small>(' + d.ha.toFixed(2) + ' ha)</small></span><span class="cdi-status">' + status + '</span>' +
        '<button type="button" title="Remove">×</button>';
      li.querySelector('button').onclick = function () { usun(d); };
      lista.appendChild(li);
    });
    var gotowe = stan.dzialki.filter(function (d) { return d.gotowe; }).length;
    przyciskOblicz.disabled = !stan.dzialki.length || gotowe < stan.dzialki.length;
    przyciskOblicz.textContent = !stan.dzialki.length ? 'Calculate CDI'
      : (gotowe < stan.dzialki.length ? 'Loading data… (' + gotowe + '/' + stan.dzialki.length + ')'
        : 'Calculate CDI (' + stan.dzialki.length + (stan.dzialki.length === 1 ? ' parcel)' : ' parcels)'));
  }

  function usun(d) {
    stan.dzialki = stan.dzialki.filter(function (x) { return x !== d; });
    zrodlo.removeFeature(d.feature);
    wynik.innerHTML = '';
    odswiezListe();
  }

  // ------------------------------------------------------------------ zaznaczanie na mapie
  map.on('singleclick', function (evt) {
    if (!stan.zaznaczanie) return;
    var trafiona = null;
    map.forEachFeatureAtPixel(evt.pixel, function (f) { if (f.get('dzialka')) { trafiona = f.get('dzialka'); return true; } },
      { layerFilter: function (l) { return l.getSource() === zrodlo; } });
    if (trafiona) { usun(trafiona); return; }
    var ll = ol.proj.toLonLat(evt.coordinate, map.getView().getProjection());
    if (!window.mapParcels) return;
    window.mapParcels.parcelAt(ll[0].toFixed(7), ll[1].toFixed(7)).then(function (wyn) {
      if (!wyn.length) return;
      var p = wyn[0];
      if (stan.dzialki.some(function (d) { return d.teryt === p.teryt; })) return;
      dodaj(p);
    });
  });

  function dodaj(p) {
    var proj = map.getView().getProjection();
    var feature = new ol.format.WKT().readFeature(p.wkt, { dataProjection: 'EPSG:4326', featureProjection: proj });
    var wgs = new ol.format.WKT().readFeature(p.wkt);
    var srodek = ol.extent.getCenter(wgs.getGeometry().getExtent());
    var d = {
      teryt: p.teryt, numer: p.numer, obreb: p.obreb, gmina: p.gmina, feature: feature,
      geojson: new ol.format.GeoJSON().writeFeatureObject(wgs),
      lon: srodek[0], lat: srodek[1],
      ha: ol.sphere.getArea(feature.getGeometry(), { projection: proj }) / 1e4,
      gotowe: false
    };
    feature.set('dzialka', d);
    zrodlo.addFeature(feature);
    stan.dzialki.push(d);
    wynik.innerHTML = '';
    odswiezListe();
    Promise.all([nddiDzialki(d.geojson), klimatPunktu(d.lon, d.lat)]).then(function (w) {
      d.nddi = w[0]; d.klimat = w[1];
    }).catch(function (e) { d.blad = e.message; }).then(function () { d.gotowe = true; odswiezListe(); });
  }

  // ------------------------------------------------------------------ NDDI (Sentinel-2, Planetary Computer)
  var NDVI_X = '(B08-B04)/(B08+B04)', NDWI_X = '(B08-B11)/(B08+B11)';
  var WYRAZENIA = [NDVI_X, NDWI_X, '(' + NDVI_X + '-' + NDWI_X + ')/(' + NDVI_X + '+' + NDWI_X + ')',
    // udział czystych pikseli: SCL 4 roślinność, 5 gleba, 6 woda (postać z where - porównania typu SCL==4 API odrzuca)
    'where((SCL>=4)&(SCL<=6),1.0,0.0)'];

  function nddiDzialki(feature) {
    var teraz = new Date(), od = new Date(teraz.getTime() - NDDI_DNI * 864e5);
    return fetch(PC + '/stac/v1/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'], intersects: feature.geometry,
        datetime: od.toISOString().slice(0, 10) + 'T00:00:00Z/' + teraz.toISOString().slice(0, 10) + 'T23:59:59Z',
        query: { 'eo:cloud_cover': { lt: 60 } }, sortby: [{ field: 'datetime', direction: 'desc' }], limit: 30
      })
    }).then(function (r) { if (!r.ok) throw new Error('STAC ' + r.status); return r.json(); })
      .then(function (dane) {
        var dni = {}, sceny = [];
        (dane.features || []).forEach(function (s) {
          var dzien = s.properties.datetime.slice(0, 10);
          if (!dni[dzien]) { dni[dzien] = 1; sceny.push({ id: s.id, data: dzien }); }
        });
        sceny = sceny.slice(0, NDDI_MAKS_SCEN);
        return poKolei(sceny, function (s) { return statystykiSceny(s, feature); }, 3);
      })
      .then(function (wyniki) {
        var ok = wyniki.filter(function (s) { return s && s.czyste >= NDDI_CZYSTE && isFinite(s.nddi); });
        var sr = function (k) { return ok.length ? ok.reduce(function (a, x) { return a + x[k]; }, 0) / ok.length : NaN; };
        return { nddi: sr('nddi'), ndvi: sr('ndvi'), sceny: ok.length, sprawdzone: wyniki.length,
          od: ok.length ? ok[ok.length - 1].data : null, do: ok.length ? ok[0].data : null };
      });
  }

  function statystykiSceny(scena, feature) {
    var url = PC + '/data/v1/item/statistics?collection=sentinel-2-l2a&item=' + encodeURIComponent(scena.id) +
      '&expression=' + encodeURIComponent(WYRAZENIA.join(';')) + '&asset_as_band=true&max_size=1024';
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(feature) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        var st = d.properties && d.properties.statistics;
        if (!st) return null;
        var v = WYRAZENIA.map(function (x) { return st[x]; });
        if (!v[0] || !v[0].count) return null;
        return { data: scena.data, ndvi: v[0].mean, ndwi: v[1].mean, nddi: v[2].median, czyste: v[3] ? v[3].mean : 0 };
      })
      .catch(function () { return null; });
  }

  function poKolei(lista, fn, rownolegle) {
    var wyniki = new Array(lista.length), i = 0;
    function nastepny() {
      if (i >= lista.length) return Promise.resolve();
      var k = i++;
      return fn(lista[k]).then(function (w) { wyniki[k] = w; return nastepny(); });
    }
    var start = [];
    for (var j = 0; j < Math.min(rownolegle, lista.length); j++) start.push(nastepny());
    return Promise.all(start).then(function () { return wyniki; });
  }

  // ------------------------------------------------------------------ SPI i SMA (ERA5 przez Open-Meteo)
  var klimatCache = {};
  function klimatPunktu(lon, lat) {
    var klucz = lon.toFixed(1) + ',' + lat.toFixed(1);       // sąsiednie działki dzielą jeden węzeł ERA5
    if (klimatCache[klucz]) return klimatCache[klucz];
    var dzis = new Date().toISOString().slice(0, 10);
    var url = OPEN_METEO + '?latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3) +
      '&start_date=' + OD_ROKU + '-01-01&end_date=' + dzis +
      '&daily=precipitation_sum,soil_moisture_0_to_100cm_mean&timezone=Europe%2FWarsaw';
    klimatCache[klucz] = fetch(url).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('Open-Meteo ' + r.status + ' ' + t.slice(0, 80)); });
      return r.json();
    }).then(function (d) { return wskaznikiKlimatu(d.daily); });
    klimatCache[klucz].catch(function () { delete klimatCache[klucz]; });
    return klimatCache[klucz];
  }

  function wskaznikiKlimatu(daily) {
    var t = daily.time, p = daily.precipitation_sum, sm = daily.soil_moisture_0_to_100cm_mean;
    var ostatni = t.length - 1;
    while (ostatni > 0 && (p[ostatni] === null || sm[ostatni] === null)) ostatni--;
    var indeks = {};
    t.forEach(function (d, i) { indeks[d] = i; });
    var koniec = t[ostatni], rokK = +koniec.slice(0, 4);

    function okno(tab, i1, n, suma) {         // suma / średnia n dni kończących się w i1 (null, gdy braki)
      if (i1 - n + 1 < 0) return null;
      var s = 0;
      for (var i = i1 - n + 1; i <= i1; i++) { if (tab[i] === null) return null; s += tab[i]; }
      return suma ? s : s / n;
    }
    function zLat(tab, n, suma) {              // wartości tego samego okna kalendarzowego w poprzednich latach
      var w = [];
      for (var r = OD_ROKU; r < rokK; r++) {
        var i = indeks[r + koniec.slice(4)];
        if (i === undefined) i = indeks[r + '-02-28'];  // 29 lutego
        if (i === undefined) continue;
        var v = okno(tab, i, n, suma);
        if (v !== null) w.push(v);
      }
      return w;
    }
    function spi(n) {
      var x = okno(p, ostatni, n, true), hist = zLat(p, n, true);
      return { wartosc: spiZGammy(x, hist), suma: x, srednia: hist.reduce(function (a, b) { return a + b; }, 0) / hist.length };
    }
    var smX = okno(sm, ostatni, SMA_DNI, false), smH = zLat(sm, SMA_DNI, false);
    var smSr = smH.reduce(function (a, b) { return a + b; }, 0) / smH.length;
    var smSd = Math.sqrt(smH.reduce(function (a, b) { return a + (b - smSr) * (b - smSr); }, 0) / (smH.length - 1));
    return { do: koniec, lata: rokK - OD_ROKU, spi1: spi(30), spi3: spi(90),
      sma: { wartosc: (smX - smSr) / smSd, wilg: smX, srednia: smSr } };
  }

  // SPI: dopasowanie rozkładu gamma (Thom) do sum z poprzednich lat, z uwzględnieniem sum zerowych
  function spiZGammy(x, hist) {
    if (x === null || hist.length < 10) return NaN;
    var dodatnie = hist.filter(function (v) { return v > 0; }), q = 1 - dodatnie.length / hist.length;
    if (dodatnie.length < 5) return NaN;
    var sr = dodatnie.reduce(function (a, b) { return a + b; }, 0) / dodatnie.length;
    var srLn = dodatnie.reduce(function (a, b) { return a + Math.log(b); }, 0) / dodatnie.length;
    var A = Math.log(sr) - srLn, alfa = (1 + Math.sqrt(1 + 4 * A / 3)) / (4 * A), beta = sr / alfa;
    var H = x <= 0 ? q : q + (1 - q) * gammaP(alfa, x / beta);
    return odwrNormalny(Math.min(Math.max(H, 1e-6), 1 - 1e-6));
  }

  function lnGamma(z) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
      0.1208650973866179e-2, -0.5395239384953e-5];
    var y = z, x = z, tmp = x + 5.5, ser = 1.000000000190015;
    tmp -= (x + 0.5) * Math.log(tmp);
    for (var j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / x);
  }
  function gammaP(a, x) {        // regularyzowana dolna niepełna funkcja gamma
    if (x <= 0) return 0;
    var gln = lnGamma(a), n;
    if (x < a + 1) {
      var ap = a, sum = 1 / a, del = sum;
      for (n = 0; n < 200; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
      return sum * Math.exp(-x + a * Math.log(x) - gln);
    }
    var b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (n = 1; n < 200; n++) {
      var an = -n * (n - a); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; var del2 = d * c; h *= del2;
      if (Math.abs(del2 - 1) < 1e-12) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
  }
  function odwrNormalny(p) {     // odwrotna dystrybuanta N(0,1) (algorytm Acklama)
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var q, r;
    if (p < 0.02425) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - 0.02425) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // ------------------------------------------------------------------ CDI
  function poziomCDI(spi1, spi3, sma, nddi) {
    var watch = spi3 < -1 || spi1 < -2;
    var warning = watch && sma < -1;
    var alert = warning && nddi >= NDDI_PROG;
    return { poziom: alert ? 3 : warning ? 2 : watch ? 1 : 0, watch: watch, warning: warning, alert: alert };
  }

  function oblicz() {
    var dane = stan.dzialki.filter(function (d) { return d.klimat; });
    if (!dane.length) { wynik.innerHTML = '<div class="rolnik-blad">No data for the selected parcels.</div>'; return; }
    dane.forEach(function (d) {
      d.cdi = poziomCDI(d.klimat.spi1.wartosc, d.klimat.spi3.wartosc, d.klimat.sma.wartosc, d.nddi ? d.nddi.nddi : NaN);
      d.feature.changed();
    });
    function srWazona(fn) {
      var s = 0, w = 0;
      dane.forEach(function (d) { var v = fn(d); if (isFinite(v)) { s += v * d.ha; w += d.ha; } });
      return w ? s / w : NaN;
    }
    var obszar = {
      spi1: srWazona(function (d) { return d.klimat.spi1.wartosc; }),
      spi3: srWazona(function (d) { return d.klimat.spi3.wartosc; }),
      sma: srWazona(function (d) { return d.klimat.sma.wartosc; }),
      nddi: srWazona(function (d) { return d.nddi ? d.nddi.nddi : NaN; }),
      ndvi: srWazona(function (d) { return d.nddi ? d.nddi.ndvi : NaN; }),
      ha: dane.reduce(function (a, d) { return a + d.ha; }, 0)
    };
    obszar.cdi = poziomCDI(obszar.spi1, obszar.spi3, obszar.sma, obszar.nddi);
    var P = POZIOMY[obszar.cdi.poziom], doDnia = dane[0].klimat.do;
    var bezNddi = dane.filter(function (d) { return !d.nddi || !isFinite(d.nddi.nddi); }).length;

    var znak = function (b) { return b ? '✔' : '–'; };
    var h = '<div class="cdi-poziom" style="background:' + P.kolor + '">CDI: ' + P.nazwa +
      '<small>Area of ' + dane.length + (dane.length === 1 ? ' parcel' : ' parcels') + ', ' + obszar.ha.toFixed(2) +
      ' ha · weather data to ' + doDnia + '</small></div>' +
      '<table class="cdi-tab"><tr><th>Indicator (area)</th><th>Value</th><th>Drought</th></tr>' +
      '<tr><td>SPI-1 (30 days)</td><td>' + f2(obszar.spi1) + '</td><td>' + znak(obszar.spi1 < -2) + '</td></tr>' +
      '<tr><td>SPI-3 (90 days)</td><td>' + f2(obszar.spi3) + '</td><td>' + znak(obszar.spi3 < -1) + '</td></tr>' +
      '<tr><td>SMA (soil 0–100 cm)</td><td>' + f2(obszar.sma) + '</td><td>' + znak(obszar.sma < -1) + '</td></tr>' +
      '<tr><td>NDDI (Sentinel-2)</td><td>' + f2(obszar.nddi) + '</td><td>' + znak(obszar.nddi >= NDDI_PROG) + '</td></tr>' +
      '<tr><td>NDVI (Sentinel-2)</td><td>' + f2(obszar.ndvi) + '</td><td></td></tr></table>';
    if (dane.length > 1) {
      h += '<div class="rolnik-sekcja" style="margin-top:8px">Parcels</div><table class="cdi-tab">' +
        '<tr><th>Parcel</th><th>SPI-1</th><th>SPI-3</th><th>SMA</th><th>NDDI</th><th>CDI</th></tr>' +
        dane.map(function (d) {
          var Q = POZIOMY[d.cdi.poziom];
          return '<tr><td title="' + esc(d.teryt) + '">' + esc(d.numer) + '</td><td>' + f2(d.klimat.spi1.wartosc) + '</td><td>' +
            f2(d.klimat.spi3.wartosc) + '</td><td>' + f2(d.klimat.sma.wartosc) + '</td><td>' + f2(d.nddi ? d.nddi.nddi : NaN) +
            '</td><td><span class="cdi-kropka" style="background:' + Q.kolor + '"></span>' + Q.nazwa + '</td></tr>';
        }).join('') + '</table>';
    }
    var d0 = dane[0];
    h += '<div class="cdi-uwaga">' +
      '30-day rain: ' + f2(d0.klimat.spi1.suma) + ' mm (normal ' + f2(d0.klimat.spi1.srednia) + ' mm); ' +
      '90-day: ' + f2(d0.klimat.spi3.suma) + ' mm (normal ' + f2(d0.klimat.spi3.srednia) + ' mm)' +
      (dane.length > 1 ? ' – first parcel' : '') + '.<br>' +
      'SPI and SMA vs. ' + OD_ROKU + '–' + (+doDnia.slice(0, 4) - 1) + ' (ERA5 / ERA5-Land, Open-Meteo); ' +
      'NDDI from Sentinel-2 images of the last ' + NDDI_DNI + ' days' +
      (d0.nddi && d0.nddi.sceny ? ' (' + d0.nddi.sceny + ' cloud-free)' : '') + '.<br>' +
      (bezNddi ? '<b>' + bezNddi + ' parcel(s) without a cloud-free image – Alert level cannot be reached for them.</b><br>' : '') +
      'CDI: Watch = SPI-3 &lt; −1 or SPI-1 &lt; −2; Warning = Watch and SMA &lt; −1; Alert = Warning and NDDI ≥ ' + NDDI_PROG +
      ' (EDO scheme, NDDI instead of fAPAR).</div>';
    wynik.innerHTML = h;
    odswiezListe();
  }
})();
