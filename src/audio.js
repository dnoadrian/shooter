// All sounds are synthesised at startup into AudioBuffers (no assets), then
// played through HRTF-free stereo panners with a shared reverb send.
// The announcer uses the browser's speech synthesis when available.

const SR = 44100;

function makeBuffer(ctx, seconds, fn, channels = 1) {
  const len = Math.floor(seconds * SR);
  const buf = ctx.createBuffer(channels, len, SR);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    fn(d, len, c);
  }
  return buf;
}

// Simple biquad band/low/high pass for offline synthesis.
function biquad(type, freq, q) {
  const w = (2 * Math.PI * freq) / SR;
  const alpha = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  let b0, b1, b2;
  if (type === 'low') {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
  } else if (type === 'high') {
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
  } else {
    b0 = alpha; b1 = 0; b2 = -alpha;
  }
  const a0 = 1 + alpha, a1 = -2 * cw, a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

const noise = () => Math.random() * 2 - 1;

function normalize(d, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
}

function synthRail(d, len) {
  const hp = biquad('high', 2500, 0.7);
  const bp = biquad('band', 900, 1.2);
  let ph = 0, ph2 = 0, ph3 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    // crack
    let s = hp(noise()) * Math.exp(-t * 55) * 0.9;
    // descending zap
    const f = 70 + 2600 * Math.exp(-t * 11);
    ph += (2 * Math.PI * f) / SR;
    s += (Math.sin(ph) + 0.5 * Math.sin(ph * 2.01)) * Math.exp(-t * 4.5) * 0.45;
    // electric hum tail with tremolo
    ph2 += (2 * Math.PI * 58) / SR;
    s += (Math.sin(ph2) + 0.4 * Math.sin(ph2 * 3)) * Math.exp(-t * 2.2) * 0.35 * (0.75 + 0.25 * Math.sin(t * 2 * Math.PI * 22));
    // metallic ring
    ph3 += (2 * Math.PI * 1840) / SR;
    s += (Math.sin(ph3) * 0.6 + Math.sin(ph3 * 1.47) * 0.4) * Math.exp(-t * 7) * 0.12;
    // swoosh body
    s += bp(noise()) * Math.exp(-t * 6) * 0.5;
    d[i] = s * Math.min(1, t * 2000);
  }
  normalize(d);
}

function synthHit(d, len) {
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = Math.exp(-t * 38);
    d[i] = (Math.sin(2 * Math.PI * 1320 * t) * 0.6 + Math.sin(2 * Math.PI * 1980 * t) * 0.4) * e * Math.min(1, t * 3000);
  }
  normalize(d, 0.7);
}

function synthGib(d, len) {
  const lp = biquad('low', 700, 0.9);
  const lp2 = biquad('low', 300, 0.7);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let s = lp(noise()) * Math.exp(-t * 9) * 1.2;
    s += lp2(noise()) * Math.exp(-t * 3) * 0.8;
    if (Math.random() < 0.002 && t < 0.35) s += noise() * 2;
    s += Math.sin(2 * Math.PI * (90 - t * 80) * t) * Math.exp(-t * 14) * 0.8;
    d[i] = s * Math.min(1, t * 1500);
  }
  normalize(d, 0.85);
}

function synthJump(d, len) {
  const bp = biquad('band', 520, 2.5);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const e = Math.sin(Math.PI * Math.min(1, t / (len / SR)));
    const f = 190 + t * 900;
    d[i] = (bp(noise()) * 1.4 + Math.sin(2 * Math.PI * f * t) * 0.25) * e * Math.exp(-t * 10);
  }
  normalize(d, 0.5);
}

function synthLand(d, len) {
  const lp = biquad('low', 400, 0.8);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    d[i] = (Math.sin(2 * Math.PI * (75 - t * 60) * t) * Math.exp(-t * 22) + lp(noise()) * Math.exp(-t * 40) * 0.8) * Math.min(1, t * 2000);
  }
  normalize(d, 0.7);
}

function synthStep(seed) {
  return (d, len) => {
    const bp = biquad('band', 500 + seed * 170, 1.4);
    const hp = biquad('high', 2500, 0.8);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      d[i] = (bp(noise()) * Math.exp(-t * 55) + hp(noise()) * Math.exp(-t * 120) * 0.3) * Math.min(1, t * 4000);
    }
    normalize(d, 0.5);
  };
}

function synthPad(d, len) {
  const bp = biquad('band', 800, 0.8);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const f = 110 + 520 * (t / (len / SR));
    d[i] = (Math.sin(2 * Math.PI * f * t) * 0.5 + bp(noise()) * 0.6) * Math.sin(Math.PI * Math.min(1, t / (len / SR))) * Math.exp(-t * 2);
  }
  normalize(d, 0.75);
}

function synthSpawn(d, len) {
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let s = 0;
    for (const [f, a] of [[660, 0.4], [990, 0.3], [1320, 0.25], [1760, 0.15]]) s += Math.sin(2 * Math.PI * f * (1 + t * 0.6) * t + Math.sin(t * 40) * 0.5) * a;
    d[i] = s * Math.sin(Math.PI * Math.min(1, t / (len / SR))) * 0.8 + noise() * 0.08 * Math.exp(-t * 6);
  }
  normalize(d, 0.55);
}

function synthBeep(freq) {
  return (d, len) => {
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      d[i] = (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(2 * Math.PI * freq * 2 * t)) * Math.min(1, t * 400) * Math.min(1, (len / SR - t) * 30);
    }
    normalize(d, 0.5);
  };
}

function synthAward(d, len) {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let s = 0;
    notes.forEach((f, k) => {
      const st = k * 0.06;
      if (t > st) s += Math.sin(2 * Math.PI * f * (t - st)) * Math.exp(-(t - st) * 3.5) * (0.5 + 0.5 * Math.sin(2 * Math.PI * f * 2.003 * (t - st)));
    });
    d[i] = s;
  }
  normalize(d, 0.45);
}

