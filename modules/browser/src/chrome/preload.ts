/// <reference lib="dom" />
// chrome 页(toolbar/地址栏)的 preload:经 contextBridge 暴露 window.tabAPI,桥接到模块主进程。
import { contextBridge, ipcRenderer } from "electron";
import { CH, type ChromeState, type TabApi } from "../ipc.js";

// 首屏主题防白闪:主题经 webPreferences.additionalArguments 传入,preload 在页面脚本前写 data-theme。
const themeArg = process.argv.find((a) => a.startsWith("--bd-theme="));
if (themeArg) {
  const dark = themeArg.slice("--bd-theme=".length) === "dark";
  const write = (): void => {
    if (dark) document.documentElement.setAttribute("data-theme", "dark");
  };
  if (document.documentElement) write();
  else {
    const obs = new MutationObserver(() => {
      if (document.documentElement) {
        obs.disconnect();
        write();
      }
    });
    obs.observe(document, { childList: true });
  }
}

const api: TabApi = {
  navigate: (url) => ipcRenderer.send(CH.navigate, url),
  back: () => ipcRenderer.send(CH.back),
  forward: () => ipcRenderer.send(CH.forward),
  reload: () => ipcRenderer.send(CH.reload),
  newTab: () => ipcRenderer.send(CH.newTab),
  switchTab: (id) => ipcRenderer.send(CH.switchTab, id),
  closeTab: (id) => ipcRenderer.send(CH.closeTab, id),
  detach: () => ipcRenderer.send(CH.detach),
  merge: () => ipcRenderer.send(CH.merge),
  showTabMenu: (tabId, x, y) => ipcRenderer.send(CH.tabMenu, { tabId, x, y }),
  toggleGroupCollapse: (groupId) => ipcRenderer.send(CH.groupCollapse, { groupId }),
  renameGroup: (groupId, name) => ipcRenderer.send(CH.groupRename, { groupId, name }),
  dragTab: (tabId, beforeId, groupId) => ipcRenderer.send(CH.dragTab, { tabId, beforeId, groupId }),
  showProfileMenu: (x, y) => ipcRenderer.send(CH.profileMenu, { x, y }),
  openChat: () => ipcRenderer.send(CH.openChat),
  ready: () => ipcRenderer.send(CH.ready),
  onState: (cb) => {
    const h = (_e: unknown, s: ChromeState): void => cb(s);
    ipcRenderer.on(CH.state, h);
    return () => {
      ipcRenderer.removeListener(CH.state, h);
    };
  },
};

contextBridge.exposeInMainWorld("tabAPI", api);
