// srt-toolchains — the toolchain folders under the person's home that the srt runner allows back, read-only (#371;
// the operator's hybrid model on #30, 2026-11-10: the project declares its toolchain in its own file, such as
// mise.toml, .tool-versions or .sdkmanrc, and the runner provides it). The home stays hidden (#114, choice A): only
// these folders come back, never the home itself, never a manager's config or shims, and never a folder that is or
// holds a credential path (srt-plan.ts secretPaths). Nothing here throws.
//
//   a known manager    present when a PATH entry lies inside its install folder; then that whole folder comes back
//   runner.readOnly    a list of folders under the home (~/x or an absolute path), an allow-list key read through
//                      settingOf; an entry that breaks a rule is refused with the reason, and the probe refuses to start
//   shims              a PATH that reaches a manager only through its shims gets a warning that says how to put the real
//                      install folders on PATH, since the shims need the manager's config, which stays hidden
//
// Each folder allowed back is a risk line in `agent-factory setup status`.

import { realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, normalize, relative } from "node:path";
import { settingName, settingOf } from "../settings/machine.js";
import { FOLDERS_HINT, listText } from "../settings/variables.js";
import { secretPaths } from "./srt-plan.js";
import { under } from "./srt-programs.js";

// one toolchain manager, its folders relative to the home
export type Manager = {
  readonly name: string;
  // where it keeps its toolchains: allowed back read-only when PATH reaches inside it
  readonly installs: string;
  // its shims: never allowed back
  readonly shims: readonly string[];
  // its config, which can hold secrets (mise's `env`): never allowed back
  readonly config: readonly string[];
  // what to do when PATH reaches it only through its shims
  readonly fix: string;
};

// the known toolchain managers, one row each (#371)
export const MANAGERS: readonly Manager[] = [
  {
    name: "mise",
    installs: ".local/share/mise/installs",
    shims: [".local/share/mise/shims"],
    config: [".config/mise", ".mise.toml"],
    fix: "use `mise activate` (not `--shims`), so PATH holds the real install folders",
  },
  {
    name: "SDKMAN!",
    installs: ".sdkman/candidates",
    shims: [],
    config: [".sdkman/etc"],
    fix: "source sdkman-init.sh, so PATH holds the candidates' folders",
  },
  {
    name: "asdf",
    installs: ".asdf/installs",
    shims: [".asdf/shims"],
    config: [".asdfrc"],
    fix: "put the install's bin folder on PATH, such as ~/.asdf/installs/java/<version>/bin",
  },
  {
    name: "nvm",
    installs: ".nvm/versions",
    shims: [],
    config: [],
    fix: "run `nvm use`, so PATH holds the Node's own folder",
  },
];

// one folder allowed back, and why: a manager's name, or runner.readOnly
export type Toolchain = { readonly dir: string; readonly from: string };

export type Toolchains = {
  readonly allowed: readonly Toolchain[];
  // each runner.readOnly entry refused, with the reason
  readonly refused: readonly string[];
  // each manager PATH reaches only through its shims
  readonly warnings: readonly string[];
};

export const NO_TOOLCHAINS: Toolchains = { allowed: [], refused: [], warnings: [] };

// tilde : a path under the home as ~/x, for a message. Pure.
export function tilde(path: string, home: string): string {
  return path === home ? "~" : under(path, home) ? `~/${relative(home, path)}` : path;
}

// hidden : every path under the home a folder allowed back may never be or hold, and what it is. Pure.
function hidden(home: string, factoryHome: string): readonly { readonly path: string; readonly what: string }[] {
  const secrets = secretPaths(home, factoryHome).map((path) => ({
    path,
    what: path === factoryHome ? "the factory home" : "a credential path",
  }));
  const managers = MANAGERS.flatMap((m) => [
    ...m.config.map((p) => ({ path: join(home, p), what: `${m.name}'s config` })),
    ...m.shims.map((p) => ({ path: join(home, p), what: `${m.name}'s shims` })),
  ]);
  return [...secrets, ...managers];
}

// folderProblem : why a folder may not come back, or "" when it may: it must be under the home, not the home itself,
// and neither be nor hold a credential path, the factory home, or a manager's config or shims. Pure.
export function folderProblem(dir: string, home: string, factoryHome: string): string {
  if (dir === home) {
    return "is your home itself, which the srt runner hides";
  }
  if (!under(dir, home)) {
    return "is not under your home; list only folders under it (one outside it is not hidden)";
  }
  const near = hidden(home, factoryHome).find((h) => under(dir, h.path) || under(h.path, dir));
  return near === undefined ? "" : `is or holds ${tilde(near.path, home)}, ${near.what}, which no run may read`;
}

// expand : one runner.readOnly entry as an absolute path: ~ and ~/x are under the home; undefined for any other
// relative path. Pure.
export function expand(entry: string, home: string): string | undefined {
  if (entry === "~" || entry.startsWith("~/")) {
    return normalize(join(home, entry.slice(1)));
  }
  return isAbsolute(entry) ? normalize(entry) : undefined;
}

