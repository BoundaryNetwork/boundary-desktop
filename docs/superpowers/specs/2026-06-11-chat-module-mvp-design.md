# chat 模块 MVP 移植设计(从 agent-ui 移植 chat)

把 agent-ui 的 chat 以一个 renderer 功能模块的形态移植到 `modules/chat`,替换现有回声 stub。模块直接对接本机 agentworkerd:REST 经 `ctx.api.request`,实时 turn 流走模块自连的 WebSocket。本期只做核心 MVP,采用"核心状态机原样搬、UI 重写"的混合搬法。本文锁定范围与架构,实现细节随实现细化。

## 1. 锁定的决策

- **范围 = 核心 MVP**:会话列表(选择 / 新建 / 删除)、历史加载、消息流(自动跟随滚动)、输入框(发送 / 停止)、流式 assistant turn 渲染(markdown + thinking 折叠块 + 工具卡 + 输入中动画)、错误经 `ctx.notify` 提示。
- **推迟(本期外)**:附件 + 灯箱、右侧三抽屉(artifact / 资源预览 / 助手)、skill chip、上下键历史导航、草稿持久化、会话置顶 / 排序、未读 / 已读 + running-session 指示、完整 delta-coalescer、代码语法高亮(highlight.js)、token 用量、审批 UI。
- **搬法 = 混合**:流式状态机(stream store + render-units + ws 事件映射 + markdown 库)按语义原样搬;UI 壳(列表 / 气泡 / composer)按设计系统重写。
- **流式传输 = 模块自连浏览器 `WebSocket`**,不扩 host 契约;鉴权用 `ctx.auth.getToken()`。
- **样式 = 不引 Tailwind**:公共控件用 `bd-*`,对话专属布局走模块内联 + token,markdown / 代码块走模块内 scoped `chat.css`。
- **状态库 = 模块内保留 zustand + immer**(打进 bundle),流式 reducer 不改写到别的状态原语。

## 2. 架构

一个 renderer 模块,内部按 协议 → 状态 → 渲染 → UI 分层,逐层裁到 MVP。

- REST(会话 CRUD + 历史)经 `ctx.api.request`——Host 的 `WorkerApiDriver` 代发到 worker 本地 HTTP base、实时注入 token。
- turn 流为模块自连的 WS:连 `ws://{config.agentworkerd.ws.addr}:{port}/ws`,`config.agentworkerd = { http?, ws? }`(每项 `{ addr, port }`)由 Host 发现 worker 端点后经 config 通道下发;config 变化(worker 重启换端口)时重连。

host 侧的 worker 进程监管与端点发现见 `docs/agent-kernel-eval.md`;本模块只消费其下发的 config 与 api seam,不感知监管细节。

## 3. 文件布局

```
modules/chat/src/
  index.tsx                # activate/deactivate;挂载 ChatApp;注册 chat.open + chat.ask 工具
  types.ts                 # Message 联合 + WS 事件/响应 + REST DTO(裁剪移植)
  protocol/
    ws.ts                  # 浏览器 WebSocket:按 config 连接/重连、发帧、分发
    handlers.ts            # 帧 → store.apply*(从 ws-bridge-handlers 移植,剥掉辅助依赖)
  state/
    stream.ts              # 流式状态机——apply* reducers(从 conversation-stream.store 移植)
    conversation.ts        # 列表 + currentId + 历史分页(裁剪:无置顶/排序/未读)
  api/conversations.ts     # ctx.api.request:list / create / history / rename / delete / sendTurn / stopTurn
  render/
    units.ts               # 原样移植(turn 状态机)
    tool.ts                # 移植(mergeToolMessages)——render/units 依赖
    thinking.ts            # 移植(mergeThinking)——render/units 依赖
    markdown.ts            # 原样移植(marked + DOMPurify,无 highlight.js)
  ui/
    app.tsx                # sidebar + main(header / window / composer)
    sidebar.tsx            # 会话列表:选择 / 新建 / 删除
    window.tsx             # 消息流 + 自动跟随滚动
    line.tsx               # 用户气泡;assistant turn(thinking 块、工具卡、markdown、输入中动画)
    composer.tsx           # textarea + 发送/停止
    chat.css               # scoped:.oc-md markdown + .oc-code-block(移植子集,无 hljs)
```

## 4. 数据流

1. `activate`:读 `ctx.config.agentworkerd.ws` → 连 WS;订阅 config 变化,worker 重启后重连。
2. 挂载:`GET /api/conversations` → 填 `conversation` 列表。
3. 选会话:`GET /api/conversations/{id}/history` → `stream.seedHistory`;WS `subscribe_conversation`。
4. 发送:乐观 `appendLocal(user)` → WS `turn_input`;帧(`turn_started` / `output_delta` / `reasoning_delta` / `tool_call` / `tool_result` / `turn_completed`)→ `handlers` → `stream.apply*` → `buildRenderUnits` → UI。
5. 停止:WS `stop_turn`。

流式写入用 store 内小 `streamBuffer`,按 `requestAnimationFrame` flush。

## 5. 移植清单(原样搬的部分)

从源端按语义搬入,剥掉 MVP 外的辅助子系统:

- `render-units.ts` → `render/units.ts`:turn 分组状态机,含 edge-case 10(thinking 全空但 pending 时合成流式指示)。连带搬 `tool-cards.ts` → `render/tool.ts`(mergeToolMessages)、`thinking.ts` → `render/thinking.ts`(mergeThinking)。
- `conversation-stream.store.ts` → `state/stream.ts`:apply* reducers(seedHistory / appendLocal / applyTurnStarted / applyOutputDelta / applyReasoningDelta / applyToolCall / applyToolResult / applyTurnCompleted / applyErrorFrame / applySnapshot / applyConversationAppended)。
- `ws-bridge-handlers.ts` → `protocol/handlers.ts`:帧到 reducer 的映射。剥掉 session-read-state、running-sessions、未读追踪、ws-error-mapping 分类、toast(错误统一收口到 `ctx.notify`)、delta-coalescer(换成 rAF 轻量 flush)。
- `markdown.ts` → `render/markdown.ts`:marked + DOMPurify,含 img / href 安全 hook 与代码块复制按钮包裹;去掉 highlight.js(代码块呈等宽无高亮)。

## 6. 依赖

模块新增打包依赖:`zustand`、`immer`、`marked`、`dompurify`。源端丢弃:`@tauri-apps/*`、`highlight.js`、`lucide-react`、`framer-motion`、`clsx`、`tailwind-merge`。react / react-dom 仍为 external,走 vendor import map 共享。

## 7. 测试

vitest 单测覆盖纯逻辑:

- `render-units`:turn 分组、streaming / cancelled 边界。
- `tool-cards` / `thinking`:合并逻辑。
- `stream`:reducer(delta 累加、turn 生命周期、错误终态)。
- `markdown`:sanitize(脚本剥离、img / href 安全)。

UI 与 WS 接线在 `pnpm dev` 对真机 agentworkerd 手动验证。

## 8. 协议类型

模块自带一份 agentworkerd REST/WS 协议响应类型的手抄子集,在模块级与 agentworkerd 契约同步(与 `docs/agent-kernel-eval.md` 一致:各模块各带一份)。
