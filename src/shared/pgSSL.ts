import { env } from "./env";

// left out without a certificate, so the URL's sslmode still applies
export const pgSSLOptions = env.KITE_PG_DB_CERTIFICATE
  ? { ssl: { ca: env.KITE_PG_DB_CERTIFICATE } }
  : {};
