import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  bashReaches,
  claudeArgv,
  claudeMd,
  claudeSettings,
  copilotArgs,
  wallProblems,
  type CoordinatorPlaces,
} from "../src/core/coordinator.js";
import { checkWall, installCoordinator, startCoordinator, type Interactive } from "../src/coordinator-cli.js";
import { tempDir } from "./temp.js";

const PLACES: CoordinatorPlaces = {
  pkg: "/opt/agent-factory",
  factoryHome: "/home/ram/.factory",
  botHome: "/home/factory",
};
const HOME = homedir();

// Claude Code's documented rule matching (permissions docs): a path rule is gitignore-style; ~/ is the home, // the
// root, and a rule with neither is relative to the session's folder (the coordinator's). A Bash rule matches the
// command as typed, * any text; a compound command is split on && || ; | &, and timeout, nice, nohup, time, command and
// stdbuf are stripped first. Deny or ask on any part wins; allow needs every part.
const CWD = "/home/ram/.factory/coordinator";

function literal(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function pathRegex(rule: string): RegExp {
  const path = rule.startsWith("~/")
    ? `${HOME}/${rule.slice(2)}`
    : rule.startsWith("//")
      ? rule.slice(1)
      : `${CWD}/${rule.replace(/^\.?\//, "")}`;
  const body = path
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => {
      if (part === "**/") {
        return "(?:.*/)?";
      }
      if (part === "**") {
        return ".*";
      }
      return part === "*" ? "[^/]*" : literal(part);
    })
    .join("");
  return new RegExp(`^${body}$`);
}

function bashRegex(rule: string): RegExp {
  // "x *" also matches a bare "x", as the docs' trailing wildcard does
  const bare = rule.endsWith(" *") ? `(?: .*)?` : "";
  const head = bare === "" ? rule : rule.slice(0, -2);
  return new RegExp(`^${head.split("*").map(literal).join(".*")}${bare}$`);
}

const WRAPPER = /^(?:timeout\s+\S+|nice(?:\s+-n\s+\S+)?|nohup|time|command|builtin|stdbuf(?:\s+-\S+)*)\s+/;

function parts(command: string): readonly string[] {
  return command.split(/\s*(?:&&|\|\||;|\||&)\s*/).map((p) => {
    let part = p.trim();
    while (WRAPPER.test(part)) {
      part = part.replace(WRAPPER, "");
    }
    return part;
  });
}

function matches(rules: readonly string[], tool: "Read" | "Edit" | "Bash", target: string): boolean {
  return rules
    .filter((r) => r.startsWith(`${tool}(`))
    .map((r) => r.slice(tool.length + 1, -1))
    .some((spec) => (tool === "Bash" ? bashRegex(spec) : pathRegex(spec)).test(target));
}

type Verdict = "deny" | "ask" | "allow" | "prompt";

function one(tool: "Read" | "Edit" | "Bash", target: string, places: CoordinatorPlaces): Verdict {
  const p = claudeSettings(places).permissions;
  if (matches(p.deny, tool, target)) {
    return "deny";
  }
  if (matches(p.ask, tool, target)) {
    return "ask";
  }
  return matches(p.allow, tool, target) ? "allow" : "prompt";
}

// what Claude Code does with one call: deny, then ask, then allow; else it asks
function verdict(tool: "Read" | "Edit" | "Bash", target: string, places: CoordinatorPlaces = PLACES): Verdict {
  const each = tool === "Bash" ? parts(target).map((t) => one(tool, t, places)) : [one(tool, target, places)];
  const order: readonly Verdict[] = ["deny", "ask", "prompt", "allow"];
  return order.find((v) => each.includes(v)) ?? "prompt";
}

