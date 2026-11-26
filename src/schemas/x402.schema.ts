import { isAddress } from "viem";
import { z } from "zod";
import { isNearAccountId } from "../shared/nearAccount";
import { isStellarAddress } from "../shared/stellarAddress";
import { isGnoValue } from "../shared/gnoAddress";

const AddressSchema = z
  .string()
  .refine(
    (value) =>
      isAddress(value) ||
      isNearAccountId(value) ||
      isStellarAddress(value) ||
      isGnoValue(value),
  );

const EvmPayloadSchema = z.object({
  signature: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
  authorization: z.object({
    from: AddressSchema,
    to: AddressSchema,
    value: z.string().regex(/^[0-9]+$/),
    validAfter: z.string().regex(/^[0-9]+$/),
    validBefore: z.string().regex(/^[0-9]+$/),
    nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }),
});

const NearPayloadSchema = z.object({
  signedDelegateAction: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

const StellarPayloadSchema = z.object({
  transaction: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export const x402_RequirementSchema = z.object({
  scheme: z.string(),
  network: z
    .string()
    .regex(
      /^(eip155:[0-9]+|near:(mainnet|testnet)|stellar:(pubnet|testnet)|gno:[a-z0-9-]+)$/,
    ),
  asset: AddressSchema,
  amount: z.string().regex(/^[0-9]+$/),
  payTo: AddressSchema,
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()),
});

export const x402_PaymentPayloadSchema = z.object({
  x402Version: z.literal(2),
  accepted: x402_RequirementSchema,
  payload: z.union([EvmPayloadSchema, NearPayloadSchema, StellarPayloadSchema]),
});
