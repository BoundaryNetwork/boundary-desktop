# 给 boundary-desktop 外挂 agentworkerd 作为 agent kernel

日期:2026-06-10
关联:`docs/chat-port-eval.md`(本文深挖其"缺 spawn/discovery 层"的部分)

## 目标

boundary-desktop(壳)把 ai-agent 的 `agentworkerd` 作为子进程拉起,当 agent kernel。壳承载登录、会话承接、设置配置,全部通过本地 HTTP/WS 与 agentworkerd 交互;kernel 持有 agent 的全部状态与运行时。

## 分工

对称替壳,worker 侧零改动是原则:

- ai-agent = Tauri 壳 + worker
- boundary-desktop = Electron 壳 + worker

同一个 worker、同一 bundle id、同一 `ai.boundary.claw` base_dir、同一设备身份。boundary-desktop 只是把 Tauri 那层壳换成现有 shell,照 ai-agent Tauri 壳今天对接 worker 的同一套方式接上去。本文所有改动都在壳侧。

bundle id 统一为 `ai.boundary.claw`:外层壳与嵌套 worker .app 同用此 id。这正是 Tauri 现状(`tauri.conf.json` identifier = `ai.boundary.claw`,嵌套 `clawhost-agentworkerd.app` 的 `CFBundleIdentifier` 也是 `ai.boundary.claw`)——外层==嵌套同 id 已被在产、已公证分发的 Tauri 包验证可行。boundary-desktop 侧把 `electron-builder.yml` 的 `appId` 从 `com.boundary.desktop` 改为 `ai.boundary.claw`、`productName` 从 `Boundary Desktop` 改为 `DabiAI Desktop`(产物即 `DabiAI Desktop.app`)。

agentworkerd 是状态权威,shell 是它的进程监管器 + HTTP/WS 驱动 + UI。

- kernel 侧(ai-agent):零改动。agentworkerd 本就为"被壳子托管的 sidecar daemon"设计,ai-agent 的 Tauri 壳今天就是这么用它的(spawn → Unix socket 控制 → 读 runtime.json 发现端口 → HTTP/WS 调业务)。`apps/agentworkerd` + `crates/app-worker|app-launcher|app-shared|ui-bundle` 全是纯 Rust,不依赖 Tauri,也不知道自己被谁 spawn。
- 壳侧(boundary-desktop):新建一层进程监管 + 打包,把 kernel 的本地端点喂给数据面。全部落在 `apps/shell/src/main` 与 electron-builder 配置,不进 `packages/contract`。

## 落地顺序

1. **macOS kernel .app 签名链(前置,最重)** —— 见下节。这条不通,后面都跑不起来。
2. **进程监管** —— 主进程 spawn agentworkerd,读 runtime.json,管生命周期。
3. **数据面接线** —— 把发现到的端点喂进 ApiDriver / config,模块用现成 ctx 取数。

## 实现状态(2026-06-10,dev 链路已打通)

进程监管 + 数据面 + macOS dev 签名链已落地并端到端验证。新增代码全在壳侧 `apps/shell/src/main/worker/`:

- `paths.ts` —— base_dir(镜像 Rust `dirs::data_local_dir()/ai.boundary.claw`)、control.sock / runtime.json 路径、worker 二进制定位(override > packaged > dev)。
- `runtime.ts` —— runtime.json 类型 + 读取(对齐 `app_shared::RuntimeFile`)。
- `control.ts` —— `WorkerControlClient`(status/drain/shutdown,Unix socket / Win TCP 8789,写+半关闭+读到 EOF)。
- `supervisor.ts` —— `WorkerSupervisor`:reap → spawn → 5s 自愈 tick → runtime.json 端点发现(pid 校验)→ drain/shutdown 排空。
- `api-driver.ts` —— `WorkerApiDriver`:`ctx.api.request` 代发到 worker HTTP,baseURL 取自发现端点,token 基座注入。
- 接线:`index.ts` 构造 supervisor、把 `WorkerApiDriver` 注入 `HostServices.api`、`onDiscover` 推 `config.agentworkerd = {http, ws}`、`whenReady` 起 supervisor、`before-quit` 拦截跑排空。
- dev worker .app:`apps/shell/resources/clawhost-agentworkerd.app` 软链 ai-agent `target/debug` 产物(`apps/shell/resources/` 已 gitignore);`BOUNDARY_WORKER_BIN` 可覆盖。
- 打包:`electron-builder.yml` mac 加 `extraResources`(嵌 worker .app)+ `signIgnore`(防重签)。

