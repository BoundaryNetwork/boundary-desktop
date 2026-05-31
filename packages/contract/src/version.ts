/**
 * 基座实现的契约能力版本 —— 契约包唯一的运行期值。
 *
 * 契约包本体是纯类型,types-only 包在运行期为空。此常量是它在运行期的唯一出口:
 * 让 host 在模块生命周期的 Resolved 阶段拿到"我实现了哪个版本"作为 semver 比对基准,
 * 与 module manifest 的 `hostApiVersion`(range)比对,不满足则拒绝加载、提示升级客户端。
 *
 * 约定:与本包 package.json 的 `version` 同步演进(见 docs/架构设计.md 11.2)。
 */
export const HOST_API_VERSION = "0.2.0";
