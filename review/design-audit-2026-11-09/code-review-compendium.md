# Compendium · how companies and vendors do AI code review (#267, map #262)

Purpose: give the operator the parts of a review system, as building blocks, to design agent-factory's automated
review. This file extends `audit-review.md` (same folder). It does not repeat its verdicts D1–D9.
Retrieved 2026-11-09. Primary sources only: vendor docs, vendor source code, company papers and engineering posts.
A vendor doc is evidence of what the vendor does. It is not evidence of how well it works.

Marks used in cells:
- **—** the source says nothing on this part.
- **(nv)** not verified: I could not find it in the primary page.
- **no nums** the source publishes no number for this part.

## 1. Parts matrix

### 1a. Vendors

| part | Anthropic Code Review (+ `/code-review` plugin) | GitHub Copilot code review | GitLab Duo (Code Review Flow) | Cursor Bugbot | CodeRabbit | Graphite Agent | Qodo PR-Agent (open source) | Amp review | Amazon Q Dev (GitHub) |
|---|---|---|---|---|---|---|---|---|---|
| context read | diff + surrounding code; CLAUDE.md on changed paths; PR title + body (plugin) | whole repo (agentic, on Actions); MCP (GitHub, Playwright) | pre-scan: diffs, tests and deps it finds; MR title + body; own earlier threads | diff + agent tools; PR comments, to avoid repeats | linked issues (GitHub, GitLab, Jira, Linear); past PRs; web search; MCP | "entire codebase" | diff in chunks; ticket (Jira, GitHub/GitLab issue) | diff + agent tools (nv) | diff (nv); review "of the entire pull request's diff" |
| rules supplied | `CLAUDE.md` (per dir) + `REVIEW.md` (root + subdirs, `@`-includes, skill files) | `.github/copilot-instructions.md`, `*.instructions.md` with `applyTo`, `AGENTS.md`, also `CLAUDE.md`, `REVIEW.md` | `.gitlab/duo/mr-review-instructions.yaml`: name + `fileFilters` globs + text; group and instance templates | `.cursor/BUGBOT.md` (root + nested), team rules, learned rules | `path_instructions` (glob + text), ast-grep rules, auto-read `AGENTS.md`, `CLAUDE.md`, copilot file | custom prompts (Rule → bad → good → reasoning); file-based rules by glob | `extra_instructions`; `repo_context_files` (e.g. `AGENTS.md`, `best_practices.md`) | `.agents/checks/*.md`, scoped by folder | `.amazonq/rules/*.md` |
| rules from which branch | base or default branch, "never from the pull request's own changes" | **head branch** ("the branch with your changes") | exclusion file on default branch; instructions file (nv) | (nv) | (nv) | (nv) | (nv) | working tree (local CLI) | (nv) |
| rules add to or replace default | add: "alongside Code Review's default review guidance" | add (nv) | add: "appends … instead of replacing them" | add, ordered: team → project → learned → manual | add: "supplement … not a replacement" | add | add | add: one agent per check | add (nv) |
| find | several agents in parallel; plugin: 2 rule agents + 2 bug agents | "tuned mix of models"; Max = "multiple high-reasoning models" | multi-step agent; non-agentic tier is single pass | was 8 passes + majority vote; now "fully agentic" | (nv) | (nv) | per chunk, up to 3 suggestions each | **one agent per check** | (nv) |
| false-positive filter | verify step; plugin: one validator per finding (Opus for logic, Sonnet for rules) | — | — | validator model (blog, 2025) | — (docs) | — | self-reflection: re-score each suggestion 0–10, drop below threshold | — | — |
| severity / category | Important · Nit · Pre-existing; check run counts | none in docs | none in docs | API field `severity` (high, medium, may be null) | profile quiet / chill / assertive | 5 categories: logic, edge case, security, perf, accidental code | score 1–10; 8–10 = major bug or security; 0 = wrong | — | "high-severity findings" |
| post | inline comments + summary + neutral check run; one per unique issue | one "Comment" review; suggested changes | inline + summary; rule hits say "According to custom instructions in '…'" | CI check (neutral by default) + comments | review + walkthrough; pre-merge checks off/warning/error | inline comment: problem, why, fix | table + optional committable comments above a score | report (CLI) | summary + threaded findings + fixes |
| dedupe | after verify: "deduplicated and ranked" | — | does not repeat earlier points, even resolved | reads earlier comments to avoid repeats | (nv) | — | `max_suggestions_per_file` keeps top scores | — | — |
| re-review | interdiff; keeps earlier result if lines unchanged; resolves own threads; reads replies | once, unless push reviews on | follow-up on push; comments only on lines added since last; reads own threads + replies | every PR update | incremental on push (default on) | (nv) | persistent comment, history 4 | on demand | `/q review`, whole diff |
| learn from humans | no auto learning; "add a rule to `REVIEW.md`" | thumbs up / down | "Feedback … does not influence later reviews" | **learned rules** from reactions, replies, human comments; promote or disable | **learnings** from chat; scope repo/org; admin approval delay 0–30 days | "improves based on how your team interacts" (no method) | — (OSS) | — | — |
| measure | "auto-resolved because a developer addressed the issue" count | — | — | resolution rate: AI judge at merge time | — | acceptance rate, up/down vote rate | — | — | — |
| published numbers | no nums for precision | no nums | no nums | resolution 52% → 70% → 78%; bugs per run 0.4 → 0.7 | no nums | no nums | no nums | no nums | no nums |
| cost / latency | per token; spend cap; skips when budget < one review | ~$0.25 / $1.50 / $10 per review (Lite / Balanced / Max) | GitLab Credits, no rate given | usage based; no nums | plan based | PR > 200,000 chars not reviewed | 3 calls max, 32k tokens per chunk | — | lines per month cap |
| does NOT | approve, block, fail the check, run code | approve (default); count to required approvals (default) | approve by default; beta flag can approve / request changes | block (neutral check, unless configured) | — (it can auto-approve if enabled) | — | approve (merge recommendation is "not a guarantee") | — | — |

