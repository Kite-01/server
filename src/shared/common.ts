import {
  type Abi,
  type AbiEvent,
  getAddress,
  keccak256,
  zeroAddress,
  toHex,
} from "viem";
import { randomUUID, randomBytes } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { SdkConfigError } from "./errors";
import { type KeyVars } from "./constants";
import { get } from "lodash";

class Common {
  uuidv4 = () => randomUUID();

  isZeroAddress = (address: string) => address === zeroAddress;

  normalizeAddress = (address: string) => getAddress(address);

  toMs = (s: number) => s * 1000;

  pow10 = (n: number) => 10n ** BigInt(n);

  ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

  generateSecret = (prefix: string) => {
    const secret = `${prefix}${randomBytes(32).toString("base64url")}`;
    const secretHint = `${prefix}...${secret.slice(-4)}`;

    return { secret, secretHint };
  };

  toBigInt = (value: string | number | bigint) => {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(Math.trunc(value));
    return BigInt(value.trim());
  };

  compareAmount = (
    op: ComparisonOperator,
    a_: string | bigint,
    b_: string | bigint,
  ) => {
    const a = this.toBigInt(a_);
    const b = this.toBigInt(b_);

    switch (op) {
      case "_eq":
        return a === b;
      case "_neq":
        return a !== b;
      case "_gt":
        return a > b;
      case "_gte":
        return a >= b;
      case "_lt":
        return a < b;
      case "_lte":
        return a <= b;
      default:
        return false;
    }
  };

  getHeader = (headers: Record<string, unknown>, key: string) => {
    const value = get(headers, key, get(headers, key.toLowerCase(), null));
    return typeof value === "string" && value.trim().length > 0
      ? value
      : undefined;
  };

  rawBodyToString = (body: unknown, raw?: string | Buffer) => {
    if (!!raw) return Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
    if (typeof body === "string") return body;
    return JSON.stringify(body);
  };

  safeCompare = (a: string, b: string) => {
    const left = Buffer.from(a, "utf8");
    const right = Buffer.from(b, "utf8");
    return left.length !== right.length ? false : timingSafeEqual(left, right);
  };

  getVar = (options: SdkOptions, keyVar: KeyVars) => {
    const value = get(options.variables, keyVar, null);
    return value;
  };

  requireVar = (options: SdkOptions, keyVar: KeyVars) => {
    const value = get(options.variables, keyVar, null);
    if (!value) throw new SdkConfigError(keyVar);
    return value;
  };

  topicToAddress = (topic: string) => `0x${topic.slice(-40)}`;

  eventSignatureToTopic0 = (signature: string) => {
    const value = signature.trim();
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) return value;
    return keccak256(toHex(value));
  };

  eventFragmentFromAbi = (abi: Abi, eventName: string) => {
    const fragment = abi.find(
      (item): item is AbiEvent =>
        item.type === "event" && item.name === eventName,
    );

    return fragment ?? null;
  };

  eventSignatureFromAbi = (abi: Abi, eventName: string) => {
    const fragment = this.eventFragmentFromAbi(abi, eventName);
    if (!fragment) return null;

    const inputs = fragment.inputs.map((input) => input.type).join(",");
    return `${eventName}(${inputs})`;
  };

  serializeData = (data: unknown) => {
    JSON.parse(
      JSON.stringify(data, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );
  };
}

export const common = new Common();
