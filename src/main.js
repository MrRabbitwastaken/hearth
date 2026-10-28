// Hearth — main process
// Owns the window, tray, global quick-capture hotkey, data file and the screen-break clock.

const {
  app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, Notification,
  powerMonitor, shell, nativeImage, clipboard, dialog, screen, protocol, net, session
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile, execFileSync } = require('child_process');
const { inboxSticky } = require('./shared/inbox.js');

const APP_ID = 'com.hearth.workassistant';
const ASSETS = path.join(__dirname, 'assets');

// ---------- portable mode ----------
// Hearth-Portable.exe sets PORTABLE_EXECUTABLE_DIR. A "Hearth Data" folder next to Hearth.exe also
// switches it on, so an unzipped copy can live on a USB stick too. Everything is kept in that folder.
const exeDir = path.dirname(process.execPath);
const PORTABLE_DIR = process.env.PORTABLE_EXECUTABLE_DIR ||
  (app.isPackaged && fs.existsSync(path.join(exeDir, 'Hearth Data')) ? exeDir : null);
const PORTABLE = !!PORTABLE_DIR;
if (PORTABLE) {
  const dir = path.join(PORTABLE_DIR, 'Hearth Data');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  app.setPath('userData', dir);
  app.setPath('sessionData', path.join(dir, 'Browser'));
}

