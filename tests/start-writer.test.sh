#!/usr/bin/env bash
# scripts/start-writer.sh: a fresh writer per run, in its own worktree, never resumed (ADR-0001; #39).
. "$(dirname "$0")/lib.sh"
export FACTORY_PROJECT=aruvii/agent-platform FACTORY_SLEEP=true
mr() { printf '{"iid":12,"state":"opened","source_branch":"feat/x","sha":"%s","labels":%s}' "$1" "$2"; }

setup() {
  FACTORY_REPO=$(project_clone feat/x); export FACTORY_REPO
  head=$(cat "$(dirname "$FACTORY_REPO")/head")
  FACTORY_GLAB=$(glab_stub); export FACTORY_GLAB
  FACTORY_CLAUDE=$(claude_stub); export FACTORY_CLAUDE
  worktree="$FACTORY_REPO/.claude/worktrees/writer-12"
}
claude_calls() { cat "$(dirname "$FACTORY_CLAUDE")/calls.log" 2>/dev/null; }
bg_calls() { claude_calls | grep -v ' | agents '; }
tools_on() {  # tools_on BRANCH TEXT : commits docs/agents/commands.md with TEXT on BRANCH of the project
  (cd "$FACTORY_REPO" && git checkout -q "$1" && mkdir -p docs/agents && printf '%b' "$2" > docs/agents/commands.md \
    && git add -A && git -c user.name=t -c user.email=t@t commit -q -m tools \
    && git push -q "$(git config remote.origin.url)" "$1" 2> /dev/null \
    && git checkout -q main)
}
mr_to_main() { printf '{"iid":12,"state":"opened","source_branch":"feat/x","target_branch":"main","sha":"%s","labels":["agent::claimed"]}' "$1"; }

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_eq "a claimed MR starts a writer and says so in one line" \
  "writer started !12 at ${head:0:8}: started abc123" "$("$REPO_ROOT/scripts/start-writer.sh" 12)"
expect_pass "the writer runs in its own worktree" sh -c "bg_out=\$(cat '$(dirname "$FACTORY_CLAUDE")/calls.log' | grep -v ' | agents '); case \$bg_out in *'.claude/worktrees/writer-12 | '*) exit 0;; *) exit 1;; esac"
expect_eq "the worktree is at the MR's head" "$head" "$(git -C "$worktree" rev-parse HEAD)"
expect_eq "the worktree is on the MR's branch, so the writer can push it" "feat/x" "$(git -C "$worktree" rev-parse --abbrev-ref HEAD)"
expect_pass "it starts in the background under the run's name" sh -c "grep -q -- '--bg -n writer-12' '$(dirname "$FACTORY_CLAUDE")/calls.log'"
expect_fail "it never resumes or continues a session (ADR-0001)" "fresh" \
  sh -c "grep -Eq -- '--resume|--continue| -c ' '$(dirname "$FACTORY_CLAUDE")/calls.log' && exit 0; echo fresh; exit 1"
expect_pass "the prompt names the MR, its branch and /crq" \
  sh -c "grep -q '!12' '$(dirname "$FACTORY_CLAUDE")/calls.log' && grep -q 'feat/x' '$(dirname "$FACTORY_CLAUDE")/calls.log' && grep -q '/crq' '$(dirname "$FACTORY_CLAUDE")/calls.log'"
expect_pass "the prompt tells the writer to push, ask with ask.sh at its pushed head, and stop (ADR-0011 D10)" \
  sh -c "grep -q 'scripts/ask.sh 12 \"\$(git rev-parse HEAD)\"' '$(dirname "$FACTORY_CLAUDE")/calls.log' && grep -q 'never guess: push your commits' '$(dirname "$FACTORY_CLAUDE")/calls.log' && grep -q 'and stop' '$(dirname "$FACTORY_CLAUDE")/calls.log'"
expect_pass "a writer that cannot finish pushes its work and asks (ADR-0011 D14)" sh -c "grep -q 'cannot finish, push what you have' '$(dirname "$FACTORY_CLAUDE")/calls.log'"
expect_pass "the ask command carries its own forge and project settings" \
  sh -c "grep -q 'FACTORY_FORGE=gitlab FACTORY_PROJECT=' '$(dirname "$FACTORY_CLAUDE")/calls.log'"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '[]')"
