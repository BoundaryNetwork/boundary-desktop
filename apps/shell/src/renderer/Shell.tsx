import { type ReactNode, useEffect, useRef, useState } from "react";
import type { UserInfo } from "@boundary-desktop/contract";
import type { LocalStatus, ModuleEntry, WorkerInfo } from "../shared/types";
import { Icons } from "./components/icons";
import { navIcon } from "./components/nav-icons";
import { SettingsModal } from "./components/SettingsModal";
import { TrafficLights } from "./components/TrafficLights";
import { runtime } from "./runtime";

/** 基座壳:68px 左导航(顶=账号 + 模块入口、底=基座控件)+ 主区域。
 *  视觉严格参照 openclaw-desktop 的 LeftRail / App。导航入口来自 catalog 的
 *  ui meta(图标按 ui.icon 映射到 lucide,顺序按 ui.order);点入口 →
 *  ModuleView 挂载容器并激活模块,模块经 render(container) 把界面画进主区域。 */
export function Shell({ user }: { user: UserInfo }): JSX.Element {
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // 已打开过的模块:多 active —— 切 rail 只换前台,这些模块保持挂载/激活不被 deactivate。
  const [openedIds, setOpenedIds] = useState<string[]>([]);
  const [env, setEnv] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 运行状态页:基座内置页(非模块),开时占满主区、盖住模块内容。
  const [statusView, setStatusView] = useState(false);
  // 分离到独立窗的 main 模块 id 集合:这些模块在主窗内容区显"已分离"占位卡片。
  const [detachedIds, setDetachedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    void runtime.start();
    runtime.setNavigate(setActiveId);
    void window.hostApi.env().then(setEnv);
    void window.hostApi.modules.list().then((list) => {
      const ordered = [...list].sort(
        (a, b) => (a.ui?.order ?? Infinity) - (b.ui?.order ?? Infinity),
      );
      setModules(ordered);
      setActiveId((cur) => cur ?? ordered[0]?.id ?? null);
    });
  }, []);

  // 前台模块进入"已打开"集合(只增不减:保活);并把前台选择上报给 main 驱动 surface 显隐。
  useEffect(() => {
    if (activeId) setOpenedIds((ids) => (ids.includes(activeId) ? ids : [...ids, activeId]));
    void window.hostApi.surface.reportForeground(activeId);
  }, [activeId]);

  // 系统设置弹层与运行状态页都是基座级 renderer DOM,但 main 模块的 native view 在 DOM 之上会盖住它们;
  // 上报开合,main 据此强制隐藏/恢复主窗内所有 surface 的 native view。
  useEffect(() => {
    void window.hostApi.surface.reportOverlay(settingsOpen || statusView);
  }, [settingsOpen, statusView]);

  // 模块请求前台(如 agent 驱动浏览器导航)→ 切到该模块,rail 高亮 + 区域浮出。
  useEffect(() => window.hostApi.surface.onForegroundRequest((id) => setActiveId(id)), []);

  // main 模块分离/合并独立窗 → 更新集合,驱动占位卡片显隐。
  useEffect(
    () =>
      window.hostApi.surface.onDetachedChange((id, detached) =>
        setDetachedIds((prev) => {
          const next = new Set(prev);
          if (detached) next.add(id);
          else next.delete(id);
          return next;
        }),
      ),
    [],
  );

  // 主题归 renderer(data-theme);上报给 main,供 main 模块 surface 跟随。
  useEffect(() => {
    const read = (): "light" | "dark" =>
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    void window.hostApi.surface.reportTheme(read());
    const obs = new MutationObserver(() => void window.hostApi.surface.reportTheme(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // 无边框窗口顶部拖拽:前台是主模块且未分离时(如浏览器内嵌,native tab 条自管拖拽),
  // 壳不放拖窗带 —— macOS app-region 是 OS 级覆盖层会盖住 native 顶部抢点击。其余情形
  // (renderer 模块 / 空态 / 主模块已分离的占位)主区顶部无 native 覆盖,需要壳给一条拖窗带。
  const isMac = window.hostApi.platform === "darwin";
  const fg = modules.find((m) => m.id === activeId);
  const fgMainEmbedded = !!fg && fg.runtime === "main" && !detachedIds.has(fg.id);
  const showDragBand = isMac && !fgMainEmbedded;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "68px 1fr",
        gridTemplateRows: "minmax(0, 1fr)",
        height: "100vh",
        overflow: "hidden",
        background: [
          "linear-gradient(to top, color-mix(in oklch, var(--accent-soft) 32%, transparent), transparent 55%)",
          "var(--panel-main-bg)",
        ].join(", "),
      }}
    >
      <LeftRail
        modules={modules}
        activeId={activeId}
        statusActive={statusView}
        onSelect={(id) => {
          setActiveId(id);
          setStatusView(false);
        }}
        onOpenStatus={() => setStatusView(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} user={user} env={env} />

      <main
        className="content"
        style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}
      >
        {/* 主区顶部隐形拖窗带(无边框窗口)。仅在前台无 native 顶部覆盖时铺设;
            app-region drag 是 OS 级覆盖层、不受 z-index 约束,故只在需要时存在。 */}
        {showDragBand ? (
          <div
            className="app-drag"
            aria-hidden="true"
            style={{ position: "absolute", top: 0, left: 0, right: 0, height: "var(--titlebar-height)", zIndex: 2 }}
          />
        ) : null}

        {/* 主区底部两层流线形状(参照 openclaw App) */}
        <svg
          aria-hidden="true"
          preserveAspectRatio="none"
          viewBox="0 0 1920 400"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "28%",
            maxHeight: 260,
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          <path
            d="M 0 230 C 480 210, 1100 175, 1920 130 L 1920 400 L 0 400 Z"
            style={{ fill: "color-mix(in oklch, var(--accent-soft) 18%, transparent)" }}
          />
          <path
            d="M 680 400 C 980 290, 1360 130, 1920 70 L 1920 400 Z"
            style={{ fill: "color-mix(in oklch, var(--accent-soft) 30%, transparent)" }}
          />
        </svg>

        {/* 模块内容浮在装饰流线之上。macOS 红绿灯落在左侧 rail 顶 strip;主区顶部拖窗带见上。 */}
        <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0 }}>
          {modules.length === 0 ? (
            statusView ? null : (
              <div className="content__placeholder" style={{ height: "100%", display: "grid", placeItems: "center" }}>
                <p className="content__placeholder-hint">未发现可用模块（检查 modules/ 目录）。</p>
              </div>
            )
          ) : (
            // 已打开的模块全部保持挂载(多 active),只切前台可见;非前台 / 运行状态页开时 display:none。
            openedIds.map((id) => {
              const entry = modules.find((m) => m.id === id);
              return entry ? (
                <ModuleView
                  key={id}
                  entry={entry}
                  hidden={id !== activeId || statusView}
                  detached={detachedIds.has(id)}
                />
              ) : null;
            })
          )}
          {statusView ? <StatusPage /> : null}
        </div>
      </main>
    </div>
  );
}

