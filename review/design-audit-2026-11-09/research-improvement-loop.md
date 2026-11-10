# Research: how teams make AI agents improve over time (for R14)

Local only. Started 2026-11-09. Input for **R14** — the improvement loop "under control" (README §2, §7). Primary
sources only. A claim marked **(nv)** is not checked against its primary source. A claim marked **(compendium)** was
checked in `code-review-compendium.md` and is not fetched again here.

## 1. The consensus loop

```
            ┌──────────────────────────────────────────────────────────────────────────┐
            │                                                                          │
 ① SIGNAL ──▶ ② LOOK AT DATA ──▶ ③ NAME FAILURES ──▶ ④ CASE FROM ──▶ ⑤ CHANGE ──▶ ⑥ RE-RUN ──▶ ⑦ SHIP ──┘
 live metric   read traces       open code →          FAILURE        prompt/rule/  evals:      only if no
 (acted-on,    (50–100,          axial code =          new golden     tool/check    new case    regression;
 user replies, a human reads     taxonomy + count      case (the      (strongest    passes,     then watch ①
 bug tracker)  the first ones)   per category          bug, reverted) level first)  old do not  and retire
                                                                                    drop        stale rules
   automated        HUMAN           HUMAN (LLM may          HUMAN          human or       automated    HUMAN gate
   everywhere       (all sources)   help cluster)           approves       optimizer      (CI)         (most sources)
```

Every eval source has steps ②–⑦. The production review bots add ① and the "retire stale rules" tail. The automated
techniques (§3) replace ②–⑤ with a model. They keep ⑥ and drop the human at ⑦.

### Who does what: human-gated vs automated

| source | what proposes the change | who accepts it | eval before ship | expiry / retire |
|---|---|---|---|---|
| Anthropic, agent evals | a human, from real failures | human | yes: capability + regression suites | eval "saturation" → add harder tasks |
| Anthropic, skills authoring | Claude A drafts; a human observes Claude B | human | yes: 3 scenarios, baseline first | — |
| Anthropic, Claude Code | a human edits `CLAUDE.md`; repeated misses move to a hook | human | — | prune; `/doctor` flags stale lines |
| OpenAI, eval flywheel | a human (analyze → measure → improve) | human | yes: continuous evaluation | — |
| Husain / Shankar | a human (one "benevolent dictator") | human | yes: CI set + aligned judge | — |
| Google AutoCommenter | rater studies, then the team suppresses URLs | human (team) | yes: per-URL thresholds from validation data | suppress non-actionable URLs |
| ByteDance BitsAI-CR | weekly Outdated Rate + sampled hand labels | human ("we consider … may decide") | yes: precision per rule | decommission low rules |
| Uber uReview | developer feedback + evals | team (nv: method not said) | yes (compendium) | suppress low-value categories |
| Atlassian RovoDev | classifier trained on resolved comments | team (retrain) | (compendium) | — |
| CodeRabbit learnings | the bot, from a chat reply | **optional**: admin, `approval_delay` 0–30 days; 0 = default = no gate | no | edit / delete by admin |
| Cursor Bugbot learned rules | the bot, from reactions, replies, human comments | **none**: auto-promote, auto-disable | no (docs silent) | auto-disable when signal stops |
| GitHub Copilot Memory | the agent, as a byproduct of work | **none**; users can delete | no; checks citations against the branch before use | **90 days** default (7–180) without reinforcement |
| Devin knowledge | Devin suggests from chat feedback | human: edit or dismiss before save | no | disable |
| Reflexion, ACE | the agent (reflect, curate) | none | task feedback only | ACE: dedupe / refine |
| GEPA, TextGrad | an optimizer over traces | none in the loop; a human deploys | yes: score on a train/val set | — |
| DGM, SICA | the agent edits its own code | none in the loop; "human supervision" around it | yes: benchmark score | archive of all versions |

