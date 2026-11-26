import { bech32 } from "@scure/base";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";

export const GnoNativeToken = "ugnot";

const RealmPath = /^gno\.land\/r\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+$/;

export const isGnoAddress = (value: string) => {
  if (!value.startsWith("g1") || value !== value.toLowerCase()) return false;
  try {
    const { prefix, words } = bech32.decode(value as `g1${string}`);
    return prefix === "g" && bech32.fromWords(words).length === 20;
  } catch {
    return false;
  }
};

export const isGnoRealm = (value: string) =>
  RealmPath.test(value) && value.length <= 256;

// ugnot, or a grc20reg key: <realm path>.<symbol>
export const isGnoToken = (value: string) => {
  if (value === GnoNativeToken) return true;
  const dot = value.lastIndexOf(".");
  return (
    dot > value.lastIndexOf("/") &&
    isGnoRealm(value.slice(0, dot)) &&
    /^[A-Za-z0-9_-]+$/.test(value.slice(dot + 1))
  );
};

export const isGnoValue = (value: string) =>
  isGnoAddress(value) || isGnoRealm(value) || isGnoToken(value);

const toAddress = (bytes: Uint8Array) =>
  bech32.encode("g", bech32.toWords(bytes.subarray(0, 20)));

// chain.DerivePkgSubAddr: a sub-realm's address, sha256 truncated to 20 bytes
export const gnoSubRealmAddress = (realm: string, subpath: string) =>
  toAddress(sha256(new TextEncoder().encode(`pkgPath:${realm}#${subpath}`)));

export const gnoPubKeyAddress = (publicKey: Uint8Array) =>
  toAddress(ripemd160(sha256(publicKey)));

// tm2 keys: secp256k1 on m/44'/118'/0'/0/<index>
export const gnoKey = (mnemonic: string, index = 0) => {
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(
    `m/44'/118'/0'/0/${index}`,
  );
  return {
    address: gnoPubKeyAddress(key.publicKey!),
    privateKey: key.privateKey!,
  };
};
