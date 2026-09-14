import { createHmac, timingSafeEqual } from "node:crypto";
import type * as NodeCrypto from "node:crypto";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramVerifier, type TelegramVerificationPolicy } from "../../src/auth/index.js";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeCrypto>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

// Synthetic credential only. The fixed digest below was independently computed
// with Python's hmac/hashlib, following Telegram's published HMAC algorithm.
const token = "123456789:SyntheticFixtureOnly_DoNotUse";
const botToken = { reveal: () => token };
const date = 1_700_000_000;
const nowMs = date * 1000;
// Test values only, not production timeout/resource defaults.
const policy: TelegramVerificationPolicy = {
  maxAgeSeconds: 300,
  maxFutureSkewSeconds: 30,
  maxBytes: 4096,
  maxFields: 16,
};
const verifier = createTelegramVerifier(botToken, policy);
const rejected = {
  ok: false,
  error: { code: "UNAUTHENTICATED", message: "Authentication required", retryable: false },
};
const fixed =
  "auth_date=1700000000&query_id=AAExample%2Bquery&user=%7B%22id%22%3A9007199254740991%2C%22first_name%22%3A%22%D9%85%D9%87%D8%AF%DB%8C+%2B+Test%22%2C%22language_code%22%3A%22fa%22%7D&start_param=room_Example_123&signature=SyntheticThirdPartySignature&hash=793982e9baa6e5d3288a06db7b5ba084731e4044597f74a3745669c87ecedc5b";
const fixedResult = {
  ok: true,
  identity: { telegramUserId: "9007199254740991", authDate: date, startParam: "room_Example_123" },
};

function fields(overrides: Record<string, string> = {}): Record<string, string> {
  return { auth_date: String(date), user: '{"id":42,"first_name":"Synthetic User"}', ...overrides };
}

function sign(values = fields(), credential = token): string {
  const canonical = Object.keys(values)
    .sort()
    .map((key) => `${key}=${values[key]}`)
    .join("\n");
  const key = createHmac("sha256", "WebAppData").update(credential).digest();
  const hash = createHmac("sha256", key).update(canonical).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("Telegram HMAC verification through the Auth public surface", () => {
  it("accepts the independent fixed vector and projects only the signed identity", () => {
    expect(verifier.verify(fixed, nowMs)).toEqual(fixedResult);
  });

  it("canonicalizes field ordering and equivalent form encoding", () => {
    const reordered = fixed.split("&").reverse().join("&").replaceAll("+", "%20");
    expect(verifier.verify(reordered, nowMs)).toEqual(fixedResult);
    expect(verifier.verify(fixed.replace("user=", "%75ser="), nowMs)).toEqual(fixedResult);
  });

  it("preserves safe numeric identity without trusting extra user properties", () => {
    const result = verifier.verify(
      sign(
        fields({
          user: JSON.stringify({
            id: 42,
            userId: "admin",
            role: "admin",
            token: "private",
            first_name: "👋 + % Test",
          }),
        }),
      ),
      nowMs,
    );
    expect(result).toEqual({ ok: true, identity: { telegramUserId: "42", authDate: date } });
    if (result.ok) expect(Object.isFrozen(result.identity)).toBe(true);
  });

  it("includes unknown fields, including signature, in HMAC mode", () => {
    const signed = sign(fields({ future_field: "opaque=+%value", signature: "synthetic" }));
    expect(verifier.verify(signed, nowMs).ok).toBe(true);
    expect(verifier.verify(signed.replace("synthetic", "forged"), nowMs)).toEqual(rejected);
    expect(verifier.verify(signed.replace("&signature=synthetic", ""), nowMs)).toEqual(rejected);
    expect(verifier.verify(signed.replace("opaque", "forged"), nowMs)).toEqual(rejected);
    expect(verifier.verify(`${signed}&unsigned_field=x`, nowMs)).toEqual(rejected);
  });

  it("returns start_param as an opaque routing hint, not membership or a session", () => {
    const result = verifier.verify(
      sign(fields({ start_param: "room_opaque", user_id: "999" })),
      nowMs,
    );
    expect(result).toEqual({
      ok: true,
      identity: { telegramUserId: "42", authDate: date, startParam: "room_opaque" },
    });
    expect(verifier.verify(fixed.replace("room_Example_123", "room_other"), nowMs)).toEqual(
      rejected,
    );
  });

  it("accepts uppercase hexadecimal digest bytes", () => {
    const query = new URLSearchParams(fixed);
    query.set("hash", query.get("hash")!.toUpperCase());
    expect(verifier.verify(query.toString(), nowMs)).toEqual(fixedResult);
  });

  it.each([
    ["user", fixed.replace("9007199254740991", "42")],
    ["auth date", fixed.replace("1700000000", "1700000001")],
    ["hash", fixed.replace("hash=7939", "hash=8939")],
    ["different bot", sign(fields(), "987654321:OtherSyntheticBot")],
  ])("rejects a forged %s", (_label, raw) => {
    expect(verifier.verify(raw, nowMs)).toEqual(rejected);
  });

  it("does not use a hex-encoded derived key or reverse HMAC key/message", () => {
    const values = fields();
    const canonical = Object.keys(values)
      .sort()
      .map((key) => `${key}=${values[key]}`)
      .join("\n");
    for (const wrongKey of [
      createHmac("sha256", "WebAppData").update(token).digest("hex"),
      createHmac("sha256", token).update("WebAppData").digest(),
    ]) {
      const hash = createHmac("sha256", wrongKey).update(canonical).digest("hex");
      expect(verifier.verify(new URLSearchParams({ ...values, hash }).toString(), nowMs)).toEqual(
        rejected,
      );
    }
  });

  it("compares valid-length authentic and forged digests as 32-byte buffers", () => {
    vi.mocked(timingSafeEqual).mockClear();
    verifier.verify(fixed, nowMs);
    verifier.verify(fixed.replace("hash=7939", "hash=8939"), nowMs);
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);
    for (const args of vi.mocked(timingSafeEqual).mock.calls) {
      for (const buffer of args) {
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.byteLength).toBe(32);
      }
    }
  });

  it.each(["", "a", "a".repeat(63), "a".repeat(65), "g".repeat(64), "0x" + "a".repeat(62)])(
    "rejects malformed digest %s before comparison",
    (hash) => {
      const query = new URLSearchParams(fixed);
      query.set("hash", hash);
      vi.mocked(timingSafeEqual).mockClear();
      expect(verifier.verify(query.toString(), nowMs)).toEqual(rejected);
      expect(timingSafeEqual).not.toHaveBeenCalled();
    },
  );
});

