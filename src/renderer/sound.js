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
  applyStreamVolume();
  if (!ctx) return;
  const s = settings();
  fxBus.gain.value = s.sounds === false ? 0 : (s.volume ?? .6) * .9;
  if (amb.name && !amb.stream) ambBus.gain.setTargetAtTime((s.ambientVolume ?? .5) * .9, ctx.currentTime, .3);
}
let svTimer = null, svLast = 0;
function applyStreamVolume() {
  if (!amb.stream) return;
  const send = () => { svLast = Date.now(); svTimer = null; window.hearth.streamVolume(streamVol()); };
  clearTimeout(svTimer);
  if (Date.now() - svLast > 60) send(); else svTimer = setTimeout(send, 60);
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
    // the soft whoosh of the sheet moving through the air
    noiseHit(t, { buf: 'pink', type: 'bandpass', freq: 700, sweepTo: 1800, q: .6, a: .12, peak: .07, d: .32 });
    // paper crinkle: lots of tiny, dry grains that swell and fade as the page bends over
    const n = 34;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const at = t + .03 + k * .42 + (Math.random() - .5) * .02;
      const env = Math.sin(Math.PI * Math.min(1, k * 1.15));
      noiseHit(at, { buf: 'white', type: 'bandpass', freq: 2200 + Math.random() * 4200, q: 1.4 + Math.random() * 2,
        a: .001, peak: (.012 + Math.random() * .05) * env + .004, d: .006 + Math.random() * .02 });
    }
    // the page settling flat
    noiseHit(t + .47, { buf: 'pink', type: 'lowpass', freq: 650, a: .004, peak: .09, d: .07 });
    noiseHit(t + .47, { buf: 'white', type: 'bandpass', freq: 3000, q: .8, a: .002, peak: .025, d: .04 });
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
    // a gentle, distant singing bowl: soft swell, low and quiet
    [[392, .045, 3.4], [784.9, .014, 2.6], [1176, .006, 1.8]].forEach(([f, p, d]) => {
      tone(t, { freq: f, peak: p, a: .09, d });
      tone(t, { freq: f * 1.003, peak: p * .4, a: .12, d: d * .9 });
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
const amb = { name: null, nodes: [], timers: [], dry: null, wet: null };
const SOUNDSCAPES = {
  rain: { label: 'Rain', ic: 'rain' },
  cafe: { label: 'Café', ic: 'coffee' },
  fire: { label: 'Fireside', ic: 'flame' },
  waves: { label: 'Waves', ic: 'waves' }
};
let roomIR = null;
function room(seconds = 1.6, decay = 3.2) {
  // a soft, diffuse room reverb made from decaying noise
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp = lp * .6 + (Math.random() * 2 - 1) * .4;        // darken the tail a little
      d[i] = lp * Math.pow(1 - t, decay) * (i < 90 ? i / 90 : 1);
    }
  }
  return ir;
}
function busOut(node, wetAmt = 0, pan = 0) {
  // route a source to the dry mix, optionally with reverb and stereo position
  let out = node;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p); out = p; }
  out.connect(amb.dry);
  if (wetAmt) { const s = ctx.createGain(); s.gain.value = wetAmt; out.connect(s); s.connect(amb.wet); }
  return out;
}
function loop(buf, filters, gain, wet = 0, pan = 0) {
  const src = ctx.createBufferSource(); src.buffer = buffers[buf]; src.loop = true;
  src.playbackRate.value = .97 + Math.random() * .06;
  let node = src;
  filters.forEach(([type, f, q]) => { const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; if (q) fl.Q.value = q; node.connect(fl); node = fl; });
  const g = ctx.createGain(); g.gain.value = gain; node.connect(g);
  busOut(g, wet, pan);
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
  const go = () => { if (!amb.name) return; fn(ctx.currentTime + .03); amb.timers.push(setTimeout(go, ms + Math.random() * jitter)); };
  amb.timers.push(setTimeout(go, Math.random() * (ms + jitter)));
}
// a slow, organic random wander for a parameter (smoother and less "wobbly" than a sine LFO)
function wander(param, lo, hi, everyMs, tau) {
  every(everyMs * .6, everyMs * .8, (t) => param.setTargetAtTime(lo + Math.random() * (hi - lo), t, tau));
}
const rnd = (a, b) => a + Math.random() * (b - a);

