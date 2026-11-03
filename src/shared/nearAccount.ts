// Imports nothing, so common.ts can use it without an import cycle through constants.ts.

/** The token address Kite stores for native NEAR, as the zero address is for native ETH. */
export const NearNativeToken = "near";

export const isNearAccountId = (value: string) => {
  return (
    value.length >= 2 &&
    value.length <= 64 &&
    /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value)
  );
};
