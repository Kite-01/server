import { env } from "node:process";

export const pgSSLOptions = env.KITE_PG_DB_CERTIFICATE
  ? { ssl: { ca: env.KITE_PG_DB_CERTIFICATE } }
  : {};
