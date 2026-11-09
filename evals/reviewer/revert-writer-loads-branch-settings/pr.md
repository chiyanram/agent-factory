# refactor(writer): drop a claude flag the box makes redundant (#999)

The box's user home is empty and the clone is mounted read-only, so the writer's claude has no settings to load
but the ones we pass. One flag fewer in claudeArgv.
