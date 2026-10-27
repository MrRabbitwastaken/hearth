/* Hearth — seasonal themes: palette tweaks plus a few gentle drifting decorations */
(() => {
'use strict';

const SEASONS = {
  autumn: { label: 'Autumn', ic: 'leaf' },
  winter: { label: 'Winter', ic: 'snow' },
  spring: { label: 'Spring', ic: 'flower' },
  summer: { label: 'Summer', ic: 'sun' }
};
function seasonFor(d = new Date()) {
  const m = d.getMonth();
  if (m === 11 || m <= 1) return 'winter';
  if (m <= 4) return 'spring';
  if (m <= 7) return 'summer';
  return 'autumn';
}

let canvas = null, ctx2 = null, parts = [], raf = null, current = null, last = 0, fxOn = false;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

function apply(settings) {
  const pick = settings.season || 'auto';
  const s = pick === 'off' ? null : pick === 'auto' ? seasonFor() : pick;
  const root = document.documentElement;
  if (s) root.dataset.season = s; else delete root.dataset.season;
  current = s;
  fxOn = !!(s && settings.seasonFx !== false && !REDUCED);
  if (fxOn) start(); else stop();
}

// ------------------------------------------------------------------ particles
function start() {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'season-fx';
    document.body.appendChild(canvas);
    ctx2 = canvas.getContext('2d');
    window.addEventListener('resize', size);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && fxOn) loop(performance.now()); });
  }
  size();
  const n = current === 'summer' ? 14 : current === 'winter' ? 34 : 16;
  parts = Array.from({ length: n }, () => spawn(true));
  cancelAnimationFrame(raf);
  canvas.style.display = '';
  loop(performance.now());
}
function stop() { cancelAnimationFrame(raf); raf = null; if (canvas) { canvas.style.display = 'none'; ctx2.clearRect(0, 0, canvas.width, canvas.height); } }
function size() {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
  ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const rnd = (a, b) => a + Math.random() * (b - a);
const LEAF_COLS = ['#C8692E', '#D9893A', '#B5482A', '#E0A43F', '#9C5B2E'];
const PETAL_COLS = ['#F4C7CF', '#F7D6DC', '#EFB3C0', '#FBE3E7'];
function spawn(initial) {
  const w = innerWidth, h = innerHeight;
  const p = { x: rnd(0, w), y: initial ? rnd(-h, h) : rnd(-60, -20), rot: rnd(0, Math.PI * 2), vr: rnd(-.02, .02), phase: rnd(0, 6.28) };
  if (current === 'winter') Object.assign(p, { r: rnd(1.4, 3.6), vy: rnd(.25, .7), vx: rnd(-.15, .15), a: rnd(.35, .8) });
  else if (current === 'autumn') Object.assign(p, { r: rnd(7, 12), vy: rnd(.35, .8), vx: rnd(-.2, .35), a: rnd(.55, .85), c: LEAF_COLS[Math.floor(Math.random() * LEAF_COLS.length)] });
  else if (current === 'spring') Object.assign(p, { r: rnd(4, 7), vy: rnd(.3, .65), vx: rnd(.05, .4), a: rnd(.6, .9), c: PETAL_COLS[Math.floor(Math.random() * PETAL_COLS.length)] });
  else Object.assign(p, { r: rnd(1.5, 3.2), vy: rnd(-.25, -.08), vx: rnd(-.1, .1), a: rnd(.25, .6), y: initial ? rnd(0, h) : h + 20 });
  return p;
}
function draw(p, t) {
  const c = ctx2;
  c.save();
  c.globalAlpha = p.a;
  c.translate(p.x, p.y); c.rotate(p.rot);
  if (current === 'winter') {
    const dark = document.documentElement.dataset.theme === 'dark';
    c.fillStyle = dark ? 'rgba(240,244,250,.9)' : 'rgba(150,170,195,.75)';
    c.beginPath(); c.arc(0, 0, p.r, 0, 6.283); c.fill();
  } else if (current === 'autumn') {
    const r = p.r * (.75 + .25 * Math.cos(t / 600 + p.phase));
    c.fillStyle = p.c;
    c.beginPath(); c.moveTo(0, -r); c.quadraticCurveTo(r * .9, -r * .2, 0, r); c.quadraticCurveTo(-r * .9, -r * .2, 0, -r); c.fill();
    c.strokeStyle = 'rgba(80,40,20,.35)'; c.lineWidth = .8; c.beginPath(); c.moveTo(0, -r * .8); c.lineTo(0, r * 1.15); c.stroke();
  } else if (current === 'spring') {
    const r = p.r;
    c.fillStyle = p.c;
    c.beginPath(); c.ellipse(0, 0, r, r * .62 * (.7 + .3 * Math.sin(t / 500 + p.phase)), 0, 0, 6.283); c.fill();
  } else {
    const g = c.createRadialGradient(0, 0, 0, 0, 0, p.r * 3);
    g.addColorStop(0, 'rgba(255,214,120,.9)'); g.addColorStop(1, 'rgba(255,214,120,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, p.r * 3, 0, 6.283); c.fill();
  }
  c.restore();
}
function loop(now) {
  if (!fxOn || document.hidden) return;
  raf = requestAnimationFrame(loop);
  if (now - last < 33) return; // ~30fps is plenty for drifting things
  const dt = Math.min(3, (now - last) / 16.7); last = now;
  ctx2.clearRect(0, 0, innerWidth, innerHeight);
  const h = innerHeight, w = innerWidth;
  parts.forEach((p, i) => {
    p.x += (p.vx + Math.sin(now / 1400 + p.phase) * (current === 'winter' ? .25 : .45)) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.y > h + 30 || p.y < -80 || p.x < -40 || p.x > w + 40) parts[i] = spawn(false);
    draw(p, now);
  });
}

window.Seasons = { apply, seasonFor, SEASONS };
})();
