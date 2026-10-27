/* Hearth — Notebooks
   Notebooks with pages that turn, pencil handwriting, sticky notes you can drag about,
   doodles, images and links, tasks from text, meeting actions, journal, search, ribbons, PDF export. */
(() => {
'use strict';

const H = () => window.H;
const D = () => window.H.D;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const icon = (n, c) => window.icon(n, c);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const nid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const NB_COLOURS = ['#BF6239', '#6B8A5A', '#C68A27', '#8A5A6B', '#5F8496', '#8C8445', '#A0714F'];
const STICKY_COLOURS = ['yellow', 'pink', 'sage', 'blue', 'peach'];
const PENS = { graphite: '#3A3A3D', red: '#B5523F', blue: '#3E6C8A' };
const PAPERS = [['lined', 'Lined'], ['squared', 'Squared'], ['dotted', 'Dotted'], ['plain', 'Plain']];
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

const ns = { nbId: null, pgId: null, expanded: {}, query: '', tool: 'type', pen: 'graphite', justToggled: null };
let editTimer = null, shelfTimer = null, resizeObs = null;

// ------------------------------------------------------------------ data helpers
const notebooks = () => {
  const rank = (n) => n.kind === 'journal' ? 0 : n.kind === 'inbox' ? 1 : 2;
  return D().notebooks.slice().sort((a, b) => rank(a) - rank(b) || (a.order ?? a.createdAt) - (b.order ?? b.createdAt));
};
const getNb = (id) => D().notebooks.find(n => n.id === id);
const getPg = (id) => D().pages.find(p => p.id === id);
function pagesOf(nbId) {
  const nb = getNb(nbId);
  const list = D().pages.filter(p => p.notebookId === nbId);
  if (nb && nb.kind === 'journal') return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.order - a.order);
  return list.sort((a, b) => a.order - b.order);
}
const curNb = () => getNb(ns.nbId);
const curPg = () => (ns.pgId ? getPg(ns.pgId) : null);
function persist() {
  D().meta.notes = { nbId: ns.nbId, pgId: ns.pgId, expanded: ns.expanded, tool: ns.tool, pen: ns.pen };
  H().save();
}
function touch(pg) {
  if (!pg) return;
  pg.updatedAt = Date.now();
  const nb = getNb(pg.notebookId);
  if (nb) { nb.updatedAt = Date.now(); if (nb.projectId) H().touchProject(nb.projectId); }
}
function pageLabel(pg, i) {
  if (pg.title && pg.title.trim()) return pg.title.trim();
  return `Page ${i + 1}`;
}
function hash(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h); }
function plainText(html) {
  const t = document.createElement('template');
  t.innerHTML = (html || '').replace(/<(\/(?:p|div|li|h[1-6])|br\s*\/?)>/gi, ' <$1>');
  $$('.photo-tools', t.content).forEach(x => x.remove());
  return (t.content.textContent || '').replace(/\s+/g, ' ').trim();
}

function createNotebook(opts = {}) {
  const now = Date.now();
  const used = D().notebooks.map(n => n.color);
  const nb = {
    id: nid('nb'), name: opts.name || 'New notebook',
    color: opts.color || NB_COLOURS.find(c => !used.includes(c)) || NB_COLOURS[D().notebooks.length % NB_COLOURS.length],
    paper: opts.paper || 'lined', kind: opts.kind || 'normal', projectId: opts.projectId || null,
    createdAt: now, updatedAt: now, order: now
  };
  D().notebooks.push(nb);
  if (opts.firstPage !== false) createPage(nb.id, 'blank');
  return nb;
}
const E = '<li><br></li>';
const TEMPLATES = [
  { id: 'blank', name: 'Blank page', ic: 'note', title: '', html: () => '' },
  { id: 'meeting', name: 'Meeting notes', ic: 'meeting', title: 'Meeting: ', html: (d) => `<p><b>Date:</b> ${d}</p><p><b>With:</b> </p><h3>Notes</h3><ul>${E}</ul><h3>Actions</h3><ul class="actions">${E}</ul>` },
  { id: 'oneone', name: '1:1', ic: 'hand', title: '1:1 with ', html: (d) => `<p><b>Date:</b> ${d}</p><h3>How are things?</h3><ul>${E}</ul><h3>Updates</h3><ul>${E}</ul><h3>Blockers</h3><ul>${E}</ul><h3>Actions</h3><ul class="actions">${E}</ul>` },
  { id: 'incident', name: 'Incident report', ic: 'bell', title: 'Incident: ', html: (d) => `<p><b>Date:</b> ${d}</p><p><b>Severity:</b> </p><p><b>Affected:</b> </p><h3>What happened</h3><p><br></p><h3>Timeline</h3><ul>${E}</ul><h3>Root cause</h3><p><br></p><h3>Fix</h3><p><br></p><h3>Follow-up actions</h3><ul class="actions">${E}</ul>` },
  { id: 'change', name: 'Change request', ic: 'repeat', title: 'Change: ', html: (d) => `<p><b>Raised:</b> ${d}</p><p><b>Planned for:</b> </p><p><b>Risk:</b> Low / Medium / High</p><h3>What's changing</h3><p><br></p><h3>Why</h3><p><br></p><h3>Rollback plan</h3><p><br></p><h3>Checks</h3><ul class="checks"><li>Approved</li><li>Users told</li><li>Backup taken</li><li>Tested on a pilot device</li></ul><h3>Actions</h3><ul class="actions">${E}</ul>` },
  { id: 'kickoff', name: 'Project kick-off', ic: 'flag', title: 'Kick-off: ', html: (d) => `<p><b>Date:</b> ${d}</p><h3>Goal</h3><p><br></p><h3>In scope / out of scope</h3><ul>${E}</ul><h3>People</h3><ul>${E}</ul><h3>Milestones</h3><ul class="checks">${E}</ul><h3>Risks</h3><ul>${E}</ul><h3>Actions</h3><ul class="actions">${E}</ul>` },
  { id: 'standup', name: 'Stand-up', ic: 'sun', title: 'Stand-up', html: (d) => `<p><b>${d}</b></p><h3>Yesterday</h3><ul>${E}</ul><h3>Today</h3><ul>${E}</ul><h3>Blockers</h3><ul>${E}</ul>` },
  { id: 'checklist', name: 'Checklist', ic: 'checklist', title: 'Checklist', html: () => `<ul class="checks">${E}</ul>` }
];
function createPage(nbId, template = 'blank', extra = {}) {
  const now = Date.now();
  const k = H().today();
  const pg = {
    id: nid('pg'), notebookId: nbId, title: '', html: '', stickies: [], strokes: [], bookmarked: false,
    createdAt: now, updatedAt: now, order: now, ...extra
  };
  const builtin = TEMPLATES.find(t => t.id === template);
  const custom = (D().noteTemplates || []).find(t => t.id === template);
  if (builtin && builtin.id !== 'blank') { pg.title = builtin.title; pg.html = builtin.html(esc(H().fmtLong(k))); pg.template = builtin.id; }
  else if (custom) { pg.title = custom.title || ''; pg.html = custom.html || ''; pg.template = custom.id; }
  D().pages.push(pg);
  return pg;
}

// ------------------------------------------------------------------ journal
function journalNotebook(create = true) {
  let nb = D().notebooks.find(n => n.kind === 'journal');
  if (!nb && create) nb = createNotebook({ name: 'Journal', color: '#6B8A5A', paper: 'lined', kind: 'journal', firstPage: false });
  return nb;
}
function journalPage(k, create = true) {
  const nb = journalNotebook(create); if (!nb) return null;
  let pg = D().pages.find(p => p.notebookId === nb.id && p.date === k);
  if (!pg && create) pg = createPage(nb.id, 'blank', { title: H().fmtLong(k), date: k });
  return pg;
}
function journalWrap(k, note, done) {
  const pg = journalPage(k);
  const items = (done || []).slice(0, 15).map(t => `<li>${esc(t.title)}</li>`).join('');
  const block = `<div data-wrap="1"><h3>Wrap-up</h3>${items ? `<p>Done today:</p><ul>${items}</ul>` : '<p>A quieter day.</p>'}${note && note.trim() ? `<p><b>Note for tomorrow:</b> ${esc(note.trim())}</p>` : ''}</div>`;
  const t = document.createElement('template');
  t.innerHTML = pg.html || '';
  const old = t.content.querySelector('[data-wrap]');
  if (old) old.remove();
  pg.html = t.innerHTML + block;
  touch(pg);
  if (ns.pgId === pg.id && $('#page-body')) $('#page-body').innerHTML = pg.html;
}

// ------------------------------------------------------------------ meeting actions → tasks
function processActions(pg) {
  if (!pg || !pg.html || !pg.html.includes('actions')) return 0;
  const nb = getNb(pg.notebookId);
  const t = document.createElement('template');
  t.innerHTML = pg.html;
  let n = 0;
  $$('ul.actions li', t.content).forEach(li => {
    if (li.dataset.task) return;
    const text = li.textContent.replace(/\s+/g, ' ').trim();
    if (!text) return;
    const task = H().newTask(text.slice(0, 300), { projectId: nb ? nb.projectId : null });
    task.noteRef = { notebookId: pg.notebookId, pageId: pg.id };
    D().tasks.push(task);
    li.dataset.task = task.id;
    n++;
  });
  if (n) {
    pg.html = t.innerHTML;
    H().save();
    H().toast(`${H().plural(n, 'meeting action')} added to Today`, { ic: 'meeting' });
  }
  return n;
}

