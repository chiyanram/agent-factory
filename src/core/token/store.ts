// store — where the model-only token is kept between runs (#136). Never in an env file or the project config.
//
//   macOS   the login Keychain, through `security`. The token goes in on stdin (`security -i`), never on the command
//           line, because every user on the machine can read a process's argv with ps.
//   Linux   a file of mode 0600 in a folder of mode 0700, owned by the user that runs the dispatcher (the `factory`
//           user on the VM). A headless server has no keychain; gh and docker keep their logins the same way. A file
//           that is a symlink, belongs to someone else or that group or others can read is refused, never read.
//
// The expiry is not secret, so both keep it in <home>/tokens.json. Nothing here prints or logs a token, and every
// outcome is a sealed result.

import { lstat, mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { Runner as Cli } from "../forge/api.js";
import { secret, type Meta, type Runner, type Secret } from "./rules.js";

export type Done = { readonly kind: "ok" } | { readonly kind: "failed"; readonly reason: string };
export type Stored =
  | { readonly kind: "found"; readonly token: Secret; readonly meta: Meta }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };
type Read =
  | { readonly kind: "found"; readonly token: Secret }
  | { readonly kind: "missing"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

export type TokenStore = {
  readonly where: string;
  put(input: { readonly runner: Runner; readonly token: Secret; readonly meta: Meta }): Promise<Done>;
  get(runner: Runner): Promise<Stored>;
};

type Vault = {
  readonly where: string;
  write(runner: Runner, token: Secret): Promise<Done>;
  read(runner: Runner): Promise<Read>;
};

const SERVICE = "agent-factory";
function setupHint(runner: Runner): string {
  return `run: agent-factory setup ${runner}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- the expiry, in <home>/tokens.json ---------------------------------------------------------------------------

async function readMetas(home: string): Promise<Readonly<Record<string, unknown>>> {
  try {
    const value = JSON.parse(await readFile(join(home, "tokens.json"), "utf8")) as unknown;
    return typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
  } catch {
    return {};
  }
}

function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

type MetaRead = { readonly kind: "meta"; readonly meta: Meta } | { readonly kind: "bad" };

function asMeta(value: unknown): MetaRead {
  const madeAt = field(value, "madeAt");
  const expiresAt = field(value, "expiresAt");
  return typeof madeAt === "string" && typeof expiresAt === "string"
    ? { kind: "meta", meta: { madeAt, expiresAt } }
    : { kind: "bad" };
}

// tokenRecord : a token's expiry on record in <home>/tokens.json, read without the token itself (#369: init checks a
// token's days left and never reads the secret); none when no expiry is on record
export async function tokenRecord(home: string, runner: Runner): Promise<Meta | "none"> {
  const meta = asMeta((await readMetas(home))[runner]);
  return meta.kind === "meta" ? meta.meta : "none";
}

async function writeMeta(home: string, runner: Runner, meta: Meta): Promise<Done> {
  try {
    const all = { ...(await readMetas(home)), [runner]: meta };
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(join(home, "tokens.json"), `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    return { kind: "ok" };
  } catch (error) {
    return { kind: "failed", reason: `cannot write ${join(home, "tokens.json")}: ${message(error)}` };
  }
}

function withMeta(vault: Vault, home: string): TokenStore {
  return {
    where: vault.where,
    put: async ({ runner, token, meta }) => {
      const written = await vault.write(runner, token);
      return written.kind === "ok" ? writeMeta(home, runner, meta) : written;
    },
    get: async (runner) => {
      const read = await vault.read(runner);
      if (read.kind !== "found") {
        return read;
      }
      const meta = asMeta((await readMetas(home))[runner]);
      return meta.kind === "meta"
        ? { kind: "found", token: read.token, meta: meta.meta }
        : { kind: "missing", reason: `the ${runner} token has no expiry on record; ${setupHint(runner)}` };
    },
  };
}

// --- macOS Keychain ----------------------------------------------------------------------------------------------