/** 68px 窄栏导航。顶部头像 + 模块入口,底部基座控件。 */
function LeftRail({
  modules,
  activeId,
  statusActive,
  onSelect,
  onOpenStatus,
  onOpenSettings,
}: {
  modules: ModuleEntry[];
  activeId: string | null;
  statusActive: boolean;
  onSelect: (id: string) => void;
  onOpenStatus: () => void;
  onOpenSettings: () => void;
}): JSX.Element {
  const isMac = window.hostApi.platform === "darwin";

  return (
    <aside
      style={{
        width: 68,
        height: "100%",
        background: "color-mix(in oklch, var(--accent-soft) 80%, transparent)",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* macOS 红绿灯 strip:整条 drag 作拖窗区,内嵌自绘红绿灯(灯组自带 .no-drag) */}
      {isMac ? (
        <div
          className="app-drag"
          style={{
            height: "var(--titlebar-height)",
            flex: "none",
            display: "flex",
            alignItems: "center",
            paddingLeft: "var(--space-2)",
          }}
        >
          <TrafficLights />
        </div>
      ) : null}

      {/* 模块入口(profile 已收进系统设置,顶部不再放头像) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-11)",
          paddingTop: isMac ? "var(--space-8)" : "var(--space-11)",
        }}
      >
        {modules.map((m) => {
          const Ic = navIcon(m.ui?.icon);
          const label = m.ui?.displayName ?? m.id;
          return (
            <RailButton
              key={m.id}
              label={label}
              active={!statusActive && m.id === activeId}
              onClick={() => onSelect(m.id)}
              renderIcon={() => <Ic size={22} strokeWidth={1.9} fill="none" />}
            />
          );
        })}
      </div>

      {/* 底部基座控件(环境信息收在系统设置里,rail 不再显示角标) */}
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "var(--space-4)",
          paddingBottom: "var(--space-6)",
        }}
      >
        <RailButton label="帮助" hideLabel renderIcon={() => <Icons.help size={20} stroke={1.8} />} onClick={() => {}} />
        <RailButton
          label="运行状态"
          hideLabel
          active={statusActive}
          renderIcon={() => <Icons.pulse size={20} stroke={1.9} />}
          onClick={onOpenStatus}
        />
        <RailButton label="系统设置" hideLabel renderIcon={() => <Icons.gear size={18} stroke={1.9} />} onClick={onOpenSettings} />
      </div>
    </aside>
  );
}

