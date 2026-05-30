import {
  AlarmClockCheck,
  Blocks,
  Compass,
  MessagesSquare,
  Paintbrush,
  Square,
  Users,
  type LucideIcon,
} from "lucide-react";

/** 模块 manifest 的 ui.icon 字符串 → lucide 图标组件。
 *  图标选型严格参照 openclaw-desktop 的 LeftRail。未命中回退到 Square。 */
const MAP: Record<string, LucideIcon> = {
  chat: MessagesSquare,
  team: Users,
  skills: Blocks,
  tasks: AlarmClockCheck,
  canvas: Paintbrush,
  browser: Compass,
};

export function navIcon(name: string | undefined): LucideIcon {
  return (name && MAP[name]) || Square;
}
