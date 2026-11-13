// trace-cli — agent-factory trace <project> <ticket> [<name>] (#487): the ticket's run traces, newest first, with the
// time, kind, size and the record line that names each; or one trace's text. It deletes the project's traces older
// than 30 days first, as each orchestrator pass does (src/core/dispatch/trace.ts). It reads only, apart from that.

import { plainName } from "./core/spec.js";
import { listTraces, pruneTraces, readTrace, TRACE_DAYS, type TraceListed } from "./core/dispatch/trace.js";

export type TraceIo = {
  readonly home: string;
  readonly now: () => number;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
};

export const TRACE_HELP = `  trace <project> <ticket> [<name>]
                               the ticket's run traces, newest first, with the record line that names each; with a
                               name, that trace's text. Traces are kept ${TRACE_DAYS} days
`;

const FORM = "usage: agent-factory trace <project> <ticket> [<name>]\n";

// sizeOf : a size a person reads: bytes, KB or MB. Pure.
export function sizeOf(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// listLine : one trace as the list shows it. Pure.
function listLine(t: TraceListed): string {
  return `${t.at}  ${t.kind}  ${sizeOf(t.bytes)}  ${t.line ?? "no record line names it"}  ${t.name}`;
}

async function list(io: TraceIo, where: { home: string; project: string; ticket: string }): Promise<number> {
  const listed = await listTraces(where);
  if (listed.kind === "failed") {
    io.err(`agent-factory trace: ${listed.reason}\n`);
    return 1;
  }
  io.out(`traces of ${where.project} ${where.ticket}, newest first, kept ${TRACE_DAYS} days (times in UTC)\n`);
  if (listed.value.length === 0) {
    io.out("none\n");
  }
  for (const t of listed.value) {
    io.out(`${listLine(t)}\n`);
  }
  return 0;
}

async function show(io: TraceIo, where: { home: string; project: string; ticket: string }, name: string) {
  const read = await readTrace(where, name, io.now());
  switch (read.kind) {
    case "ok":
      io.out(read.value);
      return 0;
    case "deleted":
      io.err(`agent-factory trace: ${name} was deleted after ${TRACE_DAYS} days\n`);
      return 1;
    case "failed":
      io.err(`agent-factory trace: ${read.reason}\n`);
      return 1;
  }
}

// Words : the command line, read: a project and a ticket, each a plain name, and an optional trace name
type Words = { readonly project: string; readonly ticket: string; readonly name?: string };

// wordsOf : the command line's words, or none when they are not a project, a ticket and an optional name. Pure.
function wordsOf(positionals: readonly string[]): Words | undefined {
  const [project = "", ticket = "", ...rest] = positionals;
  const plain = rest.length <= 1 && [project, ticket].every(plainName);
  return plain ? { project, ticket, ...nameOf(rest) } : undefined;
}

// nameOf : the trace's name, as a field to spread; none when the command line names none. Pure.
function nameOf(rest: readonly string[]): { readonly name?: string } {
  const [name] = rest;
  return name === undefined ? {} : { name };
}

// traceCommand : the list, or one trace, on stdout; a problem on stderr, and exits 1
export async function traceCommand(positionals: readonly string[], io: TraceIo): Promise<number> {
  const words = wordsOf(positionals);
  if (words === undefined) {
    io.err(FORM);
    return 64;
  }
  const pruned = await pruneTraces({ home: io.home, project: words.project, now: io.now() });
  for (const problem of pruned.problems) {
    io.err(`agent-factory trace: ${problem}\n`);
  }
  const where = { home: io.home, project: words.project, ticket: words.ticket };
  return words.name === undefined ? list(io, where) : show(io, where, words.name);
}
