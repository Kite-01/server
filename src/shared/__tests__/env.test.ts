import { afterEach, describe, expect, it, vi } from "vitest";

const original = process.env.KITE_ROOT_KEY;

// self-signed, valid until 2126
const Certificate = `-----BEGIN CERTIFICATE-----
MIIBhTCCASugAwIBAgIUQrtusHCCzIa/n3s1hspoHgAJOzowCgYIKoZIzj0EAwIw
FzEVMBMGA1UEAwwMa2l0ZS10ZXN0LWNhMCAXDTI2MTExMjE1NDQxNVoYDzIxMjYx
MDE5MTU0NDE1WjAXMRUwEwYDVQQDDAxraXRlLXRlc3QtY2EwWTATBgcqhkjOPQIB
BggqhkjOPQMBBwNCAASNqrTJWSeMq51gBWpNN3mXtapCY4khDDmegsgBjwCWso9D
mMqarBhWIycPCJI79vsGm24yatNO9+HVAK56SiYPo1MwUTAdBgNVHQ4EFgQUuARn
LZfewGORXBV/8BscZkjsgcQwHwYDVR0jBBgwFoAUuARnLZfewGORXBV/8BscZkjs
gcQwDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiEA8OqW01hFVo0t
s79f1Jju3Ut3NSywpqaWozz++kLEaKACIEdDEatXLy23pxoIAysDys7E5mwaeZcg
seZuRWnqWNXi
-----END CERTIFICATE-----`;

const loadEnv = async (rootKey: string, certificate?: string) => {
  vi.resetModules();
  process.env.KITE_ROOT_KEY = rootKey;
  if (certificate === undefined) delete process.env.KITE_PG_DB_CERTIFICATE;
  else process.env.KITE_PG_DB_CERTIFICATE = certificate;
  return import("../env.js");
};

describe("environment", () => {
  afterEach(() => {
    process.env.KITE_ROOT_KEY = original;
    delete process.env.KITE_PG_DB_CERTIFICATE;
  });

  it("accepts any string of 16 characters or more as the root key", async () => {
    const { env } = await loadEnv("any normal string 16+ chars");
    expect(env.KITE_ROOT_KEY).toBe("any normal string 16+ chars");
  });

  it("rejects a root key that is too short to be a secret", async () => {
    await expect(loadEnv("short")).rejects.toThrow(/16 characters/);
  });

  it("leaves Postgres TLS to the URL without a certificate", async () => {
    expect((await loadEnv(original!)).pgSslOptions).toEqual({});
    expect((await loadEnv(original!, "")).pgSslOptions).toEqual({});
  });

  it("verifies Postgres against the certificate, even one set on a single line", async () => {
    const { pgSslOptions } = await loadEnv(
      original!,
      Certificate.replace(/\n/g, "\\n"),
    );

    expect(pgSslOptions).toEqual({ ssl: { ca: Certificate } });
  });

  it("rejects a certificate that isn't PEM", async () => {
    await expect(loadEnv(original!, "not a certificate")).rejects.toThrow(
      /PEM-encoded certificate/,
    );
  });
});