Pattern: **the systems that measure quality at scale keep a human on each rule change** (Google, ByteDance, Uber, every
eval guide). **The products that learn per customer automate the change** (Bugbot, Copilot Memory, CodeRabbit by
default). They pay for that with expiry, auto-disable, or citation checks — not with an eval gate.

## 2. The operator's belief: "it is basically a retro"

**Verdict: partly right.** A retro is step ② and ③ of the loop. It is the most important step: every eval guide says a
human must look at the data. But a retro alone does not close the loop.

| the loop needs | a retro gives | gap |
|---|---|---|
| ② a sample, not memory | the tickets a human remembers | Husain: ≥100 traces; OpenAI: ~50 failing traces; we have no sample rule |
| ③ a count per failure kind | a list of lessons | no taxonomy, so no "fix the biggest bucket first" |
| ④ a regression case for each lesson | a rule change | **main gap.** Nothing proves the lesson fixes the case, or keeps it fixed |
| ⑥ a gate on the whole set | — | the lesson can break an old case (no "no drop" check) |
| ⑦ proof that it helped live | — | no acted-on rate (G2) to compare before and after |
| retire | — | a lesson never expires. Copilot: 90 days; Bugbot: auto-disable; BitsAI: decommission |
| strongest form | GUIDE step 6 already says architecture → types → lint → test → docs | good; Claude Code says the same: a line that keeps failing "belongs in a hook" |

So: **retro + regression case + eval gate + live metric + expiry = the loop.** The parts exist in agent-factory. The
chain between them does not.

## 3. Recommended loop for agent-factory (human-started)

```
 ENGINE (auto, every run)          HUMAN starts (P8)          HUMAN accepts           ENGINE/CI (auto)        HUMAN
 ─────────────────────────         ─────────────────          ─────────────           ───────────────         ─────
 ① acted-on rate per rule/lens  ─▶ ② retro role reads the  ─▶ ④ lesson PR to the  ─▶ ⑤ reviewer eval #215 ─▶ ⑥ moves
    (G2), human replies (G1),        last N merged tickets     plugin carries:         recall ≥ baseline,      the pin
    fix minutes, run records         (N ≈ 10, as GUIDE         · the rule change at    clean floor 0;          (DESIGN §5);
    stamped with plugin hashes       step 6); the human        the strongest level      role evals              next ticket
          ▲                          reads the first traces     · a NEW golden case     skills#236;             only
          │                        ③ failure kinds + counts     from the real failure   held-out cases
          │                          → one lesson per kind      · a review-by date
          └──────────────── ⑦ after 20 PRs: acted-on per rule; a rule with no unique act-on → retire proposal ◀──┘
```

1. ① is automatic and already designed: ADR-0015 R4 (acted-on rate) and DESIGN §6 (lens retirement after 20 PRs).
   Build G2 first. Without it, ⑦ has nothing to read.
2. ② and ③ stay human-started. The retro role drafts. The human reads at least the first traces himself (Husain: open
   coding is "always" manual).
