import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { safeStorage } from "electron";

/** 登录会话令牌(session_token, local_<uuid>)的本地落盘。可用时经 Electron safeStorage
 *  加密(macOS Keychain 等),否则明文兜底 —— worker 侧 local-session.json 本就明文存更敏感
 *  的 user/refresh 令牌,此处只是本地能力句柄。仅在 app ready 后调用(safeStorage 才可用)。
 *
 *  只存 token:用户身份每次从 /api/auth/profile 取,不缓存快照(免昵称等更新后陈旧)。 */
export class SessionStore {
  #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  load(): string | null {
    let raw: Buffer;
    try {
      raw = readFileSync(this.#path);
    } catch {
      return null; // 无文件 = 未登录
    }
    try {
      const token =
        raw.length > 0 && safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(raw)
          : raw.toString("utf8");
      return token.trim() || null;
    } catch {
      return null; // 密钥环更换/密文损坏:当未登录处理
    }
  }

  save(token: string): void {
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(token)
      : Buffer.from(token, "utf8");
    writeFileSync(this.#path, data);
  }

  clear(): void {
    try {
      rmSync(this.#path);
    } catch {
      // 无文件无所谓
    }
  }
}
