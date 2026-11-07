// fence — text from a change, a rule file or a description, put in a Markdown fence it cannot close (#22 Q3). The fence
// is one backtick longer than the longest backtick run in the text (at least four), so no text can end the block early
// and forge a section of the pack.

function longestRun(text: string): number {
  return Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
}

// fence : "### title", then the text in a fence longer than any backtick run inside it
export function fence(input: { readonly title: string; readonly text: string; readonly info?: string }): string {
  const ticks = "`".repeat(Math.max(3, longestRun(input.text)) + 1);
  const body = input.text.endsWith("\n") || input.text === "" ? input.text : `${input.text}\n`;
  return `\n### ${input.title}\n\n${ticks}${input.info ?? ""}\n${body}${ticks}\n`;
}

// one fenced-code line: up to three spaces, then three or more backticks or tildes
const OPENER = /^ {0,3}(`+|~+)/;
const CLOSER = /^ {0,3}[`~]+ *$/;

type Open = { readonly kind: "prose" } | { readonly kind: "code"; readonly mark: string; readonly length: number };

type Step = { readonly state: Open; readonly keep: boolean };

function inProse(state: Open, run: string): Step {
  return run.length >= 3
    ? { state: { kind: "code", mark: run.charAt(0), length: run.length }, keep: false }
    : { state, keep: true };
}

function inCode(state: Extract<Open, { kind: "code" }>, run: string, line: string): Step {
  const closes = run.charAt(0) === state.mark && run.length >= state.length && CLOSER.test(line);
  return { state: closes ? { kind: "prose" } : state, keep: false };
}

function step(state: Open, line: string): Step {
  const run = OPENER.exec(line)?.[1] ?? "";
  return state.kind === "prose" ? inProse(state, run) : inCode(state, run, line);
}

// prose : the text with every fenced code block removed. A fence closes only on the same marker, at least as long
// (CommonMark), so a short fence inside a long one stays code. Code blocks are examples, never rules.
export function prose(text: string): string {
  let state: Open = { kind: "prose" };
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const next = step(state, line);
    state = next.state;
    if (next.keep) {
      kept.push(line);
    }
  }
  return kept.join("\n");
}
