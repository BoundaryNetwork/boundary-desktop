# WebView Kernel 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把浏览器「网页渲染 + 控制 + CDP + 单步原语 + profile」抽成 WebView Kernel 下沉基座,经 `BaseContext.webview` 通用面暴露给所有模块;`modules/browser` 退化为消费方。

**Architecture:** 沿用 host 既有 seam 注入模式——契约定通用能力面,`packages/host` 持「能力 + 共享 profile 注册表」并定义 `WebviewDriver` 环境 seam,`apps/shell` 注入 Electron `WebContentsView` 实现(host 本体保持 headless 可测)。本计划仅覆盖 **Phase 1(契约 + host 核心,headless 可单测)**;Phase 2(shell Electron driver + IPC bounce)、Phase 3(browser 模块改造)在末尾给路线图,待 Phase 1 接口锁定后各自展开为独立 plan。

**Tech Stack:** TypeScript 6 NodeNext ESM · vitest 4 · pnpm workspace · `@boundary-desktop/contract` 类型契约 · `@boundary-desktop/host` 基座实现。

**Spec:** `docs/superpowers/specs/2026-06-07-webview-kernel-design.md`

---

## 文件结构(Phase 1)

- `packages/contract/src/contract.ts` — 新增 `WebviewProfile` / `WebviewEvent` / `ElementRef` / `ScrollOptions` / `ScreenshotOptions` / `WebviewHandle` / `WebviewCreateOptions` / `WebviewKernel` 类型;`BaseContext` 加 `webview` 字段(Task 3 才加,保持中途绿)。
- `packages/contract/src/version.ts` — `HOST_API_VERSION` `0.2.0` → `0.3.0`(Task 4)。
- `packages/contract/package.json` — `version` 同步 `0.3.0`(Task 4)。
- `packages/host/src/webview.ts` — **新建**。`WebviewDriver` / `DriverWebview` seam 接口 + `wrapDriverView`(把 driver 产物包成契约 `WebviewHandle`,dispose 绑 track)+ `ProfileRegistry`(host 级共享 profile,经 `StorageBackend` 持久化)。
- `packages/host/src/capabilities.ts` — `HostServices` 加 `webview?: WebviewDriver` 注入 + 持 `ProfileRegistry`;`forModule` 产出 `ctx.webview`。
- `packages/host/src/index.ts` — 导出 `WebviewDriver` / `DriverWebview` / `ProfileRegistry`。
- `packages/host/test/webview.test.ts` — **新建**。ProfileRegistry + ctx.webview 单测。
- `modules/*/manifest.json` — 6 个模块 `hostApiVersion` `^0.2.0` → `^0.3.0`(Task 4)。

---

## Task 1: 契约新增 webview 类型(不动 BaseContext)

先把所有新类型定义好但**不挂到 `BaseContext`**——这样契约包(types-only)typecheck 通过、host 也未被波及,中途仓库保持绿。

**Files:**
- Modify: `packages/contract/src/contract.ts`(在 `ModuleSurface`/`ViewDefinition` 之后、`// 7. 基座内部接口` 之前插入)

- [ ] **Step 1: 在 contract.ts 插入新类型**

定位 `packages/contract/src/contract.ts` 中 `export interface MenuItemDefinition { ... }` 结束、`// 7. 基座内部接口` 注释之前,插入:

