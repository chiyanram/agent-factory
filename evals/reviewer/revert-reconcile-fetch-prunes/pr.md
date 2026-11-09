# fix(loop): reconcile drops the refs of deleted branches (#999)

A clone that runs for weeks keeps a remote-tracking ref for every branch the forge ever had. reconcile's fetch
now prunes them.
