/* ==========================================================================
   NARRATOR — browser text-to-speech with live captions.
   Speaks sentence-by-sentence (avoids Chrome's long-utterance cut-off),
   reports word progress for captions and the "speaking" animation, and
   keeps captions moving on a timer if the voice gives no word events.
   ========================================================================== */

export class Narrator {
  constructor(cfg, { onSentence, onWord, onEnd } = {}) {
    this.cfg = cfg.voice;
    this.timing = cfg.timing;
    this.onSentence = onSentence || (() => {});
    this.onWord = onWord || (() => {});
    this.onEnd = onEnd || (() => {});
    this.synth = window.speechSynthesis || null;
    this.muted = false;
    this.speaking = false;
    this._run = 0;
    if (this.synth) {
      this._pickVoice();
      this.synth.addEventListener?.('voiceschanged', () => this._pickVoice());
    }
  }

  _pickVoice() {
    const voices = this.synth.getVoices();
    if (!voices.length) return;
    for (const name of this.cfg.preferred) {
      const v = voices.find(v => v.name.includes(name) && v.lang.startsWith('en'));
      if (v) { this.voice = v; return; }
    }
    this.voice = voices.find(v => v.lang === this.cfg.lang) || voices.find(v => v.lang.startsWith('en')) || voices[0];
  }

  /** Call once from a user gesture so later speech is allowed to play. */
  unlock() {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    this.synth.speak(u);
  }

  /** paragraphs: string[] */
  play(paragraphs) {
    this.stop();
    const items = [];
    paragraphs.forEach((p, pi) => {
      const sentences = p.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) || [p];
      sentences.forEach((s, si) => items.push({ text: s.trim(), pause: si === sentences.length - 1 && pi < paragraphs.length - 1 }));
    });
    this.items = items;
    this.index = 0;
    this.speaking = true;
    const run = ++this._run;
    this._next(run);
  }

  _next(run) {
    if (run !== this._run) return;
    if (this.index >= this.items.length) { this.speaking = false; this.onEnd(); return; }
    const item = this.items[this.index];
    this.onSentence(this.index, item.text);
    this._speak(item, run, () => {
      if (run !== this._run) return;
      this.index++;
      setTimeout(() => this._next(run), item.pause ? this.timing.paragraphPauseMs : 120);
    });
  }

  _speak(item, run, done) {
    const text = item.text;
    let finished = false, gotBoundary = false, fallback = null;
    const finish = () => {
      if (finished) return;
      finished = true; clearInterval(fallback); clearTimeout(this._safety);
      this.onWord(text.length);
      done();
    };

    // Timer-driven captions when there is no synth or no boundary events.
    const startFallback = (rateCharsPerSec) => {
      let pos = 0, lastWord = -1;
      fallback = setInterval(() => {
        if (run !== this._run) return clearInterval(fallback);
        pos += rateCharsPerSec / 20;
        const nextSpace = text.indexOf(' ', Math.floor(pos));
        const idx = nextSpace === -1 ? text.length : nextSpace;
        if (idx !== lastWord) { lastWord = idx; this.onWord(Math.floor(pos), true); }
        if (pos >= text.length && !this.synth) finish();
      }, 50);
    };
    const cps = 14.5 * this.cfg.rate;

    if (!this.synth) { startFallback(cps); return; }

    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.lang = this.voice?.lang || this.cfg.lang;
    u.rate = this.cfg.rate;
    u.pitch = this.cfg.pitch;
    u.volume = this.muted ? 0 : 1;
    u.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      if (!gotBoundary) { gotBoundary = true; clearInterval(fallback); }
      this.onWord(e.charIndex, true);
    };
    u.onend = finish;
    u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') finish(); };
    this._utter = u;
    this.synth.speak(u);
    // Some voices never fire word boundaries — fake them after a beat.
    setTimeout(() => { if (!gotBoundary && !finished && run === this._run) startFallback(cps); }, 700);
    // Safety net if the engine silently drops an utterance.
    this._safety = setTimeout(finish, (text.length / cps) * 1000 * 2 + 4000);
  }

  setMuted(m) {
    this.muted = m;
    if (this.speaking && this.synth) {
      // Volume can't change mid-utterance: restart the current sentence at the new volume.
      const run = ++this._run;
      this.synth.cancel();
      clearTimeout(this._safety);
      setTimeout(() => this._next(run), 60);
    }
  }

  stop() {
    this._run++;
    this.speaking = false;
    clearTimeout(this._safety);
    this.synth?.cancel();
  }
}
