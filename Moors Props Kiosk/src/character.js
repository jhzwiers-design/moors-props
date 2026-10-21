/* ==========================================================================
   CHARACTER — a lightweight rigged digital human built around the 3D face.

   Rig (Object3D joints, rigid segments):
     root ─ hips ─ spine ─ chest ─┬─ neck ─ head ─ (face, skull, hair)
                                  ├─ shoulderL ─ elbowL ─ wristL ─ hand + clipboard
                                  └─ shoulderR ─ elbowR ─ wristR ─ hand
   Wardrobe: black turtleneck, charcoal blazer with lapels, headset round
   the neck, clipboard with the script.
   ========================================================================== */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CONFIG } from './config.js';
import { buildFace } from './face.js';

const B = CONFIG.body;

// Torso silhouette: [radius, height] relative to the chest joint
const TORSO = [[0.0, -0.40], [0.138, -0.40], [0.132, -0.30], [0.124, -0.20], [0.140, -0.09], [0.148, 0.0],
  [0.152, 0.05], [0.147, 0.09], [0.125, 0.122], [0.085, 0.145], [0.056, 0.158], [0.0, 0.16]];
const TORSO_SX = 1.13, TORSO_SZ = 0.74;

export async function createCharacter() {
  const face = await buildFace();
  const skinColor = face.colors.skin;
  const hairColor = face.colors.hair;

  const mat = {
    jacket: new THREE.MeshPhysicalMaterial({ color: B.jacket, roughness: 0.78, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x55555f) }),
    lapel: new THREE.MeshPhysicalMaterial({ color: B.lapel, roughness: 0.6, sheen: 0.5, sheenColor: new THREE.Color(0x666670) }),
    knit: new THREE.MeshStandardMaterial({ color: B.turtleneck, roughness: 0.95 }),
    skin: new THREE.MeshPhysicalMaterial({ color: skinColor, roughness: 0.55, sheen: 0.25, sheenColor: new THREE.Color(0xffc0a8) }),
    neck: new THREE.MeshStandardMaterial({ color: skinColor.clone().multiplyScalar(0.55), roughness: 0.7 }),
    hair: new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.7, side: THREE.DoubleSide }),
    headset: new THREE.MeshStandardMaterial({ color: B.headset, roughness: 0.4, metalness: 0.3 }),
    cushion: new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.9 }),
    board: new THREE.MeshStandardMaterial({ color: B.clipboard, roughness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8b8bc, roughness: 0.25, metalness: 0.9 }),
    paper: new THREE.MeshStandardMaterial({ map: scriptTexture(), roughness: 0.9 }),
    button: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3 }),
  };

  const J = (name, parent, x = 0, y = 0, z = 0) => {
    const o = new THREE.Group(); o.name = name; o.rotation.order = 'YXZ'; o.position.set(x, y, z); parent?.add(o); return o;
  };

  const root = J('root');
  const hips = J('hips', root, 0, 1.0, 0);
  const spine = J('spine', hips, 0, 0.12, 0);
  const chest = J('chest', spine, 0, 0.20, 0);
  const neck = J('neck', chest, 0, 0.14, -0.005);
  const head = J('head', neck, 0, 0.10, 0.0);

  /* ---------------- torso / jacket ---------------- */
  const torsoGeo = new THREE.LatheGeometry(TORSO.map(([r, y]) => new THREE.Vector2(r, y)), 48);
  torsoGeo.scale(TORSO_SX, 1, TORSO_SZ);
  const torso = mesh(torsoGeo, mat.jacket, chest);

  // shoulder caps smooth the jacket into the sleeves
  for (const s of [-1, 1]) {
    const cap = mesh(new THREE.SphereGeometry(0.046, 24, 16), mat.jacket, chest);
    cap.position.set(s * 0.15, 0.062, -0.006);
    cap.scale.set(0.95, 0.7, 1.0);
  }

  // turtleneck V between the lapels, wrapped on the torso surface
  const vShape = new THREE.Shape();
  vShape.moveTo(-0.06, 0.112); vShape.lineTo(0.06, 0.112); vShape.lineTo(0.0, -0.17); vShape.closePath();
  mesh(wrapToTorso(new THREE.ShapeGeometry(vShape, 12), 0.0015), mat.knit, chest);

  // lapels: notched strips on each side of the V
  for (const s of [-1, 1]) {
    const l = new THREE.Shape();
    l.moveTo(s * 0.058, 0.112); l.lineTo(s * 0.085, 0.104); l.lineTo(s * 0.105, 0.045);
    l.lineTo(s * 0.085, 0.032); l.lineTo(s * 0.095, 0.01); l.lineTo(s * 0.024, -0.17); l.lineTo(s * 0.0, -0.17);
    l.closePath();
    const g = wrapToTorso(new THREE.ShapeGeometry(l, 16), 0.004);
    mesh(g, mat.lapel, chest);
  }
  // buttons
  for (const y of [-0.21, -0.30]) {
    const b = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.004, 16), mat.button, chest);
    const p = torsoSurface(0.012, y, 0.004);
    b.position.copy(p); b.rotation.x = Math.PI / 2;
  }

  /* ---------------- neck + collar ---------------- */
  const neckMesh = mesh(new THREE.CylinderGeometry(0.043, 0.048, 0.14, 24), mat.neck, neck);
  neckMesh.position.set(0, 0.06, -0.012);
  const collar = mesh(new THREE.CylinderGeometry(0.053, 0.066, 0.1, 32, 1, true), mat.knit, neck);
  collar.position.set(0, 0.008, 0.004);
  const fold = mesh(new THREE.TorusGeometry(0.053, 0.012, 10, 36), mat.knit, neck);
  fold.rotation.x = Math.PI / 2; fold.position.set(0, 0.055, 0.004);

  /* ---------------- headset round the neck ---------------- */
  const band = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.066, 0.138, 0.05), new THREE.Vector3(-0.078, 0.16, -0.01),
    new THREE.Vector3(0, 0.185, -0.07), new THREE.Vector3(0.078, 0.16, -0.01), new THREE.Vector3(0.066, 0.138, 0.05),
  ]);
  mesh(new THREE.TubeGeometry(band, 40, 0.0055, 10), mat.headset, chest);
  for (const s of [-1, 1]) {
    const cup = new THREE.Group();
    cup.position.set(s * 0.07, 0.128, 0.068);
    cup.rotation.set(-1.15, 0, s * 0.35);
    chest.add(cup);
    mesh(new THREE.CylinderGeometry(0.03, 0.032, 0.022, 28), mat.headset, cup);
    mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 24), mat.cushion, cup).position.y = -0.014;
  }
  const cable = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.075, 0.11, 0.08), new THREE.Vector3(0.09, 0.0, 0.118), new THREE.Vector3(0.085, -0.12, 0.118),
  ]);
  mesh(new THREE.TubeGeometry(cable, 20, 0.0025, 6), mat.cushion, chest);

  /* ---------------- head: 3D face + skull + hair ---------------- */
  const faceRig = new THREE.Group();
  // Place so the chin sits just above the collar
  faceRig.position.y = -face.chinY - 0.058;
  head.add(faceRig);
  faceRig.add(face.mesh);

  // skull/back of head: half-ellipsoid behind the face surface
  const skullH = face.headTopY - face.chinY;
  const skull = mesh(new THREE.SphereGeometry(1, 40, 24, Math.PI, Math.PI, 0, Math.PI), mat.hair, faceRig); // back half (z ≤ 0)
  skull.scale.set(face.headHalfW * 0.93, skullH * 0.5 * 0.94, 0.105);
  skull.position.set(face.headCenterX, face.chinY + skullH * 0.52, -0.002);

  /* ---------------- arms ---------------- */
  const arm = (side) => {
    const s = side === 'L' ? 1 : -1;
    const shoulder = J('shoulder' + side, chest, s * 0.152, 0.068, -0.008);
    const upper = mesh(new THREE.CapsuleGeometry(0.041, 0.22, 8, 20), mat.jacket, shoulder);
    upper.position.y = -0.145;
    const elbow = J('elbow' + side, shoulder, 0, -0.285, 0);
    const fore = mesh(new THREE.CapsuleGeometry(0.035, 0.2, 8, 20), mat.jacket, elbow);
    fore.position.y = -0.125;
    const cuff = mesh(new THREE.CylinderGeometry(0.031, 0.034, 0.02, 20), mat.knit, elbow);
    cuff.position.y = -0.245;
    const wrist = J('wrist' + side, elbow, 0, -0.255, 0);
    buildHand(wrist, mat.skin, s);
    return { shoulder, elbow, wrist };
  };
  const L = arm('L'), R = arm('R');

  root.traverse((o) => { if (o.isMesh && o !== face.mesh) { o.castShadow = true; o.receiveShadow = true; } });

  const joints = { root, hips, spine, chest, neck, head, shoulderL: L.shoulder, elbowL: L.elbow, wristL: L.wrist, shoulderR: R.shoulder, elbowR: R.elbow, wristR: R.wrist };
  const rest = {};
  setRestPose(joints);
  attachClipboard(L.wrist, root, mat);
  for (const [k, j] of Object.entries(joints)) rest[k] = { pos: j.position.clone(), rot: j.rotation.clone() };

  return { root, joints, rest, face, faceUniforms: face.uniforms, headWorld: () => face.mesh.getWorldPosition(new THREE.Vector3()) };
}

