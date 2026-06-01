import React, { useEffect, useRef, useState } from "react";
import type { ChromeState, TabApi, TabGroup, TabMeta } from "../ipc";

declare global {
  interface Window {
    tabAPI: TabApi;
  }
}

const EMPTY: ChromeState = { tabs: [], groups: [], activeTabId: null, theme: "light", detached: false };

type Segment = { type: "tab"; tab: TabMeta } | { type: "group"; group: TabGroup; tabs: TabMeta[] };

/** 把(已保证同组连续的)标签序列切成 段:无组标签各自一段,连续同组标签合成一个分组段。 */
function buildSegments(tabs: TabMeta[], groups: TabGroup[]): Segment[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const segs: Segment[] = [];
  for (const t of tabs) {
    const g = t.groupId != null ? byId.get(t.groupId) : undefined;
    const last = segs[segs.length - 1];
    if (g) {
      if (last && last.type === "group" && last.group.id === g.id) last.tabs.push(t);
      else segs.push({ type: "group", group: g, tabs: [t] });
    } else {
      segs.push({ type: "tab", tab: t });
    }
  }
  return segs;
}

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
        <div
          id="tabs"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("text/tab")) e.preventDefault();
          }}
          onDrop={(e) => {
            // 落在标签条空白处:移到末尾、脱离分组
            const id = Number(e.dataTransfer.getData("text/tab"));
            if (id) window.tabAPI.dragTab(id, null, null);
          }}
        >
          {/* 固定标签:恒最左,favicon-only */}
          {state.tabs
            .filter((t) => t.pinned)
            .map((t) => (
              <Tab key={t.id} tab={t} active={t.id === state.activeTabId} inGroup={false} />
            ))}
          {buildSegments(
            state.tabs.filter((t) => !t.pinned),
            state.groups,
          ).map((seg) =>
            seg.type === "tab" ? (
              <Tab key={seg.tab.id} tab={seg.tab} active={seg.tab.id === state.activeTabId} inGroup={false} />
            ) : (
              <div key={`g${seg.group.id}`} className={`tab-group group-${seg.group.color}`}>
                <GroupChip group={seg.group} count={seg.tabs.length} />
                {!seg.group.collapsed &&
                  seg.tabs.map((t) => <Tab key={t.id} tab={t} active={t.id === state.activeTabId} inGroup />)}
              </div>
            ),
          )}
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

/** 分组 chip:单击折叠/展开,双击重命名(行内 input)。折叠且无名时显示标签数。 */
function GroupChip({ group, count }: { group: TabGroup; count: number }): JSX.Element {
  const [editing, setEditing] = useState(false);
  if (editing) {
    const commit = (v: string): void => {
      window.tabAPI.renameGroup(group.id, v.trim());
      setEditing(false);
    };
    return (
      <input
        className="tab-group-chip tab-group-chip-input"
        autoFocus
        defaultValue={group.name}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          else if (e.key === "Escape") setEditing(false);
        }}
        onBlur={(e) => commit(e.target.value)}
      />
    );
  }
  return (
    <button
      type="button"
      className="tab-group-chip"
      title={group.name || "未命名分组"}
      onClick={() => window.tabAPI.toggleGroupCollapse(group.id)}
      onDoubleClick={() => setEditing(true)}
    >
      {group.name || (group.collapsed ? String(count) : "")}
    </button>
  );
}

function Tab({ tab, active, inGroup }: { tab: TabMeta; active: boolean; inGroup: boolean }): JSX.Element {
  const cls = "tab" + (active ? " active" : "") + (inGroup ? " in-group" : "") + (tab.pinned ? " pinned" : "");
  return (
    <div
      className={cls}
      title={tab.title || tab.url}
      draggable={!tab.pinned}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/tab", String(tab.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("text/tab")) e.preventDefault();
      }}
      onDrop={(e) => {
        e.stopPropagation(); // 落在标签上:移到该标签前、并入其分组(无组则脱组)
        const id = Number(e.dataTransfer.getData("text/tab"));
        if (id && id !== tab.id) window.tabAPI.dragTab(id, tab.id, tab.groupId ?? null);
      }}
      onClick={() => window.tabAPI.switchTab(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault();
        window.tabAPI.showTabMenu(tab.id, Math.round(e.clientX), Math.round(e.clientY));
      }}
    >
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
      {/* 固定标签只剩 favicon(无标题/关闭),宽度收成 34px */}
      {!tab.pinned && <span className="tab-title">{tab.title || "新标签页"}</span>}
      {!tab.pinned && (
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
      )}
    </div>
  );
}
