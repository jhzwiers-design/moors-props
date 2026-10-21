/* ==========================================================================
   SCENE — renderer, cinematic camera, stage lighting, backstage set.
   The set is deliberately darker and less detailed than the character.
   ========================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CONFIG } from './config.js';

export function createStage(container) {
  const R = CONFIG.render;
  const DIRECTOR = CONFIG.experience.director;
  const renderer = new THREE.WebGLRenderer({ antialias: R.antialias, powerPreference: 'high-performance' });
  // Pixel budget: big/Retina screens (e.g. a 5K iMac) render at most ~maxRenderPixels and are
  // scaled up by the browser — far less GPU work, hardly visible from viewing distance.
  const budgetPR = () => {
    const w = window.innerWidth || 1, h = window.innerHeight || 1;
    return Math.min(window.devicePixelRatio || 1, R.maxPixelRatio, Math.sqrt(R.maxRenderPixels / (w * h)));
  };
  renderer.setPixelRatio(budgetPR());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = R.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x030203);
  scene.fog = new THREE.FogExp2(0x050405, 0.075);

  /* ---------------- camera ---------------- */
  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.05, 60);
  const camBase = new THREE.Vector3(0, 1.43, 2.05);
  const lookAt = new THREE.Vector3(0, 1.40, 0);
  camera.position.copy(camBase);
  camera.lookAt(lookAt);

  /* ---------------- lights ---------------- */
  scene.add(new THREE.HemisphereLight(0x3a3036, 0x0a0708, 0.8));

  const key = new THREE.SpotLight(0xffd6ae, 38, 12, 0.42, 0.6, 2);
  key.position.set(-1.25, 3.1, 2.4);
  key.target.position.set(0, 1.45, 0);
  key.castShadow = R.shadows;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 4;
  scene.add(key, key.target);

  // Fill and rim lights only exist to model the director's face. Every light costs on every
  // pixel, so they are left out entirely in props mode.
  const fill = new THREE.SpotLight(0x8090c0, 10, 10, 0.6, 0.8, 2);
  fill.position.set(1.8, 1.8, 2.2);
  fill.target.position.set(0, 1.4, 0);
  const rim = new THREE.SpotLight(0x9bb4ff, 32, 10, 0.5, 0.5, 2);
  rim.position.set(1.3, 2.9, -2.0);
  rim.target.position.set(0, 1.5, 0);
  const rim2 = new THREE.SpotLight(0xffc89a, 25, 10, 0.5, 0.6, 2);
  rim2.position.set(-1.6, 2.4, -1.6);
  rim2.target.position.set(0, 1.4, 0);
  if (DIRECTOR) scene.add(fill, fill.target, rim, rim.target, rim2, rim2.target);

  // dim washes so the set reads, but stays well below the character
  const cyc = new THREE.SpotLight(0x5a3a6a, 26, 14, 0.9, 0.9, 1.6);
  cyc.position.set(0, 6.5, 1.0);
  cyc.target.position.set(0, 1.5, -4.2);
  scene.add(cyc, cyc.target);
  const pool = new THREE.SpotLight(0xffb070, 22, 9, 0.55, 0.9, 1.8);
  pool.position.set(1.8, 4.2, -1.2);
  pool.target.position.set(-1.6, 0.0, -2.4);
  scene.add(pool, pool.target);

  /* ---------------- set ---------------- */
  buildFloor(scene);
  buildCurtains(scene);
  buildTruss(scene, DIRECTOR ? 4 : 2);
  buildGhostLight(scene);
  buildRoadCases(scene);
  buildSeats(scene);
  buildLadder(scene);
  const dust = buildDust(scene, R.dust);

  /* ---------------- resize ---------------- */
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) return;               // hidden/minimised window: keep the last good size (avoids 0/0 → NaN)
    renderer.setSize(w, h);
    if (typeof pr !== 'undefined') { maxPR = budgetPR(); pr = Math.min(pr, maxPR); renderer.setPixelRatio(pr); }
    camera.aspect = w / h;
    // Portrait screens: pull back slightly so shoulders and hands stay in frame
    camera.fov = w / h < 0.8 ? 36 : 30;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);
  onResize();

  /* ---------------- per-frame ---------------- */
  const camOffset = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  function update(dt, t, viewer, faceUniforms, headPos) {
    // Subtle camera parallax with the visitor (x right+, y up+, in -1..1), plus slow drift
    const P = CONFIG.motion.cameraParallax;
    const k = 1 - Math.pow(1 - 0.03, dt * 60);
    camOffset.x += ((viewer ? viewer.x * P.x : 0) + Math.sin(t * 0.13) * 0.012 - camOffset.x) * k;
    camOffset.y += ((viewer ? viewer.y * P.y : 0) + Math.sin(t * 0.11 + 1) * 0.006 - camOffset.y) * k;
    camera.position.copy(camBase).add(camOffset);
    camera.lookAt(lookAt);

    dust.update(dt, t);

    // Feed the stage lights into the face shader (view space)
    if (faceUniforms && headPos) {
      camera.updateMatrixWorld();
      const toView = (light, out) => out.copy(light.position).sub(headPos).normalize().transformDirection(camera.matrixWorldInverse);
      toView(key, faceUniforms.uKeyDir.value);
      toView(fill, faceUniforms.uFillDir.value);
      toView(rim, faceUniforms.uRimDir.value);
    }
    renderer.render(scene, camera);
    if (R.adaptive) adapt(dt);
  }

  /* Adaptive resolution: if frames run long for a couple of seconds, render fewer
     pixels; if there's lots of headroom for a while, step back up. */
  var pr = renderer.getPixelRatio(), maxPR = pr;
  let slow = 0, fast = 0, cool = 0, avg = 1 / 60;
  function adapt(dt) {
    if (dt <= 0 || dt > 0.25) return;                 // ignore tab switches / hitches
    avg += (dt - avg) * 0.05;
    cool -= dt;
    if (avg > 1 / 48) { slow += dt; fast = 0; } else if (avg < 1 / 58) { fast += dt; slow = 0; } else { slow = fast = 0; }
    if (cool > 0) return;
    const minPR = Math.min(R.minPixelRatio, maxPR * 0.6);
    if (slow > 1.2 && pr > minPR) { pr = Math.max(minPR, pr - 0.12); renderer.setPixelRatio(pr); slow = 0; cool = 1.5; }
    else if (fast > 6 && pr < maxPR) { pr = Math.min(maxPR, pr + 0.1); renderer.setPixelRatio(pr); fast = 0; cool = 4; }
  }

  return { renderer, scene, camera, update, camBase, lookAt, lights: { key, fill, rim }, pixelRatio: () => pr };
}

