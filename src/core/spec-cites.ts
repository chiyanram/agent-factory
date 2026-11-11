// spec-cites — the cites a spec or design makes, checked by code before the design review (#489; #456 item 13). A
// claim about today's code is written as `file:line@commit`: the commit pins it, so a later commit never makes it
// wrong. Each must name a commit in the project's clone, a file in that commit's tree, and a line within that file; a
// cite that does not stops the spec, named, so the design review's rounds go to the design, not to line numbers.
//
//   src/core/loop.ts:42@1a2b3c4      one line
//   src/core/loop.ts:42-50@1a2b3c4   a range, checked by its end line
//
// The commit is 7 to 40 hex characters. Text that is not in this form is not a cite here. The repo is read only
// through hostGit.

import { hostGit } from "./git.js";

export type SpecCite = {
  readonly text: string;
  readonly file: string;
  readonly line: number;
  readonly end: number;
  readonly commit: string;
};

const CITE = /(?<![\w./-])((?:[\w.-]+\/)*[\w.-]+\.[\w]+):(\d+)(?:-(\d+))?@([0-9a-f]{7,40})\b/g;

// specCites : every `file:line@commit` in the text, each once. Pure.
export function specCites(text: string): readonly SpecCite[] {
  const seen = new Map<string, SpecCite>();
  for (const m of text.matchAll(CITE)) {
    seen.set(m[0], citeOf(m));
  }
  return [...seen.values()];
}

// citeOf : one match as a cite: a single line ends where it starts. Pure.
function citeOf(m: RegExpMatchArray): SpecCite {
  const line = Number(m[2]);
  return { text: m[0], file: m[1] ?? "", line, end: m[3] === undefined ? line : Number(m[3]), commit: m[4] ?? "" };
}

type Repo = { readonly repo: string; readonly env: NodeJS.ProcessEnv };

async function git(at: Repo, args: readonly string[]): Promise<string | undefined> {
  const ran = await hostGit({ args, repo: { kind: "repo", path: at.repo }, env: at.env, stdin: { kind: "none" } });
  return ran.kind === "ok" ? ran.stdout : undefined;
}

function lines(text: string): number {
  return text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

// citeBroken : why one cite does not hold in the clone; "" when it does
async function citeBroken(at: Repo, c: SpecCite): Promise<string> {
  const commit = await git(at, ["rev-parse", "--verify", "-q", `${c.commit}^{commit}`]);
  if (commit === undefined) {
    return `${c.text}: ${c.commit} is not a commit in the project's clone (fetch it, or cite one that is)`;
  }
  const text = await fileAt(at, commit.trim(), c.file);
  return text === undefined ? `${c.text}: ${c.file} is not in ${c.commit}` : linesBroken(c, lines(text));
}

// fileAt : a file's text at a commit, undefined when it is not there or its path is not a plain path
async function fileAt(at: Repo, commit: string, file: string): Promise<string | undefined> {
  return file.startsWith("-") || file.includes("..") ? undefined : git(at, ["show", `${commit}:${file}`]);
}

// linesBroken : why a cite's lines are not in a file of n lines; "" when they are. Pure.
function linesBroken(c: SpecCite, n: number): string {
  const within = c.line >= 1 && c.end >= c.line && c.end <= n;
  return within ? "" : `${c.text}: the file has ${n} lines at ${c.commit}`;
}

// brokenCites : one line per cite in the texts that does not hold in the clone; none when every cite holds
export async function brokenCites(at: Repo, texts: readonly string[]): Promise<readonly string[]> {
  const out: string[] = [];
  for (const cite of specCites(texts.join("\n"))) {
    const why = await citeBroken(at, cite);
    if (why !== "") {
      out.push(why);
    }
  }
  return out;
}
