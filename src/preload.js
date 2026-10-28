const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('hearth', {
  isDesktop: true,
  getData: () => ipcRenderer.invoke('store:get'),
  setData: (d) => ipcRenderer.invoke('store:set', d),
  addTask: (t) => ipcRenderer.invoke('store:addTask', t),
  addSticky: (st) => ipcRenderer.invoke('store:addSticky', st),
  saveImage: (dataUrl) => ipcRenderer.invoke('notes:saveImage', dataUrl),
  exportPdf: (html, name) => ipcRenderer.invoke('notes:pdf', { html, name }),
  onDataChanged: on('store:changed'),

  getBreak: () => ipcRenderer.invoke('break:get'),
  breakTaken: () => ipcRenderer.invoke('break:taken'),
  breakSnooze: () => ipcRenderer.invoke('break:snooze'),
  breakNow: () => ipcRenderer.invoke('break:now'),
  onBreakStatus: on('break:status'),
  onBreakDue: on('break:due'),

  notify: (title, body) => ipcRenderer.invoke('app:notify', { title, body }),
  show: () => ipcRenderer.invoke('app:show'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  copy: (text) => ipcRenderer.invoke('app:copy', text),
  setTheme: (dark) => ipcRenderer.invoke('app:theme', dark),
  setDnd: (on) => ipcRenderer.invoke('app:dnd', on),
  setFocusShield: (on) => ipcRenderer.invoke('app:focusShield', on),
  closeCapture: () => ipcRenderer.invoke('app:closeCapture'),
  hotkeyOk: () => ipcRenderer.invoke('app:hotkeyOk'),
  dataPath: () => ipcRenderer.invoke('app:dataPath'),
  appInfo: () => ipcRenderer.invoke('app:info'),
  streamPlay: (url, volume) => ipcRenderer.invoke('sound:play', { url, volume }),
  streamStop: (fast) => ipcRenderer.invoke('sound:stop', fast),
  streamVolume: (v) => ipcRenderer.invoke('sound:volume', v),
  onStreamState: on('sound:stream'),
  pickVideo: () => ipcRenderer.invoke('notes:pickVideo'),
  onSpellMenu: on('spell:menu'),
  dataWhere: () => ipcRenderer.invoke('data:where'),
  dataChoose: () => ipcRenderer.invoke('data:choose'),
  dataReset: () => ipcRenderer.invoke('data:reset'),
  dataOtherPc: () => ipcRenderer.invoke('data:otherPc'),
  onDataExternal: on('data:external'),
  saveText: (name, text) => ipcRenderer.invoke('app:saveText', { name, text }),
  holidays: () => ipcRenderer.invoke('holidays:get'),
  weatherFind: (q) => ipcRenderer.invoke('weather:find', q),
  weatherGet: (o) => ipcRenderer.invoke('weather:get', o),
  spellReplace: (w) => ipcRenderer.invoke('spell:replace', w),
  spellAdd: (w) => ipcRenderer.invoke('spell:add', w),
  spellEdit: (cmd) => ipcRenderer.invoke('spell:edit', cmd),
  spellApply: (o) => ipcRenderer.invoke('spell:apply', o),
  spellLangs: () => ipcRenderer.invoke('spell:langs'),
  exportData: () => ipcRenderer.invoke('app:export'),
  importData: () => ipcRenderer.invoke('app:import')
});