/* ======================================================================== */
function buildFloor(scene) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#16110e'; g.fillRect(0, 0, 1024, 1024);
  for (let i = 0; i < 16; i++) {                       // stage deck boards
    const x = i * 64;
    g.fillStyle = `hsl(20, 18%, ${7 + Math.random() * 4}%)`;
    g.fillRect(x + 1, 0, 62, 1024);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`;
      g.fillRect(x + Math.random() * 62, Math.random() * 1024, 1 + Math.random() * 2, 30 + Math.random() * 200);
    }
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x, 0, 1.5, 1024);
  }
  for (let k = 0; k < 120; k++) {                      // scuffs
    g.fillStyle = `rgba(255,240,220,${Math.random() * 0.03})`;
    g.beginPath(); g.arc(Math.random() * 1024, Math.random() * 1024, Math.random() * 30, 0, 7); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(5, 5);
  tex.anisotropy = 4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, metalness: 0.0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // spike tape marks
  const tape = new THREE.MeshBasicMaterial({ color: 0x5fd0a0, toneMapped: false, fog: true });
  for (const [x, z] of [[0, 0.25], [-1.2, -0.9], [1.4, -0.6]]) {
    for (const r of [0.6, -0.6]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.018), tape);
      m.rotation.set(-Math.PI / 2, 0, r);
      m.position.set(x, 0.002, z);
      scene.add(m);
    }
  }
}

function buildCurtains(scene) {
  // MeshStandard (not Physical/sheen): these are the largest surfaces on screen, so keep them cheap
  const velvet = new THREE.MeshStandardMaterial({ color: 0x120d0e, roughness: 0.92 });
  const drape = (w, h, folds, amp) => {
    const g = new THREE.PlaneGeometry(w, h, Math.round(folds * 10), 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setZ(i, Math.sin(x / w * folds * Math.PI * 2) * amp + Math.sin(x * 7.3) * amp * 0.25);
    }
    g.computeVertexNormals();
    return g;
  };
  const back = new THREE.Mesh(drape(16, 8, 26, 0.09), velvet);
  back.position.set(0, 4, -4.2);
  back.receiveShadow = true;
  scene.add(back);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(drape(2.2, 8, 5, 0.1), velvet);
    leg.position.set(s * 3.1, 4, -1.4);
    leg.rotation.y = -s * 0.35;
    scene.add(leg);
  }
  const border = new THREE.Mesh(drape(16, 1.2, 20, 0.06), velvet);
  border.position.set(0, 5.0, -1.0);
  scene.add(border);
}

function buildTruss(scene, beams = 4) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.5, metalness: 0.7 });
  const truss = new THREE.Group();
  truss.position.set(0, 4.1, -2.4);
  for (const [y, z] of [[0, 0], [0.3, 0], [0, 0.3], [0.3, 0.3]]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 9, 6), steel);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, y, z); truss.add(bar);
  }
  scene.add(truss);

  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(0xffd2a0) }, uStrength: { value: 0.09 } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = uv.y; vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(normalize(vN), vV)), 1.6); float a = uStrength * edge * smoothstep(0.0, 0.9, vY);
      gl_FragColor = vec4(uColor * a, a); }`,
  });

  // big additive beams are mostly overdraw: keep only the two central ones unless the director is on
  const fixtures = (beams >= 4 ? [[-2.4, -0.55], [-0.8, -0.25], [0.9, 0.2], [2.5, 0.5]] : [[-0.8, -0.25], [0.9, 0.2]]);
  fixtures.forEach(([x, tilt], i) => {
    const can = new THREE.Group();
    can.position.set(x, 3.95, -2.25);
    can.rotation.set(0.35, 0, tilt);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.38, 16), steel);
    can.add(body);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.11, 20),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x8fa8ff : 0xffcc90 }));
    lens.rotation.x = Math.PI / 2; lens.position.y = -0.195; can.add(lens);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.9, 4.2, 32, 1, true), beamMat.clone());
    beam.material.uniforms.uColor.value = new THREE.Color(i % 2 ? 0x7f9cff : 0xffc890);
    beam.material.uniforms.uStrength.value = i % 2 ? 0.08 : 0.11;
    beam.position.y = -2.3;
    can.add(beam);
    scene.add(can);
  });
}

