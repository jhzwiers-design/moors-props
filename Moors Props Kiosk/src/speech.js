/* ==========================================================================
   SPEECH — Web Speech API voice + simplified lip-sync.

   Browser TTS gives no audio amplitude, but it does report word
   boundaries. For every word we build a little viseme track from its
   letters (closed / slightly open / wide vowel / rounded vowel / smile)
   timed across the word's estimated duration. When a voice gives no
   boundary events, a timer drives the same system so the mouth never
   stays still while she talks.
   ========================================================================== */
import { CONFIG } from './config.js';

export const VISEMES = {
  neutral: { open: 0.0, wide: 0.0, round: 0.0, smile: 0.0 },
  closed:  { open: 0.0, wide: 0.1, round: 0.0, smile: 0.0 },
  slight:  { open: 0.28, wide: 0.0, round: 0.0, smile: 0.0 },
  wide:    { open: 0.72, wide: 0.55, round: 0.0, smile: 0.15 },
  open:    { open: 0.95, wide: 0.2, round: 0.0, smile: 0.0 },
  round:   { open: 0.55, wide: -0.3, round: 1.0, smile: 0.0 },
  ee:      { open: 0.35, wide: 0.9, round: 0.0, smile: 0.35 },
  fv:      { open: 0.12, wide: 0.2, round: 0.0, smile: 0.0 },
  smile:   { open: 0.1, wide: 0.4, round: 0.0, smile: 1.0 },
};

function letterViseme(ch, next) {
  if ('mbp'.includes(ch)) return 'closed';
  if ('fv'.includes(ch)) return 'fv';
  if (ch === 'o' || ch === 'u' || ch === 'w' || (ch === 'q')) return 'round';
  if (ch === 'a') return next === 'y' || next === 'i' ? 'wide' : 'open';
  if (ch === 'e' || ch === 'i' || ch === 'y') return 'ee';
  if ('tdnlszcjkgrh'.includes(ch)) return 'slight';
  return 'slight';
}

const SMILE_WORDS = /^(welcome|glad|enjoy|thank|excited|love|unexpected|fun|delight)/i;

export class Speech {
  constructor({ onSentence, onWord, onEnd } = {}) {
    this.cfg = CONFIG.voice;
    this.synth = window.speechSynthesis || null;
    this.onSentence = onSentence || (() => {});
    this.onWord = onWord || (() => {});
    this.onEnd = onEnd || (() => {});
    this.muted = false;
    this.speaking = false;
    this.track = [];             // [{t, v}] viseme keyframes (ms, performance.now)
    this.smileUntil = 0;
    this._run = 0;
    if (this.synth) {
      this._pick();
      this.synth.addEventListener?.('voiceschanged', () => this._pick());
    }
  }

  _pick() {
    const voices = this.synth.getVoices();
    if (!voices.length) return;
    for (const n of this.cfg.preferred) {
      const v = voices.find((x) => x.name.includes(n) && x.lang.startsWith('en'));
      if (v) { this.voice = v; return; }
    }
    this.voice = voices.find((v) => v.lang === this.cfg.lang) || voices.find((v) => v.lang.startsWith('en')) || voices[0];
  }

  unlock() {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    this.synth.speak(u);
  }

