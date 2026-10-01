const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  openProject: () => ipcRenderer.invoke('project:open'),
  saveProject: (project, path) => ipcRenderer.invoke('project:save', { project, path }),
  savePng: (dataUrl, suggestedName) => ipcRenderer.invoke('image:save', { dataUrl, suggestedName }),
  setTitle: (title) => ipcRenderer.send('window:title', title)
});
