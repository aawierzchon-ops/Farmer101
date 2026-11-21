/*
 * Zwijane panele w lewym dolnym rogu w stylu panelu rolnika (zielony nagłówek, przycisk +/–):
 * „Warstwy” (zastępuje przycisk warstw qgis2web), „Szczegółowe dane” (rolnik.js), „Uprawy”, „Analiza końcowa”.
 * Do tego logo w prawym dolnym rogu.
 * Ładowany w index.html po qgis2web.js (korzysta z globalnych `map` i `layerSwitcher`).
 */
(function () {
  if (typeof map === 'undefined' || !window.ol || !ol.control || !ol.control.LayerSwitcher) return;

  // usuń dotychczasowy przycisk warstw (prawy górny róg)
  if (typeof layerSwitcher !== 'undefined' && layerSwitcher) {
    map.removeControl(layerSwitcher);
  }

  // wspólna kolumna paneli w lewym dolnym rogu
  var kolumna = document.createElement('div');
  kolumna.className = 'ol-unselectable panele-lewy-dol';
  map.addControl(new ol.control.Control({ element: kolumna }));

  // zwijany panel w stylu panelu rolnika (zielony nagłówek, przycisk +/–), na starcie zwinięty
  function nowyPanel(tytul, klasaTresci, tresc, poRozwinieciu) {
    var p = document.createElement('div');
    p.className = 'rolnik-panel panel-warstw zwiniety';
    p.innerHTML =
      '<div class="rolnik-naglowek"><span>' + tytul + '</span>' +
      '<button type="button" class="rolnik-zwin" title="Zwiń / rozwiń">+</button></div>' +
      '<div class="rolnik-tresc ' + klasaTresci + '">' + (tresc || '') + '</div>';
    var b = p.querySelector('.rolnik-zwin');
    b.onclick = function () {
      var zwiniety = p.classList.toggle('zwiniety');
      b.textContent = zwiniety ? '+' : '–';
      if (!zwiniety && poRozwinieciu) poRozwinieciu();
    };
    kolumna.appendChild(p);
    return p;
  }

  // „Warstwy” – lista warstw qgis2web
  var panel = nowyPanel('Warstwy', 'panel-warstw-lista', '', rysuj);
  var lista = panel.querySelector('.panel-warstw-lista');
  function rysuj() {
    ol.control.LayerSwitcher.renderPanel(map, lista, { reverse: true, groupSelectStyle: 'children' });
  }
  rysuj();
  map.getLayers().on('change:length', rysuj);

  // „Uprawy” i „Analiza końcowa” – na razie bez treści
  var panelUprawy = nowyPanel('Uprawy', 'panel-uprawy', '<div class="panel-pusty">Wkrótce.</div>');
  nowyPanel('Analiza końcowa', 'panel-analiza-koncowa', '<div class="panel-pusty">Wkrótce.</div>');

  // logo w prawym dolnym rogu
  var logo = document.createElement('div');
  logo.className = 'logo-mapy';
  logo.innerHTML = '<img src="images/logo_duze.png" alt="Farmer101">';
  map.addControl(new ol.control.Control({ element: logo }));

  // panel „Szczegółowe dane” (rolnik.js, dodawany później) wstawiamy pod „Warstwy”, przed „Uprawy”
  function przeniesRolnika() {
    var r = document.querySelector('.rolnik-panel.rolnik-ol');
    if (r && r.parentNode !== kolumna) kolumna.insertBefore(r, panelUprawy);
    return !!r;
  }
  if (!przeniesRolnika()) {
    var obserwator = new MutationObserver(function () {
      if (przeniesRolnika()) obserwator.disconnect();
    });
    obserwator.observe(map.getTargetElement(), { childList: true, subtree: true });
  }
})();
