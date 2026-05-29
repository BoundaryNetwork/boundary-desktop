import type { Disposable, Runtime, ToolDefinition } from "@boundary-desktop/contract";
import type { DrainLedger } from "./drain-ledger.js";

interface ToolEntry {
  /** 注册它的那次激活的代际 token。 */
  ownerToken: number;
  ownerId: string;
  runtime: Runtime;
  def: ToolDefinition;
}

/** 对外门面 list 用的 tool 视图（全名 + schema）。 */
export interface ToolInfo {
  name: string;
  schema: object;
  description?: string;
}

/** 全局 tool 注册表。
 *
 *  名字以 `<module.id>.<name>` 登记，前缀由 Registry 用 module id 自动加，模块碰不到——
 *  跨模块冲突因此结构性不可能。
 *
 *  每个全名对应一个**栈**而非单值：热替换"先起后落"期间，新旧两代同 id 同裸名会短暂共存，
 *  新代压栈成栈顶（对外即时切到新逻辑），旧代仍在栈底；旧代退场时按 token 精确弹出自己那层。
 *  正常态栈深为 1，替换重叠期为 2（Registry 串行保证不超过 2）。 */
export class ToolRegistry {
  #stacks = new Map<string, ToolEntry[]>();
  #ledger: DrainLedger;
  #onChange: () => void;

  constructor(ledger: DrainLedger, onChange: () => void = () => {}) {
    this.#ledger = ledger;
    this.#onChange = onChange;
  }

  /** 注册。同一代际重复注册同名 → 抛错（模块内重名）；不同代际同名 → 压栈（替换重叠）。
   *  返回的 Disposable 仅弹出自己这一层，供提前撤销；正常回收由 Registry 在 deactivate 时统一做。 */
  register(ownerToken: number, ownerId: string, runtime: Runtime, def: ToolDefinition): Disposable {
    const fullName = `${ownerId}.${def.name}`;
    const stack = this.#stacks.get(fullName) ?? [];
    if (stack.some((e) => e.ownerToken === ownerToken)) {
      throw new Error(`模块 ${ownerId} 重复注册 tool "${def.name}"`);
    }
    const entry: ToolEntry = { ownerToken, ownerId, runtime, def };
    stack.push(entry);
    this.#stacks.set(fullName, stack);
    this.#onChange();
    return { dispose: () => this.#remove(fullName, entry) };
  }

  #remove(fullName: string, entry: ToolEntry): void {
    const stack = this.#stacks.get(fullName);
    if (!stack) return;
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    if (stack.length === 0) this.#stacks.delete(fullName);
    this.#onChange();
  }

  /** 调用栈顶 handler。进出账本按栈顶 entry 的 token 记，供 drain 归属。 */
  async invoke(fullName: string, args: unknown): Promise<unknown> {
    const stack = this.#stacks.get(fullName);
    const entry = stack?.[stack.length - 1];
    if (!entry) throw new Error(`tool 未注册：${fullName}`);
    this.#ledger.enter(entry.ownerToken);
    try {
      return await entry.def.handler(args);
    } finally {
      this.#ledger.leave(entry.ownerToken);
    }
  }

  list(): ToolInfo[] {
    const out: ToolInfo[] = [];
    for (const [fullName, stack] of this.#stacks) {
      const top = stack[stack.length - 1];
      out.push({ name: fullName, schema: top.def.schema, description: top.def.description });
    }
    return out;
  }
}
