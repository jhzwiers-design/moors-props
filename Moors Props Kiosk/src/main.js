/* ==========================================================================
   MAIN — wires everything together and runs the interaction sequence.

   Current experience (CONFIG.experience.speech = false):
     idle ──face or hand──▶ engaged (props, hand skeleton, director watches)
       ▲                        │
       └──── nobody for rearmAfterMs ─┘
     Instructions adapt: step in front → raise your hand → pinch to pick up.
     Mouse / touch act as a hand, with or without a camera.

   Speech experience (CONFIG.experience.speech = true), kept intact:

   idle ──face──▶ noticed ──1.5 s──▶ speaking ──script ends──▶ done
     ▲                │                  │                       │
     └──face lost─────┘   face gone 7 s: finish sentence → idle  │
     └───────────────────────────── visitor leaves ──────────────┘
   No camera: message → welcome plays → tap anywhere to hear it again.
   ========================================================================== */
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { createStage } from './scene.js';
import { Tracker } from './tracking.js';
import { Speech } from './speech.js';
import { UI } from './ui.js';
import { Interaction } from './interaction.js';
import { Cues } from './cues.js';
import { Attract } from './attract.js';

const ui = new UI();
const stage = createStage(document.getElementById('stage'));
const tracker = new Tracker();

const S = { state: 'loading', mode: 'camera', since: 0, absentSince: 0, debug: false, handSince: 0, handGoneSince: -1e9, intro: false };   // -1e9: intro shows immediately on first load
let character = null, animator = null, interaction = null, cues = null, attract = null;
const DIRECTOR = CONFIG.experience.director;
if (DIRECTOR) CONFIG.tracking.trackFace = true;          // the director needs to see faces; props mode doesn't
const SPEECH = DIRECTOR && CONFIG.experience.speech;
if (!SPEECH) document.body.classList.add('no-speech');
if (!SPEECH) document.getElementById('start').classList.add('gone');   // no tap needed without sound

// Mouse / touch behave like a hand: move = hover, press = pinch.
const pointer = { id: 'pointer', present: false, sx: 0.5, sy: 0.5, pinch: false, pinchAmount: 0, pts: null, lastMove: 0, touch: false };
const handInputs = [];

const speech = new Speech({
  onSentence: (i, text) => { ui.sentence(text); animator?.onSentence(text); },
  onWord: (ci, word) => { ui.word(ci); animator?.onWord(word); },
  onEnd: ({ interrupted }) => {
    setTimeout(() => ui.clearCaption(), interrupted ? 300 : 2200);
    setState(interrupted ? 'idle' : 'done');
  },
});

/* ---------------- state machine ---------------- */
function setState(next) {
  if (S.state === next) return;
  S.state = next;
  S.since = performance.now();
  document.body.dataset.state = next;
  if (next === 'idle') speech.speaking && speech.stop();
  if (next === 'speaking' && SPEECH) speech.play(CONFIG.script);
  if (next === 'idle' && interaction) interaction.everGrabbed = false;   // new visitor → show the hints again
}

function anyHand() { return handInputs.some((h) => h.present && !h.ghost); }   // the standby demo hand doesn't count

function updateState(now) {
  if (!SPEECH) {
    const someone = tracker.data.faceDetected || anyHand();
    if (someone) S.absentSince = 0; else if (!S.absentSince) S.absentSince = now;
    if (S.state === 'idle' && someone) setState('engaged');
    if (S.state === 'engaged' && S.absentSince && now - S.absentSince > CONFIG.timing.rearmAfterMs) setState('idle');
    return;
  }
  if (S.mode !== 'camera') return;
  const face = tracker.data.faceDetected;
  if (face) S.absentSince = 0; else if (!S.absentSince) S.absentSince = now;
  const gone = S.absentSince ? now - S.absentSince : 0;
  const T = CONFIG.timing;
  switch (S.state) {
    case 'idle': if (face) setState('noticed'); break;
    case 'noticed':
      if (gone > 1200) setState('idle');
      else if (face && now - S.since > T.noticeDelayMs) setState('speaking');
      break;
    case 'speaking': if (gone > T.leaveAfterMs) speech.finishSentence(); break;
    case 'done': if (gone > T.rearmAfterMs) setState('idle'); break;
  }
}

