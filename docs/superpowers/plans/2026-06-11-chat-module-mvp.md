# chat 模块 MVP 移植 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 agent-ui 的 chat 以 renderer 功能模块形态移植进 `modules/chat`,替换现有 169 行回声 stub,核心 MVP:会话列表 / 历史 / 流式 turn 渲染 / 发送 / 停止。

**Architecture:** 单 renderer 模块,分层 协议(`protocol/`)→ 状态(`state/`)→ 渲染(`render/`)→ UI(`ui/`)。流式状态机(stream store + render-units + tool/thinking 合并 + markdown)按语义原样搬;UI 壳重写。REST 经 `ctx.api.request` 代发到本机 agentworkerd;实时 turn 流走模块自连的浏览器 `WebSocket`(`ws://{ctx.config.agentworkerd.ws.addr}:{port}/ws`),鉴权用 `ctx.auth.getToken()`(浏览器 WS 不能设 Authorization 头,token 经 query 携带,线格式以 worker `/ws` 约定为准);错误统一收口到 `ctx.notify`。

**Tech Stack:** TypeScript 6(NodeNext/Bundler ESM)、React 18(经典 JSX,react/react-dom external)、zustand 4 + immer 10、marked 12 + dompurify 3、vitest 4 + jsdom。

**源参考(只读,不改):** agent-ui 仓 `/Volumes/development/boundary-workspace/agent-ui`,关键源
`src/types/message.ts`、`src/lib/{render-units,tool-cards,thinking,markdown}.ts`、
`src/stores/conversation-stream.store.ts`、`src/protocol/{ws-bridge-handlers,types}.ts`。

**MVP 裁剪(本期不做):** 附件 + 灯箱、右侧三抽屉、skill chip、↑/↓ 输入历史、草稿持久化、置顶 / 排序、未读 / running-session、代码高亮(highlight.js)、token 用量、审批 UI。移植时剥掉这些辅助子系统:`session-read-state` / `running-sessions` / `ws-error-mapping` / `toast`(→ `ctx.notify`)/ `delta-coalescer`(→ rAF 轻量 flush)/ `agentInstanceId`(MVP 单默认实例,WS 帧不带 `agent_instance_id`)。

**锁定的决策与待确认项:**
1. **WS 鉴权 = `ctx.auth.getToken()`(锁定决策,不改)** —— 浏览器 WebSocket 不能设 Authorization 头,本计划用 query 参数 `?token=<getToken()>` 携带,集中在 `ws.ts` 的 `buildUrl` 一处。**待确认**:boundary 的 worker `/ws` 接受 token 的线格式(query / `Sec-WebSocket-Protocol` 子协议 / open 后首帧 auth),收尾人工验证时对 worker 核对、改 `buildUrl` 一处即可。注:参考 agent-ui 在 Tauri 下直连本地 worker 是 tokenless 的,但那是该宿主的部署形态,不代表 boundary worker 同样放行——故以本项目锁定的 getToken() 为准,不照搬参考的 tokenless。
2. **不带 `agent_instance_id` = 默认实例(参考显式支持)** —— 参考 `conversations.ts` 每处都注释 "undefined 时字段不出现,worker 走 `select_instance(None) = default_instance()`(R-9)";省略该字段即用默认实例,是受支持路径,非赌运气。唯一边界(参考 `sendTurn` 注释):*退订*在无默认实例时可能回 `AmbiguousInstanceSelection`——MVP 单默认实例不触发。
3. **`config.agentworkerd` 形状** —— host 在 `apps/shell/src/main/index.ts:59` 推 `agentworkerd: endpoints`,`endpoints = { http?, ws? }`、每项 `{ addr, port }`;以 `WorkerSupervisor` 实际下发为准(收尾人工验证核对)。

**对参考做的有意 MVP 简化(已知差异,非遗漏):**
- **subscribe 不等 ack**:参考 `enterConversation` 先 subscribe → 等 `subscription_result`/`turn_snapshot` ack → 再 seed 历史(为正确接住 in-flight turn 快照)。本计划简化为 setCurrentId → 拉历史 → subscribe(fire-and-forget);进入"正在跑的会话"时不重放快照(MVP 不订阅他人 in-flight turn,影响小)。
- **不实现 `web_account_token` 回写**:参考在帧上回写服务端下发的 web 渠道账号标识(非登录鉴权);仅外部 web 渠道账号绑定需要,本地对话不依赖。

---

## 文件布局

```
modules/chat/
  package.json             # 改:加 zustand/immer/marked/dompurify 运行时依赖 + vitest/vite/jsdom 测试依赖 + test 脚本
  vitest.config.ts         # 新:jsdom 环境
  manifest.json            # 不动(id=chat / runtime=renderer / ui 已就绪)
  tsconfig.json            # 不动
  src/
    index.tsx              # 重写:activate/deactivate;注入样式;建 WS;订阅 config 重连;注册 chat.open + chat.ask;挂 ChatApp
    types.ts               # 新:Message 联合 + WS 帧/响应 + REST DTO(手抄子集)
    protocol/
      ws.ts                # 新:浏览器 WebSocket 连接/重连/发帧/分发
      handlers.ts          # 移植 ws-bridge-handlers:帧 → store.apply*,剥辅助依赖,rAF 合批
    state/
      stream.ts            # 移植 conversation-stream.store:apply* reducers(剥 agentInstanceId / store-reset)
      conversation.ts      # 新:列表 + currentId(裁剪:无置顶/排序/未读)
    api/
      conversations.ts     # 新:REST(list/create/history/rename/delete)+ WS 发送(turn/stop/sub)+ 编排(select/new/send/ask/loadOlder)
    render/
      units.ts             # 原样移植 render-units(import 改相对)
      tool.ts              # 原样移植 tool-cards
      thinking.ts          # 原样移植 thinking
      markdown.ts          # 原样移植 markdown(无 @/ 依赖,纯搬)
    ui/
      app.tsx              # sidebar + main(window + composer);挂载即拉列表;编排回调
      sidebar.tsx          # 会话列表:选择 / 新建 / 删除
      window.tsx           # buildRenderUnits + 自动跟随滚动 + 加载更早
      line.tsx             # 用户气泡;assistant turn(thinking 块 / 工具卡 / markdown / 输入中)
      composer.tsx         # textarea + 发送 / 停止
      chat.css             # scoped:.oc-md markdown + .oc-code-block + 输入中动画
    render/__tests__/{thinking,tool,units,markdown}.test.ts
    state/__tests__/stream.test.ts
```

---

## Task 1: 脚手架 —— 依赖、测试工具链、css 文本加载

**Files:**
- Modify: `modules/chat/package.json`
- Create: `modules/chat/vitest.config.ts`
- Modify: `scripts/build-modules.mjs`(加 `.css` text loader,让模块可 `import css from "./chat.css"`)

- [ ] **Step 1: 改 `modules/chat/package.json`**

```json
{
  "name": "@boundary-desktop/module-chat",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@boundary-desktop/contract": "workspace:*",
    "dompurify": "^3.1.6",
    "immer": "^10.1.1",
    "marked": "^12.0.2",
    "zustand": "^4.5.5"
  },
  "devDependencies": {
    "@types/dompurify": "^3.0.5",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "jsdom": "^25.0.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^6.0.3",
    "vite": "^6.0.0",
    "vitest": "^4.1.7"
  }
}
```

- [ ] **Step 2: 建 `modules/chat/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom", // markdown 用例需 DOMPurify(依赖 window);其余纯逻辑用例一并跑无妨
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: 给 `scripts/build-modules.mjs` 的模块构建加 css text loader**

在 `buildModule` 的 `build({...})` 调用里(`modules/<id>/dist/index.mjs` 那次)加一行 `loader`,使模块能 `import cssText from "./chat.css"` 拿到 CSS 字符串(运行时注入 `<style>`)。找到:

```js
    platform: main ? "node" : "browser",
    external: main ? ["electron"] : rendererExternal,
    jsx: "transform", // 经典 JSX:React.createElement,模块自带 import React
    logLevel: "warning",
  });
```

改为:

```js
    platform: main ? "node" : "browser",
    external: main ? ["electron"] : rendererExternal,
    jsx: "transform", // 经典 JSX:React.createElement,模块自带 import React
    loader: { ".css": "text" }, // 模块内 scoped 样式以字符串内联,运行时注入 <style>
    logLevel: "warning",
  });
