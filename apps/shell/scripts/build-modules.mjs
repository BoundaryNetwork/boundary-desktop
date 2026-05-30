// 模块构建工具链:把 vendor 共享包(react / react-dom)与各 TSX 模块构建成 app:// ESM 产物。
// 模块以 react/react-dom 为 external,运行时经渲染页的 import map 指向 vendor —— 一份 React,
// 多模块共享,模块产物不各自打包 React。
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const shell = dirname(dirname(fileURLToPath(import.meta.url))); // apps/shell
const repo = dirname(dirname(shell)); // 仓库根
const vendorDir = join(shell, "vendor");

// 模块对这些 bare specifier 的引用保持 external,交给 import map 解析到 vendor。
const external = ["react", "react-dom", "react-dom/client"];

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
      resolveDir: shell,
      loader: "js",
    },
    bundle: true,
    format: "esm",
    outfile: join(vendorDir, "vendor.mjs"),
    logLevel: "warning",
  });
}

async function buildModule(id) {
  await build({
    entryPoints: [join(repo, "modules", id, "src", "index.tsx")],
    bundle: true,
    format: "esm",
    outfile: join(repo, "modules", id, "dist", "index.mjs"),
    external,
    jsx: "transform", // 经典 JSX:React.createElement,模块自带 import React
    logLevel: "warning",
  });
}

await buildVendor();
await buildModule("chat");
console.log("[build:mods] vendor + chat 构建完成");
