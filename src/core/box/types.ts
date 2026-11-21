// types — the box seam (#112; ADR-0012 S5, S7, S8): one interface for every run with no human watching (the writer,
// the ready check, the reviewer). FACTORY_BOX picks the runner kind (choose.ts): vm, a container with its own Docker,
// or srt, Anthropic's sandbox runtime around the whole process on a work laptop. Nothing that calls a Box may depend
// on the kind (S17).
//
// A Box is an I/O seam: it decides nothing. It never inherits the host environment, it lets the run write only in the
// worktree (and a private HOME), and every outcome is a sealed result. Nothing here throws. Only pinImage makes a
// PinnedImage, so an unpinned tag cannot reach start, and only the Box that started a Session can use it.

export type BoxPlace = "vm" | "srt";

export type PinnedImage = { readonly kind: "pinned"; readonly ref: string };

export type NoImage = { readonly kind: "none" };
export const NO_IMAGE: NoImage = { kind: "none" };

export type BoxSpec = {
  readonly image: PinnedImage | NoImage;
  readonly worktree: string;
  readonly readOnly: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly proxy: string;
  readonly network: string;
};

export type Session = { readonly id: string; readonly place: BoxPlace };

export type Input = { readonly kind: "text"; readonly text: string } | { readonly kind: "none" };

export type Command = {
  readonly argv: readonly [string, ...string[]];
  readonly stdin: Input;
  readonly timeoutSeconds: number;
  readonly watch?: (chunk: string) => void;
  readonly keep?: "all" | "tail";
};

export type Failed = { readonly kind: "failed"; readonly reason: string };
export type Done = { readonly kind: "ok" } | Failed;

export type Probe = { readonly kind: "ready" } | { readonly kind: "missing"; readonly reason: string };
export type Started = { readonly kind: "started"; readonly session: Session } | Failed;
export type Ran =
  | { readonly kind: "exited"; readonly code: number; readonly stdout: string; readonly stderr: string }
  | { readonly kind: "timedOut"; readonly seconds: number }
  | Failed;

export type Copy = { readonly session: Session; readonly host: string; readonly box: string };

export type Box = {
  readonly place: BoxPlace;
  probe(): Promise<Probe>;
  start(spec: BoxSpec): Promise<Started>;
  run(input: { readonly session: Session; readonly command: Command }): Promise<Ran>;
  copyIn(copy: Copy): Promise<Done>;
  copyOut(copy: Copy): Promise<Done>;
  stop(session: Session): Promise<Done>;
};
