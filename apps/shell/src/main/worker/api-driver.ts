import type { ApiRequest } from "@boundary-desktop/contract";
import type { ApiDriver } from "@boundary-desktop/host";

/** 把模块的 `ctx.api.request` 代发到 agentworkerd 的本地 HTTP 端点。
 *  baseURL 实时取自 supervisor 发现的 runtime.json http 端点(随 worker 重启换端口);
 *  token 由基座注入(模块只读)。模块零感知,无新契约。 */
export class WorkerApiDriver implements ApiDriver {
  #baseUrl: () => string | null;

  constructor(baseUrl: () => string | null) {
    this.#baseUrl = baseUrl;
  }

  async request(opts: ApiRequest, token: string | null): Promise<unknown> {
    const base = this.#baseUrl();
    if (!base) {
      throw new Error("agentworkerd 端点尚未就绪(worker 未起或还没写出 runtime.json)");
    }
    const url = new URL(opts.path, base.endsWith("/") ? base : `${base}/`);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { ...opts.headers };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] ??= "application/json";
      body = JSON.stringify(opts.body);
    }

    const resp = await fetch(url, { method: opts.method, headers, body });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`agentworkerd ${opts.method} ${opts.path} → ${resp.status}: ${text.slice(0, 200)}`);
    }
    return text ? safeJson(text) : null;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text; // 非 JSON 响应原样返回
  }
}
