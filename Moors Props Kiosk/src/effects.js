/* ==========================================================================
   EFFECTS — one shared particle pool for every prop reaction (embers,
   steam, flames, tea drops, sparks…) plus glowing motion trails.
   Particles: a single draw call, fixed-size buffers, no allocation per frame.
   Trails: one small strip each (the ribbon uses two).
   ========================================================================== */
import * as THREE from 'three';

// size: [start, end] metres · life: [min, max] s · rise: upward accel (m/s²) · drag: per second
const KINDS = {
  ember: { color: [1.0, 0.6, 0.22], size: [0.032, 0.01], life: [0.9, 1.6], rise: 0.22, drag: 0.8, sway: 0.08, alpha: 0.95 },
  smoke: { color: [0.55, 0.52, 0.5], size: [0.03, 0.13], life: [1.8, 2.8], rise: 0.05, drag: 1.3, sway: 0.06, alpha: 0.14 },
  steam: { color: [1.0, 0.96, 0.9], size: [0.04, 0.16], life: [1.6, 2.6], rise: 0.06, drag: 1.4, sway: 0.05, alpha: 0.26 },
  petal: { color: [0.78, 0.06, 0.12], size: [0.04, 0.034], life: [2.2, 3.2], rise: -0.35, drag: 1.6, sway: 0.18, alpha: 0.95 },
  spark: { color: [1.0, 0.86, 0.55], size: [0.034, 0.0], life: [0.35, 0.75], rise: 0.0, drag: 3.2, sway: 0.0, alpha: 1.0 },
  glow:  { color: [1.0, 0.9, 0.7], size: [0.022, 0.006], life: [1.4, 2.4], rise: 0.05, drag: 0.6, sway: 0.04, alpha: 0.7 },
  // flame: random mix of yellow core and orange tips (jitter blends toward color2)
  flame: { color: [1.0, 0.78, 0.3], color2: [1.0, 0.38, 0.08], size: [0.05, 0.012], life: [0.3, 0.6], rise: 0.9, drag: 1.4, sway: 0.2, alpha: 0.95 },
  drop:  { color: [0.86, 0.5, 0.2], size: [0.016, 0.012], life: [0.8, 1.3], rise: -2.4, drag: 0.4, sway: 0.0, alpha: 0.95 },
  shimmer: { color: [0.92, 0.94, 1.0], size: [0.018, 0.0], life: [0.6, 1.1], rise: -0.05, drag: 1.5, sway: 0.06, alpha: 0.9 },
};

export class Effects {
  constructor(scene, renderer, camera, max = 480) {
    this.max = max;
    this.renderer = renderer; this.camera = camera;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.kind = new Array(max).fill(null);
    this.phase = new Float32Array(max);
    this.next = 0;
    this.live = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 800 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec3 aColor; attribute float aAlpha; attribute float aSize;
        uniform float uScale; varying vec3 vC; varying float vA;
        void main() {
          vC = aColor; vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.05, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vC; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vC * a, a);
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.geo = g;
  }

  /** Emit `count` particles of `kind` at `p` (Vector3), with optional base velocity and spread. */
  emit(kind, p, count = 1, vel = null, spread = 0.03) {
    const K = KINDS[kind];
    for (let c = 0; c < count; c++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      this.kind[i] = K;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread * 0.5;
      const r = kind === 'spark' ? 0.9 : 0.06;
      this.vel[i * 3] = (vel?.x || 0) + (Math.random() - 0.5) * r;
      this.vel[i * 3 + 1] = (vel?.y || 0) + (Math.random() - 0.5) * r + (kind === 'steam' ? 0.05 : kind === 'ember' ? 0.08 : 0);
      this.vel[i * 3 + 2] = (vel?.z || 0) + (Math.random() - 0.5) * r * 0.4;
      this.age[i] = 0;
      this.life[i] = K.life[0] + Math.random() * (K.life[1] - K.life[0]);
      this.phase[i] = Math.random() * 6.28;
      const m = K.color2 ? Math.random() : 0, c2 = K.color2 || K.color;
      this.col[i * 3] = K.color[0] + (c2[0] - K.color[0]) * m;
      this.col[i * 3 + 1] = K.color[1] + (c2[1] - K.color[1]) * m;
      this.col[i * 3 + 2] = K.color[2] + (c2[2] - K.color[2]) * m;
    }
  }

  /** A glowing trail that follows a moving point (e.g. a ribbon tip). */
  makeTrail(opts) {
    const tr = new Trail(this.points.parent, this.camera, opts);
    (this.trails ||= []).push(tr);
    return tr;
  }