端到端验证(`pnpm dev`):签名 .app spawn 未被 AMFI SIGKILL → worker 绑 HTTP/WS/control → 壳发现 `http`+`ws` 端点并推 config → "runtime attached"(证明 Secure Enclave 设备身份可达)→ 退出时 drain/shutdown 优雅排空(worker exit 0)→ 无孤儿残留。

退出排空的坑(已修):退出时 worker 可能被信号(dev 下终端进程组 SIGINT)触发自行优雅退出,控制端点随之关闭,`drain`/`shutdown` 报 EPIPE/ECONNREFUSED ——属预期,不当错误。且**进程被信号杀死时 `child.exitCode` 仍为 null、信号落在 `signalCode`**,`#waitExit` 必须同时查 `signalCode` 才探得到退出,否则空等到超时再误杀。`stop()` 改为:best-effort 驱动下线 → 耐心等退出(探到 exitCode/signalCode 即返回)→ 仅真卡死(5s)才 SIGKILL 兜底。实测:控制路径 shutdown → worker exit 0 ~0.05s;attached worker 收 SIGINT 自退 ~0.28s;均不再误杀。

未做:release 签名/公证打包未实跑(需 Developer ID 物料);Windows/Linux 的 worker 产物与 `extraResources` 未接(本机 mac);打包态 worker stdout/stderr 落文件未加。GUI Cmd+Q 的退出排空在真机复测(本环境 headless,Electron 退出路径不稳定、偶尔跳过 before-quit)。

## macOS kernel 只能以 app 方式打包

这是真正的门槛,不是"extraResources 一个二进制"。现状(ai-agent):

- agentworkerd 在 macOS 以嵌套 `.app` 分发:`clawhost-agentworkerd.app`,自带 `Info.plist` + provisioning profile + entitlements。Tauri 经 `bundle.resources`(非 sidecar)把这个**预签名的 .app** 整体塞进外层 `Contents/Resources/`。
  - 配置:`apps/desktop/src-tauri/tauri.bundle.conf.json`。
  - spawn 路径:`<Resources>/clawhost-agentworkerd.app/Contents/MacOS/clawhost-agentworkerd`(`apps/desktop/src-tauri/src/lib.rs:886`)。
- 根因:kernel 要访问 Secure Enclave / data-protection keychain(设备签名身份、激活态存这),需要 `keychain-access-groups` entitlement + 嵌入 provisioning profile —— 只有正经 `.app` 能承载,裸 Mach-O 给不了。
- dev 也绕不开:先 `cargo build -p clawhost-agentworkerd` 再组装+签名 .app(`scripts/dev-sign-worker-app.sh debug`,Apple Development 证书 + developer.provisionprofile,debug 不加 `--options runtime`)。
- Windows/Linux 无此约束:裸 `.exe` / 裸二进制即可(`tauri.bundle.windows.conf.json`)。

复刻步骤(编译 → 组装签名 .app → 嵌入 → 防重签 → 运行时定位)见下节《第一步清单》,每步带确切命令与坑。

前提:既然共用一套,boundary-desktop 嵌入的就是**同一份签名的 worker .app**(同 `keychain-access-groups`),外层壳也在**同一 Apple Team / bundle id 家族**下签名,worker 才摸得到 Secure Enclave 里那份共享的设备身份。先对齐 Apple 账号/证书/profile。

## 第一步清单:macOS worker .app 签名链

原则:signed `.app` 由 ai-agent 现成脚本(`scripts/dev-sign-worker-app.sh`)产出,boundary-desktop 只消费产物 + 嵌入时不破坏其签名。worker 与脚本都不改。