/* Default pose: relaxed, clipboard hugged against the body on the left forearm. */
function setRestPose(j) {
  j.shoulderL.rotation.set(-0.08, 0.0, 0.08);
  j.elbowL.rotation.set(-1.2, -0.85, 0.0);
  j.wristL.rotation.set(0.0, 0.0, -0.15);
  j.shoulderR.rotation.set(0.04, 0.0, -0.035);
  j.elbowR.rotation.set(-0.22, 0.0, 0.0);
  j.wristR.rotation.set(0.0, 0.4, 0.0);
}

/* Clipboard: posed in world space (upright, facing out, resting on the
   forearm), then re-parented to the wrist so it moves with the hand. */
function attachClipboard(wrist, root, mat) {
  root.updateMatrixWorld(true);
  const clip = new THREE.Group();
  mesh(new RoundedBoxGeometry(0.235, 0.315, 0.007, 2, 0.008), mat.board, clip);
  const paper = mesh(new THREE.PlaneGeometry(0.215, 0.28), mat.paper, clip);
  paper.position.set(0, -0.012, 0.0042);
  const clamp = mesh(new RoundedBoxGeometry(0.09, 0.03, 0.014, 2, 0.004), mat.metal, clip);
  clamp.position.set(0, 0.145, 0.006);
  const hand = wrist.getWorldPosition(new THREE.Vector3());
  clip.position.set(hand.x - 0.03, hand.y + 0.06, hand.z + 0.035);
  clip.rotation.set(-0.42, 0.55, 0.12);
  clip.scale.setScalar(0.9);
  root.add(clip);
  clip.updateMatrixWorld(true);
  wrist.attach(clip);
}