describe("the coordinator's wall (#106; ADR-0012 S2): the canary", () => {
  it("refuses reading ~/.ssh/canary and every secret path, the bot's key and an .env file", () => {
    for (const path of [
      `${HOME}/.ssh/canary`,
      `${HOME}/.ssh/id_ed25519`,
      `${HOME}/.config/gh/hosts.yml`,
      `${HOME}/.aws/credentials`,
      `${HOME}/.docker/config.json`,
      `${HOME}/.npmrc`,
      `${HOME}/Library/Keychains/login.keychain-db`,
      `${HOME}/.claude/.credentials.json`,
      "/home/factory/.config/agent-factory/app.pem",
      "/home/ram/.factory/secrets/claude-token",
      "/work/project/.env.local",
      "/work/project/sub/.env",
    ]) {
      expect({ path, v: verdict("Read", path) }).toEqual({ path, v: "deny" });
    }
  });

  it("refuses editing a factory file, its own settings, any .claude/, the approvals and the project files", () => {
    for (const path of [
      "/opt/agent-factory/src/app.ts",
      "/opt/agent-factory/prompts/coordinator.md",
      "/home/ram/.factory/coordinator/.claude/settings.json",
      "/home/ram/.factory/coordinator/CLAUDE.md",
      `${HOME}/.claude/settings.json`,
      "/work/project/.claude/settings.local.json",
      "/home/ram/.factory/approvals/ledger/PROJ-1.json",
      "/home/ram/.factory/starts/ledger/PROJ-1.json",
      "/home/ram/.factory/user.json",
      "/home/ram/.factory/teams/acme/team.json",
      "/home/ram/.factory/teams/acme/.git/config",
      "/home/ram/.factory/rubrics/security.md",
      "/home/ram/.factory/projects/ledger.json",
      "/home/ram/.factory/projects/ledger/brief.md",
      "/home/ram/.factory/runs/ledger/PROJ-1.jsonl",
      "/home/ram/.factory/review-runs/x/pack.md",
      "/home/ram/.factory/box-runs/x/code/Makefile",
      "/home/ram/.factory/egress/ledger/squid.conf",
      "/home/ram/.factory/plugins.json",
      "/home/ram/.factory/plugins/abc/plugin",
      "/home/ram/.factory/pending/0123456789ab.json",
      "/home/ram/.factory/writes/ledger/PROJ-1.jsonl",
    ]) {
      expect({ path, v: verdict("Edit", path) }).toEqual({ path, v: "deny" });
    }
  });

  it("lets it edit only spec drafts with no prompt; any other edit asks the person", () => {
    expect(verdict("Edit", "/home/ram/.factory/specs/ledger/PROJ-1/spec.md")).toBe("allow");
    expect(verdict("Edit", "/work/project/src/app.ts")).toBe("prompt");
  });

  it("runs the read commands, status and request with no prompt; confirm and every old loop command ask", () => {
    for (const command of [
      "agent-factory poll",
      "agent-factory poll --json",
      // the forms that name the project (#382)
      "agent-factory poll ledger",
      "agent-factory poll ledger --json",
      'agent-factory status ledger 12 aaaa1111 "writer started"',
      "agent-factory spec ledger PROJ-1",
      // the spec's text, to edit it (#542)
      "agent-factory spec ledger 6 --show",
      "agent-factory approval ledger PROJ-1",
      'agent-factory status 12 aaaa1111 "writer started"',
      // its round of questions (#517)
      "agent-factory grill ledger 12 aaaa1111 /home/ram/.factory/specs/ledger/PROJ-1/questions.json",
      "agent-factory request tracker.comment --file /home/ram/.factory/specs/ledger/PROJ-1/comment.json",
      // the retro's listing, with no model (#488)
      "agent-factory retro ledger --json",
    ]) {
      expect({ command, v: verdict("Bash", command) }).toEqual({ command, v: "allow" });
    }
    for (const command of [
      "agent-factory confirm ledger/PROJ-1/tracker.create/0123456789ab '[coordinator] a follow-up'",
      "agent-factory request notify --file d.json && agent-factory confirm ledger/PROJ-1/notify/0123456789ab x",
      "agent-factory claim 12",
      "agent-factory release 12",
      "agent-factory block 12 why",
      "agent-factory reconcile",
      "agent-factory claim ledger 12",
      "agent-factory release ledger 12",
      "agent-factory block ledger 12 why",
      "agent-factory reconcile ledger",
      "agent-factory review ledger 12",
      "agent-factory dispatch ledger --once",
      "agent-factory setup claude",
    ]) {
      expect({ command, v: verdict("Bash", command) }).toEqual({ command, v: "ask" });
    }
  });

  it("denies approve and start: the AI never approves and never STARTs a ticket (#227)", () => {
    for (const command of [
      `agent-factory approve ledger PROJ-1 ${"a".repeat(64)}`,
      "agent-factory approve",
      "agent-factory start ledger PROJ-1",
      "agent-factory spec ledger PROJ-1 && agent-factory start ledger PROJ-1 --yes",
      "agent-factory eval reviewer",
      "agent-factory eval reviewer . --drafts",
    ]) {
      expect({ command, v: verdict("Bash", command) }).toEqual({ command, v: "deny" });
    }
  });

  it("denies waive and any edit of the waivers: the AI never clears its own test check hit (#231)", () => {
    for (const command of [`agent-factory waive ledger PROJ-1 ${"a".repeat(40)}`, "agent-factory waive"]) {
      expect({ command, v: verdict("Bash", command) }).toEqual({ command, v: "deny" });
    }
    expect(claudeSettings(PLACES).permissions.deny).toContain("Edit(//home/ram/.factory/waivers/**)");
    expect(copilotArgs(PLACES)).toContain("shell(agent-factory waive)");
  });

  it("denies raw forge and network clients, git push, a second interpreter or shell, sudo and the App's token", () => {
    for (const command of [
      "gh api repos/o/r",
      // the spec is read through agent-factory spec --show, never the git host CLI (#542)
      "gh issue view 6 --json body",
      "gh",
      "timeout 5 gh api x",
      "echo hi && gh api x",
      "agent-factory poll | sh -c 'gh api x'",
      "glab mr list",
      "git push origin main",
      "git -C /work push",
      "curl https://example.com",
      "node -e 'require(\"fs\")'",
      "python3 -c 'print(1)'",
      "sh -c 'gh api x'",
      "bash -c 'cat ~/.ssh/id_rsa'",
      "npx some-tool",
      "sudo -n -u factory -- /usr/local/bin/agent-factory-app-token o/r",
      "agent-factory-app-token o/r",
      "agent-factory app-token o/r",
      "agent-factory plugin add /tmp/x",
      "agent-factory project init ledger",
      "agent-factory ask 12 aaaa1111 q",
      "agent-factory ask ledger 12 aaaa1111 q",
      "security find-generic-password -s x",
      "chmod 644 /home/ram/.factory/coordinator/.claude/settings.json",
    ]) {
      expect({ command, v: verdict("Bash", command) }).toEqual({ command, v: "deny" });
    }
  });

  it("denies init: it writes the user layer and the project file, which hold the wall (#369)", () => {
    for (const command of [
      "agent-factory init",
      "agent-factory init ledger --yes",
      "agent-factory init --repo /work/ledger",
    ]) {
      expect({ command, v: verdict("Bash", command) }).toEqual({ command, v: "deny" });
    }
    expect(copilotArgs(PLACES)).toContain("shell(agent-factory init)");
  });

  it("builds its absolute rules from a factory home with a space in it", () => {
    const spaced = { ...PLACES, factoryHome: "/home/r m/.factory" };
    expect(verdict("Edit", "/home/r m/.factory/approvals/a.json", spaced)).toBe("deny");
    expect(verdict("Edit", "/home/r m/.factory/specs/l/P-1/spec.md", spaced)).toBe("allow");
  });

  it("can never switch to bypass or auto mode", () => {
    const p = claudeSettings(PLACES).permissions;
    expect(p).toMatchObject({
      defaultMode: "default",
      disableBypassPermissionsMode: "disable",
      disableAutoMode: "disable",
    });
  });

  it("gives Copilot the same denies and read commands as flags; approve and start are denied there too", () => {
    const args = copilotArgs(PLACES);
    expect(args).toContain("shell(gh)");
    expect(args).toContain("shell(sudo)");
    expect(args).toContain("shell(agent-factory poll)");
    expect(args).toContain("shell(agent-factory request)");
    expect(args).toContain("shell(agent-factory project)");
    expect(args).toContain("shell(agent-factory approve)");
    expect(args[args.indexOf("shell(agent-factory eval)") - 1]).toBe("--deny-tool");
    expect(args).toContain("shell(agent-factory start)");
    expect(args[args.indexOf("shell(agent-factory approve)") - 1]).toBe("--deny-tool");
    expect(args.join(" ")).not.toContain("shell(agent-factory confirm)");
    expect(args.slice(0, 2)).toEqual(["--add-dir", "/home/ram/.factory/specs"]);
  });
});