// pictures are referenced as hearth://img/<file>, so they still work when the drive letter changes
protocol.registerSchemesAsPrivileged([{ scheme: 'hearth', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
// ---------- where the data lives ----------
// Normally the Windows profile (%APPDATA%\Hearth). Settings → Your data can point it at any folder,
// e.g. OneDrive, which gives a cloud backup and the same data on another PC. Portable mode keeps it beside the exe.
const locationFile = () => path.join(app.getPath('userData'), 'data-location.json');
let DATA_DIR = null;
function dataDir() {
  if (DATA_DIR) return DATA_DIR;
  DATA_DIR = app.getPath('userData');
  if (!PORTABLE) {
    try {
      const p = JSON.parse(fs.readFileSync(locationFile(), 'utf8'));
      if (p && p.dir && fs.existsSync(p.dir)) DATA_DIR = p.dir;
    } catch (_) {}
  }
  return DATA_DIR;
}
const imagesDir = () => path.join(dataDir(), 'images');

// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let captureWindow = null;
let tray = null;
let quitting = false;

// ---------- data store ----------
const dataFile = () => path.join(dataDir(), 'hearth-data.json');
let data = null;
let writeTimer = null;
let lastWriteMtime = 0;
let lastRendererSave = 0;

function defaultData() {
  return {
    version: 1,
    tasks: [],
    projects: [],
    waiting: [],
    recurring: [],
    snippets: [],
    focusLog: [],
    dayLog: {},
    meta: {},
    settings: {
      name: '',
      breakInterval: 60,
      snoozeMinutes: 10,
      idleResetMinutes: 5,
      wrapTime: '17:00',
      focusMinutes: 25,
      launchAtStartup: true,
      closeToTray: true,
      staleProjectDays: 7,
      hotkey: 'CommandOrControl+Alt+Space'
    }
  };
}

function loadData() {
  try {
    let raw = fs.readFileSync(dataFile(), 'utf8');
    // older versions stored pictures as absolute file:// paths; make them portable
    raw = raw.replace(/file:\/\/\/[^"'\\\s)<>]*?\/images\/(img-[A-Za-z0-9-]+\.(?:png|jpe?g|gif|webp))/g, 'hearth://img/$1');
    const parsed = JSON.parse(raw);
    const def = defaultData();
    data = { ...def, ...parsed, settings: { ...def.settings, ...(parsed.settings || {}) } };
    try { lastWriteMtime = fs.statSync(dataFile()).mtimeMs; } catch (_) {}
  } catch (e) {
    if (fs.existsSync(dataFile())) {
      // keep a copy of a damaged file rather than silently losing it
      try { fs.copyFileSync(dataFile(), dataFile() + '.damaged-' + Date.now()); } catch (_) {}
    }
    data = defaultData();
  }
}

function writeNow() {
  clearTimeout(writeTimer);
  writeTimer = null;
  try {
    fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
    const tmp = dataFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, dataFile());
    try { lastWriteMtime = fs.statSync(dataFile()).mtimeMs; } catch (_) {}
    // rolling daily backup
    const backup = path.join(dataDir(), 'backups');
    fs.mkdirSync(backup, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const bfile = path.join(backup, `hearth-${stamp}.json`);
    if (!fs.existsSync(bfile)) {
      fs.copyFileSync(dataFile(), bfile);
      const files = fs.readdirSync(backup).filter(f => f.startsWith('hearth-')).sort();
      while (files.length > 14) fs.unlinkSync(path.join(backup, files.shift()));
    }
  } catch (e) {
    console.error('Save failed', e);
  }
}

function scheduleWrite() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(writeNow, 400);
}

function broadcast(channel, payload, exceptWebContents) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    if (exceptWebContents && w.webContents === exceptWebContents) continue;
    w.webContents.send(channel, payload);
  }
}

// ---------- break clock ----------
// Counts *active* screen time. Locking the PC, sleeping, or being idle for
// idleResetMinutes counts as a break and resets the clock.
const breakState = {
  activeSeconds: 0,
  lastTick: Date.now(),
  snoozedUntil: 0,
  due: false,
  away: false,
  locked: false,
  sessionStart: Date.now()
};

function breakStatus() {
  const s = data.settings;
  return {
    activeSeconds: Math.round(breakState.activeSeconds),
    intervalSeconds: s.breakInterval * 60,
    snoozedUntil: breakState.snoozedUntil,
    due: breakState.due,
    away: breakState.away,
    sessionStart: breakState.sessionStart
  };
}

function resetBreak(reason) {
  breakState.activeSeconds = 0;
  breakState.snoozedUntil = 0;
  breakState.due = false;
  breakState.lastTick = Date.now();
  broadcast('break:status', { ...breakStatus(), reason });
}

function tickBreak() {
  const now = Date.now();
  const elapsed = Math.min((now - breakState.lastTick) / 1000, 120); // clamp after sleep
  breakState.lastTick = now;
  const s = data.settings;
  let idle = 0;
  try { idle = powerMonitor.getSystemIdleTime(); } catch (_) {}
  const idleLimit = s.idleResetMinutes * 60;

  if (breakState.locked || idle >= idleLimit) {
    if (!breakState.away) {
      breakState.away = true;
      resetBreak('away');
    }
    return;
  }
  if (breakState.away) {
    breakState.away = false;
    resetBreak('back');
  }

  breakState.activeSeconds += elapsed;
  const interval = s.breakInterval * 60;
  if (breakState.activeSeconds >= interval && now >= breakState.snoozedUntil && !breakState.due) {
    breakState.due = true;
    triggerBreak();
  }
  broadcast('break:status', breakStatus());
}

// ---------- focus shield & Windows do-not-disturb ----------
let focusShield = false;
const NOTIF_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';
const NOTIF_VAL = 'NOC_GLOBAL_SETTING_TOASTS_ENABLED';
const dndFile = () => path.join(app.getPath('userData'), 'dnd-restore.json');
let dndActive = false;
function reg(args) {
  return new Promise(res => execFile('reg', args, { windowsHide: true }, (err, out) => res({ err, out: String(out || '') })));
}
async function setDnd(on) {
  if (process.platform !== 'win32') return false;
  if (on) {
    if (dndActive) return true;
    const q = await reg(['query', NOTIF_KEY, '/v', NOTIF_VAL]);
    const m = /0x([0-9a-f]+)/i.exec(q.out);
    const prev = !q.err && m ? parseInt(m[1], 16) : null;
    if (prev === 0) return false; // already silenced by the user; leave it alone
    try { fs.writeFileSync(dndFile(), JSON.stringify({ prev })); } catch (_) {}
    const r = await reg(['add', NOTIF_KEY, '/v', NOTIF_VAL, '/t', 'REG_DWORD', '/d', '0', '/f']);
    dndActive = !r.err;
    return dndActive;
  }
  restoreDndSync();
  return true;
}
function restoreDndSync() {
  if (process.platform !== 'win32' || !fs.existsSync(dndFile())) { dndActive = false; return; }
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(dndFile(), 'utf8')).prev; } catch (_) {}
  try {
    if (prev === null || prev === undefined) execFileSync('reg', ['delete', NOTIF_KEY, '/v', NOTIF_VAL, '/f'], { windowsHide: true, stdio: 'ignore' });
    else execFileSync('reg', ['add', NOTIF_KEY, '/v', NOTIF_VAL, '/t', 'REG_DWORD', '/d', String(prev), '/f'], { windowsHide: true, stdio: 'ignore' });
  } catch (_) {}
  try { fs.unlinkSync(dndFile()); } catch (_) {}
  dndActive = false;
}

function triggerBreak() {
  if (focusShield) { broadcast('break:due', breakStatus()); return; } // the window holds it until focus ends
  const mins = Math.round(breakState.activeSeconds / 60);
  notify('Time for a screen break', `You've been at the screen for ${mins} minutes. Look away, stretch, grab some water.`, () => showMain());
  broadcast('break:due', breakStatus());
  if (mainWindow) {
    showMain(false);
    mainWindow.flashFrame(true);
  }
}

// ---------- notifications ----------
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(ASSETS, 'icon.png'), silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
}

// ---------- windows ----------
function showMain(focus = true) {
  if (!mainWindow) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  if (focus) mainWindow.focus();
}

