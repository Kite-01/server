/**
 * ERC-4337 EntryPoint constants and EIP-7702 helpers.
 *
 * v0.8 is the default: it is the first EntryPoint with *native* EIP-7702
 * authorization support, which is exactly the delegation model we target.
 */
export const ENTRY_POINT_V06 = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
export const ENTRY_POINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
export const ENTRY_POINT_V08 = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";

export const DEFAULT_ENTRY_POINT = ENTRY_POINT_V08;

export type EntryPointVersion = "0.6" | "0.7" | "0.8";

const BY_ADDRESS: Record<string, EntryPointVersion> = {
  [ENTRY_POINT_V06.toLowerCase()]: "0.6",
  [ENTRY_POINT_V07.toLowerCase()]: "0.7",
  [ENTRY_POINT_V08.toLowerCase()]: "0.8",
};

export const entryPointVersion = (entryPoint: string): EntryPointVersion => {
  const version = BY_ADDRESS[entryPoint.trim().toLowerCase()];
  if (!version) {
    throw new Error(
      `Unknown EntryPoint "${entryPoint}". Known: v0.6 ${ENTRY_POINT_V06}, ` +
        `v0.7 ${ENTRY_POINT_V07}, v0.8 ${ENTRY_POINT_V08}`,
    );
  }
  return version;
};

/** v0.6 packs paymaster address + data into one field; v0.7/v0.8 split them. */
export const isPackedEntryPoint = (entryPoint: string): boolean =>
  entryPointVersion(entryPoint) === "0.6";

/**
 * A signed EIP-7702 authorization. This is what makes the EOA *itself* the
 * sender — no new counterfactual address, no stranded funds at the old one.
 *
 * It must be produced by the EOA's own key (viem's `signAuthorization`, or any
 * wallet that implements it); this repo only forwards it, it never signs.
 */
export type Eip7702Authorization = {
  /** 0 means "valid on any chain"; otherwise it must match the target chain. */
  chainId: number | string;
  /** The delegate implementation the EOA points at. */
  address: string;
  nonce: number | string;
  r: string;
  s: string;
  /** Either is accepted; `yParity` is the canonical spelling. */
  yParity?: number;
  v?: number | string;
};

export const assertValidAuthorization = (
  auth: Eip7702Authorization,
  evmChainId: number,
): void => {
  const missing = (["address", "r", "s"] as const).filter((k) => !auth[k]);
  if (missing.length) {
    throw new Error(
      `EIP-7702 authorization is missing: ${missing.join(", ")}`,
    );
  }

  if (auth.yParity === undefined && auth.v === undefined) {
    throw new Error("EIP-7702 authorization needs yParity (or v)");
  }

  const authChainId = Number(auth.chainId ?? 0);
  // chainId 0 is the wildcard defined by EIP-7702; anything else must match.
  if (authChainId !== 0 && authChainId !== evmChainId) {
    throw new Error(
      `EIP-7702 authorization is for chain ${authChainId}, not ${evmChainId}`,
    );
  }
};

/** Normalise to the hex-quantity shape both providers expect on the wire. */
export const serialiseAuthorization = (
  auth: Eip7702Authorization,
): Record<string, unknown> => {
  const yParity = auth.yParity ?? normaliseYParity(auth.v!);

  return {
    chainId: toHexQuantity(auth.chainId ?? 0),
    address: auth.address.toLowerCase(),
    nonce: toHexQuantity(auth.nonce ?? 0),
    r: auth.r,
    s: auth.s,
    yParity: toHexQuantity(yParity),
  };
};

/** Legacy `v` is 27/28; yParity is 0/1. */
const normaliseYParity = (v: number | string): number => {
  const value = Number(typeof v === "string" ? BigInt(v) : v);
  return value >= 27 ? value - 27 : value;
};

export const toHexQuantity = (value: number | string | bigint): string => {
  if (typeof value === "string" && value.startsWith("0x")) return value;
  return `0x${BigInt(value).toString(16)}`;
};
