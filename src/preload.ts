import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("modder", {
  detect: () => ipcRenderer.invoke("detect"),
  version: () => ipcRenderer.invoke("version"),
  choose: () => ipcRenderer.invoke("choose"),
  modules: () => ipcRenderer.invoke("modules"),
  inspect: (path: string) => ipcRenderer.invoke("inspect", path),
  diagnose: (path?: string) => ipcRenderer.invoke("diagnose", path),
  apply: (path: string, ids: string[]) =>
    ipcRenderer.invoke("apply", path, ids),
  restore: (path: string) => ipcRenderer.invoke("restore", path),
  recover: (path: string) => ipcRenderer.invoke("recover", path),
  onLog: (fn: (message: string) => void) => {
    const handler = (_: unknown, message: string) => fn(message);
    ipcRenderer.on("operation-log", handler);
    return () => ipcRenderer.removeListener("operation-log", handler);
  },
});
