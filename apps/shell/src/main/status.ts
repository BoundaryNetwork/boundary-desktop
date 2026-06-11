import type { LocalStatus } from "../shared/types.js";

/** 拉 agentworkerd 的 /local/status 聚合状态(public,无需令牌)。
 *  base 为 null(worker 端点尚未发现)或端点抖动/未起时返回 null,渲染层据此显示"连接中"。 */
export async function fetchLocalStatus(base: string | null): Promise<LocalStatus | null> {
  if (!base) return null;
  let resp: Awaited<ReturnType<typeof fetch>>;
  try {
    resp = await fetch(new URL("/local/status", base.endsWith("/") ? base : `${base}/`));
  } catch {
    return null; // 端点未就绪或网络抖动:视为未就绪,不抛
  }
  if (!resp.ok) return null;
  return (await resp.json()) as LocalStatus;
}