function createMainWindow() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'icon.png'));
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 920,
    minHeight: 620,
    show: false,
    backgroundColor: '#F5EFE6',
    icon,
    title: 'Hearth',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#F5EFE6', symbolColor: '#5A4636', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: true
    }
  });
  mainWindow.removeMenu();
  hookSpellMenu(mainWindow);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    const hidden = process.argv.includes('--hidden');
    if (!hidden) mainWindow.show();
  });
  mainWindow.on('close', (e) => {
    if (!quitting && data.settings.closeToTray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('focus', () => mainWindow.flashFrame(false));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function openCapture() {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.show();
    captureWindow.focus();
    return;
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const w = 560, h = 168;
  captureWindow = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(display.workArea.x + (display.workArea.width - w) / 2),
    y: Math.round(display.workArea.y + display.workArea.height * 0.24),
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  hookSpellMenu(captureWindow);
  captureWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'), { hash: 'capture' });
  captureWindow.once('ready-to-show', () => { captureWindow.show(); captureWindow.focus(); });
  captureWindow.on('blur', () => { if (captureWindow && !captureWindow.isDestroyed()) captureWindow.close(); });
  captureWindow.on('closed', () => { captureWindow = null; });
}

// ---------- tray ----------
function createTray() {
  const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('Hearth');
  const menu = Menu.buildFromTemplate([
    { label: 'Open Hearth', click: () => showMain() },
    { label: 'Quick add task', click: () => openCapture() },
    { type: 'separator' },
    { label: "I've just had a break", click: () => resetBreak('manual') },
    { label: 'Start a break now', click: () => { breakState.due = true; triggerBreak(); } },
    { type: 'separator' },
    { label: 'Quit Hearth', click: () => { quitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMain());
}

function applyStartup() {
  if (!app.isPackaged || PORTABLE) return; // only register an installed copy
  app.setLoginItemSettings({
    openAtLogin: !!data.settings.launchAtStartup,
    args: ['--hidden']
  });
}

// Windows only shows toast notifications for apps that have a Start Menu
// shortcut carrying their AppUserModelID, so create one on first run.
const portableLnk = () => path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hearth (portable).lnk');
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  if (PORTABLE) {
    // a temporary shortcut so Windows will show Hearth's notifications; removed again on quit
    try {
      const target = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
      shell.writeShortcutLink(portableLnk(), fs.existsSync(portableLnk()) ? 'replace' : 'create', { target, appUserModelId: APP_ID, description: 'Hearth (portable)', icon: process.execPath, iconIndex: 0 });
    } catch (_) {}
    return;
  }
  try {
    const lnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hearth.lnk');
    const opts = { target: process.execPath, appUserModelId: APP_ID, description: 'Hearth work assistant', icon: process.execPath, iconIndex: 0 };
    const installerLnk = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Hearth', 'Hearth.lnk');
    if (fs.existsSync(lnk) || fs.existsSync(installerLnk)) return;
    shell.writeShortcutLink(lnk, 'create', opts);
  } catch (e) { console.error('Shortcut failed', e); }
}

function registerHotkey() {
  globalShortcut.unregisterAll();
  const key = data.settings.hotkey || 'CommandOrControl+Alt+Space';
  try {
    const ok = globalShortcut.register(key, openCapture);
    return ok;
  } catch (e) {
    return false;
  }
}

// ---------- IPC ----------
// Tasks added from the quick-capture window, kept briefly so a save that was
// already in flight from the main window can't overwrite them.
let recentCaptures = [];
let recentStickies = [];

ipcMain.handle('store:get', () => data);
ipcMain.handle('store:set', (e, next) => {
  const prevSettings = data.settings;
  const now = Date.now();
  recentCaptures = recentCaptures.filter(r => now - r.at < 3000);
  for (const r of recentCaptures) {
    if (!next.tasks.some(t => t.id === r.task.id)) next.tasks.push(r.task);
  }
  recentStickies = recentStickies.filter(r => now - r.at < 3000);
  for (const r of recentStickies) {
    const found = (next.pages || []).some(pg => (pg.stickies || []).some(s => s.id === r.st.id));
    if (!found) inboxSticky(next, r.st);
  }
  data = next;
  lastRendererSave = Date.now();
  scheduleWrite();
  broadcast('store:changed', null, e.sender);
  if (JSON.stringify(prevSettings) !== JSON.stringify(next.settings)) {
    applyStartup();
    registerHotkey();
    broadcast('break:status', breakStatus());
  }
  return true;
});
ipcMain.handle('store:addTask', (e, task) => {
  data.tasks.push(task);
  recentCaptures.push({ task, at: Date.now() });
  scheduleWrite();
  broadcast('store:changed', null, e.sender);
  return true;
});
ipcMain.handle('store:addSticky', (e, st) => {
  inboxSticky(data, st);
  recentStickies.push({ st, at: Date.now() });
  scheduleWrite();
  broadcast('store:changed', null, e.sender);
  return true;
});

// ---------- streamed soundscapes ----------
// YouTube (or any audio/video link) plays in a hidden window so it keeps going while you work.
function embedUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '');
  let id = null, list = u.searchParams.get('list');
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
    id = u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:live|shorts|embed|v)\/([\w-]{6,})/);
    if (!id && m) id = m[1];
  }
  const q = 'autoplay=1&controls=0&disablekb=1&modestbranding=1&playsinline=1&rel=0&iv_load_policy=3';
  if (id) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${q}&loop=1&playlist=${encodeURIComponent(id)}`;
  if (list) return `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}&${q}&loop=1`;
  return u.href; // a direct audio/stream link
}
let player = null, playerUrl = null, playerVol = .4, appliedVol = 0, fadeTimer = null, pollTimer = null;
// Sets the level inside the hidden player page and installs a guard there: YouTube's own player puts the
// volume back to its saved level whenever the video loops, re-buffers or changes quality, which made the
// sound jump loud then quiet. The guard snaps any change straight back to Hearth's level (window.__hv).
const PLAYER_JS = (v) => `(() => { const v = ${Math.max(0, Math.min(1, v)).toFixed(4)};
  window.__hv = v;
  if (!window.__hguard) {
    window.__hguard = true;
    const near = (x) => Math.abs(x.volume - window.__hv) < 0.004;
    window.__hfix = (x) => {
      if (x.__hg) return; x.__hg = true;
      x.addEventListener('volumechange', () => { if (x.muted) x.muted = false; if (!near(x)) x.volume = window.__hv; });
      ['playing', 'loadeddata', 'seeked', 'ratechange'].forEach(ev => x.addEventListener(ev, () => { if (!near(x)) x.volume = window.__hv; }));
    };
    new MutationObserver(() => document.querySelectorAll('video,audio').forEach(window.__hfix)).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(() => document.querySelectorAll('video,audio').forEach(x => { window.__hfix(x); if (!near(x)) x.volume = window.__hv; }), 300);
    try { localStorage.setItem('yt-player-volume', JSON.stringify({ data: JSON.stringify({ volume: 100, muted: false }), expiration: Date.now() + 864e8, creation: Date.now() })); } catch (e) {}
  }
  try { const mp = document.getElementById('movie_player'); if (mp && mp.setVolume && !window.__hapi) { window.__hapi = true; mp.unMute && mp.unMute(); mp.setVolume(100); } } catch (e) {}
  const m = [...document.querySelectorAll('video,audio')];
  m.forEach(x => { window.__hfix(x); x.loop = true; x.muted = false; x.volume = v; if (x.paused) x.play().catch(() => {}); });
  const err = document.querySelector('.ytp-error, .ytp-error-content');
  return { media: m.length, playing: m.some(x => !x.paused && x.readyState > 2), error: !!(err && err.offsetParent !== null) }; })()`;
function streamSend(state) { broadcast('sound:stream', { state, url: playerUrl }); }
function killPlayer() {
  clearInterval(fadeTimer); clearInterval(pollTimer);
  if (player && !player.isDestroyed()) player.destroy();
  player = null;
}
function setPlayerVolume(v, ms = 0) {
  if (!player || player.isDestroyed()) return;
  clearInterval(fadeTimer); fadeTimer = null;
  const apply = (x) => { appliedVol = x; if (player && !player.isDestroyed()) player.webContents.executeJavaScript(PLAYER_JS(x)).catch(() => {}); };
  if (!ms) { apply(v); return; }
  // fade from where it actually is now (not from the new target), so slider moves glide rather than jump
  const from = appliedVol, steps = Math.max(1, Math.round(ms / 50)); let i = 0;
  fadeTimer = setInterval(() => {
    i++; apply(from + (v - from) * (i / steps));
    if (i >= steps) { clearInterval(fadeTimer); fadeTimer = null; }
  }, 50);
}
function streamPlay(url, vol) {
  killPlayer();
  const target = embedUrl(url);
  playerUrl = url; playerVol = vol; appliedVol = 0;
  if (!target) { streamSend('error'); return false; }
  player = new BrowserWindow({
    show: false, width: 640, height: 360, skipTaskbar: true, focusable: false,
    webPreferences: { partition: 'persist:hearth-sound', autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  player.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  player.webContents.on('did-fail-load', (e, code, desc, u, isMain) => { if (isMain && code !== -3) { streamSend('error'); killPlayer(); } });
  player.webContents.on('render-process-gone', () => { streamSend('error'); killPlayer(); });
  player.loadURL(target, { httpReferrer: 'https://hearth.app/' }).catch(() => {});
  streamSend('loading');
  // start quiet and fade up once something is playing; give up after ~25s
  let tries = 0, started = false;
  pollTimer = setInterval(async () => {
    if (!player || player.isDestroyed()) return clearInterval(pollTimer);
    tries++;
    let r = null;
    try { r = await player.webContents.executeJavaScript(PLAYER_JS(0.001)); } catch (_) {}
    if (r && r.error) { clearInterval(pollTimer); streamSend('error'); killPlayer(); return; }
    if (r && r.playing && !started) { started = true; streamSend('playing'); appliedVol = 0.001; clearInterval(pollTimer); setPlayerVolume(playerVol, 2500); keepAlive(); return; }
    if (tries > 50) { clearInterval(pollTimer); streamSend('error'); killPlayer(); }
  }, 500);
  return true;
}
function keepAlive() {
  // if the video pauses itself (end of a non-looping stream, network blip), nudge it back on
  pollTimer = setInterval(() => { if (!player || player.isDestroyed()) return clearInterval(pollTimer); if (!fadeTimer) player.webContents.executeJavaScript(PLAYER_JS(appliedVol)).catch(() => {}); }, 15000);
}
ipcMain.handle('sound:play', (e, { url, volume }) => streamPlay(url, +volume || .4));
ipcMain.handle('sound:stop', (e, fast) => {
  if (!player) return true;
  if (fast) { killPlayer(); return true; }
  const p = player; setPlayerVolume(0, 1400);
  setTimeout(() => { if (player === p) killPlayer(); }, 1600);
  return true;
});
ipcMain.handle('sound:volume', (e, v) => {
  v = Math.max(0, Math.min(1, +v || 0)); playerVol = v;
  // still fading in? let the fade-in carry on to the new level instead of jumping
  setPlayerVolume(v, 250); return true;
});

// ---------- notebooks: videos ----------
const mediaDir = () => path.join(dataDir(), 'media');
ipcMain.handle('notes:pickVideo', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { title: 'Add a video to this page', properties: ['openFile'], filters: [{ name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogg', 'ogv'] }] });
  if (res.canceled || !res.filePaths[0]) return null;
  const src = res.filePaths[0];
  const size = fs.statSync(src).size;
  if (size > 1024 * 1024 * 1024) { dialog.showErrorBox('Video too large', 'Please pick a video under 1 GB.'); return null; }
  fs.mkdirSync(mediaDir(), { recursive: true });
  const name = `vid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${path.extname(src).toLowerCase()}`;
  await fs.promises.copyFile(src, path.join(mediaDir(), name));
  return { src: 'hearth://media/' + name, name: path.basename(src) };
});

// ---------- notebooks: images & PDF ----------
ipcMain.handle('notes:saveImage', (e, dataUrl) => {
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(String(dataUrl));
  if (!m) return null;
  const dir = imagesDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${m[1].toLowerCase().replace('jpeg', 'jpg')}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return 'hearth://img/' + path.basename(file);
});
ipcMain.handle('notes:pdf', async (e, { html, name }) => {
  const tmp = path.join(app.getPath('userData'), 'print-preview.html');
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { javascript: false } });
  try {
    await win.loadFile(tmp);
    await new Promise(r => setTimeout(r, 700)); // let fonts and images settle
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } });
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save as PDF',
      defaultPath: (name || 'Hearth notes').replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, pdf);
    shell.openPath(res.filePath);
    return true;
  } finally {
    win.destroy();
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
});

ipcMain.handle('break:get', () => breakStatus());
ipcMain.handle('break:taken', () => { resetBreak('taken'); return breakStatus(); });
ipcMain.handle('break:snooze', () => {
  breakState.snoozedUntil = Date.now() + data.settings.snoozeMinutes * 60 * 1000;
  breakState.due = false;
  broadcast('break:status', breakStatus());
  return breakStatus();
});
ipcMain.handle('break:now', () => { breakState.due = true; triggerBreak(); return breakStatus(); });
ipcMain.handle('app:notify', (e, { title, body }) => { notify(title, body, () => showMain()); return true; });
ipcMain.handle('app:show', () => { showMain(); return true; });
ipcMain.handle('app:openExternal', (e, url) => {
  if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
  return true;
});
ipcMain.handle('app:copy', (e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('app:theme', (e, dark) => {
  if (!mainWindow) return false;
  try {
    mainWindow.setTitleBarOverlay(dark
      ? { color: '#221D18', symbolColor: '#C2B09B', height: 40 }
      : { color: '#F5EFE6', symbolColor: '#5A4636', height: 40 });
    mainWindow.setBackgroundColor(dark ? '#221D18' : '#F5EFE6');
  } catch (_) {}
  return true;
});
ipcMain.handle('app:dnd', (e, on) => setDnd(!!on));
ipcMain.handle('app:focusShield', (e, on) => { focusShield = !!on; return true; });
ipcMain.handle('app:closeCapture', () => { if (captureWindow) captureWindow.close(); return true; });
ipcMain.handle('app:hotkeyOk', () => registerHotkey());
ipcMain.handle('app:dataPath', () => dataFile());
ipcMain.handle('app:info', () => ({ portable: PORTABLE, portableDir: PORTABLE_DIR, version: app.getVersion() }));
ipcMain.handle('app:export', async () => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Hearth data',
    defaultPath: `hearth-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return false;
  // pictures travel inside the backup, so a restore on another PC (or the portable copy) is complete
  const json = JSON.stringify(data);
  const names = [...new Set([...json.matchAll(/hearth:\/\/img\/(img-[A-Za-z0-9-]+\.(?:png|jpe?g|gif|webp))/g)].map(m => m[1]))];
  const images = {};
  for (const n of names) { try { images[n] = fs.readFileSync(path.join(imagesDir(), n)).toString('base64'); } catch (_) {} }
  fs.writeFileSync(res.filePath, JSON.stringify({ ...data, _images: images }, null, 2), 'utf8');
  return true;
});
ipcMain.handle('app:import', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Hearth data',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (res.canceled || !res.filePaths[0]) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
    if (!Array.isArray(parsed.tasks)) throw new Error('Not a Hearth file');
    if (parsed._images && typeof parsed._images === 'object') {
      fs.mkdirSync(imagesDir(), { recursive: true });
      for (const [n, b64] of Object.entries(parsed._images)) {
        if (/^img-[A-Za-z0-9-]+\.(png|jpe?g|gif|webp)$/.test(n)) fs.writeFileSync(path.join(imagesDir(), n), Buffer.from(String(b64), 'base64'));
      }
    }
    delete parsed._images;
    writeNow();
    const def = defaultData();
    data = { ...def, ...parsed, settings: { ...def.settings, ...(parsed.settings || {}) } };
    writeNow();
    return data;
  } catch (e) {
    dialog.showErrorBox('Import failed', 'That file does not look like a Hearth backup.');
    return null;
  }
});

