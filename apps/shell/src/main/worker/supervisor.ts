import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { WorkerControlClient, type WorkerState } from "./control.js";
import {
  controlSocketPath,
  runDir,
  runtimeFilePath,
  workerBinaryPath,
  WORKER_BINARY,
} from "./paths.js";
import { readRuntimeFile, type TcpEndpoint } from "./runtime.js";

// 常量取自 ai-agent `app_launcher`:retry 5s、drain 2s、轮询步进 25ms。
const RETRY_INTERVAL_MS = 5000;
const DISCOVERY_POLL_MS = 250;
const DRAIN_TIMEOUT_MS = 2000;
const POLL_STEP_MS = 25;
// 退出时等 worker 优雅退干净的上限,超时才强杀。worker 优雅退出实测 ~0.3s(已 attach);
// 给到 5s 容纳"排空 in-flight turn"的慢路径。注:worker 自行退出(信号)时 #waitExit 一旦
// 探到 signalCode 即返回,不会干等到这个上限 —— 这个上限只在 worker 真卡死时兜底。
const GRACEFUL_EXIT_TIMEOUT_MS = 5000;

export interface WorkerEndpoints {
  http?: TcpEndpoint;
  ws?: TcpEndpoint;
}

/** agentworkerd 的进程监管器:`crates/app-launcher` 的 `WorkerProcess` + `run_with_retry`
 *  + 端点发现的 Node 版。单例 daemon,独占 workspace,生命周期绑 app。worker 侧零改动。 */
export class WorkerSupervisor {
  #control = new WorkerControlClient(controlSocketPath());
  #child: ChildProcess | null = null;
  #stopping = false;
  #restarting = false;
  // 当前这一代 worker 的 spawn 时刻(ms epoch):供运行状态页算 UPTIME / STARTED。每次 spawn 刷新。
  #startedAt: number | null = null;
  #retryTimer: NodeJS.Timeout | null = null;
  #discoveryTimer: NodeJS.Timeout | null = null;
  #endpoints: WorkerEndpoints = {};
  #onDiscover: ((endpoints: WorkerEndpoints) => void) | null = null;

  /** 起监管:reap 孤儿 → spawn → 起崩溃自愈 tick(5s)与端点发现轮询。 */
  start(): void {
    this.#spawn();
    this.#retryTimer = setInterval(() => this.#tick(), RETRY_INTERVAL_MS);
    this.#discoveryTimer = setInterval(() => void this.#discover(), DISCOVERY_POLL_MS);
  }

  /** runtime.json 发现到新一代 worker 的端点时回调(端口变化才触发)。 */
  onDiscover(cb: (endpoints: WorkerEndpoints) => void): void {
    this.#onDiscover = cb;
  }

  httpBaseUrl(): string | null {
    const http = this.#endpoints.http;
    return http ? `http://${http.addr}:${http.port}` : null;
  }

  endpoints(): WorkerEndpoints {
    return this.#endpoints;
  }

  /** 当前 worker 这一代的 spawn 时刻(ms epoch);尚未 spawn 为 null。 */
  startedAt(): number | null {
    return this.#startedAt;
  }

