// field — reads one named field of a value that came from JSON or a thrown error, with no assumption about its shape,
// and the error code of a failed system call. A leaf with no imports, so every module can use it with no cycle.

export function prop(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? (Reflect.get(value, name) as unknown) : undefined;
}

export function codeOf(error: unknown): string {
  const code = prop(error, "code");
  return typeof code === "string" ? code : "";
}
