import { requestJson } from './requests.js';

const forecasts = new Map();
const FRESH_MS = 5 * 60 * 1000;
const FORECAST = 'https://api.open-meteo.com/v1/forecast';

export function readWeather(value) {
  const city = typeof value?.city === 'string' ? value.city.trim() : '';
  const days = value?.days ?? 5;
  const date = value?.date;
  if (city.length < 2 || city.length > 100 || !Number.isInteger(days) || days < 1 || days > 7) return null;
  if (date !== undefined && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date))) return null;
  return { city, days, date };
}

function urlWith(endpoint, params) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(params);
  return url;
}

async function fetchWeather({ city, days, date }) {
  const results = await requestJson(urlWith('https://geocoding-api.open-meteo.com/v1/search',
    { name: city, count: '1', language: 'zh', format: 'json' }));
  const place = results?.results?.[0];
  if (!Number.isFinite(place?.latitude) || !Number.isFinite(place?.longitude)) return null;
  const params = {
    latitude: place.latitude, longitude: place.longitude, timezone: 'auto',
    forecast_days: date ? 16 : days,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  };
  if (!date) params.current = 'temperature_2m,weather_code';
  const forecast = await requestJson(urlWith(FORECAST, params));
  return forecast?.daily?.time?.length ? { place, forecast } : null;
}

function getWeather(request) {
  const key = JSON.stringify(request);
  const hit = forecasts.get(key);
  if (hit && hit.expires > Date.now()) return hit.pending;
  const pending = fetchWeather(request).catch(() => null);
  forecasts.set(key, { expires: Date.now() + FRESH_MS, pending });
  if (forecasts.size > 32) forecasts.delete(forecasts.keys().next().value);
  return pending;
}

const CONDITIONS = new Map([
  [[0], '☀ 晴'], [[1, 2], '🌤 少云'], [[3], '☁ 阴'],
  [[45, 48], '🌫 雾'], [[51, 53, 55, 56, 57], '🌦 毛毛雨'],
  [[61, 63, 65, 66, 67, 80, 81, 82], '🌧 雨'],
  [[71, 73, 75, 77, 85, 86], '❄ 雪'], [[95, 96, 99], '⛈ 雷暴'],
].flatMap(([codes, label]) => codes.map((code) => [code, label])));

function appendText(parent, tag, text, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

export async function mountWeather(host, request) {
  const data = await getWeather(request);
  if (!data || !host.isConnected) return;
  const { place, forecast } = data;
  const { daily, current } = forecast;
  const indices = daily.time.map((day, index) => !request.date || day === request.date ? index : -1)
    .filter((i) => i >= 0 && Number.isFinite(daily.temperature_2m_min?.[i]) &&
      Number.isFinite(daily.temperature_2m_max?.[i]));
  if (!indices.length) return;
  const title = [...new Set([place.name, place.admin1, place.country].filter(Boolean))].join(' · ');
  const header = appendText(host, 'div', '', 'dsui-weather-header');
  appendText(header, 'strong', title || request.city);
  if (Number.isFinite(current?.temperature_2m)) {
    appendText(header, 'span', [CONDITIONS.get(current.weather_code), `${Math.round(current.temperature_2m)} °C`]
      .filter(Boolean).join(' '));
  }
  const days = appendText(host, 'ul', '', 'dsui-weather-days');
  for (const i of indices) {
    const day = appendText(days, 'li', '');
    const time = appendText(day, 'time', daily.time[i].slice(5));
    time.dateTime = daily.time[i];
    appendText(day, 'span', CONDITIONS.get(daily.weather_code?.[i]) ?? '—');
    appendText(day, 'span', `${Math.round(daily.temperature_2m_min[i])}–${Math.round(daily.temperature_2m_max[i])} °C`);
    const chance = daily.precipitation_probability_max?.[i];
    if (Number.isFinite(chance)) appendText(day, 'small', `降水 ${chance}%`);
  }
  const footer = appendText(host, 'div', '', 'dsui-weather-source');
  if (current?.time) appendText(footer, 'span', `当地时间 ${current.time.replace('T', ' ')} · `);
  const source = appendText(footer, 'a', 'Open-Meteo ↗');
  source.href = 'https://open-meteo.com/';
  source.target = '_blank';
  source.rel = 'noopener noreferrer';
  host.hidden = false;
}