  play(paragraphs) {
    this.stop();
    this.items = [];
    paragraphs.forEach((p, pi) => {
      const ss = p.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) || [p];
      ss.forEach((s, si) => this.items.push({ text: s.trim(), para: pi, last: si === ss.length - 1 }));
    });
    this.index = 0;
    this.speaking = true;
    this.finishing = false;
    const run = ++this._run;
    this._next(run);
  }

  /** Stop after the sentence currently being spoken. */
  finishSentence() { if (this.speaking) this.finishing = true; }

  _next(run) {
    if (run !== this._run) return;
    if (this.index >= this.items.length || this.finishing) {
      const interrupted = this.index < this.items.length;
      this.speaking = false; this.track = [];
      this.onEnd({ interrupted });
      return;
    }
    const item = this.items[this.index];
    this.onSentence(this.index, item.text, item);
    this._speak(item, run, () => {
      if (run !== this._run) return;
      this.index++;
      const pause = item.last ? CONFIG.timing.paragraphPauseMs : 140;
      setTimeout(() => this._next(run), pause);
    });
  }

  _speak(item, run, done) {
    const text = item.text;
    const cps = 14.5 * this.cfg.rate;           // estimated characters / second
    let finished = false, gotBoundary = false, fallback = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(fallback); clearTimeout(this._safety);
      this.track = [{ t: performance.now(), v: 'closed' }];
      done();
    };
    const wordAt = (ci) => {
      const m = /\S+/.exec(text.slice(ci));
      return m ? { word: m[0], start: ci + m.index } : null;
    };
    const onWord = (ci) => {
      const w = wordAt(ci);
      if (!w) return;
      this._wordVisemes(w.word, cps);
      this.onWord(w.start, w.word, text);
    };
    const startFallback = () => {
      let pos = 0, lastStart = -1;
      fallback = setInterval(() => {
        if (run !== this._run) return clearInterval(fallback);
        pos += cps / 20;
        // find the word containing pos
        const re = /\S+/g; let m, cur = null;
        while ((m = re.exec(text))) { if (m.index <= pos) cur = m; else break; }
        if (cur && cur.index !== lastStart) { lastStart = cur.index; onWord(cur.index); }
        if (!this.synth && pos >= text.length + 4) finish();
      }, 50);
    };

    if (!this.synth) { startFallback(); return; }
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang || this.cfg.lang;
    u.rate = this.cfg.rate; u.pitch = this.cfg.pitch;
    u.volume = this.muted ? 0 : 1;
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      if (!gotBoundary) { gotBoundary = true; clearInterval(fallback); }
      onWord(e.charIndex);
    };
    u.onend = finish;
    u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') finish(); };
    this.synth.speak(u);
    setTimeout(() => { if (!gotBoundary && !finished && run === this._run) startFallback(); }, 650);
    this._safety = setTimeout(finish, (text.length / cps) * 2000 + 4000);
  }

  _wordVisemes(word, cps) {
    const w = word.toLowerCase().replace(/[^a-z’']/g, '');
    const now = performance.now();
    const dur = Math.max(140, ((w.length + 1) / cps) * 1000 * 0.9);
    const track = [];
    // collapse letters into syllable-ish groups so the mouth doesn't flutter
    let prev = null;
    const groups = [];
    for (let i = 0; i < w.length; i++) {
      const v = letterViseme(w[i], w[i + 1]);
      if (v !== prev) groups.push(v);
      prev = v;
    }
    if (!groups.length) groups.push('slight');
    const step = dur / groups.length;
    groups.forEach((v, i) => track.push({ t: now + i * step, v }));
    track.push({ t: now + dur, v: 'slight' });
    this.track = track;
    if (SMILE_WORDS.test(w)) this.smileUntil = now + 900;
  }

  /** Current mouth target — called every frame by the animation system. */
  viseme(now) {
    if (!this.speaking || !this.track.length) return VISEMES.neutral;
    let cur = this.track[0];
    for (const k of this.track) { if (k.t <= now) cur = k; else break; }
    const base = VISEMES[cur.v];
    if (now < this.smileUntil) return { ...base, smile: Math.max(base.smile, 0.6) };
    return base;
  }

  setMuted(m) {
    this.muted = m;
    if (this.speaking && this.synth) {        // restart the sentence at the new volume
      const run = ++this._run;
      this.synth.cancel();
      clearTimeout(this._safety);
      setTimeout(() => this._next(run), 60);
    }
  }

  stop() {
    this._run++;
    this.speaking = false;
    this.finishing = false;
    this.track = [];
    clearTimeout(this._safety);
    this.synth?.cancel();
  }
}