```

- [ ] **Step 4: 安装依赖**

Run: `cd /Volumes/development/boundary-workspace/boundary-desktop && pnpm install`
Expected: 安装成功,`modules/chat` 链接到 workspace,新增 zustand/immer/marked/dompurify/vitest/jsdom。

- [ ] **Step 5: 占位用例确认 vitest 起得来**

Create `modules/chat/src/render/__tests__/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("vitest runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `pnpm -F @boundary-desktop/module-chat test`
Expected: 1 passed。随后删除该文件:`rm modules/chat/src/render/__tests__/smoke.test.ts`

- [ ] **Step 6: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/package.json modules/chat/vitest.config.ts scripts/build-modules.mjs pnpm-lock.yaml
git commit -m "chore(chat): 脚手架 —— 运行时依赖 + vitest + css text loader"
```

---

## Task 2: `src/types.ts` —— 协议类型手抄子集

**Files:**
- Create: `modules/chat/src/types.ts`

源参考:agent-ui `src/types/message.ts` + `src/protocol/types.ts`。只搬 MVP 用到的:Message 联合、REST DTO、WS 出/入帧。**不带** `agent_instance_id` 相关裁剪由调用方负责,类型字段保留为可选以贴合 worker 线格式。

- [ ] **Step 1: 建 `modules/chat/src/types.ts`**

```ts
// agentworkerd REST/WS 协议响应类型的手抄子集(模块级与契约同步,见 docs/agent-kernel-eval.md)。
// 字段名严格对齐 worker 线格式(snake_case);裁掉 MVP 外的帧/DTO。

// ─── Message(UI/store 内部模型)────────────────────────────────────────────
export type MessageRole = "user" | "assistant" | "thinking" | "tool" | "tool_result";

export interface ConversationReferenceView {
  direction: "input" | "output";
  source: "attachment" | "workspace_file";
  name: string;
  media_type: string;
  attachment_id?: string;
  path?: string;
  operation?: string;
  download_url?: string;
  preview_url?: string;
  text_url?: string;
}

export interface TurnUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ApprovalReason {
  kind:
    | "protected_path_access"
    | "dangerous_token"
    | "existing_file_overwrite"
    | "file_content_removal"
    | "destructive_program";
  path?: string;
  token?: string;
  program?: string;
}

export interface ApprovalRequiredTurn {
  id: string;
  tool_name: string;
  approval_key: string;
  risk_level: "low" | "medium" | "high" | "critical";
  reasons: ApprovalReason[];
}

export interface BaseMessage {
  messageId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  timestamp?: string;
  pending?: boolean;
  references?: ConversationReferenceView[];
}
export interface UserMessage extends BaseMessage {
  role: "user";
}
export interface AssistantMessage extends BaseMessage {
  role: "assistant";
  cancelled?: boolean;
  usage?: TurnUsage;
  approval?: ApprovalRequiredTurn;
}
export interface ThinkingMessage extends BaseMessage {
  role: "thinking";
}
export interface ToolMessage extends BaseMessage {
  role: "tool";
  toolCallId?: string;
  toolName?: string;
  toolArguments?: unknown;
  cancelled?: boolean;
  usage?: TurnUsage;
}
export interface ToolResultMessage extends BaseMessage {
  role: "tool_result";
  toolCallId?: string;
  toolName?: string;
}
export type Message =
  | UserMessage
  | AssistantMessage
  | ThinkingMessage
  | ToolMessage
  | ToolResultMessage;

// ─── REST DTO ────────────────────────────────────────────────────────────────
export interface ConversationSummary {
  conversation_id: string;
  name?: string;
  last_turn_at: string | null;
}

export interface ConversationHistoryMessage {
  cursor: string;
  role: MessageRole;
  content: string;
  timestamp?: string;
  references?: ConversationReferenceView[];
  usage?: TurnUsage;
  tool_call_id?: string;
  tool_name?: string;
  tool_arguments?: unknown;
  cancelled?: boolean;
}

export interface ConversationHistoryResponse {
  conversation_id: string;
  // worker 对空会话省略 messages 字段(serde 跳过空 Vec);消费侧需 ?? [] 兜底。
  messages?: ConversationHistoryMessage[];
  has_more: boolean;
  next_before?: string;
}

// ─── WS 出帧(client → server,判别字段 type)─────────────────────────────────
export interface WsTurnRequest {
  type: "turn";
  message: string;
  conversation_id?: string;
  stream?: boolean;
}
export interface WsStopTurnRequest {
  type: "stop_turn";
  conversation_id: string;
}
export interface WsSubscribeConversationRequest {
  type: "subscribe_conversation";
  conversation_id: string;
}
export interface WsUnsubscribeConversationRequest {
  type: "unsubscribe_conversation";
  conversation_id: string;
}
export interface WsPingRequest {
  type: "ping"; // 心跳;worker 回 { kind: "pong" }
}
export type WsClientRequest =
  | WsTurnRequest
  | WsStopTurnRequest
  | WsSubscribeConversationRequest
  | WsUnsubscribeConversationRequest
  | WsPingRequest;

// ─── WS 入帧:流事件(stream=true turn 内,判别字段 kind,都有 ok)──────────────
export interface TurnStartedEvent {
  ok: boolean;
  kind: "turn_started";
  conversation_id: string;
}
export interface OutputDeltaEvent {
  ok: boolean;
  kind: "output_delta";
  conversation_id: string;
  output_text: string;
}
export interface ReasoningDeltaEvent {
  ok: boolean;
  kind: "reasoning_delta";
  conversation_id: string;
  reasoning_text: string;
}
export interface ToolCallEvent {
  ok: boolean;
  kind: "tool_call";
  conversation_id: string;
  tool_call: { id: string; name: string; arguments: unknown };
}
export interface ToolResultEvent {
  ok: boolean;
  kind: "tool_result";
  conversation_id: string;
  tool_result: { tool_call_id: string; tool_name: string; content: string };
}
export interface TurnCompletedEvent {
  ok: boolean;
  kind: "turn_completed";
  conversation_id: string;
  output_text?: string;
  finish_reason?: string;
  error?: string;
  approval?: ApprovalRequiredTurn;
  usage?: TurnUsage;
  turn_at?: string;
  turn_index?: number;
  cursor?: string;
}
export type WsStreamEvent =
  | TurnStartedEvent
  | OutputDeltaEvent
  | ReasoningDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | TurnCompletedEvent;

// ─── WS 入帧:响应(判别字段 kind)──────────────────────────────────────────────
export interface TurnSnapshotResponse {
  ok: true;
  kind: "turn_snapshot";
  conversation_id: string;
  turn_id: number;
  base_message_count: number;
  state: "streaming" | "tool_running" | "awaiting_approval";
  events?: WsStreamEvent[]; // worker 空数组时省略字段 → undefined,reducer 用 ?? []
}
export interface ConversationAppendedResponse {
  ok: boolean;
  kind: "conversation_appended";
  conversation_id: string;
  messages: ConversationHistoryMessage[];
}
export interface StopTurnResultResponse {
  ok: boolean;
  kind: "stop_turn_result";
  conversation_id: string;
  stopped: boolean;
}
export interface SubscriptionResultResponse {
  ok: boolean;
  kind: "subscription_result";
  conversation_id: string;
  status: "subscribed" | "unsubscribed";
}
export interface TurnResultResponse {
  ok: boolean;
  kind: "turn_result";
  conversation_id: string;
  output_text?: string;
  finish_reason?: string;
  usage?: TurnUsage;
  approval?: ApprovalRequiredTurn;
}
export interface ConversationHistoryPageResultResponse {
  ok: boolean;
  kind: "conversation_history_page_result";
  conversation_id: string;
  messages: ConversationHistoryMessage[];
  has_more: boolean;
  next_before?: string;
}
export interface PongResponse {
  ok: boolean;
  kind: "pong";
}
export interface ErrorResponse {
  ok: false;
  kind: string; // error 帧 kind 非字面量;落 dispatch default 分支
  conversation_id?: string;
  error: string; // 字段名是 error,不是 message
}

export type ServerMessage =
  | WsStreamEvent
  | TurnSnapshotResponse
  | ConversationAppendedResponse
  | StopTurnResultResponse
  | SubscriptionResultResponse
  | TurnResultResponse
  | ConversationHistoryPageResultResponse
  | PongResponse
  | ErrorResponse;
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过(此文件无外部依赖)。

- [ ] **Step 3: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/types.ts
git commit -m "feat(chat): 协议类型手抄子集(Message + WS 帧 + REST DTO)"
```

---

## Task 3: `render/thinking.ts` —— thinking 合并(原样移植)

**Files:**
- Create: `modules/chat/src/render/thinking.ts`
- Test: `modules/chat/src/render/__tests__/thinking.test.ts`

源:agent-ui `src/lib/thinking.ts`。唯一改动:`@/types/message` → `../types`。

- [ ] **Step 1: 建 `modules/chat/src/render/thinking.ts`**

```ts
// 把一组 ThinkingMessage 合并成单个 { text, streaming }。
// 移植自 agent-ui src/lib/thinking.ts(仅改 import 路径)。
// 算法:按序拼接非空 content(\n\n 连接);任一 pending 则 streaming=true;全空返回 null。

import type { ThinkingMessage } from "../types";

export function mergeThinking(
  messages: ThinkingMessage[],
): { text: string; streaming: boolean } | null {
  if (messages.length === 0) return null;

  const parts: string[] = [];
  let streaming = false;

  for (const msg of messages) {
    const trimmed = msg.content.trim();
    if (trimmed) parts.push(trimmed);
    if (msg.pending === true) streaming = true;
  }

  if (parts.length === 0) return null;

  return {
    text: parts.join("\n\n"),
    streaming,
  };
}
```

- [ ] **Step 2: 建 `modules/chat/src/render/__tests__/thinking.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mergeThinking } from "../thinking";
import type { ThinkingMessage } from "../../types";

function think(content: string, pending = false): ThinkingMessage {
  return { messageId: "t", conversationId: "c", role: "thinking", content, pending };
}

