/* Hearth — renderer */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const icon = window.icon;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(.22, 1, .36, 1)';
const IS_CAPTURE = location.hash === '#capture';

const PROJECT_COLOURS = ['#BF6239', '#6B8A5A', '#C68A27', '#8A5A6B', '#5F8496', '#8C8445', '#A0714F'];
const STRETCHES = [
  '<b>Roll your shoulders</b> back ten times, slowly.',
  '<b>Stand up</b> and reach for the ceiling, then let your arms drop.',
  '<b>Tilt your head</b> gently to each side and hold for a few breaths.',
  '<b>Walk to the window</b> or fill up your water.',
  '<b>Open and close your hands</b> a few times, then shake them out.',
  '<b>Clasp your hands</b> behind your back and open your chest.',
  '<b>Blink slowly</b> ten times to rewet your eyes.'
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ------------------------------------------------------------------ data model
function defaultData() {
  return {
    version: 1, tasks: [], projects: [], waiting: [], recurring: [], snippets: [], notebooks: [], pages: [], noteTemplates: [],
    focusLog: [], dayLog: {}, meta: {},
    settings: {
      name: '', breakInterval: 60, snoozeMinutes: 10, idleResetMinutes: 5,
      wrapTime: '17:00', focusMinutes: 25, launchAtStartup: true, closeToTray: true,
      staleProjectDays: 7, hotkey: 'CommandOrControl+Alt+Space', theme: 'light',
      nav: { hidden: [], order: [] },
      season: 'auto', seasonFx: false, noteFont: 'auto', hiddenWidgets: [], fxDefaultV2: true, customSounds: [], soundSources: {},
      sounds: true, volume: 0.6,
      ambient: 'rain', ambientAuto: true, ambientVolume: 0.5, focusShield: true, dnd: true,
      waterOn: true, waterEvery: 90, waterGoal: 8, postureOn: true, postureEvery: 45,
      smartAdd: true, remindAtTime: true, dayStart: 7, dayEnd: 19
    }
  };
}
function normalise(d) {
  const def = defaultData();
  const out = { ...def, ...(d || {}) };
  out.settings = { ...def.settings, ...((d && d.settings) || {}) };
  out.settings.nav = { hidden: [], order: [], ...(out.settings.nav || {}) };
  // 1.3: seasonal decorations are now off unless switched on
  if (d && d.settings && !d.settings.fxDefaultV2) { out.settings.seasonFx = false; out.settings.fxDefaultV2 = true; }
  out.settings.customSounds = out.settings.customSounds || [];
  out.settings.soundSources = out.settings.soundSources || {};
  out.meta = out.meta || {};
  out.meta.breaks = out.meta.breaks || {};
  out.dayLog = out.dayLog || {};
  out.notebooks = out.notebooks || [];
  out.pages = out.pages || [];
  out.noteTemplates = out.noteTemplates || [];
  out.meta.water = out.meta.water || {};
  return out;
}

// ------------------------------------------------------------------ api (desktop or browser fallback)
const api = window.hearth || makeShim();

function makeShim() {
  const KEY = 'hearth-data-v1';
  const L = { status: [], due: [], data: [] };
  const load = () => { try { return normalise(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return normalise(null); } };
  let st = { activeSeconds: 0, intervalSeconds: 3600, snoozedUntil: 0, due: false, away: false, sessionStart: Date.now() };
  const emit = (k) => L[k].forEach(f => f({ ...st }));
  setInterval(() => {
    st.intervalSeconds = load().settings.breakInterval * 60;
    if (!st.due) {
      st.activeSeconds += 5;
      if (st.activeSeconds >= st.intervalSeconds && Date.now() >= st.snoozedUntil) { st.due = true; emit('due'); }
    }
    emit('status');
  }, 5000);
  const shim = {
    isDesktop: false,
    getData: async () => load(),
    setData: async (d) => { localStorage.setItem(KEY, JSON.stringify(d)); return true; },
    addTask: async (t) => { const d = load(); d.tasks.push(t); localStorage.setItem(KEY, JSON.stringify(d)); return true; },
    addSticky: async (st) => { const d = load(); window.inboxSticky(d, st); localStorage.setItem(KEY, JSON.stringify(d)); return true; },
    saveImage: async (dataUrl) => dataUrl,
    exportPdf: async (html) => { const w = window.open('', '_blank'); if (!w) return false; w.document.write(html); w.document.close(); setTimeout(() => w.print(), 600); return true; },
    onDataChanged: (f) => L.data.push(f),
    getBreak: async () => ({ ...st, intervalSeconds: load().settings.breakInterval * 60 }),
    breakTaken: async () => { st = { ...st, activeSeconds: 0, due: false, snoozedUntil: 0 }; emit('status'); return { ...st }; },
    breakSnooze: async () => { st.snoozedUntil = Date.now() + load().settings.snoozeMinutes * 60000; st.due = false; emit('status'); return { ...st }; },
    breakNow: async () => { st.due = true; emit('due'); return { ...st }; },
    onBreakStatus: (f) => L.status.push(f),
    onBreakDue: (f) => L.due.push(f),
    notify: async (t, b) => console.info('[notify]', t, '—', b),
    show: async () => {},
    openExternal: async (u) => window.open(u, '_blank'),
    copy: async (t) => { try { await navigator.clipboard.writeText(t); } catch (e) {} },
    setTheme: async () => {},
    closeCapture: async () => {},
    hotkeyOk: async () => true,
    dataPath: async () => 'Browser storage (preview mode)',
    exportData: async () => {
      const blob = new Blob([JSON.stringify(load(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `hearth-backup-${dayKey()}.json`; a.click(); return true;
    },
    importData: async () => null,
    _setActive(sec) { st.activeSeconds = sec; st.due = false; emit('status'); }
  };
  window.__shim = shim;
  return shim;
}

// ------------------------------------------------------------------ helpers
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dayKey(d); };
const diffDays = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 86400000);
const today = () => dayKey();
const tomorrow = () => addDays(today(), 1);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + 's')}`;
const fmtLong = (k) => parseKey(k).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = (k) => parseKey(k).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const fmtMins = (m) => { m = Math.round(m); if (m < 60) return `${m}m`; const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; };
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function relDay(k) {
  const n = diffDays(today(), k);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n < 0) return `${-n} days ago`;
  if (n < 7) return parseKey(k).toLocaleDateString('en-GB', { weekday: 'long' });
  return fmtShort(k);
}
function relLow(k) { const r = relDay(k); return /^(Today|Tomorrow|Yesterday)$/.test(r) ? r.toLowerCase() : r; }
function daysSince(ts) { return Math.floor((Date.now() - ts) / 86400000); }
function greeting() { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }

function ring(size, stroke, pct, { cls = '', live = '', label = '' } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct)));
  return `<div class="ring ${cls}" ${live ? `data-live="${live}"` : ''} style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}"><circle class="track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle class="bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${off}" data-c="${c}"/></svg>
    ${label !== '' ? `<div class="ring-label">${label}</div>` : ''}</div>`;
}
function setRing(el, pct) {
  if (!el) return;
  const bar = el.querySelector('.bar'); if (!bar) return;
  const c = +bar.dataset.c;
  bar.setAttribute('stroke-dashoffset', c * (1 - Math.max(0, Math.min(1, pct))));
}

// ------------------------------------------------------------------ state
let D = normalise(null);
const state = {
  view: 'today', entering: true, day: today(),
  addWhen: 'today', addProject: '', showDone: false, showTomorrow: true, showUpcoming: false,
  projectFilter: 'active', snipQuery: '', snipForm: null, recForm: { freq: 'weekdays', days: [1], dom: 1 },
  weekOffset: 0, modal: null, breakOpen: false, pendingBreak: false, appInfo: {}, recOpen: new Set(), projDone: new Set(),
  filter: { tag: null, prio: 0 }, lastWater: Date.now(), lastPosture: Date.now(),
  brk: { status: { activeSeconds: 0, intervalSeconds: 3600, snoozedUntil: 0, due: false, away: false }, at: Date.now() }
};

let saveTimer = null;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => api.setData(D), 120); }
function flush() { clearTimeout(saveTimer); return api.setData(D); }
const snapshot = () => JSON.stringify(D);
function restore(s) { D = normalise(JSON.parse(s)); save(); refresh(); }

// ------------------------------------------------------------------ selectors
const byOrder = (a, b) => (a.order ?? a.createdAt) - (b.order ?? b.createdAt);
const T = {
  get: (id) => D.tasks.find(t => t.id === id),
  today: () => D.tasks.filter(t => !t.done && t.date === today()).sort(byOrder),
  overdue: () => D.tasks.filter(t => !t.done && t.date && t.date < today()).sort((a, b) => a.date.localeCompare(b.date) || byOrder(a, b)),
  tomorrow: () => D.tasks.filter(t => !t.done && t.date === tomorrow()).sort(byOrder),
  upcoming: () => D.tasks.filter(t => !t.done && t.date && t.date > tomorrow()).sort((a, b) => a.date.localeCompare(b.date)),
  doneOn: (k) => D.tasks.filter(t => t.done && t.doneDate === k).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)),
  ofProject: (pid) => D.tasks.filter(t => t.projectId === pid)
};
const P = {
  get: (id) => D.projects.find(p => p.id === id),
  active: () => D.projects.filter(p => p.status === 'active'),
  stale: () => P.active().filter(p => daysSince(p.updatedAt || p.createdAt) >= D.settings.staleProjectDays)
};
const W = {
  open: () => D.waiting.filter(w => !w.done).sort((a, b) => a.since.localeCompare(b.since)),
  days: (w) => diffDays(w.since, today()),
  due: (w) => !w.done && diffDays(w.lastChased || w.since, today()) >= (w.nudgeDays || 3),
  dueList: () => W.open().filter(W.due)
};

function newTask(title, { date, projectId = null, recurringId = null } = {}) {
  return {
    id: uid(), title: title.trim(), date: date === undefined ? today() : date, done: false,
    doneAt: null, doneDate: null, projectId, recurringId, createdAt: Date.now(), order: Date.now(), carried: 0,
    priority: 0, tags: [], subtasks: [], time: null, duration: 30, remind: null, notes: ''
  };
}
function touchProject(pid) { const p = P.get(pid); if (p) p.updatedAt = Date.now(); }

// ------------------------------------------------------------------ recurring
function ruleMatches(r, k) {
  const d = parseKey(k), wd = d.getDay();
  switch (r.freq) {
    case 'daily': return true;
    case 'weekdays': return wd >= 1 && wd <= 5;
    case 'weekly': return (r.days || []).includes(wd);
    case 'monthly': {
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return d.getDate() === Math.min(r.dom || 1, last);
    }
  }
  return false;
}
function describeRule(r) {
  if (r.freq === 'daily') return 'Every day';
  if (r.freq === 'weekdays') return 'Every weekday';
  if (r.freq === 'weekly') {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const days = order.filter(d => (r.days || []).includes(d)).map(d => WEEKDAYS[d]);
    return days.length ? 'Every ' + days.join(', ') : 'Weekly (no days picked)';
  }
  if (r.freq === 'monthly') return `Monthly on the ${ordinal(r.dom || 1)}`;
  return '';
}
function nextOccurrence(r) {
  const start = r.lastGenerated === today() ? 1 : 0;
  for (let i = start; i < 70; i++) { const k = addDays(today(), i); if (ruleMatches(r, k)) return k; }
  return null;
}
function ensureRecurring() {
  const k = today(); let changed = false;
  for (const r of D.recurring) {
    if (r.active === false || r.lastGenerated === k || !ruleMatches(r, k)) continue;
    if (!D.tasks.some(t => t.recurringId === r.id && t.date === k)) {
      const nt = newTask(r.title, { projectId: r.projectId || null, recurringId: r.id });
      if (r.time) { nt.time = r.time; if (D.settings.remindAtTime) nt.remind = 0; }
      if (r.notes) nt.notes = r.notes;
      if (r.priority) nt.priority = r.priority;
      if ((r.steps || []).length) nt.subtasks = r.steps.filter(x => x.title.trim()).map(x => ({ id: uid(), title: x.title, done: false }));
      D.tasks.push(nt);
    }
    r.lastGenerated = k; changed = true;
  }
  if (changed) save();
}

// ------------------------------------------------------------------ animation helpers
function captureFocus() {
  const a = document.activeElement;
  if (!a || !a.id) return null;
  return { id: a.id, start: a.selectionStart, end: a.selectionEnd };
}
function restoreFocus(f) {
  if (!f) return;
  const el = document.getElementById(f.id);
  if (!el) return;
  el.focus({ preventScroll: true });
  try { if (f.start != null) el.setSelectionRange(f.start, f.end); } catch (e) {}
}
function flipRender(container, html) {
  const before = new Map();
  $$('[data-k]', container).forEach(el => before.set(el.dataset.k, el.getBoundingClientRect()));
  const f = captureFocus();
  container.innerHTML = html;
  restoreFocus(f);
  if (REDUCED) return;
  $$('[data-k]', container).forEach(el => {
    const b = before.get(el.dataset.k);
    if (!b) {
      if (before.size) el.animate(
        [{ opacity: 0, transform: 'translateY(8px) scale(.98)' }, { opacity: 1, transform: 'none' }],
        { duration: 380, easing: EASE, fill: 'backwards' });
      return;
    }
    const a = el.getBoundingClientRect();
    const dx = b.left - a.left, dy = b.top - a.top;
    if (Math.abs(dx) > .5 || Math.abs(dy) > .5) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 460, easing: EASE });
    }
  });
}
function animateOut(el, kind = 'collapse') {
  if (!el || REDUCED) return Promise.resolve();
  const h = el.offsetHeight;
  const frames = {
    right: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(40px)' }],
    left: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-40px)' }],
    collapse: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }]
  }[kind];
  const a1 = el.animate(frames, { duration: 260, easing: EASE, fill: 'forwards' });
  return a1.finished.then(() => {
    el.style.overflow = 'hidden';
    const a2 = el.animate([{ height: h + 'px', marginTop: getComputedStyle(el).marginTop }, { height: '0px', minHeight: '0px', paddingTop: 0, paddingBottom: 0, marginTop: '-6px', borderWidth: 0 }],
      { duration: 220, easing: EASE, fill: 'forwards' });
    return a2.finished;
  });
}
const rowEl = (id) => document.querySelector(`[data-id="${CSS.escape(id)}"]`);

// ------------------------------------------------------------------ toasts
function toast(msg, { ic = 'check', action = null, timeout = 4200 } = {}) {
  const root = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `${icon(ic, 'sm')}<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  root.appendChild(el);
  while (root.children.length > 3) root.firstChild.remove();
  const close = () => { if (!el.isConnected) return; el.classList.add('out'); setTimeout(() => el.remove(), 300); };
  if (action) el.querySelector('button').onclick = () => { action.fn(); close(); };
  setTimeout(close, timeout);
}
function undoable(msg, snap, ic = 'check') { toast(msg, { ic, action: { label: 'Undo', fn: () => restore(snap) } }); }