/* ---------------- start-up ---------------- */
async function boot() {
  if (DIRECTOR) {
    // The director is only loaded when enabled — her photo analysis and rig never run otherwise.
    try {
      const [{ createCharacter }, { Animator }] = await Promise.all([import('./character.js'), import('./animation.js')]);
      character = await createCharacter();
      stage.scene.add(character.root);
      animator = new Animator(character);
    } catch (e) {
      console.error('[kiosk] could not build the character', e);
      document.getElementById('loading').textContent = 'The director could not be loaded — see console.';
      return;
    }
  }
  interaction = new Interaction(stage, character);
  cues = new Cues(interaction, stage);
  attract = new Attract(interaction, stage.camera);
  window.kiosk = { S, tracker, speech, animator, character, stage, interaction, cues, attract, pointer, setState, config: CONFIG, THREE, frame };   // frame: for scripted tests
  ui.ready();
  S.state = 'waiting';
  // Without speech there is no sound to unlock, so no tap is needed: start straight away.
  if (!SPEECH || new URLSearchParams(location.search).has('autostart')) begin();
}

async function begin() {
  ui.hideStart();
  speech.unlock();
  navigator.wakeLock?.request('screen').catch(() => {});
  try {
    await tracker.start();
    S.mode = 'camera';
    S.state = '';
    setState('idle');
  } catch (e) {
    console.warn('[kiosk] camera tracking unavailable:', e);
    S.mode = 'nocamera';
    document.body.classList.add('no-camera');
    ui.introCta(CONFIG.intro.ctaTouch);
    S.state = '';
    setState('idle');
    ui.message(true);
    setTimeout(() => { ui.message(false); if (SPEECH) { S.state = ''; setState('speaking'); } }, CONFIG.timing.noCameraMessageMs);
  }
}
ui.onStart(() => { if (S.state === 'waiting') begin(); else ui.hideStart(); });

ui.controls({
  onMute: (m) => speech.setMuted(m),
  onReplay: () => { S.state = ''; setState('speaking'); },
});
// Without a camera (speech mode), a tap anywhere replays the welcome.
window.addEventListener('pointerdown', (e) => {
  if (SPEECH && S.mode === 'nocamera' && !speech.speaking && S.state !== 'waiting' && !e.target.closest('button')) {
    S.state = ''; setState('speaking');
  }
});

/* ---------------- mouse / touch as a hand ---------------- */
const onStage = (e) => S.state !== 'waiting' && S.state !== 'loading' && !e.target.closest('button, .start');
const movePointer = (e) => {
  pointer.sx = e.clientX / window.innerWidth;
  pointer.sy = e.clientY / window.innerHeight;
  pointer.lastMove = performance.now();
  pointer.touch = e.pointerType === 'touch';
};
window.addEventListener('pointermove', (e) => { if (!onStage(e)) return; movePointer(e); pointer.present = true; });
window.addEventListener('pointerdown', (e) => {
  if (!onStage(e)) return;
  movePointer(e); pointer.present = true; pointer.pinch = true; pointer.pinchAmount = 1;
});
const pointerUp = () => { pointer.pinch = false; pointer.pinchAmount = 0; if (pointer.touch) pointer.lastMove = performance.now() - 2000; };
window.addEventListener('pointerup', pointerUp);
window.addEventListener('pointercancel', pointerUp);

