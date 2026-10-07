import { config } from "dotenv";
import { z } from "zod";

config();

const EnvSchema = z.object({
  KITE_PUBLIC_BASE_URL: z.url(),
  KITE_PG_DB_URL: z.url(),
  KITE_ENCRYPTION_KEY: z.base64(),
  KITE_OPERATOR_MNEMONIC: z.hex(),
  KITE_USERNAME: z.string().default("pilot"),
  KITE_PASSWORD: z.string(),
  KITE_ENABLE_DASHBOARD: z.coerce.boolean().default(true),
  KITE_ENABLE_OPENAPI_UI_SPECS: z.coerce.boolean().default(true),
  KITE_ENABLE_OPENAPI_UI_PROVIDER: z.enum(["scalar", "swagger"]),
});

export const env = EnvSchema.parse(process.env);
