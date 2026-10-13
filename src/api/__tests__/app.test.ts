import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const loadApp = async (flags: Record<string, string>) => {
  vi.resetModules();

  Object.assign(process.env, flags);

  const { createApp } = await import("../app.js");
  return createApp();
};

const get = (app: Awaited<ReturnType<typeof loadApp>>, path: string) => {
  return app.handle(new Request(`http://localhost${path}`));
};

describe("dashboard", { timeout: 60_000 }, () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "kite-dashboard-"));

    await mkdir(join(dir, "client/dist/assets"), { recursive: true });
    await writeFile(join(dir, "client/dist/index.html"), "<html>kite</html>");
    await writeFile(join(dir, "client/dist/assets/test.js"), "console.log(1)");

    await writeFile(join(dir, "secret.txt"), "secret");

    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });

  afterAll(async () => {
    vi.restoreAllMocks();

    await rm(dir, {
      recursive: true,
      force: true,
    });
  });

  it("is served at the root when enabled", async () => {
    const app = await loadApp({ KITE_ENABLE_DASHBOARD: "true" });
    const root = await get(app, "/");

    expect(root.status).toBe(200);
    expect(root.headers.get("content-type")).toContain("text/html");
    expect(await root.text()).toBe("<html>kite</html>");
    expect(root.headers.get("cache-control")).toBe("no-cache");
  });

  it("serves built assets with long-lived caching", async () => {
    const app = await loadApp({ KITE_ENABLE_DASHBOARD: "true" });
    const asset = await get(app, "/assets/test.js");

    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(asset.headers.get("cache-control")).toContain("immutable");
  });

  it("falls back to the app for client-side routes", async () => {
    const app = await loadApp({ KITE_ENABLE_DASHBOARD: "true" });
    const res = await get(app, "/apps/123/customers");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>kite</html>");
  });

  it("returns 404 for missing files, traversal attempts and unknown api paths", async () => {
    const app = await loadApp({ KITE_ENABLE_DASHBOARD: "true" });

    expect((await get(app, "/missing.png")).status).toBe(404);
    expect((await get(app, "/..%2F..%2Fsecret.txt")).status).toBe(404);
    expect((await get(app, "/assets/..%2F..%2F..%2Fsecret.txt")).status).toBe(
      404,
    );

    const api = await get(app, "/api/nope");
    const json = await api.json();

    expect(api.status).toBe(404);
    expect(json).toMatchObject({
      error: {
        code: "NotFound",
      },
    });
  });

  it("returns 404 everywhere when disabled", async () => {
    const app = await loadApp({ KITE_ENABLE_DASHBOARD: "false" });

    expect((await get(app, "/")).status).toBe(404);
    expect((await get(app, "/assets/test.js")).status).toBe(404);
    expect((await get(app, "/apps/123")).status).toBe(404);
  });
});

describe("OpenAPI", { timeout: 60_000 }, () => {
  it("serves the spec and the chosen UI when enabled", async () => {
    const scalar = await loadApp({
      KITE_ENABLE_OPENAPI_UI_SPECS: "true",
      KITE_ENABLE_OPENAPI_UI_PROVIDER: "scalar",
    });

    const ui = await get(scalar, "/openapi");

    expect(ui.status).toBe(200);
    expect((await ui.text()).toLowerCase()).toContain("scalar");

    const res = await get(scalar, "/openapi/json");
    const spec = await res.json();

    expect(spec.info.title).toBe("Kite");
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        "/api/apps/all",
        "/api/customers/{id}",
        "/api/payment-links/{id}/pay",
        "/api/x402/settle",
        "/api/apps",
      ]),
    );

    expect(spec.components.securitySchemes).toHaveProperty("signature");
    expect(Object.keys(spec.paths).some((p) => p.startsWith("/callback"))).toBe(
      false,
    );
  });

  it("can use Swagger UI instead", async () => {
    const swagger = await loadApp({
      KITE_ENABLE_OPENAPI_UI_SPECS: "true",
      KITE_ENABLE_OPENAPI_UI_PROVIDER: "swagger",
    });

    const ui = await get(swagger, "/openapi");

    expect(ui.status).toBe(200);
    expect((await ui.text()).toLowerCase()).toContain("swagger");
  });

  it("is not served when disabled", async () => {
    const app = await loadApp({
      KITE_ENABLE_OPENAPI_UI_SPECS: "false",
      KITE_ENABLE_DASHBOARD: "false",
    });

    expect((await get(app, "/openapi")).status).toBe(404);
    expect((await get(app, "/openapi/json")).status).toBe(404);
  });
});
