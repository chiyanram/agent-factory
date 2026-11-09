# perf(writer): fetch the start without the config reads (#999)

The fetch is the slowest step of making the clone; hostGit reads the config three times before it. The fetch
now runs git itself.
