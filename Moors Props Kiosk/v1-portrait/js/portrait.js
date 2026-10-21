/* ==========================================================================
   PORTRAIT RENDERER
   Draws the director photo through a WebGL shader that locally warps the
   image: irises slide inside the eye openings, the face shifts with a
   pseudo-depth falloff (nose moves most, edges least) to suggest a head
   turn, and the lower lip moves slightly while speaking. Also applies the
   theatrical spotlight grade and fades the photo background to transparent.
   ========================================================================== */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2((aPos.x + 1.0) * 0.5, (1.0 - aPos.y) * 0.5); // top-left origin
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2  uRes;
uniform vec2  uEyeL, uEyeR, uEyeRadius, uEyeShift, uGaze;
uniform vec2  uNose, uFace, uHeadShift, uHead;
uniform float uFaceRadius;
uniform vec2  uMouth, uMouthRadius;
uniform float uMouthOpen;
uniform vec2  uVigC, uVigR;
uniform float uLight, uTime, uDebug;

float ellipseMask(vec2 p, vec2 c, vec2 r, float inner) {
  return 1.0 - smoothstep(inner, 1.0, length((p - c) / r));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 p = vUv * uRes;
  vec2 screenP = p;

  // --- head turn: depth-weighted displacement ---------------------------
  float d = length(p - uNose);
  float depth = exp(-(d * d) / (2.0 * pow(uFaceRadius * 0.42, 2.0)));
  float faceM = 1.0 - smoothstep(uFaceRadius * 0.55, uFaceRadius * 1.15, length(p - uFace));
  p -= uHead * uHeadShift * (0.45 * faceM + 0.55 * depth);

  // --- eyes: slide iris inside the eye opening --------------------------
  float mL = ellipseMask(p, uEyeL, uEyeRadius, 0.4);
  float mR = ellipseMask(p, uEyeR, uEyeRadius, 0.4);
  p -= uGaze * uEyeShift * (mL + mR);

  // --- mouth: lower lip drops a touch while speaking --------------------
  float mM = ellipseMask(p, uMouth + vec2(0.0, uMouthRadius.y * 0.45), uMouthRadius, 0.2);
  float below = smoothstep(uMouth.y - 3.0, uMouth.y + 5.0, p.y);
  p.y -= uMouthOpen * mM * below;

  vec4 c = texture2D(uTex, clamp(p / uRes, 0.0, 1.0));

  // --- grade: warm stage light, spotlight falloff, grain ----------------
  float spot = 1.0 - smoothstep(uFaceRadius * 0.4, uFaceRadius * 1.1, length((screenP - uFace) * vec2(1.0, 0.8)));
  vec3 col = c.rgb;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, 0.62 + 0.28 * spot);          // background desaturates
  col *= vec3(1.06, 0.99, 0.90);                            // tungsten warmth
  col = pow(col, vec3(1.08));                               // a little contrast
  col *= mix(0.16, 1.0, spot) * uLight;
  col += (hash(screenP + fract(uTime) * 91.0) - 0.5) * 0.028;

  float alpha = ellipseMask(screenP, uVigC, uVigR, 0.5);

  if (uDebug > 0.5) {
    col = mix(col, vec3(0.1, 0.9, 1.0), (mL + mR) * 0.55);
    col = mix(col, vec3(1.0, 0.3, 0.6), mM * 0.5);
    col = mix(col, vec3(1.0, 0.85, 0.2), depth * 0.25);
    alpha = max(alpha, 0.35);
  }
  gl_FragColor = vec4(col * alpha, alpha);
}`;

export class Portrait {
  constructor(canvas, cfg) {
    this.canvas = canvas;
    this.cfg = cfg;
    this.debug = false;
    this.ready = false;
  }

  async init() {
    const { portrait } = this.cfg;
    const img = await loadImage(portrait.src);
    this.imgW = img.naturalWidth || portrait.width;
    this.imgH = img.naturalHeight || portrait.height;
    // Landmarks are authored in config pixels; rescale if the image differs.
    this.scale = { x: this.imgW / portrait.width, y: this.imgH / portrait.height };

    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    this.u = {};
    for (const n of ['uRes', 'uEyeL', 'uEyeR', 'uEyeRadius', 'uEyeShift', 'uGaze', 'uNose', 'uFace',
      'uHeadShift', 'uHead', 'uFaceRadius', 'uMouth', 'uMouthRadius', 'uMouthOpen', 'uVigC', 'uVigR',
      'uLight', 'uTime', 'uDebug']) this.u[n] = gl.getUniformLocation(prog, n);

    this._setStatic();
    this.aspect = this.imgW / this.imgH;
    this.resize();
    this.ready = true;
  }

  _setStatic() {
    const { gl, u } = this;
    const p = this.cfg.portrait, m = this.cfg.motion, s = this.scale;
    const v2 = (loc, o) => gl.uniform2f(loc, o.x * s.x, o.y * s.y);
    gl.uniform2f(u.uRes, this.imgW, this.imgH);
    v2(u.uEyeL, p.eyeLeft); v2(u.uEyeR, p.eyeRight); v2(u.uEyeRadius, p.eyeRadius);
    v2(u.uEyeShift, m.eyeShift); v2(u.uHeadShift, m.headShift);
    v2(u.uNose, p.nose); v2(u.uFace, p.face); v2(u.uMouth, p.mouth); v2(u.uMouthRadius, p.mouthRadius);
    v2(u.uVigC, p.vignetteCenter); v2(u.uVigR, p.vignetteRadius);
    gl.uniform1f(u.uFaceRadius, p.faceRadius * s.x);
  }

  resize() {
    if (!this.gl) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.min(Math.round(rect.width * dpr), 2048);
    const h = Math.round(w / this.aspect);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  /** state: { gaze:{x,y}, head:{x,y}, mouth:0..1, light:number, time:seconds } */
  render(state) {
    if (!this.ready) return;
    const { gl, u } = this;
    gl.uniform2f(u.uGaze, state.gaze.x, state.gaze.y);
    gl.uniform2f(u.uHead, state.head.x, state.head.y);
    gl.uniform1f(u.uMouthOpen, state.mouth * this.cfg.motion.mouthMotion * this.scale.y);
    gl.uniform1f(u.uLight, state.light);
    gl.uniform1f(u.uTime, state.time);
    gl.uniform1f(u.uDebug, this.debug ? 1 : 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Could not load portrait: ' + src));
    img.src = src;
  });
}
