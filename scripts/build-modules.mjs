// 模块构建工具链:把 vendor 共享包(react / react-dom)与各模块构建成 app:// ESM 产物。
// 自动发现 modules/*:有 src/index.tsx|ts 的走 esbuild 出 dist/index.mjs;
// 纯 index.js 的零构建模块(无 src/)产物即源文件,跳过。
// externals 按 manifest.runtime 分:renderer 模块 external react/react-dom(经渲染页 import map
// 指向 vendor,一份 React 多模块共享);main 模块 external electron + node 内建(主进程直接 import,
// 不打包宿主运行时)。
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repo = dirname(dirname(fileURLToPath(import.meta.url))); // 仓库根(scripts/ 的上级)
const shellDir = join(repo, "apps", "shell"); // vendor 是宿主(shell)的 app:// 共享产物,产出到这里供其 serve
const vendorDir = join(shellDir, "vendor");
const modulesRoot = join(repo, "modules");

// renderer 模块对这些 bare specifier 的引用保持 external,交给 import map 解析到 vendor。
const rendererExternal = ["react", "react-dom", "react-dom/client"];

// react CJS 的命名导出 esbuild 的 `export *` 检测不可靠,显式列出常用 hook/API。
const REACT_NAMED = [
  "useState", "useEffect", "useRef", "useMemo", "useCallback", "useReducer",
  "useContext", "createContext", "createElement", "cloneElement", "isValidElement",
  "Children", "Fragment", "memo", "forwardRef", "useLayoutEffect", "useImperativeHandle",
  "useId", "useTransition", "startTransition", "useDeferredValue", "useSyncExternalStore",
  "Suspense", "StrictMode", "Component", "PureComponent", "version",
];

async function buildVendor() {
  // react + react-dom 打进同一个 vendor.mjs:bundle 在一起 → 必然同一个 react 实例
  // (react-dom 是 CJS,若把 react 设 external,ESM 输出会变成运行时 require 而炸)。
  // 导出 default(=React)+ 命名 hook + createRoot,供 import map 的 "react" 与
  // "react-dom/client" 两个 specifier 同时指向本文件、各取所需。
  await build({
    stdin: {
      contents:
        `import React from "react";\n` +
        `import { createRoot, hydrateRoot } from "react-dom/client";\n` +
        `export default React;\n` +
        `export const { ${REACT_NAMED.join(", ")} } = React;\n` +
        `export { createRoot, hydrateRoot };\n`,
      resolveDir: shellDir,
      loader: "js",
    },
    bundle: true,
    format: "esm",
    outfile: join(vendorDir, "vendor.mjs"),
    logLevel: "warning",
  });
}

/** 模块的源入口:src/index.tsx 优先,其次 src/index.ts。 */
function sourceEntry(dir) {
  for (const rel of ["src/index.tsx", "src/index.ts"]) {
    const p = join(dir, rel);
    if (existsSync(p)) return p;
  }
  throw new Error(`模块 ${dir} 缺少 src/index.tsx|ts`);
}

/** 发现 modules/* 下含 manifest.json 的模块目录(读出 runtime 以决定 externals)。 */
async function discoverModules() {
  const entries = await readdir(modulesRoot, { withFileTypes: true }).catch(() => []);
  const mods = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(modulesRoot, e.name);
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    const { runtime } = JSON.parse(await readFile(manifestPath, "utf8"));
    mods.push({ id: e.name, dir, runtime });
  }
  return mods;
}

async function buildModule({ dir, runtime }) {
  const main = runtime === "main";
  await build({
    entryPoints: [sourceEntry(dir)],
    bundle: true,
    format: "esm",
    outfile: join(dir, "dist", "index.mjs"),
    // main:主进程运行,external electron + 自动 external node 内建(platform node);
    // renderer:external react,经 import map 指向 vendor。
    platform: main ? "node" : "browser",
    external: main ? ["electron"] : rendererExternal,
    jsx: "transform", // 经典 JSX:React.createElement,模块自带 import React
    loader: { ".css": "text" }, // 模块内 scoped 样式以字符串内联,运行时注入 <style>
    logLevel: "warning",
  });
  // 模块自带的 renderer 页(main 模块载入自己的 WebContentsView,如 chrome 工具栏 / newtab 主页):
  // 发现 src/<page>/main.tsx 逐个构建成 dist/<page>/,external react 经 import map → vendor;
  // 有同目录 preload.ts 才出 preload.mjs(chrome 有、newtab 无)。
  await buildModulePages(dir);
  // 模块内置资源(如自动化 DSL 脚本)随包:scripts/ → dist/scripts/,模块运行时 fs 读自有目录。
  if (existsSync(join(dir, "scripts"))) await cp(join(dir, "scripts"), join(dir, "dist", "scripts"), { recursive: true });
}

async function buildModulePages(dir) {
  const srcDir = join(dir, "src");
  const subs = await readdir(srcDir, { withFileTypes: true }).catch(() => []);
  for (const e of subs) {
    if (e.isDirectory() && existsSync(join(srcDir, e.name, "main.tsx"))) await buildPage(dir, e.name);
  }
}

async function buildPage(dir, name) {
  const src = join(dir, "src", name);
  const outDir = join(dir, "dist", name);
  await build({
    entryPoints: [join(src, "main.tsx")],
    bundle: true,
    format: "esm",
    outfile: join(outDir, "main.mjs"),
    platform: "browser",
    external: rendererExternal, // react 经页面 import map → vendor
    jsx: "transform",
    logLevel: "warning",
  });
  if (existsSync(join(src, "preload.ts"))) {
    await build({
      entryPoints: [join(src, "preload.ts")],
      bundle: true,
      format: "esm",
      outfile: join(outDir, "preload.mjs"),
      platform: "node",
      external: ["electron"], // preload 在渲染进程的特权上下文,直接用 electron
      logLevel: "warning",
    });
  }
  await mkdir(outDir, { recursive: true });
  await copyFile(join(src, "index.html"), join(outDir, "index.html")); // 带 import map 的页面壳
}

await buildVendor();
const mods = await discoverModules();
for (const m of mods) await buildModule(m);
console.log(`[build:mods] vendor + 构建 [${mods.map((m) => m.id).join(", ")}]`);
