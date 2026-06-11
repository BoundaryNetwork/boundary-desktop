import type { UserInfo } from "@boundary-desktop/contract";
import type { AuthDriver } from "@boundary-desktop/host";
import type { ProfileInfo } from "../shared/types.js";
import type { SessionStore } from "./auth-store.js";

export interface ShellAuthDriverDeps {
  /** agentworkerd 本地 HTTP 基址(实时取自 supervisor 发现的端点;未就绪为 null)。 */
  baseUrl: () => string | null;
  /** session_token 落盘,供跨重启复登。 */
  store: SessionStore;
}

// 复登期等 worker 端点就绪的上限:有持久化会话才会等(冷启 worker bind ~1-2s)。
const RESTORE_BASEURL_TIMEOUT_MS = 10_000;
const RESTORE_POLL_STEP_MS = 200;

/** 壳的登录驱动,接本地 agentworkerd 的认证 HTTP。
 *
 *  三条路径:
 *  - restore():开机复登。有持久化 session_token 则等端点就绪后打 /api/auth/profile 复验,
 *    通过即免表单(401 清档;够不到 worker 则保留档下次再试)。profile 既校验会话又给身份。
 *  - login():无可复登会话时武装一个待决 promise,等渲染层表单提交经 submit() resolve。
 *  - submit():POST /api/auth/login 换 session_token,取 profile 拼 user,落盘并 resolve。
 *
 *  token 即 session_token(local_<uuid>):基座存为 #token、模块 ctx.api 当 Bearer 发回
 *  worker,正是其 require_local_session 中间件所需,全链路同一令牌。 */
export class ShellAuthDriver implements AuthDriver {
  #baseUrl: () => string | null;
  #store: SessionStore;
  #promise: Promise<{ token: string; user: UserInfo }> | null = null;
  #resolve: ((v: { token: string; user: UserInfo }) => void) | null = null;
  #token: string | null = null; // 当前会话 token,登出时回收用

  constructor(deps: ShellAuthDriverDeps) {
    this.#baseUrl = deps.baseUrl;
    this.#store = deps.store;
  }

