import { contextBridge, ipcRenderer } from "electron";
import type { AuthState } from "@boundary-desktop/contract";
import type { HostApi, ModuleEntry } from "../shared/types.js";

const hostApi: HostApi = {
  auth: {
    getState: () => ipcRenderer.invoke("auth:getState") as Promise<AuthState>,
    requestLogin: () => ipcRenderer.invoke("auth:requestLogin") as Promise<void>,
    submitLogin: (phone, password) =>
      ipcRenderer.invoke("auth:submitLogin", phone, password) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    requestLogout: () => ipcRenderer.invoke("auth:requestLogout") as Promise<void>,
    onChange: (listener) => {
      const handler = (_e: unknown, state: AuthState): void => listener(state);
      ipcRenderer.on("auth:changed", handler);
      return () => ipcRenderer.removeListener("auth:changed", handler);
    },
  },
  modules: {
    list: () => ipcRenderer.invoke("modules:list") as Promise<ModuleEntry[]>,
  },
};

contextBridge.exposeInMainWorld("hostApi", hostApi);
