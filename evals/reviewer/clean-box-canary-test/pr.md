# test(box): a host canary and a forge token never reach the writer's box (#181) (#202)

ADR-0012 S6 and S15 say the box gets only the variables its spec declares.
Nothing proved it: the box contract checked start, run and stop only.

- The box contract makes each box from a host env, as app.ts does, and
  plants FACTORY_CANARY and GH_TOKEN in it. Every argv and env the box
  hands its runtime (the docker CLI for vm) must hold neither the names nor
  the values, and must hold the declared token, so the check sees the run's
  real input. The vm box now goes through hostDocker, the code app.ts runs.
  Two planted pass-throughs (hostDocker passing the whole env; one host name
  sent with --env) each fail it.
- vm-box-real.test.ts runs `env` in a real vm box and fails on the canary,
  GH_TOKEN, or any undeclared secret-like name. With no image or no Sysbox
  it is skipped, with the reason. GUIDE says how to run it on the VM.
