import React, { useEffect, useRef, useState } from "react";
import type { ChromeState, TabApi, TabMeta } from "../ipc";

declare global {
  interface Window {
    tabAPI: TabApi;
  }
}

const EMPTY: ChromeState = { tabs: [], activeTabId: null, theme: "light", detached: false };

/** 地址栏输入归一成可导航 URL:有 scheme 直接用;像域名补 https://;其余当搜索词。 */
function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /\.[a-z]{2,}/i.test(s)) return `https://${s}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`;
}

const S = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** 浏览器 chrome:Chrome 风标签条 + 圆角卡片导航栏。布局/外观照搬 openclaw,token 用本项目 bd-*。 */
export function Toolbar(): JSX.Element {
  const [state, setState] = useState<ChromeState>(EMPTY);
  const [draft, setDraft] = useState("");
  const editing = useRef(false);
  const lastActive = useRef<number | null>(null);

  const active = state.tabs.find((t) => t.id === state.activeTabId);

  useEffect(() => {
    const unsub = window.tabAPI.onState((s) => {
      setState(s);
      if (s.theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
      else document.documentElement.removeAttribute("data-theme");
      const cur = s.tabs.find((t) => t.id === s.activeTabId);
      if (s.activeTabId !== lastActive.current || !editing.current) setDraft(cur?.url ?? "");
      lastActive.current = s.activeTabId;
    });
    window.tabAPI.ready();
    return unsub;
  }, []);

  const submit = (): void => {
    const url = toUrl(draft);
    if (url) window.tabAPI.navigate(url);
    editing.current = false;
  };

  return (
    <div id="toolbar">
      <div id="tab-strip">
        <div id="tabs">
          {state.tabs.map((t) => (
            <Tab key={t.id} tab={t} active={t.id === state.activeTabId} />
          ))}
        </div>
        <button id="btn-new-tab" type="button" title="新建标签页" aria-label="新建标签页" onClick={() => window.tabAPI.newTab()}>
          <svg viewBox="0 0 24 24" width="14" height="14" {...S}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          id="btn-detach-merge"
          type="button"
          title={state.detached ? "合并回主窗" : "分离为独立窗口"}
          aria-label={state.detached ? "合并回主窗" : "分离为独立窗口"}
          onClick={() => (state.detached ? window.tabAPI.merge() : window.tabAPI.detach())}
        >
          {state.detached ? (
            <svg viewBox="0 0 24 24" width="14" height="14" {...S}>
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" {...S}>
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          )}
        </button>
      </div>

      <div id="nav-bar">
        <button className="nav-btn" type="button" title="后退" aria-label="后退" disabled={!active?.canGoBack} onClick={() => window.tabAPI.back()}>
          <svg viewBox="0 0 24 24" width="18" height="18" {...S}>
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <button className="nav-btn" type="button" title="前进" aria-label="前进" disabled={!active?.canGoForward} onClick={() => window.tabAPI.forward()}>
          <svg viewBox="0 0 24 24" width="18" height="18" {...S}>
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
        <button className="nav-btn" type="button" title="刷新" aria-label="刷新" onClick={() => window.tabAPI.reload()}>
          <svg viewBox="0 0 24 24" width="16" height="16" {...S}>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <div id="address-bar">
          <span className="addr-icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" {...S}>
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
            </svg>
          </span>
          <input
            id="url-input"
            type="text"
            placeholder="输入网址或搜索"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              editing.current = true;
              e.target.select();
            }}
            onBlur={() => {
              editing.current = false;
              setDraft(active?.url ?? "");
            }}
            onKeyDown={(e) => {
              // IME 组合中(中文候选未确认)的回车只确认输入,不导航(keyCode 229 / isComposing 兜底)。
              if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) submit();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Tab({ tab, active }: { tab: TabMeta; active: boolean }): JSX.Element {
  return (
    <div className={active ? "tab active" : "tab"} title={tab.title || tab.url} onClick={() => window.tabAPI.switchTab(tab.id)}>
      {tab.favicon ? (
        <img className="tab-favicon" src={tab.favicon} alt="" />
      ) : (
        <span className="tab-favicon tab-favicon-placeholder" aria-hidden>
          <svg viewBox="0 0 24 24" width="14" height="14" {...S}>
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </span>
      )}
      <span className="tab-title">{tab.title || "新标签页"}</span>
      <button
        className="tab-close"
        type="button"
        aria-label="关闭标签页"
        onClick={(e) => {
          e.stopPropagation();
          window.tabAPI.closeTab(tab.id);
        }}
      >
        ×
      </button>
    </div>
  );
}
