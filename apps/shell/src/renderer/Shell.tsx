import { useEffect, useState } from "react";
import type { UserInfo } from "@boundary-desktop/contract";
import type { ModuleEntry } from "../shared/types";

/** 基座壳:左侧导航栏(上=账号 + 模块入口、下=基座控件)+ 主区域容器。
 *  导航的模块入口来自 catalog 的 ui meta(激活前即可渲染);主区域在 Increment B
 *  由选中模块经 render(container) 挂载,本期先占位。 */
export function Shell({ user }: { user: UserInfo }): JSX.Element {
  const [modules, setModules] = useState<ModuleEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
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
          <div className="content__placeholder">
            <div className="content__placeholder-title">{active.ui?.displayName ?? active.id}</div>
            <p className="content__placeholder-hint">
              模块 <code>{active.id}</code> 将在此挂载（Increment B：renderer 加载 + render(container)）。
            </p>
          </div>
        ) : (
          <div className="content__placeholder">
            <p className="content__placeholder-hint">未发现可用模块（检查 modules/ 目录）。</p>
          </div>
        )}
      </main>
    </div>
  );
}
