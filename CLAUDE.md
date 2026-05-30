# CLAUDE.md

boundary-desktop 项目级协作规则。**workspace 级通用规则**(git/PR/worktree 工作流、跨仓库顺序、提交信息总则)见上级 `../CLAUDE.md`,本文件不重复。

设计与领域不变量的事实来源是两份文档,本文件不复制,只给操作面:
- `README.md` —— 项目定位、核心约束、入口索引
- `docs/superpowers/specs/2026-05-29-pluggable-module-framework-design.md` —— 基座 ⇄ 模块契约的完整设计

## 一句话定位

可插拔模块热更新框架:稳定基座(Host)+ 在线热插拔功能模块(Module)。Electron + TypeScript,pnpm workspace monorepo,将来作为 ai-agent 的壳。

## 技术栈

- pnpm 11.4.0 workspace;Node 22;TypeScript 6,NodeNext ESM(全仓 `"type": "module"`)
- 测试 vitest 4;壳层 Electron 33 + electron-vite 2 + Vite 5 + React 18 + esbuild
- 包管理只用 pnpm,不用 npm/yarn

## 命令

根目录:

```bash
pnpm install        # 安装 + workspace 链接
pnpm build          # pnpm -r build,构建全部包
pnpm typecheck      # 全包类型检查
```

单包(用 `-F` 过滤):

```bash
pnpm -F @boundary-desktop/host test         # host 单测(vitest)
pnpm -F @boundary-desktop/host build        # 单包构建
pnpm -F @boundary-desktop/shell typecheck   # 壳层类型检查(node + web 两段)
pnpm -F @boundary-desktop/shell dev         # 起 Electron 壳(GUI;无显示环境跑不了)
pnpm -F @boundary-desktop/shell build:mods  # 构建 vendor.mjs + 各模块 dist(esbuild)
pnpm -F @boundary-desktop/shell build       # electron-vite build(main/preload/renderer 三段打包,不打包安装器)
```

测试节奏:先 `pnpm -F <改动包> test/typecheck`,再 `pnpm -r typecheck`,然后再交付。壳层运行时行为(跨进程加载、app://、import map)只能 `pnpm dev` 人工验证。

## 目录映射

- `packages/contract` —— `@boundary-desktop/contract`。契约单一事实来源:manifest / 生命周期 / 三层 ctx / tool 契约 + `defineModule` + `HOST_API_VERSION`。基座与所有模块共同依赖,改这里即改契约,谨慎。
- `packages/host` —— `@boundary-desktop/host`。基座实现:Registry / Reconciler / 模块来源(LocalDirSource、RemoteSource)/ capabilities / WS 门面。持有全部有状态资源。
- `apps/shell` —— `@boundary-desktop/shell`。Electron 壳:
  - `src/main` —— 主进程。装配 HostServices + Registry + RendererBridge,注册 IPC、app:// scheme、env profile、auth driver、createWindow
  - `src/preload` —— contextBridge 暴露 `window.hostApi`(壳用)与 `window.moduleBridge`(renderer runtime 用)
  - `src/renderer` —— React 壳(App/Login/Shell)+ `runtime.ts`(renderer 侧模块宿主)+ `tokens.css`/`styles.css` + `components/`(icons、BrandMark、nav-icons)
  - `src/shared` —— 跨进程共享:IPC 通道常量、类型
  - `scripts/build-modules.mjs` —— 模块与 vendor 的构建脚本
- `modules/<id>` —— 业务模块(chat/team/skills/tasks/canvas/browser,当前为示例 stub),依赖 contract
- `build/` —— 打包用 app 图标(icon.icns/ico/png)+ entitlements。是源资源,入库
- `docs/` —— spec

## 领域不变量(改动必须守住)

README「核心约束」是底线,改动前回读。要点:

- 基座是状态的唯一持有者;模块无状态或状态外置(热拔不留痕、插回行为一致)
- `ctx` 是基座与模块唯一合法接触面;能力归三范式(只读+订阅 / 代理动作 / 注册类自动回收)+ storage 特例,按 runtime 单维度裁剪
- tool 注册自动加 `<module.id>.` 前缀,跨模块冲突结构性不可能
- 对外协议(WS/MCP/CLI)是门面,接在 list/invoke/version 三件套上,不进核心契约;若新能力迫使核心契约反向依赖某门面/功能域,是边界划错,重做边界而非补依赖

## 壳层运行时结构事实(Phase 5,改壳必读)

这些是当前实现的硬事实,不是设计偏好:

- **Registry 在主进程**。renderer 类模块的真身实例活在 renderer;`RendererLoader` 在 main 返回一个**代理 Module**,其 activate/deactivate 经 IPC 驱动 renderer。`aid`(activation id)把 main 侧 ctx 绑到 bridge,供 renderer 回调
- **`app://` 自定义协议**(standard+secure+supportFetchAPI+stream)加载模块产物与 vendor。响应必须带 `Access-Control-Allow-Origin: *` + JS MIME,否则跨源动态 import 失败
- **React 单实例共享**:`vendor.mjs` 把 react + react-dom 打进一个 bundle;`index.html` 的 import map 把 `react` 与 `react-dom/client` 两个 specifier 都指向它。模块构建时 external 掉 react,**绝不能**让模块自带 react 副本(会「Dynamic require」崩)
- **多环境**:`BUILD_ENV` 烘焙默认 env、`BOUNDARY_ENV` 运行时覆盖,值 local/staging/prod。local 走 `LocalDirSource(modules/)`,staging/prod 走 `RemoteSource`,缓存按 env 分目录
- **导航**:入口来自 catalog,按 `ui.order` 升序;图标按 `ui.icon` 字符串映射到 lucide(`renderer/components/nav-icons.tsx`)
- **设计 token**:`tokens.css` 来自 openclaw-desktop 的设计系统(OKLCH,含 light/dark);壳层 chrome 走内联 token 样式;`build/` 图标、`brand-mark.svg`、`cover.png` 同源
- **窗口**:`titleBarStyle: "hiddenInset"`(macOS 用系统红绿灯);`sandbox: false`;preload 同步暴露 `hostApi.platform`,`main.tsx` 首帧前据此打 `platform-mac` 类
- BrowserWindow activate 流程对 React StrictMode 双调用 + catalog 异步有竞态,已用 `serializePerId` 按 id 串行化 + 幂等意图解决,别退回 check-then-act

## 工程坑

- 生成产物 `dist/` `out/` `vendor/` `node_modules/` 不手编,不入库(见 `.gitignore`);`build/`(app 图标)要入库
- pnpm 11 默认拦截依赖构建脚本;electron/esbuild 已在 `pnpm-workspace.yaml` 放行(`onlyBuiltDependencies` + `allowBuilds`)
- electron 二进制走 `.npmrc` 的 npmmirror 镜像下载
- 改模块源码后要 `build:mods` 重出 `modules/<id>/dist`,壳才加载到新产物;`dev` 的 `predev` 会先跑一次

## 提交约定

沿用 Conventional Commits `<type>(<scope>): description`。本仓 scope:`contract`、`host`、`shell`、`modules`(或具体模块 id 如 `chat`)、`docs`、`build`。

文档简体中文、无 emoji、只写当前状态(理由进 commit message / PR 描述)。
