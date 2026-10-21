/* ==========================================================================
   FACE — turns the 2D reference photo into a 3D head.

   1. MediaPipe Face Landmarker reads 478 3D landmarks from the photo
      (true facial depth + exact eye / brow / mouth positions).
   2. MediaPipe multiclass segmentation cuts out hair + face + neck
      (and drops the background and clothing).
   3. A dense mesh is displaced by (skull dome + landmark depth) so the
      face has a real nose, brow, cheeks and chin that catch the light
      and shift in perspective when the head turns.
   4. A shader animates the photo in place: irises, eyelids (blink),
      brows, jaw, lips and mouth interior (visemes).
   If the analysis can't run, hand-measured fallbacks for the supplied
   photo are used so the kiosk still works.
   ========================================================================== */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { loadVision } from './vision.js';

const C = CONFIG.face;

const IDX = {
  eyeA: { corners: [33, 133], top: 159, bottom: 145, iris: 468, ring: [469, 470, 471, 472] },
  eyeB: { corners: [362, 263], top: 386, bottom: 374, iris: 473, ring: [474, 475, 476, 477] },
  browA: [70, 63, 105, 66, 107],
  browB: [336, 296, 334, 293, 300],
  mouthCorners: [61, 291], lipInnerTop: 13, lipInnerBottom: 14,
  chin: 152, noseTip: 1, forehead: 10, cheekA: 234, cheekB: 454, bridge: 168,
  oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
    148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
  cheekSkin: [50, 280, 205, 425],
};

/* Hand-measured on the supplied 800×800 photo — used only if MediaPipe fails. */
const FALLBACK_800 = {
  eyeA: { c: [267, 336], rx: 34, hTop: 14, hBot: 12, iris: [267, 336], irisR: 17 },
  eyeB: { c: [434, 337], rx: 34, hTop: 14, hBot: 12, iris: [435, 337], irisR: 17 },
  browA: { c: [262, 290], half: 52, ry: 14 },
  browB: { c: [440, 290], half: 52, ry: 14 },
  mouth: { c: [342, 522], w: 150 },
  chin: [345, 610], nose: [332, 445], forehead: [340, 175], center: [350, 340],
  faceW: 330, faceH: 435,
};

export async function buildFace() {
  const img = await loadImage(C.src);
  const W = img.naturalWidth, H = img.naturalHeight;

  let lm = null, seg = null;
  try {
    const { vision, fileset } = await loadVision();
    lm = await detectLandmarks(vision, fileset, img);
    seg = await segment(vision, fileset, img).catch((e) => { console.warn('[face] segmentation failed', e); return null; });
  } catch (e) {
    console.warn('[face] photo analysis unavailable, using fallback measurements', e);
  }

  const f = lm ? featuresFromLandmarks(lm, W, H) : fallbackFeatures(W);
  const alpha = buildAlpha(seg, f, W, H);
  const colors = sampleColors(img, f, seg, lm, W, H);
  const s = C.faceWidthMeters / f.faceW;             // metres per photo pixel
  const geometry = buildRelief(f, lm, alpha, W, H, s);

  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.anisotropy = 4;
  tex.needsUpdate = true;

  const alphaTex = new THREE.CanvasTexture(alpha.canvas);
  alphaTex.flipY = false;

  const { material, uniforms } = makeMaterial(tex, alphaTex, f, W, H, s);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.name = 'face';

  return {
    mesh, uniforms, features: f, colors, scale: s, W, H,
    analysed: !!lm, segmented: !!seg,
    // Head-space positions (metres) for building the rest of the head around the face
    chinY: -(f.chin[1] - f.center[1]) * s,
    foreheadY: -(f.forehead[1] - f.center[1]) * s,
    headTopY: -(alpha.bbox.y0 - f.center[1]) * s,
    headHalfW: ((alpha.bbox.x1 - alpha.bbox.x0) / 2) * s,
    headCenterX: (((alpha.bbox.x0 + alpha.bbox.x1) / 2) - f.center[0]) * s,
  };
}

