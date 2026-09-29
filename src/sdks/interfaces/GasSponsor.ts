export interface GasSponsor {
  readonly capabilities: GasSponsorCapabilities;

  /**
   * Stub paymaster fields for the gas-estimation pass. Providers that estimate
   * gas themselves return their final answer here and set `isFinal: true`, so a
   * caller can always call this first and skip `sponsor` when it is already final.
   */
  getStubSponsorship(
    input: GasSponsorshipInput,
    options: SdkOptions,
  ): Promise<GasSponsorshipResult>;

  /** Final, signed paymaster fields for an operation with real gas values. */
  sponsor(
    input: GasSponsorshipInput,
    options: SdkOptions,
  ): Promise<GasSponsorshipResult>;
}
