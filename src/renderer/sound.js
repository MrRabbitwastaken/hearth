/* Hearth — sound: gentle effects and ambient focus soundscapes, all synthesised (no audio files) */
(() => {
'use strict';

let ctx = null, master = null, fxBus = null, ambBus = null;
let buffers = {};
const settings = () => (window.H && window.H.D && window.H.D.settings) || {};

function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
  fxBus = ctx.createGain(); fxBus.connect(master);
  ambBus = ctx.createGain(); ambBus.gain.value = 0; ambBus.connect(master);
  buffers.white = noise('white'); buffers.pink = noise('pink'); buffers.brown = noise('brown');
  applyVolumes();
  return ctx;
}
// browsers only allow audio after a user gesture — unlock on the first one
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => { if (settings().sounds !== false || amb.name) ensure(); }, { once: true, capture: true }));

function noise(kind, seconds = 3) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w * .5;
    else if (kind === 'pink') {
      b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852;
      b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926;
    } else { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
  }
  // smooth the loop seam
  const f = Math.min(2000, len / 10);
  for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[len - f + i] * (1 - k); }
  return buf;
}
function applyVolumes() {
  if (!ctx) return;
  const s = settings();
  fxBus.gain.value = s.sounds === false ? 0 : (s.volume ?? .6) * .9;
  if (amb.name) ambBus.gain.setTargetAtTime((s.ambientVolume ?? .5) * .9, ctx.currentTime, .3);
}

// ------------------------------------------------------------------ helpers
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function noiseHit(t, { type = 'bandpass', freq = 2000, q = 1, a = .003, peak = .3, d = .08, buf = 'white', sweepTo = null, dest = fxBus }) {
  const src = ctx.createBufferSource(); src.buffer = buffers[buf];
  src.playbackRate.value = .9 + Math.random() * .2;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(freq, t); fl.Q.value = q;
  if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + a + d);
  const g = ctx.createGain(); env(g, t, a, peak, d);
  src.connect(fl); fl.connect(g); g.connect(dest);
  src.start(t, Math.random() * 2); src.stop(t + a + d + .05);
}
function tone(t, { freq = 440, type = 'sine', a = .005, peak = .2, d = .3, to = null, dest = fxBus }) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + d);
  const g = ctx.createGain(); env(g, t, a, peak, d);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + d + .05);
}

// ------------------------------------------------------------------ effects
const FX = {
  // a pencil tick: scratch + soft wooden tock
  tick(t) {
    noiseHit(t, { freq: 3800, q: 1.2, peak: .18, d: .05 });
    noiseHit(t + .045, { freq: 5200, q: 1.5, peak: .12, d: .06 });
    tone(t + .01, { freq: 1180, type: 'triangle', peak: .12, d: .09, to: 900 });
  },
  // completing the last task / a nice moment: two soft marimba notes
  chime(t) {
    tone(t, { freq: 659.25, type: 'sine', peak: .16, d: .7 }); tone(t, { freq: 1318.5, type: 'sine', peak: .03, d: .4 });
    tone(t + .13, { freq: 987.77, type: 'sine', peak: .14, d: .9 }); tone(t + .13, { freq: 1975.5, type: 'sine', peak: .025, d: .5 });
  },
  // a page turning: a quick papery sweep
  page(t) {
    noiseHit(t, { buf: 'pink', type: 'bandpass', freq: 900, sweepTo: 3400, q: .8, a: .04, peak: .22, d: .28 });
    noiseHit(t + .12, { buf: 'white', type: 'highpass', freq: 3000, a: .02, peak: .06, d: .18 });
  },
  // sticky note pressed onto paper
  stick(t) {
    tone(t, { freq: 160, type: 'sine', peak: .25, d: .09, to: 90 });
    noiseHit(t, { buf: 'pink', freq: 1500, q: .7, peak: .12, d: .07 });
  },
  tap(t) { tone(t, { freq: 880, type: 'triangle', peak: .07, d: .07, to: 760 }); },
  lift(t) { noiseHit(t, { buf: 'pink', type: 'lowpass', freq: 1200, peak: .06, d: .08 }); },
  drop(t) { tone(t, { freq: 300, type: 'sine', peak: .14, d: .1, to: 180 }); noiseHit(t, { buf: 'pink', freq: 1000, peak: .06, d: .05 }); },
  swish(t) { noiseHit(t, { buf: 'pink', type: 'bandpass', freq: 600, sweepTo: 2600, q: .6, a: .03, peak: .1, d: .18 }); },
  // a singing bowl for screen breaks
  bell(t) {
    [[261.6, .18, 3.2], [523.3, .07, 2.6], [784.9, .045, 2.2], [1046.5, .025, 1.6], [1569.8, .012, 1.2]].forEach(([f, p, d]) => {
      tone(t, { freq: f, peak: p, a: .02, d });
      tone(t, { freq: f * 1.004, peak: p * .5, a: .02, d: d * .9 });
    });
  },
  water(t) {
    tone(t, { freq: 520, peak: .12, d: .12, to: 1200 });
    tone(t + .09, { freq: 700, peak: .09, d: .12, to: 1500 });
  },
  pop(t) { tone(t, { freq: 420, type: 'sine', peak: .12, d: .08, to: 900 }); }
};
function play(name, gain = 1) {
  if (settings().sounds === false) return;
  if (!ensure() || !FX[name]) return;
  const t = ctx.currentTime + .01;
  if (gain !== 1) {
    const prev = fxBus.gain.value; fxBus.gain.value = prev * gain;
    FX[name](t);
    setTimeout(() => applyVolumes(), 50);
  } else FX[name](t);
}

