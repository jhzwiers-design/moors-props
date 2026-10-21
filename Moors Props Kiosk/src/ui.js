/* ==========================================================================
   UI — only what an installation needs: a whispered instruction, an
   optional caption line, two discreet controls, and a hidden staff panel.
   ========================================================================== */
import { CONFIG } from './config.js';

const $ = (s) => document.querySelector(s);

export class UI {
  constructor() {
    this.el = {
      start: $('#start'), loading: $('#loading'), instruction: $('#instruction'), message: $('#message'),
      caption: $('#caption'), mute: $('#btn-mute'), replay: $('#btn-replay'), debug: $('#debug'),
    };
    this.el.instruction.textContent = CONFIG.ui.instruction;
    this.el.message.textContent = CONFIG.ui.noCamera;
    $('#start-title').textContent = CONFIG.production.title;
    $('#start-kicker').textContent = CONFIG.production.presenter;
    $('#mark-title').textContent = CONFIG.production.title;
    this.words = [];
    this._cursor();
    $('#intro-presenter').textContent = CONFIG.production.presenter;
    $('#intro-title').textContent = CONFIG.production.title;
    $('#intro-cta').textContent = CONFIG.intro.cta;
    $('#intro-sub').textContent = CONFIG.intro.ctaSub || '';
    $('#freeplay-line').textContent = CONFIG.cues.freePlay;
    $('#freeplay-sub').textContent = CONFIG.cues.freePlaySub;
    this.introShown = false;
  }

  ready() { this.el.loading.classList.add('gone'); document.body.classList.add('ready'); }
  hideStart() { this.el.start.classList.add('gone'); }
  onStart(fn) {
    const go = () => { this.el.start.removeEventListener('click', go); fn(); };
    this.el.start.addEventListener('click', go);
  }

  instruction(show) { this.el.instruction.classList.toggle('show', show); }
  /** Show a whispered instruction (cross-fades when the text changes); null hides it. */
  prompt(text) {
    if (text === this._prompt) return;
    this._prompt = text;
    const el = this.el.instruction;
    clearTimeout(this._promptT);
    el.classList.remove('show');
    if (!text) return;
    this._promptT = setTimeout(() => { el.textContent = text; el.classList.add('show'); }, el.textContent && el.textContent !== text ? 700 : 0);
  }
  /** Intro card: fades in/out and cycles the narrative lines while visible. */
  intro(show) {
    if (show === this.introShown) return;
    this.introShown = show;
    $('#intro').classList.toggle('show', show);
    document.body.classList.toggle('intro-on', show);
    clearTimeout(this._lineT);
    if (show) { this._line = -1; this._nextLine(); }
  }
  _nextLine() {
    const lines = CONFIG.intro.lines, el = $('#intro-line');
    el.classList.remove('show');
    this._lineT = setTimeout(() => {
      this._line = (this._line + 1) % lines.length;
      el.textContent = lines[this._line];
      el.classList.add('show');
      // the last line lingers a little longer before the story starts over
      const hold = CONFIG.intro.lineMs * (this._line === lines.length - 1 ? 1.6 : 1);
      this._lineT = setTimeout(() => this._nextLine(), hold);
    }, this._line < 0 ? 600 : 1100);
  }
  /** A single line that appears briefly, e.g. when a prop is picked up. */
  introCta(text) { $('#intro-cta').textContent = text; }
  whisper(text, ms = 3800) {
    const el = $('#whisper');
    clearTimeout(this._whisperT);
    el.classList.remove('show');
    if (!text) return;
    setTimeout(() => { el.textContent = text; el.classList.add('show'); }, 250);
    this._whisperT = setTimeout(() => el.classList.remove('show'), ms);
  }
  message(show) { this.el.message.classList.toggle('show', show); }

  sentence(text) {
    if (!CONFIG.ui.captions) return;
    const c = this.el.caption;
    c.classList.remove('show');
    c.innerHTML = '';
    this.words = [];
    const re = /\S+\s*/g; let m;
    while ((m = re.exec(text))) {
      const s = document.createElement('span');
      s.textContent = m[0];
      c.appendChild(s);
      this.words.push({ start: m.index, s });
    }
    requestAnimationFrame(() => c.classList.add('show'));
  }
  word(charIndex) { for (const w of this.words) w.s.classList.toggle('lit', w.start <= charIndex); }
  clearCaption() { this.el.caption.classList.remove('show'); }

  controls({ onMute, onReplay }) {
    this.el.mute.addEventListener('click', (e) => {
      e.stopPropagation();
      const m = this.el.mute.getAttribute('aria-pressed') !== 'true';
      this.el.mute.setAttribute('aria-pressed', m);
      this.el.mute.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
      onMute(m);
    });
    this.el.replay.addEventListener('click', (e) => { e.stopPropagation(); onReplay(); });
  }

  debug(on, lines) {
    if (on !== undefined) this.el.debug.hidden = !on;
    if (lines && !this.el.debug.hidden) this.el.debug.textContent = lines;
  }

  _cursor() {
    let t;
    window.addEventListener('pointermove', () => {
      document.body.classList.remove('hide-cursor');
      clearTimeout(t);
      t = setTimeout(() => document.body.classList.add('hide-cursor'), 2500);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}
