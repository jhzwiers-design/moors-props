/* ==========================================================================
   PROPS — the objects from the production that viewers can pick up:
   handkerchief, ribbon, teacup & saucer, and s'more.
   Each prop is a small procedural Three.js model plus a few physical
   settings. To add or swap one, add a builder here and an entry to PROP_LIST.

   home:    resting spot in SCREEN space (0..1, 0..1) — adapts to any screen shape
   radius:  collision/grab size in metres (before scale)
   scale:   overall size — lower it for smaller props and more room to play
   gravity, drag, flutter (optional): per-prop physics after a throw
            (multipliers of the defaults; flutter = sideways sway like falling cloth)

   Each builder may set model.userData.react(s), called every frame with:
     s.hold   0..1  eased "being held" amount (1 = in the hand)
     s.speed  m/s   how fast the prop is moving
     s.vel    Vector3 world velocity
     s.dt, s.t      frame time / clock
     s.emit(kind, worldPos, count, vel?, spread?)
              particles: 'ember' | 'flame' | 'smoke' | 'steam' | 'drop' | 'spark' | 'glow' | 'shimmer'
     s.makeTrail({ color, width, life, opacity }) → trail with .push(worldPos)
   ========================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PROP_LIST = [
  { name: 'handkerchief', build: buildHandkerchief, home: [0.25, 0.32], radius: 0.12, scale: 0.75, gravity: 0.3, drag: 2.4, flutter: 0.7 },
  { name: 'ribbon',       build: buildRibbon,       home: [0.75, 0.30], radius: 0.11, scale: 0.78 },
  { name: 'teacup',       build: buildTeacup,       home: [0.27, 0.72], radius: 0.10, scale: 0.85 },
  { name: 'smores',       build: buildSmores,       home: [0.74, 0.72], radius: 0.08, scale: 0.92 },
];

const _w = new THREE.Vector3();
const _w2 = new THREE.Vector3();
/** Emission helper: turns a per-second rate into whole particles over time. */
const rate = () => { let acc = 0; return (perSec, dt) => { acc += perSec * dt; const n = Math.floor(acc); acc -= n; return n; }; };
const clamp = THREE.MathUtils.clamp;

