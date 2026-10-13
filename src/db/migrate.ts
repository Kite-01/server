import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from ".";

const main = async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await sql.end({ timeout: 5 });
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
