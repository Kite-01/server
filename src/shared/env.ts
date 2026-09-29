import { config } from "dotenv";
import { z } from "zod";

config();

const EnvSchema = z.object({
  KITE_PUBLIC_BASE_URL: z.url(),
  KITE_PG_DB_URL: z.url(),
});

export const env = EnvSchema.parse(process.env);
