/* Hearth — Calendar: month / week / day views with time blocking */
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
const HOUR = 56; // px per hour on the timeline
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const cal = { view: 'month', anchor: null, selected: null, newSlot: null };
let nowTimer = null;

const fmtTime = (t) => window.Tasks.fmtTime(t);
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const range = () => { const s = D().settings; let a = +s.dayStart || 7, b = +s.dayEnd || 19; if (b <= a) b = a + 10; return [Math.max(0, a), Math.min(24, b)]; };

function tasksOn(k) {
  return D().tasks.filter(t => t.date === k).sort((a, b) => (a.done - b.done) || ((a.time || '99') .localeCompare(b.time || '99')) || ((a.order ?? a.createdAt) - (b.order ?? b.createdAt)));
}
function recurringOn(k) {
  if (k <= H().today()) return [];
  return D().recurring.filter(r => r.active !== false && H().ruleMatches(r, k) && !D().tasks.some(t => t.recurringId === r.id && t.date === k));
}
function projectsDue(k) { return D().projects.filter(p => p.due === k && p.status !== 'done'); }
function journalOn(k) { const nb = D().notebooks.find(n => n.kind === 'journal'); return nb && D().pages.find(p => p.notebookId === nb.id && p.date === k); }
function colorOf(t) { const p = t.projectId && H().P.get(t.projectId); return p ? p.color : 'var(--accent)'; }
function mondayOf(k) { const d = H().parseKey(k); const dow = (d.getDay() + 6) % 7; return H().addDays(k, -dow); }

// ================================================================== VIEW
function view() {
  if (!cal.anchor) { cal.anchor = H().today(); cal.selected = H().today(); }
  const st = H().state.entering ? 'stagger' : '';
  return `<div class="cal ${st}">
    <div class="page-head cal-head">
      <div><h1 id="cal-title">${title()}</h1><div class="sub">Plan tasks onto dates, then drag them into time slots.</div></div>
      <div class="actions">
        <div class="week-nav"><button class="icon-btn" data-act="cal-prev" title="Previous">${icon('chevronL', 'sm')}</button>
          <button class="btn sm ghost" data-act="cal-today">Today</button>
          <button class="icon-btn" data-act="cal-next" title="Next">${icon('chevronR', 'sm')}</button></div>
        <div class="seg">${['month', 'week', 'day'].map(v => `<button data-act="cal-view" data-v="${v}" class="${cal.view === v ? 'on' : ''}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
      </div>
    </div>
    <div class="cal-body" id="cal-body">${body()}</div>
  </div>`;
}
function title() {
  const a = H().parseKey(cal.anchor);
  if (cal.view === 'month') return a.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  if (cal.view === 'week') {
    const m = mondayOf(cal.anchor), s = H().addDays(m, 6);
    const ms = H().parseKey(m), ss = H().parseKey(s);
    return ms.getMonth() === ss.getMonth()
      ? `${ms.getDate()}–${ss.getDate()} ${ss.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
      : `${H().fmtShort(m)} – ${H().fmtShort(s)} ${ss.getFullYear()}`;
  }
  return H().fmtLong(cal.anchor);
}
function body() {
  if (cal.view === 'month') return monthHtml();
  if (cal.view === 'week') return timelineHtml(Array.from({ length: 7 }, (_, i) => H().addDays(mondayOf(cal.anchor), i)));
  return dayHtml();
}

