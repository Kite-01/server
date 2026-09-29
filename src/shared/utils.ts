export const toBigInt = (value: string | number | bigint): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  const trimmed = value.trim();
  return trimmed.startsWith("0x") ? BigInt(trimmed) : BigInt(trimmed || "0");
};

/**
 * Applies a comparison in base units.
 *
 * Only Moralis and QuickNode can express numeric comparisons provider-side;
 * Alchemy and Nodit deliver every matching transfer regardless of size. Run
 * every callback through this so the threshold is enforced the same way for all
 * four providers and a provider swap can't silently widen a filter.
 */
export const compareAmount = (
  actual: string | bigint,
  operation: ComparisonOperator,
  expected: string | bigint,
): boolean => {
  const a = toBigInt(actual);
  const b = toBigInt(expected);

  switch (operation) {
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

// export const rawBodyToString = (
//   input: OnchainNotifierVerifyCallbackInput,
// ): string => {
//   if (input.rawBody !== undefined) {
//     return Buffer.isBuffer(input.rawBody)
//       ? input.rawBody.toString("utf8")
//       : input.rawBody;
//   }
//   return JSON.stringify(input.body);
// };
