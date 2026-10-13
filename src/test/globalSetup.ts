import { type TestProject } from "vitest/node";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";

declare module "vitest" {
  export interface ProvidedContext {
    adminUrl: string;
  }
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

export default async function setup(project: TestProject) {
  let adminUrl = process.env.KITE_PG_DB_URL;
  let stop = async () => {};

  if (!adminUrl) {
    const dir = await mkdtemp(join(tmpdir(), "kite-pg-"));
    const port = await freePort();
    const pg = new EmbeddedPostgres({
      databaseDir: dir,
      user: "postgres",
      password: "postgres",
      port,
      persistent: false,
      onLog: () => {},
    });

    await pg.initialise();
    await pg.start();

    adminUrl = `postgres://postgres:postgres@localhost:${port}/postgres`;
    stop = async () => {
      await pg.stop();
      await rm(dir, {
        recursive: true,
        force: true,
      });
    };
  }

  try {
    const admin = postgres(adminUrl, {
      max: 1,
      onnotice: () => {},
    });

    await admin.unsafe("DROP DATABASE IF EXISTS kite_template WITH (FORCE)");
    await admin.unsafe("CREATE DATABASE kite_template");
    await admin.end();

    const templateUrl = new URL(adminUrl);
    templateUrl.pathname = "/kite_template";

    const client = postgres(templateUrl.toString(), {
      max: 1,
    });

    try {
      await migrate(drizzle(client), {
        migrationsFolder: "./drizzle",
      });
    } finally {
      await client.end();
    }
  } catch (error) {
    await stop();
    throw error;
  }

  project.provide("adminUrl", adminUrl);

  return stop;
}
