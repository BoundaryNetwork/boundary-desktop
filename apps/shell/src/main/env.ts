import { join } from "node:path";
import { app } from "electron";
import { LocalDirSource, RemoteSource, type ModuleSource } from "@boundary-desktop/host";

export type EnvName = "local" | "staging" | "prod";

// 打包时由 electron-vite define 注入(BUILD_ENV=prod pnpm build 即烘焙 "prod");
// dev 缺省 "local"。typeof 守卫:非构建路径(裸跑)下不至于 ReferenceError。
declare const __BUILD_ENV__: string;
const baked: string = typeof __BUILD_ENV__ !== "undefined" ? __BUILD_ENV__ : "local";

/** active env 单点解析:运行时 BOUNDARY_ENV 覆盖 > 打包烘焙的 BUILD_ENV。
 *  未知值直接抛(fail-fast,不静默回退)。 */
export function activeEnv(): EnvName {
  const name = process.env.BOUNDARY_ENV ?? baked;
  if (name !== "local" && name !== "staging" && name !== "prod") {
    throw new Error(`未知环境 "${name}"(BOUNDARY_ENV/BUILD_ENV 应为 local | staging | prod)`);
  }
  return name;
}

// 各远程环境的 catalog 地址(非密,可入库占位)。active env 的可经 BOUNDARY_CATALOG_URL 覆盖。
const CATALOG_URL: Record<"staging" | "prod", string> = {
  staging: "https://cdn-staging.example.com/modules/catalog.json",
  prod: "https://cdn.example.com/modules/catalog.json",
};

/** 按 active env 构造模块来源:
 *  - local:扫本地 modules/(无 CDN,跳过校验)。
 *  - staging/prod:RemoteSource 拉对应 catalog,产物缓存按 env 命名空间隔离。 */
export function createModuleSource(): { env: EnvName; source: ModuleSource } {
  const env = activeEnv();
  if (env === "local") {
    const root = process.env.BOUNDARY_MODULES_DIR ?? join(process.cwd(), "..", "..", "modules");
    return { env, source: new LocalDirSource([root]) };
  }
  const catalogUrl = process.env.BOUNDARY_CATALOG_URL ?? CATALOG_URL[env];
  const cacheDir = join(app.getPath("userData"), "modules-cache", env); // 按 env 隔离
  return { env, source: new RemoteSource({ catalogUrl, cacheDir }) };
}
