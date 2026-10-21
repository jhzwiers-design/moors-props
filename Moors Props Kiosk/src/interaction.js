/* ==========================================================================
   INTERACTION — the viewer's hands on stage.

   Each tracked hand (or a mouse / touch, as a fallback) becomes:
     · a glowing cursor + faint hand skeleton on a plane between the viewer
       and the director, so people can see the camera following them
     · a small warm light that lights the props and the director
   Pinch over a prop to grab it, move it, open the hand to throw it.
   An open-hand swipe pushes props. Released props tumble under gentle
   gravity, bounce off the frame edges and the director, then float home.

   update() returns the point the director should be watching (when she is enabled).
   ========================================================================== */
import * as THREE from 'three';
import { INTERACTION_CONFIG as IC } from './config.js';
import { PROP_LIST, glowTex } from './props.js';
import { Effects } from './effects.js';

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20]];

export class Interaction {
  constructor(stage, character) {
    this.scene = stage.scene;
    this.camera = stage.camera;
    this.effects = new Effects(stage.scene, stage.renderer, stage.camera);
    // one shared warm light that follows the active hand (one light is far cheaper than one per hand)
    this.handLight = new THREE.PointLight(0xffc890, 0, 1.0, 2);
    this.scene.add(this.handLight);
    this.spotlight = { x: 0.5, y: 0.5, amount: 0 };   // where to focus the emphasis vignette (screen 0..1)
    this._proj = new THREE.Vector3();
    this._react = {                                    // reused every frame for prop reactions
      hold: 0, speed: 0, vel: null, dt: 0, t: 0, scene: stage.scene,
      emit: (kind, pos, n, vel, spread) => this.effects.emit(kind, pos, n, vel, spread),
      makeTrail: (opts) => this.effects.makeTrail(opts),
      prop: null,      // the prop's physics state (pos, vel, releasedAt…) for props that need it
    };
    this.character = character;
    this.focus = new THREE.Vector3();
    this.events = [];
    this.everGrabbed = false;
    this.cueTarget = null;     // name of the prop the current cue asks for (set by cues.js)
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._n = new THREE.Vector3();
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
    this.headPos = new THREE.Vector3(); this.chestPos = new THREE.Vector3();
    this.lastFlinch = 0;

    this.props = PROP_LIST.map((def, i) => {
      const group = new THREE.Group();
      const model = def.build();
      group.add(model);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffd8a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      halo.scale.setScalar(def.radius * 4.2);
      halo.renderOrder = -1;
      group.add(halo);
      group.scale.setScalar(def.scale);
      this.scene.add(group);
      const z = IC.handPlaneZ + (i % 2 ? 0.04 : -0.04);
      return {
        def, group, model, halo, z, radius: def.radius * def.scale,
        pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), home: new THREE.Vector3(),
        spin: new THREE.Vector3(), tilt: new THREE.Euler(), heldBy: null, hover: 0, hold: 0, near: 0, releasedAt: -1e9, phase: Math.random() * 6.28,
      };
    });
    this._placeHomes(true);
    window.addEventListener('resize', () => this._placeHomes(false));

