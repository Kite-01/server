import { config } from "dotenv";
import { z } from "zod";

config();

const HEX_64 = /^0x[0-9a-fA-F]{64}$/;
const HEX_64_NO_PREFIX = /^[0-9a-fA-F]{64}$/;

const EnvSchema = z.object({
  KITE_PUBLIC_BASE_URL: z.url(),
  KITE_PG_DB_URL: z.url(),
  KITE_ENABLE_DASHBOARD: z.coerce.boolean().default(true),
  /**
   * 32-byte key (64 hex chars, optional 0x prefix) for encrypting secrets at
   * rest: provider credentials, webhook/callback signing keys, chain RPC URLs.
   */
  KITE_ENCRYPTION_KEY: z
    .string()
    .refine((v) => HEX_64.test(v) || HEX_64_NO_PREFIX.test(v), {
      message: "must be 64 hex characters (32 bytes), with optional 0x prefix",
    }),

  /**
   * Private key of the operator address (the factory's OPERATOR_ROLE). Used to
   * sign deploy/settle/refund/recover transactions through the actor. The
   * operator is never the payer. Never log or return this value.
   */
  KITE_ADMIN_PRIVATE_KEY: z.string().refine((v) => HEX_64.test(v), {
    message: "must be a 0x-prefixed 64-hex-character private key",
  }),

  KITE_TELEMETRY_ENABLED: z.coerce.boolean().default(false),
  KITE_MAX_GAS_PRICE_WEI: z.coerce.bigint().optional(),
});

export const env = EnvSchema.parse(process.env);