// ---------- month
function pill(t) {
  const prio = t.priority ? 'p' + t.priority : '';
  return `<div class="cal-pill ${prio} ${t.done ? 'done' : ''}" style="--c:${colorOf(t)}" ${t.done ? '' : `data-drag-task="${t.id}"`} data-id="${t.id}" data-act="task-open" data-k="cp-${t.id}" title="${esc(t.title)}">
    ${t.time ? `<span class="tm">${fmtTime(t.time)}</span>` : ''}<span class="tt">${esc(t.title)}</span></div>`;
}
function monthHtml() {
  const a = H().parseKey(cal.anchor);
  const first = H().dayKey(new Date(a.getFullYear(), a.getMonth(), 1));
  const start = mondayOf(first);
  const today = H().today();
  const cells = [];
  const daysIn = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate();
  const lead = H().parseKey(first).getDate() - H().parseKey(start).getDate();
  const total = Math.ceil(((first === start ? 0 : (H().parseKey(first) - H().parseKey(start)) / 86400000) + daysIn) / 7) * 7;
  void lead;
  for (let i = 0; i < total; i++) {
    const k = H().addDays(start, i);
    const d = H().parseKey(k);
    const ts = tasksOn(k), rec = recurringOn(k), due = projectsDue(k), jr = journalOn(k);
    const items = [
      ...due.map(p => `<div class="cal-pill due" style="--c:${p.color}" data-act="project-open" data-pid="${p.id}">${icon('flag', 'sm')}<span class="tt">${esc(p.name)} due</span></div>`),
      ...ts.map(pill),
      ...rec.map(r => `<div class="cal-pill ghost" title="Recurring: ${esc(r.title)}">${icon('repeat', 'sm')}<span class="tt">${esc(r.title)}</span></div>`)
    ];
    const max = 3;
    const shown = items.slice(0, max).join('');
    const more = items.length - max;
    const off = H().dayOff ? H().dayOff(k) : null;
    cells.push(`<div class="cal-cell ${off ? 'off-' + off.kind : ''} ${d.getMonth() !== a.getMonth() ? 'out' : ''} ${k === today ? 'today' : ''} ${k === cal.selected ? 'sel' : ''} ${k < today ? 'past' : ''} ${[0, 6].includes(d.getDay()) ? 'wkend' : ''}" data-drop-date="${k}" data-act="cal-select" data-date="${k}">
      <div class="cal-num"><span>${d.getDate()}</span>${jr ? `<i class="jr-dot" title="Journal page"></i>` : ''}${off ? `<em class="cal-off" title="${esc(off.title)}">${icon(off.kind === 'bank' ? 'flag' : 'sun', 'sm')}${esc(off.kind === 'bank' ? off.title : off.half ? '½ day leave' : 'Leave')}</em>` : ''}</div>
      <div class="cal-items">${shown}${more > 0 ? `<div class="cal-more">+${more} more</div>` : ''}</div>
    </div>`);
  }
  return `<div class="cal-month-wrap">
    <div class="cal-month">
      <div class="cal-wd">${WD.map(w => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid" id="cal-grid">${cells.join('')}</div>
    </div>
    ${dayPanel(cal.selected)}
  </div>`;
}
function dayPanel(k) {
  const ts = tasksOn(k), rec = recurringOn(k), due = projectsDue(k), jr = journalOn(k);
  const open = ts.filter(t => !t.done), done = ts.filter(t => t.done);
  return `<aside class="card cal-panel" data-k="cal-panel">
    <div class="cal-panel-head"><div><b>${H().parseKey(k).toLocaleDateString('en-GB', { weekday: 'long' })}</b><span>${H().parseKey(k).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}${k === H().today() ? ' · Today' : ''}</span></div>
      <button class="btn sm ghost" data-act="cal-dayview" data-date="${k}" title="Open day timeline">${icon('clock', 'sm')}Timeline</button></div>
    <div class="add-bar cal-add">${icon('plus', 'sm')}<input id="cal-add" placeholder="Add for ${esc(k === H().today() ? 'today' : H().fmtShort(k))}… e.g. Call Sam 2pm" autocomplete="off" maxlength="300" data-date="${k}"></div>
    <div class="add-preview" id="cal-add-preview"></div>
    ${(() => { const off = H().dayOff ? H().dayOff(k) : null; const wkend = [0, 6].includes(H().parseKey(k).getDay());
      if (off && off.kind === 'bank') return `<div class="off-line bank">${icon('flag', 'sm')}<span class="grow"><b>Bank holiday</b> · ${esc(off.title)}</span></div>`;
      if (off) return `<div class="off-line leave">${icon('sun', 'sm')}<span class="grow"><b>${off.half ? `Half day: ${off.half === 'am' ? 'morning' : 'afternoon'} off` : 'Annual leave'}</b>${off.leave.note ? ' · ' + esc(off.leave.note) : ''}</span><button class="link" data-act="leave-undo" data-date="${k}">Remove</button></div>`;
      return wkend ? '' : `<div class="off-line add"><span class="grow muted">${icon('sun', 'sm')} Off this day?</span><button class="link" data-act="leave-day" data-date="${k}">Annual leave</button><button class="link" data-act="leave-day" data-date="${k}" data-half="am">½ am</button><button class="link" data-act="leave-day" data-date="${k}" data-half="pm">½ pm</button></div>`; })()}
    ${due.map(p => `<div class="mini-item due-line" data-act="project-open" data-pid="${p.id}"><span class="chip" style="color:${p.color}">${icon('flag')}</span><span class="grow"><b>${esc(p.name)}</b> is due</span></div>`).join('')}
    <div class="list" data-drop-list="${k}">${open.map(t => H().taskRow(t, { ctx: 'cal' })).join('')}</div>
    ${!open.length && !due.length ? `<div class="muted cal-empty">${k < H().today() ? 'Nothing was planned.' : 'Nothing planned yet. Add something, or drag a task onto any day.'}</div>` : ''}
    ${rec.length ? `<div class="cal-sub">${icon('repeat', 'sm')} Recurring</div>${rec.map(r => `<div class="mini-item rec-line"><span class="grow">${esc(r.title)}</span><span class="muted">${esc(H().describeRule(r))}</span></div>`).join('')}` : ''}
    ${done.length ? `<div class="cal-sub">${icon('check', 'sm')} Done</div><div class="list">${done.map(t => H().taskRow(t, { ctx: 'cal' })).join('')}</div>` : ''}
    ${jr ? `<button class="btn sm" style="margin-top:12px" data-act="open-note" data-nb="${jr.notebookId}" data-pg="${jr.id}">${icon('book', 'sm')}Journal page</button>` : ''}
  </aside>`;
}

