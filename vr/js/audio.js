// audio.js - all sounds are synthesised with WebAudio (no audio files to download)
export class Sfx {
  constructor() { this.ctx = null; this.master = null; this.vol = 0.7; this.noise = null; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = this.vol; this.master.connect(this.ctx.destination);
    const n = this.ctx.sampleRate; this.noise = this.ctx.createBuffer(1, n, n); const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = v; }
  // route: gain (distance) -> optional stereo pan -> master
  out(gain, pan) {
    const c = this.ctx, g = c.createGain(); g.gain.value = gain; let last = g;
    if (pan !== undefined && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); last = p; }
    last.connect(this.master); return g;
  }
  burst({ gain = 1, pan, dur = 0.15, type = 'lowpass', freq = 1500, q = 0.7, sweep = 0, tone = 0, toneEnd = 0, toneGain = 0.6, attack = 0.002 }) {
    if (!this.ctx || gain <= 0.01) return;
    const c = this.ctx, t = c.currentTime, o = this.out(gain, pan);
    const env = c.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + attack); env.gain.exponentialRampToValueAtTime(0.0001, t + dur); env.connect(o);
    if (type) {
      const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true; src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t); if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
      src.connect(f); f.connect(env); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
    }
    if (tone) {
      const osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(tone, t); if (toneEnd) osc.frequency.exponentialRampToValueAtTime(toneEnd, t + dur);
      const tg = c.createGain(); tg.gain.value = toneGain; osc.connect(tg); tg.connect(env); osc.start(t); osc.stop(t + dur + 0.05);
    }
  }
  // listener-relative placement: dist in metres, rel = angle of source relative to where listener faces (rad, +right)
  place(dist, rel, ref = 28) { return { gain: Math.max(0, 1 - dist / (ref * 2.5)) * Math.min(1, ref / Math.max(ref * 0.4, dist)), pan: dist < 1 ? 0 : Math.sin(rel) * 0.9 }; }
  shot(w, dist = 0, rel = 0) {
    const p = this.place(dist, rel), g = p.gain * (dist === 0 ? 1 : 0.9), pan = p.pan;
    switch (w) {
      case 1: this.burst({ gain: 0.5 * g, pan, dur: 0.12, type: 'highpass', freq: 1800, sweep: 3 }); break;                               // knife swish
      case 2: case 3: this.burst({ gain: 0.9 * g, pan, dur: 0.13, type: 'bandpass', freq: 1900, q: 0.8, tone: 170, toneEnd: 90, toneGain: 0.5 }); break;
      case 4: this.burst({ gain: 1.2 * g, pan, dur: 0.26, type: 'lowpass', freq: 2400, sweep: 0.3, tone: 120, toneEnd: 55, toneGain: 0.9 }); break;
      case 5: this.burst({ gain: 0.8 * g, pan, dur: 0.1, type: 'bandpass', freq: 2300, q: 0.9, tone: 200, toneEnd: 110, toneGain: 0.35 }); break;
      case 6: this.burst({ gain: 1.3 * g, pan, dur: 0.3, type: 'lowpass', freq: 1500, sweep: 0.25, tone: 90, toneEnd: 45, toneGain: 0.8 }); break;
      case 9: this.burst({ gain: 1.5 * g, pan, dur: 0.6, type: 'lowpass', freq: 2200, sweep: 0.12, tone: 70, toneEnd: 35, toneGain: 1.1 }); break;
      default: this.burst({ gain: 1.0 * g, pan, dur: 0.17, type: 'lowpass', freq: 2000, sweep: 0.4, tone: 100, toneEnd: 55, toneGain: 0.8 });   // rifles
    }
  }
  hit(head) { this.burst({ gain: 0.55, dur: head ? 0.16 : 0.07, type: null, tone: head ? 1700 : 1100, toneEnd: head ? 1500 : 700, toneGain: 1 }); }
  hurt() { this.burst({ gain: 0.7, dur: 0.18, type: 'lowpass', freq: 500, tone: 110, toneEnd: 60, toneGain: 0.6 }); }
  reload() { this.burst({ gain: 0.35, dur: 0.05, type: 'bandpass', freq: 2600, q: 3 }); setTimeout(() => this.burst({ gain: 0.45, dur: 0.07, type: 'bandpass', freq: 1500, q: 3 }), 650); }
  step(dist = 0, rel = 0) { const p = this.place(dist, rel, 14); this.burst({ gain: 0.18 * p.gain, pan: p.pan, dur: 0.07, type: 'lowpass', freq: 380 }); }
  beep(dist = 0, rel = 0) { const p = this.place(dist, rel, 40); this.burst({ gain: 0.45 * p.gain, pan: p.pan, dur: 0.1, type: null, tone: 1650, toneGain: 0.7 }); }
  boom() { this.burst({ gain: 1.6, dur: 2.0, type: 'lowpass', freq: 1800, sweep: 0.03, tone: 55, toneEnd: 22, toneGain: 1.2, attack: 0.005 }); }
  buy() { this.burst({ gain: 0.5, dur: 0.1, type: null, tone: 1300, toneEnd: 1900, toneGain: 0.8 }); }
  deny() { this.burst({ gain: 0.4, dur: 0.12, type: null, tone: 220, toneEnd: 160, toneGain: 0.8 }); }
  plant(dist = 0, rel = 0) { const p = this.place(dist, rel, 30); this.burst({ gain: 0.6 * p.gain, pan: p.pan, dur: 0.25, type: null, tone: 700, toneEnd: 1400, toneGain: 0.8 }); }
  roundStart() { this.burst({ gain: 0.5, dur: 0.3, type: null, tone: 520, toneEnd: 780, toneGain: 0.8 }); }
  win() { this.burst({ gain: 0.5, dur: 0.5, type: null, tone: 440, toneEnd: 880, toneGain: 0.8 }); }
  lose() { this.burst({ gain: 0.5, dur: 0.5, type: null, tone: 330, toneEnd: 165, toneGain: 0.8 }); }
  click() { this.burst({ gain: 0.25, dur: 0.04, type: null, tone: 900, toneGain: 0.8 }); }
}
