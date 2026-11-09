# feat(cli): tell the factory's notes from people's by login and seat prefix (#128) (#141)

* feat(cli): tell the factory's notes from people's by login and seat prefix (#128)

src/core/notes.ts: at work the factory posts with the developer's own login,
so the author alone no longer says who wrote a note. A note is the factory's
only when it comes from the factory's login and its first line starts with a
seat prefix ([writer], [reviewer], [coordinator]); everything else is a
person's, so a stranger who types a prefix holds nothing (#85 item 2).
openAsks counts the asks with no project member's note after them.
commitKind reads an Agent: <seat> trailer from the trailer block, and
agentTrailer writes it.

The bash poll still decides by author; GUIDE marks it Today:, and the ported
poll (#102) uses this module.


* fix(cli): keep line findings the factory's, order notes by instant, read trailers as git does (#128)

- the reviewer's unanchored line finding now starts "[reviewer] `file:line`" on both forges, so under the
  developer's login it no longer reads as their reply and closes an ask; the old form still counts as the factory's
- openAsks orders by Date.parse, not the timestamp text; a timestamp that does not parse never closes an ask
- logins are compared without case
- commitKind follows git's trailer-block rule, folded lines, a case-free key and optional space at the colon;
  checked against git interpret-trailers
- commitKind and agentTrailer take records
- GUIDE: the ported poll will use notes.ts; the Agent trailer is marked Today: (no writer sets it yet)


---------
