/* ==========================================================================
   KIOSK — wires tracker, portrait, narrator and the on-screen UI together.
   States:  idle → noticed → speaking → done → (viewer leaves) → idle
   Modes:   'camera' (face tracking)  |  'touch' (camera unavailable/denied)
   ========================================================================== */

import { CONFIG } from './config.js';
import { Portrait } from './portrait.js';
import { FaceTracker } from './tracker.js';
import { Narrator } from './voice.js';
import { Dust } from './stage.js';

const $ = (s) => document.querySelector(s);
const el = {
  body: document.body,
  portraitBox: $('#portrait'),
  canvas: $('#portrait-canvas'),
  fallbackImg: $('#portrait-fallback'),
  dust: $('#dust'),
  caption: $('#caption'),
  prompt: $('#prompt'),
  promptSub: $('#prompt-sub'),
  presence: $('#presence-dot'),
  start: $('#start'),
  startBtn: $('#start-btn'),
  mute: $('#btn-mute'),
  replay: $('#btn-replay'),
  video: $('#cam'),
  debug: $('#debug'),
  debugBox: $('#debug-box'),
  debugText: $('#debug-text'),
};

/* ---------- static text from config ---------- */
const P = CONFIG.production;
$('#presenter').textContent = P.presenter;
$('#title').innerHTML = P.titleLines.map((l, i) => `<span class="t${i}">${l}</span>`).join('');
$('#director-name').textContent = P.directorName;
$('#director-role').textContent = P.directorRole;
el.fallbackImg.src = CONFIG.portrait.src;
el.portraitBox.style.aspectRatio = `${CONFIG.portrait.width} / ${CONFIG.portrait.height}`;

/* ---------- state ---------- */
const S = {
  mode: 'camera',
  state: '',
  noticedAt: 0,
  absentSince: 0,
  target: { x: 0, y: 0 },
  eyes: { x: 0, y: 0 },
  head: { x: 0, y: 0 },
  saccade: { x: 0, y: 0, next: 0 },
  glance: { x: 0, y: 0, next: 0 },
  touch: null,              // {x, y, until}
  wordPulse: 0,
  light: 0.85,
  muted: false,
};

/* ---------- modules ---------- */
const portrait = new Portrait(el.canvas, CONFIG);
const tracker = new FaceTracker(el.video, CONFIG);
const dust = new Dust(el.dust);
const narrator = new Narrator(CONFIG, {
  onSentence: showSentence,
  onWord: (i, pulse) => { lightWords(i); if (pulse) S.wordPulse = 1; },
  onEnd: () => setState('done'),
});

let glOK = true;
portrait.init().catch((e) => {
  console.warn('[portrait] WebGL fallback:', e);
  glOK = false;
  el.body.classList.add('no-webgl');
});

/* ---------- state machine ---------- */
function setState(next) {
  if (S.state === next) return;
  S.state = next;
  el.body.dataset.state = next;
  if (next === 'idle') {
    narrator.stop();
    clearCaption();
    setPrompt(S.mode === 'touch' ? CONFIG.prompts.noCamera : CONFIG.prompts.idle,
      S.mode === 'touch' ? '' : CONFIG.prompts.idleSub);
  } else if (next === 'noticed') {
    S.noticedAt = performance.now();
    setPrompt('', '');
  } else if (next === 'speaking') {
    setPrompt('', '');
    narrator.play(CONFIG.script);
  } else if (next === 'done') {
    setPrompt(CONFIG.prompts.done, '');
    setTimeout(() => { if (S.state === 'done') clearCaption(); }, 2500);
  }
}

function updateState(now) {
  const v = tracker.viewer;
  const T = CONFIG.timing;
  if (S.mode !== 'camera') return;

  if (v.present) S.absentSince = 0;
  else if (!S.absentSince) S.absentSince = now;
  const goneFor = S.absentSince ? now - S.absentSince : 0;

  switch (S.state) {
    case 'idle':
      if (v.present) setState('noticed');
      break;
    case 'noticed':
      if (!v.present) setState('idle');
      else if (now - S.noticedAt > T.noticeDelayMs) setState('speaking');
      break;
    case 'speaking':
      if (goneFor > T.abandonAfterMs) setState('idle');
      break;
    case 'done':
      if (goneFor > T.rearmAfterMs) setState('idle');
      break;
  }
}

