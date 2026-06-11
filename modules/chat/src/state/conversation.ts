import { create } from "zustand";

export interface Conversation {
  id: string;
  name?: string;
  lastTurnAt: string | null;
}

interface ConversationStoreState {
  conversations: Conversation[];
  currentId: string | null;
  setConversations(list: Conversation[]): void;
  setCurrentId(id: string | null): void;
  upsert(conv: Conversation): void;
  remove(id: string): void;
}

export const useConversationStore = create<ConversationStoreState>((set) => ({
  conversations: [],
  currentId: null,
  setConversations: (list) => set({ conversations: list }),
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
  remove: (id) =>
    set((s) => ({
      conversations: s.conversations.filter((c) => c.id !== id),
      currentId: s.currentId === id ? null : s.currentId,
    })),
}));
