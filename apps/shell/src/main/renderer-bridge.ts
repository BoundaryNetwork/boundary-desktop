import { type WebContents, ipcMain } from "electron";
import type { BaseContext } from "@boundary-desktop/contract";
import { IPC } from "../shared/ipc.js";
import type { ActivateRequest } from "../shared/types.js";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

/** main↔renderer 请求/响应桥:把"激活/停用模块、调 renderer tool"这类 main→renderer
 *  请求做成可 await(按 reqId 关联 renderer 的回复)。并持有每次激活的 main 侧 ctx
 *  (按 aid),供 renderer 回调能力(registerTool 等)时取用。 */
export class RendererBridge {
  #wc: WebContents | null = null;
  #reqSeq = 0;
  #aidSeq = 0;
  #pending = new Map<number, Pending>();
  #ctxByAid = new Map<number, BaseContext>();

  attach(wc: WebContents): void {
    this.#wc = wc;
    ipcMain.on(
      IPC.rtReply,
      (_e, msg: { reqId: number; ok: boolean; result?: unknown; error?: string }) => {
        const p = this.#pending.get(msg.reqId);
        if (!p) return;
        this.#pending.delete(msg.reqId);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error ?? "renderer 端执行失败"));
      },
    );
    wc.on("destroyed", () => {
      for (const p of this.#pending.values()) p.reject(new Error("renderer 已销毁"));
      this.#pending.clear();
    });
  }

  nextAid(): number {
    return ++this.#aidSeq;
  }
  bindCtx(aid: number, ctx: BaseContext): void {
    this.#ctxByAid.set(aid, ctx);
  }
  ctx(aid: number): BaseContext | undefined {
    return this.#ctxByAid.get(aid);
  }
  releaseCtx(aid: number): void {
    this.#ctxByAid.delete(aid);
  }

  #request<T>(channel: string, payload: object): Promise<T> {
    const wc = this.#wc;
    if (!wc) return Promise.reject(new Error("renderer 尚未就绪"));
    const reqId = ++this.#reqSeq;
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject });
      wc.send(channel, { reqId, ...payload });
    });
  }

  activate(req: ActivateRequest): Promise<void> {
    return this.#request(IPC.rtActivate, req);
  }
  deactivate(aid: number): Promise<void> {
    return this.#request(IPC.rtDeactivate, { aid });
  }
  invokeRendererTool(aid: number, name: string, args: unknown, caller: string | null): Promise<unknown> {
    return this.#request(IPC.rtToolInvoke, { aid, name, args, caller });
  }
  pushShared(shared: unknown): void {
    this.#wc?.send(IPC.sharedChanged, shared);
  }
}