/* ---------------- frame loop ---------------- */
let last = performance.now(), frames = 0, fps = 0, fpsT = last;
const headPos = new THREE.Vector3();
const parallax = { x: 0, y: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));   // never negative, never a huge jump
  last = now;
  const t = now / 1000;

  if (interaction && !S.paused) {
    // Gather hands: camera hands + mouse/touch
    if (pointer.present && !pointer.pinch && now - pointer.lastMove > 2500) pointer.present = false;
    handInputs.length = 0;
    if (S.mode === 'camera') for (const h of tracker.hands) handInputs.push(h);
    handInputs.push(pointer);
    // standby demo: a ghost hand shows what to do while nobody is here
    attract.update(dt, S.intro && !anyHand());
    handInputs.push(attract.hand);

    updateState(now);
    const v = S.mode === 'camera' ? tracker.data : null;
    const focus = interaction.update(dt, t, handInputs);
    // captions on pickup only in free play — during the cues the cue card does the talking
    if (CONFIG.whispers && cues.open && !S.intro && interaction.events.includes('grab')) ui.whisper(CONFIG.whispers[interaction.lastGrabbed]);
    if (interaction.events.includes('blocked')) cues.blocked();
    updateFocus();
    updateIntro(now, dt);
    cues.update(dt, t, S.intro);
    if (animator) {
      for (const ev of interaction.events) {
        if (ev === 'grab') animator.delight();
        else if (ev === 'flinch') animator.flinch();
        else if (ev === 'hand' && !tracker.data.faceDetected) animator.notice();
      }
      character.face.mesh.getWorldPosition(headPos);
      const attending = S.mode === 'nocamera' || ['noticed', 'speaking', 'done', 'engaged'].includes(S.state);
      animator.update(dt, t, { viewer: v, attending, speaking: speech.speaking, viseme: speech.viseme(now), focus, headPos });
    }
    updateInstruction(now);
  }
  // subtle camera drift: follows the viewer's face (director mode) or the active hand
  let vp = null;
  if (tracker.data.faceDetected && S.mode === 'camera') { parallax.x = (tracker.data.x - 0.5) * 2; parallax.y = (0.5 - tracker.data.y) * 2; vp = parallax; }
  else { const h = handInputs.find((x) => x.present && !x.ghost); if (h) { parallax.x = (h.sx - 0.5) * 1.2; parallax.y = (0.5 - h.sy) * 1.2; vp = parallax; } }
  stage.update(dt, t, vp, character?.faceUniforms, character ? headPos : null);

  frames++;
  if (now - fpsT > 500) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; }
  if (S.debug) {
    const d = tracker.data;
    ui.debug(undefined,
      `render ${fps} fps @ ${stage.pixelRatio().toFixed(2)}x · tracker ${tracker.fps} fps (${tracker.worker ? 'worker' : 'main thread'}, ${(tracker.detectMs || 0).toFixed(1)} ms) · particles ${interaction?.effects.live ?? 0}\n` +
      `state ${S.state} · mode ${S.mode}\n` +
      JSON.stringify({ faceDetected: d.faceDetected, x: +d.x.toFixed(2), y: +d.y.toFixed(2), distance: +d.distance.toFixed(2) }) + '\n' +
      (animator ? `head yaw ${animator.head.yaw.toFixed(1)}° pitch ${animator.head.pitch.toFixed(1)}° · eyes ${animator.eyes.yaw.toFixed(1)}°/${animator.eyes.pitch.toFixed(1)}°\n` : '') +
      (character ? `photo analysis: ${character.face.analysed ? 'landmarks ✓' : 'fallback'} · ${character.face.segmented ? 'segmentation ✓' : 'no segmentation'}\n` : '') +
      `hands ${tracker.hands.map((h) => h.present ? (h.pinch ? 'pinch' : 'open') : '–').join(' / ')} · pointer ${pointer.present ? (pointer.pinch ? 'pinch' : 'hover') : '–'}\n` +
      `voice ${SPEECH ? speech.voice?.name || '—' : 'off'}`);
  }
}
requestAnimationFrame(frame);