// ================================================================== VIEW
function view() {
  return `<div class="notes"><aside class="shelf" id="shelf"></aside><section class="desk" id="desk"></section></div>`;
}

function mount() {
  const m = D().meta.notes || {};
  if (!ns.nbId) Object.assign(ns, { nbId: m.nbId || null, pgId: m.pgId ?? null, expanded: m.expanded || {}, tool: 'type', pen: m.pen || 'graphite' });
  journalPage(H().today());
  if (!D().notebooks.some(n => n.kind === 'normal')) {
    const nb = createNotebook({ name: 'My notebook', color: '#BF6239' });
    if (!ns.nbId) { ns.nbId = nb.id; ns.pgId = pagesOf(nb.id)[0].id; }
  }
  if (!getNb(ns.nbId)) { const first = notebooks().find(n => n.kind === 'normal') || notebooks()[0]; ns.nbId = first.id; ns.pgId = (pagesOf(first.id)[0] || {}).id || null; }
  if (ns.pgId && !getPg(ns.pgId)) ns.pgId = (pagesOf(ns.nbId)[0] || {}).id || null;
  ns.expanded[ns.nbId] = true;
  H().save();
  renderShelf();
  renderDesk();
}

function light() {
  if (!$('#shelf')) return;
  renderShelf();
  if (!ns.pgId) renderCoverBody(); else refreshTaskMarks();
}

function leave() {
  commitEditor();
  processActions(curPg());
  hideSelbar();
  closeMenu();
}

// ------------------------------------------------------------------ shelf
function renderShelf() {
  const shelf = $('#shelf'); if (!shelf) return;
  const focus = document.activeElement && document.activeElement.id === 'nq' ? { s: document.activeElement.selectionStart } : null;
  const q = ns.query.trim();
  const bm = D().pages.filter(p => p.bookmarked && getNb(p.notebookId));
  shelf.innerHTML = `
    <div class="shelf-search">${icon('search', 'sm')}<input id="nq" placeholder="Search all notes…" value="${esc(ns.query)}" autocomplete="off">${q ? `<button class="icon-btn" data-act="nq-clear" title="Clear">${icon('x', 'sm')}</button>` : ''}</div>
    ${q ? renderResults(q) : `
      ${bm.length ? `<div class="shelf-label">${icon('ribbon', 'sm')} Ribbons</div>
        <div class="ribbon-list">${bm.map(p => { const nb = getNb(p.notebookId); return `<button class="pg-row rib ${p.id === ns.pgId ? 'active' : ''}" data-act="pg-open" data-nb="${nb.id}" data-pg="${p.id}" style="--c:${nb.color}"><span class="rib-mark"></span><span class="t">${esc(pageLabel(p, pagesOf(nb.id).indexOf(p)))}</span><small>${esc(nb.name)}</small></button>`; }).join('')}</div>` : ''}
      <div class="shelf-label">${icon('book', 'sm')} Notebooks <button class="icon-btn mini" data-act="nb-new" title="New notebook">${icon('plus', 'sm')}</button></div>
      <div class="nb-list">${notebooks().map(nbRow).join('')}</div>
      <button class="new-nb" data-act="nb-new">${icon('plus', 'sm')} New notebook</button>`}`;
  if (focus) { const i = $('#nq'); i.focus(); try { i.setSelectionRange(focus.s, focus.s); } catch (e) {} }
  if (ns.justToggled && !REDUCED) {
    const box = $(`.nb[data-nb="${ns.justToggled}"] .nb-pages`, shelf);
    if (box) { const h = box.scrollHeight; box.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 380, easing: H().EASE }); }
    ns.justToggled = null;
  }
}
function nbRow(nb) {
  const pages = pagesOf(nb.id);
  const open = !!ns.expanded[nb.id];
  const active = nb.id === ns.nbId;
  const ic = nb.kind === 'journal' ? 'calendar' : nb.kind === 'inbox' ? 'sticky' : 'book';
  return `<div class="nb ${active ? 'active' : ''}" data-nb="${nb.id}">
    <button class="nb-row" data-act="nb-click" data-nb="${nb.id}">
      <span class="nb-spine" style="--c:${nb.color}">${icon(ic, 'sm')}</span>
      <span class="nb-name">${esc(nb.name)}</span><span class="nb-count">${pages.length}</span>
      <span class="nb-chev ${open ? 'open' : ''}" data-act="nb-toggle" data-nb="${nb.id}">${icon('chevron', 'sm')}</span>
    </button>
    ${open ? `<div class="nb-pages">
      <button class="pg-row cover ${active && !ns.pgId ? 'active' : ''}" data-act="pg-open" data-nb="${nb.id}" data-pg="">${icon('book', 'sm')}<span class="t">Inside cover</span></button>
      ${pages.map((p, i) => `<button class="pg-row ${p.id === ns.pgId ? 'active' : ''}" data-act="pg-open" data-nb="${nb.id}" data-pg="${p.id}">
        <span class="pg-num">${nb.kind === 'journal' ? '' : i + 1}</span><span class="t">${esc(pageLabel(p, i))}</span>
        ${p.bookmarked ? `<span class="rib-dot" style="--c:${nb.color}"></span>` : ''}${(p.stickies || []).length ? `<span class="st-dot" title="${p.stickies.length} sticky notes"></span>` : ''}</button>`).join('')}
      ${nb.kind !== 'journal' ? `<button class="pg-row add" data-act="pg-new" data-nb="${nb.id}">${icon('plus', 'sm')}<span class="t">New page</span></button>` : ''}
    </div>` : ''}
  </div>`;
}
function renderResults(q) {
  const ql = q.toLowerCase();
  const out = [];
  for (const pg of D().pages) {
    const nb = getNb(pg.notebookId); if (!nb) continue;
    const text = plainText(pg.html);
    const stick = (pg.stickies || []).map(s => s.text).join(' · ');
    const hay = [pg.title || '', text, stick];
    const where = hay.findIndex(h => h.toLowerCase().includes(ql));
    if (where < 0) continue;
    const src = hay[where];
    const i = src.toLowerCase().indexOf(ql);
    const a = Math.max(0, i - 36), b = Math.min(src.length, i + q.length + 50);
    const snip = (a ? '…' : '') + esc(src.slice(a, i)) + '<mark>' + esc(src.slice(i, i + q.length)) + '</mark>' + esc(src.slice(i + q.length, b)) + (b < src.length ? '…' : '');
    out.push(`<button class="result" data-act="pg-open" data-nb="${nb.id}" data-pg="${pg.id}" data-hl="1">
      <span class="r-top"><span class="nb-dot" style="background:${nb.color}"></span>${esc(nb.name)} · <b>${esc(pageLabel(pg, pagesOf(nb.id).indexOf(pg)))}</b>${where === 2 ? ' <span class="chip">sticky</span>' : ''}</span>
      <span class="r-snip">${snip}</span></button>`);
  }
  return `<div class="shelf-label">${icon('search', 'sm')} ${out.length ? H().plural(out.length, 'match', 'matches') : 'No matches'}</div><div class="results">${out.join('')}</div>`;
}

// ------------------------------------------------------------------ desk
function renderDesk() {
  const desk = $('#desk'); if (!desk) return;
  const nb = curNb(); if (!nb) return;
  const pages = pagesOf(nb.id);
  const pg = curPg();
  const idx = pg ? pages.indexOf(pg) : -1;
  desk.innerHTML = `
    ${deskTopHtml(nb, pg, idx, pages)}
    <div class="book-area">
      <div class="book" style="--nb:${nb.color}">
        <div class="book-cover"></div>
        <div class="spine">${'<i></i>'.repeat(40)}</div>
        <div class="page-wrap" id="page-wrap">
          <div class="page-under u2"></div><div class="page-under"></div>
          ${pg ? pageHtml(nb, pg, idx) : coverHtml(nb)}
        </div>
        <div class="tabs">${notebooks().slice(0, 9).map(n => `<button class="tab ${n.id === nb.id ? 'on' : ''}" style="--c:${n.color}" data-act="nb-open" data-nb="${n.id}" title="${esc(n.name)}"><span>${esc(n.name)}</span></button>`).join('')}</div>
      </div>
    </div>`;
  mountPage();
}

