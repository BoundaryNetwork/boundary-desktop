# 浏览器模块移植设计(从 openclaw-desktop 移植 browser 能力)

把 openclaw-desktop 的浏览器能力(自定义 tab 管理 + 自动化)移植到 `modules/browser`,作为一个**自包含的 main-runtime 模块**。本文锁定架构与契约改动,实现细节随各阶段细化。

## 1. 锁定的决策

- **子系统完全自包含在模块内**:`WebContentsView`(含 chrome) / CDP 会话 / 自动化引擎 / runner / 内置脚本,全部由 `modules/browser` 自己持有。**`packages/host` 与 `apps/shell` 不含任何浏览器代码**。
- **能力只经 `ctx.registerTool` 暴露**:`browser.*` / `automation.*` 工具,由既有 WS/MCP/CLI facade 统一 list/invoke。**不引入 `ctx.browser` / `BrowserSubsystem`**(删除契约里的草图)。openclaw 自带的 `mcp-server.ts` 丢弃。
- **框架只把"右侧区域(100%)"交给子系统**:本项目左右布局(`68px rail | 1fr content`),框架给模块一个 UI 区域(content 区,100%),模块在区域内自由组合 toolbar / tab / 菜单 / 网页 view —— 这些都是**子系统内部内容**,框架不感知。
- **样式 = 本项目,布局 = 抄 openclaw**:子系统内部的 chrome 用 `@boundary-desktop/ui` 的 token + `bd-*`,布局与交互照抄 openclaw。
- **automation 脚本随模块打包**:DSL 脚本(`.json`)内置在 `modules/browser` 里,模块自己加载执行,不单独指定路径。
- **状态归属**:遵循收窄后的不变量(见 README)——共享/框架状态在 host;模块持有自己的私有功能子系统,deactivate 时彻底销毁(热拔不留痕)。
- **Electron 已升到 38**(openclaw 基线;`apps/shell` 现为 electron 42.3.0,dev/build 已验)。

## 2. 架构

```
框架(packages/host + apps/shell)
  持有:窗口、共享态、注册表、左右布局
  交给模块:一个 UI 区域(右侧 content 区,100%)= MainContext.surface
  —— 不含任何浏览器代码

modules/browser(main-runtime,自包含)
  own:WebContentsView(toolbar chrome 视图 + 每 tab content 视图)、
       CDP 会话、AutomationEngine/DslEngine/Runner、内置脚本 .json
  渲染:经 surface 拿区域 bounds → 把自己的 view 挂进去、铺满右侧
       (toolbar/tab/菜单的布局是模块内部的事,抄 openclaw,样式用 bd-*)
  暴露:ctx.registerTool 注册 browser.* / automation.*
       (main-runtime,handler 在主进程直接驱动自己的 view/engine,无跨进程 bounce)
  deactivate:销毁全部 view/run、摘除 surface → 热拔不留痕
```

要点:
- **main-runtime 是必然**:网页 tab 是主进程 native `WebContentsView`,只有主进程代码能创建/持有;host 又不碰浏览器,所以模块必须在主进程(main)里自己持有。
- **工具 handler 不再 bounce**:模块在主进程,`browser.click` 等 handler 直接调自己的引擎,不经渲染进程往返。
- **chrome 是子系统内容**:toolbar/tab 条/地址栏/菜单是模块自带的 renderer 页(载入自己的 `WebContentsView`),`import "@boundary-desktop/ui/styles.css"` 取样式,主题经 surface 下发。框架不知道有 toolbar 这回事。

### 2.1 surface 与区域

- 框架按左右布局算出右侧 content 区矩形,经 `MainContext.surface.bounds`(只读 + 订阅)给模块;窗口 resize / 布局变化即更新。
- 模块创建 native view,经 `surface.attach(view)` 挂到宿主窗口的该区域(框架管 z-order 与回收);view 在 bounds 内的内部布局由模块定。
- **多模块可并发 active;"前台"是另一维度**。模块 active(运行中、tool/订阅在线)≠ 在前台显示;rail 切换只换**前台模块**,不 deactivate(模块留活,后台 tab 继续跑)。`surface.visible` = 本模块当前是否前台(主窗前台 / 或自己的 detached 窗);非前台的 active 模块,框架令其 view 隐藏(`setVisible(false)`)而模块仍活、资源不销毁。
- shell 主窗 content 区一次显示一个前台模块;若前台是 main 模块(native view 覆盖该区),shell 渲染空占位垫底。

## 3. 契约改动(`packages/contract`,`HOST_API_VERSION` 0.1.0 → 0.2.0)

### 3.1 删除

现有的 `BrowserSubsystem` 接口与 `MainContext.browser` 字段**整段删除** —— 浏览器能力不走 ctx 能力面,只走 tool。(严格说删公开类型是破坏性变更,但二者从未被实现/消费,故并入 0.2.0 minor 即可。)

