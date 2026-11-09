# fix(notify): find the discord plugin by name, not by path (#999)

A package installed through a symlinked prefix (nvm, Homebrew) gave a real path that did not match, so no ping
went out. The plugin's registered name is enough.
