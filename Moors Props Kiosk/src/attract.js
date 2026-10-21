/* ==========================================================================
   ATTRACT — the standby demo. While nobody is at the kiosk, a glowing
   "ghost hand" drifts in, pinches a prop, shows off what it does, sets it
   down and moves on to the next. Passers-by see exactly what to do.

   The ghost is fed to the interaction system like a real hand (marked
   ghost: true, so it never counts as a visitor and never advances cues).
   It vanishes the moment a real hand appears.
   ========================================================================== */
import * as THREE from 'three';
import { CONFIG } from './config.js';

// An open right hand, wrist at (0,0), fingers pointing up (screen-height units)
const HAND = [[0, 0], [-.035, -.03], [-.06, -.06], [-.075, -.09], [-.085, -.115], [-.03, -.11], [-.035, -.16], [-.038, -.19], [-.04, -.215],
  [-.005, -.115], [-.005, -.17], [-.005, -.205], [-.005, -.235], [.02, -.11], [.024, -.16], [.026, -.19], [.028, -.215],
  [.042, -.1], [.05, -.14], [.054, -.165], [.058, -.185]];

const ease = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, f) => a + (b - a) * f;

export class Attract {
  constructor(interaction, camera) {
    this.I = interaction;
    this.camera = camera;
    this.hand = { id: 'ghost', ghost: true, present: false, sx: 0.5, sy: 1.1, pinch: false, pinchAmount: 0, pts: new Float32Array(42) };
    this.order = CONFIG.attract.order;
    this.i = 0;
    this.t = 0;
    this.wait = CONFIG.attract.startDelay;
    this._v = new THREE.Vector3();
    this.from = [0.5, 1.15];
  }

  _screen(p) {
    this._v.copy(p.home).project(this.camera);
    return [(this._v.x + 1) / 2, (1 - this._v.y) / 2];
  }

  /** @param active  true while the kiosk is in standby (intro up, no real hand) */
  update(dt, active) {
    const h = this.hand;
    if (!active || !CONFIG.attract.enabled) {
      h.present = false; h.pinch = false; h.pinchAmount = 0;
      this.t = 0; this.wait = CONFIG.attract.restartDelay;
      return;
    }
    if (this.wait > 0) { this.wait -= dt; h.present = false; h.pinch = false; return; }

    const p = this.I.props.find((x) => x.def.name === this.order[this.i % this.order.length]);
    if (!p) { this.i++; return; }
    this.t += dt;
    const t = this.t;
    const [px, py] = this._screen(p);
    const ux = px, uy = py - 0.07;                    // where it carries the prop to: lifted a little
    let x, y, pinch = 0;

    // timeline (seconds): enter 1.8 · pinch 0.5 · show off 3.2 · release 0.4 · leave 1.4
    if (t < 1.8) { const f = ease(t / 1.8); x = lerp(this.from[0], px, f); y = lerp(this.from[1], py, f); }
    else if (t < 2.3) { const f = (t - 1.8) / 0.5; x = px; y = py; pinch = ease(f); }
    else if (t < 5.5) {
      const f = (t - 2.3) / 3.2, lift = ease(Math.min(1, f * 3));
      x = lerp(px, ux, lift); y = lerp(py, uy, lift); pinch = 1;
      const a = f * Math.PI * 2;
      switch (p.def.name) {
        case 'handkerchief': x += Math.sin(a * 3) * 0.07 * lift; break;                          // wave
        case 'ribbon': x += (Math.cos(a * 1.5) - 1) * 0.07 * lift; y += Math.sin(a * 1.5) * 0.06 * lift; break;   // twirl
        case 'teacup': x += Math.sin(a * 0.5) * 0.12 * lift; break;                              // carry, gently
        default: x += Math.sin(a * 2) * 0.015 * lift; y += Math.sin(a * 3) * 0.008; break;      // warm the s'more
      }
    } else if (t < 5.9) { const f = (t - 5.5) / 0.4; x = ux; y = uy; pinch = 1 - ease(f); }
    else if (t < 7.3) { const f = ease((t - 5.9) / 1.4); x = lerp(ux, ux + 0.05, f); y = lerp(uy, 1.15, f); }
    else {                                              // gone; pause, then the next prop
      h.present = false; h.pinch = false; h.pinchAmount = 0;
      this.from = [x ?? ux, 1.15];
      this.i++; this.t = 0; this.wait = CONFIG.attract.betweenDelay;
      return;
    }

    h.present = true;
    h.sx = x; h.sy = y;
    h.pinchAmount = pinch;
    h.pinch = h.pinch ? pinch > 0.35 : pinch > 0.75;
    this._pose(x, y, pinch);
  }

  /** Build the 21 skeleton points so the thumb–index pinch point sits at (x, y). */
  _pose(x, y, pinch) {
    const P = this.hand.pts;
    const ar = (window.innerHeight || 1) / (window.innerWidth || 1);   // keep the hand's proportions on wide screens
    const s = CONFIG.attract.handSize;
    for (let j = 0; j < 21; j++) { P[j * 2] = HAND[j][0] * s * ar; P[j * 2 + 1] = HAND[j][1] * s; }
    // close thumb and index toward each other as it pinches
    const mx = (P[8] + P[16]) / 2, my = (P[9] + P[17]) / 2;
    for (const [j, k] of [[4, 0.9], [8, 0.9], [3, 0.45], [7, 0.45]]) {
      P[j * 2] += (mx - P[j * 2]) * k * pinch; P[j * 2 + 1] += (my - P[j * 2 + 1]) * k * pinch;
    }
    const cx = (P[8] + P[16]) / 2, cy = (P[9] + P[17]) / 2;
    for (let j = 0; j < 21; j++) { P[j * 2] += x - cx; P[j * 2 + 1] += y - cy; }
  }
}
