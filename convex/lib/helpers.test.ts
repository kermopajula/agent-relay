import { describe, expect, test } from "vitest";
import { originAllowed, taskTimeoutHours, timeZoneOrUtc, waitSeconds } from "./config";
import { constantTimeEqual, decryptToken, encryptToken, randomSecret, sha256Hex } from "./crypto";
import { chooseDuration, parseDuration } from "./duration";
import { matchProject, matchTask } from "./match";
import { dedupeName, displayNameFromSlug, provisionalName } from "./names";
import { parseFireUrl } from "./routineApi";
import { secretFromPath, secretsMatch } from "./secret";
import { formatSpan } from "./summary";

describe("parseDuration", () => {
  test.each([
    ["run a 2 minute test task", 2],
    ["Ask Claude to run a 10-minute test", 10],
    ["30 min please", 30],
    ["a ten minute job", 10],
    ["takes half an hour", 30],
    ["run a 5 minute task", null],
    ["fix the 2 bugs", null],
  ])("%s -> %s", (text, expected) => {
    expect(parseDuration(text)).toBe(expected);
  });

  test("falls back to the cycle by task number", () => {
    expect([1, 2, 3, 4, 5].map((n) => chooseDuration("hello", n))).toEqual([2, 10, 30, 2, 10]);
  });
});

describe("matchTask", () => {
  const tasks = [
    { number: 10, name: "Test task 10 (2 min)" },
    { number: 2, name: "Test task 2 (10 min)" },
    { number: 1, name: "Test task 1 (2 min)" },
  ];

  test.each([
    ["last", 10],
    ["", 10],
    ["Test task 1", 1],
    ["test task 10 (2 min)", 10],
    ["task 2", 2],
    ["#2", 2],
    ["task 7", null],
    ["something else", null],
  ])("%s -> task %s", (name, number) => {
    expect(matchTask(tasks, name)?.number ?? null).toBe(number);
  });
});

describe("secret helpers", () => {
  test("secretFromPath accepts exactly one segment", () => {
    expect(secretFromPath("/mcp/abc", "mcp")).toBe("abc");
    expect(secretFromPath("/mcp/abc/", "mcp")).toBe("abc");
    expect(secretFromPath("/mcp/a/b", "mcp")).toBeNull();
    expect(secretFromPath("/log/abc", "mcp")).toBeNull();
  });

  test("secretFromPath treats a malformed escape as no secret", () => {
    expect(secretFromPath("/mcp/%zz", "mcp")).toBeNull();
  });

  test("secretsMatch compares whole values", async () => {
    expect(await secretsMatch("abc", "abc")).toBe(true);
    expect(await secretsMatch("abc", "abcd")).toBe(false);
  });
});

describe("config", () => {
  test("waitSeconds defaults to 50 and clamps to 0..120", () => {
    expect([undefined, "", "x", "25", "-5", "999"].map(waitSeconds)).toEqual([50, 50, 50, 25, 0, 120]);
  });

  test("taskTimeoutHours defaults to 6 and rejects zero or less", () => {
    expect([undefined, "", "x", "0", "-1", "2", "0.5", "999"].map(taskTimeoutHours)).toEqual([6, 6, 6, 6, 6, 2, 0.5, 168]);
  });

  test("timeZoneOrUtc keeps a valid zone and falls back to UTC", () => {
    expect([undefined, "", "Europe/Tallinn", "Mars/Olympus"].map(timeZoneOrUtc)).toEqual([
      "UTC",
      "UTC",
      "Europe/Tallinn",
      "UTC",
    ]);
  });

  test("originAllowed only filters when a list is set and Origin is sent", () => {
    expect(originAllowed("https://a.example", undefined)).toBe(true);
    expect(originAllowed(null, "https://grok.com")).toBe(true);
    expect(originAllowed("https://a.example", "https://grok.com, https://x.ai")).toBe(false);
    expect(originAllowed("https://x.ai", "https://grok.com, https://x.ai")).toBe(true);
  });
});

test("formatSpan reads like a stopwatch", () => {
  expect([5_000, 65_000, 3_723_000].map(formatSpan)).toEqual(["5s", "1m 05s", "1h 02m"]);
});

const KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const OTHER_KEY = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";

