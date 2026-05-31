import type { UserInfo } from "@boundary-desktop/contract";
import type { AuthDriver } from "@boundary-desktop/host";

/** 壳的登录驱动:HostServices.requestLogin 触发 login() 武装一个待决 promise,
 *  渲染层登录表单提交经 submit() resolve 它。登录 UI 由壳渲染,凭证经此回流——
 *  与模块侧 ctx.auth.requestLogin 同一条路径(都走 HostServices → 本 driver)。
 *
 *  stub:手机号非空即放行,token/user 用手机号占位。真鉴权等 ai-agent 后端接入。 */
export class ShellAuthDriver implements AuthDriver {
  #promise: Promise<{ token: string; user: UserInfo }> | null = null;
  #resolve: ((v: { token: string; user: UserInfo }) => void) | null = null;

  login(): Promise<{ token: string; user: UserInfo }> {
    // 开发便利:BOUNDARY_DEV_AUTOLOGIN 置位时直接放行,免去 GUI 手填登录表单——
    // 供 headless 验证(起壳跑 WS 门面调模块工具)用,正常运行不设此变量、行为不变。
    if (process.env.BOUNDARY_DEV_AUTOLOGIN) {
      return Promise.resolve({ token: "dev-autologin", user: { id: "dev", name: "dev" } });
    }
    if (this.#promise) return this.#promise; // 已武装则复用,避免重复触发产生悬挂 promise
    this.#promise = new Promise((resolve) => {
      this.#resolve = resolve;
    });
    return this.#promise;
  }

  async logout(): Promise<void> {}

  submit(phone: string, _password: string): { ok: boolean; error?: string } {
    if (!this.#resolve) return { ok: false, error: "当前无待处理的登录请求" };
    if (!phone.trim()) return { ok: false, error: "请输入手机号" };
    const resolve = this.#resolve;
    this.#resolve = null;
    this.#promise = null;
    resolve({ token: `stub-${phone}`, user: { id: phone, name: phone } });
    return { ok: true };
  }
}
