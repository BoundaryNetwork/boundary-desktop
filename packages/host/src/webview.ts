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
  goBack(): void;
  goForward(): void;
  reload(): void;
  on<E extends WebviewEvent>(event: E, listener: (payload: WebviewEventMap[E]) => void): Disposable;
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

/** 把 driver 产物包成契约 WebviewHandle:整体 teardown 绑到激活 track,deactivate 自动回收。
 *  teardown 顺序固定为「先退订全部 on/cdp.on 订阅,再 view.destroy()」——避免 native view
 *  销毁时同步抛出的事件回打到尚未退订的监听器上(模块此刻已在拆除中)。
 *  teardown 幂等:消费方可提前 dispose 一次、框架 deactivate 再调一次(契约允许),二次不重复销毁。 */
export function wrapDriverView(view: DriverWebview, track: TrackDisposable): WebviewHandle {
  const subs: Disposable[] = [];
  const trackSub = (d: Disposable): Disposable => {
    subs.push(d);
    return d;
  };
  let torn = false;
  const teardown = (): void => {
    if (torn) return;
    torn = true;
    for (const s of subs) s.dispose(); // 先退订
    view.destroy(); // 再销毁
  };
  const lifecycle = track({ dispose: teardown });
  return {
    navigate: (url) => view.navigate(url),
    setBounds: (rect) => view.setBounds(rect),
    setVisible: (v) => view.setVisible(v),
    setInteractive: (on) => view.setInteractive(on),
    goBack: () => view.goBack(),
    goForward: () => view.goForward(),
    reload: () => view.reload(),
    on: <E extends WebviewEvent>(event: E, listener: (payload: WebviewEventMap[E]) => void) =>
      trackSub(view.on(event, listener)),
    find: (selector) => view.find(selector),
    click: (target) => view.click(target),
    type: (target, text) => view.type(target, text),
    upload: (target, paths) => view.upload(target, paths),
    scroll: (opts) => view.scroll(opts),
    screenshot: (opts) => view.screenshot(opts),
    eval: <T = unknown>(expr: string) => view.eval<T>(expr),
    cdp: {
      send: (method, params) => view.cdp.send(method, params),
      on: (event, listener) => trackSub(view.cdp.on(event, listener)),
    },
    dispose: () => lifecycle.dispose(),
  };
}

// ===========================================================================
// ProfileRegistry —— host 级共享 profile 注册表(共享登录态)。
// 经 StorageBackend 持久化(原始 backend,不按模块命名空间;跨模块共享)。
// ===========================================================================

// 保留前缀:host 级共享键,不走模块命名空间。`__host__:` 不是合法模块 id(kebab-case 无下划线),
// 故与任何模块经 ctx.storage 写的键结构性不撞(NamespacedStorage 用 `<moduleId>:` 前缀)。
const PROFILES_KEY = "__host__:webview:profiles";
const DEFAULT_PROFILE: WebviewProfile = { id: "default", name: "默认" };

interface PersistShape {
  seq: number;
  profiles: WebviewProfile[];
}

export class ProfileRegistry {
  #backend: StorageBackend;
  #seq = 0;
  #profiles: WebviewProfile[] = [DEFAULT_PROFILE];
  #loadPromise: Promise<void> | null = null;

  constructor(backend: StorageBackend) {
    this.#backend = backend;
  }

  /** 懒加载一次:memoize 加载 Promise——避免并发 create/remove 各自读后互相覆盖(check-then-act 竞态)。 */
  #ensureLoaded(): Promise<void> {
    return (this.#loadPromise ??= this.#load());
  }

  async #load(): Promise<void> {
    const raw = (await this.#backend.get(PROFILES_KEY)) as PersistShape | null;
    if (raw) {
      this.#seq = raw.seq;
      this.#profiles = [...raw.profiles];
    }
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

  /** 删除指定 profile;default 不可删。删不存在的 id 是幂等 no-op(不抛错)。 */
  async remove(id: string): Promise<void> {
    if (id === DEFAULT_PROFILE.id) throw new Error("default 账号不可删除");
    await this.#ensureLoaded();
    this.#profiles = this.#profiles.filter((p) => p.id !== id);
    await this.#persist();
  }

  /** profileId → 持久隔离分区名(给 driver 建 view 用)。调用方负责确保 id 已存在;此处不校验。 */
  resolvePartition(profileId?: string): string {
    return `persist:wv-${profileId ?? DEFAULT_PROFILE.id}`;
  }
}