function buildGhostLight(scene) {
  const g = new THREE.Group();
  g.position.set(2.05, 0, -2.3);
  const dark = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6, metalness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.6, 8), dark);
  pole.position.y = 0.8; g.add(pole);
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), dark);
    leg.position.set(Math.cos(i * 2.1) * 0.15, 0.08, Math.sin(i * 2.1) * 0.15);
    leg.rotation.set(Math.sin(i * 2.1) * 1.1, 0, -Math.cos(i * 2.1) * 1.1);
    g.add(leg);
  }
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
  bulb.position.y = 1.68; g.add(bulb);
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), new THREE.MeshBasicMaterial({ color: 0x222222, wireframe: true }));
  cage.position.y = 1.68; g.add(cage);
  const light = new THREE.PointLight(0xffc98a, 2.2, 4, 2);
  light.position.y = 1.68; g.add(light);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffcf90, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6 }));
  glow.scale.set(0.9, 0.9, 1); glow.position.y = 1.68; g.add(glow);
  scene.add(g);
}

function buildRoadCases(scene) {
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.7 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.35, metalness: 0.9 });
  const mk = (w, h, d, x, y, z, ry) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, 0.015), caseMat));
    for (const sy of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w + 0.01, 0.02, d + 0.01), edge);
      e.position.y = sy * (h / 2 - 0.01); g.add(e);
    }
    g.position.set(x, y + h / 2, z); g.rotation.y = ry;
    g.traverse((o) => { o.castShadow = o.receiveShadow = true; });
    scene.add(g);
    return g;
  };
  mk(0.95, 0.72, 0.62, -2.1, 0, -2.2, 0.35);
  mk(0.8, 0.5, 0.55, -2.15, 0.72, -2.2, 0.28);
  mk(0.7, 0.9, 0.6, 1.2, 0, -3.3, -0.2);
  // scripts stacked on the road case
  const paper = new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.9 });
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.025, 0.29), paper);
    s.position.set(-2.1 + Math.sin(i * 3) * 0.03, 1.235 + i * 0.027, -2.15);
    s.rotation.y = 0.3 + Math.sin(i * 7) * 0.15;
    s.castShadow = true;
    scene.add(s);
  }
}