  /** 开机复登:复验出会话则返回(基座据此置已登录态),否则 null(走登录表单)。 */
  async restore(): Promise<{ token: string; user: UserInfo } | null> {
    // 开发便利:BOUNDARY_DEV_AUTOLOGIN 置位直接放行,免 GUI 手填表单(headless 验证用)。
    if (process.env.BOUNDARY_DEV_AUTOLOGIN) {
      const session = { token: "dev-autologin", user: { id: "dev", name: "dev" } };
      this.#token = session.token;
      return session;
    }
    const token = this.#store.load();
    if (!token) return null;
    if (!(await this.#waitBaseUrl())) return null; // worker 没起来:不复登也不清档
    let user: UserInfo;
    try {
      user = await this.#fetchProfile(token);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) this.#store.clear(); // 会话确已失效
      return null; // 其它错误(端点抖动)保留档,下次再试
    }
    this.#token = token;
    return { token, user };
  }

  login(): Promise<{ token: string; user: UserInfo }> {
    if (this.#promise) return this.#promise; // 已武装则复用,避免悬挂 promise
    this.#promise = new Promise((resolve) => {
      this.#resolve = resolve;
    });
    return this.#promise;
  }

  async submit(account: string, password: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.#resolve) return { ok: false, error: "当前无待处理的登录请求" };
    if (!account.trim()) return { ok: false, error: "请输入账号" };
    if (!password) return { ok: false, error: "请输入密码" };

    let session: { token: string; user: UserInfo };
    try {
      session = await this.#performLogin(account.trim(), password);
    } catch (err) {
      return { ok: false, error: loginErrorMessage(err) };
    }

    this.#token = session.token;
    this.#store.save(session.token);
    const resolve = this.#resolve;
    this.#resolve = null;
    this.#promise = null;
    resolve(session);
    return { ok: true };
  }

  async logout(): Promise<void> {
    const token = this.#token;
    this.#token = null;
    this.#store.clear();
    if (!token) return;
    try {
      await this.#fetchJson("POST", "/api/auth/logout", token);
    } catch {
      // 登出 best-effort:本地已清档,worker 侧会话失效自然过期。
    }
  }

  // --- 个人信息页(壳 UI,非模块)经 IPC 调用 ---

  /** 读完整个人资料(account/phone/role/nickname/preferences 等)。 */
  async getProfile(): Promise<ProfileInfo> {
    return (await this.#fetchJson("GET", "/api/auth/profile", this.#requireToken())) as ProfileInfo;
  }

  /** 改昵称/个性化信息(PATCH),返回更新后的 profile。 */
  async updateProfile(patch: {
    nickname?: string;
    preferences?: string;
  }): Promise<ProfileInfo> {
    return (await this.#fetchJson(
      "PATCH",
      "/api/auth/profile",
      this.#requireToken(),
      patch,
    )) as ProfileInfo;
  }

  /** 改登录密码(POST)。失败转中文提示(当前密码错误等)。 */
  async changePassword(
    currentPassword: string,
    newPassword: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!currentPassword) return { ok: false, error: "请输入当前密码" };
    if (!newPassword) return { ok: false, error: "请输入新密码" };
    try {
      await this.#fetchJson("POST", "/api/auth/password", this.#requireToken(), {
        current_password: currentPassword,
        new_password: newPassword,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: passwordErrorMessage(err) };
    }
  }

  #requireToken(): string {
    if (!this.#token) throw new HttpError(401, "unauthorized", "未登录");
    return this.#token;
  }

  /** POST /api/auth/login → session_token,再取 profile 拼 user。
   *  profile 是用户身份的权威源,失败即让登录失败(不伪造身份、不静默兜底)。 */
  async #performLogin(
    account: string,
    password: string,
  ): Promise<{ token: string; user: UserInfo }> {
    const resp = (await this.#fetchJson("POST", "/api/auth/login", null, {
      account,
      password,
    })) as { session_token: string };
    const token = resp.session_token;
    let user: UserInfo;
    try {
      user = await this.#fetchProfile(token);
    } catch (err) {
      // 登录已成功但取资料失败:别当密码错处理,给可辨识的提示。
      const detail = err instanceof Error ? err.message : String(err);
      throw new HttpError(
        err instanceof HttpError ? err.status : 0,
        "profile_failed",
        `获取用户资料失败:${detail}`,
      );
    }
    return { token, user };
  }

  /** GET /api/auth/profile → 用户身份(id←account_id, name←display_name)。
   *  该端点既校验会话(无效则 401)又给身份,是登录态的权威源。 */
  async #fetchProfile(token: string): Promise<UserInfo> {
    const p = (await this.#fetchJson("GET", "/api/auth/profile", token)) as {
      account_id: string;
      display_name: string;
    };
    return { id: p.account_id, name: p.display_name };
  }

  async #waitBaseUrl(): Promise<boolean> {
    const deadline = Date.now() + RESTORE_BASEURL_TIMEOUT_MS;
    for (;;) {
      if (this.#baseUrl()) return true;
      if (Date.now() >= deadline) return false;
      await sleep(RESTORE_POLL_STEP_MS);
    }
  }

  async #fetchJson(
    method: string,
    path: string,
    token: string | null,
    body?: unknown,
  ): Promise<unknown> {
    const base = this.#baseUrl();
    if (!base) throw new HttpError(0, "endpoint_unavailable", "agentworkerd 端点尚未就绪");
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let resp: Awaited<ReturnType<typeof fetch>>;
    try {
      resp = await fetch(new URL(path, base.endsWith("/") ? base : `${base}/`), {
        method,
        headers,
        body: payload,
      });
    } catch (err) {
      throw new HttpError(0, "network", err instanceof Error ? err.message : String(err));
    }
    const text = await resp.text();
    if (!resp.ok) {
      const { code, message } = parseError(text, resp.status);
      throw new HttpError(resp.status, code, message);
    }
    return text ? JSON.parse(text) : null;
  }
}

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 解析 worker 的 `{error:{code,message}}` 失败信封。 */
function parseError(text: string, status: number): { code: string; message: string } {
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (body.error) {
      return { code: body.error.code ?? "error", message: body.error.message ?? text };
    }
  } catch {
    // 非 JSON 响应
  }
  return { code: "error", message: text || `HTTP ${status}` };
}

/** 登录失败转中文提示(worker 返回英文 message)。 */
function loginErrorMessage(err: unknown): string {
  if (!(err instanceof HttpError)) return "登录失败";
  switch (err.code) {
    case "unauthorized":
      return "账号或密码错误";
    case "forbidden":
      return "账号或租户已被停用";
    case "endpoint_unavailable":
    case "network":
      return "无法连接本地服务,请稍后重试";
    case "bad_gateway":
    case "service_unavailable":
      return "服务暂不可用,请稍后重试";
    default:
      return err.message || "登录失败";
  }
}

/** 改密码失败转中文提示(401 多为当前密码错或会话失效)。 */
function passwordErrorMessage(err: unknown): string {
  if (!(err instanceof HttpError)) return "修改失败";
  switch (err.code) {
    case "unauthorized":
      return "当前密码错误或登录已失效";
    case "bad_request":
      return err.message || "密码不合要求";
    case "endpoint_unavailable":
    case "network":
      return "无法连接本地服务,请稍后重试";
    case "bad_gateway":
    case "service_unavailable":
      return "服务暂不可用,请稍后重试";
    default:
      return err.message || "修改失败";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
