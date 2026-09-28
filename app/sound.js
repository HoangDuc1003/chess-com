// Small synthesized board sounds (no audio files). Audio starts only after a user gesture.
let ctx = null;
let enabled = true;

export function setSound(on) { enabled = on; }
export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
}

function knock(t, { freq = 900, decay = 0.05, gain = 0.35, q = 6 } = {}) {
  const len = Math.floor(ctx.sampleRate * (decay * 3));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * decay * 0.35));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f); f.connect(g); g.connect(ctx.destination);
  src.start(t);
}
function tone(t, freq, dur, gain = 0.08, type = 'sine') {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export function play(kind) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.005;
  switch (kind) {
    case 'move': knock(t, { freq: 700, decay: 0.045, gain: 0.5 }); break;
    case 'capture': knock(t, { freq: 1100, decay: 0.035, gain: 0.55, q: 4 }); knock(t + 0.03, { freq: 520, decay: 0.05, gain: 0.35 }); break;
    case 'castle': knock(t, { freq: 700, decay: 0.045, gain: 0.45 }); knock(t + 0.09, { freq: 640, decay: 0.045, gain: 0.45 }); break;
    case 'check': knock(t, { freq: 800, decay: 0.045, gain: 0.45 }); tone(t + 0.02, 880, 0.18, 0.06, 'triangle'); break;
    case 'promote': knock(t, { freq: 700, decay: 0.045, gain: 0.45 }); tone(t + 0.03, 660, 0.12, 0.05); tone(t + 0.1, 990, 0.16, 0.05); break;
    case 'illegal': tone(t, 180, 0.12, 0.06, 'square'); break;
    case 'end': tone(t, 523, 0.25, 0.06); tone(t + 0.12, 659, 0.25, 0.06); tone(t + 0.24, 784, 0.4, 0.06); break;
    case 'good': tone(t, 880, 0.12, 0.035); tone(t + 0.08, 1320, 0.16, 0.035); break;
    case 'bad': tone(t, 330, 0.18, 0.04, 'triangle'); break;
    case 'premove': knock(t, { freq: 520, decay: 0.03, gain: 0.25 }); break;
    case 'lowtime': tone(t, 988, 0.07, 0.05, 'square'); tone(t + 0.14, 988, 0.07, 0.05, 'square'); break;
    case 'start': tone(t, 587, 0.14, 0.05); tone(t + 0.1, 880, 0.22, 0.05); break;
  }
}
