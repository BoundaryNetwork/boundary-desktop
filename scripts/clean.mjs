// 清构建产物:递归移除 dist / out / out-tsc / vendor 目录与 *.tsbuildinfo
// (即 .gitignore 里的生成物,node_modules 除外 —— 重装代价大,要清单独 rm)。
import { readdir, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repo = dirname(dirname(fileURLToPath(import.meta.url))); // 仓库根(scripts/ 的上级)
const DIRS = new Set(["dist", "out", "out-tsc", "vendor"]); // 按名移除(与 .gitignore 同口径)
const SKIP = new Set(["node_modules", ".git", ".worktrees"]); // 不进入
const removed = [];

async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP.has(e.name)) continue;
      if (DIRS.has(e.name)) {
        await rm(p, { recursive: true, force: true });
        removed.push(p);
        continue; // 整目录已删,不再深入
      }
      await walk(p);
    } else if (e.name.endsWith(".tsbuildinfo")) {
      await rm(p, { force: true });
      removed.push(p);
    }
  }
}

await walk(repo);
console.log(`[clean] 移除 ${removed.length} 项构建产物` +
  (removed.length ? ":\n  " + removed.map((p) => relative(repo, p)).join("\n  ") : ""));
