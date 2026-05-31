import React, { useEffect, useRef, useState } from "react";
import type { ChromeState, TabApi, TabMeta } from "../ipc";

declare global {
  interface Window {
    tabAPI: TabApi;
  }
}

const EMPTY: ChromeState = { tabs: [], activeTabId: null, theme: "light" };

/** 地址栏输入归一成可导航 URL:有 scheme 直接用;像域名补 https://;其余当搜索词。 */
function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /\.[a-z]{2,}/i.test(s)) return `https://${s}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`;
}

/** 浏览器 chrome:标签条 + 地址栏。布局抄 openclaw,样式用框架 bd-* + token。 */
export function Toolbar(): JSX.Element {
  const [state, setState] = useState<ChromeState>(EMPTY);
  const [draft, setDraft] = useState("");
  const editing = useRef(false);
  const lastActive = useRef<number | null>(null);

  const active: TabMeta | undefined = state.tabs.find((t) => t.id === state.activeTabId);

  useEffect(() => {
    const unsub = window.tabAPI.onState((s) => {
      setState(s);
      if (s.theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      const cur = s.tabs.find((t) => t.id === s.activeTabId);
      // 切换标签或未在编辑时,地址栏跟随活动标签
      if (s.activeTabId !== lastActive.current || !editing.current) setDraft(cur?.url ?? "");
      lastActive.current = s.activeTabId;
    });
    window.tabAPI.ready(); // 订阅就绪,拉当前态(避开首帧广播竞态)
    return unsub;
  }, []);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const url = toUrl(draft);
    if (url) window.tabAPI.navigate(url);
    editing.current = false;
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--panel-main-bg)" }}>
      {/* 标签条 */}
      <div
        className="bd-row"
        style={{ gap: "var(--space-2)", padding: "var(--space-2) var(--space-3) 0", alignItems: "flex-end" }}
      >
        <div className="bd-row" style={{ gap: "var(--space-2)", flex: 1, minWidth: 0, overflow: "hidden" }}>
          {state.tabs.map((t) => (
            <Tab key={t.id} tab={t} active={t.id === state.activeTabId} />
          ))}
        </div>
        <button
          type="button"
          className="bd-btn"
          aria-label="新建标签页"
          title="新建标签页"
          onClick={() => window.tabAPI.newTab()}
          style={{ width: 28, height: 28, padding: 0, flex: "none", fontSize: 18, lineHeight: 1 }}
        >
          +
        </button>
      </div>

      {/* 地址栏 + 导航 */}
      <div
        className="bd-row"
        style={{
          gap: "var(--space-3)",
          padding: "var(--space-2) var(--space-4)",
          alignItems: "center",
          flex: 1,
        }}
      >
        <NavBtn label="后退" glyph="←" disabled={!active?.canGoBack} onClick={() => window.tabAPI.back()} />
        <NavBtn label="前进" glyph="→" disabled={!active?.canGoForward} onClick={() => window.tabAPI.forward()} />
        <NavBtn label="刷新" glyph="⟳" onClick={() => window.tabAPI.reload()} />
        <form onSubmit={submit} style={{ flex: 1, minWidth: 0 }}>
          <input
            className="bd-input"
            value={draft}
            placeholder="输入网址或搜索"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              editing.current = true;
              e.target.select();
            }}
            onBlur={() => {
              editing.current = false;
              setDraft(active?.url ?? "");
            }}
            style={{ width: "100%", height: 30 }}
          />
        </form>
      </div>
    </div>
  );
}

function Tab({ tab, active }: { tab: TabMeta; active: boolean }): JSX.Element {
  return (
    <div
      onClick={() => window.tabAPI.switchTab(tab.id)}
      title={tab.title || tab.url}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        height: 30,
        maxWidth: 200,
        minWidth: 0,
        padding: "0 var(--space-2) 0 var(--space-3)",
        borderRadius: "var(--r-3) var(--r-3) 0 0",
        cursor: "pointer",
        background: active ? "var(--panel-bg, var(--bg-1))" : "transparent",
        color: active ? "var(--fg-0)" : "var(--fg-1)",
        border: "1px solid",
        borderColor: active ? "var(--border-1)" : "transparent",
        borderBottom: "none",
      }}
    >
      {tab.favicon ? (
        <img src={tab.favicon} alt="" width={14} height={14} style={{ flex: "none" }} />
      ) : null}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "var(--text-2)" }}>
        {tab.title || "新标签页"}
      </span>
      <button
        type="button"
        aria-label="关闭标签页"
        onClick={(e) => {
          e.stopPropagation();
          window.tabAPI.closeTab(tab.id);
        }}
        style={{
          flex: "none",
          width: 18,
          height: 18,
          padding: 0,
          border: "none",
          borderRadius: "var(--r-2)",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}

function NavBtn({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="bd-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{ width: 30, height: 30, padding: 0, flex: "none", fontSize: 16, lineHeight: 1, opacity: disabled ? 0.4 : 1 }}
    >
      {glyph}
    </button>
  );
}
