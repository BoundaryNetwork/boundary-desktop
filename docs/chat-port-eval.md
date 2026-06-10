# 评估:把 agent-ui 的 chat 移植到 boundary-desktop,协议对接 ai-agent agentworkerd

日期:2026-06-09
状态:评估,未决策

## 目标

把 agent-ui 的 chat 部分搬进 boundary-desktop,作为一个功能模块,通过 WS/HTTP 协议直接对接本机 ai-agent 的 worker 进程(agentworkerd)。

## 两边现状

### 源:agent-ui 的 chat

- 技术栈:React 18.3 + Zustand 4.5 + Immer + framer-motion + marked + highlight.js + DOMPurify + lucide-react + Tailwind 3.4。
- chat 本体规模与耦合:
  - `pages/ChatPage/*`:Composer 35KB、ChatSidebar 41KB、ChatLine 21KB、ChatHeader 16KB、ChatWindow 10KB、index 8KB,合计约 150KB tsx。
  - `services/conversations.ts` 约 27KB。
  - 协议层 `protocol/*`:ws、ws-bridge、ws-bridge-handlers、types、runtime-endpoint、http、errors、events、hooks、delta-coalescer、ws-reconnect,合计约 70KB。
  - chat 引用约 18 个 store(account / agent / instance / jobs / artifact / conversation / conversation-stream 等),以及 attachments、workspace-fs、platform bridge。
- 与 worker 的连接:`ws://127.0.0.1:<port>/ws` + `http://127.0.0.1:<port>/api`(以及 `/local`)。WS/HTTP 用浏览器原生 `WebSocket`/`fetch`,不依赖 Tauri。

### 目标:boundary-desktop 的 chat 模块

- 当前是 168 行的 renderer 模块,依赖只有 `@boundary-desktop/contract`,RendererContext 经 IPC 收口。
- 模块构建 `scripts/build-modules.mjs` 用 esbuild:renderer 模块只 external react/react-dom(走 vendor import map 共享一份 React),其它第三方依赖全部 bundle 进 `dist/index.mjs`。

### 协议属主:ai-agent

- WS 协议真源:`crates/app-worker/src/transport/ws/protocol.rs`(Rust)。
- agent-ui 的 `src/protocol/types.ts` 是该协议的手抄 TS 镜像。
- agentworkerd 绑 `127.0.0.1:0`,真实端口写入 `<base_dir>/run/agentworkerd/runtime.json`;control socket 默认 `<cwd>/run/agentworkerd/control.sock`,仅供 app-launcher 用(status / drain / shutdown)。

## 技术可行性:可行,无硬阻断

- React 版本两边都是 18.3,vendor 共享无冲突。
- zustand / framer-motion / marked / highlight.js / DOMPurify / lucide 等可被 esbuild 全量打进模块,无需 host 配合加依赖。
- Electron renderer 是真浏览器上下文,模块内 `new WebSocket('ws://127.0.0.1:<port>/ws')` 与 `fetch` 可直连,传输层可直接复用。

## 三个摩擦点

### 1. 不是只抄 chat,而是一片运行时切片

chat 在 agent-ui 里边界不干净:耦合约 18 个 store、多个 service、platform bridge,以及设备激活 / session / token 模型。要么把整片子树搬过来,要么做不小的解耦手术。

### 2. Tauri 耦合薄,但 host 这边有空洞

- Tauri 耦合集中在单文件 `protocol/tauri.ts`:`invoke('get_worker_endpoint')` 读 runtime.json + 监听 `worker-restarted` 事件。替换此文件即可解耦。
- 在 ai-agent,app-launcher(Rust 壳)负责拉起并监管 agentworkerd,Tauri 命令读 runtime.json 返回端点。
- boundary-desktop 当前没有这一层:不拉进程、不读 runtime.json。renderer 读不了文件系统,因此“端点发现 + 进程监管”必须落到 Host(主进程)。
- 这是 workspace 规划里 boundary-desktop “将来作为 ai-agent 壳”的职责,目前阶段标记为“早期阶段,暂与其它子项目无共享契约”。本次移植会把这件事从“将来”拉到“现在”。

### 3. 协议镜像会再分叉一份

按 workspace 规则,app-worker 是契约方。现有“Rust 真源 + agent-ui TS 镜像”两份。再抄一份 `types.ts` 进 boundary-desktop 即第三份手抄,漂移面增大。若推进,应走共享 / 生成,而非再 copy。

## 框架契合度的设计问题

boundary-desktop 模块模型是 IPC 收口的能力 ctx。chat 需要一条长连 WS + 流式。renderer 模块自行开 WS 到 localhost 能跑,但绕过框架能力模型(对照 webview 作为 host 能力的做法)。WS 走模块直连还是做成 host capability,是需先定的设计决策。

## 三条路径

### A. 全量端口

搬齐 chat 子树 + 协议层 + Host 壳层(拉起 / 发现 / 监管 agentworkerd),boundary-desktop 真正能与本机 agentworkerd 对话。工作量最大,等于提前实现壳。

### B. 传输层 PoC

只搬协议层 + 一个最小 chat 视图;Host 补一个“读 runtime.json 返回端点”的能力;先打通“模块 ↔ 真 worker 一来一回 turn”。验证连通性,不搬 agent-ui 的 store 群。

### C. 暂缓

先定“WS / 进程监管该不该是 host capability”这一设计,再谈移植。

## 工作量分布

- UI 与协议层:最容易,基本是可移植 React + 浏览器原生传输。
- 从 agent-ui 剥出 chat 的依赖子树:中到大。
- Host 补 agentworkerd 拉起 / 发现层:新建能力,中等偏上,跨入壳职责。
- 设备激活 / session / token 模型:需随行或打桩。
