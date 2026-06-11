import { create } from "zustand";

// 视图偏好(模块本地):思考默认收起、工具默认展开、回车发送。
// 对齐 agent-ui preferences.store 的 chat 子集;持久化由 index.tsx 经 ctx.storage 兜底,
// store 本身保持纯内存(无 ctx 依赖)。
export interface ChatPrefs {
  showThinking: boolean;
  showToolCalls: boolean;
  submitOnEnter: boolean;
}

interface PrefsStoreState extends ChatPrefs {
  set(patch: Partial<ChatPrefs>): void;
}

export const DEFAULT_PREFS: ChatPrefs = {
  showThinking: false,
  showToolCalls: true,
  submitOnEnter: true,
};

export const usePrefsStore = create<PrefsStoreState>((set) => ({
  ...DEFAULT_PREFS,
  set: (patch) => set(patch),
}));