// one short noise "event" with an instant attack and exponential decay, filtered and panned
function burst(t, { dur = .01, freq = 2000, q = 1, gain = .1, type = 'bandpass', pan = 0, wet = 0, buf = 'white', lp = 0 }) {
  const src = ctx.createBufferSource(); src.buffer = buffers[buf];
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  let node = f;
  src.connect(f);
  if (lp) { const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp; f.connect(l); node = l; }
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  node.connect(g);
  busOut(g, wet, pan);
  src.start(t, Math.random() * 2.5); src.stop(t + dur + .02);
}
function partials(t, f0, ratios, { gain = .03, decay = .4, pan = 0, wet = .3 }) {
  // bell-like ring (cups, spoons, glass)
  const g = ctx.createGain(); g.gain.value = 1; busOut(g, wet, pan);
  ratios.forEach((r, i) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * r;
    const e = ctx.createGain();
    const pk = gain / (1 + i * .9), d = decay / (1 + i * .5);
    e.gain.setValueAtTime(.0001, t); e.gain.exponentialRampToValueAtTime(pk, t + .002); e.gain.exponentialRampToValueAtTime(.0001, t + d);
    o.connect(e); e.connect(g); o.start(t); o.stop(t + d + .05);
  });
}

// ---------- café: distant murmur of conversations, the room's hum, cups and saucers, the odd hiss of steam
function talker(pan) {
  // one distant voice: a buzzy source through two moving vowel formants, gated into syllables and phrases
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  const f0 = rnd(95, 220); o.frequency.value = f0;
  const breath = ctx.createBufferSource(); breath.buffer = buffers.pink; breath.loop = true;
  const bg = ctx.createGain(); bg.gain.value = .35; breath.connect(bg);
  const src = ctx.createGain(); src.gain.value = .5; o.connect(src); bg.connect(src);
  const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5; f1.frequency.value = 500;
  const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = 7; f2.frequency.value = 1400;
  const mix = ctx.createGain(); mix.gain.value = 1;
  src.connect(f1); src.connect(f2);
  const g2 = ctx.createGain(); g2.gain.value = .55; f2.connect(g2);
  f1.connect(mix); g2.connect(mix);
  const muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = rnd(1300, 1900);
  const env = ctx.createGain(); env.gain.value = 0;
  const level = ctx.createGain(); level.gain.value = rnd(.05, .09);
  mix.connect(muffle); muffle.connect(env); env.connect(level);
  busOut(level, .85, pan);
  o.start(); breath.start(0, Math.random() * 2);
  amb.nodes.push(o, breath);
  const VOW = [[300, 2300], [400, 2000], [550, 1700], [700, 1200], [500, 900], [350, 800], [650, 1500]];
  let speaking = Math.random() < .5;
  const tick = () => {
    if (!amb.name) return;
    const t = ctx.currentTime + .02;
    if (speaking) {
      const v = VOW[Math.floor(Math.random() * VOW.length)];
      f1.frequency.setTargetAtTime(v[0] * rnd(.9, 1.1), t, .03);
      f2.frequency.setTargetAtTime(v[1] * rnd(.9, 1.1), t, .03);
      o.frequency.setTargetAtTime(f0 * rnd(.85, 1.25), t, .06);
      const syl = rnd(.09, .22);
      env.gain.setTargetAtTime(rnd(.5, 1), t, .015);
      env.gain.setTargetAtTime(rnd(0, .25), t + syl, .03);
      if (Math.random() < .07) speaking = false;           // end of a phrase
      amb.timers.push(setTimeout(tick, (syl + rnd(.02, .08)) * 1000));
    } else {
      env.gain.setTargetAtTime(0, t, .08);
      speaking = true;
      amb.timers.push(setTimeout(tick, rnd(600, 2600)));
    }
  };
  amb.timers.push(setTimeout(tick, Math.random() * 1500));
}
function clink(t, pan) {
  const f = rnd(2300, 3600);
  partials(t, f, [1, 2.32, 4.25, 6.6], { gain: rnd(.012, .03), decay: rnd(.25, .6), pan, wet: .5 });
  burst(t, { dur: .012, freq: f * 1.3, q: 3, gain: .02, pan, wet: .3 });
}
const BUILD = {
  rain() {
    loop('pink', [['highpass', 400], ['lowpass', 5200]], .55);
    const g = loop('white', [['bandpass', 2600, .5]], .08); lfo(g.gain, .07, .03, .08);
    loop('brown', [['lowpass', 300]], .25);
    every(55, 90, (t) => burst(t, { freq: 2500 + Math.random() * 3500, q: 3, gain: .02 + Math.random() * .05, dur: .02 + Math.random() * .03, pan: rnd(-.6, .6) }));
  },
  cafe() {
    // room tone & air handling
    const hum = loop('brown', [['lowpass', 260]], .32); wander(hum.gain, .25, .38, 4000, 1.5);
    loop('pink', [['bandpass', 180, .8]], .06);
    // the general hubbub: band-limited noise that swells and settles like a room full of chat
    const crowd = loop('pink', [['bandpass', 520, .9], ['lowpass', 1600]], .07, .9);
    wander(crowd.gain, .045, .1, 1800, .6);
    const crowd2 = loop('pink', [['bandpass', 1100, 1.4]], .025, .9, .4);
    wander(crowd2.gain, .01, .035, 900, .25);
    // individual distant voices, spread across the room
    [-.7, -.35, -.1, .2, .45, .75].forEach(talker);
    // cups, saucers and spoons
    every(2200, 5200, (t) => { const pan = rnd(-.8, .8); clink(t, pan); if (Math.random() < .35) clink(t + rnd(.12, .3), pan); });
    // a spoon stirring now and then
    every(14000, 16000, (t) => { const pan = rnd(-.6, .6), n = 4 + Math.floor(Math.random() * 5); for (let i = 0; i < n; i++) partials(t + i * rnd(.11, .16), rnd(3400, 4200), [1, 2.7], { gain: .008, decay: .12, pan, wet: .4 }); });
    // cup set down on a saucer (a soft knock)
    every(6000, 9000, (t) => { const pan = rnd(-.7, .7); burst(t, { buf: 'pink', type: 'lowpass', freq: 900, gain: .06, dur: .07, pan, wet: .5 }); partials(t, rnd(900, 1300), [1, 2.1], { gain: .012, decay: .18, pan, wet: .5 }); });
    // the espresso machine's steam wand, occasionally
    every(38000, 40000, (t) => {
      const src = ctx.createBufferSource(); src.buffer = buffers.white; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 4200; f.Q.value = .8;
      const g = ctx.createGain(); const len = rnd(3, 6);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.022, t + .5);
      g.gain.setTargetAtTime(.016, t + .6, 1); g.gain.setTargetAtTime(.0001, t + len, .3);
      src.connect(f); f.connect(g); busOut(g, .6, rnd(.3, .8));
      src.start(t); src.stop(t + len + 2);
    });
  },
  fire() {
    // the body of the fire: a deep, breathing roar that never quite settles
    const roar = loop('brown', [['lowpass', 170, .7]], .55);
    wander(roar.gain, .38, .72, 700, .25);
    const breath = loop('pink', [['bandpass', 420, .7]], .1, .2);
    wander(breath.gain, .04, .14, 1100, .4);
    // a quiet hiss of gas and sap
    const hiss = loop('white', [['highpass', 2800], ['lowpass', 7500]], .012, .2);
    wander(hiss.gain, .004, .02, 1500, .5);
    // crackles: mostly tiny ticks with the odd sharper snap, softened so nothing is harsh
    const crackle = (t, big) => {
      const amp = big ? rnd(.18, .32) : .015 + .16 * Math.pow(Math.random(), 3.2);
      burst(t, { dur: big ? rnd(.02, .045) : rnd(.003, .014), freq: rnd(900, 3800), q: rnd(.7, 1.6), gain: amp, pan: rnd(-.5, .5), wet: .15, lp: 6500 });
    };
    every(70, 240, (t) => crackle(t, false));
    // little flurries of popping, like resin catching
    every(2500, 5000, (t) => { const n = 3 + Math.floor(Math.random() * 9); let tt = t; for (let i = 0; i < n; i++) { tt += rnd(.015, .09); crackle(tt, false); } });
    // a log shifting: a deeper thump with a snap
    every(4500, 9000, (t) => {
      crackle(t, true);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(rnd(85, 130), t); o.frequency.exponentialRampToValueAtTime(55, t + .2);
      const g = ctx.createGain(); g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .006); g.gain.exponentialRampToValueAtTime(.0001, t + .22);
      o.connect(g); busOut(g, .2, rnd(-.3, .3)); o.start(t); o.stop(t + .3);
      burst(t, { buf: 'brown', type: 'lowpass', freq: 500, gain: .3, dur: .25, wet: .2 });
    });
  },
  waves() {
    const sea = loop('pink', [['lowpass', 900]], .5); lfo(sea.gain, .085, .42, .48);
    const fizz = loop('white', [['highpass', 2500], ['lowpass', 7000]], .05); lfo(fizz.gain, .085, .045, .05);
    loop('brown', [['lowpass', 180]], .3);
  }
};
// ---------- streamed soundscapes (YouTube or any link), played by Hearth in the background
const DEFAULT_LINKS = {
  fire: 'https://www.youtube.com/watch?v=cdKop6aixVE',
  cafe: 'https://www.youtube.com/watch?v=c18WZZa4KIA',
  rain: 'https://www.youtube.com/watch?v=HWgOhngBGZo',
  waves: 'https://www.youtube.com/watch?v=bn9F19Hi1Lk'
};
const canStream = () => !!(window.hearth && window.hearth.streamPlay);
function sourceFor(name) {
  const s = settings();
  const custom = (s.customSounds || []).find(c => c.id === name);
  if (custom) return canStream() ? { kind: 'stream', url: custom.url, label: custom.name } : { kind: 'none', label: custom.name };
  if (!BUILD[name]) return { kind: 'none' };
  const src = (s.soundSources || {})[name] || {};
  const mode = src.mode || 'stream';
  if (mode === 'stream' && canStream()) return { kind: 'stream', url: src.url || DEFAULT_LINKS[name] };
  return { kind: 'synth' };
}
// ears hear loudness on a curve, so a straight line made the bottom half of the slider barely quieter
const streamVol = () => { const v = Math.max(0, Math.min(1, settings().ambientVolume ?? .5)); return +(Math.pow(v, 2) * .85).toFixed(4); };
if (window.hearth && window.hearth.onStreamState) {
  window.hearth.onStreamState((st) => {
    if (!amb.stream || st.url !== amb.streamUrl) return;
    amb.streamState = st.state;
    if (st.state === 'error') {
      const name = amb.name;
      amb.stream = false; amb.name = null;
      if (BUILD[name]) {
        startSynth(name);
        window.H && window.H.toast("Couldn't reach that stream, so the built-in sound is playing instead", { ic: 'globe', timeout: 6000 });
      } else {
        window.H && window.H.toast("Couldn't play that link. Check it's a public video or audio link.", { ic: 'globe', timeout: 6000 });
      }
      window.H && window.H.refreshQuiet && window.H.refreshQuiet();
    }
  });
}
function ambient(name) {
  stopAmbient(true);
  const src = sourceFor(name);
  if (src.kind === 'none') return;
  if (src.kind === 'stream') {
    amb.name = name; amb.stream = true; amb.streamUrl = src.url; amb.streamState = 'loading';
    window.hearth.streamPlay(src.url, streamVol());
    return;
  }
  startSynth(name);
}
function startSynth(name) {
  if (!name || !BUILD[name]) return;
  if (!ensure()) return;
  amb.name = name;
  amb.dry = ctx.createGain(); amb.dry.connect(ambBus);
  amb.wet = ctx.createConvolver();
  if (!roomIR) roomIR = room();
  amb.wet.buffer = roomIR;
  const wetGain = ctx.createGain(); wetGain.gain.value = name === 'cafe' ? .9 : .5;
  amb.wet.connect(wetGain); wetGain.connect(ambBus);
  amb.nodes.push({ stop: () => { try { amb.dry.disconnect(); } catch (e) {} } });
  BUILD[name]();
  ambBus.gain.cancelScheduledValues(ctx.currentTime);
  ambBus.gain.setValueAtTime(0.0001, ctx.currentTime);
  ambBus.gain.linearRampToValueAtTime((settings().ambientVolume ?? .5) * .9, ctx.currentTime + 2.5);
}
function stopAmbient(fast) {
  if (amb.stream) { window.hearth.streamStop(!!fast); amb.stream = false; amb.streamUrl = null; amb.name = null; return; }
  amb.timers.forEach(clearTimeout); amb.timers = [];
  const nodes = amb.nodes; amb.nodes = [];
  amb.name = null;
  if (!ctx) return;
  const t = ctx.currentTime;
  const fade = fast ? .15 : 1.6;
  ambBus.gain.cancelScheduledValues(t);
  ambBus.gain.setValueAtTime(ambBus.gain.value, t);
  ambBus.gain.linearRampToValueAtTime(0.0001, t + fade);
  const dry = amb.dry, wet = amb.wet; amb.dry = amb.wet = null;
  nodes.forEach(n => { try { if (n.start) n.stop(t + fade + .05); } catch (e) {} });
  setTimeout(() => { try { dry && dry.disconnect(); wet && wet.disconnect(); } catch (e) {} }, (fade + .2) * 1000);
}

window.Sound = { play, ambient, stopAmbient, applyVolumes, SOUNDSCAPES, DEFAULT_LINKS, sourceFor, canStream, current: () => amb.name, streaming: () => !!amb.stream, streamState: () => amb.streamState, _ctx: () => ctx, _bus: () => ambBus };
})();