describe("freshness with explicit server time", () => {
  it.each([
    [0, true],
    [300_000, true],
    [300_999, true],
    [301_000, false],
    [-30_000, true],
    [-31_000, false],
  ])("checks the inclusive whole-second boundary at offset %i ms", (offset, accepted) => {
    expect(verifier.verify(fixed, nowMs + offset).ok).toBe(accepted);
  });

  it.each([
    "",
    "-1",
    "01",
    " 1700000000",
    "1700000000 ",
    "1.7e9",
    "1700000000.0",
    "NaN",
    "Infinity",
    "9007199254740992",
  ])("rejects a correctly signed noncanonical auth_date %s", (auth_date) => {
    expect(verifier.verify(sign(fields({ auth_date })), nowMs)).toEqual(rejected);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "fails closed for invalid server time %s",
    (time) => {
      expect(verifier.verify(fixed, time)).toEqual(rejected);
    },
  );

  it("is deterministic and does not consume initData within the accepted window", () => {
    expect(verifier.verify(fixed, nowMs)).toEqual(verifier.verify(fixed, nowMs));
    expect(verifier.verify(fixed, nowMs + 301_000)).toEqual(rejected);
  });
});

describe("strict bounded parsing and safe rejection", () => {
  it.each([undefined, null, false, 42, {}, [], { initDataUnsafe: { user: { id: 42 } } }, ""])(
    "rejects non-raw or empty input %#",
    (raw) => {
      expect(verifier.verify(raw, nowMs)).toEqual(rejected);
    },
  );

  it.each([
    "&user=%7B%22id%22%3A42%7D",
    "&%75ser=%7B%22id%22%3A42%7D",
    "&hash=" + "0".repeat(64),
    "&auth_date=1700000000",
    "&bad",
    "&=value",
    "&",
    "&bad-key=x",
    "&USER=x",
    "&extra=%",
    "&extra=%GG",
    "&extra=%C0%AF",
    "&extra=%ED%A0%80",
    "&extra=\uD800",
  ])("rejects malformed/duplicate appended parameter %#", (suffix) => {
    expect(verifier.verify(`${fixed}${suffix}`, nowMs)).toEqual(rejected);
  });

  it.each(["hash", "user", "auth_date"])("rejects missing required field %s", (name) => {
    const query = new URLSearchParams(fixed);
    query.delete(name);
    expect(verifier.verify(query.toString(), nowMs)).toEqual(rejected);
    if (name !== "hash") {
      const values = fields();
      delete values[name];
      expect(verifier.verify(sign(values), nowMs)).toEqual(rejected);
    }
  });

  it.each(["line\nbreak", "line\rbreak", "nul\0byte"])(
    "rejects signed canonical separators %#",
    (extra) => {
      expect(verifier.verify(sign(fields({ extra })), nowMs)).toEqual(rejected);
    },
  );

  it.each([
    "{",
    "null",
    "[]",
    "{}",
    '"user"',
    '{"id":"42"}',
    '{"id":0}',
    '{"id":-1}',
    '{"id":42.5}',
    '{"id":9007199254740992}',
    '{"id":1e100}',
    '{"id":true}',
    '{"id":null}',
  ])("rejects signed invalid user JSON %#", (user) => {
    expect(verifier.verify(sign(fields({ user })), nowMs)).toEqual(rejected);
  });

  it("checks byte and field limits inclusively", () => {
    const maxBytes = Buffer.byteLength(fixed);
    expect(createTelegramVerifier(botToken, { ...policy, maxBytes }).verify(fixed, nowMs).ok).toBe(
      true,
    );
    expect(
      createTelegramVerifier(botToken, { ...policy, maxBytes: maxBytes - 1 }).verify(fixed, nowMs),
    ).toEqual(rejected);
    const maxFields = fixed.split("&").length;
    expect(createTelegramVerifier(botToken, { ...policy, maxFields }).verify(fixed, nowMs).ok).toBe(
      true,
    );
    expect(
      createTelegramVerifier(botToken, { ...policy, maxFields: maxFields - 1 }).verify(
        fixed,
        nowMs,
      ),
    ).toEqual(rejected);
  });

  it("measures raw UTF-8 bytes, not just JavaScript string length", () => {
    const raw = sign(fields({ extra: "مهدی👋" })).replace(
      "%D9%85%D9%87%D8%AF%DB%8C%F0%9F%91%8B",
      "مهدی👋",
    );
    expect(Buffer.byteLength(raw)).toBeGreaterThan(raw.length);
    expect(verifier.verify(raw, nowMs).ok).toBe(true);
    expect(
      createTelegramVerifier(botToken, { ...policy, maxBytes: raw.length }).verify(raw, nowMs),
    ).toEqual(rejected);
  });

  it("does not serialize secrets, raw input, user profile, or errors into results or telemetry", () => {
    const logs = [
      vi.spyOn(console, "log"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "error"),
      vi.spyOn(console, "debug"),
    ];
    expect(verifier.verify(sign(fields({ user: "private invalid JSON" })), nowMs)).toEqual(
      rejected,
    );
    expect(verifier.verify(fixed, nowMs)).toEqual(fixedResult);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify(verifier)).toBe("{}");
    expect(inspect(verifier)).not.toContain(token);
    expect(Object.keys(verifier)).toEqual(["verify"]);
  });
});