### 1b. In-house systems at large companies

| part | Google AutoCommenter | Meta RADAR (+ DRS) | Microsoft PR assistant | ByteDance BitsAI-CR | Uber uReview | Atlassian RovoDev Code Reviewer |
|---|---|---|---|---|---|---|
| context read | one file, task prompt; drops comments on unchanged lines | diff + risk signals + metadata | diff (nv more) | diff hunks widened to function bounds (tree-sitter) | diff + nearby functions + imports; drops config, generated | diff + PR title + body + **Jira issue** + guidelines |
| rules supplied | learned from human comments that cite a best-practice URL | safe and risk signal lists; denylists | "repository specific guidelines", custom prompts | 219 rules in a 3-tier taxonomy, 4 dimensions | shared best-practice registry | review guidelines in the prompt |
| find | T5 model, outputs location + URL | one review agent (ACR, then DCR) | (nv) | RuleChecker (fine-tuned LLM) | 3 assistants: Standard, Best Practices, AppSec | zero-shot Claude 3.5 Sonnet |
| false-positive filter | per-URL confidence threshold | confidence ≥ 8/10, any risk signal disqualifies | (nv) | ReviewFilter: yes/no, conclusion first | grader prompt scores each comment; o4-mini-high | LLM judge (gpt-4o-mini) + ModernBERT actionability classifier |
| severity / category | per best-practice URL | risk score percentile | category tag (e.g. null check, sensitive data) | taxonomy category | category classifier after generation | — |
| post | comment with distinct colour, after each update | approve or not; bot diffs land after a delay | inline comment; author clicks "apply change" | comment | comment on each commit in CI | ~2.1 comments per PR |
| dedupe | — | — | — | cosine similarity, keep one per group | semantic similarity merge | — |
| learn from humans | thumbs up / down, "Please fix"; suppress low-value URLs | thresholds per org | direct team feedback | likes / dislikes (sparse); daily hand labels ≤10% | Useful / Not useful per comment → thresholds per category | classifier trained on 5 months of resolved comments |
| measure | useful ratio; resolution | revert rate; incident rate | PR completion time | precision; **Outdated Rate** | useful rate; addressed rate; golden-set P/R/F1 | **code resolution rate** |
| published numbers | useful 54% → >80% after suppression; resolution ~40% | reverts 1/3, incidents 1/50 of non-RADAR diffs; ACR precision not given | >90% of PRs, 600K PRs/month; 10–20% faster completion (no method) | precision 75.0% (other sections 57–77%); Outdated 26.7% vs human 35–46% | useful 75%; addressed 65% vs human 51% | resolved 38.70% vs human 44.45% |
| cost / latency | beam search 2 s median | — | — | filter 1.7 s per sample | median 4 min per commit; cost "an order of magnitude less" than vendors | not reported |
| does NOT | chase recall; auto-fix | review high-risk, SOX, open-source code | commit fixes itself | cross-file review | design review ("only sees code") | decide; humans make final decisions |

