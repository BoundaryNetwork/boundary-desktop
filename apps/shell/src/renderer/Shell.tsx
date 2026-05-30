import { type ReactNode, useEffect, useRef, useState } from "react";
import type { UserInfo } from "@boundary-desktop/contract";
import type { ModuleEntry } from "../shared/types";
import { Icons } from "./components/icons";
import { navIcon } from "./components/nav-icons";
import { SettingsModal } from "./components/SettingsModal";
import { runtime } from "./runtime";

/** 基座壳:68px 左导航(顶=账号 + 模块入口、底=基座控件)+ 主区域。
 *  视觉严格参照 openclaw-desktop 的 LeftRail / App。导航入口来自 catalog 的
 *  ui meta(图标按 ui.icon 映射到 lucide,顺序按 ui.order);点入口 →
 *  ModuleView 挂载容器并激活模块,模块经 render(container) 把界面画进主区域。 */
export function Shell({ user }: { user: UserInfo }): JSX.Element {
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [env, setEnv] = useState<string>("");
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  const active = modules.find((m) => m.id === activeId) ?? null;

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

        {/* 模块内容浮在装饰流线之上。macOS 红绿灯落在左侧 rail 顶 strip(已预留),
            主区域不需要单独拖窗带。 */}
        <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0 }}>
          {active ? (
            <ModuleView key={active.id} entry={active} />
          ) : (
            <div className="content__placeholder" style={{ height: "100%", display: "grid", placeItems: "center" }}>
              <p className="content__placeholder-hint">未发现可用模块（检查 modules/ 目录）。</p>
            </div>
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
      {/* macOS 红绿灯 strip(系统自绘,这里只占位 + 作拖窗区) */}
      {isMac ? <div className="app-drag" style={{ height: "var(--titlebar-height)", flex: "none" }} /> : null}

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
 *  卸载(切换 tab)时停用模块。容器始终在 DOM 中,加载/失败用覆盖层提示。 */
function ModuleView({ entry }: { entry: ModuleEntry }): JSX.Element {
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

  return (
    <div className="moduleview">
      <div
        className="moduleview__container"
        ref={ref}
        style={{ display: phase === "ready" ? "block" : "none" }}
      />
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
