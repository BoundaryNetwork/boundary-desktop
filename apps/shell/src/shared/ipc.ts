/** IPC 通道名,main 与 preload 共用(renderer 经 window.* 结构化 API,不直接用这些)。 */
export const IPC = {
  // 壳 → main(ipcRenderer.invoke)
  appEnv: "app:env",
  authGetState: "auth:getState",
  authRequestLogin: "auth:requestLogin",
  authSubmitLogin: "auth:submitLogin",
  authRequestLogout: "auth:requestLogout",
  // 壳 → main:个人信息页读/改完整 profile(GET/PATCH /api/auth/profile)与改密码(POST /api/auth/password)
  authGetProfile: "auth:getProfile",
  authUpdateProfile: "auth:updateProfile",
  authChangePassword: "auth:changePassword",
  // 壳 → main:agentworkerd 运行状态页 —— 聚合状态(GET /local/status,public)、
  // 壳侧信息(app 版本 + worker spawn 时刻)、手动重启
  workerStatus: "worker:status",
  workerInfo: "worker:info",
  workerRestart: "worker:restart",
  modulesList: "modules:list",
  modulesActivate: "modules:activate",
  modulesDeactivate: "modules:deactivate",
  // 壳 → main:把 renderer 才知道的前台选择 / 主题上报给 main 的 surface(驱动 main 模块 view 显隐与主题)
  surfaceForeground: "surface:foreground",
  surfaceTheme: "surface:theme",
  // 壳 → main:把分离到独立窗的 main 模块合并回主窗(占位卡片的"合并回主窗口"按钮)
  surfaceMerge: "surface:merge",
  // 壳 → main:基座级全屏弹层(如系统设置)开合;激活时强制隐藏主窗内所有 surface 的
  // native view —— 它们在 renderer DOM 之上,否则会盖住 DOM 弹层
  surfaceOverlay: "surface:overlay",
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
  // main → 壳:模块请求把自己提到前台(如 agent 驱动浏览器导航),壳切 activeId 同步高亮
  surfaceForegroundRequest: "surface:foregroundRequest",

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
