import type { Http } from "../Http";

export interface BaseSdk {
  getClient(options: SdkOptions): Http;
}