describe("crypto", () => {
  test("a token survives an encrypt and decrypt round trip", async () => {
    const sealed = await encryptToken("sk-ant-oat01-secret", KEY);
    expect(sealed).not.toContain("sk-ant");
    expect(await decryptToken(sealed, KEY)).toBe("sk-ant-oat01-secret");
  });

  test("each encryption uses a fresh IV", async () => {
    expect(await encryptToken("same", KEY)).not.toBe(await encryptToken("same", KEY));
  });

  test("a different key cannot decrypt, and a bad key is refused", async () => {
    const sealed = await encryptToken("sk-ant-oat01-secret", KEY);
    await expect(decryptToken(sealed, OTHER_KEY)).rejects.toThrow(/TOKEN_ENCRYPTION_KEY changed/);
    await expect(encryptToken("x", undefined)).rejects.toThrow(/openssl rand -base64 32/);
    await expect(encryptToken("x", "not base64!")).rejects.toThrow(/openssl rand -base64 32/);
  });

  test("randomSecret has 32 bytes of entropy in URL-safe base64", () => {
    const secret = randomSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomSecret()).not.toBe(secret);
  });

  test("sha256Hex and constantTimeEqual", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

describe("parseFireUrl", () => {
  test("accepts the documented shape and returns the routine id", () => {
    expect(parseFireUrl("https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire")).toEqual({
      ok: true,
      routineId: "trig_01ABC",
    });
  });

  test.each([
    "http://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire",
    "https://api.anthropic.com:8443/v1/claude_code/routines/trig_01ABC/fire",
    "https://api.anthropic.com.evil.example/v1/claude_code/routines/trig_01ABC/fire",
    "https://user:pw@api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire",
    "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire/",
    "https://api.anthropic.com/v1/claude_code/routines//fire",
    "https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire#x",
    "not a url",
  ])("rejects %s", (url) => {
    expect(parseFireUrl(url).ok).toBe(false);
  });
});

describe("names", () => {
  test("displayNameFromSlug title-cases each word", () => {
    expect(displayNameFromSlug("begin-mobile")).toBe("Begin Mobile");
  });

  test("provisionalName uses the display time zone", () => {
    const at = new Date("2026-10-11T10:05:00Z").getTime();
    expect(provisionalName("Begin Bugs", at, "UTC")).toBe("new Begin Bugs task, sent 10:05");
    expect(provisionalName("Begin Bugs", at, "Europe/Tallinn")).toBe("new Begin Bugs task, sent 13:05");
  });

  test("dedupeName adds the first free number", () => {
    expect(dedupeName("Fix crash", [])).toBe("Fix crash");
    expect(dedupeName("Fix crash", ["Fix crash"])).toBe("Fix crash (2)");
    expect(dedupeName("Fix crash", ["Fix crash", "Fix crash (2)"])).toBe("Fix crash (3)");
  });
});

describe("matchProject", () => {
  const projects = [
    { name: "begin-bugs", displayName: "Begin Bugs", aliases: ["triage"], isDefault: true },
    { name: "begin-mobile", displayName: "Begin Mobile", aliases: [], isDefault: false },
    { name: "eve", displayName: "Eve Agent", aliases: [], isDefault: false },
  ];
  const pick = (name: string | undefined) => {
    const result = matchProject(projects, name);
    return result.kind === "match" ? result.project.name : result.kind;
  };

  test.each([
    ["begin-mobile", "begin-mobile"],
    ["Begin Mobile", "begin-mobile"],
    ["bugs", "begin-bugs"],
    ["the bug project", "begin-bugs"],
    ["mobile", "begin-mobile"],
    ["triage", "begin-bugs"],
    ["eve", "eve"],
    ["the eve agent repo", "eve"],
    ["mob", "begin-mobile"],
    ["", "begin-bugs"],
    [undefined, "begin-bugs"],
    ["the project", "begin-bugs"],
    ["begin", "ambiguous"],
    ["payroll", "unknown"],
  ])("%s -> %s", (name, expected) => {
    expect(pick(name)).toBe(expected);
  });

  test("ambiguity lists the candidates", () => {
    const result = matchProject(projects, "begin");
    expect(result.kind === "ambiguous" && result.candidates.map((p) => p.name)).toEqual(["begin-bugs", "begin-mobile"]);
  });

  test("no projects, and no default when no name is given", () => {
    expect(matchProject([], "bugs").kind).toBe("no_projects");
    expect(matchProject([{ ...projects[1]!, isDefault: false }], "").kind).toBe("no_default");
  });
});
