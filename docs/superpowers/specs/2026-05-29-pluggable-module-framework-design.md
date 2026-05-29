# 可插拔模块热更新框架设计：基座 + 模块契约

状态：草案，待 review。本文描述目标状态，不描述迁移过程中的临时形态。

## 1. 背景与目标

客户端基于 Electron，业务功能需高频迭代而不必整包重发、不打断用户当前会话。部分功能（对外暴露可调用的 tool、操控浏览器页面等）依赖常驻的有状态资源，这些资源不随功能模块的加载卸载而重建。

本框架是 ai-agent `docs/superpowers/specs/2026-05-29-electron-shell-design.md` 的**泛化升级**：从"`app://` 在线热更 UI（整页 reload 式）"扩成"基座（Host）+ 可插拔模块（Module）热插拔框架"。将来作为 ai-agent 的壳子——ai-agent 作为 main 子系统挂在 `MainContext`，或本身被壳托管，框架核心对它不感知。

核心思路：把"稳定的壳子"与"高频变化的功能"解耦，功能以可在线下载、运行时热插拔的模块形式存在。

目标：

- 功能以**模块**为单位，支持在线下载、运行时加载、热替换、热卸载，全程不重启、不断开常驻连接。
- 对模块开发者暴露**单一的模块概念**——无论功能跑在主进程还是渲染进程，面对同一套清单、同一组生命周期钩子。
- 所有有状态、长生命周期的资源集中由**基座**持有，模块无状态、可丢弃。
- 对外通信协议（WebSocket / MCP / CLI 等）是**可替换的边缘**，不进入核心契约。

非目标：

- 不面向第三方 / 不可信模块。模块全部由内部团队开发。
- 不追求对外协议的标准化互操作性（自有生态，两端均自控）。
- 不在本框架内实现具体功能域的业务逻辑（浏览器操控等作为模块或基座子系统存在，不属于框架核心）。

## 2. 设计原则

- **基座是状态的唯一持有者。** 一切有状态、长生命周期的资源（连接、会话、页面句柄、登录态、注册表）只存在于基座。这是整个设计的轴心。
- **模块无状态或状态外置。** 模块不持有上述资源，只通过基座注入的 `ctx` 操作它们。检验标准：把一个模块热拔掉不留痕迹，插回去行为一致。
- **统一契约，差异下沉。** 对上提供单一模块抽象；运行环境（主进程能力 vs 渲染 UI）的差异收敛到底层加载器与 `ctx` 裁剪里，模块开发者不感知。
- **核心稳定，边缘可替换。** 对外协议、具体功能域都是接在核心上的适配器/门面，可替换、可增量，不反向侵入核心契约。

## 3. 架构总览

```
            外部 Agent / 脚本（自有生态）
                     │  对外协议（WS / MCP / CLI —— 可替换门面）
                     ▼
┌──────────────────────────────────────────────────────────┐
│  Host（基座）                                                │
│   · 持有全部有状态资源，经 ctx 注入给模块                      │
│   · ModuleRegistry   生命周期状态机 + 全局注册表              │
│   · Loader 适配层     按 runtime 选择加载方式                 │
│   · 对外门面          把注册表的 list/invoke/version 暴露出去  │
└───────────────┬──────────────────────────────────────────┘
                │ 加载 + 注入 ctx
        ┌───────┴────────────────┐
        ▼                        ▼
┌────────────────┐      ┌────────────────┐
│ 主进程能力模块   │      │ 渲染层 UI 模块   │   …可扩展更多 runtime
│ runtime: main   │      │ runtime:renderer│
└────────────────┘      └────────────────┘
        共同遵守：manifest + activate(ctx)/deactivate()
```

进程划分：基座的有状态部分（注册表、连接、浏览器/CDP 等子系统）在**主进程**；渲染层 UI 模块在**渲染进程**，经受控的 hostApi（contextBridge）与主进程通信，不直接持有主进程资源。

## 4. 核心概念

### 4.1 模块

模块是"声明 + 纯逻辑"的包，只有两部分：

