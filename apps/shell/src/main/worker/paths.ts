import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

// 与 ai-agent worker 共用同一 bundle id / base_dir / 设备身份。worker 侧零改动,
// 壳必须算出与 worker 逐字节一致的路径,否则找不到它绑的 control socket / runtime.json。
const APP_BUNDLE_ID = "ai.boundary.claw";
const WORKER_BINARY = "clawhost-agentworkerd";
const RUN_SUBDIR = ["run", "agentworkerd"];

/** 镜像 ai-agent `app_launcher::default_base_dir`(Rust `dirs::data_local_dir()/ai.boundary.claw`)。
 *  不能用 Electron `app.getPath('appData')` —— 它在 Linux(~/.config)、Windows(Roaming)与
 *  Rust 的 data_local_dir(~/.local/share、%LOCALAPPDATA%)分叉,会读到不同目录。 */
export function workerBaseDir(): string {
  return join(dataLocalDir(), APP_BUNDLE_ID);
}

function dataLocalDir(): string {
  const home = homedir();
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Application Support");
    case "win32":
      return process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    default:
      return process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
  }
}

export function runDir(base = workerBaseDir()): string {
  return join(base, ...RUN_SUBDIR);
}

/** worker 绑的 Unix 控制 socket(mac/linux);Windows 走固定 loopback TCP,不用此路径。 */
export function controlSocketPath(base = workerBaseDir()): string {
  return join(runDir(base), "control.sock");
}

/** worker 绑完监听后原子写出的端点发现文件。 */
export function runtimeFilePath(base = workerBaseDir()): string {
  return join(runDir(base), "runtime.json");
}

/** 解析 worker 可执行文件路径:
 *  override(BOUNDARY_WORKER_BIN)> 打包态(resourcesPath 内)> dev 默认(apps/shell/resources)。
 *  macOS 一律指向签名的 `.app/Contents/MacOS/<bin>` —— 裸 Mach-O 会被 AMFI SIGKILL,
 *  且拿不到 Secure Enclave / keychain-access-groups 权限。 */
export function workerBinaryPath(): string {
  const override = process.env.BOUNDARY_WORKER_BIN;
  if (override) return override;
  const root = app.isPackaged
    ? process.resourcesPath
    : join(import.meta.dirname, "..", "..", "resources");
  if (process.platform === "darwin") {
    return join(root, `${WORKER_BINARY}.app`, "Contents", "MacOS", WORKER_BINARY);
  }
  if (process.platform === "win32") {
    return join(root, `${WORKER_BINARY}.exe`);
  }
  return join(root, WORKER_BINARY);
}

export { WORKER_BINARY };
