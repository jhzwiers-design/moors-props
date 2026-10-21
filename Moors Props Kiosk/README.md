# You on the Moors Now: 3D Director Kiosk (prototype)

## Current experience: hand tracking and props

The kiosk now showcases motion tracking only: there is no director character and no speech. `experience.director: false` in `src/config.js` turns her off, and then her photo analysis, 3D body and animation are never loaded. Setting it to `true` brings her back; `experience.speech: true` then brings back her welcome too.

With no sound to unlock, the page starts straight away with no "Touch to begin" screen.

- The webcam tracks the visitor's **hands**, which appear on stage as a glowing hand skeleton with a ring at the pinch point.
- Four props from the production float on stage: a handkerchief, a ribbon, a teacup and saucer, and a s'more.
- **Pinch** (thumb to index finger) over a prop to pick it up. Move it, then open your hand to throw it.
- An **open-hand swipe** knocks props away.
- Props fall gently, bounce off the screen edges and each other, then float back to their spots.
- **Mouse and touch work as a hand too**, with or without a camera. Moving is hovering and pressing is pinching.
- **One hand at a time:** busy rooms are full of hands, so only one drives the stage. The camera stays with the hand it is following; when that hand leaves, the biggest (nearest) hand takes over. Small, far-off hands of passers-by are ignored. Tune `detectHands`, `minHandSize` and `handSwitchDist` in `CONFIG.tracking`.
- **Warm-up:** for the first ~6 seconds every prop is unlocked and glowing ("Try it out"), so visitors see they can grab anything. If they're holding something it waits for them to put it down (up to 11 s), then the cues begin. Edit in `CONFIG.cues.warmup`.
- **Cues (what to do):** each visitor plays four short "stage cues" to set the scene before curtain. If someone hasn't picked up the glowing prop after 7 s, the tip spells out how; halfway through a cue they get a little cheer.
  1. *Signal the stage crew:* wave the handkerchief.
  2. *Set the tea:* carry the teacup to the glowing mark. Rushing it spills the tea, and that's noticed.
  3. *Light the campfire:* hold the s'more until it catches fire, then shake it out.
  4. *Tie it all together:* twirl the ribbon in a circle.

  Making it clear what to do:
  - **Only the cue's prop can be picked up.** The others are locked and give a little shake with *"Not that one yet — try the glowing one."* Set `otherGrabFactor` to 0.3 in `INTERACTION_CONFIG` to allow a very precise pinch instead. The target's grab zone is slightly larger (`targetGrabBoost`).
  - The **target prop glows strongly**, pulses and has sparkles circling it. The other props shrink slightly and go quiet.
  - A **guide line** of flowing dots runs from the visitor's hand to the target until they pick it up.
  - A **cue card** at the top shows the task, a live tip and a progress bar. A **checklist** ("Tonight's cues") down the left ticks off each step.
  - A **"Cue N complete · N to go"** moment appears in the middle of the stage after each step.
  - After the fourth cue comes the **finale** ("Places, everyone. You set the scene. The stage is yours."). Then **free play**: a lasting banner, *"The stage is yours — pick up anything and play. Stay as long as you like"*, every prop unlocks and glows softly, the checklist reads "Scene set ✓", and the prop captions return. Under the banner a "Try: …" idea changes every few seconds (`CONFIG.cues.tryThis`) to keep people playing.

  Everything resets when the next visitor arrives. Edit all the wording and timings in `CONFIG.cues`; the checks live in `src/cues.js`.