describe("mergeThinking", () => {
  it("空数组返回 null", () => {
    expect(mergeThinking([])).toBeNull();
  });

  it("全空白 content 返回 null", () => {
    expect(mergeThinking([think("  "), think("\n")])).toBeNull();
  });

  it("拼接非空 content,\\n\\n 连接", () => {
    expect(mergeThinking([think("a"), think(""), think("b")])).toEqual({
      text: "a\n\nb",
      streaming: false,
    });
  });

  it("任一 pending → streaming=true", () => {
    expect(mergeThinking([think("a"), think("b", true)])?.streaming).toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `pnpm -F @boundary-desktop/module-chat test`
Expected: thinking.test.ts 4 passed。

- [ ] **Step 4: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/render/thinking.ts modules/chat/src/render/__tests__/thinking.test.ts
git commit -m "feat(chat): 移植 thinking 合并"
```

---

## Task 4: `render/tool.ts` —— tool 卡合并(原样移植)

**Files:**
- Create: `modules/chat/src/render/tool.ts`
- Test: `modules/chat/src/render/__tests__/tool.test.ts`

源:agent-ui `src/lib/tool-cards.ts`。唯一改动:`@/types/message` → `../types`。

- [ ] **Step 1: 建 `modules/chat/src/render/tool.ts`**

```ts
// ToolMessage + ToolResultMessage 按 toolCallId 配对成 ToolCard[]。
// 移植自 agent-ui src/lib/tool-cards.ts(仅改 import 路径)。

import type { ToolMessage, ToolResultMessage } from "../types";

export interface ToolCard {
  id: string; // = toolCallId(或 ToolMessage.messageId 兜底)
  name: string; // = toolName
  inputText: string; // = stringify(toolArguments) 或 ToolMessage.content
  outputText: string | undefined; // = 配对 ToolResultMessage.content;未配对为 undefined
  isError: boolean;
}

export const PREVIEW_MAX_LINES = 2;
export const PREVIEW_MAX_CHARS = 100;
export const TOOL_INLINE_THRESHOLD = 240;

function serializeInput(msg: ToolMessage): string {
  if (msg.toolArguments !== undefined && msg.toolArguments !== null) {
    if (typeof msg.toolArguments === "string") return msg.toolArguments;
    try {
      return JSON.stringify(msg.toolArguments, null, 2);
    } catch {
      return Object.prototype.toString.call(msg.toolArguments);
    }
  }
  return msg.content;
}

export function isToolOutputError(text: string | undefined): boolean {
  const trimmed = text?.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const status = (parsed as { status?: unknown }).status;
    if (typeof status === "string" && status.toLowerCase() === "error") return true;
    return "error" in (parsed as object);
  } catch {
    return false;
  }
}

function isResultError(result: ToolResultMessage): boolean {
  return isToolOutputError(result.content);
}

export function mergeToolMessages(
  calls: ToolMessage[],
  results: ToolResultMessage[],
): ToolCard[] {
  const resultsByCallId = new Map<string, ToolResultMessage[]>();
  const usedResultIds = new Set<string>();

  for (const result of results) {
    const callId = result.toolCallId;
    if (callId) {
      const existing = resultsByCallId.get(callId);
      if (existing) {
        existing.push(result);
      } else {
        resultsByCallId.set(callId, [result]);
      }
    }
  }

  const cards: ToolCard[] = [];

  for (const call of calls) {
    const callId = call.toolCallId;
    let paired: ToolResultMessage | undefined;

    if (callId) {
      const bucket = resultsByCallId.get(callId);
      if (bucket && bucket.length > 0) {
        paired = bucket.find((r) => !usedResultIds.has(r.messageId));
        if (paired) usedResultIds.add(paired.messageId);
      }
    }

    cards.push({
      id: callId ?? call.messageId,
      name: call.toolName ?? "tool",
      inputText: serializeInput(call),
      outputText: paired?.content,
      isError: paired ? isResultError(paired) : false,
    });
  }

  for (const result of results) {
    if (usedResultIds.has(result.messageId)) continue;
    const callId = result.toolCallId;
    if (callId && usedResultIds.has(result.messageId)) continue;

    cards.push({
      id: callId ?? result.messageId,
      name: result.toolName ?? "tool",
      inputText: "",
      outputText: result.content,
      isError: isResultError(result),
    });
  }

  return cards;
}

export function getTruncatedPreview(text: string): string {
  const allLines = text.split("\n");
  const lines = allLines.slice(0, PREVIEW_MAX_LINES);
  const preview = lines.join("\n");
  if (preview.length > PREVIEW_MAX_CHARS) {
    return preview.slice(0, PREVIEW_MAX_CHARS) + "…";
  }
  return lines.length < allLines.length ? preview + "…" : preview;
}
```

> 注:源文件里的 `formatToolOutputForSidebar` 属右侧抽屉(MVP 外)依赖,不搬。

- [ ] **Step 2: 建 `modules/chat/src/render/__tests__/tool.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mergeToolMessages, isToolOutputError } from "../tool";
import type { ToolMessage, ToolResultMessage } from "../../types";

function call(id: string, callId: string, name = "search", args: unknown = { q: "x" }): ToolMessage {
  return {
    messageId: id,
    conversationId: "c",
    role: "tool",
    content: "",
    toolCallId: callId,
    toolName: name,
    toolArguments: args,
  };
}
function result(id: string, callId: string, content: string): ToolResultMessage {
  return {
    messageId: id,
    conversationId: "c",
    role: "tool_result",
    content,
    toolCallId: callId,
    toolName: "search",
  };
}

describe("mergeToolMessages", () => {
  it("按 toolCallId 配对 call + result", () => {
    const cards = mergeToolMessages([call("m1", "tc1")], [result("m2", "tc1", "ok")]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ id: "tc1", name: "search", outputText: "ok", isError: false });
    expect(cards[0].inputText).toContain('"q"');
  });

  it("未配对 call → outputText undefined", () => {
    const cards = mergeToolMessages([call("m1", "tc1")], []);
    expect(cards[0].outputText).toBeUndefined();
  });

  it("未配对 result 追加在末尾", () => {
    const cards = mergeToolMessages([call("m1", "tc1")], [result("m9", "tcX", "orphan")]);
    expect(cards).toHaveLength(2);
    expect(cards[1].outputText).toBe("orphan");
    expect(cards[1].inputText).toBe("");
  });

  it("result 含 status:error → isError=true", () => {
    const cards = mergeToolMessages([call("m1", "tc1")], [result("m2", "tc1", '{"status":"error"}')]);
    expect(cards[0].isError).toBe(true);
  });
});

describe("isToolOutputError", () => {
  it("纯文本非错误", () => {
    expect(isToolOutputError("hello")).toBe(false);
  });
  it("JSON 带 error 键判错误", () => {
    expect(isToolOutputError('{"error":"boom"}')).toBe(true);
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `pnpm -F @boundary-desktop/module-chat test`
Expected: tool.test.ts 6 passed(thinking 仍 4 passed)。

- [ ] **Step 4: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/render/tool.ts modules/chat/src/render/__tests__/tool.test.ts
git commit -m "feat(chat): 移植 tool 卡合并"
```

---

## Task 5: `render/units.ts` —— turn 分组状态机(原样移植)

**Files:**
- Create: `modules/chat/src/render/units.ts`
- Test: `modules/chat/src/render/__tests__/units.test.ts`

源:agent-ui `src/lib/render-units.ts`。改动:`@/types/message` → `../types`、`@/lib/tool-cards` → `./tool`、`@/lib/thinking` → `./thinking`。

- [ ] **Step 1: 建 `modules/chat/src/render/units.ts`**

```ts
// Message[] → RenderUnit[] 的 turn 分组状态机。
// 移植自 agent-ui src/lib/render-units.ts(仅改 import 路径)。
// 算法:遇 user flush 当前 turn 并起新 turn;thinking/tool/tool_result/assistant 累积;末尾 flush。
// edge-case 10:mergeThinking 全空返回 null,但若有 pending thinking 则合成 { text:'', streaming:true }
//   让流式 UI 在内容到达前先显示"正在思考"。

import type {
  Message,
  UserMessage,
  AssistantMessage,
  ThinkingMessage,
  ToolMessage,
  ToolResultMessage,
} from "../types";
import { mergeToolMessages, type ToolCard } from "./tool";
import { mergeThinking } from "./thinking";

export interface UserUnit {
  kind: "user";
  key: string;
  message: UserMessage;
}

export interface AssistantTurnUnit {
  kind: "assistant-turn";
  key: string;
  thinking: { text: string; streaming: boolean } | null;
  tools: ToolCard[];
  text: string;
  finalAssistant: AssistantMessage | null;
  streaming: boolean;
  cancelled: boolean;
  errorMessage?: string;
}

export interface SystemUnit {
  kind: "system";
  key: string;
  text: string;
}

export type RenderUnit = UserUnit | AssistantTurnUnit | SystemUnit;

interface TurnAccumulator {
  thinkingMsgs: ThinkingMessage[];
  toolMsgs: ToolMessage[];
  toolResultMsgs: ToolResultMessage[];
  finalAssistant: AssistantMessage | null;
  firstId: string | null;
}

function emptyAccumulator(): TurnAccumulator {
  return {
    thinkingMsgs: [],
    toolMsgs: [],
    toolResultMsgs: [],
    finalAssistant: null,
    firstId: null,
  };
}

function recordFirstId(acc: TurnAccumulator, id: string): void {
  if (acc.firstId === null) acc.firstId = id;
}

function flushTurn(acc: TurnAccumulator): AssistantTurnUnit | null {
  const { thinkingMsgs, toolMsgs, toolResultMsgs, finalAssistant, firstId } = acc;

  if (
    thinkingMsgs.length === 0 &&
    toolMsgs.length === 0 &&
    toolResultMsgs.length === 0 &&
    finalAssistant === null
  ) {
    return null;
  }

  const key =
    firstId ??
    finalAssistant?.messageId ??
    toolMsgs[0]?.messageId ??
    toolResultMsgs[0]?.messageId ??
    "__unknown__";

  let thinking = mergeThinking(thinkingMsgs);
  if (thinking === null && thinkingMsgs.some((m) => m.pending === true)) {
    thinking = { text: "", streaming: true };
  }

  const tools: ToolCard[] = mergeToolMessages(toolMsgs, toolResultMsgs);

  const text = finalAssistant?.content ?? "";

  const streaming =
    finalAssistant?.pending === true ||
    thinkingMsgs.some((m) => m.pending === true) ||
    toolMsgs.some((m) => m.pending === true);

  const cancelled =
    finalAssistant?.cancelled === true ||
    (finalAssistant === null && toolMsgs[0]?.cancelled === true);

  return {
    kind: "assistant-turn",
    key,
    thinking,
    tools,
    text,
    finalAssistant,
    streaming,
    cancelled,
  };
}

export function buildRenderUnits(messages: Message[]): RenderUnit[] {
  const units: RenderUnit[] = [];
  let acc = emptyAccumulator();

  for (const msg of messages) {
    switch (msg.role) {
      case "user": {
        const turn = flushTurn(acc);
        if (turn) units.push(turn);
        acc = emptyAccumulator();

        units.push({
          kind: "user",
          key: msg.messageId,
          message: msg,
        });
        break;
      }

      case "thinking": {
        recordFirstId(acc, msg.messageId);
        acc.thinkingMsgs.push(msg);
        break;
      }

      case "tool": {
        recordFirstId(acc, msg.messageId);
        acc.toolMsgs.push(msg);
        break;
      }

      case "tool_result": {
        recordFirstId(acc, msg.messageId);
        acc.toolResultMsgs.push(msg);
        break;
      }

      case "assistant": {
        recordFirstId(acc, msg.messageId);
        acc.finalAssistant = msg;
        break;
      }
    }
  }

  const lastTurn = flushTurn(acc);
  if (lastTurn) units.push(lastTurn);

  return units;
}
```

- [ ] **Step 2: 建 `modules/chat/src/render/__tests__/units.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { buildRenderUnits, type AssistantTurnUnit } from "../units";
import type { Message } from "../../types";

let n = 0;
function id(): string {
  return `m${n++}`;
}
function user(content: string): Message {
  return { messageId: id(), conversationId: "c", role: "user", content };
}
function assistant(content: string, pending = false): Message {
  return { messageId: id(), conversationId: "c", role: "assistant", content, pending };
}
function thinking(content: string, pending = false): Message {
  return { messageId: id(), conversationId: "c", role: "thinking", content, pending };
}
function tool(callId: string): Message {
  return {
    messageId: id(),
    conversationId: "c",
    role: "tool",
    content: "",
    toolCallId: callId,
    toolName: "search",
  };
}

describe("buildRenderUnits", () => {
  it("空输入 → 空数组", () => {
    expect(buildRenderUnits([])).toEqual([]);
  });

  it("user + assistant → 两个 unit", () => {
    const units = buildRenderUnits([user("hi"), assistant("hello")]);
    expect(units.map((u) => u.kind)).toEqual(["user", "assistant-turn"]);
    expect((units[1] as AssistantTurnUnit).text).toBe("hello");
  });

  it("第二个 user flush 前一个 turn", () => {
    const units = buildRenderUnits([user("a"), assistant("1"), user("b"), assistant("2")]);
    expect(units.map((u) => u.kind)).toEqual(["user", "assistant-turn", "user", "assistant-turn"]);
  });

  it("pending assistant → streaming=true", () => {
    const units = buildRenderUnits([user("a"), assistant("partial", true)]);
    expect((units[1] as AssistantTurnUnit).streaming).toBe(true);
  });

  it("thinking + tool 归入同一 assistant-turn", () => {
    const units = buildRenderUnits([user("a"), thinking("想一下"), tool("tc1"), assistant("答")]);
    expect(units).toHaveLength(2);
    const turn = units[1] as AssistantTurnUnit;
    expect(turn.thinking?.text).toBe("想一下");
    expect(turn.tools).toHaveLength(1);
    expect(turn.text).toBe("答");
  });

  it("edge-case 10:thinking 内容空但 pending → 合成 streaming 指示", () => {
    const units = buildRenderUnits([user("a"), thinking("", true)]);
    const turn = units[1] as AssistantTurnUnit;
    expect(turn.thinking).toEqual({ text: "", streaming: true });
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `pnpm -F @boundary-desktop/module-chat test`
Expected: units.test.ts 6 passed。

- [ ] **Step 4: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/render/units.ts modules/chat/src/render/__tests__/units.test.ts
git commit -m "feat(chat): 移植 turn 分组状态机 render-units"
```

---

## Task 6: `render/markdown.ts` —— marked + DOMPurify(原样移植)

**Files:**
- Create: `modules/chat/src/render/markdown.ts`
- Test: `modules/chat/src/render/__tests__/markdown.test.ts`

源:agent-ui `src/lib/markdown.ts`。无 `@/` 依赖,**逐字搬**(只依赖 marked / dompurify)。代码块复制按钮包裹(`.oc-code-block` / `.oc-code-copy`)保留,点击委托由 `ui/line.tsx` 处理(Task 14)。

- [ ] **Step 1: 建 `modules/chat/src/render/markdown.ts`**

```ts
// 把 assistant 文本渲染成经 DOMPurify 清洗的 HTML。
// 移植自 agent-ui src/lib/markdown.ts(逐字搬:仅依赖 marked + dompurify,无内部依赖)。
// 去掉 highlight.js:代码块呈等宽无高亮。

import DOMPurify from "dompurify";
import { marked, Renderer } from "marked";

marked.setOptions({
  gfm: true,
  breaks: true,
});

// 代码块右上角复制按钮:基底渲染器产出 <pre><code>,再包 .oc-code-block(含 .oc-code-copy 按钮)。
// 点击行为由 ui/line.tsx 事件委托处理;此处只产出静态 HTML。仅覆盖块级 code。
// 按钮内不放内容(DOMPurify html profile 不含 svg);图标由 CSS mask 画,aria-label 兜无障碍。
const baseRenderer = new Renderer();

marked.use({
  renderer: {
    code(token) {
      const inner = baseRenderer.code(token);
      return `<div class="oc-code-block"><button class="oc-code-copy" type="button" aria-label="复制代码"></button>${inner}</div>`;
    },
  },
});

// 图片安全:仅放行 https:// 与内联 data:image/...。阻断 http:// 追踪像素与协议注入。
const SAFE_IMG_SRC = /^(https:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml|avif);)/i;
const SAFE_EXTERNAL_HREF = /^(https?:|mailto:)/i;

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "src" && _node.nodeName === "IMG") {
    if (!SAFE_IMG_SRC.test(data.attrValue)) data.keepAttr = false;
  }
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A") {
    const el = node as Element;
    const href = el.getAttribute("href") ?? "";
    if (SAFE_EXTERNAL_HREF.test(href)) {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
      el.setAttribute("referrerpolicy", "no-referrer");
    } else if (href && !href.startsWith("#")) {
      el.removeAttribute("href");
    }
    return;
  }

  if (node.nodeName !== "IMG") return;
  const el = node as Element;
  if (!el.getAttribute("src")) {
    el.parentNode?.removeChild(el);
    return;
  }
  el.setAttribute("loading", "lazy");
  el.setAttribute("decoding", "async");
  el.setAttribute("referrerpolicy", "no-referrer");
});

export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "loading", "decoding", "referrerpolicy"],
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}

export function renderMarkdownInline(text: string): string {
  const raw = marked.parseInline(text, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "loading", "decoding", "referrerpolicy"],
    RETURN_TRUSTED_TYPE: false,
  }) as string;
}
```

- [ ] **Step 2: 建 `modules/chat/src/render/__tests__/markdown.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../markdown";

