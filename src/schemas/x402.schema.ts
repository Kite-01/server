import { isAddress } from "viem";
import { z } from "zod";
import { isNearAccountId } from "../shared/nearAccount";

const AddressSchema = z
  .string()
  .refine((value) => isAddress(value) || isNearAccountId(value));

// EIP-3009 transferWithAuthorization, on EVM
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

// a base64 Borsh NEP-366 SignedDelegate for one ft_transfer, on NEAR
const NearPayloadSchema = z.object({
  signedDelegateAction: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export const x402_RequirementSchema = z.object({
  scheme: z.string(),
  network: z.string().regex(/^(eip155:[0-9]+|near:(mainnet|testnet))$/),
  asset: AddressSchema,
  amount: z.string().regex(/^[0-9]+$/),
  payTo: AddressSchema,
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()),
});

export const x402_PaymentPayloadSchema = z.object({
  x402Version: z.literal(2),
  accepted: x402_RequirementSchema,
  payload: z.union([EvmPayloadSchema, NearPayloadSchema]),
});
