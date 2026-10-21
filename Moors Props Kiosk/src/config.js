/* ==========================================================================
   CONFIGURATION — every tunable lives here.
   ========================================================================== */

/* ==========================================================================
   TRACKING RESPONSE — how strongly the director reacts to the viewer.
   This is the main dial to turn on site.

   sensitivity:  1.5 subtle · 2.5 strong · 3.0 very strong · 3.5 extreme · 4.5 very extreme
   The viewer's offset from frame centre is multiplied by this before use,
   so a viewer only ~1/(2·sensitivity) of the frame off-centre already gets
   the full head turn.
   ========================================================================== */
export const TRACKING_CONFIG = {
  sensitivity: 3.0,

  maxHeadYaw: 35,          // degrees left/right
  maxHeadPitch: 20,        // degrees up/down
  maxHeadRoll: 8,          // degrees of curious head tilt

  maxEyeYaw: 0.35,         // iris travel, as a fraction of the eye's half-width
  maxEyePitch: 0.25,

  eyeSmoothing: 0.35,      // per 60fps frame — eyes react almost instantly
  headSmoothing: 0.18,     // head follows a beat later
  shoulderSmoothing: 0.07, // shoulders after the head
  torsoSmoothing: 0.045,   // torso last

  deadZone: 0.01,          // ignore only jitter (fraction of frame width)

  attentionBoost: 1.5,     // speed multiplier when a new viewer appears
  attentionMs: 650,        // how long the "I noticed you" burst lasts

  headFollow: 0.8,         // fraction of the look done by the head; the eyes do the rest
  eyeRangeDeg: 10,         // eye-in-head angle that maps to full maxEyeYaw/maxEyePitch
  shoulderFollow: 0.15,    // shoulders turn ~15% of the head
  torsoFollow: 0.05,       // torso turns ~5% of the head
  anticipation: 0.12,      // seconds of look-ahead from viewer velocity (eyes + head)
  overshoot: 0.10,         // extra head lead from velocity → overshoots, then settles
  maxLead: 0.22,           // cap on the velocity look-ahead (fraction of full range) so it never looks broken
  velocityDeadZone: 0.08,  // frame-widths/s of motion ignored for anticipation (filters webcam jitter)
};

/* ==========================================================================
   INTERACTION — hand tracking and the props the viewer can play with.
   ========================================================================== */
export const INTERACTION_CONFIG = {
  // Hands: camera frame → screen. gain > 1 lets a comfortable arm movement reach the screen edges.
  handGain: 1.45,
  handOffsetY: -0.05,      // shift the hand cursor up a little (hands are usually held low in frame)
  pinchOn: 0.32,           // thumb–index distance / hand size that counts as a pinch
  pinchOff: 0.46,          // must open past this to release (hysteresis stops flicker)
  handSmoothing: 0.45,     // per 60fps frame — cursor follow (higher = snappier, lower = steadier)
  handPlaneZ: 0.5,         // depth (m) of the plane the hand moves on, between viewer and director
  showSkeleton: true,      // draw the glowing hand skeleton so viewers see they're being tracked

  // Props
  grabRadius: 0.2,
  targetGrabBoost: 1.3,    // during a cue: the prop it asks for can be grabbed from a little further away…
  otherGrabFactor: 0,      // …and the others are locked (they shake: "not that one yet"). 0.3 = only a very precise pinch         // m — how close the pinch must be to pick a prop up
  hoverRadius: 0.26,
  holdStiffness: 22,       // how tightly a held prop follows the hand (per second)
  throwGain: 1.15,         // release velocity multiplier
  pushGain: 0.7,           // open-hand swipe impulse
  pushMinSpeed: 0.6,       // m/s hand speed before a swipe pushes props
  drag: 1.6,               // air drag (per second) after a throw
  gravity: 1.2,            // m/s² — gentle, theatrical fall
  bounce: 0.55,            // energy kept when bouncing off the frame edges / director
  returnAfterMs: 3500,     // a released prop floats back to its spot after this
  returnStiffness: 2.2,

  // Director's attention while props are in play
  lookBackEveryMs: [3500, 7000],  // glance from the prop back at the viewer's face…
  lookBackMs: [700, 1100],        // …for this long
  flinchSpeed: 0.9,               // m/s a prop must be moving near her head to make her flinch
};

