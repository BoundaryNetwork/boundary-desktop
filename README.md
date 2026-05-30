# boundary-desktop

可插拔模块热更新框架：稳定的基座（Host）+ 可在线下载、运行时热插拔的功能模块（Module）。基于 Electron，将来作为 ai-agent 的壳子。

## 入口

- [可插拔模块热更新框架设计](docs/superpowers/specs/2026-05-29-pluggable-module-framework-design.md)
  - 基座与模块契约的整体设计：生命周期、ctx 能力注入、tool 子系统、对外门面、版本契约、安全
- [packages/contract/src/contract.ts](packages/contract/src/contract.ts)
  - 基座 ⇄ 模块契约的单一事实来源（类型 + 运行期辅助）

## Layout

pnpm workspace：`apps/*`、`packages/*`、`modules/*` 三者平级。

- `apps/shell`
  - `@boundary-desktop/shell` —— Electron 壳：主进程 + React 渲染壳 + `vendor/`（共享 React 运行时产物）。框架的一个宿主，消费下列契约
- `packages/contract`
  - `@boundary-desktop/contract` —— manifest / 生命周期 / 三层 ctx / tool 契约，外加 `defineModule` 与 `HOST_API_VERSION`。基座与所有模块共同依赖
- `packages/host`
  - `@boundary-desktop/host` —— 基座，实现 contract，持有全部有状态资源（当前为占位）
- `packages/ui`
  - `@boundary-desktop/ui` —— 样式契约（纯 CSS）：设计 token + `bd-*` 设计系统类。基座发布、模块消费，与 contract 平级
- `modules/<id>`
  - 业务模块（chat/team/skills/tasks/canvas/browser，当前示例 stub）。各自标准包，统一 `src/index.ts(x)` → 构建出 `dist/index.mjs`，依赖 `@boundary-desktop/contract`
- `scripts/`
  - workspace 级模块工具链：`build-modules.mjs`（vendor + 各模块构建）、`pack-modules.mjs`（发布 catalog）
- `module-envs.json`
  - env → CDN base 单一事实源（客户端拉 catalog / 发布写 entry 共用）

## 命令

```bash
pnpm install        # 安装 + 建立 workspace 链接
pnpm build          # 构建全部包（pnpm -r build）
pnpm typecheck      # 全包类型检查

# 模块工具链（workspace 级，根脚本）
pnpm build:mods                    # 自动发现并构建各模块产物 + vendor
pnpm pack:mods <staging|prod>      # 发布：算 integrity + 生成 catalog.json → out/publish/<env>

pnpm clean                         # 清构建产物（dist/out/out-tsc/vendor/*.tsbuildinfo，不动 node_modules）
```

## 核心约束

- **基座是状态的唯一持有者。** 一切有状态、长生命周期的资源（连接、会话、页面句柄、登录态、注册表）只存在于基座。
- **模块无状态或状态外置。** 模块不持有底层资源，只通过基座注入的 `ctx` 操作它们。检验标准：热拔掉不留痕迹，插回去行为一致。
- **`ctx` 是基座与模块唯一的合法接触面。** 能力归三种范式（共享状态只读 + 订阅 / 代理动作 / 注册类自动回收）加 storage 特例，按 runtime 单一维度裁剪。
- **tool 注册自动加 `<module.id>.` 前缀。** 跨模块冲突结构性不可能，热替换按前缀回收。
- **对外协议是可替换的边缘。** WS / MCP / CLI 都是接在 list/invoke/version 三件套上的门面，不进核心契约。

新增能力若迫使核心契约反向依赖某个门面或具体功能域，说明边界划错了，应重做边界而非补反向依赖。
