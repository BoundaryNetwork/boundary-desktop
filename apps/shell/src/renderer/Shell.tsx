import { type ReactNode, useEffect, useRef, useState } from "react";
import type { UserInfo } from "@boundary-desktop/contract";
import type { ModuleEntry } from "../shared/types";
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
        onSelect={setActiveId}
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
            <div className="content__placeholder" style={{ height: "100%", display: "grid", placeItems: "center" }}>
              <p className="content__placeholder-hint">未发现可用模块（检查 modules/ 目录）。</p>
            </div>
          ) : (
            // 已打开的模块全部保持挂载(多 active),只切前台可见;非前台 display:none。
            openedIds.map((id) => {
              const entry = modules.find((m) => m.id === id);
              return entry ? (
                <ModuleView key={id} entry={entry} hidden={id !== activeId} detached={detachedIds.has(id)} />
              ) : null;
            })
          )}
        </div>
      </main>
    </div>
  );
}

/** 68px 窄栏导航。顶部头像 + 模块入口,底部基座控件。 */
function LeftRail({
  modules,
  activeId,
  onSelect,
  onOpenSettings,
}: {
  modules: ModuleEntry[];
  activeId: string | null;
  onSelect: (id: string) => void;
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
              active={m.id === activeId}
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
