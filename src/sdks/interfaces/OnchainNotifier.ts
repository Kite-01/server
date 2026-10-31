export interface OnchainNotifier {
  getTrackingError(caip2Id: Caip2Id, options: SdkOptions): string | null;

  trackAddressActivity(
    input: OnchainNotifierTrackAddressActivityInput,
    options: SdkOptions,
  ): Promise<void>;

  trackKiteContractEvent(
    input: OnchainNotifierTrackContractEventInput,
    options: SdkOptions,
  ): Promise<void>;

  untrackAddressActivity(
    input: OnchainNotifierTrackAddressActivityInput,
    options: SdkOptions,
  ): Promise<void>;

  untrackKiteContractEvent(
    input: OnchainNotifierTrackContractEventInput,
    options: SdkOptions,
  ): Promise<void>;

  getCallbackUrl(activity: "addressActivity" | "contractEvent"): string;

  isValidCallback(
    input: OnchainNotifierVerifyCallbackInput,
    options: SdkOptions,
  ): Promise<boolean>;

  handleCallback(
    activity: "addressActivity" | "contractEvent",
    payload: Record<string, unknown>,
  ): Promise<OnchainNotifierCallbackResult | null>;
}
