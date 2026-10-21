/* Shared MediaPipe loader — the WASM runtime is loaded once and reused by
   the photo analysis (face.js) and the live webcam tracker (tracking.js). */
import { CONFIG } from './config.js';

let pending = null;
export function loadVision() {
  if (!pending) {
    pending = (async () => {
      const vision = await import(CONFIG.tracking.visionBundle);
      const fileset = await vision.FilesetResolver.forVisionTasks(CONFIG.tracking.wasmRoot);
      return { vision, fileset };
    })();
  }
  return pending;
}
