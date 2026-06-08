# WebView Kernel Phase 2+3 实现计划(合并:shell driver + browser 迁移)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development(推荐)or superpowers:executing-plans 逐任务执行。步骤用 checkbox(`- [ ]`)跟踪。

**Goal:** 给 Phase 1 的 `WebviewDriver` seam 注入 Electron `WebContentsView` 实现,并把 `modules/browser` 改造为 `ctx.webview` 的消费方——browser 当场做 `pnpm dev` 活体验证整条 kernel 链路。

**Architecture:** 薄 kernel。kernel 在通用契约上只补「导航控制 + 定型事件(含 context-menu / load)」;CDP 单步原语在 driver 里实现(供 chat),browser 保留自己的 `automation.ts`/`dsl-engine.ts`,把驱动面从裸 `WebContents` 机械改走 `handle.cdp`/`handle.eval`/`handle.on`/`handle.reload`。view 由 kernel(shell driver)持有,经内部机制绑到 `surface`(detach 自动 re-parent)。

**Tech Stack:** TypeScript 6 NodeNext ESM · Electron 42(`WebContentsView` + `webContents.debugger` CDP)· vitest 4(仅 host 段)· pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-06-07-webview-kernel-design.md`(承接;本 plan 修正其 §5/§7/§9 中与实际 browser 实现不符之处——见下「与 spec 的偏差」)。

---

## 锁定的设计决定(brainstorm 产出,执行不得擅改)

1. **合并 Phase 2+3**:driver + browser 迁移一次做完,browser 是活体验证者。
2. **context-menu 走 kernel 转发的通用事件**:kernel 加 `context-menu` `WebviewEvent`,携 Electron params;browser 订阅后自建并弹原生菜单(保留 dev 检查元素 / 未来分组)。
3. **导航控制 + 定型事件 + 干净 UA 折入契约**:`goBack/goForward/reload` 进 `WebviewHandle`;`WebviewEvent` payload 定型;driver 默认给内容 view 设干净桌面 Chrome UA(反爬)。
4. **薄 kernel**:browser 留 `automation.ts`/`dsl-engine.ts`,只把 `wc.*` 换成 `handle` 的 cdp/eval/on/nav。kernel 的 typed `find/click/type/upload/scroll` 服务 chat。

## 本次范围收敛(写明,供 review)

- **renderer IPC bounce 推迟到 chat 阶段**:browser 是 **main** 模块,在主进程内**直接**驱动 driver,不走 IPC bounce。renderer bounce 在 chat(原 Phase 4)落地前无验证者,故本次**保留 `RENDERER_WEBVIEW_STUB` 不动**,bounce 留待 chat 阶段。这样本次合并建的每一块都被 browser 当场跑到。
- **chat-only 能力(typed `find/click/type/upload/scroll` + `setInteractive(false)` 的 backdrop)** 在 driver 里实现(契约已承诺、且是「下沉原语」),但本阶段**无 live 消费方**,仅 smoke 验证;真实验证在 chat 阶段。验证清单里标注。

## 与 spec 的偏差(实现勘探发现 spec 假设过时,以本 plan 为准)

- spec 称 `modules/browser` 仍是 stub、`ModuleSurface.attach` 从未被消费 → **错**。browser 是完整实现(~2300 行),且在用 `surface.attach`(`index.ts:57,71`)。
- spec §5/§9「废 ModuleSurface.attach」→ 规划中(C5)发现 **attach 不能废**:browser 的 toolbar(chrome 条)是模块自有 React 页,靠 `webContents.send`/`e.sender` 与 main 双向 IPC,kernel handle 不暴露 webContents;让 kernel 暴露 webContents 会把 Electron 句柄漏进通用契约、破不变量。正解:kernel 只接管**内容网页 view**,模块自有 chrome UI 仍合法经 `attach`(不变量本就允许模块自持私有 view)。故 attach **保留**,职责收窄为「挂模块自有 chrome view」。
- spec §7「DslEngine 不动 / 调用点改用 handle 单步原语」→ DSL 引擎全程裸 `wc`(executeJavaScript / debugger / wc 事件 / 坐标),handle 的 typed 原语承不住。按「薄 kernel」决定:DSL 结构不动,只把驱动面改走 `handle.cdp/eval/on`。

---

## 文件结构

**新增**
- `apps/shell/src/main/webview-driver.ts` — `ElectronWebviewDriver`(实现 host 的 `WebviewDriver`/`DriverWebview`):`WebContentsView` 生命周期 + 分区 + 干净 UA + 事件(含 context-menu)+ CDP + 单步原语 + backdrop;绑 surface 经 SurfaceManager 内部机制。

**修改(契约 / host)**
- `packages/contract/src/contract.ts` — `WebviewHandle` 加 `goBack/goForward/reload`;`WebviewEvent` 改为定型 map(加 `did-navigate-in-page`/`did-finish-load`/`context-menu`);加 `WebviewNavigation`/`WebviewContextMenu`;`ModuleSurface.attach` **保留**,Stage D 仅收窄其注释职责(挂模块自有 chrome view)。
- `packages/host/src/webview.ts` — `DriverWebview` 同步加 `goBack/goForward/reload` + 定型 `on`;`wrapDriverView` 委托三者。
- `packages/host/test/webview.test.ts` — fakeDriver 补三方法;加委托测试。

**修改(shell 装配)**
- `apps/shell/src/main/index.ts` — `new HostServices({ ..., webview: new ElectronWebviewDriver(surfaces) })`。
- `apps/shell/src/main/surface.ts` — `SurfaceManager` 加 `bindView`(driver 经 surface 实例绑 view,复用 `ManagedSurface.attach` 机制)。`attach` **不删**(见 Stage C5/D 结论:保留给模块自有 chrome view,职责收窄)。

**修改(browser 迁移)**
- `modules/browser/src/automation.ts` — `wc: WebContents` → `view: WebviewHandle`,`debugger.sendCommand`→`cdp.send`、`executeJavaScript`→`eval`、`debugger.on`→`cdp.on`。
- `modules/browser/src/dsl-engine.ts` — 同上;`wc.on(...)`→`view.on(...)`、`wc.reload`→`view.reload`、`wc.loadURL`→`view.navigate`。
- `modules/browser/src/tab-view-host.ts` — `new WebContentsView + surface.attach` → `ctx.webview.create({ profileId, surface })`;持 `WebviewHandle`;事件 / context-menu 经 `handle.on`。
- `modules/browser/src/tools.ts` / `automation-tools.ts` — `active(): WebContents` → `active(): WebviewHandle`;`capturePage`→`handle.screenshot`;loadURL/getURL/getTitle 经 handle/缓存。
- `modules/browser/src/index.ts` — profiles 迁 `ctx.webview.profiles`;不再 `new WebContentsView`/`surface.attach`;context-menu 经 handle 事件。

---

## Stage A — 契约扩展 + host 包装器(vitest 全绿)

只动 contract + host,browser/shell 不碰(仍走旧路),仓库全程绿。

### Task A1: 契约扩展 WebviewHandle / WebviewEvent

**Files:** Modify `packages/contract/src/contract.ts`

- [ ] **Step 1: 替换 `WebviewEvent` 定义为定型 map,新增导航/菜单 payload 类型**

定位 `export type WebviewEvent = "did-navigate" | "title-updated" | "loading" | "favicon-updated";`,整段替换为:

```ts
/** did-navigate / did-navigate-in-page 事件 payload:导航后的页面态(消费方据此更新地址栏/前进后退态)。 */
export interface WebviewNavigation {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** context-menu 事件 payload:kernel 原样转发 Chromium 右键参数,消费方自建并弹原生菜单。
 *  通用结构(坐标 + 编辑可用性 + 命中的链接/选区),不含任何浏览器业务语义。 */
export interface WebviewContextMenu {
  x: number;
  y: number;
  canGoBack: boolean;
  canGoForward: boolean;
  editFlags: { canCopy: boolean; canPaste: boolean; canCut: boolean; canSelectAll: boolean };
  linkURL: string;
  srcURL: string;
  selectionText: string;
}

/** WebviewHandle.on 的事件→payload 映射(定型,消费方按事件名收窄)。 */
export interface WebviewEventMap {
  "did-navigate": WebviewNavigation;
  "did-navigate-in-page": WebviewNavigation;
  "title-updated": { title: string };
  "favicon-updated": { favicon: string };
  "did-finish-load": void;
  "loading": { loading: boolean };
  "context-menu": WebviewContextMenu;
}

export type WebviewEvent = keyof WebviewEventMap;
```

- [ ] **Step 2: `WebviewHandle` 加导航控制 + 定型 `on`**

定位 `WebviewHandle` 接口中:
```ts
  setInteractive(on: boolean): void;
  on(event: WebviewEvent, listener: (payload: unknown) => void): Disposable;
```
替换为:
```ts
  setInteractive(on: boolean): void;
  /** 导航控制(chrome 工具栏 / DSL reload 用);fire-and-forget,完成与否经 did-navigate / did-finish-load 事件观察。 */
  goBack(): void;
  goForward(): void;
  reload(): void;
  on<E extends WebviewEvent>(event: E, listener: (payload: WebviewEventMap[E]) => void): Disposable;
```

- [ ] **Step 3: 契约 typecheck**

Run: `pnpm -F @boundary-desktop/contract typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/contract/src/contract.ts
git commit -m "feat(contract): WebviewHandle 加导航控制 + 定型事件(context-menu/did-finish-load)"
```

### Task A2: host DriverWebview / wrapDriverView 同步扩展

**Files:** Modify `packages/host/src/webview.ts`, `packages/host/test/webview.test.ts`

- [ ] **Step 1: 写失败测试(委托 goBack/goForward/reload + 定型 on payload)**

在 `packages/host/test/webview.test.ts` 的 `fakeDriver()` 内,给返回的 `DriverWebview` 对象补三个方法(在 `setInteractive() {}` 之后):

```ts
        goBack() {},
        goForward() {},
        reload() {},
```

并在 `describe("HostServices.webview")` 之外、文件末尾追加 `wrapDriverView` 委托测试:

```ts
import { wrapDriverView } from "../src/index.js";

describe("wrapDriverView 导航控制委托", () => {
  test("goBack/goForward/reload 透传到 driver view", () => {
    const calls: string[] = [];
    const noop: Disposable = { dispose: () => {} };
    const view = {
      navigate: async () => {},
      setBounds() {},
      setVisible() {},
      setInteractive() {},
      goBack() { calls.push("back"); },
      goForward() { calls.push("forward"); },
      reload() { calls.push("reload"); },
      on: () => noop,
      find: async () => null,
      click: async () => {},
      type: async () => {},
      upload: async () => {},
      scroll: async () => {},
      screenshot: async () => new Uint8Array(),
      async eval<T>() { return undefined as T; },
      cdp: { send: async () => null, on: () => noop },
      destroy() {},
    };
    const track = <D extends Disposable>(d: D): D => d;
    const handle = wrapDriverView(view, track);
    handle.goBack();
    handle.goForward();
    handle.reload();
    expect(calls).toEqual(["back", "forward", "reload"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @boundary-desktop/host test -- webview`
Expected: FAIL(`DriverWebview` 无 goBack 等 / `wrapDriverView` 产物无 goBack)。

- [ ] **Step 3: `DriverWebview` 接口加三方法 + 定型 on**

`packages/host/src/webview.ts`,`DriverWebview` 接口里:
```ts
  setInteractive(on: boolean): void;
  on(event: WebviewEvent, listener: (payload: unknown) => void): Disposable;
```
替换为:
```ts
  setInteractive(on: boolean): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  on<E extends WebviewEvent>(event: E, listener: (payload: WebviewEventMap[E]) => void): Disposable;
```

顶部 import 把 `WebviewEvent` 改为 `WebviewEvent, WebviewEventMap`:
```ts
import type {
  Disposable,
  ElementRef,
  ModuleSurface,
  Rect,
  ScreenshotOptions,
  ScrollOptions,
  WebviewEvent,
  WebviewEventMap,
  WebviewHandle,
  WebviewProfile,
} from "@boundary-desktop/contract";
```

- [ ] **Step 4: `wrapDriverView` 委托三方法**

在返回对象里,`setInteractive: (on) => view.setInteractive(on),` 之后加:
```ts
    goBack: () => view.goBack(),
    goForward: () => view.goForward(),
    reload: () => view.reload(),
```
并把 `on:` 一行的泛型补齐(定型):
```ts
    on: <E extends WebviewEvent>(event: E, listener: (payload: WebviewEventMap[E]) => void) =>
      trackSub(view.on(event, listener)),
```

- [ ] **Step 5: 跑测试 + 全 host 测试**

Run: `pnpm -F @boundary-desktop/host test`
Expected: PASS(含新委托测试 + 既有不回归)。

- [ ] **Step 6: 重建 contract/host dist(下游 typecheck 依赖产物)**

Run: `pnpm -F @boundary-desktop/contract build && pnpm -F @boundary-desktop/host build`
Expected: 无错。

- [ ] **Step 7: Commit**

```bash
git add packages/host/src/webview.ts packages/host/test/webview.test.ts
git commit -m "feat(host): DriverWebview/wrapDriverView 同步导航控制 + 定型事件"
```

---

## Stage B — Electron WebviewDriver(typecheck 绿;browser 仍走旧路)

新建 driver 并注入 HostServices。browser 此刻**仍**用 `new WebContentsView + surface.attach`(未迁),driver 无消费方但已装配;`pnpm dev` 行为不变。

### Task B1: SurfaceManager 暴露 driver 用的内部绑定

driver 要把它造的 view 绑到某 surface 的窗口(且 detach 时随之 re-parent)。复用 `ManagedSurface` 已有的 `#views` + detach/merge re-parent 机制:把当前**契约公开**的 `attach` 暂时保留(Stage D 才从契约删),并在 `SurfaceManager` 上加一个按 surface 实例绑定 view 的内部方法供 driver 用。

**Files:** Modify `apps/shell/src/main/surface.ts`

- [ ] **Step 1: `SurfaceManager` 加内部 `bindView`**

在 `SurfaceManager` 类内(`merge(id)` 方法之后)加:

```ts
  /** driver 专用:把 kernel 造的 view 绑到某 surface(经其 attach 机制,detach/merge 自动 re-parent)。
   *  surface 为契约 ModuleSurface 实例(本进程内即 ManagedSurface);返回摘除句柄。 */
  bindView(surface: ModuleSurface, view: object): Disposable {
    return (surface as ManagedSurface).attach(view);
  }
```

> 注:此处仍调 `ManagedSurface.attach`。Stage D 会把 `attach` 从**契约** `ModuleSurface` 删除、并把 `ManagedSurface.attach` 改名 `attachView`,届时本方法改调 `attachView`。先这样保证 Stage B/C 全绿。

- [ ] **Step 2: typecheck**

Run: `pnpm -F @boundary-desktop/shell typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/shell/src/main/surface.ts
git commit -m "feat(shell): SurfaceManager.bindView —— 供 webview driver 绑 view 到 surface"
```

### Task B2: ElectronWebviewDriver 实现

把 `modules/browser/src/automation.ts` 的 CDP 原语**搬进 driver**(driver 持 wc,逻辑几乎原样)。driver 是 kernel 侧实现,服务任意消费方(本阶段无人调,chat 阶段起用 find/click/type;browser 走 cdp/eval/事件那部分)。

**Files:** Create `apps/shell/src/main/webview-driver.ts`

- [ ] **Step 1: 写 driver 全文**

```ts
// kernel 的 Electron 实现:WebContentsView 生命周期 + 分区 + 干净 UA + 事件(含 context-menu) +
// CDP 通道 + 单步原语(港 modules/browser/automation.ts) + backdrop。注入 HostServices.webview。
// 框架代码:不 import 任何模块子系统;原语在此独立持有一份(薄 kernel:browser 另有自己的一份走 cdp)。
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { WebContentsView, type WebContents, app } from "electron";
import type {
  Disposable,
  ElementRef,
  Rect,
  ScreenshotOptions,
  ScrollOptions,
  WebviewContextMenu,
  WebviewEvent,
  WebviewEventMap,
  WebviewNavigation,
} from "@boundary-desktop/contract";
import type { DriverCreateOptions, DriverWebview, WebviewDriver } from "@boundary-desktop/host";
import type { SurfaceManager } from "./surface.js";

const ACCEPT_LANGUAGES = "zh-CN,zh;q=0.9,en;q=0.8";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** 干净桌面 Chrome UA(去 Electron/app token,反爬);与 browser/tab-view-host 同源逻辑。 */
let cleanUA: string | null = null;
function contentUserAgent(): string {
  if (cleanUA) return cleanUA;
  cleanUA = app.userAgentFallback
    .replace(/ Electron\/[\d.]+/, "")
    .replace(/(\(KHTML, like Gecko\)) \S+ (Chrome\/)/, "$1 $2");
  return cleanUA;
}

interface Coords {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 一块 WebContentsView 的 driver 实现。kernel 持有 wc;消费方经 WebviewHandle 驱动。 */
class ElectronWebview implements DriverWebview {
  #view: WebContentsView;
  #wc: WebContents;
  #backdrop: WebContentsView | null = null;
  #unbindSurface: Disposable | null = null;
  #navUrl = "";
  #cursor = { x: 100, y: 100 };
  // 通用事件分发:外部 on(event) 注册的监听器集合;wc 原生事件 → 归一化 payload 后广播。
  #listeners = new Map<WebviewEvent, Set<(p: unknown) => void>>();
  // CDP 事件分发:cdp.on(method) 监听器;debugger "message" 单一订阅按 method 路由。
  #cdpListeners = new Map<string, Set<(p: unknown) => void>>();
  #cdpWired = false;

  constructor(opts: { partition: string }) {
    this.#view = new WebContentsView({
      webPreferences: {
        partition: opts.partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.#wc = this.#view.webContents;
    this.#wc.session.setUserAgent(contentUserAgent(), ACCEPT_LANGUAGES);
    try {
      this.#wc.debugger.attach("1.3"); // CDP:单步原语 + 消费方 cdp 通道共用一条会话
    } catch {
      // 已 attach,忽略
    }
    this.#wireNativeEvents();
  }

  /** driver 内部:返回底层 WebContentsView(SurfaceManager 绑定 / re-parent 用)。 */
  get nativeView(): WebContentsView {
    return this.#view;
  }

  bindSurfaceDisposable(d: Disposable): void {
    this.#unbindSurface = d;
  }

  // --- 导航 ---
  async navigate(url: string): Promise<void> {
    await this.#wc.loadURL(url).catch((e: unknown) => {
      if (!String(e).includes("ERR_ABORTED")) throw e; // 重定向取消属正常
    });
  }
  goBack(): void {
    if (this.#wc.navigationHistory.canGoBack()) this.#wc.navigationHistory.goBack();
  }
  goForward(): void {
    if (this.#wc.navigationHistory.canGoForward()) this.#wc.navigationHistory.goForward();
  }
  reload(): void {
    this.#wc.reload();
  }

  // --- 区域 / 显隐 / 交互锁定 ---
  setBounds(rect: Rect): void {
    this.#view.setBounds(rect);
    this.#backdrop?.setBounds({ x: 0, y: 0, width: rect.width, height: rect.height });
  }
  setVisible(visible: boolean): void {
    this.#view.setVisible(visible);
    this.#backdrop?.setVisible(visible);
  }
  /** false=锁定:在本 view 之上盖一层透明 WebContentsView 吃掉人鼠标键盘;程序通道(cdp/eval/原语)不受影响。 */
  setInteractive(on: boolean): void {
    if (on) {
      if (this.#backdrop) {
        try {
          this.#view.removeChildView(this.#backdrop);
        } catch {
          /* 已移除 */
        }
        if (!this.#backdrop.webContents.isDestroyed()) this.#backdrop.webContents.close();
        this.#backdrop = null;
      }
      return;
    }
    if (this.#backdrop) return;
    const b = new WebContentsView({ webPreferences: { sandbox: true } });
    b.setBackgroundColor("#00000000"); // 全透明:只拦截,不遮挡
    const r = this.#view.getBounds();
    b.setBounds({ x: 0, y: 0, width: r.width, height: r.height });
    this.#view.addChildView(b); // 盖在内容之上(同窗 native 子 view 后加者在上)
    this.#backdrop = b;
  }

  // --- 通用事件(定型 payload)---
  on<E extends WebviewEvent>(event: E, listener: (payload: WebviewEventMap[E]) => void): Disposable {
    const set = this.#listeners.get(event) ?? new Set();
    set.add(listener as (p: unknown) => void);
    this.#listeners.set(event, set);
    return { dispose: () => set.delete(listener as (p: unknown) => void) };
  }

  #emit(event: WebviewEvent, payload: unknown): void {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const l of [...set]) l(payload);
  }

  #navState(): WebviewNavigation {
    const nav = this.#wc.navigationHistory;
    this.#navUrl = this.#wc.getURL();
    return {
      url: this.#navUrl,
      title: this.#wc.getTitle(),
      canGoBack: nav.canGoBack(),
      canGoForward: nav.canGoForward(),
    };
  }

  #wireNativeEvents(): void {
    const wc = this.#wc;
    wc.on("did-navigate", () => this.#emit("did-navigate", this.#navState()));
    wc.on("did-navigate-in-page", () => this.#emit("did-navigate-in-page", this.#navState()));
    wc.on("page-title-updated", () => this.#emit("title-updated", { title: wc.getTitle() }));
    wc.on("page-favicon-updated", (_e, icons) => this.#emit("favicon-updated", { favicon: icons[0] ?? "" }));
    wc.on("did-finish-load", () => this.#emit("did-finish-load", undefined));
    wc.on("did-start-loading", () => this.#emit("loading", { loading: true }));
    wc.on("did-stop-loading", () => this.#emit("loading", { loading: false }));
    wc.on("context-menu", (_e, params) => {
      const nav = wc.navigationHistory;
      const payload: WebviewContextMenu = {
        x: params.x,
        y: params.y,
        canGoBack: nav.canGoBack(),
        canGoForward: nav.canGoForward(),
        editFlags: {
          canCopy: params.editFlags.canCopy,
          canPaste: params.editFlags.canPaste,
          canCut: params.editFlags.canCut,
          canSelectAll: params.editFlags.canSelectAll,
        },
        linkURL: params.linkURL,
        srcURL: params.srcURL,
        selectionText: params.selectionText,
      };
      this.#emit("context-menu", payload);
    });
  }

  // --- CDP 通道 ---
  get cdp(): { send(method: string, params?: object): Promise<unknown>; on(event: string, listener: (payload: unknown) => void): Disposable } {
    return {
      send: (method, params) => this.#wc.debugger.sendCommand(method, params ?? {}),
      on: (event, listener) => this.#cdpOn(event, listener),
    };
  }

  #cdpOn(method: string, listener: (p: unknown) => void): Disposable {
    if (!this.#cdpWired) {
      this.#cdpWired = true;
      this.#wc.debugger.on("message", (_e, m, params) => {
        const set = this.#cdpListeners.get(m);
        if (set) for (const l of [...set]) l(params);
      });
    }
    const set = this.#cdpListeners.get(method) ?? new Set();
    set.add(listener);
    this.#cdpListeners.set(method, set);
    return { dispose: () => set.delete(listener) };
  }

  // --- 单步原语(港 automation.ts;chat 用,本阶段 smoke)---
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = (await this.#wc.debugger.sendCommand("Runtime.evaluate", {
      expression: `(async function(){ return (${expression}); })()`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    })) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
    if (r.exceptionDetails) throw new Error(`eval 出错: ${r.exceptionDetails.text ?? ""}`);
    return r.result?.value as T;
  }

  async #findCoords(selector: string): Promise<Coords | null> {
    return this.eval<Coords | null>(`(function(){
      var el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;
      el.scrollIntoView({block:'center',inline:'nearest'});
      var r=el.getBoundingClientRect();if(r.width===0||r.height===0)return null;
      return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),width:Math.round(r.width),height:Math.round(r.height)};
    })()`);
  }

  async find(selector: string): Promise<ElementRef | null> {
    const c = await this.#findCoords(selector);
    return c ? { token: JSON.stringify(c) } : null;
  }

  async #coordsOf(target: ElementRef | string): Promise<Coords> {
    if (typeof target === "string") {
      const c = await this.#findCoords(target);
      if (!c) throw new Error(`未找到元素: ${target}`);
      return c;
    }
    return JSON.parse(target.token) as Coords;
  }

  async #moveTo(x: number, y: number): Promise<void> {
    // 简化版人类化移动:直线分步 + 抖动(完整贝塞尔在 chat 阶段视需要再引)。
    const send = (px: number, py: number): Promise<unknown> =>
      this.#wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py, modifiers: 0 });
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await send(Math.round(this.#cursor.x + (x - this.#cursor.x) * t + rand(-1, 1)), Math.round(this.#cursor.y + (y - this.#cursor.y) * t + rand(-1, 1)));
      await sleep(rand(6, 12));
    }
    this.#cursor = { x, y };
  }

  async click(target: ElementRef | string): Promise<void> {
    const c = await this.#coordsOf(target);
    await this.#moveTo(c.x, c.y);
    await sleep(rand(40, 90));
    await this.#wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x: c.x, y: c.y, button: "left", clickCount: 1, modifiers: 0 });
    await sleep(rand(40, 80));
    await this.#wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x: c.x, y: c.y, button: "left", clickCount: 1, modifiers: 0 });
  }

  async type(target: ElementRef | string, text: string): Promise<void> {
    await this.click(target); // 聚焦
    for (const ch of text) {
      await this.#wc.debugger.sendCommand("Input.insertText", { text: ch });
      await sleep(rand(40, 110));
    }
  }

  async upload(target: ElementRef | string, paths: string[]): Promise<void> {
    if (!paths.length) return;
    const selector = typeof target === "string" ? target : (JSON.parse(target.token) as { sel?: string }).sel ?? "";
    const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf" };
    const files = paths.map((fp) => ({ name: basename(fp), mimeType: MIME[extname(fp).toLowerCase()] ?? "application/octet-stream", base64: readFileSync(fp).toString("base64") }));
    const sel = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const r = (await this.#wc.executeJavaScript(`(async function(){
      var files=${JSON.stringify(files)};var input=document.querySelector('${sel}');if(!input)return {ok:false};
      var dt=new DataTransfer();for(var k=0;k<files.length;k++){var f=files[k],bin=atob(f.base64),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);dt.items.add(new File([u],f.name,{type:f.mimeType}));}
      Object.defineProperty(input,'files',{value:dt.files,configurable:true});input.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true};
    })()`)) as { ok: boolean };
    if (!r?.ok) throw new Error("文件注入失败");
  }

  async scroll(opts: ScrollOptions): Promise<void> {
    let x = 400;
    let y = 300;
    if (opts.target) {
      const c = await this.#coordsOf(opts.target);
      x = c.x;
      y = c.y;
    }
    await this.#wc.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: opts.dx ?? 0, deltaY: opts.dy ?? 0, modifiers: 0 });
  }

  async screenshot(opts?: ScreenshotOptions): Promise<Uint8Array> {
    const img = await this.#wc.capturePage();
    const scaled = !opts?.fullPage && img.getSize().width > 1024 ? img.resize({ width: 1024 }) : img;
    return scaled.toJPEG(70);
  }

  destroy(): void {
    this.#unbindSurface?.dispose();
    if (this.#backdrop && !this.#backdrop.webContents.isDestroyed()) this.#backdrop.webContents.close();
    this.#backdrop = null;
    try {
      this.#wc.debugger.detach();
    } catch {
      /* 已 detach */
    }
    if (!this.#wc.isDestroyed()) this.#wc.close();
  }
}

/** 注入 HostServices.webview 的 driver:造 view、绑 surface。 */
export class ElectronWebviewDriver implements WebviewDriver {
  #surfaces: SurfaceManager;
  constructor(surfaces: SurfaceManager) {
    this.#surfaces = surfaces;
  }

  async create(opts: DriverCreateOptions): Promise<DriverWebview> {
    const view = new ElectronWebview({ partition: opts.partition });
    if (opts.surface) {
      const d = this.#surfaces.bindView(opts.surface, view.nativeView);
      view.bindSurfaceDisposable(d);
    }
    view.setInteractive(opts.interactive);
    return view;
  }
}
```

- [ ] **Step 2: typecheck shell**

Run: `pnpm -F @boundary-desktop/shell typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add apps/shell/src/main/webview-driver.ts
git commit -m "feat(shell): ElectronWebviewDriver —— WebContentsView + CDP + 原语 + backdrop + 事件"
```

### Task B3: 注入 HostServices

**Files:** Modify `apps/shell/src/main/index.ts`

- [ ] **Step 1: import + 注入**

顶部 import 区(`import { SurfaceManager } from "./surface.js";` 之后)加:
```ts
import { ElectronWebviewDriver } from "./webview-driver.js";
```

把装配段(`const host = new HostServices({...})` 与 `const surfaces = new SurfaceManager();`)调整为 **surfaces 先建、再建 host 并注入 driver**:

```ts
const bridge = new RendererBridge();
const surfaces = new SurfaceManager();
const authDriver = new ShellAuthDriver();
// 落盘 storage:模块 ctx.storage 跨重启留存(默认内存后端进程退出即丢)。
const host = new HostServices({
  auth: authDriver,
  storage: new DiskStorageBackend(
    join(app.getPath("userData"), "boundary-storage.json"),
  ),
  webview: new ElectronWebviewDriver(surfaces),
});
```

(删掉原先单独的 `const bridge = new RendererBridge();` / `const surfaces = new SurfaceManager();` 两行旧位置,避免重复声明。)

- [ ] **Step 2: typecheck + 启动冒烟**

Run: `pnpm -F @boundary-desktop/shell typecheck`
Expected: PASS。

Run(人工): `pnpm dev`
Expected: 应用正常起、现有 browser 模块照旧工作(driver 已装配但未被调用)。无回归即 Stage B 完成。

- [ ] **Step 3: Commit**

```bash
git add apps/shell/src/main/index.ts
git commit -m "feat(shell): 注入 ElectronWebviewDriver 到 HostServices.webview"
```

---

## Stage C — browser 迁移为消费方(**活体验证**)

把 browser 的 view 创建 + 自动化驱动改走 `ctx.webview`。这是整条链路的 `pnpm dev` 验证。

### Task C1: automation.ts 改走 handle（wc → WebviewHandle)

**机械替换规则**(逐函数套用,结构不变):
- 函数签名 `wc: WebContents` → `view: WebviewHandle`,函数体内 `wc` → `view`。
- `wc.debugger.sendCommand(m, p)` → `view.cdp.send(m, p)`。
- `wc.executeJavaScript(code, true)` / `wc.debugger.sendCommand("Runtime.evaluate", {expression, returnByValue})` 取 `.result.value` → `view.eval(code)`(直接返回值)。
- `wc.debugger.on("message", onMsg)` + `removeListener` → `view.cdp.on(method, cb)` 返回的 `Disposable`,用 `dispose()` 退订。
- 删除 `ensureAttached`(driver 已 attach 调试器);删 `import type { WebContents }`,改 `import type { WebviewHandle } from "@boundary-desktop/contract"`。

**Files:** Modify `modules/browser/src/automation.ts`

- [ ] **Step 1: 顶部 import + 删 ensureAttached**

```ts
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { WebviewHandle } from "@boundary-desktop/contract";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
```
(删掉 `import type { WebContents } from "electron";` 与整个 `export function ensureAttached(...) {...}`。)

- [ ] **Step 2: `findElement` 改走 eval**

把 `findElement` 签名与体改为(删去 `ensureAttached(wc)` 与 `wc.debugger.sendCommand("Runtime.evaluate", ...)` 包装,直接 `view.eval`):

```ts
export async function findElement(view: WebviewHandle, target: ElementTarget, scrollIntoView = true): Promise<Coords> {
  const expr = `(function(){
    var selector=${JSON.stringify(target.selector ?? "")}, text=${JSON.stringify(target.text ?? "")}, el=null;
    if(selector&&text){try{var ns=document.querySelectorAll(selector);for(var j=0;j<ns.length;j++){var t=(ns[j].innerText||ns[j].value||'').trim();if(t===text){el=ns[j];break;}}if(!el){for(var j=0;j<ns.length;j++){var t=(ns[j].innerText||ns[j].value||'').trim();if(t&&t.includes(text)){el=ns[j];break;}}}}catch(e){}}
    else if(selector){try{el=document.querySelector(selector);}catch(e){}}
    if(!el&&text){var cs=document.querySelectorAll('button,a,input,textarea,select,label,[role="button"],[role="tab"],[role="menuitem"],[contenteditable],div,span,p');var ex=null,inc=null;for(var i=0;i<cs.length;i++){var n=cs[i],tt=(n.innerText||n.value||n.placeholder||'').trim();if(tt===text){ex=n;break;}if(!inc&&tt&&tt.includes(text))inc=n;}el=ex||inc;}
    if(!el)return null;
    if(${scrollIntoView ? "true" : "false"}){var r0=el.getBoundingClientRect();if(r0.top<0||r0.bottom>(window.innerHeight||document.documentElement.clientHeight))el.scrollIntoView({block:'center',inline:'nearest'});}
    var r=el.getBoundingClientRect();if(r.width===0||r.height===0)return null;
    return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),width:Math.round(r.width),height:Math.round(r.height)};
  })()`;
  const v = await view.eval<Coords | null>(expr);
  if (!v) throw new Error(`未找到元素: selector="${target.selector ?? ""}" text="${target.text ?? ""}"`);
  return v;
}
```

- [ ] **Step 3: `moveTo`/`click`/`scroll`/`typeText` 把 `wc`→`view`、`wc.debugger.sendCommand`→`view.cdp.send`**

- `moveTo(view, x, y)`:删 `ensureAttached`,把 `cursor` 模块级变量保留;所有 `wc.debugger.sendCommand("Input.dispatchMouseEvent", ...)` → `view.cdp.send("Input.dispatchMouseEvent", ...)`。
- `click(view, x, y)`:`moveTo(view, x, y)` + 两次 `view.cdp.send("Input.dispatchMouseEvent", {...})`。
- `scroll(view, x, y, deltaY, humanize)`:删 `ensureAttached`,`wc.debugger.sendCommand(...)` → `view.cdp.send(...)`。
- `typeText(view, text, humanize)`:删 `ensureAttached`,`insert` 改 `(c) => view.cdp.send("Input.insertText", { text: c })`;`wc.debugger.sendCommand("Input.dispatchKeyEvent", ...)` → `view.cdp.send(...)`。

- [ ] **Step 4: `setInputFiles` 改 eval**

签名 `setInputFiles(view: WebviewHandle, selector, filePaths)`;把 `wc.executeJavaScript(...)` 整段替换为 `view.eval<{ ok: boolean; error?: string }>(...)`(表达式不变)。

- [ ] **Step 5: `interceptNext` 改 cdp.send + cdp.on**

```ts
export async function interceptNext(
  view: WebviewHandle,
  urlPattern: string,
  timeout = 30000,
): Promise<{ url: string; status: number; headers: Record<string, string>; body: string }> {
  await view.cdp.send("Network.enable", {});
  const re = new RegExp("^" + urlPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"));
  return new Promise((resolve, reject) => {
    const sub = view.cdp.on("Network.responseReceived", (params) => {
      const p = params as { requestId?: string; response?: { url: string; status: number; headers: Record<string, string> } };
      if (!p.response || !re.test(p.response.url)) return;
      const { requestId, response } = p as { requestId: string; response: NonNullable<typeof p.response> };
      sub.dispose();
      clearTimeout(timer);
      void view.cdp
        .send("Network.getResponseBody", { requestId })
        .then((b) => {
          const body = b as { body: string; base64Encoded: boolean };
          resolve({ url: response.url, status: response.status, headers: response.headers, body: body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body });
        })
        .catch(reject);
    });
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error(`拦截超时(${timeout}ms): ${urlPattern}`));
    }, timeout);
  });
}
```

- [ ] **Step 6: typecheck(此刻 tools/dsl 还引旧签名,会红——下一任务一起修;先只过 automation 自身)**

Run: `pnpm -F @boundary-desktop/module-browser typecheck`
Expected: 仅 `tools.ts`/`dsl-engine.ts` 因 `findElement(wc,...)` 调用报错(automation.ts 自身无错)。继续 C2/C3 后再绿。

### Task C2: dsl-engine.ts 改走 handle

**Files:** Modify `modules/browser/src/dsl-engine.ts`

- [ ] **Step 1: import + EngineDeps + runScript 签名 wc→view**

- 顶部 `import type { WebContents } from "electron";` → 删;`automation.js` 引入不变;加 `import type { WebviewHandle } from "@boundary-desktop/contract";`。
- `EngineDeps.active: () => WebContents | null` → `() => WebviewHandle | null`。
- `runScript` 内 `const wc = deps.active(); if (!wc || wc.isDestroyed())` → `const view = deps.active(); if (!view)`(WebviewHandle 无 isDestroyed;失活由框架回收,调用即抛)。所有 `wc` → `view`。

- [ ] **Step 2: exec / 各 helper 的 wc→view 与原语替换**

- `runStepWithRetry(view, ...)`、`exec(view, ...)`、`scrollBy(view, ...)`、`viewport(view)`、`waitForElement(view, ...)`、`scrollToElement(view, ...)`、`uploadViaChooser(view, ...)`、`evalInPage(view, ...)`、`assertPageState(view, ...)`、`waitForNavigation(view, ...)`、`waitForLoad(view, ...)`、`reload(view, ...)`:签名 `wc: WebContents` → `view: WebviewHandle`。
- 替换规则:
  - `wc.loadURL(u).catch(...)` → `view.navigate(u)`(driver 的 navigate 已内含 ERR_ABORTED 容错,去掉 `.catch`)。
  - `wc.executeJavaScript(code)` → `view.eval(code)`。
  - `wc.debugger.sendCommand("Runtime.evaluate", {expression, returnByValue, awaitPromise})` 取 value(`evalInPage`)→ `view.eval(js)`(driver eval 已 awaitPromise);`evalInPage` 整函数可简化为 `return view.eval(js);`(异常已在 driver eval 内转抛)。
  - `wc.debugger.sendCommand("Page.setInterceptFileChooserDialog"/"Page.handleFileChooser", ...)`(`uploadViaChooser`)→ `view.cdp.send(...)`;`wc.debugger.on("message", onMsg)` 过滤 `Page.fileChooserOpened` → `view.cdp.on("Page.fileChooserOpened", () => {...})` 的 `Disposable.dispose()`。
  - `wc.reload()`（`reload`）→ `view.reload()`。
  - `wc.on("did-navigate"/"did-navigate-in-page"/"did-finish-load", on)` + `removeListener`(`waitForNavigation`/`waitForLoad`/`reload`)→ `view.on(ev, on)` 返回 `Disposable`;`off()` 改为逐个 `dispose()`。

