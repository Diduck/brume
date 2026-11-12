// Brume — fonds animés lofi.
//
// Tout est calculé dans un shader, en basse résolution (1 « pixel » = 3 × 3 points),
// puis agrandi en pixels nets : c'est l'esthétique lofi, et ça ne coûte presque rien.
// Cinq scènes (ville, café, forêt, bord de mer, chambre), des palettes interchangeables,
// et parfois des animaux : oiseaux, chat, cerf, mouettes, poisson.
(function () {
  'use strict';
  const B = window.Brume;
  const P = window.BRUME_PALETTES;
  const U = B.U;
  const MAX_ANIMALS = 4;

  const lofiFS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uSkyTop, uSkyMid, uHorizon, uSunColor, uCloud, uFar, uMid, uNear, uLight, uNeon;
uniform vec4 uSun;
uniform float uStars;
uniform float uRain;      // nuages bas / ambiance pluvieuse
uniform float uStreaks;   // pluie dessinée par le fond (0 si un effet météo est déjà actif)
uniform int uScene;
uniform vec4 uAnim[${MAX_ANIMALS}];   // x, y (0–1, coin haut gauche), type, image
uniform vec4 uAnimB[${MAX_ANIMALS}];  // sens (±1), échelle (pixels), –, –
out vec4 outColor;

const float PI = 3.14159265;
float A;   // largeur / hauteur
float D;   // seuil de tramage du pixel courant
vec2 PX;   // pixel courant (basse résolution)

float h1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.02 + 3.1; a *= 0.5; }
  return s;
}
float bayer(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.x + q.y * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}
bool box(float x, float y, float x0, float x1, float y0, float y1) { return x > x0 && x < x1 && y > y0 && y < y1; }

/* ---------- Ciel : dégradé, étoiles, soleil ou lune, nuages ---------- */
vec3 sky(float x, float y) {
  float t = clamp(y / 0.7, 0.0, 1.0);
  vec3 col = t < 0.5 ? mix(uSkyTop, uSkyMid, t * 2.0) : mix(uSkyMid, uHorizon, (t - 0.5) * 2.0);
  if (uStars > 0.0 && y < 0.55) {
    float s = h2(floor(PX / 3.0));
    if (s > 0.982 && all(lessThan(mod(PX, 3.0), vec2(1.0)))) {
      float tw = 0.5 + 0.5 * sin(uTime * (0.8 + s * 3.0) + s * 60.0);
      col = mix(col, vec3(1.0, 0.97, 0.9), tw * uStars * (1.0 - y / 0.55));
    }
  }
  vec2 sp = vec2(uSun.x * A, uSun.y);
  float r = length(vec2(x, y) - sp);
  if (uSun.w >= 0.0 && uSun.z > 0.0) {
    col += uSunColor * 0.35 * exp(-(r * r) / (uSun.z * uSun.z * 10.0));
    if (r < uSun.z) {
      if (uSun.w > 0.5) {
        if (length(vec2(x, y) - sp - vec2(uSun.z * 0.42, -uSun.z * 0.22)) > uSun.z * 0.92) col = uSunColor;
      } else {
        float k = (y - sp.y) / uSun.z;
        float band = fract((y - sp.y) * 34.0 - uTime * 0.05);
        if (k < 0.0 || band > 0.18 + k * 0.45) col = mix(uSunColor, uHorizon, 0.25 + 0.35 * max(k, 0.0));
      }
    }
  }
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float drift = uTime * (0.008 + fk * 0.005);
    float cn = fbm(vec2(x * (1.6 + fk * 0.8) + drift + fk * 9.0, y * 7.0));
    float band = 1.0 - smoothstep(0.0, 0.12 + uRain * 0.2, abs(y - (0.3 - fk * 0.15) + 0.04 * sin(x * 2.0 + fk)));
    if (smoothstep(0.5 - uRain * 0.18, 0.58 - uRain * 0.18, cn * (0.6 + 0.6 * band)) > D) {
      float lit = smoothstep(0.62, 0.5, fbm(vec2(x * (1.6 + fk * 0.8) + drift + fk * 9.0, (y - 0.012) * 7.0)));
      col = mix(mix(uCloud, mix(uCloud, uSunColor, 0.35), lit * step(0.0, uSun.w)), uSkyTop, fk * 0.35);
    }
  }
  return col;
}

/* ---------- Ville : montagnes, deux rangées d'immeubles, fenêtres allumées ---------- */
vec3 city(vec3 col, float x, float y) {
  float hill = 0.6 + 0.09 * fbm(vec2(x * 0.9, 5.0)) - 0.05 * abs(sin(x * 1.7 + 0.6));
  if (y > hill) col = mix(uFar, uHorizon, 0.28);
  float bw2 = 0.026;
  float id2 = floor((x + 0.013) / bw2);
  float hb2 = h1(id2 + 31.0);
  if (y > 0.8 - pow(hb2, 1.6) * 0.2) {
    col = mix(uMid, uFar, 0.55);
    if (all(lessThan(mod(PX, vec2(4.0, 5.0)), vec2(1.0))) && h2(floor(PX / vec2(4.0, 5.0)) + id2 * 7.0) > 0.82) col = mix(col, uLight, 0.45);
  }
  float bw = 0.032;
  float id = floor(x / bw);
  float hb = h1(id + 7.0);
  float top = 0.85 - pow(hb, 2.2) * 0.16;
  if (y > top) {
    col = uMid;
    vec2 cellPx = mod(PX, vec2(4.0, 5.0));
    float lx = fract(x / bw);
    if (cellPx.x < 2.0 && cellPx.y < 2.0 && lx > 0.12 && lx < 0.88 && y > top + 0.012) {
      float seed = h2(floor(PX / vec2(4.0, 5.0)) + id * 13.0);
      float on = step(0.62, fract(seed + floor(uTime / (18.0 + seed * 40.0)) * 0.37));
      vec3 lamp = seed > 0.93 && uRain > 0.5 ? mix(uNeon, vec3(0.3, 0.9, 1.0), step(0.965, seed)) : uLight;
      col = mix(col, lamp, on * (0.75 + 0.25 * seed));
    }
    if (hb > 0.86 && abs(lx - 0.5) < 0.04 && abs(y - top + 0.008) < 0.006) col = mix(col, vec3(1.0, 0.25, 0.25), step(0.5, fract(uTime * 0.5 + hb)));
  }
  return col;
}

