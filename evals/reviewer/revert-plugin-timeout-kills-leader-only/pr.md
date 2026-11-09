# fix(plugin): a plugin's call survives the terminal's Ctrl-C handling (#999)

A detached child is not in the terminal's process group. Run the plugin as a normal child and kill it by its
pid on the timeout or the cap.
