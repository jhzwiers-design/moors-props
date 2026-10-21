/* ==========================================================================
   ANIMATION — the director's behaviour.

   Each frame:  tracking target → eyes (fast) → head (slower) → body (slowest)
   plus idle life (breathing, blinking, glances, posture shifts) and
   speech life (visemes, jaw, brows, nods, hand gestures).
   All angles are in degrees until applied to the rig.
   ========================================================================== */
import { CONFIG, TRACKING_CONFIG as TC, INTERACTION_CONFIG as IC } from './config.js';

const M = CONFIG.motion;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const map = (v, a, b, c, d) => c + ((v - a) / (b - a)) * (d - c);
const lerpK = (s, dt) => 1 - Math.pow(1 - s, dt * 60);       // frame-rate independent lerp factor
const ease = (x) => x * x * (3 - 2 * x);
// Viewer velocity (frame-widths/s) → amplified velocity; ignores landmark jitter below velocityDeadZone
const velocity = (v = 0) => {
  const m = Math.abs(v) - TC.velocityDeadZone;
  return m > 0 ? Math.sign(v) * m * TC.sensitivity * 2 : 0;
};
// Viewer position 0..1 → amplified offset -1..1 (tiny dead zone, sensitivity gain, clamped)
const amplify = (v) => {
  let d = v - 0.5;
  d = Math.abs(d) < TC.deadZone ? 0 : d - Math.sign(d) * TC.deadZone;
  return (clamp(0.5 + d * TC.sensitivity, 0, 1) - 0.5) * 2;
};

/* Arm poses added on top of the rest pose (radians). R = right hand (free), L = clipboard hand. */
const GESTURES = {
  open:    { dur: 1.7, R: { shoulder: [-0.38, 0.0, -0.10], elbow: [-1.05, 0.30, 0], wrist: [0.15, -1.15, 0.0] } },
  present: { dur: 2.2, R: { shoulder: [-0.42, 0.10, -0.42], elbow: [-0.85, 0.15, 0], wrist: [0.2, -1.35, 0.25] } },
  chest:   { dur: 1.6, R: { shoulder: [-0.35, 0.25, 0.10], elbow: [-1.75, 0.55, 0], wrist: [0.25, -0.2, 0.0] } },
  point:   { dur: 2.0, R: { shoulder: [-0.32, 0.0, -0.30], elbow: [-0.55, 0.1, 0], wrist: [0.45, -0.6, 0.0] } },
  small:   { dur: 1.2, R: { shoulder: [-0.18, 0.0, -0.05], elbow: [-0.65, 0.2, 0], wrist: [0.1, -0.8, 0.0] } },
  script:  { dur: 1.8, L: { shoulder: [-0.12, 0, 0.02], elbow: [-0.18, 0.05, 0], wrist: [0.1, 0, 0] }, glance: [9, -16] },
};
const GESTURE_RULES = [
  [/^Welcome to/i, 'open'], [/so glad/i, 'chest'], [/turns them completely/i, 'present'],
  [/I invite you/i, 'open'], [/Throughout this space/i, 'present'], [/Take some time/i, 'small'],
  [/bottom of the stairs/i, 'point'], [/another way/i, 'open'], [/look around/i, 'present'],
  [/Thank you/i, 'chest'], [/doesn’t begin|semester/i, 'script'],
];

export class Animator {
  constructor(character) {
    this.c = character;
    this.u = character.faceUniforms;
    const f = character.face.features;
    this.eyeHalfW = (f.eyeA.rx + f.eyeB.rx) / 2;     // iris travel is a fraction of this
    for (const j of Object.values(character.joints)) j.rotation.order = 'YXZ';

    this.head = { yaw: 0, pitch: 0, roll: 0 };
    this.eyes = { yaw: 0, pitch: 0 };
    this.shoulders = { yaw: 0, pitch: 0 };
    this.torso = { yaw: 0 };
    this.hadFace = false;
    this.attentionUntil = 0;
    this.look = { x: 0, y: 0 };
    this.lookBack = { until: 0, next: 0 };              // glances back at the viewer while she watches a prop                         // amplified viewer position, -1..1 (reused)
    this.wander = { yaw: 0, pitch: 0, next: 0 };
    this.glance = { yaw: 0, pitch: 0, until: 0, next: performance.now() + rand(...M.glanceAwayEveryMs) };
    this.glanceCur = { yaw: 0, pitch: 0 };
    this.micro = { yaw: 0, pitch: 0, next: 0 };
    this.blink = { start: -1, next: performance.now() + 1500, double: false };
    this.brow = { a: 0, b: 0, target: 0, until: 0 };
    this.mouth = { open: 0, wide: 0, round: 0, smile: 0 };
    this.nod = { x: 0, v: 0 };
    this.lift = 0;
    this.posture = { next: 0, rz: 0, ry: 0, px: 0, cur: { rz: 0, ry: 0, px: 0 } };
    this.gesture = null;
    this.gestureCur = { R: zeroArm(), L: zeroArm() };
    this.smileBoost = 0;
    this.prevTarget = { yaw: 0, pitch: 0 };
  }

