// 接口响应采集(港 openclaw automation/session-capture.ts)。
// 经 CDP Network 域抓匹配 url 的 JSON/JSONP 响应,按 SessionSpec 抽行累积,支持上限与翻页判定。
import type { WebviewHandle } from "@boundary-desktop/contract";
import { extractRows, readHasNext } from "./jsonpath.js";
import type { SessionSpec } from "./script-types.js";

function stripJsonp(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    // 尝试 jsonp 包裹
  }
  const m = t.match(/^[^(]*\((.*)\)\s*;?\s*$/s);
  if (m) {
    try {
      return JSON.parse(m[1]!);
    } catch {
      // 落到下方抛错
    }
  }
  throw new Error("not json/jsonp");
}

export class SessionCollector {
  #rows = new Map<string, Record<string, unknown>[]>();
  #next = new Map<string, boolean>();
  #caps = new Map<string, number>();
  #specs: SessionSpec[];

  constructor(specs: SessionSpec[]) {
    this.#specs = specs;
    for (const s of specs) {
      this.#rows.set(s.sessionKey, []);
      this.#next.set(s.sessionKey, true);
    }
  }

  shouldCapture(url: string): string | null {
    for (const s of this.#specs) if (s.urlIncludes.some((u) => url.includes(u))) return s.sessionKey;
    return null;
  }

  ingest(key: string, resp: unknown): void {
    const spec = this.#specs.find((s) => s.sessionKey === key)!;
    const arr = this.#rows.get(key)!;
    arr.push(...extractRows(resp, spec.valueKey));
    const cap = this.#caps.get(key);
    if (cap != null && arr.length > cap) arr.length = cap; // 挡住迟到的异步响应,不越过上限
    if (spec.hasNextKey) this.#next.set(key, readHasNext(resp, spec.hasNextKey));
  }

  ingestRaw(key: string, text: string): void {
    this.ingest(key, stripJsonp(text));
  }

  count(key: string): number {
    return this.#rows.get(key)?.length ?? 0;
  }

  /** 设上限:立刻裁掉超额,且后续 ingest(含迟到响应)恒不超过 n。 */
  setCap(key: string, n: number): void {
    if (!Number.isFinite(n) || n < 0) return;
    this.#caps.set(key, Math.floor(n));
    this.trim(key, n);
  }

  trim(key: string, n: number): void {
    if (!Number.isFinite(n) || n < 0) return;
    const arr = this.#rows.get(key);
    if (arr && arr.length > n) arr.length = Math.floor(n);
  }

  hasNext(key: string): boolean {
    return this.#next.get(key) ?? false;
  }

  values(key: string): Record<string, unknown>[] {
    return this.#rows.get(key) ?? [];
  }

  all(): Record<string, Record<string, unknown>[]> {
    const o: Record<string, Record<string, unknown>[]> = {};
    for (const [k, v] of this.#rows) o[k] = v;
    return o;
  }
}

/** 挂上 Network 拦截,把匹配响应喂给 collector;返回解绑函数。
 *  注意:driver 已 attach debugger,这里只需 enable Network,否则首步采集时管道未就绪、采集恒为 0。 */
export function attachCapture(view: WebviewHandle, collector: SessionCollector): () => void {
  void view.cdp.send("Network.enable").catch(() => {});
  const sub = view.cdp.on("Network.responseReceived", (params) => {
    const p = params as { response: { url: string; mimeType: string }; requestId: string };
    const key = collector.shouldCapture(p.response.url);
    if (!key) return;
    if (!/json|javascript/i.test(p.response.mimeType)) return;
    void view.cdp
      .send("Network.getResponseBody", { requestId: p.requestId })
      .then((r) => {
        try {
          collector.ingestRaw(key, (r as { body: string }).body);
        } catch {
          // 非 json/jsonp 或抽行失败,跳过
        }
      })
      .catch(() => {});
  });
  return () => {
    // 只退订,不 Network.disable:同 view 的 cdp 是共享会话(interceptNext 等也可能正用 Network 域),
    // 单方 disable 会掐掉并发消费方。Network 域随 view.destroy() 的 debugger.detach() 整体回收。
    sub.dispose();
  };
}
