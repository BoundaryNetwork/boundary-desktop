import { describe, expect, test } from "vitest";
import type { StorageBackend } from "../src/index.js";
import { ProfileRegistry } from "../src/index.js";

/** 测试用最小内存 backend(共享、不命名空间)。 */
function memBackend(): StorageBackend {
  const map = new Map<string, unknown>();
  return {
    async get(k) {
      return map.has(k) ? map.get(k) : null;
    },
    async set(k, v) {
      map.set(k, v);
    },
    async delete(k) {
      map.delete(k);
    },
    async keys() {
      return [...map.keys()];
    },
  };
}

describe("ProfileRegistry", () => {
  test("默认带 default 账号", async () => {
    const reg = new ProfileRegistry(memBackend());
    expect(await reg.list()).toEqual([{ id: "default", name: "默认" }]);
  });

  test("create 递增 id 并持久化;remove 删除;default 不可删", async () => {
    const backend = memBackend();
    const reg = new ProfileRegistry(backend);
    const a = await reg.create("店铺A");
    const b = await reg.create("店铺B");
    expect(a).toEqual({ id: "p1", name: "店铺A" });
    expect(b).toEqual({ id: "p2", name: "店铺B" });

    await reg.remove("p1");
    expect((await reg.list()).map((p) => p.id)).toEqual(["default", "p2"]);

    await expect(reg.remove("default")).rejects.toThrow();

    // 同一 backend 新建实例 → 从持久化恢复(含 seq,不复用已删 id)
    const reloaded = new ProfileRegistry(backend);
    expect((await reloaded.list()).map((p) => p.id)).toEqual(["default", "p2"]);
    const c = await reloaded.create("店铺C");
    expect(c.id).toBe("p3");
  });

  test("resolvePartition 按 profileId 给隔离分区", async () => {
    const reg = new ProfileRegistry(memBackend());
    expect(reg.resolvePartition(undefined)).toBe("persist:wv-default");
    expect(reg.resolvePartition("p1")).toBe("persist:wv-p1");
  });
});
