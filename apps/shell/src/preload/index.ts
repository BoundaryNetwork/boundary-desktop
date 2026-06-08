import { contextBridge, ipcRenderer } from "electron";
import type { AuthState } from "@boundary-desktop/contract";
import { IPC } from "../shared/ipc.js";
import type {
  ActivateRequest,
  HostApi,
  ModuleBridge,
  ModuleEntry,
  SharedState,
} from "../shared/types.js";

const hostApi: HostApi = {
  platform: process.platform,
  env: () => ipcRenderer.invoke(IPC.appEnv) as Promise<string>,
  auth: {
    getState: () => ipcRenderer.invoke(IPC.authGetState) as Promise<AuthState>,
    requestLogin: () => ipcRenderer.invoke(IPC.authRequestLogin) as Promise<void>,
    submitLogin: (phone, password) =>
      ipcRenderer.invoke(IPC.authSubmitLogin, phone, password) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    requestLogout: () => ipcRenderer.invoke(IPC.authRequestLogout) as Promise<void>,
    onChange: (listener) => {
      const handler = (_e: unknown, state: AuthState): void => listener(state);
      ipcRenderer.on(IPC.authChanged, handler);
      return () => ipcRenderer.removeListener(IPC.authChanged, handler);
    },
  },
  modules: {
    list: () => ipcRenderer.invoke(IPC.modulesList) as Promise<ModuleEntry[]>,
    activate: (id) => ipcRenderer.invoke(IPC.modulesActivate, id) as Promise<void>,
    deactivate: (id) => ipcRenderer.invoke(IPC.modulesDeactivate, id) as Promise<void>,
  },
  surface: {
    reportForeground: (id) => ipcRenderer.invoke(IPC.surfaceForeground, id) as Promise<void>,
    reportTheme: (theme) => ipcRenderer.invoke(IPC.surfaceTheme, theme) as Promise<void>,
    merge: (id) => ipcRenderer.invoke(IPC.surfaceMerge, id) as Promise<void>,
    onDetachedChange: (listener) => {
      const handler = (_e: unknown, msg: { id: string; detached: boolean }): void =>
        listener(msg.id, msg.detached);
      ipcRenderer.on(IPC.surfaceDetachedChanged, handler);
      return () => ipcRenderer.removeListener(IPC.surfaceDetachedChanged, handler);
    },
    onForegroundRequest: (listener) => {
      const handler = (_e: unknown, id: string): void => listener(id);
      ipcRenderer.on(IPC.surfaceForegroundRequest, handler);
      return () => ipcRenderer.removeListener(IPC.surfaceForegroundRequest, handler);
    },
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize) as Promise<void>,
    close: () => ipcRenderer.invoke(IPC.windowClose) as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize) as Promise<void>,
    toggleFullscreen: () => ipcRenderer.invoke(IPC.windowToggleFullscreen) as Promise<void>,
    isFocused: () => ipcRenderer.invoke(IPC.windowIsFocused) as Promise<boolean>,
    isFullscreen: () => ipcRenderer.invoke(IPC.windowIsFullscreen) as Promise<boolean>,
    onFocusChange: (listener) => {
      const handler = (_e: unknown, focused: boolean): void => listener(focused);
      ipcRenderer.on(IPC.windowFocusChange, handler);
      return () => ipcRenderer.removeListener(IPC.windowFocusChange, handler);
    },
    onFullscreenChange: (listener) => {
      const handler = (_e: unknown, fs: boolean): void => listener(fs);
      ipcRenderer.on(IPC.windowFullscreenChange, handler);
      return () => ipcRenderer.removeListener(IPC.windowFullscreenChange, handler);
    },
  },
};

// main → renderer 请求:跑 handler 后按 reqId 回 rtReply。
function answer(
  channel: string,
  run: (payload: Record<string, unknown>) => Promise<unknown>,
): void {
  ipcRenderer.on(channel, (_e, msg: { reqId: number } & Record<string, unknown>) => {
    void run(msg).then(
      (result) => ipcRenderer.send(IPC.rtReply, { reqId: msg.reqId, ok: true, result }),
      (err) =>
        ipcRenderer.send(IPC.rtReply, {
          reqId: msg.reqId,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
    );
  });
}

const moduleBridge: ModuleBridge = {
  onActivate: (handler) =>
    answer(IPC.rtActivate, (m) => handler(m as unknown as ActivateRequest).then(() => undefined)),
  onDeactivate: (handler) =>
    answer(IPC.rtDeactivate, (m) => handler(m.aid as number).then(() => undefined)),
  onToolInvoke: (handler) =>
    answer(IPC.rtToolInvoke, (m) =>
      handler(m.aid as number, m.name as string, m.args, (m.caller ?? null) as string | null),
    ),
  onSharedChanged: (listener) => {
    ipcRenderer.on(IPC.sharedChanged, (_e, shared: SharedState) => listener(shared));
  },

  getShared: () => ipcRenderer.invoke(IPC.ctxGetShared) as Promise<SharedState>,
  registerTool: (aid, def) => ipcRenderer.invoke(IPC.ctxRegisterTool, { aid, def }) as Promise<void>,
  invokeTool: (aid, name, args) => ipcRenderer.invoke(IPC.ctxInvokeTool, { aid, name, args }),
  notify: (aid, opts) => ipcRenderer.invoke(IPC.ctxNotify, { aid, opts }) as Promise<void>,
  apiRequest: (aid, opts) => ipcRenderer.invoke(IPC.ctxApiRequest, { aid, opts }),
  storage: (aid, op, key, value) =>
    ipcRenderer.invoke(IPC.ctxStorage, { aid, op, key, value }),
  requestLogin: (aid) => ipcRenderer.invoke(IPC.ctxRequestLogin, { aid }) as Promise<void>,
  requestLogout: (aid) => ipcRenderer.invoke(IPC.ctxRequestLogout, { aid }) as Promise<void>,
};

contextBridge.exposeInMainWorld("hostApi", hostApi);
contextBridge.exposeInMainWorld("moduleBridge", moduleBridge);
