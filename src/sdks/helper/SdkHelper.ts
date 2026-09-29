import { type AbiEvent, type Abi, keccak256, zeroAddress } from "viem";
import { timingSafeEqual } from "node:crypto";
import { SdkConfigError } from "../../shared/errors";
import { type KeyVars } from "../../shared/constants";
import { env } from "../../shared/env";
import { get } from "lodash";

export abstract class SdkHelper {
  BaseUrl: string = env.KITE_PUBLIC_BASE_URL;

  requireVar = (options: SdkOptions, keyVar: KeyVars) => {
    const value = get(options.variables, keyVar, null);
    if (!value) throw new SdkConfigError(keyVar);
    return value;
  };

  eventFragmentFromAbi = (abi: Abi, eventName: string) => {
    const fragment = abi.find((f) => f.type == "event" && f.name == eventName);
    if (!fragment) return null;

    return fragment as AbiEvent;
  };

  eventSignatureFromAbi = (abi: Abi, eventName: string) => {
    const fragment = this.eventFragmentFromAbi(abi, eventName);
    if (!fragment) return null;

    const inputs = (fragment as AbiEvent).inputs
      .map((input) => input.type)
      .join(",");

    return `${eventName}(${inputs})`;
  };

  eventSignatureToTopic0 = (signature: string) => {
    const value = signature.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
      return value;
    }

    return keccak256(`0x${value}`);
  };

  safeCompare = (a: string, b: string) => {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    if (left.length !== right.length) {
      return false;
    }

    return timingSafeEqual(left, right);
  };

  normalize = (v: string) => v.toLowerCase();

  isZeroAddress = (address: string) => address === zeroAddress;

  balanceOf = async (caip2Id: string, token: string, address: string) => {};
}
