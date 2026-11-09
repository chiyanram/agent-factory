# feat(forge): openChange: the host opens a draft change after a ticket's first push (#164) (#165)

- Forge.openChange({branch, base, title, body}) in the seam and both adapters. GitHub: POST pulls with draft: true.
  GitLab: POST merge_requests with the "Draft: " title prefix.
- One order for both (shared openOnce): words, find, open. The title is cleaned like any posted field, the body goes
  through the posting template, and a branch that is not plain is refused before any call. The spec's text never
  goes in.
- A change already open from the branch is reused, so a retry after a crash opens no second one; a fork's change is
  left out; two or more are left to a person.
- GUIDE: the first run opens the change (Today: the writer step, #113, does not call it yet).
