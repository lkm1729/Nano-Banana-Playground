const { contextBridge, ipcRenderer } = require("electron");

const unwrap = async (promise) => {
  const response = await promise;
  if (response?.ok) return response.value;
  const error = new Error(response?.error?.message || "API 请求失败。");
  error.code = response?.error?.code || "UNKNOWN";
  error.status = response?.error?.status;
  throw error;
};

contextBridge.exposeInMainWorld("nanoBanana", {
  testConnection: (settings) =>
    unwrap(ipcRenderer.invoke("generation:test-connection", settings)),
  generate: (settings, request) =>
    unwrap(ipcRenderer.invoke("generation:generate", { settings, request })),
  abort: (requestId) => ipcRenderer.invoke("generation:abort", requestId),
  copyImage: (dataUrl) => unwrap(ipcRenderer.invoke("clipboard:write-image", dataUrl)),
  loadSettings: () => unwrap(ipcRenderer.invoke("settings:load")),
  saveSettings: (settings) => unwrap(ipcRenderer.invoke("settings:save", settings)),
});