// ---------- lifecycle ----------
app.setAppUserModelId(APP_ID);

app.on('second-instance', () => showMain());

// ------------------------------------------------------------------ spell checking
// Chromium's checker underlines mistakes; right-clicking sends the suggestions to the window,
// which shows them in Hearth's own menu.
const SPELL_LANGS = { 'en-GB': 'English (UK)', 'en-US': 'English (US)', 'en-AU': 'English (Australia)', 'en-CA': 'English (Canada)' };
function applySpelling(over) {
  try {
    const ses = session.defaultSession;
    const s = { ...((data && data.settings) || {}), ...(over || {}) };
    const on = s.spellcheck !== false;
    ses.setSpellCheckerEnabled(on);
    const avail = ses.availableSpellCheckerLanguages || [];
    const want = s.spellLang || 'en-GB';
    const lang = avail.includes(want) ? want : avail.includes('en-GB') ? 'en-GB' : avail.find(l => l.startsWith('en')) || null;
    if (lang && on) ses.setSpellCheckerLanguages([lang]);
  } catch (e) { /* spell checking is a nice-to-have */ }
}
function hookSpellMenu(win) {
  win.webContents.on('context-menu', (e, p) => {
    if (!p.isEditable) return;
    win.webContents.send('spell:menu', {
      word: p.misspelledWord || '', suggestions: (p.dictionarySuggestions || []).slice(0, 6),
      x: p.x, y: p.y, hasSelection: !!(p.selectionText || '').trim(),
      canCut: !!p.editFlags.canCut, canCopy: !!p.editFlags.canCopy, canPaste: !!p.editFlags.canPaste
    });
  });
}
ipcMain.handle('spell:replace', (e, word) => { if (typeof word === 'string' && word.length < 200) e.sender.replaceMisspelling(word); });
ipcMain.handle('spell:add', (e, word) => {
  if (typeof word !== 'string' || !word.trim() || word.length > 80) return false;
  try { session.defaultSession.addWordToSpellCheckerDictionary(word.trim()); } catch (err) { return false; }
  // re-check the page so the underline goes straight away
  e.sender.replaceMisspelling(word);
  return true;
});
ipcMain.handle('spell:edit', (e, cmd) => { if (['cut', 'copy', 'paste', 'selectAll', 'pasteAndMatchStyle'].includes(cmd)) e.sender[cmd](); });
ipcMain.handle('spell:apply', (e, o) => { applySpelling(o && typeof o === 'object' ? { spellcheck: o.spellcheck !== false, spellLang: String(o.spellLang || 'en-GB') } : null); return true; });
ipcMain.handle('spell:langs', () => {
  let avail = [];
  try { avail = session.defaultSession.availableSpellCheckerLanguages || []; } catch (e) {}
  const list = Object.keys(SPELL_LANGS).filter(l => !avail.length || avail.includes(l)).map(id => ({ id, name: SPELL_LANGS[id] }));
  return list;
});