/* ---------------------------------------------------------------------- */
async function detectLandmarks(vision, fileset, img) {
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: CONFIG.tracking.faceModel, delegate },
    runningMode: 'IMAGE', numFaces: 1,
  });
  let fl;
  try { fl = await vision.FaceLandmarker.createFromOptions(fileset, opts('GPU')); }
  catch { fl = await vision.FaceLandmarker.createFromOptions(fileset, opts('CPU')); }
  const res = fl.detect(img);
  fl.close();
  const pts = res.faceLandmarks?.[0];
  if (!pts || pts.length < 478) throw new Error('No face found in reference photo');
  return pts;
}

async function segment(vision, fileset, img) {
  const s = await vision.ImageSegmenter.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: CONFIG.tracking.segmentModel },
    runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
  });
  const res = s.segment(img);
  const masks = res.confidenceMasks;
  // selfie_multiclass: 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 accessories
  const w = masks[0].width, h = masks[0].height;
  const get = (i) => masks[i]?.getAsFloat32Array().slice() || new Float32Array(w * h);
  const out = { w, h, hair: get(1), body: get(2), face: get(3), clothes: get(4), other: get(5) };
  masks.forEach((m) => m.close());
  s.close();
  return out;
}

/* ---------------------------------------------------------------------- */
function featuresFromLandmarks(lm, W, H) {
  const P = (i) => [lm[i].x * W, lm[i].y * H, lm[i].z * W];
  const eye = (e) => {
    const a = P(e.corners[0]), b = P(e.corners[1]);
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const iris = P(e.iris);
    const irisR = e.ring.reduce((acc, i) => acc + Math.hypot(P(i)[0] - iris[0], P(i)[1] - iris[1]), 0) / 4;
    return { c, rx: Math.abs(b[0] - a[0]) / 2, hTop: c[1] - P(e.top)[1], hBot: P(e.bottom)[1] - c[1], iris: [iris[0], iris[1]], irisR };
  };
  const brow = (ids, e) => {
    const pts = ids.map(P);
    const xs = pts.map((p) => p[0]);
    const c = [xs.reduce((a, b) => a + b) / xs.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
    return { c, half: (Math.max(...xs) - Math.min(...xs)) / 2 * 1.15, ry: Math.max(8, (e.c[1] - c[1]) * 0.55) };
  };
  const eyeA = eye(IDX.eyeA), eyeB = eye(IDX.eyeB);
  const m0 = P(IDX.mouthCorners[0]), m1 = P(IDX.mouthCorners[1]);
  const seam = (P(IDX.lipInnerTop)[1] + P(IDX.lipInnerBottom)[1]) / 2;
  return {
    eyeA, eyeB,
    browA: brow(IDX.browA, eyeA), browB: brow(IDX.browB, eyeB),
    mouth: { c: [(m0[0] + m1[0]) / 2, seam], w: Math.hypot(m1[0] - m0[0], m1[1] - m0[1]) },
    chin: P(IDX.chin), nose: P(IDX.noseTip), forehead: P(IDX.forehead), center: P(IDX.bridge),
    faceW: Math.abs(P(IDX.cheekB)[0] - P(IDX.cheekA)[0]),
    faceH: P(IDX.chin)[1] - P(IDX.forehead)[1],
  };
}

function fallbackFeatures(W) {
  const k = W / 800;
  const sc = (o) => JSON.parse(JSON.stringify(o), (key, v) => (typeof v === 'number' ? v * k : v));
  return sc(FALLBACK_800);
}

/* ---------------------------------------------------------------------- */
/* Alpha mask: hair + face + neck, faded below the chin.                   */
function buildAlpha(seg, f, W, H) {
  const R = 512;
  const A = new Float32Array(R * R);
  const fadeA = f.chin[1] + f.faceH * C.neckFade * 0.55;
  const fadeB = f.chin[1] + f.faceH * C.neckFade;
  const ex = f.faceW * 0.95, ey = f.faceH * 0.95, ecx = f.center[0], ecy = f.center[1] - f.faceH * 0.05;

  for (let j = 0; j < R; j++) {
    for (let i = 0; i < R; i++) {
      const x = (i + 0.5) / R * W, y = (j + 0.5) / R * H;
      let a;
      if (seg) {
        const si = Math.min(seg.w - 1, Math.floor((i + 0.5) / R * seg.w));
        const sj = Math.min(seg.h - 1, Math.floor((j + 0.5) / R * seg.h));
        const k = sj * seg.w + si;
        a = seg.hair[k] + seg.face[k] + seg.body[k] + seg.other[k] * 0.9;
        a = smooth(0.35, 0.75, a);
      } else {
        // Rough head + hair ellipse from features
        const dx = (x - ecx) / (f.faceW * 0.62), dy = (y - (f.center[1] - f.faceH * 0.12)) / (f.faceH * 0.78);
        a = 1 - smooth(0.85, 1.0, Math.hypot(dx, dy));
        if (y > f.chin[1] - f.faceH * 0.1) a = Math.max(a, 1 - smooth(f.faceW * 0.2, f.faceW * 0.3, Math.abs(x - f.chin[0])));
      }
      a *= 1 - smooth(fadeA, fadeB, y);                                   // fade the neck into the collar
      a *= 1 - smooth(0.85, 1.0, Math.hypot((x - ecx) / ex, (y - ecy) / ey)); // never reach far into the background
      A[j * R + i] = a;
    }
  }
  // Soft 1px blur for clean edges
  const B = new Float32Array(R * R);
  for (let j = 1; j < R - 1; j++) for (let i = 1; i < R - 1; i++) {
    let s = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += A[(j + dj) * R + i + di];
    B[j * R + i] = s / 9;
  }

  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = R;
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(R, R);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const a = B[j * R + i];
    const o = (j * R + i) * 4;
    id.data[o] = id.data[o + 1] = id.data[o + 2] = 255;
    id.data[o + 3] = Math.round(a * 255);
    if (a > 0.3) {
      const x = (i / R) * W, y = (j / R) * H;
      if (y < f.chin[1]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  ctx.putImageData(id, 0, 0);
  const at = (x, y) => {
    const i = Math.max(0, Math.min(R - 1, Math.floor(x / W * R)));
    const j = Math.max(0, Math.min(R - 1, Math.floor(y / H * R)));
    return B[j * R + i];
  };
  return { canvas, at, bbox: { x0, y0, x1, y1 } };
}

/* ---------------------------------------------------------------------- */
/* Displaced mesh: skull dome + landmark depth.                            */
function buildRelief(f, lm, alpha, W, H, s) {
  const N = C.meshSegments;
  const pad = 0.03 * W;
  const bx0 = Math.max(0, alpha.bbox.x0 - pad), bx1 = Math.min(W, alpha.bbox.x1 + pad);
  const by0 = Math.max(0, alpha.bbox.y0 - pad), by1 = Math.min(H, alpha.bbox.y1 + pad);

  const headCx = (alpha.bbox.x0 + alpha.bbox.x1) / 2;
  const headRx = (alpha.bbox.x1 - alpha.bbox.x0) / 2;
  const headCy = (alpha.bbox.y0 + f.chin[1]) / 2;
  const headRy = (f.chin[1] - alpha.bbox.y0) / 2 * 1.08;
  const domeR = C.domeDepth * headRx;

  // Landmark depth field (Gaussian-splatted)
  let pts = null, zBack = 0, sigma2 = 0, wRef = 1;
  if (lm) {
    pts = lm.map((p) => [p.x * W, p.y * H, p.z * W]);
    zBack = IDX.oval.reduce((a, i) => a + pts[i][2], 0) / IDX.oval.length;
    const sigma = f.faceW * 0.045;
    sigma2 = 2 * sigma * sigma;
    wRef = splat(pts, f.nose[0], f.nose[1], sigma2).w;
  }

  const verts = new Float32Array((N + 1) * (N + 1) * 3);
  const uvs = new Float32Array((N + 1) * (N + 1) * 2);
  const k = W / 800;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const x = bx0 + (bx1 - bx0) * (i / N);
      const y = by0 + (by1 - by0) * (j / N);
      const dx = (x - headCx) / headRx, dy = (y - headCy) / headRy;
      let h = domeR * Math.sqrt(Math.max(0, 1 - dx * dx - dy * dy));
      if (pts) {
        const r = splat(pts, x, y, sigma2);
        const fm = smooth(0.06, 0.4, r.w / wRef);
        h += fm * (zBack - r.z) * C.depthScale;
      } else {
        h += proceduralFace(f, x, y, k);
      }
      // Recede anything transparent so stray edges never poke forward
      h *= 0.25 + 0.75 * smooth(0.0, 0.5, alpha.at(x, y));
      const o = (j * (N + 1) + i);
      verts[o * 3] = (x - f.center[0]) * s;
      verts[o * 3 + 1] = -(y - f.center[1]) * s;
      verts[o * 3 + 2] = h * s;
      uvs[o * 2] = x / W;
      uvs[o * 2 + 1] = y / H;
    }
  }
  const index = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function splat(pts, x, y, sigma2) {
  let w = 0, z = 0;
  for (let n = 0; n < 468; n++) {
    const p = pts[n];
    const dx = p[0] - x, dy = p[1] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > sigma2 * 9) continue;
    const ww = Math.exp(-d2 / sigma2);
    w += ww; z += ww * p[2];
  }
  return { w, z: w > 1e-6 ? z / w : 0 };
}

function proceduralFace(f, x, y, k) {
  const g = (cx, cy, r, a) => a * Math.exp(-(((x - cx) ** 2) + ((y - cy) ** 2)) / (2 * r * r));
  return g(f.nose[0], f.nose[1] - 10 * k, 38 * k, 55 * k)        // nose
    + g(f.center[0], f.center[1] - 60 * k, 140 * k, 25 * k)       // brow / forehead
    - g(f.eyeA.c[0], f.eyeA.c[1], 30 * k, 12 * k) - g(f.eyeB.c[0], f.eyeB.c[1], 30 * k, 12 * k)
    + g(f.mouth.c[0], f.mouth.c[1], 50 * k, 18 * k) + g(f.chin[0], f.chin[1] - 30 * k, 50 * k, 15 * k);
}

/* ---------------------------------------------------------------------- */
function sampleColors(img, f, seg, lm, W, H) {
  const cv = document.createElement('canvas');
  cv.width = 200; cv.height = Math.round(200 * H / W);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const px = (x, y) => { const o = (Math.floor(y / H * cv.height) * cv.width + Math.floor(x / W * cv.width)) * 4; return [d[o], d[o + 1], d[o + 2]]; };
  const avg = (list) => list.reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0]).map((v) => v / list.length);

  const cheeks = lm ? IDX.cheekSkin.map((i) => px(lm[i].x * W, lm[i].y * H))
    : [px(f.eyeA.c[0], f.eyeA.c[1] + 70), px(f.eyeB.c[0], f.eyeB.c[1] + 70)];
  let hair = null;
  if (seg) {
    const list = [];
    for (let k = 0; k < seg.w * seg.h; k += 7) if (seg.hair[k] > 0.85) {
      list.push(px((k % seg.w) / seg.w * W, Math.floor(k / seg.w) / seg.h * H));
    }
    if (list.length > 10) hair = avg(list);
  }
  const toColor = (rgb, mul = 1) => new THREE.Color().setRGB(rgb[0] / 255 * mul, rgb[1] / 255 * mul, rgb[2] / 255 * mul, THREE.SRGBColorSpace);
  return {
    skin: toColor(avg(cheeks), 0.92),
    hair: hair ? toColor(hair, 0.9) : new THREE.Color(CONFIG.body.hairFallback),
  };
}