## 2. Consensus (parts that 3 or more independent sources share)

| # | part | sources that agree | counter-examples |
|---|---|---|---|
| C1 | **Generate, then filter with a separate step** before posting. | Anthropic CR + plugin, Qodo self-reflection, BitsAI-CR, Uber grader, RovoDev judge + classifier, Meta ACR threshold | Bugbot dropped voting for an agent; filter not named in docs |
| C2 | **Precision over recall.** Post few comments. Say so in the prompt. | plugin ("If you are not certain … do not flag"), AutoCommenter, BitsAI-CR, Uber, Anthropic CR default ("not formatting preferences") | Bugbot made prompts *more* aggressive and raised bugs per run |
| C3 | **Suppress low-value classes**: style, nits, docstrings, what a linter or CI already checks. | plugin false-positive list, `REVIEW.md` example, Qodo score 0 list, Uber suppressed categories, AutoCommenter suppressed URLs | — |
| C4 | **Threshold per class, tuned from human feedback**, not one global cut. | AutoCommenter per URL, Uber per assistant/language/category, Qodo score threshold, Meta ≥ 8/10, BitsAI-CR removes rules by Outdated Rate + precision | — |
| C5 | **Rules are repo files, scoped by folder or glob.** | Anthropic (per-dir `CLAUDE.md`, `REVIEW.md`), Copilot `applyTo`, GitLab `fileFilters`, CodeRabbit `path_instructions`, Bugbot nested files, Amp per-folder checks, Amazon Q `.amazonq/rules` | — |
| C6 | **Project rules add to a built-in default.** They do not replace it. | Anthropic ("alongside … default review guidance"), GitLab ("appends … instead of replacing"), CodeRabbit ("not a replacement"), Bugbot (ordered layers) | — |
| C7 | **A posted comment names its rule.** | GitLab ("According to custom instructions in …"), plugin ("cite and link each issue"), AutoCommenter (URL of the best practice) | — |
| C8 | **The intent is in the context**: PR body, linked ticket. | plugin (PR title + body), GitLab (MR title + body), CodeRabbit (linked issues), Qodo (ticket compliance), RovoDev (Jira) | Uber cannot review design: "only sees code" |
| C9 | **Dedupe by meaning, after the filter.** | Anthropic CR (after verify), BitsAI-CR (cosine), Uber (semantic similarity), plugin ("ONE comment per unique issue") | — |
| C10 | **Re-review is incremental and does not repeat itself.** It reads its own earlier threads. | Anthropic CR (interdiff, reads replies, resolves own threads), GitLab (own threads + replies, no repeat), Bugbot (reads PR comments), CodeRabbit (incremental) | Copilot "may repeat comments you've already dismissed" |
| C11 | **Depth is a setting** per repo or per change. | Anthropic Quick/Standard/Deep, Copilot Lite/Balanced/Max, Bugbot effort levels, Meta DRS | — |
| C12 | **Skip big or generated input**; say so. | Bugbot size limit + `linguist-generated`, Graphite 200,000 chars, GitLab 10,000-line files diff only, CodeRabbit default path filters, Copilot skips lock files, Uber drops generated | — |
| C13 | **Main metric = the comment was acted on** (a later code change at that place). | Bugbot resolution rate, BitsAI-CR Outdated Rate, Uber addressed rate, RovoDev code resolution, AutoCommenter resolution, Anthropic "auto-resolved" count | Microsoft reports completion time only |
| C14 | **Thumbs or useful votes are collected, but are secondary** (sparse). | Copilot thumbs, AutoCommenter, BitsAI-CR ("sparse"), Uber Useful/Not useful, Graphite up/down | — |
| C15 | **Human comment = upper bar.** AI acted-on rate is close to, not above, the human rate. | RovoDev 38.7% vs 44.5%, BitsAI-CR 26.7% vs 35–46% | Uber 65% vs 51% (AI above human) |
| C16 | **The AI does not approve or block by default. The human merges.** | Anthropic CR, Copilot default, Bugbot neutral check, GitLab default, RovoDev, Microsoft (does not commit) | Opt-in approvals: Copilot, GitLab beta, CodeRabbit; Meta RADAR approves low-risk diffs with no human |

Parts with **no consensus** (fewer than 3 sources, or sources disagree):
- Learning rules from reactions automatically: Bugbot and CodeRabbit do it. GitLab says it does not. Anthropic asks a human
  to edit `REVIEW.md`. CodeRabbit puts a learning on hold for admin approval.
