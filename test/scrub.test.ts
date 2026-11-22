// what looks like a secret is scrubbed before any record, kept file or trace holds it (P4; #62, #485)
import { describe, expect, it } from "vitest";
import { scrubbedJson, scrubSecrets } from "../src/core/scrub.js";
import { fakeToken } from "./planted.js";

describe("scrubSecrets", () => {
  it("scrubs a PEM private key, whole", () => {
    const pem =
      "a\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA\nAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----\nz";
    expect(scrubSecrets(pem)).toBe("a\n[scrubbed]\nz");
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
    expect(scrubSecrets("the gh_ prefix, ghp_ alone and the ghs_test fixture")).toBe(
      "the gh_ prefix, ghp_ alone and the ghs_test fixture",
    );
  });
});

describe("scrubSecrets: a name that says token, secret, password or key (#686)", () => {
  it("leaves prose, a count and a spec's AC line as written", () => {
    for (const text of [
      "the token: is read from the env",
      "password: see the how-to",
      "the password: field is never hashed",
      "max_tokens: 4096 and tokens=10",
      "- AC2: a `password:` line with no value is refused",
      "Password: Required",
      "the token:\nnext line",
    ]) {
      expect(scrubSecrets(text)).toBe(text);
    }
  });

  it("leaves a placeholder as written", () => {
    const text =
      "TOKEN=… TOKEN=... `TOKEN=<token>` TOKEN=${GITHUB_TOKEN} TOKEN=$GH_TOKEN TOKEN=xxx PASSWORD=*** API_KEY=<your key>";
    expect(scrubSecrets(text)).toBe(text);
  });

  it("keeps the Markdown closer after a scrubbed value, so a code span, a link or a table cell still closes", () => {
    expect(scrubSecrets("| `API_KEY=abc` |")).toBe("| `API_KEY=[scrubbed]` |");
    expect(scrubSecrets("[docs](https://h/x?token=abc)")).toBe("[docs](https://h/x?token=[scrubbed])");
    expect(scrubSecrets("| TOKEN=abc123 | x |")).toBe("| TOKEN=[scrubbed] | x |");
  });

  it("still scrubs a value after =, a quoted value, a config name's value and one with more than letters", () => {
    const ghp = fakeToken("github-classic");
    expect(scrubSecrets(`GITHUB_TOKEN=${ghp}`)).toBe("GITHUB_TOKEN=[scrubbed]");
    expect(scrubSecrets("GITHUB_TOKEN=abcd1234efgh")).toBe("GITHUB_TOKEN=[scrubbed]");
    expect(scrubSecrets("Authorization: token123abc")).toBe("Authorization: [scrubbed]");
    expect(scrubSecrets("DATABASE_PASSWORD=hunter")).toBe("DATABASE_PASSWORD=[scrubbed]");
    expect(scrubSecrets("export STRIPE_SECRET='abc123'")).toBe("export STRIPE_SECRET='[scrubbed]'");
    expect(scrubSecrets("password: hunter2")).toBe("password: [scrubbed]");
    expect(scrubSecrets('password: "hunter"')).toBe('password: "[scrubbed]"');
    expect(scrubSecrets("api_key: see")).toBe("api_key: [scrubbed]");
    expect(scrubSecrets("DB_PASSWORD: hunter")).toBe("DB_PASSWORD: [scrubbed]");
    expect(scrubSecrets("TOKEN=xoxo1234")).toBe("TOKEN=[scrubbed]");
    expect(scrubSecrets("TOKEN=<abc>def")).toBe("TOKEN=[scrubbed]");
  });

  it("scrubs an Authorization credential after its scheme, and leaves Authorization in prose", () => {
    expect(scrubSecrets("Authorization: Basic dXNlcjpwYXNz")).toBe("Authorization: Basic [scrubbed]");
    expect(scrubSecrets("Authorization: Token abc123def")).toBe("Authorization: Token [scrubbed]");
    expect(scrubSecrets("Authorization: see the how-to")).toBe("Authorization: see the how-to");
    expect(scrubSecrets("Authorization: <header value>")).toBe("Authorization: <header value>");
  });

  it("scrubs a value that only starts like a placeholder", () => {
    expect(scrubSecrets("password=<s3cr3t and more")).toBe("password=[scrubbed] and more");
    expect(scrubSecrets("password=<s3cr3t")).toBe("password=[scrubbed]");
  });

  it("keeps a closer inside a value in the scrub, so no part of the secret is left", () => {
    expect(scrubSecrets("password=pa)ss|word end")).toBe("password=[scrubbed] end");
  });

  it("leaves a scrubbed value as it is when scrubbed again", () => {
    for (const text of ["GITLAB_TOKEN=[scrubbed]", "| `API_KEY=[scrubbed]` |", "Authorization: [scrubbed]"]) {
      expect(scrubSecrets(text)).toBe(text);
    }
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