vec3 rainStreaks(vec3 col, vec2 uv) {
  if (uStreaks <= 0.0) return col;
  float lane = floor((PX.x + PX.y * 0.35) / 3.0);
  float pos = fract(uv.y * 1.6 + uTime * (0.9 + h1(lane) * 0.6) + h1(lane + 3.0));
  if (pos < 0.035 && h1(lane + 9.0) > 0.55) col = mix(col, vec3(0.75, 0.85, 0.95), 0.35 * uStreaks);
  return col;
}

// Ampoules d'une guirlande en chaînette entre x0 et x1.
vec3 garland(vec3 col, float x, float y, float x0, float x1, float y0, float sag) {
  if (x < x0 || x > x1) return col;
  float u = (x - x0) / (x1 - x0);
  if (abs(y - (y0 + sag * sin(u * PI))) < 0.0022) col = mix(col, uNear, 0.85);
  float step_ = 0.035;
  float id = floor((x - x0) / step_);
  float bx = x0 + (id + 0.5) * step_;
  float by = y0 + sag * sin((bx - x0) / (x1 - x0) * PI) + 0.009;
  vec3 c = mix(uLight, uNeon, step(0.6, h1(id + 4.0)));
  float br = length(vec2(x - bx, y - by));
  float tw = 0.65 + 0.35 * sin(uTime * (1.0 + h1(id) * 1.5) + id);
  if (br < 0.0065) col = c * tw;
  col += c * 0.16 * tw * exp(-br * br / 0.0007);
  return col;
}

/* ---------- Scène 0 : ville ---------- */
vec3 sceneCity(float x, float y, vec2 uv) {
  vec3 col = city(sky(x, y), x, y);
  float trainX = (fract(uTime / 40.0) * 1.8 - 0.4) * A;
  if (y > 0.875 && y < 0.902 && x > trainX && x < trainX + 0.3) {
    col = mix(uNear, uMid, 0.6);
    if (y > 0.881 && y < 0.893 && mod(PX.x, 6.0) < 3.0) col = uLight;
  }
  if (abs(y - 0.905) < 0.004) col = uNear;
  if (y > 0.93 + 0.018 * sin(x * 4.0 + 1.0) + 0.01 * step(0.5, fract(x * 3.1))) col = uNear;
  return rainStreaks(col, uv);
}

/* ---------- Scène 1 : café ---------- */
vec3 sceneCafe(float x, float y, vec2 uv) {
  float wx0 = 0.2 * A, wx1 = 0.8 * A, wy0 = 0.1, wy1 = 0.66;
  vec3 col;
  if (box(x, y, wx0, wx1, wy0, wy1)) {
    float yv = (y - wy0) / (wy1 - wy0);
    col = rainStreaks(city(sky(x, yv), x, yv), uv);
    col += vec3(0.05) * step(0.94, fract((x - y) * 2.5)); // reflet sur la vitre
  } else {
    col = uMid * (0.9 + 0.1 * step(0.5, fract(x * 11.0)));     // lambris
  }
  // Lumière chaude de la suspension sur le mur et la vitre.
  float lx = 0.1 * A;
  float lr = length(vec2(x - lx, (y - 0.27) * 1.3));
  col += uLight * 0.3 * exp(-lr * lr / 0.035);
  // Cadre et croisillons de la fenêtre.
  float fw = 0.011;
  bool frame = box(x, y, wx0 - fw, wx1 + fw, wy0 - fw, wy1 + fw) && !box(x, y, wx0, wx1, wy0, wy1);
  bool mull = box(x, y, wx0, wx1, wy0, wy1) && (abs(x - (wx0 + wx1) * 0.5) < fw * 0.6 || abs(y - (wy0 + (wy1 - wy0) * 0.42)) < fw * 0.6);
  if (frame || mull) col = uNear;
  col = garland(col, x, y, wx0, wx1, wy0 - 0.045, 0.03);
  // Suspension : fil, abat-jour, ampoule.
  if (abs(x - lx) < 0.0018 && y < 0.2) col = uNear;
  if (y > 0.2 && y < 0.255 && abs(x - lx) < mix(0.014, 0.042, (y - 0.2) / 0.055)) col = mix(uNear, uLight, 0.22);
  if (y > 0.255 && y < 0.268 && abs(x - lx) < 0.012) col = uLight;
  // Comptoir en bois.
  float ct = 0.74;
  if (y > ct) {
    col = uFar * (0.9 + 0.08 * step(0.5, fract(y * 48.0)));            // veinage horizontal
    if (fract(x * 3.2 + 0.3) < 0.006) col *= 0.8;                       // joints des planches
    if (y < ct + 0.012) col = mix(uFar, uLight, 0.28);
    col += uLight * 0.12 * exp(-pow(x - lx, 2.0) / 0.06);
  }
  // Tasse qui fume.
  float mx = 0.62 * A, mw = 0.046, mh = 0.072, mt = ct - mh;
  vec3 mug = vec3(0.93, 0.9, 0.86);
  if (box(x, y, mx - mw * 0.5, mx + mw * 0.5, mt, ct)) col = mix(mug, uMid, 0.25 * step(x, mx - mw * 0.25));
  float hr = length(vec2(x - (mx + mw * 0.5), y - (mt + mh * 0.45)));
  if (hr < 0.018 && hr > 0.009 && x > mx + mw * 0.5) col = mug;
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float sx = mx - 0.01 + fk * 0.02 + 0.011 * sin(y * 38.0 + uTime * 1.6 + fk * 2.0);
    float sy0 = mt - 0.17;
    if (y < mt - 0.006 && y > sy0 && abs(x - sx) < 0.0035) {
      float f = (y - sy0) / (mt - sy0);
      if (f * (0.55 + 0.45 * vnoise(vec2(x * 50.0, y * 20.0 + uTime))) > D) col = mix(col, vec3(1.0), 0.32 * f);
    }
  }
  // Pile de livres.
  float bx = 0.82 * A;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float by1 = ct - fk * 0.022, by0 = by1 - 0.02;
    float off = (h1(fk + 2.0) - 0.5) * 0.02;
    if (box(x, y, bx - 0.05 + off, bx + 0.05 + off, by0, by1)) col = mix(vec3(0.55, 0.28, 0.25), vec3(0.3, 0.42, 0.5), h1(fk + 7.0)) * 0.9;
  }
  // Plante en pot.
  float px0 = 0.06 * A;
  if (box(x, y, px0 - 0.028, px0 + 0.028, ct - 0.07, ct)) col = mix(uFar, vec3(0.78, 0.42, 0.28), 0.6);
  if (y < ct - 0.07 && y > ct - 0.25) {
    float leaf = fbm(vec2(x * 30.0, y * 18.0));
    float shape = (y - (ct - 0.25)) / 0.18;
    if (abs(x - px0) < 0.07 * shape + 0.01 && leaf > 0.42) col = mix(vec3(0.2, 0.36, 0.27), vec3(0.32, 0.5, 0.34), step(0.6, leaf));
  }
  return col;
}

