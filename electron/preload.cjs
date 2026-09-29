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
  testDraftCredentials: (input) => ipcRenderer.invoke("providers:test-draft", input),
  applyDraftCredentials: (operations) => ipcRenderer.invoke("providers:apply-draft", operations),
  removeCredentials: (provider) =>
    ipcRenderer.invoke("providers:remove-credentials", provider),
});

contextBridge.exposeInMainWorld("everiaWindow", {
  setInterfaceScale: (scale) => ipcRenderer.invoke("window:interface-scale", scale),
  onResponsiveScale: (callback) => {
    let active = true;
    let notificationVersion = 0;
    const listener = (_event, value) => {
      notificationVersion += 1;
      callback(value);
    };
    ipcRenderer.on("window:responsive-scale", listener);
    const requestedAtVersion = notificationVersion;
    void ipcRenderer
      .invoke("window:responsive-scale-current")
      .then((value) => {
        // A resize/maximize notification can overtake this startup reply.
        // Never let an older snapshot replace the latest window state.
        if (active && notificationVersion === requestedAtVersion)
          callback(value);
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
  write: async (file) => {
    const response = await ipcRenderer.invoke("backup:write", file);
    if (!response?.ok) {
      const error = new Error("Backup could not be written.");
      error.code = response?.code ?? "backup-failed";
      throw error;
    }
    return response.data;
  },
  chooseDestination: () => ipcRenderer.invoke("backup:choose-destination"),
  setEnabled: (enabled) => ipcRenderer.invoke("backup:set-enabled", enabled),
  setConfig: (config) => ipcRenderer.invoke("backup:set-config", config),
  systemDrive: () => ipcRenderer.invoke("backup:system-drive"),
  selectBackup: () => ipcRenderer.invoke("backup:select"),
  beginRestore: (snapshot) =>
    ipcRenderer.invoke("backup:begin-restore", snapshot),
  pendingRestore: () => ipcRenderer.invoke("backup:pending"),
  finishRestore: () => ipcRenderer.invoke("backup:finish-restore"),
});
