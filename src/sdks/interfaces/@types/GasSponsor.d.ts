/**
 * The unsigned user operation we ask a paymaster to cover.
 *
 * Field names follow EntryPoint v0.7/v0.8 (`factory`/`factoryData`); for v0.6
 * the SDKs repack to `initCode` and `paymasterAndData` on the way out.
 */
type UserOperationDraft = {
  sender: string;
  nonce: string;
  callData: string;

  callGasLimit?: string;
  verificationGasLimit?: string;
  preVerificationGas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;

  factory?: string;
  factoryData?: string;

  /** Only for a counterfactual v0.6 account. */
  initCode?: string;

  /**
   * Present when the sender is a plain EOA delegating via EIP-7702, which is
   * what keeps the sponsored sender equal to the EOA's own address.
   */
  eip7702Auth?: import("../../../shared/erc4337").Eip7702Authorization;

  signature?: string;
};

type GasSponsorshipInput = {
  internalChainId: string;
  userOperation: UserOperationDraft;
  /** Defaults to EntryPoint v0.8. */
  entryPoint?: string;
  /**
   * Placeholder signature used during estimation. A real one is not available
   * yet, because the gas numbers being estimated are part of what gets signed.
   */
  dummySignature?: string;
  /** Provider-side policy: Alchemy's Gas Manager policyId, Pimlico's sponsorshipPolicyId. */
  policyId?: string;
};

type GasSponsorshipResult = {
  /** v0.7/v0.8 */
  paymaster?: string;
  paymasterData?: string;
  paymasterVerificationGasLimit?: string;
  paymasterPostOpGasLimit?: string;

  /** v0.6 packs both into this single field instead. */
  paymasterAndData?: string;

  /** Only populated by providers that estimate gas as part of sponsoring. */
  callGasLimit?: string;
  verificationGasLimit?: string;
  preVerificationGas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;

  /**
   * False means these are stub values for estimation only and you must call
   * `sponsor` again for the signed ones. ERC-7677 lets a paymaster short-circuit
   * to true when its data carries no signature.
   */
  isFinal: boolean;

  entryPoint: string;
  entryPointVersion: import("../../../shared/erc4337").EntryPointVersion;
};

/**
 * What a given sponsor can actually do. The two providers differ enough that
 * hiding this behind a uniform facade would mislead callers.
 */
type GasSponsorCapabilities = {
  /**
   * True when sponsoring also returns gas limits and fees (Alchemy), so the
   * caller can skip `eth_estimateUserOperationGas` entirely. False for
   * standards-compliant ERC-7677 paymasters (Pimlico), where the caller must
   * estimate against a bundler itself.
   */
  providesGasEstimates: boolean;
  /** True when a separate stub phase is required before the final call. */
  requiresStubPhase: boolean;
  supportsEip7702: boolean;
  /** True when the provider speaks the standard ERC-7677 `pm_*` methods. */
  erc7677Compliant: boolean;
};

type UserOperationGasPrice = {
  slow: { maxFeePerGas: string; maxPriorityFeePerGas: string };
  standard: { maxFeePerGas: string; maxPriorityFeePerGas: string };
  fast: { maxFeePerGas: string; maxPriorityFeePerGas: string };
};