// ------------------------------------------------------------------ data folder: choose, watch, open-elsewhere
function copyDirIfAny(from, to) { try { if (fs.existsSync(from)) fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false }); } catch (e) { console.error('copy', e); } }
function switchDataDir(dir, mode) {
  // mode 'use' = load what's already there, 'move' = take this PC's data with us
  const from = dataDir();
  writeNow();
  if (mode === 'move') {
    fs.mkdirSync(dir, { recursive: true });
    for (const sub of ['images', 'media', 'backups']) copyDirIfAny(path.join(from, sub), path.join(dir, sub));
  }
  stopWatch(); releaseLock();
  const isDefault = path.resolve(dir) === path.resolve(app.getPath('userData'));
  try { if (isDefault) fs.unlinkSync(locationFile()); else fs.writeFileSync(locationFile(), JSON.stringify({ dir, from, at: Date.now() }, null, 2)); } catch (_) {}
  DATA_DIR = dir;
  if (mode === 'move') writeNow(); else loadData();
  startWatch(); takeLock();
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && w !== player) w.webContents.reload();
}
ipcMain.handle('data:where', () => ({ dir: dataDir(), file: dataFile(), isDefault: path.resolve(dataDir()) === path.resolve(app.getPath('userData')), portable: PORTABLE, defaultDir: app.getPath('userData') }));
ipcMain.handle('data:choose', async () => {
  if (PORTABLE) return { error: 'portable' };
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder for your Hearth data (e.g. in OneDrive)', properties: ['openDirectory', 'createDirectory'],
    defaultPath: process.env.OneDriveCommercial || process.env.OneDrive || app.getPath('documents')
  });
  if (res.canceled || !res.filePaths[0]) return null;
  let dir = res.filePaths[0];
  // keep things tidy: use a "Hearth" folder inside whatever was picked, unless it already holds Hearth data
  if (!fs.existsSync(path.join(dir, 'hearth-data.json')) && path.basename(dir).toLowerCase() !== 'hearth') dir = path.join(dir, 'Hearth');
  if (path.resolve(dir) === path.resolve(dataDir())) return { same: true };
  let mode = 'move';
  const existing = path.join(dir, 'hearth-data.json');
  if (fs.existsSync(existing)) {
    let when = ''; try { when = fs.statSync(existing).mtime.toLocaleString('en-GB'); } catch (_) {}
    const r = await dialog.showMessageBox(mainWindow, {
      type: 'question', title: 'Hearth data found', noLink: true, cancelId: 2, defaultId: 0,
      message: 'This folder already has Hearth data in it.',
      detail: `It was last saved ${when}.\n\nUse it: switch to that data (what's on this PC stays where it is as a fallback).\nReplace it: overwrite it with the data on this PC.`,
      buttons: ['Use the data in that folder', 'Replace it with this PC\'s data', 'Cancel']
    });
    if (r.response === 2) return null;
    mode = r.response === 0 ? 'use' : 'move';
    if (mode === 'move') { try { fs.copyFileSync(existing, existing + '.replaced-' + Date.now()); } catch (_) {} }
  }
  switchDataDir(dir, mode);
  return { dir, mode };
});
ipcMain.handle('data:reset', async () => {
  if (PORTABLE) return null;
  const def = app.getPath('userData');
  if (path.resolve(def) === path.resolve(dataDir())) return { same: true };
  const r = await dialog.showMessageBox(mainWindow, {
    type: 'question', title: 'Back to this PC', noLink: true, cancelId: 1, defaultId: 0,
    message: 'Keep your data on this PC only?',
    detail: 'Your current data is copied back into this PC\'s Hearth folder. The copy in the other folder is left untouched.',
    buttons: ['Copy it back and switch', 'Cancel']
  });
  if (r.response !== 0) return null;
  switchDataDir(def, 'move');
  return { dir: def };
});

