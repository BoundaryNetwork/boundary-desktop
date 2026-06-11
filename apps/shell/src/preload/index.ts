import { contextBridge, ipcRenderer } from "electron";
import type { AuthState } from "@boundary-desktop/contract";
import { IPC } from "../shared/ipc.js";
import { ActivationRetiredError, isCtxRetired } from "../shared/types.js";
import type {
  ActivateRequest,
  HostApi,
  ModuleBridge,
  LocalStatus,
  ModuleEntry,
  ProfileInfo,
  SharedState,
  WorkerInfo,
} from "../shared/types.js";

const hostApi: HostApi = {
  platform: process.platform,
  env: () => ipcRenderer.invoke(IPC.appEnv) as Promise<string>,
  worker: {
    status: () => ipcRenderer.invoke(IPC.workerStatus) as Promise<LocalStatus | null>,
    info: () => ipcRenderer.invoke(IPC.workerInfo) as Promise<WorkerInfo>,
    restart: () => ipcRenderer.invoke(IPC.workerRestart) as Promise<void>,
  },
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
    getProfile: () => ipcRenderer.invoke(IPC.authGetProfile) as Promise<ProfileInfo>,
    updateProfile: (patch) => ipcRenderer.invoke(IPC.authUpdateProfile, patch) as Promise<ProfileInfo>,
    changePassword: (current, next) =>
      ipcRenderer.invoke(IPC.authChangePassword, current, next) as Promise<{
        ok: boolean;
        error?: string;
      }>,
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
    reportOverlay: (active) => ipcRenderer.invoke(IPC.surfaceOverlay, active) as Promise<void>,
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
  // 出站 ctx 能力:main 对已退役 aid 回 CTX_RETIRED 哨兵(而非抛错)。按能力形状收尾——
  // 取值类(invokeTool/apiRequest/storage)reject ActivationRetiredError 让在途链走 catch;
  // void 类(registerTool/notify/requestLogin/requestLogout)直接 no-op resolve。
  registerTool: async (aid, def) => {
    await ipcRenderer.invoke(IPC.ctxRegisterTool, { aid, def });
  },
  invokeTool: async (aid, name, args) => {
    const r = await ipcRenderer.invoke(IPC.ctxInvokeTool, { aid, name, args });
    if (isCtxRetired(r)) throw new ActivationRetiredError(aid);
    return r;
  },
  notify: async (aid, opts) => {
    await ipcRenderer.invoke(IPC.ctxNotify, { aid, opts });
  },
  apiRequest: async (aid, opts) => {
    const r = await ipcRenderer.invoke(IPC.ctxApiRequest, { aid, opts });
    if (isCtxRetired(r)) throw new ActivationRetiredError(aid);
    return r;
  },
  storage: async (aid, op, key, value) => {
    const r = await ipcRenderer.invoke(IPC.ctxStorage, { aid, op, key, value });
    if (isCtxRetired(r)) throw new ActivationRetiredError(aid);
    return r;
  },
  requestLogin: async (aid) => {
    await ipcRenderer.invoke(IPC.ctxRequestLogin, { aid });
  },
  requestLogout: async (aid) => {
    await ipcRenderer.invoke(IPC.ctxRequestLogout, { aid });
  },
};

contextBridge.exposeInMainWorld("hostApi", hostApi);
contextBridge.exposeInMainWorld("moduleBridge", moduleBridge);
