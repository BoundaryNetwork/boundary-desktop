import { create } from "zustand";

// 模块自有 ws(到 worker gateway)的连接态。区别于 ctx.network(宿主级网络),
// 这里只反映本模块 ChatWs 的 open/close,供 composer 决定 placeholder/禁用。
interface ConnStoreState {
  connected: boolean;
  setConnected(v: boolean): void;
}

export const useConnStore = create<ConnStoreState>((set) => ({
  connected: false,
  setConnected: (v) => set({ connected: v }),
}));
