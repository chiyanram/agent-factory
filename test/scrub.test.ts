// what looks like a secret is scrubbed before any record, kept file or trace holds it (P4; #62, #485)
import { describe, expect, it } from "vitest";
import { scrubbedJson, scrubSecrets } from "../src/core/scrub.js";

describe("scrubSecrets", () => {
  it("scrubs a PEM private key, whole", () => {
    const pem =
      "a\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA\nAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----\nz";
    expect(scrubSecrets(pem)).toBe("a\n[scrubbed]\nz");
    // a key cut off before its END line is scrubbed to its last line of key text, never the rest of the text
    expect(scrubSecrets("-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\nAAAA+/=\nthe test failed at A.java:3")).toBe(
      "[scrubbed]\nthe test failed at A.java:3",
    );
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
    expect(scrubSecrets("token ghp_short123 and github_pat_ab12cd34 and glpat-x1y2z3w4")).toBe(
      "token [scrubbed] and [scrubbed] and [scrubbed]",
    );
    // under 8 characters after the prefix it is a name, not a token
    expect(scrubSecrets("the gh_ prefix, ghp_ alone and the ghs_test fixture")).toBe(
      "the gh_ prefix, ghp_ alone and the ghs_test fixture",
    );
  });
});

describe("scrubbedJson", () => {
  it("scrubs each string and keeps the JSON valid, a number named like a token included", () => {
    const value = { finding: 'A hard-coded password = "hunter2" sits in the config', tokens: 123 };
    const text = scrubbedJson(value);
    expect(JSON.parse(text)).toEqual({
      finding: 'A hard-coded password = "[scrubbed]" sits in the config',
      tokens: 123,
    });
  });
});
