# WebView Kernel 设计(从 browser 模块抽出浏览器 kernel 下沉基座)

把 openclaw 浏览器能力里的「网页渲染 + 控制 + CDP + 单步自动化原语」从 `modules/browser` 抽成一个 **WebView Kernel**,下沉进基座(`packages/host`,主进程),经 `BaseContext.webview` 通用能力面暴露给所有 runtime 的模块。`modules/browser` 退化为 kernel 的一个消费方(编排层 + 人主导 UI)。本文锁定架构与契约改动,实现细节随各阶段细化。

前置:本文承接 `2026-05-31-browser-module-port-design.md`(浏览器模块移植设计)。该文把整个浏览器子系统放进 `modules/browser`、host 不碰浏览器代码;本文在出现「多消费方」后,把其中的通用部分(kernel)下沉。两文不冲突——移植设计定的是「子系统私有时的归属」,本文定的是「能力变共享后的再归属」。

## 1. 背景与动机

### 1.1 现状

`modules/browser` 是自包含 main-runtime 模块,自持 `WebContentsView`(`tab-view-host.ts`,`partition: persist:browser-${profileId}`)、CDP、AutomationEngine、DSL、runner、内置脚本、profile 注册表(`index.ts` 的 `profiles` Map + `ctx.storage` 持久化)。能力只经 `ctx.registerTool` 暴露。这套设计的前提是:**浏览器是唯一消费方**。

### 1.2 新需求:浏览器能力出现多个消费方

| 消费方 | 主导 | 形态 |
|---|---|---|
| **browser 模块** | 人 | 全功能浏览器:地址栏 + 操作按钮,人主动浏览;另有「跑预置脚本批量抓数据」(DSL/runner/脚本) |
| **chat 边栏** | AI | 对话中按需打开,渲染网页 / pdf / excel / word / image 预览;人**不可操作**(透明 backdrop 拦截,防干扰),AI 可点击/填表;多 tab 待商榷 |
| **未来 canvas** | 待定 | 基于浏览器能力开发 |

共性:**「在自己分到的 UI 区域里渲染一块原生网页 view,并可程序化驱动」**。

### 1.3 归属结论

一旦浏览器能力有 ≥2 个消费方,它就不再是「子系统私有」,而是**共享框架态**——归基座持有。这非但不破 README「功能子系统硬约束」,反而正合「基座持有共享/框架状态(登录态/注册表/窗口/共享连接)」:

- 当初把浏览器子系统整个放 `modules/browser`,是因为它曾是唯一消费方(移植设计的前提)。
- 现在 chat 要复用人在 browser 里登录的账号(profile)去操作——**登录态必须跨模块共享**,锁在某个模块里(还会随 deactivate 回收)结构上不成立。
- 因此把「通用的那部分」(kernel)下沉到 host。kernel 是**通用宿主能力**(原生网页渲染 + 驱动),不是「浏览器业务」;契约只加这种通用能力,不加 `BrowserSubsystem` 这类功能专属面——守住不变量。

判据复述:**kernel = 单步能力(造 view + 控制 + CDP + 原子操作),任何要驱动网页的模块都要;browser = 把单步编排成脚本流程 + 产品 UI,是 browser 独有的产品特性。**

## 2. 三层切割

| 层 | 归属 | 内容 |
|---|---|---|
| **WebView Kernel** | 基座(`packages/host`,主进程) | 造/管 `WebContentsView` · 导航 · 摆位(setBounds)/显隐/交互锁定(backdrop) · CDP 通道 · **单步原语**:find / click / type / upload / screenshot / eval · **profile 注册表**(共享登录态) |
| **browser 模块** | 消费方 | **编排层**:DSL 引擎 + runner(串行队列 / runId / 混合同步异步) + 内置脚本 `.json` + 采集(SessionCollector / JSONPath / CSV) · 人主导 chrome(toolbar / tab 条 / 地址栏 / newtab / 右键菜单) · tab 策略 · `browser.*` / `automation.*` 工具注册 |
| **chat 模块** | 消费方 | AI 主导边栏:用 kernel 单步原语让 AI 实时 navigate / click / type / 读取(不跑预置脚本,AI 每步自决) · 多内容预览容器 · 锁定(人只读,backdrop) |

openclaw 部件去向:

| openclaw 部件 | 去向 |
|---|---|
| AutomationEngine(finder / mouse / keyboard / uploader,CDP 原语) | **下沉 kernel** |
| WebContentsView 生命周期 / partition 隔离 / profile | **下沉 kernel** |
| DslEngine / AutomationRunner / SessionCollector / JSONPath / CSV 输出 | 留 browser |
| 自动化脚本(`.json` DSL)+ script-loader | 留 browser |
| Toolbar / tab 条 / 地址栏 / newtab / 右键菜单 / 分组面板 | 留 browser |

## 3. kernel 能力面(契约改动)

