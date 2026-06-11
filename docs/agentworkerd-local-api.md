# agentworkerd 本地管理 API（登录链路）

boundary-desktop 的壳通过 `WorkerSupervisor` 拉起本地 agentworkerd 子进程，并经其 HTTP 端点消费"本地管理 API"。本文档是消费方参考，覆盖登录、会话、个人资料、状态、设备激活几组端点。契约由 ai-agent 定义（`crates/app-worker/src/transport/http/`），本文档随对接需要摘录，不是契约源。

## 端点发现与基址

worker 绑定监听后原子写出 runtime.json：

```
~/Library/Application Support/ai.boundary.claw/run/agentworkerd/runtime.json
```

字段含 `http: { addr, port }`。壳轮询该文件得到基址 `http://<addr>:<port>`；worker 未就绪时基址为 null。

## 响应与错误信封

成功：handler 直接返回裸 JSON 对象，无 `{code,message,data}` 外层（与 Gateway 上游不同）。

失败：

```json
{ "error": { "code": "unauthorized", "message": "invalid account or password" } }
```

错误 code 与 HTTP status 映射：

| status | code |
|--------|------|
| 400 | bad_request |
| 401 | unauthorized |
| 403 | forbidden |
| 404 | not_found |
| 415 | unsupported_media_type |
| 502 | bad_gateway |
| 503 | service_unavailable |
| 500 | internal_error |

## 令牌模型（三层）

| 令牌 | 产生 | 用途 | 持有方 |
|------|------|------|--------|
| `session_token` | 本地 worker，格式 `local_<uuid>` | 壳 → worker 的认证凭据 | 壳需自行持有/持久化 |
| `user_session_token` | Gateway `/auth/login` | worker → Gateway 调用 | worker 持久化在 local-session.json |
| `refresh_token` | Gateway `/auth/login` | 刷新 user_session_token | worker 持久化（仅完整登录有） |

worker 侧已把整组令牌持久化到：

```
~/Library/Application Support/ai.boundary.claw/gateway/local-session.json
```

壳侧只需持久化 `session_token`：重启后拿它打 `GET /api/auth/me`，worker 会用本地存的 user_session_token 找 Gateway 校验，必要时自动用 refresh_token 刷新。校验通过即视为已登录，无需壳重新输入凭据。

令牌传递方式（二选一）：

- Header：`Authorization: Bearer <session_token>`
- Cookie：`boundary_local_session=<session_token>`

## 鉴权要求

需要 `session_token` 的端点：`/api/auth/me`、`/api/auth/logout`、`/api/auth/profile`、`/api/auth/password`、`/local/device/*`，以及未在下方列出的其余 `/api/*`。

public（无需令牌）：`/api/auth/login`、`/local/status`、`/local/gateway/status`、`/local/daemon/status`、`/local/runtime/*`、`/api/agents`。

## 认证端点

### POST /api/auth/login

public。请求：

```json
{ "account": "string", "password": "string" }
```

`account` 是通用账户标识（手机号或邮箱等），非空；`password` 非空。

响应 200：

```json
{
  "session_token": "local_<uuid>",
  "user_session_token": "gateway-token",
  "device": { "state": "active", "device_id": "..." }
}
```

`user_session_token` 与 `device` 在缺失时被省略（`device` 仅在已激活设备时出现）。响应**不含用户资料**——用户信息走 `/api/auth/profile`。

同时下发 Cookie：`boundary_local_session=<session_token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`。

错误：400 account/password 为空；401 账户或密码错误；403 账户/租户被暂停；502/503 Gateway 不可用。

### GET /api/auth/me

需令牌。响应 200 同 login 的响应结构（`session_token` + 可选 `user_session_token`/`device`）。用于启动时校验持久化的 `session_token` 是否仍有效。401 表示令牌缺失/无效/过期。

### POST /api/auth/logout

需令牌。无请求体。响应 200 `{}`，并下发清除 Cookie（`Max-Age=0`）。worker 撤销本地会话、删除 local-session.json。

### GET /api/auth/profile

需令牌。响应 200：

```json
{
  "tenant_id": "string",
  "account_id": "string",
  "account": "string",
  "display_name": "string",
  "phone": "string?",
  "role": "string",
  "nickname": "string?",
  "preferences": "string?"
}
```

`phone`/`nickname`/`preferences` 可缺省。用户身份映射建议：`id ← account_id`，`name ← display_name`。

### PATCH /api/auth/profile

需令牌。请求（字段省略=不变；空串=清空）：

```json
{ "nickname": "string?", "preferences": "string?" }
```

响应 200 同 `GET /api/auth/profile`。

### POST /api/auth/password

需令牌。请求：

```json
{ "current_password": "string", "new_password": "string" }
```

两者非空。响应 200 `{}`。401 当前密码错误或会话失效。

## 状态端点

### GET /local/status

public。启动期/健康面板用的聚合状态：

```json
{
  "phase": "needs_login",
  "status": "action_required",
  "message": "login required",
  "worker": { "state": "ready", "pid": 0, "version": "0.1.0" },
  "gateway": { "state": "disconnected", "authenticated": false, "last_error": null },
  "device": { "state": "not_activated", "device_id": null },
  "runtime": { "attached": true, "configured": true, "target": "aarch64-apple-darwin", "runtimes": [] }
}
```

`phase` 枚举：`starting | needs_login | needs_device_activation | runtime_bootstrapping | ready | degraded | draining | stopping`。

`status` 枚举：`pending | action_required | ok | degraded | error`。

phase 推导（worker ready 前提下）：无本地会话→`needs_login`；设备 `not_activated`/`revoked`/`suspended`→`needs_device_activation`；runtime 未挂载→`runtime_bootstrapping`；否则 `ready`。`device` 为 null（worker 未配置 device manager）时跳过设备检查，登录即可达 `ready`。

`worker.state` 枚举：`starting | ready | draining | stopping`。

### GET /local/gateway/status

public。`{ state, authenticated, last_error }`。`state` 枚举：`disconnected | connecting | connected | reconnecting`。

### GET /local/daemon/status

public。`{ agentworkerd: { running: true, http: null, ws: null } }`。能返回即证明 worker 存活。

## 设备激活端点

登录之后、`ready` 之前的可选阶段（仅当 worker 配置了 device manager）。

### GET /local/device/status

需令牌。`{ state, device_id }`。`state` 枚举：`not_activated | active | revoked | suspended`。

### GET /local/device/identity

需令牌。`{ state, device_id, key_id, signing_public_key_b64, kem_public_key_b64, device_metadata, gateway_base_url }`。

### POST /local/device/activate

需令牌。请求 `{ "user_session_token": "..." }`，其值必须等于本地会话的 `user_session_token`（即 login 响应里的那个）。响应 200 `{ state, device_id }`（通常 `state: "active"`）。401 token 不匹配或会话过期；503 未配置 device manager。

## 登录→可用流程

```
1. POST /api/auth/login { account, password }
   → 存 session_token（壳侧持久化）
2. GET /local/status
   → phase == needs_login   : 上一步未成功
   → phase == needs_device_activation : 走设备激活
   → phase == ready         : 直接可用
3.（如需要）POST /local/device/activate { user_session_token }
4. GET /api/auth/profile  → 取用户身份填 UI
```

启动恢复：读持久化的 session_token → `GET /api/auth/me`，200 则已登录、取 profile；401 则清除、回登录页。
