// round — the questions `agent-factory init` asks, as one numbered round (#369), in the style of `questions: round`
// (#320): each question has 2 to 4 lettered choices with the recommended one marked, and one reply answers them all
// ("1A 2B"); an empty reply, or "accept all", takes every recommendation, and so does --yes. Pure.

export type Choice = { readonly label: string; readonly value: unknown };

export type Question = {
  // the setting it decides, such as "runner" or "gate"
  readonly id: string;
  readonly text: string;
  readonly choices: readonly Choice[];
  // the index of the recommended choice
  readonly recommended: number;
};

const LETTERS = "ABCD";

// asking : one question, numbered, with its lettered choices and the recommended one marked
export function asking(q: Question, i: number): string {
  const choices = q.choices.map((c, j) => `   ${LETTERS[j]}) ${c.label}${j === q.recommended ? " (recommended)" : ""}`);
  return [`${i + 1}. ${q.text}`, ...choices].map((l) => `${l}\n`).join("");
}

export const HOW_TO_ANSWER =
  'Answer with a letter per question, such as "1A 2B"; a question you leave out takes its recommendation. Enter alone takes every recommendation';

export type Answers =
  | { readonly kind: "ok"; readonly picks: readonly number[] }
  | { readonly kind: "bad"; readonly why: string };

function recommended(questions: readonly Question[]): readonly number[] {
  return questions.map((q) => q.recommended);
}

// pickOf : one "<n><letter>" answer, as the question's index and the choice's, or why it is not one
function pickOf(questions: readonly Question[], word: string): readonly [number, number] | string {
  const m = /^(\d+)([A-Da-d])$/.exec(word);
  const i = m === null ? -1 : Number(m[1]) - 1;
  const q = questions[i];
  return m === null || q === undefined
    ? `${JSON.stringify(word)} is not a question's number and a letter, such as 1A`
    : choiceOf(q, i, String(m[2]).toUpperCase());
}

function choiceOf(q: Question, i: number, letter: string): readonly [number, number] | string {
  const j = LETTERS.indexOf(letter);
  return j < q.choices.length ? [i, j] : `question ${i + 1} has no choice ${letter}`;
}

// answersOf : the choice picked for each question, from one reply
export function answersOf(questions: readonly Question[], reply: string): Answers {
  const text = reply.trim();
  if (text === "" || /^accept all$/i.test(text)) {
    return { kind: "ok", picks: recommended(questions) };
  }
  const picks = [...recommended(questions)];
  for (const word of text.replace(/(\d+)\s+([A-Da-d])\b/g, "$1$2").split(/[\s,]+/)) {
    const pick = pickOf(questions, word);
    if (typeof pick === "string") {
      return { kind: "bad", why: pick };
    }
    picks[pick[0]] = pick[1];
  }
  return { kind: "ok", picks };
}

// valueOf : the value a question's pick stands for
export function valueOf(questions: readonly Question[], picks: readonly number[], id: string): unknown {
  const i = questions.findIndex((q) => q.id === id);
  const q = questions[i];
  return q === undefined ? undefined : q.choices[picks[i] ?? q.recommended]?.value;
}