  /** 手动重启:优雅停掉当前 worker 再立即重生。`#restarting` 守住与自愈 tick 的竞态
   *  (置 null 到重生之间若 tick 介入会双 spawn)。重生后端点经发现轮询自然刷新。 */
  async restart(): Promise<void> {
    if (this.#restarting || this.#stopping) return;
    this.#restarting = true;
    try {
      const old = this.#child;
      this.#child = null;
      this.#endpoints = {};
      if (old) {
        try {
          await this.#control.shutdown();
        } catch {
          // 控制端点不可达:worker 可能已在退出,下面统一等。
        }
        if (!(await this.#waitExit(old, GRACEFUL_EXIT_TIMEOUT_MS))) {
          old.kill("SIGKILL");
          await this.#waitExit(old, 1000);
        }
      }
      this.#spawn(); // 内含 reapOrphans:清掉任何残留再起新一代
    } finally {
      this.#restarting = false;
    }
  }

  /** 崩溃自愈:子进程活着 → noop;已退出 → 重新 spawn。对齐 `run_with_retry`。 */
  #tick(): void {
    if (this.#stopping || this.#restarting) return;
    if (this.#childAlive()) return;
    console.warn("[worker] 子进程不在,重启");
    this.#spawn();
  }

  #childAlive(): boolean {
    const child = this.#child;
    return child !== null && child.exitCode === null && !child.killed;
  }

  #spawn(): void {
    // spawn 前按名 reap 孤儿(关键):上一轮壳异常退出会留下孤儿 worker,两个 worker 同设备
    // 抢 gateway 单一 session slot → 互标 rotated → 败者轮询拿到 40023 → 重启 ~5s 环。
    reapOrphans();
    mkdirSync(runDir(), { recursive: true }); // worker 要在此 bind control 端点
    const bin = workerBinaryPath();
    const child = spawn(bin, [], {
      stdio: ["ignore", "inherit", "inherit"], // 接到壳日志;打包态再考虑落文件
      windowsHide: true, // 等价 CREATE_NO_WINDOW,免控制台子系统二进制弹 cmd 窗
    });
    child.on("error", (err) => console.error("[worker] spawn 失败", err));
    child.on("exit", (code, signal) => {
      console.warn(`[worker] 退出 code=${code} signal=${signal}`);
      if (this.#child === child) this.#child = null;
    });
    this.#child = child;
    this.#startedAt = Date.now();
    console.log(`[worker] 已 spawn pid=${child.pid} bin=${bin}`);
  }

  /** 端点发现:轮询 runtime.json,校验 pid == 当前子进程后取 http/ws 端点。
   *  pid 校验避免读到上一轮残留文件(worker 重启前的旧 runtime.json)。 */
  async #discover(): Promise<void> {
    if (this.#stopping) return;
    const child = this.#child;
    if (!child || child.pid == null) return;
    let rt;
    try {
      rt = await readRuntimeFile(runtimeFilePath());
    } catch {
      return; // 半写/解析失败,下个 tick 再试
    }
    if (!rt || !rt.http) return;
    if (rt.pid !== child.pid) return; // 不是这一代 worker,忽略
    if (this.#endpoints.http?.port === rt.http.port && this.#endpoints.ws?.port === rt.ws?.port) {
      return; // 端口没变,不重复回调
    }
    this.#endpoints = { http: rt.http, ws: rt.ws };
    console.log(
      `[worker] 发现端点 http=${rt.http.addr}:${rt.http.port} ws=${rt.ws ? `${rt.ws.addr}:${rt.ws.port}` : "-"}`,
    );
    this.#onDiscover?.(this.#endpoints);
  }

  /** 退出排空(app quit):停 loop → 尽力驱动 worker 下线 → 耐心等其退出,真卡住才强杀。
   *
   *  控制端点 EPIPE/ECONNREFUSED 不当错误:worker 可能已被信号触发自行优雅退出(dev 下
   *  终端进程组的 SIGINT),控制端点随之关闭。此时不该把它当失败、更不该急着 SIGKILL,
   *  等它自己退干净即可(它会移除 runtime.json、优雅关 gateway session)。 */
  async stop(): Promise<void> {
    this.#stopping = true;
    if (this.#retryTimer) clearInterval(this.#retryTimer);
    if (this.#discoveryTimer) clearInterval(this.#discoveryTimer);
    const child = this.#child;
    if (!child) {
      reapOrphans();
      return;
    }

    // 驱动下线:drain(放在途的 turn 落地)→ shutdown(停服退出)。两步独立 best-effort,
    // 控制端点不可达就跳过 —— 多半 worker 已在自行退出。
    let controlReached = false;
    try {
      await this.#control.drain();
      await this.#waitState("draining", DRAIN_TIMEOUT_MS);
    } catch {
      // worker 不在 / 已在退出 / 拒绝 drain:无所谓,下面统一等退出。
    }
    try {
      await this.#control.shutdown();
      controlReached = true;
    } catch {
      // 同上。
    }
    if (!controlReached) {
      console.log("[worker] 控制 socket 已关(worker 可能在自行退出),转为等待进程退出");
    }

    // 耐心等退出,只有真卡住才强杀。
    if (!(await this.#waitExit(child, GRACEFUL_EXIT_TIMEOUT_MS))) {
      console.warn("[worker] 优雅退出超时,强杀");
      child.kill("SIGKILL");
      await this.#waitExit(child, 1000); // 收尸
    }
    reapOrphans(); // backstop:别让孤儿 worker 活过壳退出
  }

  async #waitState(state: WorkerState, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    for (;;) {
      const status = await this.#control.status().catch(() => null);
      if (status?.state === state) return;
      if (Date.now() >= deadline) throw new Error(`等 worker 进入 ${state} 超时`);
      await sleep(POLL_STEP_MS);
    }
  }

  /** 轮询子进程是否已退出(自然退出 exitCode!=null,或被信号 signalCode!=null)。
   *  返回是否在 timeout 内退出 —— 不在这里强杀,强杀策略归调用方。 */
  async #waitExit(child: ChildProcess, timeout: number): Promise<boolean> {
    const deadline = Date.now() + timeout;
    while (child.exitCode === null && child.signalCode === null) {
      if (Date.now() >= deadline) return false;
      await sleep(POLL_STEP_MS);
    }
    return true;
  }
}

/** 按名强杀 worker。对齐 ai-agent `force_kill_by_name`(`pkill -9 -x` / `taskkill /F /IM`)。 */
function reapOrphans(): void {
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/F", "/IM", `${WORKER_BINARY}.exe`]);
    } else {
      spawnSync("pkill", ["-9", "-x", WORKER_BINARY]);
    }
  } catch {
    // best-effort:没有匹配进程 / pkill 缺失都不致命
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