/** 单个导航按钮。图标无关,只管 layout / hover / active 高亮(参照 openclaw)。 */
function RailButton({
  renderIcon,
  label,
  active,
  hideLabel,
  onClick,
}: {
  renderIcon: () => ReactNode;
  label: string;
  active?: boolean;
  hideLabel?: boolean;
  onClick: () => void;
}): JSX.Element {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={label}
      title={hideLabel ? label : undefined}
      style={{
        width: 52,
        padding: hideLabel ? "8px" : "7px 4px 6px",
        borderRadius: "var(--r-4)",
        border: "none",
        background:
          !active && hovered ? "color-mix(in oklch, var(--accent-soft) 45%, transparent)" : "transparent",
        color: active ? "var(--accent)" : hovered ? "var(--fg-0)" : "var(--fg-1)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        cursor: "pointer",
        transition: "background 120ms, color 120ms",
        fontFamily: "inherit",
      }}
    >
      {renderIcon()}
      {hideLabel ? null : (
        <span style={{ fontSize: "var(--text-2)", lineHeight: "var(--lh-2)", fontWeight: 500, letterSpacing: "0.02em" }}>
          {label}
        </span>
      )}
    </button>
  );
}

/** 单个模块的挂载点:提供容器 → 激活模块(经 main Registry)→ 模块渲染进容器。
 *  多 active:切前台不卸载,仅 hidden 控制显隐;模块保持激活(后台 tab 继续跑)。
 *  真正卸载(本组件 unmount,如窗口关闭)时才 deactivate。容器始终在 DOM 中。
 *  main 模块的界面是主进程 native view(经 surface 铺在右侧),本容器留空、由 view 覆盖。 */
