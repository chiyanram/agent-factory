# perf(push): one tree compare per push instead of two (#999)

noCiFiles and noAgentSettings each walk the trees between the lease and the head. The writer's clone mounts the
agent settings read-only already, so the push keeps the CI guard and the factory-folder guard.
