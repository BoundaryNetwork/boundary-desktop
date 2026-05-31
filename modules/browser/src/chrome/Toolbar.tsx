import React, { useEffect, useRef, useState } from "react";
import type { ChromeState, TabApi } from "../ipc";

declare global {
  interface Window {
    tabAPI: TabApi;
  }
}

/** 把地址栏输入归一成可导航 URL:有 scheme 直接用;像域名(含点、无空格)补 https://;
 *  其余当搜索词走默认引擎。布局/交互抄 openclaw,样式用框架 bd-* + token。 */
function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /\.[a-z]{2,}/i.test(s)) return `https://${s}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`;
}

export function Toolbar(): JSX.Element {
  const [state, setState] = useState<ChromeState>({
    url: "",
    title: "",
    canGoBack: false,
    canGoForward: false,
    theme: "light",
  });
  const [draft, setDraft] = useState("");
  const editing = useRef(false);

  useEffect(() => {
    return window.tabAPI.onState((s) => {
      setState(s);
      // 跟随框架主题
      if (s.theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      // 地址栏未在编辑时,跟随当前页地址
      if (!editing.current) setDraft(s.url);
    });
  }, []);

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const url = toUrl(draft);
    if (url) window.tabAPI.navigate(url);
    editing.current = false;
  };

  return (
    <div
      className="bd-row"
      style={{
        height: "100%",
        gap: "var(--space-3)",
        padding: "0 var(--space-4)",
        alignItems: "center",
        background: "var(--panel-bg, var(--panel-main-bg))",
        borderBottom: "1px solid var(--border-1)",
        boxSizing: "border-box",
      }}
    >
      <NavBtn label="后退" glyph="←" disabled={!state.canGoBack} onClick={() => window.tabAPI.back()} />
      <NavBtn label="前进" glyph="→" disabled={!state.canGoForward} onClick={() => window.tabAPI.forward()} />
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
            setDraft(state.url);
          }}
          style={{ width: "100%", height: 30 }}
        />
      </form>
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
      style={{
        width: 30,
        height: 30,
        padding: 0,
        flex: "none",
        fontSize: 16,
        lineHeight: 1,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {glyph}
    </button>
  );
}