function pageHtml(nb, pg, idx) {
  const coffee = hash(pg.id) % 7 === 3;
  return `<article class="page paper-${nb.paper || 'lined'} ${ns.tool !== 'type' ? 'inking tool-' + ns.tool : ''}" id="page" data-pg="${pg.id}">
    <button class="ribbon ${pg.bookmarked ? 'on' : ''}" data-act="pg-ribbon" title="${pg.bookmarked ? 'Remove ribbon' : 'Mark this page with a ribbon'}" style="--c:${nb.color}"></button>
    <header class="nhead"><input class="page-title" id="page-title" value="${esc(pg.title || '')}" placeholder="${nb.kind === 'journal' ? '' : 'Page title'}" maxlength="120" autocomplete="off">
      <span class="page-date">${esc(H().fmtShort(H().dayKey(new Date(pg.createdAt))))}</span></header>
    <div class="page-body" id="page-body" contenteditable="${ns.tool === 'type' ? 'true' : 'false'}" spellcheck="true" data-placeholder="Start writing… paste links or pictures, or add a sticky note.">${pg.html || ''}</div>
    <canvas class="ink" id="ink"></canvas>
    <div class="stickies" id="stickies">${(pg.stickies || []).map(stickyHtml).join('')}</div>
    ${coffee ? `<svg class="coffee" viewBox="0 0 120 120" style="--r:${hash(pg.id) % 360}deg"><circle cx="60" cy="60" r="46" fill="none" stroke="#8B5A2B" stroke-width="7" stroke-dasharray="210 18 40 22" opacity=".09"/><circle cx="60" cy="60" r="41" fill="none" stroke="#8B5A2B" stroke-width="1.5" opacity=".07"/><circle cx="64" cy="58" r="39" fill="#8B5A2B" opacity=".025"/></svg>` : ''}
    <footer class="page-num">— ${nb.kind === 'journal' ? esc(H().fmtShort(pg.date || H().today())) : idx + 1} —</footer>
  </article>`;
}

function stickyHtml(s) {
  const fastener = s.attach === 'clip'
    ? `<svg class="clip" viewBox="0 0 24 60"><path d="M8 40V12a4.5 4.5 0 0 1 9 0v34a7 7 0 0 1-14 0V16" fill="none" stroke-width="2.4" stroke-linecap="round"/></svg>`
    : '<span class="pin"></span>';
  return `<div class="sticky s-${s.color || 'yellow'} at-${s.attach || 'pin'} ${s.onDesk ? 'on-desk' : ''}" data-sid="${s.id}" style="left:${s.x}%;top:${s.y}px;--rot:${s.rot || 0}deg">
    ${fastener}
    <div class="sticky-text" contenteditable="true" spellcheck="true" data-placeholder="Write something…">${esc(s.text || '').replace(/\n/g, '<br>')}</div>
    <div class="sticky-tools">
      ${STICKY_COLOURS.map(c => `<button class="sdot s-${c} ${s.color === c ? 'on' : ''}" data-act="st-color" data-v="${c}" title="${c}"></button>`).join('')}
      <span class="sep"></span>
      <button class="icon-btn mini" data-act="st-attach" title="${s.attach === 'clip' ? 'Use a pin' : 'Use a paperclip'}">${icon(s.attach === 'clip' ? 'pin' : 'clip', 'sm')}</button>
      <button class="icon-btn mini ${s.onDesk ? 'lit' : ''}" data-act="st-desk" title="${s.onDesk ? 'Remove from your Today desk' : 'Pin to your Today desk'}">${icon('sun', 'sm')}</button>
      <button class="icon-btn mini danger" data-act="st-del" title="Remove">${icon('trash', 'sm')}</button>
    </div>
  </div>`;
}

