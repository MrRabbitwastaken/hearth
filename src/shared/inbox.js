// Shared between the main process (quick capture) and the window:
// drops a sticky note onto the first page of the Inbox notebook, creating it if needed.
(function (root) {
  function id(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function ensureInbox(d) {
    d.notebooks = d.notebooks || [];
    d.pages = d.pages || [];
    const now = Date.now();
    let nb = d.notebooks.find(n => n.kind === 'inbox');
    if (!nb) {
      nb = { id: id('nb'), name: 'Inbox', color: '#C68A27', paper: 'dotted', kind: 'inbox', projectId: null, createdAt: now, updatedAt: now, order: -1 };
      d.notebooks.unshift(nb);
    }
    let pg = d.pages.filter(p => p.notebookId === nb.id).sort((a, b) => a.order - b.order)[0];
    if (!pg) {
      pg = { id: id('pg'), notebookId: nb.id, title: 'Loose notes', html: '', stickies: [], strokes: [], bookmarked: false, createdAt: now, updatedAt: now, order: now };
      d.pages.push(pg);
    }
    return { nb, pg };
  }

  function inboxSticky(d, st) {
    const { nb, pg } = ensureInbox(d);
    pg.stickies = pg.stickies || [];
    const n = pg.stickies.length;
    pg.stickies.push(Object.assign({ color: 'yellow', attach: 'pin', rot: 0 }, st, {
      x: 4 + (n % 4) * 23,
      y: 110 + (Math.floor(n / 4) % 6) * 200
    }));
    pg.updatedAt = Date.now();
    nb.updatedAt = Date.now();
    return { nb, pg };
  }

  const api = { ensureInbox, inboxSticky };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.inboxSticky = inboxSticky; root.ensureInbox = ensureInbox; }
})(typeof window !== 'undefined' ? window : globalThis);
