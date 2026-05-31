import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// main/preload/renderer 三套构建。入口走 electron-vite 约定默认:
// src/main/index.ts、src/preload/index.ts、src/renderer/index.html。
// BUILD_ENV 在构建/启动时烘焙进主进程(BUILD_ENV=prod pnpm build),运行时 BOUNDARY_ENV 可覆盖。
const buildEnv = JSON.stringify(process.env.BUILD_ENV ?? "local");

// 所有依赖都在 devDependencies(全程 bundle、运行期无 node_modules),故 externalizeDepsPlugin
// 仅外置 electron + node 内建;workspace 包与其纯 JS 传递依赖(ws/semver)一并打进 main bundle,
// 打包产物自包含。
//
// 例外:ws 的可选原生加速依赖 bufferutil / utf-8-validate 未安装,bundle 会被 esbuild 变成
// 运行时抛错的桩而崩;ws 本就用 try/catch 容忍其缺失,故标记 external 保留真 require 即可。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: { __BUILD_ENV__: buildEnv },
    build: { rollupOptions: { external: ["bufferutil", "utf-8-validate"] } },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] },
});
