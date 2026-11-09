# fix(scripts): start-writer starts again after a dead run (#999)

A dead run's worktree stopped start-writer until someone ran reconcile. Remove it and start, as before #189:
the writer pushes its work as it goes.