### 3.2 新增:`MainContext.surface`(通用,非浏览器专属)

给 main-runtime 模块一个 UI 区域,让它能在主进程渲染 native 内容。任何需要原生 UI 的 main 模块都可用,框架不含功能语义。

```ts
export interface Rect { x: number; y: number; width: number; height: number; }

/** 框架分配给 main 模块的 UI 区域(本项目左右布局里的右侧 content 区;可分离为独立窗口)。 */
export interface ModuleSurface {
  /** 区域在宿主窗口内容区的矩形(DIP,非屏幕坐标),随 resize / 布局 / detach 变化更新。 */
  readonly bounds: ReadableState<Rect>;
  /** 模块是否当前可见(active)。非可见时模块应隐藏其 view。 */
  readonly visible: ReadableState<boolean>;
  /** 主题,模块 chrome 跟随。 */
  readonly theme: ReadableState<"light" | "dark">;
  /** 当前是否已分离为独立窗口。 */
  readonly detached: ReadableState<boolean>;
  /** 把模块创建的 native view 挂到本区域;返回句柄,deactivate 自动摘除。
   *  view 为不透明句柄(契约不耦合 Electron 类型);main 模块在主进程自行创建。
   *  detach/merge 时框架把已 attach 的 view 整体 re-parent,模块无感。 */
  attach(view: object): Disposable;
  /** 请求把本 surface 分离到独立窗口(由框架建窗、re-parent;窗口仍归框架)。 */
  detach(): Promise<void>;
  /** 合并回主窗口。 */
  merge(): Promise<void>;
}

export interface MainContext extends BaseContext {
  readonly self: Readonly<Pick<ModuleManifest, "id" | "version" | "runtime">> & { runtime: "main" };
  /** 框架分配的 UI 区域;无 UI 的纯能力 main 模块为 undefined。 */
  readonly surface?: ModuleSurface;
}
```

`bounds`/`visible`/`theme`/`detached` 用既有 `ReadableState` 范式;`attach` 是注册类(返回 `Disposable`,生命周期自动回收)。host 侧实现归 `apps/shell`(它持有窗口),非框架核心。

### 3.3 detach(可分离 surface,一次设计到位)

detach 不让模块开窗(会撞"host 持窗口""框架只给一块区域"),而是 **surface 本身可分离**:

- 模块(toolbar 按钮)调 `surface.detach()`;**框架**建独立 `BrowserWindow`、把该 surface 上已 `attach` 的 view 整体 re-parent 过去、`bounds` 更新成新窗口内容区 → 模块的 bounds 订阅照常触发、在新矩形里重排 view(复用 resize 路径)。**模块侧近零专属代码**。
- 窗口始终归框架,模块世界观不变(还是"一块区域 + attach + bounds"),不破"host 持窗口""框架只给区域"两条。
- **但它依赖"多模块并发 active"(§2.1)**:detached 的 browser 与主窗前台模块并存、各自 active。这是 detach 的真实成本——**框架/shell 侧**要支持这种并存,外加管独立窗口及其 chrome(关闭→自动 merge)、主窗腾空区显占位。不止 re-parent。
- 通用能力,非浏览器专属——任何 main 模块的 surface 都能 detach。

**契约 Phase 0 即包含 `detach`/`merge`/`detached`**,避免日后再加要动契约。实现可排后,但架构一次到位。

## 4. 工具面(openclaw 16 个 → ctx.registerTool)

模块 `activate` 里注册,自动前缀 `browser.`,schema 复用 openclaw `inputSchema`,handler 在主进程直接驱动模块自己的引擎:

- `browser.{new_tab,navigate,click,type,upload,scroll,wait_for,screenshot,get_text,eval,intercept_next}`(openclaw 的 `browser_open` 删除,由 new_tab + navigate 覆盖)
- `browser.automation_{list,run,status,result,runs}`

`automation_list` 读模块内置脚本;`automation_run` 解析 scriptId → 内置脚本定义 → 自己的 runner,照搬 openclaw 混合模型(≤55s 同步返 summary / 超时返 runId,后续 `automation_status` 轮询);runner 串行队列 + runId 取件号 + run 输出都在模块内。

## 5. 模块内部构成(全部模块自有,host 不沾)

从 openclaw 平移到 `modules/browser`:

| openclaw 部件 | 去向 | 备注 |
|---|---|---|
| AutomationEngine(finder/mouse/keyboard/uploader,CDP 原语) | 模块(主进程) | 依赖 `webContents.debugger`(CDP) |
| DslEngine / AutomationRunner / SessionCollector / JSONPath / CSV 输出 | 模块(主进程) | 纯逻辑直接搬 |
| 自动化脚本(`.json` DSL)+ script-loader | 模块(随包) | 内置 `modules/browser/scripts/*.json`,模块加载 |
| TabStore / TabViewHost(WebContentsView 生命周期、view 布局) | 模块(主进程) | view 铺在 surface 给的区域内 |
| Toolbar / tab 条 / 地址栏 / newtab / 右键菜单 / 分组面板 | 模块(自带 renderer 页) | bd-*/token 重画,布局抄 openclaw |
| browser-profiles / partition 隔离 | 模块(主进程) | `session.fromPartition` 配模块自己的 view;账号元数据走 `ctx.storage` |
| 分组 / 右键菜单 | 模块 | TabStore 数据 + chrome 页 UI,模块内部 |
| session capture 运行产物落盘 | 模块 | main-runtime 经 `app.getPath('userData')` 取模块自有目录;非 host |
| `mcp-server.ts`(HTTP JSON-RPC) | 丢弃 | facade 替代 |
| `browser-ipc-contract` / preload tabAPI | 模块内部自用 | 模块自己的主⇄渲染 IPC,不进框架契约 |

### 5.1 框架/构建接线(三处当前未通,本设计要补)

`modules/browser` 是 main-runtime 但自带 renderer chrome 页(载入自己的 WebContentsView),涉及三处:

- **多产物构建 + externals 分别配**:main 入口(`dist/index.mjs`,external = **electron + node 内建**,**不含 react**)+ chrome 页(`dist/chrome/*`,external = **react/react-dom**,经 app:// 载入)+ 内置脚本随包。`scripts/build-modules.mjs` 现在只 external react(renderer 假设),要**按 manifest `runtime` 选 externals**并为本模块扩多入口。
- **app:// 服务 main 模块资产(框架补)**:`app://modules/<id>/...` 的资产目录现只由 `RendererLoader.load()` 注册(`moduleArtifacts.register`,仅 renderer 模块)。main 模块的 chrome 页要能 `app://` 载入,需把注册**上移到对所有 runtime 通用的加载路径**(main 模块也注册其资产目录)。
- **chrome 页自带 import map**:chrome 页是独立 document,需在其 HTML 里带 `react`/`react-dom/client` → `app://vendor/vendor.mjs` 的 import map —— shell 的 `index.html` 那张不覆盖它。

## 6. Electron 42(已完成)

`apps/shell` 已从 `^33.2.1` 升到 `^42.0.0`(实装 42.3.0),`electron-vite`/`electron-builder` 不变即兼容,typecheck/build/dev 均通过。openclaw 自动化用到的 API(WebContentsView、`webContents.debugger` CDP、ICU/`TextDecoder` gb18030)在 38 即齐备。

## 7. 架构覆盖范围(全部纳入,无后续架构变更)

所有 openclaw 能力都在本设计内有确定归属,**不留"二期再改架构"的坑**:

- **需框架支撑的**:
  - UI 区域 + detach/merge(`MainContext.surface`,§3.2/3.3)——契约 Phase 0 即含,日后只是实现,不再动契约。
  - **多模块并发 active(必改 shell)**:active 与"前台显示"分离(§2.1),切 rail 不 deactivate;detach 依赖此。Registry 本身允许多 active,但 **shell 现在切走即 deactivate(已核:`Shell.tsx:253` ModuleView unmount → `modules.deactivate`)**,必须改为**切换只换前台、模块保活,`deactivate` 仅在卸载/热替换时**。这是全 shell 行为变更(影响所有模块,不止 browser)。
  - **app:// 服务所有 runtime 的模块资产**(§5.1):main 模块 chrome 页需要。
- **模块内部的,天然已覆盖(不碰契约/框架)**:tab 管理、CDP 交互、自动化引擎/runner/脚本、profile 账号隔离(session 分区 + `ctx.storage`)、分组、右键菜单、session capture。这些何时实现都行,不引入架构变更。
- **强能力不加审批**:`eval`/`interceptNext`/CDP 经 facade 直接暴露,不加闸、不预留 seam。

## 8. 实现顺序(仅工作量排序,非架构推迟)

0. 契约改动(本文):删 `BrowserSubsystem`/`MainContext.browser`,加 `MainContext.surface`(含 detach/merge/detached);`HOST_API_VERSION` 0.2.0。`apps/shell` 实现 surface(右侧区域 bounds + attach + visible/theme + detach 建窗与 re-parent)。
1. surface 跑通(electron 38 已就位):最小 main 模块挂 view 铺满右侧、随 resize 跟随、切走隐藏、detach/merge 通。
2. 模块骨架:TabStore + TabViewHost,newTab/navigate/close/activate;toolbar+tab 条 chrome 页(bd-*/token,布局抄 openclaw)。
3. CDP 交互 + 工具:搬 AutomationEngine,注册 `browser.*`。
4. 自动化:搬 DslEngine/Runner + 内置脚本,注册 `automation_*`,经 facade 暴露。
5. profile 账号隔离、分组、右键菜单、session capture(均模块内部,按需补)。