```ts
// ===========================================================================
// 6.1 WebView Kernel —— 通用宿主能力(原生网页渲染 + 驱动),非浏览器专属
// ===========================================================================

/** 一个浏览器账号:一套隔离的 cookie/storage 分区。注册表由基座持有(共享登录态)。 */
export interface WebviewProfile {
  id: string;
  name: string;
}

export type WebviewEvent = "did-navigate" | "title-updated" | "loading" | "favicon-updated";

/** 页面节点的不透明引用(driver 内部映射到 CDP backendNodeId 等);消费方只原样传回。 */
export interface ElementRef {
  readonly token: string;
}

export interface ScrollOptions {
  target?: ElementRef | string;
  dx?: number;
  dy?: number;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
}

/** 一块原生网页 view 的句柄。注册类:基座把它绑到激活生命周期,deactivate 自动销毁。
 *  对 renderer 模块所有方法经 IPC bounce 到主进程;对 main 模块主进程内直调。 */
export interface WebviewHandle extends Disposable {
  navigate(url: string): Promise<void>;
  /** 区域矩形(DIP,相对宿主窗口 content 区);消费方喂(main 派生 surface.bounds,renderer 测 DOM)。 */
  setBounds(rect: Rect): void;
  /** 模块内部显隐意图;最终可见性 = 模块前台 AND 本值(前台态框架自动叠加)。 */
  setVisible(visible: boolean): void;
  /** false=锁定:框架在 native 层盖透明 backdrop 拦人鼠标键盘;程序通道(下列)不受影响。 */
  setInteractive(on: boolean): void;
  on(event: WebviewEvent, listener: (payload: unknown) => void): Disposable;

  // --- 单步原语(下沉的 AutomationEngine)---
  find(selector: string): Promise<ElementRef | null>;
  click(target: ElementRef | string): Promise<void>;
  type(target: ElementRef | string, text: string): Promise<void>;
  upload(target: ElementRef | string, paths: string[]): Promise<void>;
  scroll(opts: ScrollOptions): Promise<void>;
  screenshot(opts?: ScreenshotOptions): Promise<Uint8Array>;
  eval<T = unknown>(expression: string): Promise<T>;

  /** 原始 CDP 通道(每个 view 一条独立会话,消费方互不干扰)。 */
  readonly cdp: {
    send(method: string, params?: object): Promise<unknown>;
    on(event: string, listener: (payload: unknown) => void): Disposable;
  };
}

export interface WebviewCreateOptions {
  /** 用哪个 profile 的分区;省略走 default。 */
  profileId?: string;
  /** 是否允许人操作;默认 true。false 由框架盖 backdrop 锁定。 */
  interactive?: boolean;
  /** 可选绑定一个 surface:view 跟随该 surface(detach 时框架整体 re-parent)。
   *  main 模块传自己的 ctx.surface;renderer 模块不传(view 挂主窗 content 区)。 */
  surface?: ModuleSurface;
}

/** 框架分配的通用「原生网页渲染 + 驱动」能力。任何 runtime 的模块都可用,框架不含浏览器业务语义。 */
export interface WebviewKernel {
  create(opts?: WebviewCreateOptions): Promise<WebviewHandle>;
  /** profile 注册表(共享登录态)。 */
  readonly profiles: {
    list(): Promise<WebviewProfile[]>;
    create(name: string): Promise<WebviewProfile>;
    remove(id: string): Promise<void>;
  };
}
```

- [ ] **Step 2: 验证契约 typecheck 通过**

Run: `pnpm -F @boundary-desktop/contract typecheck`
Expected: PASS(新类型独立,未被引用也合法)。

- [ ] **Step 3: Commit**

```bash
git add packages/contract/src/contract.ts
git commit -m "feat(contract): 新增 WebView Kernel 类型(WebviewKernel/Handle/Profile)"
```

---

## Task 2: host seam + ProfileRegistry

新建 `packages/host/src/webview.ts`:`WebviewDriver`/`DriverWebview` 环境 seam、`wrapDriverView` 包装器、`ProfileRegistry`(共享 profile,持久化)。ProfileRegistry 走 TDD;seam 接口纯类型。

**Files:**
- Create: `packages/host/src/webview.ts`
- Create: `packages/host/test/webview.test.ts`

- [ ] **Step 1: 写 ProfileRegistry 失败测试**