// notice when another PC (via OneDrive etc.) changes the data file
let watching = null;
function startWatch() {
  stopWatch();
  const f = dataFile(); watching = f;
  fs.watchFile(f, { interval: 4000 }, (cur) => {
    if (!cur || !cur.mtimeMs || Math.abs(cur.mtimeMs - lastWriteMtime) < 5 || writeTimer) return;
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(f, 'utf8')); if (!Array.isArray(parsed.tasks)) return; } catch (_) { return; } // mid-sync: try next time
    lastWriteMtime = cur.mtimeMs;
    if (JSON.stringify(parsed) === JSON.stringify(data)) return; // same content re-synced: nothing to do
    if (Date.now() - lastRendererSave < 15000) {
      // you're busy editing here: keep your version, park theirs beside it
      const keep = path.join(dataDir(), `hearth-data.from-other-pc-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`);
      try { fs.writeFileSync(keep, JSON.stringify(parsed, null, 2)); } catch (_) {}
      scheduleWrite();
      broadcast('data:external', { kept: 'mine', file: keep });
      return;
    }
    const def = defaultData();
    data = { ...def, ...parsed, settings: { ...def.settings, ...(parsed.settings || {}) } };
    broadcast('data:external', { kept: 'theirs' });
  });
}
function stopWatch() { if (watching) { try { fs.unwatchFile(watching); } catch (_) {} watching = null; } }

