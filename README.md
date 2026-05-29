# boundary-desktop

可插拔模块热更新框架：稳定的基座（Host）+ 可在线下载、运行时热插拔的功能模块（Module）。基于 Electron，将来作为 ai-agent 的壳子。

## 入口

- [可插拔模块热更新框架设计](docs/superpowers/specs/2026-05-29-pluggable-module-framework-design.md)
  - 基座与模块契约的整体设计：生命周期、ctx 能力注入、tool 子系统、对外门面、版本契约、安全
- [packages/contract/src/contract.ts](packages/contract/src/contract.ts)
  - 基座 ⇄ 模块契约的单一事实来源（类型 + 运行期辅助）

## Layout

pnpm workspace，`packages/*` 与 `modules/*` 平级。

- `packages/contract`
  - `@boundary-desktop/contract` —— manifest / 生命周期 / 三层 ctx / tool 契约，外加 `defineModule` 与 `HOST_API_VERSION`。基座与所有模块共同依赖
- `packages/host`
  - `@boundary-desktop/host` —— 基座，实现 contract，持有全部有状态资源（当前为占位）
- `modules/`
  - 业务模块，均依赖 `@boundary-desktop/contract`（当前为空）

## 命令

```bash
pnpm install        # 安装 + 建立 workspace 链接
pnpm build          # 构建全部包（pnpm -r build）
pnpm typecheck      # 全包类型检查
```

## 核心约束

- **基座是状态的唯一持有者。** 一切有状态、长生命周期的资源（连接、会话、页面句柄、登录态、注册表）只存在于基座。
- **模块无状态或状态外置。** 模块不持有底层资源，只通过基座注入的 `ctx` 操作它们。检验标准：热拔掉不留痕迹，插回去行为一致。
- **`ctx` 是基座与模块唯一的合法接触面。** 能力归三种范式（共享状态只读 + 订阅 / 代理动作 / 注册类自动回收）加 storage 特例，按 runtime 单一维度裁剪。
- **tool 注册自动加 `<module.id>.` 前缀。** 跨模块冲突结构性不可能，热替换按前缀回收。
- **对外协议是可替换的边缘。** WS / MCP / CLI 都是接在 list/invoke/version 三件套上的门面，不进核心契约。

新增能力若迫使核心契约反向依赖某个门面或具体功能域，说明边界划错了，应重做边界而非补反向依赖。
