const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("everiaProviders", {
  status: (provider) => ipcRenderer.invoke("providers:status", provider),
  search: (input) => ipcRenderer.invoke("providers:search", input),
  searchChain: (input) => ipcRenderer.invoke("providers:search-chain", input),
  details: (input) => ipcRenderer.invoke("providers:details", input),
  downloadImage: (url) => ipcRenderer.invoke("providers:download-image", url),
  configuration: () => ipcRenderer.invoke("providers:configuration"),
  saveCredentials: (input) =>
    ipcRenderer.invoke("providers:save-credentials", input),
  testConnection: (provider) => ipcRenderer.invoke("providers:test", provider),
  removeCredentials: (provider) =>
    ipcRenderer.invoke("providers:remove-credentials", provider),
});

contextBridge.exposeInMainWorld("everiaWindow", {
  onResponsiveScale: (callback) => {
    let active = true;
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("window:responsive-scale", listener);
    void ipcRenderer
      .invoke("window:responsive-scale-current")
      .then((value) => {
        if (active) callback(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      ipcRenderer.removeListener("window:responsive-scale", listener);
    };
  },
});

contextBridge.exposeInMainWorld("everiaBackup", {
  config: () => ipcRenderer.invoke("backup:config"),
  isDue: () => ipcRenderer.invoke("backup:due"),
  write: (file) => ipcRenderer.invoke("backup:write", file),
  chooseDestination: () => ipcRenderer.invoke("backup:choose-destination"),
  setEnabled: (enabled) => ipcRenderer.invoke("backup:set-enabled", enabled),
  selectBackup: () => ipcRenderer.invoke("backup:select"),
  beginRestore: (snapshot) => ipcRenderer.invoke("backup:begin-restore", snapshot),
  pendingRestore: () => ipcRenderer.invoke("backup:pending"),
  finishRestore: () => ipcRenderer.invoke("backup:finish-restore"),
});