创建 `packages/host/test/webview.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { StorageBackend } from "../src/index.js";
import { ProfileRegistry } from "../src/index.js";

/** 测试用最小内存 backend(共享、不命名空间)。 */
function memBackend(): StorageBackend {
  const map = new Map<string, unknown>();
  return {
    async get(k) {
      return map.has(k) ? map.get(k) : null;
    },
    async set(k, v) {
      map.set(k, v);
    },
    async delete(k) {
      map.delete(k);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

describe("ProfileRegistry", () => {
  test("默认带 default 账号", async () => {
    const reg = new ProfileRegistry(memBackend());
    expect(await reg.list()).toEqual([{ id: "default", name: "默认" }]);
  });

  test("create 递增 id 并持久化;remove 删除;default 不可删", async () => {
    const backend = memBackend();
    const reg = new ProfileRegistry(backend);
    const a = await reg.create("店铺A");
    const b = await reg.create("店铺B");
    expect(a).toEqual({ id: "p1", name: "店铺A" });
    expect(b).toEqual({ id: "p2", name: "店铺B" });

    await reg.remove("p1");
    expect((await reg.list()).map((p) => p.id)).toEqual(["default", "p2"]);

    await expect(reg.remove("default")).rejects.toThrow();

    // 同一 backend 新建实例 → 从持久化恢复(含 seq,不复用已删 id)
    const reloaded = new ProfileRegistry(backend);
    expect((await reloaded.list()).map((p) => p.id)).toEqual(["default", "p2"]);
    const c = await reloaded.create("店铺C");
    expect(c.id).toBe("p3");
  });

  test("resolvePartition 按 profileId 给隔离分区", async () => {
    const reg = new ProfileRegistry(memBackend());
    expect(reg.resolvePartition(undefined)).toBe("persist:wv-default");
    expect(reg.resolvePartition("p1")).toBe("persist:wv-p1");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @boundary-desktop/host test -- webview`
Expected: FAIL(`ProfileRegistry` 未从 index 导出 / 不存在)。

- [ ] **Step 3: 写 webview.ts**

创建 `packages/host/src/webview.ts`:

```ts
import type {
  Disposable,
  ElementRef,
  ModuleSurface,
  Rect,
  ScreenshotOptions,
  ScrollOptions,
  WebviewEvent,
  WebviewHandle,
  WebviewProfile,
} from "@boundary-desktop/contract";
import type { StorageBackend } from "./capabilities.js";
import type { TrackDisposable } from "./state-container.js";

// ===========================================================================
// WebviewDriver —— 环境 seam。持窗口的环境(apps/shell)注入 Electron 实现;
// host 本体不依赖 Electron,headless 不注入 → ctx.webview.create 抛错(profiles 仍可用)。
// ===========================================================================

/** driver 产出的原始 view:动作面与 WebviewHandle 同构,但用 destroy() 代替 Disposable 语义。 */
export interface DriverWebview {
  navigate(url: string): Promise<void>;
  setBounds(rect: Rect): void;
  setVisible(visible: boolean): void;
  setInteractive(on: boolean): void;
  on(event: WebviewEvent, listener: (payload: unknown) => void): Disposable;
  find(selector: string): Promise<ElementRef | null>;
  click(target: ElementRef | string): Promise<void>;
  type(target: ElementRef | string, text: string): Promise<void>;
  upload(target: ElementRef | string, paths: string[]): Promise<void>;
  scroll(opts: ScrollOptions): Promise<void>;
  screenshot(opts?: ScreenshotOptions): Promise<Uint8Array>;
  eval<T = unknown>(expression: string): Promise<T>;
  readonly cdp: {
    send(method: string, params?: object): Promise<unknown>;
    on(event: string, listener: (payload: unknown) => void): Disposable;
  };
  destroy(): void;
}

export interface DriverCreateOptions {
  partition: string;
  interactive: boolean;
  surface?: ModuleSurface;
}

export interface WebviewDriver {
  create(opts: DriverCreateOptions): Promise<DriverWebview>;
}

/** 把 driver 产物包成契约 WebviewHandle:dispose 绑到激活 track,deactivate 自动销毁 view。 */
export function wrapDriverView(view: DriverWebview, track: TrackDisposable): WebviewHandle {
  const lifecycle = track({ dispose: () => view.destroy() });
  return {
    navigate: (url) => view.navigate(url),
    setBounds: (rect) => view.setBounds(rect),
    setVisible: (v) => view.setVisible(v),
    setInteractive: (on) => view.setInteractive(on),
    on: (event, listener) => track(view.on(event, listener)),
    find: (selector) => view.find(selector),
    click: (target) => view.click(target),
    type: (target, text) => view.type(target, text),
    upload: (target, paths) => view.upload(target, paths),
    scroll: (opts) => view.scroll(opts),
    screenshot: (opts) => view.screenshot(opts),
    eval: <T = unknown>(expr: string) => view.eval<T>(expr),
    cdp: {
      send: (method, params) => view.cdp.send(method, params),
      on: (event, listener) => track(view.cdp.on(event, listener)),
    },
    dispose: () => lifecycle.dispose(),
  };
}

// ===========================================================================
// ProfileRegistry —— host 级共享 profile 注册表(共享登录态)。
// 经 StorageBackend 持久化(原始 backend,不按模块命名空间;跨模块共享)。
// ===========================================================================

const PROFILES_KEY = "webview:profiles";
const DEFAULT_PROFILE: WebviewProfile = { id: "default", name: "默认" };

interface PersistShape {
  seq: number;
  profiles: WebviewProfile[];
}

export class ProfileRegistry {
  #backend: StorageBackend;
  #seq = 0;
  #profiles: WebviewProfile[] = [DEFAULT_PROFILE];
  #loaded = false;

  constructor(backend: StorageBackend) {
    this.#backend = backend;
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    const raw = (await this.#backend.get(PROFILES_KEY)) as PersistShape | null;
    if (raw) {
      this.#seq = raw.seq;
      this.#profiles = raw.profiles;
    }
    this.#loaded = true;
  }

  async #persist(): Promise<void> {
    const shape: PersistShape = { seq: this.#seq, profiles: this.#profiles };
    await this.#backend.set(PROFILES_KEY, shape);
  }

  async list(): Promise<WebviewProfile[]> {
    await this.#ensureLoaded();
    return [...this.#profiles];
  }

  async create(name: string): Promise<WebviewProfile> {
    await this.#ensureLoaded();
    const profile: WebviewProfile = { id: `p${++this.#seq}`, name };
    this.#profiles.push(profile);
    await this.#persist();
    return profile;
  }

  async remove(id: string): Promise<void> {
    if (id === DEFAULT_PROFILE.id) throw new Error("default 账号不可删除");
    await this.#ensureLoaded();
    this.#profiles = this.#profiles.filter((p) => p.id !== id);
    await this.#persist();
  }

  /** profileId → 持久隔离分区名(给 driver 建 view 用)。 */
  resolvePartition(profileId?: string): string {
    return `persist:wv-${profileId ?? DEFAULT_PROFILE.id}`;
  }
}
```

- [ ] **Step 4: 从 index 导出**

在 `packages/host/src/index.ts` 加(与既有导出同风格):

```ts
export { ProfileRegistry, wrapDriverView } from "./webview.js";
export type { DriverWebview, DriverCreateOptions, WebviewDriver } from "./webview.js";
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm -F @boundary-desktop/host test -- webview`
Expected: PASS(3 个 ProfileRegistry 测试)。

- [ ] **Step 6: Commit**

```bash
git add packages/host/src/webview.ts packages/host/src/index.ts packages/host/test/webview.test.ts
git commit -m "feat(host): WebviewDriver seam + ProfileRegistry(共享 profile,持久化)"
```

---

## Task 3: 挂 BaseContext.webview + HostServices 接线

把 `webview` 挂到 `BaseContext`,同时 `HostServices` 注入 driver + 持 `ProfileRegistry` + `forModule` 产出 `ctx.webview`——一次做完,typecheck 全程绿。走 TDD。

**Files:**
- Modify: `packages/contract/src/contract.ts`(`BaseContext` 加 `webview`)
- Modify: `packages/host/src/capabilities.ts:122-216`(`HostServicesOptions` + `HostServices` + `forModule`)
- Modify: `packages/host/test/webview.test.ts`(加 ctx.webview 测试)

- [ ] **Step 1: 写 ctx.webview 失败测试**

先把 `packages/host/test/webview.test.ts` **顶部 import 块**整段替换为合并后的版本(ESM 不允许文件中段再写 import):

```ts
import { describe, expect, test } from "vitest";
import type { Disposable } from "@boundary-desktop/contract";
import {
  HostServices,
  ProfileRegistry,
  type DriverCreateOptions,
  type DriverWebview,
  type StorageBackend,
  type WebviewDriver,
} from "../src/index.js";
```

再在文件**末尾追加**(无中段 import):

```ts
/** 录制型假 driver:created 记录每次 create 入参,getDestroyed() 读已销毁计数。 */
function fakeDriver(): {
  driver: WebviewDriver;
  created: DriverCreateOptions[];
  getDestroyed: () => number;
} {
  const created: DriverCreateOptions[] = [];
  let destroyed = 0;
  const noop: Disposable = { dispose: () => {} };
  const driver: WebviewDriver = {
    async create(opts) {
      created.push(opts);
      return {
        async navigate() {},
        setBounds() {},
        setVisible() {},
        setInteractive() {},
        on: () => noop,
        async find() {
          return null;
        },
        async click() {},
        async type() {},
        async upload() {},
        async scroll() {},
        async screenshot() {
          return new Uint8Array();
        },
        async eval<T>() {
          return undefined as T;
        },
        cdp: { send: async () => null, on: () => noop },
        destroy() {
          destroyed++;
        },
      } satisfies DriverWebview;
    },
  };
  return { driver, created, getDestroyed: () => destroyed };
}