  /* ---------- events from main / speech ---------- */
  _attention(now) {
    this.attentionUntil = now + TC.attentionMs;
    this.notice();
  }
  /** Someone picked up a prop: a pleased, interested reaction. */
  delight() {
    this.smileBoost = 1;
    this.brow.target = 0.7; this.brow.until = performance.now() + 700;
  }
  /** A prop flew at her: blink, brows up, head pulls back. */
  flinch() {
    this.blink.start = -1; this.triggerBlink(false);
    this.brow.target = 1; this.brow.until = performance.now() + 600;
    this.nod.v += 55;
  }
  notice() {
    this.brow.target = 0.85; this.brow.until = performance.now() + 900;
    this.triggerBlink();
    this.lift = 1;
    this.smileBoost = 1;
  }
  onSentence(text) {
    for (const [re, g] of GESTURE_RULES) if (re.test(text)) return this.playGesture(g, 250);
    if (Math.random() < 0.35) this.playGesture('small', 400);
  }
  onWord(word) {
    const w = word.replace(/[^A-Za-z’']/g, '');
    if (w.length >= 6 && Math.random() < 0.3) {
      this.brow.target = rand(0.35, 0.65); this.brow.until = performance.now() + 380;
      this.nod.v -= rand(14, 26);                // small downward nod on stressed words
    } else if (Math.random() < 0.12) {
      this.nod.v += rand(-10, 10);
    }
  }
  playGesture(name, delay = 0) {
    const g = GESTURES[name];
    if (!g) return;
    this.gesture = { g, start: performance.now() + delay };
    if (g.glance) {
      this.glance.yaw = g.glance[0]; this.glance.pitch = g.glance[1];
      this.glance.until = this.gesture.start + 900;
    }
  }
  triggerBlink(double = Math.random() < 0.15) {
    const now = performance.now();
    if (this.blink.start > 0 && now - this.blink.start < 300) return;
    this.blink.start = now; this.blink.double = double;
    this.blink.next = now + rand(...M.blinkEveryMs);
  }

  /* ---------- per frame ---------- */
  update(dt, t, { viewer, attending, speaking, viseme, focus = null, headPos = null }) {
    const now = performance.now();
    const J = this.c.joints, rest = this.c.rest;

    // 1. VIEWER TRACKING (highest priority). Degrees; yaw + = toward screen-right, pitch + = up.
    const tracking = !!viewer?.faceDetected;
    if (tracking && !this.hadFace) this._attention(now);   // NO FACE → FACE: "I noticed you"
    this.hadFace = tracking;
    const attention = now < this.attentionUntil;
    const boost = attention ? TC.attentionBoost : 1;

    // A focus point (a prop or the viewer's hand, in world space) outranks the viewer's face,
    // except for short glances back at the viewer so she still "sees" them.
    let focusing = !!(focus && headPos);
    if (focusing && tracking) {
      if (now > this.lookBack.next) {
        this.lookBack.until = now + rand(...IC.lookBackMs);
        this.lookBack.next = now + rand(...IC.lookBackEveryMs);
      }
      if (now < this.lookBack.until) focusing = false;
    } else if (!focusing) {
      this.lookBack.next = Math.max(this.lookBack.next, now + 1500);
    }
    const engaged = tracking || focusing;

    let eyeYawT, eyePitchT, headYawT, headPitchT, rollT;
    if (focusing) {
      // True 3D look angles from her head to the object
      const dx = focus.x - headPos.x, dy = focus.y - headPos.y, dz = Math.max(0.05, focus.z - headPos.z);
      eyeYawT = clamp(Math.atan2(dx, dz) * R2D, -55, 55);
      eyePitchT = clamp(Math.atan2(dy, Math.hypot(dx, dz)) * R2D, -45, 30);
      headYawT = eyeYawT * TC.headFollow;
      headPitchT = eyePitchT * TC.headFollow * 0.85;
      rollT = -clamp(headYawT / TC.maxHeadYaw, -1, 1) * TC.maxHeadRoll * 0.6;
    } else if (tracking) {
      // Amplify the offset from frame centre, then add velocity look-ahead (anticipation)
      const ax = amplify(viewer.x), ay = amplify(viewer.y);
      const vx = velocity(viewer.vx), vy = velocity(viewer.vy);
      const L = TC.maxLead;
      const eyeX = clamp(ax + clamp(vx * TC.anticipation * 1.5, -L, L), -1.2, 1.2);
      const eyeY = clamp(ay + clamp(vy * TC.anticipation * 1.5, -L, L), -1.2, 1.2);
      const headX = clamp(ax + clamp(vx * (TC.anticipation + TC.overshoot), -L, L), -1.15, 1.15);
      const headY = clamp(ay + clamp(vy * (TC.anticipation + TC.overshoot), -L, L), -1.15, 1.15);
      this.look.x = ax; this.look.y = ay;

      // Eyes aim straight at the viewer; the head carries most (headFollow) of that turn
      eyeYawT = eyeX * TC.maxHeadYaw;
      eyePitchT = -eyeY * TC.maxHeadPitch;
      headYawT = headX * TC.maxHeadYaw * TC.headFollow;
      headPitchT = -headY * TC.maxHeadPitch * TC.headFollow;
      rollT = -headX * TC.maxHeadRoll * 0.6;
    } else {
      this.look.x = 0; this.look.y = 0;
      if (!attending && now > this.wander.next) {          // nobody there: look around the room
        const rest = Math.random() < 0.3;
        this.wander.yaw = rest ? 0 : rand(-9, 9);
        this.wander.pitch = rest ? 0 : rand(-6, 2.5);
        this.wander.next = now + rand(2500, 6500);
      }
      eyeYawT = attending ? 0 : this.wander.yaw;
      eyePitchT = attending ? 0 : this.wander.pitch;
      headYawT = eyeYawT * 0.75; headPitchT = eyePitchT * 0.75; rollT = 0;
    }

    // Big jumps in where she looks get a refocus blink
    if (Math.hypot(eyeYawT - this.prevTarget.yaw, eyePitchT - this.prevTarget.pitch) > 14 && Math.random() < 0.5) this.triggerBlink(false);
    this.prevTarget.yaw = eyeYawT; this.prevTarget.pitch = eyePitchT;

    // 2. Glances away happen only when nobody is being tracked (idle never fights tracking).
    //    Scripted glances (e.g. at the clipboard) still play, but shorter and weaker while tracking.
    if (!engaged && attending && now > this.glance.next) {
      const toScript = Math.random() < 0.35;
      this.glance.yaw = toScript ? 9 : rand(-14, 14);
      this.glance.pitch = toScript ? -16 : rand(-6, 4);
      this.glance.until = now + rand(500, speaking ? 900 : 1400);
      this.glance.next = now + rand(...M.glanceAwayEveryMs) * (speaking ? 1.4 : 1);
    }
    const glancing = now < this.glance.until;
    const gw = engaged ? 0.45 : 1;
    const gk = lerpK(glancing ? 0.25 : 0.2, dt);
    this.glanceCur.yaw += ((glancing ? this.glance.yaw * gw : 0) - this.glanceCur.yaw) * gk;
    this.glanceCur.pitch += ((glancing ? this.glance.pitch * gw : 0) - this.glanceCur.pitch) * gk;

    // 3. Micro-saccades (lowest priority, tiny)
    if (now > this.micro.next) {
      const a = engaged ? 0.5 : 0.9;
      this.micro.yaw = rand(-a, a); this.micro.pitch = rand(-a, a) * 0.6;
      this.micro.next = now + rand(400, 1600);
    }

    // 4. EYES react first and fastest
    const ek = lerpK(Math.min(0.92, TC.eyeSmoothing * boost), dt);
    this.eyes.yaw += (eyeYawT + this.glanceCur.yaw + this.micro.yaw - this.eyes.yaw) * ek;
    this.eyes.pitch += (eyePitchT + this.glanceCur.pitch + this.micro.pitch - this.eyes.pitch) * ek;

    // 5. HEAD follows a beat later (velocity lead in its target gives anticipation + overshoot)
    this.lift *= Math.exp(-dt * 2.2);
    this.nod.v += (-this.nod.x * 90 - this.nod.v * 12) * dt;      // nod spring
    this.nod.x += this.nod.v * dt;
    const idleW = engaged ? 0.35 : 1;                            // idle drift stays under tracking
    const sway = speaking ? Math.sin(t * 0.9) * 1.3 * idleW : 0;
    const idleYaw = (Math.sin(t * 0.37) * 0.7 + Math.sin(t * 0.83) * 0.3) * idleW;
    const idlePitch = Math.sin(t * 0.29 + 1) * 0.5 * idleW;
    const idleRoll = Math.sin(t * 0.21) * 0.8 * idleW;
    const hYaw = clamp(headYawT + this.glanceCur.yaw * 0.45 + idleYaw + sway, -TC.maxHeadYaw, TC.maxHeadYaw);
    const hPitch = clamp(headPitchT + this.glanceCur.pitch * 0.4 + idlePitch + this.nod.x + this.lift * 3, -TC.maxHeadPitch, TC.maxHeadPitch);
    const hRoll = clamp(rollT + idleRoll + (speaking ? Math.sin(t * 0.7) * 0.8 : 0), -TC.maxHeadRoll, TC.maxHeadRoll);
    const hk = lerpK(Math.min(0.9, TC.headSmoothing * boost), dt);
    this.head.yaw += (hYaw - this.head.yaw) * hk;
    this.head.pitch += (hPitch - this.head.pitch) * hk;
    this.head.roll += (hRoll - this.head.roll) * hk;

    // 6. SHOULDERS then TORSO follow the head (secondary motion)
    const sk = lerpK(TC.shoulderSmoothing * boost, dt);
    this.shoulders.yaw += (this.head.yaw * TC.shoulderFollow - this.shoulders.yaw) * sk;
    this.shoulders.pitch += (this.head.pitch * TC.shoulderFollow * 0.3 - this.shoulders.pitch) * sk;
    const tk = lerpK(TC.torsoSmoothing * boost, dt);
    this.torso.yaw += (this.head.yaw * TC.torsoFollow - this.torso.yaw) * tk;

    // 7. Posture shifts every so often
    if (now > this.posture.next) {
      this.posture.rz = rand(-0.018, 0.018); this.posture.ry = rand(-0.035, 0.035); this.posture.px = rand(-0.01, 0.01);
      this.posture.next = now + rand(9000, 16000);
    }
    const pk = 1 - Math.exp(-dt * 0.7);
    for (const k of ['rz', 'ry', 'px']) this.posture.cur[k] += (this.posture[k] - this.posture.cur[k]) * pk;

    // 8. Breathing
    const breathRate = speaking ? 1 / 3.4 : 1 / 4.6;
    const br = Math.sin(t * Math.PI * 2 * breathRate);

    /* ---- apply to the rig ---- */
    const set = (j, r, x = 0, y = 0, z = 0) => j.rotation.set(rest[r].rot.x + x, rest[r].rot.y + y, rest[r].rot.z + z);
    J.hips.position.x = rest.hips.pos.x + this.posture.cur.px;
    set(J.hips, 'hips', 0, this.posture.cur.ry, this.posture.cur.rz);
    // Rig is hierarchical, so each joint gets its share relative to its parent.
    const lean = attention ? 0.03 : 0;                              // tiny lean in on noticing
    set(J.spine, 'spine', -br * 0.006 + lean, this.torso.yaw * D2R, -this.posture.cur.rz * 0.6);
    set(J.chest, 'chest', -br * 0.01 - this.shoulders.pitch * D2R, (this.shoulders.yaw - this.torso.yaw) * D2R, -this.shoulders.yaw * D2R * 0.08);
    J.chest.position.y = rest.chest.pos.y + br * 0.0022;
    J.chest.scale.set(1 + br * 0.006, 1, 1 + br * 0.012);

    const hy = this.head.yaw - this.shoulders.yaw, hp = this.head.pitch - this.shoulders.pitch, hr = this.head.roll;
    set(J.neck, 'neck', -hp * M.neckShare * D2R, hy * M.neckShare * D2R, hr * M.neckShare * D2R);
    set(J.head, 'head', -hp * (1 - M.neckShare) * D2R, hy * (1 - M.neckShare) * D2R, hr * (1 - M.neckShare) * D2R);

    // Arms + gestures
    this._gestures(now, dt);
    const gR = this.gestureCur.R, gL = this.gestureCur.L;
    const sh = br * 0.012;
    set(J.shoulderR, 'shoulderR', gR.shoulder[0], gR.shoulder[1], gR.shoulder[2] - sh * 0.5);
    set(J.elbowR, 'elbowR', gR.elbow[0] + Math.sin(t * 0.5) * 0.02, gR.elbow[1], gR.elbow[2]);
    set(J.wristR, 'wristR', gR.wrist[0], gR.wrist[1], gR.wrist[2]);
    set(J.shoulderL, 'shoulderL', gL.shoulder[0] + Math.sin(t * 0.4) * 0.01, gL.shoulder[1], gL.shoulder[2] + sh * 0.5);
    set(J.elbowL, 'elbowL', gL.elbow[0], gL.elbow[1], gL.elbow[2]);
    set(J.wristL, 'wristL', gL.wrist[0], gL.wrist[1], gL.wrist[2]);

    /* ---- face ---- */
    // Eye-in-head angle → iris travel. Big while the head is still catching up (eyes lead),
    // and a residual offset remains once settled, so the eyes are never pinned to centre.
    const ey = clamp((this.eyes.yaw - this.head.yaw) / TC.eyeRangeDeg, -1, 1);
    const ep = clamp((this.eyes.pitch - this.head.pitch) / TC.eyeRangeDeg, -1, 1);
    this.u.uGaze.value.set(ey * TC.maxEyeYaw * this.eyeHalfW, -ep * TC.maxEyePitch * this.eyeHalfW);

    // blink
    let b = 0;
    if (now > this.blink.next) this.triggerBlink();
    if (this.blink.start > 0) {
      const e = (now - this.blink.start) / 1000;
      const one = (x) => (x < 0 ? 0 : x < 0.075 ? ease(x / 0.075) : x < 0.1 ? 1 : x < 0.25 ? 1 - ease((x - 0.1) / 0.15) : 0);
      b = Math.max(one(e), this.blink.double ? one(e - 0.28) : 0);
      if (e > 0.6) this.blink.start = -1;
    }
    const lidDrop = clamp(-this.eyes.pitch / 16, 0, 1) * 0.45;
    // mouth
    const mk = 1 - Math.exp(-dt * 20);
    this.smileBoost *= Math.exp(-dt * 0.8);
    const v = speaking ? viseme : { open: 0, wide: 0, round: 0, smile: 0 };
    const chatter = speaking && v.open > 0.05 ? Math.sin(t * 13.0) * 0.07 : 0;
    this.mouth.open += (clamp(v.open + chatter, 0, 1) - this.mouth.open) * mk;
    this.mouth.wide += (v.wide - this.mouth.wide) * mk;
    this.mouth.round += (v.round - this.mouth.round) * mk;
    const smileT = Math.max(v.smile, this.smileBoost * 0.5, 0.08);
    this.mouth.smile += (smileT - this.mouth.smile) * (1 - Math.exp(-dt * 6));
    const squint = this.mouth.smile * 0.1;
    this.u.uBlink.value.set(Math.max(b, lidDrop + squint), Math.max(b, lidDrop + squint));
    this.u.uMouth.value.set(this.mouth.open, this.mouth.wide, this.mouth.round, this.mouth.smile);
    this.u.uJaw.value = this.mouth.open * 0.9;

    // brows
    if (now > this.brow.until) this.brow.target = clamp(this.eyes.pitch / 20, 0, 0.3);
    const bk2 = 1 - Math.exp(-dt * 9);
    this.brow.a += (this.brow.target - this.brow.a) * bk2;
    this.brow.b += (this.brow.target * 0.9 - this.brow.b) * bk2;
    this.u.uBrow.value.set(this.brow.a, this.brow.b);
  }

  _gestures(now, dt) {
    const target = { R: zeroArm(), L: zeroArm() };
    if (this.gesture) {
      const { g, start } = this.gesture;
      const e = (now - start) / 1000;
      const att = 0.55, rel = 0.8;
      let w = 0;
      if (e > 0 && e < att) w = ease(e / att);
      else if (e >= att && e < att + g.dur) w = 1;
      else if (e >= att + g.dur && e < att + g.dur + rel) w = 1 - ease((e - att - g.dur) / rel);
      else if (e >= att + g.dur + rel) this.gesture = null;
      for (const side of ['R', 'L']) {
        if (!g[side]) continue;
        for (const part of ['shoulder', 'elbow', 'wrist']) {
          const wobble = side === 'R' ? Math.sin(e * 2.4) * 0.06 * w : 0;
          for (let i = 0; i < 3; i++) target[side][part][i] = g[side][part][i] * w + (i === 0 ? wobble : 0);
        }
      }
    }
    const k = 1 - Math.exp(-dt * 10);
    for (const side of ['R', 'L']) for (const part of ['shoulder', 'elbow', 'wrist']) {
      for (let i = 0; i < 3; i++) this.gestureCur[side][part][i] += (target[side][part][i] - this.gestureCur[side][part][i]) * k;
    }
  }
}

function zeroArm() { return { shoulder: [0, 0, 0], elbow: [0, 0, 0], wrist: [0, 0, 0] }; }
