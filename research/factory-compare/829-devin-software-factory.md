# #829 — Profile: Devin Software Factory template

Map: #826. Read on 2026-11-20. Each claim is *documented* (link), or "unknown" with the reason.
No claim here is *inferred from code*: the product is closed source.

## Sources read

| id | URL | what it is | access |
|---|---|---|---|
| T | https://devin.ai/bots/templates/software-factory | the template's public page | public, server-rendered; raw HTML read with curl as well |
| B | https://devin.ai/bots | Bots product page | public |
| D-bots | https://docs.devin.ai/work-with-devin/bots.md | Bots docs | public |
| D-tpl | https://docs.devin.ai/work-with-devin/bots/templates.md | Bot templates docs | public |
| D-acc | https://docs.devin.ai/work-with-devin/bots/access-and-security.md | Bot access and security | public |
| D-conn | https://docs.devin.ai/work-with-devin/bots/connections.md | Bot connections and secrets | public |
| D-use | https://docs.devin.ai/work-with-devin/bots/usage-limits.md | Bot usage limits | public |
| D-auto | https://docs.devin.ai/product-guides/automations.md | Automations (triggers) | public |
| D-mem | https://docs.devin.ai/product-guides/memory.md | Memory | public |
| D-adv | https://docs.devin.ai/work-with-devin/advanced-capabilities.md | Managed Devins, schedules | public |
| D-rev | https://docs.devin.ai/work-with-devin/devin-review.md | Devin Review | public |
| D-cli | https://docs.devin.ai/llms.txt , https://docs.devin.ai/cli/models.md | Devin CLI index, models | public |
| S1 | https://alphasignal.ai/news/cognition-s-devin-bots-now-run-parallel-coding-sessions-hitting-2-000-pull | secondary news, 2026-11-17 | public; **secondary**, used only where marked |
| APP | https://app.devin.ai/bots/start?template=lead-software-factory | "Get started" target | JS shell (24 KB); needs a Devin login; not read |

## What it is

- A Devin **Bot template** named "Software Factory", category Engineering, by Cognition. Template id `lead-software-factory`. *documented* (T)
- Its one-line job, verbatim: "Finds bugs, polish, performance and refactoring work in the product area you name and opens one small pull request for each, with proof that it works. It learns from what you merge and close, and keeps your review queue filled." *documented* (T)
- It is **one Bot, not a set of roles.** The page names no sub-roles. *documented* (T: no roles listed)
- A template is a **prompt** covering "the Bot's role and how it works"; a new Bot keeps its own copy of the prompt. *documented* (D-tpl)
- A Bot: "Give a Bot an outcome to own. It plans the work, starts Devin sessions, and keeps going until it's done." *documented* (D-bots)
- Launched 2026-11-17 as one of six launch templates (Software Factory, Android Engineer, QA Engineer, Latency Optimizer, Product Engineer, Chief of Staff). Six names *documented* (B); launch date from S1 only (secondary).
- Open or closed source: **closed**, a hosted SaaS feature. Licence: unknown — no licence or repo is published for Devin Bots; Cognition's terms at devin.ai/terms were not read.

## Who it is for

- Teams with a GitHub repo that want a steady flow of small cleanup PRs in one product area. "Works best with GitHub. An equivalent tool works too." *documented* (T)
- Plans: Bot billing is documented for Max, Teams and Enterprise; public template links for Pro, Max and Teams. *documented* (D-use, D-tpl)

## The template's prompt

- **Unknown.** The public page does not show the prompt; its raw HTML holds only the description and setup steps (T, checked with curl).
- The docs say "Open a template to see what you would get", including the full prompt and an example message — inside the Devin app (D-tpl). The app needs a login (APP), so the prompt text was not read.

## Setup (verbatim from T)

1. "Choose Software Factory from the Bot templates."
2. "Tell your Bot your goal and preferences."
3. "Connect the tools and repositories you want it to use."

A new Bot from a template is private, with no connections, secrets or memory; you then tell it what it owns, set its connections and set any triggers. *documented* (D-tpl)

## Flow: product area → PR

```
operator names a product area + preferences   (T step 2)
        │
        ▼
Bot (one chat, persistent)  ── plans work, finds bugs/polish/perf/refactors   (T, D-bots)
        │ starts one child session per piece, each on its own VM              (D-bots, D-adv)
        ▼
managed Devin session ── makes one small PR "with proof that it works"        (T)
        │
        ▼
"Needs you": Review PR / Merge PR card → human merges or closes               (D-bots)
        │
        ▼
Bot memory learns from what is merged and closed                              (T, D-mem)
```

- What "proof that it works" is (test, screenshot, video): unknown — T does not say.
- How it picks or ranks work in the area: unknown — in the prompt (not read).
- How it learns from merged/closed PRs: T says it does; D-mem does not describe the mechanism. Unknown.

## Handoffs

