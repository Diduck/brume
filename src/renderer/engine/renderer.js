// Brume — rendu WebGL2.
// Toutes les particules d'une même forme partent en UN SEUL appel GPU (« instancing ») :
// le processeur ne fait que remplir un tableau de 8 nombres par particule.
(function () {
  'use strict';
  const B = window.Brume;
  const SH = B.shaders;
  const COL = B.COL;
  const FLOATS = 8;

  class SpriteBatch {
    constructor(capacity = 1024) {
      this.data = new Float32Array(capacity * FLOATS);
      this.count = 0;
    }
    push(x, y, w, h, rot, alpha, order, variant) {
      if ((this.count + 1) * FLOATS > this.data.length) {
        const bigger = new Float32Array(this.data.length * 2);
        bigger.set(this.data);
        this.data = bigger;
      }
      const d = this.data;
      const o = this.count * FLOATS;
      d[o] = x;
      d[o + 1] = y;
      d[o + 2] = w;
      d[o + 3] = h;
      d[o + 4] = rot;
      d[o + 5] = alpha;
      d[o + 6] = order;
      d[o + 7] = variant;
      this.count++;
    }
  }

  class Renderer {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', {
        alpha: true,
        premultipliedAlpha: true,
        antialias: true,
        depth: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
      if (!gl) throw new Error('WebGL2 indisponible');
      this.gl = gl;
      this.canvas = canvas;
      this.W = 1;
      this.H = 1;
      this.drawCalls = 0;
      this.rects = new Float32Array(B.MAX_RECTS * 4);
      this.rectCount = 0;
      this.rectVersion = 1;
      this.frameNo = 0;

      this.sprite = this.program(SH.spriteVS, SH.spriteFS);
      this.pile = this.program(SH.pileVS, SH.pileFS);
      this.auroraProg = this.program(SH.fullVS, SH.auroraFS);
      this.lofiProg = null; // compilé à la demande (seule la couche fond d'écran s'en sert)
      this.blit = this.program(SH.fullVS, SH.blitFS);

      // Quadrilatère unitaire partagé par tous les sprites.
      this.spriteVAO = gl.createVertexArray();
      gl.bindVertexArray(this.spriteVAO);
      const quad = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.instanceBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, FLOATS * 4, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FLOATS * 4, 16);
      gl.vertexAttribDivisor(2, 1);

      // Tas de neige.
      this.pileVAO = gl.createVertexArray();
      gl.bindVertexArray(this.pileVAO);
      this.pileBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pileBuf);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
      this.pileData = new Float32Array(6 * 5 * 8192);

      this.emptyVAO = gl.createVertexArray();
      gl.bindVertexArray(null);

      // Textures basse résolution : aurore (lissée) et fond lofi (pixels nets).
      this.auroraTex = gl.createTexture();
      this.auroraFbo = gl.createFramebuffer();
      this.auroraSize = [0, 0];
      this.lofiTex = gl.createTexture();
      this.lofiFbo = gl.createFramebuffer();
      this.lofiSize = [0, 0];
    }

    target(tex, fbo, w, h, filter) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    program(vsSrc, fsSrc) {
      const gl = this.gl;
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      const u = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, '');
        u[name] = gl.getUniformLocation(prog, name);
      }
      return { prog, u, rectVersion: 0 };
    }

    resize(W, H, dpr) {
      this.W = W;
      this.H = H;
      this.canvas.width = Math.max(1, Math.round(W * dpr));
      this.canvas.height = Math.max(1, Math.round(H * dpr));
      const gl = this.gl;
      this.auroraSize = [Math.max(2, Math.ceil(W / 4)), Math.max(2, Math.ceil(H / 4))];
      this.target(this.auroraTex, this.auroraFbo, ...this.auroraSize, gl.LINEAR);
      // Un « pixel » lofi = 3 × 3 points de l'écran.
      this.lofiSize = [Math.max(2, Math.ceil(W / 3)), Math.max(2, Math.ceil(H / 3))];
      this.target(this.lofiTex, this.lofiFbo, ...this.lofiSize, gl.NEAREST);
      this.auroraReady = false;
      this.lofiReady = false;
    }

    // Fond animé lofi. pal : couleurs RGB (0–1) déjà interpolées par le moteur.
    drawWallpaper(pal, amount) {
      const gl = this.gl;
      // Le fond bouge lentement : 30 images/s suffisent.
      if (this.frameNo % 2 === 1 || !this.lofiReady) this.renderLofi(pal);
      this.fullscreen(0, amount, 1e4, this.lofiTex);
    }

    renderLofi(pal) {
      const gl = this.gl;
      if (!this.lofiProg) this.lofiProg = this.program(SH.fullVS, SH.lofiFS);
      const p = this.lofiProg;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.lofiFbo);
      gl.viewport(0, 0, this.lofiSize[0], this.lofiSize[1]);
      gl.disable(gl.BLEND);
      this.use(p);
      gl.uniform2f(p.u.uRes, this.lofiSize[0], this.lofiSize[1]);
      for (const key of ['skyTop', 'skyMid', 'horizon', 'sunColor', 'cloud', 'far', 'mid', 'near', 'light', 'neon']) {
        const loc = p.u[`u${key[0].toUpperCase()}${key.slice(1)}`];
        if (loc) gl.uniform3fv(loc, pal[key]);
      }
      gl.uniform4fv(p.u.uSun, pal.sun);
      gl.uniform1f(p.u.uStars, pal.stars);
      gl.uniform1f(p.u.uRain, pal.rain);
      gl.uniform1f(p.u.uStreaks, pal.streaks || 0);
      gl.uniform1i(p.u.uScene, pal.scene || 0);
      if (pal.animA && p.u.uAnim) {
        gl.uniform4fv(p.u.uAnim, pal.animA);
        gl.uniform4fv(p.u.uAnimB, pal.animB);
      }
      gl.bindVertexArray(this.emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.enable(gl.BLEND);
      this.lofiReady = true;
      this.drawCalls++;
    }

    // Image fixe du fond (pixels lofi, de bas en haut) pour en faire le vrai fond d'écran macOS.
    readLofi(pal) {
      const gl = this.gl;
      this.renderLofi(pal);
      const [w, h] = this.lofiSize;
      const data = new Uint8Array(w * h * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.lofiFbo);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { w, h, data };
    }

    // Fenêtres triées de l'avant vers l'arrière : [[x, y, w, h], ...]
    setRects(list) {
      const n = Math.min(list.length, B.MAX_RECTS);
      for (let i = 0; i < n; i++) this.rects.set(list[i], i * 4);
      this.rectCount = n;
      this.rectVersion++;
    }

    // Bande visible en mode « derrière » : sous la barre des menus, au-dessus du Dock.
    setBand(top, bottom) {
      this.band = [top, bottom];
    }

    use(p) {
      const gl = this.gl;
      gl.useProgram(p.prog);
      if (p.u.uRes) gl.uniform2f(p.u.uRes, this.W, this.H);
      const band = this.bandEnabled !== false && this.band;
      if (p.u.uBand) gl.uniform2f(p.u.uBand, band ? band[0] : -1e5, band ? band[1] : 1e5);
      if (p.u.uTime) gl.uniform1f(p.u.uTime, this.time);
      if (p.u.uRects && p.rectVersion !== this.rectVersion) {
        gl.uniform4fv(p.u.uRects, this.rects);
        gl.uniform1i(p.u.uRectCount, this.rectCount);
        p.rectVersion = this.rectVersion;
      }
    }

    begin(time) {
      const gl = this.gl;
      this.time = time;
      this.drawCalls = 0;
      this.frameNo++;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
    }

    drawBatch(batch, shape, additive) {
      if (!batch.count) return;
      const gl = this.gl;
      this.use(this.sprite);
      gl.uniform1i(this.sprite.u.uShape, shape);
      gl.bindVertexArray(this.spriteVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
      gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.count * FLOATS), gl.STREAM_DRAW);
      if (additive) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
      this.drawCalls++;
    }

    // Construit et dessine la neige posée de toutes les surfaces en un seul appel.
    drawPiles(piles) {
      let d = this.pileData;
      let n = 0;
      const ensure = (extra) => {
        if (n + extra <= d.length) return;
        const bigger = new Float32Array(d.length * 2);
        bigger.set(d);
        this.pileData = d = bigger;
      };
      const vert = (x, y, t, h, order) => {
        d[n++] = x;
        d[n++] = y;
        d[n++] = t;
        d[n++] = h;
        d[n++] = order;
      };
      for (const p of piles) {
        if (!p.active) continue;
        const h = p.h;
        const cols = p.n;
        const bottom = p.y + 1;
        let prevX = p.x0;
        let prevH = 0;
        for (let i = 0; i <= cols; i++) {
          // Hauteur lissée pour un rendu doux (et 0 au-delà des bords).
          const hi = i < cols ? (h[Math.max(0, i - 1)] + 2 * h[i] + h[Math.min(cols - 1, i + 1)]) * 0.25 : 0;
          const x = i < cols ? p.x0 + (i + 0.5) * COL : p.x0 + cols * COL;
          if (prevH > 0.04 || hi > 0.04) {
            ensure(30);
            vert(prevX, p.y - prevH, 0, prevH, p.order);
            vert(prevX, bottom, 1, prevH, p.order);
            vert(x, p.y - hi, 0, hi, p.order);
            vert(x, p.y - hi, 0, hi, p.order);
            vert(prevX, bottom, 1, prevH, p.order);
            vert(x, bottom, 1, hi, p.order);
          }
          prevX = x;
          prevH = hi;
        }
      }
      if (!n) return;
      const gl = this.gl;
      this.use(this.pile);
      gl.bindVertexArray(this.pileVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pileBuf);
      gl.bufferData(gl.ARRAY_BUFFER, d.subarray(0, n), gl.STREAM_DRAW);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, n / 5);
      this.drawCalls++;
    }

    drawAurora(level) {
      const gl = this.gl;
      // L'aurore bouge lentement : on la recalcule une image sur deux.
      if (this.frameNo % 2 === 0 || !this.auroraReady) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.auroraFbo);
        gl.viewport(0, 0, this.auroraSize[0], this.auroraSize[1]);
        gl.disable(gl.BLEND);
        this.use(this.auroraProg);
        gl.bindVertexArray(this.emptyVAO);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.enable(gl.BLEND);
        this.auroraReady = true;
        this.drawCalls++;
      }
      this.fullscreen(0, level, 1e4);
    }

    drawFlash(amount, behind) {
      this.fullscreen(1, amount, behind ? 1e4 : -1);
    }

    fullscreen(mode, amount, order, tex) {
      const gl = this.gl;
      this.use(this.blit);
      gl.uniform1i(this.blit.u.uMode, mode);
      gl.uniform1f(this.blit.u.uAmount, amount);
      gl.uniform1f(this.blit.u.uOrderValue, order);
      if (mode === 0) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex || this.auroraTex);
        gl.uniform1i(this.blit.u.uTex, 0);
      }
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(this.emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.drawCalls++;
    }
  }

  B.SpriteBatch = SpriteBatch;
  B.Renderer = Renderer;
})();
