export interface OnchainNotifier {
  track(
    input: OnchainNotifierTrackInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult>;

  trackEvent(
    input: OnchainNotifierTrackEventInput,
    options: SdkOptions,
  ): Promise<OnchainNotifierTrackResult>;

  untrack(correlationId: string, options: SdkOptions): Promise<void>;

  isValidCallback(
    input: OnchainNotifierVerifyCallbackInput,
    options: SdkOptions,
  ): boolean;

  handleCallback(
    payload: Record<string, unknown>,
  ): Promise<OnchainNotifierCallbackResult>;
}
