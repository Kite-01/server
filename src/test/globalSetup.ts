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
    testDbUrl: string;
  }
}

const freePort = () => {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
};

export default async function setup(project: TestProject) {
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

  const testDbUrl = `postgres://postgres:postgres@localhost:${port}/postgres`;
  const stop = async () => {
    await pg.stop();
    await rm(dir, {
      recursive: true,
      force: true,
    });
  };

  try {
    const admin = postgres(testDbUrl, {
      max: 1,
      onnotice: () => {},
    });

    await admin.unsafe("DROP DATABASE IF EXISTS kite_template WITH (FORCE)");
    await admin.unsafe("CREATE DATABASE kite_template");
    await admin.end();

    const templateUrl = new URL(testDbUrl);
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

  project.provide("testDbUrl", testDbUrl);

  return stop;
}
