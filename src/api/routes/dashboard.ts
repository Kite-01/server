import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { Elysia, type AnyElysia } from "elysia";
import { HttpError } from "../../shared/errors";

const readAsset = async (relative: string) => {
  const root = resolve(process.cwd(), "client/dist");
  const absolute = resolve(root, `.${relative}`);
  if (!absolute.startsWith(root + sep)) {
    return null;
  }

  try {
    if (!(await stat(absolute)).isFile()) {
      return null;
    }

    return {
      absolute,
      body: await readFile(absolute),
    };
  } catch {
    return null;
  }
};

const respond = (
  asset: {
    absolute: string;
    body: Buffer;
  },
  immutable: boolean,
) => {
  const ContentTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".map": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
  };

  return new Response(new Uint8Array(asset.body), {
    headers: {
      "content-type":
        ContentTypes[extname(asset.absolute)] ?? "application/octet-stream",
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
};

const serve = async (request: Request) => {
  let pathname: string;

  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Not found", {
      status: 404,
    });
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    throw new HttpError(404, "NotFound", "Route not found");
  }

  const asset = await readAsset(pathname === "/" ? "/index.html" : pathname);
  if (asset) {
    return respond(asset, pathname.startsWith("/assets/"));
  }

  if (extname(pathname)) {
    return new Response("Not found", {
      status: 404,
    });
  }

  const index = await readAsset("/index.html");
  return index
    ? respond(index, false)
    : new Response("Not found", { status: 404 });
};

export const dashboardRoutes = new Elysia({ name: "Dashboard" })
  .get("/", ({ request }) => serve(request), { detail: { hide: true } })
  .get("/*", ({ request }) => serve(request), { detail: { hide: true } });

export const dashboardDevRoutes = async (
  openApiSpec: () => Promise<Response>,
) => {
  const root = resolve(process.cwd(), "client");
  const spec = await openApiSpec();

  if (spec.ok) {
    const specPath = resolve(root, "node_modules/.kite/openapi.json");
    await mkdir(dirname(specPath), {
      recursive: true,
    });

    await writeFile(specPath, await spec.text());

    process.env.KITE_OPENAPI_SPEC_PATH = specPath;
  }

  const { vite } = await import("elysia-vite-server");
  const plugin = await vite({
    mode: "development",
    static: false,
    vite: {
      root,
      appType: "custom",
      configLoader: "native",
      clearScreen: false,
    },
  });

  const server = plugin.decorator.vite;

  return new Elysia({ name: "DashboardDev" }).use(plugin as AnyElysia).get(
    "/*",
    async ({ request }) => {
      const url = new URL(request.url);
      if (
        url.pathname === "/api" ||
        url.pathname.startsWith("/api/") ||
        extname(url.pathname)
      ) {
        throw new HttpError(404, "NotFound", "Route not found");
      }

      const html = await readFile(resolve(root, "index.html"), "utf8");
      return new Response(await server.transformIndexHtml(request.url, html), {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      });
    },
    { detail: { hide: true } },
  );
};
