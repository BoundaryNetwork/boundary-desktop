import { useEffect, useRef, useState } from "react";
import type { UserInfo } from "@boundary-desktop/contract";
import type { ModuleEntry } from "../shared/types";
import { runtime } from "./runtime";

/** 基座壳:左侧导航栏(上=账号 + 模块入口、下=基座控件)+ 主区域。
 *  导航入口来自 catalog 的 ui meta;点入口 → ModuleView 挂载容器 + 激活模块,
 *  模块经 render(container) 把界面画进主区域。 */
export function Shell({ user }: { user: UserInfo }): JSX.Element {
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    void runtime.start();
    runtime.setNavigate(setActiveId);
    void window.hostApi.modules.list().then((list) => {
      setModules(list);
      setActiveId((cur) => cur ?? list[0]?.id ?? null);
    });
  }, []);

  const active = modules.find((m) => m.id === activeId) ?? null;

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail__top">
          <div className="rail__avatar" title={user.name}>
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          {modules.map((m) => (
            <button
              key={m.id}
              className={`rail__item${m.id === activeId ? " rail__item--active" : ""}`}
              onClick={() => setActiveId(m.id)}
              title={m.ui?.description ?? m.ui?.displayName ?? m.id}
            >
              <span className="rail__icon">{(m.ui?.displayName ?? m.id).slice(0, 1)}</span>
              <span className="rail__label">{m.ui?.displayName ?? m.id}</span>
            </button>
          ))}
        </div>

        <div className="rail__bottom">
          <button className="rail__base" title="帮助">?</button>
          <button className="rail__base" title="设置">⚙</button>
          <button
            className="rail__base"
            title="退出登录"
            onClick={() => void window.hostApi.auth.requestLogout()}
          >
            ⏻
          </button>
        </div>
      </nav>

      <main className="content">
        {active ? (
          <ModuleView key={active.id} entry={active} />
        ) : (
          <div className="content__placeholder">
            <p className="content__placeholder-hint">未发现可用模块（检查 modules/ 目录）。</p>
          </div>
        )}
      </main>
    </div>
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
