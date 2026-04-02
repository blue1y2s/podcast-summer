const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
    getState: () => ipcRenderer.invoke('desktop:get-state'),
    revealPath: (targetPath) => ipcRenderer.invoke('desktop:reveal-path', targetPath),
    toggleMaximize: () => ipcRenderer.invoke('desktop:toggle-maximize')
});
