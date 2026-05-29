import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// main/preload/renderer 三套构建。入口走 electron-vite 约定默认:
// src/main/index.ts、src/preload/index.ts、src/renderer/index.html。
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
});