/* ---------- Scène 2 : forêt, montagnes et lac ---------- */
vec3 trees(vec3 col, float x, float y) {
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float w = 0.03 + fk * 0.014;
    float base = 0.66 + fk * 0.022;
    float id = floor(x / w);
    float hh = 0.07 + h1(id + fk * 31.0) * 0.09 + fk * 0.025;
    float cx = (id + 0.5) * w + (h1(id + 9.0 + fk) - 0.5) * w * 0.35;
    float top = base - hh;
    if (y > top && y < 0.72) {
      float t = clamp((y - top) / hh, 0.0, 1.0);
      float halfW = w * 0.55 * (0.2 + 0.8 * t) * (0.65 + 0.35 * fract(t * 3.0));
      if (abs(x - cx) < halfW || y > base) col = mix(uMid, uNear, fk * 0.5);
    }
  }
  return col;
}

vec3 sceneForest(float x, float y, vec2 uv) {
  float shore = 0.7;
  float yy = y > shore ? shore - (y - shore) * 1.1 : y; // reflet dans le lac
  float xx = x + (y > shore ? 0.004 * sin(y * 260.0 + uTime * 1.8) : 0.0);
  vec3 col = sky(xx, yy);
  if (yy > 0.42 + 0.12 * fbm(vec2(xx * 0.8, 1.0))) col = mix(uFar, uHorizon, 0.32);
  if (yy > 0.52 + 0.07 * fbm(vec2(xx * 1.4, 7.0))) col = mix(uFar, uSkyTop, 0.3);
  col = trees(col, xx, yy);
  float fog = fbm(vec2(xx * 2.0 + uTime * 0.01, yy * 10.0));
  if (abs(yy - 0.62) < 0.05 && fog > 0.55 + D * 0.15) col = mix(col, uHorizon, 0.18);
  if (y > shore) {
    col = mix(col, uSkyTop, 0.4) * 0.85;
    if (fract((y - shore) * 70.0 - uTime * 0.25 + h1(floor(x * 25.0)) * 3.0) < 0.07) col = mix(col, uHorizon, 0.2);
    if (abs(y - shore) < 0.004) col = uNear;
  }
  // Lucioles au bord de l'eau (la nuit).
  if (uStars > 0.5) {
    vec2 cell = floor(PX / 9.0);
    float s = h2(cell + 17.0);
    if (s > 0.9) {
      vec2 c = (cell + 0.5) * 9.0 + vec2(sin(uTime * 0.7 + s * 40.0), cos(uTime * 0.9 + s * 30.0)) * 3.0;
      float yc = 1.0 - c.y / uRes.y;
      float blink = max(0.0, sin(uTime * (0.8 + s) + s * 50.0));
      if (yc > 0.6 && yc < 0.76 && length(PX - c) < 1.2) col = mix(col, uLight, blink);
      else if (yc > 0.6 && yc < 0.76) col += uLight * 0.15 * blink * exp(-dot(PX - c, PX - c) / 6.0);
    }
  }
  // Roseaux au premier plan.
  if (y > 0.93 + 0.02 * sin(x * 5.0)) col = uNear;
  if (y > 0.84 && mod(PX.x + floor(h1(floor(PX.x / 2.0)) * 5.0), 7.0) < 1.0 && y > 0.93 - 0.09 * h1(floor(PX.x / 7.0) + 3.0)) col = uNear;
  return rainStreaks(col, uv);
}

