import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// macOS hiddenInset:首帧前同步打类,让 rail 顶部红绿灯 strip 立即占位,
// 避免头像先贴顶再下移一帧的抖动(platform 来自 preload,同步可读)。
if (window.hostApi.platform === "darwin") {
  document.documentElement.classList.add("platform-mac");
}

// 首帧前应用持久化主题,避免亮→暗闪烁。
if (localStorage.getItem("boundary.theme") === "dark") {
  document.documentElement.setAttribute("data-theme", "dark");
}

const root = document.getElementById("root");
if (!root) throw new Error("找不到 #root 挂载点");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
