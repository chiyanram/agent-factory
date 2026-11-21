---
name: delete-comment
description: Sort and delete the code comments that check-comments bans, file a ticket for each hack a comment excused, and shrink scripts/comment-baseline.json. Use when the operator says /delete-comment, or asks to clean comments in a file, a folder or the whole repo.
disable-model-invocation: true
---

# Delete comments

Code says what it does. `scripts/check-comments.ts` keeps a comment only when the code cannot say it. Its header
lists the four kinds it keeps. This skill deletes the rest. The idea comes from pstack's comment-sicko
(https://github.com/cursor/plugins/blob/main/pstack/agents/comment-sicko.md).

## Scope

Use the files or folder the operator names. Otherwise use the files in `scripts/comment-baseline.json`, largest
count first. This is a ticket's work: pick it up as the AGENTS.md MUSTs say, in its own worktree.

## Steps

1. Record the before state. Emit the code without comments:
   `npx tsc -p tsconfig.json --noEmit false --removeComments --declaration false --sourceMap false --outDir <tmp>/before`.
2. List the banned lines. Import `banned` from `scripts/check-comments.ts` and run it on each file in scope.
3. Sort each comment, and act:

   | kind | test | action |
   |---|---|---|
   | tautology | the code, its name or its type already says it | delete |
   | stale | it names code or behaviour that is not true now (read the code) | delete |
   | excuse | it explains away a hack, a "for now", a gap, a cast or a symptom guard | delete, and note the hack |
   | decision record | a true, non-obvious why that code cannot show | one or two sentences in the module header; an ADR draft only when it spans modules |

   If you are not sure, delete. Do not make a comment shorter to keep it. Do not add a link or `Today:` to keep one.
4. Clean the module headers too: cut tautology and stale lines, keep the why, and keep one ticket pointer at most.
5. Edit comments only. Emit again to `<tmp>/after`, and `diff -r` the two emits. Any difference is a code change:
   undo it. A `.mjs` or `.js` file is not in the emit: read its diff by eye.
6. File one ticket for each module with excuses (`type:task`, per `docs/agents/issue-tracker.md`). Name each hack's
   symbol, what it does, and the fix. Put each ADR draft in the ticket's report for the operator.
7. Run `node scripts/check-comments.ts --shrink`, then `npm run format` and `make lint`.
8. Report: lines deleted, the baseline before and after, the tickets filed, the ADR drafts, and the comments you
   kept with a doubt.
