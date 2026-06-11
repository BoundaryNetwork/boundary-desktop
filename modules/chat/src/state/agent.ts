import { create } from "zustand";
import type { AgentSummary } from "../types";

// agent 列表 + 当前选中。会话操作一律走会话自携带的 agentInstanceId;
// currentAgentId 只用于:空态身份展示、新建会话归属(含 chat.ask)。
interface AgentStoreState {
  agents: AgentSummary[];
  currentAgentId: string | undefined;
  status: "idle" | "loading" | "ready" | "error";
  setAgents(list: AgentSummary[]): void;
  setCurrentAgent(id: string | undefined): void;
  setStatus(s: AgentStoreState["status"]): void;
  clearAll(): void;
}

export const useAgentStore = create<AgentStoreState>((set) => ({
  agents: [],
  currentAgentId: undefined,
  status: "idle",
  setAgents: (list) => set({ agents: list }),
  setCurrentAgent: (id) => set({ currentAgentId: id }),
  setStatus: (s) => set({ status: s }),
  clearAll: () => set({ agents: [], currentAgentId: undefined, status: "idle" }),
}));