function coverHtml(nb) {
  return `<article class="page cover-page" id="page" style="--nb:${nb.color}">
    <div class="cover-band"></div>
    <div class="cover-inner" id="cover-body">${coverBody(nb)}</div>
  </article>`;
}
function coverBody(nb) {
  const pages = pagesOf(nb.id);
  const p = nb.projectId ? H().P.get(nb.projectId) : null;
  const ptasks = p ? H().T.ofProject(p.id).filter(t => !t.done) : [];
  const projects = H().D.projects.filter(x => x.status !== 'done');
  return `
    <div class="cover-label">This notebook belongs to…</div>
    <input class="cover-name" id="nb-name" value="${esc(nb.name)}" maxlength="60" autocomplete="off">
    <div class="cover-grid">
      <div class="field"><label>Cover colour</label><div class="swatches">${NB_COLOURS.map(c => `<button class="swatch ${nb.color === c ? 'on' : ''}" style="--c:${c}" data-act="nb-color" data-v="${c}"></button>`).join('')}</div></div>
      <div class="field"><label>Paper</label><div class="papers">${PAPERS.map(([v, l]) => `<button class="paper-opt paper-${v} ${nb.paper === v ? 'on' : ''}" data-act="nb-paper" data-v="${v}"><i></i><span>${l}</span></button>`).join('')}</div></div>
      <div class="field"><label>Linked project</label><select class="select" id="nb-project"><option value="">Not linked</option>${projects.map(x => `<option value="${x.id}" ${x.id === nb.projectId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    </div>
    ${p ? `<div class="cover-section"><h4>${icon('folder', 'sm')} ${esc(p.name)}: open tasks</h4>
      ${p.nextAction ? `<div class="cover-next"><b>Next:</b> ${esc(p.nextAction)}</div>` : ''}
      <div class="cover-tasks">${ptasks.length ? ptasks.map(t => `<div class="ctask" data-id="${t.id}"><button class="check" data-act="toggle"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button><span>${esc(t.title)}</span>
        ${t.date === H().today() ? '<span class="chip accent">Today</span>' : `<button class="pill-btn sage" data-act="today">${icon('sun', 'sm')} Today</button>`}</div>`).join('') : '<div class="muted">No open tasks on this project.</div>'}</div></div>` : ''}
    <div class="cover-section"><h4>${icon('note', 'sm')} Contents</h4>
      <ol class="contents">${pages.map((pg, i) => `<li><button data-act="pg-open" data-nb="${nb.id}" data-pg="${pg.id}"><span class="t">${esc(pageLabel(pg, i))}</span><span class="dots"></span><span class="n">${nb.kind === 'journal' ? esc(H().fmtShort(pg.date || '')) : i + 1}</span>${pg.bookmarked ? `<span class="rib-dot" style="--c:${nb.color}"></span>` : ''}</button></li>`).join('') || '<li class="muted">No pages yet.</li>'}</ol>
      ${nb.kind !== 'journal' ? `<button class="btn sm" data-act="pg-new" data-nb="${nb.id}">${icon('plus', 'sm')}New page</button>` : ''}</div>
    <div class="cover-foot"><button class="btn sm" data-act="pdf-notebook">${icon('file', 'sm')}Export notebook as PDF</button>
      ${nb.kind === 'normal' ? `<button class="btn sm danger" data-act="nb-delete">${icon('trash', 'sm')}Delete notebook</button>` : ''}</div>`;
}
function renderCoverBody() {
  const el = $('#cover-body'); const nb = curNb();
  if (!el || !nb) return;
  const f = document.activeElement && document.activeElement.id === 'nb-name' ? document.activeElement.selectionStart : null;
  el.innerHTML = coverBody(nb);
  if (f != null) { const i = $('#nb-name'); i.focus(); i.setSelectionRange(f, f); }
}

// ------------------------------------------------------------------ page mounting
function mountPage() {
  const page = $('#page'); if (!page) return;
  if (resizeObs) resizeObs.disconnect();
  if (!ns.pgId) return;
  refreshTaskMarks();
  fitPage();
  resizeObs = new ResizeObserver(() => fitPage());
  resizeObs.observe(page);
  resizeObs.observe($('#page-body'));
  setupInk();
  if (ns.query.trim()) highlightSearch(ns.query.trim()); else clearHighlight();
}
let fitting = false;
function fitPage() {
  if (fitting) return;
  const page = $('#page'), body = $('#page-body'), pg = curPg();
  if (!page || !body || !pg) return;
  fitting = true;
  const w = page.clientWidth;
  const stickBottom = Math.max(0, ...(pg.stickies || []).map(s => s.y + 230));
  const inkBottom = Math.max(0, ...(pg.strokes || []).flatMap(s => s.pts.map(p => p[1] + 40)));
  const r = document.createRange(); r.selectNodeContents(body);
  const content = body.childNodes.length ? r.getBoundingClientRect().bottom - page.getBoundingClientRect().top : body.offsetTop;
  const want = Math.max(Math.round(w * 1.32), Math.round(content) + 160, stickBottom, inkBottom);
  if (Math.abs(page.offsetHeight - want) > 2) page.style.minHeight = want + 'px';
  pg.w = w; pg.h = page.offsetHeight;
  sizeCanvas();
  fitting = false;
}
function refreshTaskMarks() {
  $$('#page-body [data-task]').forEach(el => {
    const t = H().T.get(el.dataset.task);
    el.classList.toggle('is-done', !!(t && t.done));
    el.classList.toggle('gone', !t);
  });
}

function commitEditor() {
  clearTimeout(editTimer);
  const body = $('#page-body'), pg = curPg();
  if (body && pg && body.dataset.dirty) {
    pg.html = cleanHtml(body.innerHTML);
    delete body.dataset.dirty;
    touch(pg);
    H().save();
  }
}
function cleanHtml(html) {
  // strip leftover search highlights and empty trailing breaks
  return html.replace(/<br>\s*$/i, '').replace(/^(<br>)$/, '');
}
function bodyChanged() {
  const body = $('#page-body'); if (!body) return;
  body.dataset.dirty = '1';
  clearTimeout(editTimer);
  editTimer = setTimeout(commitEditor, 400);
  clearHighlight();
  fitPage();
}

// ------------------------------------------------------------------ page turning
function snapshot(el) {
  const c = el.cloneNode(true);
  c.removeAttribute('id');
  $$('[id]', c).forEach(x => x.removeAttribute('id'));
  $$('[contenteditable]', c).forEach(x => x.removeAttribute('contenteditable'));
  const src = el.querySelector('canvas.ink');
  const dst = c.querySelector('canvas.ink');
  if (src && dst) {
    const img = document.createElement('img');
    img.className = 'ink';
    try { img.src = src.toDataURL(); } catch (e) {}
    img.style.width = src.style.width; img.style.height = src.style.height;
    dst.replaceWith(img);
  }
  const t = el.querySelector('.page-title');
  const tc = c.querySelector('.page-title');
  if (t && tc) tc.setAttribute('value', t.value);
  c.style.minHeight = el.offsetHeight + 'px';
  return c;
}
function flipper(content, h) {
  const f = document.createElement('div');
  f.className = 'flip';
  f.style.height = h + 'px';
  const front = document.createElement('div'); front.className = 'face front'; front.appendChild(content);
  const shade = document.createElement('div'); shade.className = 'turn-shade'; front.appendChild(shade);
  const back = document.createElement('div'); back.className = 'face back';
  f.append(front, back);
  return f;
}
function turnTo(nbId, pgId, dir) {
  if (nbId === ns.nbId && pgId === ns.pgId) return;
  commitEditor();
  processActions(curPg());
  hideSelbar(); closeMenu();
  const oldPage = $('#page');
  const oldSnap = oldPage && !REDUCED ? snapshot(oldPage) : null;
  const oldH = oldPage ? oldPage.offsetHeight : 0;
  if (dir == null) {
    if (nbId === ns.nbId) {
      const list = pagesOf(nbId).map(p => p.id);
      dir = (pgId ? list.indexOf(pgId) : -1) > (ns.pgId ? list.indexOf(ns.pgId) : -1) ? 1 : -1;
    } else {
      const order = notebooks().map(n => n.id);
      dir = order.indexOf(nbId) > order.indexOf(ns.nbId) ? 1 : -1;
    }
  }
  ns.nbId = nbId; ns.pgId = pgId || null; ns.expanded[nbId] = true;
  const nb = getNb(nbId); if (nb) nb.lastPg = ns.pgId;
  persist();
  const desk = $('#desk'); if (desk) desk.scrollTo({ top: 0 });
  renderShelf();
  renderDesk();
  if (!oldSnap) return;
  window.Sound && Sound.play('page');
  const wrap = $('#page-wrap'), newPage = $('#page');
  if (!wrap || !newPage) return;
  const cast = document.createElement('div'); cast.className = 'turn-cast'; wrap.appendChild(cast);
  const dur = 950;
  if (dir > 0) {
    const f = flipper(oldSnap, oldH); wrap.appendChild(f);
    f.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-12deg)', offset: .15 }, { transform: 'rotateY(-78deg)', offset: .6 }, { transform: 'rotateY(-180deg)' }], { duration: dur, easing: 'ease-in-out', fill: 'forwards' });
    f.querySelector('.turn-shade').animate([{ opacity: 0 }, { opacity: .55, offset: .45 }, { opacity: 0 }], { duration: dur * .5, easing: 'ease-in', fill: 'forwards' });
    cast.animate([{ opacity: .5 }, { opacity: 0 }], { duration: dur * .8, easing: 'ease-out', fill: 'forwards' });
    setTimeout(() => { f.remove(); cast.remove(); }, dur + 20);
  } else {
    const under = document.createElement('div'); under.className = 'flip-under'; under.appendChild(oldSnap); wrap.appendChild(under);
    const f = flipper(snapshot(newPage), newPage.offsetHeight); wrap.appendChild(f);
    f.animate([{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(-100deg)', offset: .4 }, { transform: 'rotateY(-14deg)', offset: .85 }, { transform: 'rotateY(0deg)' }], { duration: dur, easing: 'ease-in-out', fill: 'forwards' });
    f.querySelector('.turn-shade').animate([{ opacity: 0 }, { opacity: .5, offset: .55 }, { opacity: 0 }], { duration: dur, easing: 'ease-out', fill: 'forwards' });
    cast.animate([{ opacity: 0 }, { opacity: .45, offset: .7 }, { opacity: 0 }], { duration: dur, fill: 'forwards' });
    setTimeout(() => { f.remove(); under.remove(); cast.remove(); }, dur + 20);
  }
}
function step(delta) {
  const list = pagesOf(ns.nbId);
  const idx = ns.pgId ? list.findIndex(p => p.id === ns.pgId) : -1;
  const next = idx + delta;
  if (next < -1 || next >= list.length) return;
  turnTo(ns.nbId, next === -1 ? null : list[next].id, delta);
}

// ------------------------------------------------------------------ ink layer
function sizeCanvas() {
  const c = $('#ink'), page = $('#page'); if (!c || !page) return;
  const dpr = window.devicePixelRatio || 1;
  const w = page.clientWidth, h = page.offsetHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    drawInk();
  }
}
function drawStroke(ctx, s, w) {
  const pts = s.pts.map(p => [p[0] / 100 * w, p[1]]);
  if (!pts.length) return;
  const path = () => {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + .1, pts[0][1] + .1);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    if (pts.length > 1) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (s.tool === 'hl') {
    ctx.globalCompositeOperation = 'multiply';
    ctx.strokeStyle = 'rgba(246, 210, 70, .45)'; ctx.lineWidth = 18; path(); ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.strokeStyle = s.color; ctx.globalAlpha = .82; ctx.lineWidth = 2.1; path(); ctx.stroke();
    ctx.globalAlpha = .22; ctx.lineWidth = 3.4; ctx.save(); ctx.translate(.5, .4); path(); ctx.stroke(); ctx.restore();
    ctx.globalAlpha = 1;
  }
}
function drawInk() {
  const c = $('#ink'), pg = curPg(); if (!c || !pg) return;
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  const w = c.width / dpr;
  (pg.strokes || []).forEach(s => drawStroke(ctx, s, w));
}
function setupInk() {
  const c = $('#ink'); if (!c) return;
  let cur = null;
  const pos = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * 100, e.clientY - r.top]; };
  const erase = (e) => {
    const pg = curPg(); const [x, y] = pos(e); const w = c.getBoundingClientRect().width;
    const before = pg.strokes.length;
    pg.strokes = pg.strokes.filter(s => !s.pts.some(p => Math.hypot((p[0] - x) / 100 * w, p[1] - y) < 14));
    if (pg.strokes.length !== before) { drawInk(); touch(pg); H().save(); }
  };
  c.onpointerdown = (e) => {
    if (ns.tool === 'type') return;
    c.setPointerCapture(e.pointerId);
    const pg = curPg(); pg.strokes = pg.strokes || [];
    if (ns.tool === 'eraser') { cur = { erasing: true }; erase(e); return; }
    cur = { tool: ns.tool === 'hl' ? 'hl' : 'pencil', color: PENS[ns.pen] || PENS.graphite, pts: [pos(e).map(v => +v.toFixed(2))] };
    pg.strokes.push(cur);
    drawInk();
  };
  c.onpointermove = (e) => {
    if (!cur) return;
    if (cur.erasing) { erase(e); return; }
    const p = pos(e).map(v => +v.toFixed(2));
    const last = cur.pts[cur.pts.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < .35) return;
    cur.pts.push(p);
    drawInk();
  };
  c.onpointerup = c.onpointercancel = () => {
    if (!cur) return;
    cur = null;
    const pg = curPg(); touch(pg); H().save(); fitPage();
  };
}

// ------------------------------------------------------------------ stickies
function addSticky() {
  const pg = curPg(); const page = $('#page'); const desk = $('#desk'); if (!pg || !page) return;
  const visTop = Math.max(90, desk.scrollTop - page.offsetTop + 120);
  const s = {
    id: nid('st'), text: '', color: STICKY_COLOURS[(pg.stickies || []).length % STICKY_COLOURS.length],
    attach: Math.random() < .5 ? 'pin' : 'clip', rot: +(Math.random() * 7 - 3.5).toFixed(1),
    x: +(52 + Math.random() * 18).toFixed(1), y: Math.round(visTop + Math.random() * 60), createdAt: Date.now()
  };
  pg.stickies = pg.stickies || [];
  pg.stickies.push(s);
  touch(pg); H().save();
  const layer = $('#stickies');
  layer.insertAdjacentHTML('beforeend', stickyHtml(s));
  const el = layer.lastElementChild;
  if (!REDUCED) el.animate([
    { transform: `translateY(-140px) rotate(${s.rot - 14}deg) scale(1.08)`, opacity: 0 },
    { transform: `translateY(6px) rotate(${s.rot + 2}deg) scale(1)`, opacity: 1, offset: .7 },
    { transform: `rotate(${s.rot}deg)`, opacity: 1 }], { duration: 620, easing: 'cubic-bezier(.3,.7,.3,1)' });
  setTimeout(() => placeCaret(el.querySelector('.sticky-text')), 300);
  setTimeout(() => window.Sound && Sound.play('stick'), 380);
  fitPage();
}
function placeCaret(el) {
  if (!el) return;
  el.focus();
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}
const stickyOf = (el) => { const pg = curPg(); const id = el.closest('.sticky')?.dataset.sid; return pg && (pg.stickies || []).find(s => s.id === id); };

let drag = null;
document.addEventListener('pointerdown', (e) => {
  const st = e.target.closest('#stickies .sticky');
  if (!st || e.button !== 0 || e.target.closest('.sticky-tools')) return;
  const txt = e.target.closest('.sticky-text');
  if (txt && document.activeElement === txt) return; // editing: let the text be selected
  const page = $('#page');
  drag = { el: st, sx: e.clientX, sy: e.clientY, left: st.offsetLeft, top: st.offsetTop, moved: false, id: e.pointerId, pw: page.clientWidth, ph: page.offsetHeight };
  e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) < 4) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.el.classList.add('dragging');
    document.body.classList.add('dragging-sticky');
    hideSelbar();
  }
  const x = Math.max(-drag.el.offsetWidth * .3, Math.min(drag.pw - drag.el.offsetWidth * .7, drag.left + dx));
  const y = Math.max(-20, drag.top + dy);
  drag.el.style.left = x + 'px'; drag.el.style.top = y + 'px';
  // gentle tilt in the direction of travel
  drag.el.style.setProperty('--tilt', Math.max(-8, Math.min(8, (e.movementX || 0) * .8)) + 'deg');
});
document.addEventListener('pointerup', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  document.body.classList.remove('dragging-sticky');
  if (!d.moved) { placeCaret(d.el.querySelector('.sticky-text')); return; }
  const s = stickyOf(d.el); if (!s) return;
  s.x = +(d.el.offsetLeft / d.pw * 100).toFixed(2);
  s.y = Math.round(d.el.offsetTop);
  s.rot = +(Math.random() * 7 - 3.5).toFixed(1);
  d.el.style.left = s.x + '%';
  d.el.style.setProperty('--rot', s.rot + 'deg');
  d.el.style.removeProperty('--tilt');
  d.el.classList.remove('dragging');
  d.el.classList.add('landing');
  window.Sound && Sound.play('stick');
  setTimeout(() => d.el.classList.remove('landing'), 450);
  touch(curPg()); H().save(); fitPage();
});

// ------------------------------------------------------------------ checklists
function insertChecklist() {
  const body = $('#page-body'); if (!body) return;
  const sel = getSelection();
  if (!sel.rangeCount || !body.contains(sel.anchorNode)) placeCaret(body);
  const ul = document.createElement('ul'); ul.className = 'checks';
  const li = document.createElement('li'); li.appendChild(document.createElement('br')); ul.appendChild(li);
  const r = getSelection().getRangeAt(0);
  // put the list after the current block
  let block = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
  while (block && block.parentNode !== body) block = block.parentNode;
  if (block && block !== body) block.after(ul); else body.appendChild(ul);
  const nr = document.createRange(); nr.setStart(li, 0); nr.collapse(true);
  sel.removeAllRanges(); sel.addRange(nr);
  bodyChanged();
  window.Sound && Sound.play('tap');
}
function autoChecklist() {
  // typing "[] " or "[ ] " at the start of a line turns it into a checklist item
  const sel = getSelection(); if (!sel.rangeCount) return;
  const body = $('#page-body');
  let node = sel.anchorNode;
  if (!node || !body.contains(node)) return;
  let block = node.nodeType === 1 ? node : node.parentNode;
  while (block && block !== body && !/^(P|DIV|LI)$/.test(block.tagName)) block = block.parentNode;
  const target = block && block !== body ? block : null;
  const text = target ? target.textContent : (node.nodeType === 3 ? node.textContent : '');
  const m = /^\s*\[\s?\]\s/.exec(text);
  if (!m) return;
  const rest = text.slice(m[0].length);
  const ul = document.createElement('ul'); ul.className = 'checks';
  const li = document.createElement('li');
  if (rest) li.textContent = rest; else li.appendChild(document.createElement('br'));
  ul.appendChild(li);
  if (target && target.tagName === 'LI' && target.parentNode.classList.contains('checks')) return;
  if (target && target.tagName === 'LI') {
    // a line inside another list: lift it out into its own checklist just after that list
    const list = target.parentNode;
    list.after(ul); target.remove();
    if (!list.children.length) list.remove();
  } else if (target) target.replaceWith(ul);
  else { node.textContent = ''; node.parentNode.insertBefore(ul, node.nextSibling); }
  const r = document.createRange(); r.selectNodeContents(li); r.collapse(false);
  sel.removeAllRanges(); sel.addRange(r);
}
document.addEventListener('mousedown', (e) => {
  const li = e.target.closest && e.target.closest('#page-body ul.checks > li');
  if (!li) return;
  const box = li.getBoundingClientRect();
  if (e.clientX - box.left > 30) return;
  e.preventDefault();
  li.classList.toggle('checked');
  if (li.classList.contains('checked')) window.Sound && Sound.play('tick');
  bodyChanged();
});

// ------------------------------------------------------------------ paste, drop, links, images
function linkChip(url) {
  let label = url;
  try { const u = new URL(url); label = u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : ''); } catch (e) {}
  if (label.length > 46) label = label.slice(0, 44) + '…';
  const a = document.createElement('a');
  a.className = 'nlink'; a.href = url; a.dataset.href = url; a.contentEditable = 'false'; a.title = url;
  a.innerHTML = `${icon('link', 'sm')}<span>${esc(label)}</span>`;
  return a;
}
function textFragment(text) {
  const frag = document.createDocumentFragment();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, li) => {
    let last = 0;
    line.replace(URL_RE, (m, off) => {
      if (off > last) frag.appendChild(document.createTextNode(line.slice(last, off)));
      frag.appendChild(linkChip(m));
      frag.appendChild(document.createTextNode(' '));
      last = off + m.length;
      return m;
    });
    if (last < line.length) frag.appendChild(document.createTextNode(line.slice(last)));
    if (li < lines.length - 1) frag.appendChild(document.createElement('br'));
  });
  return frag;
}
function insertAtCaret(node, range) {
  const sel = getSelection();
  const r = range || (sel.rangeCount ? sel.getRangeAt(0) : null);
  if (!r) return;
  r.deleteContents();
  const last = node.lastChild || node;
  r.insertNode(node);
  const after = document.createRange();
  after.setStartAfter(last); after.collapse(true);
  sel.removeAllRanges(); sel.addRange(after);
}
function photoNode(src) {
  const span = document.createElement('span');
  span.className = 'photo size-m';
  span.contentEditable = 'false';
  span.style.setProperty('--rot', (Math.random() * 4 - 2).toFixed(1) + 'deg');
  span.innerHTML = `<img src="${esc(src)}" alt=""><span class="tape"></span>
    <span class="photo-tools"><button data-ph="s" title="Small">S</button><button data-ph="m" title="Medium">M</button><button data-ph="l" title="Large">L</button><button data-ph="x" title="Remove">×</button></span>`;
  return span;
}
function readAsDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
async function insertImages(files, range) {
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue;
    const data = await readAsDataUrl(f);
    const src = (await H().api.saveImage(data)) || data;
    const frag = document.createDocumentFragment();
    frag.appendChild(photoNode(src));
    frag.appendChild(document.createTextNode(' '));
    insertAtCaret(frag, range);
    range = null;
  }
  bodyChanged();
}

document.addEventListener('paste', (e) => {
  const body = e.target.closest && e.target.closest('#page-body');
  const stickyText = e.target.closest && e.target.closest('.sticky-text');
  if (!body && !stickyText) return;
  e.preventDefault();
  const cd = e.clipboardData;
  if (stickyText) { document.execCommand('insertText', false, cd.getData('text/plain')); return; }
  const files = [...cd.files].filter(f => /^image\//.test(f.type));
  if (files.length) { insertImages(files); return; }
  const text = cd.getData('text/plain');
  if (!text) return;
  const t = text.trim();
  if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(t)) {
    const frag = document.createDocumentFragment(); frag.appendChild(photoNode(t)); frag.appendChild(document.createTextNode(' '));
    insertAtCaret(frag); bodyChanged(); return;
  }
  insertAtCaret(textFragment(text));
  bodyChanged();
});
document.addEventListener('dragover', (e) => { if (e.target.closest && e.target.closest('#page')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  const page = e.target.closest && e.target.closest('#page'); if (!page || !ns.pgId) return;
  e.preventDefault();
  const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
  const inBody = range && $('#page-body').contains(range.startContainer);
  const files = [...(e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type));
  if (files.length) {
    if (!inBody) { placeCaret($('#page-body')); }
    insertImages(files, inBody ? range : null);
    return;
  }
  const text = e.dataTransfer.getData('text/plain');
  if (text) { if (!inBody) placeCaret($('#page-body')); insertAtCaret(textFragment(text), inBody ? range : null); bodyChanged(); }
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('#page a.nlink');
  if (a) { e.preventDefault(); H().api.openExternal(a.dataset.href || a.href); return; }
  const ph = e.target.closest('#page .photo-tools button');
  if (ph) {
    e.preventDefault();
    const photo = ph.closest('.photo');
    if (ph.dataset.ph === 'x') {
      photo.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 220 }).finished.then(() => { photo.remove(); bodyChanged(); });
    } else {
      photo.classList.remove('size-s', 'size-m', 'size-l'); photo.classList.add('size-' + ph.dataset.ph); bodyChanged();
    }
  }
  if (!e.target.closest('.menu') && !e.target.closest('[data-act="menu"]')) closeMenu();
}, true);

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'page-body') { if (e.inputType === 'insertText' && e.data === ' ') autoChecklist(); bodyChanged(); return; }
  if (t.classList && t.classList.contains('sticky-text')) {
    const s = stickyOf(t); if (!s) return;
    s.text = t.innerText.replace(/\n$/, '');
    touch(curPg()); H().save(); return;
  }
  if (t.id === 'page-title') {
    const pg = curPg(); if (!pg) return;
    pg.title = t.value; touch(pg); H().save();
    const c = $('.crumb-pg'); if (c) c.textContent = pageLabel(pg, pagesOf(pg.notebookId).indexOf(pg));
    clearTimeout(shelfTimer); shelfTimer = setTimeout(renderShelf, 250);
    return;
  }
  if (t.id === 'nb-name') {
    const nb = curNb(); nb.name = t.value || 'Untitled'; nb.updatedAt = Date.now(); H().save();
    clearTimeout(shelfTimer); shelfTimer = setTimeout(() => { renderShelf(); const c = $('.crumbs b'); if (c) c.textContent = nb.name; $$('.tab.on span').forEach(s => s.textContent = nb.name); }, 200);
    return;
  }
  if (t.id === 'nq') {
    ns.query = t.value; renderShelf();
    if (ns.query.trim()) highlightSearch(ns.query.trim()); else clearHighlight();
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'nb-project') {
    const nb = curNb(); nb.projectId = e.target.value || null; H().save(); renderCoverBody();
    H().toast(nb.projectId ? 'Notebook linked to project' : 'Notebook unlinked', { ic: 'folder' });
  }
});
document.addEventListener('keydown', (e) => {
  if (H().state.view !== 'notes') return;
  if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); return; }
  if (e.key === 'Escape') {
    if ($('.menu')) { closeMenu(); return; }
    if (ns.tool !== 'type') { setTool('type'); return; }
    if (document.activeElement && document.activeElement.classList.contains('sticky-text')) document.activeElement.blur();
  }
  if (e.target.id === 'page-title' && e.key === 'Enter') { e.preventDefault(); placeCaret($('#page-body')); }
});
document.addEventListener('focusout', (e) => {
  if (e.target.id === 'page-body') commitEditor();
  if (e.target.classList && e.target.classList.contains('sticky-text') && !e.target.textContent.trim()) {
    // an empty sticky that loses focus quietly drops off the page
    const el = e.target.closest('.sticky'); const s = stickyOf(el);
    setTimeout(() => {
      if (!el.isConnected || el.contains(document.activeElement) || (s && s.text.trim())) return;
      removeSticky(el, false);
    }, 150);
  }
});
function removeSticky(el, withUndo = true) {
  const pg = curPg(); const s = stickyOf(el); if (!pg || !s) return;
  const snap = H().snapshot();
  const go = () => { pg.stickies = pg.stickies.filter(x => x.id !== s.id); el.remove(); touch(pg); H().save(); if (withUndo) H().undoable('Sticky note removed', snap, 'sticky'); };
  if (REDUCED) return go();
  el.animate([{ opacity: 1, transform: `rotate(${s.rot}deg)` }, { opacity: 0, transform: `translateY(40px) rotate(${s.rot + 12}deg) scale(.9)` }], { duration: 300, easing: 'ease-in' }).finished.then(go);
}

// ------------------------------------------------------------------ selection → task toolbar
let selbar = null;
function hideSelbar() { if (selbar) { selbar.remove(); selbar = null; } }
document.addEventListener('selectionchange', () => {
  if (drag) return;
  const sel = getSelection();
  const body = $('#page-body');
  if (!body || !sel.rangeCount || sel.isCollapsed || !body.contains(sel.anchorNode) || !body.contains(sel.focusNode)) { hideSelbar(); return; }
  const text = sel.toString().trim();
  if (text.length < 2) { hideSelbar(); return; }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const nb = curNb();
  const p = nb && nb.projectId ? H().P.get(nb.projectId) : null;
  if (!selbar) { selbar = document.createElement('div'); selbar.className = 'selbar'; document.body.appendChild(selbar); }
  selbar.innerHTML = `<span class="lbl">${icon('check', 'sm')} Make a task</span>
    <button data-sb="today">${icon('sun', 'sm')}Today</button><button data-sb="tomorrow">Tomorrow</button>
    ${p ? `<button data-sb="project" title="Add to ${esc(p.name)} backlog">${icon('folder', 'sm')}${esc(p.name.length > 16 ? p.name.slice(0, 15) + '…' : p.name)}</button>` : ''}
    <span class="sep"></span><button data-sb="mark" title="Highlight">${icon('highlighter', 'sm')}</button>`;
  const w = selbar.offsetWidth;
  selbar.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  selbar.style.top = Math.max(8, r.top - 46) + 'px';
});
document.addEventListener('mousedown', (e) => {
  const b = e.target.closest('.selbar button');
  if (!b) return;
  e.preventDefault();
  const sel = getSelection(); if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const text = sel.toString().replace(/\s+/g, ' ').trim().slice(0, 300);
  const pg = curPg(), nb = curNb();
  const wrap = (el) => {
    try { range.surroundContents(el); }
    catch (err) { el.appendChild(range.extractContents()); range.insertNode(el); }
    sel.removeAllRanges();
  };
  if (b.dataset.sb === 'mark') {
    const m = document.createElement('mark'); m.className = 'hl'; wrap(m);
  } else {
    const when = b.dataset.sb;
    const t = H().newTask(text, { date: when === 'today' ? H().today() : when === 'tomorrow' ? H().tomorrow() : null, projectId: nb.projectId || null });
    t.noteRef = { notebookId: nb.id, pageId: pg.id };
    D().tasks.push(t);
    if (t.projectId) H().touchProject(t.projectId);
    const span = document.createElement('span'); span.className = 'tasked'; span.dataset.task = t.id; wrap(span);
    H().toast(when === 'project' ? 'Added to the project backlog' : `Added to ${when}`, { ic: 'check' });
    window.Sound && Sound.play('tick');
    H().updateSidebar();
  }
  hideSelbar();
  bodyChanged();
  commitEditor();
});

// ------------------------------------------------------------------ search highlight
function clearHighlight() { if (window.CSS && CSS.highlights) CSS.highlights.delete('nsearch'); }
function highlightSearch(q) {
  if (!(window.CSS && CSS.highlights && window.Highlight)) return;
  const roots = $$('#page-body, #page .sticky-text, #page-title');
  const ranges = [];
  const ql = q.toLowerCase();
  roots.forEach(root => {
    if (root.id === 'page-title') return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const s = n.textContent.toLowerCase();
      let i = s.indexOf(ql);
      while (i >= 0) { const r = new Range(); r.setStart(n, i); r.setEnd(n, i + q.length); ranges.push(r); i = s.indexOf(ql, i + q.length); }
    }
  });
  CSS.highlights.set('nsearch', new Highlight(...ranges));
  if (ranges[0]) {
    const rect = ranges[0].getBoundingClientRect(), desk = $('#desk');
    if (desk && (rect.top > innerHeight - 80 || rect.top < 120)) desk.scrollBy({ top: rect.top - 220, behavior: 'smooth' });
  }
}

// ------------------------------------------------------------------ menus
function closeMenu() { const m = $('.menu'); if (m) { m.classList.add('out'); setTimeout(() => m.remove(), 160); } }
function openMenu(btn, kind) {
  closeMenu();
  const pg = curPg(), nb = curNb();
  const customs = D().noteTemplates || [];
  const items = kind === 'newpage' ? [
    ...TEMPLATES.map(t => ['pg-new-tpl', t.ic, t.name, '', t.id]),
    ...(customs.length ? [null, ...customs.map(t => ['pg-new-tpl', 'template', t.name, 'custom', t.id])] : []),
    null, ['nb-new', 'book', 'New notebook']
  ] : [
    pg ? ['tpl-save', 'template', 'Save page as a template'] : null,
    pg ? ['pg-ribbon', 'ribbon', pg.bookmarked ? 'Remove ribbon' : 'Add ribbon'] : null,
    ['go-cover', 'book', 'Inside cover & settings'],
    ['journal-today', 'calendar', "Today's journal"],
    null,
    pg ? ['pdf-page', 'file', 'Export page as PDF'] : null,
    ['pdf-notebook', 'file', 'Export notebook as PDF'],
    pg && nb.kind !== 'journal' ? null : undefined,
    pg && nb.kind !== 'journal' ? ['pg-delete', 'trash', 'Delete page', 'danger'] : undefined
  ].filter(x => x !== undefined);
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = (kind === 'newpage' ? '<div class="menu-label">New page from…</div>' : '') + items.map(it => it === null ? '<div class="menu-sep"></div>' : `<button data-act="${it[0]}" class="${it[3] || ''}" ${it[4] ? `data-v="${it[4]}"` : ''}>${icon(it[1], 'sm')}<span class="mi">${esc(it[2])}</span>${it[3] === 'custom' ? `<i class="tpl-x" data-act="tpl-del" data-v="${it[4]}" title="Delete template">${icon('x', 'sm')}</i>` : ''}</button>`).join('');
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.top = r.bottom + 6 + 'px';
  m.style.left = Math.min(innerWidth - m.offsetWidth - 10, Math.max(10, r.right - m.offsetWidth)) + 'px';
}

// ------------------------------------------------------------------ tools
function setTool(t) {
  ns.tool = t;
  persist();
  commitEditor();
  // re-render only the toolbar + editable state, not the whole page
  const keep = $('#desk').scrollTop;
  const page = $('#page');
  if (page) {
    page.classList.toggle('inking', t !== 'type');
    ['pencil', 'hl', 'eraser'].forEach(x => page.classList.toggle('tool-' + x, t === x));
    const body = $('#page-body'); if (body) body.contentEditable = t === 'type' ? 'true' : 'false';
  }
  renderToolbarOnly();
  $('#desk').scrollTop = keep;
}
function renderToolbarOnly() {
  const desk = $('#desk'); const nb = curNb(); if (!desk || !nb) return;
  const pg = curPg(); const pages = pagesOf(nb.id); const idx = pg ? pages.indexOf(pg) : -1;
  const tmp = document.createElement('div');
  tmp.innerHTML = deskTopHtml(nb, pg, idx, pages);
  const old = $('.desk-top', desk); if (old) old.replaceWith(tmp.firstElementChild);
}
function deskTopHtml(nb, pg, idx, pages) {
  const tool = ns.tool;
  return `<div class="desk-top">
      <div class="crumbs"><span class="nb-dot" style="background:${nb.color}"></span><b>${esc(nb.name)}</b>${pg ? ` <span class="muted">›</span> <span class="crumb-pg">${esc(pageLabel(pg, idx))}</span>` : ' <span class="muted">› Inside cover</span>'}</div>
      <div class="turners">
        <button class="icon-btn" data-act="pg-prev" title="Previous page (Alt+←)" ${idx < 0 ? 'disabled' : ''}>${icon('chevronL', 'sm')}</button>
        <span class="pg-count">${pg ? `${idx + 1} / ${pages.length}` : 'Cover'}</span>
        <button class="icon-btn" data-act="pg-next" title="Next page (Alt+→)" ${idx >= pages.length - 1 ? 'disabled' : ''}>${icon('chevronR', 'sm')}</button>
      </div>
      <div class="tools">
        ${nb.kind !== 'journal' ? `<button class="btn sm" data-act="menu" data-menu="newpage">${icon('plus', 'sm')}Page</button>` : `<button class="btn sm" data-act="journal-today">${icon('calendar', 'sm')}Today</button>`}
        ${pg ? `<button class="btn sm sticky-btn" data-act="sticky-add" title="Add a sticky note">${icon('sticky', 'sm')}Sticky</button>
        <button class="icon-btn" data-act="checklist-add" title="Insert a checklist (or type [] at the start of a line)">${icon('checklist', 'sm')}</button>
        <div class="seg tool-seg">
          <button data-act="tool" data-v="type" class="${tool === 'type' ? 'on' : ''}" title="Write">Aa</button>
          <button data-act="tool" data-v="pencil" class="${tool === 'pencil' ? 'on' : ''}" title="Pencil">${icon('pencil', 'sm')}</button>
          <button data-act="tool" data-v="hl" class="${tool === 'hl' ? 'on' : ''}" title="Highlighter">${icon('highlighter', 'sm')}</button>
          <button data-act="tool" data-v="eraser" class="${tool === 'eraser' ? 'on' : ''}" title="Rubber">${icon('eraser', 'sm')}</button>
        </div>
        ${tool === 'pencil' ? `<div class="pens">${Object.keys(PENS).map(k => `<button class="pen ${ns.pen === k ? 'on' : ''}" style="--c:${PENS[k]}" data-act="pen" data-v="${k}" title="${k}"></button>`).join('')}</div>` : ''}
        ${tool !== 'type' ? `<button class="icon-btn" data-act="ink-undo" title="Undo last stroke">${icon('undo', 'sm')}</button>` : ''}` : ''}
        <button class="icon-btn" data-act="menu" data-menu="more" title="More">${icon('dots', 'sm')}</button>
      </div>
    </div>`;
}

// ------------------------------------------------------------------ PDF
function inkImage(pg, w, h) {
  if (!(pg.strokes || []).length) return '';
  const c = document.createElement('canvas');
  c.width = w * 2; c.height = h * 2;
  const ctx = c.getContext('2d'); ctx.scale(2, 2);
  pg.strokes.forEach(s => drawStroke(ctx, s, w));
  return `<img class="ink" src="${c.toDataURL()}" style="width:${w}px;height:${h}px">`;
}
function printHtml(nb, pages, title) {
  const abs = (p) => new URL(p, location.href).href;
  const W = 720;
  const sheets = pages.map((pg, i) => {
    const h = Math.max(980, pg.h || 980);
    const body = (pg.html || '').replace(/<span class="photo-tools">[\s\S]*?<\/span>\s*<\/span>/g, '</span>');
    return `<article class="page paper-${nb.paper || 'lined'} print-page" style="width:${W}px;min-height:${h}px">
      <header class="nhead"><div class="page-title">${esc(pg.title || pageLabel(pg, i))}</div><span class="page-date">${esc(H().fmtShort(H().dayKey(new Date(pg.createdAt))))}</span></header>
      <div class="page-body">${body}</div>
      ${inkImage(pg, W, h)}
      <div class="stickies">${(pg.stickies || []).map(s => stickyHtml(s).replace(/<div class="sticky-tools">[\s\S]*?<\/div>\s*<\/div>$/, '</div>').replace('contenteditable="true"', '')).join('')}</div>
      <footer class="page-num">— ${i + 1} —</footer></article>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <link rel="stylesheet" href="${abs('../../node_modules/@fontsource-variable/caveat/index.css')}">
    <link rel="stylesheet" href="${abs('../../node_modules/@fontsource-variable/nunito/index.css')}">
    <link rel="stylesheet" href="${abs('styles.css')}"><link rel="stylesheet" href="${abs('notes.css')}">
    <style>html,body{overflow:visible!important;height:auto!important;background:#fff!important}body{padding:0;margin:0}
    .print-page{margin:0 auto 24px;page-break-after:always;break-after:page;box-shadow:none!important;border:1px solid #e8e0d2}
    .print-page:last-child{page-break-after:auto}.print-title{font-family:'Caveat Variable','Ink Free','Segoe Print',cursive;font-size:40px;text-align:center;margin:10px 0 18px;color:#3A3A3D}</style></head>
    <body><div class="print-title">${esc(title)}</div>${sheets}</body></html>`;
}
async function exportPdf(which) {
  commitEditor();
  const nb = curNb();
  const pages = which === 'page' && curPg() ? [curPg()] : pagesOf(nb.id);
  if (!pages.length) { H().toast('No pages to export yet', { ic: 'file' }); return; }
  const title = which === 'page' ? `${nb.name}: ${pageLabel(pages[0], pagesOf(nb.id).indexOf(pages[0]))}` : nb.name;
  H().toast('Preparing PDF…', { ic: 'file', timeout: 2500 });
  const ok = await H().api.exportPdf(printHtml(nb, pages, title), title);
  if (ok) H().toast('PDF saved', { ic: 'file' });
}

// ------------------------------------------------------------------ Today desk card
function deskCard() {
  const items = [];
  D().pages.forEach(pg => (pg.stickies || []).forEach(s => { if (s.onDesk && getNb(pg.notebookId)) items.push({ s, pg }); }));
  if (!items.length) return '';
  return `<div class="card desk-card" data-k="c-desk"><h3>${icon('sticky', 'sm')} On your desk</h3>
    <div class="desk-stickies">${items.slice(0, 6).map(({ s, pg }) => `<button class="mini-sticky s-${s.color}" style="--rot:${s.rot || 0}deg" data-act="open-note" data-nb="${pg.notebookId}" data-pg="${pg.id}" title="Open the page">
      <span class="pin"></span><span class="txt">${esc(s.text || '…').replace(/\n/g, '<br>')}</span></button>`).join('')}</div></div>`;
}

// ------------------------------------------------------------------ public actions
const actions = {
  'nq-clear': () => { ns.query = ''; renderShelf(); clearHighlight(); },
  'nb-click': (el, id, row, e) => {
    const nbId = el.dataset.nb;
    if (nbId === ns.nbId) return actions['nb-toggle'](el);
    ns.expanded[nbId] = true; ns.justToggled = nbId;
    const nb = getNb(nbId);
    const target = nb.lastPg && getPg(nb.lastPg) ? nb.lastPg : (pagesOf(nbId)[0] || {}).id || null;
    turnTo(nbId, target);
  },
  'nb-toggle': (el) => {
    const id = el.dataset.nb;
    const box = $(`.nb[data-nb="${id}"] .nb-pages`);
    if (ns.expanded[id] && box && !REDUCED) {
      box.animate([{ height: box.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 260, easing: H().EASE, fill: 'forwards' })
        .finished.then(() => { ns.expanded[id] = false; persist(); renderShelf(); });
      return;
    }
    ns.expanded[id] = !ns.expanded[id];
    if (ns.expanded[id]) ns.justToggled = id;
    persist(); renderShelf();
  },
  'nb-open': (el) => actions['nb-click'](el),
  'pg-open': (el) => {
    const pg = el.dataset.pg || null;
    if (el.dataset.hl) ns.expanded[el.dataset.nb] = true;
    if (el.dataset.nb === ns.nbId && pg === ns.pgId) { if (ns.query.trim()) highlightSearch(ns.query.trim()); return; }
    turnTo(el.dataset.nb, pg);
    if (ns.query.trim()) setTimeout(() => highlightSearch(ns.query.trim()), 950);
  },
  'pg-prev': () => step(-1),
  'pg-next': () => step(1),
  'pg-new': (el) => { const nbId = el.dataset.nb || ns.nbId; const pg = createPage(nbId); H().save(); turnTo(nbId, pg.id, 1); setTimeout(() => $('#page-title')?.focus(), 950); },
  'pg-new-blank': () => actions['pg-new']({ dataset: { nb: ns.nbId } }),
  'pg-new-tpl': (el) => {
    closeMenu();
    const pg = createPage(ns.nbId, el.dataset.v); H().save(); turnTo(ns.nbId, pg.id, 1);
    setTimeout(() => { const t = $('#page-title'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 950);
  },
  'tpl-save': () => {
    closeMenu(); commitEditor();
    const pg = curPg(); if (!pg) return;
    const name = (pg.title || '').replace(/[:\s]+$/, '').trim() || 'My template';
    const t = document.createElement('template'); t.innerHTML = pg.html || '';
    $$('[data-task]', t.content).forEach(x => x.removeAttribute('data-task'));
    $$('.tasked', t.content).forEach(x => x.replaceWith(...x.childNodes));
    $$('ul.checks li.checked', t.content).forEach(x => x.classList.remove('checked'));
    D().noteTemplates.push({ id: nid('tp'), name, title: pg.title || '', html: t.innerHTML, createdAt: Date.now() });
    H().save();
    H().toast(`Saved "${name}" as a template. Find it under + Page.`, { ic: 'template' });
  },
  'tpl-del': (el) => {
    const snap = H().snapshot();
    D().noteTemplates = D().noteTemplates.filter(t => t.id !== el.dataset.v);
    H().save(); closeMenu();
    H().undoable('Template deleted', snap, 'trash');
  },
  'checklist-add': () => { if (ns.tool !== 'type') setTool('type'); insertChecklist(); },
  'pg-new-meeting': () => { closeMenu(); const pg = createPage(ns.nbId, 'meeting'); H().save(); turnTo(ns.nbId, pg.id, 1); setTimeout(() => { const t = $('#page-title'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 950); },
  'pg-ribbon': () => {
    closeMenu();
    const pg = curPg(); if (!pg) return;
    pg.bookmarked = !pg.bookmarked; touch(pg); H().save();
    const r = $('#page .ribbon'); if (r) { r.classList.toggle('on', pg.bookmarked); r.title = pg.bookmarked ? 'Remove ribbon' : 'Mark this page with a ribbon'; }
    renderShelf();
    H().toast(pg.bookmarked ? 'Ribbon added: find it under Ribbons' : 'Ribbon removed', { ic: 'ribbon' });
  },
  'pg-delete': () => {
    closeMenu();
    const pg = curPg(); if (!pg) return;
    const snap = H().snapshot();
    const list = pagesOf(ns.nbId); const idx = list.indexOf(pg);
    const nextId = (list[idx - 1] || list[idx + 1] || {}).id || null;
    D().pages = D().pages.filter(p => p.id !== pg.id);
    D().tasks.forEach(t => { if (t.noteRef && t.noteRef.pageId === pg.id) delete t.noteRef; });
    ns.pgId = '__gone__';
    H().save();
    turnTo(ns.nbId, nextId, -1);
    H().undoable('Page deleted', snap, 'trash');
  },
  'go-cover': () => { closeMenu(); turnTo(ns.nbId, null, -1); },
  'journal-today': () => { closeMenu(); const pg = journalPage(H().today()); H().save(); turnTo(pg.notebookId, pg.id); },
  'nb-new': () => {
    closeMenu();
    const nb = createNotebook();
    H().save();
    ns.expanded[nb.id] = true; ns.justToggled = nb.id;
    turnTo(nb.id, null, 1);
    setTimeout(() => { const i = $('#nb-name'); if (i) { i.focus(); i.select(); } }, 950);
  },
  'nb-color': (el) => { const nb = curNb(); nb.color = el.dataset.v; H().save(); const keep = $('#desk').scrollTop; renderDesk(); $('#desk').scrollTop = keep; renderShelf(); },
  'nb-paper': (el) => { const nb = curNb(); nb.paper = el.dataset.v; H().save(); renderCoverBody(); },
  'nb-delete': () => {
    const nb = curNb(); const snap = H().snapshot();
    const ids = new Set(pagesOf(nb.id).map(p => p.id));
    D().pages = D().pages.filter(p => !ids.has(p.id));
    D().notebooks = D().notebooks.filter(n => n.id !== nb.id);
    D().tasks.forEach(t => { if (t.noteRef && ids.has(t.noteRef.pageId)) delete t.noteRef; });
    const next = notebooks()[0];
    ns.nbId = '__gone__';
    H().save();
    turnTo(next.id, (pagesOf(next.id)[0] || {}).id || null, -1);
    H().undoable(`Deleted "${nb.name}"`, snap, 'trash');
  },
  'sticky-add': () => { if (ns.tool !== 'type') setTool('type'); addSticky(); },
  'st-color': (el) => { const s = stickyOf(el); s.color = el.dataset.v; const st = el.closest('.sticky'); STICKY_COLOURS.forEach(c => st.classList.toggle('s-' + c, c === s.color)); $$('.sdot', st).forEach(d => d.classList.toggle('on', d.dataset.v === s.color)); touch(curPg()); H().save(); },
  'st-attach': (el) => {
    const s = stickyOf(el); s.attach = s.attach === 'clip' ? 'pin' : 'clip'; touch(curPg()); H().save();
    const old = el.closest('.sticky'); const tmp = document.createElement('div'); tmp.innerHTML = stickyHtml(s);
    const fresh = tmp.firstElementChild; old.replaceWith(fresh);
    const f = fresh.querySelector('.clip, .pin');
    if (f && !REDUCED) f.animate([{ transform: 'translateY(-16px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.3,1.5,.5,1)' });
  },
  'st-desk': (el) => {
    const s = stickyOf(el); s.onDesk = !s.onDesk; touch(curPg()); H().save();
    el.classList.toggle('lit', s.onDesk); el.closest('.sticky').classList.toggle('on-desk', s.onDesk);
    el.title = s.onDesk ? 'Remove from your Today desk' : 'Pin to your Today desk';
    H().toast(s.onDesk ? 'Pinned to your Today desk' : 'Taken off your desk', { ic: 'sun' });
  },
  'st-del': (el) => removeSticky(el.closest('.sticky')),
  tool: (el) => setTool(el.dataset.v),
  pen: (el) => { ns.pen = el.dataset.v; persist(); renderToolbarOnly(); },
  'ink-undo': () => { const pg = curPg(); if (pg && pg.strokes && pg.strokes.length) { pg.strokes.pop(); drawInk(); touch(pg); H().save(); } },
  menu: (el) => { if ($('.menu')) { closeMenu(); return; } openMenu(el, el.dataset.menu); },
  'pdf-page': () => { closeMenu(); exportPdf('page'); },
  'pdf-notebook': () => { closeMenu(); exportPdf('notebook'); }
};

// ------------------------------------------------------------------ entry points used by the rest of Hearth
function open(nbId, pgId) {
  const nb = getNb(nbId); if (!nb) return;
  const target = pgId === undefined || pgId === null ? (nb.lastPg && getPg(nb.lastPg) ? nb.lastPg : (pagesOf(nbId)[0] || {}).id || null) : pgId;
  if (H().state.view !== 'notes') { ns.nbId = nbId; ns.pgId = target; ns.expanded[nbId] = true; persist(); H().go('notes'); }
  else turnTo(nbId, target);
}
function openJournal() {
  const pg = journalPage(H().today()); H().save();
  open(pg.notebookId, pg.id);
}
function createForProject(pid) {
  const p = H().P.get(pid); if (!p) return;
  const nb = createNotebook({ name: p.name, color: p.color, projectId: pid });
  H().save();
  ns.nbId = null;
  open(nb.id, null);
  H().toast('Notebook started for this project', { ic: 'book' });
}
function external() {
  if (H().state.view !== 'notes') return;
  renderShelf();
  const pg = curPg(); const layer = $('#stickies');
  if (pg && layer && !layer.contains(document.activeElement)) {
    const have = new Set($$('.sticky', layer).map(e => e.dataset.sid));
    (pg.stickies || []).forEach(s => { if (!have.has(s.id)) layer.insertAdjacentHTML('beforeend', stickyHtml(s)); });
  }
}

window.Notes = { view, mount, light, leave, actions, open, openJournal, journalWrap, deskCard, createForProject, external };
})();