expect_fail "an unclaimed MR is refused" "claim it first" "$REPO_ROOT/scripts/start-writer.sh" 12
expect_eq "a refused start makes no worktree" no "$([ -d "$worktree" ] && echo yes || echo no)"

setup
live "$FACTORY_CLAUDE" writer-12
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_fail "an MR with a live run is refused: one run per MR" "already has a live run" \
  "$REPO_ROOT/scripts/start-writer.sh" 12
expect_eq "the refusal starts nothing" "" "$(bg_calls)"

setup
live "$FACTORY_CLAUDE" writer-3 reviewer-4
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_fail "two live runs on this machine is the limit (playbook §Triggers)" "run limit" \
  "$REPO_ROOT/scripts/start-writer.sh" 12

setup
respond "$FACTORY_GLAB" 1 200 "$(mr 0123456789abcdef0123456789abcdef01234567 '["agent::claimed"]')"
expect_fail "a branch tip that differs from the MR's head is refused" "head" "$REPO_ROOT/scripts/start-writer.sh" 12
expect_eq "no worktree is left behind" no "$([ -d "$worktree" ] && echo yes || echo no)"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
echo 'Workspace not trusted. Run `claude` in /x once and accept the trust prompt, then retry.' \
  > "$(dirname "$FACTORY_CLAUDE")/bg.out"
echo 1 > "$(dirname "$FACTORY_CLAUDE")/bg.rc"
expect_fail "a run that fails to start says why" "not trusted" "$REPO_ROOT/scripts/start-writer.sh" 12
expect_eq "and its worktree is removed" no "$([ -d "$worktree" ] && echo yes || echo no)"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
mkdir -p "$worktree" && echo old > "$worktree/left-by-a-dead-run"
"$REPO_ROOT/scripts/start-writer.sh" 12 > /dev/null 2>&1
expect_eq "a worktree left by a dead run is replaced, never reused" no \
  "$([ -f "$worktree/left-by-a-dead-run" ] && echo yes || echo no)"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_eq "the -p fallback runs in the foreground and says so" "writer finished !12 at ${head:0:8}" \
  "$(FACTORY_RUN_MODE=print FACTORY_MAX_USD=5 "$REPO_ROOT/scripts/start-writer.sh" 12 2>/dev/null)"
expect_pass "FACTORY_MAX_USD caps the -p run's spend (ADR-0011 D14)" sh -c "grep -q -- '--max-budget-usd 5 ' '$(dirname "$FACTORY_CLAUDE")/calls.log'"
expect_pass "the fallback uses claude -p under the run's name" sh -c "grep -q -- ' -p -n writer-12 ' '$(dirname "$FACTORY_CLAUDE")/calls.log'"
expect_eq "the fallback removes its pid file when it exits" no "$([ -f "$FACTORY_REPO/.claude/runs/writer-12.pid" ] && echo yes || echo no)"
expect_pass "the fallback uses claude -p" sh -c "grep -q -- ' -p ' '$(dirname "$FACTORY_CLAUDE")/calls.log'"
expect_eq "the fallback removes its worktree when it exits" no "$([ -d "$worktree" ] && echo yes || echo no)"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
"$REPO_ROOT/scripts/start-writer.sh" 12 > /dev/null 2>&1
expect_eq "the writer's branch tracks origin, so git push and --force-with-lease work" "origin/feat/x" \
  "$(git -C "$worktree" rev-parse --abbrev-ref '@{u}' 2>&1)"

setup
mkdir -p "$FACTORY_REPO/.claude/runs" && echo $$ > "$FACTORY_REPO/.claude/runs/writer-12.pid"
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_fail "a live -p run (pid file) counts as a live run" "already has a live run" "$REPO_ROOT/scripts/start-writer.sh" 12

