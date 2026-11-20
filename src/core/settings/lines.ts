// lines — the line of each key in a JSON file's text, so config show and a refusal can name `file:line` (#229), and
// the span of its value, so config set can change one value and keep every other byte. It reads only what JSON.parse
// already accepted, so it never decides whether a file is valid: a path it cannot place gets line 0.

type Cursor = { i: number; line: number };

// where a key is: the line its name starts on, and its value as text[start, end)
export type Place = { readonly line: number; readonly start: number; readonly end: number };

type Found = Map<string, Place>;

// the path of a key as one string: its parts joined by NUL, which no key holds
export function pathKey(path: readonly string[]): string {
  return path.join("\u0000");
}

function skipBlank(text: string, at: Cursor): void {
  while (at.i < text.length && " \t\r\n".includes(text.charAt(at.i))) {
    at.line += text.charAt(at.i) === "\n" ? 1 : 0;
    at.i += 1;
  }
}

function readString(text: string, at: Cursor): string {
  const start = at.i;
  at.i += 1;
  while (at.i < text.length && text.charAt(at.i) !== '"') {
    at.i += text.charAt(at.i) === "\\" ? 2 : 1;
  }
  at.i += 1;
  return String(JSON.parse(text.slice(start, at.i)));
}

function skipScalar(text: string, at: Cursor): void {
  while (at.i < text.length && !",}] \t\r\n".includes(text.charAt(at.i))) {
    at.i += 1;
  }
}

// readValue : the value at the cursor, from its first character; returns where it starts
function readValue(text: string, at: Cursor, path: readonly string[], found: Found): number {
  skipBlank(text, at);
  const start = at.i;
  const c = text.charAt(at.i);
  if (c === "{") {
    readObject(text, at, path, found);
  } else if (c === "[") {
    readArray(text, at, path, found);
  } else if (c === '"') {
    readString(text, at);
  } else {
    skipScalar(text, at);
  }
  return start;
}

function readObject(text: string, at: Cursor, path: readonly string[], found: Found): void {
  at.i += 1;
  skipBlank(text, at);
  while (at.i < text.length && text.charAt(at.i) !== "}") {
    const line = at.line;
    const key = readString(text, at);
    skipBlank(text, at);
    at.i += 1; // the colon
    const start = readValue(text, at, [...path, key], found);
    found.set(pathKey([...path, key]), { line, start, end: at.i });
    skipBlank(text, at);
    at.i += text.charAt(at.i) === "," ? 1 : 0;
    skipBlank(text, at);
  }
  at.i += 1;
}

function readArray(text: string, at: Cursor, path: readonly string[], found: Found): void {
  at.i += 1;
  skipBlank(text, at);
  while (at.i < text.length && text.charAt(at.i) !== "]") {
    readValue(text, at, path, found);
    skipBlank(text, at);
    at.i += text.charAt(at.i) === "," ? 1 : 0;
    skipBlank(text, at);
  }
  at.i += 1;
}

// keyPlaces : the place of every key path in a JSON text that JSON.parse accepted; the whole value is at path []
export function keyPlaces(text: string): ReadonlyMap<string, Place> {
  const found: Found = new Map();
  const at = { i: 0, line: 1 };
  skipBlank(text, at);
  const line = at.line;
  const start = readValue(text, at, [], found);
  found.set(pathKey([]), { line, start, end: at.i });
  return found;
}

// keyLines : the line (from 1) of every key path in a JSON text that JSON.parse accepted
export function keyLines(text: string): ReadonlyMap<string, number> {
  return new Map([...keyPlaces(text)].map(([path, place]) => [path, place.line]));
}