function ModuleView({
  entry,
  hidden,
  detached,
}: {
  entry: ModuleEntry;
  hidden: boolean;
  detached: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    // autostart 模块由 host 独占生命周期(开机即激活):渲染端绝不能再 activate/deactivate,
    // 否则会与 host 的激活叠加 + StrictMode 的 mount→unmount→mount 抖动,导致模块重复激活、
    // 模块级 store/view 被覆盖泄漏(navigate 与后续 eval/click 落到不同标签)。这里只占位、随前台显隐。
    if (entry.autostart) {
      setPhase("ready");
      return;
    }
    runtime.setContainer(entry.id, ref.current);
    setPhase("loading");
    setErr("");
    let cancelled = false;
    window.hostApi.modules.activate(entry.id).then(
      () => {
        if (!cancelled) setPhase("ready");
      },
      (e: unknown) => {
        if (!cancelled) {
          setPhase("error");
          setErr(e instanceof Error ? e.message : String(e));
        }
      },
    );
    return () => {
      cancelled = true;
      void window.hostApi.modules.deactivate(entry.id);
      runtime.setContainer(entry.id, null);
    };
  }, [entry.id]);

  const Ic = navIcon(entry.ui?.icon);
  const name = entry.ui?.displayName ?? entry.id;

  return (
    <div className="moduleview" style={{ display: hidden ? "none" : undefined }}>
      <div
        className="moduleview__container"
        ref={ref}
        style={{ display: phase === "ready" && !detached ? "block" : "none" }}
      />
      {/* 模块分离到独立窗:native view 已移走、本区域空出,显"已分离"占位卡片 + 合并入口。 */}
      {phase === "ready" && detached && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--space-5)",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "var(--r-5)",
              background: "color-mix(in oklch, var(--accent-soft) 50%, transparent)",
              display: "grid",
              placeItems: "center",
              color: "var(--accent)",
            }}
          >
            <Ic size={32} strokeWidth={1.8} />
          </div>
          <div style={{ fontSize: "var(--text-4)", fontWeight: 600, color: "var(--fg-0)" }}>
            {name}已分离到独立窗口
          </div>
          <div
            style={{
              fontSize: "var(--text-2)",
              color: "var(--fg-3)",
              textAlign: "center",
              maxWidth: 320,
              lineHeight: "var(--lh-3)",
            }}
          >
            {name}正在一个独立窗口中运行，你可以把它合并回主窗口继续使用。
          </div>
          <button
            type="button"
            onClick={() => void window.hostApi.surface.merge(entry.id)}
            style={{
              marginTop: "var(--space-2)",
              padding: "10px 22px",
              borderRadius: "var(--r-3)",
              border: "none",
              background: "var(--accent)",
              color: "white",
              fontSize: "var(--text-2)",
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            合并回主窗口
          </button>
        </div>
      )}
      {phase === "loading" && (
        <div className="content__placeholder">
          <p className="content__placeholder-hint">加载模块 {entry.ui?.displayName ?? entry.id}…</p>
        </div>
      )}
      {phase === "error" && (
        <div className="content__placeholder">
          <div className="content__placeholder-title">{entry.ui?.displayName ?? entry.id}</div>
          <p className="content__placeholder-hint">模块加载失败：{err}</p>
        </div>
      )}
    </div>
  );
}

// --- 运行状态页(rail 脉冲按钮 → 主区整页) ---

/** 整体健康 → 徽章色与文案。null = worker 端点尚未就绪(掉线/重启间隙)。 */
function pageHealth(s: LocalStatus | null): { tone: string; label: string } {
  if (!s) return { tone: "var(--fg-3)", label: "OFFLINE" };
  switch (s.status) {
    case "ok":
      return { tone: "var(--ok)", label: "ONLINE" };
    case "pending":
      return { tone: "var(--accent)", label: "CONNECTING" };
    case "action_required":
      return { tone: "var(--warn)", label: "ACTION REQUIRED" };
    case "degraded":
      return { tone: "var(--warn)", label: "DEGRADED" };
    case "error":
      return { tone: "var(--err)", label: "ERROR" };
  }
}