### 3.1 `BaseContext.webview`(通用,非浏览器专属)

main(browser) 与 renderer(chat / canvas) 都要用,故进 `BaseContext`——和 `storage` / `api` 一样是「通用能力池,用不用随你」。不引入 manifest 级 capability 声明(YAGNI):有这个能力不用即不碰,与其它 Base 能力一致。

```ts
// BaseContext 新增
readonly webview: WebviewKernel;

export interface Profile {
  id: string;
  name: string;
}

export interface WebviewKernel {
  /** 造一块原生网页 view,返回句柄。interactive=false 时框架在 native 层盖透明 backdrop 拦人操作。
   *  surface 可选:传则 view 跟随该 surface(detach 时框架整体 re-parent);不传则挂主窗 content 区。 */
  create(opts?: {
    profileId?: string;
    interactive?: boolean;
    surface?: ModuleSurface;
  }): Promise<WebviewHandle>;
  /** profile 注册表(共享登录态)。各 profile 一套隔离的 cookie/storage 分区。 */
  profiles: {
    list(): Promise<Profile[]>;
    create(name: string): Promise<Profile>;
    remove(id: string): Promise<void>;
  };
}

export interface WebviewHandle extends Disposable {
  navigate(url: string): Promise<void>;
  /** 区域矩形(DIP,相对宿主窗口 content 区);消费方喂(main 从 surface.bounds 派生,renderer 测 DOM)。 */
  setBounds(rect: Rect): void;
  /** 模块内部显隐意图;最终可见性 = 模块前台 AND 本值(见 §6,前台态框架自动叠加)。 */
  setVisible(visible: boolean): void;
  /** false=锁定:native backdrop 拦人鼠标键盘;AI 经下面程序通道驱动不受影响。 */
  setInteractive(on: boolean): void;
  on(event: WebviewEvent, listener: (payload: unknown) => void): Disposable;

  // --- 单步原语(下沉的 AutomationEngine;schema 复用 openclaw)---
  find(selector: string): Promise<ElementRef | null>;
  click(target: ElementRef | string): Promise<void>;
  type(target: ElementRef | string, text: string): Promise<void>;
  upload(target: ElementRef | string, paths: string[]): Promise<void>;
  scroll(opts: ScrollOptions): Promise<void>;
  screenshot(opts?: ScreenshotOptions): Promise<Uint8Array>;
  eval<T = unknown>(expression: string): Promise<T>;

  /** 原始 CDP 通道(每个 view 一条独立会话,消费方之间互不干扰)。 */
  readonly cdp: {
    send(method: string, params?: object): Promise<unknown>;
    on(event: string, listener: (payload: unknown) => void): Disposable;
  };
}

export type WebviewEvent = "did-navigate" | "title-updated" | "loading" | "favicon";
```

`ElementRef` / `ScrollOptions` / `ScreenshotOptions` 等参数类型从 openclaw 既有定义平移。

### 3.2 profile 下沉

- **partition 数据**(cookie / storage / cache):本就在 Electron session 层按 partition 名隔离、持久在磁盘,跨进程跨模块天然共享同一登录态。kernel 不重造,沿用 `persist:browser-${profileId}` 约定。
- **profile 注册表**(有哪些 profile、id→名、当前选谁):从 `modules/browser` 内存 Map + `ctx.storage` 迁到 kernel,用 host 级 storage 持久化。
- browser 的账号切换 UI、chat 的账号选择,都改调 `ctx.webview.profiles`;`create({ profileId })` 用对应 partition。人在 browser 登录 → AI 在 chat 复用,登录态因共享 partition 互通。

## 4. 工程硬骨头

### 4.1 bounds 同步(消费方喂矩形)

kernel 不猜位置,消费方 `setBounds` 喂相对 content 区的矩形:

- **main(browser)**:订阅 `surface.bounds`,自己在区域内算各 view 子矩形(chrome 顶部固定高 / tab view 下方),派生即喂。
- **renderer(chat)**:`ResizeObserver` + `getBoundingClientRect()` 测侧栏占位 div 相对 content 区的矩形,`setBounds` 喂;滚动 / resize 触发,**需节流**(高频 IPC)。

### 4.2 native-over-DOM 的天花板(固有限制,摊牌)

同一 `BrowserWindow` 里,native view **永远盖在 renderer DOM 之上**。推论:

- chat 的占位 div 只是「让出位置」,真内容是上面的 native view。
- chat 若有下拉 / 弹窗要盖在 view 之上——**做不到**(native 最高)。需要时弹窗须避开 view 区域,或弹窗本身也用 native 层。
- 这是方案的固有天花板,没法绕。设计与 UI 须据此约束布局。

### 4.3 backdrop 锁定(native 层)

`setInteractive(false)` 由 kernel 在 native 层实现:目标 view 之上盖一层透明拦截 view,吃掉鼠标键盘(renderer DOM 的透明 div 挡不住 native view,backdrop 必须 native)。AI 驱动走 `click`/`type`/`cdp` 程序通道,不受 backdrop 影响。

