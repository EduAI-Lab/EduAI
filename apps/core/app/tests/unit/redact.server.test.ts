// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  REDACTED_VALUE,
  redactDiagnosticLogString,
  redactErrorForConsole,
  redactSecretValuesInString,
  sanitizeSensitiveData,
} from "~/lib/redact.server";

describe("redactSecretValuesInString", () => {
  it("redacts Bearer tokens", () => {
    expect(redactSecretValuesInString("Authorization: Bearer abc.def.ghi")).toBe(
      `Authorization: Bearer ${REDACTED_VALUE}`,
    );
  });

  it("redacts Basic authorization credentials", () => {
    expect(redactSecretValuesInString("Authorization: Basic dXNlcjpwYXNz")).toBe(
      `Authorization: Basic ${REDACTED_VALUE}`,
    );
  });

  it("redacts JSON-quoted Authorization headers regardless of token length", () => {
    expect(redactSecretValuesInString('"Authorization": "Basic dXNlcjpwYXNz"')).toContain(
      `Basic ${REDACTED_VALUE}`,
    );
    expect(redactSecretValuesInString('"Authorization": "Bearer abc.def"')).toContain(
      `Bearer ${REDACTED_VALUE}`,
    );
  });

  it("redacts standalone long Bearer/Basic tokens outside header context", () => {
    expect(
      redactSecretValuesInString("saw Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature in log"),
    ).toBe(`saw Bearer ${REDACTED_VALUE} in log`);
    expect(redactSecretValuesInString("Basic dXNlcm5hbWU6cGFzc3dvcmQxMjM=")).toBe(
      `Basic ${REDACTED_VALUE}`,
    );
  });

  it("leaves Bearer/Basic prose untouched (#1116 review)", () => {
    expect(redactSecretValuesInString("Basic setup complete")).toBe("Basic setup complete");
    expect(redactSecretValuesInString("Bearer of bad news")).toBe("Bearer of bad news");
    expect(redactSecretValuesInString("keep it Basic for now, ok?")).toBe(
      "keep it Basic for now, ok?",
    );
  });

  it("redacts raw Cookie and Set-Cookie header lines", () => {
    expect(redactSecretValuesInString("Cookie: session=abc; theme=dark")).toBe(
      `Cookie: ${REDACTED_VALUE}`,
    );
    expect(redactSecretValuesInString("Set-Cookie: sid=xyz; Path=/")).toBe(
      `Set-Cookie: ${REDACTED_VALUE}`,
    );
  });

  it("redacts X-Api-Key header lines", () => {
    expect(redactSecretValuesInString("X-Api-Key: super-secret")).toBe(
      `X-Api-Key: ${REDACTED_VALUE}`,
    );
    expect(redactSecretValuesInString("x-api-key: super-secret")).toBe(
      `X-Api-Key: ${REDACTED_VALUE}`,
    );
  });

  it("redacts token query params", () => {
    expect(
      redactSecretValuesInString("https://api.example.com/x?access_token=sekret&ok=1"),
    ).toBe(`https://api.example.com/x?access_token=${REDACTED_VALUE}&ok=1`);
  });

  it("redacts an OAuth client_secret query param", () => {
    expect(redactSecretValuesInString("POST /token?client_secret=s3kr3t&grant_type=code")).toBe(
      `POST /token?client_secret=${REDACTED_VALUE}&grant_type=code`,
    );
  });

  // `code` is deliberately NOT on the query-param deny-list: course codes are logged as
  // `?code=CPSC110` throughout the app and redacting them would destroy triage value.
  it("leaves a non-secret code query param intact", () => {
    expect(redactSecretValuesInString("/courses?code=CPSC110")).toBe("/courses?code=CPSC110");
  });

  it("redacts URL userinfo", () => {
    expect(redactSecretValuesInString("postgres://user:pass@host/db")).toBe(
      `postgres://${REDACTED_VALUE}@host/db`,
    );
  });

  // Review on #1291: the header/query patterns above only fire on a fixed set of shapes, so a
  // serialized payload or an env dump reached the log rows untouched.
  describe("structured key/value payloads", () => {
    it("redacts a JSON-serialized credential", () => {
      expect(redactSecretValuesInString('{"apiKey":"secret"}')).toBe(
        `{"apiKey":"${REDACTED_VALUE}"}`,
      );
      expect(redactSecretValuesInString('{"password": "hunter2", "userId": "u-1"}')).toBe(
        `{"password": "${REDACTED_VALUE}", "userId": "u-1"}`,
      );
    });

    it("redacts env / shell assignment dumps", () => {
      expect(redactSecretValuesInString("API_KEY=secret")).toBe(`API_KEY=${REDACTED_VALUE}`);
      expect(redactSecretValuesInString("PGPASSWORD=xyz psql -h db")).toBe(
        `PGPASSWORD=${REDACTED_VALUE} psql -h db`,
      );
      expect(redactSecretValuesInString("DATABASE_URL=postgres://u:p@host/db")).toBe(
        `DATABASE_URL=postgres://${REDACTED_VALUE}@host/db`,
      );
    });

    it("redacts unquoted object / YAML style pairs", () => {
      expect(redactSecretValuesInString("clientSecret: sk-live-1")).toBe(
        `clientSecret: ${REDACTED_VALUE}`,
      );
      expect(redactSecretValuesInString("sessionId='abc123'")).toBe(
        `sessionId='${REDACTED_VALUE}'`,
      );
    });

    it("leaves non-credential keys and prose alone", () => {
      expect(redactSecretValuesInString("note: all good")).toBe("note: all good");
      expect(redactSecretValuesInString("status=ok count=42")).toBe("status=ok count=42");
      expect(redactSecretValuesInString("expires: 2026-12-01T00:00:00.000Z")).toBe(
        "expires: 2026-12-01T00:00:00.000Z",
      );
      // Stack frames carry `file:line:col`, which must survive to stay useful.
      expect(redactSecretValuesInString("at Object.run (/app/b.js:12:34)")).toBe(
        "at Object.run (/app/b.js:12:34)",
      );
    });

    it("does not mangle a nested literal under a credential key", () => {
      // The bare-value branch must not half-consume the `[`, which would emit invalid JSON.
      expect(redactSecretValuesInString('{"tokens":["a","b"]}')).toBe('{"tokens":["a","b"]}');
    });

    it("keeps the auth scheme that the header patterns preserve", () => {
      expect(redactSecretValuesInString("Authorization: Bearer abc.def.ghi")).toBe(
        `Authorization: Bearer ${REDACTED_VALUE}`,
      );
    });

    it("is idempotent — re-running never double-redacts", () => {
      const inputs = [
        '{"apiKey":"secret"}',
        "API_KEY=secret",
        "DATABASE_URL=postgres://u:p@host/db",
        "Authorization: Bearer abc.def.ghi",
        "Cookie: session=abc",
        "https://x.test/cb?access_token=abc123def456",
      ];
      for (const input of inputs) {
        const once = redactSecretValuesInString(input);
        expect(redactSecretValuesInString(once)).toBe(once);
      }
    });
  });

  it("does not ReDoS on long non-URL strings", () => {
    const long = "y".repeat(100_000);
    const start = Date.now();
    expect(redactSecretValuesInString(long)).toBe(long);
    expect(Date.now() - start).toBeLessThan(500);
  });

  // A dense separator blob is the worst case for the key/value pass: scanning each key's value
  // and then backing up to re-expose what it swallowed is quadratic. Matching the value only
  // after the key is known to be a credential keeps it linear. Cron stdout can be 1000 chars of
  // exactly this shape, so guard the property rather than the implementation.
  it("stays linear on a dense key/value blob", () => {
    for (const blob of ["a=".repeat(50_000), "a:b:c:d:".repeat(12_000)]) {
      const start = Date.now();
      expect(redactSecretValuesInString(blob)).toBe(blob);
      expect(Date.now() - start).toBeLessThan(500);
    }
  });
});

