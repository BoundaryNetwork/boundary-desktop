import { readFile } from "node:fs/promises";

// runtime.json 的形态对齐 ai-agent `app_shared::runtime_file::RuntimeFile`。worker 绑完
// HTTP/WS 监听后原子写出(*.tmp + rename),优雅退出时删除。连接失败应重读以跟上新一代 worker。

export interface TcpEndpoint {
  addr: string;
  port: number;
}

export interface BrowserBridgeEndpoint {
  addr: string;
  port: number;
  token: string;
}

export interface RuntimeFile {
  schema: number;
  pid: number;
  started_at: string;
  http?: TcpEndpoint;
  ws?: TcpEndpoint;
  browser_bridge?: BrowserBridgeEndpoint;
}

/** 读并解析 runtime.json;文件不存在(worker 还没绑完监听)返回 null,其余错误抛出。 */
export async function readRuntimeFile(path: string): Promise<RuntimeFile | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(text) as RuntimeFile;
}
