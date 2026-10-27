/* Hearth — task extras: smart quick-add parsing, the task detail drawer, and drag & drop */
(() => {
'use strict';

const H = () => window.H;
const D = () => window.H.D;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const icon = (n, c) => window.icon(n, c);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const PRIO = { 1: { label: 'P1', name: 'Urgent', cls: 'p1' }, 2: { label: 'P2', name: 'High', cls: 'p2' }, 3: { label: 'P3', name: 'Normal', cls: 'p3' } };

// ================================================================== SMART QUICK-ADD
const WD = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MON = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const WD_RE = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|weds|thurs|thur|sun|mon|tue|wed|thu|fri|sat';
const WD_SAFE = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday|tues|weds|thurs|thur|mon|tue|wed|thu|fri'; // bare "sat"/"sun" are too easily ordinary words
const MON_RE = 'january|february|march|april|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const PREP = '(?:(?:on|by|for|due|before)\\s+)?';

function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function plusDays(base, n) { const d = new Date(base.getFullYear(), base.getMonth(), base.getDate()); d.setDate(d.getDate() + n); return d; }

/** Parse "Chase Dell fri 2pm #vendors !1 @win11" → { title, date, time, priority, tags, projectId } */
function parse(input, now = new Date()) {
  const out = { title: '', date: undefined, time: null, priority: 0, tags: [], projectId: null, found: false };
  let s = ' ' + String(input || '') + ' ';
  const take = (re, fn) => { s = s.replace(re, (...m) => { const r = fn(...m); if (r === false) return m[0]; out.found = true; return ' '; }); };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // tags, priority, project
  take(/(\s)#([\p{L}\d][\p{L}\d_-]*)/giu, (m, sp, tag) => { const t = tag.toLowerCase(); if (!out.tags.includes(t)) out.tags.push(t); });
  take(/(\s)(?:!|p)([123])(?=\s)/gi, (m, sp, n) => { out.priority = +n; });
  take(/(\s)@([\p{L}\d][\p{L}\d_-]*)/giu, (m, sp, word) => {
    const w = word.toLowerCase().replace(/[-_]/g, '');
    const projects = (H() && D().projects || []).filter(p => p.status !== 'done');
    const p = projects.find(x => x.name.toLowerCase().replace(/[^\p{L}\d]/gu, '').startsWith(w));
    if (!p) return false;
    out.projectId = p.id;
  });

  // times
  const setTime = (h, m) => { if (h > 23 || m > 59) return false; out.time = `${pad(h)}:${pad(m)}`; };
  take(/\s(?:at\s+|@\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)(?=\s)/gi, (m, h, mi, ap) => {
    h = +h; mi = +(mi || 0);
    if (h < 1 || h > 12) return false;
    if (ap.toLowerCase() === 'pm' && h !== 12) h += 12;
    if (ap.toLowerCase() === 'am' && h === 12) h = 0;
    return setTime(h, mi);
  });
  if (!out.time) take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)(?=\s)/gi, (m, h, mi) => setTime(+h, +mi));
  if (!out.time) take(/\s(?:at\s+)?(noon|midday)(?=\s)/gi, () => setTime(12, 0));
  if (!out.time) take(/\sat\s+(\d{1,2})(?=\s)/gi, (m, h) => { h = +h; if (h > 23) return false; if (h >= 1 && h <= 7) h += 12; return setTime(h, 0); });

  // dates
  const setDate = (d) => { if (out.date !== undefined) return false; out.date = keyOf(d); };
  take(new RegExp(`\\s${PREP}(today|tod)(?=\\s)`, 'gi'), () => setDate(today));
  take(new RegExp(`\\s${PREP}(tonight)(?=\\s)`, 'gi'), () => { if (!out.time) out.time = '19:00'; return setDate(today); });
  take(new RegExp(`\\s${PREP}(tomorrow|tmrw|tmr|tomoz)(?=\\s)`, 'gi'), () => setDate(plusDays(today, 1)));
  take(new RegExp(`\\s${PREP}next\\s+week(?=\\s)`, 'gi'), () => { const dow = (today.getDay() + 6) % 7; return setDate(plusDays(today, 7 - dow)); });
  take(new RegExp(`\\s${PREP}next\\s+(${WD_RE})(?=\\s)`, 'gi'), (m, w) => {
    const target = WD[w.toLowerCase()]; const dow = (today.getDay() + 6) % 7;
    const nextMon = plusDays(today, 7 - dow);
    return setDate(plusDays(nextMon, (target + 6) % 7));
  });
  take(new RegExp(`\\s${PREP}in\\s+(\\d{1,3})\\s+(day|days|week|weeks|wk|wks)(?=\\s)`, 'gi'), (m, n, unit) => setDate(plusDays(today, +n * (/^w/i.test(unit) ? 7 : 1))));
  take(new RegExp(`\\s${PREP}(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?(?=\\s)`, 'gi'), (m, d, mo, y) => {
    d = +d; mo = +mo - 1; if (mo < 0 || mo > 11 || d < 1 || d > 31) return false;
    let yr = y ? +y : today.getFullYear(); if (y && yr < 100) yr += 2000;
    let dt = new Date(yr, mo, d); if (dt.getMonth() !== mo) return false;
    if (!y && dt < plusDays(today, -1)) dt = new Date(yr + 1, mo, d);
    return setDate(dt);
  });
  const monthDay = (d, mon) => {
    d = +d; const mo = MON[mon.toLowerCase()]; if (mo == null || d < 1 || d > 31) return false;
    let dt = new Date(today.getFullYear(), mo, d); if (dt.getMonth() !== mo) return false;
    if (dt < plusDays(today, -1)) dt = new Date(today.getFullYear() + 1, mo, d);
    return setDate(dt);
  };
  take(new RegExp(`\\s${PREP}(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MON_RE})(?=\\s)`, 'gi'), (m, d, mon) => monthDay(d, mon));
  take(new RegExp(`\\s${PREP}(${MON_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?=\\s)`, 'gi'), (m, mon, d) => monthDay(d, mon));
  take(new RegExp(`\\s(?:(?:on|by|for|due|before|this)\\s+)(sat|sun)(?=\\s)`, 'gi'), (m, w) => {
    const target = WD[w.toLowerCase()];
    return setDate(plusDays(today, (target - today.getDay() + 7) % 7));
  });
  take(new RegExp(`\\s${PREP}(?:this\\s+)?(${WD_SAFE})(?=\\s)`, 'gi'), (m, w) => {
    const target = WD[w.toLowerCase()];
    return setDate(plusDays(today, (target - today.getDay() + 7) % 7));
  });

  out.title = s.replace(/\s+/g, ' ').trim().replace(/\s+(on|by|for|at|due)$/i, '');
  if (!out.title) { out.title = String(input || '').trim(); out.found = false; }
  return out;
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const h12 = h % 12 || 12;
  return `${h12}${m ? ':' + pad(m) : ''}${h < 12 ? 'am' : 'pm'}`;
}
function previewHtml(p) {
  if (!p || !p.found) return '';
  const parts = [];
  if (p.date) parts.push(`<span class="chip accent">${icon('calendar')}${esc(H().relDay(p.date))}${p.date > H().addDays(H().today(), 6) ? '' : ''}</span>`);
  if (p.time) parts.push(`<span class="chip accent">${icon('clock')}${fmtTime(p.time)}</span>`);
  if (p.priority) parts.push(`<span class="chip prio ${PRIO[p.priority].cls}">${icon('flag')}${PRIO[p.priority].label}</span>`);
  p.tags.forEach(t => parts.push(`<span class="chip tag">#${esc(t)}</span>`));
  if (p.projectId) { const pr = H().P.get(p.projectId); if (pr) parts.push(`<span class="chip" style="color:${pr.color}"><span class="dot"></span><span style="color:var(--text-2)">${esc(pr.name)}</span></span>`); }
  return `<span class="pv-title">${icon('sparkle', 'sm')}<b>${esc(p.title)}</b></span>${parts.join('')}`;
}

// ================================================================== TASK DRAWER
function subPct(t) { const s = t.subtasks || []; return s.length ? s.filter(x => x.done).length / s.length : 0; }

function drawerHtml(id) {
  const t = H().T.get(id); if (!t) return '';
  const projects = D().projects.filter(p => p.status !== 'done' || p.id === t.projectId);
  const subs = t.subtasks || [];
  const mins = D().focusLog.filter(l => l.taskId === t.id).reduce((s, l) => s + l.minutes, 0);
  const allTags = [...new Set(D().tasks.flatMap(x => x.tags || []))].filter(x => !(t.tags || []).includes(x)).slice(0, 8);
  const today = H().today();
  const quick = [['Today', today], ['Tomorrow', H().tomorrow()], ['Next week', (() => { const d = H().parseKey(today); const dow = (d.getDay() + 6) % 7; return H().addDays(today, 7 - dow); })()], ['No date', '']];
  return `<div class="scrim" data-act="modal-close"></div>
  <div class="drawer task-drawer" role="dialog" aria-label="Task">
    <div class="drawer-head">
      <button class="check big ${t.done ? 'on' : ''}" data-act="td-toggle" title="${t.done ? 'Mark not done' : 'Mark done'}"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
      <textarea class="title-input td-title" id="td-title" rows="1" data-tbind="title" maxlength="300">${esc(t.title)}</textarea>
      <button class="icon-btn" data-act="modal-close" title="Close (Esc)">${icon('x')}</button>
    </div>
    <div class="drawer-body" data-body>
      <div class="td-grid">
        <div class="field"><label>${icon('calendar', 'sm')} Date</label>
          <input class="input" type="date" id="td-date" value="${t.date || ''}" data-tbind="date">
          <div class="quick-dates">${quick.map(([l, v]) => `<button class="pill-btn ${t.date === v || (!t.date && !v) ? 'on' : ''}" data-act="td-date" data-v="${v}">${l}</button>`).join('')}</div></div>
        <div class="field"><label>${icon('clock', 'sm')} Time</label>
          <div class="row"><input class="input" type="time" id="td-time" value="${t.time || ''}" data-tbind="time" step="300">
          <select class="select" id="td-dur" data-tbind="duration" title="How long" ${t.time ? '' : 'disabled'}>${[15, 30, 45, 60, 90, 120, 180].map(m => `<option value="${m}" ${(t.duration || 30) === m ? 'selected' : ''}>${m < 60 ? m + ' min' : (m / 60) + ' hr' + (m > 60 ? 's' : '')}</option>`).join('')}</select></div>
          ${t.time ? `<button class="link" data-act="td-clear-time">Clear time</button>` : '<span class="hint">Add a time to block it on the calendar.</span>'}</div>
        <div class="field"><label>${icon('bell', 'sm')} Reminder</label>
          <select class="select" id="td-remind" data-tbind="remind" ${t.time && t.date ? '' : 'disabled'}>
            ${[['', 'No reminder'], ['0', 'At the time'], ['5', '5 min before'], ['15', '15 min before'], ['30', '30 min before'], ['60', '1 hour before']].map(([v, l]) => `<option value="${v}" ${String(t.remind ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          ${t.time && t.date ? '' : '<span class="hint">Needs a date and a time.</span>'}</div>
        <div class="field"><label>${icon('flag', 'sm')} Priority</label>
          <div class="seg prio-seg">${[0, 1, 2, 3].map(n => `<button data-act="td-prio" data-v="${n}" class="${(t.priority || 0) === n ? 'on' : ''} ${n ? PRIO[n].cls : ''}">${n ? PRIO[n].label : 'None'}</button>`).join('')}</div></div>
      </div>
      <div class="field"><label>${icon('folder', 'sm')} Project</label>
        <select class="select" id="td-project" data-tbind="projectId"><option value="">No project</option>${projects.map(p => `<option value="${p.id}" ${p.id === t.projectId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label>${icon('tag', 'sm')} Labels</label>
        <div class="tag-box">${(t.tags || []).map(g => `<span class="chip tag">#${esc(g)}<button data-act="td-untag" data-v="${esc(g)}" title="Remove">${icon('x', 'sm')}</button></span>`).join('')}
          <input id="td-tag" placeholder="${(t.tags || []).length ? 'Add…' : 'Type a label and press Enter'}" data-enter="td-tag" maxlength="30"></div>
        ${allTags.length ? `<div class="tag-suggest">${allTags.map(g => `<button class="chip tag ghosty" data-act="td-addtag" data-v="${esc(g)}">#${esc(g)}</button>`).join('')}</div>` : ''}</div>
      <div class="field"><label>${icon('check', 'sm')} Subtasks ${subs.length ? `<span class="sub-count">${subs.filter(s => s.done).length}/${subs.length}</span>` : ''}</label>
        ${subs.length ? `<div class="sub-progress"><i style="width:${Math.round(subPct(t) * 100)}%"></i></div>` : ''}
        <div class="subtasks">${subs.map(s => `<div class="subtask ${s.done ? 'done' : ''}" data-k="sub-${s.id}" data-sid="${s.id}">
          <button class="check sm ${s.done ? 'on' : ''}" data-act="sub-toggle"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>
          <input class="sub-input" id="sub-${s.id}" value="${esc(s.title)}" data-sub="${s.id}" maxlength="200">
          <button class="icon-btn mini danger" data-act="sub-del" title="Remove">${icon('x', 'sm')}</button></div>`).join('')}</div>
        <div class="add-bar sub-add">${icon('plus', 'sm')}<input id="td-sub" placeholder="Add a step and press Enter…" data-enter="sub-add" maxlength="200"></div></div>
      <div class="field"><label>${icon('note', 'sm')} Notes</label>
        <textarea class="textarea" id="td-notes" data-tbind="notes" rows="4" placeholder="Details, links, anything useful…">${esc(t.notes || '')}</textarea></div>
      <div class="row wrap td-foot">
        <span class="muted" style="font-size:12.5px">Added ${esc(H().fmtShort(H().dayKey(new Date(t.createdAt))))}${mins ? ` · ${mins} min focused` : ''}${t.carried ? ` · carried ${t.carried}×` : ''}</span>
        <span style="flex:1"></span>
        ${!t.done ? `<button class="btn sm sage" data-act="td-focus">${icon('play', 'sm')}Focus on this</button>` : ''}
        <button class="btn sm danger" data-act="td-delete">${icon('trash', 'sm')}Delete</button>
      </div>
    </div></div>`;
}

function curTask() { const m = H().state.modal; return m && m.type === 'task' ? H().T.get(m.arg) : null; }
function rerenderDrawer() { H().renderModalBody(); }
function autosize(el) { if (!el) return; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }

function addTag(t, raw) {
  const tag = String(raw || '').trim().replace(/^#/, '').toLowerCase().replace(/\s+/g, '-');
  if (!tag) return;
  t.tags = t.tags || [];
  if (!t.tags.includes(tag)) t.tags.push(tag);
}

const actions = {
  'task-open': (el, id) => { if (id) H().openModal('task', id); },
  'td-toggle': () => { const t = curTask(); if (!t) return; H().toggleTask(t.id); const b = $('.task-drawer .check.big'); if (b) { b.classList.toggle('on', !t.done ? false : true); b.classList.add('pop'); } },
  'td-date': (el) => { const t = curTask(); t.date = el.dataset.v || null; if (!t.date) { t.remind = null; } H().save(); H().refresh(); },
  'td-clear-time': () => { const t = curTask(); t.time = null; t.remind = null; H().save(); H().refresh(); },
  'td-prio': (el) => { const t = curTask(); t.priority = +el.dataset.v; H().save(); H().refresh(); if (+el.dataset.v) window.Sound && Sound.play('tap'); },
  'td-tag': () => { const t = curTask(); const i = $('#td-tag'); addTag(t, i.value); i.value = ''; H().save(); H().refresh(); setTimeout(() => $('#td-tag')?.focus(), 0); },
  'td-addtag': (el) => { const t = curTask(); addTag(t, el.dataset.v); H().save(); H().refresh(); },
  'td-untag': (el) => { const t = curTask(); t.tags = (t.tags || []).filter(x => x !== el.dataset.v); H().save(); H().refresh(); },
  'sub-add': () => {
    const t = curTask(); const i = $('#td-sub'); const v = i.value.trim(); if (!v) return;
    t.subtasks = t.subtasks || [];
    t.subtasks.push({ id: sid(), title: v, done: false });
    i.value = ''; H().save(); H().refresh(); setTimeout(() => $('#td-sub')?.focus(), 0);
  },
  'sub-toggle': (el) => {
    const t = curTask(); const s = (t.subtasks || []).find(x => x.id === el.closest('[data-sid]').dataset.sid); if (!s) return;
    s.done = !s.done; el.classList.toggle('on', s.done); el.classList.add('pop');
    if (s.done) window.Sound && Sound.play('tick');
    H().save();
    setTimeout(() => {
      H().refresh();
      if (s.done && t.subtasks.every(x => x.done) && !t.done) H().toast('All steps done. Tick off the task?', { ic: 'check', timeout: 7000, action: { label: 'Mark done', fn: () => H().toggleTask(t.id) } });
    }, 280);
  },
  'sub-del': (el) => { const t = curTask(); const id = el.closest('[data-sid]').dataset.sid; t.subtasks = t.subtasks.filter(x => x.id !== id); H().save(); H().refresh(); },
  'td-focus': () => { const t = curTask(); H().closeModal(); H().startFocus(t.id, D().settings.focusMinutes); },
  'td-delete': () => { const t = curTask(); const snap = H().snapshot(); H().closeModal(); D().tasks = D().tasks.filter(x => x.id !== t.id); H().save(); H().refresh(); H().undoable('Task deleted', snap, 'trash'); }
};

document.addEventListener('input', (e) => {
  const t = curTask(); if (!t) return;
  const el = e.target;
  if (el.dataset.tbind) {
    const k = el.dataset.tbind;
    let v = el.value;
    if (k === 'title') { autosize(el); if (!v.trim()) return; v = v.replace(/\n/g, ' '); }
    if (k === 'duration') v = +v;
    if (k === 'remind') v = v === '' ? null : +v;
    if (k === 'projectId' || k === 'date' || k === 'time') v = v || null;
    t[k] = v;
    if (k === 'time' && !v) t.remind = null;
    if (k === 'time' && v && t.remind == null && D().settings.remindAtTime) t.remind = 0;
    if (k === 'projectId' && v) H().touchProject(v);
    H().save();
    if (k !== 'title' && k !== 'notes') H().refresh(); else H().refreshQuiet();
    return;
  }
  if (el.dataset.sub) { const s = (t.subtasks || []).find(x => x.id === el.dataset.sub); if (s) { s.title = el.value; H().save(); H().refreshQuiet(); } }
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'td-title' && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  if (e.target.dataset && e.target.dataset.sub && e.key === 'Enter') { e.preventDefault(); $('#td-sub')?.focus(); }
  if (e.target.id === 'td-tag' && e.key === 'Backspace' && !e.target.value) { const t = curTask(); if (t && t.tags && t.tags.length) { t.tags.pop(); H().save(); H().refresh(); setTimeout(() => $('#td-tag')?.focus(), 0); } }
});

// ================================================================== DRAG & DROP
let drag = null, suppressClick = false;
const DRAG_THRESHOLD = 5;

document.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const src = e.target.closest('[data-drag-task]');
  if (!src) return;
  if (e.target.closest('button:not([data-grip]), input, select, textarea, a, [contenteditable="true"]')) return;
  drag = { id: src.dataset.dragTask, src, sx: e.clientX, sy: e.clientY, started: false, pid: e.pointerId };
});
document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_THRESHOLD) return;
    beginDrag(e);
  }
  moveDrag(e);
});
document.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.pid) return;
  const d = drag; drag = null;
  if (!d.started) return;
  suppressClick = true; setTimeout(() => { suppressClick = false; }, 60);
  endDrag(d, true);
});
document.addEventListener('pointercancel', () => { if (drag && drag.started) endDrag(drag, false); drag = null; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drag && drag.started) { const d = drag; drag = null; endDrag(d, false); } });
document.addEventListener('click', (e) => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);

function beginDrag(e) {
  const r = drag.src.getBoundingClientRect();
  drag.started = true;
  drag.ox = e.clientX - r.left; drag.oy = e.clientY - r.top;
  const ghost = drag.src.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.removeAttribute('data-k');
  ghost.style.width = r.width + 'px';
  ghost.style.height = r.height + 'px';
  document.body.appendChild(ghost);
  drag.ghost = ghost;
  drag.src.classList.add('drag-src');
  const line = document.createElement('div'); line.className = 'drop-line'; document.body.appendChild(line); drag.line = line;
  const tip = document.createElement('div'); tip.className = 'drop-tip'; document.body.appendChild(tip); drag.tip = tip;
  document.body.classList.add('dragging-task');
  getSelection().removeAllRanges();
  window.Sound && Sound.play('lift');
}
function clearHover() {
  $$('.drop-hover').forEach(x => x.classList.remove('drop-hover'));
  if (drag && drag.line) drag.line.style.opacity = 0;
  if (drag && drag.tip) drag.tip.style.opacity = 0;
}
function autoScroll(e) {
  const sc = e.target && document.elementFromPoint(e.clientX, e.clientY);
  const box = sc && (sc.closest('.cal-scroll') || sc.closest('.main'));
  if (!box) return;
  const r = box.getBoundingClientRect();
  if (e.clientY < r.top + 50) box.scrollTop -= 12; else if (e.clientY > r.bottom - 50) box.scrollTop += 12;
}
function moveDrag(e) {
  const g = drag.ghost;
  g.style.transform = `translate(${e.clientX - drag.ox}px, ${e.clientY - drag.oy}px) rotate(1.6deg)`;
  autoScroll(e);
  clearHover();
  drag.target = null;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  if (!under) return;
  const list = under.closest('[data-drop-list]');
  const proj = under.closest('[data-drop-project]');
  const day = under.closest('[data-drop-date]');
  const slot = under.closest('[data-drop-slot]');
  if (slot && window.Cal) {
    const info = Cal.slotAt(slot, e.clientY);
    if (info) {
      drag.target = { type: 'slot', date: info.date, time: info.time };
      slot.classList.add('drop-hover');
      const L = drag.line, rr = slot.getBoundingClientRect();
      L.style.left = rr.left + 'px'; L.style.width = rr.width + 'px'; L.style.top = info.y + 'px'; L.style.opacity = 1;
      showTip(e, `${Cal.fmtTime(info.time)} · ${H().relDay(info.date)}`);
    }
    return;
  }
  if (list) {
    const rows = $$(':scope > [data-drag-task]', list).filter(x => x !== drag.src);
    let before = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
    const lr = list.getBoundingClientRect();
    let y;
    if (before) y = before.getBoundingClientRect().top - 4;
    else if (rows.length) y = rows[rows.length - 1].getBoundingClientRect().bottom + 2;
    else y = lr.top + 4;
    const L = drag.line;
    L.style.left = lr.left + 'px'; L.style.width = lr.width + 'px'; L.style.top = y + 'px'; L.style.opacity = 1;
    list.classList.add('drop-hover');
    drag.target = { type: 'list', list: list.dataset.dropList, before: before ? before.dataset.dragTask : null, el: list };
    return;
  }
  if (proj) {
    proj.classList.add('drop-hover');
    drag.target = { type: 'project', id: proj.dataset.dropProject };
    const p = H().P.get(proj.dataset.dropProject);
    if (p) showTip(e, `Move to ${p.name}`);
    return;
  }
  if (day) {
    day.classList.add('drop-hover');
    drag.target = { type: 'date', date: day.dataset.dropDate, allDay: day.hasAttribute('data-all-day') };
    showTip(e, H().relDay(day.dataset.dropDate));
  }
}
function showTip(e, text) {
  const t = drag.tip; t.textContent = text; t.style.opacity = 1;
  t.style.left = (e.clientX + 16) + 'px'; t.style.top = (e.clientY + 18) + 'px';
}
function listDate(name) {
  const today = H().today();
  if (name === 'today') return today;
  if (name === 'tomorrow') return H().tomorrow();
  if (/^\d{4}-\d{2}-\d{2}$/.test(name)) return name;
  return null;
}
function endDrag(d, commit) {
  const ghost = d.ghost, src = d.src, target = d.target;
  document.body.classList.remove('dragging-task');
  clearHover();
  d.line && d.line.remove(); d.tip && d.tip.remove();
  const finish = () => { ghost.remove(); src.classList.remove('drag-src'); };
  const t = H().T.get(d.id);
  if (!commit || !target || !t) {
    if (!REDUCED) {
      const r = src.getBoundingClientRect();
      ghost.animate([{ transform: ghost.style.transform, opacity: 1 }, { transform: `translate(${r.left}px, ${r.top}px)`, opacity: .4 }], { duration: 260, easing: H().EASE }).finished.then(finish);
    } else finish();
    return;
  }
  const snap = H().snapshot();
  let msg = '';
  if (target.type === 'list') {
    const date = listDate(target.list);
    if (date && date !== t.date) {
      if (date > H().today() && (!t.date || t.date <= H().today())) t.carried = (t.carried || 0) + 1;
      t.date = date;
      msg = date === H().today() ? 'Moved to today' : date === H().tomorrow() ? 'Moved to tomorrow' : `Moved to ${H().relDay(date)}`;
    }
    // re-order the destination list
    const ids = $$(':scope > [data-drag-task]', target.el).map(x => x.dataset.dragTask).filter(x => x !== t.id);
    const at = target.before ? ids.indexOf(target.before) : ids.length;
    ids.splice(at < 0 ? ids.length : at, 0, t.id);
    ids.forEach((id, i) => { const x = H().T.get(id); if (x) x.order = i + 1; });
  } else if (target.type === 'project') {
    if (t.projectId !== target.id) { t.projectId = target.id; H().touchProject(target.id); const p = H().P.get(target.id); msg = `Moved to ${p ? p.name : 'project'}`; }
  } else if (target.type === 'date') {
    if (t.date !== target.date) { t.date = target.date; msg = `Moved to ${H().relDay(target.date)}`; }
    if (target.allDay && t.time) { t.time = null; t.remind = null; msg = msg || 'Time cleared'; }
  } else if (target.type === 'slot') {
    t.date = target.date; t.time = target.time; t.duration = t.duration || 30;
    if (t.remind == null && D().settings.remindAtTime) t.remind = 0;
    msg = `Scheduled ${H().relLow(target.date)} at ${fmtTime(target.time)}`;
  }
  ghost.animate([{ opacity: 1 }, { opacity: 0, transform: ghost.style.transform + ' scale(.96)' }], { duration: 180 }).finished.then(finish);
  if (t.projectId) H().touchProject(t.projectId);
  H().save();
  H().refresh();
  window.Sound && Sound.play('drop');
  if (msg) H().undoable(msg, snap, 'arrowRight');
}

// ------------------------------------------------------------------ public
window.Tasks = { parse, previewHtml, fmtTime, drawerHtml, actions, PRIO, subPct, autosize, isDragging: () => !!(drag && drag.started) };
})();