setup
echo 'Error: unknown option --json' > "$(dirname "$FACTORY_CLAUDE")/agents.json"
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_fail "unreadable claude agents output stops the start, never reads as no runs" "cannot list live runs" \
  "$REPO_ROOT/scripts/start-writer.sh" 12

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_pass "a relative FACTORY_REPO works" sh -c "cd '$(dirname "$FACTORY_REPO")' && FACTORY_REPO=clone '$REPO_ROOT/scripts/start-writer.sh' 12"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
FACTORY_WRITER_MODEL='opus[1m]' "$REPO_ROOT/scripts/start-writer.sh" 12 > /dev/null 2>&1
touch "$worktree/opus1"
expect_pass "the model name is passed as it is, never glob-expanded" \
  grep -qF -- '--model opus[1m]' "$(dirname "$FACTORY_CLAUDE")/calls.log"

expect_fail "FACTORY_REPO must be a git clone" "FACTORY_REPO" env FACTORY_REPO=/nonexistent "$REPO_ROOT/scripts/start-writer.sh" 12

# GitHub: the writer pushes, commits and calls gh only as the factory's App (ADR-0010)
setup
FACTORY_GH=$(glab_stub); export FACTORY_GH
gh_pr='{"number":12,"state":"open","merged":false,"head":{"sha":"'"$head"'","ref":"feat/x"},"base":{"ref":"main"},"labels":[{"name":"agent::claimed"}]}'
respond "$FACTORY_GH" 1 200 "$gh_pr"
writer() { env FACTORY_FORGE=github FACTORY_PROJECT=chiyanram/ledger "$REPO_ROOT/scripts/start-writer.sh" 12; }
helper="!$REPO_ROOT/scripts/github-app.sh git-credential"
expect_fail "a clone that pushes over ssh or a path is refused: git would ask no credential helper" \
  "does not push to https://github.com/" writer
git -C "$FACTORY_REPO" remote set-url --push origin https://github.com/chiyanram/ledger.git
git -C "$FACTORY_REPO" config credential.https://github.com.helper "$helper"
expect_fail "the App's helper with no empty reset before it is refused: a global helper would answer first" \
  "another credential helper answer before the App's" writer
git -C "$FACTORY_REPO" config --unset-all credential.https://github.com.helper
git -C "$FACTORY_REPO" config --add credential.https://github.com.helper ""
git -C "$FACTORY_REPO" config --add credential.https://github.com.helper "$helper"
expect_fail "a clone that would commit under a person's email is refused" "commit under a person's email" writer
expect_eq "and nothing started" "" "$(bg_calls)"
git -C "$FACTORY_REPO" config user.email '1+ledger-factory[bot]@users.noreply.github.com'
tools_on main 'lint-file: ./lint\n'
expect_eq "a clone set up as the App starts the writer" "writer started #12 at ${head:0:8}: started abc123" "$(writer)"
expect_eq "the writer's session has no gh login and no system or global git config" \
  "$FACTORY_REPO/.claude/runs/gh-no-login 1 /dev/null" \
  "$(jq -r '.env | "\(.GH_CONFIG_DIR) \(.GIT_CONFIG_NOSYSTEM) \(.GIT_CONFIG_GLOBAL)"' "$worktree/.claude/settings.local.json")"
expect_eq "and the lint hook sits beside those settings in the same file" "$REPO_ROOT/scripts/lint-edit.sh ./lint" \
  "$(jq -r '.hooks.PostToolUse[0].hooks[0].command' "$worktree/.claude/settings.local.json")"
expect_eq "so those settings are never committed" "" "$(git -C "$worktree" status --porcelain)"
expect_pass "the prompt sends every GitHub call through the App's gh" \
  grep -q "use $REPO_ROOT/scripts/bin/gh: it acts as the factory's GitHub App" "$(dirname "$FACTORY_CLAUDE")/calls.log"

expect_fail "a dry run never starts a writer, which would push (ADR-0011 D14)" "FACTORY_DRY_RUN is set" \
  env FACTORY_DRY_RUN=1 "$REPO_ROOT/scripts/start-writer.sh" 12

# --test-first: a bug's failing test comes from a separate run, before any fix (ADR-0011 D12; rulebook crq VB7)
setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
expect_eq "a test-first run starts and says so in one line" "test writer started !12 at ${head:0:8}: started abc123" \
  "$("$REPO_ROOT/scripts/start-writer.sh" --test-first 12)"
