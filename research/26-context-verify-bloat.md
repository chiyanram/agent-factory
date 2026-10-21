# 26 — Re-learning the repo, self-verification, prompt bloat (2026-10-21)

For chiyanram/agent-factory#1. Read-only web research on three items the operator read.

## A · Re-learning the project every session

| claim | verified | source |
|---|---|---|
| Graphify = repo → queryable knowledge graph; skill, CLI, optional MCP; graph.json + GRAPH_REPORT.md | yes | github.com/Graphify-Labs/graphify |
| Graphify updates via git hook / --update on changed files; live sync is paid Cloud | yes | same |
| Graphify supports Java / TypeScript | NOT CONFIRMED ("~40 languages" via tree-sitter) | README |
| "Cut agent token spend by 80%" | Cloud marketing only; OSS benchmark measures recall (82.0% vs 70.8% grep/read), not tokens | README |
| Ladybug | embedded graph DB (ex-Kuzu), not an agent tool; no MCP | github.com/LadybugDB/ladybug |
| Serena | LSP over MCP, symbol-level lookup, Java + TS; no token numbers; app GPL-3 | github.com/oraios/serena |
| Aider repo-map | ranked symbol map, default 1k tokens; no savings figures | aider.chat/docs/repomap.html |
| Anthropic guidance | CLAUDE.md <200 lines; path-scoped rules and skills; imports "don't reduce its context cost"; skill body loads only when used | code.claude.com/docs/en/memory, /skills |

No independent measurement of tokens saved vs reading files for any code-graph tool. agent-platform already enables jdtls-lsp and typescript-lsp plugins (research/08 §4).

## B · create-verification-skill (tester-army/e2e)

Exists at skills/create-verification-skill/SKILL.md (Apache-2.0, pre-1.0). Interviews the repo, writes `.agents/skills/verify-<app>/SKILL.md` (launch, doctor, drive, evidence, bug bash, cleanup) and a features map, proves it with one test, outputs evidence under `.e2e/` (report.json, traces, screenshots). User-invoked only. Needs the `e2e` runtime. pstack lineage stated only in secondary sources. No measured outcome.

## C · Trimming Claude Code's system prompt

Verified in code.claude.com docs: a bare-name `permissions.deny` "removes the tool from Claude's context entirely"; scoped deny only blocks calls; `disableBundledSkills`, `disableWorkflows` exist; `skillOverrides` states on / name-only / user-invocable-only / off (plugin skills unaffected). Measure with `/context`; Pocock's logging proxy gist exists (article not found). Overhead ~33k tokens at start (third-party, version-specific). Risk: a removed tool cannot be called; hidden skills stop auto-triggering.

## A · Graphify deep read (source @ b90b9df, read only, nothing run)

| question | answer | evidence |
|---|---|---|
| code extraction | tree-sitter AST, local, no LLM | README.md:36; docs/how-it-works.md:10 |
| docs / .html / labelling | LLM pass; headless picks first API key in env (Gemini→Kimi→Claude→OpenAI…); with no key falls back to `claude -p`; `GRAPHIFY_BACKEND=none` + `--code-only` disable | detect.py:49; llm.py:3398-3442, 3788-3826 |
| Java / TS / Groovy+Spock / Gradle .kts | yes (no sealed/permits handling in Java) | extract.py:1411-1429, 2198-2213, 3123-3133, 3557 |
| SQL | optional [sql] extra | pyproject.toml:95 |
| Angular templates | no AST; .html goes to LLM pass | detect.py:49 |
| incremental | `graphify update .` changed files only, content hash | cli.py:2781-2822; cache.py:234-262 |
| git hooks | detached rebuild, 600 s timeout; **skip linked worktrees**; uncommitted edits invisible | hooks.py:397-413, 1094-1119 |
| agent footprint | skill.md ~12k tokens; always-on CLAUDE.md block ~300 tokens telling the agent to query before Read; PreToolUse guard on Read/Glob; MCP 10 tools ~2k tokens | always_on/claude-md.md:6; install.py:446-477; serve.py:2262-2382 |
| benchmarks | code: ERPNext (Python), n=6 questions, self-run, coverage 70.8% → 82.0%; no Java/TS; "71.5x" is a word-count estimate on one 52-file corpus; httpx ~1x; "80%" is Cloud | BENCHMARKS.md:33,52-56,145-150; benchmark.py:79-92 |
| network / licence | no telemetry; local query log; Apache-2.0 (older parts MIT) | README.md:421-422; NOTICE |

Risks for agent-platform: data leaving the machine via ambient API keys; stale graph (worktrees skipped, our work is all in worktrees); ~12k-token skill + Read hook + Python toolchain; evidence n=6 on Python.
Trial shape if wanted: code-only, no hooks or always-on rule; 15–20 real questions answered in fresh sessions with and without; record total tokens and correctness against a key-fact list written beforehand.
