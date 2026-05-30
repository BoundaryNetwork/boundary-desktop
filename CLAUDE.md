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
pnpm build:mods     # 模块工具链:构建 vendor.mjs + 自动发现各模块构建 dist(esbuild)
pnpm pack:mods <staging|prod>  # 发布:算 integrity + 生成 catalog.json → out/publish/<env>
pnpm clean          # 清构建产物(dist/out/out-tsc/vendor/*.tsbuildinfo;不动 node_modules)
```

模块的构建/发布是 **workspace 级**(脚本在根 `scripts/`,根 `package.json` 暴露),不归属任何具体宿主——shell 只是模块的消费者。vendor 是宿主共享产物,产出到 `apps/shell/vendor` 供其 serve。

单包(用 `-F` 过滤):

```bash
pnpm -F @boundary-desktop/host test         # host 单测(vitest)
pnpm -F @boundary-desktop/host build        # 单包构建
pnpm -F @boundary-desktop/shell typecheck   # 壳层类型检查(node + web 两段)
pnpm -F @boundary-desktop/shell dev         # 起 Electron 壳(GUI;无显示环境跑不了);predev 委派根 build:mods
pnpm -F @boundary-desktop/shell build       # electron-vite build(main/preload/renderer 三段打包,不打包安装器)
```

测试节奏:先 `pnpm -F <改动包> test/typecheck`,再 `pnpm -r typecheck`,然后再交付。壳层运行时行为(跨进程加载、app://、import map)只能 `pnpm dev` 人工验证。

## 目录映射

- `packages/contract` —— `@boundary-desktop/contract`。契约单一事实来源:manifest / 生命周期 / 三层 ctx / tool 契约 + `defineModule` + `HOST_API_VERSION`。基座与所有模块共同依赖,改这里即改契约,谨慎。
- `packages/host` —— `@boundary-desktop/host`。基座实现:Registry / Reconciler / 模块来源(LocalDirSource、RemoteSource)/ capabilities / WS 门面。持有全部有状态资源。
- `packages/ui` —— `@boundary-desktop/ui`。**样式契约包**(纯 CSS):`tokens.css`(token)+ `design-system.css`(`bd-*`)+ 聚合 `styles.css`。与 contract 平级——发布契约不归属任何具体宿主。
- `apps/shell` —— `@boundary-desktop/shell`。Electron 壳:
  - `src/main` —— 主进程。装配 HostServices + Registry + RendererBridge,注册 IPC、app:// scheme、env profile、auth driver、createWindow
  - `src/preload` —— contextBridge 暴露 `window.hostApi`(壳用)与 `window.moduleBridge`(renderer runtime 用)
  - `src/renderer` —— React 壳(App/Login/Shell)+ `runtime.ts`(renderer 侧模块宿主)+ `styles.css`(仅壳自身 chrome;样式契约从 `@boundary-desktop/ui` import)+ `components/`(icons、BrandMark、nav-icons、SettingsModal)
  - `src/shared` —— 跨进程共享:IPC 通道常量、类型
  - `vendor/` —— 共享 React 产物(app:// import map 指向),由根 `build:mods` 产出(gitignore)
- `module-envs.json`(仓库根)—— env → CDN base 单一事实源;`env.ts` import(客户端拉 catalog)、根 `pack:mods` 读(发布写 entry)。是模块分发的部署配置,workspace 级,不归属 shell
- `scripts/` —— **workspace 级模块工具链**:`build-modules.mjs`(vendor + 各模块构建)、`pack-modules.mjs`(发布 catalog)。根 `package.json` 暴露 `build:mods`/`pack:mods`;不归属 shell(shell 是消费者)
- `modules/<id>` —— 业务模块(chat/team/skills/tasks/canvas/browser,当前为示例 stub),**各自标准包,统一 `src/index.ts(x)` → 构建出 `dist/index.mjs`**,依赖 contract
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
- **样式契约 = `@boundary-desktop/ui` 包(`packages/ui`,纯 CSS,发布契约,不归属壳)**:
  1. **token**(`tokens.css`,来自 openclaw 设计系统,OKLCH 含 light/dark)—— 变量,强制地基,框架无关
  2. **设计系统类 `bd-*`**(`design-system.css`)—— 组件/工具类(bd-btn/bd-input/bd-textarea/bd-field/bd-card/bd-row/bd-entry/bd-navitem/bd-segmented/bd-chip/bd-badge/bd-empty…),建在 token 上。CSS 类层故意选 class 而非 React 组件:纯 DOM 模块也能 `class="bd-card"`
  - 壳 `main.tsx` import `@boundary-desktop/ui/styles.css` 全局加载,自动覆盖模块容器 DOM;模块按 class 名消费,运行时无需声明依赖。壳自身 chrome(reset/滚动条/`.moduleview`/`.content__placeholder`)留 `apps/shell/styles.css`,非契约
  - **归属规范**:`@boundary-desktop/ui` 独占 token + `bd-*`(版本随 `HOST_API_VERSION`)。模块可用 token、用 `bd-*`、为专属布局加**模块作用域**样式(scoped 根类或内联);**不得**定义全局类、**不得**覆写 `bd-*`、**不得**把私有组件类塞进契约包或壳。泄漏 vs 契约的区别在归属不在位置
  - 示范:`SettingsModal` 全走 `bd-*`;chat 模块公共控件用 `bd-*`、对话专属布局内联;5 个 stub 用 `bd-empty`
- `build/` 图标、`brand-mark.svg`、`cover.png` 来自 openclaw 同源
- **窗口**:`titleBarStyle: "hiddenInset"`(macOS 用系统红绿灯);`sandbox: false`;preload 同步暴露 `hostApi.platform`,`main.tsx` 首帧前据此打 `platform-mac` 类
- BrowserWindow activate 流程对 React StrictMode 双调用 + catalog 异步有竞态,已用 `serializePerId` 按 id 串行化 + 幂等意图解决,别退回 check-then-act

## 工程坑

- 生成产物 `dist/` `out/` `vendor/` `node_modules/` 不手编,不入库(见 `.gitignore`);`build/`(app 图标)要入库
- pnpm 11 默认拦截依赖构建脚本;electron/esbuild 已在 `pnpm-workspace.yaml` 放行(`onlyBuiltDependencies` + `allowBuilds`)
- electron 二进制走 `.npmrc` 的 npmmirror 镜像下载
- 改模块源码后要 `build:mods` 重出 `modules/<id>/dist`,壳才加载到新产物;`dev` 的 `predev` 会先跑一次
- 模块形态统一:每个模块都有 `src/index.tsx`(React)或 `src/index.ts`(纯 DOM),`build:mods` 自动发现全部 `modules/*`、走 esbuild 出 `dist/index.mjs`(external react),不硬编码模块名;缺 `src/index.tsx|ts` 直接报错
- 发布走 `pack:mods <staging|prod>`:跑完 build 后逐模块算 `sha256` 填 `integrity`、`entry` 改写为 `<base>/<id>@<version>.mjs`、汇成单一 `catalog.json`(`{version, modules[]}`,`version` 用 sorted(id+version) 的 sha256,与 host `manifestsHash` 同算)→ `out/publish/<env>`(workspace 级产物,非 shell,按 env 分目录)。`manifest.json` 里 `entry`(本地相对路径)+ `integrity`("") 是 dev/LocalDirSource 用,发布派生远程版本,不手填 hash
- **staging/prod 的唯一区别是地址**,产物字节相同。`base` 取自仓库根 `module-envs.json`(`env → CDN base` 的**单一事实源**,workspace 级、非 shell):客户端 `env.ts` 从 `<base>/catalog.json` 拉、发布往 `<base>` 写,同一份配置两侧共用,不在发布侧另写地址表。改 CDN 地址只动这一个文件。`module-envs.json` 经 `import ... with { type: "json" }` 烘焙进主进程产物(NodeNext 强制该属性)

## 提交约定

沿用 Conventional Commits `<type>(<scope>): description`。本仓 scope:`contract`、`host`、`ui`、`shell`、`modules`(或具体模块 id 如 `chat`)、`docs`、`build`。

文档简体中文、无 emoji、只写当前状态(理由进 commit message / PR 描述)。
