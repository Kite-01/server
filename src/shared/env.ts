import { common } from "./common";
import { config } from "dotenv";
import { z } from "zod";

config();

const EnvSchema = z.object({
  KITE_PUBLIC_BASE_URL: z.url(),
  KITE_PG_DB_URL: z.url(),
  KITE_ENCRYPTION_KEY: z
    .base64()
    .refine((value) => Buffer.from(value, "base64").length === 32),
  KITE_OPERATOR_MNEMONIC: z
    .string()
    .refine(common.isValidMnemonic, "Invalid mnemonic"),
  KITE_USERNAME: z.string().default("pilot"),
  KITE_PASSWORD: z.string().min(1),
  KITE_ENABLE_DASHBOARD: z.stringbool().default(true),
  KITE_ENABLE_OPENAPI_UI_SPECS: z.stringbool().default(true),
  KITE_ENABLE_OPENAPI_UI_PROVIDER: z.enum(["scalar", "swagger"]),
});

export const env = EnvSchema.parse(process.env);