/* ---------------- emphasis spotlight on the held prop (only touches the DOM when it changes) ---------------- */
const focusEl = document.getElementById('focus');
let lastFocus = '';
// The 200px element is scaled so its edge always lies beyond the screen; its gradient is
// drawn once for the current screen size (redrawn only on resize, never per frame).
let focusScale = 0;
function sizeFocus() {
  const vmin = Math.min(innerWidth, innerHeight);
  focusScale = (2.2 * Math.max(innerWidth, innerHeight)) / 100;     // half-size covers > 2 screen widths
  const clear = (0.11 * vmin) / focusScale, dark = (0.34 * vmin) / focusScale;   // in element pixels
  focusEl.style.background = `radial-gradient(circle at center, transparent 0, transparent ${clear.toFixed(2)}px, rgba(2,1,2,.62) ${dark.toFixed(2)}px, rgba(2,1,2,.62) 100%)`;
  lastFocus = '';
}
window.addEventListener('resize', () => { if (focusScale) sizeFocus(); });
function updateFocus() {
  const f = interaction.spotlight;
  const key = f.amount < 0.01 ? '0' : `${(f.x * 100).toFixed(1)}|${(f.y * 100).toFixed(1)}|${f.amount.toFixed(2)}`;
  if (key === lastFocus) return;
  lastFocus = key;
  focusEl.style.opacity = f.amount < 0.01 ? '0' : (f.amount * 0.9).toFixed(2);
  if (f.amount >= 0.01) {
    if (focusScale === 0) sizeFocus();
    focusEl.style.transform = `translate3d(${(f.x * innerWidth).toFixed(0)}px, ${(f.y * innerHeight).toFixed(0)}px, 0) scale(${focusScale.toFixed(3)})`;
  }
}

/* ---------------- intro: shown whenever no hand is on stage ---------------- */
function updateIntro(now, dt) {
  if (SPEECH) return;
  const hand = anyHand();
  if (hand) { S.handGoneSince = 0; if (!S.handSince) S.handSince = now; }
  else { S.handSince = 0; if (!S.handGoneSince) S.handGoneSince = now; }
  const loading = S.state === 'loading' || S.state === 'waiting';
  // hide the moment a hand appears; come back only after the stage has been empty a while
  const show = !loading && !hand && (S.intro || now - S.handGoneSince > CONFIG.intro.returnAfterMs);
  if (show && !S.intro) { interaction.everGrabbed = false; cues.reset(); }   // next visitor starts the cues afresh
  S.intro = show;
  ui.intro(show);
  // "house lights": the stage dims behind the intro and comes up when a hand takes it
  const target = show || loading ? CONFIG.intro.dimExposure : CONFIG.intro.liveExposure;
  const r = stage.renderer;
  r.toneMappingExposure += (target - r.toneMappingExposure) * (1 - Math.exp(-dt * (show ? 1.2 : 3)));
}

/* ---------------- adaptive instruction ---------------- */
function updateInstruction(now) {
  if (S.state === 'waiting' || S.state === 'loading') return ui.prompt(null);
  if (SPEECH) return ui.prompt(S.state === 'idle' && S.mode === 'camera' ? CONFIG.ui.instruction : null);
  if (S.intro || cues.active) return ui.prompt(null);          // the intro / cue card does the guiding
  const face = tracker.data.faceDetected, hand = anyHand();
  let text = null;
  if (interaction.everGrabbed) text = null;
  else if (hand) text = now - S.handSince > 1200 ? CONFIG.ui.pinchHint : null;
  else if (face) text = S.mode === 'camera' ? CONFIG.ui.raiseHand : null;
  else if (S.mode === 'camera') text = CONFIG.ui.instruction;
  ui.prompt(text);
}

/* ---------------- staff keys: D = debug, F = fullscreen ---------------- */
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'd') { S.debug = !S.debug; ui.debug(S.debug); }
  if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});

boot();