- Bot → child sessions ("managed Devins"): the coordinator starts children "with specific prompts, skills, tags, and ACU limits", monitors, messages, sleeps or ends them, and is woken when a child finishes or needs input. Children start without confirmation by default; "Auto-approve child sessions" can be turned off. *documented* (D-adv)
- Bot → other Bots: Bot A given access to Bot B can read B (conversation and sessions) and message it, not change it. *documented* (D-acc). Whether Software Factory hands off to other Bots: unknown.
- Bot → human: one chat; reports come back there; reachable from the web app, Slack, iMessage. *documented* (D-bots)

## Triggers

- A Bot "can run on a schedule or when something happens in your tools"; it sets these up through chat, and you may need to approve one. *documented* (D-bots)
- If a template is meant to run on a trigger, the Bot offers to set it up the first time you talk to it. *documented* (D-tpl). Which trigger Software Factory uses: unknown (prompt not read).
- Automation sources: Slack, Microsoft Teams, GitHub, GitLab, Linear, Jira, PagerDuty, schedules (cron or one-time), webhooks. Limits: per-session spend cap, default 50 runs/hour, queue caps, network policy, optional LLM or script preflight. *documented* (D-auto)

## Approval points

- "Needs you" items: Decision (Bot marks its recommendation), Review PR / Merge PR, Permission request (new access, automations, network hosts, usage-limit increases), Report/FYI. *documented* (D-bots)
- "A Bot asks before it takes on new access"; approval cards say what approving shares; "You can only approve giving your own." *documented* (D-bots, D-acc)
- Merge: the docs name "Merge PR" as a card for the human. Whether the Bot can merge by itself: unknown — D-acc does not cover merge rights.

## Stack

- Language, runtime, storage, queue: unknown — closed source, not documented.
- Sandbox: every session runs in its own VM. *documented* (B, D-adv)
- Memory: a "persistent Git repository of Markdown notes" (`MEMORY.md` plus folders), written by Devin, consolidated by daily "dreaming" sessions. *documented* (D-mem)
- LLM providers: Bots — unknown. Devin CLI supports Anthropic, OpenAI, Google and Cognition models plus open models (DeepSeek, Kimi, GLM), with an "Adaptive" router and "Fusion" pairing. *documented* (D-cli). B claims zero data retention with model providers.
- Billing: the Bot's chat plus every session it starts; "The Bot's creator pays for it." *documented* (D-use)

## Where docs and code live

- Docs: https://docs.devin.ai/work-with-devin/bots and subpages; template page T. *documented*
- Code: not public. Unknown.

## Topics 1–12 (seeds the #826 matrix)

| # | topic | first note |
|---|---|---|
| 1 | user interaction | One persistent chat per Bot (web, Slack, iMessage); "Needs you" cards for decisions, PR review/merge, permissions (D-bots). |
| 2 | CLI | Bots: no CLI documented. Devin CLI exists (`devin`, `/handoff` to cloud, subagents, skills, hooks, plugins) (D-cli); its link to Bots is unknown. |
| 3 | flow | Name an area → Bot finds work → one small PR each with proof → human merges/closes → Bot learns (T). Ranking and proof form unknown. |
| 4 | roles + prompts | One Bot; prompt = role + how it works (D-tpl). Prompt text unknown: shown only in the logged-in app. |
| 5 | handoff | Bot → managed Devin children with prompt, skills, tags, ACU limit; woken on finish or question (D-adv). Bot→Bot read+message access (D-acc). |
| 6 | review | Human reviews/merges via "Review PR / Merge PR" cards (D-bots). Devin Review exists (severity labels, `REVIEW.md`, Auto-Fix, commit status; autoapprover does not merge) (D-rev); whether this template uses it is unknown. |
| 7 | plugins | Connections = MCP servers or plugins (plugin from a member's personal marketplace) (D-conn). |
| 8 | adapters | GitHub named; "an equivalent tool works too" (T). Automations: GitHub, GitLab, Linear, Jira, Slack, Teams, PagerDuty, webhooks (D-auto). |
| 9 | internals | Bot = coordinator session + child sessions on own VMs; memory in a git repo of Markdown, daily consolidation (D-adv, D-mem). Engine internals unknown (closed). |
| 10 | security | Bot has own identity; opens PRs as itself by default; grants never exceed the giver; three share levels; approval cards; network policy can only narrow (D-acc, D-conn, D-auto). Prompt-injection guidance: unknown (not in D-acc). |
| 11 | docs | Public docs at docs.devin.ai with an `llms.txt` index; template page has description and 3 setup steps only (T, D-cli). |
| 12 | stack | Closed SaaS; per-session VM; multi-provider models in CLI; language/storage/queue unknown (B, D-cli). |

## Stayed unknown

- The template's prompt text and example message — only in the logged-in app.
- Its trigger or schedule, how it ranks work, what "proof" is, and how it learns from merges/closes.
- Whether the Bot can merge on its own; whether it uses Devin Review.
- Licence terms; language, runtime, storage and queue; models the Bot uses.
- No first-party Cognition launch post was found; launch date and template list cross-check rest on S1 (secondary) and B.
