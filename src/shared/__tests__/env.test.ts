import { afterEach, describe, expect, it, vi } from "vitest";

const original = process.env.KITE_ROOT_KEY;

const loadEnv = async (rootKey: string) => {
  vi.resetModules();
  process.env.KITE_ROOT_KEY = rootKey;
  return import("../env.js");
};

describe("environment", () => {
  afterEach(() => {
    process.env.KITE_ROOT_KEY = original;
  });

  it("accepts any string of 16 characters or more as the root key", async () => {
    const { env } = await loadEnv("any normal string 16+ chars");
    expect(env.KITE_ROOT_KEY).toBe("any normal string 16+ chars");
  });

  it("rejects a root key that is too short to be a secret", async () => {
    await expect(loadEnv("short")).rejects.toThrow(/16 characters/);
  });
});
