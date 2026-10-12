import { describe, expect, test } from "vitest";
import { originAllowed, taskTimeoutHours, timeZoneOrUtc, waitSeconds } from "./config";
import { constantTimeEqual, decryptToken, encryptToken, randomSecret, sha256Hex } from "./crypto";
import { matchProject, matchTask } from "./match";
import { dedupeName, displayNameFromSlug, provisionalName } from "./names";
import { parseFireUrl } from "./routineApi";
import { secretFromPath, secretsMatch } from "./secret";
import { formatSpan } from "./summary";

describe("matchTask", () => {
  const tasks = [
    { name: "new Legacy Monolith task, sent 10:05", sentName: "new Legacy Monolith task, sent 10:05" },
    { name: "Fix login crash", sentName: "new Legacy Monolith task, sent 09:00" },
    { name: "Bug sweep", sentName: "new Legacy Mainframes task, sent 08:00" },
  ];
  const pick = (name: string) => matchTask(tasks, name)?.name ?? null;

  test.each([
    ["last", "new Legacy Monolith task, sent 10:05"],
    ["", "new Legacy Monolith task, sent 10:05"],
    ["the last task", "new Legacy Monolith task, sent 10:05"],
    ["Fix login crash", "Fix login crash"],
    ["fix login", "Fix login crash"],
    ["login crash", "Fix login crash"],
    ["the login crash task", "Fix login crash"],
    ["new Legacy Monolith task, sent 09:00", "Fix login crash"],
    ["the Legacy Mainframes task", "Bug sweep"],
    ["task 7", null],
    ["payroll", null],
  ])("%s -> %s", (name, expected) => {
    expect(pick(name)).toBe(expected);
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
    expect([undefined, "", "Europe/Helsinki", "Mars/Olympus"].map(timeZoneOrUtc)).toEqual([
      "UTC",
      "UTC",
      "Europe/Helsinki",
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
    expect(displayNameFromSlug("legacy-monolith")).toBe("Legacy Monolith");
  });

  test("provisionalName uses the display time zone", () => {
    const at = new Date("2026-10-11T10:05:00Z").getTime();
    expect(provisionalName("Legacy Mainframes", at, "UTC")).toBe("new Legacy Mainframes task, sent 10:05");
    expect(provisionalName("Legacy Mainframes", at, "Europe/Helsinki")).toBe("new Legacy Mainframes task, sent 13:05");
  });

  test("dedupeName adds the first free number", () => {
    expect(dedupeName("Fix crash", [])).toBe("Fix crash");
    expect(dedupeName("Fix crash", ["Fix crash"])).toBe("Fix crash (2)");
    expect(dedupeName("Fix crash", ["Fix crash", "Fix crash (2)"])).toBe("Fix crash (3)");
  });
});

describe("matchProject", () => {
  const projects = [
    { name: "legacy-mainframes", displayName: "Legacy Mainframes", aliases: ["triage"], isDefault: true },
    { name: "legacy-monolith", displayName: "Legacy Monolith", aliases: [], isDefault: false },
    { name: "eve", displayName: "Eve Agent", aliases: [], isDefault: false },
  ];
  const pick = (name: string | undefined) => {
    const result = matchProject(projects, name);
    return result.kind === "match" ? result.project.name : result.kind;
  };

  test.each([
    ["legacy-monolith", "legacy-monolith"],
    ["Legacy Monolith", "legacy-monolith"],
    ["mainframes", "legacy-mainframes"],
    ["the mainframe project", "legacy-mainframes"],
    ["monolith", "legacy-monolith"],
    ["triage", "legacy-mainframes"],
    ["eve", "eve"],
    ["the eve agent repo", "eve"],
    ["mono", "legacy-monolith"],
    ["", "legacy-mainframes"],
    [undefined, "legacy-mainframes"],
    ["the project", "legacy-mainframes"],
    ["legacy", "ambiguous"],
    ["payroll", "unknown"],
  ])("%s -> %s", (name, expected) => {
    expect(pick(name)).toBe(expected);
  });

  test("ambiguity lists the candidates", () => {
    const result = matchProject(projects, "legacy");
    expect(result.kind === "ambiguous" && result.candidates.map((p) => p.name)).toEqual(["legacy-mainframes", "legacy-monolith"]);
  });

  test("no projects, and no default when no name is given", () => {
    expect(matchProject([], "mainframes").kind).toBe("no_projects");
    expect(matchProject([{ ...projects[1]!, isDefault: false }], "").kind).toBe("no_default");
  });
});