    this.hands = new Map();        // id → state
    this.visuals = [0, 1, 2].map(() => this._makeHandVisual());
  }

  /* ---------------- screen ↔ world ---------------- */
  screenToPlane(sx, sy, z, out) {
    const cam = this.camera;
    out.set(sx * 2 - 1, -(sy * 2 - 1), 0.5).unproject(cam);
    this._d.copy(out).sub(cam.position);
    const t = (z - cam.position.z) / this._d.z;
    return out.copy(cam.position).addScaledVector(this._d, t);
  }
  _placeHomes(snap) {
    if (!window.innerWidth || !window.innerHeight) return;   // hidden window: wait for a real size
    this.camera.updateMatrixWorld();
    for (const p of this.props) {
      this.screenToPlane(p.def.home[0], p.def.home[1], p.z, p.home);
      if (snap) { p.pos.copy(p.home); p.prev.copy(p.home); }
    }
  }

  /* ---------------- hand visuals ---------------- */
  _makeHandVisual() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffdcaa, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0025, 8, 40), mat);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(0.12);
    const pos = new Float32Array(BONES.length * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffe2b8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    const jpos = new Float32Array(21 * 3);
    const jGeo = new THREE.BufferGeometry();
    jGeo.setAttribute('position', new THREE.BufferAttribute(jpos, 3));
    const joints = new THREE.Points(jGeo, new THREE.PointsMaterial({ map: glowTex(), color: 0xffe2b8, size: 0.032, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    lines.frustumCulled = joints.frustumCulled = false;
    this.scene.add(ring, glow, lines, joints);
    return { ring, glow, lines, joints, jpos, pos, alpha: 0, skel: 0, used: false, smoothed: new Float32Array(42), primed: false };
  }

  /** Put every prop back on its spot and forget all hands. */
  reset() {
    for (const p of this.props) {
      p.pos.copy(p.home); p.prev.copy(p.home); p.vel.set(0, 0, 0); p.spin.set(0, 0, 0); p.tilt.set(0, 0, 0);
      p.heldBy = null; p.hover = 0; p.near = 0; p.releasedAt = -1e9;
    }
    this.hands.clear();
  }

  /* ---------------- per frame ---------------- */
  /**
   * @param hands  array of { id, present, sx, sy, pinch, pinchAmount, pts|null }
   * @returns world-space point to look at, or null
   */
  update(dt, t, hands) {
    const now = performance.now();
    this.events.length = 0;
    if (this.character) {
      this.character.face.mesh.getWorldPosition(this.headPos);
      this.character.joints.chest.getWorldPosition(this.chestPos);
    }
    const kHand = 1 - Math.pow(1 - IC.handSmoothing, dt * 60);

    // ---- hands ----
    let active = null, realHand = null;
    for (const v of this.visuals) v.used = false;
    let vi = 0;
    // a hand that vanished from the input list entirely counts as gone
    for (const [id, st] of this.hands) {
      if (st.present && !hands.some((h) => h.id === id)) { if (st.held) this._release(st, now, 0.4); st.present = false; st.wasPinch = false; }
    }
    for (const h of hands) {
      let s = this.hands.get(h.id);
      if (!h.present) {
        if (s?.held) this._release(s, now, 0.4);
        if (s) { s.present = false; s.wasPinch = false; }
        continue;
      }
      if (!s) {
        s = { world: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), held: null, wasPinch: false, present: false, since: now };
        this.hands.set(h.id, s);
      }
      s.ghost = !!h.ghost;
      this.screenToPlane(h.sx, h.sy, IC.handPlaneZ, this._v);
      if (!Number.isFinite(this._v.x + this._v.y)) continue;      // no valid camera yet (hidden window)
      if (!s.present) { s.world.copy(this._v); s.prev.copy(this._v); s.vel.set(0, 0, 0); s.since = now; this.events.push('hand'); }
      s.present = true;
      // a big jump (tracking dropout, mouse re-entering) teleports instead of sweeping through the props
      if (s.world.distanceTo(this._v) > 0.3) { s.world.copy(this._v); s.vel.set(0, 0, 0); }
      s.prev.copy(s.world);
      s.world.lerp(this._v, kHand);
      this._d.copy(s.world).sub(s.prev).divideScalar(Math.max(dt, 1e-3));
      s.vel.lerp(this._d, 0.35);

      // grab / release
      if (h.pinch && !s.wasPinch) this._tryGrab(s);
      if (!h.pinch && s.wasPinch && s.held) this._release(s, now, IC.throwGain);
      s.wasPinch = h.pinch;

      // open-hand swipe pushes props
      const speed = s.vel.length();
      if (!h.pinch && speed > IC.pushMinSpeed && !this.props.some((p) => p.heldBy)) {
        for (const p of this.props) {
          if (p.heldBy) continue;
          if (p.pos.distanceTo(s.world) < p.radius + 0.07) {
            p.vel.lerp(this._d.copy(s.vel).multiplyScalar(IC.pushGain), 0.5);
            p.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(speed * 6);
            p.releasedAt = now;
            this.events.push('push');
          }
        }
      }
      if (!active || s.held || s.since > active.state.since) active = { state: s, h };
      if (!h.ghost) realHand = s;
      const vis = this.visuals[Math.min(vi++, 2)];
      vis.used = true;
      this._drawHand(vis, s, h, dt);
    }
    for (const v of this.visuals) if (!v.used) this._fadeHand(v, dt);

    // ---- props ----
    for (const p of this.props) p.hover = Math.max(0, p.hover - dt * 4);
    if (active && !active.state.held) {
      let best = null, bd = Infinity;
      for (const p of this.props) {
        const dd = p.pos.distanceTo(active.state.world) - p.radius * 0.5;
        const f = this._grabFactor(p, active.h);
        if (!p.heldBy && f > 0 && dd < IC.hoverRadius * f && dd < bd) { bd = dd; best = p; }
      }
      if (best) best.hover = Math.min(1, best.hover + dt * 10);
    }
    // While someone holds a prop, every other prop stays put so nothing interferes with it
    this.anyHeld = this.props.some((p) => p.heldBy);
    for (const p of this.props) this._stepProp(p, dt, t, now);
    if (!this.anyHeld) this._collideProps();
    this._nearby(dt);
    this.effects.update(dt, t);

    // shared hand light follows the active hand (brighter while pinching)
    const pinchAmt = active ? (active.h.pinchAmount ?? (active.h.pinch ? 1 : 0)) : 0;
    if (active) { this.handLight.position.copy(active.state.world); this.handLight.position.z += 0.08; }
    const lightT = active ? 0.2 + pinchAmt * 0.25 : 0;
    this.handLight.intensity += (lightT - this.handLight.intensity) * (1 - Math.exp(-dt * 6));

    // guide: a line of dots flowing from the visitor's hand to the prop the cue asks for
    this._guide(dt, t, realHand);

    // emphasis: a soft spotlight on the held prop, everything else dims a little
    let held = null;
    for (const p of this.props) if (!held || p.hold > held.hold) held = p;
    if (held && held.hold > 0.01) {
      this._proj.copy(held.pos).project(this.camera);
      this.spotlight.x = (this._proj.x + 1) / 2; this.spotlight.y = (1 - this._proj.y) / 2;
    }
    this.spotlight.amount = held ? held.hold : 0;

    // ---- where should the director look? held prop > hovered prop > a moving prop > the hand ----
    let target = null;
    if (active?.state.held) target = active.state.held.pos;
    if (!target) { let hv = 0.3; for (const p of this.props) if (p.hover > hv) { hv = p.hover; target = p.pos; } }
    if (!target) { let sp = 0.5; for (const p of this.props) { const v = p.vel.length(); if (!p.heldBy && v > sp) { sp = v; target = p.pos; } } }
    if (!target && active) target = active.state.world;
    return target ? this.focus.copy(target) : null;
  }

  _guide(dt, t, hand) {
    if (!this.guide) {
      const n = 14, pos = new Float32Array(n * 3);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.PointsMaterial({ map: glowTex(), color: 0xffd9a0, size: 0.03, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      this.guide = new THREE.Points(g, m); this.guide.frustumCulled = false; this.guide.renderOrder = 6;
      this.guide.userData = { n, pos, alpha: 0 };
      this.scene.add(this.guide);
    }
    const G = this.guide.userData;
    const target = this.cueTarget && this.props.find((p) => p.def.name === this.cueTarget);
    const show = !!(hand && target && !target.heldBy && !hand.held);
    G.alpha += ((show ? 1 : 0) - G.alpha) * (1 - Math.exp(-dt * 5));
    this.guide.material.opacity = G.alpha * 0.8;
    this.guide.visible = G.alpha > 0.01;
    if (!this.guide.visible || !hand || !target) return;
    const a = hand.world, b = target.pos;
    const dist = a.distanceTo(b);
    for (let i = 0; i < G.n; i++) {
      const f = ((i / G.n) + t * 0.45) % 1;                  // dots flow toward the prop
      G.pos[i * 3] = a.x + (b.x - a.x) * f;
      G.pos[i * 3 + 1] = a.y + (b.y - a.y) * f + Math.sin(f * Math.PI) * dist * 0.12;   // gentle arc
      G.pos[i * 3 + 2] = a.z + (b.z - a.z) * f + 0.03;
    }
    this.guide.geometry.attributes.position.needsUpdate = true;
    if (dist < target.radius * 1.6) this.guide.material.opacity *= dist / (target.radius * 1.6);   // fades as you arrive
  }

  /** Props react to each other: bringing a held prop close makes its neighbours glow (they don't move). */
  _nearby(dt) {
    const held = this.props.find((p) => p.heldBy);
    for (const p of this.props) {
      let target = 0;
      if (held && p !== held) {
        const d = p.pos.distanceTo(held.pos) - p.radius - held.radius;
        target = THREE.MathUtils.clamp(1 - d / 0.32, 0, 1);       // reacts within ~30 cm, before they touch
      }
      p.near += (target - p.near) * (1 - Math.exp(-dt * 6));
    }
  }

  /** During a cue, the prop it asks for is easy to grab and the others are hard to grab. */
  _grabFactor(p, s) {
    if (!this.cueTarget || s?.ghost) return 1;
    return p.def.name === this.cueTarget ? IC.targetGrabBoost : IC.otherGrabFactor;
  }

  _tryGrab(s) {
    let best = null, bd = Infinity, blocked = null, nearest = null, nd = Infinity;
    for (const p of this.props) {
      if (p.heldBy) continue;
      const d = p.pos.distanceTo(s.world) - p.radius * 0.5;
      if (d < nd) { nd = d; nearest = p; }
      const reach = IC.grabRadius * this._grabFactor(p, s);
      if (reach > 0 && d < reach && d < bd) { bd = d; best = p; }
    }
    // the prop nearest the pinch wins: if that's not the cue's prop, it's a "not yet" — never reach across to another
    if (nearest && nd < IC.grabRadius && best !== nearest && this._grabFactor(nearest, s) < 1) { blocked = nearest; best = null; }
    if (!best) {
      // pinched a prop that isn't part of this cue: a little "not yet" shake
      if (blocked) {
        blocked.spin.set(0, 0, 9 * (Math.random() < 0.5 ? -1 : 1));
        blocked.wobble = 1;
        this.blockedProp = blocked.def.name;
        this.events.push('blocked');
      }
      return;
    }
    best.heldBy = s; s.held = best;
    this.effects.emit('spark', best.pos, 26, null, best.radius * 0.8);   // little burst of light on pickup
    this.everGrabbed = true;
    this.lastGrabbed = best.def.name;
    this.events.push('grab');
  }

  _release(s, now, gain) {
    const p = s.held;
    if (!p) return;
    p.heldBy = null; s.held = null;
    p.vel.copy(s.vel).multiplyScalar(gain);
    p.vel.z *= 0.3;
    p.spin.set(-s.vel.y, s.vel.x * 0.5, -s.vel.x).multiplyScalar(4);
    p.releasedAt = now;
    this.events.push('release');
  }

  _stepProp(p, dt, t, now) {
    // safety net: if anything ever produces an invalid number, put the prop back on its spot
    if (!Number.isFinite(p.pos.x + p.pos.y + p.pos.z + p.vel.x + p.vel.y + p.vel.z)) {
      if (!Number.isFinite(p.home.x + p.home.y + p.home.z)) return;
      p.pos.copy(p.home); p.vel.set(0, 0, 0); p.spin.set(0, 0, 0); p.tilt.set(0, 0, 0);
    }
    p.prev.copy(p.pos);
    if (p.heldBy) {
      this._v.copy(p.heldBy.world); this._v.z += 0.09;          // lift it toward the viewer while held
      p.pos.lerp(this._v, 1 - Math.exp(-dt * IC.holdStiffness));
      p.vel.copy(p.pos).sub(p.prev).divideScalar(Math.max(dt, 1e-3));
      // lean into the motion
      p.tilt.z += (-p.vel.x * 0.5 - p.tilt.z) * (1 - Math.exp(-dt * 8));
      p.tilt.x += (p.vel.y * 0.4 - p.tilt.x) * (1 - Math.exp(-dt * 8));
      p.tilt.y += dt * 0.6;
      p.spin.set(0, 0, 0);
    } else if (this.anyHeld) {
      // anchored: settle to a stop where it is (no gravity, no drifting home, no tumbling)
      p.vel.multiplyScalar(Math.exp(-dt * 14));
      p.pos.addScaledVector(p.vel, dt);
      p.spin.multiplyScalar(Math.exp(-dt * 10));
      p.releasedAt = -1e9;          // once the hold ends, it floats home gently instead of falling
    } else {
      const free = now - p.releasedAt < IC.returnAfterMs;
      if (free) {
        // per-prop physics: e.g. the handkerchief falls slowly and sways like cloth
        p.vel.y -= IC.gravity * (p.def.gravity ?? 1) * dt;
        p.vel.multiplyScalar(Math.exp(-IC.drag * (p.def.drag ?? 1) * dt));
        if (p.def.flutter) {
          p.vel.x += Math.sin(t * 2.6 + p.phase) * p.def.flutter * dt;
          p.tilt.z += (Math.sin(t * 2.6 + p.phase) * 0.5 - p.tilt.z) * (1 - Math.exp(-dt * 3));
        }
      } else {
        // float home, with a gentle bob
        this._v.copy(p.home); this._v.y += Math.sin(t * 0.9 + p.phase) * 0.012;
        const k = IC.returnStiffness;
        p.vel.addScaledVector(this._d.copy(this._v).sub(p.pos), k * k * dt);
        p.vel.multiplyScalar(Math.exp(-2 * k * 0.9 * dt));
        p.tilt.x *= Math.exp(-dt * 2); p.tilt.z *= Math.exp(-dt * 2);
        p.tilt.y += dt * 0.25;
      }
      p.pos.addScaledVector(p.vel, dt);
      p.spin.multiplyScalar(Math.exp(-dt * 1.5));
      p.tilt.x += p.spin.x * dt; p.tilt.y += p.spin.y * dt; p.tilt.z += p.spin.z * dt;
      this._bounds(p);
      if (this.character) this._collideDirector(p, now);
      // props fly on a plane in front of her: flinch when one whizzes across her face
      const dxh = p.pos.x - this.headPos.x, dyh = p.pos.y - this.headPos.y;
      if (this.character && Math.hypot(dxh, dyh) < 0.16 && p.vel.length() > IC.flinchSpeed && now - this.lastFlinch > 1200) {
        this.lastFlinch = now; this.events.push('flinch');
      }
    }
    p.group.position.copy(p.pos);
    p.group.rotation.set(p.tilt.x + Math.sin(t * 0.7 + p.phase) * 0.05, p.tilt.y, p.tilt.z);

    // highlight
    // eased "being held" amount drives each prop's own reaction
    p.hold += ((p.heldBy ? 1 : 0) - p.hold) * (1 - Math.exp(-dt * (p.heldBy ? 5 : 2.5)));
    const R = this._react;
    R.hold = p.hold; R.speed = p.vel.length(); R.vel = p.vel; R.dt = dt; R.t = t; R.prop = p;
    p.model.userData.react?.(R);
    // the prop the current cue needs pulses gently so people know what to pick up
    const isTarget = this.cueTarget === p.def.name;
    const beckon = isTarget && !p.heldBy ? 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3.2)) : 0;
    // free play: every prop glows softly, in turn
    const free = this.freePlay && !p.heldBy ? 0.12 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.4 + p.phase)) : 0;
    const glow = p.heldBy ? 0.6 : Math.max(p.hover * 0.4, p.near * 0.45, beckon, free);
    p.halo.scale.setScalar(p.def.radius * (isTarget ? 6.5 : 4.2));
    if (beckon && Math.random() < dt * 9) {                       // sparkles circling the prop to pick up
      const a = t * 2.2 + Math.random() * 6.28, r = p.radius * 1.35;
      this._v.set(p.pos.x + Math.cos(a) * r, p.pos.y + Math.sin(a) * r, p.pos.z + 0.02);
      this.effects.emit('glow', this._v, 1, { x: -Math.sin(a) * 0.05, y: Math.cos(a) * 0.05, z: 0 }, 0.01);
    }
    if (p.wobble) { p.wobble = Math.max(0, p.wobble - dt * 2); p.group.rotation.z += Math.sin(t * 40) * 0.12 * p.wobble; }
    p.halo.material.opacity += (glow - p.halo.material.opacity) * (1 - Math.exp(-dt * 10));
    const quiet = this.cueTarget && !isTarget && !p.heldBy ? 0.9 : 1;   // props not in this cue step back a little
    const sc = p.def.scale * quiet * (p.heldBy ? 1.12 : 1 + p.hover * 0.06 + (beckon ? 0.06 * Math.sin(t * 3.2) + 0.06 : 0));
    p.group.scale.setScalar(p.group.scale.x + (sc - p.group.scale.x) * (1 - Math.exp(-dt * 10)));
  }

  _bounds(p) {
    const r = p.radius;
    p.pos.z = Math.min(0.85, Math.max(0.25, p.pos.z));
    this.screenToPlane(0, 0, p.pos.z, this._a);            // top-left of the visible frame at this depth
    this.screenToPlane(1, 1, p.pos.z, this._b);            // bottom-right
    const B = IC.bounce;
    if (p.pos.x < this._a.x + r) { p.pos.x = this._a.x + r; p.vel.x = Math.abs(p.vel.x) * B; }
    if (p.pos.x > this._b.x - r) { p.pos.x = this._b.x - r; p.vel.x = -Math.abs(p.vel.x) * B; }
    if (p.pos.y > this._a.y - r) { p.pos.y = this._a.y - r; p.vel.y = -Math.abs(p.vel.y) * B; }
    if (p.pos.y < this._b.y + r) { p.pos.y = this._b.y + r; p.vel.y = Math.abs(p.vel.y) * B; p.vel.x *= 0.92; }
  }

  _collideDirector(p, now) {
    const hit = (center, rad, isHead) => {
      this._n.copy(p.pos).sub(center);
      const d = this._n.length(), min = rad + p.radius;
      if (d >= min || d < 1e-5) return;
      this._n.divideScalar(d);
      p.pos.copy(center).addScaledVector(this._n, min);
      const vn = p.vel.dot(this._n);
      const speed = p.vel.length();
      if (vn < 0) p.vel.addScaledVector(this._n, -(1 + IC.bounce) * vn);
      if (isHead && speed > IC.flinchSpeed && now - this.lastFlinch > 1200) { this.lastFlinch = now; this.events.push('flinch'); }
    };
    this._a.copy(this.headPos); this._a.z -= 0.02;
    hit(this._a, 0.12, true);
    this._b.copy(this.chestPos); this._b.y -= 0.06; this._b.z += 0.02;
    hit(this._b, 0.2, false);
  }

  _collideProps() {
    const P = this.props;
    for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
      const a = P[i], b = P[j];
      this._n.copy(b.pos).sub(a.pos);
      const d = this._n.length(), min = a.radius + b.radius;
      if (d >= min || d < 1e-5) continue;
      this._n.divideScalar(d);
      const overlap = min - d;
      const wa = a.heldBy ? 0 : b.heldBy ? 1 : 0.5, wb = 1 - wa;
      a.pos.addScaledVector(this._n, -overlap * wa);
      b.pos.addScaledVector(this._n, overlap * wb);
      const rel = this._d.copy(b.vel).sub(a.vel).dot(this._n);
      if (rel < 0) {
        const imp = -(1 + IC.bounce) * rel;
        if (!a.heldBy) a.vel.addScaledVector(this._n, -imp * wa);
        if (!b.heldBy) b.vel.addScaledVector(this._n, imp * wb);
        const now = performance.now();
        if (!a.heldBy) a.releasedAt = Math.max(a.releasedAt, now - IC.returnAfterMs + 1500);
        if (!b.heldBy) b.releasedAt = Math.max(b.releasedAt, now - IC.returnAfterMs + 1500);
      }
    }
  }

  _drawHand(vis, s, h, dt) {
    vis.alpha = Math.min(1, vis.alpha + dt * 4);
    const pinch = h.pinchAmount ?? (h.pinch ? 1 : 0);
    vis.ring.position.copy(s.world);
    vis.ring.quaternion.copy(this.camera.quaternion);
    vis.ring.scale.setScalar(1.15 - pinch * 0.55 + (s.held ? 0.25 : 0));
    vis.ring.material.opacity = vis.alpha * (0.55 + pinch * 0.4);
    vis.glow.position.copy(s.world);
    vis.glow.material.opacity = vis.alpha * (0.35 + pinch * 0.45);

    const hasSkel = IC.showSkeleton && h.pts;
    vis.skel += ((hasSkel ? 1 : 0) - vis.skel) * Math.min(1, dt * 6);
    vis.lines.material.opacity = vis.alpha * vis.skel * 0.65;
    vis.joints.material.opacity = vis.alpha * vis.skel * 0.95;
    if (hasSkel) {
      const sm = vis.smoothed, k = vis.primed ? 0.55 : 1;
      for (let i = 0; i < 42; i++) sm[i] += (h.pts[i] - sm[i]) * k;
      vis.primed = true;
      const z = IC.handPlaneZ + 0.02;
      for (let j = 0; j < 21; j++) {
        this.screenToPlane(sm[j * 2], sm[j * 2 + 1], z, this._v);
        vis.jpos[j * 3] = this._v.x; vis.jpos[j * 3 + 1] = this._v.y; vis.jpos[j * 3 + 2] = this._v.z;
      }
      BONES.forEach(([a, b], i) => {
        vis.pos.set(vis.jpos.subarray(a * 3, a * 3 + 3), i * 6);
        vis.pos.set(vis.jpos.subarray(b * 3, b * 3 + 3), i * 6 + 3);
      });
      vis.lines.geometry.attributes.position.needsUpdate = true;
      vis.joints.geometry.attributes.position.needsUpdate = true;
    }
  }

  _fadeHand(vis, dt) {
    if (vis.alpha <= 0) return;
    vis.alpha = Math.max(0, vis.alpha - dt * 3);
    vis.primed = vis.alpha > 0 && vis.primed;
    vis.ring.material.opacity = vis.glow.material.opacity = vis.alpha * 0.4;
    vis.lines.material.opacity = vis.alpha * vis.skel * 0.65;
    vis.joints.material.opacity = vis.alpha * vis.skel * 0.95;
  }
}