/* ---------------------------------------------------------------------- */
/* HANDKERCHIEF — ripples and streams behind your hand; waving it leaves a  */
/* soft shimmer. Let go and it floats down slowly, swaying like real cloth. */
function buildHandkerchief() {
  const g = new THREE.Group();
  const S = 0.2, N = 14;
  const geo = new THREE.PlaneGeometry(S, S, N, N);
  const base = geo.attributes.position.array.slice();
  const pos = geo.attributes.position.array;
  const mat = new THREE.MeshStandardMaterial({ map: handkerchiefTexture(), roughness: 0.85, side: THREE.DoubleSide, emissive: 0xfff2dd, emissiveIntensity: 0 });
  const cloth = new THREE.Mesh(geo, mat);
  cloth.rotation.set(-0.3, 0.35, 0.2);
  g.add(cloth);

  let phase = Math.random() * 6, lagX = 0, lagY = 0, trail = null, idleTick = 0, idleDt = 0;
  const shimmer = rate();
  g.userData.react = (s) => {
    // resting: reshape the cloth at a third of the frame rate (saves CPU on slower machines)
    if (s.hold < 0.02 && s.speed < 0.05) { idleDt += s.dt; if (++idleTick % 3) return; } else idleTick = 0;
    const dt = s.dt + idleDt; idleDt = 0;
    const h = s.hold, k = 1 - Math.exp(-dt * 6);
    // moving through the air (held OR drifting down after a throw) makes it ripple
    const air = Math.max(h, Math.min(1, s.speed * 2));
    phase += dt * (1.4 + air * 4 + s.speed * 6);
    const amp = 0.005 + air * 0.016 + Math.min(0.03, s.speed * 0.02);
    lagX += (clamp(-s.vel.x * 0.08, -0.08, 0.08) * air - lagX) * k;
    lagY += (clamp(-s.vel.y * 0.08, -0.08, 0.08) * air - lagY) * k;
    for (let i = 0; i < pos.length; i += 3) {
      const x0 = base[i], y0 = base[i + 1];
      // held by the top-left corner: the further from it, the more it moves
      const d = Math.hypot(x0 + S / 2, y0 - S / 2) / (S * 1.414);
      pos[i] = x0 + lagX * d * d;
      pos[i + 1] = y0 + lagY * d * d - h * 0.025 * d * d;
      pos[i + 2] = (Math.sin(x0 * 30 + phase) + Math.cos(y0 * 26 + phase * 0.8) * 0.6) * amp * d - h * 0.03 * d * d;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    mat.emissiveIntensity = h * 0.08;

    // waving it: a faint shimmer trail off the free corner
    trail ||= s.makeTrail({ color: 0xfff1dc, width: 0.022, life: 0.6, opacity: 0.35 });
    cloth.localToWorld(_w.set(pos[pos.length - 3], pos[pos.length - 2], pos[pos.length - 1]));
    if (h > 0.3 && s.speed > 0.35) {
      trail.push(_w);
      const n = shimmer(s.speed * 26, s.dt); if (n) s.emit('shimmer', _w, n, null, 0.06);
    }
  };
  return g;
}

/* ---------------------------------------------------------------------- */
/* RIBBON — a satin bow whose tails trail and twist behind your hand and   */
/* draw glowing ribbons through the air, like ribbon dancing.              */
function buildRibbon() {
  const g = new THREE.Group();
  const satin = new THREE.MeshStandardMaterial({ color: 0x9c1d43, roughness: 0.32, metalness: 0.15, side: THREE.DoubleSide, emissive: 0x5a0a22, emissiveIntensity: 0 });
  for (const side of [-1, 1]) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 24), satin);
    loop.scale.set(1, 0.6, 0.35); loop.position.set(side * 0.022, 0.004, 0); loop.rotation.z = side * 0.45;
    g.add(loop);
  }
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 10), satin));

  const N = 22, LEN = 0.26, WID = 0.02;
  const tails = [-1, 1].map((side) => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array((N + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, satin);
    mesh.frustumCulled = false;
    g.add(mesh);
    return { side, geo, pos, cx: new Float32Array(N + 1), cy: new Float32Array(N + 1), cz: new Float32Array(N + 1), trail: null };
  });
  g.rotation.z = 0.1;

  let phase = Math.random() * 6, lagX = 0, lagY = 0, idleTick = 0, idleDt = 0;
  const glitter = rate();
  g.userData.react = (s) => {
    // resting: reshape the tails at a third of the frame rate (trails fade on their own)
    if (s.hold < 0.02 && s.speed < 0.05) { idleDt += s.dt; if (++idleTick % 3) return; } else idleTick = 0;
    const dt = s.dt + idleDt; idleDt = 0;
    const h = s.hold, k = 1 - Math.exp(-dt * 5);
    phase += dt * (1.8 + h * 4 + s.speed * 8);
    const amp = 0.006 + h * 0.016 + Math.min(0.03, s.speed * 0.02);
    lagX += (clamp(-s.vel.x * 0.3, -0.22, 0.22) * h - lagX) * k;
    lagY += (clamp(-s.vel.y * 0.3, -0.22, 0.22) * h - lagY) * k;
    for (const tl of tails) {
      const { side, pos, cx, cy, cz } = tl;
      for (let i = 0; i <= N; i++) {               // centre line of the tail
        const f = i / N, f2 = Math.pow(f, 1.4);
        cx[i] = side * (0.006 + f * 0.045) + Math.sin(phase + f * 5 + side) * amp * f + lagX * f2;
        cy[i] = -f * LEN + lagY * f2;
        cz[i] = Math.cos(phase * 0.8 + f * 4) * amp * 0.6 * f;
      }
      for (let i = 0; i <= N; i++) {               // give it width, with a satin twist
        const a = Math.max(0, i - 1), b = Math.min(N, i + 1);
        let tx = cx[b] - cx[a], ty = cy[b] - cy[a];
        const tlen = Math.hypot(tx, ty) || 1; tx /= tlen; ty /= tlen;
        const twist = Math.sin((i / N) * 3 + phase * 0.7 + side) * 0.9 * (0.3 + h);
        const c = Math.cos(twist) * WID / 2, z = Math.sin(twist) * WID / 2;
        const o = i * 6;
        pos[o] = cx[i] - ty * c; pos[o + 1] = cy[i] + tx * c; pos[o + 2] = cz[i] + z;
        pos[o + 3] = cx[i] + ty * c; pos[o + 4] = cy[i] - tx * c; pos[o + 5] = cz[i] - z;
      }
      tl.geo.attributes.position.needsUpdate = true;
      tl.geo.computeVertexNormals();
      // ribbon dancing: each tail tip draws a glowing ribbon through the air
      tl.trail ||= s.makeTrail({ color: tl.side < 0 ? 0xff4d7d : 0xff8fb0, width: 0.03, life: 0.75, opacity: 0.6 });
      g.localToWorld(_w.set(cx[N], cy[N], cz[N]));
      if (h > 0.3 && s.speed > 0.12) tl.trail.push(_w);
    }
    satin.emissiveIntensity = h * 0.35;
    if (h > 0.05 && s.speed > 0.3) {
      const n = glitter(s.speed * 12 * h, s.dt);
      if (n) s.emit('glow', _w, n, null, 0.03);
    }
  };
  return g;
}

