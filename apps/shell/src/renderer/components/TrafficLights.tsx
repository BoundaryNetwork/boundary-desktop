import { useEffect, useState } from "react";

const SIZE = 12; // 系统默认 ~14px，这里小一档：12px 更克制
const GAP = 8;

/**
 * macOS 自绘红绿灯。要求主窗 `frame: false` + `setWindowButtonVisibility(false)`，
 * 系统三连键完全交给渲染端经 hostApi.window 实现：
 * - 红：close()
 * - 黄：minimize()
 * - 绿：option/alt 按下走 maximize 切换；否则全屏切换（跟系统行为一致）
 *
 * Hover 全组任一颗时显示三颗细节符号（✕ − ⤢），离开淡掉。窗口失焦时整组淡到灰点。
 * 非 macOS 走系统原生标题栏，本组件不渲染。
 */
export function TrafficLights(): JSX.Element | null {
  const isMac = window.hostApi.platform === "darwin";
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    if (!isMac) return;
    // 窗口活跃态走主进程的窗口级 focus/blur —— renderer 的 window.onblur 会被
    // 内嵌浏览器 WebContentsView 抢焦点误触发，导致灯组错误地淡成灰色。
    void window.hostApi.window.isFocused().then(setFocused);
    return window.hostApi.window.onFocusChange(setFocused);
  }, [isMac]);

  if (!isMac) return null;

  const showSymbols = hovered && focused;
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="no-drag"
      style={{ display: "inline-flex", alignItems: "center", gap: GAP }}
    >
      <Light kind="close" focused={focused} showSymbol={showSymbols} onClick={() => void window.hostApi.window.close()} />
      <Light kind="minimize" focused={focused} showSymbol={showSymbols} onClick={() => void window.hostApi.window.minimize()} />
      <Light
        kind="zoom"
        focused={focused}
        showSymbol={showSymbols}
        onClick={(e) => {
          if (e.altKey) void window.hostApi.window.toggleMaximize();
          else void window.hostApi.window.toggleFullscreen();
        }}
      />
    </div>
  );
}

type LightKind = "close" | "minimize" | "zoom";

function Light({
  kind,
  focused,
  showSymbol,
  onClick,
}: {
  kind: LightKind;
  focused: boolean;
  showSymbol: boolean;
  onClick: (e: React.MouseEvent) => void;
}): JSX.Element {
  const colors: Record<LightKind, { bg: string; border: string }> = {
    close: { bg: "#ff5f57", border: "#e0443e" },
    minimize: { bg: "#febc2e", border: "#dea123" },
    zoom: { bg: "#28c840", border: "#1aab29" },
  };
  const c = colors[kind];
  const bg = focused ? c.bg : "var(--traffic-unfocused-bg)";
  const border = focused ? c.border : "var(--traffic-unfocused-border)";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={kind === "close" ? "关闭" : kind === "minimize" ? "最小化" : "缩放"}
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: "var(--r-circle)",
        background: bg,
        border: `0.5px solid ${border}`,
        padding: 0,
        margin: 0,
        cursor: "pointer",
        display: "inline-grid",
        placeItems: "center",
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.05)",
      }}
    >
      {showSymbol ? <Symbol kind={kind} /> : null}
    </button>
  );
}

function Symbol({ kind }: { kind: LightKind }): JSX.Element {
  const stroke = "rgba(0, 0, 0, 0.55)";
  const w = 6;
  if (kind === "close") {
    return (
      <svg width={w} height={w} viewBox="0 0 6 6" aria-hidden="true">
        <line x1="1" y1="1" x2="5" y2="5" stroke={stroke} strokeWidth="1" strokeLinecap="round" />
        <line x1="5" y1="1" x2="1" y2="5" stroke={stroke} strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "minimize") {
    return (
      <svg width={w} height={w} viewBox="0 0 6 6" aria-hidden="true">
        <line x1="1" y1="3" x2="5" y2="3" stroke={stroke} strokeWidth="1" strokeLinecap="round" />
      </svg>
    );
  }
  // zoom（绿）—— 用对角双三角表示"全屏切换"
  return (
    <svg width={w} height={w} viewBox="0 0 6 6" aria-hidden="true">
      <path d="M1 4 L1 1 L4 1 Z" fill={stroke} />
      <path d="M5 2 L5 5 L2 5 Z" fill={stroke} />
    </svg>
  );
}
