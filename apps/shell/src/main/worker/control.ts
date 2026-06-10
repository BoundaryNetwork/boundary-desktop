import { connect, type Socket } from "node:net";

// 对齐 ai-agent `app_launcher::WorkerControlClient` + `app_shared::transport`。
// 传输:mac/linux = Unix domain socket;Windows = 固定 loopback TCP 127.0.0.1:8789(非 named pipe)。
// 帧:写一条 JSON 请求 → 半关闭写端(发 FIN)→ 读到对端 EOF → 解析。无分隔符,半关闭即帧边界。
const WORKER_CONTROL_TCP_PORT = 8789;
const CONTROL_TIMEOUT_MS = 5000;

export type WorkerState = "starting" | "ready" | "draining" | "stopping";

export interface WorkerStatus {
  state: WorkerState;
  pid: number;
  generation: number;
  version: string;
}

type ControlRequest = "status" | "drain" | "shutdown";

export class WorkerControlClient {
  #socketPath: string;

  constructor(socketPath: string) {
    this.#socketPath = socketPath;
  }

  status(): Promise<WorkerStatus> {
    return this.#send("status");
  }
  drain(): Promise<WorkerStatus> {
    return this.#send("drain");
  }
  shutdown(): Promise<WorkerStatus> {
    return this.#send("shutdown");
  }

  #send(type: ControlRequest): Promise<WorkerStatus> {
    return new Promise<WorkerStatus>((resolve, reject) => {
      const socket: Socket =
        process.platform === "win32"
          ? connect({ host: "127.0.0.1", port: WORKER_CONTROL_TCP_PORT })
          : connect(this.#socketPath);

      const chunks: Buffer[] = [];
      let settled = false;
      const fail = (err: Error): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(err);
      };

      socket.setTimeout(CONTROL_TIMEOUT_MS);
      socket.on("timeout", () => fail(new Error("worker control 读写超时")));
      socket.on("error", fail);
      socket.on("connect", () => {
        // end(data):写请求并半关闭写端,等价 Rust 的 write_all + shutdown_write。
        socket.end(JSON.stringify({ type }));
      });
      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.on("end", () => {
        if (settled) return;
        settled = true;
        let parsed: { ok?: boolean; error?: string } & Partial<WorkerStatus>;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch (err) {
          reject(new Error(`解析 worker control 响应失败:${(err as Error).message}`));
          return;
        }
        if (parsed.ok === false) {
          reject(new Error(parsed.error ?? "worker control 返回错误"));
          return;
        }
        resolve({
          state: parsed.state as WorkerState,
          pid: parsed.pid as number,
          generation: parsed.generation as number,
          version: parsed.version as string,
        });
      });
    });
  }
}
