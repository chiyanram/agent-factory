// only a real answer closes a question, and it reaches the next run as a typed field (#486; P13)
import { describe, expect, it } from "vitest";
import { answersIn, answersText, questionsIn, roundOf } from "../src/core/answers.js";
import { lastAnswers, openAsks, type Note, type Readers } from "../src/core/notes.js";
import { renderPost } from "../src/core/post.js";

const readers: Readers = { factory: "ram", members: new Set(["ram", "lee"]) };
let clock = 0;
function note(name: string, body: string): Note {
  clock += 1;
  return { author: { name }, body, at: `2026-11-07T10:${String(clock).padStart(2, "0")}:00Z` };
}
function ask(n: number): string {
  const items = Array.from({ length: n }, (_, i) => `${i + 1}. which? A) x · B) y (recommended)`);
  const r = renderPost({
    seat: "writer",
    title: `OPEN: ${n === 1 ? "1 question" : `${n} questions`}`,
    fields: [],
    items,
  });
  return r.kind === "ok" ? r.text : "";
}

describe("answersIn and roundOf", () => {
  it("reads letters, words, accept all, and a plain reply to one question", () => {
    expect(answersIn("1A 2c", 2)).toEqual([
      { question: 1, choice: "A", text: "" },
      { question: 2, choice: "C", text: "" },
    ]);
    expect(answersIn("1A,2B.", 2).map((a) => a.choice)).toEqual(["A", "B"]);
    expect(answersIn("1: EUR\n2) keep the old table", 2).map((a) => a.text)).toEqual(["EUR", "keep the old table"]);
    expect(answersIn("accept all", 3).map((a) => a.choice)).toEqual(["recommended", "recommended", "recommended"]);
    expect(answersIn("EUR, please", 1)).toEqual([{ question: 1, choice: "", text: "EUR, please" }]);
  });

  it("a note that is itself a question answers nothing; a number past the round is ignored", () => {
    expect(answersIn("1A, or did you mean 2B?", 2)).toEqual([]);
    expect(answersIn("what about the old rows?", 1)).toEqual([]);
    expect(answersIn("3A", 2)).toEqual([]);
  });

  it("a round closes only when every question has an answer; later replies add up and replace", () => {
    expect(roundOf(2, ["1A"])).toEqual({ kind: "open", answered: 1, count: 2 });
    expect(roundOf(2, ["1A", "2B"])).toMatchObject({ kind: "answered" });
    expect(roundOf(2, ["1A 2B", "1C"])).toMatchObject({
      kind: "answered",
      answers: [
        { question: 1, choice: "C" },
        { question: 2, choice: "B" },
      ],
    });
  });

  it("reads the round's size from the OPEN note, one for any other ask", () => {
    expect(questionsIn(ask(7))).toBe(7);
    expect(questionsIn(ask(1))).toBe(1);
    expect(questionsIn("[coordinator] OPEN: which store?")).toBe(1);
  });

  it("gives the next run the answers as data, one line each", () => {
    expect(
      answersText([
        { question: 1, choice: "A", text: "" },
        { question: 2, choice: "", text: "EUR" },
      ]),
    ).toContain('<answers>\nQ1 = choice A\nQ2 = "EUR"\n</answers>');
  });
});

describe("open asks on a change (#486)", () => {
  it("AC-2: asked, then a note ending in a question mark, or a bot's note: still open", () => {
    const asked = note("ram", ask(2));
    expect(openAsks({ notes: [asked, note("lee", "do you mean the old table?")], readers })).toBe(1);
    expect(openAsks({ notes: [asked, note("dependabot", "1A 2B")], readers })).toBe(1);
    expect(openAsks({ notes: [asked, note("lee", "1A")], readers })).toBe(1);
  });

  it("AC-3: asked, then 1A 2B: answered, and the answers are what the next run gets", () => {
    const notes = [note("ram", ask(2)), note("lee", "1A 2B")];
    expect(openAsks({ notes, readers })).toBe(0);
    expect(lastAnswers({ notes, readers })).toEqual([
      { question: 1, choice: "A", text: "" },
      { question: 2, choice: "B", text: "" },
    ]);
  });

  it("has no answers while the newest ask is open, or with no ask", () => {
    expect(lastAnswers({ notes: [note("ram", ask(2)), note("lee", "1A")], readers })).toEqual([]);
    expect(lastAnswers({ notes: [], readers })).toEqual([]);
  });
});