- Copies + vote: Bugbot used it, then moved to one agent. SWR-Bench gains from it (audit D1).
- Running code to prove a finding: only Anthropic Ultrareview (audit D6). Anthropic CR, Uber and the others only read.
- Which branch the rules come from: Anthropic reads base/default; Copilot reads head. Others do not say.

## 3. Our design vs consensus

Today = `main` `6137393`. Target = ADR-0004 as amended + DESIGN §3, §5, §6 + ADR-0015.

| # | part | agent-factory today | target | gap |
|---|---|---|---|---|
| C1 | generate, then filter | find → verify, two fresh passes (`review/round.ts`) | finder per lens → one verify pass | none |
| C2 | precision first | find prompt bans "I would have done it differently"; no "if unsure, do not report" line | same | **small**: add an "if not certain, do not report" line to `prompts/review-find.md` |
| C3 | suppress low-value classes | `nit` severity; 5-nit cap in rubric (ADR-0015 R2 amendment); R5 moves MUSTs to code checks | same | **medium**: no "do not report what lint/CI checks" list; no skip of generated or lock files |
| C4 | threshold per class from feedback | none; buckets only | lens retire after 20 PRs (audit D9 says change) | **large**: no per-category or per-rule suppression driven by acted-on data |
| C5 | rules as scoped repo files | rules on touched paths, from default branch (`review/rules.ts`, `pack.ts`) | plugins + repo files, pinned | none (ahead: pinned + default branch) |
| C6 | rules add to a default | role cards **replace** the engine's find/verify text; only the safety floor stays (ADR-0004 amend, #302) | same | **medium**: a card can drop default review checks (not only safety). Industry keeps the default and appends |
| C7 | comment names its rule | finding has `rule` id; thread post shows it (`threadPost`) | + rule source per plugin (DESIGN §5 Order) | none |
| C8 | intent in context | approved spec + design in pack; MR body is data only | same | none (ahead: approved spec, not PR body) |
| C9 | dedupe by meaning, after filter | none | exact `file:line` + rule, before verify (#237) | **medium**: audit D3 already proposes verify-side merge |
| C10 | incremental, no repeats, reads own threads | patch-id reuse; interdiff; reads only its own summary notes (`review/history.ts`); does not read human replies; does not resolve its own threads | same | **large**: a later round can post a finding again that the human answered or dismissed |
| C11 | depth is a setting | one pass for all | lenses by lane / blast radius | none |
| C12 | skip big or generated input | no size cap; no generated-file skip in pack | — | **medium**: no limit, no "skipped" note |
| C13 | acted-on metric | none recorded | ADR-0015 R4 acted-on rate; golden-set recall (offline) | **large**: R4 not built; no online metric yet; offline recall only |
| C14 | thumbs as a second signal | none | none | small: GitLab award emoji could be read through the Forge seam |
| C15 | human bar | none | none | small: record the human comment acted-on rate as the baseline |
| C16 | no approve, no block | never approves (floor); act_on loops to implementer; human merges | same | none (stricter than the opt-in vendors) |

GitLab note: the operator's projects run on GitLab. GitLab Duo's flow reads its own earlier threads and replies, does not
repeat itself, does not resolve its threads, and does not learn across MRs. Anthropic's managed Code Review is GitHub only;
on GitLab, Anthropic offers only Claude Code in CI/CD (beta, maintained by GitLab), with no review pipeline of its own.

## 4. Sources

Each section: URL, then what it adds that the audit does not have. Quotes are exact.

### Anthropic Claude Code Review
https://code.claude.com/docs/en/code-review · /code-review-customize · /code-review-pull-requests · /code-review-costs
- "Find … Verify … Rank: the findings that remain are deduplicated and ranked by severity … Post".
- Rules add to a default: `REVIEW.md` is given "as your repository's review instructions, alongside Code Review's default
  review guidance."
- Branch: "from the pull request's base branch or from the default branch, never from the pull request's own changes."
- Re-review: "The next review of the pull request reads the replies on its earlier findings, and can resolve the thread or
  post one follow-up reply."
- Metric: analytics "Feedback: Count of review comments that were auto-resolved because a developer addressed the issue."
- No cost per review is published. "Code Review skips reviews once what's left is less than the expected cost of one review."

### Anthropic `/code-review` plugin (source)
https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-review/commands/code-review.md
- "If you are not certain an issue is real, do not flag it. False positives erode trust and waste reviewer time."
- False-positive list: "Issues that a linter will catch (do not run the linter to verify)"; "Pre-existing issues".
- The bug agents get "the PR title and description … regarding the author's intent."

### Anthropic Claude Code in GitLab CI/CD
https://code.claude.com/docs/en/gitlab-ci-cd
- "Claude Code for GitLab CI/CD is currently in beta … This integration is maintained by GitLab."
- No review pipeline. The example review prompt is one `claude -p` call with `--permission-mode acceptEdits`.

### GitHub Copilot code review
https://docs.github.com/en/copilot/concepts/agents/code-review · /how-tos/use-copilot-agents/request-a-code-review/use-code-review · /tutorials/customize-code-review
- "By default, Copilot leaves a "Comment" review, not an "Approve" review or a "Request changes" review."
- Rules come "from the head branch (the branch with your changes), not the base branch." (A PR can change its own rules.)
- "Copilot may repeat comments you've already dismissed or downvoted" (paraphrase by the fetch tool; nv exact words).
- Advice: "around 10 to 20" instructions to start; "about 1,000 lines" per file. The 4,000-character limit appears in
  search results for the English page, but I could not see it in the page text: (nv).
- Cost estimates: about $0.25, $1.50 and $10 per review for Lite, Balanced and Max. No precision numbers.

### GitLab Duo Code Review / Code Review Flow
https://docs.gitlab.com/user/duo_agent_platform/flows/foundational_flows/code_review/ · https://docs.gitlab.com/user/duo_agent_platform/customize/review_instructions/ · https://docs.gitlab.com/user/project/merge_requests/duo_in_merge_requests/
- "GitLab Duo appends your custom review instructions to its standard review criteria, instead of replacing them."
- Comment format: "According to custom instructions in '[instruction_name]': [feedback comments]".
- Follow-ups read its own threads and replies; it does not repeat earlier points; "GitLab Duo does not reply to or resolve
  its earlier threads."
- "Feedback provided to GitLab Duo does not influence later reviews of other merge requests."
- Beta `duo_code_review_decisions`: approves with no findings; "An approval from GitLab Duo does not count toward required
  approvals."
- Runs as a CI/CD job on a runner tagged `gitlab--duo`. The flow "does not reference `AGENTS.md` and `SKILL.md` files."
- No precision, cost or latency numbers.

### Cursor Bugbot
https://cursor.com/docs/bugbot · https://cursor.com/blog/building-bugbot · https://cursor.com/changelog/04-08-26
- Learned rules: "It looks at reactions and replies to Bugbot comments and comments from human reviewers to create candidate
  rules." "Bugbot automatically promotes the ones that accumulate signal and disables the ones that stop being useful."
- Metric: "It uses AI to determine, at PR merge time, which bugs were actually resolved by the author in the final code."
- Update to audit D1: "We saw the largest gains when, this fall, we switched Bugbot to a fully agentic design." Voting was
  the earlier design.
- Rules cap: 30,000 characters per rule, 100,000 combined. Findings are a `neutral` check by default.

### CodeRabbit
https://docs.coderabbit.ai/guides/review-instructions · /guides/learnings · /integrations/knowledge-base · /reference/configuration
- Path instructions are a supplement to built-in review logic, "not a replacement."
- Learnings: "CodeRabbit considers your reply, and decides to make a learning out of it." An optional `approval_delay`
  (0–30 days) holds a learning until an admin approves it.
- Reads linked issues "to understand the intent behind a pull request and validate that the changes address them."
- `reviews.tools` runs linters (eslint, shellcheck, semgrep, gitleaks …) as review input. No numbers.

### Graphite Agent (Diamond)
https://graphite.com/docs/ai-reviews · /ai-review-customization · /ai-review-comments
- Rule form: "Rule → Bad example → Good example → Reasoning", with "2-3 clear, contrasting examples."
- Categories: logic bugs, edge cases, security, performance, accidentally committed code.
- "The PR won't be analyzed (e.g., if the PR exceeds 200,000 characters)". No acceptance numbers.

### Qodo PR-Agent (open source)
https://github.com/qodo-ai/pr-agent (`docs/docs/tools/improve.mdx`, `review.md`, `pr_agent/settings/configuration.toml`, `code_suggestions/pr_code_suggestions_reflect_prompts.toml`)
- Self-reflection rubric: "Give 0 if the suggestion is wrong." "Reserve high scores (8-10) for suggestions addressing
  critical issues such as major bugs or security concerns."
- Config: `suggestions_score_threshold=1`; `score_on_reflection_failure=7 # … set below suggestions_score_threshold to drop
  unvetted suggestions`.
- Merge recommendation "reports the model's findings, not a guarantee about the code."
- Field study on PR-Agent (arXiv 2412.18531, company not named on the abstract page): "73.8% of automated comments were
  resolved"; PR closure time rose "from five hours 52 minutes to eight hours 20 minutes."

### Amp review
https://ampcode.com/news/liberating-code-review
- "The code_review tool will kick off a separate agent for each check. This provides a stronger guarantee that each check
  will actually be checked than if the checks were embedded in a general context file like AGENTS.md."
- No severity, filter or numbers.

### Amazon Q Developer for GitHub / CodeGuru Reviewer
https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/github-code-reviews.html · https://docs.aws.amazon.com/codeguru/latest/reviewer-ug/welcome.html
- End of life: "On January 30, 2027, AWS will discontinue support for the Amazon Q Developer for GitHub App." CodeGuru:
  "As of November 7, 2025, you can't create new repository associations."
- Rules: "custom coding standards in simple Markdown files in the `project-root/.amazonq/rules` directory."
- "Automatic code reviews are not triggered by subsequent commits." No numbers.

### Google AutoCommenter
https://arxiv.org/html/2405.13565 (Google comment resolution: see audit)
- Threshold per rule: "per-URL thresholds computed based on the intrinsic evaluation on the validation dataset." A global
  t = 0.98 was too strict.
- Feedback: thumbs up / down for authors; reviewers also "Please fix". "While recall was not the primary focus."
- Resolution "about 40%", estimated from 6,000 snapshot pairs. No 2025–2026 Google review paper found (search only).

### Meta RADAR (+ Diff Risk Score)
https://arxiv.org/html/2605.30208
- "For a diff to be auto-accepted, ACR requires a confidence score of at least 8 out of 10." "If any risk signal is
  detected, the diff is automatically disqualified from auto-acceptance."
- "Diffs that pass receive RADAR Approval, meaning no human review is required." Excludes "open-source code, SOX-scoped
  code, or code requiring additional reviews."
- Reverts 1/3 and incidents 1/50 of non-RADAR diffs (selection effect: only low-risk diffs qualify). ACR precision not
  reported. This is the one large source where the AI approves.

### Microsoft internal PR assistant
https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/
- "When AI suggests code changes, it does not commit them directly." Teams "provide repository specific guidelines".
- ">90% of PRs", "more than 600K pull requests per month", "10 – 20% median PR completion time improvements" (no method).
- No Microsoft Research paper on this system found: (nv).

### ByteDance BitsAI-CR
https://arxiv.org/html/2501.15134
- ReviewFilter: "We finally chose the Conclusion-First pattern" (77.09% precision, 1.7 s per sample vs 31.0 s
  reasoning-first).
- Likes and dislikes are "the most direct feedback" but sparse; daily hand labels; "sampling generally does not exceed 10%."
- Outdated Rate peak 26.7% (Go) vs human 35–46%. Precision figures in the paper do not agree (57–77%).

### Uber uReview
https://www.uber.com/blog/ureview/
- Pipeline: generation (3 assistants) → grading prompt with a confidence score → semantic dedupe → category classifier.
- Thresholds per assistant, language and category, "based on developer feedback and evaluations."
- Suppressed: "Readability nits, minor logging tweaks, low-impact performance optimizations, and stylistic issues."
- 75% useful; 65% addressed vs 51% for human comments; median 4 min per commit. Golden-set precision is measured but not
  published.

### Atlassian RovoDev Code Reviewer
https://arxiv.org/html/2601.01129v2
- Context includes "Jira Issue Summary and Descriptions". Filters: an LLM judge (binary) and a ModernBERT classifier
  trained on comments that did or did not lead to a code change.
- "RovoDev Code Reviewer achieves a code resolution rate of 38.70%" vs 44.45% for human comments.
- The factual-correctness judge "had minimal measured impact", the actionability classifier helped (paraphrase; nv exact).

### Not found or not usable
- Sourcegraph Cody review: no current doc found; Amp left Sourcegraph (secondary source, nv).
- Google Critique AI features after 2024: no primary paper found.
- Atlassian arXiv 2510.05450 ("60-70% … unresolved"): seen in search results only, not read: (nv).
