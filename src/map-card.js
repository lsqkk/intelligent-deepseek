import { placeQuery, resolvePlace, validCoordinates } from './place-search.js';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function readMap(value) {
  if (!Array.isArray(value?.places) || value.places.length < 1 || value.places.length > 8) return null;
  const city = typeof value.city === 'string' ? value.city.trim() : '';
  if (city.length > 60) return null;
  const places = value.places.map((place, index) => {
    const number = index + 1;
    if (typeof place === 'string' && place.trim() && place.length <= 100) {
      return { name: place.trim(), city, number };
    }
    if (!Array.isArray(place)) return null;
    const [name, lat, lon] = place;
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || !validCoordinates(lat, lon)) return null;
    return { name: name.trim(), lat, lon, number };
  });
  return places.every(Boolean) ? { places } : null;
}

function outbound(url, label) {
  const link = document.createElement('a');
  link.href = url;
  link.textContent = label;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function mapsUrl({ lat, lon }) {
  return 'https://www.openstreetmap.org/?' + new URLSearchParams({ mlat: lat, mlon: lon }) +
    `#map=16/${lat}/${lon}`;
}

function routeUrl(places) {
  const coordinates = places.map(({ lat, lon }) => `${lat},${lon}`);
  const query = new URLSearchParams({ api: '1', origin: coordinates[0], destination: coordinates.at(-1) });
  if (coordinates.length > 2) query.set('waypoints', coordinates.slice(1, -1).join('|'));
  return 'https://www.google.com/maps/dir/?' + query;
}

export function mountMap(host, { places }) {
  if (places.every(({ lat, lon }) => validCoordinates(lat, lon))) return renderMap(host, places);
  const links = document.createElement('div');
  links.className = 'dsui-map-places';
  const searchLink = (place) => outbound('https://www.openstreetmap.org/search?' +
    new URLSearchParams({ query: placeQuery(place) }), `${place.number}. ${place.name} · 搜索 ↗`);
  const pending = places.filter(({ lat, lon }) => !validCoordinates(lat, lon));
  links.append(...pending.map(searchLink));
  host.append(links);
  host.hidden = false;
  let disposed = false;
  let disposeMap;
  const visible = new IntersectionObserver(async ([entry]) => {
    if (disposed || !entry.isIntersecting) return;
    visible.disconnect();
    const located = [];
    const missing = [];
    for (const place of places) {
      if (disposed || !host.isConnected) return;
      const point = await resolvePlace(place);
      (point ? located : missing).push(point ?? place);
    }
    if (disposed || !host.isConnected) return;
    links.remove();
    if (located.length) disposeMap = renderMap(host, located, missing.length === 0);
    if (missing.length) {
      links.replaceChildren(...missing.map(searchLink));
      host.append(links);
    }
  });
  visible.observe(host);
  return () => {
    disposed = true;
    visible.disconnect();
    disposeMap?.();
  };
}

function renderMap(host, places, complete = true) {
  const canvas = document.createElement('div');
  canvas.className = 'dsui-map-canvas';
  canvas.setAttribute('aria-label', '地点地图');
  const controls = document.createElement('div');
  controls.className = 'dsui-map-places';
  host.append(canvas, controls);
  host.hidden = false;

  let map;
  let tileTimeout;
  const markers = [];
  for (const [index, place] of places.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${place.number}. ${place.name}`;
    button.title = place.address || place.name;
    button.addEventListener('click', () => {
      if (!map) return window.open(mapsUrl(place), '_blank', 'noopener,noreferrer');
      map.setView(markers[index].getLatLng(), Math.max(map.getZoom(), 13));
      markers[index].openPopup();
    });
    controls.append(button);
  }
  const hasRoute = complete && places.length > 1;
  controls.append(outbound(hasRoute ? routeUrl(places) : mapsUrl(places[0]),
    hasRoute ? '打开路线 ↗' : '打开地图 ↗'));

  const disposeMap = () => {
    clearTimeout(tileTimeout);
    resize.disconnect();
    map?.remove();
    map = null;
  };
  const resize = new ResizeObserver(() => map?.invalidateSize({ pan: false }));
  const visible = new IntersectionObserver(async ([entry]) => {
    if (!entry.isIntersecting) return;
    visible.disconnect();
    try {
      const { default: L } = await import('leaflet');
      if (!canvas.isConnected) return;
      map = L.map(canvas, { scrollWheelZoom: false, maxZoom: 19, attributionControl: true });
      map.attributionControl.setPrefix(false);
      places.forEach((place) => {
        const { name, lat, lon, number, address } = place;
        const icon = L.divIcon({
          className: 'dsui-map-pin', html: String(number), iconSize: [26, 26], iconAnchor: [13, 13],
        });
        const popup = document.createElement('div');
        popup.append(outbound(mapsUrl(place), name + ' ↗'));
        if (address) {
          const details = document.createElement('small');
          details.className = 'dsui-map-address';
          details.textContent = address;
          popup.append(details);
        }
        markers.push(L.marker([lat, lon], { icon, title: name, alt: name }).addTo(map).bindPopup(popup));
      });
      if (places.length === 1) map.setView(markers[0].getLatLng(), 13);
      else map.fitBounds(L.latLngBounds(markers.map((marker) => marker.getLatLng())), { padding: [30, 30], maxZoom: 14 });

      const tiles = L.tileLayer(TILE_URL, {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      const fallback = () => {
        canvas.hidden = true;
        disposeMap();
      };
      let loaded = false;
      tiles.once('tileload', () => {
        loaded = true;
        clearTimeout(tileTimeout);
      });
      tileTimeout = setTimeout(fallback, 10000);
      tiles.once('load', () => {
        if (!loaded) queueMicrotask(fallback);
      });
      tiles.addTo(map);
      resize.observe(canvas);
    } catch {
      canvas.hidden = true;
      disposeMap();
    }
  });
  visible.observe(canvas);
  return () => {
    visible.disconnect();
    disposeMap();
  };
}