function buildSeats(scene) {
  // A row of house seats pushed upstage for rehearsal
  const red = new THREE.MeshStandardMaterial({ color: 0x3a0c10, roughness: 0.9 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5, metalness: 0.5 });
  const seat = new THREE.Group();
  const back = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.6, 0.08, 2, 0.03), red);
  back.position.set(0, 0.75, -0.2); back.rotation.x = -0.12; seat.add(back);
  const cush = new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.09, 0.42, 2, 0.03), red);
  cush.position.set(0, 0.45, 0.02); seat.add(cush);
  for (const sx of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.5), frame);
    arm.position.set(sx * 0.27, 0.32, -0.02); seat.add(arm);
  }
  for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) {
    const s = seat.clone();
    s.position.set(-4.0 + i * 0.56 + r * 0.25, r * 0.18, -3.0 - r * 0.85);
    s.rotation.y = 0.45;
    scene.add(s);
  }
}

function buildLadder(scene) {
  const al = new THREE.MeshStandardMaterial({ color: 0x3c3c40, roughness: 0.4, metalness: 0.8 });
  const g = new THREE.Group();
  for (const x of [-0.22, 0.22]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 3.2, 0.06), al);
    rail.position.set(x, 1.6, 0); g.add(rail);
  }
  for (let i = 0; i < 10; i++) {
    const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.44, 6), al);
    rung.rotation.z = Math.PI / 2; rung.position.y = 0.3 + i * 0.3; g.add(rung);
  }
  g.position.set(2.9, 0, -3.3); g.rotation.set(-0.12, -0.5, 0);
  scene.add(g);
}

function buildDust(scene, count) {
  const pos = new Float32Array(count * 3);
  const seed = [];
  for (let i = 0; i < count; i++) {
    seed.push({ x: (Math.random() - 0.5) * 2.4, y: Math.random() * 3.2, z: -0.8 + Math.random() * 2.0, s: 0.02 + Math.random() * 0.05, p: Math.random() * 6.28 });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ size: 0.012, color: 0xffe0bb, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture(), sizeAttenuation: true });
  const pts = new THREE.Points(g, m);
  scene.add(pts);
  return {
    update(dt, t) {
      for (let i = 0; i < count; i++) {
        const d = seed[i];
        d.y += d.s * dt * 0.6;
        if (d.y > 3.2) d.y = 0;
        pos[i * 3] = d.x + Math.sin(t * 0.3 + d.p) * 0.15;
        pos[i * 3 + 1] = d.y;
        pos[i * 3 + 2] = d.z + Math.cos(t * 0.25 + d.p) * 0.1;
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}

let _glow;
function glowTexture() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}
