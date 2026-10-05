import { sql } from "drizzle-orm";

export const toEnum = <T extends string>(e: Record<string, T>) => {
  return Object.values(e) as [T, ...T[]];
};

export const toSqlList = (values: readonly string[]) => {
  return sql.raw(values.map((v) => `'${v}'`).join(", "));
};
