import { BrowserWindow, type WebContentsView } from "electron";
import type { BaseContext, Disposable, ModuleSurface, Rect } from "@boundary-desktop/contract";
import { StateContainer, type SurfaceProvider, type TrackDisposable } from "@boundary-desktop/host";

/** 左侧导航栏宽度(与 Shell.tsx 的 grid `68px 1fr` 一致)。框架据此算右侧 content 区。 */
const RAIL_WIDTH = 68;

/** 一个 main 模块本次激活分得的 UI 区域。持有它 attach 进来的 native view、可选的 detach 窗口,
 *  并把 bounds/visible/theme/detached 以只读状态暴露给模块。所有写都由 SurfaceManager 驱动。 */
class ManagedSurface implements ModuleSurface {
  readonly bounds = new StateContainer<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  readonly visible = new StateContainer(false);
  readonly theme: StateContainer<"light" | "dark">;
  readonly detached = new StateContainer(false);

  readonly id: string;
  #manager: SurfaceManager;
  #views: WebContentsView[] = [];
  #detachWin: BrowserWindow | null = null;

  constructor(id: string, manager: SurfaceManager, theme: "light" | "dark") {
    this.id = id;
    this.#manager = manager;
    this.theme = new StateContainer(theme);
  }

  /** 当前承载 view 的窗口:已分离用独立窗口,否则用主窗。 */
  #host(): BrowserWindow {
    return this.#detachWin ?? this.#manager.window();
  }

  attach(view: object): Disposable {
    const v = view as WebContentsView;
    this.#views.push(v);
    this.#host().contentView.addChildView(v);
    v.setBounds(this.bounds.get());
    v.setVisible(this.visible.get());
    return {
      dispose: () => {
        const i = this.#views.indexOf(v);
        if (i >= 0) this.#views.splice(i, 1);
        try {
          this.#host().contentView.removeChildView(v);
        } catch {
          // 窗口可能已销毁(detach 窗关闭/主窗退出),removeChildView 抛错无害。
        }
      },
    };
  }

  async detach(): Promise<void> {
    if (this.#detachWin) return;
    const main = this.#manager.window();
    const cb = main.getContentBounds();
    const dw = new BrowserWindow({
      width: Math.max(480, cb.width - RAIL_WIDTH),
      height: cb.height,
      title: this.id,
    });
    this.#detachWin = dw;
    for (const v of this.#views) {
      main.contentView.removeChildView(v);
      dw.contentView.addChildView(v);
    }
    this.detached.set(true);
    this.#reflowDetached();
    // 关闭分离窗口即自动合并回主窗(spec §3.3)。
    dw.on("close", () => {
      if (this.#detachWin === dw) void this.merge();
    });
  }

  async merge(): Promise<void> {
    const dw = this.#detachWin;
    if (!dw) return;
    this.#detachWin = null;
    const main = this.#manager.window();
    for (const v of this.#views) {
      try {
        dw.contentView.removeChildView(v);
      } catch {
        // 分离窗已在销毁中,忽略。
      }
      main.contentView.addChildView(v);
    }
    this.detached.set(false);
    if (!dw.isDestroyed()) dw.destroy();
    this.#manager.reflow(this); // 回到主窗,按前台规则重排
  }

  // --- 以下由 SurfaceManager 调用驱动状态 ---

  /** 主窗布局/前台/主题变化后重算(仅未分离时受主窗规则约束)。 */
  reflowMerged(region: Rect, foreground: boolean): void {
    if (this.#detachWin) return;
    this.bounds.set(region);
    this.visible.set(foreground);
    for (const v of this.#views) {
      v.setBounds(region);
      v.setVisible(foreground);
    }
  }

  #reflowDetached(): void {
    const dw = this.#detachWin;
    if (!dw) return;
    const cb = dw.getContentBounds();
    const region: Rect = { x: 0, y: 0, width: cb.width, height: cb.height };
    this.bounds.set(region);
    this.visible.set(true);
    for (const v of this.#views) {
      v.setBounds(region);
      v.setVisible(true);
    }
    dw.removeAllListeners("resize");
    dw.on("resize", () => this.#reflowDetached());
  }

  setTheme(theme: "light" | "dark"): void {
    this.theme.set(theme);
  }

  /** 生命周期回收:把 view 从窗口摘除、关闭框架自建的分离窗口。
   *  view 本身(webContents/CDP)由模块在 deactivate 自行销毁——框架只管窗口与区域。 */
  teardown(): void {
    const host = this.#host();
    for (const v of this.#views) {
      try {
        host.contentView.removeChildView(v);
      } catch {
        // 忽略:窗口可能已销毁
      }
    }
    this.#views = [];
    if (this.#detachWin && !this.#detachWin.isDestroyed()) this.#detachWin.destroy();
    this.#detachWin = null;
  }
}

/** main 模块 UI 区域的环境实现:持有主窗,把右侧 content 区(`68px rail | 1fr`)经 surface 交给
 *  main 模块。前台/主题由 shell renderer 经 IPC 上报驱动;bounds 由主窗尺寸算。 */
export class SurfaceManager implements SurfaceProvider {
  #win: BrowserWindow | null = null;
  #foregroundId: string | null = null;
  #theme: "light" | "dark" = "light";
  #surfaces = new Map<string, ManagedSurface>();

  /** 绑定主窗:resize 即重排所有未分离 surface;窗口关闭解绑。 */
  attachWindow(win: BrowserWindow): void {
    this.#win = win;
    const onResize = (): void => this.#reflowAll();
    win.on("resize", onResize);
    win.on("resized", onResize);
    win.on("closed", () => {
      if (this.#win === win) this.#win = null;
    });
  }

  window(): BrowserWindow {
    if (!this.#win) throw new Error("SurfaceManager 尚未绑定主窗");
    return this.#win;
  }

  /** shell renderer 上报当前前台模块(rail 选中项);更新各 surface 可见性。 */
  setForeground(id: string | null): void {
    this.#foregroundId = id;
    this.#reflowAll();
  }

  /** shell renderer 上报主题;下发给所有 surface。 */
  setTheme(theme: "light" | "dark"): void {
    this.#theme = theme;
    for (const s of this.#surfaces.values()) s.setTheme(theme);
  }

  /** SurfaceProvider:为本次激活产出 surface,track 绑定回收。 */
  provide(self: BaseContext["self"], track: TrackDisposable): ModuleSurface {
    const surface = new ManagedSurface(self.id, this, this.#theme);
    this.#surfaces.set(self.id, surface);
    this.reflow(surface);
    track({
      dispose: () => {
        surface.teardown();
        if (this.#surfaces.get(self.id) === surface) this.#surfaces.delete(self.id);
      },
    });
    return surface;
  }

  /** 单个 surface 按当前主窗布局 + 前台规则重排(merge 回主窗后也调)。 */
  reflow(surface: ManagedSurface): void {
    if (!this.#win) return;
    surface.reflowMerged(this.#contentRegion(), this.#foregroundId === surface.id);
  }

  #reflowAll(): void {
    for (const s of this.#surfaces.values()) this.reflow(s);
  }

  /** 右侧 content 区矩形(DIP,相对主窗内容区):rail 右侧、铺满高度。 */
  #contentRegion(): Rect {
    const cb = this.window().getContentBounds();
    return { x: RAIL_WIDTH, y: 0, width: Math.max(0, cb.width - RAIL_WIDTH), height: cb.height };
  }
}