log="$(dirname "$FACTORY_CLAUDE")/calls.log"
expect_pass "it runs under the MR's one run name, so it counts as the MR's live run" grep -q -- '--bg -n writer-12 ' "$log"
expect_pass "its prompt asks only for the failing test, from the bug spec" \
  sh -c "grep -q 'Write only the test that reproduces the bug' '$log' && grep -q 'Change no production code' '$log'"
expect_pass "its stop condition: commit only the test, push it and stop, never fix and never mark ready" \
  sh -c "grep -q 'Commit only the test' '$log' && grep -q 'push it, and stop. Never fix the bug and never mark the MR ready' '$log'"
expect_pass "its commit says a separate run wrote it, so the reviewer can check VB7" \
  grep -q 'Written by a separate test-first run (VB7)' "$log"
expect_pass "with no testable inputs and result, it asks instead" grep -q 'scripts/ask.sh 12' "$log"
expect_fail "it is not the fix writer's prompt" "none" sh -c "grep -q 'Run /crq from the build phase' '$log' && exit 0; echo none; exit 1"
expect_fail "a flag after the MR is refused, never ignored" "usage" "$REPO_ROOT/scripts/start-writer.sh" 12 --test-first

setup
respond "$FACTORY_GLAB" 1 200 "$(mr "$head" '["agent::claimed"]')"
FACTORY_READY_COMMANDS='make npm' "$REPO_ROOT/scripts/start-writer.sh" 12 > /dev/null 2>&1
log="$(dirname "$FACTORY_CLAUDE")/calls.log"
expect_pass "the fix writer keeps a committed failing test as it is" grep -q 'make it pass without changing it' "$log"
expect_pass "the writer puts the evidence table in the description and learns which commands the ready check runs" \
  sh -c "grep -q 'Evidence at <your' '$log' && grep -q 'one of: make npm\.' '$log'"

# The project's writer tools from docs/agents/commands.md (ADR-0011 D17)
setup
tools_on main '# Commands\n\n```text\nlint-file: npx eslint --max-warnings 0\ntest-touched: `npm test -- --findRelatedTests`\r\n```\n'
respond "$FACTORY_GLAB" 1 200 "$(mr_to_main "$head")"
"$REPO_ROOT/scripts/start-writer.sh" 12 > /dev/null 2>&1
settings="$worktree/.claude/settings.local.json"
expect_eq "the writer's session lints each Edit, MultiEdit and Write with the project's lint" \
  "Edit|MultiEdit|Write $REPO_ROOT/scripts/lint-edit.sh npx\\ eslint\\ --max-warnings\\ 0" \
  "$(jq -r '.hooks.PostToolUse[0] | "\(.matcher) \(.hooks[0].command)"' "$settings")"
expect_eq "so the hook settings are never committed" "" "$(git -C "$worktree" status --porcelain)"
log="$(dirname "$FACTORY_CLAUDE")/calls.log"
expect_pass "the prompt names the lint and the quick touched-test command" \
  sh -c "grep -q 'linted at once with: npx eslint --max-warnings 0' '$log' && grep -q 'Run the tests you touched with: npm test -- --findRelatedTests' '$log'"

expect_pass "a CRLF line and backticks around a command are stripped" \
  sh -c "grep -q 'touched with: npm test -- --findRelatedTests\. Run' '$log'"

setup
tools_on feat/x 'lint-file: touch /tmp/pwned-by-the-mr\n'
head=$(git -C "$FACTORY_REPO" rev-parse origin/feat/x)
respond "$FACTORY_GLAB" 1 200 "$(mr_to_main "$head")"
"$REPO_ROOT/scripts/start-writer.sh" 12 > /dev/null 2>&1
expect_eq "the MR's own commands file is never read: a hook runs with no permission prompt" no \
  "$([ -e "$worktree/.claude/settings.local.json" ] && echo yes || echo no)"

setup
respond "$FACTORY_GLAB" 1 200 "$(mr_to_main "$head")"
"$REPO_ROOT/scripts/start-writer.sh" 12 > /dev/null 2>&1
expect_eq "with no commands file, no hook and no settings file" no "$([ -e "$worktree/.claude/settings.local.json" ] && echo yes || echo no)"
expect_fail "and no tool line in the prompt" "none" sh -c "grep -q 'linted at once' '$(dirname "$FACTORY_CLAUDE")/calls.log' && exit 0; echo none; exit 1"

finish
