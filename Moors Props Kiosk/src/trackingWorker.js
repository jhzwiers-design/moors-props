/* ==========================================================================
   TRACKING WORKER — runs MediaPipe off the main thread so rendering never
   waits for the camera. Receives video frames as ImageBitmaps, returns
   landmarks only. Frames are closed immediately; nothing is stored.
   ========================================================================== */
let hands = null, face = null;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const vision = await import(m.bundle);
      const fileset = await vision.FilesetResolver.forVisionTasks(m.wasmRoot);
      const create = async (Task, options) => {
        try { return await Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } }); }
        catch { return Task.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }); }
      };
      hands = await create(vision.HandLandmarker, {
        baseOptions: { modelAssetPath: m.handModel }, runningMode: 'VIDEO', numHands: m.numHands || 1,
        minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      if (m.faceModel) {
        face = await create(vision.FaceLandmarker, {
          baseOptions: { modelAssetPath: m.faceModel }, runningMode: 'VIDEO', numFaces: 3,
          minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        });
      }
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
    return;
  }

  if (m.type === 'frame') {
    const out = { type: 'result', ts: m.ts, hands: null, faces: null, ms: 0 };
    const t0 = performance.now();
    try {
      const h = hands.detectForVideo(m.bitmap, m.ts);
      out.hands = {
        landmarks: h.landmarks || [],
        handedness: (h.handednesses || h.handedness || []).map((c) => c?.[0]?.categoryName || ''),
      };
      if (m.doFace && face) {
        const f = face.detectForVideo(m.bitmap, m.ts + 0.1);
        // only what the kiosk needs: centre between the eyes + face width
        out.faces = (f.faceLandmarks || []).map((lm) => ({ x: lm[168].x, y: lm[168].y, w: Math.abs(lm[454].x - lm[234].x) }));
      }
    } catch { /* skip this frame */ }
    m.bitmap.close();
    out.ms = performance.now() - t0;
    self.postMessage(out);
  }
};
