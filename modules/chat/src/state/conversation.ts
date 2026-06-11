import { create } from "zustand";
import { useAgentStore } from "./agent";

export interface Conversation {
  id: string;
  name?: string;
  lastTurnAt: string | null;
  // 归属 agent 实例的语义标签(多 agent 累积);按 agent 拉列表时打标。
  agentInstanceId?: string;
}

interface ConversationStoreState {
  conversations: Conversation[];
  currentId: string | null;
  setConversations(list: Conversation[]): void;
  upsertMany(list: Conversation[]): void;
  setCurrentId(id: string | null): void;
  upsert(conv: Conversation): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
}

export const useConversationStore = create<ConversationStoreState>((set) => ({
  conversations: [],
  currentId: null,
  setConversations: (list) => set({ conversations: list }),
  upsertMany: (list) =>
    set((s) => {
      const byId = new Map(s.conversations.map((c) => [c.id, c]));
      for (const c of list) byId.set(c.id, c);
      return { conversations: [...byId.values()] };
    }),
  setCurrentId: (id) => set({ currentId: id }),
  upsert: (conv) =>
    set((s) => {
      const i = s.conversations.findIndex((c) => c.id === conv.id);
      if (i >= 0) {
        const next = s.conversations.slice();
        next[i] = conv;
        return { conversations: next };
      }
      return { conversations: [conv, ...s.conversations] };
    }),
  rename: (id, name) =>
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, name } : c)),
    })),
  remove: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      currentId: s.currentId === id ? null : s.currentId,
    })),
}));

/**
 * 按 agent 分组当前已知会话:返回 agent_instance_id → 该 agent 的会话列表。
 * 组顺序跟随 agents 列表顺序;组内按 lastTurnAt 倒序(无 ts 视为最早)。
 * 无 agentInstanceId 标签的会话归入第一个 agent(单实例/默认场景兜底)。
 */
export function useGroupedConversations(): Map<string, Conversation[]> {
  const conversations = useConversationStore((s) => s.conversations);
  const agents = useAgentStore((s) => s.agents);

  const groups = new Map<string, Conversation[]>();
  for (const a of agents) groups.set(a.agent_instance_id, []);
  const fallback = agents[0]?.agent_instance_id;

  for (const c of conversations) {
    const key = c.agentInstanceId ?? fallback;
    if (key === undefined) continue;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const ms = (c: Conversation): number => (c.lastTurnAt ? Date.parse(c.lastTurnAt) : 0);
  for (const list of groups.values()) list.sort((x, y) => ms(y) - ms(x));
  return groups;
}
