import { BrowserWindow, type WebContentsView } from "electron";
import type { BaseContext, Disposable, ModuleSurface, Rect } from "@boundary-desktop/contract";
import { StateContainer, type SurfaceProvider, type TrackDisposable } from "@boundary-desktop/host";
import { IPC } from "../shared/ipc.js";

/** 左侧导航栏宽度(与 Shell.tsx 的 grid `68px 1fr` 一致)。框架据此算右侧 content 区。 */
const RAIL_WIDTH = 68;

/** 一个 main 模块本次激活分得的 UI 区域。
 *
 *  职责切分(单一 owner,不分裂):
 *  - 框架(本类):持 view 的**成员关系/z-order**(attach 加入宿主窗口、detach/merge 整体 re-parent、
 *    回收时摘除)+ 发布 `bounds`/`visible`/`theme`/`detached` 只读**状态**。
 *  - 模块:订阅 `bounds`/`visible`,自行对它创建的 view 做 setBounds/setVisible —— 区域内部布局
 *    (chrome 条 + 内容、active tab 显隐)只有模块知道,框架不替它定位、不替它显隐。 */
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
    this.#host().contentView.addChildView(v); // 只管成员/z-order;bounds 与显隐由模块订阅 state 自理
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
    const isMac = process.platform === "darwin";
    const dw = new BrowserWindow({
      width: Math.max(480, cb.width - RAIL_WIDTH),
      height: cb.height,
      title: this.id,
      // 与主窗口一致:macOS 无边框,模块自有 toolbar 即顶部;tab 条空白处可拖窗,
      // 合并按钮回坞(关窗即合并)。系统三连键隐式保留,显式隐藏。
      frame: isMac ? false : true,
      titleBarStyle: isMac ? "hidden" : "default",
    });
    if (isMac) dw.setWindowButtonVisibility(false);
    this.#detachWin = dw;
    for (const v of this.#views) {
      main.contentView.removeChildView(v);
      dw.contentView.addChildView(v);
    }
    this.detached.set(true);
    this.#publishDetached();
    // 关闭分离窗口即自动合并回主窗(spec §3.3)。
    dw.on("close", () => {
      if (this.#detachWin === dw) void this.merge();
    });
  }

  requestForeground(): void {
    this.#manager.requestForeground(this.id);
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
    this.#manager.publish(this); // 回到主窗,按前台规则重新发布 bounds/visible
  }

  // --- 状态发布(只改 state,模块订阅后自行重排 view)---

  /** 主窗布局/前台变化:发布右侧区域矩形与前台可见性(仅未分离时随主窗规则)。 */
  publishMerged(region: Rect, foreground: boolean): void {
    if (this.#detachWin) return;
    this.bounds.set(region);
    this.visible.set(foreground);
  }

  #publishDetached(): void {
    const dw = this.#detachWin;
    if (!dw) return;
    const cb = dw.getContentBounds();
    this.bounds.set({ x: 0, y: 0, width: cb.width, height: cb.height });
    this.visible.set(true);
    dw.removeAllListeners("resize");
    dw.on("resize", () => this.#publishDetached());
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
  #overlayActive = false;
  #surfaces = new Map<string, ManagedSurface>();

  /** 绑定主窗:resize 即重新发布所有未分离 surface 的区域;窗口关闭解绑。 */
  attachWindow(win: BrowserWindow): void {
    this.#win = win;
    const onResize = (): void => this.#publishAll();
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

  /** shell renderer 上报当前前台模块(rail 选中项);重新发布各 surface 可见性。 */
  setForeground(id: string | null): void {
    this.#foregroundId = id;
    this.#publishAll();
  }

  /** 壳上报基座级全屏弹层(如系统设置)开合。native view 在 renderer DOM 之上、CSS 盖不住,
   *  激活时强制隐藏主窗内所有 surface 的 view,让 DOM 弹层露出;关闭后回到前台规则。
   *  分离到独立窗的 surface 不受影响(弹层只在主窗)。 */
  setOverlay(active: boolean): void {
    if (this.#overlayActive === active) return;
    this.#overlayActive = active;
    this.#publishAll();
  }

  /** 模块请求把自己提到前台(经 surface.requestForeground):立即切前台显隐,并通知 renderer
   *  同步 activeId(rail 高亮 + 原前台模块隐藏)。 */
  requestForeground(id: string): void {
    this.setForeground(id);
    this.#win?.webContents.send(IPC.surfaceForegroundRequest, id);
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
    this.publish(surface);
    // 分离态变化下发壳:分离后模块 view 移到独立窗、主窗这块区域空出,壳据此显"已分离"占位卡片。
    track(
      surface.detached.subscribe((detached) =>
        this.#win?.webContents.send(IPC.surfaceDetachedChanged, { id: self.id, detached }),
      ),
    );
    track({
      dispose: () => {
        surface.teardown();
        if (this.#surfaces.get(self.id) === surface) this.#surfaces.delete(self.id);
      },
    });
    return surface;
  }

  /** 壳发起的合并:把分离到独立窗的模块合并回主窗(占位卡片按钮)。 */
  merge(id: string): void {
    void this.#surfaces.get(id)?.merge();
  }

  /** driver 专用:把 kernel 造的 view 绑到某 surface(经其 attach 机制,detach/merge 自动 re-parent)。
   *  surface 为契约 ModuleSurface 实例(本进程内即 ManagedSurface);返回摘除句柄。 */
  bindView(surface: ModuleSurface, view: object): Disposable {
    return (surface as ManagedSurface).attach(view);
  }

  /** 单个 surface 按当前主窗布局 + 前台规则发布区域(merge 回主窗后也调)。
   *  基座弹层激活时一律隐藏(见 setOverlay)。 */
  publish(surface: ManagedSurface): void {
    if (!this.#win) return;
    const foreground = !this.#overlayActive && this.#foregroundId === surface.id;
    surface.publishMerged(this.#contentRegion(), foreground);
  }

  #publishAll(): void {
    for (const s of this.#surfaces.values()) this.publish(s);
  }

  /** 右侧 content 区矩形(DIP,相对主窗内容区):rail 右侧、铺满高度。 */
  #contentRegion(): Rect {
    const cb = this.window().getContentBounds();
    return { x: RAIL_WIDTH, y: 0, width: Math.max(0, cb.width - RAIL_WIDTH), height: cb.height };
  }
}