/* ---------------------------------------------------------------------- */
/* TEACUP & SAUCER — steam spirals up while you hold it. Move it too fast  */
/* and the tea sloshes out in droplets (and the cup empties); set it down  */
/* and it slowly refills.                                                   */
function buildTeacup() {
  const g = new THREE.Group();
  const china = new THREE.MeshPhysicalMaterial({ color: 0xf2eee6, roughness: 0.22, clearcoat: 0.6, side: THREE.DoubleSide });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc89b45, roughness: 0.3, metalness: 1, emissive: 0x7a5418, emissiveIntensity: 0 });
  const tea = new THREE.MeshStandardMaterial({ color: 0x5a2d12, roughness: 0.15 });
  const cupPts = [[0.0, 0.0], [0.022, 0.0], [0.026, 0.004], [0.036, 0.02], [0.044, 0.045], [0.046, 0.058]].map(([r, y]) => new THREE.Vector2(r, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(cupPts, 32), china));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.0018, 6, 40), gold); rim.rotation.x = Math.PI / 2; rim.position.y = 0.058; g.add(rim);
  const surface = new THREE.Mesh(new THREE.CircleGeometry(0.041, 28), tea); surface.rotation.x = -Math.PI / 2; surface.position.y = 0.046; g.add(surface);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.004, 8, 20, Math.PI * 1.3), china);
  handle.position.set(0.048, 0.032, 0); handle.rotation.z = -Math.PI * 0.65; g.add(handle);
  const saucerPts = [[0, 0], [0.05, 0.002], [0.07, 0.01], [0.074, 0.014]].map(([r, y]) => new THREE.Vector2(r, y));
  const saucer = new THREE.Mesh(new THREE.LatheGeometry(saucerPts, 36), china); saucer.position.y = -0.006; g.add(saucer);
  const sRim = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.0016, 6, 48), gold); sRim.rotation.x = Math.PI / 2; sRim.position.y = 0.008; g.add(sRim);
  g.position.y = -0.025;
  const wrap = new THREE.Group(); wrap.add(g); wrap.rotation.set(0.35, 0.4, 0);

  let level = 1, swirl = 0;                   // 1 = full cup
  const steam = rate(), spill = rate();
  const state = wrap.userData.state = { level: 1 };                  // read by the cues
  wrap.userData.reset = () => { level = 1; };
  wrap.userData.react = (s) => {
    const h = s.hold;
    gold.emissiveIntensity = h * 0.6;
    // tea tilts against the motion
    surface.rotation.x = -Math.PI / 2 + clamp(s.vel.y * 0.3, -0.35, 0.35) * h;
    surface.rotation.y = clamp(-s.vel.x * 0.3, -0.35, 0.35) * h;
    // too fast → it sloshes over the rim; resting → it refills
    if (h > 0.5 && s.speed > 0.6 && level > 0.05) {
      const n = spill((s.speed - 0.4) * 50, s.dt);
      if (n) {
        rim.getWorldPosition(_w);
        s.emit('drop', _w, n, { x: s.vel.x * 0.5, y: Math.max(0.2, s.vel.y * 0.5 + 0.3), z: 0 }, 0.06);
        level = Math.max(0, level - n * 0.015);
      }
    } else if (h < 0.1) level = Math.min(1, level + s.dt * 0.08);
    state.level = level;
    surface.position.y = 0.012 + level * 0.034;
    surface.scale.setScalar(0.78 + level * 0.22);                    // the cup narrows toward the bottom
    surface.visible = level > 0.02;
    // steam spirals up from the tea while held
    if (h > 0.05 && level > 0.05) {
      swirl += s.dt * 3;
      surface.getWorldPosition(_w); _w.y += 0.02;
      const n = steam(h * (8 + s.speed * 6) * (0.4 + level * 0.6), s.dt);
      if (n) s.emit('steam', _w, n, { x: Math.cos(swirl) * 0.05 - s.vel.x * 0.15, y: 0.07, z: Math.sin(swirl) * 0.05 }, 0.03);
    }
  };
  return wrap;
}