/* ---------- Scène 3 : bord de mer et phare ---------- */
vec3 sceneSea(float x, float y, vec2 uv) {
  vec3 col = sky(x, y);
  float hz = 0.56;
  if (y > hz) {
    float dy = y - hz;
    col = mix(uFar, uSkyTop, 0.15) * (1.0 - dy * 0.5);
    float sx = uSun.x * A;
    float wr = uSun.z * 1.3 + dy * 0.3;
    if (uSun.w >= 0.0 && abs(x - sx) < wr) {
      float row = floor(dy * 90.0);
      if (fract(dy * 90.0 - uTime * 0.6 + h1(row) * 3.0) < 0.5 && h2(vec2(floor(x * 70.0), row)) > 0.3) col = mix(col, uSunColor, 0.7 * (1.0 - abs(x - sx) / wr));
    }
    if (fract(dy * 45.0 + sin(x * 6.0 + uTime * 0.5) * 0.3) < 0.07 && h2(floor(PX / vec2(6.0, 1.0))) > 0.5) col = mix(col, uHorizon, 0.25);
  }
  // Falaise et phare.
  float cliff = mix(0.7, 0.46, smoothstep(0.7 * A, 0.86 * A, x)) + 0.025 * fbm(vec2(x * 9.0, 3.0));
  float face = 0.62 * A + (0.95 - y) * 0.22 + 0.03 * fbm(vec2(y * 12.0, 1.0));
  if (x > face && y > cliff) col = mix(uMid, uNear, step(0.55, fbm(vec2(x * 14.0, y * 14.0))) * 0.35);
  float lhx = 0.88 * A;
  if (box(x, y, lhx - 0.013, lhx + 0.013, 0.31, 0.46)) col = mix(vec3(0.82, 0.3, 0.32), vec3(0.94, 0.92, 0.88), step(0.5, fract(y * 28.0))) * 0.8;
  if (box(x, y, lhx - 0.017, lhx + 0.017, 0.288, 0.312)) col = uLight;
  if (box(x, y, lhx - 0.02, lhx + 0.02, 0.276, 0.29)) col = uNear;
  float side = cos(uTime * 1.1);
  vec2 v = vec2(x - lhx, y - 0.3);
  if (v.x * side > 0.0 && abs(v.y) < abs(v.x) * 0.07 + 0.006) col += uLight * 0.4 * pow(abs(side), 3.0) * exp(-abs(v.x) * 2.5);
  // Plage et écume qui va et vient.
  float shoreY = 0.87 + 0.02 * sin(x * 3.0) + 0.01 * sin(uTime * 0.6);
  if (y > shoreY && x < 0.8 * A + (y - 0.87) * 2.0) col = mix(uHorizon, uCloud, 0.38);
  if (abs(y - shoreY) < 0.004 && x < 0.8 * A) col = mix(col, vec3(1.0), 0.7);
  return rainStreaks(col, uv);
}

/* ---------- Scène 4 : chambre la nuit ---------- */
vec3 sceneRoom(float x, float y, vec2 uv) {
  float wx0 = 0.52 * A, wx1 = 0.9 * A, wy0 = 0.12, wy1 = 0.6;
  vec3 col;
  if (box(x, y, wx0, wx1, wy0, wy1)) {
    float yv = (y - wy0) / (wy1 - wy0);
    col = rainStreaks(city(sky(x, yv), x, yv), uv);
  } else {
    col = uMid * (0.94 + 0.06 * step(0.5, fract(x * 26.0)));
  }
  float fw = 0.011;
  bool frame = box(x, y, wx0 - fw, wx1 + fw, wy0 - fw, wy1 + fw) && !box(x, y, wx0, wx1, wy0, wy1);
  bool mull = box(x, y, wx0, wx1, wy0, wy1) && (abs(x - (wx0 + wx1) * 0.5) < fw * 0.6 || abs(y - (wy0 + wy1) * 0.5) < fw * 0.6);
  if (frame || mull) col = uNear;
  // Rideaux.
  for (int k = 0; k < 2; k++) {
    float cxr = k == 0 ? wx0 - 0.015 : wx1 + 0.015;
    if (abs(x - cxr) < 0.03 && y > wy0 - 0.03 && y < wy1 + 0.08) col = mix(uSkyMid, uMid, 0.35 + 0.25 * step(0.5, fract(x * 90.0)));
  }
  // Affiche au mur.
  if (box(x, y, 0.12 * A, 0.27 * A, 0.16, 0.4)) {
    col = uNear;
    if (box(x, y, 0.125 * A, 0.265 * A, 0.168, 0.392)) col = mix(uHorizon, uSkyMid, (y - 0.168) / 0.224);
    if (box(x, y, 0.125 * A, 0.265 * A, 0.33, 0.392)) col = uFar;
  }
  col = garland(col, x, y, 0.04 * A, 0.96 * A, 0.04, 0.035);
  // Bureau.
  float dt = 0.68;
  float lap = 0.36 * A;
  float glow = length(vec2(x - lap, (y - 0.6) * 1.4));
  col += uNeon * 0.12 * exp(-glow * glow / 0.02);
  if (y > dt) col = y < dt + 0.016 ? mix(uFar, uLight, 0.2) : uFar * 0.75;
  if (y > dt + 0.016 && (abs(x - 0.1 * A) < 0.01 || abs(x - 0.9 * A) < 0.01)) col = uNear;
  // Ordinateur portable.
  if (box(x, y, lap - 0.07, lap + 0.07, 0.565, dt - 0.006)) {
    col = uNeon * 0.8;
    if (fract((y - 0.565) * 70.0) < 0.35 && fract(x * 9.0 + h1(floor((y - 0.565) * 70.0))) < 0.6) col = uNeon * 0.45;
  }
  if (box(x, y, lap - 0.085, lap + 0.085, dt - 0.006, dt)) col = uNear;
  // Lampe de bureau et son cône de lumière.
  float lpx = 0.16 * A;
  if (abs(x - lpx) < 0.004 && y > 0.56 && y < dt) col = uNear;
  if (box(x, y, lpx - 0.03, lpx + 0.012, 0.535, 0.56)) col = mix(uNear, uLight, 0.3);
  if (y > 0.56 && y < dt && abs(x - lpx + 0.01) < (y - 0.56) * 0.55) col = mix(col, uLight, 0.07 * (1.0 - (y - 0.56) / 0.14));
  // Plante sur le bureau.
  float pl = 0.75 * A;
  if (box(x, y, pl - 0.02, pl + 0.02, dt - 0.05, dt)) col = mix(uFar, vec3(0.7, 0.4, 0.3), 0.5);
  if (y < dt - 0.05 && y > dt - 0.17 && abs(x - pl) < 0.05 * (y - (dt - 0.17)) / 0.12 + 0.008 && fbm(vec2(x * 30.0, y * 18.0)) > 0.45) col = vec3(0.2, 0.34, 0.3);
  return col;
}

