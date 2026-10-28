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
// fonts for notebook pages. s = size relative to the handwriting (Caveat 25px) so each one reads at a similar size
const FONTS = {
  hand: { name: 'Handwriting', css: "var(--hand)", s: 1 },
  calibri: { name: 'Calibri', css: "Calibri, Carlito, 'Segoe UI', sans-serif", s: .66 },
  segoe: { name: 'Segoe UI', css: "'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif", s: .62 },
  nunito: { name: 'Nunito (rounded)', css: "'Nunito Variable', Nunito, 'Segoe UI', sans-serif", s: .64 },
  arial: { name: 'Arial', css: "Arial, 'Liberation Sans', Helvetica, sans-serif", s: .62 },
  verdana: { name: 'Verdana', css: "Verdana, 'DejaVu Sans', sans-serif", s: .58 },
  georgia: { name: 'Georgia', css: "Georgia, 'DejaVu Serif', serif", s: .64 },
  times: { name: 'Times New Roman', css: "'Times New Roman', 'Liberation Serif', Times, serif", s: .7 },
  fraunces: { name: 'Fraunces (book)', css: "'Fraunces Variable', Fraunces, Georgia, serif", s: .66 },
  print: { name: 'Neat print', css: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', var(--hand)", s: .6 },
  comic: { name: 'Comic Sans', css: "'Comic Sans MS', 'Comic Neue', 'Segoe Print', cursive", s: .62 },
  mono: { name: 'Consolas (code)', css: "Consolas, 'JetBrains Mono', 'Cascadia Mono', monospace", s: .6 }
};
const isSimple = (nb) => !!nb && nb.style === 'simple';
// the font every notebook uses: 'auto' = handwriting in book notebooks and Calibri in simple ones
function fontKey(nb) {
  const k = (H().D.settings || {}).noteFont || 'auto';
  if (k !== 'auto' && FONTS[k]) return k;
  return isSimple(nb) ? 'calibri' : 'hand';
}
function fontVars(nb) {
  const f = FONTS[fontKey(nb)];
  return `--nf:${f.css.replace(/"/g, "'")};--s:${f.s}`;
}
function fontClass(nb) { return fontKey(nb) === 'hand' ? '' : 'plainfont'; }
function fontMenuItems(onPick, current, opts = {}) {
  const items = [];
  if (opts.auto) items.push({ label: 'Automatic', ic: current === 'auto' ? 'check' : 'dot', hint: 'hand / plain', fn: () => onPick('auto') });
  if (opts.reset) items.push({ label: 'Page font (remove)', ic: 'x', fn: () => onPick('none') });
  if (items.length) items.push('-');
  Object.entries(FONTS).forEach(([k, f]) => items.push({ label: f.name, ic: current === k ? 'check' : 'dot', font: f.css, fn: () => onPick(k) }));
  return items;
}
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
const byOrd = (a, b) => (a.order || 0) - (b.order || 0);
function chaptersOf(nb) { return nb && nb.kind !== 'journal' ? (nb.chapters || []).slice().sort(byOrd) : []; }
function chapterOf(nb, pg) { return pg.chapterId ? (nb.chapters || []).find(c => c.id === pg.chapterId) || null : null; }
// display order: loose pages first, then each chapter's pages
function pagesOf(nbId) {
  const nb = getNb(nbId);
  const list = D().pages.filter(p => p.notebookId === nbId);
  if (nb && nb.kind === 'journal') return list.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.order - a.order);
  const chaps = chaptersOf(nb);
  const ids = new Set(chaps.map(c => c.id));
  const loose = list.filter(p => !p.chapterId || !ids.has(p.chapterId)).sort(byOrd);
  return loose.concat(...chaps.map(c => list.filter(p => p.chapterId === c.id).sort(byOrd)));
}
function groupOf(pg) {
  const nb = getNb(pg.notebookId);
  const ch = nb ? chapterOf(nb, pg) : null;
  return pagesOf(pg.notebookId).filter(p => (ch ? p.chapterId === ch.id : !chapterOf(nb, p)));
}
function renumber(list) { list.forEach((p, i) => { p.order = i + 1; }); }
const curNb = () => getNb(ns.nbId);
const curPg = () => (ns.pgId ? getPg(ns.pgId) : null);
function persist() {
  D().meta.notes = { nbId: ns.nbId, pgId: ns.pgId, expanded: ns.expanded, tool: ns.tool, pen: ns.pen, shelfHidden: !!ns.shelfHidden };
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
    paper: opts.paper || 'lined', style: opts.style === 'simple' ? 'simple' : 'book', kind: opts.kind || 'normal', projectId: opts.projectId || null,
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
function placeAfter(pg, ref) {
  // put pg straight after ref, in ref's chapter
  pg.chapterId = ref.chapterId || null;
  const g = groupOf(ref).filter(p => p.id !== pg.id);
  g.splice(g.indexOf(ref) + 1, 0, pg);
  renumber(g);
}
function placeAtEnd(pg, nbId, chapterId) {
  pg.notebookId = nbId; pg.chapterId = chapterId || null;
  const nb = getNb(nbId);
  const g = pagesOf(nbId).filter(p => p.id !== pg.id && (chapterId ? p.chapterId === chapterId : !chapterOf(nb, p)));
  g.push(pg); renumber(g);
}
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
  const m = D().meta.notes || {};
  if (ns.shelfHidden == null) ns.shelfHidden = !!m.shelfHidden;
  return `<div class="notes ${ns.shelfHidden ? 'shelf-hidden' : ''}" id="notes"><aside class="shelf" id="shelf"></aside><section class="desk" id="desk"></section></div>`;
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
  commitEditor(true);
  lockAll(); selectShape(null);
  closeLightbox();
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
function pgRowHtml(nb, p, i) {
  return `<button class="pg-row ${p.id === ns.pgId ? 'active' : ''}" data-act="pg-open" data-nb="${nb.id}" data-pg="${p.id}" data-drag-pg="${p.id}" title="Right-click for options">
        <span class="pg-num">${nb.kind === 'journal' ? '' : i + 1}</span><span class="t">${esc(pageLabel(p, i))}</span>
        ${p.bookmarked ? `<span class="rib-dot" style="--c:${nb.color}"></span>` : ''}${(p.stickies || []).length ? `<span class="st-dot" title="${p.stickies.length} sticky notes"></span>` : ''}${(p.images || []).length ? `<span class="im-dot" title="${p.images.length} pictures">${icon('image', 'sm')}</span>` : ''}</button>`;
}
function nbRow(nb) {
  const pages = pagesOf(nb.id);
  const open = !!ns.expanded[nb.id];
  const active = nb.id === ns.nbId;
  const ic = nb.kind === 'journal' ? 'calendar' : nb.kind === 'inbox' ? 'sticky' : 'book';
  const chaps = chaptersOf(nb);
  const loose = pages.filter(p => !chapterOf(nb, p));
  return `<div class="nb ${active ? 'active' : ''}" data-nb="${nb.id}">
    <button class="nb-row" data-act="nb-click" data-nb="${nb.id}" title="Right-click for options">
      <span class="nb-spine" style="--c:${nb.color}">${icon(ic, 'sm')}</span>
      <span class="nb-name">${esc(nb.name)}</span><span class="nb-count">${pages.length}</span>
      <span class="nb-chev ${open ? 'open' : ''}" data-act="nb-toggle" data-nb="${nb.id}">${icon('chevron', 'sm')}</span>
    </button>
    ${open ? `<div class="nb-pages">
      ${loose.map(p => pgRowHtml(nb, p, pages.indexOf(p))).join('')}
      ${chaps.map(c => {
        const cp = pages.filter(p => p.chapterId === c.id);
        const hasActive = cp.some(p => p.id === ns.pgId);
        return `<div class="chap ${c.collapsed ? 'closed' : ''} ${hasActive ? 'has-active' : ''}" data-chap="${c.id}">
          <button class="chap-row" data-act="chap-toggle" data-nb="${nb.id}" data-chap="${c.id}" title="Right-click for options">
            <span class="chap-chev">${icon('chevron', 'sm')}</span>${icon('folder', 'sm')}<span class="t">${esc(c.name)}</span><span class="nb-count">${cp.length}</span></button>
          ${c.collapsed ? '' : `<div class="chap-pages" data-chap-drop="${c.id}" data-nb="${nb.id}">${cp.map(p => pgRowHtml(nb, p, pages.indexOf(p))).join('') || '<div class="chap-empty">Empty chapter: drag pages here</div>'}</div>`}
        </div>`;
      }).join('')}
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
    <div class="book-area ${isSimple(nb) ? 'simple' : ''}">
      <div class="book" style="--nb:${nb.color}">
        <div class="book-cover"></div>
        <div class="spine"></div>
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
  const simple = isSimple(nb);
  const made = new Date(pg.createdAt);
  return `<article class="page paper-${simple ? 'plain' : nb.paper || 'lined'} ${fontClass(nb)} ${ns.tool !== 'type' ? 'inking tool-' + ns.tool : ''}" id="page" data-pg="${pg.id}" style="${fontVars(nb)}">
    <button class="ribbon ${pg.bookmarked ? 'on' : ''}" data-act="pg-ribbon" title="${pg.bookmarked ? 'Remove ribbon' : 'Mark this page with a ribbon'}" style="--c:${nb.color}"></button>
    <header class="nhead"><input class="page-title" id="page-title" value="${esc(pg.title || '')}" placeholder="${nb.kind === 'journal' ? '' : 'Page title'}" maxlength="120" autocomplete="off">
      <span class="page-date">${simple ? `${esc(made.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}<span class="page-time">${esc(made.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))}</span>` : esc(H().fmtShort(H().dayKey(made)))}</span></header>
    <div class="page-body" id="page-body" contenteditable="${ns.tool === 'type' ? 'true' : 'false'}" spellcheck="true" data-placeholder="Start writing… paste links or pictures, or add a sticky note.">${pg.html || ''}</div>
    <canvas class="ink" id="ink"></canvas>
    <div class="photos" id="photos">${(pg.images || []).map(photoHtml).join('')}</div>
    <svg class="shapes" id="shapes"></svg>
    <div class="stickies" id="stickies">${(pg.stickies || []).map(stickyHtml).join('')}</div>
    ${coffee && !simple ? `<svg class="coffee" viewBox="0 0 120 120" style="--r:${hash(pg.id) % 360}deg"><circle cx="60" cy="60" r="46" fill="none" stroke="#8B5A2B" stroke-width="7" stroke-dasharray="210 18 40 22" opacity=".09"/><circle cx="60" cy="60" r="41" fill="none" stroke="#8B5A2B" stroke-width="1.5" opacity=".07"/><circle cx="64" cy="58" r="39" fill="#8B5A2B" opacity=".025"/></svg>` : ''}
    <footer class="page-num">— ${nb.kind === 'journal' ? esc(H().fmtShort(pg.date || H().today())) : idx + 1} —</footer>
  </article>`;
}

function stickyHtml(s) {
  const fastener = s.attach === 'clip'
    ? `<svg class="clip" viewBox="0 0 24 60"><path d="M8 40V12a4.5 4.5 0 0 1 9 0v34a7 7 0 0 1-14 0V16" fill="none" stroke-width="2.4" stroke-linecap="round"/></svg>`
    : '<span class="pin"></span>';
  const open = s.locked && unlocked.has(s.id);
  const body = !s.locked ? `<div class="sticky-text" contenteditable="true" spellcheck="true" data-placeholder="Write something…">${esc(s.text || '').replace(/\n/g, '<br>')}</div>`
    : open ? `<div class="sticky-text" contenteditable="true" spellcheck="false" data-placeholder="Write something private…">${esc(unlocked.get(s.id).text || '').replace(/\n/g, '<br>')}</div>`
    : `<div class="lock-face" data-act="st-unlock">${icon('lock')}<b>Locked note</b><span>Click to unlock</span></div>`;
  return `<div class="sticky s-${s.color || 'yellow'} at-${s.attach || 'pin'} ${s.onDesk ? 'on-desk' : ''} ${s.locked ? 'locked' : ''} ${open ? 'unlocked' : ''}" data-sid="${s.id}" style="left:${s.x}%;top:${s.y}px;--rot:${s.rot || 0}deg">
    ${fastener}
    ${s.locked ? `<span class="lock-badge" title="${open ? 'Unlocked for now' : 'Password protected'}">${icon(open ? 'unlock' : 'lock', 'sm')}</span>` : ''}
    ${body}
    <div class="sticky-tools">
      ${STICKY_COLOURS.map(c => `<button class="sdot s-${c} ${s.color === c ? 'on' : ''}" data-act="st-color" data-v="${c}" title="${c}"></button>`).join('')}
      <span class="sep"></span>
      <button class="icon-btn mini" data-act="st-attach" title="${s.attach === 'clip' ? 'Use a pin' : 'Use a paperclip'}">${icon(s.attach === 'clip' ? 'pin' : 'clip', 'sm')}</button>
      ${s.locked ? (open ? `<button class="icon-btn mini" data-act="st-lock" title="Lock it again">${icon('lock', 'sm')}</button>` : '') : `<button class="icon-btn mini ${s.onDesk ? 'lit' : ''}" data-act="st-desk" title="${s.onDesk ? 'Remove from your Today desk' : 'Pin to your Today desk'}">${icon('sun', 'sm')}</button>`}
      <button class="icon-btn mini danger" data-act="st-del" title="Remove">${icon('trash', 'sm')}</button>
    </div>
  </div>`;
}

function coverHtml(nb) {
  return `<article class="page cover-page ${fontClass(nb)}" id="page" style="--nb:${nb.color};${fontVars(nb)}">
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
      <div class="field"><label>Style</label><div class="papers">${[['book', 'Book', 'Pages that turn'], ['simple', 'Simple', 'Full width, plain']].map(([v, l, t]) => `<button class="paper-opt style-opt st-${v} ${(nb.style || 'book') === v ? 'on' : ''}" data-act="nb-style" data-v="${v}" title="${t}"><i></i><span>${l}</span></button>`).join('')}</div></div>
      ${isSimple(nb) ? '' : `<div class="field"><label>Paper</label><div class="papers">${PAPERS.map(([v, l]) => `<button class="paper-opt paper-${v} ${nb.paper === v ? 'on' : ''}" data-act="nb-paper" data-v="${v}"><i></i><span>${l}</span></button>`).join('')}</div></div>`}
      <div class="field"><label>Linked project</label><select class="select" id="nb-project"><option value="">Not linked</option>${projects.map(x => `<option value="${x.id}" ${x.id === nb.projectId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    </div>
    ${p ? `<div class="cover-section"><h4>${icon('folder', 'sm')} ${esc(p.name)}: open tasks</h4>
      ${p.nextAction ? `<div class="cover-next"><b>Next:</b> ${esc(p.nextAction)}</div>` : ''}
      <div class="cover-tasks">${ptasks.length ? ptasks.map(t => `<div class="ctask" data-id="${t.id}"><button class="check" data-act="toggle"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button><span>${esc(t.title)}</span>
        ${t.date === H().today() ? '<span class="chip accent">Today</span>' : `<button class="pill-btn sage" data-act="today">${icon('sun', 'sm')} Today</button>`}</div>`).join('') : '<div class="muted">No open tasks on this project.</div>'}</div></div>` : ''}
    <div class="cover-section"><h4>${icon('note', 'sm')} Contents</h4>
      <ol class="contents">${pages.map((pg, i) => {
        const ch = chapterOf(nb, pg); const prev = pages[i - 1];
        const head = ch && (!prev || prev.chapterId !== ch.id) ? `<li class="ch-head">${icon('folder', 'sm')} ${esc(ch.name)}</li>` : '';
        return `${head}<li class="${ch ? 'in-ch' : ''}"><button data-act="pg-open" data-nb="${nb.id}" data-pg="${pg.id}"><span class="t">${esc(pageLabel(pg, i))}</span><span class="dots"></span><span class="n">${nb.kind === 'journal' ? esc(H().fmtShort(pg.date || '')) : i + 1}</span>${pg.bookmarked ? `<span class="rib-dot" style="--c:${nb.color}"></span>` : ''}</button></li>`;
      }).join('') || '<li class="muted">No pages yet.</li>'}</ol>
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
  migrateInlinePhotos();
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
  const stickBottom = Math.max(0, ...$$('#stickies .sticky, #photos .photo', page).map(el => el.offsetTop + el.offsetHeight + 60),
    ...(pg.shapes || []).map(sh => Math.max(sh.y1, sh.y2) + 60));
  const inkBottom = Math.max(0, ...(pg.strokes || []).flatMap(s => s.pts.map(p => p[1] + 40)));
  const r = document.createRange(); r.selectNodeContents(body);
  const content = body.childNodes.length ? r.getBoundingClientRect().bottom - page.getBoundingClientRect().top : body.offsetTop;
  const want = Math.max(isSimple(curNb()) ? Math.round(innerHeight * .78) : Math.round(w * 1.32), Math.round(content) + 160, stickBottom, inkBottom);
  if (Math.abs(page.offsetHeight - want) > 2) page.style.minHeight = want + 'px';
  if (pg.w !== w || !$('#shapes').dataset.r) renderShapes();
  pg.w = w; pg.h = page.offsetHeight;
  const sv = $('#shapes'); if (sv) sv.setAttribute('height', page.offsetHeight);
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

function commitEditor(final) {
  clearTimeout(editTimer);
  const body = $('#page-body'), pg = curPg();
  if (final && body && pg && trimTrailing(body)) body.dataset.dirty = '1';
  if (body && pg && body.dataset.dirty) {
    pg.html = cleanHtml(body.innerHTML);
    delete body.dataset.dirty;
    touch(pg);
    H().save();
  }
}
// empty lines left at the very end (e.g. after clicking far down and not typing) are dropped,
// unless they hold space for a picture or sticky
function trimTrailing(body) {
  const keepTo = Math.max(0, ...$$('#photos .photo').map(el => el.offsetTop + el.offsetHeight)) - body.offsetTop;
  let n = 0;
  while (body.lastChild) {
    const el = body.lastChild;
    const empty = (el.nodeType === 3 && !el.textContent.trim()) ||
      (el.nodeType === 1 && /^(DIV|P)$/.test(el.tagName) && !el.textContent.trim() && !el.querySelector('img,.nlink,ul,ol'));
    if (!empty) break;
    if (el.nodeType === 1 && el.offsetTop < keepTo) break;
    el.remove(); n++;
  }
  return n;
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
  $$('iframe, video', c).forEach(x => { const d = document.createElement('div'); d.className = 'vid-ph'; d.innerHTML = icon('video'); x.replaceWith(d); });
  $$('.shape-sel, .sel-bar', c).forEach(x => x.remove());
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
  commitEditor(true);
  lockAll(); selectShape(null);
  if (ns.tool === 'shape') ns.tool = 'type';
  const tp = pgId && getPg(pgId), tnb = getNb(nbId);
  if (tp && tnb) { const ch = chapterOf(tnb, tp); if (ch && ch.collapsed) ch.collapsed = false; }
  processActions(curPg());
  hideSelbar(); closeMenu();
  const oldPage = $('#page');
  const plainSwap = isSimple(curNb()) || isSimple(getNb(nbId));
  const oldSnap = oldPage && !REDUCED && !plainSwap ? snapshot(oldPage) : null;
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
  if (plainSwap && !REDUCED) { const np = $('#page'); np && np.animate([{ opacity: 0, transform: `translateX(${dir > 0 ? 14 : -14}px)` }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.7,.2,1)' }); return; }
  if (!oldSnap) return;
  window.Sound && Sound.play('page');
  const wrap = $('#page-wrap'), newPage = $('#page');
  if (!wrap || !newPage) return;
  // one continuous, eased swing (no keyframe "kinks"), started on the next frame so layout has settled
  const dur = 820, ease = 'cubic-bezier(.42, 0, .22, 1)';
  const cast = document.createElement('div'); cast.className = 'turn-cast'; wrap.appendChild(cast);
  let f, under = null;
  if (dir > 0) { f = flipper(oldSnap, oldH); }
  else { under = document.createElement('div'); under.className = 'flip-under'; under.appendChild(oldSnap); wrap.appendChild(under); f = flipper(snapshot(newPage), newPage.offsetHeight); }
  f.style.transform = dir > 0 ? 'rotateY(0deg)' : 'rotateY(-180deg)';
  wrap.appendChild(f);
  const shade = f.querySelector('.turn-shade'), back = f.querySelector('.back');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const from = dir > 0 ? 0 : -180, to = dir > 0 ? -180 : 0;
    f.animate([{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }], { duration: dur, easing: ease, fill: 'forwards' });
    // the page darkens as it lifts towards you and lightens as it lands
    shade.animate([{ opacity: dir > 0 ? 0 : .35 }, { opacity: .3, offset: .5 }, { opacity: dir > 0 ? .35 : 0 }], { duration: dur, easing: ease, fill: 'forwards' });
    back.animate([{ filter: 'brightness(.88)' }, { filter: 'brightness(1)' }], { duration: dur, easing: ease, fill: 'forwards' });
    cast.animate([{ opacity: dir > 0 ? .35 : 0 }, { opacity: .25, offset: .55 }, { opacity: 0 }], { duration: dur, easing: 'ease-out', fill: 'forwards' });
    setTimeout(() => { f.remove(); cast.remove(); under && under.remove(); }, dur + 40);
  }));
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
    if (ns.tool === 'shape') { shapeDown(e, c); cur = { shaping: true }; return; }
    const pg = curPg(); pg.strokes = pg.strokes || [];
    if (ns.tool === 'eraser') { cur = { erasing: true }; erase(e); return; }
    cur = { tool: ns.tool === 'hl' ? 'hl' : 'pencil', color: PENS[ns.pen] || PENS.graphite, pts: [pos(e).map(v => +v.toFixed(2))] };
    pg.strokes.push(cur);
    drawInk();
  };
  c.onpointermove = (e) => {
    if (!cur) return;
    if (cur.shaping) { shapeMove(e, c); return; }
    if (cur.erasing) { erase(e); return; }
    const p = pos(e).map(v => +v.toFixed(2));
    const last = cur.pts[cur.pts.length - 1];
    if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < .35) return;
    cur.pts.push(p);
    drawInk();
  };
  c.onpointerup = c.onpointercancel = (e) => {
    if (!cur) return;
    if (cur.shaping) { cur = null; shapeUp(e, c); return; }
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
  if (!st || e.button !== 0 || e.target.closest('.sticky-tools') || e.target.closest('.lock-form')) return;
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
// ------------------------------------------------------------------ pictures (free-floating, like taped-in photos)
function photoHtml(im) {
  const inner = im.kind === 'yt' ? `<div class="vid-wrap"><iframe src="${esc(im.src)}" title="Video" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe></div>`
    : im.kind === 'video' ? `<div class="vid-wrap"><video src="${esc(im.src)}" controls preload="metadata" playsinline></video></div>`
    : `<img src="${esc(im.src)}" alt="" draggable="false">`;
  return `<figure class="photo free ${im.kind ? 'is-video' : ''}" data-iid="${im.id}" style="left:${im.x}%;top:${im.y}px;width:${im.w}px;--rot:${im.rot || 0}deg">
    ${inner}${im.kind ? `<span class="vid-grip" title="Drag to move">${icon('grip', 'sm')}${esc(im.label || 'Video')}</span>` : '<span class="tape"></span>'}
    <button class="ph-del" data-act="img-del" title="Remove picture">${icon('x', 'sm')}</button>
    <i class="ph-rz" title="Drag to resize"></i></figure>`;
}
const imageOf = (el) => { const pg = curPg(); const id = el.closest('.photo')?.dataset.iid; return pg && (pg.images || []).find(i => i.id === id); };
function readAsDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
function naturalSize(src) {
  return new Promise(res => { const im = new Image(); im.onload = () => res([im.naturalWidth || 300, im.naturalHeight || 200]); im.onerror = () => res([300, 200]); im.src = src; });
}
function topBlock(node) {
  const body = $('#page-body');
  let b = node && (node.nodeType === 1 ? node : node.parentNode);
  while (b && b.parentNode !== body) { if (b === body || !b.parentNode) return null; b = b.parentNode; }
  return b && b !== body ? b : null;
}
const LINE = 34;
// the real line height (simple notebooks and plain fonts use tighter lines than the lined paper)
function lineH() { const b = $('#page-body'); return (b && parseFloat(getComputedStyle(b).lineHeight)) || LINE; }
function emptyLine() { const d = document.createElement('div'); d.appendChild(document.createElement('br')); return d; }
/** Add a picture to the page. With `at` (a drop point) it lands there; otherwise it's taped in at the
 *  caret and the text below makes room for it. */
async function addPicture(src, at) {
  const pg = curPg(), page = $('#page'), body = $('#page-body'); if (!pg || !page) return;
  const pw = page.clientWidth;
  const [nw, nh] = await naturalSize(src);
  const w = Math.round(Math.max(120, Math.min(nw, 380, pw * .6)));
  const h = Math.round(w * nh / nw) + 32;
  const pr = page.getBoundingClientRect();
  let x, y;
  if (at) {
    x = at.x - pr.left - w / 2; y = at.y - pr.top - 20;
  } else {
    const sel = getSelection();
    let blk = sel.rangeCount && body.contains(sel.anchorNode) ? topBlock(sel.anchorNode) : null;
    if (!blk) { blk = emptyLine(); body.appendChild(blk); }
    const hasText = !!blk.textContent.trim() || !!blk.querySelector('img,.nlink');
    const br = blk.getBoundingClientRect();
    x = 96; y = (hasText ? br.bottom : br.top) - pr.top + 8;
    const lines = Math.ceil((h + 20) / lineH()) - (hasText ? 0 : 1);
    let last = blk;
    for (let i = 0; i < lines; i++) { const d = emptyLine(); last.after(d); last = d; }
    const caretLine = emptyLine(); last.after(caretLine);
    const r = document.createRange(); r.setStart(caretLine, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
    bodyChanged();
  }
  x = Math.max(-w * .2, Math.min(pw - w * .8, x));
  const im = { id: nid('im'), src, x: +(x / pw * 100).toFixed(2), y: Math.max(0, Math.round(y)), w, rot: +(Math.random() * 4 - 2).toFixed(1) };
  pg.images = pg.images || [];
  pg.images.push(im);
  touch(pg); H().save();
  const layer = $('#photos');
  layer.insertAdjacentHTML('beforeend', photoHtml(im));
  const el = layer.lastElementChild;
  if (!REDUCED) el.animate([{ opacity: 0, transform: `translateY(-30px) rotate(${im.rot - 6}deg) scale(1.04)` }, { opacity: 1, transform: `rotate(${im.rot}deg)` }], { duration: 480, easing: 'cubic-bezier(.3,.8,.3,1)' });
  window.Sound && Sound.play('stick');
  el.querySelector('img').addEventListener('load', fitPage, { once: true });
  fitPage();
}
async function insertImages(files, at) {
  let off = 0;
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue;
    const data = await readAsDataUrl(f);
    const src = (await H().api.saveImage(data)) || data;
    await addPicture(src, at ? { x: at.x + off, y: at.y + off } : null);
    off += 24;
  }
}
// older versions put pictures inside the text, where dragging them made copies; lift them out onto the page
function migrateInlinePhotos() {
  const pg = curPg(), page = $('#page'), body = $('#page-body');
  if (!pg || !body) return;
  const outer = $$('.photo', body).filter(ph => !ph.parentElement.closest('.photo'));
  if (!outer.length) return;
  const pr = page.getBoundingClientRect(), pw = page.clientWidth;
  pg.images = pg.images || [];
  const seen = new Set(pg.images.map(i => i.src));
  const plan = outer.map(ph => ({ ph, r: ph.getBoundingClientRect(), imgs: $$('img', ph) }));
  plan.forEach(({ r, imgs }) => imgs.forEach(img => {
    const src = img.getAttribute('src'); if (!src || seen.has(src)) return; seen.add(src);
    const w = Math.round(Math.min(img.getBoundingClientRect().width || 300, 380));
    pg.images.push({ id: nid('im'), src, x: +((r.left - pr.left) / pw * 100).toFixed(2), y: Math.round(r.top - pr.top), w, rot: +(Math.random() * 4 - 2).toFixed(1) });
  }));
  plan.forEach(({ ph, r }) => {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < Math.max(1, Math.round(r.height / lineH())); i++) frag.appendChild(document.createElement('br'));
    ph.replaceWith(frag);
  });
  pg.html = cleanHtml(body.innerHTML);
  touch(pg); H().save();
  $('#photos').innerHTML = pg.images.map(photoHtml).join('');
}
function removePicture(el) {
  const pg = curPg(); const im = imageOf(el); if (!pg || !im) return;
  const snap = H().snapshot();
  const go = () => { pg.images = pg.images.filter(x => x.id !== im.id); el.remove(); touch(pg); H().save(); fitPage(); H().undoable('Picture removed', snap, 'image'); };
  if (REDUCED) return go();
  el.animate([{ opacity: 1 }, { opacity: 0, transform: `translateY(20px) rotate(${(im.rot || 0) + 8}deg) scale(.92)` }], { duration: 260, easing: 'ease-in' }).finished.then(go);
}
// drag to move, corner to resize, double-click to view full size
let pdrag = null;
document.addEventListener('pointerdown', (e) => {
  const ph = e.target.closest && e.target.closest('#photos .photo');
  if (!ph || e.button !== 0 || e.target.closest('.ph-del') || e.target.closest('video')) return;
  const page = $('#page');
  e.preventDefault();
  hideSelbar();
  const resize = !!e.target.closest('.ph-rz');
  pdrag = { el: ph, resize, sx: e.clientX, sy: e.clientY, left: ph.offsetLeft, top: ph.offsetTop, w0: ph.offsetWidth, moved: false, id: e.pointerId, pw: page.clientWidth };
  ph.setPointerCapture && ph.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', (e) => {
  if (!pdrag || e.pointerId !== pdrag.id) return;
  const d = pdrag, dx = e.clientX - d.sx, dy = e.clientY - d.sy;
  if (!d.moved && Math.hypot(dx, dy) < 3) return;
  if (!d.moved) { d.moved = true; d.el.classList.add(d.resize ? 'resizing' : 'dragging'); document.body.classList.add(d.resize ? 'resizing-photo' : 'dragging-sticky'); }
  if (d.resize) {
    const w = Math.max(80, Math.min(d.pw - d.left + 40, d.w0 + dx));
    d.el.style.width = w + 'px';
    return;
  }
  const x = Math.max(-d.el.offsetWidth * .3, Math.min(d.pw - d.el.offsetWidth * .7, d.left + dx));
  const y = Math.max(-20, d.top + dy);
  d.el.style.left = x + 'px'; d.el.style.top = y + 'px';
  d.el.style.setProperty('--tilt', Math.max(-6, Math.min(6, (e.movementX || 0) * .6)) + 'deg');
});
document.addEventListener('pointerup', (e) => {
  if (!pdrag || e.pointerId !== pdrag.id) return;
  const d = pdrag; pdrag = null;
  document.body.classList.remove('dragging-sticky', 'resizing-photo');
  d.el.classList.remove('dragging', 'resizing');
  if (!d.moved) return;
  const im = imageOf(d.el); if (!im) return;
  if (d.resize) { im.w = Math.round(d.el.offsetWidth); }
  else {
    im.x = +(d.el.offsetLeft / d.pw * 100).toFixed(2);
    im.y = Math.round(d.el.offsetTop);
    d.el.style.left = im.x + '%';
    d.el.style.removeProperty('--tilt');
    d.el.classList.add('landing');
    setTimeout(() => d.el.classList.remove('landing'), 450);
    window.Sound && Sound.play('stick');
  }
  touch(curPg()); H().save(); fitPage();
});
let lightbox = null;
function closeLightbox() { if (lightbox) { const l = lightbox; lightbox = null; l.classList.add('out'); setTimeout(() => l.remove(), 250); } }
document.addEventListener('dblclick', (e) => {
  const ph = e.target.closest && e.target.closest('#photos .photo'); if (!ph || !ph.querySelector('img')) return;
  const src = ph.querySelector('img').src;
  lightbox = document.createElement('div');
  lightbox.className = 'lightbox';
  lightbox.innerHTML = `<img src="${esc(src)}" alt=""><span class="lb-hint">Click anywhere or press Esc to close</span>`;
  lightbox.addEventListener('click', closeLightbox);
  document.body.appendChild(lightbox);
});
// stop the browser's own drag-and-drop from copying pictures and link chips
let internalDrag = false;
document.addEventListener('dragstart', (e) => {
  const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
  if (!el || !el.closest) return;
  if (el.closest('#page .photo, #page .nlink, #page img')) { e.preventDefault(); return; }
  internalDrag = !!el.closest('#page-body');
});
document.addEventListener('dragend', () => { setTimeout(() => { internalDrag = false; }, 0); });

// ------------------------------------------------------------------ click any line to start writing there
document.addEventListener('mousedown', (e) => {
  const body = $('#page-body');
  if (!body || e.button !== 0 || ns.tool !== 'type' || e.target !== body) return;
  const br = body.getBoundingClientRect();
  const padTop = parseFloat(getComputedStyle(body).paddingTop) || 0;
  const top = br.top + padTop;
  let bottom = top;
  if (body.childNodes.length) { const r = document.createRange(); r.selectNodeContents(body); bottom = Math.max(top, r.getBoundingClientRect().bottom); }
  if (e.clientY <= bottom + 4) return; // on or beside existing writing: the normal caret is right
  e.preventDefault();
  const L = lineH();
  const want = Math.floor((e.clientY - top) / L) + 1;
  const have = body.childNodes.length ? Math.round((bottom - top) / L) : 0;
  if (!body.textContent.trim() && !body.querySelector('ul,ol,.nlink')) body.innerHTML = '';
  let last = null;
  for (let i = 0; i < Math.max(1, want - (body.childNodes.length ? have : 0)); i++) { last = emptyLine(); body.appendChild(last); }
  body.focus();
  const r = document.createRange(); r.setStart(last, 0); r.collapse(true);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  bodyChanged();
});

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
  if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?\S*)?$/i.test(t)) { addPicture(t); return; }
  insertAtCaret(textFragment(text));
  bodyChanged();
});
document.addEventListener('dragover', (e) => { if (e.target.closest && e.target.closest('#page')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  const page = e.target.closest && e.target.closest('#page'); if (!page || !ns.pgId) return;
  if (internalDrag) { internalDrag = false; setTimeout(bodyChanged, 0); return; } // moving text within the page: let it move
  e.preventDefault();
  const range = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
  const inBody = range && $('#page-body').contains(range.startContainer);
  const files = [...(e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type));
  if (files.length) { insertImages(files, { x: e.clientX, y: e.clientY }); return; }
  const text = e.dataTransfer.getData('text/plain');
  if (text) { if (!inBody) placeCaret($('#page-body')); insertAtCaret(textFragment(text), inBody ? range : null); bodyChanged(); }
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('#page a.nlink');
  if (a) { e.preventDefault(); H().api.openExternal(a.dataset.href || a.href); return; }
  if (!e.target.closest('.menu') && !e.target.closest('[data-act="menu"]')) closeMenu();
}, true);

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'page-body') { if (e.inputType === 'insertText' && e.data === ' ') autoChecklist(); bodyChanged(); return; }
  if (t.classList && t.classList.contains('sticky-text')) {
    const s = stickyOf(t); if (!s) return;
    if (s.locked) { const u = unlocked.get(s.id); if (u) { u.text = t.innerText.replace(/\n$/, ''); u.dirty = true; clearTimeout(u.timer); u.timer = setTimeout(() => sealSticky(s), 600); } return; }
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
    if (lightbox) { closeLightbox(); return; }
    if ($('.menu')) { closeMenu(); return; }
    if (ns.tool !== 'type') { setTool('type'); return; }
    if (tblBar) hideTblBar();
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

// wrap the selected text in a font; nested font spans inside are removed so the newest choice wins
function applyFont(range, k) {
  const body = $('#page-body'); if (!body || !body.contains(range.commonAncestorContainer)) return;
  const span = document.createElement('span'); span.className = 'ff-' + k;
  span.appendChild(range.extractContents());
  $$('[class*="ff-"]', span).forEach(x => { while (x.firstChild) x.parentNode.insertBefore(x.firstChild, x); x.remove(); });
  range.insertNode(span);
  // a whole font span replaced with "page font" just unwraps
  if (k === 'none' && !(span.parentElement && span.parentElement.closest('[class*="ff-"]'))) {
    while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span); span.remove();
  } else {
    const sel = getSelection(); sel.removeAllRanges(); const nr = document.createRange(); nr.selectNodeContents(span); sel.addRange(nr);
  }
  // drop empty leftovers
  $$('[class*="ff-"]', body).forEach(x => { if (!x.textContent && !x.querySelector('img,br')) x.remove(); });
  hideSelbar();
  bodyChanged(); commitEditor();
  window.Sound && Sound.play('tick');
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
    <span class="sep"></span><button data-sb="mark" title="Highlight">${icon('highlighter', 'sm')}</button>
    <button data-sb="font" title="Change the font of this text">${icon('font', 'sm')}Font</button>`;
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
  if (b.dataset.sb === 'font') {
    // keep the selection while the font list is open
    const keepRange = range.cloneRange();
    const r = b.getBoundingClientRect();
    const cur = (() => { let n = range.commonAncestorContainer; n = n.nodeType === 1 ? n : n.parentElement; const f = n.closest('[class*="ff-"]'); return f ? (f.className.match(/ff-(\w+)/) || [])[1] : null; })();
    const m = ctxMenu([{ header: 'Font for this text' }, ...fontMenuItems((k) => applyFont(keepRange, k), cur, { reset: true })], r.left, r.bottom + 6);
    m.addEventListener('mousedown', (ev) => ev.preventDefault());
    return;
  }
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
function closeMenu() {
  $$('.menu').forEach(m => { m.classList.add('out'); setTimeout(() => m.remove(), 160); });
  $$('#shelf .ctx-on').forEach(x => x.classList.remove('ctx-on'));
}
function openMenu(btn, kind) {
  closeMenu();
  const pg = curPg(), nb = curNb();
  const customs = D().noteTemplates || [];
  if (kind === 'tools') { const r = btn.getBoundingClientRect(); ctxMenu(toolsMenuItems(), r.left, r.bottom + 6); return; }
  if (kind === 'font') {
    const r = btn.getBoundingClientRect();
    ctxMenu([{ header: 'Font for all notebooks' }, ...fontMenuItems(setNoteFont, H().D.settings.noteFont || 'auto', { auto: true })], r.left, r.bottom + 6);
    return;
  }
  if (kind === 'more') {
    const r = btn.getBoundingClientRect();
    const extra = [
      { label: 'Inside cover & settings', ic: 'book', fn: () => turnTo(ns.nbId, null, -1) },
      { label: "Today's journal", ic: 'calendar', fn: () => actions['journal-today']() },
      { label: 'Export notebook as PDF', ic: 'file', fn: () => exportPdf('notebook') }
    ];
    const items = pg ? [...extra, '-', ...pageMenuItems(pg, true)] : extra;
    ctxMenu(items, r.right, r.bottom + 6, { alignRight: true });
    return;
  }
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
function setNoteFont(k) {
  H().D.settings.noteFont = k; H().save();
  commitEditor();
  const keep = $('#desk') ? $('#desk').scrollTop : 0;
  renderDesk(); if ($('#desk')) $('#desk').scrollTop = keep;
  H().toast(k === 'auto' ? 'Automatic font: handwriting in books, Calibri in simple notebooks' : `All notebooks now use ${FONTS[k].name}`, { ic: 'font' });
}
// new notebook: book (turning pages) or simple (full width, plain, OneNote-style)
function chooseNotebookStyle() {
  return new Promise((res) => {
    const wrap = document.createElement('div'); wrap.className = 'prompt-wrap';
    wrap.innerHTML = `<div class="scrim"></div><div class="modal prompt-modal nbstyle-modal" role="dialog">
      <div class="modal-head"><h2>New notebook</h2><p>Pick a style. You can change it later on the inside cover.</p></div>
      <div class="modal-body nbs-grid">
        <button class="nbs-card" data-nbs="book"><span class="nbs-prev book"><i class="sp"></i><b>Notes</b><em></em><em></em><em class="s"></em></span>
          <span class="nbs-name">Book</span><span class="nbs-sub">Pages that turn, handwriting, lined paper, stickies and doodles.</span></button>
        <button class="nbs-card" data-nbs="simple"><span class="nbs-prev simple"><b>Notes</b><u></u><small>28 October 2026 &nbsp;09:41</small><em></em><em></em><em class="s"></em></span>
          <span class="nbs-name">Simple</span><span class="nbs-sub">Full width with a plain font, like OneNote. Quick to scan and great for commands and procedures.</span></button>
      </div>
      <div class="modal-foot"><button class="btn ghost" data-nbs="">Cancel</button></div></div>`;
    document.body.appendChild(wrap);
    setTimeout(() => wrap.querySelector('.nbs-card').focus(), 40);
    const done = (v) => { wrap.querySelector('.modal').classList.add('out'); wrap.querySelector('.scrim').classList.add('out'); setTimeout(() => wrap.remove(), 260); res(v); };
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-nbs]'); if (b) done(b.dataset.nbs || null); else if (e.target.classList.contains('scrim')) done(null); });
    wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); });
  });
}
function setTool(t) {
  ns.tool = t;
  persist();
  commitEditor();
  // re-render only the toolbar + editable state, not the whole page
  const keep = $('#desk').scrollTop;
  const page = $('#page');
  if (page) {
    page.classList.toggle('inking', t !== 'type');
    ['pencil', 'hl', 'eraser', 'shape'].forEach(x => page.classList.toggle('tool-' + x, t === x));
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
      <button class="icon-btn shelf-toggle" data-act="shelf-toggle" title="${ns.shelfHidden ? 'Show notebooks' : 'Hide notebooks'} (Ctrl+Shift+\\)">${icon('sidebar', 'sm')}</button>
      <div class="crumbs"><button class="crumb-btn" data-act="nb-switch" title="Switch notebook"><span class="nb-dot" style="background:${nb.color}"></span><b>${esc(nb.name)}</b>${icon('chevron', 'sm')}</button>
        <span class="muted">›</span><button class="crumb-btn pg" data-act="pg-switch" title="Jump to a page"><span class="crumb-pg">${pg ? esc(pageLabel(pg, idx)) : 'Inside cover'}</span>${icon('chevron', 'sm')}</button></div>
      <div class="turners">
        <button class="icon-btn" data-act="pg-prev" title="Previous page (Alt+←)" ${idx < 0 ? 'disabled' : ''}>${icon('chevronL', 'sm')}</button>
        <span class="pg-count">${pg ? `${idx + 1} / ${pages.length}` : 'Cover'}</span>
        <button class="icon-btn" data-act="pg-next" title="Next page (Alt+→)" ${idx >= pages.length - 1 ? 'disabled' : ''}>${icon('chevronR', 'sm')}</button>
      </div>
      <div class="tools">
        ${nb.kind !== 'journal' ? `<button class="btn sm" data-act="menu" data-menu="newpage">${icon('plus', 'sm')}Page</button>` : `<button class="btn sm" data-act="journal-today">${icon('calendar', 'sm')}Today</button>`}
        ${pg ? `<button class="btn sm sticky-btn" data-act="sticky-add" title="Add a sticky note">${icon('sticky', 'sm')}Sticky</button>
        <button class="btn sm tools-btn ${tool === 'shape' ? 'on' : ''}" data-act="menu" data-menu="tools" title="Tables, shapes, videos, locked notes and more">${icon('tools', 'sm')}Tools</button>
        <div class="seg tool-seg">
          <button data-act="tool" data-v="type" class="${tool === 'type' || tool === 'shape' ? 'on' : ''}" title="Write">Aa</button>
          <button data-act="tool" data-v="pencil" class="${tool === 'pencil' ? 'on' : ''}" title="Pencil">${icon('pencil', 'sm')}</button>
          <button data-act="tool" data-v="hl" class="${tool === 'hl' ? 'on' : ''}" title="Highlighter">${icon('highlighter', 'sm')}</button>
          <button data-act="tool" data-v="eraser" class="${tool === 'eraser' ? 'on' : ''}" title="Rubber">${icon('eraser', 'sm')}</button>
        </div>
        ${tool === 'pencil' ? `<div class="pens">${Object.keys(PENS).map(k => `<button class="pen ${ns.pen === k ? 'on' : ''}" style="--c:${PENS[k]}" data-act="pen" data-v="${k}" title="${k}"></button>`).join('')}</div>` : ''}
        ${tool === 'shape' ? `<span class="shape-hint">${icon(SHAPES[ns.shape]?.ic || 'shapes', 'sm')} Drag on the page to draw a ${esc((SHAPES[ns.shape] || {}).name || 'shape').toLowerCase()} <button class="link" data-act="tool" data-v="type">Done</button></span>` : ''}
        ${tool !== 'type' && tool !== 'shape' ? `<button class="icon-btn" data-act="ink-undo" title="Undo last stroke">${icon('undo', 'sm')}</button>` : ''}` : ''}
        <button class="btn sm font-btn" data-act="menu" data-menu="font" title="Font for all notebooks">${icon('font', 'sm')}<span>${esc((H().D.settings.noteFont || 'auto') === 'auto' ? 'Font: auto' : FONTS[fontKey(nb)].name.replace(/ \(.*\)/, ''))}</span>${icon('chevron', 'sm')}</button>
        <button class="icon-btn" data-act="room" title="More room: hide the menus (again to bring them back)">${icon(H().D.settings.navCollapsed && ns.shelfHidden ? 'collapse' : 'expand', 'sm')}</button>
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
    return `<article class="page paper-${isSimple(nb) ? 'plain' : nb.paper || 'lined'} ${fontClass(nb)} print-page" style="width:${W}px;min-height:${h}px;${fontVars(nb)}">
      <header class="nhead"><div class="page-title">${esc(pg.title || pageLabel(pg, i))}</div><span class="page-date">${esc(H().fmtShort(H().dayKey(new Date(pg.createdAt))))}</span></header>
      <div class="page-body">${body}</div>
      ${inkImage(pg, W, h)}
      <div class="photos">${(pg.images || []).map(photoHtml).join('')}</div>
      <svg class="shapes" width="${W}" height="${h}">${(pg.shapes || []).map(sh => shapeSvg(sh, W)).join('')}</svg>
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
  const nb = curNb();
  return exportPages(nb, which === 'page' && curPg() ? [curPg()] : pagesOf(nb.id));
}
async function exportPages(nb, pages) {
  commitEditor();
  if (!pages.length) { H().toast('No pages to export yet', { ic: 'file' }); return; }
  const title = pages.length === 1 && pagesOf(nb.id).length > 1 ? `${nb.name}: ${pageLabel(pages[0], pagesOf(nb.id).indexOf(pages[0]))}` : nb.name;
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
  'pg-new': (el) => { const nbId = el.dataset.nb || ns.nbId; const pg = createPage(nbId); placeAtEnd(pg, nbId, el.dataset.chap || null); H().save(); turnTo(nbId, pg.id, 1); setTimeout(() => $('#page-title')?.focus(), 950); },
  'pg-new-blank': () => actions['pg-new']({ dataset: { nb: ns.nbId } }),
  'pg-new-tpl': (el) => {
    closeMenu();
    const pg = createPage(ns.nbId, el.dataset.v);
    if (curPg() && curPg().notebookId === ns.nbId) placeAfter(pg, curPg()); else placeAtEnd(pg, ns.nbId, null);
    H().save(); turnTo(ns.nbId, pg.id, 1);
    setTimeout(() => { const t = $('#page-title'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 950);
  },
  'tpl-save': () => {
    closeMenu(); if (curPg()) { saveTemplate(curPg().id); return; }
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
    toggleRibbon(pg.id); return;
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
  'nb-new': async () => {
    closeMenu();
    const style = await chooseNotebookStyle(); if (!style) return;
    const nb = createNotebook({ style });
    H().save();
    ns.expanded[nb.id] = true; ns.justToggled = nb.id;
    turnTo(nb.id, null, 1);
    setTimeout(() => { const i = $('#nb-name'); if (i) { i.focus(); i.select(); } }, 950);
  },
  'nb-color': (el) => { const nb = curNb(); nb.color = el.dataset.v; H().save(); const keep = $('#desk').scrollTop; renderDesk(); $('#desk').scrollTop = keep; renderShelf(); },
  'nb-switch': (el) => {
    const r = el.getBoundingClientRect();
    ctxMenu([{ header: 'Notebooks' }, ...notebooks().map(n => ({ label: n.name, ic: n.id === ns.nbId ? 'check' : 'book', color: n.color,
      fn: () => { if (n.id !== ns.nbId) turnTo(n.id, n.lastPg && getPg(n.lastPg) ? n.lastPg : (pagesOf(n.id)[0] || {}).id || null); } })),
      '-', { label: 'New notebook…', ic: 'plus', fn: () => actions['nb-new']() }], r.left, r.bottom + 6);
  },
  'pg-switch': (el) => {
    const nb = curNb(); if (!nb) return; const r = el.getBoundingClientRect();
    const pages = pagesOf(nb.id);
    const items = [{ label: 'Inside cover & settings', ic: !ns.pgId ? 'check' : 'sliders', fn: () => turnTo(nb.id, null, -1) }, '-'];
    let lastCh = null;
    pages.slice(-60).forEach((pg, i) => {
      const ch = chapterOf(nb, pg);
      if (ch && ch.id !== lastCh) items.push({ header: ch.name });
      if (!ch && lastCh) items.push('-');
      lastCh = ch ? ch.id : null;
      items.push({ label: pageLabel(pg, pages.indexOf(pg)), ic: pg.id === ns.pgId ? 'check' : pg.bookmarked ? 'ribbon' : 'note', fn: () => turnTo(nb.id, pg.id) });
    });
    if (nb.kind !== 'journal') items.push('-', { label: 'New page', ic: 'plus', fn: () => actions['pg-new']({ dataset: { nb: nb.id } }) });
    const m = ctxMenu(items, r.left, r.bottom + 6); m.classList.add('scroll-menu');
  },
  'nb-style': (el) => {
    const nb = curNb(); if ((nb.style || 'book') === el.dataset.v) return;
    nb.style = el.dataset.v; H().save();
    const keep = $('#desk').scrollTop; renderDesk(); $('#desk').scrollTop = keep;
    H().toast(nb.style === 'simple' ? 'Simple notebook: full width, plain font' : 'Back to a book with turning pages', { ic: 'book' });
  },
  'nb-paper': (el) => { const nb = curNb(); nb.paper = el.dataset.v; H().save(); renderCoverBody(); },
  'nb-delete': () => {
    deleteNotebook(curNb().id); return;
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
  'img-del': (el) => removePicture(el.closest('.photo')),
  'st-unlock': (el) => askUnlock(el.closest('.sticky')),
  'st-lock': (el) => { const s = stickyOf(el); if (s) { sealSticky(s, true); } },
  'room': () => {
    const st = H().D.settings;
    const both = st.navCollapsed && ns.shelfHidden;
    if (both) { if (!ns.roomPrev || !ns.roomPrev.nav) H().setNav(false); if (!ns.roomPrev || !ns.roomPrev.shelf) { ns.shelfHidden = false; $('#notes')?.classList.remove('shelf-hidden'); } }
    else { ns.roomPrev = { nav: st.navCollapsed, shelf: ns.shelfHidden }; H().setNav(true); ns.shelfHidden = true; $('#notes')?.classList.add('shelf-hidden'); }
    persist(); renderToolbarOnly();
  },
  'shelf-toggle': () => toggleShelf(),
  'chap-toggle': (el) => {
    const nb = getNb(el.dataset.nb); const c = (nb.chapters || []).find(x => x.id === el.dataset.chap); if (!c) return;
    const box = el.parentElement.querySelector('.chap-pages');
    const done = () => { c.collapsed = !c.collapsed; H().save(); renderShelf(); };
    if (!c.collapsed && box && !REDUCED) { box.animate([{ height: box.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 220, easing: H().EASE, fill: 'forwards' }).finished.then(done); return; }
    done();
    if (!c.collapsed && !REDUCED) { const nbox = $(`.chap[data-chap="${c.id}"] .chap-pages`); if (nbox) { const hh = nbox.scrollHeight; nbox.animate([{ height: '0px', opacity: 0 }, { height: hh + 'px', opacity: 1 }], { duration: 300, easing: H().EASE }); } }
  },
  tool: (el) => setTool(el.dataset.v),
  pen: (el) => { ns.pen = el.dataset.v; persist(); renderToolbarOnly(); },
  'ink-undo': () => { const pg = curPg(); if (pg && pg.strokes && pg.strokes.length) { pg.strokes.pop(); drawInk(); touch(pg); H().save(); } },
  menu: (el) => { if ($('.menu')) { closeMenu(); return; } openMenu(el, el.dataset.menu); },
  'pdf-page': () => { closeMenu(); exportPdf('page'); },
  'pdf-notebook': () => { closeMenu(); exportPdf('notebook'); }
};

// ================================================================== TOOLS: tables, shapes, videos, locked notes, stamps
const SHAPES = {
  line: { name: 'Line', ic: 'divider' }, arrow: { name: 'Arrow', ic: 'arrowRight' }, darrow: { name: 'Double arrow', ic: 'arrowRight' },
  elbow: { name: 'Elbow connector', ic: 'chevronR' }, elbowa: { name: 'Elbow arrow', ic: 'chevronR' }, elbowd: { name: 'Elbow, both ends', ic: 'chevronR' },
  rect: { name: 'Rectangle', ic: 'stop' }, ellipse: { name: 'Ellipse', ic: 'target' }, para: { name: 'Parallelogram', ic: 'stop' },
  tri: { name: 'Triangle', ic: 'shapes' }, diamond: { name: 'Diamond', ic: 'stop' }
};
const SHAPE_COLOURS = { graphite: '#3A3A3D', red: '#C0463A', blue: '#3E6C8A', green: '#5B8A4A', orange: '#D98A2B' };
function toolsMenuItems() {
  const pg = curPg();
  const sz = [[2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [5, 5]];
  return [
    { header: 'Add to this page' },
    { label: 'Table', ic: 'table', sub: [{ header: 'Columns × rows' }, ...sz.map(([c, r]) => ({ label: `${c} × ${r}`, ic: 'table', fn: () => insertTable(c, r) }))] },
    { label: 'Checklist', ic: 'checklist', fn: () => actions['checklist-add']() },
    { label: 'Shapes & arrows', ic: 'shapes', sub: [
      { header: 'Lines' }, ...['line', 'arrow', 'darrow', 'elbow', 'elbowa', 'elbowd'].map(k => ({ label: SHAPES[k].name, ic: 'pencil', fn: () => startShape(k) })),
      '-', { header: 'Basic shapes' }, ...['rect', 'ellipse', 'para', 'tri', 'diamond'].map(k => ({ label: SHAPES[k].name, ic: 'shapes', fn: () => startShape(k) }))
    ] },
    { label: 'Video', ic: 'video', sub: [
      { label: 'From a link (YouTube or video URL)…', ic: 'link', fn: () => askVideoLink() },
      { label: 'From a file on this PC…', ic: 'upload', fn: () => pickVideoFile() }
    ] },
    { label: 'Picture from a file…', ic: 'image', fn: () => pickPicture() },
    '-',
    { label: 'Locked sticky note (password)', ic: 'lock', fn: () => addLockedSticky() },
    { label: "Today's date stamp", ic: 'stamp', fn: () => insertStamp() },
    { label: 'Divider line', ic: 'divider', fn: () => insertDivider() },
    pg && (pg.shapes || []).length ? '-' : null,
    pg && (pg.shapes || []).length ? { label: 'Clear all shapes on this page', ic: 'trash', danger: true, fn: () => { const snap = H().snapshot(); pg.shapes = []; touch(pg); H().save(); renderShapes(); H().undoable('Shapes cleared', snap, 'trash'); } } : null
  ];
}
function caretBlock() {
  const body = $('#page-body'); const sel = getSelection();
  let blk = sel.rangeCount && body.contains(sel.anchorNode) ? topBlock(sel.anchorNode) : null;
  if (!blk) { blk = body.lastElementChild && !body.lastElementChild.textContent.trim() && body.lastElementChild.tagName === 'DIV' ? body.lastElementChild : null; }
  if (!blk) { blk = emptyLine(); body.appendChild(blk); }
  return blk;
}
function insertBlock(node) {
  if (ns.tool !== 'type') setTool('type');
  const body = $('#page-body'); if (!body) return null;
  const blk = caretBlock();
  const empty = !blk.textContent.trim() && !blk.querySelector('img,table,hr,.stamp');
  if (empty && blk.tagName === 'DIV') blk.replaceWith(node); else blk.after(node);
  const after = emptyLine(); node.after(after);
  return after;
}
function insertTable(cols, rows) {
  const t = document.createElement('table'); t.className = 'ntable';
  const tb = document.createElement('tbody');
  for (let r = 0; r < rows; r++) { const tr = document.createElement('tr'); for (let c = 0; c < cols; c++) { const td = document.createElement('td'); td.appendChild(document.createElement('br')); tr.appendChild(td); } tb.appendChild(tr); }
  t.appendChild(tb);
  insertBlock(t);
  const first = t.querySelector('td'); const r = document.createRange(); r.setStart(first, 0); r.collapse(true);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  $('#page-body').focus();
  bodyChanged(); window.Sound && Sound.play('tap');
}
function insertStamp() {
  const d = new Date();
  const span = document.createElement('span'); span.className = 'stamp'; span.contentEditable = 'false';
  span.textContent = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (ns.tool !== 'type') setTool('type');
  const body = $('#page-body'); const sel = getSelection();
  if (!sel.rangeCount || !body.contains(sel.anchorNode)) placeCaret(body);
  const frag = document.createDocumentFragment(); frag.appendChild(span); frag.appendChild(document.createTextNode(' '));
  insertAtCaret(frag); bodyChanged(); window.Sound && Sound.play('stick');
}
function insertDivider() {
  const hr = document.createElement('hr'); hr.className = 'ndiv';
  const after = insertBlock(hr);
  const r = document.createRange(); r.setStart(after, 0); r.collapse(true); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  bodyChanged();
}
// table helper bar: shows while the caret is in a table
let tblBar = null, tblFor = null;
function hideTblBar() { if (tblBar) { tblBar.remove(); tblBar = null; tblFor = null; } }
function cellOf(node) { const el = node && (node.nodeType === 1 ? node : node.parentElement); return el && el.closest && el.closest('#page-body table.ntable td'); }
document.addEventListener('selectionchange', () => {
  const sel = getSelection(); const td = sel.rangeCount ? cellOf(sel.anchorNode) : null;
  if (!td) { hideTblBar(); return; }
  const table = td.closest('table');
  if (tblFor !== table) {
    hideTblBar(); tblFor = table;
    tblBar = document.createElement('div'); tblBar.className = 'tbl-bar';
    tblBar.innerHTML = [['row', 'plus', 'Row'], ['col', 'plus', 'Column'], ['delrow', 'x', 'Row'], ['delcol', 'x', 'Column'], ['deltable', 'trash', 'Table']]
      .map(([a, ic, l]) => `<button data-tb="${a}" title="${a.startsWith('del') ? 'Remove' : 'Add'} ${l.toLowerCase()}">${icon(ic, 'sm')}${l}</button>`).join('');
    document.body.appendChild(tblBar);
  }
  const r = table.getBoundingClientRect();
  tblBar.style.left = Math.max(8, r.left) + 'px'; tblBar.style.top = Math.max(8, r.top - 40) + 'px';
});
document.addEventListener('mousedown', (e) => {
  const b = e.target.closest && e.target.closest('.tbl-bar button'); if (!b) return;
  e.preventDefault();
  const sel = getSelection(); const td = sel.rangeCount ? cellOf(sel.anchorNode) : null; if (!td) return;
  const tr = td.parentElement, table = td.closest('table'), ci = [...tr.children].indexOf(td);
  const cell = () => { const c = document.createElement('td'); c.appendChild(document.createElement('br')); return c; };
  const a = b.dataset.tb;
  if (a === 'row') { const n = document.createElement('tr'); [...tr.children].forEach(() => n.appendChild(cell())); tr.after(n); }
  if (a === 'col') $$('tr', table).forEach(row => { const ref = row.children[ci]; ref ? ref.after(cell()) : row.appendChild(cell()); });
  if (a === 'delrow') { if (table.rows.length > 1) tr.remove(); else { table.remove(); hideTblBar(); } }
  if (a === 'delcol') { if (tr.children.length > 1) $$('tr', table).forEach(row => row.children[ci] && row.children[ci].remove()); else { table.remove(); hideTblBar(); } }
  if (a === 'deltable') { table.remove(); hideTblBar(); }
  bodyChanged();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const sel = getSelection(); const td = sel.rangeCount ? cellOf(sel.anchorNode) : null; if (!td) return;
  e.preventDefault();
  const cells = $$('td', td.closest('table')); let i = cells.indexOf(td) + (e.shiftKey ? -1 : 1);
  if (i >= cells.length) { const tr = td.parentElement, n = document.createElement('tr'); [...tr.children].forEach(() => { const c = document.createElement('td'); c.appendChild(document.createElement('br')); n.appendChild(c); }); tr.closest('tbody').appendChild(n); bodyChanged(); }
  const all = $$('td', td.closest('table')); const target = all[Math.max(0, Math.min(all.length - 1, i))];
  const r = document.createRange(); r.selectNodeContents(target); r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
});

// ---------- videos & pictures from files
function ytEmbed(raw) {
  let u; try { u = new URL(String(raw).trim()); } catch (e) { return null; }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) { id = u.searchParams.get('v'); const m = u.pathname.match(/^\/(?:live|shorts|embed|v)\/([\w-]{6,})/); if (!id && m) id = m[1]; }
  return id ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0&modestbranding=1&playsinline=1` : null;
}
function addMedia(item) {
  const pg = curPg(), page = $('#page'), desk = $('#desk'); if (!pg || !page) return;
  const pw = page.clientWidth;
  const w = Math.round(Math.min(520, pw * .65));
  const y = Math.max(90, desk.scrollTop - page.offsetTop + 140);
  const im = { id: nid('im'), x: +((pw - w) / 2 / pw * 100).toFixed(2), y: Math.round(y), w, rot: 0, ...item };
  pg.images = pg.images || []; pg.images.push(im);
  touch(pg); H().save();
  $('#photos').insertAdjacentHTML('beforeend', photoHtml(im));
  const el = $('#photos').lastElementChild;
  if (!REDUCED) el.animate([{ opacity: 0, transform: 'translateY(-20px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: H().EASE });
  window.Sound && Sound.play('stick');
  fitPage();
}
function promptBox({ title, label, placeholder, okLabel = 'Add', password = false, confirm = false, note = '' }) {
  return new Promise((res) => {
    const wrap = document.createElement('div'); wrap.className = 'prompt-wrap';
    wrap.innerHTML = `<div class="scrim"></div><div class="modal prompt-modal" role="dialog">
      <div class="modal-head"><h2>${esc(title)}</h2>${note ? `<p>${esc(note)}</p>` : ''}</div>
      <div class="modal-body"><div class="field"><label>${esc(label)}</label><input class="input" id="pb-1" type="${password ? 'password' : 'text'}" placeholder="${esc(placeholder || '')}" autocomplete="off"></div>
        ${confirm ? `<div class="field"><label>Type it again</label><input class="input" id="pb-2" type="password" autocomplete="off"></div>` : ''}
        <div class="pb-err" id="pb-err"></div></div>
      <div class="modal-foot"><button class="btn ghost" data-pb="no">Cancel</button><button class="btn primary" data-pb="ok">${esc(okLabel)}</button></div></div>`;
    document.body.appendChild(wrap);
    const i1 = wrap.querySelector('#pb-1'), i2 = wrap.querySelector('#pb-2'), err = wrap.querySelector('#pb-err');
    setTimeout(() => i1.focus(), 40);
    const done = (v) => { wrap.querySelector('.modal').classList.add('out'); wrap.querySelector('.scrim').classList.add('out'); setTimeout(() => wrap.remove(), 260); res(v); };
    const ok = () => {
      const v = i1.value;
      if (!v.trim()) { i1.focus(); return; }
      if (confirm && v !== i2.value) { err.textContent = "Those don't match. Try again."; i2.value = ''; i2.focus(); return; }
      done(v);
    };
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-pb]'); if (b) b.dataset.pb === 'ok' ? ok() : done(null); else if (e.target.classList.contains('scrim')) done(null); });
    wrap.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { if (confirm && document.activeElement === i1) { i2.focus(); return; } ok(); } if (e.key === 'Escape') done(null); });
    wrap.showError = (m) => { err.textContent = m; };
  });
}
async function askVideoLink() {
  const v = await promptBox({ title: 'Add a video', label: 'Video link', placeholder: 'https://www.youtube.com/watch?v=… or a link to an .mp4', note: 'YouTube links play right on the page. Direct links to video files work too.' });
  if (!v) return;
  const yt = ytEmbed(v);
  if (yt) { addMedia({ kind: 'yt', src: yt, label: 'YouTube' }); return; }
  try { const u = new URL(v.trim()); if (!/^https?:$/.test(u.protocol)) throw 0; addMedia({ kind: 'video', src: u.href, label: decodeURIComponent(u.pathname.split('/').pop() || 'Video').slice(0, 40) }); }
  catch (e) { H().toast('That doesn\'t look like a link', { ic: 'link' }); }
}
async function pickVideoFile() {
  if (!H().api.pickVideo) { H().toast('Adding videos from files works in the desktop app', { ic: 'video' }); return; }
  const r = await H().api.pickVideo(); if (!r) return;
  addMedia({ kind: 'video', src: r.src, label: r.name.slice(0, 40) });
}
function pickPicture() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = () => { if (inp.files.length) { const page = $('#page'); const r = page.getBoundingClientRect(); insertImages([...inp.files], { x: r.left + r.width / 2, y: Math.max(r.top + 200, 260) }); } };
  inp.click();
}

// ---------- password-protected stickies (AES-GCM, key from your password; nothing readable is saved)
const unlocked = new Map(); // sticky id → { text, key }
const b64 = { to: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))), from: (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0)) };
async function deriveKey(pw, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptText(text, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { salt: b64.to(salt), iv: b64.to(iv), data: b64.to(data) };
}
async function addLockedSticky() {
  const pw = await promptBox({ title: 'New locked note', label: 'Choose a password', password: true, confirm: true, okLabel: 'Create', note: 'Only someone with this password can read the note. There is no way to recover it if forgotten.' });
  if (!pw) return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pw, salt);
  addSticky();
  const pg = curPg(); const s = pg.stickies[pg.stickies.length - 1];
  s.locked = true; s.color = 'blue'; s.text = '';
  s.enc = await encryptText('', key, salt);
  unlocked.set(s.id, { text: '', key, salt });
  touch(pg); H().save();
  rerenderSticky(s, true);
}
function rerenderSticky(s, focus) {
  const old = $(`#stickies .sticky[data-sid="${s.id}"]`); if (!old) return;
  const tmp = document.createElement('div'); tmp.innerHTML = stickyHtml(s); const fresh = tmp.firstElementChild;
  old.replaceWith(fresh);
  if (focus) setTimeout(() => placeCaret(fresh.querySelector('.sticky-text')), 30);
}
async function askUnlock(el) {
  const s = stickyOf(el); if (!s || !s.enc) return;
  const pw = await promptBox({ title: 'Unlock note', label: 'Password', password: true, okLabel: 'Unlock' });
  if (!pw) return;
  try {
    const salt = b64.from(s.enc.salt);
    const key = await deriveKey(pw, salt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.from(s.enc.iv) }, key, b64.from(s.enc.data));
    unlocked.set(s.id, { text: new TextDecoder().decode(plain), key, salt });
    rerenderSticky(s, true);
    window.Sound && Sound.play('pop');
  } catch (e) {
    H().toast('That password is not right', { ic: 'lock' });
    const n = $(`#stickies .sticky[data-sid="${s.id}"]`); if (n && !REDUCED) n.animate([{ transform: `rotate(${s.rot}deg) translateX(0)` }, { transform: `rotate(${s.rot}deg) translateX(-8px)` }, { transform: `rotate(${s.rot}deg) translateX(8px)` }, { transform: `rotate(${s.rot}deg) translateX(0)` }], { duration: 300 });
  }
}
async function sealSticky(s, relock) {
  const u = unlocked.get(s.id); if (!u) return;
  clearTimeout(u.timer);
  if (u.dirty || relock) { s.enc = await encryptText(u.text || '', u.key, u.salt); u.dirty = false; touch(curPg()); H().save(); }
  if (relock) { unlocked.delete(s.id); rerenderSticky(s); window.Sound && Sound.play('tap'); }
}
function lockAll() {
  const pg = curPg();
  [...unlocked.keys()].forEach(id => { const s = pg && (pg.stickies || []).find(x => x.id === id); if (s) sealSticky(s, true); else unlocked.delete(id); });
}

// ---------- shapes
let shapeDraft = null, selShape = null, shapeDrag = null;
function startShape(kind) {
  ns.shape = kind;
  setTool('shape');
  H().toast(`Drag on the page to draw a ${SHAPES[kind].name.toLowerCase()}`, { ic: 'shapes', timeout: 3000 });
}
function pxOf(sh, pw) { return { x1: sh.x1 / 100 * pw, y1: sh.y1, x2: sh.x2 / 100 * pw, y2: sh.y2 }; }
function arrowHead(x, y, ang, size = 13) {
  const a1 = ang + Math.PI - .45, a2 = ang + Math.PI + .45;
  return `M${(x + size * Math.cos(a1)).toFixed(1)} ${(y + size * Math.sin(a1)).toFixed(1)} L${x.toFixed(1)} ${y.toFixed(1)} L${(x + size * Math.cos(a2)).toFixed(1)} ${(y + size * Math.sin(a2)).toFixed(1)}`;
}
function shapePath(sh, pw) {
  const { x1, y1, x2, y2 } = pxOf(sh, pw);
  const L = Math.min(x1, x2), R = Math.max(x1, x2), T = Math.min(y1, y2), B = Math.max(y1, y2), w = R - L, h = B - T;
  const f = (n) => n.toFixed(1);
  switch (sh.type) {
    case 'line': return `M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)}`;
    case 'arrow': { const a = Math.atan2(y2 - y1, x2 - x1); return `M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} ` + arrowHead(x2, y2, a); }
    case 'darrow': { const a = Math.atan2(y2 - y1, x2 - x1); return `M${f(x1)} ${f(y1)} L${f(x2)} ${f(y2)} ` + arrowHead(x2, y2, a) + ' ' + arrowHead(x1, y1, a + Math.PI); }
    case 'elbow': case 'elbowa': case 'elbowd': {
      let d = `M${f(x1)} ${f(y1)} L${f(x2)} ${f(y1)} L${f(x2)} ${f(y2)}`;
      if (sh.type !== 'elbow' && Math.abs(y2 - y1) > 2) d += ' ' + arrowHead(x2, y2, y2 > y1 ? Math.PI / 2 : -Math.PI / 2);
      if (sh.type === 'elbowd' && Math.abs(x2 - x1) > 2) d += ' ' + arrowHead(x1, y1, x2 > x1 ? Math.PI : 0);
      return d;
    }
    case 'rect': return `M${f(L)} ${f(T)} H${f(R)} V${f(B)} H${f(L)} Z`;
    case 'ellipse': { const rx = w / 2, ry = h / 2, cx = L + rx, cy = T + ry; return `M${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)} Z`; }
    case 'para': { const k = Math.min(w * .25, h); return `M${f(L + k)} ${f(T)} H${f(R)} L${f(R - k)} ${f(B)} H${f(L)} Z`; }
    case 'tri': return `M${f(L + w / 2)} ${f(T)} L${f(R)} ${f(B)} L${f(L)} ${f(B)} Z`;
    case 'diamond': return `M${f(L + w / 2)} ${f(T)} L${f(R)} ${f(T + h / 2)} L${f(L + w / 2)} ${f(B)} L${f(L)} ${f(T + h / 2)} Z`;
  }
  return '';
}
function shapeSvg(sh, pw) {
  const d = shapePath(sh, pw);
  const c = SHAPE_COLOURS[sh.color] || sh.color || SHAPE_COLOURS.graphite;
  return `<g class="shape" data-shid="${sh.id}"><path class="sh-hit" d="${d}"/><path class="sh-line" d="${d}" stroke="${c}" stroke-width="${sh.width || 2.4}"/></g>`;
}
function renderShapes() {
  const sv = $('#shapes'), page = $('#page'), pg = curPg(); if (!sv || !page || !pg) return;
  const pw = page.clientWidth;
  sv.setAttribute('width', pw); sv.setAttribute('height', page.offsetHeight);
  sv.dataset.r = '1';
  sv.innerHTML = (pg.shapes || []).map(sh => shapeSvg(sh, pw)).join('') + (shapeDraft ? shapeSvg(shapeDraft, pw).replace('class="shape"', 'class="shape draft"') : '') + selHandles(pw);
}
function selHandles(pw) {
  const pg = curPg(); const sh = selShape && (pg.shapes || []).find(x => x.id === selShape); if (!sh) return '';
  const { x1, y1, x2, y2 } = pxOf(sh, pw);
  return `<g class="shape-sel"><rect class="sel-box" x="${Math.min(x1, x2) - 6}" y="${Math.min(y1, y2) - 6}" width="${Math.abs(x2 - x1) + 12}" height="${Math.abs(y2 - y1) + 12}" rx="4"/>
    <circle class="sel-h" data-h="1" cx="${x1}" cy="${y1}" r="7"/><circle class="sel-h" data-h="2" cx="${x2}" cy="${y2}" r="7"/></g>`;
}
const pagePt = (e) => { const r = $('#page').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, pw: r.width }; };
function shapeDown(e) {
  const p = pagePt(e);
  shapeDraft = { id: nid('sh'), type: ns.shape || 'rect', x1: p.x / p.pw * 100, y1: p.y, x2: p.x / p.pw * 100, y2: p.y, color: ns.shapeColor || 'red', width: 2.4 };
  renderShapes();
}
function shapeMove(e) {
  if (!shapeDraft) return;
  const p = pagePt(e);
  let x = p.x, y = p.y;
  if (e.shiftKey) { // keep it square / straight
    const sx = shapeDraft.x1 / 100 * p.pw, sy = shapeDraft.y1;
    if (['line', 'arrow', 'darrow'].includes(shapeDraft.type)) { if (Math.abs(x - sx) > Math.abs(y - sy)) y = sy; else x = sx; }
    else { const d = Math.max(Math.abs(x - sx), Math.abs(y - sy)); x = sx + Math.sign(x - sx || 1) * d; y = sy + Math.sign(y - sy || 1) * d; }
  }
  shapeDraft.x2 = x / p.pw * 100; shapeDraft.y2 = y;
  renderShapes();
}
function shapeUp(e) {
  const pg = curPg(); const sh = shapeDraft; shapeDraft = null; if (!sh || !pg) return;
  const pw = $('#page').clientWidth;
  if (Math.hypot((sh.x2 - sh.x1) / 100 * pw, sh.y2 - sh.y1) < 8) { // a click: drop a default-sized shape
    const lineish = ['line', 'arrow', 'darrow'].includes(sh.type);
    sh.x2 = sh.x1 + (lineish ? 140 : 150) / pw * 100; sh.y2 = sh.y1 + (lineish ? 0 : 90);
  }
  pg.shapes = pg.shapes || []; pg.shapes.push(sh);
  touch(pg); H().save();
  setTool('type');
  selectShape(sh.id);
  window.Sound && Sound.play('tap');
  fitPage();
}
let shBar = null;
function selectShape(id) {
  selShape = id;
  if (shBar) { shBar.remove(); shBar = null; }
  renderShapes();
  const pg = curPg(); const sh = id && pg && (pg.shapes || []).find(x => x.id === id); if (!sh) return;
  const page = $('#page'); const pr = page.getBoundingClientRect(); const pw = page.clientWidth;
  const { x1, y1, x2, y2 } = pxOf(sh, pw);
  shBar = document.createElement('div'); shBar.className = 'sel-bar';
  shBar.innerHTML = Object.entries(SHAPE_COLOURS).map(([k, c]) => `<button class="pen ${sh.color === k ? 'on' : ''}" style="--c:${c}" data-shc="${k}" title="${k}"></button>`).join('') +
    `<span class="sep"></span><button data-shw="1" title="Thin">${icon('divider', 'sm')}</button><button data-shw="3.6" class="thick" title="Thick">${icon('divider', 'sm')}</button><span class="sep"></span><button data-shdel="1" title="Delete (Del)">${icon('trash', 'sm')}</button>`;
  page.appendChild(shBar);
  shBar.style.left = Math.max(0, Math.min(x1, x2)) + 'px';
  shBar.style.top = Math.max(0, Math.min(y1, y2) - 46) + 'px';
}
document.addEventListener('mousedown', (e) => {
  const b = e.target.closest && e.target.closest('.sel-bar button'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const pg = curPg(); const sh = (pg.shapes || []).find(x => x.id === selShape); if (!sh) return;
  if (b.dataset.shc) { sh.color = b.dataset.shc; ns.shapeColor = sh.color; }
  if (b.dataset.shw) sh.width = +b.dataset.shw === 1 ? 1.6 : 3.6;
  if (b.dataset.shdel) { deleteShape(sh.id); return; }
  touch(pg); H().save(); selectShape(sh.id);
}, true);
function deleteShape(id) {
  const pg = curPg(); const snap = H().snapshot();
  pg.shapes = (pg.shapes || []).filter(x => x.id !== id); touch(pg); H().save();
  selectShape(null); H().undoable('Shape deleted', snap, 'trash');
}
// pick, move and reshape shapes (works in normal writing mode)
document.addEventListener('pointerdown', (e) => {
  const page = $('#page'); if (!page || ns.tool !== 'type' || e.button !== 0) return;
  const g = e.target.closest && e.target.closest('#shapes .shape:not(.draft)');
  const h = e.target.closest && e.target.closest('#shapes .sel-h');
  if (!g && !h) { if (selShape && !(e.target.closest && e.target.closest('.sel-bar'))) selectShape(null); return; }
  e.preventDefault(); e.stopPropagation();
  const id = h ? selShape : g.dataset.shid;
  if (!h && id !== selShape) selectShape(id);
  const pg = curPg(); const sh = pg.shapes.find(x => x.id === id); if (!sh) return;
  const p = pagePt(e);
  shapeDrag = { id, mode: h ? 'h' + h.dataset.h : 'move', sx: p.x, sy: p.y, o: { ...sh }, pid: e.pointerId };
}, true);
document.addEventListener('pointermove', (e) => {
  if (!shapeDrag || e.pointerId !== shapeDrag.pid) return;
  const pg = curPg(); const sh = pg.shapes.find(x => x.id === shapeDrag.id); if (!sh) return;
  const p = pagePt(e); const dx = (p.x - shapeDrag.sx) / p.pw * 100, dy = p.y - shapeDrag.sy; const o = shapeDrag.o;
  if (shapeDrag.mode === 'move') { sh.x1 = o.x1 + dx; sh.x2 = o.x2 + dx; sh.y1 = o.y1 + dy; sh.y2 = o.y2 + dy; }
  else if (shapeDrag.mode === 'h1') { sh.x1 = o.x1 + dx; sh.y1 = o.y1 + dy; }
  else { sh.x2 = o.x2 + dx; sh.y2 = o.y2 + dy; }
  shapeDrag.moved = true;
  if (shBar) shBar.style.opacity = 0;
  renderShapes();
});
document.addEventListener('pointerup', (e) => {
  if (!shapeDrag || e.pointerId !== shapeDrag.pid) return;
  const d = shapeDrag; shapeDrag = null;
  if (d.moved) { touch(curPg()); H().save(); fitPage(); }
  selectShape(d.id);
});
document.addEventListener('keydown', (e) => {
  if (!selShape || H().state.view !== 'notes') return;
  const typing = /INPUT|TEXTAREA/.test(e.target.tagName) || e.target.isContentEditable;
  if ((e.key === 'Delete' || (e.key === 'Backspace' && !typing))) { e.preventDefault(); deleteShape(selShape); }
  if (e.key === 'Escape') selectShape(null);
});

// ================================================================== CONTEXT MENUS, CHAPTERS, PAGE ORGANISING
function ctxMenu(items, x, y, opts = {}) {
  if (!opts.level) closeMenu();
  $$('.menu').forEach(m => { if ((+m.dataset.level || 0) >= (opts.level || 0) && opts.level) m.remove(); });
  const m = document.createElement('div');
  m.className = 'menu ctx' + (opts.level ? ' sub' : '');
  m.dataset.level = opts.level || 0;
  items.filter(it => it !== null && it !== false && it !== undefined).forEach((it, i, arr) => {
    if (it === '-') { if (i > 0 && arr[i - 1] !== '-' && i < arr.length - 1) m.insertAdjacentHTML('beforeend', '<div class="menu-sep"></div>'); return; }
    if (it.header) { m.insertAdjacentHTML('beforeend', `<div class="menu-label">${esc(it.header)}</div>`); return; }
    const b = document.createElement('button');
    b.className = (it.danger ? 'danger ' : '') + (it.sub ? 'has-sub' : '');
    b.disabled = !!it.disabled;
    b.innerHTML = `${it.color ? `<span class="mi-dot" style="--c:${esc(it.color)}">${icon(it.ic || 'dot', 'sm')}</span>` : icon(it.ic || 'dot', 'sm')}<span class="mi"${it.font ? ` style="font-family:${esc(it.font)}"` : ''}>${esc(it.label)}</span>${it.sub ? `<span class="sub-arrow">${icon('chevronR', 'sm')}</span>` : it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}`;
    if (it.sub) {
      const openSub = () => {
        $$('.menu.ctx').forEach(x => x.classList.remove('sub-open-from'));
        const r = b.getBoundingClientRect();
        $$('.menu.ctx button.sub-on', m).forEach(x => x.classList.remove('sub-on'));
        b.classList.add('sub-on');
        ctxMenu(it.sub, r.right + 2, r.top - 6, { level: (opts.level || 0) + 1, from: r });
      };
      b.addEventListener('mouseenter', openSub);
      b.addEventListener('click', (e) => { e.stopPropagation(); openSub(); });
    } else {
      b.addEventListener('mouseenter', () => { $$('.menu.ctx').forEach(x => { if ((+x.dataset.level || 0) > (opts.level || 0)) x.remove(); }); $$('button.sub-on', m).forEach(x => x.classList.remove('sub-on')); });
      b.addEventListener('click', (e) => { e.stopPropagation(); if (it.disabled) return; closeMenu(); it.fn && it.fn(); });
    }
    m.appendChild(b);
  });
  document.body.appendChild(m);
  const w = m.offsetWidth, h = m.offsetHeight;
  let left = opts.alignRight ? x - w : x, top = y;
  if (left + w > innerWidth - 8) left = opts.from ? opts.from.left - w - 2 : innerWidth - w - 8;
  if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
  m.style.left = Math.max(8, left) + 'px'; m.style.top = top + 'px';
  return m;
}
function refreshDeskChrome() {
  if (!$('#desk')) return;
  renderToolbarOnly();
  const pg = curPg();
  if (!pg) { renderCoverBody(); return; }
  const nb = curNb(), idx = pagesOf(nb.id).indexOf(pg);
  const f = $('#page .page-num'); if (f && nb.kind !== 'journal') f.textContent = `— ${idx + 1} —`;
}
function afterStructureChange() { H().save(); renderShelf(); refreshDeskChrome(); H().updateSidebar(); }

function movePage(id, nbId, chapterId, beforeId, quiet) {
  const pg = getPg(id); const nb = getNb(nbId); if (!pg || !nb) return;
  if (id === ns.pgId) commitEditor();
  const fromNb = pg.notebookId;
  pg.notebookId = nbId; pg.chapterId = chapterId || null;
  const g = pagesOf(nbId).filter(p => p.id !== id && (chapterId ? p.chapterId === chapterId : !chapterOf(nb, p)));
  const at = beforeId ? g.findIndex(p => p.id === beforeId) : -1;
  g.splice(at < 0 ? g.length : at, 0, pg); renumber(g);
  const ch = chapterId ? (nb.chapters || []).find(c => c.id === chapterId) : null;
  if (ch) ch.collapsed = false;
  ns.expanded[nbId] = true;
  touch(pg);
  if (id === ns.pgId && nbId !== ns.nbId) { ns.nbId = nbId; persist(); H().save(); renderShelf(); const keep = $('#desk').scrollTop; renderDesk(); $('#desk').scrollTop = keep; }
  else afterStructureChange();
  if (fromNb !== nbId && ns.nbId === fromNb && !ns.pgId) renderCoverBody();
  if (!quiet) H().toast(ch ? `Moved to "${ch.name}"` : fromNb !== nbId ? `Moved to ${nb.name}` : 'Page moved', { ic: 'folder' });
}
function shiftPage(id, dir) {
  const pg = getPg(id); const g = groupOf(pg); const i = g.indexOf(pg), j = i + dir;
  if (j < 0 || j >= g.length) return;
  [g[i], g[j]] = [g[j], g[i]]; renumber(g);
  afterStructureChange();
}
function duplicatePage(id) {
  if (id === ns.pgId) commitEditor();
  const src = getPg(id); if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  Object.assign(copy, { id: nid('pg'), title: (src.title && src.title.trim() ? src.title.trim() : pageLabel(src, pagesOf(src.notebookId).indexOf(src))) + ' (copy)', bookmarked: false, createdAt: Date.now(), updatedAt: Date.now() });
  delete copy.date;
  copy.stickies = (copy.stickies || []).map(x => ({ ...x, id: nid('st'), onDesk: false }));
  copy.images = (copy.images || []).map(x => ({ ...x, id: nid('im') }));
  const t = document.createElement('template'); t.innerHTML = copy.html || '';
  $$('[data-task]', t.content).forEach(x => x.removeAttribute('data-task'));
  $$('.tasked', t.content).forEach(x => x.replaceWith(...x.childNodes));
  copy.html = t.innerHTML;
  D().pages.push(copy);
  placeAfter(copy, src);
  H().save();
  turnTo(copy.notebookId, copy.id, 1);
  H().toast('Page duplicated', { ic: 'copy' });
}
function deletePage(id) {
  if (id === ns.pgId) { actions['pg-delete'](); return; }
  const pg = getPg(id); if (!pg) return;
  const snap = H().snapshot();
  D().pages = D().pages.filter(p => p.id !== id);
  D().tasks.forEach(t => { if (t.noteRef && t.noteRef.pageId === id) delete t.noteRef; });
  afterStructureChange();
  H().undoable('Page deleted', snap, 'trash');
}
function toggleRibbon(id) {
  const pg = getPg(id); if (!pg) return;
  pg.bookmarked = !pg.bookmarked; touch(pg); H().save();
  if (id === ns.pgId) { const r = $('#page .ribbon'); if (r) { r.classList.toggle('on', pg.bookmarked); r.title = pg.bookmarked ? 'Remove ribbon' : 'Mark this page with a ribbon'; } }
  renderShelf();
  H().toast(pg.bookmarked ? 'Ribbon added: find it under Ribbons' : 'Ribbon removed', { ic: 'ribbon' });
}
function saveTemplate(id) {
  if (id === ns.pgId) commitEditor();
  const pg = getPg(id); if (!pg) return;
  const name = (pg.title || '').replace(/[:\s]+$/, '').trim() || 'My template';
  const t = document.createElement('template'); t.innerHTML = pg.html || '';
  $$('[data-task]', t.content).forEach(x => x.removeAttribute('data-task'));
  $$('.tasked', t.content).forEach(x => x.replaceWith(...x.childNodes));
  $$('ul.checks li.checked', t.content).forEach(x => x.classList.remove('checked'));
  D().noteTemplates.push({ id: nid('tp'), name, title: pg.title || '', html: t.innerHTML, createdAt: Date.now() });
  H().save();
  H().toast(`Saved "${name}" as a template. Find it under + Page.`, { ic: 'template' });
}
function newChapter(nbId, pageId) {
  const nb = getNb(nbId); if (!nb || nb.kind === 'journal') return;
  nb.chapters = nb.chapters || [];
  const c = { id: nid('ch'), name: 'New chapter', collapsed: false, order: Math.max(0, ...nb.chapters.map(x => x.order || 0)) + 1 };
  nb.chapters.push(c);
  ns.expanded[nbId] = true;
  if (pageId) movePage(pageId, nbId, c.id, null, true); else afterStructureChange();
  setTimeout(() => renameChapter(nbId, c.id), 40);
}
function removeChapter(nbId, chId, withPages) {
  const nb = getNb(nbId); const c = (nb.chapters || []).find(x => x.id === chId); if (!c) return;
  const snap = H().snapshot();
  const inside = D().pages.filter(p => p.notebookId === nbId && p.chapterId === chId);
  if (withPages) {
    const ids = new Set(inside.map(p => p.id));
    D().pages = D().pages.filter(p => !ids.has(p.id));
    D().tasks.forEach(t => { if (t.noteRef && ids.has(t.noteRef.pageId)) delete t.noteRef; });
    nb.chapters = nb.chapters.filter(x => x.id !== chId);
    if (ids.has(ns.pgId)) { ns.pgId = '__gone__'; H().save(); turnTo(nbId, (pagesOf(nbId)[0] || {}).id || null, -1); }
    else afterStructureChange();
    H().undoable(`Deleted "${c.name}" and ${H().plural(inside.length, 'page')}`, snap, 'trash');
  } else {
    const loose = pagesOf(nbId).filter(p => !chapterOf(nb, p));
    nb.chapters = nb.chapters.filter(x => x.id !== chId);
    inside.sort(byOrd).forEach(p => { p.chapterId = null; loose.push(p); });
    renumber(loose);
    afterStructureChange();
    H().undoable(`Removed chapter "${c.name}" (pages kept)`, snap, 'folder');
  }
}
function shiftChapter(nbId, chId, dir) {
  const nb = getNb(nbId); const cs = chaptersOf(nb); const i = cs.findIndex(c => c.id === chId), j = i + dir;
  if (j < 0 || j >= cs.length) return;
  [cs[i], cs[j]] = [cs[j], cs[i]]; cs.forEach((c, k) => { c.order = k + 1; });
  afterStructureChange();
}
function deleteNotebook(id) {
  const nb = getNb(id); if (!nb || nb.kind !== 'normal') return;
  const snap = H().snapshot();
  const ids = new Set(D().pages.filter(p => p.notebookId === id).map(p => p.id));
  D().pages = D().pages.filter(p => !ids.has(p.id));
  D().notebooks = D().notebooks.filter(n => n.id !== id);
  D().tasks.forEach(t => { if (t.noteRef && ids.has(t.noteRef.pageId)) delete t.noteRef; });
  if (ns.nbId === id) {
    const next = notebooks()[0];
    ns.nbId = '__gone__'; H().save();
    turnTo(next.id, (pagesOf(next.id)[0] || {}).id || null, -1);
  } else afterStructureChange();
  H().undoable(`Deleted "${nb.name}"`, snap, 'trash');
}

// ---------- inline renaming in the shelf
function renameInline(rowEl, value, placeholder, onCommit) {
  if (!rowEl) return;
  const box = document.createElement('div');
  box.className = rowEl.className.replace(/\b(active|ctx-on)\b/g, '') + ' renaming';
  box.innerHTML = `<input class="rename-input" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="80" spellcheck="false">`;
  rowEl.replaceWith(box);
  const i = box.querySelector('input'); i.focus(); i.select();
  let done = false;
  const fin = (ok) => { if (done) return; done = true; if (ok) onCommit(i.value.trim()); renderShelf(); };
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fin(true); } if (e.key === 'Escape') { e.stopPropagation(); fin(false); } });
  i.addEventListener('blur', () => fin(true));
}
function revealPageRow(id) {
  const pg = getPg(id); if (!pg) return null;
  const nb = getNb(pg.notebookId);
  ns.expanded[nb.id] = true;
  const ch = chapterOf(nb, pg); if (ch) ch.collapsed = false;
  renderShelf();
  return $(`#shelf .pg-row[data-pg="${id}"]`);
}
function renamePage(id) {
  const pg = getPg(id); if (!pg) return;
  renameInline(revealPageRow(id), pg.title || '', 'Page title', (v) => {
    pg.title = v; touch(pg); H().save();
    if (id === ns.pgId) { const t = $('#page-title'); if (t) t.value = v; renderToolbarOnly(); }
  });
}
function renameChapter(nbId, chId) {
  const nb = getNb(nbId); const c = (nb.chapters || []).find(x => x.id === chId); if (!c) return;
  ns.expanded[nbId] = true; renderShelf();
  renameInline($(`#shelf .chap-row[data-chap="${chId}"]`), c.name, 'Chapter name', (v) => { if (v) { c.name = v; H().save(); refreshDeskChrome(); } });
}
function renameNotebook(id) {
  const nb = getNb(id); if (!nb) return;
  renameInline($(`#shelf .nb-row[data-nb="${id}"]`), nb.name, 'Notebook name', (v) => {
    if (!v) return;
    nb.name = v; nb.updatedAt = Date.now(); H().save();
    if (id === ns.nbId) { commitEditor(); const keep = $('#desk').scrollTop; renderDesk(); $('#desk').scrollTop = keep; }
  });
}

// ---------- menu contents
function moveTargets(pg) {
  // every notebook (and its chapters) this page could move to
  const here = getNb(pg.notebookId);
  return notebooks().filter(n => n.kind !== 'journal').map(n => {
    const cs = chaptersOf(n);
    const isHere = n.id === here.id;
    if (!cs.length) return { label: n.name + (isHere ? ' (here)' : ''), ic: 'book', disabled: isHere && !chapterOf(here, pg), fn: () => movePage(pg.id, n.id, null) };
    return { label: n.name + (isHere ? ' (here)' : ''), ic: 'book', sub: [
      { label: 'No chapter', ic: 'note', disabled: isHere && !chapterOf(here, pg), fn: () => movePage(pg.id, n.id, null) }, '-',
      ...cs.map(c => ({ label: c.name, ic: 'folder', disabled: c.id === pg.chapterId, fn: () => movePage(pg.id, n.id, c.id) }))
    ] };
  });
}
function pageMenuItems(pg, fromToolbar) {
  const nb = getNb(pg.notebookId); const journal = nb.kind === 'journal';
  const g = groupOf(pg); const gi = g.indexOf(pg);
  const chaps = chaptersOf(nb); const cur = chapterOf(nb, pg);
  const others = chaps.filter(c => c.id !== pg.chapterId);
  return [
    !fromToolbar && { label: 'Open', ic: 'book', fn: () => turnTo(nb.id, pg.id) },
    !fromToolbar && !journal && { label: 'Rename', ic: 'edit', fn: () => renamePage(pg.id) },
    !journal && { label: 'Duplicate page', ic: 'copy', fn: () => duplicatePage(pg.id) },
    !journal && { label: 'Move up', ic: 'chevronUp', disabled: gi <= 0, fn: () => shiftPage(pg.id, -1) },
    !journal && { label: 'Move down', ic: 'chevron', disabled: gi >= g.length - 1, fn: () => shiftPage(pg.id, 1) },
    '-',
    !journal && { label: cur ? 'Move to chapter' : 'Add to chapter', ic: 'folder', sub: [
      cur && { label: 'No chapter (loose page)', ic: 'note', fn: () => movePage(pg.id, nb.id, null) },
      ...others.map(c => ({ label: c.name, ic: 'folder', fn: () => movePage(pg.id, nb.id, c.id) })),
      (cur || others.length) ? '-' : null,
      { label: 'New chapter…', ic: 'plus', fn: () => newChapter(nb.id, pg.id) }
    ] },
    { label: 'Move to notebook', ic: 'arrowRight', sub: moveTargets(pg) },
    '-',
    { label: pg.bookmarked ? 'Remove ribbon' : 'Add ribbon', ic: 'ribbon', fn: () => toggleRibbon(pg.id) },
    !journal && { label: 'Save as template', ic: 'template', fn: () => saveTemplate(pg.id) },
    { label: 'Export page as PDF', ic: 'file', fn: () => exportPages(nb, [pg]) },
    '-',
    { label: 'Delete page', ic: 'trash', danger: true, fn: () => deletePage(pg.id) }
  ];
}
function chapterMenuItems(nbId, chId) {
  const nb = getNb(nbId); const cs = chaptersOf(nb); const i = cs.findIndex(c => c.id === chId); const c = cs[i];
  return [
    { label: 'Rename chapter', ic: 'edit', fn: () => renameChapter(nbId, chId) },
    { label: 'New page in this chapter', ic: 'plus', fn: () => actions['pg-new']({ dataset: { nb: nbId, chap: chId } }) },
    { label: c.collapsed ? 'Expand' : 'Collapse', ic: c.collapsed ? 'chevron' : 'chevronUp', fn: () => { c.collapsed = !c.collapsed; H().save(); renderShelf(); } },
    { label: 'Move up', ic: 'chevronUp', disabled: i <= 0, fn: () => shiftChapter(nbId, chId, -1) },
    { label: 'Move down', ic: 'chevron', disabled: i >= cs.length - 1, fn: () => shiftChapter(nbId, chId, 1) },
    '-',
    { label: 'Remove chapter (keep pages)', ic: 'folder', fn: () => removeChapter(nbId, chId, false) },
    { label: 'Delete chapter and its pages', ic: 'trash', danger: true, fn: () => removeChapter(nbId, chId, true) }
  ];
}
function notebookMenuItems(nbId) {
  const nb = getNb(nbId); const journal = nb.kind === 'journal';
  return [
    { label: 'Open', ic: 'book', fn: () => turnTo(nbId, nb.lastPg && getPg(nb.lastPg) ? nb.lastPg : (pagesOf(nbId)[0] || {}).id || null) },
    !journal && { label: 'Rename notebook', ic: 'edit', fn: () => renameNotebook(nbId) },
    !journal && { label: 'New page', ic: 'plus', fn: () => actions['pg-new']({ dataset: { nb: nbId } }) },
    !journal && { label: 'New chapter', ic: 'folder', fn: () => newChapter(nbId) },
    { label: 'Inside cover & settings', ic: 'sliders', fn: () => turnTo(nbId, null, -1) },
    { label: 'Export notebook as PDF', ic: 'file', fn: () => exportPages(nb, pagesOf(nbId)) },
    nb.kind === 'normal' && '-',
    nb.kind === 'normal' && { label: 'Delete notebook', ic: 'trash', danger: true, fn: () => deleteNotebook(nbId) }
  ];
}
document.addEventListener('contextmenu', (e) => {
  const inShelf = e.target.closest && e.target.closest('#shelf');
  if (!inShelf) return;
  const pr = e.target.closest('.pg-row[data-drag-pg], .pg-row.rib[data-pg]'), cr = e.target.closest('.chap-row'), nr = e.target.closest('.nb-row');
  const row = pr || cr || nr;
  if (!row) return;
  e.preventDefault();
  closeMenu();
  row.classList.add('ctx-on');
  const items = pr ? pageMenuItems(getPg(pr.dataset.dragPg || pr.dataset.pg)) : cr ? chapterMenuItems(cr.dataset.nb, cr.dataset.chap) : notebookMenuItems(nr.dataset.nb);
  ctxMenu(items, e.clientX, e.clientY);
  window.Sound && Sound.play('tap');
});

// ---------- drag pages around the shelf (reorder, into chapters, into other notebooks)
let sdrag = null, sdragClick = false;
document.addEventListener('pointerdown', (e) => {
  const row = e.button === 0 && e.target.closest && e.target.closest('#shelf .pg-row[data-drag-pg]');
  if (!row) return;
  const pg = getPg(row.dataset.dragPg); if (!pg || getNb(pg.notebookId).kind === 'journal') return;
  sdrag = { row, id: pg.id, sx: e.clientX, sy: e.clientY, started: false, pid: e.pointerId };
});
document.addEventListener('pointermove', (e) => {
  if (!sdrag || e.pointerId !== sdrag.pid) return;
  if (!sdrag.started) {
    if (Math.hypot(e.clientX - sdrag.sx, e.clientY - sdrag.sy) < 6) return;
    sdrag.started = true;
    const r = sdrag.row.getBoundingClientRect();
    sdrag.ox = e.clientX - r.left; sdrag.oy = e.clientY - r.top;
    const g = sdrag.row.cloneNode(true); g.className += ' shelf-ghost'; g.style.width = r.width + 'px';
    document.body.appendChild(g); sdrag.ghost = g;
    const l = document.createElement('div'); l.className = 'shelf-line'; document.body.appendChild(l); sdrag.line = l;
    sdrag.row.classList.add('drag-src');
    document.body.classList.add('dragging-task');
    window.Sound && Sound.play('lift');
  }
  sdrag.ghost.style.transform = `translate(${e.clientX - sdrag.ox}px, ${e.clientY - sdrag.oy}px) rotate(1.5deg)`;
  $$('#shelf .drop-hover').forEach(x => x.classList.remove('drop-hover'));
  sdrag.line.style.opacity = 0;
  sdrag.target = null;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const shelf = $('#shelf');
  if (!under || !shelf.contains(under)) return;
  // auto-scroll the shelf near its edges
  const sr = shelf.getBoundingClientRect();
  if (e.clientY < sr.top + 40) shelf.scrollTop -= 10; else if (e.clientY > sr.bottom - 40) shelf.scrollTop += 10;
  const pr = under.closest('.pg-row[data-drag-pg]'), cr = under.closest('.chap-row'), cp = under.closest('.chap-pages'), nr = under.closest('.nb-row');
  if (pr && pr.dataset.dragPg !== sdrag.id) {
    const tp = getPg(pr.dataset.dragPg), tnb = getNb(tp.notebookId);
    if (tnb.kind === 'journal') return;
    const r = pr.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    const g = groupOf(tp), i = g.indexOf(tp);
    let before = after ? (g[i + 1] || {}).id || null : tp.id;
    if (before === sdrag.id) before = (g[i + 2] || {}).id || null;
    sdrag.target = { nb: tnb.id, chap: chapterOf(tnb, tp) ? tp.chapterId : null, before };
    const L = sdrag.line; L.style.left = r.left + 6 + 'px'; L.style.width = r.width - 12 + 'px'; L.style.top = (after ? r.bottom : r.top) - 1 + 'px'; L.style.opacity = 1;
  } else if (cr || cp) {
    const el = cr || cp; const nbId = el.dataset.nb, ch = el.dataset.chap || el.dataset.chapDrop;
    (cr || cp.parentElement.querySelector('.chap-row')).classList.add('drop-hover');
    sdrag.target = { nb: nbId, chap: ch, before: null };
  } else if (nr) {
    const nb = getNb(nr.dataset.nb); if (nb.kind === 'journal') return;
    nr.classList.add('drop-hover');
    sdrag.target = { nb: nb.id, chap: null, before: null };
  }
});
function endShelfDrag(commit) {
  const d = sdrag; sdrag = null; if (!d || !d.started) return;
  document.body.classList.remove('dragging-task');
  d.ghost.remove(); d.line.remove(); d.row.classList.remove('drag-src');
  $$('#shelf .drop-hover').forEach(x => x.classList.remove('drop-hover'));
  sdragClick = true; setTimeout(() => { sdragClick = false; }, 80);
  if (commit && d.target) { movePage(d.id, d.target.nb, d.target.chap, d.target.before, true); window.Sound && Sound.play('drop'); }
}
document.addEventListener('pointerup', (e) => { if (sdrag && e.pointerId === sdrag.pid) { if (sdrag.started) endShelfDrag(true); else sdrag = null; } });
document.addEventListener('pointercancel', () => endShelfDrag(false));
document.addEventListener('click', (e) => { if (sdragClick && e.target.closest && e.target.closest('#shelf')) { e.stopPropagation(); e.preventDefault(); sdragClick = false; } }, true);

// ---------- show / hide the notebook shelf
function toggleShelf() {
  ns.shelfHidden = !ns.shelfHidden;
  const n = $('#notes'); if (n) n.classList.toggle('shelf-hidden', ns.shelfHidden);
  persist(); renderToolbarOnly();
}
document.addEventListener('keydown', (e) => {
  if (H().state.view !== 'notes') return;
  if (e.ctrlKey && e.shiftKey && (e.key === '\\' || e.code === 'Backslash')) { e.preventDefault(); toggleShelf(); }
});

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

window.Notes = { ctxMenu, view, mount, light, leave, actions, open, openJournal, journalWrap, deskCard, createForProject, external };
})();
