import type { AuthState, ModuleUiMeta } from "@boundary-desktop/contract";

/** 导航用的模块条目:取自 catalog 的 manifest(激活前即可渲染入口,见 spec 4.2)。 */
export interface ModuleEntry {
  id: string;
  version: string;
  ui?: ModuleUiMeta;
}

/** 壳通过 preload contextBridge 拿到的受控 host API。main 实现、renderer 消费。 */
export interface HostApi {
  auth: {
    getState(): Promise<AuthState>;
    /** 发起登录:壳启动时未登录即调,武装 AuthDriver 等待表单提交。 */
    requestLogin(): Promise<void>;
    /** 登录表单提交,resolve 已武装的 AuthDriver。 */
    submitLogin(phone: string, password: string): Promise<{ ok: boolean; error?: string }>;
    requestLogout(): Promise<void>;
    /** 订阅登录态变化,返回退订函数。 */
    onChange(listener: (state: AuthState) => void): () => void;
  };
  modules: {
    list(): Promise<ModuleEntry[]>;
  };
}

declare global {
  interface Window {
    hostApi: HostApi;
  }
}
