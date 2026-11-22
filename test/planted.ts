// planted — the fake secrets and the planted code a test feeds to a check. A token is built from its parts here, and
// only here, so GitHub push protection stays on for test/ and still lets these through; a real token pasted into a
// test is caught. Code that a repository check must not find in test/ (a disable comment, an `as any`) lives as text
// in tests/fixtures/planted/, which every check skips.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PREFIX = {
  "github-classic": ["ghp", "_"],
  "github-oauth": ["gho", "_"],
  "github-fine": ["github", "_pat_"],
  gitlab: ["glpat", "-"],
  "claude-oauth": ["sk-ant", "-oat01-"],
  "anthropic-key": ["sk-ant", "-api03-"],
  "discord-bot": ["MTIzNDU2Nzg5MDEyMzQ1Njc4OQ", "."],
} as const;

export type TokenKind = keyof typeof PREFIX;

const BODY: Readonly<Record<TokenKind, string>> = {
  "github-classic": "a1B2".repeat(9),
  "github-oauth": "ABCDEFGHIJKLMNOPQRSTUVWX",
  "github-fine": "11ABCDEFG0123456789_abcdefghijklmnop",
  gitlab: "Zq7".repeat(7),
  "claude-oauth": "AAAAbbbbCCCCdddd",
  "anthropic-key": "x9".repeat(16),
  "discord-bot": "GaBcDe.abcdefghijklmnopqrstuvwxyz0123456789AB",
};

export function fakeToken(kind: TokenKind, body: string = BODY[kind]): string {
  return [...PREFIX[kind], body].join("");
}

export function planted(name: string): string {
  return readFileSync(join(import.meta.dirname, "..", "tests", "fixtures", "planted", name), "utf8");
}
