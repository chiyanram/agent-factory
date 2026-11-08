import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { claudeSettings, copilotArgs, type CoordinatorPlaces } from "../src/core/coordinator.js";
import { installCoordinator, startCoordinator, type Interactive } from "../src/coordinator-cli.js";

const PLACES: CoordinatorPlaces = {
  pkg: "/opt/agent-factory",
  factoryHome: "/home/ram/.factory",
  botHome: "/home/factory",
};
const HOME = homedir();

// Claude Code's documented rule matching (permissions docs): a path rule is gitignore-style, ~/ is the home, // the
// root, ** any depth and a bare **/x any folder; a Bash rule matches the command as typed, * any text.
function pathRegex(rule: string): RegExp {
  const path = rule.startsWith("~/") ? `${HOME}/${rule.slice(2)}` : rule.startsWith("//") ? rule.slice(1) : rule;
  const body = path
    .split(/(\*\*\/|\*\*|\*)/)
    .map((part) => {
      if (part === "**/") {
        return "(?:.*/)?";
      }
      if (part === "**") {
        return ".*";
      }
      return part === "*" ? "[^/]*" : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(path.startsWith("/") ? `^${body}$` : `(^|/)${body}$`);
}

function bashRegex(rule: string): RegExp {
  return new RegExp(
    `^${rule
      .split("*")
      .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  );
}

function ruleOf(rules: readonly string[], tool: "Read" | "Edit" | "Bash", target: string): boolean {
  return rules
    .filter((r) => r.startsWith(`${tool}(`))
    .map((r) => r.slice(tool.length + 1, -1))
    .some((spec) => (tool === "Bash" ? bashRegex(spec) : pathRegex(spec)).test(target));
}

// what Claude Code does with one call: deny, then ask, then allow; else it asks
function verdict(tool: "Read" | "Edit" | "Bash", target: string): "deny" | "ask" | "allow" | "prompt" {
  const p = claudeSettings(PLACES).permissions;
  if (ruleOf(p.deny, tool, target)) {
    return "deny";
  }
  if (ruleOf(p.ask, tool, target)) {
    return "ask";
  }
  return ruleOf(p.allow, tool, target) ? "allow" : "prompt";
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