// ------------------------------------------------------------------ theme
function applyNav() {
  document.documentElement.classList.toggle('nav-collapsed', !!D.settings.navCollapsed);
}
function toggleNav() {
  D.settings.navCollapsed = !D.settings.navCollapsed;
  applyNav(); save(); buildSidebar(); updateSidebar();
  setTimeout(updateSidebar, 450);
  if (state.view === 'settings') refresh();
}
function applyTheme() {
  applyNav();
  const pref = D.settings.theme || 'light';
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  api.setTheme && api.setTheme(dark);
  window.Seasons && window.Seasons.apply(D.settings);
  window.Sound && window.Sound.applyVolumes();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ================================================================== SIDEBAR
const NAV_ALL = {
  today: { label: 'Today', ic: 'sun' },
  calendar: { label: 'Calendar', ic: 'calendar' },
  projects: { label: 'Projects', ic: 'folder' },
  notes: { label: 'Notebooks', ic: 'book' },
  waiting: { label: 'Waiting on', ic: 'hand' },
  recurring: { label: 'Recurring', ic: 'repeat' },
  snippets: { label: 'Snippets & links', ic: 'bookmark' },
  week: { label: 'Weekly review', ic: 'chart' },
  settings: { label: 'Settings', ic: 'sliders' }
};
const NAV_CUSTOM = ['calendar', 'projects', 'notes', 'waiting', 'recurring', 'snippets', 'week'];
function navOrder() {
  const o = (D.settings.nav.order || []).filter(id => NAV_CUSTOM.includes(id));
  return o.concat(NAV_CUSTOM.filter(id => !o.includes(id)));
}
function visibleNav() {
  const hidden = D.settings.nav.hidden || [];
  return ['today', ...navOrder().filter(id => !hidden.includes(id)), 'settings'];
}
function buildSidebar() {
  const ids = visibleNav();
  const item = (id) => `<button class="nav-item" data-view="${id}" title="${NAV_ALL[id].label}">${icon(NAV_ALL[id].ic)}<span>${NAV_ALL[id].label}</span><span class="count" data-count="${id}"></span></button>`;
  $('#sidebar').innerHTML = `
    <div class="brand"><img class="brand-logo" src="logo.png" alt="" draggable="false"><div class="brand-name">Hearth</div>
      <button class="icon-btn mini sound-toggle ${D.settings.sounds ? '' : 'muted'}" data-act="sound-toggle" title="${D.settings.sounds ? 'Mute sounds' : 'Turn sounds on'}">${icon(D.settings.sounds ? 'volume' : 'mute', 'sm')}</button></div>
    <nav class="nav" id="nav"><div class="nav-pill" id="nav-pill"></div>
      ${ids.slice(0, -1).map(item).join('')}
      <div class="nav-sep"></div>
      ${item('settings')}
      <button class="nav-item nav-collapse" data-act="nav-collapse" title="${D.settings.navCollapsed ? 'Expand menu' : 'Collapse menu'} (Ctrl+\\)">${icon('sidebar')}<span>${D.settings.navCollapsed ? 'Expand menu' : 'Collapse menu'}</span></button>
    </nav>
    <div class="sidebar-foot" id="sidebar-foot"></div>`;
}
function updateSidebar() {
  const counts = {
    today: T.today().length + T.overdue().length,
    projects: P.active().length,
    waiting: W.open().length,
    recurring: D.recurring.filter(r => r.active !== false).length,
    snippets: D.snippets.length,
    notes: D.notebooks.length,
    calendar: D.tasks.filter(t => !t.done && t.date === today() && t.time).length
  };
  $$('.nav-item').forEach(b => {
    const on = b.dataset.view === state.view;
    b.classList.toggle('active', on);
    const c = b.querySelector('.count');
    const n = counts[b.dataset.view];
    if (c) {
      c.textContent = n ? n : '';
      c.style.display = n ? '' : 'none';
      c.classList.toggle('alert', b.dataset.view === 'waiting' && W.dueList().length > 0);
    }
  });
  const act = $(`.nav-item[data-view="${state.view}"]`), pill = $('#nav-pill');
  if (pill) pill.style.opacity = act ? 1 : 0;
  if (act && pill) { pill.style.transform = `translateY(${act.offsetTop}px)`; pill.style.height = act.offsetHeight + 'px'; }

  // foot widgets
  const f = D.meta.focus;
  const foot = $('#sidebar-foot');
  const sig = (f ? 'f' + (f.running ? 'r' : 'p') : '') + '|b';
  if (foot.dataset.sig !== sig) {
    foot.dataset.sig = sig;
    foot.innerHTML = `
      ${f ? `<div class="clock-widget focus" data-k="w-focus">
        ${ring(42, 4, 0, { cls: 'sage', live: 'focus-ring' })}
        <div class="meta"><div class="label">Focus</div><div class="value" data-live="focus-text">--</div><div class="sub">${esc(f.label || 'Focus session')}</div></div>
        <div class="mini-btns">
          ${f.running ? `<button class="icon-btn" data-act="focus-pause" title="Pause">${icon('pause', 'sm')}</button>` : `<button class="icon-btn go" data-act="focus-resume" title="Resume">${icon('play', 'sm')}</button>`}
          <button class="icon-btn danger" data-act="focus-stop" title="Stop">${icon('stop', 'sm')}</button>
        </div></div>` : ''}
      <div class="clock-widget" title="Screen-break clock — it pauses when you lock your PC or step away">
        <div class="ring-wrap">${ring(42, 4, 0, { live: 'brk-ring' })}<button class="ring-reset" data-act="brk-reset" title="Reset the break clock">${icon('reset', 'sm')}</button></div>
        <div class="meta"><div class="label">Next break</div><div class="value" data-live="brk-text">--</div><div class="sub" data-live="brk-sub">On screen 0m</div></div>
      </div>`;
  }
  updateLive();
}

// ================================================================== VIEWS
const stg = () => (state.entering ? 'stagger' : '');

function taskRow(t, { ctx = 'today' } = {}) {
  const p = t.projectId ? P.get(t.projectId) : null;
  const focusing = D.meta.focus && D.meta.focus.taskId === t.id;
  const mins = D.focusLog.filter(l => l.taskId === t.id).reduce((s, l) => s + l.minutes, 0);
  const subs = t.subtasks || [];
  const sd = subs.filter(x => x.done).length;
  const ft = window.Tasks.fmtTime;
  const meta = [
    t.time ? `<span class="chip time ${!t.done && t.date === today() && minsNow() > toMins(t.time) + (t.duration || 30) ? 'late' : ''}">${icon('clock')}${ft(t.time)}${t.remind != null ? icon('bell') : ''}</span>` : '',
    t.priority ? `<span class="chip prio p${t.priority}">${icon('flag')}P${t.priority}</span>` : '',
    p && ctx !== 'proj' ? `<span class="chip" style="color:${p.color}"><span class="dot"></span><span style="color:var(--text-2)">${esc(p.name)}</span></span>` : '',
    subs.length ? `<span class="chip subs ${sd === subs.length ? 'sage' : ''}" title="${sd} of ${subs.length} steps done">${icon('check')}${sd}/${subs.length}<i class="mini-bar"><b style="width:${Math.round(sd / subs.length * 100)}%"></b></i></span>` : '',
    ...(t.tags || []).map(g => `<button class="chip tag ${state.filter.tag === g ? 'on' : ''}" data-act="filter-tag" data-v="${esc(g)}" title="Show only #${esc(g)}">#${esc(g)}</button>`),
    t.recurringId ? `<span class="chip sky">${icon('repeat')}Recurring</span>` : '',
    t.noteRef && D.pages.some(pg => pg.id === t.noteRef.pageId) ? `<button class="chip note-chip" data-act="open-note" data-nb="${t.noteRef.notebookId}" data-pg="${t.noteRef.pageId}" title="Open the note this came from">${icon('book')}From notes</button>` : '',
    t.carried > 0 && !t.done ? `<span class="chip honey" title="Moved to the next day ${t.carried} time(s)">${icon('arrowRight')}Carried ${t.carried}×</span>` : '',
    ctx === 'overdue' ? `<span class="chip honey">${icon('calendar')}${relDay(t.date)}</span>` : '',
    ctx === 'upcoming' ? `<span class="chip">${icon('calendar')}${relDay(t.date)}</span>` : '',
    ctx === 'proj' && !t.done ? (!t.date ? '<span class="chip">Backlog</span>' : t.date < today() ? `<span class="chip honey">${icon('calendar')}${relDay(t.date)}</span>` : t.date === today() ? `<span class="chip accent">${icon('sun')}Today</span>` : `<span class="chip">${icon('calendar')}${relDay(t.date)}</span>`) : '',
    mins ? `<span class="chip sage">${icon('target')}${fmtMins(mins)} focused</span>` : '',
    t.notes && t.notes.trim() ? `<span class="chip" title="Has notes">${icon('note')}</span>` : ''
  ].join('');

  let actions = '';
  if (t.done) {
    actions = `<button class="icon-btn danger reveal" data-act="delete" title="Delete">${icon('trash', 'sm')}</button>`;
  } else if (ctx === 'today') {
    actions = `
      <button class="icon-btn go reveal" data-act="focus-task" title="Start a focus session on this">${icon('play', 'sm')}</button>
      <button class="pill-btn soft" data-act="tomorrow" title="Move to tomorrow">Tomorrow ${icon('arrowRight', 'sm')}</button>
      <button class="icon-btn danger reveal" data-act="delete" title="Delete">${icon('trash', 'sm')}</button>`;
  } else if (ctx === 'overdue') {
    actions = `
      <button class="pill-btn sage" data-act="today" title="Bring into today">${icon('arrowLeft', 'sm')} Today</button>
      <button class="pill-btn soft" data-act="tomorrow" title="Move to tomorrow">Tomorrow ${icon('arrowRight', 'sm')}</button>
      <button class="icon-btn danger reveal" data-act="delete" title="Delete">${icon('trash', 'sm')}</button>`;
  } else if (ctx === 'cal' || ctx === 'proj') {
    actions = `
      <button class="icon-btn go reveal" data-act="focus-task" title="Focus on this">${icon('play', 'sm')}</button>
      ${t.date !== today() ? `<button class="pill-btn sage reveal" data-act="today" title="Bring into today">${icon('sun', 'sm')} Today</button>` : ''}
      <button class="icon-btn danger reveal" data-act="delete" title="Delete">${icon('trash', 'sm')}</button>`;
  } else {
    actions = `
      <button class="pill-btn back sage" data-act="today" title="Bring into today">${icon('arrowLeft', 'sm')} Today</button>
      <button class="icon-btn danger reveal" data-act="delete" title="Delete">${icon('trash', 'sm')}</button>`;
  }
  return `<div class="task prio-${t.priority || 0} ${t.done ? 'done' : ''} ${focusing ? 'focused' : ''} ${ctx === 'tomorrow' || ctx === 'upcoming' ? 'dim' : ''}" data-k="t-${t.id}" data-id="${t.id}" ${t.done ? '' : `data-drag-task="${t.id}"`}>
    ${t.done ? '' : `<span class="grip" title="Drag to move">${icon('grip', 'sm')}</span>`}
    <button class="check ${t.done ? 'on' : ''}" data-act="toggle" title="${t.done ? 'Mark not done' : 'Mark done'}"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
    <div class="task-main" data-act="task-open" title="Open task"><div class="task-title">${esc(t.title)}</div><div class="task-meta">${meta}</div></div>
    <div class="task-actions">${actions}</div>
  </div>`;
}
const toMins = (hm) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const minsNow = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

// ---------- filters (tags / priority)
function applyFilter(list) {
  const f = state.filter;
  return list.filter(t => (!f.tag || (t.tags || []).includes(f.tag)) && (!f.prio || t.priority === f.prio));
}
function filterBar() {
  const open = D.tasks.filter(t => !t.done && t.date && t.date <= tomorrow());
  const counts = {};
  open.forEach(t => (t.tags || []).forEach(g => { counts[g] = (counts[g] || 0) + 1; }));
  const tags = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(x => x[0]);
  if (state.filter.tag && !tags.includes(state.filter.tag)) tags.unshift(state.filter.tag);
  const prios = [1, 2, 3].filter(n => open.some(t => t.priority === n) || state.filter.prio === n);
  if (!tags.length && !prios.length) return '';
  const f = state.filter;
  return `<div class="filter-bar" data-k="filters">${icon('sliders', 'sm')}
    <button class="fchip ${!f.tag && !f.prio ? 'on' : ''}" data-act="filter-clear">All</button>
    ${prios.map(n => `<button class="fchip prio p${n} ${f.prio === n ? 'on' : ''}" data-act="filter-prio" data-v="${n}">${icon('flag', 'sm')}P${n}</button>`).join('')}
    ${tags.map(g => `<button class="fchip tag ${f.tag === g ? 'on' : ''}" data-act="filter-tag" data-v="${esc(g)}">#${esc(g)}</button>`).join('')}
  </div>`;
}

function emptyState(ic, title, text) {
  return `<div class="empty"><div class="art">${icon(ic)}</div><strong>${title}</strong>${text}</div>`;
}

function projectOptions(sel, none = 'No project') {
  return `<option value="">${none}</option>` + P.active().concat(D.projects.filter(p => p.status === 'paused'))
    .map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
}

function pastWrapTime() {
  const [h, m] = (D.settings.wrapTime || '17:00').split(':').map(Number);
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}

// ---------- TODAY
function viewToday() {
  const allToday = T.today();
  const list = applyFilter(allToday), overdue = applyFilter(T.overdue()), tom = applyFilter(T.tomorrow()), done = T.doneOn(today()), up = applyFilter(T.upcoming());
  const hiddenN = (allToday.length - list.length) + (T.overdue().length - overdue.length);
  const sc = dayScore(today()), stk = streak();
  const total = allToday.length + done.length;
  const pct = total ? done.length / total : 0;
  const name = D.settings.name ? `, <em>${esc(D.settings.name)}</em>` : '';
  const wrapped = D.dayLog[today()] && D.dayLog[today()].wrapped;
  const showBanner = pastWrapTime() && !wrapped && list.length > 0;

  return `<div class="${stg()}">
    <div class="page-head">
      <div><h1>${greeting()}${name}</h1>
        <div class="sub">${fmtLong(today())} · ${allToday.length ? plural(allToday.length, 'task') + ' left today' : total ? 'All done for today' : 'Nothing planned yet'}</div></div>
      <div class="actions">
        ${stk ? `<div class="streak-chip" title="Good days in a row (weekends don't break it)">${icon('flame', 'sm')}<b>${stk}</b> day streak</div>` : ''}
        ${total ? `<div class="progress-ring">${ring(46, 5, pct, { cls: 'sage', label: Math.round(pct * 100) + '%' })}<div class="txt"><b>${done.length}/${total}</b><span>done today</span></div></div>` : ''}
        <button class="btn ghost" data-act="brief-open" title="Morning brief">${icon('sunrise')}Brief</button>
        <button class="btn" data-act="wrap-open" title="End-of-day wrap-up">${icon('sunset')}Wrap up</button>
      </div>
    </div>

    ${showBanner && allToday.length ? `<div class="wrap-banner" data-k="banner"><div class="ico">${icon('sunset')}</div>
      <div><b>It's past ${esc(D.settings.wrapTime)}: time to wind down?</b><span>${plural(allToday.length, 'task')} still open. Move what's left to tomorrow in one go.</span></div>
      <button class="btn primary" data-act="wrap-open">Wrap up the day</button></div>` : ''}

    <div class="grid-today">
      <div class="col-main">
        <div class="add-bar">
          ${icon('plus')}
          <input id="add-task" placeholder="${D.settings.smartAdd !== false ? 'Add a task… try “Call Sam fri 2pm #vendors !1”' : 'Add a task and press Enter…'}" autocomplete="off" maxlength="300">
          <select class="select" id="add-project" title="Project">${projectOptions(state.addProject)}</select>
          <div class="seg" title="When">
            <button data-act="add-when" data-v="today" class="${state.addWhen === 'today' ? 'on' : ''}">Today</button>
            <button data-act="add-when" data-v="tomorrow" class="${state.addWhen === 'tomorrow' ? 'on' : ''}">Tomorrow</button>
          </div>
        </div>
        <div class="add-preview" id="add-preview"></div>
        ${filterBar()}
        ${hiddenN ? `<div class="filter-note" data-k="fnote">${plural(hiddenN, 'task')} hidden by the filter · <button class="link" data-act="filter-clear">Show all</button></div>` : ''}

        ${overdue.length ? `<div class="section overdue">
          <div class="section-head">${icon('bell', 'sm')} Carried over <span class="n">${overdue.length}</span>
            <div class="right"><button class="btn sm" data-act="overdue-all-today">Bring all into today</button></div></div>
          <div class="list" data-drop-list="overdue-none">${overdue.map(t => taskRow(t, { ctx: 'overdue' })).join('')}</div></div>` : ''}

        <div class="section">
          <div class="section-head">${icon('sun', 'sm')} Today <span class="n">${list.length}</span>
            ${list.length > 1 ? `<div class="right"><button class="btn sm ghost" data-act="all-tomorrow" title="Move every unfinished task to tomorrow">Move all to tomorrow ${icon('arrowRight', 'sm')}</button></div>` : ''}</div>
          <div class="list" data-drop-list="today">${list.length ? list.map(t => taskRow(t)).join('') :
            (done.length ? emptyState('leaf', 'All clear', 'Everything for today is done. Lovely.') : emptyState('sun', 'A fresh day', 'Add your first task above, or press <b>Ctrl+Alt+Space</b> from anywhere.'))}</div>
        </div>

        <div class="section">
          <div class="section-head"><button class="toggle ${state.showTomorrow ? '' : 'closed'}" data-act="sec-toggle" data-v="showTomorrow">${icon('chevron', 'sm')} Tomorrow</button> <span class="n">${tom.length}</span></div>
          ${state.showTomorrow ? `<div class="list" data-drop-list="tomorrow">${tom.length ? tom.map(t => taskRow(t, { ctx: 'tomorrow' })).join('') : '<div class="muted" style="padding:4px 6px 0">Nothing lined up for tomorrow yet.</div>'}</div>` : ''}
        </div>

        ${up.length ? `<div class="section">
          <div class="section-head"><button class="toggle ${state.showUpcoming ? '' : 'closed'}" data-act="sec-toggle" data-v="showUpcoming">${icon('chevron', 'sm')} Later</button> <span class="n">${up.length}</span></div>
          ${state.showUpcoming ? `<div class="list">${up.map(t => taskRow(t, { ctx: 'upcoming' })).join('')}</div>` : ''}</div>` : ''}

        ${done.length ? `<div class="section">
          <div class="section-head"><button class="toggle ${state.showDone ? '' : 'closed'}" data-act="sec-toggle" data-v="showDone">${icon('chevron', 'sm')} Done today</button> <span class="n">${done.length}</span></div>
          ${state.showDone ? `<div class="list">${done.map(t => taskRow(t)).join('')}</div>` : ''}</div>` : ''}
      </div>

      <aside class="side-col">
        ${widgetOn('desk') ? window.Notes.deskCard() : ''}
        ${widgetOn('score') ? scoreCard(sc, stk) : ''}
        ${widgetOn('break') ? breakCard() : ''}
        ${widgetOn('focus') || D.meta.focus ? focusCard() : ''}
        ${widgetOn('water') ? waterCard() : ''}
        ${widgetOn('waiting') ? waitingMini() : ''}
        ${widgetOn('projects') ? projectsMini() : ''}
        ${(D.settings.hiddenWidgets || []).length ? `<button class="link widgets-hidden" data-act="widgets-manage">${icon('eye', 'sm')} ${plural(D.settings.hiddenWidgets.length, 'hidden widget')}</button>` : ''}
      </aside>
    </div>
  </div>`;
}

// Today's side widgets: right-click one to hide it; Settings brings them back
const WIDGETS = {
  desk: { k: 'c-desk', name: 'On your desk', ic: 'sticky', sub: 'Sticky notes you pinned from a notebook' },
  score: { k: 'c-score', name: 'Good-day score', ic: 'sparkle', sub: 'Your score and streak' },
  break: { k: 'c-break', name: 'Screen break', ic: 'eye', sub: 'The break clock card (the small clock bottom left stays)' },
  focus: { k: 'c-focus', name: 'Focus mode', ic: 'target', sub: 'Timers and soundscapes. Still shows while a focus session runs' },
  water: { k: 'c-water', name: 'Water', ic: 'drop', sub: 'The glass tracker' },
  waiting: { k: 'c-wait', name: 'Time to chase', ic: 'hand', sub: 'Waiting-on items that are due' },
  projects: { k: 'c-proj', name: 'Projects', ic: 'folder', sub: 'Your active projects' }
};
const widgetOn = (id) => !(D.settings.hiddenWidgets || []).includes(id);
function setWidget(id, on) {
  const h = new Set(D.settings.hiddenWidgets || []);
  on ? h.delete(id) : h.add(id);
  D.settings.hiddenWidgets = [...h];
  save(); refresh();
}
function widgetMenu(id, x, y) {
  const w = WIDGETS[id]; if (!w) return;
  const items = [{ header: w.name },
    { label: 'Hide this widget', ic: 'eyeOff', fn: () => { setWidget(id, false); toast(`${w.name} hidden. Bring it back in Settings.`, { ic: 'eye', action: { label: 'Undo', fn: () => setWidget(id, true) } }); } }];
  if (id === 'water' && D.settings.waterOn !== false) items.push({ label: 'Turn off water nudges too', ic: 'bellOff', fn: () => { D.settings.waterOn = false; setWidget(id, false); toast('Water tracking and nudges are off. Turn them back on in Settings.', { ic: 'drop' }); } });
  items.push('-', { label: 'Choose widgets…', ic: 'sliders', fn: () => actions['widgets-manage']() });
  window.Notes.ctxMenu(items, x, y);
}

function breakCard() {
  return `<div class="card break-card glow" data-k="c-break">
    <h3>${icon('eye', 'sm')} Screen break</h3>
    <div class="big"><div class="ring-wrap">${ring(64, 6, 0, { live: 'brk-ring' })}<button class="ring-reset" data-act="brk-reset" title="Reset the break clock">${icon('reset', 'sm')}</button></div>
      <div><div class="num" data-live="brk-num">--</div><div class="cap" data-live="brk-sub">On screen 0m</div></div></div>
    <div class="row">
      <button class="btn sm primary" data-act="brk-now">${icon('coffee', 'sm')}Break now</button>
      <button class="btn sm" data-act="brk-taken" title="Reset the clock">I just had one</button>
    </div></div>`;
}
const SOUND_ICONS = ['music', 'rain', 'coffee', 'flame', 'waves', 'leaf', 'globe', 'sun', 'moon', 'sparkle'];
function soundList() {
  const sc = window.Sound ? Sound.SOUNDSCAPES : {};
  return Object.entries(sc).map(([k, v]) => ({ id: k, label: v.label, ic: v.ic, builtin: true }))
    .concat((D.settings.customSounds || []).map(c => ({ id: c.id, label: c.name, ic: c.ic || 'music', builtin: false })));
}
function ambientPicker() {
  const cur = window.Sound ? Sound.current() : null;
  const loading = cur && window.Sound && Sound.streaming() && Sound.streamState() === 'loading';
  return `<div class="ambient" data-k="ambient">
    <div class="amb-row">${soundList().map(x => {
      const src = window.Sound ? Sound.sourceFor(x.id) : { kind: 'synth' };
      return `<button class="amb ${cur === x.id ? 'on' : ''} ${loading && cur === x.id ? 'loading' : ''}" data-act="amb-play" data-v="${x.id}" title="${esc(x.label)}${src.kind === 'stream' ? ' (streamed)' : ''}. Right-click for options">${icon(x.ic, 'sm')}<span>${esc(x.label)}</span>${src.kind === 'stream' ? `<i class="amb-src" title="Streamed from the web">${icon('globe', 'sm')}</i>` : ''}${cur === x.id ? '<i class="eq"><b></b><b></b><b></b></i>' : ''}</button>`;
    }).join('')}
    <button class="amb add" data-act="sound-add" title="Add your own sound from a link (e.g. lo-fi beats on YouTube)">${icon('plus', 'sm')}<span>Add</span></button></div>
    <div class="amb-vol">${icon('volume', 'sm')}<input type="range" min="0" max="1" step="0.05" value="${D.settings.ambientVolume ?? .5}" data-set="ambientVolume" data-type="float" aria-label="Ambient volume">
      ${loading ? '<span class="amb-status">Connecting…</span>' : ''}</div>
  </div>`;
}
function soundMenu(id, x, y) {
  const builtin = !!(window.Sound && Sound.SOUNDSCAPES[id]);
  const playing = Sound.current() === id;
  if (builtin) {
    const src = D.settings.soundSources[id] || {};
    const mode = src.mode || 'stream';
    const url = src.url || Sound.DEFAULT_LINKS[id];
    return window.Notes.ctxMenu([
      { header: Sound.SOUNDSCAPES[id].label },
      { label: playing ? 'Stop' : 'Play', ic: playing ? 'stop' : 'play', fn: () => ACTIONS['amb-play']({ dataset: { v: id } }) },
      '-',
      { label: 'Streamed from YouTube (default)', ic: mode === 'stream' ? 'check' : 'globe', fn: () => setSoundMode(id, 'stream') },
      { label: 'Built-in sound (works offline)', ic: mode === 'synth' ? 'check' : 'volume', fn: () => setSoundMode(id, 'synth') },
      '-',
      { label: 'Use a different link…', ic: 'link', fn: () => openModal('sound', 'edit:' + id) },
      src.url && { label: 'Reset to the default link', ic: 'undo', fn: () => { D.settings.soundSources[id] = { ...src, url: undefined }; save(); restartIfPlaying(id); toast('Back to the default link', { ic: 'undo' }); } },
      { label: 'Open the link in your browser', ic: 'external', fn: () => api.openExternal(url) }
    ], x, y);
  }
  const c = D.settings.customSounds.find(s => s.id === id); if (!c) return;
  return window.Notes.ctxMenu([
    { header: c.name },
    { label: playing ? 'Stop' : 'Play', ic: playing ? 'stop' : 'play', fn: () => ACTIONS['amb-play']({ dataset: { v: id } }) },
    { label: 'Edit name, link or icon…', ic: 'edit', fn: () => openModal('sound', c.id) },
    { label: 'Open the link in your browser', ic: 'external', fn: () => api.openExternal(c.url) },
    '-',
    { label: 'Remove this sound', ic: 'trash', danger: true, fn: () => {
      const snap = snapshot();
      if (Sound.current() === id) Sound.stopAmbient();
      D.settings.customSounds = D.settings.customSounds.filter(s => s.id !== id);
      if (D.settings.ambient === id) D.settings.ambient = 'rain';
      save(); refresh(); undoable(`Removed "${c.name}"`, snap, 'trash');
    } }
  ], x, y);
}
function setSoundMode(id, mode) {
  D.settings.soundSources[id] = { ...(D.settings.soundSources[id] || {}), mode };
  save(); restartIfPlaying(id); refresh();
  toast(mode === 'stream' ? 'Streaming from YouTube' : 'Using the built-in sound', { ic: mode === 'stream' ? 'globe' : 'volume' });
}
function restartIfPlaying(id) { if (Sound.current() === id) { Sound.stopAmbient(true); Sound.ambient(id); } }
function modalSound(arg) {
  const editBuiltin = typeof arg === 'string' && arg.startsWith('edit:') ? arg.slice(5) : null;
  const c = !editBuiltin && arg ? D.settings.customSounds.find(s => s.id === arg) : null;
  const f = state.soundForm || (state.soundForm = c ? { name: c.name, url: c.url, ic: c.ic || 'music' } : editBuiltin ? { url: (D.settings.soundSources[editBuiltin] || {}).url || Sound.DEFAULT_LINKS[editBuiltin] } : { name: '', url: '', ic: 'music' });
  return `<div class="scrim" data-act="sound-cancel"></div>
  <div class="modal sound-modal" role="dialog" aria-label="Sound">
    <div class="modal-head"><div class="eyebrow">${icon('music', 'sm')} ${editBuiltin ? Sound.SOUNDSCAPES[editBuiltin].label + ' sound' : c ? 'Edit sound' : 'Add a sound'}</div>
      <h2>${editBuiltin ? 'Use a different link' : c ? esc(c.name) : 'Your own soundscape'}</h2>
      <p>${editBuiltin ? 'Paste a YouTube link (or any direct audio link) to play instead of the default.' : 'Paste a YouTube link, such as a lo-fi beats stream, or a direct link to an audio file or internet radio stream.'}</p></div>
    <div class="modal-body" data-body>
      ${editBuiltin ? '' : `<div class="field"><label>Name</label><input class="input" id="snd-name" value="${esc(f.name || '')}" placeholder="e.g. Lo-fi beats" maxlength="24"></div>`}
      <div class="field"><label>Link</label><input class="input" id="snd-url" value="${esc(f.url || '')}" placeholder="https://www.youtube.com/watch?v=…" spellcheck="false">
        <span class="hint">Live streams and long "10 hours" videos work best. Videos that don't allow embedding won't play.</span></div>
      ${editBuiltin ? '' : `<div class="field"><label>Icon</label><div class="icon-pick">${SOUND_ICONS.map(i => `<button class="ip ${f.ic === i ? 'on' : ''}" data-act="snd-ic" data-v="${i}">${icon(i, 'sm')}</button>`).join('')}</div></div>`}
    </div>
    <div class="modal-foot" data-foot>
      <button class="btn ghost left" data-act="sound-test">${icon('play', 'sm')}Try it</button>
      <button class="btn ghost" data-act="sound-cancel">Cancel</button>
      <button class="btn primary" data-act="sound-save" data-v="${esc(arg || '')}">${icon('check', 'sm')}Save</button></div>
  </div>`;
}
function readSoundForm() { const f = state.soundForm || {}; const n = $('#snd-name'), u = $('#snd-url'); if (n) f.name = n.value; if (u) f.url = u.value; return f; }
const validLink = (u) => { try { const x = new URL(u.trim()); return /^https?:$/.test(x.protocol); } catch (e) { return false; } };
function focusCard() {
  const f = D.meta.focus;
  if (f) {
    return `<div class="card" data-k="c-focus"><h3>${icon('target', 'sm')} Focusing ${D.settings.focusShield ? `<span class="right shield" title="Break and wellbeing reminders wait until you finish">${icon('shield', 'sm')} Shielded</span>` : ''}</h3>
      <div class="big" style="display:flex;gap:14px;align-items:center">${ring(64, 6, 0, { cls: 'sage', live: 'focus-ring' })}
        <div style="min-width:0"><div class="num" style="font-family:var(--font-display);font-size:28px" data-live="focus-text">--</div>
        <div class="muted" style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.label || 'Focus session')}</div></div></div>
      <div class="row" style="margin-top:14px">
        ${f.running ? `<button class="btn sm" data-act="focus-pause">${icon('pause', 'sm')}Pause</button>` : `<button class="btn sm sage" data-act="focus-resume">${icon('play', 'sm')}Resume</button>`}
        <button class="btn sm ghost" data-act="focus-stop">${icon('stop', 'sm')}Stop</button></div>
      ${ambientPicker()}</div>`;
  }
  return `<div class="card" data-k="c-focus"><h3>${icon('target', 'sm')} Focus mode</h3>
    <div class="muted" style="font-size:13.5px;margin-bottom:12px">Press ${icon('play', 'sm')} on a task, or start a timer here.</div>
    <div class="focus-presets">
      <button class="btn sm" data-act="focus-start" data-v="25">25 min</button>
      <button class="btn sm" data-act="focus-start" data-v="50">50 min</button>
      <button class="btn sm" data-act="focus-start" data-v="90">90 min</button></div>
    ${ambientPicker()}</div>`;
}

// ---------- good-day score, streak, water
function dayScore(k) {
  const tasks = T.doneOn(k).length;
  const breaks = D.meta.breaks[k] || 0;
  const focus = D.focusLog.filter(l => l.date === k).reduce((s, l) => s + l.minutes, 0);
  const water = (D.meta.water || {})[k] || 0;
  const goal = D.settings.waterGoal || 8;
  const parts = {
    tasks: Math.min(40, tasks * 8),
    breaks: Math.min(20, breaks * 5),
    focus: Math.min(25, Math.round(focus / 4)),
    water: D.settings.waterOn === false ? 15 : Math.min(15, Math.round(water / goal * 15))
  };
  return { total: parts.tasks + parts.breaks + parts.focus + parts.water, parts, raw: { tasks, breaks, focus, water } };
}
const GOOD_DAY = 60;
function streak() {
  let n = 0;
  let k = today();
  if (dayScore(k).total < GOOD_DAY) k = addDays(k, -1);
  for (let i = 0; i < 400; i++) {
    const wd = parseKey(k).getDay();
    const good = dayScore(k).total >= GOOD_DAY;
    if (good) n++;
    else if (wd !== 0 && wd !== 6) break;
    k = addDays(k, -1);
  }
  return n;
}
function scoreCard(sc, stk) {
  const lab = sc.total >= 85 ? 'A cracking day' : sc.total >= GOOD_DAY ? 'A good day' : sc.total >= 30 ? 'Getting there' : 'Just getting started';
  const bar = (k, label, max, val) => `<div class="sc-part"><span>${label}</span><i><b style="width:${Math.round(sc.parts[k] / max * 100)}%"></b></i><em>${val}</em></div>`;
  return `<div class="card score-card ${sc.total >= GOOD_DAY ? 'good' : ''}" data-k="c-score">
    <h3>${icon('sparkle', 'sm')} Good-day score ${stk ? `<span class="right streak">${icon('flame', 'sm')} ${stk}</span>` : ''}</h3>
    <div class="sc-top">${ring(64, 6, sc.total / 100, { cls: sc.total >= GOOD_DAY ? 'sage' : 'honey', label: `<b class="sc-num">${sc.total}</b>` })}
      <div><div class="sc-lab">${lab}</div><div class="muted" style="font-size:12.5px">${sc.total >= GOOD_DAY ? (stk > 1 ? `${stk} good days in a row` : 'Counts toward your streak') : `${GOOD_DAY - sc.total} more points for a good day`}</div></div></div>
    <div class="sc-parts">
      ${bar('tasks', 'Tasks', 40, sc.raw.tasks)}${bar('focus', 'Focus', 25, sc.raw.focus + 'm')}${bar('breaks', 'Breaks', 20, sc.raw.breaks)}${D.settings.waterOn !== false ? bar('water', 'Water', 15, sc.raw.water) : ''}
    </div></div>`;
}
function waterCard() {
  if (D.settings.waterOn === false) return '';
  const n = (D.meta.water || {})[today()] || 0, goal = D.settings.waterGoal || 8;
  const pct = Math.min(1, n / goal);
  return `<div class="card water-card" data-k="c-water"><h3>${icon('drop', 'sm')} Water <span class="right muted">${n} / ${goal}</span></h3>
    <div class="water-row">
      <div class="glass" style="--fill:${pct}"><i></i><span class="wave"></span></div>
      <div class="glasses">${Array.from({ length: goal }, (_, i) => `<span class="g ${i < n ? 'on' : ''}"></span>`).join('')}</div>
      <div class="water-btns"><button class="icon-btn" data-act="water-minus" title="Take one off">−</button><button class="btn sm sky" data-act="water-plus">${icon('plus', 'sm')}Glass</button></div>
    </div></div>`;
}

function waitingMini() {
  const due = W.dueList();
  if (!due.length) return '';
  return `<div class="card" data-k="c-wait"><h3>${icon('hand', 'sm')} Time to chase <span class="right"><button class="link" data-view="waiting">View all</button></span></h3>
    <div class="mini-list">${due.slice(0, 4).map(w => `<div class="mini-item"><span class="chip honey">${W.days(w)}d</span><span class="grow">${esc(w.title)}</span><span class="muted">${esc(w.who || '')}</span></div>`).join('')}</div></div>`;
}
function projectsMini() {
  const act = P.active();
  if (!act.length) return '';
  const sorted = act.slice().sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  return `<div class="card" data-k="c-proj"><h3>${icon('folder', 'sm')} Projects <span class="right"><button class="link" data-view="projects">All</button></span></h3>
    <div class="mini-list">${sorted.slice(0, 5).map(p => {
      const stale = daysSince(p.updatedAt || p.createdAt) >= D.settings.staleProjectDays;
      return `<div class="mini-item proj-drop" style="cursor:pointer" data-act="project-open" data-pid="${p.id}" data-drop-project="${p.id}"><span class="chip" style="color:${p.color}"><span class="dot"></span></span>
        <span class="grow">${esc(p.name)}</span>${stale ? `<span class="chip honey">quiet ${daysSince(p.updatedAt || p.createdAt)}d</span>` : p.due ? `<span class="muted">${relDay(p.due)}</span>` : ''}</div>`;
    }).join('')}</div></div>`;
}

// ---------- PROJECTS
function viewProjects() {
  const f = state.projectFilter;
  const list = D.projects.filter(p => p.status === f).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.name.localeCompare(b.name));
  const n = (s) => D.projects.filter(p => p.status === s).length;
  return `<div class="${stg()}">
    <div class="page-head"><div><h1>Projects</h1><div class="sub">The longer-running things. Keep a next action on each one so nothing stalls.</div></div>
      <div class="actions"><div class="seg">
        <button data-act="pfilter" data-v="active" class="${f === 'active' ? 'on' : ''}">Active ${n('active') || ''}</button>
        <button data-act="pfilter" data-v="paused" class="${f === 'paused' ? 'on' : ''}">Paused ${n('paused') || ''}</button>
        <button data-act="pfilter" data-v="done" class="${f === 'done' ? 'on' : ''}">Done ${n('done') || ''}</button></div>
        <button class="btn ghost" data-act="p-expand-all" title="Expand or simplify every project">${icon(list.length && list.every(p => p.expanded) ? 'chevronUp' : 'chevron', 'sm')}${list.length && list.every(p => p.expanded) ? 'Simplify all' : 'Expand all'}</button>
        <button class="btn primary" data-act="project-new">${icon('plus', 'sm')}New project</button></div></div>
    <div class="project-grid">
      ${list.map(projectCard).join('')}
      ${f === 'active' ? `<button class="card project-card new-card" data-act="project-new" data-k="p-new">${icon('plus', 'lg')}New project</button>` : ''}
    </div>
    ${!list.length && f !== 'active' ? `<div style="margin-top:14px">${emptyState('folder', 'Nothing here', `No ${f} projects.`)}</div>` : ''}
  </div>`;
}
function projectCard(p) {
  if (p.expanded) return projectCardBig(p);
  const tasks = T.ofProject(p.id);
  const open = tasks.filter(t => !t.done).length, done = tasks.filter(t => t.done).length;
  const pct = tasks.length ? done / tasks.length : 0;
  const quiet = daysSince(p.updatedAt || p.createdAt);
  const stale = p.status === 'active' && quiet >= D.settings.staleProjectDays;
  const dueChip = p.due ? (p.due < today() && p.status !== 'done' ? `<span class="chip clay">${icon('calendar')}Overdue ${fmtShort(p.due)}</span>` : `<span class="chip">${icon('calendar')}${relDay(p.due)}</span>`) : '';
  return `<div class="card project-card ${stale ? 'stale' : ''}" style="--pc:${p.color}" data-act="project-open" data-pid="${p.id}" data-k="p-${p.id}" data-drop-project="${p.id}">
    <button class="icon-btn mini p-exp" data-act="p-expand" data-pid="${p.id}" title="Expand: show all tasks here">${icon('expand', 'sm')}</button>
    <h4>${esc(p.name)}</h4>
    <div class="next">${p.nextAction ? `<b>Next:</b> ${esc(p.nextAction)}` : '<span class="muted">No next action set</span>'}</div>
    ${tasks.length ? `<div class="bar"><i style="width:${Math.round(pct * 100)}%"></i></div>` : ''}
    <div class="foot">${dueChip}<span class="chip">${plural(open, 'open task')}</span>
      ${stale ? `<span class="chip honey">${icon('clock')}Quiet ${quiet}d</span>` : quiet === 0 ? '<span class="chip sage">Touched today</span>' : `<span class="chip">${quiet}d ago</span>`}</div>
  </div>`;
}

function projectCardBig(p) {
  const tasks = T.ofProject(p.id);
  const open = tasks.filter(t => !t.done).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || byOrder(a, b));
  const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const pct = tasks.length ? done.length / tasks.length : 0;
  const dueChip = p.due ? (p.due < today() && p.status !== 'done' ? `<span class="chip clay">${icon('calendar')}Overdue ${fmtShort(p.due)}</span>` : `<span class="chip">${icon('calendar')}Due ${relLow(p.due)}</span>`) : '';
  const nb = D.notebooks.find(n => n.projectId === p.id);
  const showDone = state.projDone.has(p.id);
  return `<div class="card project-card big" style="--pc:${p.color}" data-k="p-${p.id}" data-drop-project="${p.id}">
    <div class="pb-head">
      <div style="min-width:0;flex:1"><h4>${esc(p.name)}</h4>
        <div class="foot" style="margin-top:6px">${dueChip}<span class="chip">${plural(open.length, 'open task')}</span>${done.length ? `<span class="chip sage">${done.length} done</span>` : ''}${p.status !== 'active' ? `<span class="chip">${p.status === 'paused' ? 'Paused' : 'Done'}</span>` : ''}</div></div>
      <div class="pb-ring">${ring(48, 5, pct, { cls: 'sage', label: Math.round(pct * 100) + '%' })}</div>
      ${nb ? `<button class="btn sm ghost" data-act="open-note" data-nb="${nb.id}" title="Open the project's notebook">${icon('book', 'sm')}Notebook</button>` : ''}
      <button class="btn sm" data-act="project-open" data-pid="${p.id}">${icon('edit', 'sm')}Details</button>
      <button class="icon-btn" data-act="p-expand" data-pid="${p.id}" title="Simplify">${icon('collapse', 'sm')}</button>
    </div>
    <div class="pb-next"><span class="label-sm">Next action</span>
      <div class="row"><input class="input" id="pn-${p.id}" data-pid="${p.id}" data-pnext="1" data-enter="p-next-today" value="${esc(p.nextAction || '')}" placeholder="What's the very next step? (Enter adds it to today)">
      <button class="btn" data-act="p-next-today" data-pid="${p.id}">${icon('sun', 'sm')}To today</button></div></div>
    <div class="list pb-tasks" data-drop-list="proj-${p.id}">${open.map(t => taskRow(t, { ctx: 'proj' })).join('') || '<div class="muted pb-empty">No open tasks. Add one below.</div>'}</div>
    <div class="add-bar pb-add">${icon('plus', 'sm')}<input id="pa-${p.id}" data-pid="${p.id}" data-enter="p-add-inline" placeholder="Add a task to ${esc(p.name)}… (dates work too: 'fri', 'tomorrow 2pm')" maxlength="300"></div>
    ${done.length ? `<button class="link pb-done-toggle" data-act="p-done-toggle" data-pid="${p.id}">${icon(showDone ? 'chevronUp' : 'chevron', 'sm')}${showDone ? 'Hide' : 'Show'} ${plural(done.length, 'finished task')}</button>
      ${showDone ? `<div class="list pb-done">${done.map(t => taskRow(t, { ctx: 'proj' })).join('')}</div>` : ''}` : ''}
  </div>`;
}

// ---------- WAITING
function viewWaiting() {
  const open = W.open();
  const got = D.waiting.filter(w => w.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 8);
  return `<div class="${stg()}">
    <div class="page-head"><div><h1>Waiting on</h1><div class="sub">Things other people owe you. Hearth nudges you when it's time to chase.</div></div></div>
    <div class="card form-card">
      <div class="form-grid">
        <div class="field"><label>What are you waiting for?</label><input class="input" id="w-title" placeholder="e.g. Licence quote from supplier" data-enter="waiting-add"></div>
        <div class="field"><label>From whom</label><input class="input" id="w-who" placeholder="Name or team" data-enter="waiting-add"></div>
        <div class="field"><label>Nudge after</label><select class="select" id="w-nudge">${[1, 2, 3, 5, 7, 14].map(n => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${plural(n, 'day')}</option>`).join('')}</select></div>
        <button class="btn primary" data-act="waiting-add" style="height:42px">${icon('plus', 'sm')}Add</button>
      </div></div>
    <div class="section"><div class="section-head">${icon('hand', 'sm')} Open <span class="n">${open.length}</span></div>
      <div class="list">${open.length ? open.map(waitRow).join('') : emptyState('hand', 'Nobody owes you anything', 'Add something above when you hand work off or ask for something.')}</div></div>
    ${got.length ? `<div class="section"><div class="section-head">${icon('check', 'sm')} Recently received</div>
      <div class="list">${got.map(w => `<div class="task done" data-k="w-${w.id}" data-id="${w.id}"><div class="task-main"><div class="task-title">${esc(w.title)}</div>
        <div class="task-meta">${w.who ? `<span class="chip">${esc(w.who)}</span>` : ''}<span class="chip sage">Received ${relLow(w.doneDate)}</span></div></div>
        <div class="task-actions"><button class="icon-btn reveal" data-act="w-reopen" title="Reopen">${icon('undo', 'sm')}</button><button class="icon-btn danger reveal" data-act="w-delete" title="Delete">${icon('trash', 'sm')}</button></div></div>`).join('')}</div></div>` : ''}
  </div>`;
}
function waitRow(w) {
  const due = W.due(w), days = W.days(w);
  return `<div class="task" data-k="w-${w.id}" data-id="${w.id}">
    <div class="snip-ico ${due ? 'code' : 'link'}" style="width:32px;height:32px">${icon(due ? 'bell' : 'clock', 'sm')}</div>
    <div class="task-main"><div class="task-title">${esc(w.title)}</div>
      <div class="task-meta">${w.who ? `<span class="chip sky">${esc(w.who)}</span>` : ''}
        <span class="chip">Waiting ${days === 0 ? 'since today' : plural(days, 'day')}</span>
        ${w.chases ? `<span class="chip">Chased ${w.chases}×</span>` : ''}
        ${due ? `<span class="chip honey">${icon('bell')}Time to nudge</span>` : ''}</div></div>
    <div class="task-actions">
      <button class="pill-btn" data-act="w-chase" title="I've chased them — reset the nudge">${icon('bell', 'sm')} Chased</button>
      <button class="pill-btn sage" data-act="w-got" title="Got it">${icon('check', 'sm')} Got it</button>
      <button class="icon-btn danger reveal" data-act="w-delete" title="Delete">${icon('trash', 'sm')}</button></div></div>`;
}

// ---------- RECURRING
function viewRecurring() {
  const f = state.recForm;
  const order = [1, 2, 3, 4, 5, 6, 0];
  return `<div class="${stg()}">
    <div class="page-head"><div><h1>Recurring</h1><div class="sub">Routine jobs that drop into Today on their own, e.g. "Review vulnerability report every Monday".</div></div></div>
    <div class="card form-card">
      <div class="row wrap" style="align-items:flex-end">
        <div class="field" style="flex:2;min-width:240px"><label>Task</label><input class="input" id="r-title" placeholder="e.g. Review patch compliance" data-enter="rec-add"></div>
        <div class="field" style="min-width:160px"><label>Repeats</label><select class="select" id="r-freq" data-act-change="rec-freq">
          <option value="daily" ${f.freq === 'daily' ? 'selected' : ''}>Every day</option>
          <option value="weekdays" ${f.freq === 'weekdays' ? 'selected' : ''}>Weekdays</option>
          <option value="weekly" ${f.freq === 'weekly' ? 'selected' : ''}>Weekly on…</option>
          <option value="monthly" ${f.freq === 'monthly' ? 'selected' : ''}>Monthly on day…</option></select></div>
        ${f.freq === 'weekly' ? `<div class="field"><label>Days</label><div class="day-chips">${order.map(d => `<button class="day-chip ${f.days.includes(d) ? 'on' : ''}" data-act="rec-day" data-v="${d}">${WEEKDAYS[d][0]}</button>`).join('')}</div></div>` : ''}
        ${f.freq === 'monthly' ? `<div class="field"><label>Day</label><input class="input num-input" id="r-dom" type="number" min="1" max="31" value="${f.dom}"></div>` : ''}
        <div class="field" style="min-width:160px"><label>Project</label><select class="select" id="r-project">${projectOptions('')}</select></div>
        <button class="btn primary" data-act="rec-add" style="height:42px">${icon('plus', 'sm')}Add</button>
      </div></div>
    <div class="list">${D.recurring.length ? D.recurring.map(recRow).join('') : emptyState('repeat', 'No routines yet', 'Add the jobs you do on a schedule and they\'ll appear in Today automatically.')}</div>
  </div>`;
}
function recRow(r) {
  const p = r.projectId ? P.get(r.projectId) : null;
  const nx = nextOccurrence(r);
  const on = r.active !== false;
  const open = state.recOpen.has(r.id);
  const order = [1, 2, 3, 4, 5, 6, 0];
  const made = D.tasks.filter(t => t.recurringId === r.id);
  const doneN = made.filter(t => t.done).length;
  const steps = r.steps || [];
  return `<div class="task rec-row ${on ? '' : 'dim'} ${open ? 'open' : ''}" data-k="r-${r.id}" data-id="${r.id}">
    <div class="rec-top">
      <div class="snip-ico link" style="width:32px;height:32px">${icon('repeat', 'sm')}</div>
      <div class="task-main" data-act="rec-open" title="${open ? 'Collapse' : 'Show details'}"><div class="task-title">${esc(r.title)}</div>
        <div class="task-meta"><span class="chip sky">${describeRule(r)}${r.time ? ' · ' + window.Tasks.fmtTime(r.time) : ''}</span>
          ${on && nx ? `<span class="chip">Next: ${relDay(nx)}</span>` : ''}
          ${!on ? '<span class="chip">Paused</span>' : ''}
          ${r.priority ? `<span class="chip prio p${r.priority}">${icon('flag')}P${r.priority}</span>` : ''}
          ${steps.length ? `<span class="chip">${icon('check')}${plural(steps.length, 'step')}</span>` : ''}
          ${r.notes && r.notes.trim() && !open ? `<span class="chip" title="${esc(r.notes.slice(0, 200))}">${icon('note')}Notes</span>` : ''}
          ${p ? `<span class="chip" style="color:${p.color}"><span class="dot"></span><span style="color:var(--text-2)">${esc(p.name)}</span></span>` : ''}</div></div>
      <div class="task-actions">
        <button class="icon-btn rec-chev ${open ? 'open' : ''}" data-act="rec-open" title="${open ? 'Collapse' : 'Details'}">${icon('chevron', 'sm')}</button>
        <button class="switch ${on ? 'on' : ''}" data-act="rec-toggle" title="${on ? 'Pause' : 'Resume'}"></button>
        <button class="icon-btn danger" data-act="rec-delete" title="Delete">${icon('trash', 'sm')}</button></div>
    </div>
    ${open ? `<div class="rec-detail">
      <div class="rec-grid">
        <div class="field" style="grid-column:1/-1"><label>Task name</label><input class="input" id="rt-${r.id}" data-rbind="title" value="${esc(r.title)}" maxlength="300"></div>
        <div class="field"><label>Repeats</label><select class="select" data-rbind="freq">
          ${[['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly on…'], ['monthly', 'Monthly on day…']].map(([v, l]) => `<option value="${v}" ${r.freq === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        ${r.freq === 'weekly' ? `<div class="field"><label>Days</label><div class="day-chips">${order.map(d => `<button class="day-chip ${(r.days || []).includes(d) ? 'on' : ''}" data-act="rec-eday" data-v="${d}">${WEEKDAYS[d][0]}</button>`).join('')}</div></div>` : ''}
        ${r.freq === 'monthly' ? `<div class="field"><label>Day of month</label><input class="input num-input" type="number" min="1" max="31" data-rbind="dom" value="${r.dom || 1}"></div>` : ''}
        <div class="field"><label>Time (optional)</label><input class="input" type="time" data-rbind="time" value="${r.time || ''}"></div>
        <div class="field"><label>Priority</label><div class="seg prio-seg">${[0, 1, 2, 3].map(n => `<button data-act="rec-prio" data-v="${n}" class="${(r.priority || 0) === n ? 'on' : ''} ${n ? 'p' + n : ''}">${n ? 'P' + n : 'None'}</button>`).join('')}</div></div>
        <div class="field"><label>Project</label><select class="select" data-rbind="projectId">${projectOptions(r.projectId || '')}</select></div>
      </div>
      <div class="field"><label>${icon('note', 'sm')} Description & notes</label>
        <textarea class="textarea" id="rn-${r.id}" data-rbind="notes" rows="4" placeholder="What does this involve? Links, where the report lives, who to send it to… (copied into each task it creates)">${esc(r.notes || '')}</textarea></div>
      <div class="field"><label>${icon('check', 'sm')} Steps <span class="hint" style="text-transform:none;letter-spacing:0;font-weight:600">become a fresh checklist on each task</span></label>
        <div class="subtasks">${steps.map(st => `<div class="subtask" data-k="rs-${st.id}"><span class="step-dot"></span><input class="sub-input" id="rs-${st.id}" data-rstep="${st.id}" value="${esc(st.title)}" maxlength="200"><button class="icon-btn mini danger" data-act="rec-step-del" data-v="${st.id}" title="Remove">${icon('x', 'sm')}</button></div>`).join('')}</div>
        <div class="add-bar sub-add">${icon('plus', 'sm')}<input id="rsa-${r.id}" placeholder="Add a step and press Enter…" data-enter="rec-step-add" maxlength="200"></div></div>
      <div class="row wrap rec-foot">
        <span class="muted" style="font-size:12.5px">${made.length ? `Created ${plural(made.length, 'task')} so far · ${doneN} done` : 'No tasks created yet'}${r.lastGenerated ? ` · last ${relLow(r.lastGenerated)}` : ''}</span>
        <span style="flex:1"></span>
        <button class="btn sm" data-act="rec-now">${icon('sun', 'sm')}Add one to today now</button>
        <button class="btn sm ghost" data-act="rec-open">Done</button>
      </div>
    </div>` : ''}
  </div>`;
}

// ---------- SNIPPETS
function viewSnippets() {
  const q = state.snipQuery.trim().toLowerCase();
  const list = D.snippets.filter(s => !q || (s.title + ' ' + s.content + ' ' + (s.tags || []).join(' ')).toLowerCase().includes(q))
    .sort((a, b) => (b.usedAt || b.createdAt) - (a.usedAt || a.createdAt));
  const f = state.snipForm;
  return `<div class="${stg()}">
    <div class="page-head"><div><h1>Snippets & links</h1><div class="sub">Scripts, commands, templates and portals, a click away.</div></div>
      <div class="actions"><div class="search">${icon('search', 'sm')}<input class="input" id="snip-q" placeholder="Search…" value="${esc(state.snipQuery)}" data-live-input="snip-q"></div>
      <button class="btn primary" data-act="snip-new">${icon('plus', 'sm')}New</button></div></div>
    ${f ? `<div class="card form-card" data-k="snip-form">
      <div class="row wrap" style="align-items:flex-end">
        <div class="field" style="flex:1;min-width:220px"><label>Title</label><input class="input" id="s-title" value="${esc(f.title || '')}" placeholder="e.g. Clear print spooler"></div>
        <div class="field"><label>Type</label><div class="seg">
          <button data-act="snip-kind" data-v="snippet" class="${f.kind === 'snippet' ? 'on' : ''}">${icon('code', 'sm')} Snippet</button>
          <button data-act="snip-kind" data-v="link" class="${f.kind === 'link' ? 'on' : ''}">${icon('link', 'sm')} Link</button></div></div>
        <div class="field" style="min-width:200px"><label>Tags</label><input class="input" id="s-tags" value="${esc((f.tags || []).join(', '))}" placeholder="powershell, printers"></div></div>
      <div class="field"><label>${f.kind === 'link' ? 'URL' : 'Content'}</label>
        ${f.kind === 'link' ? `<input class="input" id="s-content" value="${esc(f.content || '')}" placeholder="https://…">` :
        `<textarea class="textarea" id="s-content" style="font-family:var(--font-mono);font-size:13px" placeholder="Paste your script, command or template…">${esc(f.content || '')}</textarea>`}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" data-act="snip-cancel">Cancel</button><button class="btn primary" data-act="snip-save">${icon('check', 'sm')}Save</button></div>
    </div>` : ''}
    <div class="snip-grid">${list.map(s => {
      let host = '';
      if (s.kind === 'link') { try { host = new URL(s.content).hostname.replace(/^www\./, ''); } catch (e) { host = s.content; } }
      return `<div class="card snip" data-k="s-${s.id}" data-id="${s.id}">
        <div class="snip-head"><div class="snip-ico ${s.kind === 'link' ? 'link' : 'code'}">${icon(s.kind === 'link' ? 'link' : 'code', 'sm')}</div>
          <div style="min-width:0;flex:1"><b>${esc(s.title)}</b><small>${s.kind === 'link' ? esc(host) : esc(plural(s.content.split('\n').length, 'line'))}</small></div></div>
        ${s.kind === 'snippet' ? `<pre>${esc(s.content)}</pre>` : ''}
        <div class="foot"><div class="tags">${(s.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
          <button class="icon-btn" data-act="snip-edit" title="Edit">${icon('edit', 'sm')}</button>
          <button class="icon-btn danger" data-act="snip-delete" title="Delete">${icon('trash', 'sm')}</button>
          ${s.kind === 'link' ? `<button class="btn sm primary" data-act="snip-open">${icon('external', 'sm')}Open</button>` : `<button class="btn sm" data-act="snip-copy">${icon('copy', 'sm')}Copy</button>`}</div></div>`;
    }).join('')}</div>
    ${!list.length && !f ? emptyState('bookmark', q ? 'No matches' : 'Your toolbox is empty', q ? 'Try another search.' : 'Save the scripts, commands and links you reach for every week.') : ''}
  </div>`;
}

// ---------- WEEKLY REVIEW
function weekDays(offset) {
  const t = today();
  const dow = (parseKey(t).getDay() + 6) % 7;
  const mon = addDays(t, -dow + offset * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}
function weekSummary(days) {
  const set = new Set(days);
  const doneBy = days.map(k => T.doneOn(k));
  const doneCount = doneBy.reduce((s, a) => s + a.length, 0);
  const logs = D.focusLog.filter(l => set.has(l.date));
  const focusMin = logs.reduce((s, l) => s + l.minutes, 0);
  const byProj = {};
  logs.forEach(l => { const k = l.projectId || ''; byProj[k] = (byProj[k] || 0) + l.minutes; });
  const breaks = days.reduce((s, k) => s + (D.meta.breaks[k] || 0), 0);
  const received = D.waiting.filter(w => w.done && set.has(w.doneDate)).length;
  return { doneBy, doneCount, focusMin, byProj, breaks, received };
}
function viewWeek() {
  const days = weekDays(state.weekOffset);
  const s = weekSummary(days);
  const max = Math.max(1, ...s.doneBy.map(a => a.length));
  const label = state.weekOffset === 0 ? 'This week' : state.weekOffset === -1 ? 'Last week' : `w/c ${fmtShort(days[0])}`;
  const stk = streak();
  const scores = days.map(k => k > today() ? null : dayScore(k).total);
  const projRows = Object.entries(s.byProj).sort((a, b) => b[1] - a[1]);
  const pmax = Math.max(1, ...projRows.map(r => r[1]));

  return `<div class="${stg()}">
    <div class="page-head"><div><h1>Weekly review</h1><div class="sub">${fmtShort(days[0])} – ${fmtShort(days[6])}. Handy for one-to-ones and timesheets.</div></div>
      <div class="actions"><div class="week-nav"><button class="icon-btn" data-act="week-prev">${icon('chevronL', 'sm')}</button><span>${label}</span>
        <button class="icon-btn" data-act="week-next" ${state.weekOffset >= 0 ? 'disabled style="opacity:.3"' : ''}>${icon('chevronR', 'sm')}</button></div>
        <button class="btn primary" data-act="week-copy">${icon('copy', 'sm')}Copy summary</button></div></div>
    <div class="stat-row">
      <div class="card"><b>${s.doneCount}</b><span>tasks completed</span></div>
      <div class="card"><b>${fmtMins(s.focusMin)}</b><span>focused time</span></div>
      <div class="card"><b>${s.breaks}</b><span>screen breaks taken</span></div>
      <div class="card streak-tile"><b>${icon('flame')}${stk}</b><span>good-day streak</span></div>
    </div>
    <div class="week-grid">
      <div class="card"><h3>${icon('check', 'sm')} Tasks done per day</h3>
        <div class="bars">${days.map((k, i) => {
          const n = s.doneBy[i].length;
          const sc = scores[i];
          return `<div class="col"><div class="v">${n || ''}</div><div class="b ${k === today() ? 'today' : ''}" style="height:${Math.max(3, (n / max) * 110)}px"></div><div class="d">${WEEKDAYS[parseKey(k).getDay()]}</div>${sc == null ? '<span class="dscore none">·</span>' : `<span class="dscore ${sc >= GOOD_DAY ? 'good' : ''}" title="Good-day score">${sc}</span>`}</div>`;
        }).join('')}</div></div>
      <div class="card"><h3>${icon('target', 'sm')} Focus by project</h3>
        ${projRows.length ? projRows.map(([pid, m]) => {
          const p = pid ? P.get(pid) : null;
          return `<div class="hbar"><span class="name">${esc(p ? p.name : 'General')}</span><span class="track"><i style="width:${(m / pmax) * 100}%;background:${p ? p.color : 'var(--text-3)'}"></i></span><span class="val">${fmtMins(m)}</span></div>`;
        }).join('') : '<div class="muted">No focus sessions logged this week. Press ▶ on a task to start one.</div>'}
        ${s.received ? `<div class="muted" style="margin-top:12px">${plural(s.received, 'thing')} you were waiting on arrived.</div>` : ''}</div>
    </div>
    <div class="card"><h3>${icon('note', 'sm')} What got done</h3>
      ${s.doneCount ? days.map((k, i) => s.doneBy[i].length ? `<div class="day-group"><h5>${fmtLong(k)}</h5><ul>${s.doneBy[i].map(t => {
        const p = t.projectId ? P.get(t.projectId) : null;
        return `<li>${esc(t.title)}${p ? ` <span class="muted">· ${esc(p.name)}</span>` : ''}</li>`;
      }).join('')}</ul></div>` : '').join('') : '<div class="muted">Nothing completed yet this week.</div>'}
    </div>
  </div>`;
}
function weekText() {
  const days = weekDays(state.weekOffset);
  const s = weekSummary(days);
  const lines = [`Week of ${fmtShort(days[0])} – ${fmtShort(days[6])}`, '', `Completed (${s.doneCount}):`];
  days.forEach((k, i) => {
    if (!s.doneBy[i].length) return;
    lines.push(`${fmtLong(k)}`);
    s.doneBy[i].forEach(t => { const p = t.projectId ? P.get(t.projectId) : null; lines.push(`  - ${t.title}${p ? ` (${p.name})` : ''}`); });
  });
  lines.push('', `Good-day streak: ${streak()} day(s)`);
  if (s.focusMin) {
    lines.push('', `Focus time: ${fmtMins(s.focusMin)}`);
    Object.entries(s.byProj).sort((a, b) => b[1] - a[1]).forEach(([pid, m]) => { const p = pid ? P.get(pid) : null; lines.push(`  - ${p ? p.name : 'General'}: ${fmtMins(m)}`); });
  }
  const act = P.active();
  if (act.length) {
    lines.push('', 'Active projects:');
    act.forEach(p => lines.push(`  - ${p.name}${p.nextAction ? ` (next: ${p.nextAction})` : ''}${p.due ? ` [due ${fmtShort(p.due)}]` : ''}`));
  }
  const w = W.open();
  if (w.length) { lines.push('', 'Waiting on:'); w.forEach(x => lines.push(`  - ${x.title}${x.who ? ` from ${x.who}` : ''} (${plural(W.days(x), 'day')})`)); }
  return lines.join('\n');
}

// ---------- SETTINGS
function viewSettings() {
  const s = D.settings;
  const sw = (key) => `<button class="switch ${s[key] ? 'on' : ''}" data-act="set-toggle" data-v="${key}"></button>`;
  const num = (key, min, max) => `<input class="input num-input" type="number" min="${min}" max="${max}" value="${s[key]}" data-set="${key}" data-type="num">`;
  const seg = (key, opts, act = 'set-seg') => `<div class="seg wrap-seg">${opts.map(([v, l]) => `<button data-act="${act}" data-k="${key}" data-v="${v}" class="${String(s[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const hours = (key) => `<select class="select" data-set="${key}" data-type="num" style="width:110px">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${+s[key] === h ? 'selected' : ''}>${h === 0 ? '12am' : h === 12 ? '12pm' : (h % 12) + (h < 12 ? 'am' : 'pm')}</option>`).join('')}</select>`;
  const hidden = s.nav.hidden || [];
  const order = navOrder();
  const sc = window.Sound ? Sound.SOUNDSCAPES : {};
  const seasonNow = window.Seasons ? Seasons.seasonFor() : 'autumn';
  return `<div class="${stg()}">
    <div class="page-head"><div><h1>Settings</h1><div class="sub">Make Hearth fit the way you work.</div></div></div>
    <div class="settings">
      <div class="card"><h3>${icon('sun', 'sm')} You & appearance</h3>
        <div class="set-row"><div class="t"><b>Your name</b><span>Used in the greeting.</span></div><input class="input" value="${esc(s.name)}" data-set="name" placeholder="Name"></div>
        <div class="set-row"><div class="t"><b>Theme</b><span>Warm daylight or a cosy evening palette.</span></div>
          <div class="seg">${[['light', 'Daylight'], ['dark', 'Evening'], ['system', 'Match Windows']].map(([v, l]) => `<button data-act="set-theme" data-v="${v}" class="${s.theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="set-row"><div class="t"><b>Season</b><span>Seasonal colours. "Auto" follows the calendar (it's ${seasonNow} now).</span></div>
          ${seg('season', [['off', 'Off'], ['auto', 'Auto'], ['autumn', 'Autumn'], ['winter', 'Winter'], ['spring', 'Spring'], ['summer', 'Summer']], 'set-season')}</div>
        <div class="set-row"><div class="t"><b>Seasonal decorations</b><span>A few leaves, snowflakes, petals or sun motes drifting gently past.</span></div>${sw('seasonFx')}</div></div>

      <div class="card"><h3>${icon('sliders', 'sm')} Menu</h3>
        <div class="set-row" style="border-top:0;padding-top:0"><div class="t"><b>Compact menu</b><span>Shrink the sidebar to icons only (Ctrl+\\). Hover an icon to see its name.</span></div>${sw('navCollapsed')}</div>
        <div class="hint" style="margin-bottom:6px">Choose which pages show in the sidebar, and their order. Today and Settings always stay.</div>
        <div class="nav-cust">${order.map((id, i) => `<div class="nav-row ${hidden.includes(id) ? 'off' : ''}" data-k="nr-${id}">
          ${icon(NAV_ALL[id].ic, 'sm')}<span class="nm">${NAV_ALL[id].label}</span>
          <button class="icon-btn mini" data-act="nav-move" data-v="${id}" data-dir="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp', 'sm')}</button>
          <button class="icon-btn mini" data-act="nav-move" data-v="${id}" data-dir="1" title="Move down" ${i === order.length - 1 ? 'disabled' : ''}>${icon('chevron', 'sm')}</button>
          <button class="switch ${hidden.includes(id) ? '' : 'on'}" data-act="nav-toggle" data-v="${id}" title="${hidden.includes(id) ? 'Show' : 'Hide'}"></button></div>`).join('')}</div></div>

      <div class="card" id="set-widgets"><h3>${icon('sun', 'sm')} Today widgets</h3>
        <div class="hint" style="margin-bottom:6px">Choose which cards show down the side of Today. You can also right-click a card there to hide it.</div>
        <div class="nav-cust">${Object.entries(WIDGETS).map(([id, w]) => `<div class="nav-row ${widgetOn(id) ? '' : 'off'}" data-k="wr-${id}">
          ${icon(w.ic, 'sm')}<span class="nm">${w.name}<small>${w.sub}</small></span>
          <button class="switch ${widgetOn(id) ? 'on' : ''}" data-act="widget-toggle" data-v="${id}" title="${widgetOn(id) ? 'Hide' : 'Show'}"></button></div>`).join('')}</div></div>

      <div class="card"><h3>${icon('plus', 'sm')} Tasks & calendar</h3>
        <div class="set-row"><div class="t"><b>Smart quick-add</b><span>Understands dates and times ("fri 2pm", "tomorrow", "25/11"), #labels, !1–!3 priority and @project.</span></div>${sw('smartAdd')}</div>
        <div class="set-row"><div class="t"><b>Remind me at task times</b><span>Tasks with a time get a reminder automatically. You can change it per task.</span></div>${sw('remindAtTime')}</div>
        <div class="set-row"><div class="t"><b>Calendar day</b><span>Hours shown on the week and day timelines.</span></div>${hours('dayStart')}<span class="muted">to</span>${hours('dayEnd')}</div>
        <div class="set-row"><div class="t"><b>Wrap-up time</b><span>When Hearth suggests wrapping up and moving unfinished tasks to tomorrow.</span></div><input class="input" type="time" value="${esc(s.wrapTime)}" data-set="wrapTime"></div>
        <div class="set-row"><div class="t"><b>Flag quiet projects after</b><span>Active projects untouched this long show in your morning brief.</span></div>${num('staleProjectDays', 1, 60)}<span class="muted">days</span></div></div>

      <div class="card"><h3>${icon('target', 'sm')} Focus</h3>
        <div class="set-row"><div class="t"><b>Default focus length</b><span>Used when you press ▶ on a task.</span></div>${num('focusMinutes', 5, 180)}<span class="muted">min</span></div>
        <div class="set-row"><div class="t"><b>Soundscape</b><span>Ambient sound for focus sessions.</span></div>
          ${seg('ambient', [['off', 'None'], ...soundList().map(x => [x.id, x.label])])}</div>
        <div class="set-row sub-row"><div class="t"><span>The built-in four stream from YouTube by default and fall back to Hearth's own sounds if you're offline. Right-click any sound on the Focus card to switch source, change its link, or add your own.</span></div></div>
        <div class="set-row"><div class="t"><b>Play it automatically</b><span>Starts when a focus session starts, fades out when it ends.</span></div>${sw('ambientAuto')}</div>
        <div class="set-row"><div class="t"><b>Focus shield</b><span>Break, water and posture reminders wait politely until your session ends.</span></div>${sw('focusShield')}</div>
        <div class="set-row"><div class="t"><b>Silence Windows notifications</b><span>Turns off Windows toast notifications during focus and puts them back afterwards. Experimental.</span></div>${sw('dnd')}</div></div>

      <div class="card"><h3>${icon('volume', 'sm')} Sounds</h3>
        <div class="set-row"><div class="t"><b>Sound effects</b><span>Soft pencil ticks, page rustles, sticky-note pats and chimes.</span></div>${sw('sounds')}</div>
        <div class="set-row"><div class="t"><b>Volume</b><span>Effects volume.</span></div><input type="range" class="range" min="0" max="1" step="0.05" value="${s.volume}" data-set="volume" data-type="float"></div>
        <div class="set-row"><div class="t"><b>Have a listen</b><span>Preview the effects.</span></div>
          <div class="row wrap">${[['tick', 'Tick'], ['page', 'Page'], ['stick', 'Sticky'], ['chime', 'Chime'], ['bell', 'Break bell'], ['water', 'Water']].map(([k, l]) => `<button class="btn sm" data-act="sound-test" data-v="${k}">${l}</button>`).join('')}</div></div></div>

      <div class="card"><h3>${icon('eye', 'sm')} Screen breaks & wellbeing</h3>
        <div class="set-row"><div class="t"><b>Break every</b><span>Minutes of active screen time before a break reminder.</span></div>${num('breakInterval', 10, 240)}<span class="muted">min</span></div>
        <div class="set-row"><div class="t"><b>Snooze length</b><span>How long "Snooze" holds off the reminder.</span></div>${num('snoozeMinutes', 1, 60)}<span class="muted">min</span></div>
        <div class="set-row"><div class="t"><b>Count it as a break after</b><span>If you're away this long, or lock your PC, the clock resets.</span></div>${num('idleResetMinutes', 1, 30)}<span class="muted">min</span></div>
        <div class="set-row"><div class="t"><b>Water nudges</b><span>A gentle reminder to have a drink, plus a tracker on Today.</span></div>${sw('waterOn')}</div>
        <div class="set-row sub-row"><div class="t"><b>Every</b></div>${num('waterEvery', 15, 240)}<span class="muted">min · daily goal</span>${num('waterGoal', 1, 20)}<span class="muted">glasses</span></div>
        <div class="set-row"><div class="t"><b>Posture checks</b><span>Shoulders back, feet flat, screen at eye level.</span></div>${sw('postureOn')}</div>
        <div class="set-row sub-row"><div class="t"><b>Every</b></div>${num('postureEvery', 15, 240)}<span class="muted">min</span></div>
        <div class="hint" style="margin-top:6px">Nudges only appear within your calendar day hours and while you're at the computer.</div></div>

      <div class="card"><h3>${icon('flame', 'sm')} App</h3>
        ${state.appInfo.portable ? `<div class="set-row"><div class="t"><b>Portable mode</b><span>Running from ${esc(state.appInfo.portableDir || 'a USB drive')}. Your data travels with Hearth in the "Hearth Data" folder beside it, and nothing is left on this PC.</span></div><span class="chip sage">${icon('check')}Portable</span></div>` :
        `<div class="set-row"><div class="t"><b>Start with Windows</b><span>Opens quietly in the tray when you sign in, so the break clock starts straight away.</span></div>${sw('launchAtStartup')}</div>`}
        <div class="set-row"><div class="t"><b>Keep running in the tray when closed</b><span>Closing the window keeps reminders going. Quit from the tray icon.</span></div>${sw('closeToTray')}</div>
        <div class="set-row"><div class="t"><b>Quick-capture shortcut</b><span>Add a task or sticky from anywhere. Uses Electron accelerator format.</span></div><input class="input" value="${esc(s.hotkey)}" data-set="hotkey" style="width:230px;font-family:var(--font-mono);font-size:12.5px"></div></div>
      <div class="card"><h3>${icon('download', 'sm')} Your data</h3>
        <div class="set-row"><div class="t"><b>Stored locally</b><span class="code-path" data-live="datapath">…</span><span style="display:block">A dated backup is kept automatically each day (last 14).</span></div></div>
        <div class="set-row"><div class="t"><b>Backup & restore</b><span>Export everything to a JSON file, or restore from one.</span></div>
          <button class="btn" data-act="export">${icon('download', 'sm')}Export</button><button class="btn" data-act="import">${icon('upload', 'sm')}Import</button></div></div>
    </div></div>`;
}

const MODS = () => ({ notes: window.Notes, calendar: window.Cal });
const VIEWS = { notes: () => window.Notes.view(), calendar: () => window.Cal.view(), today: viewToday, projects: viewProjects, waiting: viewWaiting, recurring: viewRecurring, snippets: viewSnippets, week: viewWeek, settings: viewSettings };

function renderView(transition) {
  const view = $('#view');
  const isNotes = state.view === 'notes';
  view.classList.toggle('notes-mode', isNotes);
  document.body.classList.toggle('in-notes', isNotes);
  const mod = MODS()[state.view];
  if (mod && !transition) { mod.light(); updateLive(); return; }
  if (transition) {
    state.entering = true;
    view.classList.remove('enter');
    view.innerHTML = VIEWS[state.view]();
    void view.offsetWidth;
    view.classList.add('enter');
    $('.main').scrollTop = 0;
    state.entering = false;
  } else {
    state.entering = false;
    flipRender(view, VIEWS[state.view]());
  }
  if (mod) mod.mount();
  if (state.view === 'settings') api.dataPath().then(p => { const el = $('[data-live="datapath"]'); if (el) el.textContent = p; });
  updateLive();
}
function refresh() {
  if (IS_CAPTURE) return;
  renderView(false);
  updateSidebar();
  if (state.modal) renderModal(false);
}
// refresh the page behind an open drawer without touching the drawer itself (used while typing in it)
let quietTimer = null;
function refreshQuiet() { clearTimeout(quietTimer); quietTimer = setTimeout(() => { renderView(false); updateSidebar(); }, 250); }
function go(view) {
  if (view === state.view) return;
  const old = MODS()[state.view];
  if (old && old.leave) old.leave();
  state.view = view;
  updateSidebar();
  renderView(true);
}

// ================================================================== MODALS
function openModal(type, arg) {
  const had = !!state.modal;
  state.modal = { type, arg };
  document.body.classList.add('has-modal');
  renderModal(true, had);
}
function closeModal() {
  if (!state.modal) return;
  const root = $('#modal-root');
  const panel = root.querySelector('.modal, .drawer'), scrim = root.querySelector('.scrim');
  state.modal = null;
  document.body.classList.remove('has-modal');
  if (panel) panel.classList.add('out');
  if (scrim) scrim.classList.add('out');
  setTimeout(() => { if (!state.modal) root.innerHTML = ''; }, 320);
  refresh();
}
function renderModal(fresh) {
  const root = $('#modal-root');
  const m = state.modal; if (!m) return;
  const html = { project: modalProject, brief: modalBrief, wrap: modalWrap, task: (id) => window.Tasks.drawerHtml(id), sound: modalSound }[m.type](m.arg);
  if (!html) { state.modal = null; root.innerHTML = ''; return; }
  if (fresh) {
    root.innerHTML = html;
    if (m.type === 'task') { const ti = $('#td-title'); if (ti) window.Tasks.autosize(ti); }
    const p = root.querySelector('.modal, .drawer');
    setTimeout(() => p && p.classList.add('settled'), 700);
  } else {
    // update only the body so inputs keep focus and the panel doesn't re-animate
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    const newBody = tmp.querySelector('[data-body]'), body = root.querySelector('[data-body]');
    if (newBody && body) flipRender(body, newBody.innerHTML);
    const nf = tmp.querySelector('[data-foot]'), of = root.querySelector('[data-foot]');
    if (nf && of) of.innerHTML = nf.innerHTML;
  }
}

// ---------- project drawer
function modalProject(pid) {
  const p = P.get(pid); if (!p) return '';
  const tasks = T.ofProject(pid);
  const open = tasks.filter(t => !t.done).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || byOrder(a, b));
  const done = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const mins = D.focusLog.filter(l => l.projectId === pid).reduce((s, l) => s + l.minutes, 0);
  const whenChip = (t) => !t.date ? '<span class="chip">Backlog</span>' : t.date < today() ? `<span class="chip honey">${relDay(t.date)}</span>` : t.date === today() ? '<span class="chip accent">Today</span>' : `<span class="chip">${relDay(t.date)}</span>`;
  return `<div class="scrim" data-act="modal-close"></div>
  <div class="drawer" role="dialog" aria-label="Project">
    <div class="drawer-head">
      <div class="snip-ico" style="background:${p.color};color:#fff;margin-top:4px">${icon('folder', 'sm')}</div>
      <input class="title-input" id="p-name" value="${esc(p.name)}" data-pbind="name" placeholder="Project name">
      <button class="icon-btn" data-act="modal-close" title="Close (Esc)">${icon('x')}</button>
    </div>
    <div class="drawer-body" data-body>
      <div class="row wrap" style="gap:16px">
        <div class="field"><label>Status</label><div class="seg">${['active', 'paused', 'done'].map(s => `<button data-act="p-status" data-v="${s}" class="${p.status === s ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div></div>
        <div class="field"><label>Due</label><input class="input" type="date" id="p-due" value="${p.due || ''}" data-pbind="due" style="width:170px"></div>
        <div class="field"><label>Colour</label><div class="swatches">${PROJECT_COLOURS.map(c => `<button class="swatch ${p.color === c ? 'on' : ''}" style="--c:${c}" data-act="p-color" data-v="${c}"></button>`).join('')}</div></div>
      </div>
      ${(() => { const nb = D.notebooks.find(n => n.projectId === p.id); const n = nb ? D.pages.filter(x => x.notebookId === nb.id).length : 0;
        return `<div class="field"><label>Notebook</label><div class="row">${nb ? `<span class="chip" style="color:${nb.color}"><span class="dot"></span><span style="color:var(--text-2)">${esc(nb.name)} · ${plural(n, 'page')}</span></span><button class="btn sm" data-act="open-note" data-nb="${nb.id}">${icon('book', 'sm')}Open notebook</button>` :
        `<span class="muted" style="font-size:13px">No notebook yet.</span><button class="btn sm" data-act="p-notebook">${icon('book', 'sm')}Start a notebook</button>`}</div></div>`; })()}
      <div class="field"><label>Next action</label>
        <div class="row"><input class="input" id="p-next" value="${esc(p.nextAction || '')}" data-pbind="nextAction" data-enter="p-next-today" placeholder="What's the very next step? (Enter adds it to today)">
        <button class="btn" data-act="p-next-today" title="Add the next action to today">${icon('sun', 'sm')}To today</button></div></div>
      <div class="field"><label>Tasks · ${open.length} open</label>
        <div class="add-bar" style="margin:0 0 8px;box-shadow:none">${icon('plus', 'sm')}<input id="p-add" placeholder="Add a task to this project…" data-enter="p-add"></div>
        <div class="list">${open.map(t => `<div class="task" data-k="pt-${t.id}" data-id="${t.id}">
          <button class="check" data-act="toggle"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
          <div class="task-main"><div class="task-title">${esc(t.title)}</div><div class="task-meta">${whenChip(t)}</div></div>
          <div class="task-actions">${t.date !== today() ? `<button class="pill-btn sage" data-act="today">${icon('sun', 'sm')} Today</button>` : `<button class="pill-btn soft" data-act="tomorrow">Tomorrow ${icon('arrowRight', 'sm')}</button>`}
          <button class="icon-btn danger reveal" data-act="delete">${icon('trash', 'sm')}</button></div></div>`).join('') || '<div class="muted">No open tasks.</div>'}
        ${done.length ? `<div class="muted" style="margin:8px 4px 2px;font-size:12.5px">${plural(done.length, 'task')} done${done[0] ? ` · last: ${esc(done[0].title)}` : ''}</div>` : ''}</div>
      </div>
      <div class="field"><label>Notes</label><textarea class="textarea" id="p-notes" data-pbind="notes" rows="6" placeholder="Links, decisions, contacts, anything useful…">${esc(p.notes || '')}</textarea></div>
      <div class="row wrap" style="justify-content:space-between">
        <div class="muted" style="font-size:13px">${icon('target', 'sm')} ${fmtMins(mins)} focused · Started ${fmtShort(dayKey(new Date(p.createdAt)))}</div>
        <button class="btn sm danger" data-act="p-delete">${icon('trash', 'sm')}Delete project</button></div>
    </div></div>`;
}

// ---------- morning brief
function modalBrief() {
  const overdue = T.overdue(), list = T.today(), due = W.dueList(), stale = P.stale();
  const y = D.dayLog[addDays(today(), -1)] || D.dayLog[lastLoggedDayWithNote()];
  const note = y && y.note && y.note.trim() ? y.note : '';
  return `<div class="scrim" data-act="modal-close"></div>
  <div class="modal" role="dialog" aria-label="Morning brief">
    <div class="modal-head"><div class="eyebrow">${icon('sunrise', 'sm')} ${greeting()}${D.settings.name ? ', ' + esc(D.settings.name) : ''}</div>
      <h2>${fmtLong(today())}</h2><p>Here's how today is shaping up.</p></div>
    <div class="modal-body" data-body>
      ${note ? `<div class="note-box" data-k="b-note"><span class="label-sm">Note from your last wrap-up</span>${esc(note)}</div>` : ''}
      <div class="brief-stats" data-k="b-stats">
        <div class="stat"><b>${list.length}</b><span>planned for today</span></div>
        <div class="stat"><b>${due.length}</b><span>to chase</span></div>
        <div class="stat"><b>${stale.length}</b><span>quiet projects</span></div></div>
      ${overdue.length ? `<div class="field" data-k="b-over"><div class="row"><label class="label-sm" style="flex:1">Carried over · ${overdue.length}</label><button class="btn sm" data-act="overdue-all-today">Bring all into today</button></div>
        <div class="list">${overdue.map(t => `<div class="brief-row" data-k="bo-${t.id}" data-id="${t.id}"><div class="grow">${esc(t.title)}<small>from ${relLow(t.date)}</small></div>
          <button class="pill-btn sage" data-act="today">${icon('arrowLeft', 'sm')} Today</button><button class="icon-btn go" data-act="toggle" title="Already done">${icon('check', 'sm')}</button><button class="icon-btn danger" data-act="delete" title="Drop it">${icon('x', 'sm')}</button></div>`).join('')}</div></div>` : ''}
      ${list.length ? `<div class="field" data-k="b-today"><label>On today's list</label><div class="mini-list">${list.slice(0, 6).map(t => `<div class="mini-item">${icon('sun', 'sm')}<span class="grow">${esc(t.title)}</span>${t.recurringId ? '<span class="chip sky">Recurring</span>' : ''}</div>`).join('')}
        ${list.length > 6 ? `<div class="muted">+ ${list.length - 6} more</div>` : ''}</div></div>` : ''}
      ${due.length ? `<div class="field" data-k="b-wait"><label>Worth chasing</label><div class="list">${due.map(w => `<div class="brief-row" data-k="bw-${w.id}" data-id="${w.id}"><div class="grow">${esc(w.title)}<small>${w.who ? esc(w.who) + ' · ' : ''}waiting ${plural(W.days(w), 'day')}</small></div>
          <button class="pill-btn" data-act="w-chase">${icon('bell', 'sm')} Chased</button><button class="pill-btn sage" data-act="w-got">${icon('check', 'sm')} Got it</button></div>`).join('')}</div></div>` : ''}
      ${stale.length ? `<div class="field" data-k="b-stale"><label>Projects that have gone quiet</label><div class="list">${stale.map(p => `<div class="brief-row" data-k="bp-${p.id}"><span class="chip" style="color:${p.color}"><span class="dot"></span></span><div class="grow">${esc(p.name)}<small>untouched for ${plural(daysSince(p.updatedAt || p.createdAt), 'day')}${p.nextAction ? ' · next: ' + esc(p.nextAction) : ''}</small></div>
          <button class="btn sm" data-act="project-open" data-pid="${p.id}">Open</button></div>`).join('')}</div></div>` : ''}
      ${!overdue.length && !list.length && !due.length && !stale.length ? `<div class="empty" data-k="b-empty"><div class="art">${icon('leaf')}</div><strong>A clean slate</strong>Add a few tasks to get the day going.</div>` : ''}
    </div>
    <div class="modal-foot" data-foot><button class="btn ghost left" data-act="notes-journal">${icon('book', 'sm')}Today's journal</button><button class="btn primary" data-act="modal-close">${icon('sun', 'sm')}Start the day</button></div>
  </div>`;
}
function lastLoggedDayWithNote() {
  const keys = Object.keys(D.dayLog).filter(k => k < today() && D.dayLog[k].note).sort();
  return keys[keys.length - 1] || '';
}

// ---------- wrap-up
function modalWrap() {
  const list = T.today().concat(T.overdue()), done = T.doneOn(today());
  const log = D.dayLog[today()] || {};
  const weekday = parseKey(today()).toLocaleDateString('en-GB', { weekday: 'long' });
  return `<div class="scrim" data-act="modal-close"></div>
  <div class="modal" role="dialog" aria-label="Wrap up">
    <div class="modal-head"><div class="eyebrow">${icon('sunset', 'sm')} Wrapping up ${weekday}</div>
      <h2>${done.length ? (done.length >= 5 ? 'What a day.' : 'Nice work today.') : "Let's close the day."}</h2>
      <p>${done.length ? `You finished ${plural(done.length, 'task')}.` : 'No tasks ticked off today, and that\'s fine.'} ${list.length ? `${list.length === 1 ? 'Decide what happens to the one still open.' : `Decide what happens to the ${list.length} still open.`}` : 'Nothing left open.'}</p></div>
    <div class="modal-body" data-body>
      ${list.length ? `<div class="field" data-k="wr-open"><div class="row"><label class="label-sm" style="flex:1">Still open · ${list.length}</label>
        <button class="btn sm primary" data-act="wrap-all">Move all to tomorrow ${icon('arrowRight', 'sm')}</button></div>
        <div class="list">${list.map(t => `<div class="brief-row" data-k="wo-${t.id}" data-id="${t.id}"><div class="grow">${esc(t.title)}${t.carried ? `<small>carried ${t.carried}× already</small>` : ''}</div>
          <button class="pill-btn" data-act="tomorrow">Tomorrow ${icon('arrowRight', 'sm')}</button>
          <button class="icon-btn go" data-act="toggle" title="Actually done">${icon('check', 'sm')}</button>
          <button class="icon-btn danger" data-act="delete" title="Drop it">${icon('x', 'sm')}</button></div>`).join('')}</div></div>` :
        `<div class="empty" data-k="wr-clear" style="padding:22px"><div class="art">${icon('leaf')}</div><strong>All clear</strong>Nothing left hanging.</div>`}
      ${done.length ? `<div class="field" data-k="wr-done"><label>Done today</label><div class="mini-list">${done.slice(0, 8).map(t => `<div class="mini-item"><span style="color:var(--sage)">${icon('check', 'sm')}</span><span class="grow">${esc(t.title)}</span></div>`).join('')}${done.length > 8 ? `<div class="muted">+ ${done.length - 8} more</div>` : ''}</div></div>` : ''}
      <div class="field" data-k="wr-note"><label>Note for tomorrow-you</label><textarea class="textarea" id="wrap-note" data-daynote="1" rows="3" placeholder="Where you left off, what to start with…">${esc(log.note || '')}</textarea></div>
    </div>
    <div class="modal-foot" data-foot><button class="btn ghost left" data-act="modal-close">Back to work</button>
      <button class="btn primary" data-act="wrap-finish">${icon('moon', 'sm')}Finish the day</button></div>
  </div>`;
}

// ================================================================== BREAK OVERLAY
let breakCountdown = null;
function openBreak() {
  if (state.breakOpen) return;
  state.breakOpen = true;
  state.pendingBreak = false;
  window.Sound && Sound.play('bell');
  const mins = Math.max(1, Math.round(brkActive() / 60));
  const tip = STRETCHES[Math.floor(Math.random() * STRETCHES.length)];
  const el = document.createElement('div');
  el.className = 'break-overlay';
  el.id = 'break-ov';
  el.innerHTML = `<div class="break-inner">
    <div class="breath"><span data-breath>Breathe in</span></div>
    <h2>Time to rest your eyes</h2>
    <p>You've been on screen for ${plural(mins, 'minute')}. Step away for a few minutes. Your tasks will still be here.</p>
    <div class="rule-card">${ring(58, 5, 0, { cls: 'sage', live: 'r20', label: '20' })}
      <div><div class="k">The 20-20-20 rule</div><div class="t">Look at something about 20 feet (6 m) away for 20 seconds.</div></div></div>
    <div class="stretch">${icon('stretch', 'sm')} Then: ${tip}</div>
    <div class="break-actions"><button class="btn primary" data-act="brk-done">${icon('check', 'sm')}Done, reset the clock</button>
      <button class="btn" data-act="brk-snooze">${icon('clock', 'sm')}Snooze ${D.settings.snoozeMinutes} min</button></div></div>`;
  document.body.appendChild(el);
  const started = Date.now();
  let phase = 0;
  clearInterval(breakCountdown);
  breakCountdown = setInterval(() => {
    const s = (Date.now() - started) / 1000;
    const r = $('[data-live="r20"]', el);
    const left = Math.max(0, 20 - Math.floor(s));
    if (r) { setRing(r, Math.min(1, s / 20)); r.querySelector('.ring-label').innerHTML = left > 0 ? left : icon('check', 'sm'); }
    const ph = Math.floor(s / 4) % 2;
    if (ph !== phase) { phase = ph; const b = $('[data-breath]', el); if (b) b.textContent = ph ? 'Breathe out' : 'Breathe in'; }
  }, 250);
}
function closeBreak() {
  const el = $('#break-ov');
  state.breakOpen = false;
  clearInterval(breakCountdown);
  if (el) { el.classList.add('out'); setTimeout(() => el.remove(), 500); }
}
function countBreak() {
  const k = today();
  D.meta.breaks[k] = (D.meta.breaks[k] || 0) + 1;
  save();
}

// ================================================================== LIVE (per-second) UPDATES
function brkActive() {
  const s = state.brk.status;
  if (s.away || s.due) return s.activeSeconds;
  return s.activeSeconds + (Date.now() - state.brk.at) / 1000;
}
function setBreakStatus(s) { state.brk = { status: s, at: Date.now() }; updateLive(); }

function focusElapsed(f = D.meta.focus) {
  if (!f) return 0;
  return f.accumulated + (f.running ? (Date.now() - f.startedAt) / 1000 : 0);
}

function updateLive() {
  // break clock
  const s = state.brk.status;
  const interval = s.intervalSeconds || D.settings.breakInterval * 60;
  const active = brkActive();
  const remain = Math.max(0, interval - active);
  const snoozed = s.snoozedUntil && s.snoozedUntil > Date.now();
  let text, num, pct = Math.min(1, active / interval);
  if (s.due) { text = 'Break time'; num = 'Now'; }
  else if (s.away) { text = 'Resting'; num = 'Away'; pct = 0; }
  else if (snoozed) { const m = Math.ceil((s.snoozedUntil - Date.now()) / 60000); text = `Snoozed ${m}m`; num = `${m}<small>min</small>`; }
  else if (remain <= 0) { text = 'Any moment'; num = '0<small>min</small>'; }
  else { const m = Math.ceil(remain / 60); text = `in ${m} min`; num = `${m}<small>min</small>`; }
  const onFor = `On screen ${fmtMins(Math.floor(active / 60))}`;
  $$('[data-live="brk-ring"]').forEach(el => { setRing(el, pct); el.classList.toggle('due', !!s.due); el.classList.toggle('honey', !!snoozed); });
  $$('[data-live="brk-text"]').forEach(el => { el.textContent = text; });
  $$('[data-live="brk-num"]').forEach(el => { el.innerHTML = num; });
  $$('[data-live="brk-sub"]').forEach(el => { el.textContent = s.away ? 'Clock resets while you\'re away' : onFor; });

  // focus
  const f = D.meta.focus;
  if (f) {
    const el = focusElapsed(f), left = Math.max(0, f.totalSec - el);
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    $$('[data-live="focus-ring"]').forEach(r => setRing(r, el / f.totalSec));
    $$('[data-live="focus-text"]').forEach(t => { t.textContent = `${mm}:${pad(ss)}${f.running ? '' : ' · paused'}`; });
    if (f.running && left <= 0) finishFocus(true);
  }
}

// ================================================================== FOCUS
function startFocus(taskId, minutes) {
  if (D.meta.focus) logFocus(D.meta.focus);
  const t = taskId ? T.get(taskId) : null;
  D.meta.focus = {
    taskId: t ? t.id : null, projectId: t ? t.projectId : null,
    label: t ? t.title : `${minutes}-minute focus`,
    totalSec: minutes * 60, startedAt: Date.now(), accumulated: 0, running: true
  };
  save(); refresh();
  focusEffects(true);
  toast(`Focusing for ${minutes} minutes`, { ic: 'target' });
}
function shieldOn() { const f = D.meta.focus; return !!(f && f.running && D.settings.focusShield); }
function focusEffects(on) {
  if (on) {
    if (D.settings.ambientAuto && D.settings.ambient && D.settings.ambient !== 'off' && window.Sound && !Sound.current()) Sound.ambient(D.settings.ambient);
    if (D.settings.dnd && api.setDnd) api.setDnd(true);
  } else {
    if (window.Sound && Sound.current()) Sound.stopAmbient();
    if (api.setDnd) api.setDnd(false);
  }
  if (api.setFocusShield) api.setFocusShield(shieldOn());
  if (!shieldOn() && state.pendingBreak && !on) setTimeout(() => { if (!shieldOn()) openBreak(); }, 1200);
}
function logFocus(f) {
  const minutes = Math.round(focusElapsed(f) / 60);
  if (minutes < 1) return 0;
  D.focusLog.push({ id: uid(), date: today(), minutes, taskId: f.taskId, projectId: f.projectId, label: f.label, at: Date.now() });
  if (f.projectId) touchProject(f.projectId);
  return minutes;
}
function finishFocus(completed) {
  const f = D.meta.focus; if (!f) return;
  const minutes = logFocus(f);
  D.meta.focus = null;
  save(); refresh();
  focusEffects(false);
  if (completed) {
    window.Sound && Sound.play('chime');
    api.notify('Focus session complete', `${minutes} minutes on "${f.label}". Nice work. Take a breather.`);
    const t = f.taskId && T.get(f.taskId);
    if (t && !t.done) toast(`${minutes} min logged. Mark "${t.title.slice(0, 30)}" done?`, { ic: 'target', timeout: 9000, action: { label: 'Mark done', fn: () => toggleTask(t.id) } });
    else toast(`${minutes} minutes of focus logged`, { ic: 'target' });
  } else if (minutes) {
    toast(`${minutes} min logged`, { ic: 'target' });
  }
}

// ================================================================== ACTIONS
function toggleTask(id, el) {
  const t = T.get(id); if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  t.doneDate = t.done ? today() : null;
  if (t.done && t.date && t.date < today()) t.date = today();
  if (t.projectId) touchProject(t.projectId);
  if (t.done && D.meta.focus && D.meta.focus.taskId === id) finishFocus(false);
  const check = el && el.querySelector('.check');
  if (check) { check.classList.toggle('on', t.done); check.classList.add('pop'); }
  if (t.done && window.Sound) Sound.play(T.today().length === 0 && t.date === today() ? 'chime' : 'tick');
  save();
  setTimeout(refresh, check ? 380 : 0);
  if (t.done && T.today().length === 0 && T.doneOn(today()).length > 1) setTimeout(() => toast('Today\'s list is clear. Lovely work.', { ic: 'sparkle' }), 600);
}
async function moveTask(id, date, el, dir = 'right') {
  const t = T.get(id); if (!t) return;
  const snap = snapshot();
  if (el) await animateOut(el, dir);
  if (date > today() && (!t.date || t.date <= today())) t.carried = (t.carried || 0) + 1;
  t.date = date;
  t.order = Date.now();
  window.Sound && Sound.play('swish');
  if (t.projectId) touchProject(t.projectId);
  save(); refresh();
  undoable(date === tomorrow() ? 'Moved to tomorrow' : date === today() ? 'Added to today' : 'Moved', snap, date === today() ? 'sun' : 'arrowRight');
}
async function deleteTask(id, el) {
  const t = T.get(id); if (!t) return;
  const snap = snapshot();
  if (el) await animateOut(el, 'collapse');
  D.tasks = D.tasks.filter(x => x.id !== id);
  if (D.meta.focus && D.meta.focus.taskId === id) D.meta.focus = null;
  save(); refresh();
  undoable('Task deleted', snap, 'trash');
}
function addTask(title, opts, extra) {
  if (!title.trim()) return null;
  const t = newTask(title, opts);
  if (extra) Object.assign(t, extra);
  D.tasks.push(t);
  window.Sound && Sound.play('tap');
  if (t.projectId) touchProject(t.projectId);
  save(); refresh();
  return t;
}
async function moveAllToTomorrow(includeOverdue) {
  const list = T.today().concat(includeOverdue ? T.overdue() : []);
  if (!list.length) return;
  const snap = snapshot();
  const els = list.map(t => rowEl(t.id)).filter(Boolean);
  if (!REDUCED) els.forEach((el, i) => el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(40px)' }], { duration: 280, delay: i * 40, easing: EASE, fill: 'forwards' }));
  await new Promise(r => setTimeout(r, REDUCED ? 0 : 280 + els.length * 40));
  list.forEach(t => { t.date = tomorrow(); t.carried = (t.carried || 0) + 1; t.order = Date.now() + Math.random(); });
  save(); refresh();
  undoable(`${plural(list.length, 'task')} moved to tomorrow`, snap, 'arrowRight');
}
function bringOverdueToday() {
  const list = T.overdue(); if (!list.length) return;
  const snap = snapshot();
  list.forEach(t => { t.date = today(); });
  save(); refresh();
  undoable(`${plural(list.length, 'task')} brought into today`, snap, 'sun');
}
function newProject() {
  const p = { id: uid(), name: 'New project', status: 'active', color: PROJECT_COLOURS[D.projects.length % PROJECT_COLOURS.length], nextAction: '', notes: '', due: '', createdAt: Date.now(), updatedAt: Date.now() };
  D.projects.push(p);
  save();
  if (state.view === 'projects') { state.projectFilter = 'active'; refresh(); }
  openModal('project', p.id);
  setTimeout(() => { const i = $('#p-name'); if (i) { i.focus(); i.select(); } }, 80);
}

function startInlineEdit(titleEl, id) {
  const t = T.get(id); if (!t || titleEl.querySelector('input')) return;
  titleEl.innerHTML = `<input class="task-edit" value="${esc(t.title)}" maxlength="300">`;
  const input = titleEl.querySelector('input');
  input.focus(); input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return; done = true;
    if (commit && input.value.trim() && input.value.trim() !== t.title) { t.title = input.value.trim(); save(); }
    refresh();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') { e.stopPropagation(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
}

const ACTIONS = {
  'filter-tag': (el) => { const g = el.dataset.v; state.filter.tag = state.filter.tag === g ? null : g; if (state.view !== 'today') go('today'); else refresh(); },
  'filter-prio': (el) => { const n = +el.dataset.v; state.filter.prio = state.filter.prio === n ? 0 : n; refresh(); },
  'filter-clear': () => { state.filter = { tag: null, prio: 0 }; refresh(); },
  'nav-toggle': (el) => {
    const id = el.dataset.v, h = D.settings.nav.hidden;
    D.settings.nav.hidden = h.includes(id) ? h.filter(x => x !== id) : h.concat(id);
    save(); buildSidebar(); updateSidebar(); refresh();
  },
  'nav-move': (el) => {
    const order = navOrder(), id = el.dataset.v, i = order.indexOf(id), j = i + (+el.dataset.dir);
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    D.settings.nav.order = order;
    save(); buildSidebar(); updateSidebar(); refresh();
  },
  'set-seg': (el) => { const k = el.dataset.k; let v = el.dataset.v; D.settings[k] = v; save(); refresh(); if (k === 'ambient' && window.Sound && Sound.current() && v !== 'off') Sound.ambient(v); },
  'set-season': (el) => { D.settings.season = el.dataset.v; applyTheme(); save(); refresh(); },
  'sound-toggle': () => { D.settings.sounds = !D.settings.sounds; save(); Sound.applyVolumes(); buildSidebar(); updateSidebar(); if (D.settings.sounds) Sound.play('pop'); if (state.view === 'settings') refresh(); },
  'sound-test': (el) => { const was = D.settings.sounds; D.settings.sounds = true; Sound.applyVolumes(); Sound.play(el.dataset.v); D.settings.sounds = was; setTimeout(() => Sound.applyVolumes(), 4000); },
  'amb-play': (el) => {
    const k = el.dataset.v;
    if (Sound.current() === k) { Sound.stopAmbient(); } else { Sound.ambient(k); D.settings.ambient = k; save(); }
    setTimeout(refresh, 30);
  },
  'sound-add': () => { state.soundForm = null; openModal('sound', null); setTimeout(() => $('#snd-name')?.focus(), 80); },
  'snd-ic': (el) => { readSoundForm(); state.soundForm.ic = el.dataset.v; renderModal(false); },
  'sound-cancel': () => { if (state.soundTest) { Sound.stopAmbient(true); state.soundTest = false; } state.soundForm = null; closeModal(); },
  'sound-test': () => {
    const f = readSoundForm();
    if (!validLink(f.url || '')) { toast('Paste a full link starting with https://', { ic: 'link' }); return; }
    if (!api.streamPlay) { toast('Streaming works in the desktop app', { ic: 'globe' }); return; }
    if (state.soundTest) { Sound.stopAmbient(true); state.soundTest = false; return; }
    D.settings.customSounds.push({ id: '__test', name: 'Test', url: f.url.trim() });
    Sound.ambient('__test'); state.soundTest = true;
    D.settings.customSounds = D.settings.customSounds.filter(x => x.id !== '__test');
    toast('Playing a preview… press Try it again to stop', { ic: 'play', timeout: 5000 });
  },
  'sound-save': (el) => {
    const f = readSoundForm(); const arg = el.dataset.v || '';
    if (!validLink(f.url || '')) { toast('Paste a full link starting with https://', { ic: 'link' }); $('#snd-url')?.focus(); return; }
    if (state.soundTest) { Sound.stopAmbient(true); state.soundTest = false; }
    if (arg.startsWith('edit:')) {
      const id = arg.slice(5);
      D.settings.soundSources[id] = { ...(D.settings.soundSources[id] || {}), url: f.url.trim(), mode: 'stream' };
      save(); state.soundForm = null; closeModal(); restartIfPlaying(id);
      toast('Link updated', { ic: 'link' }); return;
    }
    if (!(f.name || '').trim()) { toast('Give it a name', { ic: 'edit' }); $('#snd-name')?.focus(); return; }
    let c = arg ? D.settings.customSounds.find(x => x.id === arg) : null;
    if (c) Object.assign(c, { name: f.name.trim(), url: f.url.trim(), ic: f.ic || 'music' });
    else { c = { id: 'snd-' + uid(), name: f.name.trim(), url: f.url.trim(), ic: f.ic || 'music' }; D.settings.customSounds.push(c); }
    save(); state.soundForm = null; closeModal();
    toast(`"${c.name}" added. Click it to play, right-click for options.`, { ic: 'music' });
    if (arg) restartIfPlaying(c.id);
  },
  'water-plus': () => { const k = today(); D.meta.water[k] = (D.meta.water[k] || 0) + 1; save(); Sound.play('water'); refresh(); if (D.meta.water[k] === (D.settings.waterGoal || 8)) toast('Water goal reached. Well done!', { ic: 'drop' }); },
  'water-minus': () => { const k = today(); D.meta.water[k] = Math.max(0, (D.meta.water[k] || 0) - 1); save(); refresh(); },
  'open-note': (el) => { if (state.modal) closeModalInstant(); window.Notes.open(el.dataset.nb, el.dataset.pg || null); },
  'notes-journal': () => { if (state.modal) closeModalInstant(); window.Notes.openJournal(); },
  'p-notebook': () => { const pid = state.modal.arg; closeModalInstant(); window.Notes.createForProject(pid); },
  'add-when': (el) => { state.addWhen = el.dataset.v; refresh(); setTimeout(() => $('#add-task')?.focus(), 0); },
  'sec-toggle': (el) => { state[el.dataset.v] = !state[el.dataset.v]; refresh(); },
  toggle: (el, id, row) => toggleTask(id, row),
  tomorrow: (el, id, row) => moveTask(id, tomorrow(), row, 'right'),
  today: (el, id, row) => moveTask(id, today(), row, 'left'),
  delete: (el, id, row) => deleteTask(id, row),
  'focus-task': (el, id) => startFocus(id, D.settings.focusMinutes),
  'all-tomorrow': () => moveAllToTomorrow(false),
  'overdue-all-today': () => bringOverdueToday(),
  'brief-open': () => openModal('brief'),
  'wrap-open': () => openModal('wrap'),
  'modal-close': () => closeModal(),

  'brk-now': () => api.breakNow().then(() => openBreak()),
  'brk-reset': (el) => {
    const svg = el && el.querySelector('svg');
    svg && svg.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-360deg)' }], { duration: 600, easing: 'cubic-bezier(.3,.7,.2,1)' });
    api.breakTaken().then(setBreakStatus);
    window.Sound && Sound.play('tick');
    toast(`Break clock reset: next break in ${D.settings.breakInterval} min`, { ic: 'clock' });
  },
  'widgets-manage': () => { go('settings'); setTimeout(() => { const c = document.getElementById('set-widgets'); c && c.scrollIntoView({ behavior: 'smooth', block: 'center' }); c && c.classList.add('flash'); }, 450); },
  'widget-toggle': (el) => setWidget(el.dataset.v, !widgetOn(el.dataset.v)),
  'brk-taken': () => { countBreak(); api.breakTaken().then(setBreakStatus); toast('Break logged. Clock reset.', { ic: 'coffee' }); },
  'brk-done': () => { countBreak(); closeBreak(); api.breakTaken().then(setBreakStatus); toast('Welcome back. Clock reset.', { ic: 'leaf' }); },
  'brk-snooze': () => { closeBreak(); api.breakSnooze().then(setBreakStatus); toast(`Snoozed for ${D.settings.snoozeMinutes} minutes`, { ic: 'clock' }); },

  'focus-start': (el) => startFocus(null, +el.dataset.v),
  'focus-pause': () => { const f = D.meta.focus; if (!f) return; f.accumulated = focusElapsed(f); f.running = false; save(); refresh(); focusEffects(false); },
  'focus-resume': () => { const f = D.meta.focus; if (!f) return; f.startedAt = Date.now(); f.running = true; save(); refresh(); focusEffects(true); },
  'focus-stop': () => finishFocus(false),

  pfilter: (el) => { state.projectFilter = el.dataset.v; refresh(); },
  'project-new': () => newProject(),
  'project-open': (el) => openModal('project', el.dataset.pid),
  'p-status': (el) => { const p = P.get(state.modal.arg); p.status = el.dataset.v; p.updatedAt = Date.now(); save(); refresh(); },
  'p-color': (el) => { const p = P.get(state.modal.arg); p.color = el.dataset.v; save(); const ico = $('.drawer-head .snip-ico'); if (ico) ico.style.background = p.color; refresh(); },
  'p-expand': (el) => { const p = P.get(el.dataset.pid); p.expanded = !p.expanded; save(); refresh(); window.Sound && Sound.play('tap'); },
  'p-expand-all': () => { const list = D.projects.filter(p => p.status === state.projectFilter); const all = list.every(p => p.expanded); list.forEach(p => { p.expanded = !all; }); save(); refresh(); },
  'p-done-toggle': (el) => { const id = el.dataset.pid; if (state.projDone.has(id)) state.projDone.delete(id); else state.projDone.add(id); refresh(); },
  'p-add-inline': (el) => {
    const pid = el.dataset.pid; const i = $('#pa-' + pid); const v = i.value.trim(); if (!v) return;
    const pr = D.settings.smartAdd !== false ? window.Tasks.parse(v) : { title: v, tags: [], priority: 0 };
    addTask(pr.title, { projectId: pid, date: pr.date !== undefined ? pr.date : null }, { time: pr.time || null, priority: pr.priority || 0, tags: pr.tags || [] });
    touchProject(pid);
    const i2 = $('#pa-' + pid); if (i2) { i2.value = ''; i2.focus(); }
  },
  'p-next-today': (el) => {
    const pid = (el && el.dataset && el.dataset.pid) || (state.modal && state.modal.arg);
    const p = P.get(pid);
    const inline = !!(el && el.dataset && el.dataset.pid);
    const input = inline ? $('#pn-' + pid) : $('#p-next');
    const v = (input ? input.value : p.nextAction || '').trim();
    if (!v) { input?.focus(); return; }
    p.nextAction = '';            // clear it so the next step can be typed straight away
    p.updatedAt = Date.now();
    addTask(v, { projectId: p.id });
    const i2 = inline ? $('#pn-' + pid) : $('#p-next'); if (i2) { i2.value = ''; i2.focus(); }
    toast(`"${v.length > 40 ? v.slice(0, 38) + '…' : v}" added to today`, { ic: 'sun' });
  },
  'nav-collapse': () => toggleNav(),
  'p-add': () => {
    const i = $('#p-add'); const v = i.value.trim(); if (!v) return;
    addTask(v, { projectId: state.modal.arg, date: null });
    i.value = ''; i.focus();
  },
  'p-delete': () => {
    const pid = state.modal.arg, p = P.get(pid); const snap = snapshot();
    D.projects = D.projects.filter(x => x.id !== pid);
    D.tasks.forEach(t => { if (t.projectId === pid) t.projectId = null; });
    D.recurring.forEach(r => { if (r.projectId === pid) r.projectId = null; });
    save(); closeModal();
    undoable(`Deleted "${p.name}"`, snap, 'trash');
  },

  'waiting-add': () => {
    const t = $('#w-title'), w = $('#w-who'), n = $('#w-nudge');
    if (!t.value.trim()) { t.focus(); return; }
    D.waiting.push({ id: uid(), title: t.value.trim(), who: w.value.trim(), since: today(), lastChased: today(), nudgeDays: +n.value, chases: 0, done: false, createdAt: Date.now() });
    t.value = ''; w.value = '';
    save(); refresh(); t.focus();
  },
  'w-chase': (el, id) => { const w = D.waiting.find(x => x.id === id); w.lastChased = today(); w.chases = (w.chases || 0) + 1; save(); refresh(); toast(`Nudge reset. Hearth will remind you again in ${plural(w.nudgeDays, 'day')}.`, { ic: 'bell' }); },
  'w-got': async (el, id, row) => { const snap = snapshot(); if (row) await animateOut(row, 'right'); const w = D.waiting.find(x => x.id === id); w.done = true; w.doneDate = today(); w.doneAt = Date.now(); save(); refresh(); undoable('Marked as received', snap); },
  'w-reopen': (el, id) => { const w = D.waiting.find(x => x.id === id); w.done = false; save(); refresh(); },
  'w-delete': async (el, id, row) => { const snap = snapshot(); if (row) await animateOut(row); D.waiting = D.waiting.filter(x => x.id !== id); save(); refresh(); undoable('Deleted', snap, 'trash'); },

  'rec-day': (el) => { const d = +el.dataset.v, f = state.recForm; f.days = f.days.includes(d) ? f.days.filter(x => x !== d) : f.days.concat(d); keepRecTitle(); },
  'rec-add': () => {
    const f = state.recForm, title = $('#r-title');
    if (!title.value.trim()) { title.focus(); return; }
    if (f.freq === 'weekly' && !f.days.length) { toast('Pick at least one day', { ic: 'calendar' }); return; }
    const dom = $('#r-dom') ? Math.max(1, Math.min(31, +$('#r-dom').value || 1)) : f.dom;
    D.recurring.push({ id: uid(), title: title.value.trim(), freq: f.freq, days: f.days.slice(), dom, projectId: $('#r-project').value || null, active: true, createdAt: Date.now() });
    ensureRecurring();
    state.recDraft = '';
    save(); refresh();
    toast('Routine added', { ic: 'repeat' });
  },
  'rec-open': (el, id) => { if (state.recOpen.has(id)) state.recOpen.delete(id); else state.recOpen.add(id); refresh(); if (state.recOpen.has(id)) setTimeout(() => { const r = rowEl(id); r && r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 60); },
  'rec-eday': (el, id) => { const r = D.recurring.find(x => x.id === id); const d = +el.dataset.v; r.days = (r.days || []).includes(d) ? r.days.filter(x => x !== d) : (r.days || []).concat(d); save(); refresh(); },
  'rec-prio': (el, id) => { const r = D.recurring.find(x => x.id === id); r.priority = +el.dataset.v; save(); refresh(); },
  'rec-step-add': (el) => {
    const id = (el.closest('[data-id]') || {}).dataset?.id; const r = D.recurring.find(x => x.id === id); if (!r) return;
    const i = $('#rsa-' + id); const v = i.value.trim(); if (!v) return;
    r.steps = r.steps || []; r.steps.push({ id: uid(), title: v });
    save(); refresh(); setTimeout(() => $('#rsa-' + id)?.focus(), 0);
  },
  'rec-step-del': (el, id) => { const r = D.recurring.find(x => x.id === id); r.steps = (r.steps || []).filter(x => x.id !== el.dataset.v); save(); refresh(); },
  'rec-now': (el, id) => {
    const r = D.recurring.find(x => x.id === id); if (!r) return;
    const nt = newTask(r.title, { projectId: r.projectId || null, recurringId: r.id });
    if (r.time) nt.time = r.time;
    if (r.notes) nt.notes = r.notes;
    if (r.priority) nt.priority = r.priority;
    if ((r.steps || []).length) nt.subtasks = r.steps.filter(x => x.title.trim()).map(x => ({ id: uid(), title: x.title, done: false }));
    D.tasks.push(nt); save(); refresh();
    toast(`"${r.title}" added to today`, { ic: 'sun' });
  },
  'rec-toggle': (el, id) => { const r = D.recurring.find(x => x.id === id); r.active = r.active === false; if (r.active) ensureRecurring(); save(); refresh(); },
  'rec-delete': async (el, id, row) => { const snap = snapshot(); if (row) await animateOut(row); D.recurring = D.recurring.filter(x => x.id !== id); save(); refresh(); undoable('Routine deleted', snap, 'trash'); },

  'snip-new': () => { state.snipForm = { kind: 'snippet', title: '', content: '', tags: [] }; refresh(); setTimeout(() => $('#s-title')?.focus(), 30); },
  'snip-kind': (el) => { readSnipForm(); state.snipForm.kind = el.dataset.v; refresh(); },
  'snip-cancel': () => { state.snipForm = null; refresh(); },
  'snip-save': () => {
    readSnipForm();
    const f = state.snipForm;
    if (!f.title.trim() || !f.content.trim()) { toast('Add a title and some content', { ic: 'edit' }); return; }
    if (f.kind === 'link' && !/^[a-z]+:/i.test(f.content.trim())) f.content = 'https://' + f.content.trim();
    if (f.id) Object.assign(D.snippets.find(s => s.id === f.id), f);
    else D.snippets.push({ ...f, id: uid(), createdAt: Date.now() });
    state.snipForm = null; save(); refresh();
    toast('Saved', { ic: 'bookmark' });
  },
  'snip-edit': (el, id) => { const s = D.snippets.find(x => x.id === id); state.snipForm = { ...s, tags: [...(s.tags || [])] }; refresh(); $('.main').scrollTop = 0; },
  'snip-delete': async (el, id, row) => { const snap = snapshot(); if (row) await animateOut(row); D.snippets = D.snippets.filter(x => x.id !== id); save(); refresh(); undoable('Deleted', snap, 'trash'); },
  'snip-copy': (el, id) => {
    const s = D.snippets.find(x => x.id === id); api.copy(s.content); s.usedAt = Date.now(); save();
    el.innerHTML = `${icon('check', 'sm')}Copied`; el.classList.add('copied');
    setTimeout(() => { el.innerHTML = `${icon('copy', 'sm')}Copy`; el.classList.remove('copied'); }, 1400);
  },
  'snip-open': (el, id) => { const s = D.snippets.find(x => x.id === id); s.usedAt = Date.now(); save(); api.openExternal(s.content); },

  'week-prev': () => { state.weekOffset--; renderView(true); },
  'week-next': () => { if (state.weekOffset < 0) { state.weekOffset++; renderView(true); } },
  'week-copy': () => { api.copy(weekText()); toast('Summary copied. Paste it into an email or Teams.', { ic: 'copy' }); },

  'set-toggle': (el) => {
    const k = el.dataset.v; D.settings[k] = !D.settings[k]; el.classList.toggle('on', D.settings[k]); save();
    if (k === 'seasonFx') applyTheme();
    if (k === 'navCollapsed') { D.settings.navCollapsed = !D.settings.navCollapsed; toggleNav(); return; }
    if (k === 'sounds') { Sound.applyVolumes(); buildSidebar(); updateSidebar(); }
    if (k === 'smartAdd' || k === 'waterOn') refresh();
  },
  'set-theme': (el) => { D.settings.theme = el.dataset.v; applyTheme(); save(); refresh(); },
  export: () => api.exportData().then(ok => ok && toast('Backup exported', { ic: 'download' })),
  import: () => api.importData().then(d => { if (d) { D = normalise(d); applyTheme(); refresh(); toast('Data restored', { ic: 'upload' }); } }),

  'wrap-all': () => moveAllToTomorrow(true),
  'wrap-finish': () => {
    const k = today();
    D.dayLog[k] = { ...(D.dayLog[k] || {}), wrapped: true, note: ($('#wrap-note') || {}).value || '' };
    window.Notes.journalWrap(k, D.dayLog[k].note, T.doneOn(k));
    save(); closeModal();
    window.Sound && Sound.play('chime');
    toast('Day wrapped. Have a good evening.', { ic: 'moon', timeout: 5000 });
  }
};

function keepRecTitle() {
  const v = $('#r-title')?.value || '';
  refresh();
  const i = $('#r-title'); if (i) i.value = v;
}
function readSnipForm() {
  const f = state.snipForm; if (!f) return;
  f.title = $('#s-title')?.value ?? f.title;
  f.content = $('#s-content')?.value ?? f.content;
  f.tags = ($('#s-tags')?.value ?? (f.tags || []).join(',')).split(',').map(s => s.trim()).filter(Boolean);
}

// ================================================================== EVENTS
document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-view]');
  if (nav && !e.target.closest('[data-act]')) { if (state.modal) closeModal(); go(nav.dataset.view); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const fn = ACTIONS[act] || (window.Notes && window.Notes.actions[act]) || (window.Cal && window.Cal.actions[act]) || (window.Tasks && window.Tasks.actions[act]);
  if (!fn) return;
  const row = el.closest('[data-id]');
  // a project card is itself the action target; don't treat it as a row
  if (act === 'project-open' && state.modal && state.modal.type !== 'project') closeModalInstant();
  e.preventDefault();
  fn(el, row ? row.dataset.id : null, row);
});
function closeModalInstant() { state.modal = null; document.body.classList.remove('has-modal'); $('#modal-root').innerHTML = ''; }


document.addEventListener('keydown', (e) => {
  const tgt = e.target;
  if (e.key === 'Enter' && tgt.id === 'add-task') {
    const v = tgt.value.trim(); if (!v) return;
    const p = D.settings.smartAdd !== false ? window.Tasks.parse(v) : { title: v, tags: [], priority: 0 };
    const date = p.date !== undefined ? p.date : (state.addWhen === 'tomorrow' ? tomorrow() : today());
    const extra = { time: p.time || null, priority: p.priority || 0, tags: p.tags || [] };
    if (extra.time && D.settings.remindAtTime) extra.remind = 0;
    const t = addTask(p.title, { date, projectId: p.projectId || $('#add-project')?.value || null }, extra);
    const inp = $('#add-task'); if (inp) { inp.value = ''; inp.focus(); }
    const pv = $('#add-preview'); if (pv) pv.innerHTML = '';
    if (t && t.date === tomorrow()) { state.showTomorrow = true; refresh(); }
    if (t && t.date !== today()) toast(`Added to ${relLow(t.date)}${t.time ? ' at ' + window.Tasks.fmtTime(t.time) : ''}`, { ic: 'calendar' });
    else if (t && t.time) toast(`Added for ${window.Tasks.fmtTime(t.time)} today${t.remind != null ? ' with a reminder' : ''}`, { ic: 'clock' });
    return;
  }
  if (e.key === 'Enter' && tgt.dataset && tgt.dataset.enter && !e.shiftKey) {
    e.preventDefault();
    const fn = ACTIONS[tgt.dataset.enter] || (window.Notes && Notes.actions[tgt.dataset.enter]) || (window.Cal && Cal.actions[tgt.dataset.enter]) || (window.Tasks && Tasks.actions[tgt.dataset.enter]);
    fn && fn(tgt); return;
  }
  if (e.key === 'Escape') {
    if (state.breakOpen) return;
    if (state.modal) { closeModal(); return; }
    if (state.snipForm) { state.snipForm = null; refresh(); return; }
  }
  const typing = /INPUT|TEXTAREA|SELECT/.test(tgt.tagName) || tgt.isContentEditable;
  if ((e.ctrlKey && e.key.toLowerCase() === 'n') || (!typing && e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
    e.preventDefault(); if (state.modal) closeModal(); go('today'); setTimeout(() => $('#add-task')?.focus(), 60); return;
  }
  if (e.ctrlKey && !e.shiftKey && (e.key === '\\' || e.code === 'Backslash')) { e.preventDefault(); toggleNav(); return; }
  if (e.ctrlKey && /^[1-9]$/.test(e.key)) {
    const ids = visibleNav();
    if (!ids[+e.key - 1]) return;
    e.preventDefault(); if (state.modal) closeModal(); go(ids[+e.key - 1]);
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.pnext) { const p = P.get(t.dataset.pid); if (p) { p.nextAction = t.value; save(); } return; }
  if (t.dataset.rbind) {
    const r = D.recurring.find(x => x.id === (t.closest('[data-id]') || {}).dataset?.id); if (!r) return;
    let v = t.value; const k = t.dataset.rbind;
    if (k === 'dom') { v = Math.max(1, Math.min(31, parseInt(v, 10) || 1)); }
    if (k === 'title' && !v.trim()) return;
    if (k === 'projectId' || k === 'time') v = v || null;
    r[k] = v;
    if (k === 'freq' && v === 'weekly' && !(r.days || []).length) r.days = [1];
    save();
    if (k === 'freq' || k === 'projectId' || k === 'time') refresh(); else refreshQuiet();
    return;
  }
  if (t.dataset.rstep) {
    const r = D.recurring.find(x => x.id === (t.closest('[data-id]') || {}).dataset?.id); if (!r) return;
    const st = (r.steps || []).find(x => x.id === t.dataset.rstep); if (st) { st.title = t.value; save(); }
    return;
  }
  if (t.dataset.pbind && state.modal && state.modal.type === 'project') {
    const p = P.get(state.modal.arg); if (!p) return;
    p[t.dataset.pbind] = t.value; p.updatedAt = Date.now();
    save();
    return;
  }
  if (t.id === 'add-task') {
    const pv = $('#add-preview'); if (!pv) return;
    pv.innerHTML = D.settings.smartAdd !== false && t.value.trim() ? window.Tasks.previewHtml(window.Tasks.parse(t.value)) : '';
    return;
  }
  if (t.dataset.set) {
    let v = t.value;
    if (t.dataset.type === 'num') { v = parseInt(v, 10); if (isNaN(v)) return; v = Math.max(+t.min || 0, Math.min(+t.max || 9999, v)); }
    if (t.dataset.type === 'float') { v = parseFloat(v); if (isNaN(v)) return; }
    D.settings[t.dataset.set] = v;
    save();
    if (t.dataset.set === 'volume' || t.dataset.set === 'ambientVolume') { Sound.applyVolumes(); return; }
    if (t.dataset.set === 'dayStart' || t.dataset.set === 'dayEnd') return;
    if (t.dataset.set === 'name' && state.view === 'today') return;
    updateLive();
    return;
  }
  if (t.dataset.daynote) {
    const k = today(); D.dayLog[k] = { ...(D.dayLog[k] || {}), note: t.value }; save(); return;
  }
  if (t.id === 'snip-q') { state.snipQuery = t.value; readSnipForm(); refresh(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'add-project') state.addProject = t.value;
  if (t.id === 'r-freq') { state.recForm.freq = t.value; keepRecTitle(); }
  if (t.id === 'r-dom') state.recForm.dom = +t.value || 1;
  if (t.dataset.pbind === 'due' || t.dataset.pbind === 'name') refresh();
  if (t.dataset.set === 'volume') Sound.play('tick');
  if (t.dataset.set === 'waterGoal' || t.dataset.set === 'dayStart' || t.dataset.set === 'dayEnd') refresh();
  if (t.dataset.set === 'hotkey') api.hotkeyOk().then(ok => toast(ok ? 'Shortcut updated' : 'That shortcut is taken or invalid', { ic: 'sliders' }));
});

document.addEventListener('contextmenu', (e) => {
  const card = e.target.closest && !e.target.closest('input, textarea, [contenteditable="true"], .amb') && e.target.closest('.side-col > .card[data-k]');
  if (card) {
    const id = Object.keys(WIDGETS).find(k => WIDGETS[k].k === card.dataset.k);
    if (id) { e.preventDefault(); widgetMenu(id, e.clientX, e.clientY); return; }
  }
  const b = e.target.closest && e.target.closest('.amb[data-v]');
  if (!b) return;
  e.preventDefault();
  soundMenu(b.dataset.v, e.clientX, e.clientY);
});

// ================================================================== DAY / WRAP WATCHERS
function maybeMorning() {
  if (D.meta.lastBriefDate === today()) return;
  D.meta.lastBriefDate = today(); save();
  const anything = T.overdue().length || T.today().length || W.dueList().length || P.stale().length || D.tasks.length;
  if (anything) setTimeout(() => { if (!state.modal && !state.breakOpen) openModal('brief'); }, 650);
}
function checkDay() {
  if (state.day !== today()) {
    state.day = today();
    ensureRecurring();
    refresh();
    maybeMorning();
  }
  if (pastWrapTime() && !(D.dayLog[today()] || {}).wrapped && D.meta.wrapPrompted !== today() && !state.breakOpen) {
    const open = T.today().length;
    if (open || T.doneOn(today()).length) {
      D.meta.wrapPrompted = today(); save();
      api.notify('Time to wrap up', open ? `${plural(open, 'task')} still open. Move them to tomorrow?` : 'Close out the day and leave a note for tomorrow.');
      if (!state.modal) openModal('wrap');
      refresh();
    }
  }
}

// ================================================================== REMINDERS & WELLBEING NUDGES
function checkReminders() {
  const now = Date.now();
  let changed = false;
  D.tasks.forEach(t => {
    if (t.done || !t.date || !t.time || t.remind == null) return;
    const [y, m, d] = t.date.split('-').map(Number);
    const [hh, mm] = t.time.split(':').map(Number);
    const at = new Date(y, m - 1, d, hh, mm).getTime() - t.remind * 60000;
    const key = `${t.date} ${t.time} ${t.remind}`;
    if (t.remindedKey === key || now < at || now - at > 30 * 60000) return;
    t.remindedKey = key; changed = true;
    const when = t.remind ? `in ${t.remind} min (${window.Tasks.fmtTime(t.time)})` : `now (${window.Tasks.fmtTime(t.time)})`;
    api.notify(`⏰ ${t.title}`, `Starting ${when}`);
    window.Sound && Sound.play('chime');
    toast(`${t.title}: ${when}`, { ic: 'bell', timeout: 12000, action: { label: 'Focus', fn: () => startFocus(t.id, Math.max(15, t.duration || D.settings.focusMinutes)) } });
  });
  if (changed) save();
}
const POSTURE_TIPS = [
  'Sit back, shoulders down and relaxed, feet flat on the floor.',
  'Is the top of your screen at eye level? Chin slightly tucked.',
  'Unclench your jaw, drop your shoulders, take a slow breath.',
  'Elbows at about 90°, wrists straight, not resting on the edge of the desk.',
  'Roll your shoulders back a few times and sit tall.'
];
function inWorkHours() {
  const h = new Date().getHours();
  return h >= (+D.settings.dayStart || 7) && h < (+D.settings.dayEnd || 19);
}
function checkNudges() {
  const now = Date.now();
  const s = state.brk.status;
  if (!inWorkHours() || (s && s.away) || state.breakOpen) { state.lastWater = Math.max(state.lastWater, now - (D.settings.waterEvery * 60000) / 2); state.lastPosture = Math.max(state.lastPosture, now - (D.settings.postureEvery * 60000) / 2); return; }
  if (shieldOn()) return; // wait until the focus session ends
  const visible = document.hasFocus();
  if (D.settings.waterOn !== false && now - state.lastWater >= D.settings.waterEvery * 60000) {
    state.lastWater = now;
    const n = (D.meta.water || {})[today()] || 0, goal = D.settings.waterGoal || 8;
    window.Sound && Sound.play('water');
    toast(n >= goal ? 'Water check: you hit your goal, keep sipping.' : `Time for some water (${n}/${goal} so far).`, { ic: 'drop', timeout: 15000, action: { label: 'Had a drink', fn: () => ACTIONS['water-plus']() } });
    if (!visible) api.notify('Time for some water', `${n} of ${goal} glasses so far today.`);
    return;
  }
  if (D.settings.postureOn !== false && now - state.lastPosture >= D.settings.postureEvery * 60000) {
    state.lastPosture = now;
    const tip = POSTURE_TIPS[Math.floor(Math.random() * POSTURE_TIPS.length)];
    window.Sound && Sound.play('pop');
    toast(`Posture check: ${tip}`, { ic: 'stretch', timeout: 12000, action: { label: 'Done', fn: () => {} } });
    if (!visible) api.notify('Posture check', tip);
  }
}

// ================================================================== CAPTURE WINDOW
function bootCapture() {
  document.body.classList.add('capture');
  const modes = ['today', 'tomorrow', 'note'];
  const labels = { today: 'Task · Today', tomorrow: 'Task · Tomorrow', note: 'Sticky note' };
  let when = 'today';
  const root = document.createElement('div');
  root.className = 'capture-card';
  const paint = () => {
    root.innerHTML = `<div class="capture-row"><img class="brand-logo sm" src="logo.png" alt=""><input id="cap" class="${when === 'note' ? 'hand' : ''}" placeholder="${when === 'note' ? 'Jot a quick note…' : 'Add a task…'}" maxlength="500" autocomplete="off"></div>
      <div class="capture-foot"><div class="seg">${modes.map(m => `<button data-w="${m}" class="${when === m ? 'on' : ''}">${labels[m]}</button>`).join('')}</div>
      <span class="hint">Enter to add · Tab to switch · Esc to close</span></div>`;
  };
  paint();
  document.body.appendChild(root);
  const focus = () => setTimeout(() => $('#cap').focus(), 30);
  focus();
  const swap = (m) => {
    when = m;
    const inp = $('#cap');
    inp.classList.toggle('hand', m === 'note');
    inp.placeholder = m === 'note' ? 'Jot a quick note…' : 'Add a task…';
    $$('[data-w]', root).forEach(b => b.classList.toggle('on', b.dataset.w === m));
    inp.focus();
  };
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) swap(b.dataset.w); });
  document.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') api.closeCapture();
    if (e.key === 'Tab') { e.preventDefault(); swap(modes[(modes.indexOf(when) + (e.shiftKey ? 2 : 1)) % 3]); }
    if (e.key === 'Enter') {
      const v = $('#cap').value.trim(); if (!v) return;
      if (when === 'note') {
        await api.addSticky({ id: uid(), text: v, color: 'yellow', attach: 'pin', rot: +(Math.random() * 6 - 3).toFixed(1), createdAt: Date.now() });
        root.innerHTML = `<div class="capture-done">${icon('check')} Stuck in your Inbox notebook</div>`;
      } else {
        await api.addTask(newTask(v, { date: when === 'tomorrow' ? tomorrow() : today() }));
        root.innerHTML = `<div class="capture-done">${icon('check')} Added to ${when}</div>`;
      }
      setTimeout(() => api.closeCapture(), 650);
    }
  });
}

// ================================================================== SHARED API FOR notes.js
window.H = {
  get D() { return D; }, state, api, save, flush, refresh, toast, undoable, snapshot, restore,
  esc, icon, uid, dayKey, today, tomorrow, parseKey, addDays, fmtLong, fmtShort, relDay, relLow, plural, daysSince,
  newTask, T, P, touchProject, addTask, toggleTask, openModal, closeModal, closeModalInstant: () => closeModalInstant(), go, animateOut,
  updateSidebar, REDUCED, EASE, IS_CAPTURE,
  ruleMatches, describeRule, taskRow, flipRender, refreshQuiet, startFocus, renderView,
  setNav: (v) => { if (!!D.settings.navCollapsed !== !!v) toggleNav(); },
  renderModalBody: () => renderModal(false)
};

// ================================================================== BOOT
async function boot() {
  if (IS_CAPTURE) { bootCapture(); return; }
  D = normalise(await api.getData());
  try { state.appInfo = (api.appInfo && await api.appInfo()) || {}; } catch (e) { state.appInfo = {}; }
  applyTheme();
  ensureRecurring();
  buildSidebar();
  state.view = 'today';
  renderView(true);
  updateSidebar();
  requestAnimationFrame(() => updateSidebar());

  api.getBreak().then(setBreakStatus);
  api.onBreakStatus((s) => {
    const prev = state.brk.status;
    if (s.reason === 'away' && prev && prev.activeSeconds > 120) countBreak();
    setBreakStatus(s);
    if (!s.due && state.breakOpen && s.reason === 'back') closeBreak();
  });
  if (api.onStreamState) api.onStreamState(() => setTimeout(() => { if (state.view === 'today') refreshQuiet(); }, 50));
  api.onBreakDue((s) => {
    setBreakStatus(s);
    if (shieldOn()) {
      if (!state.pendingBreak) toast('Your break is waiting until this focus session ends', { ic: 'shield', timeout: 6000 });
      state.pendingBreak = true;
      return;
    }
    openBreak();
  });
  api.onDataChanged(async () => {
    D = normalise(await api.getData());
    refresh();
    toast('Added from quick capture', { ic: 'plus' });
    window.Notes.external && window.Notes.external();
  });

  setInterval(updateLive, 1000);
  setInterval(checkDay, 20000);
  state.lastWater = Date.now(); state.lastPosture = Date.now();
  setInterval(() => { checkReminders(); checkNudges(); }, 15000);
  setTimeout(checkReminders, 3000);
  if (D.meta.focus && D.meta.focus.running) { if (api.setFocusShield) api.setFocusShield(shieldOn()); if (D.settings.dnd && api.setDnd) api.setDnd(true); }
  window.addEventListener('focus', checkDay);
  window.addEventListener('resize', () => updateSidebar());
  window.addEventListener('beforeunload', () => flush());
  maybeMorning();
  setTimeout(checkDay, 1500);
}
boot();
})();