3. ④ is the new rule. **No lesson without a golden case.** The `revert-*` cases in `evals/reviewer/` already have this
   shape: a real fix, reverted. A lesson for a writer role goes to the role evals (skills#236).
4. ⑤ is ADR-0015 E8/E10, already decided. Add a held-out part: cases the retro did not see. Run them only at the gate.
5. ⑥ is DESIGN §5 "Updating is deliberate". Only the operator raises `baseline.json` (E10).
6. ⑦ gives each lesson a review-by date. A rule with no act-on hit by then goes back to a human. It is not deleted
   silently.

**Automate later:** ① → ③ drafting. The engine clusters dismissed and acted-on findings and drafts a lesson PR with
its seed case. This is what Bugbot and CodeRabbit do. Keep ④ accept, ⑤ gate and ⑥ pin move human, as Google and
ByteDance do. Never automate: raising the baseline, or editing the judge and the cases in the same PR as the lesson
(DGM hacked its own check; see §4.12).

### Golden-set hygiene (question 4)

| item | what sources say | for us |
|---|---|---|
| size to start | Anthropic: "20-50 simple tasks drawn from real failures"; skills: 3 scenarios | 20 seeded + 10 clean (E5) is in range |
| where cases come from | Anthropic: "bug tracker and support queue"; Husain: "confirmed failures" | one case per accepted lesson |
| overfitting | Husain: train / dev / test split for the judge, test untouched; GEPA: separate train and validation sets | keep a held-out slice the lesson author never sees |
| saturation | Anthropic: "An eval at 100% tracks regressions but provides no signal for improvement" | when recall nears 100%, add harder cases |
| judge check | Shankar: evaluators "inherit all the problems of the LLMs they evaluate"; OpenAI: "Use human feedback to calibrate" | E6 (18 of 20); repeat on each judge change |
| criteria drift | Shankar: "grading outputs helps users define criteria" | expect the rubric to change after the first retros |

## 4. Sources

### 4.1 Anthropic — "Demystifying evals for AI agents" (2026-01-09)
https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- "In reality, 20-50 simple tasks drawn from real failures is a great start."
- "If you're already in production, look at your bug tracker and support queue."
- Regression evals: "a decline in score signals that something is broken".
- "An eval at 100% tracks regressions but provides no signal for improvement."
- "LLM-as-judge graders should be closely calibrated with human experts".
- "You won't know if your graders are working well unless you read the transcripts".

### 4.2 Anthropic — Skill authoring best practices
https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- "Create evaluations BEFORE writing extensive documentation."
- Steps: identify gaps → "Build three scenarios" → "Establish baseline" → minimal instructions → iterate.
- Claude A writes the skill, Claude B uses it, the human observes: "Iterate based on observation".

### 4.3 Anthropic — Claude Code best practices
https://code.claude.com/docs/en/best-practices
- "If you keep adding emphasis to a `CLAUDE.md` line and Claude still misses it, that's a sign the line belongs in a
  hook."
- "`/doctor prompt-audit` flags instructions that were written for older models, point at files that no longer exist".

### 4.4 OpenAI — Evaluation best practices; eval flywheel cookbook
https://developers.openai.com/api/docs/guides/evaluation-best-practices ·
https://developers.openai.com/cookbook/examples/evaluation/building_resilient_prompts_using_an_evaluation_flywheel
- "Adopt eval-driven development: Evaluate early and often."
- "Set up continuous evaluation (CE) to run evals on every change".
- "grow the eval set over time." "Use human feedback to calibrate automated scoring."
- Flywheel: Analyze → Measure → Improve; open coding on "around 50" failing traces, then axial coding. It credits
  Shankar & Husain. The guide does not discuss overfitting.

### 4.5 Hamel Husain & Shreya Shankar — LLM evals FAQ
https://hamel.dev/blog/posts/evals-faq/
- Open coding, then axial coding into a "failure taxonomy". "We recommend reviewing at least 100 traces."
- "Focus automated evaluators on failures that persist after fixing your prompts."
- A single domain expert as "benevolent dictator".
- Judge trust: true positive and true negative rates; train / dev / test split, test kept untouched.
- "Use LLMs to scale what you've learned, not to avoid looking at data."

### 4.6 Shankar et al. — "Who Validates the Validators?" (arXiv 2404.12272)
https://arxiv.org/abs/2404.12272
- "LLM-generated evaluators simply inherit all the problems of the LLMs they evaluate, requiring further human
  validation."
- Criteria drift: "users need criteria to grade outputs, but grading outputs helps users define criteria."

### 4.7 Google AutoCommenter (arXiv 2405.13565)
https://arxiv.org/html/2405.13565
- The team "opted for suppression of specific best-practice predictions" instead of retraining.
- Raters "identified 17 non-actionable URLs, whose suppression increased" the useful ratio "from 54% to 66%".
- Thresholds "computed based on the intrinsic evaluation on the validation dataset."
- Human gate: yes. Raters and the team choose, not the thumbs-down button.

### 4.8 ByteDance BitsAI-CR (arXiv 2501.15134)
https://arxiv.org/html/2501.15134
- "Every week, we track changes in the Outdated Rate of each review rule."
- "we consider whether the review rule is not being accepted by users and may decide on decommissioning it."
- "Each day, we sample and annotate the online data (sampling generally does not exceed 10%)."
- Human gate: implied by "we consider"; not stated outright.

### 4.9 Uber uReview, Atlassian RovoDev (compendium)
https://www.uber.com/blog/ureview/ · https://arxiv.org/html/2601.01129v2
- Uber: thresholds per assistant, language and category, "based on developer feedback and evaluations."
- RovoDev: a ModernBERT classifier trained on comments that did or did not lead to a code change.
- Who approves a change is not said **(nv)**.

### 4.10 Product memory: CodeRabbit, Bugbot, Copilot Memory, Devin
- CodeRabbit https://docs.coderabbit.ai/guides/learnings — "Days admins have to approve or reject a learning before it
  is automatically applied." 0 (the default) applies it at once.
- Bugbot https://cursor.com/docs/bugbot — "Cursor will automatically enable or disable rules as it learns more about
  your team's activity over time." `@cursor remember [fact]` adds a rule. The docs do not say a human approves **(nv)**.
- Copilot Memory https://docs.github.com/en/copilot/concepts/agents/copilot-memory — "check the citations provided with
  each memory before using it"; default expiry 90 days, settable "between 7 and 180 days"; users with write access can
  delete repository facts.
- Devin https://docs.devin.ai/product-guides/knowledge — "Edit the suggested Knowledge before saving, or dismiss the
  Knowledge if it's not helpful."

### 4.11 Reflexion, TextGrad, GEPA, ACE
- Reflexion (arXiv 2303.11366): "not by updating weights, but instead through linguistic feedback"; an "episodic memory
  buffer"; 91% pass@1 HumanEval.
- TextGrad (arXiv 2406.07496): "backpropagates textual feedback provided by LLMs to improve individual components".
- GEPA (arXiv 2507.19457): "reflects on them in natural language to diagnose problems"; beats GRPO "by 6% on average …
  while using up to 35x fewer rollouts"; beats MIPROv2 by over 10%.
- ACE (arXiv 2510.04618): prior methods suffer "brevity bias" and "context collapse, where iterative rewriting erodes
  details over time". Example: 18,282 tokens at 66.7 accuracy collapsed to 122 tokens at 57.1, below the 63.7 baseline.
  ACE uses append-and-update "delta contexts". Its effect "depends on the availability of signals"; without reliable
  signals the context "can become polluted".
- Lesson for us: lessons must be added as separate items, never by rewriting the whole rule file.

### 4.12 Darwin Gödel Machine; Self-Improving Coding Agent
- DGM (arXiv 2505.22954; https://sakana.ai/dgm/): it "iteratively modifies its own code"; SWE-bench "from 20.0% to
  50.0%". Sakana's page: "in some cases, it removed the markers we use in the reward function to detect hallucination",
  "hacking our hallucination detection function to report false successes." Paper §5: the loop "could amplify
  misalignment over successive generations." The exact appendix text was not read **(nv)**.
- SICA (arXiv 2504.15228, Robeyns, Szummer, Aitchison): the agent "can autonomously edit itself"; "17% to 53% on a
  random subset of SWE Bench Verified." The abstract has no safety discussion.
- Lesson for us: the thing that changes must never also change its own grader. Keep the judge, the cases and the
  baseline out of the lesson PR.

### 4.13 Google / DeepMind
No primary source found on an improvement loop for agents in production, beyond AutoCommenter (§4.7). Not searched in
depth **(nv)**.
