// a — a planted module whose header holds one pointer (see #12)
// and a second pointer added to the header (#13)

// keep the cap low; an old note stays until the file is touched (#488)
export const CAP = 3;

// keep the cap low (#488, operator 2026-11-14)
export function cap(): number {
  // keep the cap low
  const label = "see #12 // not a comment";
  // Today: the cap is not read from settings yet (#21); a setting replaces it
  // once the settings layer lands (#22)
  return CAP + label.length;
}
