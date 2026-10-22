import { isAddress } from "viem";
import { z } from "zod";

const AddressSchema = z.string().refine(isAddress);

export const x402_RequirementSchema = z.object({
  scheme: z.string(),
  network: z.string().regex(/^eip155:[0-9]+$/),
  asset: AddressSchema,
  amount: z.string().regex(/^[0-9]+$/),
  payTo: AddressSchema,
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()),
});

export const x402_PaymentPayloadSchema = z.object({
  x402Version: z.literal(2),
  accepted: x402_RequirementSchema,
  payload: z.object({
    signature: z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/),
    authorization: z.object({
      from: AddressSchema,
      to: AddressSchema,
      value: z.string().regex(/^[0-9]+$/),
      validAfter: z.string().regex(/^[0-9]+$/),
      validBefore: z.string().regex(/^[0-9]+$/),
      nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    }),
  }),
});
