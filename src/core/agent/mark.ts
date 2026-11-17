// agent/mark — what marks every model run the adapter starts (ADR-0023 D3): the door seam (door/write.ts) refuses a
// person's word from an environment that carries it. It is no FACTORY_* name, since a run gets none of those (S6).

export const MODEL_RUN_MARK = { AGENT_FACTORY_MODEL_RUN: "1" } as const;
