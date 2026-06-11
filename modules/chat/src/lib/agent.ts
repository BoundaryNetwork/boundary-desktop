// agent 展示辅助:纯函数,从 agent-ui lib/agent-display 移植。
// agent 无 identity(emoji/theme),只保留取色 + 显示名 + 头像首字三件。

/** 侧栏取这个最小形态即可:id + 可选 name。 */
export type AgentLike = { id: string; name?: string };

/** 由 agent id 稳定派生色相(0-359)。31-乘子滚动和,每步无符号截断。 */
export function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** 取 agent 最友好的名字:name(去空白)> id 兜底。 */
export function displayName(a: AgentLike): string {
  return a.name?.trim() || a.id;
}

/** 头像圆里的单个字形:显示名首个 code point(Array.from 正确切代理对/CJK/emoji),兜底 '?'。 */
export function avatarLetter(a: AgentLike): string {
  const name = displayName(a);
  return Array.from(name)[0] ?? Array.from(a.id)[0] ?? "?";
}
