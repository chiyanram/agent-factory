// window — the completion window (#182; decided on #182, 2026-11-08). An agent can finish while a child it started
// keeps its output open, so the process never exits. While the writer runs, the host looks for a report the schema
// accepts every few seconds; once one is there, the writer has 60 seconds to exit. If it is still running then, the
// host stops the box, and the run is decided from the report, with the hang said in the post and the record. A run with
// no accepted report waits out its full timeout, as before. The run is still decided from a fresh read of the report
// after the box has stopped (run.ts), never from what the watch saw.

// one fixed window, no setting
export const WINDOW_SECONDS = 60;
// how often the host looks for the report while the writer runs
export const POLL_MS = 2000;

export type Watched<T> = { readonly kind: "ended"; readonly value: T } | { readonly kind: "hung" };

export type Watch<T> = {
  // the writer's run in the box; it ends when the process exits or the box's own timeout stops it
  readonly running: Promise<T>;
  // whether the clone holds a report the schema accepts
  readonly reported: () => Promise<boolean>;
  // waits the milliseconds given; a test passes its own
  readonly wait: (ms: number) => Promise<void>;
};

// realWait : the wait the host uses
export const realWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type Raced<T> = Watched<T> | { readonly kind: "waited" };

function race<T>(running: Promise<T>, waited: Promise<void>): Promise<Raced<T>> {
  return Promise.race([
    running.then((value): Raced<T> => ({ kind: "ended", value })),
    waited.then((): Raced<T> => ({ kind: "waited" })),
  ]);
}

// inWindow : the run's end within the window, or hung when the window closes first
async function inWindow<T>(watch: Watch<T>): Promise<Watched<T>> {
  const raced = await race(watch.running, watch.wait(WINDOW_SECONDS * 1000));
  return raced.kind === "ended" ? raced : { kind: "hung" };
}

// watched : the run's end, or hung when it outlived the window after an accepted report
export async function watched<T>(watch: Watch<T>): Promise<Watched<T>> {
  for (;;) {
    const raced = await race(watch.running, watch.wait(POLL_MS));
    if (raced.kind === "ended") {
      return raced;
    }
    if (await watch.reported()) {
      return inWindow(watch);
    }
  }
}
