export interface GasSponsor {
  submitSponsoredCalls(
    input: OnchainActorTransactionInput,
    signer: import("viem").LocalAccount,
    options: SdkOptions,
  ): Promise<{ callId: string }>;

  getSponsoredCallsStatus(
    caip2Id: Caip2Id,
    callId: string,
    signer: import("viem").LocalAccount,
    options: SdkOptions,
  ): Promise<OnchainActorCallStatus>;

  getSponsorshipError(
    caip2Id: Caip2Id,
    signer: import("viem").LocalAccount,
    options: SdkOptions,
  ): Promise<string | null>;
}