/* ---------------------------------------------------------------------- */
function makeMaterial(tex, alphaTex, f, W, H, s) {
  const k = W / 800;
  const v2 = (a) => new THREE.Vector2(a[0], a[1]);
  const uniforms = {
    uMap: { value: tex },
    uAlpha: { value: alphaTex },
    uRes: { value: new THREE.Vector2(W, H) },
    uEyeA: { value: new THREE.Vector4(f.eyeA.c[0], f.eyeA.c[1], f.eyeA.rx, 0) },
    uEyeB: { value: new THREE.Vector4(f.eyeB.c[0], f.eyeB.c[1], f.eyeB.rx, 0) },
    uLidA: { value: new THREE.Vector2(f.eyeA.hTop, f.eyeA.hBot) },
    uLidB: { value: new THREE.Vector2(f.eyeB.hTop, f.eyeB.hBot) },
    uIrisA: { value: new THREE.Vector3(f.eyeA.iris[0], f.eyeA.iris[1], f.eyeA.irisR) },
    uIrisB: { value: new THREE.Vector3(f.eyeB.iris[0], f.eyeB.iris[1], f.eyeB.irisR) },
    uBrowA: { value: new THREE.Vector4(f.browA.c[0], f.browA.c[1], f.browA.half, f.browA.ry) },
    uBrowB: { value: new THREE.Vector4(f.browB.c[0], f.browB.c[1], f.browB.half, f.browB.ry) },
    uMouthC: { value: v2(f.mouth.c) },
    uMouthW: { value: f.mouth.w },
    uChinY: { value: f.chin[1] },
    uCenter: { value: v2(f.center) },
    uScale: { value: s },
    // animated
    uGaze: { value: new THREE.Vector2() },          // iris offset in px
    uBlink: { value: new THREE.Vector2() },         // A, B 0..1
    uBrow: { value: new THREE.Vector2() },          // A, B raise 0..1
    uMouth: { value: new THREE.Vector4() },         // open, wide, round, smile
    uJaw: { value: 0 },
    uOpenMax: { value: C.mouthOpenMax * k },
    uBrowMax: { value: C.browRaise * k },
    uJawMax: { value: C.jawDropMeters },
    // lighting (view space, updated by scene)
    uKeyDir: { value: new THREE.Vector3(-0.4, 0.5, 0.8).normalize() },
    uKeyColor: { value: new THREE.Color(1.0, 0.86, 0.72) },
    uFillDir: { value: new THREE.Vector3(0.6, 0.1, 0.7).normalize() },
    uFillColor: { value: new THREE.Color(0.18, 0.2, 0.28) },
    uRimDir: { value: new THREE.Vector3(0.5, 0.4, -0.7).normalize() },
    uRimColor: { value: new THREE.Color(0.45, 0.55, 0.8) },
    uAmbient: { value: 0.36 },
    uExposure: { value: 1.0 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: true,
    vertexShader: /* glsl */`
      uniform vec2 uRes; uniform vec2 uMouthC; uniform float uMouthW; uniform float uChinY;
      uniform float uJaw; uniform float uJawMax;
      varying vec2 vUv; varying vec3 vN; varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vec2 p = uv * uRes;
        vec3 pos = position;
        // jaw: lower face drops slightly (geometry), lips handled in fragment
        float below = smoothstep(uMouthC.y - 2.0, uMouthC.y + 18.0, p.y);
        float chin = 1.0 - smoothstep(uChinY, uChinY + (uChinY - uMouthC.y) * 0.9, p.y);
        float side = 1.0 - smoothstep(uMouthW * 0.7, uMouthW * 1.35, abs(p.x - uMouthC.x));
        pos.y -= uJaw * uJawMax * below * chin * side;
        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vViewPos = mv.xyz;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform sampler2D uAlpha; uniform vec2 uRes;
      uniform vec4 uEyeA, uEyeB; uniform vec2 uLidA, uLidB; uniform vec3 uIrisA, uIrisB;
      uniform vec4 uBrowA, uBrowB; uniform vec2 uMouthC; uniform float uMouthW, uChinY;
      uniform vec2 uGaze, uBlink, uBrow; uniform vec4 uMouth; uniform float uOpenMax, uBrowMax;
      uniform vec3 uKeyDir, uFillDir, uRimDir; uniform vec3 uKeyColor, uFillColor, uRimColor;
      uniform float uAmbient, uExposure;
      varying vec2 vUv; varying vec3 vN; varying vec3 vViewPos;

      float ell(vec2 p, vec2 c, vec2 r, float inner) { return 1.0 - smoothstep(inner, 1.0, length((p - c) / r)); }

      // Eyelid: slides the upper lid down over the eye. Returns shifted p and lash shading.
      vec2 lid(vec2 p, vec4 eye, vec2 h, float b, inout float lash) {
        float xn = (p.x - eye.x) / eye.z;
        if (abs(xn) > 1.15 || b < 0.001) return p;
        float prof = sqrt(max(0.0, 1.0 - xn * xn));
        float top = eye.y - h.x * prof * 1.08;
        float bot = eye.y + h.y * prof;
        float span = (bot - top) * b;
        float edge = top + span;
        if (p.y < edge && p.y > top - h.x * 3.5) {
          float f = smoothstep(top - h.x * 3.5, top, p.y);
          p.y -= span * f;
        }
        lash = max(lash, b * prof * exp(-pow((p.y - edge) / 1.6, 2.0)));
        return p;
      }

      void main() {
        vec2 p = vUv * uRes;
        vec2 p0 = p;

        // ---------------- mouth ----------------
        float open = uMouth.x, wide = uMouth.y, rnd = uMouth.z, smile = uMouth.w;
        float halfW = uMouthW * 0.5 * (1.0 + 0.10 * wide - 0.28 * rnd);
        float mReg = ell(p, uMouthC, vec2(uMouthW * 0.8, uMouthW * 0.45), 0.4);
        p.x = uMouthC.x + (p.x - uMouthC.x) * (1.0 - 0.07 * wide * mReg + 0.22 * rnd * mReg);
        // smile: lift corners
        vec2 cA = uMouthC - vec2(uMouthW * 0.5, 0.0), cB = uMouthC + vec2(uMouthW * 0.5, 0.0);
        float sig = uMouthW * 0.16;
        float cm = exp(-dot(p - cA, p - cA) / (2.0 * sig * sig)) + exp(-dot(p - cB, p - cB) / (2.0 * sig * sig));
        p.y += smile * uOpenMax * 0.35 * cm;

        float xn = (p.x - uMouthC.x) / halfW;
        float prof = pow(max(0.0, 1.0 - xn * xn), 0.75);
        float gap = open * uOpenMax * prof * (1.0 + 0.35 * rnd);
        float dy = p.y - uMouthC.y;
        float interior = 0.0;
        float teeth = 0.0;
        if (dy > 0.0 && dy < gap) {
          interior = 1.0;
          float t = dy / max(gap, 0.001);
          teeth = (1.0 - smoothstep(0.18, 0.34, t)) * (1.0 - smoothstep(0.45, 0.8, abs(xn))) * smoothstep(0.25, 0.5, open);
        } else if (dy >= gap) {
          float fall = 1.0 - smoothstep(0.0, (uChinY - uMouthC.y) * 1.05, dy);
          p.y -= gap * fall;
        } else {
          float up = 1.0 - smoothstep(0.0, uMouthW * 0.22, -dy);
          p.y += gap * 0.22 * up;
        }

        // ---------------- brows ----------------
        p.y += uBrow.x * uBrowMax * ell(p, uBrowA.xy, uBrowA.zw * vec2(1.0, 1.6), 0.2);
        p.y += uBrow.y * uBrowMax * ell(p, uBrowB.xy, uBrowB.zw * vec2(1.0, 1.6), 0.2);

        // ---------------- eyelids ----------------
        float lash = 0.0;
        vec2 pl = lid(p, uEyeA, uLidA, uBlink.x, lash);
        pl = lid(pl, uEyeB, uLidB, uBlink.y, lash);
        bool covered = pl.y != p.y;
        p = pl;

        // ---------------- irises ----------------
        if (!covered) {
          float mA = ell(p, uIrisA.xy, vec2(uEyeA.z * 1.08, (uLidA.x + uLidA.y) * 0.8), 0.58);
          float mB = ell(p, uIrisB.xy, vec2(uEyeB.z * 1.08, (uLidB.x + uLidB.y) * 0.8), 0.58);
          p -= uGaze * (mA + mB);
        }

        vec3 albedo = texture2D(uMap, clamp(p / uRes, 0.0, 1.0)).rgb;
        if (interior > 0.5) {
          vec3 inside = mix(vec3(0.10, 0.025, 0.03), vec3(0.22, 0.07, 0.07), smoothstep(0.4, 1.0, dy / max(gap, 0.001)));
          albedo = mix(inside, vec3(0.78, 0.74, 0.68), teeth * 0.85);
        }
        albedo *= 1.0 - 0.6 * lash;

        float alpha = texture2D(uAlpha, vUv).a;
        if (alpha < 0.02) discard;

        // ---------------- lighting ----------------
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(-vViewPos);
        float key = max(dot(N, uKeyDir), 0.0);
        float fill = max(dot(N, uFillDir), 0.0);
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * max(dot(N, uRimDir) + 0.5, 0.0);
        vec3 light = vec3(uAmbient) + uKeyColor * key * 0.62 + uFillColor * fill;
        vec3 col = albedo * light * uExposure + uRimColor * rim * 0.22;
        col *= mix(0.55, 1.0, smoothstep(0.1, 0.8, alpha)); // darken fringe
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return { material, uniforms };
}

/* ---------------------------------------------------------------------- */
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not load ' + src));
    img.src = src;
  });
}