function synthReady(d, len) {
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    d[i] = Math.sin(2 * Math.PI * (700 + t * 3000) * t) * Math.exp(-t * 45) * Math.min(1, t * 3000);
  }
  normalize(d, 0.3);
}

function synthAmbience(d, len, c) {
  const lp = biquad('low', 180, 0.6);
  const lp2 = biquad('band', 900, 3);
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    const swell = 0.6 + 0.4 * Math.sin((2 * Math.PI * t) / (len / SR) + c);
    d[i] = lp(noise()) * 2.5 * swell + lp2(noise()) * 0.05 * (0.5 + 0.5 * Math.sin(t * 0.7 + c * 2));
  }
  // seamless loop: crossfade the ends
  const fade = Math.floor(SR * 0.5);
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[i] = d[i] * a + d[len - fade + i] * (1 - a);
  }
  normalize(d, 0.35);
}

function synthLava(d, len) {
  const lp = biquad('low', 300, 0.7);
  const bubbles = [];
  for (let k = 0; k < 18; k++) bubbles.push({ t: Math.random() * (len / SR - 0.2), f: 90 + Math.random() * 200 });
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    let s = lp(noise()) * 1.5;
    for (const b of bubbles) {
      const dt = t - b.t;
      if (dt > 0 && dt < 0.15) s += Math.sin(2 * Math.PI * b.f * (1 + dt * 8) * dt) * Math.exp(-dt * 30) * 0.8;
    }
    d[i] = s;
  }
  const fade = Math.floor(SR * 0.3);
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    d[i] = d[i] * a + d[len - fade + i] * (1 - a);
  }
  normalize(d, 0.6);
}

function impulse(ctx) {
  return makeBuffer(
    ctx,
    2.4,
    (d, len) => {
      for (let i = 0; i < len; i++) {
        const t = i / SR;
        d[i] = noise() * Math.exp(-t * 2.6) * (t < 0.01 ? t * 100 : 1);
      }
    },
    2,
  );
}

export class Audio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buffers = {};
    this.voiceQueue = [];
  }

  // Must be called from a user gesture.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse(ctx);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(reverb);
    reverb.connect(this.master);
    const b = this.buffers;
    b.rail = makeBuffer(ctx, 1.3, synthRail);
    b.hit = makeBuffer(ctx, 0.14, synthHit);
    b.gib = makeBuffer(ctx, 0.7, synthGib);
    b.jump = makeBuffer(ctx, 0.16, synthJump);
    b.land = makeBuffer(ctx, 0.2, synthLand);
    b.steps = [0, 1, 2, 3].map((k) => makeBuffer(ctx, 0.09, synthStep(k)));
    b.pad = makeBuffer(ctx, 0.55, synthPad);
    b.spawn = makeBuffer(ctx, 0.6, synthSpawn);
    b.beep = makeBuffer(ctx, 0.18, synthBeep(880));
    b.fight = makeBuffer(ctx, 0.5, synthBeep(1320));
    b.award = makeBuffer(ctx, 0.9, synthAward);
    b.ready = makeBuffer(ctx, 0.08, synthReady);
    b.ambience = makeBuffer(ctx, 8, synthAmbience, 2);
    b.lava = makeBuffer(ctx, 5, synthLava);
    this.applyVolume();
    this.startLoops();
  }

  applyVolume() {
    if (this.master) this.master.gain.value = this.settings.volume;
  }

  startLoops() {
    const ctx = this.ctx;
    const amb = ctx.createBufferSource();
    amb.buffer = this.buffers.ambience;
    amb.loop = true;
    const ag = ctx.createGain();
    ag.gain.value = 0.35;
    amb.connect(ag).connect(this.master);
    amb.start();
    // lava hiss localised at the pool
    const lava = ctx.createBufferSource();
    lava.buffer = this.buffers.lava;
    lava.loop = true;
    const lg = ctx.createGain();
    lg.gain.value = 0.9;
    const panner = this.makePanner([0, -10, 0]);
    panner.refDistance = 250;
    lava.connect(lg).connect(panner).connect(this.sfx);
    lava.start();
  }

  makePanner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 220;
    p.rolloffFactor = 1.1;
    p.maxDistance = 10000;
    p.positionX.value = pos[0];
    p.positionY.value = pos[1];
    p.positionZ.value = pos[2];
    return p;
  }

  // pos === null plays the sound "in your head" (local player).
  play(name, pos = null, gain = 1, rate = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    let buf = this.buffers[name];
    if (Array.isArray(buf)) buf = buf[Math.floor(Math.random() * buf.length)];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    if (pos) {
      const p = this.makePanner(pos);
      g.connect(p);
      p.connect(this.sfx);
      p.connect(this.reverbSend);
    } else {
      g.connect(this.sfx);
      g.connect(this.reverbSend);
    }
    src.start();
  }

  setListener(pos, forward) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(forward.x, t);
      l.forwardY.setValueAtTime(forward.y, t);
      l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  announce(text) {
    if (!this.settings.announcer || !window.speechSynthesis || !this.ctx) return;
    try {
      const synth = window.speechSynthesis;
      if (synth.speaking) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.92;
      u.pitch = 0.35;
      u.volume = Math.min(1, this.settings.volume * 1.4);
      const voices = synth.getVoices();
      const en = voices.find((v) => /en[-_](US|GB)/i.test(v.lang) && /male|daniel|google uk english male|alex/i.test(v.name)) || voices.find((v) => /^en/i.test(v.lang));
      if (en) u.voice = en;
      synth.speak(u);
    } catch {
      // speech synthesis is optional
    }
  }
}
