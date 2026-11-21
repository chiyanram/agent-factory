// repo-gardener ships no types. These cover only the two functions scripts/garden-pr.ts imports from its
// src/config.mjs, as repo-gardener 0.1.2 defines them; an upgrade rechecks them with that import.

declare module "repo-gardener/src/config.mjs" {
  export type Config = { readonly largeFileLines: number };

  export function resolveConfig(user: Readonly<Record<string, unknown>>): Config;

  export function classifiers(config: Config): {
    readonly isCode: (path: string) => boolean;
    readonly isTest: (path: string) => boolean;
  };
}
