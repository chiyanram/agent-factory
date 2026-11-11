// what looks like a secret is scrubbed before any record, kept file or trace holds it (P4; #62, #485)
import { describe, expect, it } from "vitest";
import { scrubSecrets } from "../src/core/scrub.js";

describe("scrubSecrets", () => {
  it("scrubs a PEM private key, whole", () => {
    const pem =
      "a\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA\nAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----\nz";
    expect(scrubSecrets(pem)).toBe("a\n[scrubbed]\nz");
    // a key cut off before its end line is scrubbed to the end of the text
    expect(scrubSecrets("-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg")).toBe("[scrubbed]");
  });

  it("scrubs a login in a URL, and leaves a URL with none", () => {
    expect(scrubSecrets("git clone https://oauth2:glpat-abcdefghij1234@gitlab.corp.example/x.git")).toBe(
      "git clone https://[scrubbed]@gitlab.corp.example/x.git",
    );
    expect(scrubSecrets("https://user:s3cret@host/p")).toBe("https://[scrubbed]@host/p");
    expect(scrubSecrets("see https://example.com:8080/a@b and git@github.com:o/r.git")).toBe(
      "see https://example.com:8080/a@b and git@github.com:o/r.git",
    );
  });

  it("scrubs short git host tokens, and leaves words that only start alike", () => {
    expect(scrubSecrets("token ghp_short123 and github_pat_ab12 and glpat-x1y2")).toBe(
      "token [scrubbed] and [scrubbed] and [scrubbed]",
    );
    expect(scrubSecrets("the gh_ prefix and ghp_ alone")).toBe("the gh_ prefix and ghp_ alone");
  });
});
