export interface GasSponsor {
  sendSponsoredTransaction(
    input: OnchainActorTransactionInput,
    signer: import("viem").LocalAccount,
    options: SdkOptions,
  ): Promise<string>;
}