/* ---------- Scène 5 : terrasse de nuit, sous un lampadaire ----------
 * La scène la plus détaillée : un vrai modèle d'éclairage. La lumière du lampadaire
 * décroît avec la distance, en paliers tramés (le rendu « peint » du pixel art), et
 * éclaire tout ce qui l'entoure : feuillage, pavés, rambarde, façade. */
vec2 LAMP;

// Intensité de la lampe en (x, y), quantifiée en paliers avec tramage.
float lamp(float x, float y, float reach) {
  float d = length(vec2(x, y) - LAMP);
  float i = 1.0 / (1.0 + d * d / (reach * reach));
  return floor(i * 6.0 + D * 0.95) / 6.0;
}

// Ombrage d'une surface : lumière ambiante bleue de la nuit + lumière chaude de la lampe.
vec3 lit(vec3 base, float x, float y, float reach, float amount) {
  float l = lamp(x, y, reach);
  return base * (0.75 + 0.25 * uSkyMid / max(base, vec3(0.05))) * 0.85 + base * uLight * l * amount * 2.2 + uLight * l * l * amount * 0.18;
}

float foliage(float x, float y) {
  return fbm(vec2(x * 13.0, y * 13.0)) * 0.75 + vnoise(vec2(x * 46.0, y * 46.0)) * 0.35;
}

