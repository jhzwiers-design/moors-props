/* ==========================================================================
   CUES — gives each visitor something to DO: a short run of "stage cues"
   (set the scene before curtain), one at a time, each with a clear
   instruction, a glowing target prop, a progress bar and a payoff.

     Warm-up  a few seconds to play with anything (shows it's all live)

     Cue 1  wave the handkerchief            (count back-and-forth waves)
     Cue 2  carry the tea to the mark        (reach the glowing mark; spilling is noticed)
     Cue 3  light the s'more, then shake it out
     Cue 4  twirl the ribbon in a circle     (accumulated turning of the motion)
     Finale "Places, everyone." → free play

   Wording lives in CONFIG.cues. Resets whenever the intro returns.
   ========================================================================== */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { glowTex } from './props.js';

const $ = (s) => document.querySelector(s);

export class Cues {
  constructor(interaction, stage) {
    this.I = interaction;
    this.camera = stage.camera;
    this.list = CONFIG.cues.steps;
    this.el = { card: $('#cue'), kicker: $('#cue-kicker'), title: $('#cue-title'), text: $('#cue-text'), hint: $('#cue-hint'), bar: $('#cue-bar'), dots: $('#cue-dots'), finale: $('#finale'),
      freeSub: $('#freeplay-sub'), list: $('#checklist'), listHead: $('#checklist-head'), listItems: $('#checklist-items'), toast: $('#toast'), toastLine: $('#toast-line'), toastSub: $('#toast-sub'), free: $('#freeplay') };
    this.el.dots.innerHTML = this.list.map(() => '<span></span>').join('');
    // the "prompt book" checklist down the side
    this.el.listItems.innerHTML = this.list.map((c, i) => `<li><span class="ck-mark">${i + 1}</span><span class="ck-text">${c.title}</span></li>`).join('');
    this._v = new THREE.Vector3();

    // the "table" mark for the tea cue: a glowing ring on stage
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mark = new THREE.Group();
    this.markRing = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.004, 8, 48), ringMat);
    this.markGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffc98a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.markGlow.scale.setScalar(0.3);
    this.mark.add(this.markRing, this.markGlow);
    stage.scene.add(this.mark);

    this.reset();
  }

  reset() {
    this.index = 0;
    this.phase = 'idle';          // idle (intro up) → warmup → active → done (pause) → … → finale → free
    this.progress = 0;
    this.shown = 0;
    this.finished = false;
    for (const p of this.I.props) p.model.userData.reset?.();
    this._start(0, false);
    this.phase = 'warmup';
    this.warmT = 0;
    this.I.cueTarget = null;
    this.el.card.classList.remove('show');
    this.el.finale.classList.remove('show');
    this.el.toast.classList.remove('show');
    this.el.free.classList.remove('show');
    this.el.list.classList.remove('complete');
    this.el.listHead.textContent = CONFIG.cues.listTitle;
    clearTimeout(this.el.freeSub._swapT);
    this.el.freeSub.classList.remove('swap');
    this.el.freeSub.textContent = CONFIG.cues.freePlaySub;
    this.I.freePlay = false;
    this._renderList();
    this._showWarmup();
  }

  _showWarmup() {
    const W = CONFIG.cues.warmup;
    this.el.kicker.textContent = W.kicker;
    this.el.title.textContent = W.title;
    this.el.text.textContent = W.text;
    this.el.hint.textContent = W.hint;
    [...this.el.dots.children].forEach((d) => { d.className = ''; });
  }

  /** Tick off finished cues, highlight the current one. */
  _renderList() {
    [...this.el.listItems.children].forEach((li, k) => {
      if (this.phase === 'warmup') { li.className = ''; li.querySelector('.ck-mark').textContent = String(k + 1); return; }
      const done = k < this.index || (k === this.index && (this.phase === 'done' || this.phase === 'finale' || this.phase === 'free'));
      li.className = done ? 'done' : k === this.index ? 'now' : '';
      li.querySelector('.ck-mark').textContent = done ? '✓' : String(k + 1);
    });
  }

  /** Someone pinched a prop that isn't part of this cue. */
  blocked() {
    if (this.phase !== 'active') return;
    this.el.hint.textContent = CONFIG.cues.blockedHint;
    this.el.hint.classList.add('warn');
    clearTimeout(this._blockT);
    this._blockT = setTimeout(() => { this.el.hint.classList.remove('warn'); }, 2200);
  }

  get active() { return this.phase !== 'free'; }
  /** Any prop can be picked up (warm-up and free play). */
  get open() { return this.phase === 'free' || this.phase === 'warmup'; }

  _prop(name) { return this.I.props.find((p) => p.def.name === name); }

  _start(i, show = true) {
    this.index = i;
    const c = this.list[i];
    this.phase = 'active';
    this.progress = 0;
    this.spilled = false;
    this.startDist = undefined;
    this.waves = 0; this.lastSign = 0;
    this.turn = 0; this.lastAngle = null;
    this.sinceHeld = 0; this.cheered = false; this.cheerUntil = 0;
    this.blownBase = this._prop('smores')?.model.userData.state?.blownOut || 0;
    this.I.cueTarget = c.prop;
    this.el.kicker.textContent = `Cue ${i + 1} of ${this.list.length}`;
    this.el.title.textContent = c.title;
    this.el.text.textContent = c.text;
    this.el.hint.textContent = CONFIG.cues.pinchHint;
    this.el.bar.style.transform = 'scaleX(0)';
    [...this.el.dots.children].forEach((d, k) => { d.className = k < i ? 'done' : k === i ? 'now' : ''; });
    this._renderList();
    if (c.check === 'deliver') {
      // place the mark across the stage from the teacup's home
      const p = this._prop(c.prop);
      this.I.screenToPlane(CONFIG.cues.markAt[0], CONFIG.cues.markAt[1], p.z, this.mark.position);
    }
    if (show) this._flashCard();
  }

  _flashCard() {
    const card = this.el.card;
    card.classList.remove('show');
    void card.offsetWidth;
    card.classList.add('show');
  }

  /**
   * @param introShown  true while the intro card is up (nobody playing)
   */
  update(dt, t, introShown) {
    const now = performance.now();
    // marks and cards are only visible while someone is playing
    if (introShown) {
      if (this.shown) { this.el.card.classList.remove('show'); this.shown = 0; }
      this.I.cueTarget = null;                         // no target glow during the standby demo
      this._markOpacity(0, dt);
      return;
    }
    if (!this.shown && this.phase !== 'free') { this._flashCard(); this.shown = 1; }
    if (this.phase === 'warmup') return this._warmup(dt);
    if (this.phase === 'active' && !this.I.cueTarget) this.I.cueTarget = this.list[this.index].prop;

    if (this.phase === 'active') this._check(dt, t);
    else if (this.phase === 'done' && now > this.nextAt) {
      if (this.index + 1 < this.list.length) this._start(this.index + 1);
      else this._finale();
    } else if (this.phase === 'finale' && now > this.nextAt) {
      // free play: say so clearly, and keep saying it (a quiet banner) while they play
      this.phase = 'free';
      this.el.finale.classList.remove('show');
      this.I.cueTarget = null;
      this.I.freePlay = true;
      this.el.free.classList.add('show');
      this.el.list.classList.add('complete');
      this.el.listHead.textContent = CONFIG.cues.listDone;
      this._renderList();
      this.tryAt = now + CONFIG.cues.tryEveryMs; this.tryI = 0;
    } else if (this.phase === 'free' && now > this.tryAt) {
      // rotate little "try this" ideas under the banner so there's always something new to do
      const ideas = CONFIG.cues.tryThis;
      this.tryAt = now + CONFIG.cues.tryEveryMs;
      this._swap(this.el.freeSub, ideas[this.tryI++ % ideas.length]);
    }

    const c = this.list[this.index];
    this._markOpacity(this.phase === 'active' && c.check === 'deliver' ? 1 : 0, dt, t);
    const bar = `scaleX(${Math.min(1, this.progress).toFixed(2)})`;
    if (bar !== this._bar) { this._bar = bar; this.el.bar.style.transform = bar; }   // touch the DOM only on change
  }

  /** Warm-up: everything is live and glowing; the bar fills, then the cues begin. */
  _warmup(dt) {
    const W = CONFIG.cues.warmup;
    this.I.cueTarget = null;
    this.I.freePlay = true;
    this.warmT += dt * 1000;
    this.progress = Math.min(1, this.warmT / W.ms);
    const bar = `scaleX(${this.progress.toFixed(2)})`;
    if (bar !== this._bar) { this._bar = bar; this.el.bar.style.transform = bar; }
    this._markOpacity(0, dt);
    // don't yank the cues in while they're mid-play with something (up to maxMs)
    const holding = this.I.props.some((p) => p.heldBy);
    if (this.warmT < W.ms || (holding && this.warmT < W.maxMs)) return;
    this.I.freePlay = false;
    this.el.toastLine.textContent = W.toast;
    this.el.toastSub.textContent = W.toastSub;
    this._toast(CONFIG.cues.pauseMs);
    this._start(0);
  }

  /** Fade a line out, change it, fade it back in. */
  _swap(el, text) {
    el.classList.add('swap');
    clearTimeout(el._swapT);
    el._swapT = setTimeout(() => { el.textContent = text; el.classList.remove('swap'); }, 350);
  }

  _toast(ms) {
    const toast = this.el.toast;
    toast.classList.remove('show'); void toast.offsetWidth; toast.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => toast.classList.remove('show'), ms - 300);
  }

  _markOpacity(target, dt, t = 0) {
    const m = this.markRing.material;
    m.opacity += (target * (0.6 + 0.25 * Math.sin(t * 3)) - m.opacity) * (1 - Math.exp(-dt * 6));
    this.markGlow.material.opacity = m.opacity * 0.7;
    this.markRing.quaternion.copy(this.camera.quaternion);
    this.markRing.scale.setScalar(1 + 0.06 * Math.sin(t * 3));
  }

  _check(dt, t) {
    const c = this.list[this.index];
    const p = this._prop(c.prop);
    const held = !!p.heldBy;
    const now = performance.now();
    // stuck? after a while without the right prop in hand, spell it out
    this.sinceHeld = held ? 0 : this.sinceHeld + dt * 1000;
    if (now > this.cheerUntil) {
      if (held) this.el.hint.textContent = c.hint || '';
      else if (this.sinceHeld > CONFIG.cues.nudgeMs && !this.el.hint.classList.contains('warn')) this.el.hint.textContent = CONFIG.cues.nudge;
    }
    // a little encouragement halfway through
    if (!this.cheered && this.progress >= 0.5 && this.progress < 1) {
      this.cheered = true;
      const cheers = CONFIG.cues.cheers;
      this.el.hint.textContent = cheers[Math.floor(Math.random() * cheers.length)];
      this.cheerUntil = now + 1600;
    }

    switch (c.check) {
      case 'wave': {           // count back-and-forth swings while held
        if (held && Math.abs(p.vel.x) > 0.3) {
          const sign = Math.sign(p.vel.x);
          if (this.lastSign && sign !== this.lastSign) this.waves++;
          this.lastSign = sign;
        }
        this.progress = this.waves / c.count;
        break;
      }
      case 'deliver': {        // bring the teacup onto the glowing mark
        const d = Math.hypot(p.pos.x - this.mark.position.x, p.pos.y - this.mark.position.y);
        this.startDist ??= d;
        if (!held) this.startDist = Math.max(this.startDist, d);
        this.progress = held ? Math.max(this.progress * 0.98, 1 - d / this.startDist) : this.progress * 0.97;
        const level = p.model.userData.state?.level ?? 1;
        if (level < 0.75 && !this.spilled) { this.spilled = true; this.el.hint.textContent = c.spillHint; }
        if (held && d < 0.07) {
          this.progress = 1;
          this.I.effects.emit('glow', this.mark.position, 18, null, 0.1);
          return this._complete(level < 0.75 ? c.doneSpilled : c.done);
        }
        break;
      }
      case 'fire': {           // toast until it catches fire, then shake it out
        const st = p.model.userData.state;
        if (st.burning) { this.el.text.textContent = c.text2; this.el.hint.textContent = c.hint2; }
        this.progress = st.burning ? 0.85 : Math.min(0.8, st.toast * 0.8);
        if (st.blownOut > this.blownBase) { this.progress = 1; return this._complete(c.done); }
        break;
      }
      case 'twirl': {          // add up how far the motion direction turns
        if (held && p.vel.length() > 0.07) {       // even slow, gentle circles count
          const a = Math.atan2(p.vel.y, p.vel.x);
          if (this.lastAngle !== null) {
            let da = a - this.lastAngle;
            if (da > Math.PI) da -= Math.PI * 2; if (da < -Math.PI) da += Math.PI * 2;
            if (Math.abs(da) < 1.2) this.turn += da;    // ignore sudden flips (jitter)
          }
          this.lastAngle = a;
        } else if (!held) { this.lastAngle = null; }
        this.progress = Math.abs(this.turn) / (Math.PI * 2 * c.turns);
        break;
      }
    }
    this.progress = Math.max(0, this.progress);
    if (this.progress >= 1) this._complete(c.done);
  }

  _complete(line) {
    if (this.phase !== 'active') return;
    const c = this.list[this.index];
    const p = this._prop(c.prop);
    this.phase = 'done';
    this.progress = 1;
    this.nextAt = performance.now() + CONFIG.cues.pauseMs;
    this.I.effects.emit('spark', p.pos, 40, null, 0.1);
    this.I.effects.emit('glow', p.pos, 20, null, 0.15);
    this.el.text.textContent = line;
    this.el.hint.textContent = '';
    this.el.dots.children[this.index].className = 'done';
    this.I.cueTarget = null;
    this._renderList();
    // a clear "step done" moment in the middle of the stage
    this.el.toastLine.textContent = `Cue ${this.index + 1} complete`;
    this.el.toastSub.textContent = this.index + 1 < this.list.length ? `${this.list.length - this.index - 1} to go` : CONFIG.cues.lastToGo;
    this._toast(CONFIG.cues.pauseMs);
  }

  _finale() {
    this.phase = 'finale';
    this.finished = true;
    this.nextAt = performance.now() + CONFIG.cues.finaleMs;
    this.el.card.classList.remove('show');
    const f = this.el.finale;
    f.querySelector('.finale-1').textContent = CONFIG.cues.finale[0];
    f.querySelector('.finale-2').textContent = CONFIG.cues.finale[1];
    f.classList.add('show');
    for (const p of this.I.props) {
      this.I.effects.emit('spark', p.pos, 30, null, 0.12);
      this.I.effects.emit('glow', p.pos, 16, null, 0.2);
    }
  }
}
