/*
 * Panel „Warstwy” w lewym dolnym rogu, wyglądający jak panel „Analiza dla rolnika”
 * (zielony nagłówek, przycisk zwiń/rozwiń). Zastępuje przycisk warstw qgis2web z prawego górnego rogu.
 * Oba panele trafiają do wspólnej kolumny w lewym dolnym rogu: „Warstwy” na górze, „Analiza dla rolnika” pod spodem.
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

  // panel „Warstwy” w stylu panelu rolnika
  var panel = document.createElement('div');
  panel.className = 'rolnik-panel panel-warstw zwiniety';
  panel.innerHTML =
    '<div class="rolnik-naglowek"><span>Warstwy</span>' +
    '<button type="button" class="rolnik-zwin" title="Zwiń / rozwiń">+</button></div>' +
    '<div class="rolnik-tresc panel-warstw-lista"></div>';
  kolumna.appendChild(panel);

  var lista = panel.querySelector('.panel-warstw-lista');
  var przycisk = panel.querySelector('.rolnik-zwin');

  function rysuj() {
    ol.control.LayerSwitcher.renderPanel(map, lista, { reverse: true, groupSelectStyle: 'children' });
  }
  rysuj();
  map.getLayers().on('change:length', rysuj);

  przycisk.onclick = function () {
    var zwiniety = panel.classList.toggle('zwiniety');
    przycisk.textContent = zwiniety ? '+' : '–';
    if (!zwiniety) rysuj();
  };

  // panel „Analiza dla rolnika” (dodawany później przez rolnik.js) przenosimy pod „Warstwy”
  function przeniesRolnika() {
    var r = document.querySelector('.rolnik-panel.rolnik-ol');
    if (r && r.parentNode !== kolumna) kolumna.appendChild(r);
    return !!r;
  }
  if (!przeniesRolnika()) {
    var obserwator = new MutationObserver(function () {
      if (przeniesRolnika()) obserwator.disconnect();
    });
    obserwator.observe(map.getTargetElement(), { childList: true, subtree: true });
  }
})();
