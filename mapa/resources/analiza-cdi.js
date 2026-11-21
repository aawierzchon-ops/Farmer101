/*
 * Panel „Final analysis”: zaznaczanie działek i obliczanie wskaźnika suszy CDI.
 *
 * 1. „Select parcels” – kliknięcie mapy dodaje działkę (ULDK GUGiK), kliknięcie zaznaczonej ją usuwa.
 *    Dla każdej działki: kategoria gleby I–IV (z warstwy gleby SoilGrids, można zmienić) i dane ERA5
 *    od 1991 r. (opad, ET0, wilgotność gleby 0–100 cm; Open-Meteo).
 * 2. „Calculate CDI” – dla wybranej uprawy i daty analizy:
 *    - SPI-1 (30 dni), SPI-3 (90 dni) – rozkład gamma względem tych samych dni z lat 1991–(rok-1),
 *    - SMA – anomalia wilgotności gleby z 10 dni (z-score),
 *    - KBW – klimatyczny bilans wodny (opad − ET0) z ostatniego zakończonego okresu sześciodekadowego
 *      i próg z rozporządzenia MRiRW z 11.04.2019 (Dz.U. 2019 poz. 739) dla uprawy i kategorii gleby,
 *    - anomalia NDDI – NDDI z Sentinel-2 (60 dni przed datą) względem tych samych tygodni w latach 2018–(rok-1);
 *      liczona tylko w sezonie IV–IX i gdy NDVI ≥ 0,3.
 *    CDI: Watch = SPI-3 < −1 lub SPI-1 < −2 lub KBW poniżej progu; Warning = Watch i SMA < −1;
 *         Alert = Warning i anomalia NDDI > +1 (schemat EDO, NDDI zamiast fAPAR).
 *    Obszar = średnie ważone powierzchnią działek + udział powierzchni na każdym poziomie.
 */