// managersOn : each manager whose install folder a PATH entry lies inside, with that folder. Pure.
export function managersOn(path: readonly string[], home: string): readonly Toolchain[] {
  return MANAGERS.flatMap((m) => {
    const installs = join(home, m.installs);
    return path.some((p) => under(p, installs) && p !== installs) ? [{ dir: installs, from: m.name }] : [];
  });
}

// shimWarnings : a warning for each manager PATH reaches only through its shims. Pure.
export function shimWarnings(path: readonly string[], home: string): readonly string[] {
  return MANAGERS.flatMap((m) => {
    const shims = m.shims.map((s) => join(home, s)).filter((s) => path.some((p) => under(p, s)));
    const installs = join(home, m.installs);
    return shims.length > 0 && !path.some((p) => under(p, installs))
      ? [
          `PATH reaches ${m.name} only through its shims (${shims.map((s) => tilde(s, home)).join(", ")}), which the srt runner never allows back, so its programs will not run there: ${m.fix}`,
        ]
      : [];
  });
}

async function real(path: string): Promise<string> {
  return realpath(path).catch(() => path);
}

async function isDir(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

type Checked = { readonly kind: "ok"; readonly dir: string } | { readonly kind: "refused"; readonly reason: string };

// checkEntry : one runner.readOnly entry, at its real path, or why it is refused
async function checkEntry(entry: string, home: string, factoryHome: string): Promise<Checked> {
  const name = `runner.readOnly ${JSON.stringify(entry)}`;
  const path = expand(entry, home);
  if (path === undefined) {
    return { kind: "refused", reason: `${name} must be ~/<folder> or an absolute path` };
  }
  const dir = await real(path);
  if (!(await isDir(dir))) {
    return { kind: "refused", reason: `${name} is not a folder` };
  }
  const problem = folderProblem(dir, home, factoryHome);
  return problem === "" ? { kind: "ok", dir } : { kind: "refused", reason: `${name} ${problem}` };
}

// readOnlyEntries : runner.readOnly as a list, or why it is not one
function readOnlyEntries(env: NodeJS.ProcessEnv): readonly string[] | "bad" {
  const text = settingOf(env, "runner.readOnly");
  return text === undefined ? [] : listText(text);
}

// fromSetting : the folders runner.readOnly allows back, and the entries it refuses
async function fromSetting(
  env: NodeJS.ProcessEnv,
  home: string,
  factoryHome: string,
): Promise<Pick<Toolchains, "allowed" | "refused">> {
  const entries = readOnlyEntries(env);
  if (entries === "bad") {
    return { allowed: [], refused: [`${settingName("runner.readOnly")} must be ${FOLDERS_HINT}`] };
  }
  const checked = await Promise.all(entries.map((e) => checkEntry(e, home, factoryHome)));
  return {
    allowed: checked.flatMap((c) => (c.kind === "ok" ? [{ dir: c.dir, from: "runner.readOnly" }] : [])),
    refused: checked.flatMap((c) => (c.kind === "refused" ? [c.reason] : [])),
  };
}

// fromManagers : each detected manager's install folder, at its real path, when it is a folder that may come back
async function fromManagers(path: readonly string[], home: string, factoryHome: string): Promise<readonly Toolchain[]> {
  const found = await Promise.all(
    managersOn(path, home).map(async (t) => {
      const dir = await real(t.dir);
      return (await isDir(dir)) && folderProblem(dir, home, factoryHome) === "" ? [{ dir, from: t.from }] : [];
    }),
  );
  return found.flat();
}

// locateToolchains : the toolchain folders under `home` the srt runner allows back read-only, the runner.readOnly
// entries it refuses, and the shims warnings
export async function locateToolchains(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly home: string;
  readonly factoryHome: string;
}): Promise<Toolchains> {
  const home = await real(input.home);
  const factoryHome = await real(input.factoryHome);
  const raw = (input.env.PATH ?? "").split(delimiter).filter((p) => p.startsWith("/"));
  const path = await Promise.all(raw.map(real));
  const managers = await fromManagers(path, home, factoryHome);
  const setting = await fromSetting(input.env, home, factoryHome);
  const all = [...managers, ...setting.allowed];
  const allowed = all.filter((t, i) => all.findIndex((o) => o.dir === t.dir) === i);
  return { allowed, refused: setting.refused, warnings: shimWarnings(path, home) };
}

// toolchainLines : what `setup status` prints for the srt runner's toolchains: a risk line per folder allowed back,
// then each refusal and warning. Pure.
export function toolchainLines(toolchains: Toolchains, home: string): readonly string[] {
  return [
    ...toolchains.allowed.map(
      (t) =>
        `risk: the run reads ${tilde(t.dir, home)} (${t.from}), read-only: a secret kept in it can be read by the run`,
    ),
    ...toolchains.refused.map((r) => `refused: ${r}`),
    ...toolchains.warnings.map((w) => `warning: ${w}`),
  ];
}