describe("startup policy and secret boundary", () => {
  it.each([
    { maxAgeSeconds: 0 },
    { maxAgeSeconds: NaN },
    { maxAgeSeconds: Infinity },
    { maxAgeSeconds: 0.5 },
    { maxFutureSkewSeconds: -1 },
    { maxFutureSkewSeconds: NaN },
    { maxBytes: 0 },
    { maxBytes: 0.5 },
    { maxFields: 2 },
    { maxFields: Infinity },
    { maxFields: Number.MAX_SAFE_INTEGER + 1 },
  ])("fails startup for invalid policy %#", (override) => {
    expect(() => createTelegramVerifier(botToken, { ...policy, ...override })).toThrowError(
      "Invalid Telegram verification policy",
    );
  });

  it("snapshots configuration and reveals the bot credential once", () => {
    const mutable = { ...policy };
    const secret = { reveal: vi.fn(() => token) };
    const instance = createTelegramVerifier(secret, mutable);
    mutable.maxAgeSeconds = 100_000;
    expect(instance.verify(fixed, nowMs + 301_000)).toEqual(rejected);
    expect(instance.verify(fixed, nowMs)).toEqual(fixedResult);
    expect(secret.reveal).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(instance)).toBe(true);
  });

  it.each(["", "unsafe token", "0:invalid", ":invalid", "123:", "123:has space"])(
    "sanitizes invalid credential configuration %#",
    (value) => {
      expect(() => createTelegramVerifier({ reveal: () => value }, policy)).toThrowError(
        "Invalid Telegram verifier configuration",
      );
    },
  );

  it("does not propagate a secret provider's exception or cause", () => {
    try {
      createTelegramVerifier(
        {
          reveal() {
            throw new Error(`secret ${token}`);
          },
        },
        policy,
      );
      expect.fail("expected startup failure");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Invalid Telegram verifier configuration");
      expect((error as Error).cause).toBeUndefined();
      expect(inspect(error)).not.toContain(token);
    }
  });
});
