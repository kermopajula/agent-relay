import { describe, expect, test } from "vitest";
import { originAllowed, waitSeconds } from "./config";
import { chooseDuration, parseDuration } from "./duration";
import { matchTask } from "./match";
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
