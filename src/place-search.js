import { requestJson } from './requests.js';

const HAN = /\p{Script=Han}/u;
const cache = new Map();
let queue = Promise.resolve();
let lastRequestAt = 0;

export function validCoordinates(lat, lon) {
  return Number.isFinite(lat) && Math.abs(lat) <= 85 && Number.isFinite(lon) && Math.abs(lon) <= 180;
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function placeQuery({ city, name }) {
  if (!city || normalize(name).startsWith(normalize(city))) return name;
  return `${city} ${name}`;
}

function search(query) {
  const hit = cache.get(query);
  if (hit && hit.expires > Date.now()) return hit.pending;
  const pending = queue.then(async () => {
    const delay = 500 - (Date.now() - lastRequestAt);
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    lastRequestAt = Date.now();
    const url = new URL('https://photon.komoot.io/api');
    url.search = new URLSearchParams({ q: query, limit: '5' });
    const response = await requestJson(url);
    return Array.isArray(response?.features) ? response.features : [];
  });
  queue = pending.catch(() => {
    if (cache.get(query)?.pending === pending) cache.delete(query);
  });
  cache.set(query, { pending, expires: Date.now() + 30 * 60 * 1000 });
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  return pending;
}

function matchPlace(features, place) {
  const expected = normalize(place.name);
  const qualified = normalize(placeQuery(place));
  const city = normalize(place.city);
  const candidates = [];
  for (const feature of features) {
    const { geometry, properties } = feature ?? {};
    if (geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates) || !properties?.name) continue;
    const [lon, lat] = geometry.coordinates;
    if (!validCoordinates(lat, lon) ||
        ['construction', 'proposed', 'demolished'].includes(properties.osm_value)) continue;
    const regions = [properties.city, properties.county, properties.state, properties.country].filter(Boolean);
    const regionMatches = !city || regions.some((part) => normalize(part).includes(city));
    const comparableRegion = regions.some((part) => HAN.test(part) === HAN.test(place.city));
    // Photon can return a translated name/address even when it matches a Chinese query.
    const translated = HAN.test(place.name) !== HAN.test(properties.name);
    const name = normalize(properties.name);
    const exact = name === qualified || (name === expected && regionMatches);
    const localNameWithTranslatedRegion = name === expected && !comparableRegion;
    if (exact || localNameWithTranslatedRegion || (translated && (regionMatches || !comparableRegion))) {
      if (translated && place.city && ['city', 'county', 'state', 'country', 'district', 'locality'].includes(properties.type)) continue;
      const parts = [properties.name, properties.district, ...regions];
      candidates.push({ ...place, lat, lon, address: [...new Set(parts.filter(Boolean))].join(' · '),
        exact: exact || localNameWithTranslatedRegion });
    }
  }
  return candidates.find(({ exact }) => exact) ?? candidates[0];
}

export async function resolvePlace(place) {
  if (validCoordinates(place.lat, place.lon)) return place;
  const query = placeQuery(place);
  const compact = HAN.test(query) ? query.replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '') : query;
  try {
    const match = matchPlace(await search(compact), place);
    if (match || compact === query) return match;
    return matchPlace(await search(query), place);
  } catch {
    return undefined;
  }
}
