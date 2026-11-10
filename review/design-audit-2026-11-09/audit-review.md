# Audit 5 · review (#267, map #262)

Question (#267): does the target automated review hold up against industry AI code review practice?
Target = ADR-0004 as amended by DESIGN §3, §5, §6, §7, GLOSSARY, and task #237 (lenses picked by blast radius,
merged, one verify pass). Baseline = chiyanram/skills#210 (2026-11-06). This file extends it. It does not redo it.
Retrieved 2026-11-09. Primary sources only. A vendor page counts as primary for what the vendor does, not for how well
it works.

## Verdict table

| # | decision (target design) | verdict | one-line reason | differs from skills#210 |
|---|---|---|---|---|
| D1 | One finder run per lens (#237) | **refine** | Lenses match industry. But two vendors and one benchmark gain from repeated runs of the *same* lens with a vote. ADR-0004 rejected copies as "no measured gain". Let the ADR-0015 eval decide k per lens. | yes (#210 R4: "independence from fresh context + different inputs, not copies") |
| D2 | Lenses picked by blast radius: tiny 1, bug/feature ~3, one-way door all (#237) | keep | Claude Code Review sets depth per repo (Quick/Standard/Deep). Meta scores diff risk to change how a diff is handled. | no |
| D3 | Merge: same `file:line` + same rule = one finding (#237) | **change** | Every product dedupes by *same issue*, not by an exact key. Two lenses cite different rules for one bug. Dedupe after verify, by location window + same underlying issue. | yes (#210 has no merge rule) |
| D4 | One shared verify pass that tries to refute each finding | keep | Find → verify is in every product source and in BitsAI-CR. Self-correction without outside evidence fails. | no (#210 RV1) |
| D5 | Buckets act_on / consider / noted / dismissed | **refine** | Keep the buckets. Drop the second scale: DESIGN §5 still has finder `severity`, but ADR-0015 R2 drops it. One scale, set by verify. | no (#210 R4 same buckets) |
| D6 | Evidence grade `cited` / `walked` / `ran` | **refine** | Industry ties the grade to what may be posted. Set a floor per bucket (a logic act_on needs `walked` or `ran`). Verify sets the grade, not the finder. `ran` needs a box. | yes (#210 asks for evidence, has no grade) |
| D7 | 3 rounds max, then the human | keep (small refine) | Products bound re-review and review only the interdiff. No source gives a number. Add: the same finding back after a fix stops the loop early. | no (#210: 3 cycles AO/SK) |
| D8 | Zero findings is not a pass; the AI never approves | keep | Claude Code Review and Copilot both say so in their docs. | no |
| D9 | Lens retired after 20 PRs with no unique verified finding | **change** | Industry retires by *adoption* and *precision*, not silence. Count acted-on findings (ADR-0015 R4), add a precision floor, and never retire a lens on silence alone while it still catches its golden-set seeds. | partly (#210 RV5 logs the human's action; it does not tie retirement to it) |

## D1 · One finder run per lens

**Target.** One fresh finder per lens, in parallel. Each sees only its rubric, the baseline checks, the spec and
design, and the code (#237 step 3).

**Industry.**
- Anthropic's official `/code-review` plugin splits by lens *and* runs two copies of each lens: "Agents 1 + 2:
  CLAUDE.md compliance sonnet agents" and "Agent 3: Opus bug agent … Agent 4: Opus bug agent"
  (https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-review/commands/code-review.md).
- Anthropic's `pr-review-toolkit` ships "6 expert review agents that each focus on a specific aspect of code quality"
  (https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/README.md).
- Cursor Bugbot used copies of one prompt, not lenses: "Run eight parallel passes with randomized diff order" and
  "Majority voting to filter out bugs found during only one pass" (https://cursor.com/blog/building-bugbot).
- SWR-Bench (1000 PRs): aggregating several runs raises F1 "by up to 43.67%". The runs are one LLM run repeatedly
  (Self-Agg) or several LLMs (Multi-Agg), not specialised roles. Its two-agent CR-Agent showed "employing multi-agent
  systems for code review tasks is highly challenging" (https://arxiv.org/html/2509.01494v1).
- Li et al.: "the performance of large language models (LLMs) scales with the number of agents instantiated" by
  sampling and voting (https://arxiv.org/abs/2402.05120).

**Verdict: refine.** Lenses are sound: they give each run a short rubric, and Anthropic does it. But ADR-0004 rejected
copies as "no measured gain; more tokens". Bugbot and SWR-Bench now show a gain from copies plus a vote or merge.
Proposal: keep one run per lens by default. Let the ADR-0015 golden set test k = 2 for the correctness lens, kept only
if recall in act_on rises at the clean floor of 0. The cost cap applies.

## D2 · Lenses picked by blast radius

**Industry.**
- Claude Code Review: "An Owner chooses one level for the organization and can give an individual repository its own,
  such as Quick for a routine codebase and Deep for a critical one" (https://code.claude.com/docs/en/code-review).
- Ultrareview is the deep tier: "a larger fleet of reviewer agents explores the change in parallel", "Best for
  pre-merge confidence on substantial changes" (https://code.claude.com/docs/en/ultrareview).
- Meta's Diff Risk Score predicts "the likelihood of a code change causing a production incident" and lets teams land
  "lower-risk changes during these periods" (https://engineering.fb.com/2025/08/06/developer-tools/diff-risk-score-drs-ai-risk-aware-software-development-meta/).

**Verdict: keep.** Our choice is per diff (lane, paths, size). That is finer than Anthropic's per repo, and code picks
it, not a model. Note: Meta uses a trained model for risk. Ours is a rule. A rule is the right start.

## D3 · Merge by exact `file:line` + rule

**Target.** "the same `file:line` with the same rule counts as one finding" (#237 step 4), in code, before verify.

**Industry.**
- Claude Code Review: "the findings that remain are deduplicated and ranked by severity". Dedupe comes after verify
  (https://code.claude.com/docs/en/code-review).
- BitsAI-CR "employs cosine similarity to determine whether comments are similar" and "randomly retains one comment
  from each similar group" (https://arxiv.org/html/2501.15134).
- Anthropic plugin: "Only post ONE comment per unique issue. Do not post duplicate comments" (plugin URL above).

**Verdict: change.** An exact key misses the common case: two lenses flag one bug, one line apart, under two rule ids
(for example `correctness` and a test-integrity rule). The human then gets two threads for one problem. Proposal:
1. Keep the exact-key merge in code as a cheap first step.
2. Give verify one more job: mark findings that are the same underlying issue within a few lines, and keep one.
   ADR-0015 E4 already uses this test ("same underlying issue", line ±5) for the eval.
3. Record every merged lens on the kept finding, so D9 still counts each lens.

## D4 · One shared verify pass

**Industry.**
- Claude Code Review: "Verify: a verification step checks the candidate findings against the code and filters out
  false positives" (https://code.claude.com/docs/en/code-review).
- BitsAI-CR: "a two-stage approach combining RuleChecker for initial issue detection and ReviewFilter for precision
  verification", "75.0% precision" (https://arxiv.org/abs/2501.15134).
- Anthropic plugin step 5: "launch parallel subagents to validate the issue … Use Opus subagents for bugs and logic
  issues, and sonnet agents for CLAUDE.md violations" (plugin URL above).
- Bugbot: "Run results through a validator model to catch false positives" (https://cursor.com/blog/building-bugbot).
- Huang et al.: models "struggle to self-correct their responses without external feedback"; "performance even
  degrades after self-correction" (https://arxiv.org/abs/2310.01798). So the verifier must re-open the code, not
  re-read the claim. Our verify prompt does this.
- Zheng et al.: LLM judges show "position, verbosity, and self-enhancement biases" (https://arxiv.org/abs/2306.05685).

**Verdict: keep.** Shared versus per-finding verify: Anthropic's plugin uses one verifier per finding. One shared run
is cheaper and is what ADR-0004 decided. Watch for one thing in the eval: with many findings, the order in the list
may bias the verdicts (position bias). If the golden set shows it, split verify into batches. No change now.

## D5 · Buckets act_on / consider / noted / dismissed

**Industry.**
- Claude Code Review uses three levels: "Important · A bug that should be fixed before merging", "Nit · A minor
  issue, worth fixing but not blocking", "Pre-existing · A bug that exists in the codebase but wasn't introduced by
  this PR" (https://code.claude.com/docs/en/code-review-pull-requests).
- Anthropic security review keeps a finding by a filter decision and a confidence: `keep_finding`,
  `confidence_score` (https://github.com/anthropics/claude-code-security-review/blob/main/claudecode/findings_filter.py).
- Google AutoCommenter picked "very high precision" and suppressed "correct but low-value comments" that "may provide
  net negative value" (https://arxiv.org/html/2405.13565).

**Map.** act_on = Important. noted = Nit and Pre-existing. dismissed = dropped by verify. consider has no product
twin; it is the human judgment call, and it is fine.

**Verdict: refine.** The buckets hold. But the target has two scales on one finding: the finder's `severity`
(blocker, warning, nit; DESIGN §5 finding row) and verify's bucket. ADR-0015 R2 says "Drop the unused severity". DESIGN
§5 still lists it. Proposal: drop `severity` from the finding row, keep `category`. The bucket is the only scale, and
verify sets it. Fix DESIGN §5 to match ADR-0015.

## D6 · Evidence grade cited / walked / ran

**Industry.**
- Claude Code Review REVIEW.md guidance: "behavior claims need a `file:line` citation in the source, not an inference
  from naming" (https://code.claude.com/docs/en/code-review-customize).
- Anthropic security review grades confidence by evidence: "0.9-1.0: Certain exploit path identified, tested if
  possible"; "0.7-0.8: Suspicious pattern requiring specific conditions to exploit"
  (https://github.com/anthropics/claude-code-security-review/blob/main/claudecode/prompts.py).
- Ultrareview: "every reported finding is independently reproduced and verified" in "a cloud sandbox"
  (https://code.claude.com/docs/en/ultrareview).
- Claude Code Review (the cheaper tier) works "without building or running your code"
  (https://code.claude.com/docs/en/code-review).
- OpenAI CriticGPT: critics have "hallucinated bugs"; human + critic teams hallucinate "less than LLMs alone"
  (https://arxiv.org/abs/2407.00215).

**Verdict: refine.** The three grades match the industry ladder (cite → trace → reproduce). Three gaps:
1. **A floor per bucket.** A logic finding goes to act_on only at `walked` or `ran`. A rule finding may be `cited`.
   Without a floor, the grade is a label nobody acts on.
2. **Who grades.** The finder claims a grade. Verify confirms or lowers it. The author never grades its own
   finding (ADR-0004, "the author never judges its own findings").
3. **`ran` needs a box.** The reviewer runs on the host, read-only (`review/model.ts`, ADR-0012 S5 not yet built).
   Until the reviewer runs in a box, `ran` cannot occur. Say so with **Today:**, or let `ran` mean "the ready check's
   evidence row covers it".

## D7 · 3 rounds max

**Industry.**
- Claude Code Review: a later review "focuses on what changed since the last review"; a push can be answered with
  "Code review not repeated — earlier findings still open" (https://code.claude.com/docs/en/code-review-pull-requests).
- Copilot: "Unless Copilot has been configured to review each push to a pull request, it will only review a pull
  request once" (https://docs.github.com/en/copilot/concepts/agents/code-review).
- Huang et al. (above): repeated self-correction without outside feedback can make results worse.

**Verdict: keep.** Products bound re-review and review only the interdiff, as ADR-0004 does (patch-id reuse,
interdiff). No primary source publishes a number, so 3 is our choice; #210 found 3 in two toolkits. Small refine: if
verify keeps the same finding (same issue, same place) after a fix round, stop and go to the human. A repeat means
the loop is not converging, and a fourth try will not help.

## D8 · Zero findings is not a pass; the AI never approves

**Industry.**
- Claude Code Review: "A review never approves or blocks the pull request"; "A review with no findings doesn't mean
  your code is error-free or secure"; a missing result must be treated "as no verdict rather than as zero findings"
  (https://code.claude.com/docs/en/code-review, https://code.claude.com/docs/en/code-review-pull-requests).
- Copilot: "By default, Copilot's reviews do not count toward required approvals"; "Always validate Copilot's
  feedback carefully" (https://docs.github.com/en/copilot/concepts/agents/code-review).
- Meta: when reviewers saw AI patches, "reviewers taking over 5% longer"; the fix put "the burden of fixing the code
  back on authors" (https://arxiv.org/html/2507.13499v1).

**Verdict: keep.** We are stricter than Copilot, which can approve when enabled. One difference to keep in mind: our
act_on loops back to the implementer, so the AI can stop a PR from reaching the human. Claude Code Review never
blocks. That is fine because the human still merges, and the 3-round cap sends it to the human anyway.

## D9 · Retire a lens after 20 PRs with no unique verified finding

**Industry.**
- BitsAI-CR removes rules by adoption and precision: "removing rules that generate low-value comments with low
  Outdated Rates and high precision"; Outdated Rate "tracks the percentage of code lines modified after being flagged";
  the bar is "an Outdated Rate of around 25% (±5%) with a precision of around 65% (±5%) for 14 days"
  (https://arxiv.org/html/2501.15134).
- Google AutoCommenter: "identified 17 non-actionable URLs, whose suppression increased the historical useful ratio
  from 54% to 66%"; "a simple suppression mechanism was sufficient to strongly improve user acceptance to over 80%"
  (https://arxiv.org/html/2405.13565).
- Bugbot's main metric is the resolution rate: "which bugs were actually resolved by the author in the final code"
  (https://cursor.com/blog/building-bugbot).

**Verdict: change.** Industry retires a rule for *noise* (low adoption, low precision). Our rule retires a lens for
*silence* (no unique verified finding). Two problems:
1. "Verified" means verify kept it. That is the model judging the model. Use the acted-on rate instead (ADR-0015 R4: "a
   finding counts when a later commit fixes it"). It is the same signal as Outdated Rate and Bugbot's resolution rate.
2. A lens for a rare, severe class (security, one-way-door data) may rightly find nothing in 20 PRs. Silence is not
   failure there. Do not retire a lens on silence while it still catches its seeds in the ADR-0015 golden set.

Proposal: retire or rewrite a lens when (a) after 20 PRs it has no unique *acted-on* finding **and** it misses its
golden-set seeds, or (b) most of its findings are dismissed or never acted on (a precision floor, as BitsAI-CR and
#210 RV5). The operator approves each retirement.

## Sources not used, and why

- Graphite Diamond: its pages give only marketing claims ("minimizing noise and false positives") and no method
  (https://graphite.com/guides/building-developer-trust-high-signal-ai-feedback). Not counted.
- CodeRabbit: the blog says it "verifies findings independently, and shows the evidence before you decide what to
  fix" (https://coderabbit.ai/blog/how-coderabbits-agentic-code-validation-helps-with-code-reviews). Vendor claim, no
  numbers. Counted only as "a vendor has a verify step".
- Google comment-resolution (https://research.google/blog/resolving-code-review-comments-with-ml/) is about fixing
  human comments, not finding issues. It supports one point: Google "calibrated for a target precision of 50%" because
  "Incorrect suggested edits take the developers time and reduce the developers' trust in the feature".
- HalluJudge (Atlassian data, https://arxiv.org/abs/2601.19072): a judge for ungrounded review comments, "F1 score of
  0.85" at "$0.009" each. A possible cheap pre-filter before verify. Not needed for any verdict.