  `waitForNavigation` 重写参考:
```ts
function waitForNavigation(view: WebviewHandle, timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const subs = [view.on("did-navigate", on), view.on("did-navigate-in-page", on)];
    function off(): void { for (const s of subs) s.dispose(); }
    function on(): void { clearTimeout(timer); off(); resolve(); }
    const timer = setTimeout(() => { off(); reject(new Error("等待页面导航超时")); }, timeout);
  });
}
```
  `waitForLoad` / `reload` 同法,监听 `did-navigate` / `did-navigate-in-page` / `did-finish-load` 三事件;`reload` 在挂监听后调 `view.reload()`。`waitForLoad` 开头的 `wc.executeJavaScript("document.readyState")` → `view.eval("document.readyState")`。

- [ ] **Step 3: typecheck(待 C3 修 tools 后整体绿)**

### Task C3: tools.ts / automation-tools.ts 改 active(): WebviewHandle

**Files:** Modify `modules/browser/src/tools.ts`, `modules/browser/src/automation-tools.ts`

- [ ] **Step 1: tools.ts deps 与原语调用**

- import:`import type { WebContents } from "electron";` → 删;加 `import type { WebviewHandle } from "@boundary-desktop/contract";`。
- `ToolDeps.active: () => WebContents | null` → `() => WebviewHandle | null`。
- `const wc = (): WebContents => { const w = deps.active(); if (!w || w.isDestroyed()) throw ... }` → `const h = (): WebviewHandle => { const w = deps.active(); if (!w) throw new Error("无活动标签"); return w; }`。
- `const js = (code) => wc().executeJavaScript(code, true)` → `const js = (code) => h().eval(code)`。
- `navigate` 工具:`const w = wc(); await w.loadURL(url).catch(...)` → `const w = h(); await w.navigate(url)`;返回 `{ url, title }` 改为订阅缓存或 eval 取:简化为 `return { ok: true }`(地址/标题由 chrome 工具栏经 did-navigate 事件更新,工具无需回传)。
- `screenshot` 工具:`const img = await wc().capturePage(); ... toJPEG` → `return { mimeType: "image/jpeg", data: Buffer.from(await h().screenshot()).toString("base64") }`(driver screenshot 已缩放 JPEG)。
- `click`/`type`/`upload`/`scroll`/`intercept_next`/`wait_for`/`get_text`/`snapshot`:把 `wc()` → `h()`,`findElement(wc(), ...)`/`click(wc(), ...)`/`typeText(wc(), ...)`/`setInputFiles(wc(), ...)`/`interceptNext(wc(), ...)` 的首参 `wc()` → `h()`。`scroll` 工具的 `js(...)` 已走 `h().eval`,不变。

- [ ] **Step 2: automation-tools.ts deps 类型**

- import:删 `WebContents`,加 `import type { WebviewHandle } from "@boundary-desktop/contract";`。
- `Deps.active: () => WebContents | null` → `() => WebviewHandle | null`(`runScript` 的 `deps.active` 透传,类型随 dsl-engine 的 `EngineDeps` 一致)。

- [ ] **Step 3: 模块整体 typecheck**

Run: `pnpm -F @boundary-desktop/module-browser typecheck`
Expected: PASS(automation/dsl/tools 一致)。

### Task C4: tab-view-host.ts 改用 ctx.webview.create

把「`new WebContentsView` + UA + 事件 + context-menu + `surface.attach`」整体换成 `ctx.webview.create({ profileId, surface })` 返回的 `WebviewHandle`;导航事件 / 右键菜单经 `handle.on`。

**Files:** Modify `modules/browser/src/tab-view-host.ts`

- [ ] **Step 1: 重写 HostDeps + TabViewHost 持 WebviewHandle**

```ts
import { Menu, type MenuItemConstructorOptions, app } from "electron";
import type { Disposable, Rect, WebviewCreateOptions, WebviewHandle, WebviewKernel } from "@boundary-desktop/contract";
import type { TabMeta } from "./ipc.js";

interface HostDeps {
  /** 经 kernel 造一块绑定到模块 surface 的 view(profile 分区隔离)。 */
  create: (opts: WebviewCreateOptions) => Promise<WebviewHandle>;
  /** 空地址的新标签页。 */
  startPage: string;
  /** 某标签导航态变化(喂回 TabStore)。 */
  onNav: (id: number, patch: Partial<Omit<TabMeta, "id">>) => void;
}

/** 每标签一个 kernel view(WebviewHandle)。view 由 kernel 持有/绑 surface;导航事件、右键菜单经 handle.on。 */
export class TabViewHost {
  #views = new Map<number, { handle: WebviewHandle; subs: Disposable[]; ready: Promise<void> }>();
  #deps: HostDeps;

  constructor(deps: HostDeps) {
    this.#deps = deps;
  }

  sync(tabs: TabMeta[]): void {
    const live = new Set(tabs.map((t) => t.id));
    for (const id of [...this.#views.keys()]) if (!live.has(id)) this.#destroy(id);
    for (const t of tabs) if (!this.#views.has(t.id)) this.#create(t.id, t.url, t.profileId ?? "default");
  }

  /** 句柄就绪后才可驱动;tools 的 active() 经此取(见 index.ts active())。 */
  handle(id: number | null): WebviewHandle | null {
    return id != null ? (this.#views.get(id)?.handle ?? null) : null;
  }

  layout(rect: Rect, visible: boolean, activeId: number | null): void {
    for (const [id, e] of this.#views) {
      e.handle.setBounds(rect);
      e.handle.setVisible(visible && id === activeId);
    }
  }

  destroyAll(): void {
    for (const id of [...this.#views.keys()]) this.#destroy(id);
  }

  #create(id: number, url: string, profileId: string): void {
    const subs: Disposable[] = [];
    const entry: { handle: WebviewHandle | null; subs: Disposable[]; ready: Promise<void> } = { handle: null, subs, ready: Promise.resolve() };
    entry.ready = this.#deps.create({ profileId, interactive: true }).then((handle) => {
      entry.handle = handle;
      const nav = (p: { url: string; title: string; canGoBack: boolean; canGoForward: boolean }): void => {
        const blank = p.url.startsWith("data:") || p.url.includes("/newtab/index.html");
        this.#deps.onNav(id, { url: blank ? "" : p.url, title: p.title, canGoBack: p.canGoBack, canGoForward: p.canGoForward });
      };
      subs.push(handle.on("did-navigate", nav));
      subs.push(handle.on("did-navigate-in-page", nav));
      subs.push(handle.on("title-updated", (p) => this.#deps.onNav(id, { title: p.title })));
      subs.push(handle.on("favicon-updated", (p) => this.#deps.onNav(id, { favicon: p.favicon })));
      subs.push(handle.on("context-menu", (p) => this.#contextMenu(handle, p)));
      void handle.navigate(url || this.#deps.startPage);
    });
    this.#views.set(id, entry as { handle: WebviewHandle; subs: Disposable[]; ready: Promise<void> });
  }

  #contextMenu(handle: WebviewHandle, p: import("@boundary-desktop/contract").WebviewContextMenu): void {
    const items: MenuItemConstructorOptions[] = [
      { label: "后退", enabled: p.canGoBack, click: () => handle.goBack() },
      { label: "前进", enabled: p.canGoForward, click: () => handle.goForward() },
      { label: "重新加载", click: () => handle.reload() },
      { type: "separator" },
      { label: "复制", role: "copy", enabled: p.editFlags.canCopy },
      { label: "粘贴", role: "paste", enabled: p.editFlags.canPaste },
      { label: "全选", role: "selectAll" },
    ];
    if (!app.isPackaged) {
      // dev:检查元素经 cdp 触发(Inspector.inspect 不便;用 DevTools open 命令兜底)。
      items.push({ type: "separator" }, { label: "检查元素", click: () => void handle.cdp.send("Inspector.enable").then(() => handle.cdp.send("DOM.enable")) });
    }
    Menu.buildFromTemplate(items).popup();
  }

  #destroy(id: number): void {
    const e = this.#views.get(id);
    if (!e) return;
    this.#views.delete(id);
    void e.ready.then(() => {
      for (const s of e.subs) s.dispose();
      e.handle?.dispose(); // kernel 销毁 view
    });
  }
}
```

> 注:`repaint()`(随主题刷背景色)删除——背景色由 kernel view 管;主题切换不再需要模块重绘内容 view。`contentUserAgent` / `navPatch` 删除(UA 归 driver,nav 态来自事件 payload)。`#contextMenu` 的「检查元素」用 CDP 兜底:openclaw 原生 `inspectElement` 需 webContents,模块已无;dev 下可接受降级或后续在 kernel 加 `openDevTools` 原语(YAGNI,暂不加)。

- [ ] **Step 2: 模块 typecheck(index.ts 仍引旧 host 形参,下一任务修)**

### Task C5: index.ts 接线 ctx.webview + profiles 迁移 + context-menu

**Files:** Modify `modules/browser/src/index.ts`

- [ ] **Step 1: 删 chromeView 之外的 WebContentsView/surface.attach;TabViewHost 改注入 create**

- import:`WebContentsView` 保留(chrome 条仍是模块自有 toolbar 渲染页,经 `surface.attach`——见下注);加 `WebviewHandle` 类型按需。
- `host = new TabViewHost({ attach: (v) => s.attach(v), bg, startPage, onNav })` → `host = new TabViewHost({ create: (opts) => ctx.webview.create({ ...opts, surface: s }), startPage: newtabUrl, onNav: (id, patch) => store!.update(id, patch) })`。
- `active(): WebContents | null` → `active(): WebviewHandle | null { return host?.handle(store?.activeId() ?? null) ?? null; }`(类型改 `WebviewHandle`)。
- `relayout()` 里 `host?.layout(content, visible, store?.activeId() ?? null)` 不变(layout 现作用于 handle)。删 `host?.repaint()` 与 `s.theme.subscribe` 里的 `host?.repaint()` 调用。

> **chrome 条决策(写明)**:browser 的 toolbar 渲染页(`chromeView`)是模块自有 UI,**不是**内容网页,本就该归模块、经 `surface.attach` 挂载。但 Stage D 要从契约删 `attach`。解决:chrome 条也改走 kernel——`ctx.webview.create({ surface: s })` 造一块 view,`handle.navigate("app://modules/.../chrome/index.html")` 载入 toolbar 页。kernel view 走 `persist:wv-default` 分区即可(toolbar 页无需隔离)。这样模块零 `surface.attach`,Stage D 可净删。**实施**:把 `chromeView = new WebContentsView({...}); s.attach(chromeView)` 换成 `const chromeHandle = await ctx.webview.create({ surface: s }); await chromeHandle.navigate(chromeUrl)`,后续 `chromeView.webContents.send(...)` 等 chrome IPC 改为经 chromeHandle 对应 webContents——**但 handle 不暴露 webContents/send**。

> **chrome 条 IPC 障碍 + 决定**:toolbar 页与 main 的双向 IPC(`CH.*`:state 下发 + 指令上行)依赖 `chromeView.webContents.send` / `e.sender === chromeView.webContents`,kernel handle 不暴露 webContents。两条路:(a) kernel 加一个「取该 view 的 webContents 以挂模块自有 IPC」逃生口——但这把 Electron 句柄漏进契约,**违背通用面**;(b) chrome 条**保留** `surface.attach`(它是模块自有 UI 的合法用途,spec 不变量本就允许模块自持 view),Stage D **只删「内容 view 不再用 attach」不删 attach 本身**。

> **结论(覆盖 Stage D 范围)**:`ModuleSurface.attach` **保留在契约**——它服务「模块自有 chrome UI(非 kernel 渲染的网页)」这一合法场景(browser toolbar 即是)。kernel 只接管**内容网页 view**。故本 plan **不删 attach**;Stage D 改为「校验内容 view 全部走 kernel、attach 仅余 chrome 条一处」的收口审计。spec §5/§9「废 attach」据此修正:attach 不废,职责收窄为「模块自有 chrome view」。

- [ ] **Step 2: chromeView 维持 surface.attach 不变,仅内容标签走 kernel**

故 `chromeView = new WebContentsView({...})` + `s.attach(chromeView)` + 全部 `CH.*` chrome IPC **保持原样**。只有 `TabViewHost`(内容标签)改走 kernel(C4 已做)。`active()` 返回 `WebviewHandle`。

- [ ] **Step 3: profiles 迁移到 ctx.webview.profiles**

把模块内 `profiles` Map + `persistProfiles` + `showProfileMenu` 改调 `ctx.webview.profiles`:
- 删 `const profiles = new Map(...)`、`profileSeq`、`persistProfiles`、`ctx.storage.get/set("profiles")` 那段回载逻辑。
- `useProfile(id)` / `openTab(url, profile)`:profile 不存在时改 `await ctx.webview.profiles.create(name)`;当前账号仍由 `store.setCurrentProfile`(TabStore 保持 profileId 字符串,kernel profile id 即其值)。
- `listProfiles()` → `(await ctx.webview.profiles.list()).map((p) => ({ id: p.id, name: p.name, current: p.id === store!.currentProfile() }))`(注:`browserTools` 的 `listProfiles` 签名要改 async,返回 Promise;tools.ts `profiles` 工具 handler 改 `await deps.listProfiles()`)。
- `showProfileMenu()`:`[...profiles.entries()]` → `await ctx.webview.profiles.list()`;「新建账号」→ `await ctx.webview.profiles.create(...)`。
- partition 约定变化:browser 旧用 `persist:browser-${profileId}`,kernel 用 `persist:wv-${profileId}`。**迁移影响**:已登录的旧浏览器分区不自动带过来(不同分区名)。这是已知的一次性登录态重置,验证清单标注;如需保留可在 kernel 加分区别名(YAGNI,暂不做)。

- [ ] **Step 4: 模块整体 typecheck**

Run: `pnpm -F @boundary-desktop/module-browser typecheck`
Expected: PASS。

- [ ] **Step 5: 构建模块 + 活体验证**

Run: `pnpm build:mods`
Expected: browser dist 重建无错。

Run(人工): `pnpm dev`,打开 browser 模块,逐项过**验证清单**(见末尾)。

- [ ] **Step 6: Commit**

```bash
git add modules/browser/src/automation.ts modules/browser/src/dsl-engine.ts modules/browser/src/tools.ts modules/browser/src/automation-tools.ts modules/browser/src/tab-view-host.ts modules/browser/src/index.ts
git commit -m "refactor(browser): 迁移为 ctx.webview 消费方(view/CDP/automation/profiles 改走 kernel)"
```

---

## Stage D — 收口审计 + 全仓校验

attach 不删(见 C5 结论);本 stage 做收口与全仓回归。

- [ ] **Step 1: 审计内容 view 已全部走 kernel**

Run: `grep -rn "new WebContentsView" modules/browser/src`
Expected: 仅 `index.ts` 的 `chromeView`(模块自有 toolbar)一处;`tab-view-host.ts` 无。

Run: `grep -rn "surface.attach\|s.attach" modules/browser/src`
Expected: 仅 `index.ts` 的 `s.attach(chromeView)` 一处。

- [ ] **Step 2: 全仓 typecheck + host 测试**

Run: `pnpm -r typecheck`
Expected: PASS。

Run: `pnpm -F @boundary-desktop/host test`
Expected: PASS。

- [ ] **Step 3: 更新契约注释,收窄 attach 职责**

`packages/contract/src/contract.ts` 的 `ModuleSurface.attach` 注释改为(只写当前状态):
```ts
  /** 把模块**自有的上层应用 UI**(消费方自己的壳:浏览器 toolbar、chat 侧栏框等,各模块形态不同)
   *  挂到本区域;返回句柄,deactivate 自动摘除。这层壳归模块,kernel 不感知。
   *  被浏览/驱动的**内容网页 view** 应经 `ctx.webview.create({ surface })` 由 kernel 持有,不走此入口。
   *  view 为不透明句柄;detach/merge 时框架把已 attach 的 view 整体 re-parent。 */
  attach(view: object): Disposable;
```

- [ ] **Step 4: Commit**

```bash
git add packages/contract/src/contract.ts
git commit -m "docs(contract): 收窄 ModuleSurface.attach 职责为模块自有 chrome view"
```

---

## 验证清单(`pnpm dev`,人工)

**browser 当场验(本阶段必须全过)**
- [ ] 打开 browser:toolbar(chrome 条)正常显示(`surface.attach` 路径未动)。
- [ ] 新建标签 → 内容区出现 kernel view;newtab 主页经 `app://` 正常载入。
- [ ] 地址栏输入 URL 导航 → 页面加载;地址栏/标题/前进后退态随 `did-navigate` 事件更新。
- [ ] 后退/前进/重载按钮可用(经 `handle.goBack/goForward/reload`)。
- [ ] 多标签切换:仅活动标签可见;切后台模块整块隐藏(layout setVisible 生效)。
- [ ] 右键内容页 → 原生菜单弹出(经 `context-menu` 事件自建),后退/前进/复制/粘贴可用。
- [ ] `browser.*` 工具经 WS/MCP 仍可用:`navigate`/`snapshot`/`get_text`/`screenshot`/`eval`/`scroll`/`wait_for`/`click`/`type`/`upload`/`intercept_next` 各跑一遍(走 handle.cdp/eval)。
- [ ] `automation.*`:跑一个内置脚本(`automation_run`),确认 DSL 步骤(navigate/click/type/scroll/extract/sessionCapture)经 handle 驱动成功。
- [ ] 多账号:`new_tab` 指定 profile → 新账号在 `ctx.webview.profiles` 出现;不同账号 cookie 隔离(`persist:wv-<id>` 分区)。
- [ ] surface detach/merge:把 browser 分离独立窗 → 内容 view + chrome 条整体 re-parent;合并回主窗正常。
- [ ] deactivate(切走再切回 / 关模块):view 随激活回收,无残留 native 糊层。

**chat 阶段才验(本阶段仅标注,不阻塞)**
- [ ] kernel typed `find/click/type/upload/scroll`(driver 已实现,smoke-only)。
- [ ] `setInteractive(false)` backdrop 锁定(browser 全程 interactive=true,未触发)。
- [ ] renderer IPC bounce(`RENDERER_WEBVIEW_STUB` 仍在;chat 阶段替换)。

**已知一次性影响(标注,非缺陷)**
- [ ] 分区从 `persist:browser-*` 改 `persist:wv-*`:旧浏览器登录态不自动迁移,首次需重新登录。

---

## 完成判据

- `pnpm -r typecheck` 全绿;`pnpm -F @boundary-desktop/host test` 全绿。
- browser 经 `pnpm dev` 全量验证清单通过:内容 view / 导航 / 多标签 / 右键菜单 / `browser.*` / `automation.*` / 多账号 / detach 均经 `ctx.webview` 工作。
- 内容网页 view 零 `new WebContentsView` / 零 `surface.attach`(仅 chrome 条保留 attach,职责已收窄并注释)。
- driver 完整实现 DriverWebview(browser 验 nav/cdp/eval/事件/screenshot 路径;find/click/type/backdrop 待 chat)。
- renderer bounce 与 chat 消费方留独立后续(stub 仍在,已注明)。
```
