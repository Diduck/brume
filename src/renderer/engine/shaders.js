// Brume — programmes GPU (GLSL ES 3.0).
// Aucune image : chaque flocon, pétale, feuille ou bonhomme de neige est dessiné
// mathématiquement dans le fragment shader, ce qui reste net à toutes les tailles.
(function () {
  'use strict';
  const B = window.Brume;
  const MAX_RECTS = 48;
  B.MAX_RECTS = MAX_RECTS;

  // Masque « derrière les fenêtres » : un pixel est caché s'il tombe dans une fenêtre
  // située devant l'objet. Les fenêtres arrivent triées de l'avant vers l'arrière ;
  // un objet d'ordre k n'est masqué que par les fenêtres 0..k-1.
  // En mode « derrière » (ordre ≥ 10000), rien n'apparaît non plus sur la barre des
  // menus (au-dessus de uBand.x) ni sur le Dock (en dessous de uBand.y).
  const MASK = `
uniform vec4 uRects[${MAX_RECTS}];
uniform int uRectCount;
uniform vec2 uBand;
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
bool masked(vec2 p, float order) {
  if (order >= 9999.0 && (p.y < uBand.x || p.y > uBand.y)) return true;
  for (int i = 0; i < ${MAX_RECTS}; i++) {
    if (i >= uRectCount || float(i) >= order) break;
    vec4 r = uRects[i];
    vec2 h = r.zw * 0.5;
    if (sdRoundBox(p - r.xy - h, h, 10.0) < 0.0) return true;
  }
  return false;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

  const spriteVS = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 iA; // x, y, largeur, hauteur
layout(location = 2) in vec4 iB; // rotation, opacité, ordre, variante
uniform vec2 uRes;
out vec2 vUV;
out vec2 vWorld;
out float vAlpha;
out float vOrder;
out float vVariant;
out float vRot;
void main() {
  vec2 local = aCorner * iA.zw;
  float c = cos(iB.x), s = sin(iB.x);
  vec2 world = iA.xy + vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vUV = aCorner * 2.0;
  vWorld = world;
  vAlpha = iB.y;
  vOrder = iB.z;
  vVariant = iB.w;
  vRot = iB.x;
  vec2 clip = world / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

  const spriteFS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vWorld;
in float vAlpha;
in float vOrder;
in float vVariant;
in float vRot;
uniform int uShape;
uniform float uTime;
out vec4 outColor;
${MASK}

vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }
float soft(float sd) { float w = max(fwidth(sd), 1e-4); return 1.0 - smoothstep(-w, w, sd); }
float boxA(vec2 p, vec2 c, vec2 h) {
  vec2 d = abs(p - c) - h;
  return soft(length(max(d, 0.0)) + min(max(d.x, d.y), 0.0));
}
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// 0 — flocon : disque doux ou cristal à six branches, avec un liseré sombre
// pour rester visible sur une fenêtre blanche.
vec4 snowflake(vec2 uv) {
  float r = length(uv);
  float shape = r;
  if (vVariant > 0.85) {
    float a = atan(uv.y, uv.x) + vVariant * 9.0;
    float arms = pow(abs(cos(3.0 * a)), 12.0);
    shape = r / mix(0.42, 1.0, arms);
  }
  float body = 1.0 - smoothstep(0.55, 0.9, shape);
  float rim = (1.0 - smoothstep(0.8, 1.0, shape)) * 0.32;
  return over(vec4(vec3(0.985, 0.99, 1.0), 1.0) * body, vec4(0.30, 0.37, 0.48, 1.0) * rim);
}

// 1 — goutte de pluie étirée dans le sens de sa vitesse.
vec4 raindrop(vec2 uv) {
  float across = 1.0 - smoothstep(0.2, 1.0, abs(uv.x));
  float along = smoothstep(-1.0, 0.7, uv.y) * (1.0 - smoothstep(0.82, 1.0, uv.y));
  float a = across * along * 0.85;
  return vec4(vec3(0.62, 0.72, 0.88) * a, a);
}

// 2 — pétale de cerisier avec son encoche.
vec4 petal(vec2 uv) {
  float widthK = mix(0.75, 0.42, smoothstep(-0.2, 1.0, uv.y));
  float e = length(vec2(uv.x / widthK, uv.y / 0.95));
  float notch = length(uv - vec2(0.0, -1.02));
  float inside = (1.0 - smoothstep(0.86, 1.0, e)) * smoothstep(0.2, 0.3, notch);
  vec3 tip = mix(vec3(1.0, 0.88, 0.92), vec3(1.0, 0.78, 0.86), vVariant);
  vec3 base = mix(vec3(0.97, 0.62, 0.74), vec3(0.92, 0.47, 0.63), vVariant);
  vec3 col = mix(tip, base, smoothstep(-0.6, 1.0, uv.y));
  col = mix(col, col * vec3(0.84, 0.7, 0.76), smoothstep(0.72, 0.98, e) * 0.8);
  return vec4(col * inside, inside);
}

// 3 — feuille d'automne (forme en amande, nervures, pétiole).
vec4 leaf(vec2 uv) {
  vec2 p = uv * 1.12;
  float e = length(vec2(abs(p.x) + 0.62, p.y)) - 1.17;
  float body = soft(e);
  float stem = (1.0 - smoothstep(0.03, 0.07, abs(p.x))) * step(0.85, p.y) * (1.0 - step(1.12, p.y));
  int k = int(floor(vVariant * 3.999));
  vec3 c = k == 0 ? vec3(0.93, 0.46, 0.13) : k == 1 ? vec3(0.78, 0.2, 0.12) : k == 2 ? vec3(0.95, 0.73, 0.22) : vec3(0.56, 0.33, 0.16);
  vec3 col = c * (0.82 + 0.18 * (1.0 - abs(p.x) * 1.4));
  float vein = 1.0 - smoothstep(0.0, 0.05, abs(p.x));
  float side = (1.0 - smoothstep(0.0, 0.07, abs(fract((p.y + abs(p.x) * 0.9) * 3.0) - 0.5))) * step(abs(p.x), 0.45);
  col = mix(col, c * 0.6, max(vein * 0.8, side * 0.4));
  col = mix(col, c * 0.5, smoothstep(-0.12, -0.02, e) * 0.7);
  float a = max(body, stem);
  vec3 outC = mix(c * 0.45, col, body);
  return vec4(outC * a, a);
}

// 4 — lueur : luciole (variante < 0.5) ou étincelle colorée.
vec4 glow(vec2 uv) {
  float r2 = dot(uv, uv);
  vec3 c = vec3(0.86, 1.0, 0.45);
  if (vVariant >= 0.5) {
    int k = int(floor((vVariant - 0.5) * 7.999));
    c = k == 0 ? vec3(1.0, 0.84, 0.4) : k == 1 ? vec3(1.0) : k == 2 ? vec3(0.6, 0.9, 1.0) : vec3(1.0, 0.65, 0.85);
  }
  float a = (exp(-r2 * 18.0) + exp(-r2 * 3.2) * 0.5) * (1.0 - smoothstep(0.85, 1.0, sqrt(r2)));
  return vec4(c * a, a * 0.35);
}

// 5 — traînée d'étoile filante.
vec4 trail(vec2 uv) {
  float along = pow(clamp(uv.y * 0.5 + 0.5, 0.0, 1.0), 2.4);
  float a = exp(-uv.x * uv.x * 6.0) * along;
  return vec4(mix(vec3(0.55, 0.75, 1.0), vec3(1.0), along) * a, a * 0.4);
}

// 6 — ronds dans l'eau.
vec4 ring(vec2 uv) {
  float a = (1.0 - smoothstep(0.0, 0.2, abs(length(uv) - 0.78))) * 0.8;
  return vec4(vec3(0.8, 0.88, 0.98) * a, a);
}

// 7 — gouttelette d'éclaboussure.
vec4 droplet(vec2 uv) {
  float a = 1.0 - smoothstep(0.6, 1.0, length(uv));
  return vec4(vec3(0.68, 0.78, 0.92) * a, a);
}

// 8 — étoile scintillante du fond.
vec4 star(vec2 uv) {
  float r2 = dot(uv, uv);
  float cross = exp(-abs(uv.x) * 18.0) * exp(-abs(uv.y) * 3.0) + exp(-abs(uv.y) * 18.0) * exp(-abs(uv.x) * 3.0);
  float a = exp(-r2 * 26.0) + cross * 0.35;
  return vec4(vec3(0.85, 0.92, 1.0) * a, a * 0.3);
}

// 9 — boule de neige éclairée en 3D. La texture tourne avec la boule,
// la lumière reste fixe (calculée dans le repère de l'écran).
vec4 snowball(vec2 uv) {
  float r = length(uv);
  if (r > 1.0) return vec4(0.0);
  float c = cos(vRot), s = sin(vRot);
  vec2 sp = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  vec3 n = vec3(sp, sqrt(max(0.0, 1.0 - r * r)));
  float diff = max(dot(n, normalize(vec3(-0.45, -0.7, 0.6))), 0.0);
  vec3 col = mix(vec3(0.68, 0.75, 0.87), vec3(1.0), 0.25 + 0.75 * diff);
  col *= 1.0 - 0.07 * step(0.76, hash(floor(uv * 6.0 + 20.0)));
  col += vec3(0.05, 0.07, 0.1) * pow(1.0 - n.z, 3.0);
  col = mix(col, vec3(0.42, 0.5, 0.62), smoothstep(0.86, 1.0, r) * 0.6);
  float a = 1.0 - smoothstep(0.96, 1.0, r);
  return vec4(col * a, a);
}

// 10 — nez en carotte (pointe vers +x).
vec4 carrot(vec2 uv) {
  float x = uv.x * 0.5 + 0.5;
  float halfH = 0.55 * (1.0 - x);
  float inside = soft(abs(uv.y) - halfH);
  vec3 col = vec3(0.98, 0.52, 0.12) * (1.0 - 0.18 * step(0.86, fract(x * 4.0)));
  col = mix(col, vec3(0.75, 0.32, 0.05), smoothstep(halfH - 0.2, halfH, abs(uv.y)) * 0.6);
  return vec4(col * inside, inside);
}

// 11 — bras en branche (avec deux petites fourches).
vec4 stick(vec2 uv) {
  float d = sdSeg(uv, vec2(-0.95, 0.15), vec2(0.95, 0.0));
  d = min(d, sdSeg(uv, vec2(0.35, 0.05), vec2(0.8, -0.75)));
  d = min(d, sdSeg(uv, vec2(0.6, 0.02), vec2(0.98, 0.35)));
  float a = soft(d - 0.11);
  return vec4(vec3(0.38, 0.25, 0.15) * a, a);
}

// 12 — chapeau haut de forme.
vec4 hat(vec2 uv) {
  float crown = boxA(uv, vec2(0.0, -0.18), vec2(0.6, 0.77));
  float brim = boxA(uv, vec2(0.0, 0.7), vec2(0.98, 0.14));
  float a = max(crown, brim);
  vec3 col = vec3(0.1, 0.1, 0.12);
  col = mix(col, vec3(0.72, 0.12, 0.16), crown * boxA(uv, vec2(0.0, 0.36), vec2(0.6, 0.13)));
  col += vec3(0.07) * boxA(uv, vec2(-0.38, -0.2), vec2(0.06, 0.5));
  return vec4(col * a, a);
}

// 13 — morceau de charbon (yeux, sourire, boutons).
vec4 coal(vec2 uv) {
  float a = soft(length(uv) - 0.85);
  vec2 h = uv - vec2(-0.3, -0.3);
  vec3 col = vec3(0.07, 0.07, 0.09) + vec3(0.14) * exp(-dot(h, h) * 8.0);
  return vec4(col * a, a);
}

// 14 — écharpe rayée.
vec4 scarf(vec2 uv) {
  float a = max(boxA(uv, vec2(0.0, -0.35), vec2(0.95, 0.28)), boxA(uv, vec2(0.45, 0.35), vec2(0.16, 0.6)));
  vec3 col = mix(vec3(0.82, 0.16, 0.2), vec3(0.97, 0.92, 0.9), step(0.62, fract((uv.x + uv.y * 0.3) * 3.0)) * 0.6);
  return vec4(col * a, a);
}

void main() {
  if (masked(vWorld, vOrder)) discard;
  vec4 c;
  if (uShape == 0) c = snowflake(vUV);
  else if (uShape == 1) c = raindrop(vUV);
  else if (uShape == 2) c = petal(vUV);
  else if (uShape == 3) c = leaf(vUV);
  else if (uShape == 4) c = glow(vUV);
  else if (uShape == 5) c = trail(vUV);
  else if (uShape == 6) c = ring(vUV);
  else if (uShape == 7) c = droplet(vUV);
  else if (uShape == 8) c = star(vUV);
  else if (uShape == 9) c = snowball(vUV);
  else if (uShape == 10) c = carrot(vUV);
  else if (uShape == 11) c = stick(vUV);
  else if (uShape == 12) c = hat(vUV);
  else if (uShape == 13) c = coal(vUV);
  else c = scarf(vUV);
  c *= vAlpha;
  if (c.a < 0.002) discard;
  outColor = c;
}`;

  // Tas de neige : un ruban de triangles construit à partir de la carte de hauteurs.
  const pileVS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec3 aInfo; // t (0 = surface, 1 = bord de la fenêtre), hauteur, ordre
uniform vec2 uRes;
out vec2 vWorld;
out float vT;
out float vH;
out float vOrder;
void main() {
  vWorld = aPos;
  vT = aInfo.x;
  vH = aInfo.y;
  vOrder = aInfo.z;
  vec2 clip = aPos / uRes * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

  const pileFS = `#version 300 es
precision highp float;
in vec2 vWorld;
in float vT;
in float vH;
in float vOrder;
uniform float uTime;
out vec4 outColor;
${MASK}
void main() {
  if (masked(vWorld, vOrder)) discard;
  float depth = vT * vH; // nombre de px sous la surface de la neige
  vec3 col = mix(vec3(0.995, 0.997, 1.0), vec3(0.78, 0.84, 0.93), smoothstep(1.5, 16.0, depth));
  col = mix(col, vec3(0.52, 0.6, 0.72), (1.0 - smoothstep(0.0, 1.3, depth)) * 0.5);
  float g = hash(floor(vWorld * 0.7));
  float sparkle = step(0.993, g) * (0.5 + 0.5 * sin(uTime * 3.0 + g * 60.0));
  col += vec3(0.6) * sparkle * step(1.5, depth) * (1.0 - smoothstep(4.0, 7.0, depth));
  outColor = vec4(col, 1.0) * 0.98;
}`;

  // Triangle plein écran (aucun sommet à envoyer).
  const fullVS = `#version 300 es
out vec2 vUV;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  // Aurore boréale : rendue en basse résolution (1/4) puis agrandie — elle est floue
  // par nature, donc on économise ~94 % des calculs sans perte visible.
  const auroraFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec2 uRes;
uniform float uTime;
out vec4 outColor;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
void main() {
  vec2 world = vec2(vUV.x, 1.0 - vUV.y) * uRes;
  vec2 p = world / uRes.y;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float x = p.x * (0.9 + 0.3 * fk) + uTime * (0.010 + 0.006 * fk) + fk * 3.7;
    float base = 0.2 + 0.07 * fk + 0.12 * (fbm(vec2(x * 1.3, uTime * 0.03 + fk * 5.0)) - 0.5);
    float dy = base - p.y;
    float rays = 0.5 + 0.5 * fbm(vec2(x * 22.0, uTime * 0.18 + fk));
    float inten = smoothstep(-0.006, 0.02, dy) * exp(-max(dy, 0.0) / (0.16 + 0.05 * fk)) * rays * (0.55 - 0.12 * fk);
    float hgt = clamp(dy / 0.25, 0.0, 1.0);
    vec3 c = mix(vec3(0.2, 1.0, 0.55), vec3(0.15, 0.75, 0.95), hgt);
    c = mix(c, vec3(0.65, 0.35, 0.95), smoothstep(0.55, 1.0, hgt));
    col += c * inten;
    alpha += inten;
  }
  float fade = 1.0 - smoothstep(0.35, 0.65, p.y);
  // Lumière presque purement additive : l'aurore éclaire, elle n'assombrit jamais le fond d'écran.
  outColor = vec4(col * 0.9 * fade, clamp(alpha * 0.03 * fade, 0.0, 1.0));
}`;

  // Copie de l'aurore à l'écran (mode 0) ou éclair d'orage (mode 1), avec le masque.
  const blitFS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform vec2 uRes;
uniform sampler2D uTex;
uniform int uMode;
uniform float uAmount;
uniform float uOrderValue;
uniform float uTime;
out vec4 outColor;
${MASK}
void main() {
  vec2 world = vec2(vUV.x, 1.0 - vUV.y) * uRes;
  if (masked(world, uOrderValue)) discard;
  if (uMode == 0) outColor = texture(uTex, vUV) * uAmount;
  else outColor = vec4(vec3(0.86, 0.9, 1.0) * uAmount, uAmount);
}`;

  B.shaders = { spriteVS, spriteFS, pileVS, pileFS, fullVS, auroraFS, blitFS }; // lofiFS : voir lofi.js
})();