/* ---------- gaze targeting ---------- */
const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));
const dead = (v, z) => (Math.abs(v) < z ? 0 : (v - Math.sign(v) * z) / (1 - z));

function computeTarget(now) {
  const v = tracker.viewer;
  const tc = CONFIG.tracking;

  if (S.touch && now < S.touch.until) return { x: S.touch.x, y: S.touch.y, locked: true };

  if (S.mode === 'camera' && v.present) {
    return {
      x: clamp(dead(v.x, tc.deadZone) * tc.sensitivity.x),
      y: clamp(dead(v.y + tc.cameraOffsetY, tc.deadZone) * tc.sensitivity.y),
      locked: true,
    };
  }
  // Nobody there: occasionally glance around the room, mostly resting near centre.
  if (now > S.glance.next) {
    const g = CONFIG.motion.idleGlance;
    const rest = Math.random() < 0.4;
    S.glance.x = rest ? 0 : (Math.random() * 2 - 1) * g;
    S.glance.y = rest ? 0 : (Math.random() * 0.8 - 0.3) * g;
    S.glance.next = now + 2500 + Math.random() * 4000;
  }
  return { x: S.glance.x, y: S.glance.y, locked: false };
}

/* ---------- main loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  const M = CONFIG.motion;

  updateState(now);
  const tgt = computeTarget(now);

  // Micro-saccades keep the eyes alive while locked on a viewer.
  if (now > S.saccade.next) {
    const a = tgt.locked ? 0.05 : 0.02;
    S.saccade.x = (Math.random() * 2 - 1) * a;
    S.saccade.y = (Math.random() * 2 - 1) * a * 0.6;
    S.saccade.next = now + 600 + Math.random() * 1800;
  }

  const ke = 1 - Math.exp(-dt * M.eyeFollowRate);
  const kh = 1 - Math.exp(-dt * M.headFollowRate);
  S.eyes.x += (tgt.x + S.saccade.x - S.eyes.x) * ke;
  S.eyes.y += (tgt.y + S.saccade.y - S.eyes.y) * ke;
  S.head.x += (tgt.x - S.head.x) * kh;
  S.head.y += (tgt.y - S.head.y) * kh;

  // Speaking animation
  const speaking = S.state === 'speaking' && narrator.speaking;
  S.wordPulse = Math.max(0, S.wordPulse - dt * 4.5);
  const env = speaking ? S.wordPulse : 0;
  const mouth = env * (0.55 + 0.45 * Math.sin(t * 15.0));
  const nod = env * M.speakNod * Math.sin(t * 5.2);

  const lightTarget = { idle: 0.86, noticed: 1.02, speaking: 1.06, done: 0.98 }[S.state] ?? 1;
  S.light += (lightTarget + env * 0.03 - S.light) * (1 - Math.exp(-dt * 2.5));

  const breathe = 1 + Math.sin(t * 1.1) * M.breathe;
  const headY = S.head.y + nod;

  if (glOK) {
    portrait.render({ gaze: S.eyes, head: { x: S.head.x, y: headY }, mouth, light: S.light, time: t });
  }
  el.portraitBox.style.transform =
    `perspective(1400px) rotateY(${S.head.x * M.tiltDeg.x}deg) rotateX(${-headY * M.tiltDeg.y}deg) ` +
    (glOK ? '' : `translate(${S.head.x * 1.2}%, ${headY * 0.8}%) `) +
    `scale(${breathe})`;
  el.body.style.setProperty('--light', S.light.toFixed(3));
  el.body.style.setProperty('--look-x', S.head.x.toFixed(3));

  dust.draw(dt, t, S.light);

  // Presence indicator
  const v = tracker.viewer;
  el.presence.style.left = `${((tgt.locked ? tgt.x / CONFIG.tracking.sensitivity.x : 0) + 1) * 50}%`;
  el.body.classList.toggle('viewer-present', S.mode === 'camera' && v.present);

  if (debugOn) drawDebug(tgt);
  requestAnimationFrame(frame);
}

/* ---------- captions ---------- */
let words = [];
function showSentence(_, text) {
  el.caption.classList.remove('in');
  void el.caption.offsetWidth;
  words = [];
  el.caption.innerHTML = '';
  const re = /\S+\s*/g;
  let m;
  while ((m = re.exec(text))) {
    const span = document.createElement('span');
    span.textContent = m[0];
    el.caption.appendChild(span);
    words.push({ start: m.index, span });
  }
  el.caption.classList.add('in');
}
function lightWords(charIndex) {
  for (const w of words) w.span.classList.toggle('lit', w.start <= charIndex);
}
function clearCaption() { el.caption.classList.remove('in'); }
function setPrompt(main, sub) {
  el.prompt.textContent = main;
  el.promptSub.textContent = sub;
  el.body.classList.toggle('has-prompt', !!main);
}

