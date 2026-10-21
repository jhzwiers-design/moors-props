/* ==========================================================================
   TRACKING — webcam → MediaPipe Face Landmarker + Hand Landmarker,
   locally in the browser. The video element is never shown; frames are
   analysed and discarded. Nothing is recorded, stored or uploaded.

   Face output (normalised 0..1, from the VISITOR's point of view):
     data = { faceDetected, x, y, distance, vx, vy }
       x: 0 = visitor at the left edge of the screen, 1 = right edge
       y: 0 = top, 1 = bottom
       distance: 0 = very close, 1 = far away
       vx, vy: smoothed velocity in frame-widths per second (for anticipation)

   Hand output (up to two, already mapped to SCREEN space 0..1):
     hands[i] = { id, present, sx, sy, pinch, pinchAmount, pts }
       sx, sy: the pinch point (between thumb and index tips)
       pinch:  true while thumb and index are pinched (with hysteresis)
       pts:    Float32Array(42) — all 21 landmarks as screen x,y pairs

   Objects are updated in place every detection (no per-frame garbage).

   Performance: detection runs in a Web Worker (trackingWorker.js) so the
   render loop never waits for it; the main thread only hands over a video
   frame (~0.1 ms). If the worker can't start, it falls back to running
   MediaPipe on the main thread. Face tracking is optional (CONFIG.tracking.trackFace).
   ========================================================================== */
import { CONFIG, INTERACTION_CONFIG as IC } from './config.js';
import { loadVision } from './vision.js';

const T = CONFIG.tracking;

const makeHand = (id) => ({ id, label: '', present: false, sx: 0.5, sy: 0.5, pinch: false, pinchAmount: 0, pts: new Float32Array(42), lastSeen: 0 });

