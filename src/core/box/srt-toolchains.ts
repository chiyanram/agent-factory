// srt-toolchains — the toolchain folders under the person's home that the srt runner allows back, read-only (#371).
// The project declares its toolchain in its own file, such as mise.toml, .tool-versions or .sdkmanrc, and the runner
// provides it. The home stays hidden: only these folders come back, never the home itself, never a manager's config
// (it can hold secrets, such as mise's `env`) or shims, and never a folder that is or holds a credential path
// (srt-plan.ts secretPaths). Nothing here throws.
//
//   a known manager    present when a PATH entry lies inside its install folder; then that whole folder comes back
//   srt.readOnly       a list of folders under the home (~/x or an absolute path), an allow-list key read through
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

export type Manager = {
  readonly name: string;
  readonly installs: string;
  readonly shims: readonly string[];
  readonly config: readonly string[];
  readonly fix: string;
};

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

export type Toolchain = { readonly dir: string; readonly from: string };

export type Toolchains = {
  readonly allowed: readonly Toolchain[];
  readonly refused: readonly string[];
  readonly warnings: readonly string[];
};

export const NO_TOOLCHAINS: Toolchains = { allowed: [], refused: [], warnings: [] };

export function tilde(path: string, home: string): string {
  return path === home ? "~" : under(path, home) ? `~/${relative(home, path)}` : path;
}

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

export function expand(entry: string, home: string): string | undefined {
  if (entry === "~" || entry.startsWith("~/")) {
    return normalize(join(home, entry.slice(1)));
  }
  return isAbsolute(entry) ? normalize(entry) : undefined;
}

export function managersOn(path: readonly string[], home: string): readonly Toolchain[] {
  return MANAGERS.flatMap((m) => {
    const installs = join(home, m.installs);
    return path.some((p) => under(p, installs) && p !== installs) ? [{ dir: installs, from: m.name }] : [];
  });
}

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

async function checkEntry(entry: string, home: string, factoryHome: string): Promise<Checked> {
  const name = `srt.readOnly ${JSON.stringify(entry)}`;
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

function readOnlyEntries(env: NodeJS.ProcessEnv): readonly string[] | "bad" {
  const text = settingOf(env, "srt.readOnly");
  return text === undefined ? [] : listText(text);
}

async function fromSetting(
  env: NodeJS.ProcessEnv,
  home: string,
  factoryHome: string,
): Promise<Pick<Toolchains, "allowed" | "refused">> {
  const entries = readOnlyEntries(env);
  if (entries === "bad") {
    return { allowed: [], refused: [`${settingName("srt.readOnly")} must be ${FOLDERS_HINT}`] };
  }
  const checked = await Promise.all(entries.map((e) => checkEntry(e, home, factoryHome)));
  return {
    allowed: checked.flatMap((c) => (c.kind === "ok" ? [{ dir: c.dir, from: "srt.readOnly" }] : [])),
    refused: checked.flatMap((c) => (c.kind === "refused" ? [c.reason] : [])),
  };
}

async function fromManagers(path: readonly string[], home: string, factoryHome: string): Promise<readonly Toolchain[]> {
  const found = await Promise.all(
    managersOn(path, home).map(async (t) => {
      const dir = await real(t.dir);
      return (await isDir(dir)) && folderProblem(dir, home, factoryHome) === "" ? [{ dir, from: t.from }] : [];
    }),
  );
  return found.flat();
}

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