vec3 sceneTerrace(float x, float y, vec2 uv) {
  LAMP = vec2(0.71 * A, 0.2);
  vec3 col = sky(x, y);
  // Brume cyan à l'horizon, derrière la ville.
  col = mix(col, uHorizon, smoothstep(0.24, 0.42, y) * (1.0 - smoothstep(0.42, 0.56, y)) * 0.55);

  // Ville lointaine sur deux plans : le fond pâle dans la brume, le devant plus sombre.
  float bw2 = 0.02;
  float id2 = floor(x / bw2);
  if (y > 0.47 - pow(h1(id2 + 51.0), 1.6) * 0.17) {
    col = mix(uFar, uHorizon, 0.4);
    if (all(lessThan(mod(PX, vec2(3.0, 4.0)), vec2(1.0))) && h2(floor(PX / vec2(3.0, 4.0)) + id2) > 0.9) col = mix(col, uNeon, 0.4);
  }
  float bw = 0.034;
  float id = floor(x / bw);
  float top = 0.6 - pow(h1(id + 77.0), 2.0) * 0.21;
  if (y > top) {
    col = mix(uMid, uFar, 0.5);
    if (fract(x / bw) < 0.08) col *= 0.85; // arête de l'immeuble
    vec2 cw = mod(PX, vec2(4.0, 5.0));
    if (cw.x < 2.0 && cw.y < 2.0 && y > top + 0.01 && h2(floor(PX / vec2(4.0, 5.0)) + id * 3.0) > 0.72) col = mix(col, uNeon, 0.7);
  }
  // Pylônes et fils électriques.
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float px0 = (0.12 + fk * 0.36) * A;
    if (abs(x - px0) < 0.0028 && y > 0.3 && y < 0.62) col = mix(uMid, uFar, 0.4);
    float u = fract((x - 0.12 * A) / (0.36 * A));
    for (int w = 0; w < 2; w++) {
      float wy = 0.31 + float(w) * 0.025 + 0.035 * sin(u * PI);
      if (abs(y - wy) < 0.0016 && x > 0.12 * A && x < 0.84 * A) col = mix(uMid, uFar, 0.3);
    }
  }

  // Rambarde de la terrasse.
  float railTop = 0.625, railBot = 0.8;
  if (x > 0.24 * A && y > railTop && y < railBot) {
    bool bar = mod(PX.x, 9.0) < 2.0;
    bool rail = y < railTop + 0.012 || abs(y - 0.765) < 0.006;
    if (bar || rail) col = lit(uMid, x, y, 0.16, 0.9);
  }

  // Façade de gauche : mur, fenêtres chaudes, auvent rayé, enseigne.
  float facade = 0.22 * A + 0.01 * step(0.5, fract(y * 3.0));
  if (x < facade) {
    col = lit(mix(uMid, uNear, 0.35), x, y, 0.3, 0.25);
    if (fract(y * 60.0) < 0.08) col *= 0.9; // rangées de briques
    for (int fl = 0; fl < 3; fl++) {
      float wy0 = 0.08 + float(fl) * 0.2;
      for (int c = 0; c < 2; c++) {
        float wx0 = 0.03 * A + float(c) * 0.09 * A;
        if (box(x, y, wx0, wx0 + 0.055 * A, wy0, wy0 + 0.13)) {
          float lampOn = step(0.25, h1(float(fl * 2 + c) + floor(uTime / 23.0)));
          vec3 inside = mix(uNeon, uLight, (y - wy0) / 0.13);
          col = mix(mix(uNear, uMid, 0.5), inside, lampOn);
          if (abs(x - (wx0 + 0.0275 * A)) < 0.003 || abs(y - (wy0 + 0.065)) < 0.004) col = uNear; // croisillons
          if (lampOn > 0.5 && y > wy0 + 0.095 && fbm(vec2(x * 60.0, 3.0)) > 0.5) col = mix(col, vec3(0.3, 0.5, 0.32), 0.7); // plantes au rebord
        }
      }
    }
    // Lueur des fenêtres sur la façade.
    col += uNeon * 0.05;
  }
  float awY = 0.665;
  if (x < facade + 0.06 * A && y > awY && y < awY + 0.035) col = mix(mix(vec3(0.62, 0.2, 0.22), vec3(0.9, 0.86, 0.78), step(0.5, fract(x * 22.0))), uNear, 0.35);
  if (box(x, y, 0.06 * A, 0.12 * A, 0.72, 0.8)) { // ardoise du menu
    col = mix(uNear, uMid, 0.3);
    if (box(x, y, 0.065 * A, 0.115 * A, 0.728, 0.792) && fract((y - 0.728) * 90.0) < 0.3 && h1(floor((y - 0.728) * 90.0)) > 0.25) col = mix(col, vec3(0.9), 0.55);
  }

  // Arbre en arche : canopée en haut à droite qui retombe le long du bord.
  float edge = 0.36 + 0.42 * smoothstep(0.8 * A, 0.98 * A, x) - 0.12 * smoothstep(0.62 * A, 0.45 * A, x);
  float n = foliage(x, y);
  if (y < edge && x > 0.42 * A && n + smoothstep(0.0, 0.08, edge - y) * 0.5 > 0.78) {
    vec2 toLamp = normalize(LAMP - vec2(x, y));
    float n2 = foliage(x + toLamp.x * 0.006, y + toLamp.y * 0.006);
    float face = step(n2, n); // feuilles tournées vers la lampe
    float l = lamp(x, y, 0.085);
    vec3 dark = vec3(0.03, 0.08, 0.1);
    vec3 midT = vec3(0.06, 0.15, 0.16);
    vec3 warm = mix(vec3(0.5, 0.28, 0.1), uLight, 0.55);
    col = mix(dark, midT, step(0.88, n) * (0.5 + 0.5 * face));
    col = mix(col, warm, clamp(l * (0.25 + 1.2 * face), 0.0, 1.0));
  }
  // Tronc qui descend à droite.
  if (abs(x - (0.93 * A + 0.02 * sin(y * 6.0))) < 0.018 && y > 0.3) col = lit(vec3(0.12, 0.09, 0.08), x, y, 0.2, 0.6);

  // Lampadaire : mât, crosse, lanterne et halo en anneaux.
  if (abs(x - LAMP.x) < 0.005 && y > LAMP.y && y < 0.86) col = lit(mix(uNear, uMid, 0.4), x, y, 0.08, 1.0);
  if (box(x, y, LAMP.x - 0.016, LAMP.x + 0.016, LAMP.y - 0.04, LAMP.y + 0.012)) col = mix(uLight, vec3(1.0, 0.97, 0.85), 0.5);
  if (box(x, y, LAMP.x - 0.02, LAMP.x + 0.02, LAMP.y - 0.052, LAMP.y - 0.04)) col = uNear;
  float dl = length(vec2(x, y) - LAMP);
  col += uLight * floor(exp(-dl * dl / 0.004) * 4.0 + D * 0.5) / 4.0 * 0.35;

  // Pavés : lignes en perspective, flaque de lumière sous le lampadaire.
  float floorY = 0.82;
  if (y > floorY) {
    float depth = (y - floorY) / (1.0 - floorY);
    float u = (x - 0.5 * A) / (0.25 + depth);
    float grid = step(fract(u * 9.0), 0.06) + step(fract(depth * depth * 14.0 + 0.2), 0.1);
    vec3 stone = mix(uMid, uFar, 0.3) * (1.0 - 0.3 * min(grid, 1.0));
    float pool = lamp(x, LAMP.y + (y - floorY) * 0.9, 0.16);
    col = stone * (0.95 - pool * 0.3) + uLight * pool * 0.42; // la lumière s'ajoute : flaque chaude
    if (y < floorY + 0.006) col = uNear;
  }

  // Lucioles dorées qui flottent autour de l'arbre et de la lampe.
  vec2 cell = floor(PX / 11.0);
  float s = h2(cell + 3.0);
  if (s > 0.86) {
    float t = uTime * (0.08 + s * 0.06) + s * 7.0;
    vec2 c = (cell + vec2(0.5 + 0.4 * sin(t * 6.0), fract(t))) * 11.0;
    float yc = 1.0 - c.y / uRes.y;
    float xc = c.x / uRes.y;
    float near = 1.0 - smoothstep(0.1, 0.45, length(vec2(xc, yc) - LAMP));
    if (length(PX - c) < 1.0 && near > 0.0) col = mix(col, vec3(1.0, 0.8, 0.45), 0.85 * near);
  }

  return rainStreaks(col, uv);
}

