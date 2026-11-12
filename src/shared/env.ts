import { common } from "./common";
import { config } from "dotenv";
import { z } from "zod";

config({ quiet: true });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["production", "development"]).default("development"),
  KITE_PORT: z.coerce.number().int().positive().default(3000),
  KITE_PUBLIC_BASE_URL: z.url(),
  KITE_PG_DB_URL: z.url(),
  KITE_PG_DB_CERTIFICATE: z
    .string()
    .optional()
    .refine(common.isValidPemCert, "Must be a valid PEM-encoded certificate")
    .transform((pem) => pem?.replace(/\\n/g, "\n").trim() || undefined),
  KITE_PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  KITE_PG_BOSS_POOL_MAX: z.coerce.number().int().positive().default(20),
  KITE_ENCRYPTION_KEY: z
    .base64()
    .refine((value) => Buffer.from(value, "base64").length === 32),
  KITE_OPERATOR_MNEMONIC: z
    .string()
    .refine(common.isValidMnemonic, "Invalid mnemonic"),
  KITE_ROOT_KEY: z.string().min(16, "Must be at least 16 characters"),
  KITE_ENABLE_DASHBOARD: z.stringbool().default(true),
  KITE_ENABLE_OPENAPI_UI_SPECS: z.stringbool().default(true),
  KITE_ENABLE_OPENAPI_UI_PROVIDER: z
    .enum(["scalar", "swagger"])
    .default("scalar"),
  KITE_IS_TESTNET: z.stringbool().default(false),
});

export const env = EnvSchema.parse(process.env);

// left out without a certificate, so the URL's sslmode still applies
export const pgSslOptions = env.KITE_PG_DB_CERTIFICATE
  ? { ssl: { ca: env.KITE_PG_DB_CERTIFICATE } }
  : {};
