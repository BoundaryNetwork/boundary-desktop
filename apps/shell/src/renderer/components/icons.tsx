import type { ReactNode, SVGProps } from 'react'

type IconProps = Omit<SVGProps<SVGSVGElement>, 'stroke'> & { size?: number; stroke?: number }

function Base({
  size = 18,
  stroke = 1.6,
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const Icons = {
  terminal: (p: IconProps) => (
    <Base {...p}>
      <polyline points="4 7 9 12 4 17" />
      <line x1="12" y1="18" x2="20" y2="18" />
    </Base>
  ),
  cube: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9z" />
      <path d="M3 7.5 12 12l9-4.5" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </Base>
  ),
  puzzle: (p: IconProps) => (
    <Base {...p}>
      <path d="M10 3h4a1 1 0 0 1 1 1v2a2 2 0 1 0 4 0h1a1 1 0 0 1 1 1v4a2 2 0 1 1 0 4v4a1 1 0 0 1-1 1h-4a2 2 0 1 0-4 0H7a1 1 0 0 1-1-1v-4a2 2 0 1 1 0-4V7a1 1 0 0 1 1-1h2a2 2 0 1 0 1-3z" />
    </Base>
  ),
  bolt: (p: IconProps) => (
    <Base {...p}>
      <polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2" />
    </Base>
  ),
  stream: (p: IconProps) => (
    <Base {...p}>
      <path d="M3 6h18" />
      <path d="M6 12h15" />
      <path d="M9 18h12" />
    </Base>
  ),
  remote: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 6h11l-2 3 2 3H4z" />
      <circle cx="18" cy="17" r="2.5" />
      <path d="M16 17H8" />
    </Base>
  ),
  chat: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Base>
  ),
  archive: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="3" width="18" height="4" rx="1" />
      <path d="M5 7v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </Base>
  ),
  gear: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Base>
  ),
  search: (p: IconProps) => (
    <Base {...p}>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.7" y2="16.7" />
    </Base>
  ),
  filter: (p: IconProps) => (
    <Base {...p}>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </Base>
  ),
  plus: (p: IconProps) => (
    <Base {...p}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Base>
  ),
  paperclip: (p: IconProps) => (
    <Base {...p}>
      <path d="m21.4 11.1-9.8 9.8a6 6 0 0 1-8.5-8.5l10-10a4 4 0 0 1 5.7 5.7l-10 10a2 2 0 1 1-2.8-2.8l9.2-9.2" />
    </Base>
  ),
  check: (p: IconProps) => (
    <Base {...p}>
      <polyline points="4 12 10 18 20 6" />
    </Base>
  ),
  x: (p: IconProps) => (
    <Base {...p}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Base>
  ),
  play: (p: IconProps) => (
    <Base {...p}>
      <polygon points="6 4 20 12 6 20 6 4" />
    </Base>
  ),
  stop: (p: IconProps) => (
    <Base {...p}>
      <rect x="5" y="5" width="14" height="14" rx="1" />
    </Base>
  ),
  refresh: (p: IconProps) => (
    <Base {...p}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.5 9a9 9 0 0 1 15-3.4L23 10M1 14l4.5 4.4A9 9 0 0 0 20.5 15" />
    </Base>
  ),
  download: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </Base>
  ),
  upload: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </Base>
  ),
  pulse: (p: IconProps) => (
    <Base {...p}>
      <polyline points="3 12 7 12 10 4 14 20 17 12 21 12" />
    </Base>
  ),
  send: (p: IconProps) => (
    <Base {...p}>
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </Base>
  ),
  info: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="16" x2="12" y2="11" />
      <circle cx="12" cy="8" r="0.5" fill="currentColor" />
    </Base>
  ),
  alert: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3 1.5 21h21z" />
      <line x1="12" y1="9" x2="12" y2="14" />
      <circle cx="12" cy="17.5" r="0.5" fill="currentColor" />
    </Base>
  ),
  ext: (p: IconProps) => (
    <Base {...p}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </Base>
  ),
  trash: (p: IconProps) => (
    <Base {...p}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Base>
  ),
  copy: (p: IconProps) => (
    <Base {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Base>
  ),
  fork: (p: IconProps) => (
    <Base {...p}>
      <path d="M2 12.5h7.3l5.8-6.6h6.4" />
      <path d="m17.8 2.2 3.7 3.7-3.7 3.7" />
      <path d="M9.3 12.5l5.8 6.6h6.4" />
      <path d="m17.8 15.4 3.7 3.7-3.7 3.7" />
    </Base>
  ),
  rewind: (p: IconProps) => (
    <Base {...p}>
      <polyline points="8 6 3 11 8 16" />
      <path d="M3 11h13a5 5 0 0 1 0 10H6" />
    </Base>
  ),
  // 顺时针旋转的「重新回答」图标(Lucide RotateCw 形态),用于
  // AI 消息底部的「重新回答」按钮。
  regenerate: (p: IconProps) => (
    <Base {...p}>
      <polyline points="21 3 21 9 15 9" />
      <path d="M18.36 18.36A9 9 0 1 1 21 9" />
    </Base>
  ),
  folder: (p: IconProps) => (
    <Base {...p}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </Base>
  ),
  cpu: (p: IconProps) => (
    <Base {...p}>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="15" x2="23" y2="15" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="15" x2="4" y2="15" />
    </Base>
  ),
  shield: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5z" />
    </Base>
  ),
  globe: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <path d="M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </Base>
  ),
  clock: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </Base>
  ),
  bot: (p: IconProps) => (
    <Base {...p}>
      <rect x="4" y="7" width="16" height="12" rx="3" />
      <line x1="12" y1="3" x2="12" y2="7" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
      <line x1="8" y1="19" x2="8" y2="21" />
      <line x1="16" y1="19" x2="16" y2="21" />
    </Base>
  ),
  menu: (p: IconProps) => (
    <Base {...p}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </Base>
  ),
  chevronRight: (p: IconProps) => (
    <Base {...p}>
      <polyline points="9 6 15 12 9 18" />
    </Base>
  ),
  chevronDown: (p: IconProps) => (
    <Base {...p}>
      <polyline points="6 9 12 15 18 9" />
    </Base>
  ),
  logout: (p: IconProps) => (
    <Base {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </Base>
  ),
  power: (p: IconProps) => (
    <Base {...p}>
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
      <line x1="12" y1="2" x2="12" y2="12" />
    </Base>
  ),
  more: (p: IconProps) => (
    <Base {...p}>
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
    </Base>
  ),
  edit: (p: IconProps) => (
    <Base {...p}>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
    </Base>
  ),
  help: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2 2-2.5 3" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </Base>
  ),
  sidebar: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </Base>
  ),
  sidebarRight: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" y1="4" x2="15" y2="20" />
    </Base>
  ),
  code: (p: IconProps) => (
    <Base {...p}>
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </Base>
  ),
  eye: (p: IconProps) => (
    <Base {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  ),
  expand: (p: IconProps) => (
    <Base {...p}>
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </Base>
  ),

  // Filled variants — 用作 LeftRail "选中态" 的实心图标。fill=currentColor +
  // 取消 stroke,几何选择闭合路径以避免空洞。仅在 active 时切到 filled 版,
  // 其余 UI 仍用上面的线条 outline 版。
  chatFilled: ({ size = 18, stroke: _s, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...rest}
    >
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  clockFilled: ({ size = 18, stroke: _s, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...rest}
    >
      {/* 实心圆 + 反挖的指针。fillRule=evenodd 让内部时针 path 反向 */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5a1 1 0 1 0-2 0v5a1 1 0 0 0 .29.71l3 3a1 1 0 0 0 1.42-1.42L13 11.59V7z"
      />
    </svg>
  ),
  boltFilled: ({ size = 18, stroke: _s, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...rest}
    >
      <polygon points="13 2 4 14 11 14 10 22 20 10 13 10 13 2" />
    </svg>
  ),
  // pulse 是开口波形,不能简单 fill。改成"实心圆点 + 加粗的脉冲线" 双层组合,
  // 视觉上更"实"。底层圆点提供 filled 感,上层线沿用 stroke 但加粗。
  pulseFilled: ({ size = 18, stroke = 2.4, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...rest}
    >
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <polyline
        points="3 12 7 12 10 4 14 20 17 12 21 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={String(stroke)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  gearFilled: ({ size = 18, stroke: _s, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...rest}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14 2.8a1 1 0 0 0-1-.8h-2a1 1 0 0 0-1 .8l-.42 2.1a8 8 0 0 0-1.83.76l-1.78-1.18a1 1 0 0 0-1.27.13L3.29 5.7a1 1 0 0 0-.13 1.27L4.34 8.75a8 8 0 0 0-.76 1.83L1.48 11a1 1 0 0 0-.8 1v2c0 .47.33.88.8 1l2.1.42a8 8 0 0 0 .76 1.83L3.16 19.03a1 1 0 0 0 .13 1.27l1.41 1.41a1 1 0 0 0 1.27.13l1.78-1.18a8 8 0 0 0 1.83.76L10 23.52c.12.47.53.8 1 .8h2a1 1 0 0 0 1-.8l.42-2.1a8 8 0 0 0 1.83-.76l1.78 1.18a1 1 0 0 0 1.27-.13l1.41-1.41a1 1 0 0 0 .13-1.27l-1.18-1.78a8 8 0 0 0 .76-1.83l2.1-.42c.47-.12.8-.53.8-1v-2a1 1 0 0 0-.8-1l-2.1-.42a8 8 0 0 0-.76-1.83l1.18-1.78a1 1 0 0 0-.13-1.27l-1.41-1.41a1 1 0 0 0-1.27-.13l-1.78 1.18a8 8 0 0 0-1.83-.76L14 2.8zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"
      />
    </svg>
  ),
}

export type IconName = keyof typeof Icons