(function () {
  'use strict';
  if (typeof map === 'undefined' || !window.ol) return;

  var OD_ROKU = 1991, SMA_DNI = 10;
  var NDDI_DNI = 60, NDDI_OD_ROKU = 2018, NDDI_CZYSTE = 0.8, NDDI_MAKS_SCEN = 6, NDVI_MIN = 0.3;
  var PC = 'https://planetarycomputer.microsoft.com/api';
  var OPEN_METEO = 'https://archive-api.open-meteo.com/v1/archive';

  // ---------- Dz.U. 2019 poz. 739, załącznik: wartości KBW [mm] oznaczające suszę ----------
  // [uprawa][kategoria gleby] -> 14 okresów sześciodekadowych; null = „x” (brak obniżenia plonów
  // w okresie) albo „-” (uprawa niewskazana na tej kategorii gleby)
  var PROGI_KBW = {
    "Zboża ozime": {"I":[-129,-132,-137,-145,-154,-165,-180,-199,-220,null,null,null,null,null],"II":[-150,-153,-158,-166,-175,-186,-201,-220,-241,null,null,null,null,null],"III":[-188,-191,-196,-204,-213,-224,-239,-258,-279,null,null,null,null,null],"IV":[-215,-218,-223,-231,-240,-251,-266,-285,-306,null,null,null,null,null]},
    "Zboża jare": {"I":[-125,-127,-130,-135,-142,-153,-169,-186,-207,null,null,null,null,null],"II":[-144,-146,-149,-154,-161,-172,-188,-205,-226,null,null,null,null,null],"III":[-174,-176,-179,-184,-191,-202,-218,-235,-256,null,null,null,null,null],"IV":[-194,-196,-199,-204,-211,-222,-238,-255,-276,null,null,null,null,null]},
    "Kukurydza na ziarno": {"I":[null,null,null,-168,-161,-156,-153,-152,-153,-154,-156,-158,-161,-164],"II":[null,null,null,-200,-193,-188,-185,-184,-185,-186,-188,-190,-193,-196],"III":[null,null,null,-236,-229,-224,-221,-220,-221,-222,-224,-226,-229,-232],"IV":[null,null,null,-271,-264,-259,-256,-255,-256,-257,-259,-261,-264,-267]},
    "Kukurydza na kiszonkę": {"I":[null,null,null,-168,-161,-156,-153,-152,-152,-152,-153,-155,-157,-160],"II":[null,null,null,-200,-193,-188,-185,-184,-184,-184,-185,-187,-189,-192],"III":[null,null,null,-236,-229,-224,-221,-220,-220,-220,-221,-223,-225,-228],"IV":[null,null,null,-271,-264,-259,-256,-255,-255,-255,-256,-258,-260,-263]},
    "Rzepak i rzepik": {"I":[-207,-187,-170,-155,-142,-132,null,null,null,null,null,null,-138,-138],"II":[-232,-211,-193,-177,-165,-155,null,null,null,null,null,null,-158,-158],"III":[-275,-254,-236,-220,-208,-198,null,null,null,null,null,null,-205,-205],"IV":[-297,-276,-258,-242,-230,-220,null,null,null,null,null,null,-230,-230]},
    "Ziemniaki": {"I":[null,null,-238,-232,-226,-219,-210,-200,-189,-178,-168,-157,-147,null],"II":[null,null,-257,-251,-245,-238,-229,-219,-208,-197,-187,-176,-166,null],"III":[null,null,-286,-280,-274,-267,-258,-248,-237,-226,-216,-205,-195,null],"IV":[null,null,-306,-300,-294,-287,-278,-268,-257,-246,-236,-225,-215,null]},
    "Burak cukrowy": {"I":[null,null,null,null,null,null,null,null,null,null,null,null,null,null],"II":[-250,-248,-245,-241,-237,-232,-226,-220,-212,-202,-192,-182,-169,-155],"III":[-277,-275,-272,-268,-264,-259,-253,-247,-239,-229,-219,-209,-196,-182],"IV":[-296,-294,-291,-287,-283,-278,-272,-266,-258,-248,-238,-228,-215,-201]},
    "Chmiel": {"I":[null,null,null,-230,-220,-212,-205,-199,-194,-190,-186,-182,null,null],"II":[null,null,null,-248,-238,-230,-223,-217,-212,-208,-204,-200,null,null],"III":[null,null,null,-285,-275,-267,-260,-254,-249,-245,-241,-237,null,null],"IV":[null,null,null,-302,-292,-284,-277,-271,-266,-262,-258,-254,null,null]},
    "Tytoń": {"I":[null,null,null,-189,-187,-186,-185,-186,-187,-190,-195,-200,null,null],"II":[null,null,null,-201,-199,-198,-197,-198,-199,-202,-207,-212,null,null],"III":[null,null,null,-227,-225,-224,-223,-224,-225,-228,-233,-238,null,null],"IV":[null,null,null,-240,-238,-237,-236,-237,-238,-241,-246,-251,null,null]},
    "Warzywa gruntowe": {"I":[null,null,null,-189,-187,-185,-184,-184,-184,-185,-187,-188,null,null],"II":[null,null,null,-207,-205,-203,-202,-202,-202,-203,-205,-206,null,null],"III":[null,null,null,-243,-241,-239,-238,-238,-238,-239,-241,-242,null,null],"IV":[null,null,null,-263,-261,-259,-258,-258,-258,-259,-261,-262,null,null]},
    "Krzewy owocowe": {"I":[-149,-148,-147,-147,-149,-154,-159,-162,-163,-162,-160,-157,null,null],"II":[-166,-165,-164,-164,-166,-171,-176,-179,-180,-179,-177,-174,null,null],"III":[-200,-199,-198,-198,-200,-205,-210,-213,-214,-213,-211,-208,null,null],"IV":[-217,-216,-215,-215,-217,-222,-227,-230,-231,-230,-228,-225,null,null]},
    "Drzewa owocowe": {"I":[-168,-171,-175,-180,-187,-193,-199,-205,-210,-215,-220,-223,null,null],"II":[-190,-193,-197,-202,-209,-215,-221,-227,-232,-237,-242,-245,null,null],"III":[-229,-232,-236,-241,-248,-254,-260,-266,-271,-276,-281,-284,null,null],"IV":[-249,-252,-256,-261,-268,-274,-280,-286,-291,-296,-301,-304,null,null]},
    "Truskawki": {"I":[-133,-137,-143,-152,-163,-178,-190,-198,-202,null,null,null,null,null],"II":[-150,-154,-160,-169,-180,-195,-207,-215,-219,null,null,null,null,null],"III":[-183,-187,-193,-202,-213,-228,-240,-248,-252,null,null,null,null,null],"IV":[-204,-208,-214,-223,-234,-249,-261,-269,-273,null,null,null,null,null]},
    "Rośliny strączkowe": {"I":[null,null,null,-161,-161,-163,-165,-166,-167,-168,-170,-172,-174,-176],"II":[null,null,null,-182,-182,-184,-186,-187,-188,-189,-191,-193,-195,-197],"III":[null,null,null,-213,-213,-215,-217,-218,-219,-220,-222,-224,-226,-228],"IV":[null,null,null,-234,-234,-236,-238,-239,-240,-241,-243,-245,-247,-249]}
  };
  var OKRESY = [['03-21', '05-20'], ['04-01', '05-31'], ['04-11', '06-10'], ['04-21', '06-20'], ['05-01', '06-30'],
    ['05-11', '07-10'], ['05-21', '07-20'], ['06-01', '07-31'], ['06-11', '08-10'], ['06-21', '08-20'],
    ['07-01', '08-31'], ['07-11', '09-10'], ['07-21', '09-20'], ['08-01', '09-30']];
  var UPRAWY_EN = {
    'Zboża ozime': 'Winter cereals', 'Zboża jare': 'Spring cereals', 'Kukurydza na ziarno': 'Maize (grain)',
    'Kukurydza na kiszonkę': 'Maize (silage)', 'Rzepak i rzepik': 'Rapeseed', 'Ziemniaki': 'Potatoes',
    'Burak cukrowy': 'Sugar beet', 'Chmiel': 'Hops', 'Tytoń': 'Tobacco', 'Warzywa gruntowe': 'Field vegetables',
    'Krzewy owocowe': 'Fruit bushes', 'Drzewa owocowe': 'Fruit trees', 'Truskawki': 'Strawberries',
    'Rośliny strączkowe': 'Legumes'
  };
  // klasa uziarnienia USDA (warstwa gleby SoilGrids) -> kategoria gleby wg rozporządzenia (przybliżenie)
  var KATEGORIA_Z_KLASY = {
    'piasek': 'I', 'piasek gliniasty': 'I', 'glina piaszczysta': 'II', 'glina': 'III', 'pył gliniasty': 'III',
    'pył': 'III', 'glina piaszczysto-ilasta': 'IV', 'glina ilasta': 'IV', 'glina pylasto-ilasta': 'IV',
    'ił piaszczysty': 'IV', 'ił pylasty': 'IV', 'ił': 'IV'
  };
  var POZIOMY = [
    { nazwa: 'No drought', kolor: '#2e7d32' }, { nazwa: 'Watch', kolor: '#f9a825' },
    { nazwa: 'Warning', kolor: '#ef6c00' }, { nazwa: 'Alert', kolor: '#c62828' }
  ];
  var RZYM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

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
    '.cdi-ustawienia{display:grid;grid-template-columns:auto 1fr;gap:3px 6px;align-items:center;font-size:12px;margin:4px 0 6px}' +
    '.cdi-ustawienia select,.cdi-ustawienia input{font-size:12px;min-width:0;width:100%;box-sizing:border-box}' +
    '.cdi-lista{list-style:none;margin:0;padding:0;font-size:12px}' +
    '.cdi-lista li{display:flex;align-items:center;gap:5px;padding:3px 0;border-bottom:1px solid #eee}' +
    '.cdi-lista .cdi-nazwa{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.cdi-lista select{font-size:11px;padding:0}' +
    '.cdi-lista .cdi-status{font-size:11px;color:#888;white-space:nowrap}' +
    '.cdi-lista button{border:0;background:none;color:#999;cursor:pointer;font-size:15px;padding:0 2px;line-height:1}' +
    '.cdi-wynik{margin-top:8px;font-size:12px}' +
    '.cdi-poziom{color:#fff;border-radius:4px;padding:6px 8px;font-weight:700;font-size:14px;margin-bottom:6px}' +
    '.cdi-poziom small{display:block;font-weight:400;font-size:11px;opacity:.9}' +
    '.cdi-iung{border:1px solid #ccc;border-radius:4px;padding:4px 6px;margin-bottom:6px}' +
    '.cdi-iung b.tak{color:#c62828}.cdi-iung b.nie{color:#2e7d32}' +
    '.cdi-rozklad{display:flex;height:10px;border-radius:3px;overflow:hidden;margin:3px 0 6px}' +
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
    var d = f.get('dzialka'), poziom = d && d.wynik ? d.wynik.cdi.poziom : -1;
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
  var dzis = new Date().toISOString().slice(0, 10);
  tresc.innerHTML =
    '<div class="cdi-przyciski"><button type="button" class="cdi-zaznacz">Select parcels</button>' +
    '<button type="button" class="cdi-wyczysc">Clear</button></div>' +
    '<div class="cdi-pomoc">Turn on “Select parcels”, then click parcels on the map (click again to remove).</div>' +
    '<div class="cdi-ustawienia"><label>Crop</label><select class="cdi-uprawa">' +
    Object.keys(PROGI_KBW).map(function (u) {
      return '<option value="' + u + '"' + (u === 'Zboża jare' ? ' selected' : '') + '>' + (UPRAWY_EN[u] || u) + '</option>';
    }).join('') + '</select>' +
    '<label>Date</label><input type="date" class="cdi-data" max="' + dzis + '" min="' + (NDDI_OD_ROKU + 1) + '-01-01" value="' + dzis + '"></div>' +
    '<ul class="cdi-lista"></ul>' +
    '<button type="button" class="cdi-oblicz" disabled>Calculate CDI</button>' +
    '<div class="cdi-wynik"></div>';
  var $ = function (s) { return tresc.querySelector(s); };
  var przyciskZaznacz = $('.cdi-zaznacz'), lista = $('.cdi-lista'), przyciskOblicz = $('.cdi-oblicz'), wynik = $('.cdi-wynik');
  var poleUprawa = $('.cdi-uprawa'), poleData = $('.cdi-data');
  var liczenie = false;

  przyciskZaznacz.onclick = function () {
    stan.zaznaczanie = !stan.zaznaczanie;
    przyciskZaznacz.classList.toggle('aktywny', stan.zaznaczanie);
    przyciskZaznacz.textContent = stan.zaznaczanie ? 'Selecting… (click to stop)' : 'Select parcels';
    document.documentElement.classList.toggle('cdi-zaznaczanie', stan.zaznaczanie);
    if (stan.zaznaczanie && window.container) container.style.display = 'none';
  };
  $('.cdi-wyczysc').onclick = function () { stan.dzialki = []; zrodlo.clear(); wynik.innerHTML = ''; odswiezListe(); };
  przyciskOblicz.onclick = function () { oblicz(); };
  poleUprawa.onchange = poleData.onchange = function () { wynik.innerHTML = ''; wyczyscWyniki(); };

  function f2(v) { return isFinite(v) ? v.toFixed(2) : '–'; }
  function f0(v) { return isFinite(v) ? Math.round(v) : '–'; }
  function esc(t) { var d = document.createElement('div'); d.textContent = t == null ? '' : String(t); return d.innerHTML; }
  function etykietaOkresu(o) {
    var a = o[0].split('-'), b = o[1].split('-');
    return (+a[1]) + ' ' + RZYM[+a[0]] + '–' + (+b[1]) + ' ' + RZYM[+b[0]];
  }
  function wyczyscWyniki() { stan.dzialki.forEach(function (d) { d.wynik = null; d.feature.changed(); }); odswiezListe(); }

  function odswiezListe() {
    lista.innerHTML = '';
    stan.dzialki.forEach(function (d) {
      var li = document.createElement('li');
      var status = d.blad ? 'error' : (d.gotowe ? (d.wynik ? POZIOMY[d.wynik.cdi.poziom].nazwa : 'ready') : 'loading…');
      li.innerHTML = '<span class="cdi-nazwa" title="' + esc(d.teryt + (d.klasaGleby ? ' · ' + d.klasaGleby : '')) + '">' +
        esc(d.numer) + ' · ' + esc(d.obreb) + ' <small>(' + d.ha.toFixed(2) + ' ha)</small></span>' +
        '<select title="Soil category (Dz.U. 2019 poz. 739)">' + ['I', 'II', 'III', 'IV'].map(function (k) {
          return '<option' + (k === d.kategoria ? ' selected' : '') + '>' + k + '</option>';
        }).join('') + '</select><span class="cdi-status">' + status + '</span><button type="button" title="Remove">×</button>';
      li.querySelector('select').onchange = function () { d.kategoria = this.value; d.wynik = null; wynik.innerHTML = ''; odswiezListe(); };
      li.querySelector('button').onclick = function () { usun(d); };
      lista.appendChild(li);
    });
    var gotowe = stan.dzialki.filter(function (d) { return d.gotowe; }).length, n = stan.dzialki.length;
    przyciskOblicz.disabled = liczenie || !n || gotowe < n;
    if (!liczenie) {
      przyciskOblicz.textContent = !n ? 'Calculate CDI' : (gotowe < n ? 'Loading data… (' + gotowe + '/' + n + ')'
        : 'Calculate CDI (' + n + (n === 1 ? ' parcel)' : ' parcels)'));
    }
  }

  function usun(d) {
    stan.dzialki = stan.dzialki.filter(function (x) { return x !== d; });
    zrodlo.removeFeature(d.feature);
    wynik.innerHTML = '';
    odswiezListe();
  }

  // ------------------------------------------------------------------ zaznaczanie na mapie
  map.on('singleclick', function (evt) {
    if (!stan.zaznaczanie || liczenie) return;
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
    var geo = new ol.format.GeoJSON().writeFeatureObject(wgs);
    geo.properties = {};
    var d = {
      teryt: p.teryt, numer: p.numer, obreb: p.obreb, gmina: p.gmina, feature: feature, geojson: geo,
      lon: srodek[0], lat: srodek[1], kategoria: 'II', klasaGleby: null, nddiCache: {},
      ha: ol.sphere.getArea(feature.getGeometry(), { projection: proj }) / 1e4, gotowe: false
    };
    feature.set('dzialka', d);
    zrodlo.addFeature(feature);
    stan.dzialki.push(d);
    wynik.innerHTML = '';
    odswiezListe();
    var gleba = window.rolnikWartosc ? window.rolnikWartosc('gleba_klasa', d.lon, d.lat) : Promise.resolve(null);
    Promise.all([daneKlimatu(d.lon, d.lat), gleba]).then(function (w) {
      d.klimat = w[0];
      if (w[1] && w[1].tekst) { d.klasaGleby = w[1].tekst; d.kategoria = KATEGORIA_Z_KLASY[w[1].tekst] || d.kategoria; }
    }).catch(function (e) { d.blad = e.message; }).then(function () { d.gotowe = true; odswiezListe(); });
  }

  // ------------------------------------------------------------------ dane ERA5 (Open-Meteo)
  var klimatCache = {};
  function daneKlimatu(lon, lat) {
    var klucz = lon.toFixed(1) + ',' + lat.toFixed(1);    // sąsiednie działki dzielą jeden węzeł ERA5
    if (klimatCache[klucz]) return klimatCache[klucz];
    var url = OPEN_METEO + '?latitude=' + lat.toFixed(3) + '&longitude=' + lon.toFixed(3) +
      '&start_date=' + OD_ROKU + '-01-01&end_date=' + dzis +
      '&daily=precipitation_sum,et0_fao_evapotranspiration,soil_moisture_0_to_100cm_mean&timezone=Europe%2FWarsaw';
    klimatCache[klucz] = fetch(url).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('Open-Meteo ' + r.status + ' ' + t.slice(0, 80)); });
      return r.json();
    }).then(function (d) {
      var dl = d.daily, k = { t: dl.time, p: dl.precipitation_sum, et: dl.et0_fao_evapotranspiration,
        sm: dl.soil_moisture_0_to_100cm_mean, idx: {} };
      k.t.forEach(function (x, i) { k.idx[x] = i; });
      var o = k.t.length - 1;
      while (o > 0 && (k.p[o] === null || k.sm[o] === null || k.et[o] === null)) o--;
      k.ostatni = k.t[o];
      return k;
    });
    klimatCache[klucz].catch(function () { delete klimatCache[klucz]; });
    return klimatCache[klucz];
  }

  function wskaznikiKlimatu(k, data, uprawa, kategoria) {
    var koniec = data > k.ostatni ? k.ostatni : data, i1 = k.idx[koniec], rokK = +koniec.slice(0, 4);
    function okno(tab, j1, n, suma) {
      if (j1 - n + 1 < 0) return null;
      var s = 0;
      for (var j = j1 - n + 1; j <= j1; j++) { if (tab[j] === null) return null; s += tab[j]; }
      return suma ? s : s / n;
    }
    function zLat(tab, n, suma) {
      var w = [];
      for (var r = OD_ROKU; r < rokK; r++) {
        var j = k.idx[r + koniec.slice(4)];
        if (j === undefined) j = k.idx[r + '-02-28'];
        if (j === undefined) continue;
        var v = okno(tab, j, n, suma);
        if (v !== null) w.push(v);
      }
      return w;
    }
    function spi(n) {
      var x = okno(k.p, i1, n, true), h = zLat(k.p, n, true);
      return { wartosc: spiZGammy(x, h), suma: x, srednia: srednia(h) };
    }
    var smX = okno(k.sm, i1, SMA_DNI, false), smH = zLat(k.sm, SMA_DNI, false), smS = srednia(smH);
    var smSd = Math.sqrt(smH.reduce(function (a, b) { return a + (b - smS) * (b - smS); }, 0) / (smH.length - 1));

    // KBW: ostatni zakończony okres sześciodekadowy w roku daty analizy (po sezonie – ostatni okres roku)
    var kbw = null;
    for (var o = OKRESY.length - 1; o >= 0; o--) {
      var od = rokK + '-' + OKRESY[o][0], doD = rokK + '-' + OKRESY[o][1];
      if (doD <= koniec) {
        var j0 = k.idx[od], j2 = k.idx[doD], s = 0, ok = true;
        for (var j = j0; j <= j2; j++) { if (k.p[j] === null || k.et[j] === null) { ok = false; break; } s += k.p[j] - k.et[j]; }
        var prog = (PROGI_KBW[uprawa] && PROGI_KBW[uprawa][kategoria]) ? PROGI_KBW[uprawa][kategoria][o] : null;
        kbw = { okres: o, wartosc: ok ? s : NaN, prog: prog, susza: ok && prog !== null && s < prog, poSezonie: koniec > rokK + '-09-30' };
        break;
      }
    }
    return { data: koniec, spi1: spi(30), spi3: spi(90), sma: { wartosc: (smX - smS) / smSd }, kbw: kbw };
  }

  function srednia(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : NaN; }

  // SPI: rozkład gamma (estymator Thoma) dopasowany do sum z poprzednich lat, z prawdopodobieństwem zera
  function spiZGammy(x, hist) {
    if (x === null || hist.length < 10) return NaN;
    var dod = hist.filter(function (v) { return v > 0; }), q = 1 - dod.length / hist.length;
    if (dod.length < 5) return NaN;
    var sr = srednia(dod), srLn = srednia(dod.map(Math.log));
    var A = Math.log(sr) - srLn, alfa = (1 + Math.sqrt(1 + 4 * A / 3)) / (4 * A), beta = sr / alfa;
    var H = x <= 0 ? q : q + (1 - q) * gammaP(alfa, x / beta);
    return odwrNormalny(Math.min(Math.max(H, 1e-6), 1 - 1e-6));
  }
  function lnGamma(z) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
      0.1208650973866179e-2, -0.5395239384953e-5];
    var y = z, tmp = z + 5.5, ser = 1.000000000190015;
    tmp -= (z + 0.5) * Math.log(tmp);
    for (var j = 0; j < 6; j++) ser += c[j] / ++y;
    return -tmp + Math.log(2.5066282746310005 * ser / z);
  }
  function gammaP(a, x) {
    if (x <= 0) return 0;
    var gln = lnGamma(a), n;
    if (x < a + 1) {
      var ap = a, sum = 1 / a, del = sum;
      for (n = 0; n < 300; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
      return sum * Math.exp(-x + a * Math.log(x) - gln);
    }
    var b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
    for (n = 1; n < 300; n++) {
      var an = -n * (n - a); b += 2;
      d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; var del2 = d * c; h *= del2;
      if (Math.abs(del2 - 1) < 1e-12) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - gln) * h;
  }
  function odwrNormalny(p) {
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

  // ------------------------------------------------------------------ NDDI (Sentinel-2) i jego anomalia
  var NDVI_X = '(B08-B04)/(B08+B04)', NDWI_X = '(B08-B11)/(B08+B11)';
  var WYRAZENIA = [NDVI_X, NDWI_X, '(' + NDVI_X + '-' + NDWI_X + ')/(' + NDVI_X + '+' + NDWI_X + ')',
    'where((SCL>=4)&(SCL<=6),1.0,0.0)'];   // udział czystych pikseli (SCL 4 roślinność, 5 gleba, 6 woda)

  function przesun(data, dni) { return new Date(new Date(data + 'T12:00:00Z').getTime() + dni * 864e5).toISOString().slice(0, 10); }

  // średnie NDDI i NDVI z bezchmurnych scen w oknie [od, do]
  function nddiOkna(d, od, doD) {
    var klucz = od + '/' + doD;
    if (d.nddiCache[klucz]) return d.nddiCache[klucz];
    d.nddiCache[klucz] = fetch(PC + '/stac/v1/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collections: ['sentinel-2-l2a'], intersects: d.geojson.geometry,
        datetime: od + 'T00:00:00Z/' + doD + 'T23:59:59Z', query: { 'eo:cloud_cover': { lt: 60 } },
        sortby: [{ field: 'eo:cloud_cover', direction: 'asc' }], limit: 30
      })
    }).then(function (r) { if (!r.ok) throw new Error('STAC ' + r.status); return r.json(); })
      .then(function (dane) {
        var dni = {}, sceny = [];
        (dane.features || []).forEach(function (s) {
          var dz = s.properties.datetime.slice(0, 10);
          if (!dni[dz]) { dni[dz] = 1; sceny.push({ id: s.id, data: dz }); }
        });
        return poKolei(sceny.slice(0, NDDI_MAKS_SCEN), function (s) { return statystykiSceny(s, d.geojson); }, 3);
      })
      .then(function (w) {
        var ok = w.filter(function (s) { return s && s.czyste >= NDDI_CZYSTE && isFinite(s.nddi); });
        return { nddi: srednia(ok.map(function (s) { return s.nddi; })), ndvi: srednia(ok.map(function (s) { return s.ndvi; })), sceny: ok.length };
      });
    d.nddiCache[klucz].catch(function () { delete d.nddiCache[klucz]; });
    return d.nddiCache[klucz];
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
        return { ndvi: v[0].mean, nddi: v[2].median, czyste: v[3] ? v[3].mean : 0 };
      })
      .catch(function () { return null; });
  }

  function poKolei(lst, fn, rownolegle) {
    var wyniki = new Array(lst.length), i = 0;
    function nastepny() {
      if (i >= lst.length) return Promise.resolve();
      var k = i++;
      return fn(lst[k]).then(function (w) { wyniki[k] = w; return nastepny(); });
    }
    var start = [];
    for (var j = 0; j < Math.min(rownolegle, lst.length); j++) start.push(nastepny());
    return Promise.all(start).then(function () { return wyniki; });
  }

  // NDDI w oknie 60 dni przed datą + te same okna w latach NDDI_OD_ROKU..rok-1 -> anomalia (z-score)
  function anomaliaNddi(d, data) {
    var mies = +data.slice(5, 7), rok = +data.slice(0, 4), od = przesun(data, -NDDI_DNI);
    var lata = [];
    for (var r = NDDI_OD_ROKU; r < rok; r++) lata.push(r);
    return nddiOkna(d, od, data).then(function (teraz) {
      var wynikNddi = { nddi: teraz.nddi, ndvi: teraz.ndvi, sceny: teraz.sceny, z: NaN, lat: 0, powod: '' };
      if (mies < 4 || mies > 9) { wynikNddi.powod = 'outside growing season (IV–IX)'; return wynikNddi; }
      if (!teraz.sceny) { wynikNddi.powod = 'no cloud-free image'; return wynikNddi; }
      if (!(teraz.ndvi >= NDVI_MIN)) { wynikNddi.powod = 'NDVI < ' + NDVI_MIN + ' (bare soil)'; return wynikNddi; }
      return poKolei(lata, function (r) {
        return nddiOkna(d, r + od.slice(4), r + data.slice(4)).catch(function () { return null; });
      }, 2).then(function (hist) {
        var h = hist.filter(function (x) { return x && x.sceny && isFinite(x.nddi); }).map(function (x) { return x.nddi; });
        wynikNddi.lat = h.length;
        if (h.length < 3) { wynikNddi.powod = 'fewer than 3 years of history'; return wynikNddi; }
        var s = srednia(h), sd = Math.sqrt(h.reduce(function (a, b) { return a + (b - s) * (b - s); }, 0) / (h.length - 1));
        wynikNddi.srednia = s;
        wynikNddi.z = sd > 0 ? (teraz.nddi - s) / sd : NaN;
        return wynikNddi;
      });
    });
  }

  // ------------------------------------------------------------------ CDI
  function poziomCDI(spi1, spi3, sma, kbwSusza, zNddi) {
    var watch = spi3 < -1 || spi1 < -2 || !!kbwSusza;
    var warning = watch && sma < -1;
    var alert = warning && zNddi > 1;
    return { poziom: alert ? 3 : warning ? 2 : watch ? 1 : 0 };
  }

  function oblicz() {
    var data = poleData.value || dzis, uprawa = poleUprawa.value;
    var dane = stan.dzialki.filter(function (d) { return d.klimat; });
    if (!dane.length) { wynik.innerHTML = '<div class="rolnik-blad">No data for the selected parcels.</div>'; return; }
    liczenie = true;
    przyciskOblicz.disabled = true;
    var gotowe = 0;
    przyciskOblicz.textContent = 'Loading Sentinel-2 (0/' + dane.length + ')…';
    poKolei(dane, function (d) {
      d.wynik = null;
      var kl = wskaznikiKlimatu(d.klimat, data, uprawa, d.kategoria);
      return anomaliaNddi(d, kl.data).catch(function (e) { return { z: NaN, powod: e.message }; }).then(function (n) {
        d.wynik = { kl: kl, nddi: n };
        d.wynik.cdi = poziomCDI(kl.spi1.wartosc, kl.spi3.wartosc, kl.sma.wartosc, kl.kbw && kl.kbw.susza, n.z);
        d.feature.changed();
        przyciskOblicz.textContent = 'Loading Sentinel-2 (' + (++gotowe) + '/' + dane.length + ')…';
      });
    }, 2).then(function () { pokazWynik(dane, data, uprawa); })
      .catch(function (e) { wynik.innerHTML = '<div class="rolnik-blad">' + esc(e.message) + '</div>'; })
      .then(function () { liczenie = false; odswiezListe(); });
  }

  function pokazWynik(dane, data, uprawa) {
    var ha = dane.reduce(function (a, d) { return a + d.ha; }, 0);
    function srW(fn) {
      var s = 0, w = 0;
      dane.forEach(function (d) { var v = fn(d); if (isFinite(v)) { s += v * d.ha; w += d.ha; } });
      return w ? s / w : NaN;
    }
    var spi1 = srW(function (d) { return d.wynik.kl.spi1.wartosc; }), spi3 = srW(function (d) { return d.wynik.kl.spi3.wartosc; });
    var sma = srW(function (d) { return d.wynik.kl.sma.wartosc; }), zN = srW(function (d) { return d.wynik.nddi.z; });
    var nddi = srW(function (d) { return d.wynik.nddi.nddi; }), ndvi = srW(function (d) { return d.wynik.nddi.ndvi; });
    var zKbw = dane.filter(function (d) { return d.wynik.kl.kbw && d.wynik.kl.kbw.prog !== null; });
    var haKbwSusza = dane.reduce(function (a, d) { return a + (d.wynik.kl.kbw && d.wynik.kl.kbw.susza ? d.ha : 0); }, 0);
    var udzialKbw = ha ? 100 * haKbwSusza / ha : 0;
    var cdi = poziomCDI(spi1, spi3, sma, udzialKbw >= 50, zN);
    var P = POZIOMY[cdi.poziom], dataD = dane[0].wynik.kl.data, kbw0 = dane[0].wynik.kl.kbw;

    var h = '<div class="cdi-poziom" style="background:' + P.kolor + '">CDI: ' + P.nazwa +
      '<small>' + dane.length + (dane.length === 1 ? ' parcel' : ' parcels') + ', ' + ha.toFixed(2) + ' ha · ' +
      esc(UPRAWY_EN[uprawa] || uprawa) + ' · data to ' + dataD + '</small></div>';

    // ocena wg rozporządzenia (KBW)
    h += '<div class="cdi-iung">';
    if (!kbw0) {
      h += 'Drought risk (Dz.U. 2019 poz. 739): <i>no complete 60-day period yet this season (first ends 20 V).</i>';
    } else {
      h += 'Drought risk (Dz.U. 2019 poz. 739), period ' + etykietaOkresu(OKRESY[kbw0.okres]) +
        (kbw0.poSezonie ? ' (last of the season)' : '') + ': ';
      if (!zKbw.length) h += '<i>not applicable for this crop and period.</i>';
      else h += '<b class="' + (haKbwSusza ? 'tak' : 'nie') + '">' + (haKbwSusza ? 'YES' : 'NO') + '</b> – ' +
        udzialKbw.toFixed(0) + '% of area' +
        (dane.length === 1 ? '<br>KBW ' + f0(kbw0.wartosc) + ' mm, threshold ' + (kbw0.prog === null ? 'x' : kbw0.prog + ' mm') +
          ' (soil cat. ' + dane[0].kategoria + ')' : '');
    }
    h += '</div>';

    // rozkład powierzchni na poziomy CDI
    var pow = [0, 0, 0, 0];
    dane.forEach(function (d) { pow[d.wynik.cdi.poziom] += d.ha; });
    h += '<div class="cdi-rozklad">' + pow.map(function (p, i) {
      return p ? '<span title="' + POZIOMY[i].nazwa + ' ' + (100 * p / ha).toFixed(0) + '%" style="flex:' + p + ';background:' +
        POZIOMY[i].kolor + '"></span>' : '';
    }).join('') + '</div><div style="font-size:11px;margin-top:-3px;margin-bottom:6px">' + pow.map(function (p, i) {
      return p ? '<span class="cdi-kropka" style="background:' + POZIOMY[i].kolor + '"></span>' + POZIOMY[i].nazwa + ' ' +
        (100 * p / ha).toFixed(0) + '%' : '';
    }).filter(Boolean).join(' · ') + '</div>';

    var znak = function (b) { return b ? '✔' : '–'; };
    h += '<table class="cdi-tab"><tr><th>Indicator (area)</th><th>Value</th><th>Drought</th></tr>' +
      '<tr><td>SPI-1 (30 days)</td><td>' + f2(spi1) + '</td><td>' + znak(spi1 < -2) + '</td></tr>' +
      '<tr><td>SPI-3 (90 days)</td><td>' + f2(spi3) + '</td><td>' + znak(spi3 < -1) + '</td></tr>' +
      '<tr><td>SMA (soil 0–100 cm)</td><td>' + f2(sma) + '</td><td>' + znak(sma < -1) + '</td></tr>' +
      '<tr><td>KBW below threshold</td><td>' + udzialKbw.toFixed(0) + '%</td><td>' + znak(udzialKbw >= 50) + '</td></tr>' +
      '<tr><td>NDDI anomaly (z)</td><td>' + f2(zN) + '</td><td>' + znak(zN > 1) + '</td></tr>' +
      '<tr><td>NDDI / NDVI (60 days)</td><td>' + f2(nddi) + ' / ' + f2(ndvi) + '</td><td></td></tr></table>';

    h += '<div class="rolnik-sekcja" style="margin-top:8px">Parcels</div><table class="cdi-tab">' +
      '<tr><th>Parcel</th><th>Soil</th><th>KBW / thr.</th><th>SPI-3</th><th>SMA</th><th>NDDI z</th><th>CDI</th></tr>' +
      dane.map(function (d) {
        var w = d.wynik, k = w.kl.kbw, Q = POZIOMY[w.cdi.poziom];
        return '<tr><td title="' + esc(d.teryt) + '">' + esc(d.numer) + '</td><td>' + d.kategoria + '</td><td>' +
          (k ? f0(k.wartosc) + ' / ' + (k.prog === null ? 'x' : k.prog) : '–') + '</td><td>' + f2(w.kl.spi3.wartosc) +
          '</td><td>' + f2(w.kl.sma.wartosc) + '</td><td title="' + esc(w.nddi.powod || '') + '">' + f2(w.nddi.z) +
          '</td><td><span class="cdi-kropka" style="background:' + Q.kolor + '"></span>' + Q.nazwa + '</td></tr>';
      }).join('') + '</table>';

    var bezNddi = dane.filter(function (d) { return !isFinite(d.wynik.nddi.z); });
    h += '<div class="cdi-uwaga">' +
      (bezNddi.length ? '<b>NDDI anomaly unavailable for ' + bezNddi.length + ' parcel(s): ' +
        esc(bezNddi[0].wynik.nddi.powod || 'no data') + ' – Alert level cannot be reached.</b><br>' : '') +
      'CDI: Watch = SPI-3 &lt; −1 or SPI-1 &lt; −2 or KBW below threshold; Warning = Watch and SMA &lt; −1; ' +
      'Alert = Warning and NDDI anomaly &gt; +1 (EDO scheme, NDDI instead of fAPAR).<br>' +
      'KBW = precipitation − ET0 (FAO) from ERA5 over the 60-day period; thresholds from Dz.U. 2019 poz. 739. ' +
      'IUNG computes evapotranspiration with its own formula from IMGW stations – ERA5 KBW tends to be ~10–20 mm lower.<br>' +
      'Soil category from SoilGrids texture (approximation) – check and change it in the list if needed. ' +
      'SPI/SMA vs. ' + OD_ROKU + '–' + (+dataD.slice(0, 4) - 1) + '; NDDI anomaly vs. ' + NDDI_OD_ROKU + '–' +
      (+dataD.slice(0, 4) - 1) + '.</div>';
    wynik.innerHTML = h;
  }
})();