/* ---------------------------------------------------------------------- */
/* S'MORE — the marshmallow toasts white → golden → brown while held. Hold */
/* it long enough and it catches fire; shake it hard to blow it out (puff  */
/* of smoke, a little charred). Left alone, it slowly resets.               */
function buildSmores() {
  const g = new THREE.Group();
  const graham = new THREE.MeshStandardMaterial({ map: grahamTexture(), roughness: 0.85 });
  const choc = new THREE.MeshStandardMaterial({ color: 0x3b1f12, roughness: 0.4 });
  const mallow = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.75, emissive: 0xff7a20, emissiveIntensity: 0 });
  const bottom = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.01, 0.07, 2, 0.003), graham); g.add(bottom);
  const chocolate = new THREE.Mesh(new RoundedBoxGeometry(0.058, 0.007, 0.052, 2, 0.002), choc); chocolate.position.y = 0.0085; g.add(chocolate);
  const marsh = new THREE.Mesh(new THREE.SphereGeometry(0.031, 24, 16), mallow); marsh.scale.set(1, 0.48, 1); marsh.position.y = 0.024; g.add(marsh);
  const top = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.01, 0.07, 2, 0.003), graham); top.position.set(0.004, 0.041, -0.003); top.rotation.set(0.05, 0.12, -0.04); g.add(top);
  const light = new THREE.PointLight(0xff9a40, 0, 1.6, 2); light.position.y = 0.03; g.add(light);
  g.position.y = -0.02;
  const wrap = new THREE.Group(); wrap.add(g); wrap.rotation.set(0.5, 0.5, 0.05);

  const WHITE = new THREE.Color(0xf4efe6), GOLD = new THREE.Color(0xe2a75e), BROWN = new THREE.Color(0x8a5428), CHAR = new THREE.Color(0x2e1d12);
  let toast = 0, fire = 0, burning = false, char = 0, cooldown = 0;
  const embers = rate(), smoke = rate(), flames = rate();
  const state = wrap.userData.state = { toast: 0, burning: false, blownOut: 0 };   // read by the cues
  wrap.userData.reset = () => { toast = 0; char = 0; burning = false; cooldown = 0; };
  wrap.userData.react = (s) => {
    const h = s.hold, t = s.t;
    state.toast = toast; state.burning = burning;
    if (h > 0.5) {
      toast = Math.min(1, toast + s.dt * 0.2);                        // ~5 s to fully toasted
      cooldown = Math.max(0, cooldown - s.dt);
      if (toast >= 1 && !burning && char < 0.9 && cooldown <= 0) burning = true;   // …then it catches fire
    } else {
      // set down: cools, any fire dies, and it slowly turns back into a fresh one
      burning = false; cooldown = 0;
      toast = Math.max(0, toast - s.dt * 0.03); char = Math.max(0, char - s.dt * 0.03);
    }
    if (burning) {
      char = Math.min(1, char + s.dt * 0.12);
      if (s.speed > 1.1) {                                            // shake it to blow it out
        burning = false; cooldown = 4;                                // keep holding 4 s to relight it
        state.blownOut++;
        marsh.getWorldPosition(_w); _w.y += 0.03;
        s.emit('smoke', _w, 22, { x: -s.vel.x * 0.2, y: 0.1, z: 0 }, 0.05);
        s.emit('spark', _w, 10, null, 0.04);
      }
    }
    fire += ((burning ? 1 : 0) - fire) * (1 - Math.exp(-s.dt * (burning ? 4 : 8)));

    // colour: white → gold → brown, then darker as it chars
    if (toast < 0.5) mallow.color.copy(WHITE).lerp(GOLD, toast * 2); else mallow.color.copy(GOLD).lerp(BROWN, (toast - 0.5) * 2);
    mallow.color.lerp(CHAR, char * 0.85);
    const flick = Math.sin(t * 11) * 0.15 + Math.sin(t * 23) * 0.1 + Math.sin(t * 37) * 0.05;
    mallow.emissiveIntensity = h * (0.2 + flick * 0.25) + fire * (0.6 + flick);
    light.intensity = h * (1.2 + flick) + fire * (2.5 + flick * 3);
    marsh.scale.set(1 + h * 0.12 + fire * 0.06, 0.48 + h * 0.08, 1 + h * 0.12 + fire * 0.06);  // puffs up in the heat
    chocolate.scale.set(1 + h * 0.06, 1 - h * 0.25, 1 + h * 0.06);                             // the chocolate melts

    if (h > 0.05 || fire > 0.05) {
      marsh.getWorldPosition(_w); _w.y += 0.025;
      let n = embers(h * (3 + s.speed * 10) + fire * 6, s.dt);
      if (n) s.emit('ember', _w, n, { x: -s.vel.x * 0.25, y: 0.05, z: 0 }, 0.04);
      n = flames(fire * 40, s.dt);
      if (n) s.emit('flame', _w, n, { x: -s.vel.x * 0.3, y: 0.12, z: 0 }, 0.035);
      n = smoke(h * toast * 2 + fire * 4, s.dt);
      if (n) { _w2.copy(_w); _w2.y += 0.06; s.emit('smoke', _w2, n, { x: -s.vel.x * 0.1, y: 0.05, z: 0 }, 0.03); }
    }
  };
  return wrap;
}

/* ---------------- textures (drawn once, in code) ---------------- */
const canvasTex = (w, h, draw) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};

function handkerchiefTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f4efe4'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(160,140,110,.35)'; g.lineWidth = 1;
    for (let i = 0; i < w; i += 6) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); }   // linen weave
    g.fillStyle = '#fffaf0';                                                                           // scalloped lace edge
    for (let i = 8; i < w; i += 16) for (const [x, y] of [[i, 6], [i, h - 6], [6, i], [w - 6, i]]) { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(150,120,90,.5)'; g.setLineDash([3, 3]); g.strokeRect(20, 20, w - 40, h - 40);
    g.setLineDash([]);
    g.fillStyle = '#8a1a2c'; g.font = 'italic 44px Georgia, serif'; g.textAlign = 'right'; g.fillText('M', w - 34, h - 34);  // embroidered initial
  });
}

function grahamTexture() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#c48a52'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(90,50,20,.45)';
    for (let x = 20; x < w; x += 22) for (let y = 20; y < h; y += 22) { g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(90,50,20,.35)'; g.beginPath(); g.moveTo(w / 2, 4); g.lineTo(w / 2, h - 4); g.stroke();
  });
}

let _glow;
export function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}