  update(dt, t) {
    if (this.trails) for (const tr of this.trails) tr.update(dt);
    // keep point size correct for the current drawing buffer and field of view
    this.uniforms.uScale.value = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      const K = this.kind[i];
      if (!K) continue;
      this.age[i] += dt;
      const f = this.age[i] / this.life[i];
      if (f >= 1) { this.kind[i] = null; this.alpha[i] = 0; this.size[i] = 0; continue; }
      live++;
      const drag = Math.exp(-K.drag * dt);
      const o = i * 3;
      this.vel[o] = this.vel[o] * drag + Math.sin(t * 2.3 + this.phase[i]) * K.sway * dt;
      this.vel[o + 1] = this.vel[o + 1] * drag + K.rise * dt;
      this.vel[o + 2] *= drag;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt;
      const fadeIn = Math.min(1, f * 8), fadeOut = 1 - f * f;
      this.alpha[i] = K.alpha * fadeIn * fadeOut * (K === KINDS.ember ? 0.75 + 0.25 * Math.sin(t * 20 + this.phase[i]) : 1);
      this.size[i] = K.size[0] + (K.size[1] - K.size[0]) * f;
    }
    this.live = live;
    const a = this.geo.attributes;
    a.position.needsUpdate = a.aColor.needsUpdate = a.aAlpha.needsUpdate = a.aSize.needsUpdate = true;
    this.points.visible = live > 0;
  }
}

/* ---------------------------------------------------------------------- */
/* TRAIL — a camera-facing strip through the last few positions of a      */
/* moving point, tapering and fading with age. Fixed buffers.             */
export class Trail {
  constructor(scene, camera, { color = 0xff6a9a, width = 0.03, life = 0.8, length = 48, opacity = 0.75 } = {}) {
    this.camera = camera; this.width = width; this.life = life; this.n = length; this.opacity = opacity;
    this.pts = Array.from({ length }, () => new THREE.Vector3());
    this.age = new Float32Array(length).fill(1e9);
    this.head = 0; this.count = 0;
    this.pos = new Float32Array(length * 2 * 3);
    this.alpha = new Float32Array(length * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.visible = false;
    scene.add(this.mesh);
    this.geo = g;
    this._t = new THREE.Vector3(); this._v = new THREE.Vector3(); this._p = new THREE.Vector3();
  }
  /** Add the newest point (call once per frame while the trail should grow). */
  push(p) {
    const last = this.pts[(this.head - 1 + this.n) % this.n];
    if (this.count && last.distanceToSquared(p) < 1e-6) return;     // ignore if it hasn't moved
    this.pts[this.head].copy(p); this.age[this.head] = 0;
    this.head = (this.head + 1) % this.n; this.count = Math.min(this.n, this.count + 1);
  }
  update(dt) {
    let alive = 0;
    for (let i = 0; i < this.n; i++) { this.age[i] += dt; if (this.age[i] < this.life) alive++; }
    this.mesh.visible = alive > 1;
    if (!this.mesh.visible) return;
    const cam = this.camera.position;
    for (let k = 0; k < this.n; k++) {                 // k = 0 newest … n-1 oldest
      const i = (this.head - 1 - k + this.n * 2) % this.n;
      const j = (i - 1 + this.n) % this.n;             // older neighbour (for direction)
      const p = this.pts[i];
      this._t.copy(p).sub(this.pts[k < this.count - 1 ? j : i]);
      if (this._t.lengthSq() < 1e-10) this._t.set(1, 0, 0);
      this._v.copy(cam).sub(p);
      this._p.crossVectors(this._t, this._v).normalize();
      const life = 1 - Math.min(1, this.age[i] / this.life);
      const taper = 1 - k / this.n;
      const w = this.width * 0.5 * taper * (0.4 + 0.6 * life);
      const o = k * 6;
      this.pos[o] = p.x + this._p.x * w; this.pos[o + 1] = p.y + this._p.y * w; this.pos[o + 2] = p.z + this._p.z * w;
      this.pos[o + 3] = p.x - this._p.x * w; this.pos[o + 4] = p.y - this._p.y * w; this.pos[o + 5] = p.z - this._p.z * w;
      const a = (k < this.count ? life * life * taper : 0) * this.opacity;
      this.alpha[k * 2] = this.alpha[k * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = this.geo.attributes.aAlpha.needsUpdate = true;
  }
}
