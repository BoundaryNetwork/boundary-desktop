import React, { useState, type CSSProperties } from "react";

// 主页(新标签页):布局/外观照搬 openclaw NewTab。内容视图内 location.href 直接导航
// (TabViewHost 的 did-navigate 会更新工具栏地址栏),不需要额外 IPC 桥。

type Shortcut = {
  url: string;
  name: string;
  domain: string;
  icon: string;
  color: string;
  variant: "fill" | "tint";
};

const SHORTCUTS: Shortcut[] = [
  { url: "https://bianjie.ecbis.cn", name: "边界BI", domain: "bianjie.ecbis.cn", icon: "BI", color: "#2f7dff", variant: "tint" },
  { url: "https://dabids.cn", name: "达笔AI", domain: "dabids.cn", icon: "AI", color: "#7458ff", variant: "tint" },
  { url: "https://daguands.cn", name: "达官", domain: "daguands.cn", icon: "官", color: "#23ad6b", variant: "tint" },
  { url: "https://agent.ecbis.cn", name: "边界智能体", domain: "agent.ecbis.cn", icon: "智", color: "#2f7dff", variant: "tint" },
  { url: "https://www.renzhibianjie.com", name: "认知边界", domain: "renzhibianjie.com", icon: "认", color: "#00a4ef", variant: "tint" },
  { url: "https://www.taobao.com", name: "淘宝", domain: "taobao.com", icon: "淘", color: "#ff5000", variant: "fill" },
  { url: "https://www.jd.com", name: "京东", domain: "jd.com", icon: "京", color: "#e1251b", variant: "fill" },
  { url: "https://www.xiaohongshu.com", name: "小红书", domain: "xiaohongshu.com", icon: "红", color: "#ff2442", variant: "fill" },
  { url: "https://www.douyin.com", name: "抖音", domain: "douyin.com", icon: "抖", color: "#111111", variant: "fill" },
  { url: "https://www.amazon.com", name: "亚马逊", domain: "amazon.com", icon: "a", color: "#111111", variant: "fill" },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "凌晨好";
  if (h < 11) return "上午好";
  if (h < 13) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function readUserName(): string {
  try {
    return new URLSearchParams(location.search).get("u")?.trim() || "卖家朋友";
  } catch {
    return "卖家朋友";
  }
}

function toUrl(input: string): string {
  const s = input.trim();
  if (!s) return "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /\.[a-z]{2,}/i.test(s)) return `https://${s}`;
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`;
}

export function NewTab(): JSX.Element {
  const [value, setValue] = useState("");
  const [hello] = useState(greeting());
  const [userName] = useState(readUserName());

  const navigate = (raw: string): void => {
    const u = toUrl(raw);
    if (u) location.href = u;
  };

  return (
    <div className="page">
      <header className="hero">
        <h1 className="hello">
          {hello},{userName}! <span className="wave">👋</span>
        </h1>
        <p className="subtitle">专注生意,用好工具,做好运营</p>
      </header>

      <div className="search-box">
        <span className="search-icon" aria-hidden>
          🔍
        </span>
        <input
          id="url-input"
          type="text"
          placeholder="搜索或输入网址"
          autoFocus
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) navigate(value);
          }}
        />
        <button id="btn-go" type="button" aria-label="搜索" onClick={() => navigate(value)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      </div>

      <section>
        <h2 className="section-title">快捷访问</h2>
        <div className="shortcuts">
          {SHORTCUTS.map((s) => (
            <button type="button" key={s.url} className="shortcut" onClick={() => navigate(s.url)}>
              <div className={`shortcut-icon ${s.variant}`} style={{ "--brand": s.color } as CSSProperties}>
                {s.icon}
              </div>
              <div className="shortcut-name">{s.name}</div>
              <div className="shortcut-domain">{s.domain}</div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
