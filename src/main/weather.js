'use strict';
// Météo réelle : position approximative par IP (ipwho.is), puis conditions
// actuelles chez Open-Meteo (gratuit, sans clé). Tout est optionnel.
const UA = { 'User-Agent': 'Brume/1.0 (projet lycée)' };

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} pour ${url}`);
  return res.json();
}

let cachedLocation = null;

async function locate() {
  if (cachedLocation) return cachedLocation;
  const j = await getJson('https://ipwho.is/');
  if (!j || j.success === false) throw new Error('géolocalisation indisponible');
  cachedLocation = { lat: j.latitude, lon: j.longitude, city: j.city || 'chez toi' };
  return cachedLocation;
}

async function current() {
  const loc = await locate();
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${loc.lat}&longitude=${loc.lon}` +
    '&current=weather_code,is_day,temperature_2m,wind_speed_10m,wind_direction_10m' +
    '&wind_speed_unit=kmh&timezone=auto';
  const j = await getJson(url);
  return { ...toEffect(j.current, loc.lat), city: loc.city, temperature: Math.round(j.current.temperature_2m) };
}

// Saison selon le mois, inversée dans l'hémisphère sud (lat < 0).
function seasonOf(date = new Date(), lat = 45) {
  let m = date.getMonth(); // 0 = janvier
  if (lat < 0) m = (m + 6) % 12;
  return m <= 1 || m === 11 ? 'hiver' : m <= 4 ? 'printemps' : m <= 7 ? 'ete' : 'automne';
}

// Codes météo WMO + saison + jour/nuit + température -> effet Brume.
// Tous les effets peuvent sortir : la pluie, l'orage et la neige suivent le ciel ; quand il
// ne tombe rien, la saison décide (pétales au printemps, feuilles en automne, lucioles
// les nuits douces, étoiles filantes les nuits claires).
function toEffect(c, lat) {
  const code = c.weather_code;
  const temp = c.temperature_2m;
  const night = !c.is_day;
  const season = seasonOf(new Date(), lat);
  const clear = code <= 1; // ciel dégagé
  const fair = code <= 3; // dégagé à couvert, mais sec
  const wet = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  let effect = 'none';
  if ([71, 73, 75, 77, 85, 86].includes(code)) effect = 'snow';
  else if (code >= 95) effect = 'storm';
  else if (wet) effect = temp !== undefined && temp <= 1 ? 'snow' : 'rain'; // pluie froide = neige
  else if (season === 'printemps') {
    if (!night) effect = fair ? 'sakura' : 'none';
    else effect = temp >= 14 ? 'fireflies' : clear ? 'starfall' : 'sakura';
  } else if (season === 'ete') {
    if (night) effect = temp >= 14 ? 'fireflies' : clear ? 'starfall' : 'none';
    else effect = 'none'; // grand soleil : rien ne tombe
  } else if (season === 'automne') {
    if (!night || !clear) effect = temp >= 17 && night ? 'fireflies' : 'leaves';
    else effect = 'starfall';
  } else {
    // Hiver : quelques flocons par grand froid sous un ciel gris, étoiles les nuits claires.
    if (night && clear) effect = 'starfall';
    else if (fair && !clear && temp !== undefined && temp <= -2) effect = 'snow';
  }
  // Direction météo = d'où vient le vent. Composante vers l'est = -sin(direction).
  const toEast = -Math.sin((c.wind_direction_10m * Math.PI) / 180) * c.wind_speed_10m;
  const wind = Math.max(-2, Math.min(2, Math.round(toEast / 18)));
  let intensity = [65, 67, 75, 82, 86, 97, 99].includes(code) ? 'heavy' : [51, 61, 71, 80, 85].includes(code) ? 'light' : 'normal';
  if (effect === 'snow' && !wet && code <= 3) intensity = 'light'; // flocons de grand froid
  return { effect, wind, intensity, code, season };
}

module.exports = { current, toEffect, seasonOf };
