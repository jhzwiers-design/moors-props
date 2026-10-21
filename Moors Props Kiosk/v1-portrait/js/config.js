/* ==========================================================================
   KIOSK CONFIGURATION
   Everything you are likely to change lives in this one file:
   portrait, face landmarks, script, voice, tracking sensitivity, timing.
   ========================================================================== */

export const CONFIG = {
  /* ------------------------------------------------------------------ */
  /* Production text                                                      */
  /* ------------------------------------------------------------------ */
  production: {
    presenter: 'Loyola University New Orleans',
    titleLines: ['You on the', 'Moors Now'],
    directorName: '',            // e.g. 'Jane Doe' — shown under the portrait
    directorRole: 'Director',
  },

  /* ------------------------------------------------------------------ */
  /* Portrait                                                             */
  /* To swap the portrait: replace the file, then update the landmark     */
  /* pixel coordinates below (measured on the ORIGINAL image). Press "C"  */
  /* in the kiosk to see the eye/mouth/face regions drawn on the image.   */
  /* ------------------------------------------------------------------ */
  portrait: {
    src: 'director.webp',
    width: 800,                  // natural pixel size of the image
    height: 800,

    eyeLeft:  { x: 267, y: 336 },   // centre of the iris on the viewer's left
    eyeRight: { x: 435, y: 337 },   // centre of the iris on the viewer's right
    eyeRadius: { x: 36, y: 17 },    // half-size of the visible eye opening
    nose:  { x: 332, y: 440 },      // tip of the nose (closest point to camera)
    mouth: { x: 342, y: 522 },      // centre of the lip line
    mouthRadius: { x: 72, y: 36 },
    face:  { x: 350, y: 410 },      // centre of the face
    faceRadius: 300,                // roughly chin-to-forehead radius

    // Spotlight / vignette that fades the photo background into the stage
    vignetteCenter: { x: 370, y: 440 },
    vignetteRadius: { x: 390, y: 450 },
  },

  /* ------------------------------------------------------------------ */
  /* Motion (in image pixels unless noted). Keep these subtle.            */
  /* ------------------------------------------------------------------ */
  motion: {
    eyeShift:  { x: 4.5, y: 2.6 },  // max iris travel
    headShift: { x: 13,  y: 8 },    // max pseudo-3D turn of the face
    tiltDeg:   { x: 3.2, y: 2.2 },  // extra CSS 3D tilt of the whole portrait
    eyeFollowRate: 12,              // higher = eyes snap faster (per second)
    headFollowRate: 3.2,            // head lags behind the eyes, like a person
    mouthMotion: 1.6,               // px of lower-lip movement while speaking (0 = off)
    speakNod: 0.07,                 // tiny nods on stressed words (0 = off)
    breathe: 0.004,                 // idle breathing scale
    idleGlance: 0.32,               // how far the director looks around when nobody is there
  },

  /* ------------------------------------------------------------------ */
  /* Tracking                                                             */
  /* ------------------------------------------------------------------ */
  tracking: {
    sensitivity: { x: 1.35, y: 1.2 }, // multiply viewer offset before mapping
    deadZone: 0.04,                   // ignore tiny movement around centre
    mirror: true,                     // true for a front-facing camera
    cameraOffsetY: -0.15,             // camera sits ABOVE the screen: shift neutral gaze
    minFaceSize: 0.07,                // ignore faces smaller than this (fraction of frame width) = far away
    detectIntervalMs: 33,             // run detector at ~30 fps
    lostGraceMs: 900,                 // keep looking at the last spot this long after losing the face
    minConfidence: 0.55,
    // MediaPipe assets. For a fully offline kiosk, download these and point to local copies.
    visionBundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
    wasmRoot:     'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    model:        'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  },

  /* ------------------------------------------------------------------ */
  /* Experience timing                                                    */
  /* ------------------------------------------------------------------ */
  timing: {
    noticeDelayMs: 900,       // viewer must stay this long before the director speaks
    abandonAfterMs: 7000,     // viewer gone this long mid-speech → stop and reset
    rearmAfterMs: 5000,       // after the welcome, viewer must leave this long before it can play again
    paragraphPauseMs: 520,
    hideCursorAfterMs: 2500,
  },

  /* ------------------------------------------------------------------ */
  /* Voice (browser text-to-speech)                                       */
  /* ------------------------------------------------------------------ */
  voice: {
    lang: 'en-US',
    rate: 0.94,
    pitch: 1.0,
    // First match wins (substring match on the voice name). Natural/enhanced voices first.
    preferred: [
      'Ava (Premium)', 'Ava (Enhanced)', 'Zoe (Premium)', 'Samantha (Enhanced)',
      'Microsoft Aria Online', 'Microsoft Jenny Online', 'Microsoft Ava Online',
      'Google US English', 'Samantha', 'Ava', 'Allison',
    ],
  },

  /* ------------------------------------------------------------------ */
  /* The welcome script — one string per paragraph.                       */
  /* ------------------------------------------------------------------ */
  script: [
    'Welcome to You on the Moors Now. I’m so glad you’re here and excited to share this production with you.',
    'This play takes familiar stories of love, independence, and expectations and turns them completely on their head. As you watch, I invite you to question what you think you know and enjoy the unexpected.',
    'But the experience doesn’t begin when you take your seat. Throughout this space, you’ll find interactive elements created by students in Loyola’s Human Centered Design class. Take some time to explore them, discover more about the production, and see how their work connects the audience to the world of the play.',
    'And at the bottom of the stairs, you’ll find a projection-mapping installation created by students who have worked on it throughout the semester. It’s another way to experience the ideas and atmosphere of this production beyond the stage.',
    'So take a look around, interact, explore, and most importantly, enjoy You on the Moors Now. Thank you for being here, and welcome to the theatre.',
  ],

  /* On-screen prompts */
  prompts: {
    idle: 'Come closer.',
    idleSub: 'The director would like a word.',
    done: 'Enjoy the show.',
    noCamera: 'Touch the portrait to be welcomed.',
  },
};
