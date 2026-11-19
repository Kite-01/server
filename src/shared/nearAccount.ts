export const NearNativeToken = "near" as const;
export const isNearAccountId = (value: string) => {
  return (
    value.length >= 2 &&
    value.length <= 64 &&
    /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value)
  );
};
