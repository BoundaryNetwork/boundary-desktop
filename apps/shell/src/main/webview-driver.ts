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