// a small "open on" marker so two PCs sharing a folder can warn each other
const lockFile = () => path.join(dataDir(), 'hearth-open.json');
let lockTimer = null, otherPc = null;
function takeLock() {
  otherPc = null;
  try {
    const l = JSON.parse(fs.readFileSync(lockFile(), 'utf8'));
    if (l && l.host && l.host !== os.hostname() && Date.now() - (l.at || 0) < 150000) otherPc = l.host;
  } catch (_) {}
  const beat = () => { try { fs.writeFileSync(lockFile(), JSON.stringify({ host: os.hostname(), at: Date.now() })); } catch (_) {} };
  beat(); clearInterval(lockTimer); lockTimer = setInterval(beat, 60000);
}
function releaseLock() {
  clearInterval(lockTimer); lockTimer = null;
  try { const l = JSON.parse(fs.readFileSync(lockFile(), 'utf8')); if (l.host === os.hostname()) fs.unlinkSync(lockFile()); } catch (_) {}
}
ipcMain.handle('data:otherPc', () => otherPc);

// save a text file (CSV exports)
ipcMain.handle('app:saveText', async (e, o) => {
  const name = String((o && o.name) || 'export.txt').replace(/[\\/:*?"<>|]+/g, ' ');
  const ext = path.extname(name).slice(1) || 'txt';
  const res = await dialog.showSaveDialog(mainWindow, { title: 'Save', defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, String((o && o.text) || ''), 'utf8');
  return res.filePath;
});

// ------------------------------------------------------------------ UK bank holidays (gov.uk, free)
ipcMain.handle('holidays:get', async () => {
  try {
    const r = await net.fetch('https://www.gov.uk/bank-holidays.json', { headers: { 'User-Agent': 'Hearth/' + app.getVersion() } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const out = {};
    for (const [k, v] of Object.entries(j)) out[k] = (v.events || []).map(e => [e.date, e.title]);
    return out;
  } catch (err) { return { error: String(err.message || err) }; }
});

// ------------------------------------------------------------------ weather (Open-Meteo, free and keyless)
async function getJSON(url) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Hearth/' + app.getVersion() } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
ipcMain.handle('weather:find', async (e, q) => {
  if (typeof q !== 'string' || !q.trim() || q.length > 80) return [];
  try {
    const j = await getJSON('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=' + encodeURIComponent(q.trim()));
    return (j.results || []).map(r => ({ name: r.name, region: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude }));
  } catch (err) { return { error: String(err.message || err) }; }
});
ipcMain.handle('weather:get', async (e, o) => {
  const lat = +(o && o.lat), lon = +(o && o.lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: 'Bad location' };
  try {
    return await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m' +
      '&hourly=temperature_2m,weather_code,precipitation_probability' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&wind_speed_unit=mph&timezone=auto&forecast_days=2');
  } catch (err) { return { error: String(err.message || err) }; }
});

app.whenReady().then(() => {
  protocol.handle('hearth', (req) => {
    const u = new URL(req.url);
    const dir = u.host === 'img' ? imagesDir() : u.host === 'media' ? mediaDir() : null;
    if (!dir) return new Response('Not found', { status: 404 });
    const file = path.join(dir, path.basename(decodeURIComponent(u.pathname)));
    return net.fetch(pathToFileURL(file).href, { headers: req.headers });
  });
  // YouTube needs to know who is embedding it; pages loaded from disk send no referrer
  const yt = { urls: ['https://www.youtube-nocookie.com/*', 'https://www.youtube.com/*'] };
  const addReferrer = (d, cb) => {
    if (!d.requestHeaders.Referer && !d.requestHeaders.referer) d.requestHeaders.Referer = 'https://hearth.app/';
    cb({ requestHeaders: d.requestHeaders });
  };
  session.defaultSession.webRequest.onBeforeSendHeaders(yt, addReferrer);
  session.fromPartition('persist:hearth-sound').webRequest.onBeforeSendHeaders(yt, addReferrer);
  restoreDndSync(); // in case Hearth was closed mid-focus
  loadData();
  startWatch(); takeLock();
  applySpelling();
  createMainWindow();
  createTray();
  registerHotkey();
  applyStartup();
  ensureStartMenuShortcut();

  powerMonitor.on('lock-screen', () => { breakState.locked = true; tickBreak(); });
  powerMonitor.on('unlock-screen', () => { breakState.locked = false; resetBreak('back'); });
  powerMonitor.on('suspend', () => { breakState.locked = true; });
  powerMonitor.on('resume', () => { breakState.locked = false; resetBreak('back'); });

  breakState.lastTick = Date.now();
  setInterval(tickBreak, 5000);
});

app.on('before-quit', () => {
  quitting = true; writeNow(); stopWatch(); releaseLock(); restoreDndSync(); killPlayer();
  if (PORTABLE) { try { fs.unlinkSync(portableLnk()); } catch (_) {} }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* keep running in the tray */ });