// ---------- week / day timeline
function layoutDay(ts) {
  // assign overlapping timed tasks to side-by-side lanes
  const ev = ts.map(t => ({ t, s: toMin(t.time), e: toMin(t.time) + (t.duration || 30) })).sort((a, b) => a.s - b.s || b.e - a.e);
  const clusters = [];
  let cur = null;
  ev.forEach(x => {
    if (!cur || x.s >= cur.end) { cur = { items: [], end: x.e }; clusters.push(cur); }
    cur.items.push(x); cur.end = Math.max(cur.end, x.e);
  });
  clusters.forEach(c => {
    const lanes = [];
    c.items.forEach(x => {
      let i = lanes.findIndex(end => end <= x.s);
      if (i < 0) { i = lanes.length; lanes.push(0); }
      lanes[i] = x.e; x.lane = i;
    });
    c.items.forEach(x => { x.lanes = lanes.length; });
  });
  return ev;
}
function block(x, start) {
  const t = x.t;
  const top = (x.s - start * 60) / 60 * HOUR;
  const h = Math.max(22, (x.e - x.s) / 60 * HOUR - 3);
  const w = 100 / x.lanes;
  return `<div class="tl-block ${t.priority ? 'p' + t.priority : ''} ${t.done ? 'done' : ''} ${h < 40 ? 'short' : ''}" style="top:${top}px;height:${h}px;left:calc(${w * x.lane}% + 3px);width:calc(${w}% - 6px);--c:${colorOf(t)}"
    ${t.done ? '' : `data-drag-task="${t.id}"`} data-id="${t.id}" data-act="task-open" data-k="cb-${t.id}">
    <b>${esc(t.title)}</b><span>${fmtTime(t.time)} – ${fmtTime(toTime(Math.min(24 * 60 - 1, x.e)))}</span>
    ${t.done ? '' : '<i class="rz" data-resize title="Drag to change length"></i>'}</div>`;
}
function timelineHtml(days, wide = false) {
  const [a, b] = range();
  const today = H().today();
  const hours = Array.from({ length: b - a }, (_, i) => a + i);
  const head = days.map(k => {
    const d = H().parseKey(k);
    return `<button class="tl-dh ${k === today ? 'today' : ''}" data-act="cal-dayview" data-date="${k}"><span>${WD[(d.getDay() + 6) % 7]}</span><b>${d.getDate()}</b></button>`;
  }).join('');
  const allday = days.map(k => {
    const ts = tasksOn(k).filter(t => !t.time && !t.done);
    const due = projectsDue(k);
    return `<div class="tl-allday" data-drop-date="${k}" data-all-day>${due.map(p => `<div class="cal-pill due" style="--c:${p.color}" data-act="project-open" data-pid="${p.id}">${icon('flag', 'sm')}<span class="tt">${esc(p.name)}</span></div>`).join('')}${ts.map(pill).join('')}</div>`;
  }).join('');
  const cols = days.map(k => {
    const ts = tasksOn(k).filter(t => t.time);
    const ev = layoutDay(ts);
    const isToday = k === today;
    return `<div class="tl-col ${isToday ? 'today' : ''} ${k < today ? 'past' : ''}" data-drop-slot data-date="${k}">
      ${ev.map(x => block(x, a)).join('')}
      ${isToday ? `<div class="now-line" id="now-line"><i></i></div>` : ''}
    </div>`;
  }).join('');
  return `<div class="tl-wrap ${wide ? 'wide' : ''}" style="--cols:${days.length}">
    <div class="tl-head"><div class="tl-gutter"></div>${head}</div>
    <div class="tl-allrow"><div class="tl-gutter lbl">All day</div>${allday}</div>
    <div class="cal-scroll" id="cal-scroll">
      <div class="tl" style="height:${(b - a) * HOUR}px">
        <div class="tl-gutter hours">${hours.map(h => `<span style="top:${(h - a) * HOUR}px">${h === 12 ? 'noon' : (h % 12 || 12) + (h < 12 ? 'am' : 'pm')}</span>`).join('')}</div>
        ${cols}
      </div>
    </div>
  </div>`;
}
function dayHtml() {
  const k = cal.anchor;
  const untimed = tasksOn(k).filter(t => !t.time && !t.done);
  const overdue = k === H().today() ? H().T.overdue() : [];
  return `<div class="cal-day-wrap">
    <aside class="card cal-panel day-side" data-k="day-side">
      <div class="cal-panel-head"><div><b>Unscheduled</b><span>Drag onto the timeline to block out time</span></div></div>
      <div class="add-bar cal-add">${icon('plus', 'sm')}<input id="cal-add" placeholder="Add… e.g. Patch review 10am" autocomplete="off" maxlength="300" data-date="${k}"></div>
      <div class="add-preview" id="cal-add-preview"></div>
      <div class="list" data-drop-list="${k}">${untimed.map(t => H().taskRow(t, { ctx: 'cal' })).join('')}</div>
      ${!untimed.length ? '<div class="muted cal-empty">Everything for this day has a time.</div>' : ''}
      ${overdue.length ? `<div class="cal-sub">${icon('bell', 'sm')} Carried over</div><div class="list">${overdue.map(t => H().taskRow(t, { ctx: 'cal' })).join('')}</div>` : ''}
    </aside>
    ${timelineHtml([k], true)}
  </div>`;
}

