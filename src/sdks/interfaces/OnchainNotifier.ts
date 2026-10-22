export interface OnchainNotifier {
  trackAddressActivity(
    input: OnchainNotifierTrackAddressActivityInput,
    options: SdkOptions,
  ): Promise<void>;

  trackKiteContractEvent(
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
