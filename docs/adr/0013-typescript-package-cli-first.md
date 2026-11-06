# 0013 · A TypeScript package that calls CLIs

Status: accepted 2026-11-06 (operator, map #30: Q13, Q16, the integration rule, gap 4). Changes the order in
ADR-0011 D13.

## Context

No earlier ADR chose bash. The 19 `scripts/*.sh` files grew from glue. ADR-0012 needs several things that strain bash:
- a dispatcher decision table, and JSON from two forges;
- a process-group kill (macOS has no `setsid`);
- a runner seam (`claude`, `copilot`, `opencode`);
- a later AG-UI web app (Q8);
- tests.

The factory must install the same way on a personal laptop, a work laptop, a teammate's laptop and a Linux VM.

## Decision

```
npx agent-factory dispatch | poll | approve | …      (TypeScript, Node — already present for claude and copilot)
        ├── CLI first:  gh · glab · git · claude · copilot · opencode · srt · limactl · acli
        └── HTTP only where no CLI covers a call: one module per service; token from the CLI or the OS keychain
```

| # | decision | #30 |
|---|---|---|
| T1 | The factory is a TypeScript npm package that runs on the host. It picks its box with `FACTORY_BOX` (ADR-0012 S8). A container image comes later, only to host a UI on the VM. | [Q13 + Q16](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681380403) |
| T2 | Every integration calls a CLI. Each CLI keeps its own login, so factory code holds no token. | [integration rule](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681380403) |
| T3 | Where no CLI covers a call, one direct HTTP call is allowed, through one small module per service. Its token or webhook URL comes from the CLI (for example `gh auth token`) or the OS keychain at call time. Never from an env var, a config file or the repo. The Discord pings (Q8) are the first case. | [integration rule](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681380403), [Q8](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681441140) |
| T4 | **Order:** (1) the package with ADR-0012 built in, (2) the dispatcher as part of it, (3) the laptop pilot (#62) on the package. The bash scripts are ported one by one. This replaces "dispatch after the pilot" (ADR-0011 D13). | [gap 4](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681648337) |
| T5 | Every runner call names a full model ID, never an alias. | [Q10](https://github.com/chiyanram/agent-factory/issues/30#issuecomment-6681453020) |

## Why

- One install path everywhere. Node is already on the machine for the `claude` and `copilot` CLIs.
- Sandcastle is TypeScript and works the same way: CLIs for git, docker and the agents, HTTP for the cloud sandboxes.
  We can read it one-to-one.
- AG-UI has an official TypeScript SDK.
- Building the ADR-0012 fixes once in TypeScript costs less than building them in bash and porting them later. The cost
  is that the pilot moves back by about 1–2 weeks.

## Alternatives rejected

| option | why rejected |
|---|---|
| stay in bash | the dispatcher, the process groups and a UI are awkward, and the ADR-0012 fixes would be built twice |
| Python | a close second, but it is not on a fresh Mac, and it does not match Sandcastle |
| a container image as the main way to ship | needs Docker on every laptop and does not fix the sandbox (ADR-0012) |
| HTTP SDKs for every service | each holds a token in our code; the CLIs already hold the logins |
| pilot first in bash (the original D13 order) | the safety fixes would be built twice (gap 4) |

## Consequences

- Until the port, the bash scripts stay the working loop. The docs mark every place where they still behave the old way.
- `AGENTS.md` and `CONTRIBUTING.md` keep the bash 3.2 rules for the scripts that are not ported yet.

## Sources

Map #30 comments of 2026-11-06 (linked above) · the Sandcastle study on #83 · ADR-0011, 0012.
