// types — the box seam (#112; ADR-0012 S5, S7, S8): one interface for every run with no human watching (the writer,
// the ready check, the reviewer). FACTORY_BOX picks only where the box runs (choose.ts); every place runs the same
// container box image, so nothing that calls a Box may depend on the place (S17, review issue 10 on #30).
//
// A Box is an I/O seam: it decides nothing. It never inherits the host environment, it mounts only the worktree, and
// every outcome is a sealed result. Nothing here throws.

export type BoxPlace = "vm" | "laptop";

// A container image pinned by digest (S7: "Pin the version"), made only by pinImage, so an unpinned tag cannot reach
// start.
export type PinnedImage = { readonly kind: "pinned"; readonly ref: string };

export type BoxSpec = {
  readonly image: PinnedImage;
  // the host path of the worktree: the only folder mounted into the box
  readonly worktree: string;
  // paths inside the worktree the run may read but not change: the agent's own settings and instructions (#113 Q1)
  readonly readOnly: readonly string[];
  // every variable the run sees, and nothing else: the host environment is never inherited (ADR-0014 P11)
  readonly env: Readonly<Record<string, string>>;
  // the egress proxy every request leaves through (#130)
  readonly proxy: string;
  // the project's internal network: no route out but its proxy (one proxy per project, decision on #30, 2026-11-07)
  readonly network: string;
};

// One started box. Only the Box that started it can use it.
export type Session = { readonly id: string; readonly place: BoxPlace };

export type Input = { readonly kind: "text"; readonly text: string } | { readonly kind: "none" };

export type Command = {
  // run with no shell: argv[0] is the program
  readonly argv: readonly [string, ...string[]];
  readonly stdin: Input;
  readonly timeoutSeconds: number;
  // each piece of the command's stdout as it comes, while it runs (#228: the writer's stall stop); Ran still holds all
  // of it at the end
  readonly watch?: (chunk: string) => void;
};

export type Failed = { readonly kind: "failed"; readonly reason: string };
export type Done = { readonly kind: "ok" } | Failed;

export type Probe = { readonly kind: "ready" } | { readonly kind: "missing"; readonly reason: string };
export type Started = { readonly kind: "started"; readonly session: Session } | Failed;
export type Ran =
  | { readonly kind: "exited"; readonly code: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "timedOut"; readonly seconds: number }
  | Failed;

// a host path and a path inside the box's worktree
export type Copy = { readonly session: Session; readonly host: string; readonly box: string };

export type Box = {
  readonly place: BoxPlace;
  // whether a box can start here now: the runtime answers and the image is present
  probe(): Promise<Probe>;
  start(spec: BoxSpec): Promise<Started>;
  run(input: { readonly session: Session; readonly command: Command }): Promise<Ran>;
  copyIn(copy: Copy): Promise<Done>;
  copyOut(copy: Copy): Promise<Done>;
  // succeeds when the box is gone afterwards, even if it was already gone
  stop(session: Session): Promise<Done>;
};