/* ---------- Animaux (sprites en silhouette) ---------- */
const int BIRD0[3] = int[3](17, 10, 4);
const int BIRD1[3] = int[3](4, 10, 17);
const int CATW0[7] = int[7](2560, 3586, 7681, 2045, 2046, 2580, 2580);
const int CATW1[7] = int[7](2560, 3586, 7681, 2045, 2046, 1320, 1320);
const int DEER0[10] = int[10](1280, 1536, 1792, 3840, 897, 255, 127, 165, 165, 165);
const int DEER1[10] = int[10](1280, 1536, 1792, 3840, 897, 255, 127, 330, 330, 330);
const int FISH[3] = int[3](22, 31, 22);
const int CATS0[4] = int[4](10, 255, 511, 254);
const int CATS1[4] = int[4](10, 255, 511, 510);

ivec2 spriteSize(int t) {
  if (t == 1) return ivec2(5, 3);
  if (t == 2) return ivec2(13, 7);
  if (t == 3) return ivec2(12, 10);
  if (t == 4) return ivec2(5, 3);
  return ivec2(9, 4);
}
int spriteRow(int t, int f, int r) {
  if (t == 1) return f == 0 ? BIRD0[r] : BIRD1[r];
  if (t == 2) return f == 0 ? CATW0[r] : CATW1[r];
  if (t == 3) return f == 0 ? DEER0[r] : DEER1[r];
  if (t == 4) return FISH[r];
  return f == 0 ? CATS0[r] : CATS1[r];
}
bool animal() {
  for (int i = 0; i < ${MAX_ANIMALS}; i++) {
    int t = int(uAnim[i].z + 0.5);
    if (t == 0) continue;
    float s = uAnimB[i].y;
    vec2 origin = vec2(uAnim[i].x * uRes.x, (1.0 - uAnim[i].y) * uRes.y);
    ivec2 sz = spriteSize(t);
    int cx = int(floor((PX.x - origin.x) / s));
    int cy = int(floor((origin.y - PX.y - 0.5) / s));
    if (cx < 0 || cy < 0 || cx >= sz.x || cy >= sz.y) continue;
    if (uAnimB[i].x < 0.0) cx = sz.x - 1 - cx;
    if (((spriteRow(t, int(uAnim[i].w + 0.5), cy) >> cx) & 1) == 1) return true;
  }
  return false;
}

