/** IPC 通道名,main 与 preload 共用(renderer 经 window.* 结构化 API,不直接用这些)。 */
export const IPC = {
  // 壳 → main(ipcRenderer.invoke)
  appEnv: "app:env",
  authGetState: "auth:getState",
  authRequestLogin: "auth:requestLogin",
  authSubmitLogin: "auth:submitLogin",
  authRequestLogout: "auth:requestLogout",
  modulesList: "modules:list",
  modulesActivate: "modules:activate",
  modulesDeactivate: "modules:deactivate",
  // main → 壳(webContents.send)
  authChanged: "auth:changed",

  // main → renderer runtime(webContents.send + reqId,runtime 经 rtReply 回)
  rtActivate: "rt:activate",
  rtDeactivate: "rt:deactivate",
  rtToolInvoke: "rt:toolInvoke",
  rtReply: "rt:reply",
  sharedChanged: "shared:changed",

  // renderer runtime → main(ipcRenderer.invoke)
  ctxRegisterTool: "ctx:registerTool",
  ctxInvokeTool: "ctx:invokeTool",
  ctxNotify: "ctx:notify",
  ctxApiRequest: "ctx:apiRequest",
  ctxStorage: "ctx:storage",
  ctxRequestLogin: "ctx:requestLogin",
  ctxRequestLogout: "ctx:requestLogout",
  ctxGetShared: "ctx:getShared",
} as const;