describe("renderMarkdown sanitize", () => {
  it("渲染基础 markdown", () => {
    const html = renderMarkdown("**bold** and `code`");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("剥离 <script>", () => {
    const html = renderMarkdown("hi<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(1)");
  });

  it("javascript: 链接被移除 href", () => {
    const html = renderMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });

  it("https 外链加 target/rel", () => {
    const html = renderMarkdown("[x](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("http 图片被剥 src 后移除", () => {
    const html = renderMarkdown("![a](http://tracker.test/p.gif)");
    expect(html).not.toContain("tracker.test");
  });

  it("代码块包 .oc-code-block 复制按钮", () => {
    const html = renderMarkdown("```\nconst x = 1\n```");
    expect(html).toContain("oc-code-block");
    expect(html).toContain("oc-code-copy");
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `pnpm -F @boundary-desktop/module-chat test`
Expected: markdown.test.ts 6 passed。

- [ ] **Step 4: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/render/markdown.ts modules/chat/src/render/__tests__/markdown.test.ts
git commit -m "feat(chat): 移植 markdown 渲染(marked + DOMPurify)"
```

---

## Task 7: `state/conversation.ts` —— 会话列表 + currentId(新写)

**Files:**
- Create: `modules/chat/src/state/conversation.ts`

裁剪版:只保留 MVP 需要的 `conversations` / `currentId` 与增删改。无置顶 / 排序 / 未读。`stream.ts` 的选择器依赖本 store 的 `currentId`,故先建。

- [ ] **Step 1: 建 `modules/chat/src/state/conversation.ts`**

```ts
import { create } from "zustand";

export interface Conversation {
  id: string;
  name?: string;
  lastTurnAt: string | null;
}

interface ConversationStoreState {
  conversations: Conversation[];
  currentId: string | null;
  setConversations(list: Conversation[]): void;
  setCurrentId(id: string | null): void;
  upsert(conv: Conversation): void;
  remove(id: string): void;
}

export const useConversationStore = create<ConversationStoreState>((set) => ({
  conversations: [],
  currentId: null,
  setConversations: (list) => set({ conversations: list }),
  setCurrentId: (id) => set({ currentId: id }),
  upsert: (conv) =>
    set((s) => {
      const i = s.conversations.findIndex((c) => c.id === conv.id);
      if (i >= 0) {
        const next = s.conversations.slice();
        next[i] = conv;
        return { conversations: next };
      }
      return { conversations: [conv, ...s.conversations] };
    }),
  remove: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      currentId: s.currentId === id ? null : s.currentId,
    })),
}));
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/state/conversation.ts
git commit -m "feat(chat): 会话列表 + currentId store"
```

---

## Task 8: `state/stream.ts` —— 流式状态机(移植 + 裁剪)

**Files:**
- Create: `modules/chat/src/state/stream.ts`
- Test: `modules/chat/src/state/__tests__/stream.test.ts`

源:agent-ui `src/stores/conversation-stream.store.ts`。**裁剪:** 去掉 `setMessages`(F7 throw)/ `setSending` / `setError` / `clearAll` / `setConvAgentInstanceId` 与 `agentInstanceId` 字段;`@/lib/uuid` → `crypto.randomUUID()`;删 `registerStoreReset` import+调用;`./conversation.store` → `./conversation`;`@/protocol/types`+`@/types/message` → `../types`;删底部 message 类型 re-export。**保留** 全部 reducer 与内部 mutator 语义不变。

- [ ] **Step 1: 建 `modules/chat/src/state/stream.ts`**

```ts
// 单 store 流式状态机:apply* reducers。
// 移植自 agent-ui src/stores/conversation-stream.store.ts(裁剪 agentInstanceId / store-reset,
// uuid 改 crypto.randomUUID,import 改相对;reducer 与内部 mutator 语义不变)。
// 依赖 zustand immer middleware:mutable 写法产出 immutable 结果。

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  ConversationHistoryMessage,
  TurnCompletedEvent,
  TurnSnapshotResponse,
  WsStreamEvent,
  Message,
  MessageRole,
  BaseMessage,
  UserMessage,
  AssistantMessage,
  ThinkingMessage,
  ToolMessage,
  ToolResultMessage,
} from "../types";
import { useConversationStore } from "./conversation";

// ─── Store state shape ────────────────────────────────────────────────────────

/** Public per-conv view(UI 渲染读这个）*/
export interface ConvStreamState {
  messages: Message[];
  sending: boolean;
  /** snapshot.state 映射;'streaming' | 'tool_running' | null */
  inFlightState: string | null;
  /** 错误 banner 文本(per-conv;MVP 错误走 ctx.notify,本字段仅内部记录)*/
  error: string | null;
}

/** Internal per-conv(额外 streaming scratch 字段,单元测试可见)*/
export interface ConvStreamInternal extends ConvStreamState {
  /** output_delta 累积;turn_completed 时清空 */
  streamBuffer: string;
  /** turn_started 时 arm,conversation_appended / turn_completed 时清——见 D-5 */
  skipNextAppend: boolean;
}

function initialConvStreamInternal(): ConvStreamInternal {
  return {
    messages: [],
    sending: false,
    inFlightState: null,
    error: null,
    streamBuffer: "",
    skipNextAppend: false,
  };
}

export interface ConvStreamStoreState {
  byConversation: Record<string, ConvStreamInternal>;

  // —— Hydration / 编排 actions ——
  seedHistory(convId: string, messages: Message[]): void;
  prependHistory(convId: string, older: Message[]): void;
  appendLocal(convId: string, message: Message): void;
  clearByConversation(convId: string): void;

  // —— Wire frame reducer actions(ws 帧 dispatch 调）——
  applyTurnStarted(convId: string): void;
  applyOutputDelta(convId: string, text: string): void;
  applyReasoningDelta(convId: string, text: string): void;
  applyToolCall(convId: string, payload: { id: string; name: string; arguments: unknown }): void;
  applyToolResult(
    convId: string,
    payload: { tool_call_id: string; tool_name: string; content: string },
  ): void;
  applyTurnCompleted(convId: string, msg: TurnCompletedEvent): void;
  applyConversationAppended(convId: string, wireMessages: ConversationHistoryMessage[]): void;
  applySnapshot(convId: string, snapshot: TurnSnapshotResponse): void;
  /** turn_completed{ok:false} 走 applyTurnCompleted;不带 turn 上下文的 error 帧走这条 */
  applyErrorFrame(convId: string, error: string): void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useConvStreamStore = create<ConvStreamStoreState>()(
  immer((set) => ({
    byConversation: {},

    seedHistory: (convId, messages) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.messages = messages;
        conv.sending = false;
        conv.inFlightState = null;
        conv.streamBuffer = "";
        conv.skipNextAppend = false;
        conv.error = null;
      }),

    prependHistory: (convId, older) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.messages = [...older, ...conv.messages];
      }),

    appendLocal: (convId, message) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.messages.push(message);
      }),

    clearByConversation: (convId) =>
      set((s) => {
        delete s.byConversation[convId];
      }),

    applyTurnStarted: (convId) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.sending = true;
        conv.inFlightState = conv.inFlightState ?? "streaming";
        conv.error = null;
        conv.skipNextAppend = true;
      }),

    applyOutputDelta: (convId, text) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        applyOutputDeltaMut(conv, text, convId);
      }),

    applyReasoningDelta: (convId, text) =>
      set((s) => {
        if (!text) return;
        const conv = ensureConv(s.byConversation, convId);
        appendReasoningDeltaMut(conv.messages, text, convId);
      }),

    applyToolCall: (convId, call) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        applyToolCallMut(conv, call, convId);
      }),

    applyToolResult: (convId, payload) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        applyToolResultMut(conv, payload, convId);
      }),

    /**
     * 找最后一条 assistant message → pending=false + 写 finalText/usage/cancelled/approval;
     * 没找到且有内容 → 新建一条 assistant;清 streamBuffer/sending/inFlightState;
     * 无条件清 skipNextAppend(D-5);!ok && error && !approval 时写错误 banner。
     */
    applyTurnCompleted: (convId, completed) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        const finalText = completed.output_text ?? conv.streamBuffer ?? "";
        const finalTimestamp = new Date().toISOString();
        const cancelled = completed.finish_reason === "cancelled";

        sealThinkingMut(conv.messages);

        let lastAiIdx = -1;
        for (let i = conv.messages.length - 1; i >= 0; i--) {
          const r = conv.messages[i].role;
          if (r === "user") break;
          if (r === "assistant") {
            lastAiIdx = i;
            break;
          }
        }

        if (lastAiIdx >= 0) {
          const target = conv.messages[lastAiIdx] as AssistantMessage;
          target.content = target.pending
            ? finalText
            : target.content && target.content.length > 0
              ? target.content
              : finalText;
          target.timestamp = target.timestamp ?? finalTimestamp;
          target.pending = false;
          target.cancelled = cancelled || target.cancelled;
          if (completed.usage) target.usage = completed.usage;
          if (completed.approval) target.approval = completed.approval;
        } else if (finalText.length > 0 || completed.usage || completed.approval) {
          conv.messages.push({
            messageId: generatePendingId(),
            conversationId: convId,
            role: "assistant",
            content: finalText,
            timestamp: finalTimestamp,
            pending: false,
            cancelled,
            usage: completed.usage,
            approval: completed.approval,
          });
        }

        conv.streamBuffer = "";
        conv.sending = false;
        conv.inFlightState = null;
        conv.skipNextAppend = false;
        if (!completed.ok && completed.error && !completed.approval) {
          conv.error = completed.error;
        }
      }),

    /**
     * skipNextAppend=true 时整批 drop(turn_started arm 的 echo dedupe);
     * 否则 dropTrailingPending + 追加 historyMessageToLocal 转换后的消息。
     * 兼任 turn 结束副作用:清 streamBuffer + sending=false + inFlightState=null。
     */
    applyConversationAppended: (convId, wireMessages) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        if (conv.skipNextAppend) {
          conv.skipNextAppend = false;
          return;
        }
        dropTrailingPendingMut(conv.messages);
        for (const m of wireMessages) {
          conv.messages.push(historyMessageToLocal(m, convId));
        }
        conv.streamBuffer = "";
        conv.sending = false;
        conv.inFlightState = null;
      }),

    /**
     * subscribe in-flight turn 时服务端 push 的 turn-so-far 快照。
     * 重 reduce:dropTrailingPending + 重放 events;streamBuffer 进 reduce 前清空(R-1)。
     * arm skipNextAppend=true(re-subscribe 路径也要 dedupe echo)。events 可能 undefined,用 ?? []。
     */
    applySnapshot: (convId, snapshot) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.streamBuffer = "";
        dropTrailingPendingMut(conv.messages);
        conv.sending = true;
        conv.inFlightState = snapshot.state ?? "streaming";

        const events = snapshot.events ?? [];
        for (const event of events) {
          reduceEventInPlace(conv, event, convId);
        }

        conv.sending = true;
        conv.inFlightState = snapshot.state ?? "streaming";
        conv.skipNextAppend = true;
      }),

    applyErrorFrame: (convId, error) =>
      set((s) => {
        const conv = ensureConv(s.byConversation, convId);
        conv.sending = false;
        conv.inFlightState = null;
        conv.error = error;
        dropTrailingPendingMut(conv.messages);
      }),
  })),
);

// ─── Internal helpers(不导出)────────────────────────────────────────────────

function ensureConv(
  byConversation: Record<string, ConvStreamInternal>,
  convId: string,
): ConvStreamInternal {
  if (!byConversation[convId]) {
    byConversation[convId] = initialConvStreamInternal();
  }
  return byConversation[convId];
}

/** `pending-${crypto.randomUUID()}` */
export function generatePendingId(): string {
  return `pending-${crypto.randomUUID()}`;
}

/** 把数组里所有 pending thinking message 封口(必须遍历全数组,thinking 可能不在末尾)。 */
function sealThinkingMut(messages: Message[]): void {
  for (const m of messages) {
    if (m.role === "thinking" && m.pending) {
      m.pending = false;
    }
  }
}

/** 把末尾 pending assistant message 封口。 */
function finalizePendingAiMut(messages: Message[]): void {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.pending) {
    last.pending = false;
  }
}

/** 移除末尾所有 pending=true 消息。 */
export function dropTrailingPendingMut(messages: Message[]): void {
  while (messages.length > 0 && messages[messages.length - 1].pending) {
    messages.pop();
  }
}