- **清单（manifest）**：自描述身份、版本、运行环境、所需基座版本、产物位置与完整性，以及可选展示元信息（见 4.2）。
- **两个生命周期钩子**：`activate(ctx)` 中用基座注入的能力注册副作用、读初始共享状态、挂订阅；`deactivate()` 中清理模块自己产生的本地资源。理想情况下 `deactivate` 接近为空——通过 `ctx` 注册的副作用由基座按命名空间自动回收（见第 7 节）。

### 4.2 清单：运行字段与展示字段分离

运行字段（`id`/`version`/`runtime`/`hostApiVersion`/`entry`/`integrity`）是框架加载所必需；展示字段集中在可选的 `ui` 块（`displayName`/`icon`/`description`），仅用于基座渲染模块入口，框架加载逻辑不读取。

`ui` 可选：无 UI 入口的纯能力模块（只注册 tool、不在界面露出）无需填写。展示元信息放清单而非打进产物，使基座能在**模块激活之前**（如在入口列表里展示"可用未激活"的模块）就渲染它，此时产物代码尚未加载。

### 4.3 基座的四项职责

由"状态唯一持有者"推导：**持有运行环境与加载适配**（Loader）、**持有全局注册表**（tool 等注册物集中登记、带命名空间、生命周期到期回收）、**驱动模块生命周期状态机**（加载/激活/卸载/替换是受控迁移）、**向模块注入能力**（ctx，按 runtime 裁剪）。

## 5. 模块生命周期

### 5.1 状态机

```
Discovered → Resolved → Fetched → Loaded → Active → Inactive → Unloaded
   拿到       版本契约    下载+      代码     注册     撤销       释放
   清单       校验通过    验签通过   入内存   副作用   副作用     实例
```

四种操作对应受控迁移：加载（→ Loaded，代码就位但不生效，可预热）、激活（→ Active）、卸载（→ Unloaded）、替换（见 5.2）。

### 5.2 热替换：先起后落

替换运行中的模块，采用先起后落以压缩不可用窗口：新版本独立走完到 Loaded（下载、验签、入内存，不影响旧版本）→ 新版本 `activate` → 旧版本 `deactivate` → 释放旧实例。切换由 Registry 串行保证，对外表现为功能从旧逻辑无缝切到新逻辑。

### 5.3 状态外置 + 在途任务 drain

**状态外置**让替换干净：模块不持有底层资源，`deactivate` 时没有句柄要清理，换模块如换映射表而非重建管道。

**在途任务 drain**：替换/卸载前，正在执行且属于旧模块的调用，要么等其完成、要么明确失败，不得在 `deactivate` 时丢弃。drain 是**基座私有实现**——Registry 维护每个模块的 in-flight invocation 账本，在 Active → Inactive 这步先等其清零（或超时强失败）再调 `module.deactivate`。它不进契约、不作为模块钩子暴露，模块对 drain 无感。

## 6. 模块来源与开发期支持

模块的**来源**与其**加载机制**解耦：加载机制（Loader + 生命周期 + ctx 注入）恒定，来源可多种。引入 `ModuleSource` 抽象，各来源分别实现；Loader、ctx、生命周期一律不感知来源差异，只拿到"一个可加载的本地产物路径"。

### 6.1 单一 catalog：所有模块从一个清单文件登记

线上**不是**每个模块各有一个 manifest URL，而是**一个单一的清单文件（catalog）**列出全部模块。基座只拉这一个文件，就拿到所有模块的注册信息。

三个概念分清：

- **`ModuleManifest`**：单个模块的自描述（id/version/runtime/hostApiVersion/entry/integrity/ui）。
- **catalog**：那个单一在线文件，`{ version, modules: ModuleManifest[] }`——所有模块的 manifest 汇成一张表，外加一个 catalog 版本号。
- **`ModuleRegistry`**：基座内部的运行时生命周期状态机（第 5 节），不是这个在线文件。

`ModuleSource` 据此分两个职责：

```
catalog(): Promise<{ version: string; modules: ModuleManifest[] }>   拉那一个清单文件，列出全部模块
fetchArtifact(manifest): Promise<string>                             取某模块产物到本地，返回本地路径
```

`fetchArtifact` 插在生命周期的 Fetched 步之前，其余阶段不变。

### 6.2 catalog = 期望态，Registry = 实际态，基座做对账

catalog 是**期望态**（应存在哪些模块、各自哪个版本），Registry 是**实际态**。基座拉到 catalog 后与当前 live 模块集 diff，做对账（reconcile）：

