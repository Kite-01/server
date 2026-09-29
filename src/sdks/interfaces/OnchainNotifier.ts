export interface OnchainNotifier {
  track(
    appId: string,
    input: OnchainNotifierTrackInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult>;

  trackEvent(
    appId: string,
    input: OnchainNotifierTrackEventInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult>;

  untrack(
    appId: string,
    correlationId: string,
    options: SdkOptions,
  ): Promise<void>;

  getCallbackUrl(): string;

  isValidCallback(
    input: OnchainNotifierVerifyCallbackInput,
    options: SdkOptions,
  ): Promise<boolean>;

  handleCallback(
    payload: Record<string, unknown>,
  ): Promise<OnchainNotifierCallbackResult | void>;
}