// ================================================================== MOUNT / REFRESH
function mount() {
  scrollToNow();
  tickNow();
  clearInterval(nowTimer);
  nowTimer = setInterval(tickNow, 30000);
}
function light() {
  const el = $('#cal-body'); if (!el) return;
  const sc = $('#cal-scroll'); const keep = sc ? sc.scrollTop : null;
  H().flipRender(el, body());
  const sc2 = $('#cal-scroll'); if (sc2 && keep != null) sc2.scrollTop = keep;
  const t = $('#cal-title'); if (t) t.textContent = title();
  tickNow();
}
function leave() { clearInterval(nowTimer); }
function scrollToNow() {
  const sc = $('#cal-scroll'); if (!sc) return;
  const [a] = range();
  const now = new Date();
  const target = Math.max(0, ((now.getHours() - 1.5) - a) * HOUR);
  sc.scrollTop = target;
}
function tickNow() {
  const l = $('#now-line'); if (!l) return;
  const [a, b] = range();
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  if (m < a * 60 || m > b * 60) { l.style.display = 'none'; return; }
  l.style.display = ''; l.style.top = ((m - a * 60) / 60 * HOUR) + 'px';
}
function go(dir) {
  const el = $('#cal-body');
  if (cal.view === 'month') { const a = H().parseKey(cal.anchor); cal.anchor = H().dayKey(new Date(a.getFullYear(), a.getMonth() + dir, 1)); }
  else cal.anchor = H().addDays(cal.anchor, cal.view === 'week' ? 7 * dir : dir);
  if (cal.view !== 'month') cal.selected = cal.anchor;
  else if (H().parseKey(cal.selected).getMonth() !== H().parseKey(cal.anchor).getMonth()) cal.selected = cal.anchor;
  swap(el, dir);
}
function swap(el, dir) {
  const t = $('#cal-title'); if (t) t.textContent = title();
  if (!el) return;
  const keep = $('#cal-scroll') ? $('#cal-scroll').scrollTop : null;
  if (REDUCED || !dir) { el.innerHTML = body(); after(keep); return; }
  el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${-24 * dir}px)` }], { duration: 160, easing: 'ease-in' }).finished.then(() => {
    el.innerHTML = body(); after(keep);
    el.animate([{ opacity: 0, transform: `translateX(${24 * dir}px)` }, { opacity: 1, transform: 'none' }], { duration: 320, easing: H().EASE });
  });
  window.Sound && Sound.play('page', .5);
}
function after(keep) { if (keep != null && $('#cal-scroll')) $('#cal-scroll').scrollTop = keep; else scrollToNow(); tickNow(); }

// ================================================================== ACTIONS
const actions = {
  'cal-view': (el) => { cal.view = el.dataset.v; if (cal.view !== 'month') cal.anchor = cal.selected || cal.anchor; $$('[data-act="cal-view"]').forEach(b => b.classList.toggle('on', b.dataset.v === cal.view)); swap($('#cal-body'), 0); scrollToNow(); },
  'cal-prev': () => go(-1),
  'cal-next': () => go(1),
  'cal-today': () => { cal.anchor = H().today(); cal.selected = H().today(); swap($('#cal-body'), 0); scrollToNow(); },
  'cal-select': (el) => {
    const k = el.dataset.date;
    if (cal.selected === k) return;
    cal.selected = k;
    $$('.cal-cell.sel').forEach(c => c.classList.remove('sel'));
    el.classList.add('sel');
    const panel = $('.cal-panel');
    if (panel) {
      const tmp = document.createElement('div'); tmp.innerHTML = dayPanel(k);
      const fresh = tmp.firstElementChild; panel.replaceWith(fresh);
      if (!REDUCED) fresh.animate([{ opacity: .4, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: H().EASE });
    }
  },
  'cal-dayview': (el) => { cal.view = 'day'; cal.anchor = el.dataset.date; cal.selected = el.dataset.date; $$('[data-act="cal-view"]').forEach(b => b.classList.toggle('on', b.dataset.v === 'day')); swap($('#cal-body'), 0); scrollToNow(); }
};

// quick-add on the calendar
document.addEventListener('input', (e) => {
  if (e.target.id !== 'cal-add') return;
  const pv = $('#cal-add-preview'); if (!pv) return;
  const p = D().settings.smartAdd !== false ? window.Tasks.parse(e.target.value) : null;
  pv.innerHTML = p ? window.Tasks.previewHtml(p) : '';
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'cal-add' && e.key === 'Enter') {
    const v = e.target.value.trim(); if (!v) return;
    const p = D().settings.smartAdd !== false ? window.Tasks.parse(v) : { title: v, tags: [], priority: 0 };
    const t = H().newTask(p.title, { date: p.date || e.target.dataset.date, projectId: p.projectId || null });
    Object.assign(t, { time: p.time || null, priority: p.priority || 0, tags: p.tags || [] });
    if (t.time && D().settings.remindAtTime) t.remind = 0;
    D().tasks.push(t);
    if (t.date !== e.target.dataset.date) { cal.selected = t.date; if (cal.view === 'month') cal.anchor = t.date; }
    H().save(); H().refresh();
    const i = $('#cal-add'); if (i) { i.value = ''; i.focus(); }
    const pv = $('#cal-add-preview'); if (pv) pv.innerHTML = '';
    H().toast(`Added to ${H().relLow(t.date)}${t.time ? ' at ' + fmtTime(t.time) : ''}`, { ic: 'calendar' });
  }
});

// click an empty slot → inline new task at that time
document.addEventListener('click', (e) => {
  const col = e.target.closest('.tl-col');
  if (!col || e.target.closest('.tl-block, .tl-new')) return;
  const info = slotAt(col, e.clientY); if (!info) return;
  $$('.tl-new').forEach(x => x.remove());
  const [a] = range();
  const box = document.createElement('div');
  box.className = 'tl-new';
  box.style.top = ((toMin(info.time) - a * 60) / 60 * HOUR) + 'px';
  box.innerHTML = `<span>${fmtTime(info.time)}</span><input placeholder="New task… (Enter)" maxlength="300">`;
  col.appendChild(box);
  const inp = box.querySelector('input'); inp.focus();
  if (!REDUCED) box.animate([{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: H().EASE });
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { box.remove(); return; }
    if (ev.key !== 'Enter' || !inp.value.trim()) return;
    const p = D().settings.smartAdd !== false ? window.Tasks.parse(inp.value) : { title: inp.value.trim(), tags: [] };
    const t = H().newTask(p.title, { date: info.date, projectId: p.projectId || null });
    Object.assign(t, { time: p.time || info.time, duration: 30, priority: p.priority || 0, tags: p.tags || [] });
    if (D().settings.remindAtTime) t.remind = 0;
    D().tasks.push(t); H().save(); H().refresh();
    window.Sound && Sound.play('tap');
  });
  inp.addEventListener('blur', () => setTimeout(() => box.remove(), 150));
});

// resize a block to change its length
let rz = null;
document.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('[data-resize]'); if (!h) return;
  const blk = h.closest('.tl-block'); const t = H().T.get(blk.dataset.id); if (!t) return;
  e.preventDefault(); e.stopPropagation();
  rz = { blk, t, sy: e.clientY, h0: blk.offsetHeight, d0: t.duration || 30, pid: e.pointerId };
  blk.classList.add('resizing');
  document.body.classList.add('resizing-block');
}, true);
document.addEventListener('pointermove', (e) => {
  if (!rz || e.pointerId !== rz.pid) return;
  const dm = Math.round(((e.clientY - rz.sy) / HOUR * 60) / 15) * 15;
  const d = Math.max(15, Math.min(8 * 60, rz.d0 + dm));
  rz.d = d;
  rz.blk.style.height = Math.max(22, d / 60 * HOUR - 3) + 'px';
  const sp = rz.blk.querySelector('span'); if (sp) sp.textContent = `${fmtTime(rz.t.time)} – ${fmtTime(toTime(toMin(rz.t.time) + d))}`;
});
document.addEventListener('pointerup', (e) => {
  if (!rz || e.pointerId !== rz.pid) return;
  const r = rz; rz = null;
  document.body.classList.remove('resizing-block');
  r.blk.classList.remove('resizing');
  if (r.d && r.d !== r.d0) { r.t.duration = r.d; H().save(); H().refresh(); window.Sound && Sound.play('tap'); }
  setTimeout(() => {}, 0);
}, true);
// a resize must not also open the task
document.addEventListener('click', (e) => { if (e.target.closest('[data-resize]')) { e.stopPropagation(); e.preventDefault(); } }, true);

function slotAt(col, clientY) {
  const r = col.getBoundingClientRect();
  const [a, b] = range();
  let m = a * 60 + (clientY - r.top) / HOUR * 60;
  m = Math.round(m / 15) * 15;
  m = Math.max(a * 60, Math.min(b * 60 - 15, m));
  return { date: col.dataset.date, time: toTime(m), y: r.top + (m - a * 60) / 60 * HOUR };
}

window.Cal = { view, mount, light, leave, actions, slotAt, fmtTime, open: (k) => { cal.anchor = k; cal.selected = k; } };
})();
