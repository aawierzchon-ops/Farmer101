/*
 * Zwijane panele w lewym dolnym rogu w stylu panelu rolnika (zielony nagłówek, przycisk +/–):
 *  - „Layers”: warstwy qgis2web + warstwy analityczne z rolnik.js (Landsat, ERA5, gleba) + mapy zagrożenia,
 *  - „Detailed data”: na starcie pusta; wyniki poszczególnych parametrów dla zaznaczonych działek
 *    (wypełnia resources/analiza-cdi.js po „Calculate”),
 *  - „Final analysis”: zaznaczanie działek i wynik końcowy (resources/analiza-cdi.js).
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
      '<button type="button" class="rolnik-zwin" title="Collapse / expand">+</button></div>' +
      '<div class="rolnik-tresc ' + klasaTresci + '">' + (tresc || '') + '</div>';
    var b = p.querySelector('.rolnik-zwin');
    p.rozwin = function () { if (p.classList.contains('zwiniety')) b.onclick(); };
    b.onclick = function () {
      var zwiniety = p.classList.toggle('zwiniety');
      b.textContent = zwiniety ? '+' : '–';
      if (!zwiniety && poRozwinieciu) poRozwinieciu();
    };
    kolumna.appendChild(p);
    return p;
  }

  // „Layers” – lista warstw qgis2web, pod nią warstwy analityczne i mapy zagrożenia (rolnik.js)
  var panel = nowyPanel('Layers', 'panel-warstw-tresc',
    '<div class="panel-warstw-lista"></div>' +
    '<div class="panel-warstwy-analityczne"></div>' +
    '<div class="panel-mapy-zagrozenia"></div>', rysuj);
  var lista = panel.querySelector('.panel-warstw-lista');
  function rysuj() {
    ol.control.LayerSwitcher.renderPanel(map, lista, { reverse: true, groupSelectStyle: 'children' });
  }
  rysuj();
  map.getLayers().on('change:length', rysuj);

  // „Detailed data” – pusta do czasu obliczeń dla zaznaczonych działek
  window.panelSzczegoly = nowyPanel('Detailed data', 'panel-szczegoly',
    '<div class="panel-pusty">Select parcels in “Final analysis” and click “Calculate” – the results of each ' +
    'parameter will appear here.</div>');
  window.panelAnalizy = nowyPanel('Final analysis', 'panel-analiza-koncowa', '<div class="panel-pusty">Loading…</div>');

  // logo w prawym dolnym rogu
  var logo = document.createElement('div');
  logo.className = 'logo-mapy';
  logo.innerHTML = '<img src="images/logo_duze.png" alt="Farmer101">';
  map.addControl(new ol.control.Control({ element: logo }));

  // panel warstw z rolnik.js (dodawany później) osadzamy w „Layers” – bez własnego nagłówka
  var cel = panel.querySelector('.panel-warstwy-analityczne');
  cel.innerHTML = '<div class="rolnik-grupa">Analysis layers</div>';
  function przeniesRolnika() {
    var r = document.querySelector('.rolnik-panel.rolnik-ol');
    if (!r) return false;
    if (r.parentNode !== cel) {
      r.classList.remove('zwiniety');
      r.classList.add('rolnik-osadzony');
      cel.appendChild(r);
    }
    return true;
  }
  if (!przeniesRolnika()) {
    var obserwator = new MutationObserver(function () {
      if (przeniesRolnika()) obserwator.disconnect();
    });
    obserwator.observe(map.getTargetElement(), { childList: true, subtree: true });
  }
})();