已签名 `.app` 的固定形态(`dev-sign-worker-app.sh` 产出,boundary-desktop 当输入):

- 结构:`clawhost-agentworkerd.app/Contents/{MacOS/clawhost-agentworkerd, Info.plist, embedded.provisionprofile}`。
- Info.plist:`CFBundleIdentifier = ai.boundary.claw`、`CFBundleExecutable = clawhost-agentworkerd`、`LSBackgroundOnly = true`(无 dock 图标)。
- entitlements:`application-identifier = <TEAM>.ai.boundary.claw`、`team-identifier = <TEAM>`、`keychain-access-groups = [<TEAM>.*]`、network server/client。
- 签名:`codesign --force --deep --identifier ai.boundary.claw --entitlements ...`;release 另加 `--options runtime`。

### 0. 一次性物料(与 ai-agent 共用同一套)

- [ ] 同一 Apple Team、同一 App ID `ai.boundary.claw`(沿用,不新建)。外层 `electron-builder.yml` 的 `appId` 也改为 `ai.boundary.claw`(现为 `com.boundary.desktop`),与 Tauri 一致。
- [ ] Development provisioning profile(锁本机,dev 用)+ Apple Development 证书在钥匙串。
- [ ] Developer ID provisioning profile(ProvisionsAllDevices,发布用)+ Developer ID Application 证书。
- [ ] 这些 profile 文件位置沿用 ai-agent `apps/desktop/src-tauri/{developer,distribution}.provisionprofile`,或用 `BOUNDARY_PROVISIONING_PROFILE` / `BOUNDARY_DISTRIBUTION_PROFILE` 指过去。

### 1. 产出已签名 worker .app(在 ai-agent,复用脚本)

- [ ] dev:`cargo build -p clawhost-agentworkerd` → `scripts/dev-sign-worker-app.sh debug` → `target/debug/clawhost-agentworkerd.app`。
- [ ] release:`cargo build --release -p clawhost-agentworkerd`(分 mac arm64/x64 target)→ `BOUNDARY_CODESIGN_IDENTITY=<Developer ID App> scripts/dev-sign-worker-app.sh release` → `target/release/clawhost-agentworkerd.app`。
- [ ] 产物就是一个签好、嵌好 profile 的 `.app`,作为 boundary-desktop 构建输入(用文件拷贝 / artifact,不在 boundary-desktop 重写签名逻辑)。

### 2. boundary-desktop dev 接线

- [ ] `predev` 把 signed `.app` 拷到壳能定位的固定位置(如 `apps/shell/resources/clawhost-agentworkerd.app`)。
- [ ] 主进程 dev spawn 路径指向该 `.app/Contents/MacOS/clawhost-agentworkerd`。
- [ ] dev 成功门:起 shell → worker 被 spawn 且**不被 AMFI SIGKILL**、SE 键创建无 `errSecMissingEntitlement(-34018)` → `~/Library/Application Support/ai.boundary.claw/run/agentworkerd/runtime.json` 出现 → 能连 control.sock 拿到 status。

### 3. 打包嵌入(electron-builder,发布)

- [ ] `extraResources` 把 signed `.app` 放进 `Contents/Resources/clawhost-agentworkerd.app`。
- [ ] 防重签(关键坑,已核实 electron-builder 25.1.8 / osx-sign 1.3.1 源码):osx-sign `walkAsync(Contents)` 会遍历到嵌套 worker .app 的每个文件,默认 `codesign --force` 重签,且 entitlements 取 `entitlementsInherit`(`build/entitlements.mac.inherit.plist`,无 `keychain-access-groups`、不重嵌 profile)→ 直接打掉 worker 的 SE 访问(-34018)。解法用 `mac.signIgnore`:
  ```yaml
  mac:
    signIgnore:
      - "clawhost-agentworkerd\\.app"
  ```
  electron-builder 把每条 `signIgnore` 当 `new RegExp(it)`、对完整路径 `regExp.test(file)`(无锚点子串匹配);osx-sign 命中即 `continue` 完全跳过签名,保留脚本签好的签名。一条正则即覆盖该 .app 及其所有子路径。
  - 备选:afterSign hook 在外层签完后用 worker 自己的 entitlements + profile 重签嵌套 .app(等价再跑脚本 codesign 段);signIgnore 更简单,优先。