- catalog 有、Registry 无 → install（并激活，见下）。
- 两边都有但版本变了 → replace（先起后落，第 5.2 节）。
- Registry 有、catalog 没了 → uninstall。

首版语义：**catalog = 期望激活集**，对账后把表内模块全部拉到 active；"可用未激活"（第 4.2 节的入口列表 UX）留到有需求再加，首版不引入激活策略字段。

catalog 的 `version` 字段是对账触发器：基座按间隔轮询这一个文件（复用 electron-shell 的 `version.json` 轮询模式），`version` 变即重新拉取 + 对账。一个文件、一次轮询，驱动全部模块的增删换。

### 6.3 三种来源

| 来源 | 场景 | catalog 与产物获取 |
|---|---|---|
| 远程 CDN | 生产 | 从清单服务拉签名 catalog，从 CDN 下载各模块产物 |
| 本地目录 | 开发 | 扫描配置的本地模块目录，现拼出一份 catalog；产物指向 dev 构建输出 |
| 本地 dev server | 开发（热重载） | catalog 指向 `http://localhost:xxxx`，连本地构建服务 |

本地目录来源：基座按开发模式配置（环境变量或 dev 配置）扫描指定目录、读各模块 manifest 拼成 catalog，与线上同样走对账登记进 Registry。

### 6.4 热重载（HMR）

本地 dev server（如 Vite）watch 文件变化并自动重建。基座 dev 模式监听其变更信号（或直接 watch 本地产物文件 / catalog），变更即触发对账 → 该模块热替换。保存文件后秒级在运行中的客户端看到模块更新。生产环境用热替换做灰度/热更，开发环境用它做 HMR，同一机制两种用途。

### 6.5 校验：签 catalog 一次，覆盖全部

签名收口到 catalog 这一个文件：对整份 catalog 签名一次，即覆盖所有模块的 entry URL 与各自 `integrity`，无需给每个 manifest 分别签。客户端先验 catalog 签名，再按每条 entry 的 `integrity` 校验下载下来的产物。

完整性校验与签名仅对远程来源强制；本地来源（无 CDN 的 hash/签名）跳过。该放宽只在 dev build 中允许，release build 对本地来源直接拒绝，防止"跳过校验"的口子流入生产。

## 7. 能力注入：ctx 的三种范式

`ctx` 是基座与模块唯一的合法接触面，模块能做的一切都经由它。所有能力归入三种范式加一个特例，新增能力都应归入某一类并照其范式实现。完整接口见 `packages/contract/src/contract.ts`。

### 7.1 共享状态类（只读 + 订阅）

基座持有的全局状态，模块只读、不可写。统一形态为 `get()`（读快照）+ `subscribe()`（订阅变化，返回句柄绑生命周期自动退订）。模块不缓存快照，要用时读、变了被通知。代表：`auth`、`config`、`network`、`theme`（渲染层）。只读是结构性的——这些能力在类型上没有 set 方法；写操作（如登录/登出）归入代理动作类。

### 7.2 代理动作类（请求基座代办）

需统一管控的动作，经基座代办：

- `api.request`：调自有后端时由基座代发，自动加 token、base URL、鉴权刷新。
- `auth.requestLogin / requestLogout`：请基座弹出可信登录流程，OAuth/密码流程由基座完成。
- `notify`、`navigate`（渲染层）、`log/track`、`invokeTool`（调用任意已注册 tool，模块间通信经基座路由，不互相直连）。

模块自主发请求（第三方 API、流式响应、自定义请求库等）时，经 `auth.getToken()` 同步拿当前 token、`auth.get()` 拿用户信息快照，自己发请求自己带凭证。基座在凭证供给上保持实时性（token 刷新/吊销后下次取到即最新），模块约定现取不长期缓存。

### 7.3 注册类（贡献 + 自动回收）

模块向系统贡献东西，返回 `Disposable` 句柄；句柄由基座绑定到模块生命周期，`deactivate` 时自动回收，模块通常无需手动注销。代表：`registerTool`、`registerView`/`registerMenuItem`（渲染层 UI 贡献）、`on`（事件订阅）。

### 7.4 特例：storage（私有持久）

