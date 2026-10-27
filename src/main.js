// Hearth — main process
// Owns the window, tray, global quick-capture hotkey, data file and the screen-break clock.

const {
  app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, Notification,
  powerMonitor, shell, nativeImage, clipboard, dialog, screen
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile, execFileSync } = require('child_process');
const { inboxSticky } = require('./shared/inbox.js');

const APP_ID = 'com.hearth.workassistant';
const ASSETS = path.join(__dirname, 'assets');

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
const dataFile = () => path.join(app.getPath('userData'), 'hearth-data.json');
let data = null;
let writeTimer = null;

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
    const raw = fs.readFileSync(dataFile(), 'utf8');
    const parsed = JSON.parse(raw);
    const def = defaultData();
    data = { ...def, ...parsed, settings: { ...def.settings, ...(parsed.settings || {}) } };
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
    // rolling daily backup
    const backup = path.join(app.getPath('userData'), 'backups');
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
  if (!app.isPackaged) return; // only register the real .exe
  app.setLoginItemSettings({
    openAtLogin: !!data.settings.launchAtStartup,
    args: ['--hidden']
  });
}

// Windows only shows toast notifications for apps that have a Start Menu
// shortcut carrying their AppUserModelID, so create one on first run.
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
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

// ---------- notebooks: images & PDF ----------
ipcMain.handle('notes:saveImage', (e, dataUrl) => {
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(String(dataUrl));
  if (!m) return null;
  const dir = path.join(app.getPath('userData'), 'images');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${m[1].toLowerCase().replace('jpeg', 'jpg')}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return pathToFileURL(file).href;
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
ipcMain.handle('app:export', async () => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Hearth data',
    defaultPath: `hearth-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf8');
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

app.whenReady().then(() => {
  restoreDndSync(); // in case Hearth was closed mid-focus
  loadData();
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

app.on('before-quit', () => { quitting = true; writeNow(); restoreDndSync(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* keep running in the tray */ });
