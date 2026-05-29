import { join } from "node:path";
import { BrowserWindow, app, ipcMain } from "electron";
import { HostServices, LocalDirSource, type ModuleSource } from "@boundary-desktop/host";
import type { ModuleEntry } from "../shared/types.js";
import { ShellAuthDriver } from "./auth.js";
import { registerAppProtocol, registerAppScheme } from "./app-protocol.js";

registerAppScheme(); // 必须在 app ready 前

const authDriver = new ShellAuthDriver();
const host = new HostServices({ auth: authDriver });

// 开发期模块来源:扫描 monorepo 的 modules/。Increment A 仅用于列 catalog 渲染导航;
// 真正加载在 Increment B(RendererLoader)。可经 BOUNDARY_MODULES_DIR 覆盖。
const modulesRoot = process.env.BOUNDARY_MODULES_DIR ?? join(process.cwd(), "..", "..", "modules");
const source: ModuleSource = new LocalDirSource([modulesRoot]);

function registerIpc(): void {
  ipcMain.handle("auth:getState", () => host.getAuthState());
  ipcMain.handle("auth:requestLogin", () => host.requestLogin());
  ipcMain.handle("auth:submitLogin", (_e, phone: string, password: string) =>
    authDriver.submit(phone, password),
  );
  ipcMain.handle("auth:requestLogout", () => host.requestLogout());
  ipcMain.handle("modules:list", async (): Promise<ModuleEntry[]> => {
    const catalog = await source.catalog();
    return catalog.modules.map((m) => ({ id: m.id, version: m.version, ui: m.ui }));
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    show: false,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // ESM preload 要求关闭 sandbox
    },
  });

  const sub = host.subscribeAuth((state) => win.webContents.send("auth:changed", state));
  win.on("closed", () => sub.dispose());
  win.once("ready-to-show", () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL); // dev:vite server
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html")); // prod
  }
}

void app.whenReady().then(() => {
  registerAppProtocol();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