模块持有持久状态的唯一途径：数据落在基座管理的存储里，按模块 `id` **命名空间隔离**，模块间互不可见。热替换后新版本用同一命名空间读回。凭证不入 storage，经 `auth` 现取现用。

### 7.5 能力面全景

| 范式 | 能力 | 首版必要性 |
|---|---|---|
| 共享状态 | auth | 必备 |
| 共享状态 | config / network / theme | 高 / 中高 / 渲染层必备 |
| 代理动作 | api.request | 必备 |
| 代理动作 | notify | 高 |
| 代理动作 | navigate / log / invokeTool | 中 |
| 注册类 | registerTool | 必备 |
| 注册类 | registerView / registerMenuItem | 渲染层必备 |
| 注册类 | on（事件） | 中 |
| 私有持久 | storage | 高 |

首版以 auth + storage + api.request + notify + registerTool/registerView 即可跑通一个完整模块，其余按实际模块需求增量加。

### 7.6 ctx 按 runtime 裁剪

ctx 按 runtime 单一维度裁剪：`BaseContext`（所有模块共有）→ `RendererContext`（增 container/theme/navigate/registerView 等）/ `MainContext`（增功能子系统，如浏览器操控）。同一 runtime 的模块拿到的 ctx 形状一致。

## 8. 模块加载机制（按 runtime）

Loader 适配层把"代码在某 runtime 下变成 Module 实例"的脏活收口。来源抽象产出"一个本地产物路径"后，按 runtime 分两条加载路径：

### 8.1 main 模块：Node 直接 import

主进程模块的产物落本地后，主进程 `import()` 本地文件即得 Module 实例。main 模块拥有完整 Node 能力（信任边界见第 13 节）。

### 8.2 renderer 模块：app:// 自定义协议 + 落本地再 import

渲染窗口开 `contextIsolation`、关 `nodeIntegration`，无法直接 `import()` 远程 https URL（撞 CSP，且远程 origin 不可控）。加载路径：

```
下载产物 → 校验 integrity → 落本地缓存目录 → renderer import('app://modules/<id>/<version>/entry.js')
```

- 基座用 `protocol.handle('app', handler)` 把 `app://modules/<id>/<version>/<path>` 映射到本地缓存目录的对应文件。
- 渲染层动态 `import('app://...')` 执行模块代码。`app://` 是稳定、安全的本地 origin，绕开远程 https import 的 CSP 限制，又保留"先校验后执行"。
- CSP 的 `script-src` 放行 `app:` scheme。
- 与 electron-shell 设计里 UI 在线热更用的 `app://app` 是同一套 scheme 机制，本框架将其推广到模块产物。

新增隔离级别（如进程级 webview）= 新增一个 Loader，上层与模块契约都不动。

## 9. tool 子系统

### 9.1 tool 注册是横切能力

任何模块（无论 runtime）都可能把功能暴露成可调用 tool。tool 注册是 `ctx.registerTool` 这一横切能力，与"模块跑在哪"正交。全局 tool 注册表唯一，集中在主进程（对外门面与变更通知都从这里出）。

### 9.2 命名空间：冲突结构性消除

基座在 `registerTool` 时用模块 `id` 自动给 tool 名加前缀，登记为 `<module.id>.<name>`；模块只写裸名，无法触及或伪造前缀。于是：

- **跨模块冲突结构性不可能**——tool 唯一性来自模块 id 唯一性（由清单服务保证），基座无需去重逻辑。
- **模块内重名**在注册时检测到 `<id>.<name>` 已存在，直接抛错、激活失败、日志点名。
- **热替换回收**靠前缀匹配：撤销某模块即移除所有 `<module.id>.` 开头的 tool，不漏不误删。

### 9.3 跨进程路由对模块透明

注册时记录 tool 来源（runtime）。被调用时：主进程模块的 handler 本地直接执行；渲染层模块的 handler 由基座经 IPC 转发到渲染进程执行、结果回传。模块写 handler 时当作本地调用，跨进程细节由基座承担。

## 10. 对外门面

### 10.1 核心契约：三件套

注册表对门面只暴露三个动作：**list**（列出当前 tool 及 schema）、**invoke(name, args)**（调用，内部按来源路由）、**version / 变更通知**（tool 集合随模块热更新变化时的对账依据）。任何门面都映射到这三件套。

