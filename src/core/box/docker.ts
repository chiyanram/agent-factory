// docker — the docker CLI as this host runs it, for the vm box, box build and the egress proxy (#113). Pure.
//
// The CLI gets only the variables it reads to find its engine and its config, never the whole host environment: a
// value meant for one box run goes in through vm.ts, by name, and nothing else of the host reaches it.

import type { Runner } from "../forge/api.js";
import type { Docker } from "./vm.js";

const PASSED = [
  "PATH",
  "HOME",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CONFIG",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
] as const;

export function hostDocker(env: NodeJS.ProcessEnv, run: Runner): Docker {
  const passed = PASSED.flatMap((name) => {
    const value = env[name];
    return value === undefined ? [] : [[name, value] as const];
  });
  return { run, bin: "docker", env: Object.fromEntries(passed) };
}
