import type { Disposable } from "@boundary-desktop/contract";
import type { ToolInfo } from "./tool-registry.js";

/** 对外门面的核心契约：三件套 + 变更订阅。
 *  任何门面（WS / MCP / CLI）都映射到它，门面层不碰模块系统、命名空间、跨进程路由。
 *
 *  - list：列出当前 tool 及 schema
 *  - invoke：按全名调用，内部按来源路由（含 drain 计数）
 *  - version：tool 集合的变更计数，断线重连后的对账依据
 *  - onChange：tool 集合变化时通知（注册/卸载/热替换触发），供门面主动推送 */
export interface ToolFacade {
  list(): ToolInfo[];
  invoke(name: string, args: unknown): Promise<unknown>;
  version(): number;
  onChange(listener: () => void): Disposable;
}
