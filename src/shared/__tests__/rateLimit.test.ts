import { describe, expect, it } from "vitest";
import { clientKey, RateLimiter } from "../rateLimit";

describe("RateLimiter", () => {
  it("lets a key through up to its limit in each window", () => {
    const limiter = new RateLimiter(2, 60_000);

    expect(limiter.take("a", 0).allowed).toBe(true);
    expect(limiter.take("a", 1_000).allowed).toBe(true);
    expect(limiter.take("a", 2_000)).toEqual({
      allowed: false,
      retryAfterSeconds: 58,
    });
    expect(limiter.take("b", 2_000).allowed).toBe(true);
    expect(limiter.take("a", 60_000).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  const request = (forwarded?: string) =>
    new Request("http://localhost/pay/x", {
      headers: forwarded ? { "x-forwarded-for": forwarded } : {},
    });

  it("takes the address the server's own proxy added", () => {
    expect(clientKey(request("1.1.1.1, 2.2.2.2"))).toBe("2.2.2.2");
    expect(clientKey(request("3.3.3.3"))).toBe("3.3.3.3");
  });

  it("can't tell clients apart without a proxy", () => {
    expect(clientKey(request())).toBeNull();
  });
});
