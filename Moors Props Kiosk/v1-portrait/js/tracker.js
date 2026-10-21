/* ==========================================================================
   FACE TRACKER
   Webcam → MediaPipe Face Detector, entirely in the browser. Frames are
   read into the detector and discarded; nothing is recorded, stored or sent.
   Emits a normalised viewer position: x,y in -1..1 (0 = centre), size 0..1.
   ========================================================================== */

export class FaceTracker {
  constructor(video, cfg) {
    this.video = video;
    this.cfg = cfg.tracking;
    this.lastSeen = 0;
    this.viewer = { present: false, x: 0, y: 0, size: 0, faces: 0, box: null };
    this.fps = 0;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API not available');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    const vision = await import(this.cfg.visionBundle);
    const fileset = await vision.FilesetResolver.forVisionTasks(this.cfg.wasmRoot);
    const make = (delegate) => vision.FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: this.cfg.model, delegate },
      runningMode: 'VIDEO',
      minDetectionConfidence: this.cfg.minConfidence,
    });
    try { this.detector = await make('GPU'); } catch { this.detector = await make('CPU'); }

    this._loop();
  }

  _loop = () => {
    this._timer = setTimeout(this._loop, this.cfg.detectIntervalMs);
    const v = this.video;
    if (!this.detector || v.readyState < 2 || !v.videoWidth) return;
    const now = performance.now();
    let res;
    try { res = this.detector.detectForVideo(v, now); } catch { return; }
    this._frameTimes = (this._frameTimes || []).filter(t => now - t < 1000).concat(now);
    this.fps = this._frameTimes.length;

    const W = v.videoWidth, H = v.videoHeight;
    const faces = (res.detections || [])
      .map(d => d.boundingBox)
      .filter(b => b && b.width / W >= this.cfg.minFaceSize);

    if (faces.length) {
      // Follow the closest (largest) face.
      const b = faces.reduce((a, c) => (c.width > a.width ? c : a));
      let cx = (b.originX + b.width / 2) / W;
      const cy = (b.originY + b.height * 0.42) / H; // eye line, not box centre
      if (this.cfg.mirror) cx = 1 - cx;
      this.viewer = {
        present: true,
        x: cx * 2 - 1,
        y: cy * 2 - 1,
        size: b.width / W,
        faces: faces.length,
        box: { x: b.originX / W, y: b.originY / H, w: b.width / W, h: b.height / H },
      };
      this.lastSeen = now;
    } else if (now - this.lastSeen > this.cfg.lostGraceMs) {
      this.viewer = { ...this.viewer, present: false, faces: 0, box: null };
    }
  };

  stop() {
    clearTimeout(this._timer);
    this.stream?.getTracks().forEach(t => t.stop());
  }
}