- [ ] 外层壳(appId `ai.boundary.claw`,同 Tauri)在同一 Team 下签、hardenedRuntime;整包 notarize(嵌套 worker .app 已 `--options runtime` + secure timestamp,可过公证)。外层==嵌套同 id 已被 Tauri 在产包验证可过公证。
- [ ] 校验:`codesign --verify --deep --strict`、`spctl -a -t exec`、`xcrun stapler validate`;装到一台没装过的机器跑通激活。

### 4. 运行时定位

- [ ] dev:指向 predev 拷贝位置。
- [ ] packaged:`path.join(process.resourcesPath, "clawhost-agentworkerd.app/Contents/MacOS/clawhost-agentworkerd")`(替代 Tauri 的 `resource_dir()`)。

## 进程监管(照搬 app-launcher,TS 重写)

落在 `apps/shell/src/main`,是 `crates/app-launcher` 的 `WorkerProcess` + `run_with_retry` + `WorkerControlClient` 的 Node 版。worker 不改,只对接。生命周期绑 app 生命周期:单例 daemon,独占 workspace,不可多实例。下列常量/行为均取自 app-launcher 实现。

### spawn(照搬 `spawn_worker_child` + Tauri setup)

- [ ] binary 路径:见签名清单第 4 步(mac 指向 .app 内二进制)。
- [ ] args:无;env:继承 + 透传 `RUST_LOG`(worker 同级日志)。无需传 gateway/base_dir,worker 内部默认。
- [ ] stdio:stdin 置空,stdout/stderr 接到壳日志(打包态建议落文件——worker 自身无文件日志)。
- [ ] spawn 前 `mkdir -p <base>/run/agentworkerd/`(worker 要在此 bind control 端点)。
- [ ] spawn 前按名 reap 孤儿 `clawhost-agentworkerd`(关键):上一轮壳异常退出会留下孤儿 worker,两个 worker 同设备抢 gateway 单一 session slot → 互相把对方 session 标记 rotated → 败者 runtime profile 轮询拿到 40023 → SessionReloadRequired → 重启 ~5s 环。
- [ ] Windows:spawn 用 `windowsHide`(等价 `CREATE_NO_WINDOW`),否则控制台子系统二进制会弹 cmd 窗。

### 控制协议客户端(照搬 `WorkerControlClient`)

- [ ] 传输:**mac/linux = Unix domain socket** `<base>/run/agentworkerd/control.sock`;**Windows = loopback TCP `127.0.0.1:8789`**(不是 named pipe)。
- [ ] 请求:写 JSON `{"type":"status"|"drain"|"shutdown"}` → 半关闭写端 → 读到 EOF → 解析。
- [ ] 响应:`{ok:true, state, pid, generation, version}`(state ∈ `starting|ready|draining|stopping`)或 `{ok:false, error}`。
- [ ] 读写超时 5s。

### 就绪 / 存活语义(照搬 `wait_for_ready` + `child_is_running`,但要理解)

- [ ] 存活 = 子进程未退出;崩溃 = 子进程退出。这是唯一的自愈信号。
- [ ] `Ready` 状态只在**激活 + RuntimeProfile 加载后**到达;未激活时停在 `starting`。
- [ ] 关键:初次 spawn 后 wait-for-ready 5s 超时**不算失败**——HTTP/control 端点早已起(bootstrap Phase 2),激活由 UI 经 HTTP 驱动。别把"未 Ready"当 spawn 失败去重启(否则与激活流程互踩)。
- [ ] 端点发现:轮询 `<base>/run/agentworkerd/runtime.json`,取 `http`/`ws` 的 `{addr,port}`;**校验 `runtime.json.pid == 刚 spawn 的子进程 pid`** 再用(避免读到上一轮残留),然后喂 ApiDriver baseURL + `updateConfig()` push ws。