/** tool content 可能是对象,序列化成字符串。 */
function stringifyToolContent(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

/** 单条 history wire 消息 → store Message。 */
export function historyMessageToLocal(m: ConversationHistoryMessage, convId: string): Message {
  const { cursor, role, content, timestamp, references, usage, tool_call_id, tool_name, tool_arguments, cancelled } = m;

  const base: BaseMessage = {
    messageId: cursor,
    conversationId: convId,
    role: role as MessageRole,
    content,
    timestamp,
    references: references ?? [],
    pending: false,
  };

  switch (role) {
    case "user":
      return { ...base, role: "user" } as UserMessage;
    case "assistant":
      return { ...base, role: "assistant", cancelled, usage } as AssistantMessage;
    case "thinking":
      return { ...base, role: "thinking" } as ThinkingMessage;
    case "tool":
      return {
        ...base,
        role: "tool",
        toolCallId: tool_call_id,
        toolName: tool_name,
        toolArguments: tool_arguments,
        cancelled,
        usage,
      } as ToolMessage;
    case "tool_result":
      return { ...base, role: "tool_result", toolCallId: tool_call_id, toolName: tool_name } as ToolResultMessage;
    default:
      return { ...base, role: "assistant" } as AssistantMessage;
  }
}

/** output_delta / snapshot replay 共用:累加 streamBuffer,写或更新末尾 pending assistant。 */
function applyOutputDeltaMut(conv: ConvStreamInternal, text: string, convId: string): void {
  conv.streamBuffer += text;
  const last = conv.messages[conv.messages.length - 1];
  if (last?.role === "assistant" && last.pending) {
    last.content = conv.streamBuffer;
  } else {
    conv.messages.push({
      messageId: generatePendingId(),
      conversationId: convId,
      role: "assistant",
      content: conv.streamBuffer,
      pending: true,
      timestamp: new Date().toISOString(),
    });
  }
  conv.inFlightState = "streaming";
  conv.sending = true;
}

/** tool_call / snapshot replay 共用:finalize 末尾 ai + seal thinking + push tool + 清 streamBuffer。 */
function applyToolCallMut(
  conv: ConvStreamInternal,
  call: { id: string; name: string; arguments: unknown },
  convId: string,
): void {
  conv.streamBuffer = "";
  finalizePendingAiMut(conv.messages);
  sealThinkingMut(conv.messages);
  conv.messages.push({
    messageId: generatePendingId(),
    conversationId: convId,
    role: "tool",
    content: "",
    toolCallId: call.id,
    toolName: call.name,
    toolArguments: call.arguments,
    timestamp: new Date().toISOString(),
  });
  conv.inFlightState = "tool_running";
}

/** tool_result / snapshot replay 共用:finalize 末尾 ai + seal thinking + push tool_result。 */
function applyToolResultMut(
  conv: ConvStreamInternal,
  payload: { tool_call_id: string; tool_name: string; content: string },
  convId: string,
): void {
  finalizePendingAiMut(conv.messages);
  sealThinkingMut(conv.messages);
  conv.messages.push({
    messageId: generatePendingId(),
    conversationId: convId,
    role: "tool_result",
    content: stringifyToolContent(payload.content),
    toolCallId: payload.tool_call_id,
    toolName: payload.tool_name,
    timestamp: new Date().toISOString(),
  });
  conv.inFlightState = "streaming";
}

/** snapshot.events 重放派发器(不处理 turn_started / turn_completed;未知类型 ignore)。 */
function reduceEventInPlace(conv: ConvStreamInternal, event: WsStreamEvent, convId: string): void {
  switch (event.kind) {
    case "output_delta":
      applyOutputDeltaMut(conv, event.output_text, convId);
      break;
    case "reasoning_delta":
      if (event.reasoning_text) {
        appendReasoningDeltaMut(conv.messages, event.reasoning_text, convId);
      }
      break;
    case "tool_call":
      applyToolCallMut(conv, event.tool_call, convId);
      break;
    case "tool_result":
      applyToolResultMut(conv, event.tool_result, convId);
      break;
    default:
      break;
  }
}

/** reasoning 累积:暂存末尾 pending assistant → 累积/新建 pending thinking → 放回 assistant。 */
function appendReasoningDeltaMut(messages: Message[], delta: string, convId: string): void {
  const last = messages[messages.length - 1];
  const pendingAi = last?.role === "assistant" && last.pending ? messages.pop() : null;

  const newLast = messages[messages.length - 1];
  if (newLast?.role === "thinking" && newLast.pending) {
    newLast.content += delta;
  } else {
    messages.push({
      messageId: generatePendingId(),
      conversationId: convId,
      role: "thinking",
      content: delta,
      pending: true,
      timestamp: new Date().toISOString(),
    });
  }

  if (pendingAi) messages.push(pendingAi);
}

// ─── Selectors / hooks ───────────────────────────────────────────────────────

export function useCurrentConvStream(): ConvStreamState | undefined {
  const currentId = useConversationStore((s) => s.currentId);
  return useConvStreamStore((s) => (currentId ? s.byConversation[currentId] : undefined));
}

export function useCurrentMessages(): Message[] {
  return useCurrentConvStream()?.messages ?? [];
}

export function useCurrentSending(): boolean {
  return useCurrentConvStream()?.sending ?? false;
}

export function byConversationHasEntry(id: string): boolean {
  return !!useConvStreamStore.getState().byConversation[id];
}
```

- [ ] **Step 2: 建 `modules/chat/src/state/__tests__/stream.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useConvStreamStore } from "../stream";
import type { TurnCompletedEvent } from "../../types";

function getConv(id: string) {
  return useConvStreamStore.getState().byConversation[id];
}
const store = () => useConvStreamStore.getState();

beforeEach(() => {
  useConvStreamStore.setState({ byConversation: {} });
});

describe("stream reducers", () => {
  it("seedHistory 整体替换并重置 scratch", () => {
    store().seedHistory("c", [
      { messageId: "m1", conversationId: "c", role: "user", content: "hi" },
    ]);
    expect(getConv("c").messages).toHaveLength(1);
    expect(getConv("c").sending).toBe(false);
    expect(getConv("c").streamBuffer).toBe("");
  });

  it("applyTurnStarted arm sending + skipNextAppend", () => {
    store().applyTurnStarted("c");
    expect(getConv("c").sending).toBe(true);
    expect(getConv("c").skipNextAppend).toBe(true);
  });

  it("applyOutputDelta 累加进末尾 pending assistant", () => {
    store().applyOutputDelta("c", "Hel");
    store().applyOutputDelta("c", "lo");
    const msgs = getConv("c").messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ role: "assistant", content: "Hello", pending: true });
  });

  it("applyReasoningDelta 累积进 pending thinking,且排在 pending assistant 前", () => {
    store().applyOutputDelta("c", "answer");
    store().applyReasoningDelta("c", "think...");
    const roles = getConv("c").messages.map((m) => m.role);
    expect(roles).toEqual(["thinking", "assistant"]);
  });

  it("applyToolCall finalize pending ai + push tool", () => {
    store().applyOutputDelta("c", "partial");
    store().applyToolCall("c", { id: "tc1", name: "search", arguments: {} });
    const msgs = getConv("c").messages;
    expect(msgs[0].pending).toBe(false); // assistant 封口
    expect(msgs[1]).toMatchObject({ role: "tool", toolCallId: "tc1" });
    expect(getConv("c").streamBuffer).toBe("");
  });

  it("applyTurnCompleted 封口末尾 assistant 并清终态", () => {
    store().applyTurnStarted("c");
    store().applyOutputDelta("c", "done");
    const completed: TurnCompletedEvent = {
      ok: true,
      kind: "turn_completed",
      conversation_id: "c",
    };
    store().applyTurnCompleted("c", completed);
    const conv = getConv("c");
    expect(conv.messages[0]).toMatchObject({ role: "assistant", content: "done", pending: false });
    expect(conv.sending).toBe(false);
    expect(conv.skipNextAppend).toBe(false);
    expect(conv.streamBuffer).toBe("");
  });

  it("applyTurnCompleted{cancelled} 标记 cancelled", () => {
    store().applyOutputDelta("c", "x");
    store().applyTurnCompleted("c", {
      ok: true,
      kind: "turn_completed",
      conversation_id: "c",
      finish_reason: "cancelled",
    });
    expect((getConv("c").messages[0] as { cancelled?: boolean }).cancelled).toBe(true);
  });

  it("applyConversationAppended skipNextAppend=true 时整批丢弃", () => {
    store().applyTurnStarted("c"); // arm skip
    store().applyConversationAppended("c", [
      { cursor: "x1", role: "user", content: "echo" },
    ]);
    expect(getConv("c").messages).toHaveLength(0);
    expect(getConv("c").skipNextAppend).toBe(false);
  });

  it("applyConversationAppended 未 arm 时追加并转换", () => {
    store().applyConversationAppended("c", [
      { cursor: "x1", role: "assistant", content: "hi" },
    ]);
    expect(getConv("c").messages[0]).toMatchObject({ messageId: "x1", role: "assistant", content: "hi" });
  });

  it("applyErrorFrame 删尾部 pending 并写 error 终态", () => {
    store().applyOutputDelta("c", "half"); // 产生 pending assistant
    store().applyErrorFrame("c", "boom");
    const conv = getConv("c");
    expect(conv.messages).toHaveLength(0);
    expect(conv.error).toBe("boom");
    expect(conv.sending).toBe(false);
  });
});
```

- [ ] **Step 3: 跑测试**

Run: `pnpm -F @boundary-desktop/module-chat test`
Expected: stream.test.ts 10 passed(全套累计 thinking 4 + tool 6 + units 6 + markdown 6 + stream 10）。

- [ ] **Step 4: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/state/stream.ts modules/chat/src/state/__tests__/stream.test.ts
git commit -m "feat(chat): 移植流式状态机 stream store"
```

---

## Task 9: `protocol/ws.ts` —— 浏览器 WebSocket(新写)

**Files:**
- Create: `modules/chat/src/protocol/ws.ts`

模块自连的 WebSocket:按 config 提供的 url 连接、**鉴权用 `ctx.auth.getToken()`**(经 query 携带,集中在 `buildUrl`)、断线指数退避重连、端点变化(worker 重启)时重连、未开前发帧先入队(参考 ws.ts:274 行为,避免首发丢失)、心跳 ping/pong(参考 25s/30s)。

- [ ] **Step 1: 建 `modules/chat/src/protocol/ws.ts`**

```ts
import type { WsClientRequest, ServerMessage } from "../types";

export interface ChatWsOptions {
  /** 当前 ws base,如 ws://127.0.0.1:PORT/ws;端点未就绪返回 null(稍后重试)。 */
  url(): string | null;
  /** 当前登录 token;每次连接前现取(刷新/吊销后即最新),登出为 null。 */
  token(): string | null;
  /** 入帧分发(交给 handlers 的 dispatcher);pong 在本类内消费,不外抛。 */
  onFrame(frame: ServerMessage): void;
  onOpen?(): void;
}

const MAX_BACKOFF_MS = 30_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 30_000;

/** 浏览器 WebSocket 不能设 Authorization 头:token 经 query 参数携带(鉴权用 ctx.auth.getToken())。
 *  待确认 worker /ws 接受 token 的线格式(query / Sec-WebSocket-Protocol / open 后首帧),
 *  以 worker 约定为准——改这里一处即可。 */
function buildUrl(base: string, token: string | null): string {
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

export class ChatWs {
  #opts: ChatWsOptions;
  #ws: WebSocket | null = null;
  #closedByUser = false;
  #attempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;
  #pongTimer: ReturnType<typeof setTimeout> | null = null;
  /** 未开连时的发送缓冲:open 后 flush(参考 ws.ts pendingPayloads,避免首发丢失)。 */
  #pending: WsClientRequest[] = [];

  constructor(opts: ChatWsOptions) {
    this.#opts = opts;
  }

  connect(): void {
    this.#closedByUser = false;
    this.#open();
  }

  #open(): void {
    const base = this.#opts.url();
    if (!base) {
      this.#scheduleReconnect(); // 端点未就绪,稍后重试
      return;
    }
    let ws: WebSocket;
    try {
      ws = new WebSocket(buildUrl(base, this.#opts.token()));
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;
    ws.onopen = () => {
      this.#attempt = 0;
      this.#flushPending();
      this.#startHeartbeat();
      this.#opts.onOpen?.();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let frame: ServerMessage;
      try {
        frame = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return; // 非 JSON 帧忽略
      }
      if (frame.kind === "pong") {
        this.#onPong();
        return;
      }
      this.#opts.onFrame(frame);
    };
    ws.onclose = () => {
      this.#clearHeartbeat();
      this.#ws = null;
      if (!this.#closedByUser) this.#scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws.close(); // 交给 onclose 接管重连
      } catch {
        /* already closing */
      }
    };
  }

  #scheduleReconnect(): void {
    if (this.#closedByUser || this.#reconnectTimer) return;
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.#attempt);
    this.#attempt++;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#open();
    }, delay);
  }

  /** 端点变化(worker 重启换端口)时调:断开旧连、重连新地址。 */
  reconnect(): void {
    this.#teardownSocket();
    this.#attempt = 0;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#open();
  }

  /** 发帧:未开连则入队,open 时 flush(参考行为,避免首条 turn 丢失)。 */
  send(req: WsClientRequest): void {
    const ws = this.#ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(req));
    } else {
      this.#pending.push(req);
    }
  }

  close(): void {
    this.#closedByUser = true;
    this.#pending = [];
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#teardownSocket();
  }

  #flushPending(): void {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const toSend = this.#pending.splice(0);
    for (const req of toSend) ws.send(JSON.stringify(req));
  }

  #startHeartbeat(): void {
    this.#clearHeartbeat();
    this.#pingTimer = setInterval(() => {
      this.send({ type: "ping" });
      // pong 超时 = 连接假死,强制 close → onclose 走重连
      this.#pongTimer = setTimeout(() => this.#ws?.close(), PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  #onPong(): void {
    if (this.#pongTimer) {
      clearTimeout(this.#pongTimer);
      this.#pongTimer = null;
    }
  }

  #clearHeartbeat(): void {
    if (this.#pingTimer) {
      clearInterval(this.#pingTimer);
      this.#pingTimer = null;
    }
    if (this.#pongTimer) {
      clearTimeout(this.#pongTimer);
      this.#pongTimer = null;
    }
  }

  #teardownSocket(): void {
    this.#clearHeartbeat();
    const ws = this.#ws;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* already closing */
    }
    this.#ws = null;
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/protocol/ws.ts
git commit -m "feat(chat): 浏览器 WebSocket 连接/重连/发帧"
```