export const CONFIG = {
  production: {
    presenter: 'Loyola University New Orleans',
    title: 'You on the Moors Now',
  },

  /* ---------------------------------------------------------------- */
  /* Director reference photo. Face landmarks, depth and the hair/head */
  /* cut-out are computed automatically from this image at start-up.  */
  /* ---------------------------------------------------------------- */
  face: {
    src: 'assets/director-reference.webp',
    faceWidthMeters: 0.152,     // cheek-to-cheek width of the 3D face
    depthScale: 0.72,           // exaggerate/flatten facial depth from landmarks
    domeDepth: 0.42,            // how rounded the skull/hair shell is (fraction of head half-width)
    neckFade: 0.13,             // where the photo fades out below the chin (fraction of face height)
    meshSegments: 150,          // resolution of the 3D face surface
    // Expression ranges (in image pixels of an 800px-wide photo; auto-scaled)
    browRaise: 3.2,
    mouthOpenMax: 20,
    jawDropMeters: 0.006,
  },

  /* ---------------------------------------------------------------- */
  /* Clothing & body                                                   */
  /* ---------------------------------------------------------------- */
  body: {
    jacket: 0x141418,
    lapel: 0x1d1d23,
    turtleneck: 0x0c0c0e,
    headset: 0x2a2a2e,
    clipboard: 0x6b4a2e,
    skinFallback: 0xd9a58e,    // used if the skin tone can't be sampled from the photo
    hairFallback: 0x3b2a20,
  },

  /* ---------------------------------------------------------------- */
  /* Tracking                                                          */
  /* ---------------------------------------------------------------- */
  tracking: {
    mirror: true,               // front-facing webcam
    detectIntervalMs: 40,       // ~25 detections/s; the cursor is smoothed in between
    videoWidth: 480, videoHeight: 360,
    lostAfterMs: 400,           // short dropouts are ignored
    minFaceWidth: 0.06,         // ignore faces further away than this (fraction of frame width)
    // distance: 0 = very close, 1 = far. Derived from face width in the frame.
    nearFaceWidth: 0.42,
    farFaceWidth: 0.08,
    cameraOffsetY: -0.08,       // webcam above the screen → visitors appear low; compensate
    visionBundle: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs',
    wasmRoot: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
    faceModel: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    handModel: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    trackHands: true,
    trackFace: false,           // face tracking is only needed for the director; off saves ~9 ms per check
    useWorker: true,            // run detection in a background thread (smooth rendering)
    faceEvery: 2,               // run face detection every Nth tick (hands run every tick)
    handLostAfterMs: 250,
    // ONE visitor at a time: only one hand drives the stage
    detectHands: 2,             // hands the camera looks for (so it can ignore the extras); 1 = lightest
    minHandSize: 0.07,          // ignore hands smaller than this (far-off passers-by), fraction of frame height
    handSwitchDist: 0.25,       // a hand jumping further than this (screen fraction) is someone else's
    segmentModel: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
  },

  /* ---------------------------------------------------------------- */
  /* Motion — head limits (degrees), smoothing, eye/head coordination  */
  /* ---------------------------------------------------------------- */
  motion: {
    neckShare: 0.35,                     // fraction of head rotation taken by the neck joint
    cameraParallax: { x: 0.10, y: 0.05 },// virtual camera drift (metres) with visitor position
    blinkEveryMs: [2600, 6000],
    glanceAwayEveryMs: [7000, 14000],    // idle only — never while a viewer is being tracked
  },

  /* ---------------------------------------------------------------- */
  /* Experience timing                                                 */
  /* ---------------------------------------------------------------- */
  timing: {
    noticeDelayMs: 1500,        // look at the visitor this long before speaking
    leaveAfterMs: 7000,         // no face this long → finish sentence, return to idle
    rearmAfterMs: 4000,         // after the welcome, wait for the visitor to leave this long
    noCameraMessageMs: 4500,
    paragraphPauseMs: 550,
  },

  voice: {
    lang: 'en-US',
    rate: 0.95,
    pitch: 1.02,
    preferred: [
      'Ava (Premium)', 'Ava (Enhanced)', 'Zoe (Premium)', 'Samantha (Enhanced)',
      'Microsoft Aria Online', 'Microsoft Jenny Online', 'Microsoft Ava Online',
      'Google US English', 'Samantha', 'Ava', 'Allison',
    ],
  },

  trackingResponse: TRACKING_CONFIG,
  interaction: INTERACTION_CONFIG,

  experience: {
    director: false,         // the director character is off: the kiosk is hand tracking + props only
    speech: false,           // her welcome speech (only used when director is true)
  },

  /* ---------------------------------------------------------------- */
  /* Intro — shown whenever no hand is detected. Edit the words freely. */
  /* ---------------------------------------------------------------- */
  intro: {
    lines: [
      'The rehearsal is over. The stage is not quite empty.',
      'Someone left a few things behind.',
      'A handkerchief. A ribbon. A cup of tea.',
      'And, somehow, s’mores.',
      'The show starts soon — and the stage crew needs a hand.',
    ],
    cta: 'Raise a hand to begin',
    ctaSub: 'Takes about a minute',
    ctaTouch: 'Touch the stage to begin',   // shown instead when there is no camera
    lineMs: 3600,            // how long each line stays up
    returnAfterMs: 5000,     // no hand for this long → lights dim, intro returns
    dimExposure: 0.62,       // stage brightness while the intro is up…
    liveExposure: 1.05,      // …and once a hand takes the stage
  },

  /* ---------------------------------------------------------------- */
  /* Cues — the short task each visitor plays through, one at a time.  */
  /* check: 'wave' | 'deliver' | 'fire' | 'twirl' (see src/cues.js)    */
  /* ---------------------------------------------------------------- */
  cues: {
    steps: [
      { prop: 'handkerchief', check: 'wave', count: 5,
        title: 'Signal the stage crew', text: 'Pick up the handkerchief and wave it.',
        hint: 'Wave it side to side!', done: 'Signal received.' },
      { prop: 'teacup', check: 'deliver',
        title: 'Set the tea', text: 'Carry the teacup to the glowing mark — gently.',
        hint: 'Slowly, or it will spill…', spillHint: 'Careful — it’s spilling!',
        done: 'Tea is served. Not a drop spilled.', doneSpilled: 'Tea is served. Mostly.' },
      { prop: 'smores', check: 'fire',
        title: 'Light the campfire', text: 'Hold the s’more until it catches fire…',
        hint: 'Keep holding it — it’s toasting.', text2: '…now shake it to put it out!', hint2: 'Shake it hard!',
        done: 'Toasted to perfection.' },
      { prop: 'ribbon', check: 'twirl', turns: 1,
        title: 'Tie it all together', text: 'Twirl the ribbon in a big circle.',
        hint: 'Round and round!', done: 'Beautifully done.' },
    ],
    // warm-up: a few seconds to play with anything before the cues begin
    warmup: { kicker: 'Warm-up', title: 'Try it out', text: 'Pinch to pick anything up — move it, shake it, toss it.',
      hint: 'Your first cue is coming up…', ms: 6000, maxMs: 11000,   // waits (up to maxMs) for them to put a prop down
      toast: 'Nice! Now the real thing', toastSub: '4 quick cues to set the scene' },
    nudgeMs: 7000,            // no luck with the glowing prop this long → a clearer hint
    nudge: 'Reach toward the glow, then pinch your thumb and finger together.',
    cheers: ['Halfway there!', 'That’s it — keep going!', 'Ooh, nice!', 'Almost…'],
    pinchHint: 'Pinch your fingers to pick it up.',
    blockedHint: 'Not that one yet — try the glowing one.',
    listTitle: 'Tonight’s cues',
    listDone: 'Scene set ✓',
    lastToGo: 'That’s the last one!',
    freePlay: 'The stage is yours — pick up anything and play.',
    freePlaySub: 'Stay as long as you like',
    // free play: little "try this" ideas, rotated under the banner to keep people playing
    tryThis: [
      'Try: toss the handkerchief and watch it drift down',
      'Try: toast another s’more — then shake it out',
      'Try: draw loops in the air with the ribbon',
      'Try: whip the teacup around and watch it spill',
      'Try: fling a prop across the stage',
    ],
    tryEveryMs: 6500,
    markAt: [0.6, 0.5],       // where the tea mark sits on screen (0..1)
    pauseMs: 2200,            // pause on the "done" line before the next cue
    finale: ['Places, everyone.', 'You set the scene. The stage is yours.'],
    finaleMs: 6000,           // finale on screen, then free play
  },

  /* Standby demo: a ghost hand shows passers-by what to do */
  attract: {
    enabled: true,
    order: ['teacup', 'ribbon', 'handkerchief', 'smores'],
    startDelay: 2.5,          // seconds after the stage empties before the demo starts
    betweenDelay: 1.2,        // pause between props
    restartDelay: 3,          // after a visitor leaves
    handSize: 1.0,            // ghost hand size (1 ≈ a quarter of the screen height)
  },

  /* One quiet line when a prop is picked up during free play (set whispers: null to turn off) */
  whispers: {
    handkerchief: 'Dropped, perhaps on purpose.',
    ribbon: 'Tied neatly. For now.',
    teacup: 'Mind your manners. Or don’t.',
    smores: 'Not every story ends in a drawing room.',
  },

  ui: {
    instruction: 'Step in front of the screen.',
    raiseHand: 'Raise your hand.',
    pinchHint: 'Pinch to pick something up.',
    noCamera: 'Camera tracking is unavailable. Touch the stage to play.',
    captions: true,
  },

  render: {
    maxRenderPixels: 2400000,// pixel budget (≈ 2070×1160). Big/Retina screens render this many and scale up.
                             // Raise on a fast machine for sharper edges; lower if it still stutters.
    maxPixelRatio: 1.25,     // upper limit; drops automatically if frames run slow
    minPixelRatio: 0.7,      // lowest the automatic scaling will go
    antialias: true,         // smooth edges (cheap at the pixel budget above)
    adaptive: true,          // lower/raise resolution to hold a smooth frame rate
    shadows: false,          // off: no visible benefit without the director, real cost on big screens
    dust: 120,
  },

  script: [
    'Welcome to You on the Moors Now. I’m so glad you’re here and excited to share this production with you.',
    'This play takes familiar stories of love, independence, and expectations and turns them completely on their head. As you watch, I invite you to question what you think you know and enjoy the unexpected.',
    'But the experience doesn’t begin when you take your seat. Throughout this space, you’ll find interactive elements created by students in Loyola’s Human Centered Design class. Take some time to explore them, discover more about the production, and see how their work connects the audience to the world of the play.',
    'And at the bottom of the stairs, you’ll find a projection-mapping installation created by students who have worked on it throughout the semester. It’s another way to experience the ideas and atmosphere of this production beyond the stage.',
    'So take a look around, interact, explore, and most importantly, enjoy You on the Moors Now. Thank you for being here, and welcome to the theatre.',
  ],
};