### 崩溃自愈(照搬 `run_with_retry`)

- [ ] 后台每 5s tick:子进程活着→noop;已退出→重新 spawn(含再次 reap + 路径解析)。
- [ ] 可取消:app 退出时停 loop。

### 重启(照搬 `graceful_restart`,按需,如换账号)

- [ ] 序列:drain(发 Drain,轮询 status==`draining`,2s 超时)→ shutdown(发 Shutdown)→ wait-for-exit(轮询子进程退出,3s 超时则 kill)→ spawn → wait-for-ready。

### 退出排空(照搬 `shutdown`,app quit)

- [ ] 序列:drain(best-effort)→ shutdown → wait-for-exit(3s 超时则强杀)。
- [ ] Electron 接线:在 `before-quit` 里 `event.preventDefault()`,异步跑完排空再真正 `app.quit()`/`exit`;别让进程在 worker 还没排空时就被 Electron 拆掉。

### 超时常量(照搬)

- [ ] drain 2s / shutdown 3s / ready 5s / retry 5s / control 读写 5s / 轮询步进 25ms。

## 数据面:ctx 现成覆盖

shell 与 agentworkerd 的 HTTP/WS 交互一对一落在现成 driver seam 上,模块零感知、零新契约。

| 职责 | 模块侧 | shell 侧实现 | 打到 agentworkerd |
|---|---|---|---|
| 登录 | `ctx.auth.requestLogin()` / `getToken()`(contract.ts:149-156) | `AuthDriver.login()`(capabilities.ts:28-32) | `POST /api/auth/login`,token = 本地 session |
| 会话承接 / 取数 | `ctx.api.request({path})`(contract.ts:166-168) | `ApiDriver.request(opts, token)`(capabilities.ts:34-37) | 本地 HTTP REST(`/api/conversations` 等) |
| 设置/配置 | `ctx.config`(只读+订阅)(contract.ts:158) | `HostServices.updateConfig()`(capabilities.ts:162-164) | shell 拉配置后 push 进 config |
| 实时 turn 流 | 模块自取 `getToken()` 自连 WS(contract.ts:163-165) | —— | agentworkerd WS |

- shell 的 ApiDriver 把 baseURL 指向发现到的 agentworkerd 本地端口、自动带 token;模块直接 `ctx.api.request` 即可。
- ws 端口经 `updateConfig()` push 进 `ctx.config`,模块读 config 自连 WS。端点发现走现成 config 通道,无需新契约。

## bootstrap 时序

agentworkerd 的本地 HTTP 在 Phase 2 起(绑 HTTP + Unix socket + 写 runtime.json),早于 Phase 3 的"加载 RuntimeProfile / 等激活"。所以 spawn-first、再用 HTTP 驱动激活是其原生路径:

```
shell spawn agentworkerd
  → agentworkerd 立刻起 HTTP(此时未激活/未登录)
  → shell 读 runtime.json,设 ApiDriver baseURL + push ws 到 config
  → shell 经 AuthDriver.login() 打 /api/auth/login、/local/device/activate 驱动登录+激活
  → agentworkerd 重试环加载到 RuntimeProfile → ready
  → 会话承接 / turn 可用
```

agentworkerd 的重试环把失败分类成 NeedsActivation / GatewayConnect / SessionExpired,本就是为"壳还没把我登录上"设计。

## 待对齐

- Apple Team / 证书 / provisioning profile 与 kernel 的 `keychain-access-groups` 对齐(前置)。
- 公证配置:`mac.notarize`(EB 25 用 notarytool,设 teamId);worker .app 须 Developer ID 签 + `--options runtime` + secure timestamp(脚本已具备),公证 staple 打在外层产物、嵌套不单独 staple。
- base_dir 共用已定:固定路径 `~/Library/Application Support/ai.boundary.claw`(`run/agentworkerd/` 下放 control.sock + runtime.json),壳用 Node 算同一路径读取即可,worker 零改动。
- chat 等模块各自带一份 agentworkerd REST/WS 响应类型,与 agentworkerd 契约同步(模块级)。
