// Only this checkout's tests: a git worktree under .claude/worktrees/ holds a second copy of every test (#148).
// Many tests drive real git and real processes; a cold macOS runner has taken 5.5-6 s on single tests against
// vitest's 5 s default (#252, #261), so each test gets 30 s. A real hang still fails, just later.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], testTimeout: 30_000 },
});
