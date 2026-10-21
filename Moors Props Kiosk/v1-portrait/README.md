# You on the Moors Now — Director Kiosk

A portrait of the director that notices whoever walks up, looks at them, and speaks a welcome.
It runs in the browser on plain HTML/CSS/JS. There's no build step, backend, login or database.

## Run it

The page has to be served from `localhost`. Camera access and WebGL image loading don't work from `file://`.

- **Quick:** double-click `start-kiosk.command`. It starts a local server and opens Chrome in full-screen kiosk mode with `?autostart`.
  The first time, Chrome asks for camera permission. Allow it once and the kiosk profile remembers it.
- **Manual:** run `python3 -m http.server 8765` in this folder, then open `http://localhost:8765`.
  You need to tap **Touch to begin** once, because browsers only allow sound after a tap.

Keys: **D** shows the tracking debug panel · **C** shows where the eye and mouth regions sit on the portrait · **F** toggles fullscreen.

## How it works

| File | What it does |
|---|---|
| `js/config.js` | **Edit this one.** Portrait, landmarks, script, voice, sensitivity, timing, prompts |
| `css/kiosk.css` | Visual design. Colour and type tokens are at the top |
| `js/portrait.js` | WebGL shader that warps the photo. The irises slide inside the eye openings, the face shifts with a depth falloff to suggest a head turn, and the lower lip moves slightly while speaking. It also grades the image like a follow-spot |
| `js/tracker.js` | MediaPipe face detection on webcam frames, in the browser |
| `js/voice.js` | Browser text-to-speech, spoken one sentence at a time, with word-timed captions |
| `js/main.js` | State machine (idle → noticed → speaking → done), smoothing, and UI |
| `js/stage.js` | Dust drifting in the spotlight |

The eyes follow quickly and the head follows more slowly, the way a person turns. Small eye movements
keep the gaze alive. When nobody is there, the director looks around the room.

## Common changes

- **New portrait:** replace `assets/director.webp` and set `portrait.src`, `width`, `height`. Then update the
  landmark pixel coordinates (iris centres, nose, mouth, face). Press **C** to check the alignment.
  The cyan areas should sit just inside each eye opening.
- **Script:** `CONFIG.script` takes one string per paragraph.
- **Sensitivity:** `tracking.sensitivity` sets how far the director looks for a given viewer offset.
  `tracking.cameraOffsetY` corrects for a camera mounted above the screen. `tracking.mirror` matches the camera orientation.
- **Subtlety:** use `motion.eyeShift`, `headShift` and `tiltDeg`. Set `mouthMotion` to `0` to turn lip movement off.
- **Who triggers it:** `tracking.minFaceSize` ignores people far away. Raise it so only someone close starts the welcome.
- **Voice:** `voice.preferred` lists voice names in order of preference. On macOS, install a better voice under
  System Settings → Accessibility → Spoken Content → System Voice → Manage Voices (for example, "Ava (Premium)").
  Press **D** to see which voice is in use.

## Privacy

Camera frames go to the face detector in the browser and are thrown away. Nothing is recorded, stored or sent.
The detector's code and model file are downloaded from a CDN the first time. For a kiosk that runs fully offline, download the
three URLs in `CONFIG.tracking` (`vision_bundle.mjs`, the `wasm/` folder, and the `.tflite` model) into this folder.
Then point the config at the local copies.

## Fallbacks

- **Camera denied or missing:** the kiosk switches to touch mode. A tap on the portrait starts the welcome and the director looks at the spot that was touched.
- **No WebGL:** a plain masked image with a gentle CSS tilt is shown.
- **No speech engine:** captions play on a timer.
