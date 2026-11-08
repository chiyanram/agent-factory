// branch — what a branch name may be, in one module with no imports, so the forge plugins can carry it (#134).

// plainBranch : a branch name git accepts and no option or refspec can hide in.
export function plainBranch(branch: string): boolean {
  const shape = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch);
  const bad = /\.\.|\/\/|\/\.|@\{|\.lock$|\/$|\.$/.test(branch);
  return shape && !bad && branch !== "HEAD";
}