// 本地 worker 进程态(/local/status 的 worker.state)。
const WORKER_STATE_LABEL: Record<LocalStatus["worker"]["state"], string> = {
  starting: "启动中",
  ready: "就绪",
  draining: "排空中",
  stopping: "停止中",
};
function workerTone(st: LocalStatus["worker"]["state"]): string {
  return st === "ready" ? "var(--ok)" : st === "starting" ? "var(--accent)" : "var(--warn)";
}
// 远程 gRPC 网关连接态(/local/status 的 gateway.state)。
const GATEWAY_STATE_LABEL: Record<LocalStatus["gateway"]["state"], string> = {
  disconnected: "未连接",
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
};
function gatewayTone(st: LocalStatus["gateway"]["state"]): string {
  return st === "connected" ? "var(--ok)" : st === "disconnected" ? "var(--fg-3)" : "var(--accent)";
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ms 时长 → HH:MM:SS(小时不封顶)。 */
function formatUptime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`;
}

/** ms epoch → YYYY-MM-DD HH:MM:SS(本地时区)。 */
function formatStarted(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** 运行状态整页:脉冲健康圈 + ONLINE 徽章 + UPTIME 走字 + 重启 + 版本/PID/启动时间。
 *  本页可见时才挂载(随 statusView 显隐),挂载即轮询 worker.status,卸载即停。 */
function StatusPage(): JSX.Element {
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [info, setInfo] = useState<WorkerInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [restarting, setRestarting] = useState(false);

  // 聚合状态轮询:挂载即拉,之后每 2s。null = worker 端点未就绪。
  useEffect(() => {
    let alive = true;
    const pull = (): void => {
      void window.hostApi.worker.status().then(
        (s) => {
          if (alive) setStatus(s);
        },
        () => {},
      );
    };
    pull();
    const t = window.setInterval(pull, 2000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  // 壳侧信息(app 版本 + spawn 时刻):挂载拉一次;重启后再拉(startedAt 变了)。
  const loadInfo = (): void => {
    void window.hostApi.worker.info().then(setInfo, () => {});
  };
  useEffect(loadInfo, []);

  // UPTIME 每秒走字。
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const restart = (): void => {
    if (restarting) return;
    setRestarting(true);
    setStatus(null); // 立即反映掉线
    void window.hostApi.worker
      .restart()
      .then(loadInfo)
      .finally(() => setRestarting(false));
  };

  const { tone, label } = pageHealth(status);
  const startedAt = info?.startedAt ?? null;
  const uptime = startedAt != null ? formatUptime(now - startedAt) : "--:--:--";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "26px 24px 24px",
        userSelect: "none",
      }}
    >
      <style>{`
        @keyframes bd-status-breath { 0%,100% { transform: scale(1); opacity: .5 } 50% { transform: scale(1.1); opacity: .85 } }
        @keyframes bd-status-spin { to { transform: rotate(360deg) } }
      `}</style>

      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--fg-0)" }}>运行状态</h1>

      {/* 脉冲健康圈:外发光呼吸 + 虚线环(重启时加速旋转)+ 内圈脉冲图标。
          flexShrink:0 防止 overflow 列把方形容器纵向压扁成椭圆。 */}
      <div
        style={{
          position: "relative",
          flex: "none",
          width: 150,
          height: 150,
          marginTop: 18,
          display: "grid",
          placeItems: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 4,
            borderRadius: "50%",
            background: `radial-gradient(circle, color-mix(in oklch, ${tone} 42%, transparent), transparent 68%)`,
            filter: "blur(8px)",
            animation: "bd-status-breath 3.2s ease-in-out infinite",
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 18,
            borderRadius: "50%",
            border: `2px dashed color-mix(in oklch, ${tone} 60%, transparent)`,
            animation: `bd-status-spin ${restarting ? "1.1s" : "20s"} linear infinite`,
          }}
        />
        <div
          style={{
            width: 86,
            height: 86,
            borderRadius: "50%",
            background: `color-mix(in oklch, ${tone} 15%, var(--bg-1))`,
            display: "grid",
            placeItems: "center",
            color: tone,
            boxShadow: "var(--shadow-1)",
          }}
        >
          <Icons.pulse size={36} stroke={2} />
        </div>
      </div>

      {/* 徽章 */}
      <div
        style={{
          marginTop: 14,
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-3)",
          color: tone,
          fontSize: "var(--text-2)",
          fontWeight: 600,
          letterSpacing: "0.12em",
        }}
      >
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: tone }} />
        {label}
      </div>

      {/* 运行计时 */}
      <div
        style={{
          marginTop: 12,
          fontSize: 48,
          fontWeight: 700,
          color: "var(--fg-0)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.04em",
          lineHeight: 1,
        }}
      >
        {uptime}
      </div>

      {/* 重启(展示 + 重启;停止服务未接) */}
      <button
        type="button"
        onClick={restart}
        disabled={restarting}
        style={{
          marginTop: 18,
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "8px 18px",
          borderRadius: "var(--r-3)",
          border: "1px solid var(--line)",
          background: "var(--bg-2)",
          color: "var(--fg-1)",
          fontSize: "var(--text-2)",
          fontWeight: 500,
          fontFamily: "inherit",
          cursor: restarting ? "default" : "pointer",
          opacity: restarting ? 0.6 : 1,
        }}
      >
        <Icons.refresh size={15} stroke={1.9} />
        {restarting ? "重启中…" : "重启"}
      </button>

      {/* 两个状态:本地 worker 进程 + 远程 gRPC 网关连接 */}
      <div style={{ display: "flex", gap: "var(--space-5)", width: "100%", maxWidth: 520, marginTop: 22 }}>
        <StateCard
          title="本地 Worker"
          tone={status ? workerTone(status.worker.state) : "var(--fg-3)"}
          value={status ? WORKER_STATE_LABEL[status.worker.state] : "—"}
        />
        <StateCard
          title="远程网关"
          tone={status ? gatewayTone(status.gateway.state) : "var(--fg-3)"}
          value={status ? GATEWAY_STATE_LABEL[status.gateway.state] : "—"}
          sub={status ? (status.gateway.authenticated ? "已认证" : "未认证") : undefined}
        />
      </div>

      {status?.gateway.last_error ? (
        <div
          style={{
            width: "100%",
            maxWidth: 520,
            marginTop: "var(--space-4)",
            color: "var(--err)",
            fontSize: "var(--text-1)",
            lineHeight: "var(--lh-3)",
            wordBreak: "break-all",
          }}
        >
          网关错误：{status.gateway.last_error}
        </div>
      ) : null}

      {/* 信息表 */}
      <div style={{ width: "100%", maxWidth: 520, marginTop: 16 }}>
        <div style={{ height: 1, background: "var(--line)" }} />
        <InfoRow k="DESKTOP" v={info?.desktopVersion ?? "—"} />
        <InfoRow k="WORKER" v={status?.worker.version ?? "—"} />
        <InfoRow k="PID" v={status ? String(status.worker.pid) : "—"} />
        <InfoRow k="STARTED" v={startedAt != null ? formatStarted(startedAt) : "—"} />
      </div>
    </div>
  );
}

/** 单个状态卡:标题 + 色点 + 状态文案(可带副标,如网关认证态)。 */
function StateCard({
  title,
  tone,
  value,
  sub,
}: {
  title: string;
  tone: string;
  value: string;
  sub?: string;
}): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        padding: "var(--space-6)",
        borderRadius: "var(--r-4)",
        border: "1px solid var(--line)",
        background: "var(--panel-mid-bg)",
      }}
    >
      <div style={{ color: "var(--fg-3)", fontSize: "var(--text-1)", letterSpacing: "0.06em" }}>{title}</div>
      <div style={{ marginTop: "var(--space-3)", display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: tone, flex: "none" }} />
        <span style={{ color: "var(--fg-0)", fontSize: "var(--text-4)", fontWeight: 600 }}>{value}</span>
        {sub ? <span style={{ color: "var(--fg-3)", fontSize: "var(--text-1)" }}>· {sub}</span> : null}
      </div>
    </div>
  );
}

/** 信息表的一行:左 KEY(大写疏排灰),右取值(等宽数字)。 */
function InfoRow({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-5)",
        padding: "9px 2px",
        borderBottom: "1px solid var(--line-soft)",
      }}
    >
      <span style={{ color: "var(--fg-3)", fontSize: "var(--text-1)", letterSpacing: "0.14em" }}>{k}</span>
      <span style={{ color: "var(--fg-1)", fontSize: "var(--text-2)", fontVariantNumeric: "tabular-nums" }}>{v}</span>
    </div>
  );
}