### 10.2 门面可替换

MCP、WebSocket、CLI 都是接在三件套上的门面，可并存、可替换、可增量。模块系统、命名空间、跨进程路由均不随门面变化。

### 10.3 默认门面：WebSocket

- 传输用 **WebSocket**（长连接、双向、低开销、本机/跨机皆可）。
- 协议极简：`{id, type, name, args}`，`id` 用于异步请求/响应配对，`type` 区分 invoke/list/result/error/变更通知。
- tool 变更走**主动推送**（WS 双向），`version` 字段作断线重连后的对账兜底。

需对外开放或接入标准 Agent 生态时，增加一个 MCP 门面接到同一三件套即可。

## 11. 版本契约与兼容性

模块清单声明 `hostApiVersion`（所需基座能力版本范围，semver）；基座在 Resolved 阶段比对自身版本，不满足则拒绝加载并提示升级客户端。模块对 `@boundary-desktop/contract` 的依赖版本范围，就是其 manifest 中 `hostApiVersion` 的声明。

契约包是纯类型，types-only 包在运行期为空，无法被读出"实现了哪个版本"。为此契约包额外导出运行期常量 `HOST_API_VERSION`（与本包 `version` 同步演进），作为基座做 semver 比对的基准。这是版本闸门唯一的运行期出口。

发版纪律：基座能力升级走应用整体更新（低频、可能重启），模块走热更新（高频）。模块要用尚未提供的新能力时，先升基座、再发模块；`hostApiVersion` 闸门是这条纪律的技术兜底。

## 12. 工程组织

### 12.1 契约独立成包：@boundary-desktop/contract

manifest 格式、生命周期钩子、ctx 三种范式的全部接口，构成基座与所有模块的共同契约，独立发布为一个包，作为单一事实来源。基座依赖它（实现这些接口），每个模块依赖它（面向接口编程）。

该包**只含类型/接口与极少运行时辅助**（`defineModule` 帮助函数、`HOST_API_VERSION` 常量），不含任何 ctx 能力的实现。`auth`/`api`/`registerTool` 等的实现在基座，运行时由基座在 `activate(ctx)` 注入；模块编译期依赖契约包拿类型，运行期从基座拿实现。模块产物因此不打包基座实现代码，基座也能在接口不变前提下替换实现而模块无感。

### 12.2 monorepo 结构

```
boundary-desktop/                  (pnpm workspace)
├─ packages/
│  ├─ contract/                    @boundary-desktop/contract  —— 契约（类型 + 运行期辅助）
│  └─ host/                        @boundary-desktop/host      —— 基座（实现 contract）
└─ modules/                        业务模块（与 packages 平级）
   ├─ browser/                     @boundary-desktop/module-browser
   └─ .../                         各模块，均依赖 @boundary-desktop/contract
```

`pnpm-workspace.yaml` 中 `packages:` 列出 `"packages/*"` 与 `"modules/*"`，二者平级。本地开发模块以 workspace 方式引用契约包，无需发包联动。契约改动可立即在基座与所有模块中暴露类型错误、一次改完。将来模块多、团队分散需拆多仓时，契约包已独立，直接发布即可。

### 12.3 共享依赖

框架级重型依赖（渲染框架等）设为 external、由基座统一提供，模块不各自打包，避免多副本与版本不一致。模块自身的纯工具依赖走正常 npm 声明，或置于 monorepo 共享 package。

## 13. 安全

- **验签。** 完整性：清单携带产物 hash（`integrity`），主进程下载后比对。来源：对清单签名，客户端验签，防 CDN 被入侵后替换产物。
- **main 模块信任边界。** main 模块运行在主进程、拥有完整 Node 能力，唯一闸门是 integrity + 签名校验。blast radius 写明：签名私钥泄漏 = 主进程任意代码执行。这条边界依赖"仅内部可信模块"（非目标）的假设承重——本框架不为 main 模块提供沙箱，签名链是唯一防线，私钥管理按最高等级对待。
- **runtime 隔离。** 渲染层加载远程代码的窗口开 `contextIsolation`、关 `nodeIntegration`，能力只经 hostApi 受控暴露。
- **展示内容 sanitize。** 清单里的 icon 等是远程内容；内联 SVG 可内嵌脚本。优先用内置图标名，内联 SVG 须 sanitize 或仅以 `<img src=data:>` 渲染。