- **Standby demo:** while nobody is at the kiosk, a glowing ghost hand (`src/attract.js`) drifts in, pinches a prop, shows off what it does (carries the tea, twirls the ribbon, waves the handkerchief, warms the s'more), sets it down and moves on. It never counts as a visitor and vanishes the moment a real hand appears. Settings are in `CONFIG.attract`.
- **Intro:** whenever no hand is on stage, the stage dims and an intro card appears over the floating props. It shows the title and a short sequence of narrative lines ("The rehearsal is over…"), ending with "Raise a hand to begin". When a hand appears, the lights come up and the intro fades away. It returns after `intro.returnAfterMs` with no hand. Edit the lines, timing and brightness in `CONFIG.intro`.
- **Prop reactions:** each prop reacts in its own way while held.
  - The **handkerchief** ripples and streams behind your hand, and waving it leaves a soft shimmer. Let go and it floats down slowly, swaying like real cloth.
  - The **ribbon**'s tails trail and twist, and moving it draws glowing ribbons through the air, like ribbon dancing.
  - The **teacup**'s steam spirals up. Move it too fast and tea sloshes out in droplets and the cup empties a little. Set it down and it refills.
  - The **s'more**'s marshmallow toasts golden brown over about 5 s, then catches fire. Shake it hard to blow it out in a puff of smoke; it relights after another 4 s of holding. Set down, it slowly turns fresh again.

  Every grab sets off a small burst of sparks, and a soft spotlight dims everything except the held prop. **While a prop is held, every other prop stays exactly where it is.** Nothing bumps, gets swiped, floats home or tumbles, so nothing interferes with the held prop, and it passes through the others. Neighbours still glow softly when the held prop comes close. Once it's let go, everything floats home. Reactions live in each prop's builder in `src/props.js`, and the particle types (embers, flames, steam, smoke, tea drops, sparks, shimmer, glow) and the glowing motion trails are in `src/effects.js`.
- **Prop lines:** picking up a prop shows one quiet line tied to the play's themes. Edit them in `CONFIG.whispers`, or set `whispers: null` to turn them off.
- Instructions adapt as people go: "Step in front of the screen.", then "Raise your hand.", then "Pinch to pick something up."

Adjust hand gain, pinch thresholds, throw strength, gravity and return time in `INTERACTION_CONFIG` in `src/config.js`. Change or add props in `src/props.js`, where each prop is one builder function plus a home position on screen.


A Three.js digital character built from the director's photo. It notices a visitor through the webcam, looks at them, and speaks the welcome.
It's plain HTML/JS with no build step or backend.

## Run

Double-click `start-kiosk.command`. It serves this folder on `localhost:8765` using `serve.py`, which turns off browser caching so edits always show up and opens Chrome in kiosk mode with sound allowed.
Approve the camera prompt once.

To run it by hand, run `python3 serve.py` in this folder and open `http://localhost:8765`. Then tap once (browsers need a tap before playing sound).

Staff keys: **D** shows tracking and performance data (it never shows the video). **F** toggles fullscreen.

## How the face becomes 3D

At start-up, `src/face.js` analyses `assets/director-reference.webp` in the browser:

1. **MediaPipe Face Landmarker** finds 478 3D landmarks. These give real facial depth and the exact positions of the eyes, irises, brows, lips and chin.
2. **MediaPipe multiclass segmentation** cuts out hair, face and neck. It drops the background and the shirt.
3. A dense mesh is pushed into shape by a skull dome plus the landmark depth. The nose, brow, cheeks and glasses turn in perspective and catch the stage light.
4. A shader animates the photo itself: irises, blinking eyelids, brows, lips and jaw, and a mouth interior with teeth. The mouth shapes are closed, slightly open, wide, round, "ee", "f/v" and smile.

If MediaPipe can't load, measurements taken by hand from this photo are used instead.

## Performance

- **Hand tracking** runs in a background worker (`src/trackingWorker.js`), so the animation never waits for the camera. Detection costs the main thread about 0.1 ms per frame, down from about 5 ms. If the worker can't start, tracking falls back to the main thread automatically.
- **Face tracking** is off unless the director is enabled, which saves about 9 ms per check.
- **Rendering:** shadows are off, the curtains use a simpler material, and one shared hand light replaces three. Render time dropped from about 4 ms to 1.4 ms per frame on a MacBook.
- **Pixel budget for big screens:** large or Retina displays, such as a 27-inch 5K iMac, render at most `CONFIG.render.maxRenderPixels` pixels (about 2.4 million, a little over 1080p), and Chrome scales the image up to fill the screen. On a 5K iMac that's 58% fewer pixels than before. If it still stutters, lower that number, to about 1,600,000 for example. On a fast machine you can raise it for crisper edges.
- **Lighter scene in props mode:** the director-only fill and rim lights are left out (7 lights instead of 10), and only 2 of the 4 light beams are drawn.
- **No full-screen repaints:** the spotlight on a held prop is a small pre-drawn layer that is moved and scaled by the graphics chip, and the cue card has no live blur. Both used to make the browser repaint the whole screen every frame.
- **Idle props cost less:** the handkerchief and ribbon reshape at a third of the frame rate when nobody's touching them, and hand tracking uses a 480×360 camera image at about 25 checks per second.
- **Adaptive resolution:** if frames run slow for a moment, the kiosk renders fewer pixels, then steps back up when there's headroom. Settings are in `CONFIG.render`.
- Press **D** to see the render fps and resolution, the tracker rate (and whether it's in the worker), detection time and particle count.

## Files

| File | Role |
|---|---|
| `src/config.js` | **Every setting**: script, voice, head ranges, smoothing, eye/head split, timing, colours |
| `src/face.js` | Turns the photo into a 3D face, with the expression shader |
| `src/character.js` | Rig (hips → spine → chest → neck → head, shoulders → elbows → wrists), clothing, headset, clipboard |
| `src/animation.js` | Behaviour: eyes lead, head follows, body lags. Also blinking, breathing, glances, posture shifts, nods, gestures and lip-sync blending |
| `src/tracking.js` | Webcam → face `{ faceDetected, x, y, distance, vx, vy }` plus the one active hand (pinch point, pinch state and 21 landmarks), all in the browser |
| `src/interaction.js` | Hand cursors and skeleton, grabbing, throwing, swiping, prop physics, and what the director looks at |
| `src/cues.js` | The guided tasks: the cue card, checklist, progress checks, the tea mark, "cue complete" moments, the finale and free play |
| `src/attract.js` | The standby ghost-hand demo |
| `src/props.js` | The four props (handkerchief, ribbon, teacup, s'more), their home positions, per-prop physics and their reactions when held |
| `src/effects.js` | One shared particle system for embers, steam, petals, sparks and glow |
| `src/trackingWorker.js` | Runs MediaPipe in a background thread |
| `src/speech.js` | Web Speech API voice plus word-timed visemes |
| `src/scene.js` | Renderer, camera with subtle parallax, stage lights, curtains, truss, ghost light, road cases, seats, dust |
| `src/ui.js` | Instruction, no-camera message, captions, discreet replay/mute |
| `src/main.js` | Interaction sequence and frame loop |

## Tuning

- **Responsiveness:** everything is in `TRACKING_CONFIG` at the top of `src/config.js`. Start with `sensitivity`: 1.5 is subtle, 2.5 strong, 3.0 very strong (the default), 3.5 extreme and 4.5 very extreme.
  The viewer's offset from frame centre is multiplied by `sensitivity`, so a viewer about 1/6 of the frame off-centre already gets the full turn.
- **Ranges:** `maxHeadYaw` is 35°, `maxHeadPitch` 20° and `maxHeadRoll` 8°. `maxEyeYaw` and `maxEyePitch` are iris travel as a fraction of eye width (0.35 and 0.25).
- **Layering:** `eyeSmoothing` (0.35) is faster than `headSmoothing` (0.18), which is faster than the shoulders and torso. `shoulderFollow` (15%) and `torsoFollow` (5%) are each a share of the head turn.
- **Feel:** `anticipation` and `overshoot` lead the viewer's movement and are capped by `maxLead`. `velocityDeadZone` filters webcam jitter. `attentionBoost` and `attentionMs` set how sharply a new viewer is noticed.
- **Timing:** `timing.noticeDelayMs` sets how long she looks before speaking. `timing.leaveAfterMs` sets how long a visitor can be gone before she finishes the sentence and returns to idle.
- **Distance:** `tracking.minFaceWidth` ignores people who are far away.
- **Fallback:** if the camera is denied, she shows the "Camera tracking is unavailable…" message and plays the welcome. A tap replays it.

## Offline

The libraries and models come from CDNs: Three.js, MediaPipe `tasks-vision`, `face_landmarker.task` and `selfie_multiclass_256x256.tflite`.
For a venue without internet, download them into this folder and update the URLs in `index.html` and `src/config.js`.

## Previous version

`v1-portrait/` holds the earlier 2D portrait kiosk.