### 4.4 renderer 全 async bounce

renderer 模块的每个 handle 调用经 preload `moduleBridge` IPC bounce 到主进程(沿用 `aid` 绑定 activation,新增一组 `ctxWebview*` IPC 通道)。`screenshot` / `cdp.send` 跨进程序列化大对象有成本,可接受。view 永远活在主进程、由 kernel 持有,deactivate 随 activation 回收。

## 5. view 与 surface / detach 的配合

surface 已设计 `detach` / `merge`(可分离独立窗口),browser 要用。view 现由 kernel 持有,不再走「模块 `surface.attach(自造 view)`」。处理:

- `kernel.create({ surface })` 可选绑定一个 surface:
  - **main(browser)**:传 surface → view 跟随该 surface;surface detach 到独立窗口时,框架自动把绑定的 view 整体 re-parent,模块无感,复用 `surface.bounds` 订阅重排。
  - **renderer(chat)**:不传 → view 挂主窗 content 区,按 DOM 矩形 setBounds,不参与 detach。
- 旧入口 `ModuleSurface.attach(view: object)` 废弃,统一成「kernel 造 view + 可选绑 surface」;detach / merge 仍归框架。

## 6. 前台态与显隐(框架自动 gate)

native view 永远盖在 DOM 上,故模块切到后台时其 view 必须跟着隐藏,否则糊在前台模块上。方案:**框架自动 gate**——view 属于某 activation(aid),框架知道该模块是否前台,view 最终可见性 = `模块前台 AND 模块自己 setVisible(true)`。

- 模块的 `setVisible` 只表达内部意图(如 chat 折叠边栏);「前台与否」由框架叠加,模块不手动跟前台态。
- 因此 `RendererContext` **不必**新增 `visible` 字段,省一处契约改动。

## 7. browser 模块改造

- `tab-view-host.ts`:从「自己 `new WebContentsView` + `persist:browser-${profileId}`」改为 `ctx.webview.create({ profileId, interactive: true, surface })`。
- AutomationEngine 调用点:从自持 `webContents.debugger` 改为用 handle 的单步原语 / `cdp`。
- profile 注册表:从模块内 Map + `ctx.storage` 迁到 `ctx.webview.profiles`。
- **不动**:DslEngine / runner / SessionCollector / 内置脚本 / chrome(toolbar / tab / 地址栏 / newtab / 右键菜单) / tab 策略 / `browser.*` / `automation.*` 工具注册。

## 8. chat 模块(消费方示例,本文不展开实现)

- 在边栏占位 div 上,`ctx.webview.create({ interactive: false, profileId })` 造锁定 view;`ResizeObserver` 喂 bounds。
- AI 驱动:`navigate` / `find` / `click` / `type` / `screenshot`(给 AI 看) / `eval`(读内容)。
- 多内容预览:网页 / pdf / image 直接 `navigate`(Chromium 原生渲染);excel / word 由 chat 自己转预览 URL(预览服务 / 转 HTML)——kernel 只认 URL,不碰多格式。
- 多 tab:待商榷,不阻塞本设计。

## 9. 契约版本

`BaseContext.webview` 新增 + `kernel.create({ surface })` + 废 `ModuleSurface.attach`,以新增为主(`attach` 废弃属破坏,但其从未被消费)→ `HOST_API_VERSION` minor bump `0.2.0` → `0.3.0`,契约包 `package.json` 同步。

## 10. 不变量符合性

- **能力只经通用面**:`webview` 是通用宿主能力(原生网页渲染 + 驱动),非 `BrowserSubsystem` 这类功能专属面;契约不出现浏览器领域类型。browser 对外业务能力仍只经 `ctx.registerTool`(`browser.*` / `automation.*`)。
- **共享态归基座**:profile / 登录态本属「基座持有共享状态」,下沉正合不变量;当初放模块是「唯一消费方」的临时归属。
- **`ctx` 唯一接触面 + 三范式**:`webview` 归「注册类自动回收」(`create` 返回 `Disposable`,deactivate 回收)+「代理动作」(navigate / click 等 async);按 runtime 单维度仍成立(Base 能力,main/renderer 同接口,renderer 经 bounce)。
- **门面不进核心契约**:WS / MCP / CLI 仍接在 browser 的 `browser.*` / `automation.*` 工具上,kernel 不为门面加面。

## 11. 暂不做(YAGNI 边界)

- DSL / runner / 内置脚本 / 采集**不下沉**——是 browser 产品特性,chat 不需要。
- 多格式预览(excel / word)**不进 kernel**——chat 自己转 URL,kernel 只认 URL。
- manifest 级 capability 声明**不引入**——`webview` 进 BaseContext,沿用「通用能力池」。
- chat 多 tab、canvas 具体形态——待后续各自设计,不阻塞本文。
