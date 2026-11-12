// Brume — les gens. Un petit atelier qui « sculpte » des personnages en volumes simples
// (boules, tubes, œufs, plaques), les pose comme des marionnettes articulées, les éclaire,
// puis les PEINT en pixel art :
//   • 4 tons par matière (peau, cheveux, pull, pantalon…), ombres teintées de violet et
//     lumières tirées vers le crème, comme dans les illustrations lofi ;
//   • mèches de cheveux avec reflets, plis des vêtements, poignets et semelles ;
//   • un trait sombre là où un volume passe devant un autre (bras devant le pull) ;
//   • un contour violet-noir sélectif (plus clair du côté de la lumière) ;
//   • un liseré de lumière du ciel (ou de la fenêtre) sur le bord du personnage.
//
// Pourquoi passer par la 3D ? Une pose se décrit par des angles d'articulations (ou par la
// position des mains et des pieds) : les proportions restent justes sous tous les angles,
// et l'ombrage des volumes tombe tout seul. Chaque image est calculée une seule fois au
// chargement de la scène, puis dessinée comme un sprite ordinaire.
//
// Repère du corps : [avant, haut, gauche], en « têtes » (1 = hauteur d'une tête).
// Repère de l'écran : x vers la droite, y vers le bas, z vers nous ; en pixels logiques.
(function () {
  'use strict';
  const B = window.Brume;
  const { Raster, hex, mix, hash } = B.PX;

  /* ================= Petits outils de géométrie ================= */
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const norm = (a) => mul(a, 1 / (len(a) || 1));
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Matrices 3 × 3 (par lignes) dans le repère [avant, haut, gauche].
  const mm = (A, Bm) => A.map((r) => [0, 1, 2].map((j) => r[0] * Bm[0][j] + r[1] * Bm[1][j] + r[2] * Bm[2][j]));
  const mv = (A, v) => [dot(A[0], v), dot(A[1], v), dot(A[2], v)];
  const ID = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  // Penché vers l'avant (autour de l'axe gauche-droite).
  const pitch = (a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [
      [c, s, 0],
      [-s, c, 0],
      [0, 0, 1],
    ];
  };
  // Tourné vers sa gauche (autour de la verticale).
  const yaw = (a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [
      [c, 0, -s],
      [0, 1, 0],
      [s, 0, c],
    ];
  };
  // Incliné vers son épaule gauche (autour de l'axe avant).
  const roll = (a) => {
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [
      [1, 0, 0],
      [0, c, -s],
      [0, s, c],
    ];
  };
  const rot = (tw = 0, pi = 0, ro = 0) => mm(mm(yaw(tw), pitch(pi)), roll(ro));

  // Direction d'un membre : pi = balancé vers l'avant depuis « pendu vers le bas »,
  // ab = écarté vers l'extérieur ; side = +1 pour le côté gauche, -1 pour le droit.
  const limb = (pi, ab, side) => [Math.sin(pi) * Math.cos(ab), -Math.cos(pi) * Math.cos(ab), side * Math.sin(ab)];

  // IK à deux os : où placer le coude (ou le genou) pour que la main atteigne la cible.
  function ik(a, target, l1, l2, pole) {
    let d = sub(target, a);
    const dist = clamp(len(d), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.001);
    d = norm(d);
    const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    let p = sub(pole, mul(d, dot(pole, d)));
    if (len(p) < 1e-4) p = [0, -1, 0];
    p = norm(p);
    const mid = add(add(a, mul(d, along)), mul(p, h));
    return { mid, end: add(a, mul(d, dist)) };
  }

  /* ================= Couleurs ================= */
  const SH_TINT = hex('#2a1636'); // ombres tirées vers le violet
  const HL_TINT = hex('#fff0d6'); // lumières tirées vers le crème
  const scaleC = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const toC = (c) => (typeof c === 'string' ? hex(c) : c);

  // Teinte / saturation / luminosité (pour des rampes « à la main » : les ombres glissent
  // vers le violet, les lumières vers le jaune, comme le font les pixel artistes).
  function toHsl(c) {
    const r = c[0] / 255;
    const g = c[1] / 255;
    const b = c[2] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn;
    const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function fromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h / 360 + 1 / 3) * 255, f(h / 360) * 255, f(h / 360 - 1 / 3) * 255].map(Math.round);
  }
  // Fait tourner une teinte vers une cible (degrés), d'au plus « amt ».
  const towards = (h, target, amt) => {
    let d = ((target - h + 540) % 360) - 180;
    return h + clamp(d, -amt, amt);
  };
  // Rampe de 5 tons : [creux, ombre, base, clair, reflet].
  // dl : écarts de luminosité ; sh / hl : teintes visées par les ombres et les lumières.
  function ramp(base, o = {}) {
    const c = toC(base);
    const [h, s, l] = toHsl(c);
    const dl = o.dl || [-0.25, -0.12, 0, 0.09, 0.18];
    const shH = o.shH == null ? 265 : o.shH;
    const hlH = o.hlH == null ? 48 : o.hlH;
    const out = dl.map((d, i) => {
      if (i === 2) return c;
      const k = i < 2 ? (2 - i) : i - 2;
      const hh = i < 2 ? towards(h, shH, 9 * k) : towards(h, hlH, 7 * k);
      const ss = i < 2 ? s * (o.sat || 1) * (1 + 0.06 * k) : s * (1 - 0.1 * k);
      // Les couleurs très sombres s'éclaircissent moins vite (sinon elles virent au gris).
      const ll = l + d * (i > 2 ? 0.55 + Math.min(0.45, l) : 1);
      return fromHsl(hh, s < 0.04 ? 0.06 + ss : ss, ll); // un gris prend une pointe de teinte
    });
    return out;
  }
  // La peau : ombres rosées plutôt que grises.
  const skinRamp = (base) => ramp(base, { dl: [-0.24, -0.1, 0, 0.06, 0.11], shH: 8, hlH: 40, sat: 0.92 });
  // Les cheveux : reflets plus marqués ; noirs → reflets bleutés, châtains → dorés.
  const hairRamp = (base) => {
    const c = toC(base);
    const l = toHsl(c)[2];
    return l < 0.16 ? ramp(base, { dl: [-0.1, -0.05, 0, 0.11, 0.22], shH: 270, hlH: 240 }) : ramp(base, { dl: [-0.2, -0.1, 0, 0.1, 0.2], shH: 300, hlH: 40 });
  };

  const INK = '#1c1226'; // contour : violet très sombre, jamais noir pur

  /* ================= Caméra ================= */
  // th : angle de vue (0 = profil tourné vers la droite, π/2 = de face, -π/2 = de dos).
  // ph : la caméra regarde un peu d'en haut.
  function camera(th, ph, k) {
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const cp = Math.cos(ph);
    const sp = Math.sin(ph);
    const dir = (v) => {
      const x = v[0] * ct + v[2] * st;
      // (le repère du corps [avant, haut, gauche] est « gaucher » : la projection est
      // une rotation suivie d'un miroir ; de profil vers la droite, on voit son côté droit)
      const z0 = v[0] * st - v[2] * ct;
      return [x, -(v[1] * cp - z0 * sp), z0 * cp + v[1] * sp];
    };
    return { dir, p: (v) => mul(dir(v), k), k };
  }

  /* ================= Primitives (en coordonnées écran) ================= */
  // Chaque primitive sait dire si le rayon du pixel (px, py) la touche, à quelle
  // profondeur, avec quelle normale, et de quelle matière est ce point.
  function ball(c, r, mat, o = {}) {
    return {
      ...o,
      mat,
      bb: [c[0] - r, c[1] - r, c[0] + r, c[1] + r],
      hit(px, py, h) {
        const dx = px - c[0];
        const dy = py - c[1];
        const d2 = dx * dx + dy * dy;
        if (d2 > r * r) return false;
        const dz = Math.sqrt(r * r - d2);
        h.z = c[2] + dz;
        h.nx = dx / r;
        h.ny = dy / r;
        h.nz = dz / r;
        h.t = 0;
        h.u = 0;
        h.m = mat;
        h.dv = 0;
        return true;
      },
    };
  }

  // Tube effilé (une file de boules de a vers b) : bras, jambes, mèches, manche de guitare.
  function tube(a, b, ra, rb, mat, o = {}) {
    const L = len(sub(a, b));
    const n = Math.max(2, Math.ceil(L / 0.35) + 1);
    const rm = Math.max(ra, rb);
    const cls = o.cls;
    return {
      ...o,
      mat,
      bb: [Math.min(a[0], b[0]) - rm, Math.min(a[1], b[1]) - rm, Math.max(a[0], b[0]) + rm, Math.max(a[1], b[1]) + rm],
      hit(px, py, h) {
        let best = -Infinity;
        let bk = -1;
        let bx = 0;
        let by = 0;
        let br = 1;
        for (let k = 0; k < n; k++) {
          const t = k / (n - 1);
          const r = ra + (rb - ra) * t;
          const dx = px - (a[0] + (b[0] - a[0]) * t);
          const dy = py - (a[1] + (b[1] - a[1]) * t);
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r) continue;
          const z = a[2] + (b[2] - a[2]) * t + Math.sqrt(r * r - d2);
          if (z > best) {
            best = z;
            bk = k;
            bx = dx;
            by = dy;
            br = r;
          }
        }
        if (bk < 0) return false;
        const t = bk / (n - 1);
        h.z = best;
        h.nx = bx / br;
        h.ny = by / br;
        h.nz = (best - (a[2] + (b[2] - a[2]) * t)) / br;
        h.t = t;
        h.u = 0;
        h.m = mat;
        h.dv = 0;
        if (cls) return cls(h) !== false;
        return true;
      },
    };
  }

  // Œuf (ellipsoïde orienté) : tête, buste, bassin, masse des cheveux, caisse de guitare.
  // ax : trois axes unitaires (écran) ; r : les trois rayons. o.cls(q, h, front) peut
  // changer la matière d'un point (q = coordonnées locales sur la surface) ou le creuser.
  function egg(c, ax, r, mat, o = {}) {
    const rm = Math.max(r[0], r[1], r[2]);
    const cls = o.cls;
    const e = ax.map((v, i) => mul(v, 1 / r[i])); // axes divisés par les rayons
    const bz = e.map((v) => v[2]);
    const A2 = bz[0] * bz[0] + bz[1] * bz[1] + bz[2] * bz[2];
    const nrm = (q, sgn, h) => {
      // normale = Σ q_i · e_i / r_i
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < 3; i++) {
        nx += q[i] * e[i][0];
        ny += q[i] * e[i][1];
        nz += q[i] * e[i][2];
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      h.nx = (sgn * nx) / l;
      h.ny = (sgn * ny) / l;
      h.nz = (sgn * nz) / l;
    };
    return {
      ...o,
      mat,
      bb: [c[0] - rm, c[1] - rm, c[0] + rm, c[1] + rm],
      hit(px, py, h) {
        const dx = px - c[0];
        const dy = py - c[1];
        const al = [e[0][0] * dx + e[0][1] * dy, e[1][0] * dx + e[1][1] * dy, e[2][0] * dx + e[2][1] * dy];
        const Bq = al[0] * bz[0] + al[1] * bz[1] + al[2] * bz[2];
        const Cq = al[0] * al[0] + al[1] * al[1] + al[2] * al[2] - 1;
        const disc = Bq * Bq - A2 * Cq;
        if (disc < 0 || A2 < 1e-9) return false;
        const sq = Math.sqrt(disc);
        for (const sgn of [1, -1]) {
          const t = (-Bq + sgn * sq) / A2;
          const q = [al[0] + bz[0] * t, al[1] + bz[1] * t, al[2] + bz[2] * t];
          h.z = c[2] + t;
          h.t = 0;
          h.u = 0;
          h.m = mat;
          h.dv = 0;
          h.q = q;
          nrm(q, sgn, h);
          if (!cls) return true;
          const ok = cls(q, h, sgn > 0);
          if (ok !== false) return true;
          if (!o.inner) return false;
        }
        return false;
      },
    };
  }

  // Plaque plate (livre, écran de téléphone…) : centre c, demi-côtés e1 et e2.
  function slab(c, e1, e2, mat, o = {}) {
    const n0 = cross(e1, e2);
    const n = mul(n0, 1 / (len(n0) || 1));
    const l1 = dot(e1, e1);
    const l2 = dot(e2, e2);
    const pts = [add(add(c, e1), e2), add(sub(c, e1), e2), sub(add(c, e1), e2), sub(sub(c, e1), e2)];
    const cls = o.cls;
    return {
      ...o,
      mat,
      bb: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
      hit(px, py, h) {
        if (Math.abs(n[2]) < 0.05) return false;
        const dx = px - c[0];
        const dy = py - c[1];
        const dz = -(n[0] * dx + n[1] * dy) / n[2];
        const w = [dx, dy, dz];
        const a = dot(w, e1) / l1;
        const b = dot(w, e2) / l2;
        if (a < -1 || a > 1 || b < -1 || b > 1) return false;
        const s = n[2] < 0 ? -1 : 1;
        h.z = c[2] + dz;
        h.nx = n[0] * s;
        h.ny = n[1] * s;
        h.nz = n[2] * s;
        h.t = a;
        h.u = b;
        h.m = mat;
        h.dv = 0;
        if (cls) return cls(h) !== false;
        return true;
      },
    };
  }

  /* ================= Proportions ================= */
  // En « têtes ». f : jeune femme, m : jeune homme, kid : enfant.
  const BODIES = {
    f: { sh: 0.4, hipW: 0.19, chest: [0.25, 0.4, 0.37], waist: [0.22, 0.34, 0.3], pelv: [0.25, 0.3, 0.37], arm: [0.74, 0.66], armR: [0.125, 0.105, 0.095], leg: [0.95, 0.9], legR: [0.19, 0.145, 0.11], neck: 0.105, spine: 1.1, head: [0.46, 0.5, 0.41], foot: 0.36 },
    m: { sh: 0.47, hipW: 0.2, chest: [0.28, 0.43, 0.43], waist: [0.25, 0.36, 0.35], pelv: [0.26, 0.3, 0.37], arm: [0.78, 0.7], armR: [0.14, 0.12, 0.105], leg: [0.98, 0.92], legR: [0.2, 0.155, 0.12], neck: 0.12, spine: 1.15, head: [0.46, 0.5, 0.41], foot: 0.4 },
    kid: { sh: 0.36, hipW: 0.17, chest: [0.25, 0.36, 0.34], waist: [0.24, 0.3, 0.3], pelv: [0.25, 0.27, 0.33], arm: [0.55, 0.5], armR: [0.12, 0.105, 0.1], leg: [0.66, 0.62], legR: [0.17, 0.14, 0.11], neck: 0.1, spine: 0.85, head: [0.48, 0.5, 0.44], foot: 0.32 },
  };
  const ANKLE = 0.11; // hauteur de la cheville au-dessus du sol

  /* ================= Le squelette ================= */
  // pose : {
  //   pelvis: [f, u, s] (par défaut debout), hips: rotation des hanches (yaw),
  //   lean / twist / side : buste penché, tourné, incliné ; head: { nod, turn, tilt },
  //   armL / armR : { pi, ab, el } (angles) ou { hand: [f, u, s], pole } (la main va là),
  //   legL / legR : { pi, ab, kn } (angles) ou { foot: [f, u, s], pole }, toe : pied tendu,
  // }
  function skeleton(look, pose) {
    const bd = BODIES[look.body || 'f'];
    const legLen = bd.leg[0] + bd.leg[1] + ANKLE;
    const pel = pose.pelvis || [0, legLen - 0.02, 0];
    const Rp = yaw(pose.hips || 0);
    const Rt = mm(Rp, rot(pose.twist || 0, pose.lean || 0, pose.side || 0));
    const hd = pose.head || {};
    const Rh = mm(Rt, rot(hd.turn || 0, hd.nod || 0, hd.tilt || 0));
    const J = { bd, Rt, Rh, Rp, pelvis: pel };
    const T = (v) => add(pel, mv(Rt, v));
    J.waist = T([0, bd.spine * 0.42, 0]);
    J.chest = T([0, bd.spine * 0.74, 0]);
    J.neck = T([0, bd.spine * 1.03, 0]);
    J.shL = T([-0.02, bd.spine * 0.92, bd.sh]);
    J.shR = T([-0.02, bd.spine * 0.92, -bd.sh]);
    J.headC = add(J.neck, mv(Rh, [0.04, 0.5, 0]));
    for (const [side, sgn] of [
      ['L', 1],
      ['R', -1],
    ]) {
      // Jambes.
      const hip = add(pel, mv(Rp, [0, -0.04, sgn * bd.hipW]));
      const lg = pose[`leg${side}`] || {};
      let knee;
      let ankle;
      if (lg.foot) {
        const r = ik(hip, add(lg.foot, [0, ANKLE, 0]), bd.leg[0], bd.leg[1], lg.pole || mv(Rp, [1, 0, sgn * 0.15]));
        knee = r.mid;
        ankle = r.end;
      } else {
        const pi = lg.pi || 0;
        knee = add(hip, mul(mv(Rp, limb(pi, lg.ab || 0.02, sgn)), bd.leg[0]));
        ankle = add(knee, mul(mv(Rp, limb(pi - (lg.kn || 0), (lg.ab || 0.02) * 0.6, sgn)), bd.leg[1]));
      }
      const toeA = lg.toe || 0;
      const fyaw = mm(Rp, yaw(sgn * (lg.out || 0.12)));
      const toe = add(ankle, mul(mv(fyaw, [Math.cos(toeA), -Math.sin(toeA) - 0.05, 0]), bd.foot));
      J[`hip${side}`] = hip;
      J[`knee${side}`] = knee;
      J[`ankle${side}`] = ankle;
      J[`toe${side}`] = toe;
      // Bras.
      const sh = J[`sh${side}`];
      const am = pose[`arm${side}`] || {};
      let elbow;
      let wrist;
      if (am.hand) {
        const r = ik(sh, am.hand, bd.arm[0], bd.arm[1], am.pole || mv(Rt, [-0.3, -1, sgn * 0.6]));
        elbow = r.mid;
        wrist = r.end;
      } else {
        const pi = am.pi || 0;
        const ab = am.ab == null ? 0.12 : am.ab;
        elbow = add(sh, mul(mv(Rt, limb(pi, ab, sgn)), bd.arm[0]));
        wrist = add(elbow, mul(mv(Rt, limb(pi + (am.el || 0.15), ab * 0.5, sgn)), bd.arm[1]));
      }
      J[`elbow${side}`] = elbow;
      J[`wrist${side}`] = wrist;
      const hdir = am.hdir ? norm(am.hdir) : norm(sub(wrist, elbow));
      J[`hand${side}`] = add(wrist, mul(hdir, 0.1));
      J[`hdir${side}`] = hdir;
    }
    // Pieds posés au sol : on descend (ou remonte) tout le corps.
    if (pose.ground) {
      const dy = Math.min(J.ankleL[1] - ANKLE, J.ankleR[1] - ANKLE, J.toeL[1] - 0.07, J.toeR[1] - 0.07);
      for (const k of Object.keys(J)) if (Array.isArray(J[k]) && J[k].length === 3 && typeof J[k][0] === 'number') J[k] = [J[k][0], J[k][1] - dy, J[k][2]];
    }
    return J;
  }

  /* ================= Les cheveux ================= */
  // Chaque coiffure : la calotte (un œuf un peu plus gros que le crâne, creusé à
  // l'emplacement du visage) + des mèches (tubes) et des volumes (boules).
  const STYLES = {
    long: { hairline: 0.22, bangs: 0.0, nape: -9, cap: [1.1, 1.1, 1.14], capOff: [-0.05, 0.05], locks: 'long' },
    bob: { hairline: 0.12, bangs: -0.12, nape: -9, cap: [1.12, 1.1, 1.18], capOff: [-0.06, 0.03], locks: 'bob' },
    messy: { hairline: 0.25, bangs: 0.06, nape: -0.72, cap: [1.12, 1.12, 1.14], capOff: [-0.04, 0.08], locks: 'messy' },
    bun: { hairline: 0.3, bangs: 0.2, nape: -0.74, cap: [1.06, 1.05, 1.09], capOff: [-0.03, 0.03], locks: 'bun' },
    pony: { hairline: 0.28, bangs: 0.05, nape: -0.72, cap: [1.07, 1.06, 1.1], capOff: [-0.03, 0.03], locks: 'pony' },
    short: { hairline: 0.32, bangs: 0.22, nape: -0.66, cap: [1.08, 1.08, 1.1], capOff: [-0.03, 0.07], locks: null },
    curly: { hairline: 0.25, bangs: 0.1, nape: -0.72, cap: [1.16, 1.15, 1.2], capOff: [-0.05, 0.1], locks: 'curly' },
    bald: { hairline: 2, bangs: 2, nape: 2, cap: [1, 1, 1], capOff: [0, 0], locks: null },
  };

  // Texture de mèches : renvoie un décalage de ton (+1 reflet, -1 mèche sombre).
  // a : position autour de la tête (ou du tube), b : position le long de la mèche.
  function strand(a, b, lum, seed) {
    const id = Math.floor(a);
    const r = hash(id, 7, seed);
    const r2 = hash(id, 11, seed);
    // Bande de reflet (l'anneau brillant des cheveux), coupée par les mèches.
    if (lum > 0.55 && Math.abs(b - (0.35 + r * 0.25)) < 0.16 + r2 * 0.1 && r > 0.25) return 1;
    // Mèches sombres dans l'ombre.
    if (lum < 0.62 && r2 > 0.62 && b > 0.25) return -1;
    return 0;
  }

  /* ================= Assemblage d'un personnage ================= */
  // Construit la liste de primitives d'un personnage posé. Renvoie aussi les points
  // utiles (mains, tête…) en coordonnées écran.
  function assemble(look, pose, opt) {
    const hh = opt.hh;
    const cam = camera(opt.view == null ? 0 : opt.view, opt.tilt == null ? 0.12 : opt.tilt, hh);
    const J = skeleton(look, pose);
    const bd = J.bd;
    const P = (v) => cam.p(v);
    const D = (v) => cam.dir(v);
    const prims = [];
    const st = STYLES[look.hair === 'none' ? 'bald' : look.hairStyle || 'short'] || STYLES.short;
    const sway = pose.sway || 0;
    // Côté éloigné (un ton plus sombre) : celui dont l'épaule est la plus loin de nous.
    const dz = P(J.shL)[2] - P(J.shR)[2];
    const farSide = opt.farSide !== undefined ? opt.farSide : Math.abs(dz) < 0.25 * hh ? null : dz < 0 ? 'L' : 'R';

    // --- Matières ---
    const top = look.top || '#8a5bb0';
    const topStyle = look.topStyle || 'sweater';
    const sleeves = look.sleeves || (topStyle === 'tee' ? 'short' : 'long');
    const bottomStyle = look.bottomStyle || 'pants';

    // --- Jambes ---
    for (const side of ['L', 'R']) {
      const far = farSide === side;
      const hip = P(J[`hip${side}`]);
      const knee = P(J[`knee${side}`]);
      const ankle = P(J[`ankle${side}`]);
      const toe = P(J[`toe${side}`]);
      const [r0, r1, r2] = bd.legR.map((r) => r * hh);
      const shin = bottomStyle === 'pants' ? 'bottom' : look.tights ? 'tights' : 'skin';
      const thighMat = bottomStyle === 'skirt' ? (look.tights ? 'tights' : 'skin') : 'bottom';
      const crease = (h) => {
        // Pli au creux du genou et léger pli près de la hanche.
        if (h.t > 0.82 && h.nz < 0.75) h.dv = -1;
        return true;
      };
      // Vu de dos sur un tabouret, les jambes sont cachées par le corps et le siège.
      if (pose.hideLegs) continue;
      prims.push(tube(hip, knee, r0, r1 * 1.05, thighMat, { far, cls: crease, tag: 'thigh' }));
      prims.push(tube(knee, ankle, r1, r2, shin, { far, tag: 'shin', cls: (h) => (h.t > 0.86 && shin === 'bottom' && bottomStyle === 'pants' ? ((h.dv = -1), true) : true) }));
      // Chaussure : un tube du talon aux orteils, semelle plus sombre.
      const heel = lerp3(ankle, toe, -0.1);
      const sr = Math.max(0.75, bd.legR[2] * hh * 1.05);
      prims.push(
        tube(heel, toe, sr, sr * 0.9, 'shoe', {
          far,
          tag: 'shoe',
          cls: (h) => {
            if (h.ny > 0.55) h.m = 'sole';
            return true;
          },
        }),
      );
    }

    // --- Buste ---
    const Rt = J.Rt;
    const ax = (R) => [norm(D(mv(R, [1, 0, 0]))), norm(D(mv(R, [0, 1, 0]))), norm(D(mv(R, [0, 0, 1])))];
    const tAx = ax(Rt);
    const torsoMat = 'top';
    const hemCls = (q, h) => {
      // Ourlet du pull (bande côtelée) ; le bas du bassin est en pantalon.
      if (q[1] < -0.2 && topStyle !== 'coat') {
        h.m = 'bottom';
      } else if (q[1] < 0.05 && topStyle !== 'coat') h.dv = -1;
      return true;
    };
    prims.push(egg(P(J.pelvis), ax(J.Rp), bd.pelv.map((r) => r * hh), 'bottom', { tag: 'pelvis' }));
    prims.push(egg(P(J.waist), tAx, bd.waist.map((r) => r * hh), torsoMat, { tag: 'waist', cls: hemCls }));
    prims.push(
      egg(P(J.chest), tAx, bd.chest.map((r) => r * hh), torsoMat, {
        tag: 'chest',
        cls: (q, h) => {
          // Fermeture / liseré de la veste au milieu du devant.
          if (topStyle === 'jacket' && hh >= 6 && q[0] > 0.55 && Math.abs(q[2]) < 0.12) h.m = 'trim';
          if (topStyle === 'hoodie' && q[0] > 0.5 && Math.abs(q[2]) < 0.35 && q[1] < -0.35 && q[1] > -0.85) h.dv = -1; // poche ventrale
          if (look.moon && q[0] < -0.55) {
            // Petit croissant de lune brodé dans le dos.
            const a = (q[1] - 0.05) ** 2 + q[2] ** 2;
            const b = (q[1] - 0.12) ** 2 + (q[2] + 0.12) ** 2;
            if (a < 0.1 && b > 0.075) h.m = 'print';
          }
          return true;
        },
      }),
    );
    // Épaules arrondies (un tube d'une épaule à l'autre).
    prims.push(tube(P(J.shL), P(J.shR), bd.armR[0] * hh * 1.25, bd.armR[0] * hh * 1.25, torsoMat, { tag: 'shoulders' }));
    // Manteau long : une jupe de manteau jusqu'aux genoux.
    if (topStyle === 'coat') {
      const hemC = add(J.pelvis, mv(J.Rp, [0.02, -0.25, 0]));
      prims.push(egg(P(hemC), ax(J.Rp), [bd.pelv[0] * 1.15 * hh, 0.55 * hh, bd.pelv[2] * 1.15 * hh], 'top', { tag: 'coat', cls: (q, h) => (q[1] > 0.95 ? false : (q[1] < -0.75 && (h.dv = -1), true)) }));
    }
    if (bottomStyle === 'skirt') {
      const hemC = add(J.pelvis, mv(J.Rp, [0.02, -0.22, 0]));
      prims.push(egg(P(hemC), ax(J.Rp), [bd.pelv[0] * 1.25 * hh, 0.45 * hh, bd.pelv[2] * 1.3 * hh], 'bottom', { tag: 'skirt', cls: (q) => q[1] < 0.9 }));
    }

    // --- Bras ---
    for (const side of ['L', 'R']) {
      const far = farSide === side;
      const sh = P(J[`sh${side}`]);
      const el = P(J[`elbow${side}`]);
      const wr = P(J[`wrist${side}`]);
      const [r0, r1, r2] = bd.armR.map((r) => r * hh);
      const fore = sleeves === 'short' ? 'skin' : 'top';
      const piping = topStyle === 'jacket' && hh >= 6; // liseré lisible seulement en grand
      // Liseré clair sur l'extérieur de la manche (veste de survêtement).
      const out = norm(D(mv(J.Rt, [0, 0, side === 'L' ? 1 : -1])));
      const pip = (h) => {
        if (piping && h.nx * out[0] + h.ny * out[1] + h.nz * out[2] > 0.82) h.m = 'trim';
        return true;
      };
      prims.push(
        tube(sh, el, r0, r1, 'top', {
          far,
          tag: 'upperarm',
          cls: (h) => {
            if (sleeves === 'short' && h.t > 0.5) h.m = 'skin';
            if (h.t > 0.78 && h.nz < 0.6 && sleeves !== 'short') h.dv = -1; // pli du coude
            return pip(h);
          },
        }),
      );
      prims.push(
        tube(el, wr, r1, r2, fore, {
          far,
          tag: 'forearm',
          cls: (h) => {
            if (fore === 'top' && h.t > 0.8) h.m = 'cuff';
            return pip(h);
          },
        }),
      );
      // La main : un petit œuf dans le prolongement de l'avant-bras.
      const hd = D(J[`hdir${side}`]);
      const hc = P(J[`hand${side}`]);
      const hr = Math.max(0.7, bd.armR[2] * hh * 1.25);
      prims.push(tube(hc, add(hc, mul(norm(hd), hr * 0.9)), hr, hr * 0.8, 'skin', { far, tag: 'hand' }));
    }

    // --- Cou et tête ---
    const Rh = J.Rh;
    const hAx = ax(Rh);
    const hr = bd.head.map((r) => r * hh);
    const hc = P(J.headC);
    prims.push(tube(P(J.neck), P(add(J.neck, mv(Rh, [0.02, 0.32, 0]))), bd.neck * hh, bd.neck * hh, 'skin', { tag: 'neck', cls: (h) => ((h.dv = -1), true) }));
    // Crâne (le visage est la partie avant) et mâchoire un peu plus étroite.
    prims.push(egg(hc, hAx, hr, 'skin', { tag: 'skull' }));
    const jawC = add(J.headC, mv(Rh, [0.08, -0.2, 0]));
    prims.push(egg(P(jawC), hAx, [hr[0] * 0.78, hr[1] * 0.62, hr[2] * 0.8], 'skin', { tag: 'jaw' }));
    // Nez (une petite bosse) et oreilles.
    prims.push(ball(P(add(J.headC, mv(Rh, [bd.head[0] * 0.96, -0.1, 0]))), Math.max(0.55, 0.075 * hh), 'skin', { tag: 'nose' }));
    if (!(st.locks === 'long' || st.locks === 'bob' || look.phones)) {
      for (const s of [1, -1]) prims.push(egg(P(add(J.headC, mv(Rh, [-0.02, -0.04, s * bd.head[2] * 0.95]))), hAx, [0.1 * hh, 0.14 * hh, 0.07 * hh], 'skin', { tag: 'ear', cls: (q, h) => ((h.dv = -1), true) }));
    }

    // --- Cheveux ---
    const seed = look.seed || 1;
    if (st !== STYLES.bald) {
      const capC = add(J.headC, mv(Rh, [st.capOff[0], st.capOff[1], 0]));
      const capR = [hr[0] * st.cap[0], hr[1] * st.cap[1], hr[2] * st.cap[2]];
      const hat = look.hat;
      prims.push(
        egg(P(capC), hAx, capR, 'hair', {
          tag: 'hair',
          inner: true,
          cls: (q, h, front) => {
            // q : [avant, haut, gauche] sur la calotte.
            const hl = st.hairline + (Math.abs(q[2]) < 0.55 ? st.bangs - st.hairline : 0) * (1 - Math.abs(q[2]) / 0.55);
            const face = q[0] > 0.12 && q[1] < hl;
            if (face) return false;
            if (q[1] < st.nape && q[0] < 0.3) return false; // nuque dégagée
            if (q[1] < -0.55 && q[0] > -0.2 && st.locks !== 'long' && st.locks !== 'bob') return false;
            const hlow = hat ? (hat.low == null ? 0.22 : hat.low) : 0;
            if (hat && q[1] > hlow) {
              h.m = q[1] < hlow + 0.13 ? 'hatBand' : 'hat';
              return true;
            }
            if (!front) {
              h.dv = -2;
              return true;
            }
            h.t = (Math.atan2(q[2], q[0]) / Math.PI) * 7 + 20;
            h.u = clamp(1 - (q[1] + 1) / 2, 0, 1);
            h.strand = 1;
            return true;
          },
        }),
      );
      if (hat && hat.pom) prims.push(ball(P(add(capC, mv(Rh, [-0.05, capR[1] / hh + 0.05, 0]))), 0.16 * hh, 'hatBand', { tag: 'pom' }));
      const lockMat = 'hair';
      const back = (u, f, s) => add(J.headC, mv(Rh, [f, u, s]));
      const sw = (k) => [Math.sin(sway) * k * 0.08, 0, Math.cos(sway * 0.7) * k * 0.03];
      const lockCls = (k) => (h) => {
        h.strand = 1;
        h.u = h.t;
        h.t = (Math.atan2(h.ny, h.nx) / Math.PI) * 3 + k * 5.3;
        return true;
      };
      const chain = (pts, rs, tag) => {
        for (let i = 0; i < pts.length - 1; i++) prims.push(tube(P(pts[i]), P(pts[i + 1]), rs[i] * hh, rs[i + 1] * hh, lockMat, { tag, cls: lockCls(i + tag.length) }));
      };
      if (st.locks === 'long') {
        // Rideau de cheveux dans le dos, qui s'évase un peu en bas, et deux mèches
        // qui encadrent le visage.
        const down = (p, d) => add(p, [0, -d, 0]);
        const b0 = back(0.02, -0.26, 0);
        const b1 = add(down(b0, 0.7), add(mv(J.Rt, [-0.16, 0, 0]), sw(1)));
        const b2 = add(down(b1, 0.65), add(mv(J.Rt, [-0.06, 0, 0]), sw(2)));
        for (const s of [-0.22, 0.22]) chain([add(b0, mv(Rh, [0, 0, s])), add(b1, mv(J.Rt, [0, 0, s * 1.5])), add(b2, mv(J.Rt, [0.02, 0, s * 1.6]))], [0.36, 0.33, 0.24], 'back');
        chain([b0, b1, b2], [0.4, 0.36, 0.26], 'back');
        for (const s of [1, -1]) {
          const f0 = back(-0.02, -0.04, s * 0.41);
          const f1 = add(down(f0, 0.55), add(mv(J.Rt, [0.06, 0, s * 0.06]), sw(1)));
          const f2 = add(down(f1, 0.45), add(mv(J.Rt, [0.0, 0, s * 0.05]), sw(2)));
          chain([f0, f1, f2], [0.13, 0.12, 0.07], 'side');
        }
      } else if (st.locks === 'bob') {
        for (const s of [1, -1, 0]) {
          const f0 = back(0.05, s ? 0.0 : -0.2, s * 0.32);
          const f1 = add(f0, add(mv(Rh, [s ? 0.02 : -0.1, -0.52, s * 0.09]), sw(0.6)));
          chain([f0, f1], s ? [0.2, 0.17] : [0.32, 0.3], 'bob');
        }
      } else if (st.locks === 'messy') {
        // Mèches en bataille : des touffes qui dépassent un peu partout.
        const R = (i) => hash(i, 3, seed);
        for (let i = 0; i < 9; i++) {
          const a = Math.PI * (0.42 + (1.16 * i) / 8) + (R(i) - 0.5) * 0.3; // côtés, dessus et nuque (pas devant le visage)
          const el = 0.25 + R(i + 9) * 0.55;
          const base = back(Math.sin(el) * 0.42, Math.cos(a) * Math.cos(el) * 0.36, Math.sin(a) * Math.cos(el) * 0.3);
          const out = norm(mv(Rh, [Math.cos(a) * 0.9, 0.55 + R(i + 3) * 0.4, Math.sin(a) * 0.7]));
          const tip = add(add(base, mul(out, 0.3 + R(i + 5) * 0.16)), [0, -0.12, 0]);
          prims.push(tube(P(base), P(tip), 0.17 * hh, 0.04 * hh, lockMat, { tag: 'tuft', cls: lockCls(i) }));
        }
        // Frange qui retombe sur le front.
        for (const s of [-0.2, 0.02, 0.22]) {
          const f0 = back(0.4, 0.28, s);
          const f1 = back(0.2, 0.5, s + 0.08);
          prims.push(tube(P(f0), P(f1), 0.13 * hh, 0.05 * hh, lockMat, { tag: 'fringe', cls: lockCls(s * 10) }));
        }
      } else if (st.locks === 'bun') {
        prims.push(egg(P(back(0.36, -0.4, 0)), hAx, [0.25 * hh, 0.22 * hh, 0.27 * hh], lockMat, { tag: 'bun', cls: (q, h) => ((h.strand = 1), (h.t = Math.atan2(q[2], q[1]) * 2.5 + 30), (h.u = 0.5 - q[0] * 0.4), true) }));
        if (look.scrunchie) prims.push(tube(P(back(0.26, -0.3, -0.13)), P(back(0.26, -0.3, 0.13)), 0.09 * hh, 0.09 * hh, 'scrunchie', { tag: 'scr' }));
      } else if (st.locks === 'pony') {
        const p0 = back(0.18, -0.42, 0);
        const p1 = add(p0, add([-0.12, -0.3, 0], sw(1)));
        const p2 = add(p1, add([-0.02, -0.4, 0], sw(2)));
        chain([p0, p1, p2], [0.14, 0.16, 0.07], 'pony');
      } else if (st.locks === 'curly') {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const el = 0.2 + hash(i, 4, seed) * 0.8;
          const p = back(Math.sin(el) * 0.5 + 0.05, Math.cos(a) * Math.cos(el) * 0.42 - 0.05, Math.sin(a) * Math.cos(el) * 0.42);
          prims.push(ball(P(p), (0.15 + hash(i, 5, seed) * 0.06) * hh, lockMat, { tag: 'curl', cls: (h) => ((h.strand = 1), (h.t = i * 2.3), (h.u = 0.4), true) }));
        }
      }
    }

    // --- Accessoires ---
    if (look.scarf) {
      // Écharpe : un boudin autour du cou et un pan qui pend devant.
      const n0 = add(J.neck, mv(Rt, [0, 0.04, 0]));
      const ring = [];
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ring.push(add(n0, mv(Rt, [Math.cos(a) * 0.17, 0, Math.sin(a) * 0.19])));
      }
      for (let k = 0; k < 8; k++) prims.push(tube(P(ring[k]), P(ring[k + 1]), 0.12 * hh, 0.12 * hh, 'scarf', { tag: 'scarf' }));
      const e0 = add(n0, mv(Rt, [0.2, -0.02, 0.1]));
      const e1 = add(e0, add(mv(Rt, [0.08, -0.5, 0.02]), [Math.sin(sway) * 0.05, 0, 0]));
      prims.push(tube(P(e0), P(e1), 0.1 * hh, 0.09 * hh, 'scarf', { tag: 'scarfEnd', cls: (h) => (h.t > 0.85 ? ((h.dv = -1), true) : true) }));
    }
    if (topStyle === 'hoodie') {
      // Capuche roulée sur la nuque et les épaules (un boudin en fer à cheval).
      const n0 = add(J.neck, mv(Rt, [-0.06, -0.04, 0]));
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI * 0.35 + (k / 8) * Math.PI * 1.3;
        pts.push(add(n0, mv(Rt, [Math.cos(a) * 0.3, 0.06 - Math.cos(a) * 0.05, Math.sin(a) * 0.32])));
      }
      for (let k = 0; k < 8; k++) prims.push(tube(P(pts[k]), P(pts[k + 1]), 0.15 * hh, 0.15 * hh, 'top', { tag: 'hood', cls: (h) => ((h.dv = h.ny > 0.2 ? -1 : 0), true) }));
    }
    if (look.phones) {
      // Casque : arceau par-dessus la tête et deux oreillettes.
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * Math.PI;
        pts.push(add(J.headC, mv(Rh, [-0.05, Math.sin(a) * 0.66 + 0.0, Math.cos(a) * 0.52])));
      }
      for (let k = 0; k < 8; k++) prims.push(tube(P(pts[k]), P(pts[k + 1]), 0.085 * hh, 0.085 * hh, 'phones', { tag: 'band', zb: 0.3 }));
      for (const s of [1, -1]) {
        const c = add(J.headC, mv(Rh, [-0.02, -0.06, s * 0.5]));
        prims.push(egg(P(c), hAx, [0.19 * hh, 0.22 * hh, 0.1 * hh], 'phones', { tag: 'cup', cls: (q, h) => (q[2] * s > 0.5 ? ((h.m = 'phonesHi'), true) : true) }));
      }
    }
    if (look.bag) {
      // Sac en bandoulière, sur la hanche droite.
      const c = add(J.pelvis, mv(J.Rp, [0.0, 0.1, -0.42]));
      prims.push(egg(P(c), ax(J.Rp), [0.22 * hh, 0.2 * hh, 0.08 * hh], 'bag', { tag: 'bag' }));
      prims.push(tube(P(add(J.shL, mv(Rt, [0.12, 0.02, -0.05]))), P(add(c, mv(J.Rp, [0.1, 0.15, 0.05]))), 0.05 * hh, 0.05 * hh, 'bagStrap', { tag: 'strap', zb: 0.4 }));
    }
    if (look.backpack) {
      const c = add(J.chest, mv(Rt, [-0.36, -0.08, 0]));
      prims.push(egg(P(c), tAx, [0.18 * hh, 0.4 * hh, 0.3 * hh], 'bag', { tag: 'backpack' }));
    }

    // Accessoires propres à la pose (livre, tasse, guitare…), fournis par la pose.
    if (pose.props) pose.props({ J, P, D, hh, prims, ax, tube, ball, egg, slab, look, add, mv, mul, norm, sub });

    // Points utiles, en coordonnées écran.
    const pts = {
      handL: P(J.handL),
      handR: P(J.handR),
      head: hc,
      top: P(add(J.headC, mv(Rh, [0, 0.62, 0]))),
      pelvis: P(J.pelvis),
      neck: P(J.neck),
      mouth: P(add(J.headC, mv(Rh, [0.42, -0.22, 0]))),
    };
    if (pose.points) Object.assign(pts, pose.points({ J, P, hh, add, mv }));
    // Les yeux (posés après coup sur le visage).
    const eyes = [];
    for (const s of [1, -1]) {
      const local = [bd.head[0] * 0.84, -0.03, s * bd.head[2] * 0.48];
      eyes.push({ p: P(add(J.headC, mv(Rh, local))), n: norm(D(mv(Rh, norm([0.75, 0, s * 0.62])))) });
    }
    return { prims, pts, eyes, cam, J };
  }

  /* ================= Peinture ================= */
  const LIGHT = norm([-0.55, -0.8, 0.55]); // de haut à gauche, un peu de face

  // Peint une liste de primitives dans un Raster (w × h), origine du monde en (ox, oy).
  function paint(model, look, w, h, ox, oy, opt) {
    const { prims, eyes } = model;
    const n = w * h;
    const Z = new Float32Array(n).fill(-1e9);
    const ID = new Int16Array(n).fill(-1);
    const NX = new Float32Array(n);
    const NY = new Float32Array(n);
    const NZ = new Float32Array(n);
    const TA = new Float32Array(n);
    const TB = new Float32Array(n);
    const MAT = new Array(n).fill(null);
    const DV = new Int8Array(n);
    const STR = new Uint8Array(n);
    const hit = {};
    prims.forEach((pr, i) => {
      const x0 = Math.max(0, Math.floor(pr.bb[0] + ox) - 1);
      const y0 = Math.max(0, Math.floor(pr.bb[1] + oy) - 1);
      const x1 = Math.min(w - 1, Math.ceil(pr.bb[2] + ox) + 1);
      const y1 = Math.min(h - 1, Math.ceil(pr.bb[3] + oy) + 1);
      const zb = pr.zb || 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          hit.strand = 0;
          if (!pr.hit(x + 0.5 - ox, y + 0.5 - oy, hit)) continue;
          const k = y * w + x;
          const z = hit.z + zb;
          if (z <= Z[k]) continue;
          Z[k] = z;
          ID[k] = i;
          NX[k] = hit.nx;
          NY[k] = hit.ny;
          NZ[k] = hit.nz;
          MAT[k] = hit.m;
          DV[k] = hit.dv + (pr.far ? -1 : 0);
          TA[k] = hit.t;
          TB[k] = hit.u;
          STR[k] = hit.strand ? 1 : 0;
        }
      }
    });

    // Rampes de couleurs du personnage.
    const R = opt.ramps;
    const L = opt.light ? norm(opt.light) : LIGHT;
    const T = new Int8Array(n).fill(-1);
    for (let k = 0; k < n; k++) {
      if (ID[k] < 0) continue;
      const m = MAT[k];
      const lam = NX[k] * L[0] + NY[k] * L[1] + NZ[k] * L[2];
      let lum = 0.5 + 0.5 * lam; // « demi-Lambert » : les ombres restent lisibles
      if (m === 'skin') lum = lum * 0.9 + 0.12;
      let tone = lum < 0.36 ? 1 : lum < 0.6 ? 2 : lum < 0.86 ? 3 : 4;
      if (m !== 'hair' && tone === 4 && lum < 0.93) tone = 3; // reflets rares hors cheveux
      if (STR[k]) tone += strand(TA[k], TB[k], lum, look.seed || 1);
      tone += DV[k];
      T[k] = clamp(tone, 0, 4);
    }
    // Nettoyage : un pixel isolé d'un ton prend le ton de ses voisins (aplats propres).
    const T2 = T.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const k = y * w + x;
        if (T[k] < 0) continue;
        const nb = [k - 1, k + 1, k - w, k + w].filter((j) => T[j] >= 0 && MAT[j] === MAT[k]);
        if (nb.length < 3) continue;
        if (nb.some((j) => T[j] === T[k])) continue;
        const cnt = {};
        for (const j of nb) cnt[T[j]] = (cnt[T[j]] || 0) + 1;
        let best = T[k];
        let bc = 0;
        for (const key of Object.keys(cnt)) if (cnt[key] > bc) ((bc = cnt[key]), (best = +key));
        if (bc >= 2) T2[k] = best;
      }
    }
    // Trait d'occlusion : un volume qui passe devant un autre dessine un trait sombre
    // sur celui de derrière (bras devant le buste, mèche devant l'épaule…).
    const thr = opt.lineDepth || Math.max(1.2, opt.hh * 0.22);
    const LINE = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (ID[k] < 0) continue;
        for (const j of [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1]) {
          if (j < 0 || ID[j] < 0 || ID[j] === ID[k]) continue;
          if (Z[j] - Z[k] > thr) {
            LINE[k] = 1;
            break;
          }
        }
      }
    }
    const r = new Raster(w, h);
    for (let k = 0; k < n; k++) {
      if (ID[k] < 0) continue;
      const rp = R[MAT[k]] || R.top;
      let t = T2[k];
      if (LINE[k]) t = Math.min(t, MAT[k] === 'skin' ? 1 : 0); // la peau garde un trait plus doux
      r.set(k % w, (k / w) | 0, rp[clamp(t, 0, 4)]);
    }
    // Les yeux : un ou deux pixels sombres, seulement s'ils sont visibles.
    if (opt.face !== false) {
      const eyeC = toC(look.eyes || '#2a1828');
      for (const e of eyes) {
        if (e.n[2] < 0.3) continue; // œil tourné vers nous seulement
        const x = Math.floor(e.p[0] + ox);
        const y = Math.floor(e.p[1] + oy);
        const k = y * w + x;
        if (x < 0 || y < 0 || x >= w || y >= h || ID[k] < 0) continue;
        const tag = model.prims[ID[k]].tag;
        if ((tag !== 'skull' && tag !== 'jaw' && tag !== 'nose') || MAT[k] !== 'skin') continue;
        if (Math.abs(Z[k] - e.p[2]) > opt.hh * 0.35) continue;
        r.set(x, y, eyeC);
        if (opt.hh >= 6.5 && y + 1 < h && ID[k + w] >= 0 && model.prims[ID[k + w]].tag !== 'hair') r.set(x, y + 1, mix(eyeC, R.skin[1], 0.25));
        if (opt.hh >= 7 && look.blush !== false && x + (e.n[0] > 0 ? 1 : -1) >= 0) {
          const bx = x + (e.n[0] > 0.2 ? 1 : e.n[0] < -0.2 ? -1 : 0);
          const bk = (y + 2) * w + bx;
          if (ID[bk] >= 0 && MAT[bk] === 'skin') r.set(bx, y + 2, mix(R.skin[2], hex('#f07a8a'), 0.35));
        }
      }
    }
    // Contour : violet-noir à l'ombre, plus doux du côté de la lumière.
    const ink = toC(look.ink || INK);
    const out = new Raster(w, h);
    out.data.set(r.data);
    const sel = opt.outline !== false;
    const lx = L[0];
    const ly = L[1];
    if (sel) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const k = y * w + x;
          if (ID[k] >= 0) continue;
          let best = null;
          let lit = 0;
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (ID[j] < 0) continue;
            best = j;
            // Le pixel de contour est du côté de la lumière si on va vers elle.
            lit = Math.max(lit, -dx * lx + -dy * ly);
          }
          if (best == null) continue;
          const rp = R[MAT[best]] || R.top;
          const c = lit > 0.5 ? mix(rp[0], ink, 0.35) : mix(rp[0], ink, 0.72);
          out.set(x, y, c);
        }
      }
    }
    // Liseré de lumière (ciel, fenêtre, feu) sur le bord du personnage.
    if (opt.rim) {
      const rc = toC(opt.rim.color);
      const dirs = Array.isArray(opt.rim.dir[0]) ? opt.rim.dir : [opt.rim.dir];
      const k0 = opt.rim.k == null ? 0.5 : opt.rim.k;
      const only = opt.rim.mats; // matières concernées (toutes par défaut)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const k = y * w + x;
          if (ID[k] < 0 || (only && !only.includes(MAT[k]))) continue;
          let edge = false;
          for (const [rdx, rdy] of dirs) {
            const xx = x + rdx;
            const yy = y + rdy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || ID[yy * w + xx] < 0) edge = true;
          }
          if (!edge) continue;
          const p = r.get(x, y);
          out.set(x, y, mix(p, rc, k0));
        }
      }
    }
    return { r: out, Z, ID };
  }

  /* ================= Rampes d'un personnage ================= */
  function rampsOf(look) {
    const R = {
      skin: skinRamp(look.skin || '#e8b896'),
      hair: hairRamp(look.hairColor || '#4a2c22'),
      top: ramp(look.top || '#8a5bb0'),
      cuff: null,
      trim: ramp(look.trim || '#e8e0d0', { lift: 0.12 }),
      bottom: ramp(look.bottom || '#2e3048'),
      tights: ramp(look.tights || '#2a2430'),
      shoe: ramp(look.shoes || '#2a2228'),
      sole: ramp(look.sole || '#d8d0c4', { lift: 0.1 }),
      scarf: ramp(look.scarf || '#c8463c'),
      hat: ramp((look.hat && look.hat.color) || '#c8463c'),
      hatBand: ramp((look.hat && (look.hat.band || look.hat.color)) || '#e8e0d0'),
      phones: ramp(look.phones || '#2a2a34', { lift: 0.3 }),
      phonesHi: ramp(look.phonesHi || '#de6c8c'),
      bag: ramp(look.bagColor || '#7a4a2a'),
      bagStrap: ramp('#3a2418'),
      scrunchie: ramp(look.scrunchie || '#e26a8e'),
      print: ramp(look.moon || '#f2d27a', { dl: [-0.2, -0.1, 0, 0.05, 0.1] }),
    };
    // Poignets : même couleur que le haut, un cran plus sombre (bord côtelé).
    R.cuff = R.top.map((c, i) => R.top[Math.max(0, i - 1)]);
    // Objets tenus (parapluie, livre, tasse, guitare…) : couleurs par défaut, modifiables.
    const PROPS = {
      umb: '#d4564f', umb2: '#e8c547', shaft: '#3a2a24', book: '#b8483c', page: '#f2ead8', mug: '#ece4d8', coffee: '#5a3422',
      guitar: '#d8903a', guitarDk: '#5a2a14', fret: '#3a2418', metal: '#a8a8b4', stick: '#5a3a22', rod: '#4a3426', kite: '#e8403a', phone: '#2a2a34', screen: '#8ad0ff',
      ...(look.props || {}),
    };
    for (const k of Object.keys(PROPS)) if (!R[k]) R[k] = k === 'page' || k === 'mug' || k === 'screen' ? ramp(PROPS[k], { dl: [-0.3, -0.14, 0, 0.04, 0.08] }) : ramp(PROPS[k]);
    if (look.ramps) Object.assign(R, look.ramps);
    return R;
  }

  /* ================= Rendu d'une pose / d'une planche ================= */
  // Rend une pose dans une grande toile ; renvoie le Raster et les points utiles.
  // opt : { hh (hauteur d'une tête, px), view, tilt, light, rim, outline, ramps }
  function renderPose(look, pose, opt, ramps) {
    const hh = opt.hh;
    const size = Math.ceil(hh * 9);
    const w = size;
    const h = size;
    const ox = Math.round(w / 2);
    const oy = Math.round(h * 0.8);
    const model = assemble(look, pose, opt);
    const { r } = paint(model, look, w, h, ox, oy, { ...opt, ramps });
    const pts = {};
    for (const k of Object.keys(model.pts)) pts[k] = [model.pts[k][0] + ox, model.pts[k][1] + oy];
    return { r, ox, oy, pts };
  }

  // Boîte englobante des pixels opaques.
  function bbox(r) {
    let x0 = r.w;
    let y0 = r.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        if (!r.data[(y * r.w + x) * 4 + 3]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return [x0, y0, x1, y1];
  }
  function crop(r, x0, y0, w, h) {
    const o = new Raster(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x + x0;
        const sy = y + y0;
        if (sx < 0 || sy < 0 || sx >= r.w || sy >= r.h) continue;
        const i = (sy * r.w + sx) * 4;
        if (!r.data[i + 3]) continue;
        const j = (y * w + x) * 4;
        o.data[j] = r.data[i];
        o.data[j + 1] = r.data[i + 1];
        o.data[j + 2] = r.data[i + 2];
        o.data[j + 3] = r.data[i + 3];
      }
    }
    return o;
  }

  // Planche : plusieurs poses nommées (une pose ou une liste d'images), toutes recadrées
  // sur la même boîte, avec le même point d'ancrage (ax, ay) = origine du monde (le sol
  // sous le bassin, ou le siège pour une pose assise).
  // poses : { nom: pose | [pose, pose…] } ; renvoie { frames: { nom: Raster | [Raster] },
  // pts: { nom: pts | [pts] }, w, h, ax, ay }.
  function sheet(look, poses, opt) {
    const ramps = rampsOf(look);
    const out = {};
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    let ox = 0;
    let oy = 0;
    for (const name of Object.keys(poses)) {
      const list = Array.isArray(poses[name]) ? poses[name] : [poses[name]];
      out[name] = list.map((p) => {
        const res = renderPose(look, p, { ...opt, ...(p.opt || {}) }, ramps);
        const b = bbox(res.r);
        if (b[2] >= 0) {
          bx0 = Math.min(bx0, b[0]);
          by0 = Math.min(by0, b[1]);
          bx1 = Math.max(bx1, b[2]);
          by1 = Math.max(by1, b[3]);
        }
        ox = res.ox;
        oy = res.oy;
        return res;
      });
    }
    const w = bx1 - bx0 + 1;
    const h = by1 - by0 + 1;
    const frames = {};
    const pts = {};
    for (const name of Object.keys(out)) {
      const fr = out[name].map((res) => crop(res.r, bx0, by0, w, h));
      const pp = out[name].map((res) => {
        const o = {};
        for (const k of Object.keys(res.pts)) o[k] = [Math.round(res.pts[k][0] - bx0), Math.round(res.pts[k][1] - by0)];
        return o;
      });
      const single = !Array.isArray(poses[name]);
      frames[name] = single ? fr[0] : fr;
      pts[name] = single ? pp[0] : pp;
    }
    return { frames, pts, w, h, ax: ox - bx0, ay: oy - by0 };
  }

  // Transforme les Raster d'une planche en images (canvas), avec un éclairage optionnel :
  // fn(raster, sheet) peut par exemple appliquer B.PXC.applyLight avec les lampes de la scène.
  function bake(sh, fn) {
    const conv = (r) => {
      if (fn) fn(r, sh);
      return r.toCanvas();
    };
    const frames = {};
    for (const k of Object.keys(sh.frames)) frames[k] = Array.isArray(sh.frames[k]) ? sh.frames[k].map(conv) : conv(sh.frames[k]);
    return { ...sh, frames };
  }


  /* ================= Accessoires tenus en main ================= */
  // Parapluie : manche depuis la main, dôme à panneaux de deux couleurs.
  function umbrellaProp(side, o = {}) {
    return (k) => {
      const { J, P, hh, prims, egg, tube } = k;
      const hand = J[`hand${side}`];
      const top = add(hand, o.off || [0.14, 1.72, 0]);
      prims.push(tube(P(add(hand, [0, -0.15, 0])), P(top), 0.05 * hh, 0.05 * hh, 'shaft', { tag: 'shaft' }));
      const cam = k.D;
      const A = [norm(cam([1, 0, 0])), norm(cam([0, 1, 0])), norm(cam([0, 0, 1]))];
      const R = o.r || 1.25;
      prims.push(
        egg(P(add(top, [0, -0.22, 0])), A, [R * hh, 0.6 * hh, R * hh], 'umb', {
          tag: 'umbrella',
          inner: true,
          cls: (q, h, front) => {
            if (q[1] < 0.05) return false;
            const a = Math.atan2(q[2], q[0]);
            h.m = Math.floor((a / Math.PI) * 4 + 8) % 2 ? 'umb' : 'umb2';
            if (!front) h.dv = -2;
            else if (q[1] < 0.2) h.dv = -1; // bord du dôme
            return true;
          },
        }),
      );
      prims.push(ball(P(add(top, [0, 0.42, 0])), 0.07 * hh, 'shaft', { tag: 'tip' }));
    };
  }
  // Livre ouvert (deux pages, couverture), centre c, demi-largeur w, inclinaison tilt.
  function bookProp(c, o = {}) {
    return (k) => {
      const { P, hh, prims, slab, D } = k;
      const w = o.w || 0.3;
      const e1 = mul(D(o.across || [0, 0, 1]), w * hh);
      const t = o.tilt == null ? 0.55 : o.tilt;
      const e2 = mul(D(norm(o.along || [Math.cos(t), Math.sin(t), 0])), (o.h || 0.21) * hh);
      const nrm = norm(cross(e1, e2));
      const back = mul(nrm, nrm[2] > 0 ? -0.06 * hh : 0.06 * hh);
      prims.push(slab(add(P(c), back), mul(e1, 1.08), mul(e2, 1.1), 'book', { tag: 'cover' }));
      prims.push(
        slab(P(c), e1, e2, 'page', {
          tag: 'pages',
          zb: 0.05,
          cls: (h) => {
            if (Math.abs(h.t) < 0.08) h.dv = -1; // reliure
            else if (Math.abs(h.t) > 0.3 && Math.abs(h.t) < 0.85 && Math.abs(h.u) < 0.7 && Math.floor((h.u + 1) * 4.5) % 2 === 0) h.dv = -1; // lignes de texte
            return true;
          },
        }),
      );
      if (o.flip) {
        // Une page qui se tourne : debout au-dessus de la reliure.
        const up = mul(D([0, 1, 0]), 0.24 * hh);
        prims.push(slab(add(P(c), add(mul(e1, -0.15), up)), mul(e1, 0.35), mul(up, 1), 'page', { tag: 'flip', zb: 0.3 }));
      }
    };
  }
  // Tasse tenue dans la main.
  function mugProp(side, o = {}) {
    return (k) => {
      const { J, P, hh, prims, tube } = k;
      const c = add(J[`hand${side}`], o.off || [0.06, 0.06, 0]);
      prims.push(tube(P(add(c, [0, -0.12, 0])), P(add(c, [0, 0.12, 0])), 0.14 * hh, 0.15 * hh, 'mug', { tag: 'mug', zb: o.zb || 0 }));
    };
  }
  // Bâton, canne à pêche… : un tube depuis la main, dans une direction.
  function stickProp(side, dir, L, mat, o = {}) {
    return (k) => {
      const { J, P, hh, prims, tube } = k;
      const h = J[`hand${side}`];
      const d = norm(dir);
      const a = add(h, mul(d, -(o.back || 0.15)));
      const b = add(h, mul(d, L));
      prims.push(tube(P(a), P(b), (o.r0 || 0.06) * hh, (o.r1 || 0.03) * hh, mat, { tag: mat }));
    };
  }
  // Guitare tenue en travers des genoux (repère du corps).
  function guitarProp(o) {
    return (k) => {
      const { P, hh, prims, egg, tube, D } = k;
      const c = o.c;
      const along = norm(o.along); // vers la tête de la guitare
      const n0 = norm(o.face); // la table regarde par là
      const nrm = norm(sub(n0, mul(along, dot(n0, along))));
      const wide = norm(cross(along, nrm));
      const A = [norm(D(nrm)), norm(D(wide)), norm(D(along))];
      const deco = (q, h) => {
        if (Math.abs(q[0]) < 0.55) h.m = 'guitarDk'; // éclisses
        else if (q[0] > 0 && q[1] * q[1] + (q[2] - 0.62) * (q[2] - 0.62) < 0.07) h.m = 'fret'; // rosace
        else if (q[0] > 0 && Math.abs(q[2] + 0.45) < 0.09 && Math.abs(q[1]) < 0.4) h.m = 'guitarDk'; // chevalet
        return true;
      };
      prims.push(egg(P(c), A, [0.14 * hh, 0.5 * hh, 0.56 * hh], 'guitar', { tag: 'gbody', cls: deco }));
      prims.push(egg(P(add(c, mul(along, 0.58))), A, [0.13 * hh, 0.38 * hh, 0.34 * hh], 'guitar', { tag: 'gbody2', cls: (q, h) => (Math.abs(q[0]) < 0.55 ? ((h.m = 'guitarDk'), true) : q[0] > 0 && q[1] * q[1] + (q[2] + 0.3) * (q[2] + 0.3) < 0.12 ? ((h.m = 'fret'), true) : true) }));
      const n1 = add(c, add(mul(along, 0.75), mul(nrm, 0.06)));
      const n2 = add(c, add(mul(along, 1.75), mul(nrm, 0.06)));
      prims.push(tube(P(n1), P(n2), 0.075 * hh, 0.065 * hh, 'fret', { tag: 'neck' }));
      prims.push(tube(P(n2), P(add(n2, mul(along, 0.28))), 0.1 * hh, 0.09 * hh, 'guitarDk', { tag: 'head' }));
    };
  }
  const seq = (...fns) => (k) => fns.forEach((f) => f && f(k));

  /* ================= Poses ================= */
  // Debout, bras le long du corps ; br (0–1) : respiration.
  function stand(o = {}) {
    const br = o.br || 0;
    return {
      ground: true,
      lean: 0.03 + br * 0.015,
      head: { nod: 0.06 - br * 0.03, turn: o.turn || 0, tilt: o.tilt || 0 },
      armL: o.armL || { pi: 0.03, ab: 0.1 + br * 0.03, el: 0.2 },
      armR: o.armR || { pi: -0.02, ab: 0.1 + br * 0.03, el: 0.22 },
      legL: { pi: 0.03, ab: 0.05 },
      legR: { pi: -0.03, ab: 0.05 },
      sway: o.sway || 0,
      props: o.props,
    };
  }
  // Marche : ph = phase du cycle (0 → 2π) pour la jambe gauche.
  function walk(ph, o = {}) {
    const st = o.stride == null ? 1 : o.stride;
    const leg = (p) => {
      const sw = Math.max(0, Math.cos(p + 0.3));
      return { pi: 0.42 * st * Math.sin(p), kn: 0.08 + 1.0 * sw * sw * st + 0.14 * Math.max(0, -Math.cos(p)), toe: 0.45 * sw * st - 0.12 * Math.max(0, Math.sin(p)), ab: 0.03 };
    };
    const arm = (p, side) => ({ pi: -0.38 * st * Math.sin(p), ab: 0.1, el: 0.22 + 0.3 * Math.max(0, -Math.sin(p)) });
    const pose = {
      ground: true,
      lean: 0.07,
      hips: -0.1 * Math.sin(ph) * st,
      twist: 0.16 * Math.sin(ph) * st,
      head: { nod: 0.05, turn: -0.06 * Math.sin(ph) * st },
      legL: leg(ph),
      legR: leg(ph + Math.PI),
      armL: arm(ph, 'L'),
      armR: arm(ph + Math.PI, 'R'),
      sway: ph,
    };
    if (o.hold) Object.assign(pose, o.hold(ph));
    pose.props = o.props;
    return pose;
  }
  // Assis : origine du monde = le siège sous le bassin ; seatH = hauteur du siège
  // au-dessus du sol (en têtes). Les pieds se posent au sol (ou pendent si dangle).
  function seated(o = {}) {
    const sh = o.seatH == null ? 1.0 : o.seatH;
    const fx = o.footF == null ? 0.9 : o.footF;
    const pose = {
      pelvis: [o.back || 0, 0.27, 0],
      lean: o.lean == null ? 0.1 : o.lean,
      twist: o.twist || 0,
      side: o.side || 0,
      head: o.head || { nod: 0.1 },
      sway: o.sway || 0,
      hideLegs: o.hideLegs,
    };
    if (o.dangle != null) {
      pose.legL = { pi: 1.45, kn: 1.25 + o.dangle, ab: 0.06, toe: 0.4 };
      pose.legR = { pi: 1.45, kn: 1.25 - o.dangle, ab: 0.06, toe: 0.4 };
    } else if (o.cross) {
      pose.legL = { foot: [fx + 0.1, -sh, -0.05], pole: [1, 0.6, 0.3] };
      pose.legR = { foot: [fx, -sh, -0.2], pole: [1, 0.4, -0.2] };
    } else {
      pose.legL = { foot: [fx, -sh, 0.22], pole: [1, 0.3, 0.25] };
      pose.legR = { foot: [fx - (o.stagger || 0), -sh, -0.22], pole: [1, 0.3, -0.25] };
    }
    return pose;
  }

  /* ================= Planches prêtes à l'emploi ================= */
  // Options communes : hh (taille d'une tête en px), light, rim, outline.
  const near = (view) => (Math.cos(view) >= 0 ? 'R' : 'L'); // la main la plus proche de nous

  // Passant qui marche (vers la droite et vers la gauche), n images.
  // o.carry : 'umbrella' | 'leash' | null.
  function walker(look, o = {}) {
    const n = o.frames || 6;
    const views = { right: o.view == null ? 0.32 : o.view, left: Math.PI - (o.view == null ? 0.32 : o.view) };
    const poses = {};
    for (const dir of ['right', 'left']) {
      const v = views[dir];
      const hs = near(v);
      poses[dir] = [];
      for (let i = 0; i < n; i++) {
        const ph = (i / n) * Math.PI * 2;
        let hold = null;
        let props = null;
        if (o.carry === 'umbrella') {
          hold = () => ({ [`arm${hs}`]: { hand: [0.32, 2.92, hs === 'L' ? 0.12 : -0.12], pole: [-0.2, -1, hs === 'L' ? 1 : -1] } });
          props = umbrellaProp(hs, { r: o.umbR || 1.3 });
        } else if (o.carry === 'leash') {
          hold = () => ({ [`arm${hs}`]: { pi: 0.45, ab: 0.15, el: 0.25 } });
        }
        const p = walk(ph, { hold, props, stride: o.stride });
        p.opt = { view: v };
        poses[dir].push(p);
      }
    }
    const sh = sheet(look, poses, { hh: o.hh || 5, light: o.light, rim: o.rim, tilt: o.tilt });
    const hk = (dir) => (near(views[dir]) === 'L' ? 'handL' : 'handR');
    return { sheet: sh, hand: { right: sh.pts.right.map((p) => p[hk('right')]), left: sh.pts.left.map((p) => p[hk('left')]) } };
  }

  // Chien qui trotte (même atelier : volumes simples), tourné vers la droite.
  function dogSheet(o = {}) {
    const s = o.size || 4; // ~ hauteur au garrot en px / 1
    const base = o.color || '#9a6438';
    const R = { fur: ramp(base), furHi: ramp(o.patch || '#e8dcc8'), nose: ramp('#1e1418'), collar: ramp(o.collar || '#d4564f') };
    const frames = { right: [], left: [] };
    const N = 4;
    for (const dir of ['right', 'left']) {
      for (let i = 0; i < N; i++) {
        const ph = (i / N) * Math.PI * 2;
        const cam = camera(dir === 'right' ? 0.18 : Math.PI - 0.18, 0.15, s);
        const P = (v) => cam.p(v);
        const prims = [];
        const A = [norm(cam.dir([1, 0, 0])), norm(cam.dir([0, 1, 0])), norm(cam.dir([0, 0, 1]))];
        const bob = Math.abs(Math.sin(ph)) * 0.05;
        const bodyC = [0, 1.05 + bob, 0];
        prims.push(egg(P(bodyC), A, [0.95 * s, 0.42 * s, 0.38 * s], 'fur', { tag: 'body', cls: (q, h) => (q[1] < -0.45 && q[0] > -0.2 ? ((h.m = 'furHi'), true) : true) }));
        const headC = [0.95, 1.6 + bob, 0];
        prims.push(egg(P(headC), A, [0.38 * s, 0.34 * s, 0.32 * s], 'fur', { tag: 'dhead' }));
        prims.push(tube(P(add(headC, [0.2, -0.1, 0])), P(add(headC, [0.52, -0.16, 0])), 0.2 * s, 0.15 * s, 'fur', { tag: 'snout', cls: (h) => (h.t > 0.85 ? ((h.m = 'nose'), true) : (h.ny > 0.3 && ((h.m = 'furHi'), true), true)) }));
        for (const z of [0.18, -0.18]) prims.push(tube(P(add(headC, [-0.1, 0.22, z])), P(add(headC, [-0.22, -0.18 + Math.sin(ph) * 0.04, z * 1.4])), 0.13 * s, 0.09 * s, 'fur', { tag: 'ear', far: z > 0, cls: (h) => ((h.dv = -1), true) }));
        prims.push(tube(P(add(headC, [-0.25, -0.28, 0])), P(add(headC, [-0.25, -0.28, 0.01])), 0.26 * s, 0.26 * s, 'collar', { tag: 'collar', zb: -0.2 }));
        // Pattes : trot en diagonale.
        const legs = [
          [0.6, 0.18, ph],
          [0.6, -0.18, ph + Math.PI],
          [-0.65, 0.18, ph + Math.PI],
          [-0.65, -0.18, ph],
        ];
        for (const [fx, fz, p] of legs) {
          const top = [fx, 1.0 + bob, fz];
          const swing = Math.sin(p) * 0.35;
          const lift = Math.max(0, Math.cos(p)) * 0.18;
          const foot = [fx + swing, 0.08 + lift, fz];
          prims.push(tube(P(top), P(foot), 0.17 * s, 0.12 * s, fz > 0 ? 'fur' : 'fur', { tag: 'leg', far: fz > 0 === (dir === 'right'), cls: (h) => (h.t > 0.8 ? ((h.m = 'furHi'), true) : true) }));
        }
        const wag = Math.sin(ph * 2) * 0.25;
        prims.push(tube(P([-0.85, 1.25 + bob, 0]), P([-1.2, 1.75 + bob, wag]), 0.12 * s, 0.07 * s, 'fur', { tag: 'tail' }));
        const W = Math.ceil(s * 5);
        const H = Math.ceil(s * 4);
        const ox = Math.round(W / 2);
        const oy = H - 1;
        const { r } = paint({ prims, eyes: [] }, { ink: o.ink }, W, H, ox, oy, { hh: s, ramps: R, light: o.light, face: false });
        // Œil et truffe.
        const eye = P(add(headC, [0.22, 0.08, 0]));
        r.set(Math.floor(eye[0] + ox), Math.floor(eye[1] + oy), hex('#1a1010'));
        frames[dir].push({ r, collar: P(add(headC, [-0.25, -0.28, 0])).map((v, j) => (j === 0 ? v + ox : v + oy)) });
      }
    }
    // Recadrage commun.
    let x0 = 1e9;
    let y0 = 1e9;
    let x1 = -1;
    let y1 = -1;
    for (const d of ['right', 'left'])
      for (const f of frames[d]) {
        const b = bbox(f.r);
        x0 = Math.min(x0, b[0]);
        y0 = Math.min(y0, b[1]);
        x1 = Math.max(x1, b[2]);
        y1 = Math.max(y1, b[3]);
      }
    const out = { w: x1 - x0 + 1, h: y1 - y0 + 1 };
    for (const d of ['right', 'left']) {
      out[d] = frames[d].map((f) => crop(f.r, x0, y0, out.w, out.h));
      out[`${d}Collar`] = frames[d].map((f) => [Math.round(f.collar[0] - x0), Math.round(f.collar[1] - y0)]);
    }
    return out;
  }

  /* ---------- Garde-robe : tirages variés pour la foule ---------- */
  const SKINS = ['#f2c8a8', '#e8b48e', '#d49a74', '#b07a56', '#8a5a3e', '#6a4230'];
  const HAIRS = ['#1e1a22', '#2e2018', '#4a2c1e', '#6a3e24', '#8a4a2a', '#c8a060', '#9a9aa4', '#2a1c2e'];
  const STYLE_LIST = ['long', 'bob', 'messy', 'bun', 'pony', 'short', 'curly', 'short'];
  const TOPS = {
    warm: ['#c8463c', '#3c5e7e', '#d8a03a', '#5e7a4a', '#8a6aa8', '#e0d4bc', '#4a8a8a', '#d87a8a', '#7a5aa8'],
    cold: ['#7a3a3a', '#2e3a5a', '#6a5a3a', '#3e4a3a', '#5a3a5a', '#3a3a44', '#8a5a3a', '#2a4a5a', '#a07a4a'],
  };
  const BOTTOMS = ['#2e3048', '#3a4a6a', '#22222c', '#5a4a3a', '#4a4a56', '#2a3a5a'];
  const SHOES = ['#2a2228', '#e8e0d8', '#6a3a2a', '#1e1e26', '#c84a3a'];
  const ACCENT = ['#e8c547', '#d4564f', '#e8e0d0', '#5a8a5a', '#3f8fb0', '#e26a8e'];

  // Tire une tenue au hasard (déterministe pour une graine donnée).
  // season : 'summer' | 'spring' | 'autumn' | 'winter' ; o.wet : sous la pluie.
  function randomLook(seed, o = {}) {
    const R = B.PX.rng(seed * 977 + 13);
    const pick = (a) => a[Math.floor(R() * a.length)];
    const cold = o.season === 'winter' || o.season === 'autumn' || o.cold;
    const body = R() < 0.5 ? 'f' : 'm';
    let hairStyle = pick(STYLE_LIST);
    if (body === 'm' && (hairStyle === 'long' || hairStyle === 'bun') && R() < 0.7) hairStyle = R() < 0.5 ? 'short' : 'messy';
    const hairColor = R() < 0.12 ? '#9a9aa4' : pick(HAIRS);
    const lk = {
      seed,
      body,
      skin: pick(SKINS),
      hairColor,
      hairStyle,
      top: pick(cold ? TOPS.cold : TOPS.warm),
      topStyle: cold ? (R() < 0.55 ? 'coat' : pick(['jacket', 'hoodie', 'sweater'])) : pick(['sweater', 'tee', 'hoodie', 'jacket', 'tee']),
      trim: pick(['#e8e0d0', '#d8d8e0', '#e8c547']),
      bottom: pick(BOTTOMS),
      bottomStyle: !cold && body === 'f' && R() < 0.3 ? 'skirt' : 'pants',
      tights: '#2a2430',
      shoes: pick(SHOES),
    };
    if (lk.topStyle === 'tee' && R() < 0.4) lk.sleeves = 'short';
    if (cold && R() < (o.season === 'winter' ? 0.75 : 0.35)) lk.scarf = pick(ACCENT);
    if (o.season === 'winter' && R() < 0.6) lk.hat = { color: pick(ACCENT), band: pick(['#e8e0d0', '#3a3a44']), pom: R() < 0.5 };
    if (R() < 0.25) {
      lk.bag = true;
      lk.bagColor = pick(['#7a4a2a', '#3a3a44', '#a85a3a', '#5a6a4a']);
    }
    if (o.wet) lk.props = { umb: pick(['#d4564f', '#3f8fb0', '#e8c547', '#2c2c34', '#8a5bb0', '#e26a8e']), umb2: null };
    if (lk.props) lk.props.umb2 = R() < 0.5 ? lk.props.umb : pick(['#e8e0d0', '#2c2c34', '#e8c547']);
    return lk;
  }

  // Les jeux de passants pour une foule (B.PXC.Crowd) : parapluies, promeneurs, enfant,
  // promeneur avec chien. o : { hh, season, wet, n, light, rim, seed }.
  function crowdSets(o = {}) {
    const hh = o.hh || 5;
    const n = o.n || 5;
    const seed = o.seed || 1;
    const toSet = (wk, extra) => {
      const b = bake(wk.sheet, o.bake);
      return { right: b.frames.right, left: b.frames.left, w: b.w, h: b.h, ax: b.ax, ay: b.ay, hand: wk.hand, frameDur: o.frameDur || 0.15, ...extra };
    };
    const umbrella = [];
    const dry = [];
    for (let i = 0; i < n; i++) {
      umbrella.push(toSet(walker(randomLook(seed + i * 7, { season: o.season, wet: true, cold: true }), { hh, carry: 'umbrella', light: o.light, rim: o.rim })));
      dry.push(toSet(walker(randomLook(seed + i * 7 + 3, { season: o.season }), { hh, light: o.light, rim: o.rim })));
    }
    // L'enfant en ciré jaune, capuche, bottes rouges.
    const kidLook = { seed: 4, body: 'kid', skin: '#eab48c', hairColor: '#6a3a1e', hairStyle: 'short', top: o.wet || o.season === 'autumn' ? '#f0c63c' : '#3a7ad0', topStyle: 'coat', bottom: '#2a2a3a', shoes: '#d24a3a', hat: o.wet ? { color: '#f0c63c', band: '#d8a828', low: -0.05 } : null };
    const kid = toSet(walker(kidLook, { hh: hh * 0.95, light: o.light, rim: o.rim, stride: 1.1 }), { frameDur: 0.12 });
    // Le promeneur et son chien.
    const dogLook = randomLook(seed + 101, { season: o.season, cold: o.wet });
    const dw = walker(dogLook, { hh, carry: 'leash', light: o.light, rim: o.rim });
    const dog = dogSheet({ size: Math.max(2.6, hh * 0.62), color: ['#9a6438', '#e8dcc8', '#3a3036'][seed % 3], patch: '#f0e6d4', light: o.light });
    const dogB = { right: dog.right.map((r) => (o.bake && o.bake(r), r.toCanvas())), left: dog.left.map((r) => (o.bake && o.bake(r), r.toCanvas())) };
    const dset = toSet(dw, { dogRight: dogB.right, dogLeft: dogB.left, dogW: dog.w, dogH: dog.h, collar: { right: dog.rightCollar, left: dog.leftCollar } });
    return { umbrella, dry, kid, dog: dset };
  }

  // Dessine un passant (et son chien) : utilisé par la foule et par les scènes qui
  // ont leur propre promeneur. x = bord gauche voulu du personnage, groundY = sol.
  function drawWalker(g, set, x, groundY, dir, t, leashColor) {
    const frames = dir > 0 ? set.right : set.left;
    const i = Math.floor(t / (set.frameDur || 0.15)) % frames.length;
    const img = frames[i];
    const y = groundY - set.ay;
    g.drawImage(img, x, y);
    if (!set.dogRight) return;
    const dframes = dir > 0 ? set.dogRight : set.dogLeft;
    const di = Math.floor(t / 0.12) % dframes.length;
    const dx = dir > 0 ? x + set.w + 2 : x - set.dogW - 2;
    const dy = groundY - set.dogH + 1;
    g.drawImage(dframes[di], dx, dy);
    const hand = (dir > 0 ? set.hand.right : set.hand.left)[i];
    const col = (dir > 0 ? set.collar.right : set.collar.left)[di];
    const hx = x + hand[0];
    const hy = y + hand[1];
    const cx = dx + col[0];
    const cy = dy + col[1];
    g.fillStyle = leashColor || '#2a1a14';
    const nn = Math.max(Math.abs(cx - hx), Math.abs(cy - hy), 1);
    for (let k = 0; k <= nn; k++) {
      const u = k / nn;
      g.fillRect(Math.round(hx + (cx - hx) * u), Math.round(hy + (cy - hy) * u + Math.sin(u * Math.PI) * 2), 1, 1);
    }
  }

  /* ================= Les héros des scènes ================= */
  // Chaque fonction renvoie une planche (Raster) prête à être éclairée par la scène puis
  // « cuite » avec bake(). o : { hh, light, rim, view… } ; les cotes sont en têtes.
  const heroes = {
    // Lecteur sur un banc, vu de face (un peu de trois quarts) : lit, tourne la page,
    // lève les yeux. Avec umbrella : il tient un parapluie sur l'épaule.
    bench(look, o = {}) {
      const base = (x = {}) => {
        const p = seated({ seatH: o.seatH || 1.0, lean: 0.12, footF: 0.75, head: { nod: x.nod == null ? 0.3 : x.nod, turn: x.turn || 0, tilt: x.tilt || 0.06 }, cross: o.cross });
        const book = [0.62, 0.62, 0];
        p.armR = { hand: x.handR || [0.6, 0.58, -0.27] };
        p.armL = { hand: o.umbrella ? [0.42, 1.0, 0.12] : [0.6, 0.58, 0.27] };
        p.props = seq(bookProp(book, { tilt: 1.05, flip: x.flip }), o.umbrella ? umbrellaProp('L', { off: [-0.32, 1.9, 0.18], r: 1.35 }) : null);
        return p;
      };
      return sheet(look, { read: [base(), base({ nod: 0.34 })], page: base({ handR: [0.68, 0.72, -0.02], flip: true }), look: base({ nod: -0.05, turn: 0.45, tilt: 0 }) }, { hh: o.hh || 7, view: o.view == null ? 0.82 : o.view, light: o.light, rim: o.rim });
    },
    // Cliente au comptoir de la fenêtre, vue de dos : lit (livre posé sur le rebord),
    // tourne une page, boit une gorgée. ledge : hauteur du rebord au-dessus du siège.
    counter(look, o = {}) {
      const lu = o.ledge == null ? 0.85 : o.ledge;
      const base = (x = {}) => {
        const p = seated({ seatH: o.seatH || 0.8, lean: 0.28, footF: 0.55, hideLegs: true, head: { nod: x.nod == null ? 0.38 : x.nod, turn: x.turn || 0.12, tilt: x.tilt == null ? 0.1 : x.tilt }, sway: x.sway || 0 });
        p.armL = { hand: x.handL || [0.82, lu + 0.06, 0.24], pole: [-0.2, -0.6, 1] };
        p.armR = { hand: x.handR || [0.82, lu + 0.06, -0.24], pole: [-0.2, -0.6, -1] };
        p.props = seq(bookProp([0.86, lu + 0.04, 0], { tilt: 0.25, w: 0.3, h: 0.2, flip: x.flip }), x.mug ? mugProp('R', { off: [0.08, 0.05, 0] }) : null);
        return p;
      };
      return sheet(
        look,
        {
          idle: [base(), base({ nod: 0.4, sway: 0.6 })],
          page: base({ handR: [0.9, lu + 0.22, -0.02], flip: true }),
          sip: base({ handR: [0.5, 1.68, -0.1], mug: true, nod: 0.05, turn: 0.2 }),
        },
        { hh: o.hh || 9, view: o.view == null ? -Math.PI / 2 + 0.35 : o.view, light: o.light, rim: o.rim },
      );
    },
    // Quelqu'un à son bureau, vu de dos, casque sur les oreilles : tape au clavier,
    // écoute en hochant la tête, s'étire, boit une gorgée. desk : hauteur du plateau.
    desk(look, o = {}) {
      const du = o.desk == null ? 0.75 : o.desk;
      const base = (x = {}) => {
        const p = seated({ seatH: o.seatH || 1.0, lean: x.lean == null ? 0.16 : x.lean, twist: o.twist || 0, footF: 0.7, head: { nod: x.nod == null ? 0.12 : x.nod, turn: x.turn == null ? o.turn || 0 : x.turn, tilt: x.tilt || 0 }, sway: x.sway || 0 });
        const kL = x.kL || 0;
        const kR = x.kR || 0;
        const ks = o.kbS || 0; // clavier décalé sur le côté
        p.armL = { hand: x.handL || [0.88, du + 0.05 + kL, 0.18 + ks], pole: [-0.3, -1, 0.7] };
        p.armR = { hand: x.handR || [0.88, du + 0.05 + kR, -0.18 + ks], pole: [-0.3, -1, -0.7] };
        if (x.mug) p.props = mugProp(x.mug, { off: [0.08, 0.05, 0] });
        return p;
      };
      const up = { lean: -0.1, nod: -0.3, handL: [-0.12, 2.8, 0.12], handR: [-0.12, 2.8, -0.12] };
      const poses = {
        idle: base({ handL: [0.78, du + 0.04, 0.26], handR: [0.78, du + 0.04, -0.26] }),
        typeA: base({ kL: 0.08 }),
        typeB: base({ kR: 0.08 }),
        bob: base({ nod: 0.3, handL: [0.78, du + 0.04, 0.26], handR: [0.78, du + 0.04, -0.26], lean: 0.2 }),
        stretch: base(up),
        sip: o.sipHand === 'L' ? base({ handL: [0.48, 1.74, 0.1], mug: 'L', nod: -0.05, handR: [0.78, du + 0.04, -0.26 + (o.kbS || 0)] }) : base({ handR: [0.48, 1.74, -0.1], mug: 'R', nod: -0.05, handL: [0.78, du + 0.04, 0.26] }),
      };
      poses.stretch.armL.pole = [-0.4, 0, 1];
      poses.stretch.armR.pole = [-0.4, 0, -1];
      return sheet(look, poses, { hh: o.hh || 11, view: o.view == null ? -Math.PI / 2 + 0.4 : o.view, light: o.light, rim: o.rim });
    },
    // Campeur assis sur une bûche, tourné vers le feu (à droite).
    camper(look, o = {}) {
      const base = (x = {}) => {
        const p = seated({ seatH: o.seatH || 0.72, lean: x.lean == null ? 0.22 : x.lean, footF: 0.75, head: { nod: x.nod == null ? 0.12 : x.nod, tilt: 0.04 }, stagger: 0.12 });
        p.armL = { hand: x.handL || [1.02, 0.95, 0.12] };
        p.armR = { hand: x.handR || [1.02, 0.92, -0.14] };
        p.props = x.props;
        return p;
      };
      const stickDir = (a) => [Math.cos(a), -Math.sin(a), 0.05];
      return sheet(
        look,
        {
          warm: base(),
          rub: [base({ handL: [0.66, 1.02, 0.04], handR: [0.66, 0.98, -0.06], lean: 0.18 }), base({ handL: [0.66, 0.98, 0.02], handR: [0.67, 1.03, -0.04], lean: 0.18 })],
          poke: [base({ handR: [0.78, 0.72, -0.12], handL: [0.62, 0.5, 0.22], props: stickProp('R', stickDir(0.42), 1.7, 'stick') }), base({ handR: [0.86, 0.66, -0.12], handL: [0.62, 0.5, 0.22], props: stickProp('R', stickDir(0.55), 1.7, 'stick') })],
          sip: base({ handR: [0.5, 1.62, -0.08], handL: [0.46, 1.5, 0.08], props: mugProp('R', { off: [0.07, 0.06, 0.04] }), nod: -0.05, lean: 0.12 }),
        },
        { hh: o.hh || 6.5, view: o.view == null ? 0.35 : o.view, light: o.light, rim: o.rim },
      );
    },
    // Musicien assis sur un banc, guitare sur les genoux, tourné vers la gauche.
    guitarist(look, o = {}) {
      const c = [0.66, 0.6, -0.16];
      const along = norm([0.1, 0.38, 1]);
      const face = [1, 0.12, 0];
      const g = guitarProp({ c, along, face });
      const fret = add(c, add(mul(along, 1.3), [0.12, 0.02, 0]));
      const base = (x = {}) => {
        const p = seated({ seatH: o.seatH || 1.0, lean: 0.16, head: { nod: x.nod == null ? 0.2 : x.nod, turn: 0.35, tilt: 0.12 }, cross: false });
        p.armL = { hand: add(fret, [0, x.fy || 0, 0]), pole: [-0.2, -1, 0.8] };
        p.armR = { hand: add(c, add(mul(along, 0.38), [0.2, x.sy || 0, 0])), pole: [-0.5, -0.4, -1] };
        p.props = g;
        return p;
      };
      return sheet(
        look,
        { up: base({ sy: 0.08 }), down: base({ sy: -0.08 }), nodUp: base({ sy: 0.08, nod: 0.36 }), nodDown: base({ sy: -0.08, nod: 0.36 }) },
        { hh: o.hh || 8, view: o.view == null ? Math.PI - 0.75 : o.view, light: o.light, rim: o.rim },
      );
    },
    // Pêcheur au bout du ponton, jambes dans le vide, canne tendue vers la mer (à droite).
    fisher(look, o = {}) {
      const base = (lift, dangle) => {
        const p = seated({ dangle, lean: 0.15, head: { nod: 0.1 } });
        const a = lift ? 0.95 : 0.6;
        const d = [Math.cos(a), Math.sin(a), 0];
        p.armR = { hand: [0.62, 0.68, -0.08] };
        p.armL = { hand: [0.48, 0.58, 0.08] };
        p.props = stickProp('R', d, 3.0, 'rod', { r0: 0.07, r1: 0.035 });
        p.points = (k) => ({ tip: k.P(k.add(k.J.handR, mul(d, 3.0))) });
        return p;
      };
      return sheet(look, { idle: [base(false, 0.12), base(false, -0.12)], lift: base(true, 0) }, { hh: o.hh || 4, view: o.view == null ? 0.25 : o.view, light: o.light, rim: o.rim });
    },
    // Enfant qui tient la ficelle d'un cerf-volant (bras levé, puis il tire un coup).
    kite(look, o = {}) {
      const base = (hand, br) => {
        const p = stand({ br, turn: 0.15, armR: { hand, pole: [-0.2, -1, -0.8] }, armL: { pi: -0.1, ab: 0.25, el: 0.5 } });
        p.head = { nod: -0.35, turn: 0.1 };
        return p;
      };
      return sheet(look, { hold: base([0.45, 2.35, -0.22], 0), pull: base([0.22, 2.05, -0.28], 1) }, { hh: o.hh || 5, view: o.view == null ? -0.55 : o.view, light: o.light, rim: o.rim });
    },
  };

  // Teinte posée sur les pixels d'un Raster (lumière du soir, nuit bleutée…) :
  // rgb = 'r,g,b' ou [r, g, b], a = force (0–1). S'utilise comme fonction de bake().
  function tint(rgb, a) {
    const c = typeof rgb === 'string' ? rgb.split(',').map(Number) : rgb;
    return (r) => {
      if (!a) return;
      const d = r.data;
      for (let i = 0; i < d.length; i += 4) {
        if (!d[i + 3]) continue;
        d[i] += (c[0] - d[i]) * a;
        d[i + 1] += (c[1] - d[i + 1]) * a;
        d[i + 2] += (c[2] - d[i + 2]) * a;
      }
    };
  }

  B.People = { heroes, tint, sheet, bake, walker, dogSheet, randomLook, crowdSets, drawWalker, stand, walk, seated, umbrellaProp, bookProp, mugProp, stickProp, guitarProp, seq, near, camera, ramp, skinRamp, hairRamp, rampsOf, skeleton, assemble, paint, BODIES, STYLES, util: { add, sub, mul, norm, mv, rot, yaw, pitch, roll, lerp3, len, dot } };
})();
