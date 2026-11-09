# feat(cli): posting template that makes every posted field inert (#126) (#133)

* feat(cli): posting template that cleans every field the factory posts (#126)

src/core/post.ts: renderPost builds a post from a fixed template ([seat]
title, then '- label: value' lines); cleanField makes outside words safe to
place in it. A field is put on one line, loses its backticks and control
characters, has HTML and link brackets escaped, and has URLs, @mentions and
closing keywords with their reference put in code spans. It never starts with
'/', so no GitLab quick action runs as the poster, and it is capped in length.


* fix(cli): break trigger characters instead of wrapping them in code spans (#126)

Review findings: a backslash in the input escaped the opening backtick, so a
mention, a link or a closing keyword was live again; a mention right after a
span was missed; GitLab closing forms such as 'closing #1', 'Closes issue #1'
and a second reference were missed; www. and non-http links rendered; the
cap applied to the input only. cleanField now escapes the backslash first,
puts a word joiner after @, # and ! and inside :// and www., escapes HTML and
every Markdown and Jira link, image, macro and code-span character, drops
invisible format characters, and caps the output. renderPost refuses a label
that is not plain words.


* fix(cli): renderPost returns a sealed result; fields and items are required (#126)

From the review comment on the PR: a refused label is now
{kind: "refused", reason}, never a throw, so the dispatcher handles it
instead of stopping mid-run; and fields and items are required readonly
arrays, so undefined is never a decision.


---------
