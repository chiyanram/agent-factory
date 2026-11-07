// prompt — reads a pasted secret without showing it (#136). On a terminal, echo is off and each key is read raw until
// Enter; Ctrl-C gives up. Off a terminal (a pipe, a test), it reads the whole input. The text is never written back.

export function readHidden(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  return process.stdin.isTTY ? readRaw() : readAll();
}

function readAll(): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
  });
}

const CTRL_C = "\u0003";
const STOPS = ["\r", "\n", CTRL_C];

// the first Enter or Ctrl-C in a chunk, or -1
function stopAt(chunk: string): number {
  const found = STOPS.map((c) => chunk.indexOf(c)).filter((i) => i >= 0);
  return found.length === 0 ? -1 : Math.min(...found);
}

function readRaw(): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    const stop = (value: string): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onKey);
      process.stderr.write("\n");
      resolve(value);
    };
    const onKey = (chunk: string): void => {
      const at = stopAt(chunk);
      if (at < 0) {
        text += chunk;
        return;
      }
      stop(chunk[at] === CTRL_C ? "" : text + chunk.slice(0, at));
    };
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    process.stdin.on("data", onKey);
  });
}