void main() {
  PX = floor(gl_FragCoord.xy);
  vec2 uv = gl_FragCoord.xy / uRes;
  float y = 1.0 - uv.y;
  A = uRes.x / uRes.y;
  float x = uv.x * A;
  D = bayer(PX);

  vec3 col;
  if (uScene == 1) col = sceneCafe(x, y, uv);
  else if (uScene == 2) col = sceneForest(x, y, uv);
  else if (uScene == 3) col = sceneSea(x, y, uv);
  else if (uScene == 4) col = sceneRoom(x, y, uv);
  else if (uScene == 5) col = sceneTerrace(x, y, uv);
  else col = sceneCity(x, y, uv);

  if (animal()) col = uNear * 0.8;

  col = floor(col * 24.0 + D) / 24.0;
  col += (h2(PX + floor(uTime * 12.0)) - 0.5) * 0.035;
  vec2 v = uv - 0.5;
  col *= 1.0 - dot(v, v) * 0.45;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

  B.shaders.lofiFS = lofiFS;
  B.MAX_ANIMALS = MAX_ANIMALS;

  /* ---------- Animaux : qui apparaît, quand, et où ----------
   * Coordonnées normalisées : x de 0 à 1 sur la largeur, y de 0 à 1 depuis le haut
   * (coin haut gauche du sprite). Échelle en pixels lofi. */
  const SIZE = { 1: [5, 3], 2: [13, 7], 3: [12, 10], 4: [5, 3], 5: [9, 4] };

  class Fauna {
    constructor() {
      this.list = [];
      this.next = U.rand(5, 12);
    }

    update(dt, scene, lowW, lowH) {
      this.lowW = lowW;
      this.lowH = lowH;
      this.next -= dt;
      if (this.next <= 0 && this.list.length < 2) {
        this.spawn(scene);
        this.next = U.rand(20, 50);
      }
      for (let i = this.list.length - 1; i >= 0; i--) {
        const a = this.list[i];
        a.t += dt;
        if (a.gravity) a.vy += a.gravity * dt;
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.frame = Math.floor(a.t * a.fps) % 2;
        if (a.t > a.life || a.x < -0.25 || a.x > 1.25 || a.y > 1.2) this.list.splice(i, 1);
      }
    }

    // Place un sprite pour que ses pieds touchent la ligne sol (y normalisé).
    onGround(type, scale, ground) {
      return ground - (SIZE[type][1] * scale) / this.lowH;
    }

    add(type, scale, x, y, vx, vy, opts = {}) {
      const dir = vx < 0 ? -1 : 1;
      this.list.push({ type, scale, x, y, vx, vy, dir, t: 0, frame: 0, fps: opts.fps || 4, life: opts.life || 120, gravity: opts.gravity || 0, followers: opts.followers });
    }

    birds(y, scale) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const x0 = dir > 0 ? -0.08 : 1.08;
      const vx = dir * U.rand(0.035, 0.055);
      for (let k = 0; k < 3; k++) this.add(1, scale, x0 - dir * k * 0.025, y + (k % 2) * 0.02 + k * 0.006, vx, 0, { fps: 3 + k * 0.4 });
    }

    spawn(scene) {
      const roll = Math.random();
      const dirX = () => (Math.random() < 0.5 ? 1 : -1);
      if (scene === 0) {
        if (roll < 0.55) this.birds(U.rand(0.18, 0.36), 1);
        else {
          const d = dirX();
          this.add(2, 2, d > 0 ? -0.05 : 1.02, this.onGround(2, 2, 0.928), d * 0.018, 0, { fps: 3 });
        }
      } else if (scene === 1) {
        this.add(5, 3, U.rand(0.36, 0.5), this.onGround(5, 3, 0.74), 0, 0, { fps: 0.4, life: U.rand(50, 110) });
      } else if (scene === 2) {
        if (roll < 0.5) this.birds(U.rand(0.12, 0.3), 1);
        else {
          const d = dirX();
          this.add(3, 2, d > 0 ? -0.06 : 1.02, this.onGround(3, 2, 0.705), d * 0.014, 0, { fps: 2.5 });
        }
      } else if (scene === 3) {
        if (roll < 0.65) this.birds(U.rand(0.15, 0.4), 2);
        else this.add(4, 2, U.rand(0.15, 0.6), 0.7, U.rand(0.02, 0.04), -0.22, { gravity: 0.5, life: 1.2 });
      } else if (scene === 5) {
        // Un chat se promène sur la rambarde.
        const d = Math.random() < 0.5 ? 1 : -1;
        this.add(2, 2, d > 0 ? 0.24 : 1.0, this.onGround(2, 2, 0.627), d * 0.016, 0, { fps: 3, life: 70 });
      } else if (roll < 0.5) {
        this.add(5, 3, U.rand(0.55, 0.7), this.onGround(5, 3, 0.68), 0, 0, { fps: 0.4, life: U.rand(50, 110) });
      } else {
        this.add(2, 2, 0.5, this.onGround(2, 2, 0.6), 0.012, 0, { fps: 3, life: 40 });
      }
    }

    // Remplit les tableaux d'uniformes (au plus MAX_ANIMALS animaux).
    uniforms(outA, outB) {
      outA.fill(0);
      outB.fill(0);
      this.list.slice(0, MAX_ANIMALS).forEach((a, i) => {
        outA.set([a.x, a.y, a.type, a.frame], i * 4);
        outB.set([a.dir, a.scale, 0, 0], i * 4);
      });
    }
  }

  /* ---------- Fond animé : fondu, transitions de palette, animaux ---------- */
  const COLORS = ['skyTop', 'skyMid', 'horizon', 'sunColor', 'cloud', 'far', 'mid', 'near', 'light', 'neon'];

  class Wallpaper {
    constructor(host) {
      this.host = host; // { settings, effectName }
      this.level = 0;
      this.cur = null;
      this.cache = {};
      this.fauna = new Fauna();
      this.animA = new Float32Array(MAX_ANIMALS * 4);
      this.animB = new Float32Array(MAX_ANIMALS * 4);
    }

    palette(key) {
      if (!this.cache[key]) {
        const src = P.PALETTES[key];
        const pal = { scene: src.scene, sun: src.sun.slice(), stars: src.stars, rain: src.rain, streaks: src.rain };
        for (const c of COLORS) pal[c] = P.hexToRgb(src[c]);
        this.cache[key] = pal;
      }
      return this.cache[key];
    }

    update(dt, lowW, lowH) {
      const key = P.resolve(this.host.settings.wallpaper, this.host.effectName);
      this.level += ((key ? 1 : 0) - this.level) * Math.min(1, dt * 1.5);
      if (Math.abs(this.level - (key ? 1 : 0)) < 0.002) this.level = key ? 1 : 0;
      if (!key) return;
      const target = this.palette(key);
      // Pas de double pluie : si un effet météo tombe déjà, le fond ne dessine pas la sienne.
      const streaks = this.host.effectName === 'none' ? target.rain : 0;
      if (!this.cur || this.cur.scene !== target.scene) {
        this.cur = JSON.parse(JSON.stringify(target)); // nouvelle scène : pas de fondu de couleurs
        this.cur.streaks = streaks;
        this.fauna.list.length = 0;
      } else {
        const k = Math.min(1, dt * 1.2);
        for (const c of COLORS) for (let i = 0; i < 3; i++) this.cur[c][i] += (target[c][i] - this.cur[c][i]) * k;
        for (let i = 0; i < 3; i++) this.cur.sun[i] += (target.sun[i] - this.cur.sun[i]) * k;
        this.cur.sun[3] = target.sun[3];
        this.cur.stars += (target.stars - this.cur.stars) * k;
        this.cur.rain += (target.rain - this.cur.rain) * k;
        this.cur.streaks += (streaks - this.cur.streaks) * k;
      }
      this.fauna.update(dt, this.cur.scene, lowW, lowH);
      this.fauna.uniforms(this.animA, this.animB);
      this.cur.animA = this.animA;
      this.cur.animB = this.animB;
    }

    // Saute directement à la palette cible (pour l'image fixe du vrai fond d'écran).
    snapTo() {
      const key = P.resolve(this.host.settings.wallpaper, this.host.effectName);
      if (!key) return;
      const target = this.palette(key);
      this.cur = JSON.parse(JSON.stringify(target));
      this.cur.streaks = this.host.effectName === 'none' ? target.rain : 0;
    }

    visible() {
      return this.level > 0.002 && !!this.cur;
    }
  }

  B.Wallpaper = Wallpaper;
  B.Fauna = Fauna;
})();