export function keychainVault(run: Cli, env: NodeJS.ProcessEnv): Vault {
  return {
    where: "the macOS login Keychain",
    write: async (runner, token) => {
      // checkToken allows only [A-Za-z0-9._-] and checkWebhook a Discord URL of letters, digits, ".", "/", ":", "_"
      // and "-": neither holds a space, a quote or a backslash, so the line needs no quoting
      const exit = await run({
        bin: "security",
        args: ["-i"],
        stdin: `add-generic-password -U -s ${SERVICE} -a ${runner} -w ${token.reveal()}\n`,
        env,
      });
      return exit.code === 0 && !/error/i.test(exit.stderr)
        ? { kind: "ok" }
        : { kind: "failed", reason: `security could not store the ${runner} token (exit ${exit.code})` };
    },
    read: async (runner) => {
      const exit = await run({
        bin: "security",
        args: ["find-generic-password", "-s", SERVICE, "-a", runner, "-w"],
        stdin: "",
        env,
      });
      if (exit.code === 0) {
        return { kind: "found", token: secret(exit.stdout.trim()) };
      }
      return /could not be found/i.test(exit.stderr)
        ? { kind: "missing", reason: `no ${runner} token in the Keychain; ${setupHint(runner)}` }
        : { kind: "failed", reason: `security could not read the ${runner} token (exit ${exit.code})` };
    },
  };
}

// --- Linux file --------------------------------------------------------------------------------------------------

export type Owner = { readonly uid: number };

export type FileStat = {
  readonly isFile: boolean;
  readonly isSymlink: boolean;
  readonly mode: number;
  readonly uid: number;
};

type FileRule = {
  readonly fails: (stat: FileStat, owner: Owner) => boolean;
  readonly why: (stat: FileStat, owner: Owner) => string;
};

const FILE_RULES: readonly FileRule[] = [
  { fails: (s) => s.isSymlink, why: () => "it is a symlink" },
  { fails: (s) => !s.isFile && !s.isSymlink, why: () => "it is not a regular file" },
  { fails: (s, o) => s.uid !== o.uid, why: (s, o) => `it belongs to uid ${s.uid}, not ${o.uid}` },
  {
    fails: (s) => (s.mode & 0o077) !== 0,
    why: (s) => `group or others can read it (mode ${(s.mode & 0o777).toString(8)})`,
  },
];

// unsafeFile : every reason a token file may not be read; empty when it may. Pure.
export function unsafeFile(stat: FileStat, owner: Owner): readonly string[] {
  return FILE_RULES.filter((r) => r.fails(stat, owner)).map((r) => r.why(stat, owner));
}

async function readTokenFile(file: string, owner: Owner): Promise<Read> {
  const stat = await lstat(file);
  const problems = unsafeFile(
    { isFile: stat.isFile(), isSymlink: stat.isSymbolicLink(), mode: stat.mode, uid: stat.uid },
    owner,
  );
  if (problems.length > 0) {
    return { kind: "failed", reason: `refused to read ${file}: ${problems.join("; ")}` };
  }
  return { kind: "found", token: secret((await readFile(file, "utf8")).trim()) };
}

export function fileVault(home: string, owner: Owner): Vault {
  const dir = join(home, "secrets");
  const fileOf = (runner: Runner): string => join(dir, `${runner}-token`);
  return {
    where: dir,
    write: async (runner, token) => {
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await chmod(dir, 0o700);
        await writeFile(fileOf(runner), `${token.reveal()}\n`, { mode: 0o600 });
        await chmod(fileOf(runner), 0o600);
        return { kind: "ok" };
      } catch (error) {
        return { kind: "failed", reason: `cannot write ${fileOf(runner)}: ${message(error)}` };
      }
    },
    read: async (runner) => {
      try {
        return await readTokenFile(fileOf(runner), owner);
      } catch {
        return { kind: "missing", reason: `no ${runner} token at ${fileOf(runner)}; ${setupHint(runner)}` };
      }
    },
  };
}

// --- which store --------------------------------------------------------------------------------------------------

export type Opened =
  | { readonly kind: "store"; readonly store: TokenStore }
  | { readonly kind: "refused"; readonly reason: string };

type Place = { readonly platform: NodeJS.Platform; readonly open: (input: StoreInput) => TokenStore };
export type StoreInput = {
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly owner: Owner;
  readonly run: Cli;
  readonly env: NodeJS.ProcessEnv;
};

const PLACES: readonly Place[] = [
  { platform: "darwin", open: (i) => withMeta(keychainVault(i.run, i.env), i.home) },
  { platform: "linux", open: (i) => withMeta(fileVault(i.home, i.owner), i.home) },
];

export function openStore(input: StoreInput): Opened {
  const place = PLACES.find((p) => p.platform === input.platform);
  return place === undefined
    ? { kind: "refused", reason: `no token store for ${input.platform}; macOS and Linux are supported` }
    : { kind: "store", store: place.open(input) };
}
