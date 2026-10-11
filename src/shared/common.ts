import {
  type Abi,
  type AbiEvent,
  type Address,
  type Hex,
  getAddress,
  isAddress,
  isAddressEqual,
  keccak256,
  pad,
  toEventSelector,
  zeroAddress,
  toHex,
} from "viem";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { AppError, SdkConfigError } from "./errors";
import { timingSafeEqual } from "node:crypto";
import { type KeyVars } from "./constants";
import { english } from "viem/accounts";
import { get } from "lodash";

class Common {
  uuidv4 = () => randomUUID();

  isZeroAddress = (address: string) => address.toLowerCase() === zeroAddress;

  normalizeAddress = (address: string) => getAddress(address);

  isSameAddress = (a: Maybe<string>, b: Maybe<string>) => {
    return (
      !!a &&
      !!b &&
      isAddress(a, { strict: false }) &&
      isAddress(b, { strict: false }) &&
      isAddressEqual(a as Address, b as Address)
    );
  };

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

  eventTopicFromAbi = (abi: Abi, eventName: string) => {
    const fragment = this.eventFragmentFromAbi(abi, eventName);
    return fragment ? toEventSelector(fragment) : null;
  };

  serializeData = <T>(data: T): unknown => {
    return JSON.parse(
      JSON.stringify(data, (_key: string, value: unknown) => {
        return typeof value === "bigint" ? value.toString() : value;
      }),
    );
  };

  uuidToBytes32 = (uuid: string): Hex => {
    const hex = uuid.replaceAll("-", "").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hex)) {
      throw new AppError(`Invalid UUID: ${uuid}`);
    }

    return pad(`0x${hex}`, {
      size: 32,
    });
  };

  bytes32ToUuid = (value: string) => {
    const hex = value.toLowerCase();
    if (!/^0x0{32}[0-9a-f]{32}$/.test(hex)) {
      return null;
    }

    const raw = hex.slice(34);
    return [
      raw.slice(0, 8),
      raw.slice(8, 12),
      raw.slice(12, 16),
      raw.slice(16, 20),
      raw.slice(20),
    ].join("-");
  };

  isValidMnemonic = (value: string) => {
    const words = value.trim().normalize("NFKD").split(/\s+/);
    if (![12, 15, 18, 21, 24].includes(words.length)) {
      return false;
    }

    const indexes = words.map((word) => english.indexOf(word));
    if (indexes.some((index) => index < 0)) {
      return false;
    }

    const bits = indexes
      .map((index) => index.toString(2).padStart(11, "0"))
      .join("");

    const entropyBits = (bits.length * 32) / 33;
    const entropy = Buffer.from(
      bits
        .slice(0, entropyBits)
        .match(/.{8}/g)!
        .map((byte) => parseInt(byte, 2)),
    );

    const checksum = [...createHash("sha256").update(entropy).digest()]
      .map((byte) => byte.toString(2).padStart(8, "0"))
      .join("")
      .slice(0, bits.length - entropyBits);

    return checksum === bits.slice(entropyBits);
  };
}

export const common = new Common();
