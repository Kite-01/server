// A fixed-window limit kept in memory, so each server instance counts on its own.
export class RateLimiter {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  // whether the key may go ahead, and if not, seconds until it may
  take = (key: string, now = Date.now()) => {
    if (this.windows.size > 10_000) {
      for (const [k, w] of this.windows) {
        if (now - w.start >= this.windowMs) this.windows.delete(k);
      }
    }

    const current = this.windows.get(key);
    if (!current || now - current.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(
          (current.start + this.windowMs - now) / 1000,
        ),
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };

  reset = () => this.windows.clear();
}

// The last X-Forwarded-For entry is the one the server's own proxy added, so a
// client can't choose it. Without a proxy there's no telling clients apart.
export const clientKey = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for");

  return forwarded?.split(",").at(-1)?.trim() || null;
};