export class Tracker {
  constructor() {
    this.data = { faceDetected: false, x: 0.5, y: 0.5, distance: 0.5, vx: 0, vy: 0 };
    this.hands = [makeHand('hand0')];   // one hand at a time: busy rooms are full of hands
    this.prev = { x: 0.5, y: 0.5, t: 0, valid: false };
    this.faces = 0;
    this.fps = 0;
    this.lastSeen = 0;
    this.running = false;
    this._n = 0;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute('playsinline', '');
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // small frames are plenty: the hand model works at 224 px internally; less to copy each frame
      video: { facingMode: 'user', width: { ideal: T.videoWidth }, height: { ideal: T.videoHeight }, frameRate: { ideal: 30 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    if (await this._startWorker()) { this.running = true; this._tick(); return; }

    // Fallback: run MediaPipe on the main thread
    const { vision, fileset } = await loadVision();
    const create = async (Task, options) => {
      try { return await Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } }); }
      catch { return Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }); }
    };
    if (T.trackFace) this.landmarker = await create(vision.FaceLandmarker, {
      baseOptions: { modelAssetPath: T.faceModel },
      runningMode: 'VIDEO', numFaces: 3,
      minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    if (T.trackHands) {
      this.handLandmarker = await create(vision.HandLandmarker, {
        baseOptions: { modelAssetPath: T.handModel },
        runningMode: 'VIDEO', numHands: T.detectHands,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
    }
    this.running = true;
    this._tick();
  }

  /** Start the background worker; resolves false if it isn't available. */
  _startWorker() {
    if (!T.useWorker || typeof Worker === 'undefined' || typeof createImageBitmap === 'undefined') return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      try {
        // classic (not module) worker: MediaPipe's loader needs importScripts()
        this.worker = new Worker(new URL('./trackingWorker.js', import.meta.url));
      } catch { return done(false); }
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'ready') done(true);
        else if (m.type === 'error') { console.warn('[tracker] worker failed, using main thread:', m.message); this.worker.terminate(); this.worker = null; done(false); }
        else if (m.type === 'result') this._onWorkerResult(m);
      };
      this.worker.onerror = () => { this.worker?.terminate(); this.worker = null; done(false); };
      this.worker.postMessage({
        type: 'init', bundle: T.visionBundle, wasmRoot: T.wasmRoot,
        handModel: T.trackHands ? T.handModel : null, numHands: T.detectHands, faceModel: T.trackFace ? T.faceModel : null,
      });
      setTimeout(() => { if (!settled) { this.worker?.terminate(); this.worker = null; done(false); } }, 30000);
    });
  }

  _onWorkerResult(m) {
    this.busy = false;
    this.detectMs = m.ms;
    const now = performance.now();
    if (m.hands) this._hands({ landmarks: m.hands.landmarks, handedness: m.hands.handedness.map((n) => [{ categoryName: n }]) }, now);
    if (m.faces) this._face(m.faces, now);
  }

  _tick = () => {
    if (!this.running) return;
    this._timer = setTimeout(this._tick, T.detectIntervalMs);
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    const now = performance.now();
    this._n++;

    if (this.worker) {
      // one frame in flight at a time; skip if the worker is still busy
      if (this.busy && now - this.sentAt < 1000) return;
      this.busy = true; this.sentAt = now;
      this._count(now);
      const doFace = T.trackFace && this._n % T.faceEvery === 0;
      createImageBitmap(v).then((bitmap) => {
        if (!this.worker) { bitmap.close(); return; }
        this.worker.postMessage({ type: 'frame', bitmap, ts: now, doFace }, [bitmap]);
      }).catch(() => { this.busy = false; });
      return;
    }

    // main-thread fallback (MediaPipe needs strictly increasing timestamps per task)
    this._count(now);
    if (this.handLandmarker) {
      try { this._hands(this.handLandmarker.detectForVideo(v, now), now); } catch { /* keep going */ }
    }
    if (this.landmarker && (!this.handLandmarker || this._n % T.faceEvery === 0)) {
      try {
        const res = this.landmarker.detectForVideo(v, now + 0.1);
        this._face((res.faceLandmarks || []).map((lm) => ({ x: lm[168].x, y: lm[168].y, w: Math.abs(lm[454].x - lm[234].x) })), now);
      } catch { /* keep going */ }
    }
  };

  _count(now) {
    this._times = (this._times || []).filter((t) => now - t < 1000); this._times.push(now);
    this.fps = this._times.length;
  }

  /** faces: [{ x, y, w }] — centre between the eyes (0..1) and face width */
  _face(faces, now) {
    // Pick the closest (widest) face
    let best = null, bestW = 0;
    for (const f of faces) if (f.w > bestW) { bestW = f.w; best = f; }
    this.faces = faces.length;

    if (best && bestW >= T.minFaceWidth) {
      const c = best;
      const x = T.mirror ? 1 - c.x : c.x;
      const y = Math.min(1, Math.max(0, c.y + T.cameraOffsetY));
      const d = this.data, p = this.prev;
      // Velocity between detections (frame-widths / s), lightly smoothed
      if (p.valid) {
        const dts = Math.max(0.016, (now - p.t) / 1000);
        d.vx = d.vx * 0.45 + ((x - p.x) / dts) * 0.55;
        d.vy = d.vy * 0.45 + ((y - p.y) / dts) * 0.55;
        d.vx = Math.max(-3, Math.min(3, d.vx));
        d.vy = Math.max(-3, Math.min(3, d.vy));
      } else { d.vx = 0; d.vy = 0; }
      p.x = x; p.y = y; p.t = now; p.valid = true;
      d.faceDetected = true; d.x = x; d.y = y;
      d.distance = clamp01((bestW - T.nearFaceWidth) / (T.farFaceWidth - T.nearFaceWidth));
      this.lastSeen = now;
    } else if (now - this.lastSeen > T.lostAfterMs) {
      this.data.faceDetected = false;
      this.data.vx = 0; this.data.vy = 0;
      this.prev.valid = false;
    }
  }

  /**
   * Only ONE hand drives the stage. Several may be in view (crowds, passers-by);
   * we stay with the hand we already follow, and otherwise pick the biggest
   * (nearest the screen). Small, far-away hands are ignored.
   */
  _hands(res, now) {
    const list = res.landmarks || [];
    const aspect = this.video.videoWidth / this.video.videoHeight || 4 / 3;
    const h = this.hands[0];
    let pick = null, best = Infinity;
    for (const lm of list) {
      const size = Math.hypot((lm[0].x - lm[9].x) * aspect, lm[0].y - lm[9].y);
      if (size < T.minHandSize) continue;
      const sx = toScreenX((lm[4].x + lm[8].x) / 2), sy = toScreenY((lm[4].y + lm[8].y) / 2);
      // following someone: the hand closest to where theirs just was; otherwise the biggest
      const score = h.present ? Math.hypot(sx - h.sx, sy - h.sy) : -size;
      if (h.present && score > T.handSwitchDist) continue;
      if (score < best) { best = score; pick = { lm, size, sx, sy }; }
    }
    if (!pick) {
      if (h.present && now - h.lastSeen > T.handLostAfterMs) { h.present = false; h.pinch = false; }
      return;
    }
    const { lm } = pick;
    for (let j = 0; j < 21; j++) {
      h.pts[j * 2] = toScreenX(lm[j].x);
      h.pts[j * 2 + 1] = toScreenY(lm[j].y);
    }
    // Pinch = thumb tip ↔ index tip, relative to hand size (wrist ↔ middle knuckle)
    const dist = (a, b) => Math.hypot((lm[a].x - lm[b].x) * aspect, lm[a].y - lm[b].y);
    const ratio = dist(4, 8) / Math.max(1e-4, pick.size);
    h.pinch = h.pinch ? ratio < IC.pinchOff : ratio < IC.pinchOn;
    h.pinchAmount = clamp01((IC.pinchOff + 0.15 - ratio) / (IC.pinchOff + 0.15 - IC.pinchOn * 0.6));
    h.sx = pick.sx;
    h.sy = pick.sy;
    h.present = true;
    h.lastSeen = now;
  }

  stop() {
    this.running = false;
    this.worker?.terminate();
    clearTimeout(this._timer);
    this.stream?.getTracks().forEach((t) => t.stop());
  }
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const toScreenX = (x) => clamp01(0.5 + ((T.mirror ? 1 - x : x) - 0.5) * IC.handGain);
const toScreenY = (y) => clamp01(0.5 + (y - 0.5) * IC.handGain + IC.handOffsetY);
