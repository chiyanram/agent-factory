// Only this checkout's tests: a git worktree under .claude/worktrees/ holds a second copy of every test (#148).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
