# docs(guide): the CI backstop stays a manual check; GitLab lists the external CI path on Free (#115) (#183)

`agent-factory setup` will not check the backstop, because the factory's
identity must not hold the right to read CI variables or secrets, and the
host push already refuses a CI change (PR #169).

Refs #115
