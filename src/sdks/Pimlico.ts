import { type GasSponsor } from "./interfaces/GasSponsor";
import { KeyVars, Provider } from "../shared/constants";
import { getChain } from "../shared/chains";
import {
  assertValidAuthorization,
  DEFAULT_ENTRY_POINT,
  entryPointVersion,
  isPackedEntryPoint,
  serialiseAuthorization,
  toHexQuantity,
} from "../shared/erc4337";
import { requireVar } from "../shared/utils";
import { JsonRpc, unwrap } from "./JsonRpc";

/**
 * Pimlico paymaster + bundler.
 * https://docs.pimlico.io/references/paymaster/erc20-paymaster/endpoints/pm_getPaymasterData
 *
 * - v1 of the API is the bundler, v2 is the paymaster: both are
 *   https://api.pimlico.io/v{n}/{chainId}/rpc?apikey=... with a numeric chain id.
 * - Pimlico implements standard ERC-7677, so it is a genuine two-phase flow:
 *   `pm_getPaymasterStubData` for estimation, then `pm_getPaymasterData` for the
 *   signed values. It does NOT estimate gas as part of sponsoring — that is a
 *   separate bundler call the caller owns.
 * - EIP-7702 works by passing `eip7702Auth` on the user operation, which keeps
 *   the sender equal to the EOA's own address.
 */
const PARAM_CONTEXT_POLICY = "sponsorshipPolicyId";

export class Pimlico implements GasSponsor {
  readonly capabilities: GasSponsorCapabilities = {
    providesGasEstimates: false,
    requiresStubPhase: true,
    supportsEip7702: true,
    erc7677Compliant: true,
  };

  getClient = (internalChainId: string, options: SdkOptions): JsonRpc => {
    const apiKey = requireVar(options, KeyVars.PimlicoApiKey, Provider.Pimlico);
    const { evmChainId } = getChain(internalChainId);

    return new JsonRpc(
      `https://api.pimlico.io/v2/${evmChainId}/rpc?apikey=${encodeURIComponent(apiKey)}`,
      Provider.Pimlico,
    );
  };

  getStubSponsorship = async (
    input: GasSponsorshipInput,
    options: SdkOptions,
  ): Promise<GasSponsorshipResult> =>
    this.request("pm_getPaymasterStubData", input, options);

  sponsor = async (
    input: GasSponsorshipInput,
    options: SdkOptions,
  ): Promise<GasSponsorshipResult> =>
    this.request("pm_getPaymasterData", input, options);

  /** Bundler-side gas prices; Pimlico will reject an op priced below these. */
  getUserOperationGasPrice = async (
    internalChainId: string,
    options: SdkOptions,
  ): Promise<UserOperationGasPrice> => {
    const apiKey = requireVar(options, KeyVars.PimlicoApiKey, Provider.Pimlico);
    const { evmChainId } = getChain(internalChainId);

    // Gas price lives on the bundler (v1), not the paymaster (v2).
    const client = new JsonRpc(
      `https://api.pimlico.io/v1/${evmChainId}/rpc?apikey=${encodeURIComponent(apiKey)}`,
      Provider.Pimlico,
    );

    const method = "pimlico_getUserOperationGasPrice";
    return unwrap(
      Provider.Pimlico,
      method,
      await client.call<UserOperationGasPrice>(method, []),
    );
  };

  private request = async (
    method: string,
    input: GasSponsorshipInput,
    options: SdkOptions,
  ): Promise<GasSponsorshipResult> => {
    const chain = getChain(input.internalChainId);
    const entryPoint = input.entryPoint ?? DEFAULT_ENTRY_POINT;
    const version = entryPointVersion(entryPoint);
    const client = this.getClient(input.internalChainId, options);

    const userOperation = buildUserOperation(input, chain.evmChainId, chain.supports7702);

    const context =
      input.policyId === undefined
        ? null
        : { [PARAM_CONTEXT_POLICY]: input.policyId };

    const result = unwrap(
      Provider.Pimlico,
      method,
      await client.call<Erc7677Response>(method, [
        userOperation,
        entryPoint,
        toHexQuantity(chain.evmChainId),
        context,
      ]),
    );

    return {
      // ERC-7677 may set isFinal on the stub call when paymasterData carries no
      // signature, which lets the caller skip the second round trip entirely.
      isFinal: result.isFinal ?? method === "pm_getPaymasterData",
      entryPoint,
      entryPointVersion: version,
      ...(isPackedEntryPoint(entryPoint)
        ? {
            paymasterAndData: result.paymasterAndData,
            // v0.6 lets the paymaster revise gas while sponsoring.
            callGasLimit: result.callGasLimit,
            verificationGasLimit: result.verificationGasLimit,
            preVerificationGas: result.preVerificationGas,
          }
        : {
            paymaster: result.paymaster,
            paymasterData: result.paymasterData,
            paymasterVerificationGasLimit: result.paymasterVerificationGasLimit,
            paymasterPostOpGasLimit: result.paymasterPostOpGasLimit,
          }),
    };
  };
}

type Erc7677Response = {
  paymaster?: string;
  paymasterData?: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;
  paymasterAndData?: string;
  callGasLimit?: string;
  verificationGasLimit?: string;
  preVerificationGas?: string;
  isFinal?: boolean;
  sponsor?: { name: string; icon?: string };
};

/**
 * Shape the draft for the wire: repack v0.6 `initCode`, drop undefined fields
 * (paymasters reject nulls), and serialise the 7702 authorization.
 */
export const buildUserOperation = (
  input: GasSponsorshipInput,
  evmChainId: number,
  supports7702?: boolean,
): Record<string, unknown> => {
  const op = input.userOperation;
  const entryPoint = input.entryPoint ?? DEFAULT_ENTRY_POINT;

  const wire: Record<string, unknown> = {
    sender: op.sender,
    nonce: op.nonce,
    callData: op.callData,
  };

  const optional: Array<keyof UserOperationDraft> = [
    "callGasLimit",
    "verificationGasLimit",
    "preVerificationGas",
    "maxFeePerGas",
    "maxPriorityFeePerGas",
  ];

  for (const key of optional) {
    if (op[key] !== undefined) wire[key] = op[key];
  }

  if (isPackedEntryPoint(entryPoint)) {
    if (op.initCode !== undefined) wire.initCode = op.initCode;
  } else {
    if (op.factory !== undefined) wire.factory = op.factory;
    if (op.factoryData !== undefined) wire.factoryData = op.factoryData;
  }

  if (op.eip7702Auth) {
    if (supports7702 === false) {
      throw new Error(
        `EIP-7702 is not enabled for chain ${evmChainId} in the chain registry`,
      );
    }
    assertValidAuthorization(op.eip7702Auth, evmChainId);
    wire.eip7702Auth = serialiseAuthorization(op.eip7702Auth);
  }

  const signature = op.signature ?? input.dummySignature;
  if (signature !== undefined) wire.signature = signature;

  return wire;
};
