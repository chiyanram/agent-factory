import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { claudeMd, claudeSettings, copilotArgs, type CoordinatorPlaces } from "../src/core/coordinator.js";
import { installCoordinator, startCoordinator, type Interactive } from "../src/coordinator-cli.js";

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
      "/opt/agent-factory/GUIDE.md",
      "/home/ram/.factory/coordinator/.claude/settings.json",
      "/home/ram/.factory/coordinator/CLAUDE.md",
      `${HOME}/.claude/settings.json`,
      "/work/project/.claude/settings.local.json",
      "/home/ram/.factory/approvals/ledger/PROJ-1.json",
      "/home/ram/.factory/projects/ledger.json",
      "/home/ram/.factory/runs/ledger/PROJ-1.jsonl",
      "/home/ram/.factory/review-runs/x/pack.md",
      "/home/ram/.factory/box-runs/x/code/Makefile",
      "/home/ram/.factory/egress/ledger/squid.conf",
    ]) {
      expect({ path, v: verdict("Edit", path) }).toEqual({ path, v: "deny" });
    }
  });

  it("lets it edit only spec drafts with no prompt; any other edit asks the person", () => {
    expect(verdict("Edit", "/home/ram/.factory/specs/ledger/PROJ-1/spec.md")).toBe("allow");
    expect(verdict("Edit", "/work/project/src/app.ts")).toBe("prompt");
  });

  it("runs the read commands and status with no prompt; approve and every start command ask", () => {
    for (const command of [
      "agent-factory poll",
      "agent-factory poll --json",
      "agent-factory spec ledger PROJ-1",
      "agent-factory approval ledger PROJ-1",
      'agent-factory status 12 aaaa1111 "writer started"',
    ]) {
      expect({ command, v: verdict("Bash", command) }).toEqual({ command, v: "allow" });
    }
    for (const command of [
      `agent-factory approve ledger PROJ-1 ${"a".repeat(64)}`,
      "agent-factory claim 12",
      "agent-factory release 12",
      "agent-factory block 12 why",
      "agent-factory reconcile",
      "agent-factory review 12",
      "agent-factory dispatch ledger --once",
      "agent-factory setup claude",
      "/opt/agent-factory/scripts/start-writer.sh 12",
    ]) {
      expect({ command, v: verdict("Bash", command) }).toEqual({ command, v: "ask" });
    }
  });

  it("denies raw forge and network clients, git push, a second interpreter or shell, sudo and the App's token", () => {
    for (const command of [
      "gh api repos/o/r",
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
      "agent-factory ask 12 aaaa1111 q",
      "security find-generic-password -s x",
      "chmod 644 /home/ram/.factory/coordinator/.claude/settings.json",
    ]) {
      expect({ command, v: verdict("Bash", command) }).toEqual({ command, v: "deny" });
    }
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

  it("gives Copilot the same denies and read commands as flags; what is not allowed asks there", () => {
    const args = copilotArgs(PLACES);
    expect(args).toContain("shell(gh)");
    expect(args).toContain("shell(sudo)");
    expect(args).toContain("shell(agent-factory poll)");
    expect(args.join(" ")).not.toContain("shell(agent-factory approve)");
    expect(args.slice(0, 2)).toEqual(["--add-dir", "/home/ram/.factory/specs"]);
  });
});

describe("setup coordinator and the launcher (#106)", () => {
  let home = "";
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "factory-coordinator-"));
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
    expect(readFileSync(join(home, "coordinator", "CLAUDE.md"), "utf8")).toContain("@/opt/agent-factory/GUIDE.md");
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

  it("leaves the import out when the package path has a space, which an @import cannot hold", () => {
    expect(claudeMd({ ...PLACES, pkg: "/opt/agent factory" })).not.toContain("@/opt");
    expect(claudeMd(PLACES)).toContain("@/opt/agent-factory/GUIDE.md");
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
