import { afterAll, beforeEach, inject, vi } from "vitest";
import { testMnemonic } from "./mocks.js";
import { randomBytes } from "node:crypto";
import { rootKey } from "./rootKey.js";
import postgres from "postgres";

const testDbUrl = inject("testDbUrl");
const database = `kite_test_${randomBytes(6).toString("hex")}`;

const admin = postgres(testDbUrl, {
  max: 1,
});

await admin.unsafe(`CREATE DATABASE ${database} TEMPLATE kite_template`);
await admin.end();

const databaseUrl = new URL(testDbUrl);
databaseUrl.pathname = `/${database}`;

process.env.KITE_PG_DB_URL = databaseUrl.toString();
process.env.KITE_PUBLIC_BASE_URL = "http://localhost:3000";
process.env.KITE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.KITE_OPERATOR_MNEMONIC = testMnemonic;
process.env.KITE_ROOT_KEY = rootKey;

const resetClient = postgres(databaseUrl.toString(), {
  max: 1,
});

const tables = await resetClient<{ tablename: string }[]>`
  select tablename from pg_tables where schemaname = 'public' and tablename like 'kite_%'
`;

const truncateAll = `truncate ${tables.map((t) => `"${t.tablename}"`).join(", ")} restart identity cascade`;

beforeEach(async () => {
  await resetClient.unsafe(truncateAll);
});

afterAll(async () => {
  await resetClient.end();
  const cleanup = postgres(testDbUrl, { max: 1 });
  await cleanup.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await cleanup.end();
});

vi.mock("../shared/scheduler", async () => {
  const { schedulerMock } = await import("./mocks.js");
  return { Scheduler: schedulerMock };
});

vi.mock("../shared/onchainActor", async () => {
  const { fakeActor } = await import("./mocks.js");
  return {
    getOnchainActor: () => fakeActor,
    OnchainActorMap: {},
  };
});