describe("sanitizeSensitiveData (key + value)", () => {
  it("redacts keys and scrubs secret substrings in string leaves", () => {
    expect(
      sanitizeSensitiveData({
        authorization: "Bearer abc",
        url: "https://x.com?token=sekret",
        note: "ok",
      }),
    ).toEqual({
      authorization: REDACTED_VALUE,
      url: `https://x.com?token=${REDACTED_VALUE}`,
      note: "ok",
    });
  });

  it("redacts HAR-style { name, value } header entries", () => {
    expect(
      sanitizeSensitiveData([
        { name: "Cookie", value: "session=abc" },
        { name: "Authorization", value: "Basic dXNlcjpwYXNz" },
        { name: "x-api-key", value: "sekret" },
        { name: "Accept", value: "application/json" },
      ]),
    ).toEqual([
      { name: "Cookie", value: REDACTED_VALUE },
      { name: "Authorization", value: REDACTED_VALUE },
      { name: "x-api-key", value: REDACTED_VALUE },
      { name: "Accept", value: "application/json" },
    ]);
  });

  it("redacts HAR cookie rows that carry extra domain/path fields", () => {
    expect(
      sanitizeSensitiveData([
        {
          name: "auth_token",
          value: "abc123",
          domain: "example.com",
          path: "/",
          httpOnly: true,
          secure: true,
          expires: "2026-12-01T00:00:00.000Z",
        },
      ]),
    ).toEqual([
      {
        name: "auth_token",
        value: REDACTED_VALUE,
        domain: "example.com",
        path: "/",
        httpOnly: true,
        secure: true,
        expires: "2026-12-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("redactDiagnosticLogString", () => {
  it("parses JSON and applies key + value redaction", () => {
    const raw = JSON.stringify([
      {
        headers: { Authorization: "Bearer abc.def" },
        url: "https://api.example.com?access_token=sekret",
      },
    ]);
    const redacted = redactDiagnosticLogString(raw);
    const parsed = JSON.parse(redacted) as Array<{
      headers: { Authorization: string };
      url: string;
    }>;
    expect(parsed[0].headers.Authorization).toBe(REDACTED_VALUE);
    expect(parsed[0].url).toContain(`access_token=${REDACTED_VALUE}`);
  });

  it("falls back to value-level scrubbing for non-JSON text", () => {
    expect(redactDiagnosticLogString("got Bearer tok-1234567890-abcdef")).toBe(
      `got Bearer ${REDACTED_VALUE}`,
    );
  });

  it("scrubs Cookie / Basic / x-api-key text captures before persist", () => {
    const raw = [
      "Cookie: session=abc",
      "Authorization: Basic dXNlcjpwYXNz",
      "X-Api-Key: super-secret",
    ].join("\n");
    const redacted = redactDiagnosticLogString(raw);
    expect(redacted).toContain(`Cookie: ${REDACTED_VALUE}`);
    expect(redacted).toContain(`Basic ${REDACTED_VALUE}`);
    expect(redacted).toContain(`X-Api-Key: ${REDACTED_VALUE}`);
    expect(redacted).not.toContain("session=abc");
    expect(redacted).not.toContain("dXNlcjpwYXNz");
    expect(redacted).not.toContain("super-secret");
  });
});

describe("redactErrorForConsole", () => {
  it("scrubs an Error's message and stack and returns a plain shape", () => {
    const err = new Error("Can't reach postgres://appuser:s3cr3t@db.internal:5432/eduai");
    const result = redactErrorForConsole(err) as {
      name: string;
      message: string;
      stack?: string;
    };

    // A plain object, not an Error — console.error prints an Error's own fields
    // rather than any properties we would set on it.
    expect(result).not.toBeInstanceOf(Error);
    expect(result.name).toBe("Error");
    expect(result.message).toBe(`Can't reach postgres://${REDACTED_VALUE}@db.internal:5432/eduai`);
    expect(result.stack).not.toContain("s3cr3t");
  });

  it("omits stack when the Error has none", () => {
    const err = new Error("plain failure");
    err.stack = undefined;

    expect(redactErrorForConsole(err)).toEqual({
      name: "Error",
      message: "plain failure",
      stack: undefined,
    });
  });

  it("scrubs thrown strings", () => {
    expect(redactErrorForConsole("failed /cb?access_token=abc123def456")).toBe(
      `failed /cb?access_token=${REDACTED_VALUE}`,
    );
  });

  it("falls back to full sanitization for non-Error throwables", () => {
    expect(redactErrorForConsole({ apiKey: "sk-live-1", note: "hit /cb?token=abc" })).toEqual({
      apiKey: REDACTED_VALUE,
      note: `hit /cb?token=${REDACTED_VALUE}`,
    });
  });
});