---

## Task 10: `protocol/handlers.ts` —— 帧分发 + rAF 合批(移植 + 裁剪)

**Files:**
- Create: `modules/chat/src/protocol/handlers.ts`

源:agent-ui `src/protocol/ws-bridge-handlers.ts` + `delta-coalescer.ts`。**裁剪:** 剥 `session-read-state` / `running-sessions` / 未读追踪 / `ws-error-mapping` 分类 / `toast`(→ 传入的 `notify`)/ `unsubscribeIfNotCurrent`(MVP 切会话时显式退订,见 api 层);`delta-coalescer` 的 50ms `setInterval` 换成 `requestAnimationFrame` 轻量合批。导出工厂 `createFrameDispatcher(notify)` 返回 `dispatch(frame)`。

- [ ] **Step 1: 建 `modules/chat/src/protocol/handlers.ts`**

```ts
// WS 入帧 → stream store reducers 的映射 + rAF 合批。
// 移植自 agent-ui ws-bridge-handlers.ts + delta-coalescer.ts(剥辅助子系统;coalescer 换 rAF)。

import type { NotifyOptions } from "@boundary-desktop/contract";
import { useConvStreamStore } from "../state/stream";
import type { ServerMessage } from "../types";

type Notify = (opts: NotifyOptions) => void;

// ─── rAF 合批:高频 output_delta / reasoning_delta 攒到下一帧再写 store,避免逐帧 O(N²) 重渲 ──

interface DeltaBuf {
  output: string;
  reasoning: string;
}
const buffers = new Map<string, DeltaBuf>();
let rafHandle: number | null = null;

function getBuf(id: string): DeltaBuf {
  let b = buffers.get(id);
  if (!b) {
    b = { output: "", reasoning: "" };
    buffers.set(id, b);
  }
  return b;
}

function schedule(): void {
  if (rafHandle != null) return;
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    flushAll();
  });
}

function enqueueOutput(id: string, text: string): void {
  getBuf(id).output += text;
  schedule();
}

function enqueueReasoning(id: string, text: string): void {
  getBuf(id).reasoning += text;
  schedule();
}

/** 把某会话攒的 delta 落 store:reasoning 先于 output(保证 thinking 排在 assistant 前)。 */
function flushConv(id: string): void {
  const b = buffers.get(id);
  if (!b) return;
  buffers.delete(id);
  const store = useConvStreamStore.getState();
  if (b.reasoning) store.applyReasoningDelta(id, b.reasoning);
  if (b.output) store.applyOutputDelta(id, b.output);
}

function flushAll(): void {
  for (const id of [...buffers.keys()]) flushConv(id);
}

/** 丢弃某会话攒的 delta(error / snapshot 重放前,积压必须作废)。 */
function discardConv(id: string): void {
  buffers.delete(id);
}

// ─── dispatcher ───────────────────────────────────────────────────────────────

export function createFrameDispatcher(notify: Notify): (frame: ServerMessage) => void {
  return function dispatch(frame: ServerMessage): void {
    const store = useConvStreamStore.getState();
    switch (frame.kind) {
      case "turn_started":
        flushConv(frame.conversation_id);
        store.applyTurnStarted(frame.conversation_id);
        break;
      case "output_delta":
        enqueueOutput(frame.conversation_id, frame.output_text);
        break;
      case "reasoning_delta":
        enqueueReasoning(frame.conversation_id, frame.reasoning_text);
        break;
      case "tool_call":
        flushConv(frame.conversation_id); // 工具调用前先落文本,保证顺序
        store.applyToolCall(frame.conversation_id, frame.tool_call);
        break;
      case "tool_result":
        flushConv(frame.conversation_id);
        store.applyToolResult(frame.conversation_id, frame.tool_result);
        break;
      case "turn_completed":
        flushConv(frame.conversation_id);
        store.applyTurnCompleted(frame.conversation_id, frame);
        if (!frame.ok && frame.error) {
          notify({ level: "error", message: frame.error });
        } else if (frame.finish_reason === "cancelled") {
          notify({ level: "info", message: "已停止" });
        }
        break;
      case "turn_snapshot":
        discardConv(frame.conversation_id);
        store.applySnapshot(frame.conversation_id, frame);
        break;
      case "conversation_appended":
        flushConv(frame.conversation_id);
        store.applyConversationAppended(frame.conversation_id, frame.messages);
        break;
      case "stop_turn_result":
        if (!frame.stopped) notify({ level: "warning", message: "未找到正在进行的对话" });
        break;
      case "subscription_result":
      case "turn_result": // 非流式结果;流式路径由 turn_completed 收口
      case "conversation_history_page_result": // MVP 走 REST 拉历史
      case "pong":
        break;
      default: {
        // ErrorResponse(kind 非字面量,落这里):带 conversation_id 则写 error 终态。
        const f = frame as { ok?: boolean; conversation_id?: string; error?: string };
        if (f.ok === false) {
          const msg = f.error ?? "未知错误";
          notify({ level: "error", message: msg });
          if (f.conversation_id) {
            discardConv(f.conversation_id);
            store.applyErrorFrame(f.conversation_id, msg);
          }
        }
        break;
      }
    }
  };
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/protocol/handlers.ts
git commit -m "feat(chat): 帧分发 + rAF 合批(移植 ws-bridge-handlers)"
```

---

## Task 11: `api/conversations.ts` —— REST + WS 发送 + 编排(新写)

**Files:**
- Create: `modules/chat/src/api/conversations.ts`

把 agent-ui `services/conversations.ts` 收口成一个文件:纯 REST 请求(经 `ctx.api.request`)+ WS 发送(turn/stop/subscribe)+ 编排(选择 / 新建 / 删除 / 发送 / ask / 加载更早)。编排函数显式收 `(ctx, ws)`,不藏全局,供 `ui/app.tsx` 与 `index.tsx` 的 chat.ask handler 共用。分页游标存模块内 `Map`。

- [ ] **Step 1: 建 `modules/chat/src/api/conversations.ts`**

```ts
import type { RendererContext } from "@boundary-desktop/contract";
import type { ChatWs } from "../protocol/ws";
import type { Conversation } from "../state/conversation";
import { useConversationStore } from "../state/conversation";
import { useConvStreamStore, historyMessageToLocal } from "../state/stream";
import type { ConversationSummary, ConversationHistoryResponse, UserMessage } from "../types";

const HISTORY_LIMIT = 50;

/** 会话级历史分页游标(MVP 用 REST 拉历史)。 */
const pageCursors = new Map<string, { hasMore: boolean; before?: string }>();

function toConversation(w: ConversationSummary): Conversation {
  return { id: w.conversation_id, name: w.name, lastTurnAt: w.last_turn_at };
}

// ─── REST ──────────────────────────────────────────────────────────────────────

export async function listConversations(ctx: RendererContext): Promise<Conversation[]> {
  const res = await ctx.api.request<{ conversations?: ConversationSummary[] }>({
    method: "GET",
    path: "/api/conversations",
  });
  return (res.conversations ?? []).map(toConversation);
}

export async function createConversation(ctx: RendererContext, name?: string): Promise<Conversation> {
  const res = await ctx.api.request<{ conversation_id: string; name?: string }>({
    method: "POST",
    path: "/api/conversations",
    body: name ? { name } : {},
  });
  return { id: res.conversation_id, name: res.name, lastTurnAt: null };
}

export async function renameConversation(ctx: RendererContext, id: string, name: string): Promise<void> {
  await ctx.api.request({ method: "POST", path: `/api/conversations/${id}/rename`, body: { name } });
}

export async function deleteConversationApi(ctx: RendererContext, id: string): Promise<void> {
  await ctx.api.request({ method: "DELETE", path: `/api/conversations/${id}` });
}

async function fetchHistory(
  ctx: RendererContext,
  id: string,
  before?: string,
): Promise<ConversationHistoryResponse> {
  return ctx.api.request<ConversationHistoryResponse>({
    method: "GET",
    path: `/api/conversations/${id}/history`,
    query: before ? { limit: HISTORY_LIMIT, before } : { limit: HISTORY_LIMIT },
  });
}

// ─── WS 发送 ─────────────────────────────────────────────────────────────────────

export function subscribe(ws: ChatWs, id: string): void {
  ws.send({ type: "subscribe_conversation", conversation_id: id });
}
export function unsubscribe(ws: ChatWs, id: string): void {
  ws.send({ type: "unsubscribe_conversation", conversation_id: id });
}
export function sendTurn(ws: ChatWs, id: string, message: string): void {
  ws.send({ type: "turn", conversation_id: id, message, stream: true });
}
export function stopTurn(ws: ChatWs, id: string): void {
  ws.send({ type: "stop_turn", conversation_id: id });
}

// ─── 编排 ─────────────────────────────────────────────────────────────────────────

/** 选择会话:退订旧、置 currentId、首次进入则拉历史 seed、订阅。返回 hasMore 供 UI。 */
export async function selectConversation(ctx: RendererContext, ws: ChatWs, id: string): Promise<boolean> {
  const conv = useConversationStore.getState();
  const prevId = conv.currentId;
  if (prevId && prevId !== id) unsubscribe(ws, prevId);
  conv.setCurrentId(id);

  // 已有 stream entry 则不重拉(R-3 方案 A)
  if (!useConvStreamStore.getState().byConversation[id]) {
    const res = await fetchHistory(ctx, id);
    const msgs = (res.messages ?? []).map((m) => historyMessageToLocal(m, id));
    useConvStreamStore.getState().seedHistory(id, msgs);
    pageCursors.set(id, { hasMore: res.has_more, before: res.next_before });
  }
  subscribe(ws, id);
  return pageCursors.get(id)?.hasMore ?? false;
}

/** 加载更早一页历史(prepend)。返回剩余 hasMore。 */
export async function loadOlder(ctx: RendererContext, id: string): Promise<boolean> {
  const cur = pageCursors.get(id);
  if (!cur || !cur.hasMore || !cur.before) return false;
  const res = await fetchHistory(ctx, id, cur.before);
  const older = (res.messages ?? []).map((m) => historyMessageToLocal(m, id));
  useConvStreamStore.getState().prependHistory(id, older);
  pageCursors.set(id, { hasMore: res.has_more, before: res.next_before });
  return res.has_more;
}

/** 新建会话:create → upsert 列表 → select。返回新会话。 */
export async function newConversation(ctx: RendererContext, ws: ChatWs): Promise<Conversation> {
  const conv = await createConversation(ctx);
  useConversationStore.getState().upsert(conv);
  await selectConversation(ctx, ws, conv.id);
  return conv;
}

/** 删除会话:REST 删 → 退订 → 清 stream entry → 清列表。 */
export async function removeConversation(ctx: RendererContext, ws: ChatWs, id: string): Promise<void> {
  await deleteConversationApi(ctx, id);
  unsubscribe(ws, id);
  useConvStreamStore.getState().clearByConversation(id);
  useConversationStore.getState().remove(id);
  pageCursors.delete(id);
}

/** 发送:乐观追加 user 消息 → WS turn。 */
export function send(ws: ChatWs, id: string, text: string): void {
  const t = text.trim();
  if (!t) return;
  const local: UserMessage = {
    messageId: `local-${crypto.randomUUID()}`,
    conversationId: id,
    role: "user",
    content: t,
    timestamp: new Date().toISOString(),
  };
  useConvStreamStore.getState().appendLocal(id, local);
  sendTurn(ws, id, t);
}

/** 外部 tool(chat.ask)入口:无当前会话则新建,再发送。 */
export async function ask(ctx: RendererContext, ws: ChatWs, q: string): Promise<void> {
  let id = useConversationStore.getState().currentId;
  if (!id) {
    const c = await newConversation(ctx, ws);
    id = c.id;
  }
  send(ws, id, q);
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/api/conversations.ts
git commit -m "feat(chat): REST + WS 发送 + 会话编排"
```