describe("the wall's check (#105, #227)", () => {
  type Rules = { allow: string[]; ask: string[]; deny: string[] };
  const loosened = (change: (p: Rules & Record<string, unknown>) => void): unknown => {
    const settings = claudeSettings(PLACES);
    const p = settings.permissions;
    const permissions: Rules & Record<string, unknown> = {
      ...p,
      allow: [...p.allow],
      ask: [...p.ask],
      deny: [...p.deny],
    };
    change(permissions);
    return { ...settings, permissions };
  };

  it("finds nothing wrong with the shipped template, and the session never asks for bypass mode", () => {
    expect(wallProblems(claudeSettings(PLACES), PLACES)).toEqual([]);
    expect(claudeArgv().join(" ")).not.toMatch(/dangerously|bypass|skip-permissions/);
  });

  it("names each loosening: approve or start allowed or asked, gh, glab, curl, bash -c, an edit outside the specs", () => {
    const cases: readonly [(p: Rules & Record<string, unknown>) => void, string][] = [
      [(p) => p.allow.push("Bash(agent-factory approve *)"), "Bash(agent-factory approve *) lets"],
      [(p) => p.ask.push("Bash(agent-factory approve *)"), "Bash(agent-factory approve *) lets"],
      [(p) => p.allow.push("Bash(agent-factory start:*)"), "agent-factory start"],
      [(p) => p.ask.push("Bash(agent-factory waive *)"), "Bash(agent-factory waive *) lets"],
      [
        (p) => p.allow.push("Bash(agent-factory eval *)"),
        "Bash(agent-factory eval *) lets the coordinator run agent-factory eval reviewer",
      ],
      [(p) => p.ask.push("Bash(agent-factory eval reviewer)"), "lets the coordinator run agent-factory eval reviewer"],
      [
        (p) => (p.deny = p.deny.filter((r) => !r.includes("agent-factory eval"))),
        "Bash(agent-factory eval) is missing",
      ],
      [(p) => p.allow.push("Bash(gh *)"), "run gh api user"],
      [(p) => p.allow.push("Bash(glab api *)"), "run glab api user"],
      [(p) => p.allow.push("Bash(curl:*)"), "run curl"],
      [(p) => p.allow.push("Bash(bash -c *)"), "run bash -c true"],
      [(p) => p.allow.push("Bash"), "Bash lets the coordinator run"],
      [(p) => p.allow.push("Bash(*)"), "Bash(*) lets the coordinator run"],
      [(p) => p.allow.push("Edit(//home/ram/.factory/approvals/**)"), "edit outside the spec drafts"],
      [(p) => p.allow.push("Edit(//home/ram/.factory/specs/../starts/**)"), "edit outside the spec drafts"],
      [(p) => p.allow.push("Write"), "Write lets the coordinator edit outside"],
      [
        (p) => (p.deny = p.deny.filter((r) => !r.includes("agent-factory approve"))),
        "Bash(agent-factory approve) is missing",
      ],
      [
        (p) => (p.deny = p.deny.filter((r) => !r.includes("/starts/"))),
        "Edit(//home/ram/.factory/starts/**) is missing",
      ],
      [
        (p) => (p.deny = p.deny.filter((r) => !r.includes("agent-factory waive"))),
        "Bash(agent-factory waive) is missing",
      ],
      [
        (p) => (p.deny = p.deny.filter((r) => !r.includes("/waivers/"))),
        "Edit(//home/ram/.factory/waivers/**) is missing",
      ],
      [(p) => (p.deny = p.deny.filter((r) => r !== "Edit(~/.claude/**)")), "Edit(~/.claude/**) is missing"],
      // the settings layers (#229): the user file, the teams' clones, and the project home
      ...["user.json", "teams/**", "projects/**"].map(
        (tail): [(p: Rules & Record<string, unknown>) => void, string] => [
          (p) => (p.deny = p.deny.filter((r) => r !== `Edit(//home/ram/.factory/${tail})`)),
          `Edit(//home/ram/.factory/${tail}) is missing`,
        ],
      ),
      [(p) => (p.disableBypassPermissionsMode = "allow"), "bypass-permissions mode is not disabled"],
      [(p) => (p.defaultMode = "bypassPermissions"), "the default mode is bypassPermissions"],
    ];
    for (const [change, problem] of cases) {
      const found = wallProblems(loosened(change), PLACES).join("\n");
      expect({ problem, found: found.includes(problem) }).toEqual({ problem, found: true });
    }
    expect(wallProblems("not settings", PLACES).length).toBeGreaterThan(0);
  });

  it("matches Bash rules as Claude Code does: a trailing * also matches the bare command", () => {
    expect(bashReaches("Bash(agent-factory start *)", "agent-factory start ledger PROJ-1")).toBe(true);
    expect(bashReaches("Bash(agent-factory st*)", "agent-factory start ledger PROJ-1")).toBe(true);
    expect(bashReaches("Bash(agent-factory status *)", "agent-factory start ledger PROJ-1")).toBe(false);
    expect(bashReaches("Read(//x/**)", "gh api user")).toBe(false);
  });
});

