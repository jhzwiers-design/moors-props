/* ==========================================================================
   STAGE ATMOSPHERE — dust drifting through the follow-spot.
   ========================================================================== */

export class Dust {
  constructor(canvas, count = 70) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.count = count;
    this.resize();
    this.motes = Array.from({ length: count }, () => this._mote(true));
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.c.clientWidth; this.h = this.c.clientHeight;
    this.c.width = this.w * dpr; this.c.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _mote(anywhere) {
    return {
      x: this.w * (0.3 + Math.random() * 0.4),
      y: anywhere ? Math.random() * this.h : this.h + 10,
      r: 0.6 + Math.random() * 1.8,
      vy: -(4 + Math.random() * 10),
      phase: Math.random() * Math.PI * 2,
      a: 0.15 + Math.random() * 0.45,
    };
  }

  /** intensity: 0..1 brightness of the beam */
  draw(dt, t, intensity = 1) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    for (const m of this.motes) {
      m.y += m.vy * dt;
      m.x += Math.sin(t * 0.4 + m.phase) * 6 * dt;
      if (m.y < -10) Object.assign(m, this._mote(false));
      // brighter inside the cone of light
      const spread = (h - m.y) / h * 0.32 * w + 40;
      const inBeam = Math.max(0, 1 - Math.abs(m.x - cx) / spread);
      const a = m.a * inBeam * intensity * (0.6 + 0.4 * Math.sin(t * 1.3 + m.phase));
      if (a < 0.01) continue;
      ctx.beginPath();
      ctx.fillStyle = `rgba(255, 228, 190, ${a})`;
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