---

## Task 12: `ui/chat.css` —— markdown + 代码块 scoped 样式(新写)

**Files:**
- Create: `modules/chat/src/ui/chat.css`

仅 markdown 排版(`.oc-md`)、代码块(`.oc-code-block` / `.oc-code-copy`)与输入中动画(`.oc-typing`)。对话布局(气泡 / 列表)走组件内联 + token,不进本文件。复制按钮图标用 CSS mask(DOMPurify 清掉内联 SVG)。

- [ ] **Step 1: 建 `modules/chat/src/ui/chat.css`**

```css
/* chat 模块 scoped 样式:markdown 排版 + 代码块 + 输入中动画。布局走组件内联 + token。 */

.oc-md {
  font-size: var(--text-3);
  line-height: 1.6;
  color: var(--fg-1);
  word-break: break-word;
}
.oc-md p {
  margin: 0 0 var(--space-4);
}
.oc-md p:last-child {
  margin-bottom: 0;
}
.oc-md ul,
.oc-md ol {
  margin: 0 0 var(--space-4);
  padding-left: var(--space-8);
}
.oc-md li {
  margin: var(--space-2) 0;
}
.oc-md a {
  color: var(--accent);
  text-decoration: underline;
}
.oc-md :not(pre) > code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.92em;
  padding: 0.1em 0.35em;
  border-radius: var(--r-2);
  background: var(--bg-2);
}
.oc-md blockquote {
  margin: 0 0 var(--space-4);
  padding-left: var(--space-6);
  border-left: 3px solid var(--line);
  color: var(--fg-2);
}
.oc-md h1,
.oc-md h2,
.oc-md h3 {
  margin: var(--space-6) 0 var(--space-3);
  font-weight: 600;
  line-height: 1.3;
}
.oc-md img {
  max-width: 100%;
  border-radius: var(--r-3);
}

.oc-code-block {
  position: relative;
  margin: 0 0 var(--space-4);
}
.oc-code-block pre {
  margin: 0;
  padding: var(--space-5);
  overflow-x: auto;
  border-radius: var(--r-4);
  background: var(--bg-2);
  border: 1px solid var(--line);
}
.oc-code-block pre code {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.86em;
  line-height: 1.55;
}
.oc-code-copy {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  width: 26px;
  height: 26px;
  border: 1px solid var(--line);
  border-radius: var(--r-3);
  background: var(--bg-1);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
  /* 复制图标:CSS mask(内联 SVG 会被 DOMPurify 清掉) */
  -webkit-mask: var(--icon-copy-mask) center / 14px no-repeat;
  mask: var(--icon-copy-mask) center / 14px no-repeat;
  background-color: var(--fg-2);
}
.oc-code-block:hover .oc-code-copy {
  opacity: 1;
}

/* 输入中三点动画 */
.oc-typing {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 18px;
}
.oc-typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-3, var(--fg-2));
  animation: oc-typing-bounce 1.2s infinite ease-in-out;
}
.oc-typing span:nth-child(2) {
  animation-delay: 0.15s;
}
.oc-typing span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes oc-typing-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}
```

> 注:`--icon-copy-mask` 若 token 集未提供,复制按钮显示为纯色块,仍可点;不阻塞 MVP。可后续在模块内补一个 data-URI mask 变量。

- [ ] **Step 2: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/ui/chat.css
git commit -m "feat(chat): markdown + 代码块 scoped 样式"
```

---

## Task 13: `ui/composer.tsx` —— 输入框 + 发送/停止(新写)

**Files:**
- Create: `modules/chat/src/ui/composer.tsx`

textarea + 发送/停止按钮。Enter 发送,Shift+Enter 换行。`sending` 时按钮切「停止」。

- [ ] **Step 1: 建 `modules/chat/src/ui/composer.tsx`**

```tsx
import React from "react";

const S: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    gap: "var(--space-4)",
    padding: "var(--space-5) var(--space-7)",
    borderTop: "1px solid var(--line)",
    alignItems: "flex-end",
  },
  area: {
    flex: 1,
    minHeight: 44,
    maxHeight: 160,
    padding: "var(--space-4) var(--space-6)",
    borderRadius: "var(--r-5)",
    resize: "none",
    fontSize: "var(--text-3)",
    lineHeight: 1.5,
  },
  btn: { height: 44, padding: "0 var(--space-9)", borderRadius: "var(--r-5)" },
};

