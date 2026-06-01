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
  // 壳 → main:把 renderer 才知道的前台选择 / 主题上报给 main 的 surface(驱动 main 模块 view 显隐与主题)
  surfaceForeground: "surface:foreground",
  surfaceTheme: "surface:theme",
  // 壳 → main:把分离到独立窗的 main 模块合并回主窗(占位卡片的"合并回主窗口"按钮)
  surfaceMerge: "surface:merge",
  // 壳 → main:无边框窗口下自绘红绿灯把系统三连键语义经 IPC 暴露
  windowMinimize: "window:minimize",
  windowClose: "window:close",
  windowToggleMaximize: "window:toggleMaximize",
  windowToggleFullscreen: "window:toggleFullscreen",
  windowIsFocused: "window:isFocused",
  windowIsFullscreen: "window:isFullscreen",
  // main → 壳(webContents.send)
  authChanged: "auth:changed",
  // main → 壳:窗口活跃态 / 全屏态变化,驱动自绘红绿灯
  windowFocusChange: "window:focus-change",
  windowFullscreenChange: "window:fullscreen-change",
  // main → 壳:某 main 模块 surface 分离态变化,驱动主窗内容区显隐"已分离"占位卡片
  surfaceDetachedChanged: "surface:detachedChanged",

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
