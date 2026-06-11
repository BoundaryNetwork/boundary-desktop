import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom", // markdown 用例需 DOMPurify(依赖 window);其余纯逻辑用例一并跑无妨
    include: ["src/**/*.test.ts"],
  },
});