// ------------------------------------------------------------------ ambient soundscapes
const amb = { name: null, nodes: [], timers: [] };
const SOUNDSCAPES = {
  rain: { label: 'Rain', ic: 'rain' },
  cafe: { label: 'Café', ic: 'coffee' },
  fire: { label: 'Fireside', ic: 'flame' },
  waves: { label: 'Waves', ic: 'waves' }
};
function loop(buf, filters, gain) {
  const src = ctx.createBufferSource(); src.buffer = buffers[buf]; src.loop = true;
  let node = src;
  filters.forEach(([type, f, q]) => { const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; if (q) fl.Q.value = q; node.connect(fl); node = fl; });
  const g = ctx.createGain(); g.gain.value = gain; node.connect(g); g.connect(ambBus);
  src.start(0, Math.random() * 2);
  amb.nodes.push(src);
  return g;
}
function lfo(param, rate, depth, base) {
  const o = ctx.createOscillator(); o.frequency.value = rate;
  const g = ctx.createGain(); g.gain.value = depth;
  o.connect(g); g.connect(param); param.value = base; o.start();
  amb.nodes.push(o);
}
function every(ms, jitter, fn) {
  const go = () => { if (!amb.name) return; fn(ctx.currentTime + .02); amb.timers.push(setTimeout(go, ms + Math.random() * jitter)); };
  amb.timers.push(setTimeout(go, Math.random() * ms));
}
const BUILD = {
  rain() {
    loop('pink', [['highpass', 400], ['lowpass', 5200]], .55);
    const g = loop('white', [['bandpass', 2600, .5]], .08); lfo(g.gain, .07, .03, .08);
    loop('brown', [['lowpass', 300]], .25);
    every(55, 90, (t) => noiseHit(t, { freq: 2500 + Math.random() * 3500, q: 3, peak: .02 + Math.random() * .05, d: .02 + Math.random() * .03, dest: ambBus }));
  },
  cafe() {
    const hum = loop('brown', [['lowpass', 520]], .55); lfo(hum.gain, .13, .12, .5);
    const talk = loop('pink', [['bandpass', 650, 1.2]], .18); lfo(talk.gain, .4, .08, .16);
    every(1800, 4200, (t) => { const f = 2400 + Math.random() * 2600; tone(t, { freq: f, peak: .018 + Math.random() * .02, d: .25, dest: ambBus }); tone(t + .06, { freq: f * 1.5, peak: .01, d: .2, dest: ambBus }); });
    every(5200, 7000, (t) => noiseHit(t, { buf: 'pink', freq: 900, q: .6, peak: .05, d: .25, dest: ambBus }));
  },
  fire() {
    const roar = loop('brown', [['lowpass', 380]], .7); lfo(roar.gain, .23, .15, .62);
    loop('pink', [['bandpass', 1100, .7]], .05);
    every(70, 260, (t) => { const n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) noiseHit(t + i * .012, { type: 'highpass', freq: 1800 + Math.random() * 3000, peak: .04 + Math.random() * .14, d: .006 + Math.random() * .02, dest: ambBus }); });
    every(1400, 2400, (t) => noiseHit(t, { buf: 'brown', type: 'lowpass', freq: 600, peak: .25, d: .2, dest: ambBus }));
  },
  waves() {
    const sea = loop('pink', [['lowpass', 900]], .5); lfo(sea.gain, .085, .42, .48);
    const fizz = loop('white', [['highpass', 2500], ['lowpass', 7000]], .05); lfo(fizz.gain, .085, .045, .05);
    loop('brown', [['lowpass', 180]], .3);
  }
};
function ambient(name) {
  stopAmbient(true);
  if (!name || !BUILD[name]) return;
  if (!ensure()) return;
  amb.name = name;
  BUILD[name]();
  ambBus.gain.cancelScheduledValues(ctx.currentTime);
  ambBus.gain.setValueAtTime(0.0001, ctx.currentTime);
  ambBus.gain.linearRampToValueAtTime((settings().ambientVolume ?? .5) * .9, ctx.currentTime + 2.5);
}
function stopAmbient(fast) {
  amb.timers.forEach(clearTimeout); amb.timers = [];
  const nodes = amb.nodes; amb.nodes = [];
  amb.name = null;
  if (!ctx) return;
  const t = ctx.currentTime;
  const fade = fast ? .15 : 1.6;
  ambBus.gain.cancelScheduledValues(t);
  ambBus.gain.setValueAtTime(ambBus.gain.value, t);
  ambBus.gain.linearRampToValueAtTime(0.0001, t + fade);
  nodes.forEach(n => { try { n.stop(t + fade + .05); } catch (e) {} });
}

window.Sound = { play, ambient, stopAmbient, applyVolumes, SOUNDSCAPES, current: () => amb.name };
})();
