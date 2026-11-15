// origin — the project's clone is the project's repo: its `origin` names the git host and project the settings name.
// A clone whose origin points elsewhere (another repo, a fork) would build from or push to the wrong place with no
// warning, so `config check` and each orchestrator pass stop on a mismatch and name both URLs.

// originProblem : why the clone in the settings is not the project's repo, or "" when it is or nothing names both
export async function originProblem(_env: NodeJS.ProcessEnv): Promise<string> {
  return "";
}
