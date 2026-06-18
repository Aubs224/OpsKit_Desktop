const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('opskit', {
  getBootstrap: () => invoke('app:getBootstrap'),
  getSettings: () => invoke('settings:get'),
  saveSettings: (settings) => invoke('settings:save', settings),
  setApiKey: (provider, apiKey) => invoke('keys:set', { provider, apiKey }),
  deleteApiKey: (provider) => invoke('keys:delete', { provider }),
  getKeyPresence: () => invoke('keys:presence'),
  selectDirectory: () => invoke('dialog:selectDirectory'),
  selectQuickSetup: () => invoke('dialog:selectQuickSetup'),
  chooseFiles: () => invoke('dialog:chooseFiles'),
  listSessions: () => invoke('session:list'),
  startSession: (name) => invoke('session:start', { name }),
  openSession: (id) => invoke('session:open', { id }),
  sendMessage: (payload) => invoke('chat:send', payload),
  runCohereBootTest: () => invoke('validation:cohereBootTest'),
  openPath: (targetPath) => invoke('shell:openPath', targetPath)
});