describe("setup coordinator and the launcher (#106)", () => {
  let home = "";
  beforeEach(() => {
    home = tempDir("factory-coordinator-");
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const places = (): CoordinatorPlaces => ({ ...PLACES, factoryHome: home });
  const io = (calls: Parameters<Interactive>[0][]) => {
    const err: string[] = [];
    return {
      err,
      io: {
        env: { PATH: "/usr/bin" },
        out: () => undefined,
        err: (t: string) => void err.push(t),
        interactive: async (call: Parameters<Interactive>[0]) => (calls.push(call), 0),
      },
    };
  };

  it("writes the settings and the instructions read-only, and can run again", async () => {
    expect(await installCoordinator(places())).toEqual({ kind: "ok", value: join(home, "coordinator") });
    const file = join(home, "coordinator", ".claude", "settings.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(claudeSettings(places()));
    expect(statSync(file).mode & 0o777).toBe(0o444);
    expect(readFileSync(join(home, "coordinator", "CLAUDE.md"), "utf8")).toContain(
      "@/opt/agent-factory/prompts/coordinator.md",
    );
    expect(await installCoordinator(places())).toMatchObject({ kind: "ok" });
  });

  it("never writes through a symlink put in place of its folder", async () => {
    const elsewhere = join(home, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(home, "coordinator"));
    expect(await installCoordinator(places())).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("is a symlink"),
    });
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it("the orchestrator's check refuses missing or loosened settings, and passes the ones setup writes (#105)", async () => {
    expect(await checkWall(places())).toMatchObject({ reason: expect.stringContaining("run agent-factory setup") });
    await installCoordinator(places());
    expect(await checkWall(places())).toEqual({ kind: "ok" });
    const file = join(home, "coordinator", ".claude", "settings.json");
    const settings = claudeSettings(places());
    const loose = {
      ...settings,
      permissions: { ...settings.permissions, allow: [...settings.permissions.allow, "Bash(agent-factory approve *)"] },
    };
    rmSync(file);
    writeFileSync(file, JSON.stringify(loose));
    expect(await checkWall(places())).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("Bash(agent-factory approve *) lets the coordinator run"),
    });
    rmSync(file);
    writeFileSync(file, "{not json");
    expect(await checkWall(places())).toMatchObject({ reason: expect.stringContaining("not valid JSON") });
  });

  it("leaves the import out when the package path has a space, which an @import cannot hold", () => {
    expect(claudeMd({ ...PLACES, pkg: "/opt/agent factory" })).not.toContain("@/opt");
    expect(claudeMd(PLACES)).toContain("@/opt/agent-factory/prompts/coordinator.md");
  });

  it("refuses to start before setup; after it, starts Claude in its folder with only its own settings", async () => {
    const calls: Parameters<Interactive>[0][] = [];
    const before = io(calls);
    expect(await startCoordinator(places(), "claude", before.io)).toBe(1);
    expect(before.err.join("")).toContain("run agent-factory setup coordinator first");
    await installCoordinator(places());
    expect(await startCoordinator(places(), "claude", io(calls).io)).toBe(0);
    expect(await startCoordinator(places(), "copilot", io(calls).io)).toBe(0);
    expect(calls.map((c) => [c.bin, c.args.slice(0, 2), c.cwd])).toEqual([
      ["claude", ["--setting-sources", "project"], join(home, "coordinator")],
      ["copilot", ["--add-dir", `${home}/specs`], join(home, "coordinator")],
    ]);
  });
});