/** 跑一次激活、拿到 ctx 的 webview 能力 + 触发回收的 track。 */
function forModuleWith(host: HostServices) {
  const disposables: Disposable[] = [];
  const track = <D extends Disposable>(d: D): D => {
    disposables.push(d);
    return d;
  };
  const caps = host.forModule({ id: "browser", version: "1.0.0", runtime: "main" }, track);
  return { caps, dispose: () => disposables.forEach((d) => d.dispose()) };
}

describe("HostServices.webview", () => {
  test("profiles 经 ctx.webview 暴露,跨模块共享同一注册表", async () => {
    const host = new HostServices();
    const { caps } = forModuleWith(host);
    await caps.webview.profiles.create("店铺A");
    // 另一个模块的 ctx 看到同一份
    const other = forModuleWith(host);
    expect((await other.caps.webview.profiles.list()).map((p) => p.name)).toContain("店铺A");
  });

  test("create 用 profile 分区调 driver,deactivate 销毁 view", async () => {
    const fake = fakeDriver();
    const host = new HostServices({ webview: fake.driver });
    const { caps, dispose } = forModuleWith(host);
    const p = await caps.webview.profiles.create("店铺A"); // p1
    const handle = await caps.webview.create({ profileId: p.id, interactive: false });
    expect(fake.created[0]).toMatchObject({ partition: "persist:wv-p1", interactive: false });
    dispose(); // 模拟 deactivate 回收
    expect(fake.getDestroyed()).toBe(1);
    void handle;
  });

  test("未注入 driver 时 create 抛错,但 profiles 仍可用", async () => {
    const host = new HostServices();
    const { caps } = forModuleWith(host);
    await expect(caps.webview.create()).rejects.toThrow(/WebviewDriver/);
    expect(await caps.webview.profiles.list()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm -F @boundary-desktop/host test -- webview`
Expected: FAIL(`caps.webview` 不存在 / `HostServicesOptions.webview` 未知)。

- [ ] **Step 3: 契约 BaseContext 加 webview**

在 `packages/contract/src/contract.ts` 的 `BaseContext` 里,`storage: StorageScope;` 之后加:

```ts
  /** 通用「原生网页渲染 + 驱动」能力(WebView Kernel)。所有 runtime 可用,用不用随你;
   *  renderer 模块经 IPC bounce 到主进程。无窗口的 headless 环境下 create 抛错、profiles 仍可用。 */
  readonly webview: WebviewKernel;
```

- [ ] **Step 4: HostServices 接线**

改 `packages/host/src/capabilities.ts`:

(a) 顶部 import 补上类型与本地模块:

```ts
import type { WebviewKernel } from "@boundary-desktop/contract";
import { ProfileRegistry, wrapDriverView, type WebviewDriver } from "./webview.js";
```

(b) `HostServicesOptions` 加字段:

```ts
  webview?: WebviewDriver;
```

(c) `HostServices` 加私有字段 + 构造:

```ts
  #webviewDriver?: WebviewDriver;
  #profiles: ProfileRegistry;
```
构造函数体内(`this.#network = ...` 之后)加:
```ts
    this.#webviewDriver = opts.webview;
    this.#profiles = new ProfileRegistry(this.#storage);
```

(d) `forModule` 返回对象里,`storage: ...` 之后加:

```ts
      webview: this.#buildWebview(track),
```

(e) `forModule` 方法之后、类结尾 `}` 之前加私有方法:

```ts
  #buildWebview(track: TrackDisposable): WebviewKernel {
    const profiles = this.#profiles;
    const driver = this.#webviewDriver;
    return {
      create: async (opts) => {
        if (!driver) throw new Error("未配置 WebviewDriver:当前环境无法创建网页 view");
        const view = await driver.create({
          partition: profiles.resolvePartition(opts?.profileId),
          interactive: opts?.interactive ?? true,
          surface: opts?.surface,
        });
        return wrapDriverView(view, track);
      },
      profiles: {
        list: () => profiles.list(),
        create: (name: string) => profiles.create(name),
        remove: (id: string) => profiles.remove(id),
      },
    };
  }
```

注:`WebviewKernel` 用于 `#buildWebview` 返回类型标注;profile 增删查只是委托 `ProfileRegistry`,capabilities.ts 不直接标注 `WebviewProfile`。

- [ ] **Step 5: 跑 host 全测 + 契约 typecheck**

Run: `pnpm -F @boundary-desktop/host test`
Expected: PASS(含新 3 个 webview ctx 测试 + 既有测试不回归)。

Run: `pnpm -F @boundary-desktop/contract typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/contract/src/contract.ts packages/host/src/capabilities.ts packages/host/test/webview.test.ts
git commit -m "feat(host): BaseContext.webview 接线 —— ctx.webview 产出 + 共享 profiles"
```

---

## Task 4: 版本 bump + 全仓 typecheck

`HOST_API_VERSION` 0.2.0 → 0.3.0。注意 **0.x 的 `^` 语义**:`^0.2.0` = `>=0.2.0 <0.3.0`,不满足 0.3.0 → 必须把各模块 manifest 的 `hostApiVersion` 一并提到 `^0.3.0`,否则加载被版本闸门拒绝。

**Files:**
- Modify: `packages/contract/src/version.ts:13`
- Modify: `packages/contract/package.json`(`version` 字段)
- Modify: `modules/browser/manifest.json` `modules/chat/manifest.json` `modules/canvas/manifest.json` `modules/team/manifest.json` `modules/skills/manifest.json` `modules/tasks/manifest.json`(`hostApiVersion`)

- [ ] **Step 1: bump HOST_API_VERSION**

`packages/contract/src/version.ts`:
```ts
export const HOST_API_VERSION = "0.3.0";
```

- [ ] **Step 2: bump 契约包 version**

`packages/contract/package.json` 的 `"version"` 改为 `"0.3.0"`。

- [ ] **Step 3: 各模块 manifest 提到 ^0.3.0**

6 个 `modules/*/manifest.json` 的 `"hostApiVersion": "^0.2.0"` 全改为 `"^0.3.0"`。

Run: `grep -rl '"hostApiVersion": "\^0.2.0"' modules/*/manifest.json`
Expected: 改完后该命令无输出。

- [ ] **Step 4: 全仓 typecheck + host 测试回归**

Run: `pnpm -r typecheck`
Expected: PASS。

Run: `pnpm -F @boundary-desktop/host test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/version.ts packages/contract/package.json modules/*/manifest.json
git commit -m "chore(contract): HOST_API_VERSION 0.3.0 + 模块 manifest 同步 ^0.3.0"
```

---

## Phase 1 完成判据

- `pnpm -F @boundary-desktop/host test` 全绿,含 ProfileRegistry(默认账号/递增 id/持久化恢复/分区解析)与 ctx.webview(共享 profiles / create 走分区 / deactivate 销毁 / 无 driver 抛错)。
- `pnpm -r typecheck` 全绿。
- 契约暴露 `BaseContext.webview`,host 产出能力 + 共享 profile 注册表 + `WebviewDriver` seam 就位,等待 shell 注入真实现。**此时无任何 Electron 代码,纯 headless 可测。**

---

## 后续 Phase 路线图(待 Phase 1 接口锁定后各自展开为独立 plan)

### Phase 2 — shell Electron driver + IPC bounce(`apps/shell`,验证以 `pnpm dev` 人工为主)

CLAUDE.md 明确:壳层跨进程 / native view 行为只能 `pnpm dev` 人工验证,故 Phase 2 任务以「实现 + 手动验证清单」为主,非 vitest TDD。要点:

1. **Electron `WebviewDriver` 实现**(`apps/shell/src/main/webview-driver.ts`):用 `WebContentsView` 实现 `DriverWebview`——`navigate`/`setBounds`/`setVisible`;`setInteractive(false)` 盖透明拦截 `WebContentsView` 做 backdrop;`session.fromPartition(partition)` 接分区(复用既有 `registerAppProtocolForSession`);CDP 经 `webContents.debugger`;单步原语 find/click/type/upload/scroll/screenshot/eval 平移 openclaw AutomationEngine。注入:`new Registry({ ..., })` 装配处把 driver 传进 `HostServices({ webview })`。
2. **renderer bounce**:`apps/shell/src/shared` 加 `ctxWebview*` IPC 通道常量;`preload/index.ts` 的 `moduleBridge` 加 `webviewCreate/Navigate/SetBounds/.../Cdp` 经 `aid` 绑定;`renderer/runtime.ts` 给 renderer 模块的 ctx 组一个走 bridge 的 `webview` 代理(handle 方法 → IPC)。main 模块直调,不过 bridge。
3. **surface 绑定 + detach re-parent**:`create({surface})` 时 driver 把 view 挂到该 surface 的窗口;surface detach/merge 时框架 re-parent 绑定的 view(复用 `surface.bounds` 订阅重排)。废弃 `ModuleSurface.attach`(改契约 + 删 shell 实现)。
4. **前台态自动 gate**:框架按 activation 是否前台,叠加 `setVisible` 算 view 最终可见性(§6)。
5. **profile 持久化 backend**:确认 shell 注入的 `StorageBackend` 是磁盘持久(profiles 跨重启留存);分区数据本就持久。

### Phase 3 — browser 模块改造为消费方(`modules/browser`,人工验证 + 既有行为)

1. `tab-view-host.ts`:`new WebContentsView + persist:browser-${profileId}` → `ctx.webview.create({ profileId, interactive: true, surface })`;view 句柄改持 `WebviewHandle`。
2. AutomationEngine 调用点:自持 `webContents.debugger` → handle 的单步原语 / `cdp`。
3. profile:模块内 `profiles` Map + `ctx.storage` → `ctx.webview.profiles`;chrome 账号菜单改调之。
4. **不动**:DslEngine / runner / SessionCollector / 内置脚本 / chrome / tab 策略 / `browser.*`/`automation.*` 工具注册。
5. 验证:`pnpm build:mods && pnpm dev`,人工过 tab/导航/自动化脚本/多账号隔离;`browser.*` 工具经门面仍可用。

### Phase 4 — chat 消费方(独立 spec/plan,本计划不覆盖)

spec §8 已列形态(锁定 view + AI 驱动 + 多格式预览转 URL),待 Phase 2/3 落地后单独设计。