/* ---------------------------------------------------------------------- */
function buildHand(wrist, m, s) {
  const hand = new THREE.Group();
  wrist.add(hand);
  const palm = mesh(new RoundedBoxGeometry(0.068, 0.082, 0.026, 3, 0.012), m, hand);
  palm.position.y = -0.045;
  const fingerLen = [0.048, 0.055, 0.052, 0.042];
  fingerLen.forEach((len, i) => {
    const f = new THREE.Group();
    f.position.set((i - 1.5) * 0.017 * -s, -0.086, 0.0);
    f.rotation.x = 0.35 + i * 0.05;
    hand.add(f);
    mesh(new THREE.CapsuleGeometry(0.0082, len * 0.55, 4, 10), m, f).position.y = -len * 0.32;
    const tip = new THREE.Group(); tip.position.y = -len * 0.6; tip.rotation.x = 0.35; f.add(tip);
    mesh(new THREE.CapsuleGeometry(0.0075, len * 0.35, 4, 10), m, tip).position.y = -len * 0.2;
  });
  const thumb = new THREE.Group();
  thumb.position.set(0.034 * -s, -0.035, 0.008);
  thumb.rotation.set(0.4, 0, s * -0.7);
  hand.add(thumb);
  mesh(new THREE.CapsuleGeometry(0.0095, 0.035, 4, 10), m, thumb).position.y = -0.024;
  return hand;
}

/* Wrap a flat shape (x,y in chest space) onto the front of the torso. */
function wrapToTorso(geo, offset) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = torsoSurface(p.getX(i), p.getY(i), offset);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
function torsoSurface(x, y, offset) {
  let r = TORSO[1][0];
  for (let i = 1; i < TORSO.length - 1; i++) {
    const [r0, y0] = TORSO[i], [r1, y1] = TORSO[i + 1];
    if (y >= y0 && y <= y1) { r = r0 + (r1 - r0) * ((y - y0) / (y1 - y0 || 1)); break; }
  }
  const rx = r * TORSO_SX, rz = r * TORSO_SZ;
  const t = Math.min(0.999, Math.abs(x) / rx);
  return new THREE.Vector3(x, y, rz * Math.sqrt(1 - t * t) + offset);
}

function mesh(geo, material, parent) {
  const m = new THREE.Mesh(geo, material);
  parent?.add(m);
  return m;
}

function scriptTexture() {
  const c = document.createElement('canvas');
  c.width = 384; c.height = 500;
  const g = c.getContext('2d');
  g.fillStyle = '#ece6da'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#222';
  g.font = 'italic 30px Georgia, serif';
  g.fillText('You on the Moors Now', 30, 70);
  g.font = '15px Helvetica, Arial, sans-serif';
  g.fillStyle = '#555';
  g.fillText('DIRECTOR’S NOTES · ACT ONE', 30, 100);
  g.strokeStyle = 'rgba(0,0,0,.18)';
  for (let y = 135; y < 480; y += 22) {
    g.beginPath(); g.moveTo(30, y); g.lineTo(30 + 250 + Math.sin(y) * 70, y); g.stroke();
  }
  g.strokeStyle = 'rgba(160,30,30,.55)'; g.lineWidth = 2;
  g.beginPath(); g.ellipse(250, 245, 60, 18, -0.1, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
