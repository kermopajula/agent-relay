import { afterEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import { decryptToken } from "./lib/crypto";
import { ENCRYPTION_KEY, setup } from "./test.helpers";

const FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEFGHJKLMNOPQRSTUVW/fire";
const TOKEN = "sk-ant-oat01-test-token-0123456789abcdef";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("projects:add", () => {
  test("stores the token encrypted and returns no token", async () => {
    const t = setup();
    const view = await t.action(internal.projects.add, { name: "begin-bugs", fireUrl: FIRE_URL, token: TOKEN });
    expect(view).toMatchObject({ name: "begin-bugs", displayName: "Begin Bugs", aliases: [], isDefault: true });
    expect(JSON.stringify(view)).not.toContain(TOKEN);

    const [stored] = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(stored?.encryptedToken).toMatch(/^v1:/);
    expect(stored?.encryptedToken).not.toContain(TOKEN);
    expect(await decryptToken(stored?.encryptedToken ?? "", ENCRYPTION_KEY)).toBe(TOKEN);
  });

  test("the first project is the default, later ones only when asked", async () => {
    const t = setup();
    await t.action(internal.projects.add, { name: "begin-bugs", fireUrl: FIRE_URL, token: TOKEN });
    await t.action(internal.projects.add, { name: "begin-mobile", fireUrl: FIRE_URL, token: TOKEN });
    await t.action(internal.projects.add, { name: "begin-web", fireUrl: FIRE_URL, token: TOKEN, makeDefault: true });
    const list = await t.query(internal.projects.list, {});
    expect(list.map((p) => [p.name, p.isDefault])).toEqual([
      ["begin-bugs", false],
      ["begin-mobile", false],
      ["begin-web", true],
    ]);
  });

  test.each([
    ["a bad slug", { name: "Begin Bugs" }, /lowercase slug/],
    ["an http URL", { fireUrl: FIRE_URL.replace("https", "http") }, /fireUrl must look like/],
    ["another host", { fireUrl: FIRE_URL.replace("api.anthropic.com", "evil.example") }, /fireUrl must look like/],
    ["another path", { fireUrl: FIRE_URL.replace("/fire", "/run") }, /fireUrl must look like/],
    ["a query string", { fireUrl: `${FIRE_URL}?x=1` }, /fireUrl must look like/],
    ["an empty token", { token: " " }, /API token/],
  ])("rejects %s", async (_label, override, message) => {
    const t = setup();
    await expect(
      t.action(internal.projects.add, { name: "begin-bugs", fireUrl: FIRE_URL, token: TOKEN, ...override }),
    ).rejects.toThrow(message);
    expect(await t.query(internal.projects.list, {})).toEqual([]);
  });

  test("rejects a duplicate name", async () => {
    const t = setup();
    await t.action(internal.projects.add, { name: "begin-bugs", fireUrl: FIRE_URL, token: TOKEN });
    await expect(t.action(internal.projects.add, { name: "begin-bugs", fireUrl: FIRE_URL, token: TOKEN })).rejects.toThrow(
      /exists/,
    );
  });

  test("refuses to store a token without a valid TOKEN_ENCRYPTION_KEY", async () => {
    for (const key of ["", "dG9vIHNob3J0"]) {
      const t = setup({ TOKEN_ENCRYPTION_KEY: key });
      await expect(t.action(internal.projects.add, { name: "begin-bugs", fireUrl: FIRE_URL, token: TOKEN })).rejects.toThrow(
        /openssl rand -base64 32/,
      );
    }
  });
});

describe("projects:list, remove, setDefault, rotateToken", () => {
  test("list never returns a token or its ciphertext", async () => {
    const t = setup();
    await t.action(internal.projects.add, { name: "begin-bugs", aliases: ["bugs"], fireUrl: FIRE_URL, token: TOKEN });
    const list = await t.query(internal.projects.list, {});
    const json = JSON.stringify(list);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("encryptedToken");
    expect(json).not.toContain("v1:");
    expect(list[0]?.aliases).toEqual(["bugs"]);
  });

  test("setDefault moves the default and remove says when none is left", async () => {
    const t = setup();
    await t.action(internal.projects.add, { name: "begin-bugs", fireUrl: FIRE_URL, token: TOKEN });
    await t.action(internal.projects.add, { name: "begin-mobile", fireUrl: FIRE_URL, token: TOKEN });
    await t.mutation(internal.projects.setDefault, { name: "begin-mobile" });
    expect((await t.query(internal.projects.list, {})).map((p) => p.isDefault)).toEqual([false, true]);
    expect(await t.mutation(internal.projects.remove, { name: "begin-mobile" })).toContain("no default project");
    expect((await t.query(internal.projects.list, {})).map((p) => p.name)).toEqual(["begin-bugs"]);
    await expect(t.mutation(internal.projects.remove, { name: "nope" })).rejects.toThrow(/No project named "nope"/);
  });

  test("rotateToken replaces the stored token", async () => {
    const t = setup();
    await t.action(internal.projects.add, { name: "begin-bugs", fireUrl: FIRE_URL, token: TOKEN });
    const fresh = "sk-ant-oat01-rotated-token-9876543210";
    const view = await t.action(internal.projects.rotateToken, { name: "begin-bugs", token: fresh });
    expect(JSON.stringify(view)).not.toContain(fresh);
    const [stored] = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(await decryptToken(stored?.encryptedToken ?? "", ENCRYPTION_KEY)).toBe(fresh);
  });
});

describe("projects:update", () => {
  test("replaces the aliases and leaves the rest alone", async () => {
    const t = setup();
    const before = await t.action(internal.projects.add, {
      name: "begin-bugs",
      displayName: "Begin",
      aliases: ["bugs"],
      fireUrl: FIRE_URL,
      token: TOKEN,
    });
    const view = await t.mutation(internal.projects.update, { name: "begin-bugs", aliases: [" begin bugs ", "the app"] });
    expect(view).toEqual({ ...before, aliases: ["begin bugs", "the app"] });
    expect(await t.query(internal.projects.list, {})).toEqual([view]);
  });

  test("changes only the display name", async () => {
    const t = setup();
    const before = await t.action(internal.projects.add, { name: "begin-bugs", aliases: ["bugs"], fireUrl: FIRE_URL, token: TOKEN });
    const view = await t.mutation(internal.projects.update, { name: "begin-bugs", displayName: "  Begin  " });
    expect(view).toEqual({ ...before, displayName: "Begin" });
  });

  test("an empty alias list clears the aliases", async () => {
    const t = setup();
    await t.action(internal.projects.add, { name: "begin-bugs", aliases: ["bugs"], fireUrl: FIRE_URL, token: TOKEN });
    const view = await t.mutation(internal.projects.update, { name: "begin-bugs", aliases: [] });
    expect(view.aliases).toEqual([]);
  });

  test("changes the fire URL", async () => {
    const t = setup();
    await t.action(internal.projects.add, { name: "begin-bugs", fireUrl: FIRE_URL, token: TOKEN });
    const other = FIRE_URL.replace("trig_01ABCDEFGHJKLMNOPQRSTUVW", "trig_01ZYXWVUTSRQPONMLKJHGFEDCB");
    const view = await t.mutation(internal.projects.update, { name: "begin-bugs", fireUrl: ` ${other} ` });
    expect(view.fireUrl).toBe(other);
  });

  test.each([
    ["an http URL", { fireUrl: FIRE_URL.replace("https", "http") }, /fireUrl must look like/],
    ["another host", { fireUrl: FIRE_URL.replace("api.anthropic.com", "evil.example") }, /fireUrl must look like/],
    ["a query string", { fireUrl: `${FIRE_URL}?x=1` }, /fireUrl must look like/],
    ["an empty display name", { displayName: " " }, /displayName must be 1 to 60 characters/],
    ["a long alias", { aliases: ["x".repeat(61)] }, /Each alias must be 1 to 60 characters/],
    ["too many aliases", { aliases: Array.from({ length: 11 }, (_, i) => `alias ${i}`) }, /At most 10 aliases/],
  ])("rejects %s and changes nothing", async (_label, override, message) => {
    const t = setup();
    const before = await t.action(internal.projects.add, { name: "begin-bugs", aliases: ["bugs"], fireUrl: FIRE_URL, token: TOKEN });
    await expect(t.mutation(internal.projects.update, { name: "begin-bugs", ...override })).rejects.toThrow(message);
    expect(await t.query(internal.projects.list, {})).toEqual([before]);
  });

  test("rejects an unknown name", async () => {
    const t = setup();
    await expect(t.mutation(internal.projects.update, { name: "nope", displayName: "Nope" })).rejects.toThrow(
      /No project named "nope"/,
    );
  });

  test("follows the same overlap rules as add", async () => {
    // add does not refuse a display name or alias that another project uses, so update does not either.
    // A project may also keep its own display name and aliases.
    const t = setup();
    await t.action(internal.projects.add, { name: "begin-bugs", aliases: ["bugs"], fireUrl: FIRE_URL, token: TOKEN });
    await t.action(internal.projects.add, { name: "begin-mobile", aliases: ["phone"], fireUrl: FIRE_URL, token: TOKEN });
    const self = await t.mutation(internal.projects.update, {
      name: "begin-mobile",
      displayName: "Begin Mobile",
      aliases: ["phone"],
    });
    expect(self).toMatchObject({ displayName: "Begin Mobile", aliases: ["phone"] });
    const other = await t.mutation(internal.projects.update, { name: "begin-mobile", aliases: ["bugs", "phone"] });
    expect(other.aliases).toEqual(["bugs", "phone"]);
  });

  test("keeps the token and returns no token", async () => {
    const t = setup();
    await t.action(internal.projects.add, { name: "begin-bugs", fireUrl: FIRE_URL, token: TOKEN });
    const [before] = await t.run((ctx) => ctx.db.query("projects").collect());
    const view = await t.mutation(internal.projects.update, {
      name: "begin-bugs",
      displayName: "Begin",
      aliases: ["the app"],
      fireUrl: FIRE_URL,
    });
    const json = JSON.stringify(view);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain("encryptedToken");
    expect(json).not.toContain("v1:");
    const [after] = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(after?.encryptedToken).toBe(before?.encryptedToken);
    expect(after?.tokenUpdatedAt).toBe(before?.tokenUpdatedAt);
    expect(view.tokenUpdatedAt).toBe(before?.tokenUpdatedAt);
    expect(await decryptToken(after?.encryptedToken ?? "", ENCRYPTION_KEY)).toBe(TOKEN);
  });
});