## 14. 模块形态示例

一个 main 模块（对外协议无关，MCP/WS/CLI 都只是门面）：

```ts
import { defineModule, type MainContext } from "@boundary-desktop/contract";

export default defineModule<MainContext>({
  async activate(ctx) {
    // 注册 tool —— 传裸名，基座登记为 `<id>.fetchTitle`，卸载自动回收
    ctx.registerTool({
      name: "fetchTitle",
      schema: { type: "object", properties: { url: { type: "string" } } },
      async handler(args) {
        const { url } = args as { url: string };
        // 用基座持有的浏览器子系统，不自己持有页面句柄
        const { pageId } = await ctx.browser!.open(url);
        const shot = await ctx.browser!.screenshot(pageId);
        await ctx.browser!.close(pageId);
        await ctx.api.request({ method: "POST", path: "/log", body: { url } });
        return { screenshot: shot };
      },
    });

    // 跟随登录态：读快照 + 订阅，订阅句柄随 deactivate 自动退订
    if (!ctx.auth.get().authenticated) await ctx.auth.requestLogin();
    ctx.auth.subscribe((s) => ctx.log.info("auth changed", { user: s.user?.id }));
  },
  // 没写 deactivate：tool 注册、auth 订阅都由基座按 id 自动回收
});
```

## 15. 待定决策

- renderer 模块产物缓存目录的清理策略（跨版本累积，按 mtime LRU 或总大小封顶裁剪）。
- 模块 manifest 的清单服务形态与 `id` 唯一性保证机制。
- `on(event)` 的系统事件目录（哪些离散事件向模块开放）。

## 16. 分阶段

1. **契约包**：`@boundary-desktop/contract` 落地——manifest / 生命周期 / ctx 三层 / tool 契约 + `HOST_API_VERSION` + `defineModule`。验证：类型完整、运行期导出可用。（已完成）
2. **基座核心**：`ModuleRegistry` 生命周期状态机 + 全局 tool 注册表（命名空间前缀）+ in-flight drain 账本。验证：本地目录来源的 main 模块走 install→activate→replace→deactivate 全程，tool 注册/回收/重名检测正确。
3. **ctx 注入 + main 加载**：BaseContext 实现（auth/storage/api.request/notify/registerTool）+ main Loader（Node import 本地文件）。验证：示例 main 模块激活后 tool 可被调用。
4. **对外 WS 门面**：list / invoke / version 三件套 + 变更主动推送。验证：外部 WS 客户端 list 到 tool、invoke 成功、模块热替换后收到变更通知。
5. **renderer 加载 + UI 贡献**：`app://` 协议 + 落本地 import + RendererContext（container/theme/registerView）+ 跨进程 tool 路由。验证：renderer 模块挂载视图、其 tool 经 IPC 路由可调。
6. **远程来源 + catalog 对账**：CDN 来源（单一签名 catalog + 各产物 integrity）+ catalog 轮询/对账（install/replace/uninstall）+ dev 本地来源 HMR。验证：拉 catalog 验签、按 diff 增删换模块、灰度热替换不断连接；本地保存文件秒级热重载。

## 17. 验证标准（汇总）

- 契约包：类型完整覆盖 manifest / 生命周期 / 三层 ctx / tool；运行期 `import` 拿到 `HOST_API_VERSION` 与 `defineModule`。
- 生命周期：模块走完状态机各受控迁移；热替换先起后落，切换期对外功能无中断；drain 保证在途调用不被丢弃。
- 命名空间：跨模块同裸名 tool 不冲突；模块内重名注册时抛错；卸载按前缀回收无残留。
- main 加载：本地产物 Node import 成模块，tool 本地直接执行。
- renderer 加载：`app://modules/<id>/<version>/entry.js` import 成模块，origin 稳定，CSP 放行；其 tool 经 IPC 路由被调用、结果回传。
- 门面：外部 WS 客户端 list / invoke / 收变更推送；`version` 断线重连后对账正确。
- 版本闸门：`hostApiVersion` 不满足时拒绝加载并提示升级。
- 安全：远程产物 integrity 比对失败拒绝加载；清单签名校验失败拒绝；release build 拒绝本地无验签来源。