/* ---------- controls ---------- */
el.mute.addEventListener('click', (e) => {
  e.stopPropagation();
  S.muted = !S.muted;
  narrator.setMuted(S.muted);
  el.mute.setAttribute('aria-pressed', S.muted);
  el.mute.setAttribute('aria-label', S.muted ? 'Unmute' : 'Mute');
});
el.replay.addEventListener('click', (e) => {
  e.stopPropagation();
  S.state = '';            // force re-entry
  setState('speaking');
});

// Touch the portrait: look at the touch point; start the welcome if not already speaking.
el.portraitBox.addEventListener('pointerdown', (e) => {
  const r = el.portraitBox.getBoundingClientRect();
  S.touch = {
    x: clamp(((e.clientX - r.left) / r.width) * 2 - 1),
    y: clamp(((e.clientY - r.top) / r.height) * 2 - 1),
    until: performance.now() + (S.mode === 'touch' ? 60000 : 2500),
  };
  if (S.state !== 'speaking') { S.state = ''; setState('speaking'); }
});

/* ---------- start-up ---------- */
async function begin() {
  el.start.classList.add('gone');
  narrator.unlock();
  requestWakeLock();
  try {
    await tracker.start();
    S.mode = 'camera';
  } catch (err) {
    console.warn('[tracker] camera unavailable → touch mode:', err);
    S.mode = 'touch';
    el.body.classList.add('touch-mode');
  }
  S.state = '';
  setState('idle');
}

el.startBtn.addEventListener('click', begin, { once: true });
if (new URLSearchParams(location.search).has('autostart')) begin();

async function requestWakeLock() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').catch(() => {});
    });
    return lock;
  } catch { /* not supported — fine */ }
}

/* ---------- kiosk hygiene ---------- */
let cursorTimer;
window.addEventListener('pointermove', () => {
  el.body.classList.remove('hide-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => el.body.classList.add('hide-cursor'), CONFIG.timing.hideCursorAfterMs);
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => { portrait.resize(); dust.resize(); });
new ResizeObserver(() => portrait.resize()).observe(el.canvas);

/* ---------- debug (D = tracking panel, C = calibrate portrait, F = fullscreen) ---------- */
let debugOn = false;
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'd') { debugOn = !debugOn; el.debug.hidden = !debugOn; }
  if (k === 'c') portrait.debug = !portrait.debug;
  if (k === 'f') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
});
function drawDebug(tgt) {
  const v = tracker.viewer;
  const b = v.box;
  el.debugBox.style.display = b ? 'block' : 'none';
  if (b) Object.assign(el.debugBox.style, {
    left: `${(1 - b.x - b.w) * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`,
  });
  el.debugText.textContent =
    `mode ${S.mode} · state ${S.state} · detector ${tracker.fps} fps\n` +
    `viewer ${v.present ? 'yes' : 'no'}  faces ${v.faces}  size ${v.size.toFixed(2)}\n` +
    `raw   x ${v.x.toFixed(2)}  y ${v.y.toFixed(2)}\n` +
    `look  x ${tgt.x.toFixed(2)}  y ${tgt.y.toFixed(2)}\n` +
    `voice ${narrator.voice?.name || '—'}`;
}

requestAnimationFrame(frame);
setState('idle');

// Handy for testing from the browser console, e.g. kiosk.tracker.viewer = { present: true, x: .6, y: 0, size: .2 }
window.kiosk = { state: S, tracker, portrait, narrator, config: CONFIG };