export function Composer({
  sending,
  onSend,
  onStop,
}: {
  sending: boolean;
  onSend(text: string): void;
  onStop(): void;
}): React.ReactElement {
  const [text, setText] = React.useState("");

  const submit = (): void => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div style={S.row}>
      <textarea
        className="bd-textarea"
        style={S.area}
        value={text}
        placeholder="今天要做点什么？"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {sending ? (
        <button type="button" className="bd-btn" style={S.btn} onClick={onStop}>
          停止
        </button>
      ) : (
        <button type="button" className="bd-btn bd-btn--primary" style={S.btn} onClick={submit}>
          发送
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/ui/composer.tsx
git commit -m "feat(chat): composer 输入框 + 发送/停止"
```

---

## Task 14: `ui/line.tsx` —— 单元渲染(新写)

**Files:**
- Create: `modules/chat/src/ui/line.tsx`

渲染一个 `RenderUnit`:用户气泡;assistant turn(thinking 折叠块、工具卡、markdown 文本、输入中动画、已停止标记)。markdown 经 `renderMarkdown` + `dangerouslySetInnerHTML`,代码复制走事件委托。

- [ ] **Step 1: 建 `modules/chat/src/ui/line.tsx`**

```tsx
import React from "react";
import type { RenderUnit, AssistantTurnUnit } from "../render/units";
import type { ToolCard } from "../render/tool";
import { renderMarkdown } from "../render/markdown";

const S: Record<string, React.CSSProperties> = {
  user: {
    alignSelf: "flex-end",
    maxWidth: "78%",
    padding: "var(--space-4) var(--space-6)",
    borderRadius: "var(--r-4)",
    background: "var(--accent)",
    color: "#fff",
    fontSize: "var(--text-3)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  turn: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  thinking: {
    fontSize: "var(--text-2)",
    color: "var(--fg-2)",
    background: "var(--bg-1)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-3)",
    padding: "var(--space-3) var(--space-5)",
  },
  thinkingSummary: { cursor: "pointer", userSelect: "none" },
  tool: {
    fontSize: "var(--text-2)",
    border: "1px solid var(--line)",
    borderRadius: "var(--r-3)",
    padding: "var(--space-3) var(--space-5)",
    background: "var(--bg-1)",
  },
  toolErr: { borderColor: "var(--danger, #e5484d)" },
  toolName: { fontFamily: "var(--font-mono, monospace)", fontWeight: 600 },
  pre: { margin: "var(--space-2) 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word" },
  meta: { fontSize: "var(--text-2)", color: "var(--fg-3, var(--fg-2))" },
};

function ThinkingBlock({ thinking }: { thinking: { text: string; streaming: boolean } }): React.ReactElement {
  return (
    <details style={S.thinking} open={thinking.streaming}>
      <summary style={S.thinkingSummary}>{thinking.streaming ? "正在思考…" : "思考过程"}</summary>
      {thinking.text && <div style={S.pre}>{thinking.text}</div>}
    </details>
  );
}

function ToolCardView({ card }: { card: ToolCard }): React.ReactElement {
  return (
    <div style={{ ...S.tool, ...(card.isError ? S.toolErr : null) }}>
      <span style={S.toolName}>{card.name}</span>
      {card.inputText && <div style={S.pre}>{card.inputText}</div>}
      {card.outputText !== undefined && <div style={S.pre}>{card.outputText}</div>}
    </div>
  );
}

function TypingDots(): React.ReactElement {
  return (
    <div className="oc-typing">
      <span />
      <span />
      <span />
    </div>
  );
}

function AssistantText({ text }: { text: string }): React.ReactElement {
  // 代码块复制按钮:事件委托(markdown.ts 只产出静态 .oc-code-copy 按钮)。
  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const btn = (e.target as HTMLElement).closest(".oc-code-copy");
    if (!btn) return;
    const code = btn.parentElement?.querySelector("code");
    if (code) void navigator.clipboard.writeText(code.textContent ?? "");
  };
  return (
    <div
      className="oc-md"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}

export function Line({ unit }: { unit: RenderUnit }): React.ReactElement | null {
  if (unit.kind === "user") {
    return <div style={S.user}>{unit.message.content}</div>;
  }
  if (unit.kind === "system") {
    return <div style={S.meta}>{unit.text}</div>;
  }
  const turn: AssistantTurnUnit = unit;
  const emptyStreaming =
    turn.streaming && !turn.text && !turn.thinking && turn.tools.length === 0;
  return (
    <div style={S.turn}>
      {turn.thinking && <ThinkingBlock thinking={turn.thinking} />}
      {turn.tools.map((t) => (
        <ToolCardView key={t.id} card={t} />
      ))}
      {turn.text && <AssistantText text={turn.text} />}
      {emptyStreaming && <TypingDots />}
      {turn.cancelled && <div style={S.meta}>已停止</div>}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/ui/line.tsx
git commit -m "feat(chat): 单元渲染(气泡/thinking/工具卡/markdown/输入中)"
```

---

## Task 15: `ui/window.tsx` —— 消息流 + 自动跟随滚动(新写)

**Files:**
- Create: `modules/chat/src/ui/window.tsx`

`useCurrentMessages` → `buildRenderUnits` → `<Line>` 列表。底部跟随:用户在底部附近时新消息自动滚到底;滚上去后不打扰。顶部「加载更早」按钮(有 hasMore 时)。

- [ ] **Step 1: 建 `modules/chat/src/ui/window.tsx`**

```tsx
import React from "react";
import { buildRenderUnits } from "../render/units";
import { useCurrentMessages } from "../state/stream";
import { Line } from "./line";

const S: Record<string, React.CSSProperties> = {
  feed: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
    padding: "var(--space-6) var(--space-7)",
  },
  empty: {
    flex: 1,
    display: "grid",
    placeItems: "center",
    color: "var(--fg-2)",
    fontSize: "var(--text-3)",
  },
  older: { alignSelf: "center" },
};

const STICK_THRESHOLD_PX = 80;

export function ChatWindow({
  currentId,
  hasMore,
  onLoadOlder,
}: {
  currentId: string | null;
  hasMore: boolean;
  onLoadOlder(): void;
}): React.ReactElement {
  const messages = useCurrentMessages();
  const units = React.useMemo(() => buildRenderUnits(messages), [messages]);
  const ref = React.useRef<HTMLDivElement>(null);
  const stick = React.useRef(true);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [units]);

  const onScroll = (): void => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD_PX;
  };

  if (!currentId) {
    return <div style={S.empty}>选择或新建一个会话开始对话</div>;
  }

  return (
    <div ref={ref} style={S.feed} onScroll={onScroll}>
      {hasMore && (
        <button type="button" className="bd-chip" style={S.older} onClick={onLoadOlder}>
          加载更早
        </button>
      )}
      {units.map((u) => (
        <Line key={u.key} unit={u} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/ui/window.tsx
git commit -m "feat(chat): 消息流 + 自动跟随滚动 + 加载更早"
```

---

## Task 16: `ui/sidebar.tsx` —— 会话列表(新写)

**Files:**
- Create: `modules/chat/src/ui/sidebar.tsx`

`useConversationStore` 读列表 + currentId;新建按钮;每项点选,hover 出删除。

- [ ] **Step 1: 建 `modules/chat/src/ui/sidebar.tsx`**

```tsx
import React from "react";
import { useConversationStore } from "../state/conversation";

const S: Record<string, React.CSSProperties> = {
  root: {
    width: 248,
    flex: "0 0 248px",
    borderRight: "1px solid var(--line)",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-1)",
  },
  head: {
    padding: "var(--space-5) var(--space-5)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: "var(--text-3)", fontWeight: 600 },
  list: { flex: 1, overflowY: "auto", padding: "0 var(--space-3) var(--space-4)" },
  item: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-3)",
    padding: "var(--space-3) var(--space-4)",
    borderRadius: "var(--r-3)",
    cursor: "pointer",
    fontSize: "var(--text-3)",
    color: "var(--fg-1)",
  },
  itemActive: { background: "var(--accent-soft)", color: "var(--accent)" },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  del: {
    border: "none",
    background: "transparent",
    color: "var(--fg-3, var(--fg-2))",
    cursor: "pointer",
    fontSize: "var(--text-2)",
    padding: "0 var(--space-2)",
  },
};

export function Sidebar({
  onSelect,
  onNew,
  onDelete,
}: {
  onSelect(id: string): void;
  onNew(): void;
  onDelete(id: string): void;
}): React.ReactElement {
  const conversations = useConversationStore((s) => s.conversations);
  const currentId = useConversationStore((s) => s.currentId);

  return (
    <div style={S.root}>
      <div style={S.head}>
        <span style={S.title}>对话</span>
        <button type="button" className="bd-chip" onClick={onNew}>
          新建
        </button>
      </div>
      <div style={S.list}>
        {conversations.map((c) => (
          <div
            key={c.id}
            style={{ ...S.item, ...(c.id === currentId ? S.itemActive : null) }}
            onClick={() => onSelect(c.id)}
          >
            <span style={S.name}>{c.name?.trim() || "新会话"}</span>
            <button
              type="button"
              style={S.del}
              title="删除"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/ui/sidebar.tsx
git commit -m "feat(chat): 会话列表 sidebar"
```

---

## Task 17: `ui/app.tsx` —— 组合根(新写)

**Files:**
- Create: `modules/chat/src/ui/app.tsx`

组合 sidebar + main(window + composer)。挂载即拉会话列表。编排回调把 `(ctx, ws)` 接进 api 层;`hasMore` 用本地 state 跟踪(select / loadOlder 后更新)。错误经 `ctx.notify`。

- [ ] **Step 1: 建 `modules/chat/src/ui/app.tsx`**

```tsx
import React from "react";
import type { RendererContext } from "@boundary-desktop/contract";
import type { ChatWs } from "../protocol/ws";
import { useConversationStore } from "../state/conversation";
import { useCurrentSending } from "../state/stream";
import * as api from "../api/conversations";
import { Sidebar } from "./sidebar";
import { ChatWindow } from "./window";
import { Composer } from "./composer";

const S: Record<string, React.CSSProperties> = {
  root: { height: "100%", display: "flex" },
  main: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
};

export function ChatApp({ ctx, ws }: { ctx: RendererContext; ws: ChatWs }): React.ReactElement {
  const currentId = useConversationStore((s) => s.currentId);
  const sending = useCurrentSending();
  const [hasMore, setHasMore] = React.useState(false);

  const fail = React.useCallback(
    (message: string) => (e: unknown) => ctx.notify({ level: "error", message, detail: String(e) }),
    [ctx],
  );

  React.useEffect(() => {
    void api
      .listConversations(ctx)
      .then((list) => useConversationStore.getState().setConversations(list))
      .catch(fail("加载会话列表失败"));
  }, [ctx, fail]);

  const onSelect = (id: string): void => {
    void api.selectConversation(ctx, ws, id).then(setHasMore).catch(fail("打开会话失败"));
  };
  const onNew = (): void => {
    void api
      .newConversation(ctx, ws)
      .then(() => setHasMore(false))
      .catch(fail("新建会话失败"));
  };
  const onDelete = (id: string): void => {
    void api.removeConversation(ctx, ws, id).catch(fail("删除会话失败"));
  };
  const onSend = (text: string): void => {
    if (currentId) api.send(ws, currentId, text);
    else void api.ask(ctx, ws, text).then(() => setHasMore(false)).catch(fail("发送失败"));
  };
  const onStop = (): void => {
    if (currentId) api.stopTurn(ws, currentId);
  };
  const onLoadOlder = (): void => {
    if (currentId) void api.loadOlder(ctx, currentId).then(setHasMore).catch(fail("加载历史失败"));
  };

  return (
    <div style={S.root}>
      <Sidebar onSelect={onSelect} onNew={onNew} onDelete={onDelete} />
      <div style={S.main}>
        <ChatWindow currentId={currentId} hasMore={hasMore} onLoadOlder={onLoadOlder} />
        <Composer sending={sending} onSend={onSend} onStop={onStop} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/ui/app.tsx
git commit -m "feat(chat): 组合根 app(sidebar + window + composer)"
```

---

## Task 18: `src/index.tsx` —— activate/deactivate 接线(重写 stub)

**Files:**
- Modify(整体重写): `modules/chat/src/index.tsx`

activate:注入 chat.css `<style>`;建 dispatcher + ChatWs;连 WS;订阅 config(ws base 变才重连);注册 `chat.open` + `chat.ask`;挂 ChatApp。deactivate:卸载 React、关 WS、移除样式、退订、清 store。

- [ ] **Step 1: 重写 `modules/chat/src/index.tsx`**

```tsx
// chat 模块入口:activate 接线协议/状态/UI,注册 chat.open + chat.ask。
// react / react-dom external(壳 import map 共享);RendererContext type-only。
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import type { RendererContext } from "@boundary-desktop/contract";
import { ChatApp } from "./ui/app";
import { ChatWs } from "./protocol/ws";
import { createFrameDispatcher } from "./protocol/handlers";
import { useConversationStore } from "./state/conversation";
import { useConvStreamStore } from "./state/stream";
import * as api from "./api/conversations";
import cssText from "./ui/chat.css";

interface WorkerEndpoint {
  addr: string;
  port: number;
}

/** 从 ctx.config 读 agentworkerd.ws 端点拼 ws url。host 在发现 worker 后经 config 通道下发
 *  agentworkerd = { http?, ws? },每项 { addr, port }(见 apps/shell/src/main/index.ts)。 */
function wsBase(ctx: RendererContext): string | null {
  const cfg = ctx.config.get() as { agentworkerd?: { ws?: WorkerEndpoint } };
  const ws = cfg.agentworkerd?.ws;
  return ws ? `ws://${ws.addr}:${ws.port}/ws` : null;
}

let root: Root | null = null;
let ws: ChatWs | null = null;
let styleEl: HTMLStyleElement | null = null;
let configSub: { dispose(): void } | null = null;
let lastWsBase: string | null = null;

const mod = {
  activate(ctx: RendererContext): void {
    styleEl = document.createElement("style");
    styleEl.textContent = cssText;
    document.head.appendChild(styleEl);

    const dispatch = createFrameDispatcher((opts) => ctx.notify(opts));
    ws = new ChatWs({
      url: () => wsBase(ctx),
      token: () => ctx.auth.getToken(), // 每次连接前现取,刷新/吊销后即最新
      onFrame: dispatch,
    });
    lastWsBase = wsBase(ctx);
    ws.connect();

    // worker 重启换端口 → ws base 变才重连(无关 config 变化不打扰)。
    configSub = ctx.config.subscribe(() => {
      const next = wsBase(ctx);
      if (next !== lastWsBase) {
        lastWsBase = next;
        ws?.reconnect();
      }
    });

    // open:把对话模块切到前台(供别的模块 invokeTool("chat.open") 调用)。
    ctx.registerTool({
      name: "open",
      schema: { type: "object", properties: {} },
      description: "把对话模块切到前台",
      handler: async (_args, inv) => {
        ctx.navigate("chat");
        return { ok: true, caller: inv.caller };
      },
    });
    // ask:外部发起一次提问(无当前会话则新建),切到前台。
    ctx.registerTool({
      name: "ask",
      schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      description: "向对话发起一次提问",
      handler: async (args) => {
        const q = (args as { q?: string })?.q ?? "";
        ctx.navigate("chat");
        if (ws && q.trim()) await api.ask(ctx, ws, q);
        return { ok: true };
      },
    });

    root = createRoot(ctx.container);
    root.render(<ChatApp ctx={ctx} ws={ws} />);
  },

  deactivate(): void {
    root?.unmount();
    root = null;
    ws?.close();
    ws = null;
    configSub?.dispose();
    configSub = null;
    styleEl?.remove();
    styleEl = null;
    lastWsBase = null;
    // 清模块自有状态:同 bundle deactivate→reactivate 时 store 是持久单例,
    // 不清会让 selectConversation 命中"已有 entry 跳重拉"路径而显示陈旧历史。
    useConversationStore.getState().setConversations([]);
    useConversationStore.getState().setCurrentId(null);
    useConvStreamStore.setState({ byConversation: {} });
  },
};

export default mod;
```

- [ ] **Step 2: 类型检查**

Run: `pnpm -F @boundary-desktop/module-chat typecheck`
Expected: 通过。

- [ ] **Step 3: 全套测试 + 构建**

Run: `pnpm -F @boundary-desktop/module-chat test && pnpm build:mods`
Expected: 32 passed;`[build:mods] vendor + 构建 [..., chat, ...]` 无报错,产出 `modules/chat/dist/index.mjs`。

- [ ] **Step 4: Commit**

```bash
cd /Volumes/development/boundary-workspace/boundary-desktop
git add modules/chat/src/index.tsx
git commit -m "feat(chat): activate/deactivate 接线 + chat.open/chat.ask"
```

---

## Task 19: 收尾验证(类型、构建、人工)

**Files:** 无(只跑命令 + 人工核对)

- [ ] **Step 1: workspace 级类型检查**

Run: `pnpm -r typecheck`
Expected: 全包通过(含 chat 模块)。

- [ ] **Step 2: 全套单测**

Run: `pnpm -F @boundary-desktop/module-chat test`
Expected: thinking 4 + tool 6 + units 6 + markdown 6 + stream 10 = 32 passed。

- [ ] **Step 3: 模块构建**

Run: `pnpm build:mods`
Expected: 无报错,`modules/chat/dist/index.mjs` 更新;无 "Dynamic require" / react 重复实例告警。

- [ ] **Step 4: 人工验证(`pnpm dev`,需 GUI + 本机 agentworkerd)**

Run: `pnpm dev`
逐项核对(并据此确认开头的待确认项):
- 进入对话模块,左栏列出已有会话(确认 `GET /api/conversations` 经 ctx.api.request 通)。
- 点会话 → 右侧加载历史并渲染(markdown / thinking / 工具卡)。
- 输入发送 → 出现乐观 user 气泡 → assistant 流式逐字渲染(确认 WS 连上、token 被接受)。
- 发送中点「停止」→ 收到 turn_completed{cancelled},气泡标「已停止」。
- 新建会话 → 发送即建会话并流式回复。
- 触发别的模块 `invokeTool("chat.open")` / `chat.ask` → 切到对话前台 / 自动发问。
- 重启 worker(`运行状态页` 重启)→ ws base 变,自动重连后仍可发送(确认 **待确认项 3** config 形状)。
- **核对 WS 鉴权线格式(待确认项 1)**:看 worker `/ws` 日志确认 `?token=<getToken()>` 是否被接受;若 worker 期望子协议或首帧 auth,改 `protocol/ws.ts` 的 `buildUrl`(或 open 后补一帧)一处即可。worker 无默认 agent 实例时,subscribe/turn 报 `AmbiguousInstanceSelection`,则需补 `agent_instance_id`(待确认项 2)。

- [ ] **Step 5: 交接(不自动开 PR,等 review)**

不开 PR。汇总:涉及 repo(boundary-desktop)、改动文件清单、`pnpm -r typecheck` 与单测结果、人工验证逐项结论、三个集成假设的实测结论与任何为此改的代码。等明确指令再开 worktree + PR。

---

## 备注:与 workspace 规则的衔接

- 全部 commit 聚焦 boundary-desktop 单仓;消息用 Conventional Commits,scope=`chat`(或 `chore(chat)`)。
- 本计划只产出本地 commit;开 worktree / 推分支 / 开 PR 一律等用户明确指令(base 分支受保护,禁止本地 merge + push)。
- 不混入无关变更;`scripts/build-modules.mjs` 的 css text loader 是本特性所需的最小通用增强,单列 Task 1 说明。
- 文档(本计划)简体中文、无 emoji、只写当前状态。
